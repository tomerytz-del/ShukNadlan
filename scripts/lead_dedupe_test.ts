/* ============================================================================
   כפילות ליד בין טופס מטא לבין פייסבוק/אינסטגרם / האתר
   (supabase/functions/_shared/lead-dedupe.ts, meta-leads.ts, lead-routing.ts)

   ניסיון חוזר של אותו meta_lead_id נושא external_ref. ליד פתוח מאותו
   טלפון ואותו סוג ב-30 הימים מצורף, בלי insert שני. מקור meta_ads_* מהדפדפן
   נופל. בלי מסד ובלי רשת.

       node --experimental-strip-types scripts/lead_dedupe_test.ts
   ========================================================================== */
import {
  appendLeadNote,
  attachToOpenLead,
  metaAdsSourceLabel,
  pickOpenLead,
  pushTouch,
  touchSeen,
  type AttachInput,
  type OpenLeadRow,
} from "../supabase/functions/_shared/lead-dedupe.ts";

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => {
  console.log((cond ? "✓ " : "✗ ") + name + (cond || got === undefined ? "" : `  (got ${JSON.stringify(got)})`));
  if (!cond) fail++;
};

const recent = new Date().toISOString();
const older = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// מי נחשב ליד פתוח
// ---------------------------------------------------------------------------
{
  const rows: OpenLeadRow[] = [
    { id: "new", agent_id: "a1", status: "unlocked", created_at: recent, raw_message: "ראשון" },
    { id: "old", agent_id: "a1", status: "masked", created_at: older },
    { id: "won", agent_id: "a1", status: "unlocked", created_at: recent },
    { id: "lost-other", agent_id: "a1", status: "unlocked", created_at: recent },
    { id: "archived", agent_id: "a1", status: "masked", created_at: recent },
    { id: "pending", agent_id: null, status: "pending_charge", created_at: older },
    { id: "weird", agent_id: "a1", status: "sold", created_at: recent },
  ];
  const work = [
    { lead_id: "won", agent_id: "a1", stage: "won" },
    { lead_id: "lost-other", agent_id: "a2", stage: "not_relevant" },
    { lead_id: "lost-other", agent_id: "a1", stage: "contacted" },
    { lead_id: "new", agent_id: "a1", stage: "new" },
  ];
  const open = pickOpenLead(rows, ["archived"], work);
  ok("הליד הפתוח החדש נבחר", open?.id === "new", open?.id);
  ok("ליד שנסגר בהצלחה אצל הסוכן/ת המשויך/ת אינו פתוח", pickOpenLead([rows[2]], [], work) === null);
  ok("שלב סופי של סוכן/ת אחר/ת אינו סוגר", pickOpenLead([rows[3]], [], work)?.id === "lost-other");
  ok("ארכיון סוגר גם בלי שלב", pickOpenLead([rows[4]], ["archived"], []) === null);
  ok("pending_charge פתוח", pickOpenLead([rows[5]], [], [])?.id === "pending");
  ok("status שאינו מהשלושה החיים אינו פתוח", pickOpenLead([rows[6]], [], []) === null);
  ok("ליד בלי סוכן/ת עם שלב סופי סגור", pickOpenLead(
    [{ id: "u", agent_id: null, status: "masked", created_at: recent }],
    [],
    [{ lead_id: "u", agent_id: "a9", stage: "not_relevant" }],
  ) === null);
}

// ---------------------------------------------------------------------------
// הודעה ומקור נוסף
// ---------------------------------------------------------------------------
{
  const once = appendLeadNote("רוצה למכור", "טופס לידים במטא · מוכר/ת", "עדיין רלוונטי");
  ok("ההודעה מצטרפת עם תווית", once === "רוצה למכור\nפנייה נוספת (טופס לידים במטא · מוכר/ת): עדיין רלוונטי", once);
  ok("אותה שורה אינה מוכפלת", appendLeadNote(once, "טופס לידים במטא · מוכר/ת", "עדיין רלוונטי") === once);
  ok("בלי תווית נשארת פנייה נוספת", appendLeadNote("", null, "היי") === "פנייה נוספת: היי");
  ok("אין מקף ארוך בשורה", !/[—–―]/.test(once));
  const touches = pushTouch([], { source: "meta_ads_owner_form", external_ref: "123", at: recent });
  ok("מגע ראשון נרשם", touches.length === 1 && touches[0].external_ref === "123");
  ok("אותו external_ref כבר נראה", touchSeen(touches, "meta_ads_owner_form", "123"));
  ok("מקור אחר אינו אותו מגע", !touchSeen(touches, "facebook_dm", "123"));
  ok("בלי external_ref אין דילוג", !touchSeen(touches, "meta_ads_owner_form", null));
  ok("תווית מטא לבעלים", metaAdsSourceLabel("meta_ads_owner_form") === "טופס לידים במטא · מוכר/ת");
  ok("מקור שאינו מטא בלי תווית", metaAdsSourceLabel("facebook_dm") === null);
}

// ---------------------------------------------------------------------------
// לקוח מדומה: אותו חוזה כמו supabase-js (שרשרת שנפתרת ב-await)
// ---------------------------------------------------------------------------
type Call = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown };

function fakeSb(opts: {
  phone?: string | null;
  normError?: boolean;
  leads?: OpenLeadRow[];
  leadsError?: { code: string };
  archived?: string[];
  work?: { lead_id: string; agent_id: string; stage: string }[];
  openError?: boolean;
  notifyError?: boolean;
}) {
  const calls: Call[] = [];
  const updates: { id: string; payload: Record<string, unknown> }[] = [];
  const notes: Record<string, unknown>[] = [];
  function chain(table: string, op: string, run: (filters: Record<string, unknown>, payload?: unknown) => Promise<{ data: unknown; error: unknown }>) {
    const filters: Record<string, unknown> = {};
    let payload: unknown;
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = (k: string, v: unknown) => { filters[k] = v; return q; };
    q.gte = (k: string, v: unknown) => { filters[k] = v; return q; };
    q.is = (k: string, v: unknown) => { filters[k] = v; return q; };
    q.in = (k: string, v: unknown) => { filters[k] = v; return q; };
    q.order = self;
    q.limit = self;
    q.update = (p: unknown) => { payload = p; return q; };
    q.insert = (p: unknown) => { payload = p; return q; };
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      calls.push({ table, op, filters: { ...filters }, payload });
      return run(filters, payload).then(resolve, reject);
    };
    return q;
  }
  const sb = {
    calls,
    updates,
    notes,
    rpc: async (fn: string) => {
      calls.push({ table: fn, op: "rpc", filters: {} });
      if (opts.normError) return { data: null, error: { code: "42883" } };
      return { data: opts.phone ?? null, error: null };
    },
    from: (table: string) => {
      if (table === "leads") {
        return chain("leads", "leads", async (filters, payload) => {
          if (payload) {
            updates.push({ id: String(filters.id), payload: payload as Record<string, unknown> });
            return { data: null, error: null };
          }
          if (opts.leadsError) return { data: null, error: opts.leadsError };
          return { data: opts.leads ?? [], error: null };
        });
      }
      if (table === "lead_archives") {
        return chain("lead_archives", "archives", async () => {
          if (opts.openError) return { data: null, error: { code: "57014" } };
          return { data: (opts.archived ?? []).map((lead_id) => ({ lead_id })), error: null };
        });
      }
      if (table === "notifications") {
        return chain("notifications", "notify", async (_filters, payload) => {
          if (opts.notifyError) return { data: null, error: { code: "42501" } };
          notes.push((payload ?? {}) as Record<string, unknown>);
          return { data: null, error: null };
        });
      }
      return chain("lead_work", "work", async () => ({ data: opts.work ?? [], error: null }));
    },
  };
  return sb;
}

const base: AttachInput = {
  phone: "050-123-4567",
  leadType: "owner_inbound",
  matchProperty: false,
  source: "meta_ads_owner_form",
  externalRef: "998877",
  message: "מהדירה ברחוב הרצל",
  sourceLabel: "טופס לידים במטא · מוכר/ת",
  internal: true,
};

{
  const none = fakeSb({ phone: null });
  const miss = await attachToOpenLead(none, base);
  ok("טלפון שלא מנורמל אינו כפילות", miss === null);
  ok("בלי נרמול אין קריאה ללידים", none.calls.every((c) => c.op === "rpc"));
}

{
  const broken = fakeSb({ phone: "972501234567", leadsError: { code: "42703" } });
  ok("עמודה שטרם עלתה מדלגת וממשיכה ל-insert", await attachToOpenLead(broken, base) === null);
  ok("אין עדכון כשהעמודה חסרה", broken.updates.length === 0);
}

{
  const openLead: OpenLeadRow = {
    id: "lead-1", agent_id: "agt", agency_id: "ag1", status: "unlocked", created_at: recent,
    raw_message: "כתבתי בפייסבוק", source_touches: [], city: "עפולה", property_type: "דירה", deal_type: "sale",
  };
  const sb = fakeSb({ phone: "972501234567", leads: [openLead] });
  const hit = await attachToOpenLead(sb, {
    ...base, matchProperty: true, propertyId: "prop-9", agencyId: "ag1", agentId: "agt",
  });
  ok("ליד פתוח מוחזר ככפילות", hit?.lead_id === "lead-1");
  const q = sb.calls.find((c) => c.table === "leads" && !c.payload);
  ok("הסינון הוא הטלפון, הסוג, הנכס והשולחן",
    q?.filters.phone_e164 === "972501234567" && q?.filters.lead_type === "owner_inbound" &&
    q?.filters.property_id === "prop-9" && q?.filters.agency_id === "ag1" && q?.filters.agent_id === "agt");
  ok("עדכון אחד", sb.updates.length === 1);
  const payload = sb.updates[0].payload;
  ok("ההודעה צורפה", String(payload.raw_message).includes("פנייה נוספת") && String(payload.raw_message).includes("מהדירה ברחוב הרצל"));
  const touches = payload.source_touches as { source: string; external_ref: string }[];
  ok("המקור הנוסף נרשם בלי להחליף את הליד", touches.length === 1 && touches[0].source === "meta_ads_owner_form" && touches[0].external_ref === "998877");
  ok("הטלפון אינו בגוף העדכון", !JSON.stringify(payload).includes("050") && !JSON.stringify(payload).includes("972501234567"));
  ok("הסוכן/ת מקבל/ת התראת פנייה נוספת על הליד",
    sb.notes.length === 1 && sb.notes[0].type === "new_lead" && sb.notes[0].agent_id === "agt" &&
    sb.notes[0].related_lead_id === "lead-1" && sb.notes[0].title === "פנייה נוספת על ליד קיים");
  ok("גוף ההתראה בלי הטלפון", !JSON.stringify(sb.notes[0]).includes("972") && !JSON.stringify(sb.notes[0]).includes("050"));
}

{
  const openLead: OpenLeadRow = {
    id: "lead-1", agent_id: "agt", status: "unlocked", created_at: recent,
    raw_message: "כבר צורף",
    source_touches: [{ source: "meta_ads_owner_form", external_ref: "998877", at: older }],
  };
  const sb = fakeSb({ phone: "972501234567", leads: [openLead] });
  const hit = await attachToOpenLead(sb, base);
  ok("אותו meta_lead_id שכבר צורף חוזר בלי עדכון שני", hit?.lead_id === "lead-1" && sb.updates.length === 0 && sb.notes.length === 0);
}

{
  const sb = fakeSb({
    phone: "972501234567",
    leads: [{ id: "closed", agent_id: "agt", status: "unlocked", created_at: recent, raw_message: "נסגר" }],
    work: [{ lead_id: "closed", agent_id: "agt", stage: "won" }],
  });
  ok("ליד שנסגר אינו בולע פנייה חדשה", await attachToOpenLead(sb, base) === null && sb.updates.length === 0);
}

{
  const sb = fakeSb({
    phone: "972501234567",
    leads: [{ id: "arch", agent_id: "agt", agency_id: "ag1", status: "unlocked", created_at: recent }],
    archived: ["arch"],
  });
  ok("ליד בארכיון אינו פתוח", await attachToOpenLead(sb, base) === null);
}

{
  const short = fakeSb({ phone: "972501234567", leads: [] });
  ok("פחות מ-9 ספרות אינה כפילות", await attachToOpenLead(short, { ...base, phone: "12" }) === null);
  ok("פחות מ-9 ספרות אינה נרמול", short.calls.length === 0);
  const empty = fakeSb({ phone: "972501234567", leads: [] });
  ok("אין ליד בחלון - ממשיכים ל-insert", await attachToOpenLead(empty, base) === null && empty.updates.length === 0);
}

{
  const sb = fakeSb({
    phone: "972501234567",
    leads: [{ id: "lead-1", agent_id: "agt", status: "masked", created_at: recent, raw_message: null }],
    openError: true,
  });
  ok("בדיקת פתוח שנכשלה אינה ממזגת", await attachToOpenLead(sb, base) === null && sb.updates.length === 0);
}

{
  const masked = fakeSb({
    phone: "972501234567",
    leads: [{ id: "hid", agent_id: "agt", agency_id: "ag1", status: "masked", created_at: recent }],
  });
  ok("ליד מוסתר אינו בולע פנייה", await attachToOpenLead(masked, base) === null && masked.notes.length === 0);
  const pending = fakeSb({
    phone: "972501234567",
    leads: [{ id: "pay", agent_id: "agt", agency_id: "ag1", status: "pending_charge", created_at: recent }],
  });
  ok("ליד שממתין לחיוב אינו בולע פנייה", await attachToOpenLead(pending, base) === null);
  const loose = fakeSb({
    phone: "972501234567",
    leads: [{ id: "free", agent_id: null, agency_id: "ag1", status: "unlocked", created_at: recent }],
  });
  ok("ליד בלי סוכן/ת אינו בולע פנייה", await attachToOpenLead(loose, base) === null);
}

{
  const sb = fakeSb({
    phone: "972501234567",
    leads: [
      { id: "a", agent_id: "agt-a", agency_id: "ag-a", status: "unlocked", created_at: recent },
      { id: "b", agent_id: "agt-b", agency_id: "ag-b", status: "unlocked", created_at: older },
    ],
  });
  ok("שני משרדים אינם מתמזגים", await attachToOpenLead(sb, base) === null && sb.notes.length === 0 && sb.updates.length === 0);
}

{
  const sb = fakeSb({ phone: "972501234567", leads: [] });
  ok("בלי נכס אין מיזוג של פנייה", await attachToOpenLead(sb, { ...base, matchProperty: true, propertyId: null }) === null);
  ok("בלי נכס אין קריאה למסד", sb.calls.length === 0);
  const pub = fakeSb({
    phone: "972501234567",
    leads: [{ id: "lead-1", agent_id: "agt", agency_id: "ag1", status: "unlocked", created_at: recent }],
  });
  ok("דפדפן אינו ממזג", await attachToOpenLead(pub, { ...base, internal: false }) === null && pub.calls.length === 0);
  const noAgent = fakeSb({ phone: "972501234567", leads: [] });
  ok("משרד בלי סוכן/ת אינו מצמיד", await attachToOpenLead(noAgent, { ...base, agencyId: "ag1", agentId: null }) === null);
  ok("משרד בלי סוכן/ת אינו קורא למסד", noAgent.calls.length === 0);
}

{
  const sb = fakeSb({
    phone: "972501234567",
    notifyError: true,
    leads: [{ id: "lead-1", agent_id: "agt", agency_id: "ag1", status: "unlocked", created_at: recent, raw_message: "ישן" }],
  });
  ok("התראה שנכשלה אינה ממזגת", await attachToOpenLead(sb, base) === null && sb.updates.length === 0);
}

// ---------------------------------------------------------------------------
// מקור: מטא וחברתי רק מקורא פנימי. שאר המקורות כמו שהיו.
// intakeRequest מעביר external_ref = meta_lead_id.
// ---------------------------------------------------------------------------
(globalThis as { Deno?: { env: { get(name: string): string | undefined } } }).Deno = {
  env: { get: () => undefined },
};

const routing = await import("../supabase/functions/_shared/lead-routing.ts");
const meta = await import("../supabase/functions/_shared/meta-leads.ts");

ok("מטא בלי אמון נופל", routing.normalizeSource("meta_ads_owner_form", "homepage_owner_wizard", false) === "homepage_owner_wizard");
ok("מטא עם אמון נשמר", routing.normalizeSource("meta_ads_property_form", "", true) === "meta_ads_property_form");
ok("פייסבוק בלי אמון נופל", routing.normalizeSource("facebook_dm", "homepage_owner_wizard", false) === "homepage_owner_wizard");
ok("אשף הבית נשמר גם בלי אמון", routing.normalizeSource("homepage_owner_wizard", "x", false) === "homepage_owner_wizard");
ok("מקור לא מוכר נופל", routing.normalizeSource("made_up", "homepage_owner_wizard", true) === "homepage_owner_wizard");

const lead = {
  id: "444555666777",
  created_time: recent,
  field_data: [
    { name: "full_name", values: ["דנה כהן"] },
    { name: "phone_number", values: ["0501234567"] },
    { name: "email", values: ["dana@example.com"] },
    { name: "עיר", values: ["עפולה"] },
  ],
};
const formBase = {
  form_id: "f1", form_name: "מוכרים", kind: "owner" as const,
  default_city: "עפולה", default_property_type: "דירה", deal_type: "sale",
};
const ownerReq = meta.intakeRequest(lead, formBase);
ok("ליד בעלים נושא external_ref", "body" in ownerReq && ownerReq.body.external_ref === "444555666777" && ownerReq.body.source === "meta_ads_owner_form");
const propReq = meta.intakeRequest(lead, { ...formBase, kind: "property", property_id: "prop-1" });
ok("פנייה על נכס נושאת external_ref", "body" in propReq && propReq.fn === "property-inquiry-intake" && propReq.body.external_ref === lead.id);
const buyerReq = meta.intakeRequest(lead, { ...formBase, kind: "buyer" });
ok("מחפש/ת נושא/ת external_ref", "body" in buyerReq && buyerReq.fn === "saved-search-intake" && buyerReq.body.external_ref === lead.id && buyerReq.body.source === "meta_ads_buyer_form");

if (fail) {
  console.error(`\n${fail} failed`);
  process.exit(1);
}
console.log("\nall passed");
