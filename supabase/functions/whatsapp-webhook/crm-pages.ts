// קישור ישיר לעמוד ב-CRM, כשאין כלי שעושה את הפעולה מכאן.
// הנתיבים זהים ל-ACC_BY_TYPE ב-notification-push ול-handleGotoParam ב-crm.js.

export interface PageLinkInput {
  topic?: unknown;
  agreement_id?: unknown;
  property_id?: unknown;
  client_id?: unknown;
  lead_id?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(v: unknown): string | null {
  const s = String(v ?? "");
  return UUID.test(s) ? s : null;
}

export interface PageLink {
  topic: string;
  path: string;
  /** המשפט שהמודל מעתיק לסוכן/ת, בלי כתובת ובלי "היכנסו לדשבורד". */
  say: string;
  /** נפתח ככפתור. לא נכתב בתוך say. */
  url: string;
}

const TOPICS = [
  "agreements", "property", "client", "showcase", "agenda", "google_calendar",
  "leads", "notifications", "marketing", "import", "home",
] as const;

export function pageLink(siteBase: string, input: PageLinkInput): PageLink | null {
  const site = siteBase.replace(/\/$/, "");
  if (!site) return null;
  const topic = String(input.topic || "");
  const agreement = id(input.agreement_id);
  const property = id(input.property_id);
  const client = id(input.client_id);
  const lead = id(input.lead_id);

  let path = "/crm";
  let say = "אפשר להמשיך מכאן:";
  switch (topic) {
    case "agreements":
      path = agreement
        ? `/crm?goto=accAgreements&agreement=${agreement}`
        : "/crm?goto=accAgreements";
      say = "ביטול או תיקון נוסח של הסכם שכבר ננעל נעשה בעמוד ההסכם:";
      break;
    case "property":
      path = property ? `/crm?goto=accProperties&property=${property}` : "/crm?goto=accProperties";
      say = "עריכת הנכס נפתחת כאן:";
      break;
    case "client":
    case "showcase":
      path = client ? `/crm?goto=accClients&client=${client}` : "/crm?goto=accClients";
      say = topic === "showcase"
        ? "המיניסייט של הלקוח/ה נפתח מהכרטיס:"
        : "כרטיס הלקוח/ה נפתח כאן:";
      break;
    case "agenda":
      path = "/crm?goto=accAgenda";
      say = "היומן נפתח כאן:";
      break;
    case "google_calendar":
      path = "/crm?goto=accAgenda";
      say = "חיבור יומן Google הוא אישור חד-פעמי, והוא נעשה מכאן:";
      break;
    case "leads":
      path = lead ? `/crm?goto=accLeads&lead=${lead}` : "/crm?goto=accLeads";
      say = "הליד נפתח כאן:";
      break;
    case "notifications":
      path = "/crm?goto=accNotifPrefs";
      say = "הגדרות ההתראות בוואטסאפ נפתחות כאן:";
      break;
    case "marketing":
      path = property ? `/crm?goto=accProperties&property=${property}` : "/crm?goto=accProperties";
      say = "פרסום לפייסבוק או עדכון המודעה נפתח מכרטיס הנכס:";
      break;
    case "import":
      path = "/crm?goto=accProperties";
      say = "אפשר גם לשלוח לי לכאן קובץ אקסל (כולל קובץ מיד2), או לייבא מהעמוד הזה:";
      break;
    case "home":
      path = "/crm";
      say = "האזור האישי נפתח כאן:";
      break;
    default:
      return null;
  }
  return { topic, path, say, url: `${site}${path}` };
}

/** הכתובת מתוך המשפט. http ו-https, לא רק https. */
export function urlInSay(say: string): string {
  const https = say.lastIndexOf("https://");
  const http = say.lastIndexOf("http://");
  const i = Math.max(https, http);
  return i >= 0 ? say.slice(i) : say;
}

export function pageLinkTopics(): readonly string[] {
  return TOPICS;
}
