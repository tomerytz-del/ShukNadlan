// שיתוף דף המשרד בפייסבוק. גבריאלה אינה מפרסמת: היא שולחת כפתור
// לדף הציבורי, והסוכן/ת פותח/ת ומשתף/ת בעצמו/ה.
//
// הכתובת היא csmLinkFor("agency_page") - אותו בונה של הדף הציבורי
// (/agency?slug=, עם encodeURIComponent ל-slug עברי). הכפתור יוצא
// דרך modelLink, שמגיע ל-sendCtaUrl (interactive · cta_url).
// בגוף אין כתובת ואין טלפון.

import { BUTTON_TITLE_MAX } from "../_shared/agent-deep-link.ts";
import { csmLinkFor } from "./csm-links.ts";

/** כותרת הכפתור. 20 יחידות UTF-16, כמו sendCtaUrl. */
export const OFFICE_SHARE_LABEL = "🏢 דף המשרד";

/** גוף ההודעה האינטראקטיבית. בלי כתובת, בלי טלפון, ובלי טענה שפורסם. */
export const OFFICE_SHARE_BODY =
  "לשיתוף בפייסבוק: פותחים את הדף, לוחצים שיתוף, ובוחרים פרופיל אישי, דף פייסבוק או קבוצה.";

export const OFFICE_SHARE_BUTTON_GUIDANCE =
  "כתוב/י משפט אחד: הכפתור פותח את דף המשרד, והשיתוף בפייסבוק נעשה מהדף. " +
  "אל תכתבי כתובת או טלפון, ואל תאמרי שפרסמת או ששלחת.";

export const OFFICE_SHARE_MISS_GUIDANCE =
  "כתוב/י את say כמו שהוא. בלי כתובת, בלי לנחש דף, ובלי \"אני לא יכולה\". אל תאמרי שפרסמת.";

export type OfficeShareReason = "no_agency" | "no_page" | "not_live" | "unknown";

const SAY: Record<OfficeShareReason, string> = {
  no_agency: "אין משרד משויך לחשבון, ולכן אין דף משרד לשתף. אם המשרד עוד לא נפתח, אפשר להירשם ואז לשתף.",
  no_page: "למשרד אין עדיין דף ציבורי באתר, אז אין מה לשתף. אפשר להשלים את פרטי המשרד באזור האישי.",
  not_live: "דף המשרד עדיין לא מוצג באתר, כי הרישיון לא אושר. אחרי האישור אפשר לשתף אותו בפייסבוק.",
  unknown: "לא הצלחתי לבדוק עכשיו אם דף המשרד מוצג. אפשר לנסות שוב בעוד רגע.",
};

export function officeShareSay(reason: OfficeShareReason): string {
  return SAY[reason];
}

export function officeShareLabelFits(label: string): boolean {
  return label.length <= BUTTON_TITLE_MAX && Array.from(label).length <= BUTTON_TITLE_MAX;
}

/** הכתובת הציבורית, או null כשאין slug. לא ממציאים דף. */
export function officePageUrl(slug: unknown): string | null {
  const s = String(slug ?? "").trim();
  if (!s || !officeShareLabelFits(OFFICE_SHARE_LABEL)) return null;
  return csmLinkFor("agency_page", { agency_slug: s })?.url ?? null;
}

export type OfficeShareDecision =
  | { kind: "share"; url: string; label: string; body: string }
  | { kind: "explain"; reason: OfficeShareReason; say: string };

/**
 * מה לשלוח. lookup error או agency_is_live שנכשל = הסבר, לא כתובת.
 * דף שאינו באוויר (רישיון) גם הוא הסבר: הקישור הציבורי לא נפתח לגולש/ת.
 */
export function officeShareDecision(input: {
  agencyId: unknown;
  /** null = השאילתה נכשלה. מחרוזת (גם ריקה) = יש שורה. */
  slug: unknown;
  lookupFailed?: boolean;
  live: boolean | "error";
}): OfficeShareDecision {
  const agencyId = typeof input.agencyId === "string" ? input.agencyId.trim() : "";
  if (!agencyId) return { kind: "explain", reason: "no_agency", say: SAY.no_agency };
  if (input.lookupFailed) return { kind: "explain", reason: "unknown", say: SAY.unknown };
  const url = officePageUrl(input.slug);
  if (!url) return { kind: "explain", reason: "no_page", say: SAY.no_page };
  if (input.live === "error") return { kind: "explain", reason: "unknown", say: SAY.unknown };
  if (input.live !== true) return { kind: "explain", reason: "not_live", say: SAY.not_live };
  return { kind: "share", url, label: OFFICE_SHARE_LABEL, body: OFFICE_SHARE_BODY };
}
