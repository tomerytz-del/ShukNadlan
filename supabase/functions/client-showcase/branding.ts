// ============================================================================
// זיהוי לוגו / סימן מים של משרד תיווך בתמונת נכס.
//
// משרדים מטביעים את הלוגו על תמונות הנכס — בפינה, כסימן מים שקוף באמצע,
// או כפס עם טלפון בתחתית. בנכס בשת"פ זה בדיוק מה שאסור שיגיע ללקוח/ה של
// משרד אחר, ולכן כל תמונה של נכס כזה נבדקת פעם אחת לפני שהיא מוצגת.
//
// אותו מודל ואותו ערוץ של classifyImage (‏_shared/visualization.ts), אבל
// שאלה אחרת ותשובה אחרת — ולכן פונקציה נפרדת ולא עוד שדה בסיווג הקיים:
// הסיווג רץ על כל נכס פעיל, וזיהוי הלוגו נחוץ רק לנכסים שנשלחים בשת"פ.
//
// ‏**כשל אינו "אין לוגו".** קריאה שנכשלה מחזירה `null`, והתמונה נשארת לא
// בדוקה — כלומר מוסתרת. רק `NO` מפורש מהמודל פותח אותה.
// ============================================================================

const VISION_MODEL = Deno.env.get("GEMINI_VISION_MODEL") ?? "gemini-3.1-flash-lite";

export const BRANDING_MODEL = VISION_MODEL;

const PROMPT =
  'זוהי תמונה של נכס נדל"ן. האם מופיע בה, בכל מקום ובכל גודל, אחד מאלה: ' +
  "לוגו של משרד תיווך או של חברה, סימן מים (גם שקוף או חלקי), שם של משרד, " +
  "מספר טלפון, כתובת אתר, או פס מיתוג בשולי התמונה? " +
  "ענה במילה אחת באנגלית בלבד: YES אם יש, NO אם אין.";

export async function detectBranding(
  apiKey: string,
  mime: string,
  data: string,
): Promise<{ has_branding: boolean | null; error?: string }> {
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mime, data } }, { text: PROMPT }] }],
          // מודל חושב: התקציב כולל את החשיבה. ראו ההערה ב-classifyImage.
          generationConfig: { temperature: 0, maxOutputTokens: 2048 },
        }),
      },
    );
  } catch (e) {
    return { has_branding: null, error: `fetch: ${(e as Error).message}` };
  }

  if (!res.ok) {
    let body = "";
    try {
      body = (await res.text()).slice(0, 200);
    } catch {
      /* noop */
    }
    return { has_branding: null, error: `HTTP ${res.status}${body ? `: ${body}` : ""}` };
  }

  // deno-lint-ignore no-explicit-any
  const out: any = await res.json();
  const text = ((out?.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string }>)
    .map((p) => p?.text ?? "")
    .join(" ")
    .toUpperCase();

  if (/\bYES\b/.test(text)) return { has_branding: true };
  if (/\bNO\b/.test(text)) return { has_branding: false };
  return { has_branding: null, error: `תשובה לא ברורה מ-${VISION_MODEL}` };
}
