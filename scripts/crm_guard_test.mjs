// בדיקת ההגנה והסינון של /crm. node --experimental-strip-types scripts/crm_guard_test.mjs
import { blockReason, safeQuery, safeReferer } from "../netlify/edge-functions/lib/crm-guard.ts";
let bad = 0;
const check = (n, ok) => { if (!ok) { bad++; console.error("✗", n); } else console.log("✓", n); };
const b = (userAgent, country, geoAllow) => blockReason({ userAgent, country, geoAllow });
check("python-httpx נחסם", b("python-httpx/0.28.1", "US") === "scraper_ua");
check("curl נחסם", b("curl/8.14.1", "IL") === "scraper_ua");
check("בלי UA נחסם", b("", "IL") === "scraper_ua");
check("דפדפן רגיל עובר", b("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7)", "IL") === null);
check("headless Chrome עובר (נרשם ולא נחסם)", b("Mozilla/5.0 HeadlessChrome/120", "US") === null);
check("הניטור שלנו עובר", b("Mozilla/5.0 (ShukNadlan-uptime-monitor)", "US") === null);
check("סוכן התפעול עובר", b("ShukNadlanOpsAgent/1.0 (+ops_agent)", "US", "IL") === null);
check("geo כבוי כברירת מחדל", b("Mozilla/5.0", "US") === null);
check("geo חוסם מדינה שאינה ברשימה", b("Mozilla/5.0", "US", "IL") === "geo");
check("geo מאפשר מדינה ברשימה", b("Mozilla/5.0", "il", "IL, PS") === null);
check("מדינה לא ידועה עוברת", b("Mozilla/5.0", undefined, "IL") === null);
check("query: ידוע נשמר, OAuth נחתך",
  safeQuery("?goto=accLeads&lead=0&code=SECRET&state=abc") === "goto=accLeads&lead=0&code=[x]&state=[x]");
check("referer בלי query", safeReferer("https://x.co/plan?k=TOKEN") === "https://x.co/plan");
check("referer שבור", safeReferer("לא-כתובת") === "");
process.exit(bad ? 1 : 0);
