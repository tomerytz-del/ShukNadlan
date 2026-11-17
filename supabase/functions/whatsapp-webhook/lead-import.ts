/**
 * ייבוא לידים מקובץ דרך גבריאלה (וואטסאפ ומייל), שורה-שורה, עם שאלה על כל שורה
 * שחסר בה פרט. הליבה הטהורה ב-lead-import-core.ts, והבדיקות ב-lead_import_test.ts.
 *
 *   קובץ Excel/CSV של אנשים ──► prepareLeadImportJob: עותק ב-lead_import_jobs
 *                                 וסיכום יבש (כמה שלמות, כמה עם חסר)
 *   "כן, תכניסי" ─────────────► runLeadImport (import_leads_file): כל שורה שלמה
 *                                 נכנסת בנפרד ל-leads (agent_lead_add), שורה עם חסר
 *                                 מחכה בתור
 *   תשובה על שורה ──────────► answerLeadImport (lead_import_answer): משלימה את
 *                                 הראשונה בתור, מכניסה אותה, ושואלת על הבאה
 *
 * **הקובץ אינו נשאר בשיחה** (ההיסטוריה שומרת 2,500 תווים), ולכן השאלה על שורה 7
 * אחרי כמה הודעות נשענת על העבודה במסד ולא על זיכרון המודל.
 *
 * **בתור שקורא קובץ אין כתיבה** (MEDIA_TOOLS), וגם במייל: ההכנסה רצה רק אחרי "כן"
 * בוואטסאפ. תוכן הקובץ נכתב בידי אחרים ואינו הוראה.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { readMatrix } from "./property-import.ts";
import {
  applyAnswer,
  describeDraft,
  type LeadDefaults,
  type LeadDraft,
  type LeadFields,
  LEAD_IMPORT_MAX_ROWS,
  looksLikeLeads,
  mapLeadHeaders,
  missingText,
  parseLeadRows,
  rpcPayload,
  type AnswerInput,
} from "./lead-import-core.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** אחרי זה הסיכום כבר לא מתאר את המצב, והקובץ נשלח מחדש */
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

type RowStatus = "inserted" | "duplicate" | "failed" | "skipped" | "pending";

interface JobState {
  defaults?: LeadDefaults;
  /** שדות ששורה קיבלה בתשובות: גוברים על מה שבקובץ */
  fixes?: Record<string, LeadFields>;
  results?: Record<string, { s: RowStatus; lead_id?: string; why?: string }>;
}

interface AgentLite { id: string; agency_id: string | null }

export async function prepareLeadImportJob(
  supabase: SupabaseClient,
  agent: AgentLite,
  bytes: Uint8Array,
  fileName: string,
  source: "whatsapp" | "email" = "whatsapp",
): Promise<string | null> {
  try {
    const m = readMatrix(bytes, fileName);
    if (!m || !m.rows.length) return null;
    if (!looksLikeLeads(m.headers)) return null;
    if (m.rows.length > LEAD_IMPORT_MAX_ROWS) {
      return `[ייבוא לידים] זה קובץ של אנשים עם יותר מ-${LEAD_IMPORT_MAX_ROWS} שורות - יותר ממה שאפשר לקלוט בשיחה. ` +
        `להציע לפצל אותו לכמה קבצים (או לייבא לקוחות מאקסל בדשבורד).\n[סוף ייבוא לידים]`;
    }
    const { drafts } = parseLeadRows(m.headers, m.rows as unknown[][]);
    const real = drafts.filter((d) => !d.blank);
    const complete = real.filter((d) => !d.missing.length).length;
    const incomplete = real.filter((d) => d.missing.length);
    const noKind = real.filter((d) => d.missing.includes("kind")).length;
    const map = mapLeadHeaders(m.headers);
    const found = (Object.keys(map) as (keyof typeof map)[]).filter((k) => map[k] > -1)
      .map((k) => m.headers[map[k]]);

    const { data: job, error } = await supabase.from("lead_import_jobs").insert({
      agent_id: agent.id, source, file_name: fileName || null,
      headers: m.headers, rows: m.rows, state: {},
    }).select("id").single();
    if (error || !job) {
      console.error("lead import job insert failed", error);
      return null;
    }
    return [
      `[ייבוא לידים] זוהה קובץ של אנשים עם טלפון (job_id: ${job.id}), ${real.length} שורות. עמודות שזוהו: ${found.join(", ")}.`,
      `שלמות (טלפון, שם וסוג): ${complete}. עם חסר: ${incomplete.length}` +
        (noKind ? ` (ב-${noKind} מהן לא ידוע אם מוכר/ת או מחפש/ת)` : "") + ".",
      ...incomplete.slice(0, 3).map((d) => `  • ${describeDraft(d)} - חסר: ${missingText(d.missing)}`),
      `**ליד או לקוח/ה?** אם הסוכן/ת אמר/ה "לידים" - זה import_leads_file (ל"הלידים שלי"). אם אמר/ה "לקוחות" - ` +
        `אלה לא לידים: להציע את הלקוחות (create_client, או ייבוא מאקסל בדשבורד). לא ברור - לשאול במשפט אחד.`,
      `ליד = אדם שהסוכן/ת צריך/ה לחזור אליו (מוכר/ת נכס או מחפש/ת). אחרי אישור: import_leads_file עם ה-job_id הזה. ` +
        `אם הסוכן/ת אמר/ה על כל הקובץ "אלה מוכרים" / "אלה מחפשים" - להעביר default_kind (owner / seeker), ` +
        `ואם אמר/ה מכירה או השכרה - default_deal_type. אין לנחש סוג או עסקה כשלא נאמר.`,
      `השורות השלמות נכנסות בנפרד, ועל כל שורה עם חסר גבריאלה שואלת אחת-אחת.`,
      `[סוף ייבוא לידים]`,
    ].join("\n");
  } catch (err) {
    console.error("prepareLeadImportJob failed", err);
    return null;
  }
}

async function loadJob(supabase: SupabaseClient, agentId: string, jobId: string) {
  const { data, error } = await supabase.from("lead_import_jobs")
    .select("id, agent_id, source, file_name, headers, rows, state, status, created_at")
    .eq("id", jobId).eq("agent_id", agentId).maybeSingle();
  if (error || !data) return { error: "לא מצאתי את הקובץ הזה אצלך. אפשר לשלוח אותו שוב?" } as const;
  if (Date.now() - new Date(String(data.created_at)).getTime() > JOB_TTL_MS && data.status === "pending") {
    return { error: "הקובץ ישן מיום. אפשר לשלוח אותו שוב?" } as const;
  }
  return { job: data as Row };
}

/** הטיוטות של העבודה כרגע: מהקובץ, ועליהן מה שנענה */
function currentDrafts(job: Row): LeadDraft[] {
  const state = (job.state || {}) as JobState;
  const { drafts } = parseLeadRows(job.headers as string[], job.rows as unknown[][], state.defaults || {});
  const fixes = state.fixes || {};
  return drafts.map((d) => {
    const f = fixes[String(d.index)];
    if (!f) return d;
    const merged = applyAnswer({ ...d, fields: f }, {}).draft;
    return merged;
  });
}

function question(d: LeadDraft, pendingLeft: number, note = "") {
  return {
    row: d.rowNumber,
    description: describeDraft(d),
    missing: d.missing,
    missing_text: missingText(d.missing),
    bad_phone: d.badPhone || undefined,
    pending_left: pendingLeft,
    note: note || undefined,
    ask:
      `לשאול אחת: על שורה ${d.rowNumber} חסר ${missingText(d.missing)}. ` +
      `לתת מה שידוע עליה ולבקש רק את החסר. "דלג" מדלג עליה, "דלג על כולם" סוגר את הקובץ. ` +
      `אל תשאל/י על שורה אחרת עד שהשורה הזו נענתה.`,
  };
}

function counts(state: JobState) {
  const out = { inserted: 0, duplicate: 0, failed: 0, skipped: 0, pending: 0 };
  for (const r of Object.values(state.results || {})) out[r.s]++;
  return out;
}

async function insertOne(supabase: SupabaseClient, agentId: string, d: LeadDraft) {
  const { data, error } = await supabase.rpc("agent_lead_add", { p_agent_id: agentId, p: rpcPayload(d.fields) });
  if (error) return { s: "failed" as RowStatus, why: "שגיאת מסד" };
  const r = (data || {}) as Row;
  if (r.duplicate) return { s: "duplicate" as RowStatus, lead_id: String(r.lead_id) };
  if (!r.success) return { s: "failed" as RowStatus, why: String(r.error || "לא נשמר") };
  return { s: "inserted" as RowStatus, lead_id: String(r.lead_id) };
}

async function notifyDone(supabase: SupabaseClient, agentId: string, c: ReturnType<typeof counts>) {
  if (!c.inserted) return;
  const { error } = await supabase.from("notifications").insert({
    agent_id: agentId,
    type: "lead_entered",
    title: c.inserted === 1 ? "הליד נקלט" : `${c.inserted} לידים נקלטו`,
    body: c.pending ? `מהקובץ שנשלח. ${c.pending} ממתינים לפרטים.` : "מהקובץ שנשלח.",
    suppress_push: true,
  });
  if (error) console.error("lead import notification failed", error.message);
}

async function save(supabase: SupabaseClient, jobId: string, state: JobState, done: boolean) {
  await supabase.from("lead_import_jobs").update({
    state, status: done ? "done" : "pending", ...(done ? { finished_at: new Date().toISOString() } : {}),
  }).eq("id", jobId);
}

/** מה נשאר: סיכום, או השאלה הבאה */
function outcome(drafts: LeadDraft[], state: JobState) {
  const c = counts(state);
  const results = state.results || {};
  const nextDraft = drafts.find((d) => results[String(d.index)]?.s === "pending");
  return {
    ok: true,
    inserted: c.inserted,
    duplicates: c.duplicate,
    failed: c.failed,
    skipped: c.skipped,
    pending: c.pending,
    saved_to: "הלידים שלי",
    next: nextDraft ? question(nextDraft, c.pending) : null,
    guidance: nextDraft
      ? "לדווח במשפט אחד כמה נכנסו ל\"הלידים שלי\", ואז לשאול על השורה ב-next (אחת בלבד)."
      : "הקובץ נסגר. לדווח כמה נכנסו ל\"הלידים שלי\", כמה כבר היו (duplicates), כמה דולגו וכמה נכשלו. לא להציע כרטיסי לקוח.",
  };
}

export async function runLeadImport(
  supabase: SupabaseClient,
  agent: AgentLite,
  jobId: string,
  opts: { default_kind?: unknown; default_deal_type?: unknown } = {},
): Promise<Row> {
  const loaded = await loadJob(supabase, agent.id, jobId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const job = loaded.job;
  const state: JobState = (job.state || {}) as JobState;
  state.results = state.results || {};
  state.fixes = state.fixes || {};
  if (!state.defaults) {
    const kind = opts.default_kind === "owner" || opts.default_kind === "seeker" ? opts.default_kind : "";
    const deal = opts.default_deal_type === "sale" || opts.default_deal_type === "rent" ? opts.default_deal_type : "";
    state.defaults = { kind, deal_type: deal };
  }
  if (job.status === "done") {
    return { ...outcome(currentDrafts(job), state), note: "הקובץ הזה כבר נקלט." };
  }

  const drafts = currentDrafts({ ...job, state });
  // אחת-אחת: קריאה לכל ליד, כדי שכפילות, כשל וליד שנקלט יתועדו כל אחד לעצמו
  for (const d of drafts) {
    const key = String(d.index);
    const prev = state.results[key]?.s;
    if (prev === "inserted" || prev === "duplicate" || prev === "skipped") continue;
    if (d.blank) { state.results[key] = { s: "skipped", why: "שורה ריקה" }; continue; }
    if (d.missing.length) { state.results[key] = { s: "pending" }; continue; }
    state.results[key] = await insertOne(supabase, agent.id, d);
  }

  const c = counts(state);
  await save(supabase, jobId, state, c.pending === 0);
  await notifyDone(supabase, agent.id, c);
  return outcome(drafts, state);
}

export async function answerLeadImport(
  supabase: SupabaseClient,
  agent: AgentLite,
  jobId: string,
  input: AnswerInput & { skip?: unknown; skip_all?: unknown },
): Promise<Row> {
  const loaded = await loadJob(supabase, agent.id, jobId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const job = loaded.job;
  const state: JobState = (job.state || {}) as JobState;
  state.results = state.results || {};
  state.fixes = state.fixes || {};
  const drafts = currentDrafts(job);
  const pendingNow = () => drafts.filter((d) => state.results![String(d.index)]?.s === "pending");
  const first = pendingNow()[0];
  if (!first) return { ...outcome(drafts, state), note: "אין שורות שמחכות לתשובה." };

  const key = String(first.index);
  if (input.skip_all === true) {
    for (const d of pendingNow()) state.results[String(d.index)] = { s: "skipped", why: "דולגה" };
  } else if (input.skip === true) {
    state.results[key] = { s: "skipped", why: "דולגה" };
  } else {
    const { draft, badPhone } = applyAnswer(first, input);
    state.fixes[key] = draft.fields;
    if (draft.missing.length) {
      drafts[first.index] = draft;
      await save(supabase, jobId, state, false);
      const q = question(draft, pendingNow().length,
        badPhone ? `המספר "${badPhone}" לא נראה כמו טלפון ישראלי. לבקש שוב.` : "");
      return { ...outcome(drafts, state), next: q, guidance: "השורה עדיין חסרה פרט. לשאול שוב על אותה שורה בלבד." };
    }
    state.results[key] = await insertOne(supabase, agent.id, draft);
  }

  const c = counts(state);
  await save(supabase, jobId, state, c.pending === 0);
  if (c.pending === 0) await notifyDone(supabase, agent.id, c);
  return outcome(drafts, state);
}
