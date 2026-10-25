package il.co.shuknadlan.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebBackForwardList;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
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

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShukShellPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge == null || bridge.getWebView() == null) return;
        WebView webView = bridge.getWebView();
        injectDocumentStart(webView);
        bridge.setWebViewClient(new ShellWebViewClient(bridge, this));
        // נרשם אחרי ה-callback של Capacitor, ולכן רץ ראשון ולא חוזר למסך האתחול.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleBack();
            }
        });
        handleOauthIntent(getIntent(), true);
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

    void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // אין אפליקציה לסוג הקישור. נשארים במסך הנוכחי.
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
