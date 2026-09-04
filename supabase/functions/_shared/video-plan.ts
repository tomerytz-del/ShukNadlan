// ============================================================================
// תוכנית הצילום של סרטון נכס — אילו תמונות, באיזה סדר, ובאיזו תנועת מצלמה.
//
// **למה אין כאן קריאה ל-Claude.** התכנון המקורי היה לשלוח כל תמונה למודל
// שפה ולבקש ממנו פרומפט תנועה. השאלה שמודל שפה באמת נדרש לה שם היא "איזה
// חדר זה?" — ועל זה כבר עונה ‎classify-property-images‎ בחינם, בטבלת
// ‎property_image_tags‎. וברגע שידוע שזו חזית, הפרומפט אינו משתנה בין נכס
// לנכס: "דחיפה איטית קדימה" היא אותה הוראה לכל חזית. כלומר הקריאה הייתה
// משלמת, מאטה ומכניסה שונות — כדי להחזיר טקסט שכתוב כאן ממילא.
//
// היתרון המעשי: הפרומפטים האלה ניתנים לכיוונון על ידי מי שרואה את התוצאות.
// קליפ שיוצא רועד הוא שורה שמתקנים כאן, לא ניסוח מחדש של פרומפט-על שמייצר
// פרומפטים.
//
// אם יום אחד הקליפים ירגישו גנריים מדי — הנקודה להחלפה היא ‎clipPrompt‎
// בלבד, וכל השאר (הבחירה, הסדר, ציר הזמן) נשאר.
// ============================================================================

import type { PhotoTags } from "./visualization.ts";

export type TaggedImage = { image_url: string } & PhotoTags;

export interface Shot {
  position: number;
  roomType: string;
  imageUrl: string;
  prompt: string;
}

// ---------------------------------------------------------------------------
// סדר הצילומים
//
// זה סדר של סרטון מכירה ולא של אלבום: פותחים בחזית כי היא אומרת "איפה זה
// ומה זה", ממשיכים לסלון שהוא החלל שקונים, ואז מטבח ומרפסת — שני החללים
// שמכריעים החלטות. חדר שינה ואמבטיה נכנסים רק כשאין אחרים, ו"other" הוא
// המילוי האחרון.
//
// חלל עזר (‎space_role = 'auxiliary'‎ — מסדרון, חדר מדרגות, מחסן) לא נכנס
// בכלל: הוא מה שמצלמים כדי שיהיו תמונות, לא מה שמוכר.
// ---------------------------------------------------------------------------
const ROOM_ORDER = [
  "facade",
  "living_room",
  "kitchen",
  "balcony",
  "yard",
  "bedroom",
  "bathroom",
  "other",
];

// ---------------------------------------------------------------------------
// תנועת המצלמה לכל סוג חלל
//
// שני עקרונות בכל שורה, ושניהם עולים מאותו מקום כמו בלוקי האיסורים של
// ההדמיות (‏_shared/visualization.ts):
//
//   1. **תנועה בלבד.** מודל image-to-video שלא נאמר לו אחרת ישמח להוסיף
//      רהיט, לפתוח דלת או לשנות תאורה — כלומר להראות נכס שלא קיים. כל
//      פרומפט כאן נגמר באיסור המפורש הזה.
//   2. **איטי.** תנועה מהירה חושפת את העיוותים של המודל בקצוות הפריים.
//      "slow" ו-"subtle" הן לא שפה שיווקית כאן אלא הגנה על האיכות.
//
// אנגלית ולא עברית: מודלי הווידאו מאומנים על תיאורים באנגלית, ופרומפט
// בעברית מחזיר תנועה אקראית.
// ---------------------------------------------------------------------------
const MOTION_ONLY =
  "Camera movement only. Do not add, remove, or alter any object, furniture, wall, window, or door. " +
  "Keep the original lighting, colors, and proportions exactly. Photorealistic, no text, no people appearing.";

const CLIP_PROMPTS: Record<string, string> = {
  facade:
    "Slow cinematic aerial drone shot pushing forward toward the building, gentle descent, wide angle, " +
    "steady smooth motion, golden hour light. " + MOTION_ONLY,
  yard:
    "Slow low aerial drone glide across the garden toward the house, smooth stabilized motion, warm daylight. " +
    MOTION_ONLY,
  living_room:
    "Slow steady pan from left to right across the living room, tripod-smooth, subtle forward drift, " +
    "natural daylight from the existing windows. " + MOTION_ONLY,
  kitchen:
    "Slow dolly push-in along the kitchen counter, shallow depth of field, steady gimbal motion, soft interior light. " +
    MOTION_ONLY,
  balcony:
    "Slow forward dolly from inside the balcony toward the open view, steady gimbal motion, bright natural light. " +
    MOTION_ONLY,
  bedroom:
    "Very slow forward push-in into the bedroom, calm steady motion, soft natural light. " + MOTION_ONLY,
  bathroom:
    "Slow subtle pan across the bathroom, steady tripod motion, clean bright light. " + MOTION_ONLY,
  other:
    "Very slow subtle push-in, steady tripod motion, natural light, minimal camera movement. " + MOTION_ONLY,
};

export function clipPrompt(roomType: string | null): string {
  return CLIP_PROMPTS[roomType ?? "other"] ?? CLIP_PROMPTS.other;
}

// ---------------------------------------------------------------------------
// בחירת התמונות
//
// שתי מגבלות שמעצבות את התוצאה:
//
//   • **תמונה אחת לכל סוג חלל.** שני צילומים של אותו סלון הם אותו קליפ
//     פעמיים בעיני הצופה, וסרטון של ארבעה קליפים לא יכול לבזבז שניים.
//   • **סדר ולא ציון.** כשאין חזית, הסרטון פשוט נפתח בסלון. אין כאן
//     "השלמה" מתמונה מסוג אחר — עדיף סרטון של שלושה קליפים אמיתיים
//     מארבעה שאחד מהם הוא מסדרון.
//
// הנפילה לתמונות הגולמיות (‎fallbackImages‎) היא למקרה שהסיווג לא רץ או
// נכשל: בלעדיה נכס עם תמונות מצוינות ובלי תיוג היה מחזיר "אין תמונות
// מתאימות", וזו תשובה שאי אפשר להסביר לסוכן/ת שרואה את הגלריה מולו/ה.
// ---------------------------------------------------------------------------
export function pickShots(
  tags: TaggedImage[],
  fallbackImages: string[],
  limit: number,
): Shot[] {
  const used = new Set<string>();
  const picked: Array<{ roomType: string; imageUrl: string }> = [];

  for (const room of ROOM_ORDER) {
    if (picked.length >= limit) break;
    const hit = tags.find(
      (t) =>
        t.room_type === room &&
        t.space_role !== "auxiliary" &&
        !used.has(t.image_url),
    );
    if (hit) {
      used.add(hit.image_url);
      picked.push({ roomType: room, imageUrl: hit.image_url });
    }
  }

  // עדיין חסר — משלימים מהגלריה לפי הסדר שהסוכן/ת סידר/ה אותה. התמונה
  // הראשונה בגלריה היא זו שנבחרה להיות פני המודעה, ולכן היא גם ההשלמה
  // הראשונה ההגיונית.
  for (const url of fallbackImages) {
    if (picked.length >= limit) break;
    if (used.has(url)) continue;
    used.add(url);
    const tag = tags.find((t) => t.image_url === url);
    picked.push({ roomType: tag?.room_type ?? "other", imageUrl: url });
  }

  return picked.map((p, i) => ({
    position: i,
    roomType: p.roomType,
    imageUrl: p.imageUrl,
    prompt: clipPrompt(p.roomType),
  }));
}

// ---------------------------------------------------------------------------
// ציר הזמן שנשלח ל-ffmpeg של fal
//
// ‎compose‎ מקבל ‎tracks‎, וכל track הוא רשימת keyframes עם ‎url‎, ‎timestamp‎
// ו-‎duration‎ במילישניות. הרצועה הראשונה היא הקליפים בזה אחר זה; רצועת
// האודיו, אם הוגדרה מוזיקה, נמתחת על כל האורך.
//
// **‎crossfadeMs‎.** בברירת המחדל 0 — חיתוכים חדים, וזה גם מה שרוב הרילסים
// של נדל"ן עושים בפועל. ערך גדול מאפס מקצר את ציר הזמן בהתאם ומייצר חפיפה
// בין keyframes; אם הגרסה של fal שמותקנת מפרשת חפיפה כמעבר רך — יתקבל
// crossfade, ואם לא — יתקבלו חיתוכים. בשני המקרים הסרטון נוצר. הפרמטר יושב
// ב-pricing_config בדיוק כדי שאפשר יהיה לבדוק את זה בלי פריסה מחדש.
// ---------------------------------------------------------------------------
export interface TimelineOpts {
  clipUrls: string[];
  clipMs: number;
  crossfadeMs: number;
  musicUrl?: string | null;
}

// deno-lint-ignore no-explicit-any
export function buildComposeTracks(opts: TimelineOpts): { tracks: any[]; totalMs: number } {
  const overlap = Math.max(0, Math.min(opts.crossfadeMs, Math.floor(opts.clipMs / 2)));
  const step = opts.clipMs - overlap;

  const keyframes = opts.clipUrls.map((url, i) => ({
    url,
    timestamp: i * step,
    duration: opts.clipMs,
  }));

  const totalMs = opts.clipUrls.length === 0
    ? 0
    : (opts.clipUrls.length - 1) * step + opts.clipMs;

  // deno-lint-ignore no-explicit-any
  const tracks: any[] = [{ id: "video", type: "video", keyframes }];

  if (opts.musicUrl) {
    tracks.push({
      id: "music",
      type: "audio",
      keyframes: [{ url: opts.musicUrl, timestamp: 0, duration: totalMs }],
    });
  }

  return { tracks, totalMs };
}
