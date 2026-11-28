// בדיקת הלוגיקה של קריאת תוכנית דירה (supabase/functions/_shared/plan-model.ts).
// קוד טהור, רץ ב-node:  node --experimental-strip-types scripts/plan_model_test.ts
import assert from "node:assert/strict";
import {
  autoFurnish, buildModel, imageSize, isPlanModel, mirrorModel, mirrorSettings, parseHints, parsePlanReading, PlanReadError,
} from "../supabase/functions/_shared/plan-model.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
}

// תמונה של 1000x800: קואורדינטה מנורמלת x היא פיקסל, ו-y מוכפלת ב-0.8
const W = 1000, H = 800;
const sample = () => ({
  rooms: [
    { kind: "living", name: "סלון", x1: 100, y1: 100, x2: 600, y2: 500 },
    { kind: "bedroom", x1: 600, y1: 100, x2: 900, y2: 500 },
    { kind: "balcony", x1: 100, y1: 500, x2: 600, y2: 700 },
    { kind: "spaceship", x1: 600, y1: 500, x2: 900, y2: 700 },
    { kind: "wc", x1: 10, y1: 10, x2: 11, y2: 11 },
    { kind: "bath", x1: "x", y1: 0, x2: 5, y2: 5 },
  ],
  walls: [
    { kind: "exterior", x1: 100, y1: 100, x2: 900, y2: 100, openings: [
      { kind: "window", x1: 200, y1: 100, x2: 300, y2: 100 },
      { kind: "window", x1: 250, y1: 100, x2: 350, y2: 100 },
      { kind: "door", x1: 50, y1: 100, x2: 150, y2: 100 },
    ] },
    { kind: "interior", x1: 600, y1: 500, x2: 600, y2: 100, openings: [{ kind: "door", x1: 600, y1: 200, x2: 600, y2: 300 }] },
    { kind: "railing", x1: 100, y1: 700, x2: 600, y2: 700, openings: [{ kind: "door", x1: 200, y1: 700, x2: 300, y2: 700 }] },
    { kind: "interior", x1: 100, y1: 100, x2: 400, y2: 400 },
    { kind: "exterior", x1: 900, y1: 100, x2: 900, y2: 700 },
  ],
  core: [{ x1: 700, y1: 550, x2: 800, y2: 650 }],
  dimensions: [{ cm: 500, x1: 100, y1: 300, x2: 600, y2: 300 }, { cm: 99999, x1: 0, y1: 0, x2: 10, y2: 10 }],
  north_deg: 325,
  apartment_sqm: 30,   // תואם למידה הכתובה (1 ס"מ לפיקסל): מידה שסותרת את השטח נדחית
  balcony_sqm: null,
});

test("parsePlanReading: JSON עטוף בגדר קוד ועם טקסט לפניו", () => {
  const obj = parsePlanReading('הנה התוצאה:\n```json\n{"rooms": []}\n```');
  assert.deepEqual(obj, { rooms: [] });
  assert.throws(() => parsePlanReading("אין כאן כלום"), PlanReadError);
  assert.throws(() => parsePlanReading("{ broken"), PlanReadError);
});

test("buildModel: חדרים, סוג לא מוכר, חדר קטן וחדר בלי מספרים", () => {
  const { model, settings } = buildModel(sample(), W, H);
  assert.equal(model.rooms.length, 4);
  assert.deepEqual(model.rooms[0].r[0], [100, 80, 600, 400]);
  assert.equal(model.rooms[0].name, "סלון");
  assert.equal(model.rooms[1].name, "חדר שינה");
  assert.equal(model.rooms[1].f, "wood");
  assert.equal(model.rooms[2].bal, 1);
  assert.equal(model.rooms[2].nc, 1);
  assert.equal(model.rooms[3].id, "other1");
  // החדר הקטן והחדר בלי מספרים נזרקו ונספרו בקוד אחד
  assert.deepEqual(settings.checks.find((c) => c.code === "rooms_dropped"), { code: "rooms_dropped", n: 2 });
  // מנורה לכל חדר עם תקרה, לא למרפסת
  assert.equal(model.lamps.length, 3);
});

test("buildModel: קירות ישרים בלבד, פתחים נחתכים לקיר ולא חופפים, אין פתחים במעקה", () => {
  const { model, settings } = buildModel(sample(), W, H);
  assert.equal(model.walls.length, 4);
  assert.deepEqual(settings.checks.find((c) => c.code === "diagonal_walls"), { code: "diagonal_walls", n: 1 });
  const top = model.walls[0];
  assert.equal(top.h, 80);
  assert.equal(top.t, "ext");
  // הדלת נחתכה לתחילת הקיר (100), והחלון החופף השני נזרק
  assert.deepEqual(top.o, [["d", 100, 150], ["w", 200, 300]]);
  const inner = model.walls[1];
  assert.equal(inner.v, 600);
  assert.deepEqual([inner.a, inner.b], [80, 400]);
  assert.deepEqual(inner.o, [["d", 160, 240]]);
  const rail = model.walls[2];
  assert.equal(rail.t, "rail");
  assert.equal(rail.o, undefined);
  assert.deepEqual(model.solids, [[700, 440, 800, 520]]);
});

test("buildModel: קנה מידה ממידה כתובה, וצפון מנורמל לטווח -180 עד 180", () => {
  const { settings } = buildModel(sample(), W, H);
  assert.equal(settings.scale, 1);
  assert.equal(settings.scale_source, "dimensions");
  assert.equal(settings.north, -35);
  assert.equal(settings.declared_area_sqm, 30);
  assert.equal(settings.declared_balcony_sqm, null);
  assert.ok(!settings.checks.some((c) => c.code === "scale_estimated" || c.code === "no_north"));
});

test("buildModel: בלי מידות נופלים לשטח, אחר כך לרוחב דלת, ותמיד עם אזהרה", () => {
  const a = sample(); a.dimensions = [];
  const byArea = buildModel(a, W, H);
  assert.equal(byArea.settings.scale_source, "area");
  assert.deepEqual(byArea.settings.checks.find((c) => c.code === "scale_estimated"), { code: "scale_estimated", source: "area" });
  const d = sample(); d.dimensions = []; (d as { apartment_sqm: number | null }).apartment_sqm = null;
  const byDoor = buildModel(d, W, H);
  assert.equal(byDoor.settings.scale_source, "door");
  // חציון רוחבי הדלתות: 50 ו-80 פיקסלים -> 65, ו-85 ס"מ לדלת
  assert.equal(byDoor.settings.scale, Math.round(85 / 65 * 1000) / 1000);
  // בלי מידות, בלי שטח ובלי דלתות: ברירת מחדל, ואז לא מרהטים (אין לדעת מה נכנס לחדר)
  const n = sample(); n.dimensions = []; (n as { apartment_sqm: number | null }).apartment_sqm = null;
  n.walls.forEach((w) => { (w as { openings?: unknown[] }).openings = []; });
  const byDefault = buildModel(n, W, H);
  assert.equal(byDefault.settings.scale_source, "default");
  assert.deepEqual(byDefault.model.furniture, []);
  assert.ok(byDoor.model.furniture.length > 0);
});

test("buildModel: מידות לא עקביות מקבלות אזהרה, ואין צפון = אזהרה", () => {
  const s = sample();
  s.dimensions.push({ cm: 900, x1: 100, y1: 300, x2: 600, y2: 300 });
  (s as { north_deg: number | null }).north_deg = null;
  const { settings } = buildModel(s, W, H);
  assert.ok(settings.checks.some((c) => c.code === "scale_inconsistent"));
  assert.ok(settings.checks.some((c) => c.code === "no_north"));
  assert.equal(settings.north, 0);
});

test("buildModel: תוכנית שאי אפשר לבנות ממנה נכשלת בקוד ברור", () => {
  assert.throws(() => buildModel({ rooms: [], walls: [] }, W, H), (e: unknown) => e instanceof PlanReadError && e.code === "plan_unreadable");
  const noWalls = sample(); noWalls.walls = [];
  assert.throws(() => buildModel(noWalls, W, H), PlanReadError);
  assert.throws(() => buildModel(sample(), 50, 50), (e: unknown) => e instanceof PlanReadError && e.code === "bad_image_size");
});

test("autoFurnish: פריט נכנס רק כשיש לו מקום", () => {
  const big = autoFurnish([{ id: "bedroom1", name: "x", f: "wood", r: [[0, 0, 400, 300]] }], 1);
  assert.deepEqual(big, [["bed2", 200, 150, 0]]);
  const tiny = autoFurnish([{ id: "bedroom1", name: "x", f: "wood", r: [[0, 0, 100, 100]] }], 1);
  assert.deepEqual(tiny, []);
});

test("mirrorModel: היפוך כפול מחזיר את המקור, והיפוך אחד נכון", () => {
  const { model } = buildModel(sample(), W, H);
  const m = mirrorModel(model);
  assert.deepEqual(m.rooms[0].r[0], [400, 80, 900, 400]);
  assert.equal(m.walls[1].v, 400);
  assert.deepEqual(m.walls[0].o, [["w", 700, 800], ["d", 850, 900]]);
  assert.deepEqual([m.walls[0].a, m.walls[0].b], [100, 900]);
  assert.deepEqual(m.solids, [[200, 440, 300, 520]]);
  assert.deepEqual(mirrorModel(m), model);
  assert.equal(mirrorSettings({ north: -35, scale: 1 }).north, 35);
  // הצפון נשאר בטווח, ומראה של מראה אינו מסומן כמראה
  assert.equal(mirrorSettings({ north: -180 }).north, -180);
  const once = mirrorSettings({ north: 10 });
  assert.equal(once.mirrored, true);
  assert.equal(mirrorSettings(once).mirrored, false);
  assert.equal(mirrorSettings(once).north, 10);
});

test("mirrorModel: סיבוב ריהוט מתהפך ומידות נשמרות", () => {
  const { model } = buildModel(sample(), W, H);
  model.furniture = [["sofa", 300, 200, 90, 250], ["bed2", 700, 200, 0]];
  const m = mirrorModel(model);
  assert.deepEqual(m.furniture, [["sofa", 700, 200, 270, 250], ["bed2", 300, 200, 0]]);
});

test("buildModel: פתח שבא אחרי פתח שנזרק נבדק מול האחרון שנשמר", () => {
  const s = sample();
  s.walls[0].openings = [
    { kind: "window", x1: 200, y1: 100, x2: 400, y2: 100 },
    { kind: "window", x1: 250, y1: 100, x2: 300, y2: 100 },
    { kind: "door", x1: 320, y1: 100, x2: 380, y2: 100 },
    { kind: "door", x1: 500, y1: 100, x2: 560, y2: 100 },
  ];
  assert.deepEqual(buildModel(s, W, H).model.walls[0].o, [["w", 200, 400], ["d", 500, 560]]);
});

test("buildModel: שטח שנקרא שגוי נופל לרוחב הדלת, לא לברירת המחדל", () => {
  // תמונה גדולה ושטח של 16 מ"ר: קנה מידה של 0.18 ס"מ לפיקסל, מחוץ לטווח הסביר
  const s = sample(); s.dimensions = []; (s as { apartment_sqm: number | null }).apartment_sqm = 16;
  const r = buildModel(s, 4000, 3200);
  assert.equal(r.settings.scale_source, "door");
});

test("isPlanModel: מודל שנבנה עובר, jsonb שנערך ונשבר לא", () => {
  const { model } = buildModel(sample(), W, H);
  assert.equal(isPlanModel(model), true);
  assert.equal(isPlanModel({ ...model, walls: "x" }), false);
  assert.equal(isPlanModel({}), false);
  assert.equal(isPlanModel(null), false);
});

test("imageSize: PNG, JPEG ו-WebP מהכותרת, וקובץ שאינו תמונה", () => {
  const pad = (a: number[]) => Uint8Array.from([...a, ...new Array(40).fill(0)]);
  // PNG 1600x1354
  const png = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x06, 0x40, 0, 0, 0x05, 0x4a]);
  assert.deepEqual(imageSize(png), { w: 1600, h: 1354, mime: "image/png" });
  // JPEG: מקטע APP0 באורך 16 ואז SOF0 עם גובה 1354 ורוחב 1600
  const jpg = pad([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x05, 0x4a, 0x06, 0x40]);
  assert.deepEqual(imageSize(jpg), { w: 1600, h: 1354, mime: "image/jpeg" });
  // WebP מורחב (VP8X): רוחב וגובה פחות אחת, 24 ביט little-endian
  const webp = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, 0x3f, 0x06, 0, 0x49, 0x05, 0]);
  assert.deepEqual(imageSize(webp), { w: 1600, h: 1354, mime: "image/webp" });
  assert.equal(imageSize(pad([1, 2, 3, 4])), null);
  assert.equal(imageSize(Uint8Array.from([0xff, 0xd8])), null);
});


// הקריאה האמיתית הראשונה (פנטהאוז, 23.11.2026), בפיקסלים של תמונה 1080x908: 11 חדרים, קירות
// חיצוניים בלבד, "סלון" שעוטף את כל הדירה, ומידות שנתנו 4.6 ס"מ לפיקסל. הסיור יצא אולם אחד.
const PH_W = 1080, PH_H = 908;
const phNorm = (x1: number, y1: number, x2: number, y2: number) =>
  ({ x1: x1 * 1000 / PH_W, y1: y1 * 1000 / PH_H, x2: x2 * 1000 / PH_W, y2: y2 * 1000 / PH_H });
const penthouse = () => ({
  rooms: ([["living", 299, 63, 715, 719], ["master", 131, 63, 298, 229], ["bath", 131, 246, 255, 328], ["storage", 252, 308, 399, 386],
    ["mamad", 252, 392, 402, 526], ["service", 239, 528, 309, 652], ["bath", 310, 576, 377, 705], ["bedroom", 377, 576, 521, 706],
    ["bedroom", 521, 576, 666, 706], ["balcony", 727, 63, 997, 721], ["balcony", 94, 461, 438, 793]] as [string, number, number, number, number][])
    .map(([kind, a, b, c, d]) => ({ kind, ...phNorm(a, b, c, d) })),
  walls: [
    { kind: "exterior", ...phNorm(131, 63, 715, 63), openings: [{ kind: "window", ...phNorm(150, 63, 220, 63) }] },
    { kind: "exterior", ...phNorm(715, 63, 715, 721), openings: [{ kind: "sliding", ...phNorm(715, 106, 715, 337) }] },
    { kind: "exterior", ...phNorm(131, 63, 131, 328) },
    { kind: "exterior", ...phNorm(377, 706, 666, 706), openings: [{ kind: "window", ...phNorm(411, 706, 454, 706) }] },
    { kind: "railing", ...phNorm(997, 63, 997, 721) },
  ],
  dimensions: [{ cm: 979, ...phNorm(299, 80, 512, 80) }],   // הותאמה לקטע קצר מדי: 4.6 ס"מ לפיקסל
  apartment_sqm: 156.46, balcony_sqm: 135.2, north_deg: 30,
});

test("buildModel: בלי קירות פנימיים הם משוחזרים מהחדרים, ולכל חדר יש דלת", () => {
  const { model, settings } = buildModel(penthouse(), PH_W, PH_H);
  assert.ok(settings.checks.some((c) => c.code === "walls_inferred"));
  assert.ok(model.walls.filter((w) => w.t === "int").length >= 8, "קירות פנימיים");
  const doors = model.walls.flatMap((w) => (w.o ?? []).filter((o) => o[0] === "d"));
  assert.ok(doors.length >= 7, `דלתות: ${doors.length}`);
  // אין קיר באורך אפס ואין פתח שיוצא מהקיר
  for (const w of model.walls) {
    assert.ok(w.b > w.a);
    for (const o of w.o ?? []) assert.ok(o[1] >= w.a && o[2] <= w.b && o[2] > o[1]);
  }
  // החלון והוויטרינה שנקראו עברו לקירות המשוחזרים
  assert.ok(model.walls.some((w) => (w.o ?? []).some((o) => o[0] === "s")));
  assert.ok(model.walls.some((w) => (w.o ?? []).some((o) => o[0] === "w")));
});

test("buildModel: חדרים חופפים אינם חופפים אחרי השחזור, והסלון אינו בולע את חדרי השינה", () => {
  const { model } = buildModel(penthouse(), PH_W, PH_H);
  const rects = model.rooms.flatMap((r) => r.r.map((q) => ({ id: r.id, q })));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i].q, b = rects[j].q;
    assert.ok(!(a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]), `${rects[i].id} חופף את ${rects[j].id}`);
  }
  assert.ok(model.rooms.find((r) => r.id === "living1")!.r.length > 1);
});

test("buildModel: מידה כתובה שסותרת את השטח הכתוב נדחית, וקנה המידה נגזר מהשטח", () => {
  const { settings } = buildModel(penthouse(), PH_W, PH_H);
  assert.equal(settings.scale_source, "area");
  assert.ok(settings.scale > 1.6 && settings.scale < 2.7, String(settings.scale));
  assert.ok(settings.checks.some((c) => c.code === "scale_inconsistent"));
});

test("buildModel: רווח בעובי קיר בין חדרים אינו משאיר אותם אטומים", () => {
  // מרווחים של 25 פיקסלים (מעל tol): בלי בליעת הרווח יצאו 12 קירות חיצוניים ואף דלת
  const raw = {
    rooms: [{ kind: "living", x1: 100, y1: 100, x2: 500, y2: 900 }, { kind: "mamad", x1: 525, y1: 100, x2: 900, y2: 450 },
      { kind: "bedroom", x1: 525, y1: 475, x2: 900, y2: 900 }],
    walls: [{ kind: "exterior", x1: 100, y1: 100, x2: 900, y2: 100 }, { kind: "exterior", x1: 900, y1: 100, x2: 900, y2: 900 },
      { kind: "exterior", x1: 100, y1: 900, x2: 900, y2: 900 }, { kind: "exterior", x1: 100, y1: 100, x2: 100, y2: 900 }],
    apartment_sqm: 90,
  };
  const { model } = buildModel(raw, 1000, 1000);
  assert.ok(model.walls.some((w) => w.t === "int"));
  assert.equal(model.walls.flatMap((w) => (w.o ?? []).filter((o) => o[0] === "d")).length, 2);
});

test("buildModel: ויטרינה של חדר אל המרפסת אינה פוטרת אותו מדלת אל הדירה, והתוויות לפי החדרים שנשארו", () => {
  const raw = {
    rooms: [{ kind: "living", x1: 100, y1: 100, x2: 600, y2: 500 }, { kind: "bedroom", x1: 600, y1: 100, x2: 900, y2: 500 },
      { kind: "balcony", x1: 600, y1: 500, x2: 900, y2: 700 }, { kind: "corridor", x1: 100, y1: 100, x2: 600, y2: 500 }],
    walls: [{ kind: "exterior", x1: 100, y1: 100, x2: 900, y2: 100 },
      { kind: "exterior", x1: 600, y1: 500, x2: 900, y2: 500, openings: [{ kind: "sliding", x1: 650, y1: 500, x2: 850, y2: 500 }] },
      { kind: "exterior", x1: 100, y1: 100, x2: 100, y2: 500 }],
    apartment_sqm: 60,
  };
  const { model, settings } = buildModel(raw, 1000, 1000);
  const inner = model.walls.find((w) => w.t === "int" && w.v === 600)!;
  assert.ok((inner.o ?? []).some((o) => o[0] === "d"), "דלת בין חדר השינה לסלון");
  // שני חדרים באותו מלבן: אחד ירד, נספר, ואין לו תווית או מנורה יתומה
  assert.equal(model.rooms.length, 3);
  assert.equal(model.labels.length, 3);
  assert.deepEqual(settings.checks.find((c) => c.code === "rooms_dropped"), { code: "rooms_dropped", n: 1 });
});

test("buildModel: מטבח ופינת אוכל בחלל פתוח הם אזורים: ריהוט ותווית, בלי קירות", () => {
  const raw = {
    rooms: [{ kind: "living", x1: 100, y1: 100, x2: 800, y2: 600 }, { kind: "bedroom", x1: 800, y1: 100, x2: 950, y2: 600 },
      { kind: "kitchen", x1: 100, y1: 100, x2: 350, y2: 500 }],   // "חדר" שכולו בתוך הסלון: הופך לאזור
    walls: [{ kind: "exterior", x1: 100, y1: 100, x2: 950, y2: 100 }, { kind: "exterior", x1: 100, y1: 100, x2: 100, y2: 600 },
      { kind: "interior", x1: 800, y1: 100, x2: 800, y2: 600 }, { kind: "exterior", x1: 100, y1: 600, x2: 950, y2: 600 }],
    zones: [{ kind: "dining", x1: 400, y1: 150, x2: 560, y2: 420 }],
    entrance: { x1: 500, y1: 600, x2: 560, y2: 600 },
    apartment_sqm: 100,
  };
  const { model } = buildModel(raw, 1000, 1000);
  assert.equal(model.rooms.length, 2, "המטבח אינו חדר");
  const kit = model.furniture.find((f) => f[0] === "kitchen")!;
  assert.ok(kit, "יחידת מטבח");
  assert.equal(kit[3], 270, "גב אל הקיר השמאלי");
  assert.ok(model.furniture.some((f) => f[0] === "table"));
  assert.ok(model.furniture.filter((f) => f[0] === "chair").length >= 4);
  assert.ok(model.labels.some((l) => l[0] === "מטבח") && model.labels.some((l) => l[0] === "פינת אוכל"));
  // דלת הכניסה נכנסה לקיר התחתון, והתווית "כניסה" בצד של הדירה (מעל הקיר)
  const bottom = model.walls.find((w) => w.h === 600)!;
  assert.ok((bottom.o ?? []).some((o) => o[0] === "d"));
  const entry = model.labels.find((l) => l[0] === "כניסה")!;
  assert.ok(entry && entry[2] < 600);
});

test("buildModel: גרעין הבניין נחצב מהסלון שעוטף אותו, ויש סביבו קיר", () => {
  const raw = penthouse() as Record<string, unknown>;
  raw.core = [phNorm(400, 307, 670, 528)];
  const { model } = buildModel(raw, PH_W, PH_H);
  assert.equal(model.solids.length, 1);
  const s = model.solids[0], cxm = (s[0] + s[2]) / 2, cym = (s[1] + s[3]) / 2;
  assert.ok(!model.rooms.some((r) => r.r.some((q) => cxm > q[0] && cxm < q[2] && cym > q[1] && cym < q[3])), "אין רצפה בתוך הגרעין");
  assert.ok(model.walls.some((w) => w.t === "ext" && w.h !== undefined && Math.abs(w.h - s[1]) <= 20 && w.a < cxm && w.b > cxm), "קיר בראש הגרעין");
});

test("parseHints: טווחים, חצי חדר, וערך שגוי הוא null ולא שגיאה", () => {
  assert.deepEqual(parseHints({ apartment_sqm: 100.88, rooms: 4 }), { apartment_sqm: 100.9, rooms: 4 });
  assert.deepEqual(parseHints({ apartment_sqm: "120", rooms: 3.4 }), { apartment_sqm: 120, rooms: 3.5 });
  assert.deepEqual(parseHints({ apartment_sqm: 5, rooms: 40 }), null);
  assert.deepEqual(parseHints({ apartment_sqm: 80, rooms: 0 }), { apartment_sqm: 80, rooms: null });
  assert.equal(parseHints(null), null);
  assert.equal(parseHints("x"), null);
});

test("buildModel: שטח מהטופס ממלא חסר, ושטח כתוב בתוכנית גובר עליו", () => {
  const d = sample(); d.dimensions = []; (d as { apartment_sqm: number | null }).apartment_sqm = null;
  const viaHint = buildModel(d, W, H, { apartment_sqm: 16, rooms: null });
  const viaPlan = buildModel({ ...d, apartment_sqm: 16 }, W, H);
  assert.equal(viaHint.settings.declared_area_sqm, 16);
  assert.equal(viaHint.settings.scale, viaPlan.settings.scale);
  const win = buildModel(sample(), W, H, { apartment_sqm: 99, rooms: null });
  assert.equal(win.settings.declared_area_sqm, 30);
});

test("buildModel: מספר חדרים שהוצהר מסמן 'בדקו' רק בהפרש של חדר שלם, ולא משנה את המודל", () => {
  // בדוגמה: סלון וחדר שינה נספרים (המרפסת והחלל הלא מוכר לא)
  const at = (rooms: number) => buildModel(sample(), W, H, { apartment_sqm: null, rooms }).settings.checks.find((c) => c.code === "rooms_mismatch");
  assert.deepEqual(at(4), { code: "rooms_mismatch", declared: 4, found: 2 });
  assert.equal(at(2), undefined);
  assert.equal(at(2.5), undefined);
  assert.equal(buildModel(sample(), W, H, { apartment_sqm: null, rooms: 4 }).model.rooms.length, buildModel(sample(), W, H).model.rooms.length);
});

test("buildModel: 'לא היה ברור' מנוקה (בלי HTML ובלי מקף ארוך), מוגבל ל-6, ובלי כפילויות", () => {
  const raw = sample() as Record<string, unknown>;
  raw.uncertain = [
    { about: "wall", note: "קיר <b>מוסתר</b> מאחורי הארון \u2014 לא בטוח" },
    { about: "wall", note: "קיר <b>מוסתר</b> מאחורי הארון \u2014 לא בטוח" },
    { about: "spaceship", note: "x".repeat(300) },
    { note: "   " }, { about: "opening", note: "" }, 5, null,
    ...Array.from({ length: 8 }, (_, i) => ({ about: "room", note: `חלל ${i}` })),
  ];
  const c = buildModel(raw, W, H).settings.checks.find((k) => k.code === "model_uncertain") as { notes: string[] };
  assert.ok(c && c.notes.length <= 6);
  assert.equal(c.notes[0], "קיר: קיר b מוסתר /b מאחורי הארון - לא בטוח");
  assert.ok(c.notes.every((n) => !/[<>\u2014\u2013]/.test(n)), "בלי HTML ובלי מקף ארוך");
  assert.ok(c.notes.every((n) => n.length <= 130));
  assert.equal(new Set(c.notes).size, c.notes.length);
  const clean = sample() as Record<string, unknown>; clean.uncertain = [];
  assert.equal(buildModel(clean, W, H).settings.checks.some((k) => k.code === "model_uncertain"), false);
});

console.log(`✓ ${passed} בדיקות של plan-model עברו`);
