package il.co.shuknadlan.app;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * איך פותחים קישור וואטסאפ מחוץ ל-WebView. הלוגיקה בלי Android כדי שאפשר
 * לבדוק אותה: קודם האפליקציה, אחר כך הדפדפן, ואז החנות.
 * כפתור אימות הכניסה הוא https://wa.me עם target=_blank. קישורי העוזר
 * באנדרואיד הם intent:// עם package של וואטסאפ ביזנס.
 */
public final class WhatsappLinks {
    public static final String PERSONAL = "com.whatsapp";
    public static final String BUSINESS = "com.whatsapp.w4b";

    public enum Kind { WHATSAPP, VIEW, STORE }

    public static final class Step {
        public final Kind kind;
        public final String url;
        public final String pkg;

        Step(Kind kind, String url, String pkg) {
            this.kind = kind;
            this.url = url;
            this.pkg = pkg;
        }
    }

    private WhatsappLinks() {}

    public static boolean allowedPackage(String pkg) {
        return PERSONAL.equals(pkg) || BUSINESS.equals(pkg);
    }

    /** סדר ניסיונות. הראשון שנפתח מנצח. רשימה ריקה - לא קישור שאנחנו פותחים. */
    public static List<Step> plan(String raw) {
        List<Step> steps = new ArrayList<>();
        fill(raw, steps, 0);
        return steps;
    }

    private static void fill(String raw, List<Step> steps, int depth) {
        if (raw == null || raw.isEmpty() || depth > 3) return;
        String trimmed = raw.trim();
        if (startsWithScheme(trimmed, "intent")) {
            IntentParts parts = parseIntent(trimmed);
            if (parts == null) return;
        if (parts.sendUrl != null) {
            String pkg = allowedPackage(parts.pkg) ? parts.pkg : null;
            addWhatsapp(steps, parts.sendUrl, pkg);
            if (pkg != null) addWhatsapp(steps, parts.sendUrl, other(pkg));
            addWhatsapp(steps, parts.sendUrl, null);
        } else if (parts.webUrl != null) {
            fill(parts.webUrl, steps, depth + 1);
        }
        if (parts.fallback != null && !parts.fallback.equals(trimmed)) {
            fill(parts.fallback, steps, depth + 1);
        }
        if (parts.sendUrl != null) addStore(steps);
        return;
    }
        String send = toSendUrl(trimmed);
        if (send != null) {
            addWhatsapp(steps, send, null);
            addWhatsapp(steps, send, PERSONAL);
            addWhatsapp(steps, send, BUSINESS);
            if (startsWithScheme(trimmed, "https") || startsWithScheme(trimmed, "http")) {
                addView(steps, trimmed);
            }
            addStore(steps);
            return;
        }
        if (isViewable(trimmed)) addView(steps, trimmed);
    }

    /** whatsapp://send, או null אם זה לא קישור שליחת הודעה. */
    public static String toSendUrl(String raw) {
        if (raw == null) return null;
        URI uri = parse(raw);
        if (uri == null) return null;
        String scheme = scheme(uri);
        if ("whatsapp".equals(scheme)) return raw.trim();
        if (!"https".equals(scheme) && !"http".equals(scheme)) return null;
        String host = stripWww(host(uri));
        Map<String, String> query = query(uri.getRawQuery());
        if ("wa.me".equals(host)) {
            String seg = singleSegment(uri.getPath());
            String phone = "send".equals(seg) ? digits(query.get("phone")) : digits(seg);
            if ((phone == null || phone.isEmpty()) && query.get("phone") != null) phone = digits(query.get("phone"));
            return buildSend(phone, query.get("text"));
        }
        if ("api.whatsapp.com".equals(host) || "web.whatsapp.com".equals(host)) {
            String path = uri.getPath() == null ? "" : uri.getPath();
            if (!path.equals("/send") && !path.startsWith("/send/")) return null;
            return buildSend(digits(query.get("phone")), query.get("text"));
        }
        return null;
    }

    static final class IntentParts {
        final String sendUrl;
        final String webUrl;
        final String pkg;
        final String fallback;

        IntentParts(String sendUrl, String webUrl, String pkg, String fallback) {
            this.sendUrl = sendUrl;
            this.webUrl = webUrl;
            this.pkg = pkg;
            this.fallback = fallback;
        }
    }

    static IntentParts parseIntent(String raw) {
        int marker = raw.indexOf("#Intent;");
        if (marker < 0 || !startsWithScheme(raw, "intent")) return null;
        String data = raw.substring(raw.indexOf(':') + 1, marker);
        String tail = raw.substring(marker + "#Intent;".length());
        if (tail.endsWith(";end")) tail = tail.substring(0, tail.length() - 4);
        else if (tail.endsWith("end")) tail = tail.substring(0, tail.length() - 3);
        String scheme = null;
        String pkg = null;
        String fallback = null;
        for (String part : tail.split(";")) {
            if (part.startsWith("scheme=")) scheme = part.substring("scheme=".length());
            else if (part.startsWith("package=")) pkg = part.substring("package=".length());
            else if (part.startsWith("S.browser_fallback_url=")) {
                fallback = decode(part.substring("S.browser_fallback_url=".length()));
            }
        }
        String sendUrl = null;
        String webUrl = null;
        if (data.startsWith("//")) {
            if ("whatsapp".equals(scheme)) sendUrl = "whatsapp:" + data;
            else if ("https".equals(scheme) || "http".equals(scheme)) webUrl = scheme + ":" + data;
        }
        return new IntentParts(sendUrl, webUrl, pkg, fallback);
    }

    private static void addWhatsapp(List<Step> steps, String url, String pkg) {
        steps.add(new Step(Kind.WHATSAPP, url, pkg));
    }

    private static void addView(List<Step> steps, String url) {
        steps.add(new Step(Kind.VIEW, url, null));
    }

    private static void addStore(List<Step> steps) {
        steps.add(new Step(Kind.STORE, "market://details?id=" + PERSONAL, null));
        steps.add(new Step(Kind.STORE, "https://play.google.com/store/apps/details?id=" + PERSONAL, null));
    }

    private static String other(String pkg) {
        return BUSINESS.equals(pkg) ? PERSONAL : BUSINESS;
    }

    private static String buildSend(String phone, String text) {
        StringBuilder b = new StringBuilder("whatsapp://send");
        boolean any = false;
        if (phone != null && !phone.isEmpty()) {
            b.append(any ? "&" : "?").append("phone=").append(enc(phone));
            any = true;
        }
        if (text != null) {
            b.append(any ? "&" : "?").append("text=").append(enc(text));
        }
        return b.toString();
    }

    private static String singleSegment(String path) {
        if (path == null || path.isEmpty() || "/".equals(path)) return "";
        String seg = path.startsWith("/") ? path.substring(1) : path;
        if (seg.endsWith("/")) seg = seg.substring(0, seg.length() - 1);
        if (seg.indexOf('/') >= 0) return "";
        return seg;
    }

    private static String digits(String raw) {
        if (raw == null || raw.isEmpty()) return "";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c >= '0' && c <= '9') b.append(c);
        }
        return b.toString();
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> out = new LinkedHashMap<>();
        if (raw == null || raw.isEmpty()) return out;
        for (String part : raw.split("&")) {
            int eq = part.indexOf('=');
            String key = decode(eq < 0 ? part : part.substring(0, eq));
            String value = decode(eq < 0 ? "" : part.substring(eq + 1));
            if (!key.isEmpty()) out.put(key, value);
        }
        return out;
    }

    private static boolean isViewable(String raw) {
        return startsWithScheme(raw, "https") || startsWithScheme(raw, "http")
            || startsWithScheme(raw, "tel") || startsWithScheme(raw, "mailto")
            || startsWithScheme(raw, "sms") || startsWithScheme(raw, "geo");
    }

    private static boolean startsWithScheme(String raw, String scheme) {
        int colon = raw.indexOf(':');
        if (colon <= 0) return false;
        return raw.substring(0, colon).equalsIgnoreCase(scheme);
    }

    private static URI parse(String raw) {
        try {
            return new URI(raw.trim());
        } catch (URISyntaxException e) {
            return null;
        }
    }

    private static String scheme(URI uri) {
        String s = uri.getScheme();
        return s == null ? "" : s.toLowerCase(Locale.US);
    }

    private static String host(URI uri) {
        String h = uri.getHost();
        return h == null ? "" : h.toLowerCase(Locale.US);
    }

    private static String stripWww(String host) {
        return host.startsWith("www.") ? host.substring(4) : host;
    }

    private static String enc(String raw) {
        try {
            return URLEncoder.encode(raw, "UTF-8").replace("+", "%20");
        } catch (UnsupportedEncodingException e) {
            return raw;
        }
    }

    private static String decode(String raw) {
        try {
            return URLDecoder.decode(raw, "UTF-8");
        } catch (IllegalArgumentException | UnsupportedEncodingException e) {
            return raw;
        }
    }
}
