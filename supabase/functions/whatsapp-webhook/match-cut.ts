// ---------------------------------------------------------------------------
// חיתוך רשימת התאמות (client_matches, property_matches)
//
// עד 12.10.2026 שני הכלים ביקשו מהמסד בדיוק limit שורות והחזירו count = כמה
// חזרו. הבוט כתב "5 התאמות" ללקוח שהיו לו 12, ושש מהן ב-100%: השישית -
// מודעה 1037, הזולה מכולן ללקוח שאמר "פחות עדיף" - נחתכה רק כי פורסמה
// ראשונה, כי בין ציונים שווים הסדר הוא תאריך הפרסום.
//
// לכן: מושכים עד התקרה של המסד (30), ו**לא חותכים באמצע ציון** - כשהאחרונה
// שהוצגה שווה לבאות אחריה, גם הן מוצגות, עד MATCH_SHOW_MAX. ‏total הוא המספר
// האמיתי, ו-more_note אומר למודל מה לא הוצג.
// ---------------------------------------------------------------------------
export const MATCH_FETCH_CAP = 30;   // ‏v_cap בשתי פונקציות המסד
export const MATCH_SHOW_MAX = 15;

export interface MatchCut<T> {
  shown: T[];
  total: number;
  capped: boolean;
  tiesAdded: number;
  sameScoreHidden: number;
  lastScore: number | null;
}

export function cutMatches<T extends Record<string, unknown>>(rows: T[], limit: number): MatchCut<T> {
  const base = Math.min(limit, rows.length);
  let end = base;
  if (end > 0) {
    const s = Number(rows[end - 1].score);
    while (end < rows.length && end < MATCH_SHOW_MAX && Number(rows[end].score) === s) end++;
  }
  const shown = rows.slice(0, end);
  const lastScore = shown.length ? Number(shown[shown.length - 1].score) : null;
  return {
    shown,
    total: rows.length,
    capped: rows.length >= MATCH_FETCH_CAP,
    tiesAdded: end - base,
    sameScoreHidden: lastScore === null ? 0 : rows.slice(end).filter((r) => Number(r.score) === lastScore).length,
    lastScore,
  };
}

export function matchCounts<T>(cut: MatchCut<T>, tool: string) {
  const shown = cut.shown.length;
  const totalText = cut.capped ? `${MATCH_FETCH_CAP} ומעלה` : String(cut.total);
  const parts: string[] = [];
  if (cut.total > shown) {
    parts.push(`יש ${totalText} התאמות ומוצגות ${shown}. אמור/אמרי את המספר האמיתי ולא את מספר המוצגות.`);
  }
  if (cut.tiesAdded) {
    parts.push(`הוצגו ${shown} ולא ${shown - cut.tiesAdded}, כדי לא לחתוך בין התאמות באותו ציון (${cut.lastScore}). להציג את כולן.`);
  }
  if (cut.sameScoreHidden) {
    parts.push(`יש עוד ${cut.sameScoreHidden} בציון ${cut.lastScore} כמו האחרונה שהוצגה - לציין זאת.`);
  }
  if (cut.total > shown) parts.push(`להציג עוד - ${tool} עם limit גדול יותר (עד ${MATCH_SHOW_MAX}).`);
  return {
    // ‏count = כמה הוצגו, total = כמה יש באמת. המספר שנאמר לסוכן/ת הוא total.
    count: shown,
    total: cut.total,
    total_is_capped: cut.capped || undefined,
    more_note: parts.length ? parts.join(" ") : undefined,
  };
}
