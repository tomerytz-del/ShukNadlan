// ============================================================================
// השם הרשמי של רחוב, מרשימת הרחובות של העירייה
//
// ## מה נמצא (12.10.2026)
//
// בעפולה 37 נכסים פעילים בלי פין, ובהם 10 כתובות אמיתיות שהשכבה ענתה
// עליהן "לא נמצא" שלוש פעמים ויצאו מהתור לתמיד: "יוספטל 1", "פרץ ציוני 3"
// (שלוש מודעות), "אוסישקין 61". השכבה רושמת את השם המלא - "גיורא יוספטל",
// "הרב פרץ ציוני", "מנחם אוסישקין" - והשאילתה היא PropertyIsEqualTo. אף ציר
// ב-streetVariants אינו מוסיף שם פרטי או תואר, ובצדק: הוא מייצר צורות
// מהשם עצמו, והשם המלא אינו נגזר מהקצר.
//
// הרשימה הרשמית כבר במסד (‏`street_registry`, ‏`source = 'gis'`, מסונכרנת
// מאותה שכבה - docs/street-registry.md). הטופס ב-CRM בוחר ממנה, אבל
// הבוט, הייבוא ושורות ישנות לא עוברים שם. כאן היא מתרגמת את השם שהוקלד
// לשם שהשכבה מכירה, **לפני** השאילתה.
//
// ## הכלל, ולמה הוא צר
//
// כל מילה שהוקלדה מופיעה בשם הרשמי, באותו סדר (‏"הרב לוין" ב-"הרב נחום
// לוין"), ו**רק שם רשמי אחד** עונה על זה. שניים - לא מנחשים. בלי מרחק
// עריכה: רחוב אחר עם אותו מספר בית הוא פין שגוי שנראה מושלם, וזה גרוע
// מאין פין (‏docs/property-map.md). השכבה עדיין צריכה לאשר את מספר הבית
// ברחוב הרשמי, ולכן התרגום לבדו אינו מייצר פין.
// ============================================================================

const PREFIX_WORDS = new Set(["רחוב", "רח", "שדרות", "שד", "סמטת", "סמ", "דרך"]);

function normWords(s: string): string[] {
  return String(s || "")
    .replace(/["'״׳`.]/g, "")
    .split(/[\s\-–]+/)
    .filter(Boolean);
}

function loose(w: string): string {
  return (w.length > 3 && w.startsWith("ה") ? w.slice(1) : w).replace(/יי/g, "י").replace(/וו/g, "ו");
}

function isSubsequence(needle: string[], hay: string[]): boolean {
  let i = 0;
  for (const w of hay) if (i < needle.length && w === needle[i]) i++;
  return i === needle.length;
}

/**
 * השם הרשמי שהשכבה מכירה, או `null` כשאין צורך בתרגום (השם כבר רשמי)
 * או כשאין התאמה אחת ויחידה.
 */
export function resolveOfficialStreet(typed: string, official: string[]): string | null {
  const raw = String(typed || "").trim();
  const t = normWords(raw);
  if (!t.length) return null;
  // כבר רשמי, אות באות - אין מה לתרגם
  if (official.includes(raw)) return null;

  const tKey = t.join(" ");
  const sorted = (ws: string[]) => [...ws].sort().join(" ");
  const core = t.filter((w) => !PREFIX_WORDS.has(w));
  if (!core.length) return null;

  // לפי הסדר מהצר לרחב, ועוצרים בשלב הראשון שיש בו התאמה אחת ויחידה.
  // שלב שיש בו שתיים - לא מנחשים, וגם לא ממשיכים לשלב רחב יותר.
  const stages: Array<(ow: string[]) => boolean> = [
    // גרשיים בלבד: "שז"ר" מול "שז''ר", "ביל"ו" מול "ביל''ו". נראים זהים,
    // והשכבה משווה תו-תו - בלי השלב הזה הם נדחים לנצח.
    (ow) => ow.join(" ") === tKey,
    // סדר המילים: "המלכה אסתר" הוא "אסתר המלכה"
    (ow) => ow.length === t.length && sorted(ow) === tKey.split(" ").sort().join(" "),
    // יו"ד/וי"ו כפולה וה"א הידיעה בכל מילה: "הנשיא ויצמן" / "הנשיא וייצמן",
    // "הרוגי מלכות" / "הרוגי המלכות". ‏streetVariants מכפיל יו"ד בכל המילים
    // בבת אחת ("הנשייא וייצמן"), ולכן לא מגיע לצורה הנכונה.
    (ow) => ow.length === t.length && ow.map(loose).join(" ") === t.map(loose).join(" "),
    // מילים שחסרות בהקלדה: "יוספטל" ב-"גיורא יוספטל", "הרב לוין" ב-"הרב נחום
    // לוין", ובלי תחילית - "ארלוזורוב" ב-"שדרות ארלוזורוב"
    (ow) => isSubsequence(t, ow) || isSubsequence(core, ow.filter((w) => !PREFIX_WORDS.has(w))),
    // מילה שנוספה בהקלדה: "הרב אשר קירשטיין" מול "הרב קירשטיין". רק לשם
    // רשמי של שתי מילים ומעלה - שם של מילה אחת היה נבלע בכל הקלדה שמכילה אותו.
    (ow) => ow.length >= 2 && isSubsequence(ow, t),
  ];
  for (const stage of stages) {
    const hits = official.filter((o) => stage(normWords(o)));
    if (hits.length === 1) return hits[0] === raw ? null : hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}

// מטמון לכל isolate, כמו loadCitySource: רשימת רחובות משתנה בסנכרון לילי,
// והסורק קורא לכאן 25 פעם בסבב.
const cache = new Map<string, { at: number; names: string[] }>();
const TTL_MS = 10 * 60 * 1000;

// deno-lint-ignore no-explicit-any
type SupabaseLike = { from: (t: string) => any };

/**
 * שמות הרחובות הרשמיים בעיר. רשימה ריקה כשאין כאלה או כשהשליפה נכשלה -
 * **ולא זריקה**: בלי הרשימה השאילתה פשוט רצה עם השם שהוקלד, כמו קודם.
 * כשל כאן אינו "אין כתובת כזו" ואינו מגיע למונה.
 */
export async function loadOfficialStreets(supabase: SupabaseLike, city: string): Promise<string[]> {
  const key = String(city || "").trim();
  if (!key) return [];
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.names;
  try {
    const { data, error } = await supabase
      .from("street_registry")
      .select("name")
      .eq("city", key)
      .eq("source", "gis")
      .eq("active", true);
    if (error) throw error;
    const names = (data || []).map((r: { name: string }) => String(r.name));
    cache.set(key, { at: Date.now(), names });
    return names;
  } catch (err) {
    console.warn("loadOfficialStreets failed", err);
    return [];
  }
}

/** הנוחות לקוראים: השם הרשמי לשאילתה, או `null`. */
export async function officialStreetFor(
  supabase: SupabaseLike | null | undefined,
  city: string,
  street: string,
): Promise<string | null> {
  if (!supabase) return null;
  return resolveOfficialStreet(street, await loadOfficialStreets(supabase, city));
}
