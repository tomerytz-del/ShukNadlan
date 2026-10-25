package il.co.shuknadlan.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.net.URLDecoder;
import java.util.List;
import org.junit.Test;

public class WhatsappLinksTest {
    @Test
    public void waMeBecomesWhatsappSendThenBrowserThenStore() throws Exception {
        String raw = "https://wa.me/972532494740?text="
            + "אימות%20כניסה%20482193";
        List<WhatsappLinks.Step> steps = WhatsappLinks.plan(raw);
        assertEquals(WhatsappLinks.Kind.WHATSAPP, steps.get(0).kind);
        assertEquals("972532494740", query(steps.get(0).url, "phone"));
        assertEquals("אימות כניסה 482193", query(steps.get(0).url, "text"));
        assertEquals(null, steps.get(0).pkg);
        assertEquals(WhatsappLinks.PERSONAL, steps.get(1).pkg);
        assertEquals(WhatsappLinks.BUSINESS, steps.get(2).pkg);
        assertEquals(WhatsappLinks.Kind.VIEW, steps.get(3).kind);
        assertEquals(raw, steps.get(3).url);
        assertEquals(WhatsappLinks.Kind.STORE, steps.get(4).kind);
        assertTrue(steps.get(4).url.startsWith("market://"));
        assertTrue(steps.get(5).url.startsWith("https://play.google.com/"));
    }

    @Test
    public void apiAndWebSendLinksUseThePhoneQuery() throws Exception {
        String api = WhatsappLinks.toSendUrl(
            "https://api.whatsapp.com/send?phone=972546929991&text=hi");
        assertEquals("972546929991", query(api, "phone"));
        assertEquals("hi", query(api, "text"));
        String web = WhatsappLinks.toSendUrl("https://web.whatsapp.com/send?phone=+972-50");
        assertEquals("97250", query(web, "phone"));
        assertEquals("whatsapp://send?text=share",
            WhatsappLinks.toSendUrl("https://www.wa.me/?text=share"));
    }

    @Test
    public void groupInviteStaysAnHttpsLink() {
        String raw = "https://chat.whatsapp.com/AbCdEf";
        assertNull(WhatsappLinks.toSendUrl(raw));
        List<WhatsappLinks.Step> steps = WhatsappLinks.plan(raw);
        assertEquals(1, steps.size());
        assertEquals(WhatsappLinks.Kind.VIEW, steps.get(0).kind);
        assertEquals(raw, steps.get(0).url);
    }

    @Test
    public void androidIntentPrefersBusinessThenFallsBack() throws Exception {
        String raw = "intent://send?phone=972532494740&text=hi"
            + "#Intent;scheme=whatsapp;package=com.whatsapp.w4b;"
            + "S.browser_fallback_url=https%3A%2F%2Fwa.me%2F972532494740%3Ftext%3Dhi;end";
        List<WhatsappLinks.Step> steps = WhatsappLinks.plan(raw);
        assertEquals(WhatsappLinks.BUSINESS, steps.get(0).pkg);
        assertEquals("whatsapp://send?phone=972532494740&text=hi", steps.get(0).url);
        assertEquals(WhatsappLinks.PERSONAL, steps.get(1).pkg);
        boolean sawBrowser = false;
        for (WhatsappLinks.Step step : steps) {
            if (step.kind == WhatsappLinks.Kind.VIEW) {
                sawBrowser = true;
                assertEquals("https://wa.me/972532494740?text=hi", step.url);
            }
        }
        assertTrue(sawBrowser);
        assertEquals(WhatsappLinks.Kind.STORE, steps.get(steps.size() - 1).kind);
    }

    @Test
    public void intentPackageThatIsNotWhatsappIsIgnored() {
        String raw = "intent://example.com/path#Intent;scheme=https;package=com.malware;end";
        List<WhatsappLinks.Step> steps = WhatsappLinks.plan(raw);
        assertEquals(1, steps.size());
        assertEquals(WhatsappLinks.Kind.VIEW, steps.get(0).kind);
        assertEquals(null, steps.get(0).pkg);
        assertEquals("https://example.com/path", steps.get(0).url);
    }

    @Test
    public void phoneAndExistingWhatsappSchemeStayOutsideTheWebView() {
        List<WhatsappLinks.Step> tel = WhatsappLinks.plan("tel:+972546929991");
        assertEquals(1, tel.size());
        assertEquals(WhatsappLinks.Kind.VIEW, tel.get(0).kind);
        assertEquals("tel:+972546929991", tel.get(0).url);
        String send = "whatsapp://send?phone=972546929991&text=hi";
        assertEquals(send, WhatsappLinks.toSendUrl(send));
        assertEquals(WhatsappLinks.Kind.WHATSAPP, WhatsappLinks.plan(send).get(0).kind);
    }

    private static String query(String url, String key) throws Exception {
        int q = url.indexOf('?');
        String query = q < 0 ? "" : url.substring(q + 1);
        for (String part : query.split("&")) {
            int eq = part.indexOf('=');
            String name = eq < 0 ? part : part.substring(0, eq);
            if (!key.equals(name)) continue;
            return URLDecoder.decode(eq < 0 ? "" : part.substring(eq + 1), "UTF-8");
        }
        return null;
    }
}
