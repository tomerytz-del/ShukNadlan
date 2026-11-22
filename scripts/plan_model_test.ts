// בדיקת הלוגיקה של קריאת תוכנית דירה (supabase/functions/_shared/plan-model.ts).
// קוד טהור, רץ ב-node:  node --experimental-strip-types scripts/plan_model_test.ts
import assert from "node:assert/strict";
import {
  autoFurnish, buildModel, mirrorModel, mirrorSettings, parsePlanReading, PlanReadError,
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
  apartment_sqm: 80,
  balcony_sqm: null,
});

test("parsePlanReading: JSON עטוף בגדר קוד ועם טקסט לפניו", () => {
  const obj = parsePlanReading('הנה התוצאה:\n```json\n{"rooms": []}\n```');
  assert.deepEqual(obj, { rooms: [] });
  assert.throws(() => parsePlanReading("אין כאן כלום"), PlanReadError);
  assert.throws(() => parsePlanReading("{ broken"), PlanReadError);
});

test("buildModel: חדרים, סוג לא מוכר, חדר קטן וחדר בלי מספרים", () => {
  const { model, warnings } = buildModel(sample(), W, H);
  assert.equal(model.rooms.length, 4);
  assert.deepEqual(model.rooms[0].r[0], [100, 80, 600, 400]);
  assert.equal(model.rooms[0].name, "סלון");
  assert.equal(model.rooms[1].name, "חדר שינה");
  assert.equal(model.rooms[1].f, "wood");
  assert.equal(model.rooms[2].bal, 1);
  assert.equal(model.rooms[2].nc, 1);
  assert.equal(model.rooms[3].id, "other1");
  assert.ok(warnings.some((w) => w.includes("קטן מדי")));
  assert.ok(warnings.some((w) => w.includes("בלי קואורדינטות")));
  // מנורה לכל חדר עם תקרה, לא למרפסת
  assert.equal(model.lamps.length, 3);
});

test("buildModel: קירות ישרים בלבד, פתחים נחתכים לקיר ולא חופפים, אין פתחים במעקה", () => {
  const { model, warnings } = buildModel(sample(), W, H);
  assert.equal(model.walls.length, 4);
  assert.ok(warnings.some((w) => w.includes("אלכסוניים")));
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
  assert.equal(settings.declared_area_sqm, 80);
  assert.equal(settings.declared_balcony_sqm, null);
});

test("buildModel: בלי מידות נופלים לשטח, אחר כך לרוחב דלת, ותמיד עם אזהרה", () => {
  const a = sample(); a.dimensions = [];
  const byArea = buildModel(a, W, H);
  assert.equal(byArea.settings.scale_source, "area");
  assert.ok(byArea.warnings.some((w) => w.includes("לכייל")));
  const d = sample(); d.dimensions = []; (d as { apartment_sqm: number | null }).apartment_sqm = null;
  const byDoor = buildModel(d, W, H);
  assert.equal(byDoor.settings.scale_source, "door");
  // חציון רוחבי הדלתות: 50 ו-80 פיקסלים -> 65, ו-85 ס"מ לדלת
  assert.equal(byDoor.settings.scale, Math.round(85 / 65 * 1000) / 1000);
});

test("buildModel: מידות לא עקביות מקבלות אזהרה, ואין צפון = אזהרה", () => {
  const s = sample();
  s.dimensions.push({ cm: 900, x1: 100, y1: 300, x2: 600, y2: 300 });
  (s as { north_deg: number | null }).north_deg = null;
  const { warnings, settings } = buildModel(s, W, H);
  assert.ok(warnings.some((w) => w.includes("אינן עקביות")));
  assert.ok(warnings.some((w) => w.includes("חץ צפון")));
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
});

test("mirrorModel: סיבוב ריהוט מתהפך ומידות נשמרות", () => {
  const { model } = buildModel(sample(), W, H);
  model.furniture = [["sofa", 300, 200, 90, 250], ["bed2", 700, 200, 0]];
  const m = mirrorModel(model);
  assert.deepEqual(m.furniture, [["sofa", 700, 200, 270, 250], ["bed2", 300, 200, 0]]);
});

console.log(`✓ ${passed} בדיקות של plan-model עברו`);
