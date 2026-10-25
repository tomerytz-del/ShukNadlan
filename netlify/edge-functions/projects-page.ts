/* ============================================================================
   /projects - נשאר באינדקס גם כשאין פרויקט
   ----------------------------------------------------------------------------
   הדף מדרג שאילתות על פרויקטים חדשים בעפולה כשהרשימה ריקה. אין noindex.
   ה-JSON-LD: CollectionPage ו-BreadcrumbList תמיד, FAQPage לשאלות שבדף,
   ו-ItemList רק כשיש לפחות פרויקט אחד. המדריך עצמו יושב ב-projects.html,
   כדי שכשל מסד לא ירוקן את הדף.

   index-jsonld.ts לא נוגע בנתיב הזה, כדי שלא יופיע ItemList ריק שני.
   ========================================================================== */

import type { Config, Context } from "https://edge.netlify.com/v1/index.ts";

const SITE = "https://shuknadlan.co.il";
const SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
const FETCH_TIMEOUT_MS = 2500;

const H1 = "פרויקטים חדשים בעפולה ובעמק יזרעאל";
const TITLE = "פרויקטים חדשים בעפולה | שוק נדל״ן";
const DESCRIPTION =
  "פרויקטים חדשים בעפולה ובעמק יזרעאל. מה בודקים לפני רכישה מקבלן, קישורים לשכונות ולנכסים בעפולה, והתראה כשיעלה פרויקט.";

const FAQS: [string, string][] = [
  [
    "מה בודקים לפני שקונים דירה מקבלן?",
    "לפני חתימה בודקים את הבטוחה לכספי הקונה לפי חוק המכר (דירות), אם יש ליווי בנקאי, את המפרט הטכני ואת לוח הזמנים לאכלוס. המסמכים של העסקה קובעים, לא נוסח כללי בעמוד הזה.",
  ],
  [
    "מהן ערבות לפי חוק המכר וליווי בנקאי?",
    "חוק המכר (דירות), התשל״ג-1973, מחייב את מוכר הדירה החדשה להבטיח את הכספים ששולמו, למשל בערבות בנקאית או בפוליסת ביטוח, לפי המסלול שבחוק. ליווי בנקאי הוא מסגרת שבה בנק מלווה את הבנייה ומשחרר כספים לפי התקדמות. לא בכל פרויקט אותו מסלול, ובכל עסקה בודקים את המסמכים מול עורך דין.",
  ],
  [
    "מה כוללים מפרט טכני ולוח זמנים?",
    "המפרט הטכני מתאר את רמת הגמר, החומרים והאבזור. לוח הזמנים מציין מתי צפוי האכלוס. שניהם חלק ממסמכי המכר, והם הקובעים.",
  ],
  [
    "מהי דירה בהנחה או מחיר מטרה?",
    "אלה מסלולים ממשלתיים לדיור במחיר מופחת, עם תנאי זכאות שמפרסם משרד הבינוי והשיכון. לא כל פרויקט נכלל בהם. כשפרויקט כזה יפורסם באתר, התנאים יופיעו בדף שלו. בעמוד הזה אין שמות של פרויקטים ואין מחירים.",
  ],
];

type Row = { slug?: string; name?: string };

function pagePath(pathname: string): boolean {
  const path = pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  return path === "/projects";
}

async function projects(): Promise<{ ok: true; rows: Row[]; total: number } | { ok: false }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/projects_public?select=slug,name&slug=not.is.null&limit=1000`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Accept: "application/json",
          Prefer: "count=exact",
        },
        signal: ctrl.signal,
      },
    );
    if (!res.ok) return { ok: false };
    const data = await res.json();
    if (!Array.isArray(data)) return { ok: false };
    const range = res.headers.get("content-range") || "";
    const match = range.match(/\/(\d+)\s*$/);
    return { ok: true, rows: data as Row[], total: match ? Number(match[1]) : data.length };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function graph(rows: Row[] | null, total: number): Record<string, unknown> {
  const url = `${SITE}/projects`;
  const items: Record<string, unknown>[] = [];
  for (const row of rows || []) {
    const slug = String(row.slug || "").trim();
    const name = String(row.name || "").trim();
    if (!slug || !name) continue;
    items.push({
      "@type": "ListItem",
      position: items.length + 1,
      name,
      url: `${SITE}/project?slug=${encodeURIComponent(slug)}`,
    });
  }
  const nodes: Record<string, unknown>[] = [
    {
      "@type": "CollectionPage",
      "@id": `${url}#page`,
      url,
      name: H1,
      description: DESCRIPTION,
      inLanguage: "he",
      isPartOf: { "@id": `${SITE}/#website` },
      breadcrumb: { "@id": `${url}#breadcrumb` },
      about: { "@type": "City", name: "עפולה" },
      ...(items.length ? { mainEntity: { "@id": `${url}#list` } } : {}),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "שוק נדל״ן", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: H1, item: url },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: FAQS.map(([name, text]) => ({
        "@type": "Question",
        name,
        acceptedAnswer: { "@type": "Answer", text },
      })),
    },
  ];
  if (items.length) {
    nodes.push({
      "@type": "ItemList",
      "@id": `${url}#list`,
      name: H1,
      itemListOrder: "https://schema.org/ItemListUnordered",
      numberOfItems: rows && rows.length < total ? total : items.length,
      itemListElement: items,
    });
  }
  return { "@context": "https://schema.org", "@graph": nodes };
}

function text(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function attr(s: string): string {
  return text(s).replace(/"/g, "&quot;");
}

export function inject(html: string, rows: Row[] | null, total: number): string {
  if (html.includes("CollectionPage") || html.includes("FAQPage")) return html;
  const json = JSON.stringify(graph(rows, total)).replace(/</g, "\\u003c");
  return html
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${text(TITLE)}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(TITLE)}${b}`)
    .replace(/(<meta property="og:description" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(DESCRIPTION)}${b}`)
    .replace(/(<meta name="description" content=")[^"]*(">)/, (_m, a, b) => `${a}${attr(DESCRIPTION)}${b}`)
    .replace(/(<h1 id="projectsH1">)[\s\S]*?(<\/h1>)/, (_m, a, b) => `${a}${text(H1)}${b}`)
    .replace(/<\/head>/i, () => `<script type="application/ld+json">${json}</script>\n</head>`);
}

export default async function handler(request: Request, context: Context) {
  const res = await context.next();
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return res;
  if (!pagePath(new URL(request.url).pathname)) return res;
  const html = await res.text();
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  const got = await projects();
  const out = got.ok ? inject(html, got.rows, got.total) : inject(html, null, 0);
  return new Response(out, { status: res.status, headers });
}

export const config: Config = { path: ["/projects", "/projects.html"] };
