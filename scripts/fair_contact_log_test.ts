/* נקודת הרישום של לחיצת וואטסאפ וחיוג ביריד, בלי מסד.
   node --experimental-strip-types scripts/fair_contact_log_test.ts
*/
import {
  SHARED_IP_HASH,
  clientIp,
  handleFairContact,
  hashIp,
  normalizeIp,
  parseClick,
  resetFairContactLogForTests,
  type FairContactArgs,
} from "../supabase/functions/_shared/fair-contact.ts";

let fail = 0;
const ok = (name: string, cond: unknown) => {
  console.log((cond ? "✓ " : "✗ ") + name);
  if (!cond) fail++;
};

const PROP = "c0000000-0000-0000-0000-000000000001";
const SESSION = "a".repeat(32);

function req(method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://example.test/fair-contact-log", init);
}

const parsed = parseClick({
  property_id: PROP.toUpperCase(),
  channel: "whatsapp",
  source_page: "property",
  client_session: SESSION,
  name: "דנה",
  phone: "0501234567",
}, "");
ok("מזהה נכס באותיות קטנות, בלי שם ובלי טלפון", parsed.ok === true
  && parsed.ok
  && parsed.value.property_id === PROP
  && parsed.value.channel === "whatsapp"
  && parsed.value.source_page === "property"
  && parsed.value.client_session === SESSION
  && !("name" in parsed.value)
  && !("phone" in parsed.value));

ok("ערוץ לא מוכר נדחה", parseClick({ property_id: PROP, channel: "sms" }, "").ok === false);
ok("בלי נכס נדחה", parseClick({ channel: "call" }, "").ok === false);
ok("סשן שהוא טלפון אינו נשמר", parseClick(
  { property_id: PROP, channel: "call", client_session: "972501234567" },
  "",
).ok === true && (parseClick(
  { property_id: PROP, channel: "call", client_session: "972501234567" },
  "",
) as { value: { client_session: string | null } }).value.client_session === null);

const asApp = parseClick(
  { property_id: PROP, channel: "call", source_page: "swipe" },
  "Mozilla/5.0 ShukNadlanApp/1.0",
);
ok("האפליקציה נקבעת מה-User-Agent", asApp.ok === true && asApp.ok && asApp.value.source_page === "app");
const fakeApp = parseClick(
  { property_id: PROP, channel: "call", source_page: "app" },
  "Mozilla/5.0",
);
ok("דפדפן אינו יכול לטעון שהוא האפליקציה", fakeApp.ok === true && fakeApp.ok && fakeApp.value.source_page === null);

const h1 = await hashIp("203.0.113.8", "salt-a");
const h2 = await hashIp("203.0.113.8", "salt-a");
const h3 = await hashIp("203.0.113.8", "salt-b");
const shared = await hashIp("", "salt-a");
ok("גיבוב יציב, 64 תווים, תלוי במלח", h1 === h2 && h1 !== h3 && h1.length === 64 && /^[a-f0-9]+$/.test(h1));
ok("כתובת לא תקינה היא הדלי המשותף של 64 אפסים", shared === SHARED_IP_HASH
  && shared === await hashIp("not-an-ip", "salt-b")
  && shared !== h1);
ok("IPv6 נספר לפי /64, וכתובת ממופה נספרת כ-IPv4",
  await hashIp("2001:db8:1:2::1", "salt-a") === await hashIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd", "salt-a")
  && await hashIp("2001:db8:1:2::1", "salt-a") !== await hashIp("2001:db8:1:3::1", "salt-a")
  && await hashIp("::ffff:203.0.113.8", "salt-a") === h1
  && await hashIp("::ffff:c000:201", "salt-a") === await hashIp("192.0.2.1", "salt-a")
  && await hashIp("64:ff9b::192.0.2.1", "salt-a") === await hashIp("64:ff9b::c000:201", "salt-a")
  && await hashIp("64:ff9b::192.0.2.1", "salt-a") === await hashIp("192.0.2.1", "salt-a")
  && await hashIp("2001:db8::ffff:192.0.2.1", "salt-a") !== await hashIp("192.0.2.1", "salt-a")
  && await hashIp("2001:db8::ffff:192.0.2.1", "salt-a") === await hashIp("2001:db8::1", "salt-a"));
ok("מלח ריק עדיין מגובב, אחרת מהמלח האמיתי", (await hashIp("203.0.113.8", "")) !== h1
  && (await hashIp("203.0.113.8", "")).length === 64);

function ipOf(headers: Record<string, string>): string {
  return clientIp(new Request("https://example.test/fair-contact-log", { headers }));
}
ok("cf-connecting-ip גובר על הכותרת שהלקוח שולח", ipOf({
  "cf-connecting-ip": "198.51.100.20",
  "x-forwarded-for": "203.0.113.8, 10.0.0.1",
}) === "198.51.100.20");
ok("בלי cf נלקחת הקפיצה האחרונה, לא הראשונה", ipOf({
  "x-forwarded-for": "203.0.113.8, 198.51.100.14",
}) === "198.51.100.14");
ok("קפיצה אחרונה שאינה כתובת נופלת לדלי", ipOf({
  "x-forwarded-for": "203.0.113.8, not-an-ip",
}) === "" && ipOf({ "cf-connecting-ip": "nope", "x-forwarded-for": "1.2.3.4, also-bad" }) === "");
ok("IPv4 עם יציאה ו-IPv6 תקינים", normalizeIp("203.0.113.9:443") === "203.0.113.9"
  && normalizeIp("[2001:db8::1]:443") === "2001:db8::1"
  && normalizeIp("::ffff:192.0.2.1") === "::ffff:192.0.2.1"
  && normalizeIp("999.1.2.3") === ""
  && normalizeIp("01.2.3.4") === "");
resetFairContactLogForTests();
const cfWarnings: string[] = [];
const previousWarn = console.warn;
console.warn = (message?: unknown) => { cfWarnings.push(String(message ?? "")); };
ipOf({ "x-forwarded-for": "198.51.100.14" });
ipOf({ "x-forwarded-for": "198.51.100.15" });
console.warn = previousWarn;
ok("חסר cf-connecting-ip נרשם פעם אחת", cfWarnings.length === 1
  && cfWarnings[0].includes("cf-connecting-ip missing"));

let seen: FairContactArgs | null = null;
const call = async (args: FairContactArgs) => {
  seen = args;
  return {
    data: {
      ok: true,
      logged: true,
      duplicate: false,
      ref: 7,
      created_at: "2026-10-31T12:00:00Z",
      fair_end: "2026-10-31T21:59:59Z",
      channel: "whatsapp_click",
      status: "eligible",
    },
    error: null,
  };
};

const good = await handleFairContact(req("POST", {
  property_id: PROP,
  channel: "whatsapp",
  source_page: "swipe",
  client_session: SESSION,
  name: "דנה",
  phone: "050",
}, { "x-forwarded-for": "203.0.113.8, 198.51.100.14", "user-agent": "Mozilla/5.0" }), { salt: "salt-a", call });
const goodBody = await good.json();
const lastHop = await hashIp("198.51.100.14", "salt-a");
ok("POST נרשם ומחזיר ערוץ וזמן, בלי ה-IP", good.status === 200 && goodBody.logged === true
  && goodBody.channel === "whatsapp_click" && goodBody.fair_end
  && !JSON.stringify(goodBody).includes("203.0.113.8")
  && !JSON.stringify(goodBody).includes("198.51.100.14")
  && !JSON.stringify(goodBody).includes("salt-a"));
ok("לפונקציה עובר גיבוב של הקפיצה האחרונה, לא של המזויפת, ובלי שם", seen !== null
  && seen.p_ip_hash === lastHop
  && seen.p_ip_hash !== h1
  && seen.p_channel === "whatsapp"
  && seen.p_source_page === "swipe"
  && seen.p_client_session === SESSION
  && !("name" in seen) && !("phone" in seen));

const spoofed = await handleFairContact(req("POST", {
  property_id: PROP, channel: "whatsapp", client_session: "b".repeat(32),
}, { "x-forwarded-for": "8.8.8.8, not-an-ip", "user-agent": "Mozilla/5.0" }), {
  salt: "salt-a",
  call: async (args) => {
    seen = args;
    return { data: { ok: true, duplicate: false, channel: "whatsapp_click", status: "eligible" }, error: null };
  },
});
ok("קפיצה אחרונה לא תקינה אינה נופלת אחורה לכתובת שהלקוח שם", spoofed.status === 200 && seen!.p_ip_hash === shared);
const rotated = await handleFairContact(req("POST", {
  property_id: PROP, channel: "call", client_session: "c".repeat(32),
}, {
  "cf-connecting-ip": "203.0.113.8",
  "x-forwarded-for": "1.1.1.1, 198.51.100.14",
  "user-agent": "Mozilla/5.0",
}), {
  salt: "salt-a",
  call: async (args) => {
    seen = args;
    return { data: { ok: true, duplicate: false, channel: "call_click", status: "eligible" }, error: null };
  },
});
ok("סיבוב של הקפיצה הראשונה אינו משנה את הדלי כשיש כתובת פלטפורמה", rotated.status === 200
  && seen!.p_ip_hash === h1 && seen!.p_ip_hash !== lastHop);

let beaconArgs: FairContactArgs | null = null;
const beacon = await handleFairContact(req("POST", JSON.stringify({
  property_id: PROP, channel: "call", source_page: "property", client_session: SESSION,
}), { "content-type": "text/plain;charset=UTF-8", "user-agent": "Mozilla/5.0 ShukNadlanApp/1.0" }), {
  salt: "salt-a",
  call: async (args) => {
    beaconArgs = args;
    return { data: { ok: true, duplicate: true, channel: "call_click", status: "eligible" }, error: null };
  },
});
const beaconBody = await beacon.json();
ok("גוף text/plain כמו sendBeacon, והאפליקציה גוברת", beacon.status === 200
  && beaconBody.duplicate === true && beaconArgs !== null
  && beaconArgs.p_source_page === "app" && beaconArgs.p_channel === "call");

const opted = await handleFairContact(req("OPTIONS"), { salt: "", call });
ok("OPTIONS בלי גוף", opted.status === 204);

const got = await handleFairContact(req("GET"), { salt: "", call });
ok("GET נדחה", got.status === 405);

const bad = await handleFairContact(req("POST", "{"), { salt: "", call });
ok("JSON שבור", bad.status === 400 && (await bad.json()).error === "invalid_json");

const huge = await handleFairContact(req("POST", "x".repeat(3000)), { salt: "", call });
ok("גוף גדול נדחה", huge.status === 400);

const limited = await handleFairContact(req("POST", { property_id: PROP, channel: "whatsapp" }), {
  salt: "salt-a",
  call: async () => ({ data: { ok: false, error: "rate_limited" }, error: null }),
});
ok("תקרה חוזרת 429", limited.status === 429 && (await limited.json()).error === "rate_limited");

const closed = await handleFairContact(req("POST", { property_id: PROP, channel: "call" }), {
  salt: "salt-a",
  call: async () => ({ data: { ok: false, error: "not_in_fair" }, error: null }),
});
ok("נכס שאינו ביריד חוזר 404", closed.status === 404);

const broken = await handleFairContact(req("POST", { property_id: PROP, channel: "call" }), {
  salt: "salt-a",
  call: async () => ({ data: null, error: { message: "relation secret_table does not exist" } }),
});
const brokenBody = await broken.json();
ok("שגיאת מסד אינה חושפת את הטקסט", broken.status === 500 && brokenBody.error === "db_error"
  && !JSON.stringify(brokenBody).includes("secret_table"));

if (fail) {
  console.error(fail + " failed");
  process.exit(1);
}
console.log("fair contact log: ok");
