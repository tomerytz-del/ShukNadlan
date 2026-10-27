/* ============================================================================
   כפילות ליד בין טופס מטא לבין פייסבוק/אינסטגרם / האתר
   (supabase/functions/_shared/lead-dedupe.ts, meta-leads.ts, lead-routing.ts)

   ניסיון חוזר של אותו meta_lead_id נושא external_ref. ליד פתוח מאותו
   טלפון ואותו סוג ב-30 הימים מצורף, בלי insert שני. מקור meta_ads_* מהדפדפן
   נופל. בלי מסד ובלי רשת.

       node --experimental-strip-types scripts/lead_dedupe_test.ts
   ========================================================================== */
import { readFileSync } from "node:fs";
import {
  addressFromStoredLead,
  appendLeadNote,
  attachToOpenLead,
  isPageRoutedSource,
  isPlatformTarget,
  metaAdsSourceLabel,
  parseAddressIdentity,
  pickOpenLead,
  pushTouch,
  sameOwnerAddress,
  touchSeen,
  type AttachInput,
  type OpenLeadRow,
} from "../supabase/functions/_shared/lead-dedupe.ts";
import {
  duplicateLeadBody,
  ownerPhoneAttach,
  pageLeadInsertAttempts,
  propertyPhoneAttach,
} from "../supabase/functions/_shared/lead-attach-plan.ts";

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
  touchError?: string;
  touchMissing?: boolean;
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
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ table: fn, op: "rpc", filters: { ...(args ?? {}) }, payload: args });
      if (fn === "lead_phone_touch") {
        if (opts.touchMissing) return { data: null, error: { code: "42883" } };
        if (opts.touchError) return { data: null, error: { code: opts.touchError } };
        const id = String(args?.p_lead_id ?? "");
        updates.push({
          id,
          payload: {
            raw_message: args?.p_note,
            source_touches: args?.p_touch ? [args.p_touch] : [],
          },
        });
        return { data: id, error: null };
      }
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
  const touchAt = sb.calls.findIndex((c) => c.table === "lead_phone_touch");
  const noteAt = sb.calls.findIndex((c) => c.table === "notifications");
  ok("העדכון במסד לפני ההתראה", touchAt >= 0 && noteAt > touchAt);
}

{
  const openLead: OpenLeadRow = {
    id: "lead-1", agent_id: "agt", status: "unlocked", created_at: recent,
    raw_message: "כבר צורף",
    source_touches: [{ source: "meta_ads_owner_form", external_ref: "998877", at: older }],
  };
  const sb = fakeSb({ phone: "972501234567", leads: [openLead] });
  const hit = await attachToOpenLead(sb, { ...base, agencyId: "ag1", agentId: "agt" });
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
  ok("שני משרדים אינם מתמזגים", await attachToOpenLead(sb, { ...base, agencyId: "ag-a", agentId: "agt-a" }) === null && sb.notes.length === 0 && sb.updates.length === 0);
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
  const hit = await attachToOpenLead(sb, { ...base, agencyId: "ag1", agentId: "agt" });
  ok("עדכון שהצליח נשאר גם כשההתראה נכשלת", hit?.lead_id === "lead-1" && sb.updates.length === 1 && sb.notes.length === 0);
}

{
  const sb = fakeSb({
    phone: "972501234567",
    touchError: "42501",
    leads: [{ id: "lead-1", agent_id: "agt", agency_id: "ag1", status: "unlocked", created_at: recent, raw_message: "ישן" }],
  });
  const desk = { ...base, agencyId: "ag1", agentId: "agt" };
  ok("עדכון שנכשל אינו מצמיד ואינו מודיע", await attachToOpenLead(sb, desk) === null && sb.updates.length === 0 && sb.notes.length === 0);
  const missing = fakeSb({
    phone: "972501234567",
    touchMissing: true,
    leads: [{ id: "lead-1", agent_id: "agt", agency_id: "ag1", status: "unlocked", created_at: recent, raw_message: "ישן" }],
  });
  ok("פונקציית המגע שטרם עלתה ממשיכה ל-insert", await attachToOpenLead(missing, desk) === null && missing.notes.length === 0);
}

// ---------------------------------------------------------------------------
// א. פניית פלטפורמה אינה נבלעת בליד של דף, מכל משרד.
// ---------------------------------------------------------------------------
{
  const page = (id: string, source: string): OpenLeadRow => ({
    id, agent_id: "agt-page", agency_id: "ag-page", status: "unlocked", source, created_at: recent,
    raw_message: "כתבתי בדף",
  });
  const onlyPage = fakeSb({ phone: "972501234567", leads: [page("p", "agency_page")] });
  ok("ליד מדף משרד אינו בולע פניית פלטפורמה", await attachToOpenLead(onlyPage, base) === null && onlyPage.updates.length === 0 && onlyPage.notes.length === 0);
  const agentPage = fakeSb({ phone: "972501234567", leads: [page("p", "agent_page")] });
  ok("ליד מדף סוכן/ת אינו בולע פניית פלטפורמה", await attachToOpenLead(agentPage, base) === null);
  const prefixed = fakeSb({ phone: "972501234567", leads: [page("p", "agency_page_owner_wizard")] });
  ok("קידומת של דף נחשבת ניתוב דף", isPageRoutedSource("agency_page_owner_wizard") && await attachToOpenLead(prefixed, base) === null);
  ok("מקור פלטפורמה ו-null אינם דף", !isPageRoutedSource(null) && !isPageRoutedSource("meta_ads_owner_form") && !isPageRoutedSource("homepage_owner_wizard"));

  const mixed = fakeSb({
    phone: "972501234567",
    leads: [
      page("page", "agency_page"),
      {
        id: "plat", agent_id: "agt-plat", agency_id: "ag-plat", status: "unlocked",
        source: "facebook_dm", created_at: older, raw_message: "כתבתי בפייסבוק",
      },
    ],
  });
  const hit = await attachToOpenLead(mixed, base);
  ok("ליד משויך אינו יעד של פניית פלטפורמה, וליד דף אינו נבחר במקומו", hit === null && mixed.updates.length === 0);

  const nullSource = fakeSb({
    phone: "972501234567",
    leads: [{
      id: "old", agent_id: "agt", agency_id: "ag-old", status: "unlocked", source: null,
      created_at: recent, city: "עפולה", raw_message: "הרצל 12",
    }],
  });
  ok("source ריק עם משרד אינו בולע פניית פלטפורמה",
    !isPlatformTarget({ agency_id: "ag-old", agent_id: "agt", source: null }) &&
    await attachToOpenLead(nullSource, { ...base, matchAddress: true, city: "עפולה", address: "הרצל 12" }) === null &&
    nullSource.updates.length === 0);
  ok("source ריק עם סוכן/ת בלבד אינו יעד פלטפורמה", !isPlatformTarget({ agency_id: null, agent_id: "agt", source: null }));
  ok("בלי משרד ובלי סוכן/ת ובלי דף זה יעד פלטפורמה", isPlatformTarget({ agency_id: null, agent_id: null, source: null }));
  ok("דף בלי משרד אינו יעד פלטפורמה", !isPlatformTarget({ agency_id: null, agent_id: null, source: "agency_page" }));
  const unassigned = fakeSb({
    phone: "972501234567",
    leads: [{ id: "u", agent_id: null, agency_id: null, status: "unlocked", source: null, created_at: recent }],
  });
  ok("יעד פלטפורמה בלי סוכן/ת אינו נבלע", await attachToOpenLead(unassigned, base) === null && unassigned.updates.length === 0);

  const sameDeskPage = fakeSb({
    phone: "972501234567",
    leads: [{
      id: "desk", agent_id: "agt", agency_id: "ag1", status: "unlocked", source: "agency_page",
      created_at: recent, raw_message: "מהדף",
    }],
  });
  const deskHit = await attachToOpenLead(sameDeskPage, { ...base, agencyId: "ag1", agentId: "agt" });
  ok("פנייה עם משרד וסוכן/ת עדיין מצמידה לאותו שולחן, גם אם הליד מדף", deskHit?.lead_id === "desk");
  const q = sameDeskPage.calls.find((c) => c.table === "leads" && c.op === "leads");
  ok("השולחן הידוע מסונן במסד", q?.filters.agency_id === "ag1" && q?.filters.agent_id === "agt");
}

// ---------------------------------------------------------------------------
// ה. בעל/ת נכס: אותה עיר, אותו רחוב, ומספר בית אם נכתב.
// ---------------------------------------------------------------------------
{
  const herzl = parseAddressIdentity("עפולה", "רחוב הרצל 12");
  ok("רחוב הרצל 12 הוא הרצל 12", herzl?.street === "הרצל" && herzl?.house === "12" && herzl?.city === "עפולה");
  ok("שדרות וקידומת רח מתקפלות לאותו רחוב",
    sameOwnerAddress(herzl!, parseAddressIdentity("עפולה", "שדרות הרצל 12")) &&
    sameOwnerAddress(herzl!, parseAddressIdentity("עפולה", "רח' הרצל 12")));
  ok("מספר בית אחר אינו אותו נכס", !sameOwnerAddress(herzl!, parseAddressIdentity("עפולה", "הרצל 14")));
  ok("רחוב בלי מספר אינו נבלע ברחוב עם מספר", !sameOwnerAddress(herzl!, parseAddressIdentity("עפולה", "הרצל")));
  ok("שני צדדים בלי מספר בית כן מתאימים",
    sameOwnerAddress(parseAddressIdentity("עפולה", "הרצל")!, parseAddressIdentity("עפולה", "רחוב הרצל")));
  ok("עיר אחרת אינה אותו נכס", !sameOwnerAddress(herzl!, parseAddressIdentity("חיפה", "הרצל 12")));
  ok("4 חדרים אינו כתובת", parseAddressIdentity("עפולה", "4 חדרים") === null);
  ok("בלי רחוב אין זהות", parseAddressIdentity("עפולה", "") === null && parseAddressIdentity("", "הרצל 12") === null);
  ok("הכתובת השמורה היא הקטע הראשון, לא ההערה",
    addressFromStoredLead({ city: "עפולה", raw_message: "הרצל 12 · 4 חדרים\nפנייה נוספת: שוב" })?.house === "12");
  ok("מפרט שמור אינו כתובת", addressFromStoredLead({ city: "עפולה", raw_message: "4 חדרים" }) === null);

  const stored = (raw: string, city = "עפולה"): OpenLeadRow => ({
    id: "own", agent_id: "agt", agency_id: "ag1", status: "unlocked", source: "homepage_owner_wizard",
    created_at: recent, raw_message: raw, city,
  });
  const ownerBase: AttachInput = {
    ...base, matchAddress: true, city: "עפולה", address: "רחוב הרצל 12", agencyId: "ag1", agentId: "agt",
  };
  const same = fakeSb({ phone: "972501234567", leads: [stored("שדרות הרצל 12 · 3 חדרים")] });
  ok("אותה כתובת מצמידה", (await attachToOpenLead(same, ownerBase))?.lead_id === "own");
  const otherHouse = fakeSb({ phone: "972501234567", leads: [stored("הרצל 14")] });
  ok("בית אחר אינו מצמיד", await attachToOpenLead(otherHouse, ownerBase) === null && otherHouse.notes.length === 0);
  const noHouse = fakeSb({ phone: "972501234567", leads: [stored("הרצל")] });
  ok("חסר מספר בית בצד אחד אינו מצמיד", await attachToOpenLead(noHouse, ownerBase) === null);
  const details = fakeSb({ phone: "972501234567", leads: [stored("4 חדרים")] });
  ok("ליד בלי רחוב אינו בולע פנייה עם רחוב", await attachToOpenLead(details, ownerBase) === null);
  const otherCity = fakeSb({ phone: "972501234567", leads: [stored("הרצל 12", "חיפה")] });
  ok("עיר אחרת אינה מצמידה", await attachToOpenLead(otherCity, ownerBase) === null);
  const bare = fakeSb({ phone: "972501234567", leads: [stored("הרצל 12")] });
  ok("בלי כתובת בפנייה אין קריאה למסד", await attachToOpenLead(bare, { ...ownerBase, address: null }) === null && bare.calls.length === 0);
  const pageAddr = fakeSb({
    phone: "972501234567",
    leads: [{ ...stored("הרצל 12"), source: "agency_page", agency_id: "ag-page", id: "page-own" }],
  });
  ok("גם עם אותה כתובת, ליד דף אינו בולע פניית פלטפורמה",
    await attachToOpenLead(pageAddr, { ...ownerBase, agencyId: null, agentId: null }) === null && pageAddr.updates.length === 0);
}

{
  const rows = pageLeadInsertAttempts({ city: "עפולה" }, "property_inquiry", "agency_page");
  ok("כל ניסיון insert של ליד דף נושא source",
    rows.length === 3 && rows.every((row) => row.source === "agency_page"));
  ok("הניסיון האחרון שומר source גם כשהסוג יורד",
    rows[2].lead_type === "owner_inbound" && rows[2].source === "agency_page");
  const ownerRows = pageLeadInsertAttempts({ city: "עפולה" }, "owner_inbound", "agent_page");
  ok("ליד בעלים מדף סוכן/ת נושא source בכל ניסיון",
    ownerRows.every((row) => row.source === "agent_page" && row.lead_type === "owner_inbound"));
}

// ---------------------------------------------------------------------------
// מי רשאי/ת להצמיד: הדפדפן מקבל null והקליטה נשארת על צורת ה-insert.
// קורא service role מקבל תוכנית. הקבצים עצמם קוראים לזה רק אחרי isInternalCaller.
// ---------------------------------------------------------------------------
{
  const ownerCtx = {
    trusted: true,
    insertedType: "owner_inbound",
    phone: "050-123-4567",
    agencyId: null as string | null,
    agentId: null as string | null,
    city: "עפולה",
    address: "הרצל 12" as string | null,
    source: "meta_ads_owner_form",
    externalRef: "998877",
    message: "מהדירה",
    sourceLabel: "טופס לידים במטא · מוכר/ת",
  };
  ok("דפדפן בבעלים אינו מצמיד", ownerPhoneAttach({ ...ownerCtx, trusted: false }) === null);
  const ownerPlan = ownerPhoneAttach(ownerCtx);
  ok("service role בבעלים מצמיד עם כתובת",
    !!ownerPlan && ownerPlan.internal === true && ownerPlan.matchAddress === true && ownerPlan.matchProperty === false);
  ok("בעלים בלי רחוב אינו מצמיד", ownerPhoneAttach({ ...ownerCtx, address: null }) === null);
  ok("מחשבון תשואה אינו מצמיד", ownerPhoneAttach({ ...ownerCtx, insertedType: "property_inquiry" }) === null);
  ok("משרד בלי סוכן/ת אינו תוכנית", ownerPhoneAttach({ ...ownerCtx, agencyId: "ag1", agentId: null }) === null);

  const propCtx = {
    trusted: true,
    phone: "050-123-4567",
    propertyId: "prop-9" as string | null,
    agencyId: "ag1" as string | null,
    agentId: "agt" as string | null,
    source: "meta_ads_property_form",
    externalRef: "998877",
    message: "מעוניין",
    sourceLabel: "טופס לידים במטא · פנייה על נכס",
  };
  ok("דפדפן בפנייה על נכס אינו מצמיד", propertyPhoneAttach({ ...propCtx, trusted: false }) === null);
  const propPlan = propertyPhoneAttach(propCtx);
  ok("service role בפנייה על נכס מצמיד לאותו שולחן",
    !!propPlan && propPlan.internal === true && propPlan.matchProperty === true &&
    propPlan.propertyId === "prop-9" && propPlan.agencyId === "ag1" && propPlan.agentId === "agt");
  ok("בלי נכס אין תוכנית", propertyPhoneAttach({ ...propCtx, propertyId: null }) === null);
  ok("בלי סוכן/ת על הנכס אין תוכנית", propertyPhoneAttach({ ...propCtx, agentId: null }) === null);
  ok("צורת duplicate רק למיזוג", duplicateLeadBody("lead-1").duplicate === true && duplicateLeadBody("lead-1").lead_id === "lead-1");

  const ownerIdx = readFileSync(new URL("../supabase/functions/owner-lead-intake/index.ts", import.meta.url), "utf8");
  const propIdx = readFileSync(new URL("../supabase/functions/property-inquiry-intake/index.ts", import.meta.url), "utf8");
  ok("קליטת בעלים קוראת להצמדה רק כשיש תוכנית",
    /const merged = plan \? await attachToOpenLead\(supabase, plan\) : null/.test(ownerIdx) &&
    ownerIdx.includes("if (merged) return json(duplicateLeadBody(merged.lead_id))"));
  ok("בלי מיזוג תשובת הבעלים היא צורת ה-insert",
    ownerIdx.includes("lead_id: lead.id") && ownerIdx.includes("match_type: matchType") &&
    !ownerIdx.includes("duplicate: true, lead_id: lead.id"));
  ok("קליטת פנייה קוראת להצמדה רק כשיש תוכנית",
    /const merged = plan \? await attachToOpenLead\(supabase, plan\) : null/.test(propIdx) &&
    propIdx.includes("if (merged) return json(duplicateLeadBody(merged.lead_id))"));
  ok("בלי מיזוג תשובת הפנייה היא צורת ה-insert",
    propIdx.includes("auto_unlocked: autoUnlock") && propIdx.includes("lead_id: lead.id") &&
    !propIdx.includes("duplicate: true, lead_id: lead.id"));
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
ok("טופס בעלים במטא לא שולח רחוב", "body" in ownerReq && !("address" in ownerReq.body));

const serviceKey = "service-role-key-0123456789";
const anonKey = "anon-key-aaaaaaaaaaaaaaaa";
const userJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.sig";
function callAs(headers: Record<string, string> | null): boolean {
  const req = headers
    ? new Request("https://example.test/fn", { method: "POST", headers })
    : new Request("https://example.test/fn", { method: "POST" });
  return routing.isInternalCaller(req, serviceKey);
}
ok("Bearer של service role הוא קורא פנימי", callAs({ authorization: `Bearer ${serviceKey}` }));
ok("Bearer שגוי אינו קורא פנימי", !callAs({ authorization: "Bearer not-the-service-role" }));
ok("apikey של anon בלי Bearer אינו קורא פנימי", !callAs({ apikey: anonKey }));
ok("Bearer של anon אינו קורא פנימי", !callAs({ authorization: `Bearer ${anonKey}`, apikey: anonKey }));
ok("JWT של משתמש/ת אינו קורא פנימי", !callAs({ authorization: `Bearer ${userJwt}` }));
ok("בלי כותרת Authorization אינו קורא פנימי", !callAs(null));
ok("apikey של service role בלי Bearer אינו קורא פנימי", !callAs({ apikey: serviceKey }));
const propReq = meta.intakeRequest(lead, { ...formBase, kind: "property", property_id: "prop-1" });
ok("פנייה על נכס נושאת external_ref", "body" in propReq && propReq.fn === "property-inquiry-intake" && propReq.body.external_ref === lead.id);
const buyerReq = meta.intakeRequest(lead, { ...formBase, kind: "buyer" });
ok("מחפש/ת נושא/ת external_ref", "body" in buyerReq && buyerReq.fn === "saved-search-intake" && buyerReq.body.external_ref === lead.id && buyerReq.body.source === "meta_ads_buyer_form");

if (fail) {
  console.error(`\n${fail} failed`);
  process.exit(1);
}
console.log("\nall passed");
