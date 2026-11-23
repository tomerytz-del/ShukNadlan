// ============================================================================
// plan-model.ts - מקריאת תוכנית דירה למודל של הסיור התלת-ממדי (docs/plan-3d-tour.md)
//
// קוד טהור: בלי רשת ובלי מסד, כדי שהבדיקה (scripts/plan_model_test.ts) תרוץ ב-node.
//   1. PLAN_READ_PROMPT - מה מבקשים ממודל הראייה, ובאיזה מבנה.
//   2. buildModel() - מהתשובה שלו למודל שהצופה קורא. **המודל הוא טיוטה**: מודל ראייה
//      טועה בקואורדינטות, ולכן כל ערך נבדק, נחתך לגבולות התמונה, ומה שלא ברור נזרק
//      ונרשם ב-checks ולא מנוחש. הבעלים מתקן/ת בעורך לפני פרסום.
//   3. mirrorModel() - דגם מהופך מראה (דגם נוסף, נרכש בנפרד).
//   4. imageSize() - מידות התמונה מהבייטים עצמם, לא ממה שהדפדפן דיווח.
//
// מבנה המודל זהה למה שהצופה מצפה לו: קואורדינטות בפיקסלים של תמונת התוכנית,
// וקנה המידה (ס"מ לפיקסל) ב-settings.scale.
//
// ‏checks הם **קודים ולא משפטים**: הם נשמרים ב-settings, והעורך (שלב ד') מנסח אותם.
// משפט בעברית שנוצר כאן היה חי רק בתשובה אחת ונעלם ברענון.
// ============================================================================

export type Rect = [number, number, number, number];
export type Opening = ["d" | "w" | "s", number, number];
export type Wall = { h?: number; v?: number; a: number; b: number; t: "ext" | "int" | "rail"; o?: Opening[] };
export type Room = { id: string; name: string; f: "tile" | "wood" | "wet" | "deck"; r: Rect[]; nc?: 1; bal?: 1; svc?: 1 };
export type Furn = [string, number, number, number, number?, number?];

export type PlanModel = {
  imgW: number;
  imgH: number;
  rooms: Room[];
  solids: Rect[];
  walls: Wall[];
  labels: [string, number, number][];
  lamps: [number, number][];
  furniture: Furn[];
};

export type PlanCheck =
  | { code: "rooms_dropped"; n: number }
  | { code: "diagonal_walls"; n: number }
  | { code: "scale_estimated"; source: "area" | "door" | "default" }
  | { code: "scale_inconsistent" }
  | { code: "no_north" }
  | { code: "walls_inferred" };

export type PlanSettings = {
  scale: number;
  scale_source: "dimensions" | "area" | "door" | "default";
  north: number;
  declared_area_sqm: number | null;
  declared_balcony_sqm: number | null;
  checks: PlanCheck[];
};

export class PlanReadError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// סוג חדר -> שם ברירת מחדל, רצפה ודגלים. הרשימה סגורה: סוג שהמודל המציא הופך ל-"other".
const ROOM_KINDS: Record<string, { name: string; f: Room["f"]; nc?: 1; bal?: 1; svc?: 1 }> = {
  living: { name: "סלון", f: "tile" },
  kitchen: { name: "מטבח", f: "tile" },
  dining: { name: "פינת אוכל", f: "tile" },
  master: { name: "סוויטת הורים", f: "wood" },
  bedroom: { name: "חדר שינה", f: "wood" },
  mamad: { name: 'ממ"ד', f: "wood" },
  bath: { name: "חדר רחצה", f: "wet" },
  wc: { name: "שירותים", f: "wet" },
  corridor: { name: "מסדרון", f: "tile" },
  entry: { name: "כניסה", f: "tile" },
  storage: { name: "מחסן", f: "tile" },
  balcony: { name: "מרפסת", f: "deck", nc: 1, bal: 1 },
  service: { name: "מרפסת שירות", f: "tile", nc: 1, svc: 1 },
  other: { name: "חלל", f: "tile" },
};

export const PLAN_READ_PROMPT =
  "זוהי תוכנית אדריכלית של דירה אחת (מבט מלמעלה). חלץ ממנה את מבנה הדירה והחזר JSON בלבד, בלי טקסט נוסף.\n" +
  "כל הקואורדינטות מנורמלות לטווח 0 עד 1000: x משמאל לימין, y מלמעלה למטה, ביחס לתמונה כולה.\n" +
  "המבנה:\n" +
  "{\n" +
  '  "rooms": [{"kind": "<סוג>", "name": "<השם כפי שכתוב בתוכנית, אם כתוב>", "x1":0,"y1":0,"x2":0,"y2":0}],\n' +
  '  "walls": [{"kind": "exterior|interior|railing", "x1":0,"y1":0,"x2":0,"y2":0,\n' +
  '             "openings": [{"kind": "door|window|sliding", "x1":0,"y1":0,"x2":0,"y2":0}]}],\n' +
  '  "core": [{"x1":0,"y1":0,"x2":0,"y2":0}],\n' +
  '  "zones": [{"kind": "kitchen|dining|living", "x1":0,"y1":0,"x2":0,"y2":0}],\n' +
  '  "entrance": {"x1":0,"y1":0,"x2":0,"y2":0},\n' +
  '  "dimensions": [{"cm": 0, "x1":0,"y1":0,"x2":0,"y2":0}],\n' +
  '  "north_deg": null,\n' +
  '  "apartment_sqm": null,\n' +
  '  "balcony_sqm": null\n' +
  "}\n" +
  `kind של חדר הוא אחד מ: ${Object.keys(ROOM_KINDS).join(", ")}.\n` +
  "כללים:\n" +
  "1. rooms: מלבן לכל חלל, לפי הפנים של הקירות. חלל פתוח אחד (סלון, מטבח ופינת אוכל בלי קיר ביניהם) הוא חדר אחד מסוג living. מלבן של חדר אינו מכסה חדרים אחרים ואינו מכסה את גרעין הבניין.\n" +
  "2. walls: קו לאורך מרכז כל קיר, מקצה לקצה. exterior לקיר חיצוני עבה, interior למחיצה פנימית, railing למעקה מרפסת. רק קירות שמצוירים בתוכנית.\n" +
  "3. openings: כל דלת, חלון או דלת הזזה, כקטע על קו הקיר שלו. רווח בקיר עם קשת פתיחה הוא door.\n" +
  "4. core: גרעין הבניין (מדרגות, מעלית, פירים, לובי קומתי) אם הוא מופיע בתוך מתאר הדירה או שהדירה עוטפת אותו: מלבן אחד שעוטף את כולו. לא חלק מהדירה ולא חדר.\n" +
  "5. dimensions: עד 8 קווי מידה שמספר בסנטימטרים כתוב לידם, עם שתי הנקודות שהמידה נמדדת ביניהן. רק מספרים שכתובים בתוכנית.\n" +
  "6. north_deg: זווית חץ הצפון במעלות עם כיוון השעון מראש התמונה, או null אם אין חץ.\n" +
  "7. apartment_sqm ו-balcony_sqm: רק אם השטח כתוב בתוכנית. אחרת null.\n" +
  "8. zones: בתוך חלל פתוח, מלבן סביב הריהוט המצויר של כל אזור: kitchen (משטח העבודה והארונות), dining (שולחן האוכל והכיסאות), living (הספה והשטיח). אלה אזורים ולא חדרים, ואין ביניהם קירות.\n" +
  "9. entrance: דלת הכניסה הראשית לדירה, כקטע על קו הקיר שלה (בדרך כלל ליד המילה כניסה או חץ). null אם אינה מסומנת.\n" +
  "10. אל תמציא: מה שלא רואים בתוכנית לא נכנס לתשובה.";

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** גבולות הגודל של תמונת תוכנית. נבדק לפני החיוב (ב-Edge Function) וגם ב-buildModel. */
export function validImageSize(w: number, h: number): boolean {
  return w >= 200 && w <= 8000 && h >= 200 && h <= 8000;
}

/**
 * מידות התמונה מהכותרת של הקובץ (PNG, JPEG, WebP). null אם לא זוהה.
 * מהבייטים ולא מהדפדפן: מודל הראייה מחזיר קואורדינטות ביחס לקובץ שראה, ומידות שגויות
 * מהלקוח היו מעוותות כל קיר בלי שום שגיאה.
 */
export function imageSize(b: Uint8Array): { w: number; h: number; mime: "image/png" | "image/jpeg" | "image/webp" } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  const le24 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (b.length < 30) return null;
  // PNG: החתימה, ואז IHDR עם רוחב וגובה
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: u32(16), h: u32(20), mime: "image/png" };
  // JPEG: עוברים על המקטעים עד SOF (C0-CF, חוץ מ-C4, C8, CC)
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5), mime: "image/jpeg" };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + u16(i + 2);
    }
    return null;
  }
  // WebP: RIFF....WEBP ואז VP8 (lossy), VP8L (lossless) או VP8X (extended)
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    const mime = "image/webp" as const;
    if (tag === "VP8X") return { w: le24(24) + 1, h: le24(27) + 1, mime };
    if (tag === "VP8 ") return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff, mime };
    if (tag === "VP8L") {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, mime };
    }
  }
  return null;
}

/** מוציא JSON מתשובת המודל: גם כשהוא עטוף ב-```json, וגם כשיש טקסט לפניו. */
export function parsePlanReading(text: string): Record<string, unknown> {
  const t = String(text ?? "").trim();
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new PlanReadError("plan_unreadable", "התשובה אינה JSON");
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("not an object");
    return obj as Record<string, unknown>;
  } catch {
    throw new PlanReadError("plan_unreadable", "התשובה אינה JSON תקין");
  }
}

type Box = { x1: number; y1: number; x2: number; y2: number };

/** ארבע קואורדינטות מנורמלות (0-1000) לפיקסלים: חתוכות לגבולות התמונה ומסודרות (x1<=x2, y1<=y2). null אם חסר מספר. */
function boxPx(o: unknown, W: number, H: number): Box | null {
  const r = (o ?? {}) as Record<string, unknown>;
  const x1 = num(r.x1), y1 = num(r.y1), x2 = num(r.x2), y2 = num(r.y2);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
  const px = (v: number, size: number) => Math.round(Math.min(1000, Math.max(0, v)) / 1000 * size);
  const ax = px(x1, W), bx = px(x2, W), ay = px(y1, H), by = px(y2, H);
  return { x1: Math.min(ax, bx), y1: Math.min(ay, by), x2: Math.max(ax, bx), y2: Math.max(ay, by) };
}

const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

const MAX_ROOMS = 40, MAX_WALLS = 220, MAX_OPENINGS = 12, MAX_SOLIDS = 8;

/**
 * מתשובת מודל הראייה למודל של הצופה.
 * זורק PlanReadError כשאין מה לבנות (פחות משני חדרים או פחות משלושה קירות).
 */
// ---- קירות מתוך החדרים ----
// מודל הראייה טוב בתיבות של חדרים וחלש בקירות: בתוכנית האמיתית הראשונה (פנטהאוז, 23.11.2026)
// חזרו 11 חדרים, 9 קירות חיצוניים ואף קיר פנימי, והסיור יצא אולם אחד. כשהקירות הפנימיים חסרים,
// משחזרים אותם מגבולות החדרים: רשת מכל קווי החדרים, לכל תא החדר הקטן ביותר שמכיל אותו (כך
// "סלון" שנקרא כתיבה שעוטפת הכול אינו בולע את חדרי השינה), וקיר בכל גבול בין שני בעלים שונים.

type Grid = { xs: number[]; ys: number[]; own: number[][] };

/** קווים קרובים (עד tol) מתאחדים לקו אחד: שני חדרים שקיר מפריד ביניהם נקראים עם רווח של עובי הקיר */
function snapLines(vals: number[], tol: number): Map<number, number> {
  const v = [...new Set(vals)].sort((a, b) => a - b), map = new Map<number, number>();
  for (let i = 0; i < v.length;) {
    let j = i;
    while (j + 1 < v.length && v[j + 1] - v[j] <= tol && v[j + 1] - v[i] <= 2 * tol) j++;
    const m = Math.round((v[i] + v[j]) / 2);
    for (let k = i; k <= j; k++) map.set(v[k], m);
    i = j + 1;
  }
  return map;
}

function roomGrid(rooms: Room[], tol: number, solids: Rect[] = []): Grid {
  const mx = snapLines(rooms.flatMap((r) => [r.r[0][0], r.r[0][2]]).concat(solids.flatMap((q) => [q[0], q[2]])), tol);
  const my = snapLines(rooms.flatMap((r) => [r.r[0][1], r.r[0][3]]).concat(solids.flatMap((q) => [q[1], q[3]])), tol);
  // גרעין הבניין אינו שייך לאף חדר: תא שבתוכו נשאר ריק, וכך נוצר סביבו קיר ("סלון" שעוטף אותו אינו בולע אותו)
  const cores = solids.map((q) => [mx.get(q[0])!, my.get(q[1])!, mx.get(q[2])!, my.get(q[3])!]);
  // חדר צר ששני הקצוות שלו התאחדו לקו אחד היה נעלם: לו משאירים את הקואורדינטות המקוריות בציר הזה
  const rects = rooms.map((r) => {
    const q = r.r[0], x1 = mx.get(q[0])!, x2 = mx.get(q[2])!, y1 = my.get(q[1])!, y2 = my.get(q[3])!;
    return [x1 < x2 ? x1 : q[0], y1 < y2 ? y1 : q[1], x1 < x2 ? x2 : q[2], y1 < y2 ? y2 : q[3]];
  });
  const uniq = (a: number[]) => [...new Set(a)].sort((p, q) => p - q);
  const all = rects.concat(cores);
  const xs = uniq(all.flatMap((q) => [q[0], q[2]])), ys = uniq(all.flatMap((q) => [q[1], q[3]]));
  const area = (q: number[]) => (q[2] - q[0]) * (q[3] - q[1]);
  const own = ys.slice(0, -1).map((y, j) => xs.slice(0, -1).map((x, i) => {
    const cx = (x + xs[i + 1]) / 2, cy = (y + ys[j + 1]) / 2;
    if (cores.some((q) => cx > q[0] && cx < q[2] && cy > q[1] && cy < q[3])) return -1;
    let best = -1;
    rects.forEach((q, k) => {
      if (cx > q[0] && cx < q[2] && cy > q[1] && cy < q[3] && (best < 0 || area(q) < area(rects[best]))) best = k;
    });
    return best;
  }));
  // רווח בעובי קיר בין שני חדרים (עד 3×tol) שלא התאחד בהצמדה: התא הריק עובר לשכן, כדי שהחדרים
  // ייגעו זה בזה ויהיה ביניהם קיר אחד עם דלת, ולא שני קירות חיצוניים עם חלל אטום ביניהם
  const thin = 3 * tol;
  for (let j = 0; j < own.length; j++) for (let i = 1; i < own[j].length - 1; i++) {
    if (own[j][i] < 0 && xs[i + 1] - xs[i] <= thin && own[j][i - 1] >= 0 && own[j][i + 1] >= 0) own[j][i] = own[j][i - 1];
  }
  for (let j = 1; j < own.length - 1; j++) for (let i = 0; i < own[j].length; i++) {
    if (own[j][i] < 0 && ys[j + 1] - ys[j] <= thin && own[j - 1][i] >= 0 && own[j + 1][i] >= 0) own[j][i] = own[j - 1][i];
  }
  return { xs, ys, own };
}

/** שטח התאים של חדר k, בפיקסלים רבועים */
function ownedArea(g: Grid, pred: (k: number) => boolean): number {
  let a = 0;
  g.own.forEach((row, j) => row.forEach((k, i) => { if (k >= 0 && pred(k)) a += (g.xs[i + 1] - g.xs[i]) * (g.ys[j + 1] - g.ys[j]); }));
  return a;
}

type Seg = { A: number; B: number; a: number; b: number; wall: Wall };

/**
 * קירות, פתחים ומלבני חדרים מתוך הרשת. `read` הם הקירות שהמודל כן קרא: הפתחים שלהם (חלונות,
 * דלתות) מועתקים לקיר המשוחזר הקרוב. חדר שנשאר בלי דלת מקבל אחת, אחרת אי אפשר להיכנס אליו.
 */
export function inferWalls(rooms: Room[], read: Wall[], g: Grid, tol: number, scale: number): { rooms: Room[]; walls: Wall[] } {
  const { xs, ys, own } = g;
  const at = (j: number, i: number) => (j < 0 || i < 0 || j >= own.length || i >= own[0].length ? -1 : own[j][i]);
  const rm = (k: number) => k >= 0 && !rooms[k].bal, bal = (k: number) => k >= 0 && !!rooms[k].bal;
  const kind = (A: number, B: number): Wall["t"] | null => {
    if (A === B) return null;
    if (rm(A) && rm(B)) return "int";
    if (rm(A) || rm(B)) return "ext";
    return bal(A) !== bal(B) ? "rail" : null;
  };
  const walls: Wall[] = [], segs: Seg[] = [];
  // עוברים על כל קו של הרשת בשני הכיוונים, ומאחדים קטעים רצופים מאותו סוג לקיר אחד
  const sweep = (horiz: boolean) => {
    const lines = horiz ? ys : xs, along = horiz ? xs : ys;
    lines.forEach((line, li) => {
      let cur: Wall | null = null;
      for (let c = 0; c < along.length - 1; c++) {
        const A = horiz ? at(li - 1, c) : at(c, li - 1), B = horiz ? at(li, c) : at(c, li);
        const t = kind(A, B);
        if (!t) { cur = null; continue; }
        if (!cur || cur.t !== t || cur.b !== along[c]) {
          cur = horiz ? { h: line, a: along[c], b: along[c + 1], t } : { v: line, a: along[c], b: along[c + 1], t };
          walls.push(cur);
        } else cur.b = along[c + 1];
        const last = segs[segs.length - 1];
        if (last && last.wall === cur && last.A === A && last.B === B && last.b === along[c]) last.b = along[c + 1];
        else segs.push({ A, B, a: along[c], b: along[c + 1], wall: cur });
      }
    });
  };
  sweep(true);
  sweep(false);

  const lineOf = (w: Wall) => (w.h !== undefined ? w.h : w.v!);
  const add = (w: Wall, o: Opening) => { (w.o ??= []).push(o); };
  // פתחים שנקראו: כל אחד לקיר המשוחזר הקרוב ביותר באותו כיוון
  for (const rw of read) {
    for (const o of rw.o ?? []) {
      let best: Wall | null = null, bd = 2 * tol + 1;
      for (const w of walls) {
        if (w.t === "rail" || (w.h !== undefined) !== (rw.h !== undefined)) continue;
        const d = Math.abs(lineOf(w) - lineOf(rw));
        if (d < bd && Math.min(o[2], w.b) - Math.max(o[1], w.a) >= 6) { best = w; bd = d; }
      }
      if (best) add(best, [o[0], Math.max(o[1], best.a), Math.min(o[2], best.b)]);
    }
  }
  const opens = (sg: Seg, kinds: string) => (sg.wall.o ?? []).some((o) => kinds.includes(o[0]) && Math.min(o[2], sg.b) - Math.max(o[1], sg.a) > 4);
  const touches = (sg: Seg, k: number) => sg.A === k || sg.B === k;
  const other = (sg: Seg, k: number) => (sg.A === k ? sg.B : sg.A);
  const areas = rooms.map((_, k) => ownedArea(g, (x) => x === k));
  const hub = rooms.reduce((b, r, k) => (!r.bal && (b < 0 || areas[k] > areas[b]) ? k : b), -1);
  const doorPx = Math.max(10, Math.round(85 / scale)), slidePx = Math.max(20, Math.round(200 / scale));
  const longest = (list: Seg[]) => list.reduce<Seg | null>((b, sg) => (!b || sg.b - sg.a > b.b - b.a ? sg : b), null);
  rooms.forEach((r, k) => {
    if (k === hub || areas[k] === 0) return;
    const mine = segs.filter((sg) => touches(sg, k) && sg.wall.t !== "rail");
    // פתח נחשב רק אם הוא מוביל לחדר: ויטרינה של חדר שינה אל המרפסת אינה כניסה לחדר
    if (mine.some((sg) => opens(sg, "ds") && rm(other(sg, k)))) return;
    // חדר: דלת אל המרחב המרכזי, ואם אין שם מקום, אל השכן עם הגבול הארוך ביותר. מרפסת: ויטרינה אל חדר.
    // פתח צר מ-60 ס"מ אינו דלת: מנסים את הגבול הבא
    const want = r.bal ? slidePx : doorPx, minPx = Math.max(8, Math.round(60 / scale));
    const fits = (x: Seg) => x.b - x.a - 8 >= minPx;
    const toRooms = mine.filter((x) => rm(other(x, k)) && fits(x));
    const sg = longest(toRooms.filter((x) => other(x, k) === hub)) ?? longest(toRooms);
    if (!sg) return;
    const len = sg.b - sg.a, w = Math.min(want, len - 8);
    const from = r.bal ? Math.round(sg.a + (len - w) / 2) : Math.round(sg.a + Math.min(12, (len - w) / 2));
    add(sg.wall, [r.bal ? "s" : "d", from, from + w]);
  });
  for (const w of walls) {
    if (!w.o) continue;
    w.o.sort((p, q) => p[1] - q[1]);
    const clean: Opening[] = [];
    for (const o of w.o) if (!clean.length || o[1] >= clean[clean.length - 1][2]) clean.push(o);
    w.o = clean;
  }

  // מלבני החדר: רצפים של תאים בכל שורה, ומיזוג שורות עוקבות עם אותו טווח. הגדול ראשון (r[0] הוא החדר "הראשי")
  const out: Room[] = [];
  rooms.forEach((r, k) => {
    const rects: Rect[] = [];
    own.forEach((row, j) => {
      for (let i = 0; i < row.length;) {
        if (row[i] !== k) { i++; continue; }
        let e = i;
        while (e + 1 < row.length && row[e + 1] === k) e++;
        const prev = rects.find((q) => q[0] === xs[i] && q[2] === xs[e + 1] && q[3] === ys[j]);
        if (prev) prev[3] = ys[j + 1]; else rects.push([xs[i], ys[j], xs[e + 1], ys[j + 1]]);
        i = e + 1;
      }
    });
    if (!rects.length) return;
    rects.sort((p, q) => (q[2] - q[0]) * (q[3] - q[1]) - (p[2] - p[0]) * (p[3] - p[1]));
    out.push({ ...r, r: rects });
  });
  return { rooms: out, walls };
}

export function buildModel(raw: Record<string, unknown>, imgW: number, imgH: number): { model: PlanModel; settings: PlanSettings } {
  const W = Math.round(imgW), H = Math.round(imgH);
  if (!validImageSize(W, H)) throw new PlanReadError("bad_image_size", "גודל התמונה אינו תקין");
  const checks: PlanCheck[] = [];
  const minSide = Math.max(6, Math.round(Math.min(W, H) * 0.012));
  const bigEnough = (b: Box) => b.x2 - b.x1 >= minSide && b.y2 - b.y1 >= minSide;

  // ---- חדרים ----
  let rooms: Room[] = [];
  const labels: [string, number, number][] = [];
  const lamps: [number, number][] = [];
  const counts: Record<string, number> = {};
  let dropped = 0;
  for (const r of list(raw.rooms, MAX_ROOMS)) {
    const b = boxPx(r, W, H);
    if (!b || !bigEnough(b)) { dropped++; continue; }
    const rr = r as Record<string, unknown>;
    const kind = typeof rr.kind === "string" && ROOM_KINDS[rr.kind] ? rr.kind : "other";
    const { name: defName, ...flags } = ROOM_KINDS[kind];
    const given = typeof rr.name === "string" ? rr.name.trim().slice(0, 40) : "";
    counts[kind] = (counts[kind] ?? 0) + 1;
    const room: Room = { id: `${kind}${counts[kind]}`, name: given || defName, r: [[b.x1, b.y1, b.x2, b.y2]], ...flags };
    rooms.push(room);
    const cx = Math.round((b.x1 + b.x2) / 2), cy = Math.round((b.y1 + b.y2) / 2);
    labels.push([room.name, cx, cy]);
    if (!room.nc) lamps.push([cx, cy]);
  }
  if (dropped) checks.push({ code: "rooms_dropped", n: dropped });
  // ---- אזורים בחלל פתוח (מטבח, פינת אוכל, סלון): לריהוט ולתוויות, לא קירות ----
  const zones: Zone[] = [];
  for (const z of list(raw.zones, 6)) {
    const b = boxPx(z, W, H), k = (z as Record<string, unknown>)?.kind;
    if (b && bigEnough(b) && (k === "kitchen" || k === "dining" || k === "living")) zones.push({ kind: k, q: [b.x1, b.y1, b.x2, b.y2] });
  }
  // מטבח או פינת אוכל שנקראו כ"חדר" בתוך הסלון (70% ומעלה ממנו) הם אזור: כחדר הם היו מקבלים קירות סביבם
  const livings = rooms.filter((r) => r.id.startsWith("living"));
  rooms = rooms.filter((r) => {
    const kind = r.id.replace(/\d+$/, "");
    if (kind !== "kitchen" && kind !== "dining") return true;
    const q = r.r[0], area = (q[2] - q[0]) * (q[3] - q[1]);
    const inside = livings.some((l) => {
      const p = l.r[0], ox = Math.min(q[2], p[2]) - Math.max(q[0], p[0]), oy = Math.min(q[3], p[3]) - Math.max(q[1], p[1]);
      return ox > 0 && oy > 0 && ox * oy >= 0.7 * area;
    });
    if (inside && !zones.some((z) => z.kind === kind)) zones.push({ kind, q });
    return !inside;
  });
  if (rooms.length < 2) throw new PlanReadError("plan_unreadable", "לא זוהו חדרים בתוכנית");

  // ---- קירות ופתחים: רק קירות ישרים (אופקי או אנכי). אלכסון נזרק ונספר ----
  let walls: Wall[] = [];
  let diagonal = 0;
  for (const w of list(raw.walls, MAX_WALLS)) {
    const b = boxPx(w, W, H);
    if (!b) continue;
    const dx = b.x2 - b.x1, dy = b.y2 - b.y1;
    if (Math.max(dx, dy) < minSide) continue;
    const ww = w as Record<string, unknown>;
    const t: Wall["t"] = ww.kind === "exterior" ? "ext" : ww.kind === "railing" ? "rail" : "int";
    const horiz = dy <= dx * 0.15;
    if (!horiz && dx > dy * 0.15) { diagonal++; continue; }
    const lo = horiz ? b.x1 : b.y1, hi = horiz ? b.x2 : b.y2;
    const line = Math.round(horiz ? (b.y1 + b.y2) / 2 : (b.x1 + b.x2) / 2);
    const wall: Wall = horiz ? { h: line, a: lo, b: hi, t } : { v: line, a: lo, b: hi, t };
    // פתחים: מוטלים על ציר הקיר, נחתכים לאורכו, ממוינים ובלי חפיפה. במעקה אין פתחים
    if (t !== "rail") {
      const os: Opening[] = [];
      for (const o of list(ww.openings, MAX_OPENINGS)) {
        const ob = boxPx(o, W, H);
        if (!ob) continue;
        const from = Math.max(lo, horiz ? ob.x1 : ob.y1), to = Math.min(hi, horiz ? ob.x2 : ob.y2);
        if (to - from < Math.max(4, minSide / 2)) continue;
        const k = (o as Record<string, unknown>).kind;
        os.push([k === "door" ? "d" : k === "sliding" ? "s" : "w", from, to]);
      }
      os.sort((p, q) => p[1] - q[1]);
      // מול הפתח האחרון **שנשמר**, לא מול הקודם ברשימה: פתח שבא אחרי אחד שנזרק נבדק מול מה שבאמת נשאר
      const clean: Opening[] = [];
      for (const o of os) if (!clean.length || o[1] >= clean[clean.length - 1][2]) clean.push(o);
      if (clean.length) wall.o = clean;
    }
    walls.push(wall);
  }
  if (diagonal) checks.push({ code: "diagonal_walls", n: diagonal });
  if (walls.length < 3) throw new PlanReadError("plan_unreadable", "לא זוהו קירות בתוכנית");

  // ---- גרעין הבניין ----
  const solids: Rect[] = [];
  for (const c of list(raw.core, MAX_SOLIDS)) {
    const b = boxPx(c, W, H);
    if (b && bigEnough(b)) solids.push([b.x1, b.y1, b.x2, b.y2]);
  }

  // ---- קנה מידה (ס"מ לפיקסל): ממידות כתובות, אחרת משטח כתוב, אחרת מרוחב דלת, ואחרת ברירת מחדל ----
  const declaredArea = num(raw.apartment_sqm), declaredBalcony = num(raw.balcony_sqm);
  const ratios: number[] = [];
  for (const d of list(raw.dimensions, 8)) {
    const cm = num((d as Record<string, unknown>)?.cm), b = boxPx(d, W, H);
    if (cm === null || !b || cm < 30 || cm > 3000) continue;
    const px = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
    if (px < minSide) continue;
    const ratio = cm / px;
    if (ratio > 0.2 && ratio < 12) ratios.push(ratio);
  }
  // כל מקור נבדק בטווח לפני שהוא מתקבל: שטח שנקרא שגוי (1,200 במקום 120) נופל לרוחב הדלת, לא לברירת המחדל
  const sane = (v: number) => v > 0.2 && v < 12;
  let scale = 1.5;
  let scaleSource: PlanSettings["scale_source"] = "default";
  const doors = walls.flatMap((w) => (w.o ?? []).filter((o) => o[0] === "d").map((o) => o[2] - o[1]));
  // השטח לפי הרשת ולא לפי סכום המלבנים: חדרים שנקראו חופפים נספרים פעם אחת
  const tol = Math.max(8, Math.round(Math.max(W, H) * 0.018));
  const grid = roomGrid(rooms, tol, solids);
  const px2 = ownedArea(grid, (k) => !rooms[k].bal && !rooms[k].svc);
  const byArea = declaredArea !== null && declaredArea > 15 && declaredArea < 1500 && px2 > 0
    ? Math.sqrt(declaredArea * 10000 / px2) : 0;
  const byDoor = doors.length ? 85 / median(doors) : 0;
  // מידה כתובה מתקבלת רק אם היא מסכימה עם השטח הכתוב (עד 35%): בפנטהאוז המידות הותאמו לקטעים
  // הלא נכונים ונתנו 4.6 ס"מ לפיקסל במקום כ-1.7, והרהיטים יצאו בגודל של צעצוע
  const near = sane(byArea) ? ratios.filter((r) => r / byArea > 0.74 && r / byArea < 1.35) : ratios;
  if (near.length) {
    scale = median(near);
    scaleSource = "dimensions";
    if (near.length < ratios.length || (near.length >= 2 && Math.max(...near) / Math.min(...near) > 1.25)) checks.push({ code: "scale_inconsistent" });
  } else if (ratios.length && sane(byArea)) {
    scale = byArea;
    scaleSource = "area";
    checks.push({ code: "scale_inconsistent" });
  } else if (sane(byArea)) {
    scale = byArea;
    scaleSource = "area";
  } else if (sane(byDoor)) {
    scale = byDoor;
    scaleSource = "door";
  }
  if (scaleSource !== "dimensions") checks.push({ code: "scale_estimated", source: scaleSource });

  // קירות פנימיים חסרים (פחות מקיר לכל שני חדרים): משחזרים מהחדרים. מה שנקרא טוב נשאר כמו שהוא
  const inner = rooms.filter((r) => !r.bal).length;
  if (walls.filter((w) => w.t === "int").length < Math.max(1, Math.floor(inner / 2))) {
    const inf = inferWalls(rooms, walls, grid, tol, scale);
    if (inf.walls.length >= 3 && inf.rooms.length >= 2) {
      // חדר שנבלע כולו בחדרים קטנים ממנו ירד: נספר, והתוויות והמנורות נבנות מהחדרים שנשארו
      const gone = rooms.length - inf.rooms.length;
      if (gone) {
        const prev = checks.find((c) => c.code === "rooms_dropped");
        if (prev && prev.code === "rooms_dropped") prev.n += gone; else checks.push({ code: "rooms_dropped", n: gone });
      }
      rooms = inf.rooms;
      walls = inf.walls;
      labels.length = 0;
      lamps.length = 0;
      for (const r of rooms) {
        const q = r.r[0], cx = Math.round((q[0] + q[2]) / 2), cy = Math.round((q[1] + q[3]) / 2);
        labels.push([r.name, cx, cy]);
        if (!r.nc) lamps.push([cx, cy]);
      }
      checks.push({ code: "walls_inferred" });
    }
  }

  // ---- דלת הכניסה: נכנסת לקיר הקרוב, ותווית "כניסה" בצד של הדירה (משם נפתח מבט ראשון) ----
  const en = boxPx(raw.entrance, W, H);
  if (en) {
    const hz = en.x2 - en.x1 >= en.y2 - en.y1, mid = hz ? (en.y1 + en.y2) / 2 : (en.x1 + en.x2) / 2;
    const lo = hz ? en.x1 : en.y1, hi = hz ? en.x2 : en.y2;
    let best: Wall | null = null, bd = 2 * tol + 1;
    for (const w of walls) {
      if (w.t === "rail" || (w.h !== undefined) !== hz) continue;
      const d = Math.abs((w.h !== undefined ? w.h : w.v!) - mid);
      if (d < bd && Math.min(hi, w.b) - Math.max(lo, w.a) >= 6) { best = w; bd = d; }
    }
    if (best) {
      const doorPx = Math.max(10, Math.round(90 / scale)), c = Math.round((Math.max(lo, best.a) + Math.min(hi, best.b)) / 2);
      const from = Math.max(best.a, Math.round(c - doorPx / 2)), to = Math.min(best.b, from + doorPx);
      best.o = (best.o ?? []).filter((o) => o[2] <= from || o[1] >= to).concat([["d", from, to]]).sort((p, q) => p[1] - q[1]);
      const line = best.h !== undefined ? best.h : best.v!, off = Math.max(14, Math.round(60 / scale));
      const inRoom = (x: number, y: number) => rooms.some((r) => !r.bal && r.r.some((q) => x > q[0] && x < q[2] && y > q[1] && y < q[3]));
      const side = [1, -1].find((sg) => (hz ? inRoom(c, line + sg * off) : inRoom(line + sg * off, c)));
      if (side) labels.push(hz ? ["כניסה", c, line + side * off] : ["כניסה", line + side * off, c]);
    }
  }

  const northRaw = num(raw.north_deg);
  if (northRaw === null) checks.push({ code: "no_north" });

  // בלי קנה מידה אמיתי אין לדעת אם מיטה נכנסת לחדר: לא מרהטים על ברירת מחדל
  const furniture = scaleSource === "default" ? [] : autoFurnish(rooms, scale, zones, walls, tol);
  for (const z of zones) labels.push([ROOM_KINDS[z.kind].name, Math.round((z.q[0] + z.q[2]) / 2), Math.round((z.q[1] + z.q[3]) / 2)]);
  return {
    model: { imgW: W, imgH: H, rooms, solids, walls, labels, lamps, furniture },
    settings: {
      scale: Math.round(scale * 1000) / 1000,
      scale_source: scaleSource,
      north: northRaw === null ? 0 : Math.round(norm360(northRaw + 180) - 180),
      declared_area_sqm: declaredArea !== null && declaredArea > 0 ? declaredArea : null,
      declared_balcony_sqm: declaredBalcony !== null && declaredBalcony > 0 ? declaredBalcony : null,
      checks,
    },
  };
}

/**
 * ריהוט התחלתי, מינימלי ובמרכז החדר: נקודת פתיחה לעורך ולא עיצוב. פריט נכנס רק אם יש לו
 * מקום (לפי מידות החדר בס"מ), כדי שלא ייצא מיטה שבולטת מקיר.
 */
export type Zone = { kind: "kitchen" | "dining" | "living"; q: Rect };

/** ריהוט של אזור בחלל פתוח. המטבח נצמד לקיר שלאורך האזור; בלי קיר קרוב, לצד הארוך */
function furnishZone(z: Zone, scale: number, walls: Wall[], tol: number, out: Furn[]) {
  const [x1, y1, x2, y2] = z.q, cx = Math.round((x1 + x2) / 2), cy = Math.round((y1 + y2) / 2);
  const wCm = (x2 - x1) * scale, dCm = (y2 - y1) * scale, wide = wCm >= dCm, px = (cm: number) => Math.round(cm / scale);
  if (z.kind === "dining") {
    const len = Math.max(160, Math.min(240, Math.max(wCm, dCm) - 40)), n = Math.min(4, Math.floor(len / 58));
    out.push(["table", cx, cy, wide ? 0 : 90, Math.round(len), 100]);
    for (let i = 0; i < n; i++) {
      const t = px(-len / 2 + (len / n) * (i + 0.5)), o = px(74);
      if (wide) { out.push(["chair", cx + t, cy - o, 0]); out.push(["chair", cx + t, cy + o, 180]); }
      else { out.push(["chair", cx - o, cy + t, 270]); out.push(["chair", cx + o, cy + t, 90]); }
    }
    return;
  }
  if (z.kind === "living") {
    out.push(["rug", cx, cy, wide ? 0 : 90]);
    if (wide) out.push(["sofa", cx, Math.round(y1 + (y2 - y1) * 0.22), 0]); else out.push(["sofa", Math.round(x1 + (x2 - x1) * 0.22), cy, 270]);
    out.push(["coffee", cx, cy, wide ? 0 : 90]);
    return;
  }
  // מטבח: הצד שלאורכו יש הכי הרבה קיר
  const sides = [
    { rot: 0, hz: true, line: y1, lo: x1, hi: x2, sg: 1 }, { rot: 180, hz: true, line: y2, lo: x1, hi: x2, sg: -1 },
    { rot: 270, hz: false, line: x1, lo: y1, hi: y2, sg: 1 }, { rot: 90, hz: false, line: x2, lo: y1, hi: y2, sg: -1 },
  ].map((sd) => {
    let cover = 0, at = sd.line;
    for (const w of walls) {
      if (w.t === "rail" || (w.h !== undefined) !== sd.hz) continue;
      const wl = w.h !== undefined ? w.h : w.v!, ov = Math.min(sd.hi, w.b) - Math.max(sd.lo, w.a);
      if (Math.abs(wl - sd.line) <= 3 * tol && ov > cover) { cover = ov; at = wl; }
    }
    return { ...sd, cover, at };
  });
  const best = sides.reduce((b, sd) => (sd.cover > b.cover || (sd.cover === b.cover && sd.hi - sd.lo > b.hi - b.lo) ? sd : b));
  const len = Math.max(180, Math.min(440, (best.hi - best.lo) * scale)), mid = Math.round((best.lo + best.hi) / 2);
  const off = best.at + best.sg * px(40), isl = best.at + best.sg * px(250);
  out.push(best.hz ? ["kitchen", mid, off, best.rot, Math.round(len)] : ["kitchen", off, mid, best.rot, Math.round(len)]);
  // אי רק כשיש עומק: 3.3 מ' ומעלה מהקיר
  if ((best.hz ? dCm : wCm) >= 330 && len >= 240) {
    const w = Math.round(Math.min(240, len - 100));
    out.push(best.hz ? ["island", mid, isl, best.rot, w, 80] : ["island", isl, mid, best.rot, w, 80]);
  }
}

export function autoFurnish(rooms: Room[], scale: number, zones: Zone[] = [], walls: Wall[] = [], tol = 16): Furn[] {
  const out: Furn[] = [];
  for (const z of zones) furnishZone(z, scale, walls, tol, out);
  const zoned = (k: string) => zones.some((z) => z.kind === k);
  for (const r of rooms) {
    const [x1, y1, x2, y2] = r.r[0];
    const cx = Math.round((x1 + x2) / 2), cy = Math.round((y1 + y2) / 2);
    const wCm = (x2 - x1) * scale, dCm = (y2 - y1) * scale;
    const kind = r.id.replace(/\d+$/, "");
    const wide = wCm >= dCm;
    const fits = (a: number, b: number) => (wide ? wCm >= a && dCm >= b : dCm >= a && wCm >= b);
    if ((kind === "master" || kind === "bedroom") && fits(260, 240)) out.push(["bed2", cx, cy, 0]);
    else if ((kind === "bedroom" || kind === "mamad") && fits(240, 160)) out.push(["bed1", cx, cy, wide ? 90 : 0]);
    else if (kind === "living" && !zoned("living") && fits(360, 300)) { out.push(["rug", cx, cy, wide ? 0 : 90]); out.push(["sofa", cx, cy, wide ? 0 : 90]); }
    else if (kind === "dining" && !zoned("dining") && fits(320, 220)) out.push(["table", cx, cy, wide ? 0 : 90]);
    else if (kind === "wc" && fits(90, 120)) out.push(["toilet", cx, cy, 0]);
    else if (kind === "bath" && fits(180, 150)) out.push(["toilet", cx, cy, 0]);
    else if (kind === "balcony" && fits(300, 200)) out.push(["otable", cx, cy, wide ? 0 : 90]);
  }
  return out;
}

/**
 * האם ה-jsonb שנקרא מהמסד הוא מודל שאפשר להפוך. הבעלים עורך/ת את `model` מהדפדפן,
 * ולכן קריאה בשרת אינה סומכת על המבנה (כמו שדף הנכס אינו סומך על scenes של סיור 360).
 */
export function isPlanModel(m: unknown): m is PlanModel {
  const o = m as Record<string, unknown> | null;
  return !!o && typeof o === "object" && validImageSize(Number(o.imgW), Number(o.imgH)) &&
    ["rooms", "solids", "walls", "labels", "lamps", "furniture"].every((k) => Array.isArray(o[k]));
}

/** דגם מהופך מראה: היפוך על ציר אנכי (שמאל-ימין). */
export function mirrorModel(m: PlanModel): PlanModel {
  const fx = (x: number) => m.imgW - x;
  const flipRect = (q: Rect): Rect => [fx(q[2]), q[1], fx(q[0]), q[3]];
  return {
    imgW: m.imgW,
    imgH: m.imgH,
    rooms: m.rooms.map((r) => ({ ...r, r: r.r.map(flipRect) })),
    solids: m.solids.map(flipRect),
    walls: m.walls.map((w) => {
      if (w.v !== undefined) return { ...w, v: fx(w.v) };
      // קיר אופקי: הקצוות והפתחים מתהפכים על ציר ה-x, והסדר נשמר עולה
      const o = (w.o ?? []).map((p) => [p[0], fx(p[2]), fx(p[1])] as Opening).sort((p, q) => p[1] - q[1]);
      const out: Wall = { ...w, a: fx(w.b), b: fx(w.a) };
      if (o.length) out.o = o; else delete out.o;
      return out;
    }),
    labels: m.labels.map((l) => [l[0], fx(l[1]), l[2]] as [string, number, number]),
    lamps: m.lamps.map((l) => [fx(l[0]), l[1]] as [number, number]),
    furniture: m.furniture.map((f) => [f[0], fx(f[1]), f[2], norm360(360 - f[3]), ...f.slice(4)] as Furn),
  };
}

/**
 * היפוך של הגדרות שתלויות בכיוון: הצפון מתהפך יחד עם התוכנית (ונשאר בטווח -180 עד 179),
 * והדגל mirrored מתחלף: מראה של מראה חוזר לכיוון המקורי.
 */
export function mirrorSettings<T extends { north?: number; mirrored?: boolean }>(s: T): T {
  const out = { ...s, mirrored: !s.mirrored };
  if (typeof s.north === "number") out.north = norm360(-s.north + 180) - 180;
  return out;
}
