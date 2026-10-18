// ============================================================================
// csm-tools.ts — גבריאלה לצוות ההטמעה (docs/csm-adoption.md, "בוואטסאפ")
//
// אשת צוות ההטמעה כותבת לגבריאלה מאותו מספר, ומזוהה לפי הטלפון ב-csm_staff
// (‏csm-chat.ts). היא **אינה סוכנת**: התור שלה נפרד לגמרי מזה של הסוכנים, עם
// הכלים האלה בלבד - מי בסיכון, פרטי סוכן/ת או משרד, העברת שלב, רישום פגישה,
// בקשת פיתוח, הקלטות שיחה ושאלה למנטור ההטמעה. אין כאן נכסים, לקוחות, לידים
// או ניהול פלטפורמה.
//
// הנתונים מ-csm_agents_overview (אותה פונקציה של האזור ב-/csm), דרך service_role.
// ============================================================================
import type Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

type Row = Record<string, unknown>;

const STAGES: Record<string, string> = {
  registered: "נרשם/ה - לא פעיל/ה",
  call_scheduled: "נקבעה פגישה",
  onboarded: "עבר/ה הדרכה וביצע/ה פעולה ראשונה",
  active_pilot: "בפיילוט פעיל",
  champion: "משתמש/ת עצמאי/ת",
  at_risk: "נשירה - דורש/ת חיזוק",
};
const STAGE_ORDER = Object.keys(STAGES);
const WINS = ["connect", "property", "client", "match", "post", "mentor", "reminder"];


export const CSM_TOOLS: Anthropic.Tool[] = [
  {
    name: "csm_overview",
    description:
      "צוות ההטמעה בלבד. תמונת המצב של הטמעת הסוכנים: כמה בכל שלב, מי בסיכון (5 ימים ומעלה בלי הודעה לגבריאלה), " +
      "ומי שמועד הקשר שלו/ה הגיע. לשאלות כמו \"מי בסיכון?\", \"למי לחזור היום?\", \"מה המצב?\".",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "csm_find_agent",
    description:
      "צוות ההטמעה בלבד. כרטיס מלא של סוכן/ת לפי שם, טלפון או שם משרד: טלפון, מייל, משרד וכתובתו, מסלול, " +
      "השלב בצנרת, ורמת השימוש (הודעות לגבריאלה, נכסים, לקוחות, משימות, שאלות למנטור, כניסה אחרונה). " +
      "מחזיר גם agent_id לשימוש בכלים csm_set_stage / csm_log_session / csm_add_feedback.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "שם, חלק משם, טלפון או שם משרד" } },
      required: ["query"],
    },
  },
  {
    name: "csm_office",
    description:
      "צוות ההטמעה בלבד. משרד תיווך לפי שם: כתובת ועיר, המנהלים, וכל הסוכנים עם טלפון, שלב ושימוש. " +
      "בלי query - רשימת כל המשרדים עם מספרים מצטברים, לתעדוף.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "שם המשרד או חלק ממנו. ריק = כל המשרדים" } },
    },
  },
  {
    name: "csm_set_stage",
    description:
      "צוות ההטמעה בלבד. העברת סוכן/ת לשלב בצנרת, ולפי הצורך מועד הקשר הבא והערה. " +
      "השלבים: registered (נרשם/ה), call_scheduled (נקבעה פגישה), onboarded (עבר/ה הדרכה), " +
      "active_pilot (פיילוט פעיל), champion (עצמאי/ת), at_risk (נשירה). קודם csm_find_agent למזהה.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        stage: { type: "string", enum: STAGE_ORDER },
        followup_date: { type: "string", description: "YYYY-MM-DD, מועד הקשר הבא" },
        note: { type: "string" },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "csm_log_session",
    description:
      "צוות ההטמעה בלבד. רישום פגישת הדרכה או שיחת מעקב עם סוכן/ת: אילו פעולות בוצעו בהצלחה " +
      "(connect=שמירת המספר והודעת שלום, property=נכס, client=לקוח/ה, match=התאמה, post=פוסט שיווקי, " +
      "mentor=שאלה למנטור, reminder=תזכורת), דירוג 1-5, יעד שבועי, מועד קשר והערות. " +
      "פעולה אחת לפחות מעבירה ל\"עבר/ה הדרכה\". לסכם לה מה נרשם לפני הקריאה אם משהו לא ברור.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        done: { type: "array", items: { type: "string", enum: WINS } },
        clarity: { type: "integer", minimum: 1, maximum: 5, description: "האם המערכת ברורה" },
        time_saving: { type: "integer", minimum: 1, maximum: 5, description: "האם רואה/ה חיסכון בזמן" },
        weekly_goal: { type: "string" },
        followup_date: { type: "string", description: "YYYY-MM-DD" },
        notes: { type: "string" },
        dev_notes: { type: "string", description: "קושי בניסוח, שדה חסר, באג" },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "csm_add_feedback",
    description:
      "צוות ההטמעה בלבד. בקשת פיתוח או חיכוך שסוכן/ת העלה/תה. בקשה עם אותה כותרת מקבלת את הסוכן/ת כקול נוסף " +
      "(\"ביקשו 3\") ולא שורה כפולה - לכן כותרת קצרה ועניינית.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "הבקשה במשפט אחד" },
        agent_id: { type: "string", description: "מי ביקש/ה (מ-csm_find_agent). לא חובה" },
        category: { type: "string", enum: ["pilot_blocker", "daily_efficiency", "office_management"] },
        severity: { type: "string", enum: ["blocker", "usability", "enhancement"] },
        description: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "csm_ask_mentor",
    description:
      "שאלה למנטור ההטמעה: עם איזה משרדים להתחיל, איך לגשת למשרד או למנהל/ת, מה לענות על התנגדות, " +
      "איך להחזיר סוכן/ת שנשר/ה. המנטור רואה את כל התיק. להעביר את השאלה כמו שנשאלה.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
  {
    name: "csm_recent_calls",
    description:
      "הקלטות השיחה האחרונות שנותחו (מהאזור או מוואטסאפ): מתי, עם מי, סטטוס, ותקציר. " +
      "עם call_id - הניתוח המלא של שיחה אחת (סיכום, התחייבויות, המלצות, צעדים, הודעה מוצעת).",
    input_schema: {
      type: "object",
      properties: { call_id: { type: "string" } },
    },
  },
  {
    name: "csm_link_call",
    description:
      "שיוך הקלטת שיחה לסוכן/ת (\"זו הייתה שיחה עם יוסי\"). קודם csm_find_agent למזהה. " +
      "apply_followup=true מעדכן גם את מועד הקשר והשלב המוצע מהניתוח.",
    input_schema: {
      type: "object",
      properties: {
        call_id: { type: "string" },
        agent_id: { type: "string" },
        apply_followup: { type: "boolean" },
      },
      required: ["call_id", "agent_id"],
    },
  },
];


const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const days = (v: unknown) => (v ? Math.floor((Date.now() - new Date(String(v)).getTime()) / 86400000) : null);
const norm = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

function waDigits(phone: unknown): string {
  const d = digits(phone);
  return d.startsWith("0") ? "972" + d.slice(1) : d;
}

// מועד קשר: 10:00 בבוקר בישראל ביום שנבחר
function followupIso(date: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? "").trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T10:00:00+03:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function agentCard(r: Row) {
  return {
    agent_id: r.agent_id,
    name: r.display_name,
    phone: r.phone,
    whatsapp: r.phone ? "https://wa.me/" + waDigits(r.phone) : null,
    email: r.email,
    office: r.agency_name,
    office_address: [r.agency_address, r.agency_city].filter(Boolean).join(", ") || null,
    role: r.role === "manager" ? "מנהל/ת משרד" : "סוכן/ת",
    tier: r.tier,
    stage: STAGES[String(r.stage)] || r.stage,
    joined_days_ago: days(r.joined_at),
    last_login_days_ago: days(r.last_login_at),
    days_since_gabriela: days(r.last_gabriela_at),
    gabriela_messages_7d: num(r.gabriela_7d),
    gabriela_messages_30d: num(r.gabriela_30d),
    active_listings: num(r.active_listings),
    listings_total: num(r.listings_total),
    clients: num(r.clients),
    open_tasks: num(r.open_tasks),
    mentor_questions_30d: num(r.mentor_30d),
    sessions: num(r.sessions),
    last_session_days_ago: days(r.last_session_at),
    weekly_goal: r.last_weekly_goal || null,
    next_followup: r.next_followup_at ? String(r.next_followup_at).slice(0, 10) : null,
    notes: r.stage_notes || null,
  };
}

const short = (r: Row) => ({
  agent_id: r.agent_id, name: r.display_name, office: r.agency_name, phone: r.phone,
  stage: STAGES[String(r.stage)] || r.stage, days_since_gabriela: days(r.last_gabriela_at),
});

async function overviewRows(supabase: SupabaseClient): Promise<Row[]> {
  const { data, error } = await supabase.rpc("csm_agents_overview");
  if (error) throw new Error(error.message);
  return (data as Row[]) ?? [];
}

function atRisk(r: Row) {
  return r.stage !== "champion" && (days(r.joined_at) ?? 0) >= 5 && (days(r.last_gabriela_at) ?? 999) >= 5;
}

/* ‏staff: השורה ב-csm_staff שזוהתה לפי הטלפון (csm-chat.ts). ‏askMentor מוזרק
   כדי שהקובץ לא ייבא את המנטור (וממנו npm:) בבדיקות. */
export async function runCsmTool(
  supabase: SupabaseClient, staff: { id: string }, name: string, input: Record<string, unknown>,
  askMentor?: (q: unknown) => Promise<unknown>,
): Promise<unknown> {
  if (!staff?.id) return { ok: false, error: "הכלי פתוח לצוות ההטמעה בלבד." };

  if (name === "csm_ask_mentor") {
    return askMentor ? await askMentor(input.question) : { ok: false, error: "המנטור לא זמין כרגע." };
  }

  if (name === "csm_recent_calls") {
    const names = new Map(((await overviewRows(supabase)) ?? []).map((r) => [r.agent_id, r.display_name]));
    if (input.call_id) {
      const { data, error } = await supabase.from("csm_calls")
        .select("id, title, agent_id, status, error, analysis, created_at").eq("id", String(input.call_id)).maybeSingle();
      if (error || !data) return { ok: false, error: "השיחה לא נמצאה." };
      return { ok: true, call: { ...data, agent: names.get(data.agent_id) || null } };
    }
    const { data, error } = await supabase.from("csm_calls")
      .select("id, title, agent_id, status, error, analysis, created_at")
      .order("created_at", { ascending: false }).limit(8);
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      calls: ((data as Row[] | null) ?? []).map((c) => ({
        call_id: c.id, title: c.title, agent: names.get(c.agent_id) || null, status: c.status,
        date: String(c.created_at).slice(0, 10), error: c.error || null,
        summary: (c.analysis as Row | null)?.summary ?? null,
      })),
    };
  }

  if (name === "csm_overview") {
    const rows = await overviewRows(supabase);
    const byStage: Record<string, number> = {};
    for (const r of rows) {
      const s = STAGES[String(r.stage)] || String(r.stage);
      byStage[s] = (byStage[s] || 0) + 1;
    }
    const due = rows.filter((r) => r.next_followup_at && new Date(String(r.next_followup_at)).getTime() <= Date.now() + 86400000);
    const risk = rows.filter(atRisk).sort((a, b) => (days(a.joined_at) ?? 0) - (days(b.joined_at) ?? 0));
    return {
      ok: true,
      agents_total: rows.length,
      by_stage: byStage,
      at_risk_count: risk.length,
      at_risk: risk.slice(0, 15).map(short),
      followups_due: due.slice(0, 15).map((r) => ({ ...short(r), weekly_goal: r.last_weekly_goal || null,
        followup: String(r.next_followup_at).slice(0, 10) })),
      note: "הצג/י בקצרה: מספרים לפי שלב, ואז מי בסיכון ומי לחזור אליו היום (שם, משרד, טלפון). " +
        "חדשים (הצטרפו לאחרונה) קודם - שם החלון נסגר הכי מהר.",
    };
  }

  if (name === "csm_find_agent") {
    const q = norm(input.query), qd = digits(input.query);
    if (!q) return { ok: false, error: "צריך שם, טלפון או משרד." };
    const rows = await overviewRows(supabase);
    const hits = rows.filter((r) =>
      norm(r.display_name).includes(q) || norm(r.agency_name).includes(q) ||
      (qd.length >= 6 && (digits(r.phone).endsWith(qd.slice(-9)))));
    if (!hits.length) return { ok: true, count: 0, note: "לא נמצא/ה סוכן/ת. אפשר לנסות חלק מהשם או את הטלפון." };
    if (hits.length > 8) {
      return { ok: true, count: hits.length, agents: hits.slice(0, 15).map(short),
        note: "יותר מדי תוצאות - להציג את הרשימה הקצרה ולשאול למי הכוונה." };
    }
    return { ok: true, count: hits.length, agents: hits.map(agentCard) };
  }

  if (name === "csm_office") {
    const rows = await overviewRows(supabase);
    const q = norm(input.query);
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const k = String(r.agency_id || "none");
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    if (!q) {
      return {
        ok: true,
        offices: [...groups.values()].map((a) => ({
          office: a[0].agency_name, city: a[0].agency_city || null, agents: a.length,
          on_gabriela_7d: a.filter((r) => num(r.gabriela_7d) > 0).length,
          active_listings: a.reduce((s, r) => s + num(r.active_listings), 0),
          at_risk: a.filter(atRisk).length,
          manager_uses_gabriela: a.some((r) => r.role === "manager" && (days(r.last_gabriela_at) ?? 999) < 7),
        })).sort((x, y) => y.agents - x.agents).slice(0, 40),
      };
    }
    const match = [...groups.values()].filter((a) => norm(a[0].agency_name).includes(q));
    if (!match.length) return { ok: true, count: 0, note: "לא נמצא משרד בשם הזה." };
    if (match.length > 3) return { ok: true, count: match.length, offices: match.map((a) => a[0].agency_name), note: "לשאול לאיזה משרד הכוונה." };
    return {
      ok: true,
      offices: match.map((a) => ({
        office: a[0].agency_name,
        address: [a[0].agency_address, a[0].agency_city].filter(Boolean).join(", ") || null,
        agents_count: a.length,
        managers: a.filter((r) => r.role === "manager").map((r) => ({ name: r.display_name, phone: r.phone, email: r.email })),
        agents: a.map((r) => ({ ...short(r), tier: r.tier, gabriela_7d: num(r.gabriela_7d),
          active_listings: num(r.active_listings), clients: num(r.clients) })),
      })),
    };
  }

  if (name === "csm_link_call") {
    const rows = await overviewRows(supabase);
    const target = rows.find((r) => r.agent_id === String(input.agent_id));
    if (!target) return { ok: false, error: "agent_id לא נמצא. קודם csm_find_agent." };
    const { data: call, error } = await supabase.from("csm_calls")
      .update({ agent_id: target.agent_id }).eq("id", String(input.call_id)).select("id, analysis").maybeSingle();
    if (error || !call) return { ok: false, error: "השיחה לא נמצאה." };
    const a = (call.analysis ?? {}) as Row;
    if (input.apply_followup && (a.suggested_stage || a.followup_date)) {
      const row: Row = { agent_id: target.agent_id, updated_at: new Date().toISOString(),
        stage: STAGES[String(a.suggested_stage)] ? a.suggested_stage : target.stage };
      if (a.followup_date) row.next_followup_at = followupIso(a.followup_date);
      const { error: stErr } = await supabase.from("csm_agent_stage").upsert(row, { onConflict: "agent_id" });
      if (stErr) return { ok: false, error: stErr.message };
      return { ok: true, name: target.display_name, stage: STAGES[String(row.stage)], followup: a.followup_date || null };
    }
    return { ok: true, name: target.display_name };
  }

  // הכלים שכותבים: הסוכן/ת חייב/ת להיות ברשימה
  const rows = name === "csm_add_feedback" && !input.agent_id ? [] : await overviewRows(supabase);
  const target = input.agent_id ? rows.find((r) => r.agent_id === String(input.agent_id)) : null;
  if (input.agent_id && !target) return { ok: false, error: "agent_id לא נמצא. קודם csm_find_agent." };

  if (name === "csm_set_stage") {
    if (!target) return { ok: false, error: "חסר agent_id." };
    const stage = input.stage ? String(input.stage) : String(target.stage);
    if (!STAGES[stage]) return { ok: false, error: "שלב לא מוכר." };
    const row: Row = { agent_id: target.agent_id, stage, updated_at: new Date().toISOString() };
    if (input.followup_date !== undefined) row.next_followup_at = followupIso(input.followup_date);
    if (input.note) row.notes = String(input.note).slice(0, 2000);
    const { error } = await supabase.from("csm_agent_stage").upsert(row, { onConflict: "agent_id" });
    if (error) return { ok: false, error: error.message };
    return { ok: true, name: target.display_name, stage: STAGES[stage],
      followup: row.next_followup_at ? String(input.followup_date) : null };
  }

  if (name === "csm_log_session") {
    if (!target) return { ok: false, error: "חסר agent_id." };
    const done = (Array.isArray(input.done) ? input.done : []).map(String).filter((k) => WINS.includes(k));
    const firstWin = Object.fromEntries(WINS.map((k) => [k, done.includes(k)]));
    const rate = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : null);
    const follow = followupIso(input.followup_date);
    const { error } = await supabase.from("csm_sessions").insert({
      agent_id: target.agent_id,
      kind: num(target.sessions) ? "followup" : "first_win",
      first_win: firstWin,
      clarity: rate(input.clarity), time_saving: rate(input.time_saving),
      weekly_goal: input.weekly_goal ? String(input.weekly_goal).slice(0, 300) : null,
      followup_at: follow,
      notes: input.notes ? String(input.notes).slice(0, 4000) : null,
      dev_notes: input.dev_notes ? String(input.dev_notes).slice(0, 4000) : null,
    });
    if (error) return { ok: false, error: error.message };
    // כמו "שמירת הפגישה" ב-CRM: הצלחה מקדמת ל"עבר/ה הדרכה", רק קדימה; מנשירה - לפיילוט
    const cur = String(target.stage);
    const next = done.length && STAGE_ORDER.indexOf(cur) < STAGE_ORDER.indexOf("onboarded") ? "onboarded"
      : cur === "at_risk" && done.length ? "active_pilot" : cur;
    const { error: stErr } = await supabase.from("csm_agent_stage").upsert(
      { agent_id: target.agent_id, stage: next, updated_at: new Date().toISOString(), ...(follow ? { next_followup_at: follow } : {}) },
      { onConflict: "agent_id" });
    if (stErr) console.error("csm stage after session failed", stErr.message);
    return { ok: true, name: target.display_name, done: done.length, stage: STAGES[next],
      followup: follow ? String(input.followup_date) : null };
  }

  if (name === "csm_add_feedback") {
    const title = String(input.title ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
    if (title.length < 2) return { ok: false, error: "חסרה כותרת." };
    const { data: existing, error: e1 } = await supabase.from("csm_feedback").select("id, title").limit(1000);
    if (e1) return { ok: false, error: e1.message };
    let id = ((existing as Row[] | null) ?? []).find((f) => norm(f.title) === norm(title))?.id as string | undefined;
    const isNew = !id;
    if (!id) {
      const cat = String(input.category || "");
      const sev = String(input.severity || "");
      const { data, error } = await supabase.from("csm_feedback").insert({
        title,
        description: input.description ? String(input.description).slice(0, 4000) : null,
        category: ["pilot_blocker", "daily_efficiency", "office_management"].includes(cat) ? cat : "daily_efficiency",
        severity: ["blocker", "usability", "enhancement"].includes(sev) ? sev : "usability",
      }).select("id").single();
      if (error) return { ok: false, error: error.message };
      id = data.id as string;
    }
    if (target) {
      const { error } = await supabase.from("csm_feedback_votes")
        .upsert({ feedback_id: id, agent_id: target.agent_id }, { onConflict: "feedback_id,agent_id", ignoreDuplicates: true });
      if (error) return { ok: false, error: error.message };
    }
    const { count } = await supabase.from("csm_feedback_votes").select("id", { count: "exact", head: true }).eq("feedback_id", id);
    return { ok: true, new_request: isNew, requested_by: count ?? 0 };
  }

  return { ok: false, error: `כלי לא מוכר: ${name}` };
}
