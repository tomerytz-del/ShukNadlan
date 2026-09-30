/* ============================================================================
   קישור קצר לנכס — ‏/p/1162 → ‏/property?id=…
   ----------------------------------------------------------------------------
   ‏אינסטגרם אינה הופכת קישור בכיתוב של פוסט ללחיץ. מי שרוצה להגיע לנכס
   מקליד את הכתובת או מעתיק אותה, וכתובת עם uuid של 36 תווים אי אפשר
   להקליד. מספר המודעה (‏listing_number) כבר מופיע בכל פוסט, בדף הנכס
   ובבוט — ולכן הוא המפתח כאן.

   ‏**הפניה ולא הגשה.** ‏/p/1162 אינו דף: הוא מפנה לכתובת הקנונית של הנכס.
   כך אין לגוגל שתי כתובות לאותו תוכן, וה-canonical וה-og: ממשיכים להגיע
   מ-og-tags.ts כרגיל. ‏**‏302 ולא 301:** דפדפן שומר 301 לתמיד, ונכס שנמכר
   היה ממשיך להיפתח כ"לא נמצא" אצל מי שכבר לחץ פעם — במקום לדף הבית.

   ‏**מפתח anon**, כמו og-tags.ts: נכס שאינו active אינו נמצא. במקרה כזה —
   וגם בכל כשל (‏timeout, מסד שלא ענה) — הגולש/ת מופנה/ית לדף הבית עם
   ‏302, ולא לדף שגיאה: מי שהגיע מפוסט ישן על נכס שנמכר עדיין מחפש/ת דירה.

   הפרטים: docs/facebook-auto-publish.md, סעיף "אינסטגרם".
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";

const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 1500;

async function propertyId(listing: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/properties?select=id&status=eq.active&listing_number=eq.${listing}&limit=1`,
      {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        signal: ctrl.signal,
      },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0]?.id ? String(rows[0].id) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/p\/(\d{1,9})\/?$/);
  const id = m ? await propertyId(m[1]) : null;
  if (!id) return Response.redirect(new URL("/", url), 302);
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(`/property?id=${encodeURIComponent(id)}`, url).toString(),
      "Cache-Control": "public, max-age=300",
    },
  });
};

export const config: Config = {
  path: "/p/*",
};
