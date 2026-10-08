// ============================================================================
// עיר המשרד בפתיחתו - agency-signup ו-create-own-agency
//
// משרד שנולד בלי עיר אינו נספר באף שוק מקומי, ובאתר הפומבי הוא מופיע בשוק
// ברירת המחדל (עפולה) גם אם הוא בנתניה. ‏20270115101000, docs/regional-pages.md
// ("משרד בלי עיר").
//
// שתי צורות, כמו בטופס (assets/agency-city.js):
//   - ‏`city_id` - בחירה מהרשימה הסגורה. נבדק שהוא קיים ב-cities.
//   - ‏`city_name` - "עיר אחרת…" בטקסט חופשי. מפוענח ב-city_id_for_name
//     (אותו נרמול של כל האתר, כולל city_aliases), ואם לא הוכר - null.
//
// ‏**null אינו כישלון:** הפתיחה ממשיכה. משרד בלי עיר יקבל אותה מהנכס הראשון
// שלו (טריגר properties_fill_agency_city), ועד אז הוא מופיע בפאנל השווקים
// וב-agency_no_city בסוכן התפעולי. טופס ישן שבמטמון, שאינו שולח עיר, אינו
// שובר הרשמה.
// ============================================================================

// deno-lint-ignore no-explicit-any
type Client = any;

/** כתובת המשרד מהטופס ("הרצל 24, עפולה") ל-agencies.address. רשות - טופס ישן
 *  שבמטמון אינו שולח אותה, והמשרד נפתח בלעדיה. */
export function cleanAgencyAddress(body: { address?: unknown } | null | undefined): string | null {
  const s = typeof body?.address === "string" ? body.address.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  return s || null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveAgencyCityId(
  supabase: Client,
  body: { city_id?: unknown; city_name?: unknown } | null | undefined,
): Promise<string | null> {
  const id = typeof body?.city_id === "string" ? body.city_id.trim() : "";
  if (UUID.test(id)) {
    const { data } = await supabase.from("cities").select("id").eq("id", id).maybeSingle();
    if (data?.id) return data.id as string;
  }
  const name = typeof body?.city_name === "string" ? body.city_name.trim().slice(0, 80) : "";
  if (name) {
    const { data } = await supabase.rpc("city_id_for_name", { p_name: name });
    if (typeof data === "string" && UUID.test(data)) return data;
  }
  return null;
}
