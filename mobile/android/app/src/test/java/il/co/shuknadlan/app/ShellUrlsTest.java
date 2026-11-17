package il.co.shuknadlan.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ShellUrlsTest {
    @Test
    public void offlineLinkAddsTheBrokerFlagOnlyForThatAudience() {
        String broker = ShellUrls.offlineFor("net", "https://shuknadlan.co.il/crm", "broker");
        assertTrue(broker.contains("why=net"));
        assertTrue(broker.contains("aud=broker"));
        assertTrue(broker.contains("retry="));
        assertTrue(broker.contains("shuknadlan.co.il"));

        String visitor = ShellUrls.offlineFor("http", "https://shuknadlan.co.il/crm", "visitor");
        assertTrue(visitor.contains("why=http"));
        assertFalse(visitor.contains("aud="));

        String unknown = ShellUrls.offlineFor("net", "https://evil.example/", "nope");
        assertFalse(unknown.contains("aud="));
        assertFalse(unknown.contains("retry="));
        assertTrue(unknown.contains("why=net"));

        String missing = ShellUrls.offlineFor("net", null, null);
        assertFalse(missing.contains("aud="));
        assertFalse(missing.contains("retry="));
    }
}
