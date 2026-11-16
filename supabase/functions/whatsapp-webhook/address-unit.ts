// כתובת משותפת לבניין: רחוב ומספר בית אינם יחידה.
//
// מודעה פעילה באותו רחוב ומספר בית חוסמת עדכון כתובת כשאין מה שמפריד
// בין שתי יחידות (קומה או מספר משרד). גבריאלה שואלת את המספר, לא ממלאת
// אותו. מספר שונה עובר. אותו מספר, או היעדר מספר, נשאר חסום.
// הטריגר properties_guard_duplicate אוכף את אותו כלל במסד.

export interface UnitAddress {
  floor: number | null;
  unit: string | null;
}

export interface ListedUnit extends UnitAddress {
  listing_number?: number | null;
}

export type ShareStop =
  | {
    ok: false;
    needs_unit: true;
    error: string;
    say: string;
    guidance: string;
    listing_number: number | null;
  }
  | {
    ok: false;
    blocked: true;
    same_unit: true;
    error: string;
    say: string;
    guidance: string;
    listing_number: number | null;
  };

/** המשפט שהסוכן/ת שומע/ת כשחסר מספר. בלי טלפון ובלי כתובת אתר. */
export const UNIT_ASK_SAY =
  "בכתובת הזו כבר יש מודעה. כדי לשמור משרד אחר באותו בניין צריך מספר קומה או מספר משרד. מה המספר?";

export const UNIT_ASK_GUIDANCE =
  "הכתובת לא נשמרה. אמרי את say כמו שהוא. אל תנחשי מספר ואל תמלאי 1 או כל ברירת מחדל. " +
  "אחרי שהסוכן/ת עונה, קראי שוב לאותו כלי עם floor (אם נאמרה קומה) או unit_label (אם נאמר מספר משרד או יחידה), בדיוק כפי שנאמר. " +
  "אל תאמרי שהכתובת השתנתה. אין למסור טלפון ואין לכתוב כתובת אתר.";

export const UNIT_BLOCK_SAY =
  "הכתובת הזו, עם אותה קומה ואותו מספר משרד, כבר מפורסמת. לא שמרתי אותה.";

export const UNIT_BLOCK_GUIDANCE =
  "אל תנסי שוב בלי מספר אחר. force_new לא עוקף את זה. אין למסור טלפון ואין לכתוב כתובת אתר.";

export function floorOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

/** אותו נירמול של property_text_key: רווחים, גרשיים ופיסוק אינם מספר אחר. */
export function normUnit(value: unknown): string | null {
  const s = String(value ?? "")
    .replace(/["'׳״,.\-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return s || null;
}

export function cleanUnitLabel(value: unknown): string | null {
  const s = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return s || null;
}

/**
 * אותו רחוב ומספר בית כבר סוננו על ידי הקורא.
 * בלי קומה ובלי מספר משרד: שואלים, לא שומרים.
 * קומה ומספר שזהים למודעה קיימת: חסימה.
 * קומה או מספר שונים: מותר.
 */
export function sharedBuildingDecision(
  incoming: UnitAddress,
  existing: ListedUnit[],
): "allow" | "ask" | "block" {
  if (!existing.length) return "allow";
  const floor = floorOrNull(incoming.floor);
  const unit = normUnit(incoming.unit);
  if (floor === null && unit === null) return "ask";
  const same = existing.some((row) =>
    floorOrNull(row.floor) === floor && normUnit(row.unit) === unit
  );
  return same ? "block" : "allow";
}

export function shareStop(incoming: UnitAddress, existing: ListedUnit[]): ShareStop | null {
  const kind = sharedBuildingDecision(incoming, existing);
  if (kind === "allow") return null;
  if (kind === "ask") {
    return {
      ok: false,
      needs_unit: true,
      error: UNIT_ASK_SAY,
      say: UNIT_ASK_SAY,
      guidance: UNIT_ASK_GUIDANCE,
      listing_number: listingOf(existing[0]),
    };
  }
  const floor = floorOrNull(incoming.floor);
  const unit = normUnit(incoming.unit);
  const match = existing.find((row) =>
    floorOrNull(row.floor) === floor && normUnit(row.unit) === unit
  );
  return {
    ok: false,
    blocked: true,
    same_unit: true,
    error: UNIT_BLOCK_SAY,
    say: UNIT_BLOCK_SAY,
    guidance: UNIT_BLOCK_GUIDANCE,
    listing_number: listingOf(match || existing[0]),
  };
}

function listingOf(row: ListedUnit | undefined): number | null {
  const n = Number(row?.listing_number);
  return Number.isFinite(n) ? n : null;
}

/** הכתובת שנשמרת, עם הקומה ומספר המשרד שנאמרו. בלי מספר לא מוסיפים כלום. */
export function composeAddress(
  street: unknown,
  house: unknown,
  floor: unknown,
  unit: unknown,
): string | null {
  const head = [street, house].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");
  const floorN = floorOrNull(floor);
  const unitText = cleanUnitLabel(unit);
  const tail: string[] = [];
  if (floorN !== null) tail.push(`קומה ${floorN}`);
  if (unitText) tail.push(unitText);
  const full = [head, ...tail].filter(Boolean).join(", ");
  return full || null;
}
