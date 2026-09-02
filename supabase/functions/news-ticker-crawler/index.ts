import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// אוטומציית מבזק חדשות שבועית. מקור יחיד מאומת שבדקתי בפועל (לא ניחשתי): גלובס RSS נדל"ן ותשתיות.
// הוספת מקורות נוספים מרשימת ה-Base44 (TheMarker/Bizportal/NadlanCenter/Magdilim/C14/Blinker/עיריית עפולה)
// דורשת אימות URL של ה-feed המדויק של כל אתר לפני הוספה — לא נחשו בעצמי כדי לא למאון URL שגוי שיכשל בשקט.
//
// זרימה: שליפת RSS -> פרסור XML -> סינון "עפולה" בכותרת/תוכן -> ניסוח
// מחדש עם Claude API (לעולם משלו, לא ציטוט מהמקור) -> INSERT ל-news_items עם דדופ לפי source_url.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

// רשימת מקורות RSS — מאומתים בלבד כרגע. הוספת מקור חדש = שורה אחת במערך הזה, לא שינוי קוד.
const RSS_SOURCES = [
  { name: "גלובס - נדל\"ן ותשתיות", url: "https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=607" },
];

// מילות-מפתח נגזרות מ-10 השאילות של המשתמש (Base44) — כולן מתחילות ב-"עפולה", שהוא
// המכנה המשותפת. דורשים התאמה ל"עפולה" בדווקא, לא מספיק משני-משנה מהמילים הנוספות
// כדי למנוע רעש (מצב"ע בעיר אחרת שבמקרה מוצג "תב"ע" גם כן).
const REQUIRED_TERM = "עפולה";

function corsHeaders() {
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#8226;/g, "•").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
    .trim();
}

interface RssItem { title: string; description: string; link: string; pubDate: string; sourceName: string }

function parseRssItems(xml: string, sourceName: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml))) {
    const block = m[1];
    const title = decodeEntities((block.match(/<title>([\s\S]*?)<\/title>/) || [, ""])[1]);
    const description = decodeEntities((block.match(/<description>([\s\S]*?)<\/description>/) || [, ""])[1]);
    const linkRaw = (block.match(/<link>([\s\S]*?)<\/link>/) || [, ""])[1];
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [, ""])[1];
    if (title) items.push({ title, description, link: linkRaw.split("#")[0].trim(), pubDate, sourceName });
  }
  return items;
}

async function summarizeForTicker(item: RssItem): Promise<string | null> {
  if (!anthropicApiKey) return null;
  // עיקרון copyright: מנסח במפורש שלא לצטט/להעתיק מהכתבה המקורית, רק לנסח מחדש
  // לגמרי (בדיוק עם הכללים שכבר נאכפים במערכת נוספת) — שורה אחת קצרה, לא סיכום מלא.
  const prompt = `הדע הבא הוא כתבת חדשות מקור חיצוני. נסח מחדש במילים שלך בלבד (לא ציטוט ישיר) לשורת מבזק עברית אחת קצרה (עד  20 מילים), רלוונטית לעפולה ולשוק הנדל"ן. אם הכתבה לא רלוונטית לעפולה בפועל אלא רק מאזכרת אותה באגב, השב בדיוק את המלה "דלג".

כותרת: ${item.title}
תקציר: ${item.description}

השב רק את שורת המבזק, בלי מרכאות נוספות.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    console.error("Claude API error:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (item.title === "דלג") return null; // safety: אם המודל החזיר את מילת הקוד בטעות
  return typeof text === "string" ? text.trim() : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

  if (!anthropicApiKey) {
    return json({ error: "missing_anthropic_key", detail: "ANTHROPIC_API_KEY לא מוגדר כ-Secret בפרויקט" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const results: Record<string, unknown>[] = [];

  for (const source of RSS_SOURCES) {
    try {
      const res = await fetch(source.url);
      if (!res.ok) {
        results.push({ source: source.name, error: `fetch_failed_${res.status}` });
        continue;
      }
      const xml = await res.text();
      const items = parseRssItems(xml, source.name);
      const matched = items.filter((it) =>
        it.title.includes(REQUIRED_TERM) || it.description.includes(REQUIRED_TERM)
      );

      for (const item of matched) {
        // בדיקת כפילות לפני קריאה ל-Claude (חוסך עלות, לא רק נקי)
        const { data: existing } = await supabase.from("news_items").select("id").eq("source_url", item.link).maybeSingle();
        if (existing) continue;

        const headline = await summarizeForTicker(item);
        if (!headline) { results.push({ source: source.name, skipped: item.title }); continue; }

        const { error: insertErr } = await supabase.from("news_items").insert({
          headline,
          source_url: item.link,
          published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        });
        if (insertErr && insertErr.code !== "23505") {
          results.push({ source: source.name, error: insertErr.message });
        } else {
          results.push({ source: source.name, inserted: headline });
        }
      }
    } catch (e) {
      results.push({ source: source.name, error: String(e) });
    }
  }

  return json({ success: true, processed: results.length, results });
});
