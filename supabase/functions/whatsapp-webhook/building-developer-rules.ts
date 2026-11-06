// החלטות בלי מסד ובלי וואטסאפ. אותם כללים ב-
// 20271106100000_building_projects.sql. הבדיקה: scripts/building_developer_test.ts

export const DEVELOPER_UNKNOWN_TITLE = "לא יודע";

const UNKNOWN_ANSWERS = new Set([
  "לא יודע",
  "לא יודעת",
  "לא ידוע",
  "אין לי מושג",
  "לא מכיר",
  "לא מכירה",
]);

const NEW_CONDITIONS = new Set(["new_from_contractor", "new"]);
const PROJECT_STATUSES = new Set([
  "planning",
  "permit_requested",
  "permit_issued",
  "construction_complete",
]);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BUTTON_RE = new RegExp(`^bdev:u:(${UUID})$`, "i");

export type DeveloperVerification = "unverified" | "verified" | "conflict";
export type DeveloperSource = "web" | "agent" | "municipality" | "manual";

export interface DeveloperRow {
  developer_company: string | null;
  verification_status: DeveloperVerification;
  source_type: DeveloperSource;
  source_note: string | null;
  partners: string[];
}

export function companyKey(name: string | null | undefined): string {
  return String(name || "").replace(/\s+/g, " ").trim();
}

export function isUnknownDeveloperAnswer(text: string | null | undefined): boolean {
  const t = companyKey(text).replace(/[?.!]+$/g, "").trim();
  return UNKNOWN_ANSWERS.has(t);
}

/** רווחים בלבד. בלי קירוב של שם רחוב ובלי מחיקת מספר בית. */
export function buildingAddressKey(text: string | null | undefined): string | null {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t || null;
}

export function propertyAddressKey(
  street?: string | null,
  house?: string | null,
  address?: string | null,
): string | null {
  const joined = [companyKey(street), companyKey(house)].filter(Boolean).join(" ");
  return buildingAddressKey(joined || address || "");
}

export function addressLinkable(key: string | null | undefined): boolean {
  return !!key && /[0-9]/.test(key);
}

export function isNewConstruction(
  condition?: string | null,
  projectStatus?: string | null,
): boolean {
  if (NEW_CONDITIONS.has(String(condition || ""))) return true;
  return PROJECT_STATUSES.has(companyKey(projectStatus));
}

export function shouldEnqueueDeveloperAsk(input: {
  enabled: boolean;
  condition?: string | null;
  projectStatus?: string | null;
  addressKey: string | null;
  knownDeveloper: boolean;
  alreadyPrompted: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (!isNewConstruction(input.condition, input.projectStatus)) return false;
  if (!addressLinkable(input.addressKey)) return false;
  if (input.knownDeveloper) return false;
  if (input.alreadyPrompted) return false;
  return true;
}

/** חלון השליחה של הסוכנים, וחלון 24 השעות של Meta. שניהם נדרשים. */
export function shouldSendDeveloperAsk(input: {
  windowOpen: boolean;
  within24h: boolean;
}): boolean {
  return input.windowOpen && input.within24h;
}

export function applyDeveloperClaim(
  row: DeveloperRow,
  claim: {
    company: string;
    source_type: DeveloperSource;
    source_note?: string | null;
    partners?: string[];
  },
): { row: DeveloperRow; action: "set" | "same" | "conflict" | "ignored" } {
  const next = companyKey(claim.company);
  if (!next || isUnknownDeveloperAnswer(next)) return { row, action: "ignored" };
  const current = companyKey(row.developer_company);
  if (!current) {
    return {
      action: "set",
      row: {
        ...row,
        developer_company: next,
        source_type: claim.source_type,
        source_note: claim.source_note ?? row.source_note,
        verification_status: row.verification_status === "conflict" ? "conflict" : "unverified",
        partners: row.partners.length ? row.partners : (claim.partners || []),
      },
    };
  }
  if (current === next) {
    return {
      action: "same",
      row: {
        ...row,
        partners: row.partners.length ? row.partners : (claim.partners || row.partners),
      },
    };
  }
  const note = row.source_note || "";
  const extra = `התנגשות: ${next} (${claim.source_type})`;
  return {
    action: "conflict",
    row: {
      ...row,
      developer_company: row.developer_company,
      source_type: row.source_type,
      verification_status: "conflict",
      source_note: note.includes(extra) ? note : (note ? `${note} ${extra}` : extra),
    },
  };
}

export function exactProjectMatch<T extends { addresses: string[]; city: string }>(
  projects: T[],
  city: string,
  key: string | null,
): T | "none" | "many" {
  if (!addressLinkable(key)) return "none";
  const cityKey = companyKey(city);
  const hits = projects.filter((p) =>
    companyKey(p.city) === cityKey &&
    p.addresses.some((a) => buildingAddressKey(a) === key)
  );
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) return "none";
  return "many";
}

export function developerUnknownButton(promptId: string): { id: string; title: string } {
  return { id: `bdev:u:${promptId}`, title: DEVELOPER_UNKNOWN_TITLE };
}

export function parseDeveloperUnknownButton(id: string | null | undefined): string | null {
  const m = BUTTON_RE.exec(String(id || ""));
  return m ? m[1] : null;
}

export function developerAskBody(addressLabel: string): string {
  const where = companyKey(addressLabel) || "הזה";
  return `בבניין ${where} לא רשומה חברה יזמית. איזו חברה בנתה את הפרויקט? כתבו את השם, או לחצו לא יודע.`;
}

export function developerVerificationPhrase(verification: string | null | undefined): string {
  if (verification === "verified") return "הנתון אומת";
  if (verification === "conflict") return "יש סתירה בין מקורות, והשם לא הוחלף";
  return "הנתון לא אומת";
}

export function developerSpeech(info: {
  found?: boolean;
  ambiguous?: boolean;
  company?: string | null;
  partners?: string[] | null;
  source_label?: string | null;
  verification?: string | null;
  house_number_required?: boolean;
} | null | undefined): string {
  if (!info || info.house_number_required) {
    return "כדי לומר מי בנה את הבניין צריך מספר בית. אני לא מנחשת לפי שם הרחוב.";
  }
  if (info.ambiguous) {
    return "יש יותר מפרויקט אחד בכתובת הזו, ואני לא בוחרת ביניהם.";
  }
  const company = companyKey(info.company);
  if (!info.found || !company) {
    return "אין לי חברה יזמית רשומה לבניין הזה. אני לא מנחשת.";
  }
  const partners = (info.partners || []).map((p) => companyKey(p)).filter(Boolean);
  const partnerBit = partners.length ? ` שותפים: ${partners.join(", ")}.` : "";
  const source = companyKey(info.source_label) || "לא צוין";
  return `החברה היזמית הרשומה היא ${company}.${partnerBit} מקור: ${source}. ${developerVerificationPhrase(info.verification)}.`;
}

export function developerAskHasVisibleUrl(body: string): boolean {
  return /https?:\/\/|www\.|wa\.me/i.test(body);
}
