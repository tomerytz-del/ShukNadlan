#!/usr/bin/env node
// גיבוי למפעיל: מעלה את תמונות חבילת ההשקה לדלי הפרטי marketing-creatives.
// הדרך הרגילה היא כפתור "העלאת תמונות" בלשונית "השקה מושהית" (הפעולה
// upload_launch_creatives ב-ads-admin), בלי מפתח שירות על המחשב.
//
// ברירת המחדל היא הדפסה בלבד: נתיב, sha256, גודל. בלי רשת.
//   node scripts/upload_meta_creatives.mjs
//   node scripts/upload_meta_creatives.mjs --confirm
//
// --confirm דורש SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY, וכותב רק ל-Storage.
// הסקריפט לא קורא ל-graph.facebook.com. את ההעלאה למטא עושה ads-admin
// ביצירה המושהית, אחרי בדיקת אותו sha256.
//
// הנתיב בדלי הוא הנתיב מתחת ל-marketing/meta-creatives/, למשל
// 20261024/creatives/brokers/B1_fomo_live55_match_1x1.png.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseDir = path.join(root, "marketing", "meta-creatives");
const bucket = "marketing-creatives";
const confirm = process.argv.includes("--confirm");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function walk(dir, rel) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await walk(child, childRel));
    else if (/\.(png|jpe?g)$/i.test(entry.name)) out.push(childRel);
  }
  return out.sort();
}

function mimeOf(rel) {
  return rel.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

const files = await walk(baseDir, "");
if (!files.length) {
  console.error("no images under marketing/meta-creatives");
  process.exit(1);
}

const manifestPath = path.join(baseDir, "20261024", "manifest.json");
let expected = new Map();
try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  expected = new Map((manifest.files || []).map((f) => [f.path, f.sha256]));
} catch {
  console.error("missing manifest:", manifestPath);
  process.exit(1);
}

let mismatch = 0;
const rows = [];
for (const rel of files) {
  const buf = await readFile(path.join(baseDir, rel));
  const hash = sha256(buf);
  const want = expected.get(rel);
  const flag = want === hash ? "ok" : "MISMATCH";
  if (flag !== "ok") mismatch++;
  rows.push({ rel, hash, bytes: buf.length, flag });
  console.log(`${flag}\t${hash}\t${buf.length}\t${rel}`);
}
for (const rel of expected.keys()) {
  if (!files.includes(rel)) {
    mismatch++;
    console.log(`MISSING\t${rel}`);
  }
}

if (mismatch) {
  console.error(`dry-run: ${mismatch} files do not match the manifest. nothing uploaded.`);
  process.exit(1);
}

if (!confirm) {
  console.log(`dry-run: ${rows.length} files, 0 uploads. pass --confirm to write to ${bucket}.`);
  process.exit(0);
}

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --confirm");
  process.exit(1);
}
if (/graph\.facebook\.com/i.test(supabaseUrl) || /graph\.facebook\.com/i.test(serviceKey)) {
  console.error("refusing: this script never calls Meta");
  process.exit(1);
}

let failed = 0;
for (const row of rows) {
  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${row.rel.split("/").map(encodeURIComponent).join("/")}`;
  const buf = await readFile(path.join(baseDir, row.rel));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": mimeOf(row.rel),
      "x-upsert": "true",
    },
    body: buf,
  });
  if (!res.ok) {
    failed++;
    const text = await res.text();
    console.error(`FAIL\t${res.status}\t${row.rel}\t${text.slice(0, 300)}`);
  } else {
    console.log(`UPLOADED\t${row.rel}`);
  }
}
if (failed) {
  console.error(`uploaded ${rows.length - failed} of ${rows.length}`);
  process.exit(1);
}
console.log(`uploaded ${rows.length} files to ${bucket}. Meta was not called.`);
