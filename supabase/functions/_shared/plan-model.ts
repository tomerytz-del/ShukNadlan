// ============================================================================
// plan-model.ts - מקריאת תוכנית דירה למודל של הסיור התלת-ממדי (docs/plan-3d-tour.md)
//
// קוד טהור: בלי רשת ובלי מסד, כדי שהבדיקה (scripts/plan_model_test.ts) תרוץ ב-node.
// שלושה דברים:
//   1. PLAN_READ_PROMPT - מה מבקשים ממודל הראייה, ובאיזה מבנה.
//   2. buildModel() - מהתשובה שלו למודל שהצופה קורא. **המודל הוא טיוטה**: מודל ראייה
//      טועה בקואורדינטות, ולכן כל ערך נבדק, נחתך לגבולות התמונה, ומה שלא ברור נזרק
//      ונרשם ב-warnings ולא מנוחש. הבעלים מתקן/ת בעורך לפני פרסום.
//   3. mirrorModel() - דגם מהופך מראה (דגם נוסף, נרכש בנפרד).
//
// מבנה המודל זהה למה שהצופה מצפה לו: קואורדינטות בפיקסלים של תמונת התוכנית,
// וקנה המידה (ס"מ לפיקסל) ב-settings.scale.
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

export type PlanSettings = {
  scale: number;
  scale_source: "dimensions" | "area" | "door" | "default";
  north: number;
  declared_area_sqm: number | null;
  declared_balcony_sqm: number | null;
};

export type BuildResult = { model: PlanModel; settings: PlanSettings; warnings: string[] };

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

export const PLAN_ROOM_KINDS = Object.keys(ROOM_KINDS);

export const PLAN_READ_PROMPT =
  "זוהי תוכנית אדריכלית של דירה אחת (מבט מלמעלה). חלץ ממנה את מבנה הדירה והחזר JSON בלבד, בלי טקסט נוסף.\n" +
  "כל הקואורדינטות מנורמלות לטווח 0 עד 1000: x משמאל לימין, y מלמעלה למטה, ביחס לתמונה כולה.\n" +
  "המבנה:\n" +
  "{\n" +
  '  "rooms": [{"kind": "<סוג>", "name": "<השם כפי שכתוב בתוכנית, אם כתוב>", "x1":0,"y1":0,"x2":0,"y2":0}],\n' +
  '  "walls": [{"kind": "exterior|interior|railing", "x1":0,"y1":0,"x2":0,"y2":0,\n' +
  '             "openings": [{"kind": "door|window|sliding", "x1":0,"y1":0,"x2":0,"y2":0}]}],\n' +
  '  "core": [{"x1":0,"y1":0,"x2":0,"y2":0}],\n' +
  '  "dimensions": [{"cm": 0, "x1":0,"y1":0,"x2":0,"y2":0}],\n' +
  '  "north_deg": null,\n' +
  '  "apartment_sqm": null,\n' +
  '  "balcony_sqm": null\n' +
  "}\n" +
  `kind של חדר הוא אחד מ: ${PLAN_ROOM_KINDS.join(", ")}.\n` +
  "כללים:\n" +
  "1. rooms: מלבן לכל חלל, לפי הפנים של הקירות. חלל פתוח אחד (סלון, מטבח ופינת אוכל בלי קיר ביניהם) הוא חדר אחד מסוג living.\n" +
  "2. walls: קו לאורך מרכז כל קיר, מקצה לקצה. exterior לקיר חיצוני עבה, interior למחיצה פנימית, railing למעקה מרפסת. רק קירות שמצוירים בתוכנית.\n" +
  "3. openings: כל דלת, חלון או דלת הזזה, כקטע על קו הקיר שלו. רווח בקיר עם קשת פתיחה הוא door.\n" +
  "4. core: גרעין הבניין (מדרגות, מעלית, פירים) אם הוא מופיע בתוך מתאר הדירה. לא חלק מהדירה.\n" +
  "5. dimensions: עד 8 קווי מידה שמספר בסנטימטרים כתוב לידם, עם שתי הנקודות שהמידה נמדדת ביניהן. רק מספרים שכתובים בתוכנית.\n" +
  "6. north_deg: זווית חץ הצפון במעלות עם כיוון השעון מראש התמונה, או null אם אין חץ.\n" +
  "7. apartment_sqm ו-balcony_sqm: רק אם השטח כתוב בתוכנית. אחרת null.\n" +
  "8. אל תמציא: מה שלא רואים בתוכנית לא נכנס לתשובה.";

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

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

/** ארבע קואורדינטות מנורמלות (0-1000) לפיקסלים, חתוכות לגבולות התמונה. null אם חסר מספר. */
function boxPx(o: unknown, W: number, H: number): Box | null {
  const r = (o ?? {}) as Record<string, unknown>;
  const x1 = num(r.x1), y1 = num(r.y1), x2 = num(r.x2), y2 = num(r.y2);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
  const cx = (v: number) => Math.round(Math.min(1000, Math.max(0, v)) / 1000 * W);
  const cy = (v: number) => Math.round(Math.min(1000, Math.max(0, v)) / 1000 * H);
  return { x1: cx(x1), y1: cy(y1), x2: cx(x2), y2: cy(y2) };
}

const MAX_ROOMS = 40, MAX_WALLS = 220, MAX_OPENINGS = 12, MAX_SOLIDS = 8;

/**
 * מתשובת מודל הראייה למודל של הצופה.
 * זורק PlanReadError כשאין מה לבנות (פחות משני חדרים או פחות משלושה קירות).
 */
export function buildModel(raw: Record<string, unknown>, imgW: number, imgH: number): BuildResult {
  const W = Math.round(imgW), H = Math.round(imgH);
  if (!(W >= 200 && W <= 8000 && H >= 200 && H <= 8000)) {
    throw new PlanReadError("bad_image_size", "גודל התמונה אינו תקין");
  }
  const warnings: string[] = [];
  const minSide = Math.max(6, Math.round(Math.min(W, H) * 0.012));

  // ---- חדרים ----
  const rooms: Room[] = [];
  const labels: [string, number, number][] = [];
  const lamps: [number, number][] = [];
  const counts: Record<string, number> = {};
  for (const r of (Array.isArray(raw.rooms) ? raw.rooms : []).slice(0, MAX_ROOMS)) {
    const b = boxPx(r, W, H);
    if (!b) { warnings.push("חדר בלי קואורדינטות הושמט"); continue; }
    const x1 = Math.min(b.x1, b.x2), x2 = Math.max(b.x1, b.x2), y1 = Math.min(b.y1, b.y2), y2 = Math.max(b.y1, b.y2);
    if (x2 - x1 < minSide || y2 - y1 < minSide) { warnings.push("חדר קטן מדי הושמט"); continue; }
    const rr = r as Record<string, unknown>;
    const kindRaw = typeof rr.kind === "string" ? rr.kind : "other";
    const kind = ROOM_KINDS[kindRaw] ? kindRaw : "other";
    const def = ROOM_KINDS[kind];
    const given = typeof rr.name === "string" ? rr.name.trim().slice(0, 40) : "";
    counts[kind] = (counts[kind] ?? 0) + 1;
    const room: Room = { id: `${kind}${counts[kind]}`, name: given || def.name, f: def.f, r: [[x1, y1, x2, y2]] };
    if (def.nc) room.nc = 1;
    if (def.bal) room.bal = 1;
    if (def.svc) room.svc = 1;
    rooms.push(room);
    const cx = Math.round((x1 + x2) / 2), cy = Math.round((y1 + y2) / 2);
    labels.push([room.name, cx, cy]);
    if (!def.nc) lamps.push([cx, cy]);
  }
  if (rooms.length < 2) throw new PlanReadError("plan_unreadable", "לא זוהו חדרים בתוכנית");

  // ---- קירות ופתחים: רק קירות ישרים (אופקי או אנכי). אלכסון נזרק ונספר ----
  const walls: Wall[] = [];
  let diagonal = 0;
  for (const w of (Array.isArray(raw.walls) ? raw.walls : []).slice(0, MAX_WALLS)) {
    const b = boxPx(w, W, H);
    if (!b) continue;
    const dx = Math.abs(b.x2 - b.x1), dy = Math.abs(b.y2 - b.y1);
    if (Math.max(dx, dy) < minSide) continue;
    const ww = w as Record<string, unknown>;
    const t: Wall["t"] = ww.kind === "exterior" ? "ext" : ww.kind === "railing" ? "rail" : "int";
    const horiz = dy <= dx * 0.15, vert = dx <= dy * 0.15;
    if (!horiz && !vert) { diagonal++; continue; }
    const lo = horiz ? Math.min(b.x1, b.x2) : Math.min(b.y1, b.y2);
    const hi = horiz ? Math.max(b.x1, b.x2) : Math.max(b.y1, b.y2);
    const line = Math.round(horiz ? (b.y1 + b.y2) / 2 : (b.x1 + b.x2) / 2);
    const wall: Wall = horiz ? { h: line, a: lo, b: hi, t } : { v: line, a: lo, b: hi, t };
    // פתחים: מוטלים על ציר הקיר, נחתכים לאורכו, ממוינים ובלי חפיפה. במעקה אין פתחים
    if (t !== "rail") {
      const os: Opening[] = [];
      for (const o of (Array.isArray(ww.openings) ? ww.openings : []).slice(0, MAX_OPENINGS)) {
        const ob = boxPx(o, W, H);
        if (!ob) continue;
        const from = Math.max(lo, horiz ? Math.min(ob.x1, ob.x2) : Math.min(ob.y1, ob.y2));
        const to = Math.min(hi, horiz ? Math.max(ob.x1, ob.x2) : Math.max(ob.y1, ob.y2));
        if (to - from < Math.max(4, minSide / 2)) continue;
        const k = (o as Record<string, unknown>).kind;
        os.push([k === "door" ? "d" : k === "sliding" ? "s" : "w", from, to]);
      }
      os.sort((p, q) => p[1] - q[1]);
      const clean: Opening[] = [];
      for (const o of os) {
        const last = clean[clean.length - 1];
        if (last && o[1] < last[2]) continue;
        clean.push(o);
      }
      if (clean.length) wall.o = clean;
    }
    walls.push(wall);
  }
  if (diagonal) warnings.push(`${diagonal} קירות אלכסוניים לא נכנסו למודל ויש להוסיף אותם ידנית`);
  if (walls.length < 3) throw new PlanReadError("plan_unreadable", "לא זוהו קירות בתוכנית");

  // ---- גרעין הבניין ----
  const solids: Rect[] = [];
  for (const c of (Array.isArray(raw.core) ? raw.core : []).slice(0, MAX_SOLIDS)) {
    const b = boxPx(c, W, H);
    if (!b) continue;
    const x1 = Math.min(b.x1, b.x2), x2 = Math.max(b.x1, b.x2), y1 = Math.min(b.y1, b.y2), y2 = Math.max(b.y1, b.y2);
    if (x2 - x1 >= minSide && y2 - y1 >= minSide) solids.push([x1, y1, x2, y2]);
  }

  // ---- קנה מידה (ס"מ לפיקסל): ממידות כתובות, אחרת משטח כתוב, אחרת מרוחב דלת, ואחרת ברירת מחדל עם אזהרה ----
  const declaredArea = num(raw.apartment_sqm), declaredBalcony = num(raw.balcony_sqm);
  const ratios: number[] = [];
  for (const d of (Array.isArray(raw.dimensions) ? raw.dimensions : []).slice(0, 8)) {
    const cm = num((d as Record<string, unknown>)?.cm), b = boxPx(d, W, H);
    if (cm === null || !b || cm < 30 || cm > 3000) continue;
    const px = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
    if (px < minSide) continue;
    const ratio = cm / px;
    if (ratio > 0.2 && ratio < 12) ratios.push(ratio);
  }
  let scale = 0;
  let scaleSource: PlanSettings["scale_source"] = "default";
  if (ratios.length) {
    scale = median(ratios);
    scaleSource = "dimensions";
    const spread = Math.max(...ratios) / Math.min(...ratios);
    if (ratios.length >= 2 && spread > 1.25) warnings.push("המידות הכתובות בתוכנית אינן עקביות. יש לכייל את קנה המידה ידנית");
  } else if (declaredArea !== null && declaredArea > 15 && declaredArea < 1500) {
    const px2 = rooms.filter((r) => !r.bal && !r.svc)
      .reduce((s, r) => s + (r.r[0][2] - r.r[0][0]) * (r.r[0][3] - r.r[0][1]), 0);
    if (px2 > 0) { scale = Math.sqrt(declaredArea * 10000 / px2); scaleSource = "area"; }
  }
  if (!scale) {
    const doors = walls.flatMap((w) => (w.o ?? []).filter((o) => o[0] === "d").map((o) => o[2] - o[1]));
    if (doors.length) { scale = 85 / median(doors); scaleSource = "door"; }
  }
  if (!(scale > 0.2 && scale < 12)) {
    scale = 1.5;
    scaleSource = "default";
  }
  if (scaleSource !== "dimensions") warnings.push("לא נמצאו מידות כתובות בתוכנית. קנה המידה משוער ויש לכייל אותו לפי מידה ידועה");

  const northRaw = num(raw.north_deg);
  const north = northRaw === null ? 0 : Math.round(((northRaw + 180) % 360 + 360) % 360 - 180);
  if (northRaw === null) warnings.push("לא נמצא חץ צפון בתוכנית. יש להזין את כיוון הצפון");

  const model: PlanModel = { imgW: W, imgH: H, rooms, solids, walls, labels, lamps, furniture: autoFurnish(rooms, scale) };
  return {
    model,
    settings: {
      scale: Math.round(scale * 1000) / 1000,
      scale_source: scaleSource,
      north,
      declared_area_sqm: declaredArea !== null && declaredArea > 0 ? declaredArea : null,
      declared_balcony_sqm: declaredBalcony !== null && declaredBalcony > 0 ? declaredBalcony : null,
    },
    warnings,
  };
}

/**
 * ריהוט התחלתי, מינימלי ובמרכז החדר: נקודת פתיחה לעורך ולא עיצוב. פריט נכנס רק אם יש לו
 * מקום (לפי מידות החדר בס"מ), כדי שלא ייצא מיטה שבולטת מקיר.
 */
export function autoFurnish(rooms: Room[], scale: number): Furn[] {
  const out: Furn[] = [];
  for (const r of rooms) {
    const [x1, y1, x2, y2] = r.r[0];
    const cx = Math.round((x1 + x2) / 2), cy = Math.round((y1 + y2) / 2);
    const wCm = (x2 - x1) * scale, dCm = (y2 - y1) * scale;
    const kind = r.id.replace(/\d+$/, "");
    const wide = wCm >= dCm;
    const fits = (a: number, b: number) => (wide ? wCm >= a && dCm >= b : dCm >= a && wCm >= b);
    if ((kind === "master" || kind === "bedroom") && fits(260, 240)) out.push(["bed2", cx, cy, 0]);
    else if ((kind === "bedroom" || kind === "mamad") && fits(240, 160)) out.push(["bed1", cx, cy, wide ? 90 : 0]);
    else if (kind === "living" && fits(360, 300)) { out.push(["rug", cx, cy, wide ? 0 : 90]); out.push(["sofa", cx, cy, wide ? 0 : 90]); }
    else if (kind === "dining" && fits(320, 220)) out.push(["table", cx, cy, wide ? 0 : 90]);
    else if (kind === "wc" && fits(90, 120)) out.push(["toilet", cx, cy, 0]);
    else if (kind === "bath" && fits(180, 150)) out.push(["toilet", cx, cy, 0]);
    else if (kind === "balcony" && fits(300, 200)) out.push(["otable", cx, cy, wide ? 0 : 90]);
  }
  return out;
}

/** דגם מהופך מראה: היפוך על ציר אנכי (שמאל-ימין). */
export function mirrorModel(m: PlanModel): PlanModel {
  const W = m.imgW;
  const fx = (x: number) => W - x;
  return {
    imgW: m.imgW,
    imgH: m.imgH,
    rooms: m.rooms.map((r) => ({ ...r, r: r.r.map((q) => [fx(q[2]), q[1], fx(q[0]), q[3]] as Rect) })),
    solids: m.solids.map((q) => [fx(q[2]), q[1], fx(q[0]), q[3]] as Rect),
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
    furniture: m.furniture.map((f) => {
      const out: Furn = [f[0], fx(f[1]), f[2], ((360 - f[3]) % 360 + 360) % 360];
      if (f[4] !== undefined) out.push(f[4]);
      if (f[5] !== undefined) out.push(f[5]);
      return out;
    }),
  };
}

/** היפוך של הגדרות שתלויות בכיוון: הצפון מתהפך יחד עם התוכנית. */
export function mirrorSettings<T extends { north?: number }>(s: T): T {
  return typeof s.north === "number" ? { ...s, north: -s.north } : { ...s };
}
