package il.co.shuknadlan.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.net.URLDecoder;
import org.junit.Test;

public class OauthFlowTest {
    @Test
    public void s256MatchesRfc7636Vector() {
        String verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", OauthFlow.challenge(verifier));
    }

    @Test
    public void attachKeepsExistingQueryAndAddsChallenge() {
        String raw = "https://obookujgolazrwycsiyn.supabase.co/auth/v1/authorize?provider=google"
            + "&redirect_to=il.co.shuknadlan.app%3A%2F%2Fauth-callback";
        assertFalse(OauthFlow.hasChallenge(raw));
        String out = OauthFlow.attach(raw, "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
        assertTrue(out.contains("provider=google"));
        assertTrue(out.contains("code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
        assertTrue(out.contains("code_challenge_method=s256"));
        assertTrue(OauthFlow.hasChallenge(out));
    }

    @Test
    public void implicitReturnPutsTokensInTheHash() {
        String url = OauthFlow.implicitReturn(
            "https://shuknadlan.co.il/crm?invite=1", "aaa.bbb", "rrr", "3600", "bearer");
        assertTrue(url.startsWith("https://shuknadlan.co.il/crm?"));
        assertTrue(url.contains("invite=1"));
        assertTrue(url.contains("shuk_oauth="));
        assertTrue(url.indexOf("shuk_oauth=") < url.indexOf('#'));
        String frag = url.substring(url.indexOf('#') + 1);
        assertTrue(frag.contains("access_token=aaa.bbb"));
        assertTrue(frag.contains("refresh_token=rrr"));
        assertTrue(frag.contains("expires_in=3600"));
        assertTrue(frag.contains("token_type=bearer"));
        assertFalse(url.contains("code="));
    }

    @Test
    public void errorReturnUsesTheLoginPageCopy() throws Exception {
        String cancel = OauthFlow.errorReturn("https://shuknadlan.co.il/developer-crm", true);
        assertEquals("https://shuknadlan.co.il/developer-crm?error=access_denied", cancel);
        String fail = OauthFlow.errorReturn("https://evil.example/steal", false);
        assertTrue(fail.startsWith("https://shuknadlan.co.il/crm?error=server_error&error_description="));
        String desc = URLDecoder.decode(fail.substring(fail.indexOf("error_description=") + 18), "UTF-8");
        assertEquals("אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.", desc);
        assertFalse(OauthFlow.FAILED.contains("\u2014"));
        assertFalse(OauthFlow.CANCELLED.contains("\u2014"));
    }
}
