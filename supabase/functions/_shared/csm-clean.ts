// ============================================================================
// _shared/csm-clean.ts - עזרי הניקוי של מה שחוזר מהמודל בניתוחי שיחות ההטמעה (טהור, בלי Deno)
//   s: טקסט באורך סביר, בלי מקף ארוך ובלי רווחים כפולים · pick: ערך מרשימה סגורה, אחרת ברירת מחדל
//   arr: מערך אובייקטים באורך מוגבל · strEnum: enum לסכמת הכלי מאותה רשימה סגורה
// ============================================================================
export const s = (v: unknown, max: number) => String(v ?? "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().slice(0, max);
export const pick = (v: unknown, allowed: Record<string, string>, fallback: string) =>
  Object.prototype.hasOwnProperty.call(allowed, String(v)) ? String(v) : fallback;
export const arr = (v: unknown, max: number) => (Array.isArray(v) ? v : []).slice(0, max) as Record<string, unknown>[];
export const strEnum = (o: Record<string, string>) => ({ type: "string", enum: Object.keys(o) });
