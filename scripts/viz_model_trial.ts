// ============================================================================
// ניסיון מודלים להדמיות (‏viz-speed שינוי 2, 1.11.2026) - לפני כל מעבר בייצור.
//
// **עולה כסף, ולכן ברירת המחדל היא ריצה יבשה** שמדפיסה את התוכנית והעלות. הרצה
// אמיתית רק עם ‎--run‎, ורק אחרי שתומר אישר את המספרים.
//
// מה הוא עושה: בוחר 20 הדמיות קיימות (‏modern_clean, ‏status=done) מגוונות -
// סלון, מטבח, חדר שינה, חוץ - ולכל אחת מריץ את **אותו צילום ואותו פרומפט** בשני
// המודלים המועמדים, עם imageConfig (‏1K, יחס הצילום). התוצאה של המודל הנוכחי
// כבר קיימת במסד (‏result_url) ולכן לא נקנית שוב - 40 קריאות ולא 60.
//
// **לא נוגע בייצור:** לא כותב לטבלאות, לא לאחסון ולא למטמון. התמונות נשמרות
// בתיקייה מקומית, יחד עם index.html להשוואה (לפני / נוכחי / Lite / 2.1) עם זמן
// ועלות לכל תמונה - כדי שתומר יחליט. המעבר עצמו: GEMINI_IMAGE_MODEL (+
// GEMINI_IMAGE_CONFIG=1, ‏GEMINI_IMAGE_THINKING) בסודות הפונקציות, וחזרה מיידית
// בהחזרת הערך הקודם.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GEMINI_API_KEY=... \
//     deno run --allow-net --allow-env --allow-read --allow-write scripts/viz_model_trial.ts [--run] [--out dir]
// ============================================================================
import {
  buildPrivatePrompt,
  fetchAsBase64,
  imageRequestBody,
  isLandType,
  renderModeFor,
  type PrivateTarget,
  type StyleKey,
} from "../supabase/functions/_shared/visualization.ts";

const CANDIDATES: Array<{ model: string; label: string; thinking?: string; usdPerImage: number }> = [
  { model: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite", usdPerImage: 0.0336 },
  { model: "gemini-nano-banana-2.1", label: "Nano Banana 2.1 (thinking minimal)", thinking: "minimal", usdPerImage: 0.0336 },
];
const PER_TARGET = 5;   // 5 × (סלון, מטבח, חדר שינה, חוץ) = 20
const TARGETS = ["living_room", "kitchen", "bedroom", "exterior"];

const args = Deno.args;
const RUN = args.includes("--run");
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "viz-trial-out";
const SB = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GEMINI = Deno.env.get("GEMINI_API_KEY");
if (!SB || !KEY) throw new Error("חסרים SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY");

async function rest(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return await r.json();
}

// ---- הבחירה: הדמיות קיימות, מגוונות לפי מטרה, מנכסים שונים -------------------
const rows: any[] = await rest(
  "property_visualizations?select=id,property_id,target,mode,source_image_url,result_url,created_at" +
    "&kind=eq.private_room&style_key=eq.modern_clean&status=eq.done&result_url=not.is.null&order=created_at.desc&limit=600",
);
const picked: any[] = [];
const usedProps = new Set<string>();
for (const t of TARGETS) {
  for (const r of rows.filter((x) => x.target === t)) {
    if (picked.filter((x) => x.target === t).length >= PER_TARGET) break;
    if (usedProps.has(r.property_id)) continue;
    usedProps.add(r.property_id);
    picked.push(r);
  }
}
const calls = picked.length * CANDIDATES.length;
const cost = picked.length * CANDIDATES.reduce((a, c) => a + c.usdPerImage, 0);
console.log(`תמונות: ${picked.length} (${TARGETS.map((t) => `${t} ${picked.filter((x) => x.target === t).length}`).join(", ")})`);
console.log(`קריאות: ${calls} · עלות משוערת: $${cost.toFixed(2)} (המודל הנוכחי לא נקרא - התוצאה שלו כבר במסד)`);
if (!RUN) {
  console.log("ריצה יבשה - לא נשלח דבר. להרצה: --run (רק אחרי אישור של תומר).");
  Deno.exit(0);
}
if (!GEMINI) throw new Error("חסר GEMINI_API_KEY");

// ---- ההרצה ------------------------------------------------------------------
await Deno.mkdir(OUT, { recursive: true });
const props = new Map<string, any>(
  (await rest(`properties?select=id,property_type,deal_type,rooms,size_sqm,area_sqm&id=in.(${[...usedProps].join(",")})`))
    .map((p: any) => [p.id, p]),
);
const results: any[] = [];
for (const r of picked) {
  const p = props.get(r.property_id);
  if (!p || isLandType(p.property_type)) continue;
  const src = await fetchAsBase64(r.source_image_url);
  if (!src) continue;
  const prompt = buildPrivatePrompt(r.target as PrivateTarget, "modern_clean" as StyleKey, {
    propertyType: p.property_type,
    sizeSqm: p.size_sqm ?? p.area_sqm ?? null,
    rooms: p.rooms ?? null,
    mode: renderModeFor(p.deal_type),
  });
  const row: any = { id: r.id, target: r.target, before: r.source_image_url, current: r.result_url, out: {} };
  for (const c of CANDIDATES) {
    const t0 = performance.now();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${c.model}:generateContent?key=${GEMINI}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(imageRequestBody(src.mime, src.data, prompt, { imageConfig: true, thinking: c.thinking })) },
    );
    const ms = Math.round(performance.now() - t0);
    let file = "", err = "", usage: any = null;
    if (res.ok) {
      const j = await res.json();
      usage = j?.usageMetadata ?? null;
      const part = (j?.candidates?.[0]?.content?.parts ?? []).find((x: any) => (x.inlineData || x.inline_data)?.data);
      const inl = part && (part.inlineData || part.inline_data);
      if (inl) {
        file = `${r.id}-${c.model}.${(inl.mimeType || inl.mime_type || "image/png").split("/")[1]}`;
        await Deno.writeFile(`${OUT}/${file}`, Uint8Array.from(atob(inl.data), (ch) => ch.charCodeAt(0)));
      } else err = "אין תמונה בתגובה";
    } else err = `HTTP ${res.status}`;
    row.out[c.model] = { file, ms, err, usd: file ? c.usdPerImage : 0, usage };
    console.log(r.target, c.model, ms + "ms", err || file);
  }
  results.push(row);
}
await Deno.writeTextFile(`${OUT}/results.json`, JSON.stringify(results, null, 2));

// ---- דף ההשוואה ---------------------------------------------------------------
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const cell = (src: string, cap: string) => `<td><img src="${esc(src)}" loading="lazy"><div>${esc(cap)}</div></td>`;
const html = `<!doctype html><meta charset="utf-8"><title>ניסיון מודלים - הדמיות</title>
<style>body{font-family:system-ui;direction:rtl;margin:16px}table{border-collapse:collapse}td{padding:6px;vertical-align:top;font-size:13px}
img{width:300px;border-radius:8px;display:block}th{text-align:start;padding:6px}</style>
<h1>ניסיון מודלים: ${results.length} תמונות</h1>
<table><tr><th>מטרה</th><th>לפני</th><th>נוכחי (מהמסד)</th>${CANDIDATES.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr>
${results.map((r) => `<tr><td>${esc(r.target)}</td>${cell(r.before, "הצילום")}${cell(r.current, "gemini-3.1-flash-image-preview")}${
  CANDIDATES.map((c) => { const o = r.out[c.model]; return o.file ? cell(o.file, `${o.ms}ms · $${o.usd}`) : `<td>${esc(o.err)}</td>`; }).join("")}</tr>`).join("\n")}
</table>`;
await Deno.writeTextFile(`${OUT}/index.html`, html);
console.log(`נשמר: ${OUT}/index.html`);
