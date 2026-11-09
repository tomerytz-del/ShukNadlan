/* ============================================================================
   קישור קצר למיניסייט — ‏/m/<טוקן> → ‏/showcase?t=<טוקן>
   ----------------------------------------------------------------------------
   ההודעה שהסוכן/ת מעביר/ה מהוואטסאפ האישי אינה יכולה לשאת כפתור, אז
   הקישור גלוי. הטוקן הוא אותו מפתח שכבר בכתובת הארוכה, בלי query ובלי
   מסד. ‏302: הדף הקנוני נשאר /showcase, והטוקן אינו נשמר אצל הדפדפן לתמיד.
   טוקן שאינו hex באורך 32-64 מופנה לדף הבית, כמו /w/.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import { minisiteRedirectPath } from "../../supabase/functions/_shared/wa-forward.ts";

export default (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const path = minisiteRedirectPath(url.pathname);
  const target = path ? new URL(path, url.origin) : new URL("/", url.origin);
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Cache-Control": "private, no-store",
    },
  });
};

export const config: Config = {
  path: "/m/*",
};
