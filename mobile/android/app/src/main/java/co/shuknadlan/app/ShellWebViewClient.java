package co.shuknadlan.app;

import android.graphics.Bitmap;
import android.net.Uri;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * תופס OAuth וקישורים חיצוניים לפני שהם נטענים ב-WebView, ומציג את מסך
 * "אין רשת" כשהמסמך הראשי נכשל בגלל רשת. שאר הניווט נשאר אצל Capacitor.
 */
public class ShellWebViewClient extends BridgeWebViewClient {
    private final MainActivity activity;

    public ShellWebViewClient(Bridge bridge, MainActivity activity) {
        super(bridge);
        this.activity = activity;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (uri == null) return false;
        if (request.isForMainFrame() && consume(view, uri.toString())) return true;
        return super.shouldOverrideUrlLoading(view, request);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        if (request == null || !request.isForMainFrame() || error == null) return;
        int code = error.getErrorCode();
        if (code != WebViewClientCompat.ERROR_HOST_LOOKUP
            && code != WebViewClientCompat.ERROR_CONNECT
            && code != WebViewClientCompat.ERROR_IO
            && code != WebViewClientCompat.ERROR_TIMEOUT
            && code != WebViewClientCompat.ERROR_FAILED_SSL_HANDSHAKE) {
            return;
        }
        String failing = request.getUrl() == null ? "" : request.getUrl().toString();
        if (failing.contains("offline.html")) return;
        view.loadUrl(ShellUrls.OFFLINE);
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
    }

    private boolean consume(WebView view, String raw) {
        String rewritten = ShellUrls.rewriteAuthorize(raw);
        if (rewritten != null) {
            activity.rememberOauthReturn(view.getUrl());
            activity.openAuth(rewritten);
            return true;
        }
        if (ShellUrls.isExternal(raw)) {
            activity.openExternal(Uri.parse(raw));
            return true;
        }
        return false;
    }

    /** הקבועים של WebViewClient, בלי לרשת פעמיים. */
    private static final class WebViewClientCompat {
        static final int ERROR_HOST_LOOKUP = -2;
        static final int ERROR_CONNECT = -6;
        static final int ERROR_IO = -7;
        static final int ERROR_TIMEOUT = -8;
        static final int ERROR_FAILED_SSL_HANDSHAKE = -11;
    }
}
