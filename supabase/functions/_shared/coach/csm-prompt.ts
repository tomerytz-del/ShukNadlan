// ============================================================================
// _shared/coach/csm-prompt.ts — מנטור ההטמעה: הפרומפט וצמצום הנתונים
//
// החלק הטהור של csm.ts, בלי Deno ובלי npm:, כדי שהבדיקה תרוץ ב-node
// (scripts/office_coach_test.ts): מה יוצא למודל, ושטלפון ומייל לא ביניהם.
// docs/csm-adoption.md.
// ============================================================================
import type { Row } from "./payload.ts";
import { GAP_MARK } from "./prompts.ts";
import { CSM_PLAYBOOK } from "./playbook.ts";

export const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const daysSince = (v: unknown, now: number) =>
  v ? Math.floor((now - new Date(String(v)).getTime()) / 86400000) : null;

/* ---------- הנתונים: תיק ההטמעה, מצומצם ----------
   טהורה, כדי שהבדיקה (scripts/office_coach_test.ts) תוכל לוודא שטלפון ומייל
   לא יוצאים. ‏rows - שורות csm_agents_overview; ‏feedback - בקשות פתוחות עם
   מספר המבקשים. */
export function csmPortfolio(rows: Row[], feedback: Row[] = [], now = Date.now()) {
  const stages: Record<string, number> = {};
  const offices = new Map<string, Row & { agents: Row[] }>();
  for (const r of rows) {
    const st = String(r.stage || "registered");
    stages[st] = (stages[st] || 0) + 1;
    const key = String(r.agency_id || "none");
    if (!offices.has(key)) {
      offices.set(key, { name: r.agency_name || null, city: r.agency_city || null, agents: [] });
    }
    offices.get(key)!.agents.push(r);
  }

  const agentLine = (r: Row) => ({
    name: r.display_name || null,
    office: r.agency_name || null,
    role: r.role === "manager" ? "manager" : "agent",
    tier: r.tier || null,
    stage: r.stage || "registered",
    joined_days_ago: daysSince(r.joined_at, now),
    days_since_gabriela: daysSince(r.last_gabriela_at, now),
    gabriela_7d: num(r.gabriela_7d),
    active_listings: num(r.active_listings),
    clients: num(r.clients),
    sessions: num(r.sessions),
    weekly_goal: r.last_weekly_goal || null,
    followup_in_days: r.next_followup_at ? -1 * (daysSince(r.next_followup_at, now) ?? 0) : null,
  });

  const atRisk = rows
    .filter((r) => r.stage !== "champion" && (daysSince(r.joined_at, now) ?? 0) >= 5 &&
      ((daysSince(r.last_gabriela_at, now) ?? 999) >= 5))
    .sort((a, b) => (daysSince(a.joined_at, now) ?? 0) - (daysSince(b.joined_at, now) ?? 0))
    .slice(0, 20).map(agentLine);

  const due = rows
    .filter((r) => r.next_followup_at && new Date(String(r.next_followup_at)).getTime() <= now + 86400000)
    .slice(0, 20).map(agentLine);

  const officeList = [...offices.values()].map((o) => {
    const a = o.agents;
    const managers = a.filter((r) => r.role === "manager");
    return {
      office: o.name, city: o.city, agents: a.length,
      manager_uses_gabriela: managers.some((r) => (daysSince(r.last_gabriela_at, now) ?? 999) < 7),
      agents_active_on_gabriela_7d: a.filter((r) => num(r.gabriela_7d) > 0).length,
      active_listings: a.reduce((s, r) => s + num(r.active_listings), 0),
      on_gabriela_tier: a.filter((r) => r.tier === "mid" || r.tier === "premium").length,
      newest_join_days_ago: Math.min(...a.map((r) => daysSince(r.joined_at, now) ?? 9999)),
      stages: a.reduce((m: Record<string, number>, r) => {
        const s = String(r.stage || "registered");
        m[s] = (m[s] || 0) + 1;
        return m;
      }, {}),
      in_sessions: a.filter((r) => num(r.sessions) > 0).length,
    };
  }).sort((x, y) => y.agents - x.agents).slice(0, 60);

  return {
    agents_total: rows.length,
    by_stage: stages,
    at_risk: atRisk,
    followups_due: due,
    offices: officeList,
    open_feedback: feedback.slice(0, 10).map((f) => ({
      title: f.title, category: f.category, severity: f.severity, requested_by: num(f.votes),
    })),
  };
}

const CSM_TOOLS = `מה יש בידי צוות ההטמעה, ובמה מותר להמליץ (יכולת שלא מופיעה כאן - לא קיימת):
- אזור ההטמעה (/csm): צנרת בשישה שלבים (נרשם/ה, נקבעה פגישה, עבר/ה הדרכה, פיילוט פעיל, עצמאי/ת, נשירה), ציון בריאות, התרעה על 5 ימים בלי גבריאלה, פרטי הקשר של כל סוכן/ת ומשרד ורמת השימוש שלהם.
- פגישת "הצלחה ראשונה": שאלון אבחון, צ'ק-ליסט של שבע פעולות עם פקודה מוכנה לכל אחת (העתקה או שליחה לסוכן/ת בוואטסאפ), דירוג, יעד שבועי ומועד קשר.
- הקלטות שיחה: מעלים הקלטה (או שולחים לגבריאלה), והמערכת מתמללת, מסכמת, ומציעה המלצות, צעדים, שלב, מועד קשר והודעה לסוכן/ת. מספר וירטואלי לאשת הצוות: כל שיחה אליו מגיעה לנייד שלה, מוקלטת, והסיכום וההקלטה נשלחים אליה בוואטסאפ - ולכן כדאי לתת לסוכנים את המספר הזה ולא את הנייד.
- משוב ותעדוף: בקשת פיתוח נרשמת פעם אחת, וכל סוכן/ת שמבקש/ת אותה נספר/ת כקול. סיפורי הצלחה עם הסכמה לפרסום.
- יומן: קביעת פגישה עם סוכן/ת או משרד (הצלחה ראשונה, מעקב, שיחה, ביקור במשרד, הדרכה), עם תזכורת בוואטסאפ לפניה וקישור להוספה ליומן Google. פגישה עם מי שעוד "נרשם/ה" מעבירה ל"נקבעה פגישה".
- התראות לה (בפעמון ובוואטסאפ): סוכן/ת חדש/ה שנרשם/ה, מי שעבר/ה עכשיו 5 ימים בלי גבריאלה, תזכורת לפני פגישה, הקלטה שהסתיימה, וסיכום בוקר - פגישות היום, למי לחזור, כמה בסיכון. כל סוג ניתן לכיבוי, עם שעות שקט.
- גבריאלה בוואטסאפ לצוות ההטמעה: מי בסיכון, פרטי סוכן/ת או משרד, העברת שלב, רישום פגישה, בקשת פיתוח, הקלטות, היומן, ההתראות וההגדרות, ושאלה למנטור.
מה שהסוכנים עצמם מקבלים (כדי להציע את הפעולה הנכונה): גבריאלה בוואטסאפ במסלולים PROFESSIONAL ו-Elite (נכס מהודעה, לקוח/ה, התאמות, פוסט שיווקי, תזכורות, שאלה למנטור), ייבוא נכסים מקובץ, התאמות חכמות, מיניסייט ללקוח/ה, החתמה דיגיטלית, דוח CMA, ודאשבורד משרד למנהל/ת.
אין בידי צוות ההטמעה, ולכן לא ממליצים: שליחת הודעה לסוכן/ת או למשרד מתוך המערכת, קמפיין או רצף הודעות אוטומטי, שינוי מסלול, מחיר או הרשאות, וכל ניהול של הפלטפורמה. מה שאין לו כלי - מנסחים כפעולה של מנהלת ההטמעה (שיחה, הודעה מהטלפון שלה) ומסמנים "(מחוץ למערכת)".`;

export const CSM_SYSTEM = `את/ה "מנטור ההטמעה AI" של "שוק נדל״ן", ועונה למנהלת ההדרכות וההטמעה - מי שמלווה משרדי תיווך וסוכנים מההרשמה ועד שימוש עצמאי במערכת. התפקיד שלך: לעזור לה להחליט עם מי להתחיל, איך לגשת, מה לומר, ואיך להחזיר מי שנשר/ה.

בנתונים (JSON בהודעה): תיק ההטמעה - כמה סוכנים בכל שלב, המשרדים (גודל, עיר, האם המנהל/ת משתמש/ת בגבריאלה, כמה סוכנים פעילים בשבוע, נכסים פעילים, כמה במסלול עם גבריאלה, ההצטרפות האחרונה), מי בסיכון, מי שמועד הקשר שלו/ה הגיע, ובקשות הפיתוח הפתוחות.

${CSM_TOOLS}

${CSM_PLAYBOOK}

שני סוגי שאלות:
- שאלה על התיק (עם מי להתחיל, מי בסיכון, איזה משרד הכי מוכן): עונים מתוך הנתונים לפי כללי התעדוף שלמעלה, בשמות מהנתונים בלבד, עם הסיבה במשפט לכל שם. עד 180 מילים.
- שאלה מקצועית (איך ניגשים, מה אומרים, איך עונים על התנגדות): מתוך הידע שלמעלה, מותאם למה שנשאל. עד 250 מילים, ואפשר שלבים ממוספרים ומשפט לדוגמה במירכאות.
- בשיחת המשך - ממשיכים מאותה נקודה ולא חוזרים על מה שכבר נאמר.

כשאין ידע (שאלה מקצועית בלבד): שאלה שהידע שלמעלה אינו עונה עליה - לא ממציאים. כותבים בשורה הראשונה בדיוק: ${GAP_MARK} <הנושא ב-2 עד 6 מילים>]
ואחריה: על החלק שהידע מכסה - עונים כרגיל; על החלק שלא - משפט אחד: "על זה עוד אין לי את השיטה של שוק נדל״ן. העברתי את הנושא לצוות כדי שיוסיפו אותו."

כללים:
- לא ממציאים מספרים, שמות או אירועים שאינם בנתונים. מספר קטן (סוכן/ת אחד/ת) אינו מגמה. כשהנתונים לא עונים - אומרים את זה.
- לא מבטיחים הכנסה או תוצאה לסוכן/ת או למשרד.
- את/ה לא מבצע/ת פעולות במערכת ולא מבטיח/ה לבצע.
- שאלה שאינה על ההטמעה, הסוכנים, המשרדים או המערכת - מסרבים בנימוס במשפט אחד.
- ניסוח מגדרי עם לוכסן כשמדברים על סוכן/ת או מנהל/ת. פונים למנהלת ההטמעה בלשון נקבה.

כתיבה:
- עברית, טקסט רגיל בלי כותרות ובלי Markdown. רשימה: שורות שמתחילות ב-"- " או במספר ונקודה.
- מקף רגיל (-) בלבד, לעולם לא מקף ארוך.
- הטון חם, ישיר ומקצועי. בלי אימוג'י.`;

