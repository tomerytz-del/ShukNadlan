/* ============================================================================
   קישור קצר להודעת וואטסאפ מוכנה — ‏/wa/<code> → ‏wa.me/<טלפון>?text=…
   ----------------------------------------------------------------------------
   ‏‏`property_link` של גבריאלה נותן לסוכן/ת קישור שפותח וואטסאפ עם הודעה
   מוכנה ללקוח/ה. ‏wa.me/?text= עם ההודעה בתוכו הגיע לאלף תווים ויותר (כל אות
   עברית היא שישה תווים של %D7%…), ובאייפון רק תחילתו הייתה לחיצה.

   ‏ההודעה נשמרת ב-`wa_share_links` כשהבוט בונה אותה, והקישור נושא קוד של 10
   תווים. כאן קוראים אותה דרך `wa_share_link_get` (‏anon, לפי קוד בלבד) ומפנים.
   ‏בכל כשל — קוד שאינו קיים, ישן מ-90 יום, מסד שלא ענה — מפנים לדף הבית.

   ‏המיניסייט אינו עובר כאן אלא ב-showcase-send.ts (‏/w/<token>), כי ההודעה
   שלו קבועה ונבנית בלי מסד. הפרטים: docs/client-showcase.md.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";

const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 2000;

async function lookup(code: string): Promise<{ phone: string | null; body: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wa_share_link_get`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_code: code }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    return row?.body ? { phone: row.phone ? String(row.phone) : null, body: String(row.body) } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/wa\/([0-9A-Za-z]{8,16})\/?$/);
  const row = m ? await lookup(m[1]) : null;
  if (!row) return Response.redirect(new URL("/", url), 302);
  const to = row.phone && /^\d{9,15}$/.test(row.phone) ? row.phone : "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://wa.me/${to}?text=${encodeURIComponent(row.body)}`,
      "Cache-Control": "no-store",
    },
  });
};

export const config: Config = {
  path: "/wa/*",
};
