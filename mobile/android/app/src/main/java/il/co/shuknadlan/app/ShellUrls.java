package il.co.shuknadlan.app;

import android.net.Uri;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * כללי הניווט של השלד. העותק ב-Java הוא מה שה-WebView באמת מציית לו;
 * www/native-bridge.js הוא אותו חוזה ל-JS ולבדיקות. שינוי באחד דורש את השני.
 */
public final class ShellUrls {
    public static final String SITE = "https://shuknadlan.co.il";
    public static final String SITE_HOST = "shuknadlan.co.il";
    public static final String AUTH_CALLBACK = "il.co.shuknadlan.app://auth-callback";
    public static final String OFFLINE = "https://localhost/offline.html";
    public static final String PURCHASE_NOTE = "https://localhost/purchase-note.html";

    private ShellUrls() {}

    /** כתובת authorize של Supabase, עם redirect_to לסכמה של האפליקציה. Google נשאר כמו שהוא. */
    public static String rewriteAuthorize(String raw) {
        Uri uri = parse(raw);
        if (uri == null) return null;
        String host = host(uri);
        boolean authorize = host.endsWith(".supabase.co") && path(uri).contains("/auth/v1/authorize");
        boolean google = "accounts.google.com".equals(host);
        if (!authorize && !google) return null;
        if (!authorize) return uri.toString();
        Uri.Builder b = uri.buildUpon().clearQuery();
        Map<String, String> params = new LinkedHashMap<>();
        for (String name : uri.getQueryParameterNames()) {
            if (!"redirect_to".equals(name)) params.put(name, uri.getQueryParameter(name));
        }
        params.put("redirect_to", AUTH_CALLBACK);
        for (Map.Entry<String, String> e : params.entrySet()) {
            b.appendQueryParameter(e.getKey(), e.getValue());
        }
        return b.build().toString();
    }

    public static boolean isExternal(String raw) {
        Uri uri = parse(raw);
        if (uri == null) return false;
        String scheme = scheme(uri);
        if (scheme.equals("tel") || scheme.equals("mailto") || scheme.equals("sms")
            || scheme.equals("geo") || scheme.equals("whatsapp") || scheme.equals("intent")) {
            return true;
        }
        if (!scheme.equals("http") && !scheme.equals("https")) return false;
        String host = stripWww(host(uri));
        if (host.equals("wa.me") || host.equals("api.whatsapp.com")
            || host.equals("web.whatsapp.com") || host.equals("chat.whatsapp.com")) {
            return true;
        }
        if (host.equals("waze.com") || host.equals("ul.waze.com")) return true;
        if (host.equals("maps.apple.com") || host.equals("maps.google.com") || host.equals("maps.app.goo.gl")) {
            return true;
        }
        String path = path(uri);
        if (host.equals("google.com") && path.startsWith("/maps")) return true;
        if (host.equals("goo.gl") && path.startsWith("/maps")) return true;
        return false;
    }

    /** דף של האתר או של השלד המקומי. נשאר ב-WebView, כולל window.open. */
    public static boolean staysInApp(String raw) {
        Uri uri = parse(raw);
        if (uri == null) return false;
        String scheme = scheme(uri);
        if (!scheme.equals("https") && !scheme.equals("http")) return false;
        String host = host(uri);
        if (host.equals(SITE_HOST) || host.endsWith("." + SITE_HOST)) return true;
        return "localhost".equals(host);
    }

    /** מסלולים, קופה, או עמוד הסליקה. לא נפתח בדפדפן ולא בתוך ה-WebView. */
    public static boolean isPurchase(String raw) {
        Uri uri = parse(raw);
        if (uri == null) return false;
        String scheme = scheme(uri);
        if (!scheme.equals("http") && !scheme.equals("https")) return false;
        String host = stripWww(host(uri));
        if (isPaymentHost(host)) return true;
        if (!host.equals(SITE_HOST) && !host.endsWith("." + SITE_HOST) && !"localhost".equals(host)) {
            return false;
        }
        String path = path(uri);
        if (path.endsWith(".html")) path = path.substring(0, path.length() - 5);
        if (path.endsWith("/")) path = path.substring(0, path.length() - 1);
        if (path.isEmpty()) path = "/";
        return "/pricing".equals(path) || "/checkout".equals(path);
    }

    private static boolean isPaymentHost(String host) {
        return host.equals("greeninvoice.co.il") || host.endsWith(".greeninvoice.co.il")
            || host.equals("morning.co") || host.endsWith(".morning.co")
            || host.equals("morning.dev") || host.endsWith(".morning.dev");
    }

    /**
     * מחזיר כתובת https באתר. קישור עומק נשאר כמו שהוא.
     * סכמת האפליקציה (חזרה מ-OAuth) מודבקת על הדף שממנו יצאו, או על /crm.
     */
    public static String authReturn(String callbackUrl, String returnTo) {
        Uri cb = parse(callbackUrl);
        if (cb == null) return null;
        if ("https".equals(scheme(cb)) && SITE_HOST.equals(host(cb))) return cb.toString();
        if (!"il.co.shuknadlan.app".equals(scheme(cb))) return null;
        Uri dest = parse(returnTo);
        if (dest == null || !"https".equals(scheme(dest)) || !SITE_HOST.equals(host(dest))) {
            dest = Uri.parse(SITE + "/crm");
        }
        Map<String, String> params = new LinkedHashMap<>();
        for (String name : dest.getQueryParameterNames()) params.put(name, dest.getQueryParameter(name));
        for (String name : cb.getQueryParameterNames()) params.put(name, cb.getQueryParameter(name));
        Uri.Builder b = dest.buildUpon().clearQuery();
        for (Map.Entry<String, String> e : params.entrySet()) {
            b.appendQueryParameter(e.getKey(), e.getValue());
        }
        String fragment = cb.getEncodedFragment();
        if (fragment != null && !fragment.isEmpty()) b.encodedFragment(fragment);
        return b.build().toString();
    }

    public static boolean isLocalShell(String raw) {
        Uri uri = parse(raw);
        if (uri == null) return false;
        return "localhost".equals(host(uri));
    }

    private static Uri parse(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        Uri uri = Uri.parse(raw);
        if (uri.getScheme() == null) return null;
        return uri;
    }

    private static String scheme(Uri uri) {
        String s = uri.getScheme();
        return s == null ? "" : s.toLowerCase(Locale.US);
    }

    private static String host(Uri uri) {
        String h = uri.getHost();
        return h == null ? "" : h.toLowerCase(Locale.US);
    }

    private static String stripWww(String host) {
        return host.startsWith("www.") ? host.substring(4) : host;
    }

    private static String path(Uri uri) {
        String p = uri.getPath();
        return p == null ? "" : p;
    }
}
