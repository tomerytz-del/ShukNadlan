package co.shuknadlan.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
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

public class MainActivity extends BridgeActivity {
    private boolean bridgeInjected;

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
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null || bridge == null || bridge.getWebView() == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        String dest = ShellUrls.authReturn(data.toString(), readOauthReturn());
        if (dest != null) bridge.getWebView().loadUrl(dest);
    }

    void rememberOauthReturn(String current) {
        if (current == null || !current.startsWith(ShellUrls.SITE)) return;
        int hash = current.indexOf('#');
        String trimmed = hash >= 0 ? current.substring(0, hash) : current;
        prefs().edit().putString(ShukShellPlugin.OAUTH_RETURN, trimmed).apply();
    }

    void openAuth(String url) {
        try {
            CustomTabsIntent tabs = new CustomTabsIntent.Builder().setShowTitle(true).build();
            tabs.intent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY);
            tabs.launchUrl(this, Uri.parse(url));
        } catch (ActivityNotFoundException e) {
            openExternal(Uri.parse(url));
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
