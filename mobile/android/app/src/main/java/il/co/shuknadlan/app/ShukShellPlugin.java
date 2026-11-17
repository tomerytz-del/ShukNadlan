package il.co.shuknadlan.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** פתיחת קישור מחוץ ל-WebView, וקריאת הדף שאליו חוזרים אחרי Google. */
@CapacitorPlugin(name = "ShukShell")
public class ShukShellPlugin extends Plugin {
    static final String PREFS = "shuk_shell";
    static final String OAUTH_RETURN = "oauth_return";
    static final String OAUTH_VERIFIER = "oauth_verifier";
    /** broker או visitor. חסר, או כל ערך אחר, נקרא כ-visitor. */
    static final String SUPPORT_AUDIENCE = "support_audience";

    @PluginMethod
    public void openExternal(PluginCall call) {
        String raw = call.getString("url");
        Uri uri = raw == null ? null : Uri.parse(raw);
        if (uri == null || uri.getScheme() == null) {
            call.reject("bad_url");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("no_activity");
            return;
        }
        if (activity instanceof MainActivity && ((MainActivity) activity).openExternal(uri)) {
            call.resolve();
            return;
        }
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, uri));
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("open_failed");
        }
    }

    @PluginMethod
    public void consumeOAuthReturn(PluginCall call) {
        Activity activity = getActivity();
        String url = "";
        if (activity != null) {
            SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            url = prefs.getString(OAUTH_RETURN, "");
            prefs.edit().remove(OAUTH_RETURN).apply();
        }
        JSObject ret = new JSObject();
        ret.put("url", url == null ? "" : url);
        call.resolve(ret);
    }

    /** הדגל שמסך "אין רשת" קורא. רק broker או visitor, בלי מזהה משתמש. */
    @PluginMethod
    public void setSupportAudience(PluginCall call) {
        String audience = "broker".equals(call.getString("audience")) ? "broker" : "visitor";
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("no_activity");
            return;
        }
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(SUPPORT_AUDIENCE, audience)
            .apply();
        call.resolve();
    }
}
