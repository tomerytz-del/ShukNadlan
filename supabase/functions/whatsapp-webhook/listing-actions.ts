// פעולות הרסניות מוואטסאפ: מחיקת תמונה, ביטול הסכם, והנפקה מחדש.
// הכפתור נושא את המזהה. הכותרת לבדה אינה מספיקה. אין מחיקה בלי אישור.

export const IMAGE_DELETE_YES = "כן, למחוק";
export const IMAGE_DELETE_NO = "לא למחוק";
export const AGREEMENT_CANCEL_YES = "כן, לבטל";
export const AGREEMENT_CANCEL_NO = "להשאיר";
export const AGREEMENT_REISSUE_YES = "כן, הסכם חדש";
export const AGREEMENT_REISSUE_NO = "לא עכשיו";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const IMAGE_RE = new RegExp(`^imgd:(y|n):(${UUID})(?::([0-9.]+))?$`, "i");
const AGREEMENT_RE = new RegExp(`^ag(cx|rx):(y|n):(${UUID})$`, "i");

export interface OwnedRow {
  agent_id: string;
  agency_id?: string | null;
}

/** הסוכן/ת הוא/היא בעל/ת השורה, והמשרד לא השתנה מתחתיה. */
export function ownsRow(
  agent: { id: string; agency_id?: string | null },
  row: OwnedRow | null | undefined,
): boolean {
  if (!row || row.agent_id !== agent.id) return false;
  if (agent.agency_id && row.agency_id && agent.agency_id !== row.agency_id) return false;
  return true;
}

export function imagesAfterRemove(
  images: readonly string[],
  positions: readonly number[],
): { ok: true; next: string[]; removed: number } | { ok: false; error: string } {
  const n = images.length;
  if (!n) return { ok: false, error: "אין לנכס תמונות." };
  const drop = new Set<number>();
  for (const raw of positions) {
    const p = Number(raw);
    if (!Number.isInteger(p) || p < 1 || p > n) {
      return { ok: false, error: `יש לנכס ${n} תמונות. צריך מספר בין 1 ל-${n}.` };
    }
    drop.add(p);
  }
  if (!drop.size) return { ok: false, error: `צריך את מספרי התמונות למחיקה, בין 1 ל-${n}.` };
  const next = images.filter((_, i) => !drop.has(i + 1));
  return { ok: true, next, removed: n - next.length };
}

export function imageDeleteButtons(
  propertyId: string,
  positions: readonly number[],
): { id: string; title: string }[] | null {
  const pos = [...new Set(positions.map(Number))]
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= 99)
    .sort((a, b) => a - b)
    .slice(0, 12);
  if (!pos.length || !propertyId) return null;
  const yes = `imgd:y:${propertyId}:${pos.join(".")}`;
  const no = `imgd:n:${propertyId}`;
  if (yes.length > 200 || utf16len(IMAGE_DELETE_YES) > 20 || utf16len(IMAGE_DELETE_NO) > 20) return null;
  return [
    { id: yes, title: IMAGE_DELETE_YES },
    { id: no, title: IMAGE_DELETE_NO },
  ];
}

export function parseImageDeleteButton(buttonId: string): {
  yes: boolean;
  propertyId: string;
  positions: number[];
} | null {
  const m = IMAGE_RE.exec(String(buttonId || "").trim());
  if (!m) return null;
  const positions = m[3]
    ? m[3].split(".").map(Number).filter((n) => Number.isInteger(n) && n >= 1)
    : [];
  if (m[1].toLowerCase() === "y" && !positions.length) return null;
  return { yes: m[1].toLowerCase() === "y", propertyId: m[2], positions };
}

export function agreementConfirmButtons(
  action: "cancel" | "reissue",
  agreementId: string,
): { id: string; title: string }[] | null {
  if (!agreementId) return null;
  const prefix = action === "cancel" ? "agcx" : "agrx";
  const yesTitle = action === "cancel" ? AGREEMENT_CANCEL_YES : AGREEMENT_REISSUE_YES;
  const noTitle = action === "cancel" ? AGREEMENT_CANCEL_NO : AGREEMENT_REISSUE_NO;
  if (utf16len(yesTitle) > 20 || utf16len(noTitle) > 20) return null;
  return [
    { id: `${prefix}:y:${agreementId}`, title: yesTitle },
    { id: `${prefix}:n:${agreementId}`, title: noTitle },
  ];
}

export function parseAgreementButton(buttonId: string): {
  action: "cancel" | "reissue";
  yes: boolean;
  agreementId: string;
} | null {
  const m = AGREEMENT_RE.exec(String(buttonId || "").trim());
  if (!m) return null;
  return {
    action: m[1].toLowerCase() === "cx" ? "cancel" : "reissue",
    yes: m[2].toLowerCase() === "y",
    agreementId: m[3],
  };
}

export function reissueBlockedKind(kind: string): string | null {
  if (String(kind || "").startsWith("marketing_")) {
    return "את טופס ההסכמה לשיווק לא מנפיקים לבד. מנפיקים מחדש את הבלעדיות, וההסכמה נוצרת איתו.";
  }
  return null;
}

const BASES = new Set(["price", "monthly", "yearly", "flat"]);

export interface ReissueSource {
  kind: string;
  client_ids?: string[] | null;
  property_ids?: string[] | null;
  commission_pct?: number | null;
  commission_amount?: number | null;
  commission_note?: string | null;
  exclusive_from?: string | null;
  exclusive_until?: string | null;
  notes?: string | null;
}

export interface ReissueSigner {
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  ord?: number | null;
  client_id?: string | null;
}

/** שדות ל-prepare_agreement. הערכים שהסוכן/ת תיקן/ה גוברים על מה שנשמר. */
export function reissuePrepareInput(
  row: ReissueSource,
  signers: readonly ReissueSigner[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> | { error: string } {
  const blocked = reissueBlockedKind(row.kind);
  if (blocked) return { error: blocked };
  const clientId = String(
    overrides.client_id || row.client_ids?.[0] || signers.find((s) => s.client_id)?.client_id || "",
  );
  if (!clientId) return { error: "אין לקוח/ה על ההסכם, אי אפשר להוציא חדש." };
  const propertyIds = Array.isArray(overrides.property_ids) && overrides.property_ids.length
    ? overrides.property_ids
    : (row.property_ids || []);
  if (!propertyIds.length) return { error: "אין נכס על ההסכם, אי אפשר להוציא חדש." };
  const extras = signers
    .filter((s) => Number(s.ord) > 0 && String(s.full_name || "").trim())
    .map((s) => ({
      full_name: String(s.full_name).trim(),
      phone: s.phone || undefined,
      email: s.email || undefined,
    }));
  const basis = BASES.has(String(row.commission_note || "")) ? String(row.commission_note) : undefined;
  return {
    kind: row.kind,
    client_id: clientId,
    property_ids: propertyIds,
    commission_pct: overrides.commission_pct ?? row.commission_pct ?? undefined,
    commission_amount: overrides.commission_amount ?? row.commission_amount ?? undefined,
    commission_basis: overrides.commission_basis ?? basis,
    exclusive_from: overrides.exclusive_from ?? row.exclusive_from ?? undefined,
    exclusive_until: overrides.exclusive_until ?? row.exclusive_until ?? undefined,
    notes: overrides.notes ?? row.notes ?? undefined,
    client_email: overrides.client_email || undefined,
    in_person_only: overrides.in_person_only === true ? true : undefined,
    extra_signers: extras.length ? extras : undefined,
    force_new: true,
  };
}

function utf16len(s: string): number {
  return [...s].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
}
