package il.co.shuknadlan.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import org.json.JSONObject;

/**
 * כניסת Google באתר היא implicit: supabase-js 2.116 לא שולח code_challenge,
 * והאסימונים חוזרים ב-fragment. מערכת Android מורידה fragment מ-Intent, ולכן
 * החזרה לאפליקציה מגיעה בלי session והדף שממנו יצאו לא נטען מחדש.
 * כאן מוסיפים PKCE, מחליפים את ה-code באסימונים, ומחזירים אותם כ-hash שהלקוח
 * הקיים באתר כבר יודע לקרוא.
 */
public final class OauthFlow {
    public static final String CANCELLED =
        "ההתחברות עם Google בוטלה. אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.";
    public static final String FAILED =
        "ההתחברות עם Google נכשלה: אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.";

    private static final String TOKEN_URL =
        "https://obookujgolazrwycsiyn.supabase.co/auth/v1/token?grant_type=pkce";
    private static final String ANON =
        "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
    private static final char[] B64 =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toCharArray();

    private OauthFlow() {}

    public static boolean hasChallenge(String raw) {
        if (raw == null) return false;
        int q = raw.indexOf('?');
        if (q < 0) return false;
        int h = raw.indexOf('#', q);
        String query = h < 0 ? raw.substring(q + 1) : raw.substring(q + 1, h);
        for (String part : query.split("&")) {
            if (part.startsWith("code_challenge=")) return true;
        }
        return false;
    }

    public static String verifier() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return base64Url(bytes);
    }

    /** RFC 7636 S256. */
    public static String challenge(String verifier) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return base64Url(digest);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static String attach(String authorizeUrl, String verifier) {
        String challenge = challenge(verifier);
        int hash = authorizeUrl.indexOf('#');
        String base = hash >= 0 ? authorizeUrl.substring(0, hash) : authorizeUrl;
        String frag = hash >= 0 ? authorizeUrl.substring(hash) : "";
        String sep = base.contains("?") ? "&" : "?";
        return base + sep + "code_challenge=" + challenge
            + "&code_challenge_method=s256" + frag;
    }

    public static String safeReturn(String returnTo) {
        String base = returnTo == null ? "" : returnTo;
        int hash = base.indexOf('#');
        if (hash >= 0) base = base.substring(0, hash);
        if (!base.startsWith(ShellUrls.SITE + "/") && !base.equals(ShellUrls.SITE)) {
            return ShellUrls.SITE + "/crm";
        }
        return base;
    }

    /** כתובת שהלקוח ה-implicit באתר קורא ממנה session בזמן האתחול. */
    public static String implicitReturn(String returnTo, JSONObject session) {
        String expires = session.has("expires_in")
            ? String.valueOf(session.opt("expires_in")) : "3600";
        if ("null".equals(expires) || expires.isEmpty()) expires = "3600";
        String type = session.optString("token_type", "bearer");
        return implicitReturn(returnTo,
            session.optString("access_token", ""),
            session.optString("refresh_token", ""),
            expires,
            type);
    }

    public static String implicitReturn(String returnTo, String access, String refresh,
                                        String expires, String type) {
        if (access == null || access.isEmpty() || refresh == null || refresh.isEmpty()) {
            throw new IllegalArgumentException("session");
        }
        if (expires == null || expires.isEmpty()) expires = "3600";
        if (type == null || type.isEmpty()) type = "bearer";
        String frag = "access_token=" + urlEncode(access)
            + "&refresh_token=" + urlEncode(refresh)
            + "&expires_in=" + urlEncode(expires)
            + "&token_type=" + urlEncode(type);
        // פרמטר השאילתה מכריח טעינת מסמך חדשה. שינוי של ה-hash בלבד
        // לא מריץ מחדש את supabase-js, והכפתור נשאר על "מעבירים ל-Google…".
        String base = safeReturn(returnTo);
        String sep = base.contains("?") ? "&" : "?";
        return base + sep + "shuk_oauth=" + System.currentTimeMillis() + "#" + frag;
    }

    /** שגיאה ב-query, כדי שמסך הכניסה הקיים יציג אותה ויאפס את הכפתור. */
    public static String errorReturn(String returnTo, boolean cancel) {
        String base = safeReturn(returnTo);
        String sep = base.contains("?") ? "&" : "?";
        if (cancel) return base + sep + "error=access_denied";
        return base + sep + "error=server_error&error_description="
            + urlEncode("אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.");
    }

    public static JSONObject exchange(String code, String verifier) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(TOKEN_URL).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("apikey", ANON);
        conn.setRequestProperty("Authorization", "Bearer " + ANON);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", "application/json");
        byte[] body;
        try {
            JSONObject payload = new JSONObject();
            payload.put("auth_code", code);
            payload.put("code_verifier", verifier);
            body = payload.toString().getBytes(StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IOException("token body");
        }
        conn.setFixedLengthStreamingMode(body.length);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(body);
        }
        int status = conn.getResponseCode();
        InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String text = read(in);
        if (status < 200 || status >= 300) {
            throw new IOException("token status " + status);
        }
        try {
            JSONObject json = new JSONObject(text);
            if (json.optString("access_token", "").isEmpty()
                || json.optString("refresh_token", "").isEmpty()) {
                throw new IOException("token missing session");
            }
            return json;
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException("token body");
        }
    }

    static String base64Url(byte[] raw) {
        StringBuilder out = new StringBuilder(((raw.length + 2) / 3) * 4);
        int i = 0;
        while (i + 3 <= raw.length) {
            int n = ((raw[i] & 0xff) << 16) | ((raw[i + 1] & 0xff) << 8) | (raw[i + 2] & 0xff);
            out.append(B64[(n >> 18) & 63]);
            out.append(B64[(n >> 12) & 63]);
            out.append(B64[(n >> 6) & 63]);
            out.append(B64[n & 63]);
            i += 3;
        }
        if (i < raw.length) {
            int rem = raw.length - i;
            int n = (raw[i] & 0xff) << 16;
            if (rem == 2) n |= (raw[i + 1] & 0xff) << 8;
            out.append(B64[(n >> 18) & 63]);
            out.append(B64[(n >> 12) & 63]);
            if (rem == 2) out.append(B64[(n >> 6) & 63]);
        }
        return out.toString();
    }

    private static String urlEncode(String raw) {
        try {
            return URLEncoder.encode(raw, "UTF-8").replace("+", "%20");
        } catch (java.io.UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream src = in) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] tmp = new byte[4096];
            int n;
            while ((n = src.read(tmp)) >= 0) buf.write(tmp, 0, n);
            return buf.toString(StandardCharsets.UTF_8.name());
        }
    }
}
