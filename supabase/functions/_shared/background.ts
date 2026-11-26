// ============================================================================
// _shared/background.ts - עבודה ארוכה שממשיכה אחרי שהתשובה כבר יצאה (EdgeRuntime.waitUntil)
// בלי waitUntil (בדיקה מקומית) מחכים לה. תמלול של שעת שיחה אינו נכנס לבקשה רגילה.
// ============================================================================
export async function background(work: Promise<unknown>): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work);
  else await work;
}
