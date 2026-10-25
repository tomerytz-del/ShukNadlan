package il.co.shuknadlan.app;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.GeolocationPermissions;
import android.webkit.WebBackForwardList;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.google.android.gms.ads.identifier.AdvertisingIdClient;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "ShukAuth";
    private static final int OAUTH_IDLE = 0;
    private static final int OAUTH_PENDING = 1;
    private static final int OAUTH_EXCHANGING = 2;

    private boolean bridgeInjected;
    private volatile int oauthState = OAUTH_IDLE;
    private String oauthHandledCode = "";
    private String lastExternalUrl = "";
    private long lastExternalAt;
    private Boolean trackingAllowed;
    private ActivityResultLauncher<String> coarseLocationLauncher;
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingGeoOrigin;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        coarseLocationLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            granted -> {
                GeolocationPermissions.Callback callback = pendingGeo;
                String origin = pendingGeoOrigin;
                pendingGeo = null;
                pendingGeoOrigin = null;
                if (callback != null) callback.invoke(origin, Boolean.TRUE.equals(granted), false);
            });
        registerPlugin(ShukShellPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge == null || bridge.getWebView() == null) return;
        WebView webView = bridge.getWebView();
        injectDocumentStart(webView);
        bridge.setWebViewClient(new ShellWebViewClient(bridge, this));
        // בלי זה target=_blank ו-window.open נזרקים, והלחיצה לא עושה כלום.
        webView.getSettings().setSupportMultipleWindows(true);
        webView.setWebChromeClient(new ShellWebChromeClient(bridge, this));
        // נרשם אחרי ה-callback של Capacitor, ולכן רץ ראשון ולא חוזר למסך האתחול.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleBack();
            }
        });
        handleOauthIntent(getIntent(), true);
        readTrackingOptOut();
    }

    /** "קרוב אלי" מקבל מיקום משוער. לא מבקשים ACCESS_FINE_LOCATION. */
    void allowCoarseLocation(String origin, GeolocationPermissions.Callback callback) {
        if (callback == null) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
            == PackageManager.PERMISSION_GRANTED) {
            callback.invoke(origin, true, false);
            return;
        }
        pendingGeo = callback;
        pendingGeoOrigin = origin;
        coarseLocationLauncher.launch(Manifest.permission.ACCESS_COARSE_LOCATION);
    }

    void showPurchaseNote(WebView view) {
        if (view == null) return;
        String current = view.getUrl() == null ? "" : view.getUrl();
        if (current.startsWith(ShellUrls.PURCHASE_NOTE)) return;
        view.loadUrl(ShellUrls.PURCHASE_NOTE);
    }

    void pushTracking(WebView view) {
        if (trackingAllowed == null || view == null) return;
        view.evaluateJavascript(
            "try{if(window.ShukNadlanApp&&window.ShukNadlanApp.setTrackingAllowed)"
                + "window.ShukNadlanApp.setTrackingAllowed(" + trackingAllowed + ");}catch(e){}",
            null);
    }

    private void readTrackingOptOut() {
        new Thread(() -> {
            boolean allowed = true;
            try {
                AdvertisingIdClient.Info info = AdvertisingIdClient.getAdvertisingIdInfo(getApplicationContext());
                if (info != null && info.isLimitAdTrackingEnabled()) allowed = false;
            } catch (Throwable ignored) {
                allowed = true;
            }
            final boolean value = allowed;
            runOnUiThread(() -> {
                trackingAllowed = value;
                if (bridge != null) pushTracking(bridge.getWebView());
            });
        }, "shuk-tracking").start();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (oauthState != OAUTH_PENDING || bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().postDelayed(() -> {
            if (oauthState == OAUTH_PENDING) {
                Log.i(TAG, "oauth closed without a callback");
                deliverOauthError(readOauthReturn(), true, false);
            }
        }, 700);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleOauthIntent(intent, false);
    }

    private void handleOauthIntent(Intent intent, boolean coldStart) {
        if (intent == null || bridge == null || bridge.getWebView() == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        String scheme = data.getScheme() == null ? "" : data.getScheme().toLowerCase(Locale.US);
        if ("il.co.shuknadlan.app".equals(scheme) && "auth-callback".equals(data.getHost())) {
            completeOauth(data);
            return;
        }
        if (coldStart) return;
        String dest = ShellUrls.authReturn(data.toString(), readOauthReturn());
        if (dest != null) bridge.getWebView().loadUrl(dest);
    }

    private void completeOauth(Uri data) {
        String error = data.getQueryParameter("error");
        String code = data.getQueryParameter("code");
        if (code != null && code.equals(oauthHandledCode)) return;
        oauthState = OAUTH_EXCHANGING;
        String back = readOauthReturn();
        Log.i(TAG, "oauth callback hasCode=" + (code != null && !code.isEmpty())
            + " hasError=" + (error != null && !error.isEmpty()));
        if (error != null && !error.isEmpty()) {
            deliverOauthError(back, isCancel(error), true);
            return;
        }
        if (code == null || code.isEmpty()) {
            deliverOauthError(back, false, true);
            return;
        }
        oauthHandledCode = code;
        String verifier = prefs().getString(ShukShellPlugin.OAUTH_VERIFIER, "");
        prefs().edit().remove(ShukShellPlugin.OAUTH_VERIFIER).apply();
        if (verifier == null || verifier.isEmpty()) {
            Log.i(TAG, "oauth callback without a stored verifier");
            deliverOauthError(back, false, false);
            return;
        }
        final String codeFinal = code;
        final String verifierFinal = verifier;
        new Thread(() -> {
            try {
                JSONObject session = OauthFlow.exchange(codeFinal, verifierFinal);
                String dest = OauthFlow.implicitReturn(back, session);
                runOnUiThread(() -> {
                    oauthState = OAUTH_IDLE;
                    loadOauthDest(dest);
                });
            } catch (Exception e) {
                Log.w(TAG, "oauth token exchange failed: " + e.getMessage());
                runOnUiThread(() -> deliverOauthError(back, false, false));
            }
        }, "shuk-oauth").start();
    }

    private static boolean isCancel(String error) {
        String value = error.toLowerCase(Locale.US);
        return value.contains("access_denied") || value.contains("cancel");
    }

    private void deliverOauthError(String back, boolean cancel, boolean clearVerifier) {
        oauthState = OAUTH_IDLE;
        if (clearVerifier) prefs().edit().remove(ShukShellPlugin.OAUTH_VERIFIER).apply();
        resetGoogleButtonNow(cancel ? OauthFlow.CANCELLED : OauthFlow.FAILED);
        loadOauthDest(OauthFlow.errorReturn(back, cancel));
    }

    /** מאפס את כפתור Google גם אם טעינת הדף עם השגיאה לא מספיקה להחליף את המסמך. */
    private void resetGoogleButtonNow(String message) {
        WebView view = bridge == null ? null : bridge.getWebView();
        if (view == null) return;
        String quoted = JSONObject.quote(message);
        view.evaluateJavascript(
            "try{if(window.ShukNative&&window.ShukNative.failOAuth)window.ShukNative.failOAuth("
                + quoted + ");}catch(e){}",
            null);
    }

    private void loadOauthDest(String dest) {
        WebView view = bridge == null ? null : bridge.getWebView();
        if (view == null || dest == null || dest.isEmpty()) return;
        view.loadUrl(dest);
    }

    void rememberOauthReturn(String current) {
        if (current == null || !current.startsWith(ShellUrls.SITE)) return;
        int hash = current.indexOf('#');
        String trimmed = hash >= 0 ? current.substring(0, hash) : current;
        prefs().edit().putString(ShukShellPlugin.OAUTH_RETURN, trimmed).apply();
    }

    void openAuth(String url) {
        String launch = url;
        try {
            if (url.contains("/auth/v1/authorize") && !OauthFlow.hasChallenge(url)) {
                String verifier = OauthFlow.verifier();
                launch = OauthFlow.attach(url, verifier);
                prefs().edit().putString(ShukShellPlugin.OAUTH_VERIFIER, verifier).apply();
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "oauth pkce failed");
            deliverOauthError(readOauthReturn(), false, true);
            return;
        }
        oauthState = OAUTH_PENDING;
        oauthHandledCode = "";
        try {
            CustomTabsIntent tabs = new CustomTabsIntent.Builder().setShowTitle(true).build();
            tabs.launchUrl(this, Uri.parse(launch));
        } catch (ActivityNotFoundException e) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(launch)));
            } catch (ActivityNotFoundException again) {
                deliverOauthError(readOauthReturn(), false, true);
            }
        }
    }

    /**
     * קישור החוצה. ה-WebView נשאר על הדף הנוכחי, כדי שאחרי וואטסאפ אפשר
     * לחזור ולאמת את הכניסה. מחזיר false רק אם אין לאן לפתוח.
     */
    boolean openExternal(Uri uri) {
        if (uri == null) return false;
        String raw = uri.toString();
        long now = android.os.SystemClock.uptimeMillis();
        if (raw.equals(lastExternalUrl) && now - lastExternalAt < 800) return true;
        boolean opened = false;
        for (WhatsappLinks.Step step : WhatsappLinks.plan(raw)) {
            if (launch(step)) {
                opened = true;
                lastExternalUrl = raw;
                lastExternalAt = now;
                break;
            }
        }
        if (!opened) {
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.US);
            Log.i("ShukShell", "open failed scheme=" + scheme);
        }
        return opened;
    }

    /** חלון שנפתח מ-target=_blank או מ-window.open. לא מחליף את הדף אם הקישור חיצוני. */
    void dispatchPopup(WebView main, String raw) {
        String rewritten = ShellUrls.rewriteAuthorize(raw);
        if (rewritten != null) {
            rememberOauthReturn(main == null ? null : main.getUrl());
            openAuth(rewritten);
            return;
        }
        if (ShellUrls.isPurchase(raw)) {
            showPurchaseNote(main);
            return;
        }
        if (ShellUrls.isExternal(raw) || !ShellUrls.staysInApp(raw)) {
            openExternal(Uri.parse(raw));
            return;
        }
        if (main != null) main.loadUrl(raw);
    }

    private boolean launch(WhatsappLinks.Step step) {
        Uri uri = Uri.parse(step.url);
        if (step.kind == WhatsappLinks.Kind.WHATSAPP) {
            return startView(uri, step.pkg);
        }
        return startView(uri, null);
    }

    private boolean startView(Uri uri, String pkg) {
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        if (pkg != null) {
            if (!WhatsappLinks.allowedPackage(pkg)) return false;
            intent.setPackage(pkg);
        }
        // DEFAULT בלי BROWSABLE: חייגן ווואטסאפ מצהירים על DEFAULT, ו-BROWSABLE
        // נוסף היה מפיל חייגן שלא מצהיר עליו.
        intent.addCategory(Intent.CATEGORY_DEFAULT);
        try {
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    private void handleBack() {
        WebView view = bridge == null ? null : bridge.getWebView();
        if (view != null && view.canGoBack()) {
            WebBackForwardList list = view.copyBackForwardList();
            int index = list.getCurrentIndex();
            if (index > 0) {
                String prev = list.getItemAtIndex(index - 1).getUrl();
                if (ShellUrls.isLocalShell(prev)) {
                    moveTaskToBack(true);
                    return;
                }
            }
            view.goBack();
            return;
        }
        moveTaskToBack(true);
    }

    private void injectDocumentStart(WebView webView) {
        if (bridgeInjected) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        try (InputStream in = getAssets().open("public/native-bridge.js")) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] tmp = new byte[4096];
            int n;
            while ((n = in.read(tmp)) >= 0) buf.write(tmp, 0, n);
            String js = buf.toString(StandardCharsets.UTF_8.name());
            WebViewCompat.addDocumentStartJavaScript(webView, js, Collections.singleton("*"));
            bridgeInjected = true;
        } catch (IOException ignored) {
            // מדיניות הכתובות ב-ShellWebViewClient עדיין תופסת OAuth וקישורים חיצוניים.
        }
    }

    private String readOauthReturn() {
        return prefs().getString(ShukShellPlugin.OAUTH_RETURN, "");
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(ShukShellPlugin.PREFS, MODE_PRIVATE);
    }
}
