package il.co.shuknadlan.app;

import android.graphics.Bitmap;
import android.net.Uri;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
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
        showFailure(view, request.getUrl() == null ? "" : request.getUrl().toString(), "net");
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        super.onReceivedHttpError(view, request, errorResponse);
        if (request == null || !request.isForMainFrame() || errorResponse == null) return;
        if (errorResponse.getStatusCode() < 400) return;
        showFailure(view, request.getUrl() == null ? "" : request.getUrl().toString(), "http");
    }

    private void showFailure(WebView view, String failing, String why) {
        if (failing.contains("offline.html") || failing.contains("purchase-note")) return;
        String current = view.getUrl() == null ? "" : view.getUrl();
        if (current.contains("offline.html")) return;
        view.loadUrl(ShellUrls.offlineFor(why, failing));
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        activity.pushTracking(view);
    }

    private boolean consume(WebView view, String raw) {
        String rewritten = ShellUrls.rewriteAuthorize(raw);
        if (rewritten != null) {
            activity.rememberOauthReturn(view.getUrl());
            activity.openAuth(rewritten);
            return true;
        }
        if (ShellUrls.isPurchase(raw)) {
            activity.showPurchaseNote(view);
            return true;
        }
        if (ShellUrls.isExternal(raw)) {
            activity.openExternal(Uri.parse(raw));
            return true;
        }
        return false;
    }
}
