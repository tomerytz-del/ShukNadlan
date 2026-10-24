/* ============================================================================
   מתווכים בעפולה - /afula/מתווכים
   ----------------------------------------------------------------------------
   brokers.html מוגש תחת הכתובת (200 ב-_redirects). הפונקציה ממלאת משרדים
   חיים בעפולה (RLS של agencies כבר מסנן משרד בלי רישיון) ואת המתווכים שלהם.

   canonical מהכתובת, לפני המסד. כשל בשאילתת המשרדים הוא 503 בלי noindex.
   שאילתת המתווכים והספירה הן משניות: כישלון שלהן משאיר את המשרדים.
   רשימת משרדים ריקה אחרי תשובה היא 200 עם noindex.

   docs/afula-brokers.md.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";
import "../../assets/brokers-render.js";

const SITE = "https://shuknadlan.co.il";
const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 2500;

type Page = { path: string; h1: string; description: string; intro: string };
type Row = Record<string, unknown>;
type Data = { agencies: Row[]; agents: Row[] };

type Api = {
  pageOf: (pathname: string) => Page | null;
  agencyQuery: () => string;
  render: (data: Data) => string;
  scripts: (data: Data, site: string) => string;
  fullTitle: () => string;
};

function api(): Api {
  return (globalThis as unknown as { ShukBrokers: Api }).ShukBrokers;
}

async function getJson(path: string, init?: RequestInit): Promise<unknown | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/* undefined = המשרדים לא נענו. אובייקט = יש תשובה, גם אם המתווכים חסרים. */
async function load(): Promise<Data | undefined> {
  const agencies = await getJson("agencies?" + api().agencyQuery());
  if (!Array.isArray(agencies)) return undefined;
  const [members, cards] = await Promise.all([
    getJson("agency_members_public?select=slug,display_name,agency_id&is_active_agent=eq.true&order=display_name.asc&limit=1000"),
    getJson("rpc/homepage_agency_cards", { method: "POST", body: "{}" }),
  ]);
  const counts = new Map<string, number>();
  if (Array.isArray(cards)) {
    for (const row of cards as Row[]) {
      if (row && row.agency_id) counts.set(String(row.agency_id), Number(row.active_count) || 0);
    }
  }
  const names = new Map<string, string>();
  const offices = (agencies as Row[]).map((a) => {
    const id = String(a.id || "");
    names.set(id, String(a.name || ""));
    return { ...a, active_count: counts.get(id) || 0 };
  });
  const agents = Array.isArray(members)
    ? (members as Row[]).filter((m) => m && m.slug && names.has(String(m.agency_id))).map((m) => ({
      slug: m.slug,
      display_name: m.display_name,
      agency_name: names.get(String(m.agency_id)) || "",
    }))
    : [];
  return { agencies: offices, agents };
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function text(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function withUrl(html: string, page: Page): string {
  const url = SITE + page.path;
  return html
    .replace(/(<meta property="og:url" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(url)}${b}`)
    .replace(/<link\b[^>]*\brel="canonical"[^>]*>\s*/gi, "")
    .replace(/<\/head>/i, () => `<link rel="canonical" href="${attr(url)}">\n</head>`);
}

export function noindex(html: string): string {
  if (/<meta\b[^>]*\bname="robots"[^>]*noindex/i.test(html)) return html;
  return html.replace(/<\/head>/i, () => `<meta name="robots" content="noindex,follow">\n</head>`);
}

function failureHeaders(base: Headers, status: number): Headers {
  const headers = new Headers(base);
  headers.delete("content-length");
  headers.set("Cache-Control", "no-store");
  headers.set("Netlify-CDN-Cache-Control", "no-store");
  if (status === 503) headers.set("Retry-After", "60");
  return headers;
}

export function inject(html: string, page: Page, data: Data): string {
  const A = api();
  const box = /<div id="brokersBody"[^>]*>[\s\S]*?<!--\/brokers-->/;
  if (!box.test(html)) return html;
  const full = A.fullTitle();
  const body = A.render(data);
  const preloadMatch = body.match(/<img[^>]*fetchpriority="high"[^>]*>/);
  const src = preloadMatch ? (preloadMatch[0].match(/\bsrc="([^"]+)"/) || [])[1] : "";
  const preload = src ? `<link rel="preload" as="image" href="${src}" fetchpriority="high">\n` : "";
  return html
    .replace(box, () => `<div id="brokersBody" data-ssr="1">\n${body}\n<!--/brokers-->`)
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${text(full)}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(full)}${b}`)
    .replace(/(<meta property="og:description" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(page.description)}${b}`)
    .replace(/(<meta name="description" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(page.description)}${b}`)
    .replace(/(<h1 id="brokersH1">)[\s\S]*?(<\/h1>)/, (_m, a, b) => `${a}${text(page.h1)}${b}`)
    .replace(/(<p id="brokersLead">)[\s\S]*?(<\/p>)/, (_m, a, b) => `${a}${text(page.description)}${b}`)
    .replace(/<\/head>/i, () => `${preload}${A.scripts(data, SITE)}\n</head>`);
}

export default async function handler(request: Request, context: Context) {
  const res = await context.next();
  const pathname = new URL(request.url).pathname;
  const page = api().pageOf(pathname);
  /* ‏כמו silo-page: נתיב עברי לא נתפס ב-Netlify. `/afula/*` כן. נתיב
     שאינו הדף הזה חוזר כמו שהוא, כדי לא לבלוע דף נחיתה תחת אותה קידומת. */
  if (!page) {
    let path = pathname;
    try { path = decodeURIComponent(path); } catch { /* נשאר כמו שהוא */ }
    if (path.startsWith("/afula/")) return res;
  }
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return res;
  const html = await res.text();
  let out = html;
  let cache = false;
  let status = res.status;
  let empty = false;

  try {
    if (!page) {
      out = noindex(html);
      status = 404;
    } else {
      out = withUrl(html, page);
      const data = await load();
      if (!data) {
        status = 503;
      } else if (!data.agencies.length) {
        out = noindex(inject(out, page, data));
        empty = true;
        status = 200;
      } else {
        const filled = inject(out, page, data);
        cache = filled !== out;
        out = filled;
      }
    }
  } catch {
    out = page ? withUrl(html, page) : html;
    cache = false;
    empty = false;
    status = 503;
  }

  if (status === 404 || status === 503 || empty) {
    return new Response(out, { status, headers: failureHeaders(res.headers, status) });
  }

  const headers = new Headers(res.headers);
  headers.delete("content-length");
  if (cache) {
    headers.set("Netlify-CDN-Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  }
  return new Response(out, { status: res.status, headers });
}

export const config: Config = {
  path: [
    "/afula/*",
    "/brokers",
    "/brokers.html",
    "/afula/מתווכים",
    "/afula/%D7%9E%D7%AA%D7%95%D7%95%D7%9B%D7%99%D7%9D",
  ],
};
