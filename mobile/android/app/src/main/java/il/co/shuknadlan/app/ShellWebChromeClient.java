package il.co.shuknadlan.app;

import android.net.Uri;
import android.os.Message;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * target=_blank ו-window.open לא מגיעים ל-shouldOverrideUrlLoading כשאין
 * תמיכה בחלונות. WebView זורק אותם, והכפתור נראה מת. חלון זמני תופס את
 * הכתובת ונזרק; הדף שנשאר על המסך לא מוחלף.
 */
public class ShellWebChromeClient extends BridgeWebChromeClient {
    private final MainActivity activity;

    public ShellWebChromeClient(Bridge bridge, MainActivity activity) {
        super(bridge);
        this.activity = activity;
    }

    @Override
    public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
        if (resultMsg == null || !(resultMsg.obj instanceof WebView.WebViewTransport)) return false;
        final WebView popup = new WebView(view.getContext());
        popup.getSettings().setJavaScriptEnabled(false);
        popup.getSettings().setAllowFileAccess(false);
        popup.setWebViewClient(new WebViewClient() {
            private boolean taken;

            @Override
            public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
                String url = request.getUrl() == null ? "" : request.getUrl().toString();
                if (url.isEmpty() || url.startsWith("about:")) return false;
                take(view, popupView, url);
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView popupView, String url) {
                if (url == null || url.isEmpty() || url.startsWith("about:")) return false;
                take(view, popupView, url);
                return true;
            }

            @Override
            public void onPageStarted(WebView popupView, String url, android.graphics.Bitmap favicon) {
                take(view, popupView, url);
            }

            private void take(WebView main, WebView popupView, String url) {
                if (taken || url == null || url.isEmpty() || url.startsWith("about:")) return;
                taken = true;
                activity.dispatchPopup(main, url);
                popupView.post(() -> {
                    popupView.stopLoading();
                    popupView.destroy();
                });
            }
        });
        WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
        transport.setWebView(popup);
        resultMsg.sendToTarget();
        return true;
    }
}
