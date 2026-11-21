// ============================================================================
// האם היום יום עבודה בישראל (לשליחת תזכורות יזומות)
//
// ימים א'-ה', **לא שבת ולא חג**. ריצה שנדלגת אינה מאבדת דבר: הזכאות של התזכורת נקבעת לפי זמן שעבר, ולכן
// הריצה הבאה ביום חול תופסת אותה (docs/new-projects.md, "מדריך ההתחלה").
//
// החגים נגזרים מהלוח העברי של Intl, לא מרשימת תאריכים קשיחה שמתיישנת: ימי חג שבהם לא עובדים בלבד
// (ראש השנה, יום כיפור, יום ראשון ואחרון של סוכות ופסח, שבועות). חול המועד נחשב יום עבודה. ערב חג אינו חסום.
// ============================================================================

const IL_TZ = "Asia/Jerusalem";

// ‏(חודש עברי באנגלית של ICU, יום בחודש). ‏Tishri = תשרי. אדר/ניסן בשנה מעוברת אינם נוגעים כאן.
const NO_WORK: Array<[string, number]> = [
  ["Tishri", 1], ["Tishri", 2],   // ראש השנה
  ["Tishri", 10],                 // יום כיפור
  ["Tishri", 15], ["Tishri", 22], // סוכות, שמחת תורה / שמיני עצרת
  ["Nisan", 15], ["Nisan", 21],   // פסח (יום ראשון ושביעי)
  ["Sivan", 6],                   // שבועות
];

function hebrewDay(date: Date): { month: string; day: number } {
  const parts = new Intl.DateTimeFormat("en-u-ca-hebrew", { timeZone: IL_TZ, day: "numeric", month: "long" })
    .formatToParts(date);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = Number(parts.find((p) => p.type === "day")?.value ?? 0);
  return { month, day };
}

/** יום בשבוע בישראל: ‏0 = ראשון ... 6 = שבת. */
export function israelWeekday(date: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: IL_TZ, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

export function isIsraelHoliday(date: Date): boolean {
  const { month, day } = hebrewDay(date);
  return NO_WORK.some(([m, d]) => m === month && d === day);
}

export function isIsraelWorkday(date: Date = new Date()): boolean {
  const wd = israelWeekday(date);
  if (wd < 0 || wd >= 5) return false; // שישי ושבת
  return !isIsraelHoliday(date);
}
