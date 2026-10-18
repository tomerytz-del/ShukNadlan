// ============================================================================
// site_load_test.ts — מבחן עומס לאתר ולפונקציות של גבריאלה והמנטור
//
// שני יעדים, ושניהם בלי כתיבה למסד ובלי עלות של מודל:
//
//   web   - "גולשים" בו-זמניים, כל אחד עובר מסלול של גולש/ת אמיתי/ת: דף הבית
//           (CDN של Netlify), רשימת הנכסים מה-REST של Supabase (מפתח anon, כמו
//           הדפדפן), דף נכס (עובר ב-og-tags ‏- Edge Function של Netlify שקוראת
//           מהמסד), ו-/prices (‏prices-page, ממלאת בשרת). קריאה בלבד.
//   edge  - בקשות בו-זמניות ל-Edge Functions של Supabase שנדחות מיד בשער:
//           ‏whatsapp-webhook עם חתימה שגויה (401, לפני כל עיבוד, בלי מודל ובלי
//           הודעה) ו-coach-ask בלי JWT (401). זה מודד כמה ריצות במקביל הפונקציות
//           מקבלות לפני 429/503 - התקרה של תוכנית Supabase - בלי שום תופעת לוואי.
//
// מה **לא** נבדק כאן, ולמה: עיבוד מלא של הודעה לגבריאלה. הודעה חתומה אמיתית
// מפעילה מודל, כותבת ליומן ושולחת וואטסאפ דרך Meta - כלומר עלות, נתונים מזויפים
// במסד והודעות לאנשים. הקיבולת של המודל משותפת לגבריאלה ולמנטור (אותו חשבון
// Anthropic), ונמדדת ב-coach_load_test.ts; תור של גבריאלה הוא לרוב 2-4 קריאות
// למודל, ולכן קיבולת של N שאלות למנטור היא בערך N/3 הודעות לגבריאלה.
//
//   node --experimental-strip-types scripts/site_load_test.ts --target=web --levels=10,50 --yes
//   node --experimental-strip-types scripts/site_load_test.ts --target=edge --levels=50,200 --yes
//
// דגלים: --target=web|edge  --levels=10,50,100  --pause=20 (שניות בין גלים)  --yes
// ‏Netlify מבקשת לתאם מראש עומס כבד על האתר; גלים של מאות "גולשים" - אחרי תיאום.
// מ-GitHub: workflow "מבחן עומס - אתר ופונקציות" (‏site_load_test.yml).
// ============================================================================

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const TARGET = args.target === "edge" ? "edge" : "web";
const LEVELS = String(args.levels ?? "5").split(",").map((x) => Math.max(1, Math.min(2000, Number(x) || 1)));
const PAUSE_S = Math.max(0, Number(args.pause ?? 20));
const GO = args.yes === "true";

const SITE = process.env.SITE_URL || "https://shuknadlan.co.il";
const SUPABASE = process.env.SUPABASE_URL || "https://obookujgolazrwycsiyn.supabase.co";
// המפתח הציבורי שכבר באתר (assets/*.js) - לא סוד
const ANON = process.env.SUPABASE_ANON_KEY || "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";

type Hit = { step: string; status: number; ms: number };

async function timed(step: string, url: string, init?: RequestInit): Promise<Hit> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    await res.arrayBuffer();
    return { step, status: res.status, ms: performance.now() - t0 };
  } catch {
    return { step, status: 0, ms: performance.now() - t0 };
  }
}

const REST_LIST = `${SUPABASE}/rest/v1/properties?select=id,title,price,city&status=eq.active&order=created_at.desc&limit=60`;
let propertyIds: string[] = [];

async function visitor(i: number): Promise<Hit[]> {
  const hits: Hit[] = [];
  hits.push(await timed("דף הבית", `${SITE}/`));
  hits.push(await timed("רשימת נכסים (REST)", REST_LIST, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }));
  const id = propertyIds.length ? propertyIds[i % propertyIds.length] : null;
  if (id) hits.push(await timed("דף נכס (og-tags)", `${SITE}/property?id=${encodeURIComponent(id)}`));
  hits.push(await timed("מחירי דירות (prices-page)", `${SITE}/prices`));
  return hits;
}

async function edgeHit(i: number): Promise<Hit[]> {
  if (i % 2 === 0) {
    return [await timed("whatsapp-webhook (חתימה שגויה)", `${SUPABASE}/functions/v1/whatsapp-webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "0".repeat(64) },
      body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
    })];
  }
  return [await timed("coach-ask (בלי JWT)", `${SUPABASE}/functions/v1/coach-ask`, {
    method: "POST", headers: { "content-type": "application/json", apikey: ANON }, body: "{}",
  })];
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// מה נחשב "תקין" לכל צעד: באתר 200, בפונקציות הדחייה המצופה 401
const expected = (step: string, status: number) => (TARGET === "edge" ? status === 401 : status === 200);

console.log(`מבחן עומס · ${TARGET === "web" ? `אתר (${SITE})` : "Edge Functions של Supabase"} · גלים: ${LEVELS.join(", ")}`);
if (!GO) { console.log("זו תוכנית בלבד. להרצה מוסיפים --yes."); process.exit(0); }

if (TARGET === "web") {
  const r = await fetch(REST_LIST, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }).catch(() => null);
  const rows = r && r.ok ? await r.json() as { id: string }[] : [];
  propertyIds = rows.map((x) => x.id);
  console.log(`נכסים פעילים לדגימה: ${propertyIds.length}`);
}

let firstBad: number | null = null;
for (const [li, n] of LEVELS.entries()) {
  if (li > 0 && PAUSE_S) await new Promise((r) => setTimeout(r, PAUSE_S * 1000));
  const t0 = performance.now();
  const all = (await Promise.all(Array.from({ length: n }, (_, i) => (TARGET === "web" ? visitor(i) : edgeHit(i))))).flat();
  const wall = (performance.now() - t0) / 1000;
  console.log(`\n== ${n} ${TARGET === "web" ? "גולשים" : "בקשות"} בו-זמנית · ${wall.toFixed(1)} ש' ==`);
  const steps = [...new Set(all.map((h) => h.step))];
  let bad = 0;
  for (const step of steps) {
    const hs = all.filter((h) => h.step === step);
    const good = hs.filter((h) => expected(step, h.status));
    bad += hs.length - good.length;
    const by = hs.reduce<Record<string, number>>((m, h) => ((m[h.status] = (m[h.status] ?? 0) + 1), m), {});
    const ms = good.map((h) => h.ms / 1000);
    console.log(`  ${step}: ${good.length}/${hs.length} תקינות · חציון ${pct(ms, 50).toFixed(2)} ש' · p95 ${pct(ms, 95).toFixed(2)} ש' · ${JSON.stringify(by)}`);
  }
  if (bad && firstBad === null) firstBad = n;
}
console.log(firstBad === null ? "\nכל הגלים עברו בלי שגיאות." : `\nשגיאות (סטטוס לא צפוי או 0 = timeout/חיבור) החלו בגל של ${firstBad}.`);
