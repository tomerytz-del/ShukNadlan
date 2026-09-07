// ============================================================================
// סרטון שיווקי לנכס — הלקוח של fal.ai, קטלוג הסצנות ובחירת התמונות.
//
// המנוע כאן הוא image-to-video: כל תמונה של הנכס הופכת לקליפ קצר שבו
// **המצלמה זזה והנכס לא**. זו כל הדוקטרינה, והיא זהה בכוונה לזו של ההדמיות
// (‎_shared/visualization.ts‎): מודל וידאו שמקבל חופש יצירתי מזיז קירות,
// משנה חלונות ומוסיף חדרים שלא קיימים — כלומר מייצר מודעה מטעה. הפרומפטים
// למטה בנויים סביב האיסור הזה ולא סביב "תעשה משהו יפה".
//
// למה fal ולא ffmpeg אצלנו: ל-Edge Function של Deno אין ffmpeg ואין תקציב
// זמן לקידוד וידאו. גם המיזוג רץ אצל fal, ולכן כל מה שקורה כאן הוא שליחת
// בקשות וקבלת כתובות.
// ============================================================================

export const VIDEOS_BUCKET = "property-videos";

// ---------------------------------------------------------------------------
// המודלים
//
// שניהם ניתנים לדריסה מהסביבה בכוונה: קטלוג המודלים של fal מתחלף בקצב מהיר,
// וגרסה חדשה של Kling לא צריכה לגרור פריסה מחדש של הקוד. הערכים כאן הם
// ברירת המחדל שנבדקה, לא הנחה קשיחה.
//
// ‏FAL_VIDEO_MODEL — image-to-video. חייב לקבל ‎image_url‎ ו-‎prompt‎.
// ‏FAL_MERGE_MODEL — חיבור הקליפים לרצף אחד.
// ---------------------------------------------------------------------------
export const FAL_VIDEO_MODEL =
  Deno.env.get("FAL_VIDEO_MODEL") || "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
export const FAL_MERGE_MODEL =
  Deno.env.get("FAL_MERGE_MODEL") || "fal-ai/ffmpeg-api/merge-videos";
// ‏compose **אינו** משמש למיזוג. נמדד מול ה-API החי ונמצא שהוא מתעלם
// מ-‎duration‎, מ-‎timestamp‎ ומ-‎start_from‎ ומשרשר קליפים שלמים — כלומר הוא
// ‎merge-videos‎ עם סכימה מסובכת יותר. נשאר כאן רק כברירת המחדל של
// ‎?mode=probe‎, כלי הבדיקה שבו נמדדה המסקנה הזאת.
export const FAL_COMPOSE_MODEL =
  Deno.env.get("FAL_COMPOSE_MODEL") || "fal-ai/ffmpeg-api/compose";

const FAL_QUEUE = "https://queue.fal.run";

function falKey(): string {
  return Deno.env.get("FAL_KEY") || "";
}

// ---------------------------------------------------------------------------
// תור הבקשות של fal
//
// ‏POST https://queue.fal.run/{model}  →  { request_id, status_url, response_url }
// ‏GET  {status_url}                   →  { status: IN_QUEUE | IN_PROGRESS | COMPLETED }
// ‏GET  {response_url}                 →  הפלט עצמו
//
// ‏fal_webhook הופך את זה לאסינכרוני לגמרי: fal קורא/ת אלינו כשהבקשה נגמרת,
// ואיננו צריכים להחזיק Edge Function פתוחה לאורך דקות של רינדור. ה-polling
// נשאר בכל זאת כמסלול גיבוי (‎falStatus‎/‎falResult‎), כי webhook שאבד היה
// משאיר בקשה תקועה — ואת הסוכן/ת מחויב/ת.
// ---------------------------------------------------------------------------
export interface FalSubmit {
  ok: boolean;
  requestId?: string;
  error?: string;
}

export async function falSubmit(
  model: string,
  input: Record<string, unknown>,
  webhookUrl?: string
): Promise<FalSubmit> {
  const key = falKey();
  if (!key) return { ok: false, error: "fal_not_configured" };

  const url = new URL(`${FAL_QUEUE}/${model}`);
  if (webhookUrl) url.searchParams.set("fal_webhook", webhookUrl);

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Authorization": `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `fal_${res.status}: ${text.slice(0, 300)}` };
    }
    const data = JSON.parse(text);
    const requestId = data?.request_id ?? data?.requestId;
    if (!requestId) return { ok: false, error: `fal_no_request_id: ${text.slice(0, 200)}` };
    return { ok: true, requestId };
  } catch (err) {
    return { ok: false, error: `fal_network: ${(err as Error).message}` };
  }
}

// ‏status ו-result לפי model+request_id, כי זו הצורה שה-reconcile מחזיק —
// ‎status_url‎ המקורי לא נשמר, ואפשר להרכיב אותו מחדש מהשניים.
export async function falStatus(model: string, requestId: string): Promise<string | null> {
  const key = falKey();
  if (!key) return null;
  try {
    const res = await fetch(`${FAL_QUEUE}/${model}/requests/${requestId}/status`, {
      headers: { "Authorization": `Key ${key}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.status ?? null;
  } catch {
    return null;
  }
}

export async function falResult(model: string, requestId: string): Promise<unknown | null> {
  const key = falKey();
  if (!key) return null;
  try {
    const res = await fetch(`${FAL_QUEUE}/${model}/requests/${requestId}`, {
      headers: { "Authorization": `Key ${key}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// חילוץ כתובת הווידאו מהתשובה
//
// חיפוש עמוק ולא נתיב קבוע, וזו החלטה מכוונת: המודלים של fal אינם אחידים —
// חלקם מחזירים ‎{ video: { url } }‎, חלקם ‎{ video_url }‎ וחלקם ‎{ videos: [...] }‎ —
// והמודל כאן ניתן להחלפה מהסביבה. נתיב קשיח היה הופך כל החלפת מודל לתקלה
// שקטה שבה הקליפ נוצר, שולם עליו, והקוד מדווח שאין תוצאה.
// ---------------------------------------------------------------------------
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

export function extractVideoUrl(payload: unknown): string | null {
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number): string | null => {
    if (node == null || depth > 8) return null;
    if (typeof node === "string") {
      return /^https?:\/\//i.test(node) && VIDEO_EXT.test(node) ? node : null;
    }
    if (typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = walk(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }

    // המפתחות המקובלים נבדקים ראשונים, כדי שתשובה שיש בה גם תמונת תצוגה
    // מקדימה וגם וידאו לא תחזיר את התמונה.
    const obj = node as Record<string, unknown>;
    for (const key of ["video", "video_url", "videos", "url", "output"]) {
      if (key in obj) {
        const hit = walk(obj[key], depth + 1);
        if (hit) return hit;
      }
    }
    for (const value of Object.values(obj)) {
      const hit = walk(value, depth + 1);
      if (hit) return hit;
    }
    return null;
  };

  return walk(payload, 0);
}

// ---------------------------------------------------------------------------
// קטלוג הסצנות
//
// לכל מטרה יש תנועת מצלמה משלה, והיא נגזרת ממה שבפריים ולא מהעדפה אסתטית:
//
//   • חוץ — תנועת רחפן. זו התנועה היחידה שבאמת מתאימה לחזית, והיא גם מה
//     שהסוכן/ת מצפה לו כשהוא/היא מבקש/ת "סרטון כמו מרחפן". עלייה איטית או
//     ריחוף לאחור, בלי להסתובב סביב הבניין: סיבוב דורש מהמודל להמציא צדדים
//     שהוא לא ראה, וזה בדיוק הרגע שבו הוא מוסיף קומה.
//   • פנים — דולי קדימה איטי. מודל וידאו שמסתובב בחדר מייצר קירות חדשים;
//     תנועה קדימה בציר אחד נשארת בתוך מה שהצילום כבר מראה.
//
// כל פרומפט נחתם באותה הוראה כמו בהדמיות: בספק — לא לשנות.
// ---------------------------------------------------------------------------
export type SceneTarget = "exterior" | "living_room" | "kitchen" | "bedroom" | "bathroom" | "balcony" | "other";

const CAMERA: Record<SceneTarget, string> = {
  exterior:
    "Slow cinematic aerial drone shot: the camera rises gently and pulls back, revealing the building and its immediate surroundings.",
  living_room:
    "Slow cinematic dolly-in: the camera glides forward through the living room at chest height, steady and level.",
  kitchen:
    "Slow cinematic dolly-in: the camera glides forward along the kitchen counter, steady and level.",
  bedroom:
    "Slow cinematic dolly-in: the camera glides forward into the bedroom at chest height, steady and level.",
  bathroom:
    "Slow, subtle forward push: the camera moves gently into the room, steady and level.",
  balcony:
    "Slow cinematic push forward toward the balcony opening, revealing the view beyond.",
  other:
    "Slow, subtle forward push: the camera moves gently forward, steady and level.",
};

// האיסורים. זהה בכוונה לרוח הפרומפטים של ההדמיות — מה שמשתנה כאן הוא
// שהאיסור חל גם על *הזמן*: מודל וידאו יכול לשנות את הנכס תוך כדי הקליפ.
const FORBIDDEN = [
  "Do NOT change the architecture: keep every wall, window, door, opening and roofline exactly as photographed.",
  "Do NOT add, remove or resize rooms, floors, balconies or furniture.",
  "Do NOT add people, pets, text, logos, watermarks or vehicles that are not already in the photo.",
  "Do NOT change the time of day, the weather or the season.",
  "Do NOT morph, warp or melt any surface; straight lines must stay straight for the whole clip.",
  "The scene must remain the same real property from the first frame to the last — only the camera moves.",
].join(" ");

export function buildScenePrompt(target: SceneTarget, propertyType: string | null): string {
  const subject = target === "exterior"
    ? `the exterior of this ${propertyType || "property"}`
    : "this interior space";
  return [
    `Real estate marketing video of ${subject}.`,
    CAMERA[target] ?? CAMERA.other,
    "Photorealistic, natural daylight, stable horizon, no camera shake.",
    FORBIDDEN,
    "If you are unsure whether a change alters the property, do not make it.",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// בחירת התמונות וסדרן
//
// הסדר הוא סדר של מודעה ולא של הגלריה: קודם חוץ (זה השוט שמסביר איפה אנחנו),
// אחר כך סלון, מטבח, ורק בסוף השאר. זה גם הסדר שבו קונה מסתכל/ת על נכס.
//
// הבחירה נשענת על ‎property_image_tags‎ שכבר קיים ומאוכלס על ידי
// ‎classify-property-images‎. נכס שטרם סווג לא נחסם: ‎fallbackOrder‎ פשוט
// לוקח/ת את התמונות לפי הסדר שבו הסוכן/ת העלה/תה אותן, וזה סדר סביר בפני
// עצמו — רוב הסוכנים מעלים את החזית ראשונה.
// ---------------------------------------------------------------------------
export interface TaggedImage {
  image_url: string;
  photo_type?: string | null;
  space_role?: string | null;
  room_type?: string | null;
}

export interface PickedScene {
  target: SceneTarget;
  url: string;
}

const ROOM_TO_TARGET: Record<string, SceneTarget> = {
  facade: "exterior",
  yard: "exterior",
  living_room: "living_room",
  kitchen: "kitchen",
  bedroom: "bedroom",
  bathroom: "bathroom",
  balcony: "balcony",
  other: "other",
};

// סדר העדיפות ברצף. חדר אמבטיה אינו ברשימה בכוונה: הוא כמעט תמיד השוט
// החלש ביותר במודעה, והוא נכנס רק אם אין מספיק תמונות אחרות.
const SCENE_ORDER: SceneTarget[] = ["exterior", "living_room", "kitchen", "bedroom", "balcony", "other", "bathroom"];

export function pickScenes(tags: TaggedImage[], images: string[], limit: number): PickedScene[] {
  const used = new Set<string>();
  const picked: PickedScene[] = [];

  const byTarget = new Map<SceneTarget, string[]>();
  for (const tag of tags) {
    if (!tag.image_url) continue;
    const target = tag.room_type
      ? ROOM_TO_TARGET[tag.room_type] ?? "other"
      : tag.photo_type === "exterior"
        ? "exterior"
        : "other";
    const list = byTarget.get(target) ?? [];
    list.push(tag.image_url);
    byTarget.set(target, list);
  }

  // סבב ראשון: תמונה אחת לכל מטרה, לפי סדר הרצף. כך סרטון של ארבעה קליפים
  // מראה ארבעה מקומות שונים בנכס ולא ארבע זוויות של אותו סלון.
  for (const target of SCENE_ORDER) {
    if (picked.length >= limit) break;
    const url = (byTarget.get(target) ?? []).find((u) => !used.has(u));
    if (!url) continue;
    used.add(url);
    picked.push({ target, url });
  }

  // סבב שני: אם עדיין חסרים קליפים, ממלאים בתמונות נוספות מאותן מטרות.
  for (const target of SCENE_ORDER) {
    if (picked.length >= limit) break;
    for (const url of byTarget.get(target) ?? []) {
      if (picked.length >= limit) break;
      if (used.has(url)) continue;
      used.add(url);
      picked.push({ target, url });
    }
  }

  // גיבוי אחרון: נכס שטרם סווג. הסדר של הסוכן/ת, והתמונה הראשונה מטופלת
  // כחוץ — זו ברירת המחדל הנכונה ברוב המודעות.
  for (const url of images) {
    if (picked.length >= limit) break;
    if (used.has(url)) continue;
    used.add(url);
    picked.push({ target: picked.length === 0 ? "exterior" : "other", url });
  }

  return picked;
}

// ---------------------------------------------------------------------------
// הקלט למודל
//
// ‎duration‎ נשלח כמחרוזת: כך Kling ורוב מודלי ה-i2v ב-fal מצפים לקבל אותו
// (‎"5"‎ / ‎"10"‎). מודל שמצפה למספר יקבל מחרוזת מספרית ויפרש אותה נכון ברוב
// המקרים; מודל שנבחר דרך ‎FAL_VIDEO_MODEL‎ וסכימתו שונה מתועד ב-docs.
// ---------------------------------------------------------------------------
export function buildClipInput(
  imageUrl: string,
  prompt: string,
  seconds: number,
  aspectRatio: string
): Record<string, unknown> {
  return {
    image_url: imageUrl,
    prompt,
    // ‏String(5) הוא "5" ולא "5.0" — חשוב, כי מודל עם רשימה סגורה משווה
    // מחרוזות ו-"5.0" ייפול אצלו. שבר נשלח כמו שהוא ("2.5").
    duration: String(seconds),
    aspect_ratio: aspectRatio,
    // תנועת מצלמה בלבד — ההוראה חוזרת גם כ-negative prompt כי זה הערוץ
    // שהמודלים מצייתים לו הכי טוב.
    negative_prompt:
      "distortion, warping, morphing walls, changing architecture, extra floors, extra windows, text, watermark, people, cartoon, blurry",
  };
}

// ---------------------------------------------------------------------------
// כשל חולף מול כשל אמיתי
//
// ‏**למה בכלל צריך להבחין:** בהרצה אמיתית קליף אחד קיבל ‎403‎ של "יתרה
// אזלה" בזמן שהקליף **שאחריו** נשלח בהצלחה באותה לולאה. כלומר זה לא היה
// מצב החשבון אלא רעש רגעי — ותמונה אחת ירדה מהסרטון בלי סיבה אמיתית.
// ניסיון שני אחד הוא המחיר הזול ביותר לכך שתמונה לא תתפספס.
//
// ‏422 **אינו** ברשימה בכוונה: הוא אומר שהקלט עצמו פסול (למשל ‎duration‎ שאינו
// נתמך), ושליחה חוזרת שלו רק תשלם שוב על אותה דחייה.
// ---------------------------------------------------------------------------
export function isTransientFailure(error: string | undefined): boolean {
  if (!error) return false;
  if (/^fal_network/.test(error)) return true;
  return /^fal_(403|408|409|425|429|5\d\d)/.test(error);
}

// חיבור פשוט, בלי חיתוך. זה המסלול שנבדק בפרודקשן ועבד.
export function buildMergeInput(clipUrls: string[], aspectRatio: string): Record<string, unknown> {
  return {
    video_urls: clipUrls,
    resolution: aspectRatio === "9:16" ? "portrait_16_9" : "landscape_16_9",
  };
}

// ---------------------------------------------------------------------------
// שמירת הקובץ אצלנו
//
// הכתובת ש-fal מחזיר/ה היא זמנית ומתארחת אצלם — מודעה שמצביעה עליה הייתה
// נשברת בלי התראה. לכן הקובץ יורד ומועלה לדלי שלנו, לאותו נתיב שה-CRM כותב
// אליו ממילא (‎<agent_id>/<property_id>/‎), כדי ש-‎cleanupReplacedVideo‎
// ב-crm.html תדע למחוק אותו כשהסוכן/ת יחליף/תחליף סרטון ידנית.
// ---------------------------------------------------------------------------
export async function storeFinalVideo(
  supabase: any,
  agentId: string,
  propertyId: string,
  sourceUrl: string
): Promise<{ url?: string; error?: string }> {
  let bytes: Uint8Array;
  let contentType = "video/mp4";
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) return { error: `download_failed_${res.status}` };
    contentType = res.headers.get("content-type") || "video/mp4";
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return { error: `download_error: ${(err as Error).message}` };
  }

  if (!bytes.length) return { error: "empty_video" };

  // הדלי חסום ל-50MB ול-mp4/webm/mov. חריגה נכשלת ממילא בהעלאה, אבל הודעה
  // מפורשת כאן חוסכת ניחוש מול שגיאת Storage גנרית.
  if (bytes.length > 50 * 1024 * 1024) return { error: "video_too_large" };

  const ext = contentType.includes("webm") ? "webm" : "mp4";
  const mime = ext === "webm" ? "video/webm" : "video/mp4";
  const path = `${agentId}/${propertyId}/marketing-${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(VIDEOS_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: true });
  if (error) return { error: `upload_failed: ${error.message}` };

  const { data } = supabase.storage.from(VIDEOS_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

// מוחקת את הקובץ הישן רק כשהוא שלנו. סרטון שהודבק מיוטיוב אינו קובץ בדלי,
// וניסיון למחוק אותו הוא no-op — אבל הבדיקה כאן מונעת גם את המקרה שבו
// הכתובת מצביעה על דלי אחר לגמרי.
export async function removeStoredVideo(supabase: any, url: string | null): Promise<void> {
  if (!url) return;
  const marker = `/storage/v1/object/public/${VIDEOS_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return;
  const path = decodeURIComponent(url.slice(at + marker.length).split("?")[0]);
  if (!path) return;
  await supabase.storage.from(VIDEOS_BUCKET).remove([path]).catch(() => {});
}

// ---------------------------------------------------------------------------
// מדידת אורך של MP4 — בלי ffmpeg ובלי שירות חיצוני
//
// **למה זה נדרש:** ‏`compose` החזיר "הצלחה" על בקשת חיתוך שלא חתכה כלום.
// כישלון שקט כזה אי אפשר לזהות מהסטטוס — רק מהאורך של הקובץ שיצא. בלי
// המדידה הזאת כל ניסיון לתקן את הסכימה היה מחייב אדם שיפתח את הסרטון
// ויספור שניות.
//
// הקופסה ‎mvhd‎ (בתוך ‎moov‎) מחזיקה ‎timescale‎ ו-‎duration‎, והחלוקה ביניהם
// היא האורך בשניות. מחפשים את החתימה בבתים במקום לפרסר את עץ הקופסאות:
// ‏‎moov‎ יכול לשבת בתחילת הקובץ או בסופו, וסריקה פשוטה עובדת בשני המקרים.
// ---------------------------------------------------------------------------
export async function measureMp4Seconds(url: string): Promise<number | null> {
  let bytes: Uint8Array;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }

  // חיפוש "mvhd" כרצף בתים
  const sig = [0x6d, 0x76, 0x68, 0x64]; // m v h d
  let at = -1;
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === sig[0] && bytes[i + 1] === sig[1] && bytes[i + 2] === sig[2] && bytes[i + 3] === sig[3]) {
      at = i;
      break;
    }
  }
  if (at === -1) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = at + 4; // אחרי שם הקופסה מגיע version+flags
  if (base + 32 > bytes.length) return null;

  const version = bytes[base];
  let timescale: number;
  let duration: number;
  if (version === 1) {
    timescale = view.getUint32(base + 20);
    // ‏duration הוא 64 ביט; ‏Number מספיק בשלמות עד 2^53 וסרטון לא מתקרב לזה
    duration = Number(view.getBigUint64(base + 24));
  } else {
    timescale = view.getUint32(base + 12);
    duration = view.getUint32(base + 16);
  }

  if (!timescale || !duration) return null;
  return Math.round((duration / timescale) * 100) / 100;
}

export function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

// השוואה בזמן קבוע לטוקן ה-webhook, מאותו טעם כמו ב-cron-auth.ts
export function tokensMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
