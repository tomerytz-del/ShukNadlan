// כתובת משותפת לבניין: רחוב ומספר בית אינם יחידה.
//
// מודעה פעילה באותו רחוב ומספר בית חוסמת עדכון כתובת כשאין מה שמפריד
// בין שתי יחידות (קומה או מספר משרד). גבריאלה שואלת את המספר, לא ממלאת
// אותו. מספר שונה עובר. אותו מספר, או היעדר מספר, נשאר חסום.
// הטריגר properties_guard_duplicate אוכף את אותו כלל במסד.

export interface UnitAddress {
  floor: number | null;
  unit: string | null;
  /** כמו property_dedupe_key: null אינו שווה למספר. */
  rooms?: number | null;
  /** sale / rent. ריק אינו שווה לעסקה שנאמרה. */
  deal?: string | null;
  /** מסחרי בלי חדרים: משרד בבניין, לא דירה. */
  commercial?: boolean;
}

export interface ListedUnit extends UnitAddress {
  listing_number?: number | null;
  /** false = משרד אחר. חסר = אותו משרד (הקוראים הישנים). */
  sameOffice?: boolean;
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
  }
  | {
    ok: false;
    blocked: true;
    elsewhere: true;
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

/** משרד אחר באותה כתובת. בלי שם ובלי הזמנה להמציא מספר. */
export const UNIT_ELSEWHERE_SAY =
  "הנכס כבר מפורסם במערכת. אפשר לפרסם אותו רק עם הסכם בלעדיות חתום.";

export const UNIT_ELSEWHERE_GUIDANCE =
  "אמרי את say כמו שהוא. אל תציעי למלא מספר משרד או קומה כדי לעקוף, ואל תמסרי שם, טלפון או כתובת אתר.";

export function floorOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

/** מספר בית: '25א' ו-'25 א' הם אותו בית. רווחים אינם הבדל. */
export function houseCompact(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").trim().toLowerCase();
}

export function sameHouseNumber(a: unknown, b: unknown): boolean {
  const x = houseCompact(a);
  const y = houseCompact(b);
  return x !== "" && x === y;
}

/** קידומת לחיפוש, כדי ש-'25 א' יימצא גם כשהשאילתה היא '25א'. */
export function houseNumberPrefix(value: unknown): string {
  const compact = houseCompact(value).replace(/[%_]/g, "");
  const digits = /^(\d+)/.exec(compact);
  return digits ? digits[1] : compact;
}

/** חדרים כמו trim_scale במפתח: 3 ו-3.0 זהים, וריק אינו 3. */
export function roomsKey(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(n);
}

export function dealKey(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * האם מפתח הכפילות (חדרים, קומה, עסקה) מתנגש.
 * קומה שמולאה מול מודעה בלי קומה של משרד אחר עדיין מתנגשת:
 * המילוי אינו הופך את זה לדירה אחרת.
 */
export function dedupeKeyCollides(incoming: UnitAddress, row: ListedUnit): boolean {
  if (roomsKey(incoming.rooms) !== roomsKey(row.rooms)) return false;
  if (dealKey(incoming.deal) !== dealKey(row.deal)) return false;
  const inFloor = floorOrNull(incoming.floor);
  const rowFloor = floorOrNull(row.floor);
  if (inFloor === rowFloor) return true;
  return row.sameOffice === false && rowFloor === null && inFloor !== null;
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

function commercialWithoutRooms(incoming: UnitAddress): boolean {
  return incoming.commercial === true && roomsKey(incoming.rooms) === "";
}

/**
 * מספר חדש מול מודעה בלי מספר מפריד רק באותו משרד, או במסחרי בלי חדרים.
 * שני מספרים שונים שנאמרו הם שתי יחידות. מספר זהה הוא אותה יחידה.
 */
export function unitSeparates(incoming: UnitAddress, row: ListedUnit): boolean {
  const next = normUnit(incoming.unit);
  const prev = normUnit(row.unit);
  if (next && prev) return next !== prev;
  if (next && !prev) return row.sameOffice !== false || commercialWithoutRooms(incoming);
  return false;
}

/**
 * אותו רחוב ומספר בית כבר סוננו על ידי הקורא.
 * שואלים מספר רק כשמפתח הכפילות באמת מתנגש ואין מספר.
 * חדרים או סוג עסקה שונים אינם אותה דירה. משרד אחר אינו נעקף במספר שהומצא.
 */
export function sharedBuildingDecision(
  incoming: UnitAddress,
  existing: ListedUnit[],
): "allow" | "ask" | "block" | "elsewhere" {
  const hits = existing.filter((row) => dedupeKeyCollides(incoming, row));
  if (!hits.length) return "allow";
  const foreign = hits.filter((row) => row.sameOffice === false);
  if (foreign.some((row) => !unitSeparates(incoming, row))) return "elsewhere";
  const local = hits.filter((row) => row.sameOffice !== false);
  if (!local.length) return "allow";
  if (!normUnit(incoming.unit)) return "ask";
  if (local.some((row) => normUnit(row.unit) === normUnit(incoming.unit))) return "block";
  return "allow";
}

export function shareStop(incoming: UnitAddress, existing: ListedUnit[]): ShareStop | null {
  const kind = sharedBuildingDecision(incoming, existing);
  if (kind === "allow") return null;
  if (kind === "ask") {
    const hit = existing.find((row) => dedupeKeyCollides(incoming, row));
    return {
      ok: false,
      needs_unit: true,
      error: UNIT_ASK_SAY,
      say: UNIT_ASK_SAY,
      guidance: UNIT_ASK_GUIDANCE,
      listing_number: listingOf(hit || existing[0]),
    };
  }
  if (kind === "elsewhere") {
    const foreign = existing.find((row) => row.sameOffice === false && dedupeKeyCollides(incoming, row));
    return {
      ok: false,
      blocked: true,
      elsewhere: true,
      error: UNIT_ELSEWHERE_SAY,
      say: UNIT_ELSEWHERE_SAY,
      guidance: UNIT_ELSEWHERE_GUIDANCE,
      listing_number: listingOf(foreign || existing[0]),
    };
  }
  const match = existing.find((row) =>
    dedupeKeyCollides(incoming, row) && normUnit(row.unit) === normUnit(incoming.unit)
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
