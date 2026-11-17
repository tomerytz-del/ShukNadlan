// שם שכונה שמותר להראות לגולש/ת.
//
// neighborhoods.is_planned הוא אזור תכנון (למשל "B1 אזור בתכנון"): המצולע
// נשאר במסד, והשם אינו כותרת, אינו שורת מיקום ואינו הודעת וואטסאפ.
// אין כאן בדיקת מחרוזת. השם עצמו יכול להישאר בקוד התכנוני.

export function neighborhoodPublicName(
  row: { name?: string | null; is_planned?: boolean | null } | null | undefined,
): string {
  if (!row || row.is_planned) return "";
  return String(row.name || "").replace(/\s+/g, " ").trim();
}
