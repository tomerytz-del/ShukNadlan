// ============================================================================
// csm-links.ts — הקישורים שגבריאלה שולחת בשם צוות ההטמעה (docs/csm-adoption.md,
// "קישורים לסוכנים")
//
// **רשימה סגורה ולא כתובת חופשית.** ההודעה יוצאת מהמספר של גבריאלה, שהסוכנים
// סומכים עליו; קישור שהמודל המציא או שהוקלד בטעות היה יוצא בשמנו. כל קישור כאן
// הוא דף אמיתי באתר או מסך ב-CRM (‏goto של NAV_GROUPS), ועוד שלושה אישיים:
// הדף של הסוכן/ת, דף המשרד, וצ'אט עם גבריאלה.
//
// ‏path ולא כתובת מלאה: מחוץ לחלון 24 השעות הקישור הוא סיומת הכפתור של תבנית
// ההתראות (‏WHATSAPP_NOTIFY_TEMPLATE, בסיס shuknadlan.co.il), ושם מותר רק נתיב
// באתר. טהור - בלי Deno - כדי שהבדיקה תרוץ ב-node (scripts/office_coach_test.ts).
// ============================================================================

export const SITE_BASE = "https://shuknadlan.co.il";
// המספר של גבריאלה - אותו מספר של ASSISTANT_WA_NUMBER ב-crm.js וב-csm-page.js
export const GABRIELA_WA = "972532494740";

export type CsmLink = { key: string; label: string; path: string; use: string; manager?: boolean };

export const CSM_LINKS: CsmLink[] = [
  // ה-CRM של הסוכן/ת - המסך שבו עושים את הפעולה
  { key: "crm", label: "הכניסה ל-CRM", path: "/crm", use: "כניסה ראשונה, או מי שלא מוצא/ת את הדרך" },
  { key: "crm_properties", label: "הנכסים שלי ב-CRM", path: "/crm?goto=accProperties", use: "הוספת נכס, עריכה ופרסום" },
  { key: "crm_clients", label: "הלקוחות שלי ב-CRM", path: "/crm?goto=accClients", use: "לקוח/ה חדש/ה והתאמות" },
  { key: "crm_leads", label: "הלידים שלי ב-CRM", path: "/crm?goto=accLeads", use: "פניות מהאתר ומהמספר הווירטואלי" },
  { key: "crm_agenda", label: "יומן ומשימות ב-CRM", path: "/crm?goto=accAgenda", use: "פגישות ותזכורות" },
  { key: "crm_agreements", label: "הסכמים ב-CRM", path: "/crm?goto=accAgreements", use: "הסכם תיווך וחתימה דיגיטלית" },
  { key: "crm_dashboard", label: "הדשבורד שלי", path: "/crm?goto=accMyDashboard", use: "מה עשיתי השבוע, זמן תגובה" },
  { key: "crm_profile", label: "הפרופיל שלי", path: "/crm?goto=accProfile", use: "תמונה, אודות, רישיון - מה שמופיע בדף הסוכן/ת" },
  { key: "crm_prefs", label: "ההגדרות שלי", path: "/crm?goto=accPrefs", use: "ערים, סוגי נכסים והעדפות לידים" },
  { key: "crm_notifications", label: "התראות והודעות", path: "/crm?goto=accNotifPrefs", use: "מה מגיע בוואטסאפ ומתי" },
  { key: "crm_gcal", label: "חיבור יומן Google", path: "/crm?goto=accGcal", use: "שהפגישות יופיעו ביומן Google" },
  { key: "crm_wallet", label: "מנוי וארנק", path: "/crm?goto=accWallet", use: "מסלול, תשלום וטעינת ארנק" },
  { key: "crm_calls", label: "שיחות ומספרים", path: "/crm?goto=accOfficeCalls", use: "מספר וירטואלי ויומן שיחות" },
  { key: "crm_team", label: "צוותים וסוכנים", path: "/crm?goto=accTeam", use: "הזמנת סוכנים למשרד ותפקידים", manager: true },
  { key: "crm_office_dashboard", label: "דאשבורד המשרד", path: "/crm?goto=accOfficeDashboard", use: "מה המנהל/ת רואה על הסוכנים", manager: true },
  { key: "crm_branding", label: "דף המשרד", path: "/crm?goto=accBranding", use: "עיצוב, לוגו ותמונת נושא של המשרד", manager: true },
  // האתר
  { key: "pricing", label: "המסלולים והמחירים", path: "/pricing", use: "השוואת מסלולים, מה כלול" },
  { key: "checkout", label: "רכישת מנוי", path: "/checkout", use: "מעבר למסלול בתשלום" },
  { key: "signup", label: "הרשמת משרד", path: "/agency-signup", use: "משרד או סוכן/ת שעוד לא נרשמו" },
  { key: "faq", label: "שאלות נפוצות", path: "/faq", use: "תשובות קצרות על המערכת" },
  { key: "home", label: "האתר", path: "/", use: "איך הנכסים נראים לגולשים" },
  { key: "agents", label: "המתווכים באתר", path: "/agents", use: "רשימת המתווכים" },
  { key: "agencies", label: "המשרדים באתר", path: "/agencies", use: "רשימת המשרדים" },
  { key: "prices", label: "מחירי דירות", path: "/prices", use: "נתוני שוק לפגישת גיוס" },
  { key: "deals", label: "עסקאות לפי יישוב", path: "/deals", use: "עסקאות אמיתיות לפגישת גיוס" },
  { key: "articles", label: "מבזקי נדל\"ן", path: "/articles", use: "תוכן לשיתוף" },
  { key: "professional_signup", label: "הרשמת בעלי מקצוע", path: "/professional-signup", use: "שמאי/ת, עו\"ד, משכנתאות" },
  // אישיים - נבנים מהכרטיס
  { key: "agent_page", label: "הדף שלך באתר", path: "/agent?slug={agent_slug}", use: "הדף הציבורי של הסוכן/ת" },
  { key: "agency_page", label: "דף המשרד באתר", path: "/agency?slug={agency_slug}", use: "הדף הציבורי של המשרד" },
  { key: "gabriela", label: "שיחה עם גבריאלה", path: "", use: "לשמור את המספר ולשלוח הודעה ראשונה" },
];

const BY_KEY = new Map(CSM_LINKS.map((l) => [l.key, l]));

export type LinkCtx = { agent_slug?: string | null; agency_slug?: string | null; role?: string | null };

/** הקישור לסוכן/ת. ‏null = מפתח לא מוכר, או דף אישי בלי slug. */
export function csmLinkFor(key: string, ctx: LinkCtx = {}): { key: string; label: string; url: string; path: string | null } | null {
  const l = BY_KEY.get(String(key || ""));
  if (!l) return null;
  if (l.key === "gabriela") {
    return { key: l.key, label: l.label, path: null,
      url: `https://wa.me/${GABRIELA_WA}?text=${encodeURIComponent("שלום גבריאלה")}` };
  }
  let path = l.path;
  if (path.includes("{agent_slug}")) {
    if (!ctx.agent_slug) return null;
    path = path.replace("{agent_slug}", encodeURIComponent(ctx.agent_slug));
  }
  if (path.includes("{agency_slug}")) {
    if (!ctx.agency_slug) return null;
    path = path.replace("{agency_slug}", encodeURIComponent(ctx.agency_slug));
  }
  return { key: l.key, label: l.label, path, url: SITE_BASE + path };
}

/** הרשימה למודל: מפתח, שם ולמה. מסכי מנהל/ת מסומנים. */
export function csmLinkCatalog(): Array<{ key: string; label: string; use: string; manager_only?: boolean }> {
  return CSM_LINKS.map((l) => ({ key: l.key, label: l.label, use: l.use, ...(l.manager ? { manager_only: true } : {}) }));
}

/** ההודעה לסוכן/ת: ממי, הטקסט שלה, והקישור. בלי מקף ארוך (הכלל ב-CLAUDE.md). */
export function csmOutreachText(staffName: string | null, message: string, link: { label: string; url: string } | null): string {
  const from = staffName ? `*הודעה מ${staffName}, צוות ההטמעה של שוק נדל"ן*` : `*הודעה מצוות ההטמעה של שוק נדל"ן*`;
  const body = String(message || "").trim().replace(/[–—]/g, "-");
  return [from, body, link ? `\n${link.label}: ${link.url}` : ""].filter(Boolean).join("\n").trim();
}
