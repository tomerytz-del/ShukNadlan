/**
 * תמלול הקלטה ב-Whisper, משותף לשני מקומות: שיחה במספר הווירטואלי
 * (‏`twilio-voice`) והקלטה שסוכן/ת שולח/ת לגבריאלה בוואטסאפ
 * (‏`whatsapp-webhook/media-intake.ts`). שניהם מקבלים אותם קבצים - הקלטות
 * מטלפונים, עם אותן מעטפות 3gp/m4a שנדחות - ולכן אותו צינור ניסיונות.
 *
 * הועבר כמו שהוא מ-`twilio-voice/index.ts`; ההבדל היחיד הוא שהמפתח וה-client
 * עוברים כפרמטר.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { logAiUsage, unitsRow } from "./ai-usage.ts";

/** ‏Whisper מקבל עד 25MB לקובץ. */
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

/** ‏Whisper מקבל את הקובץ לפי הסיומת, וקובץ m4a מטלפון (מכשירי הקלטה,
 *  Voice Memos) נדחה לפעמים ב-"Invalid file format" למרות שהוא תקין - נצפה
 *  ב-1.10.2026 בסימולציה הראשונה. לכן בדחייה כזו מנסים שוב באותם בתים עם
 *  שם וסוג חלופיים, לפי מה שהבתים עצמם אומרים. */
const WHISPER_RETRY: Record<string, Array<[string, string]>> = {
  m4a: [["mp4", "audio/mp4"], ["mp4", "video/mp4"]],
  mp4: [["m4a", "audio/mp4"]],
  // ‏aac גולמי (‏ADTS, ממקליטי שיחות באנדרואיד) אינו m4a; ‏ffmpeg של Whisper
  // מזהה אותו לפי הבתים כשהשם מתקבל, ולכן גם mp3.
  aac: [["m4a", "audio/mp4"], ["mp4", "audio/mp4"], ["mp3", "audio/mpeg"]],
  webm: [["ogg", "audio/ogg"]],
  ogg: [["oga", "audio/ogg"], ["webm", "audio/webm"]],
};

function findAscii(bytes: Uint8Array, s: string): boolean {
  const c = [...s].map((ch) => ch.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - c.length; i++) {
    for (let j = 0; j < c.length; j++) if (bytes[i + j] !== c[j]) continue outer;
    return true;
  }
  return false;
}

/** הקודק בתוך מעטפת mp4/3gp, לפי ה-sample entry ב-stsd. */
function mp4Codec(bytes: Uint8Array): string {
  if (findAscii(bytes, "mp4a")) return "aac";
  if (findAscii(bytes, "samr")) return "amr";
  if (findAscii(bytes, "sawb")) return "amr-wb";
  return "?";
}

/** ‏ftyp עם מותג 3gp (‏3gp4 - נצפה בהקלטה מטלפון אנדרואיד ב-1.10.2026) נדחה
 *  ב-Whisper גם בשם m4a וגם בשם mp4, אף שהשמע בפנים הוא AAC רגיל. המותג הוא
 *  רק תווית בקופסה הראשונה, ולכן מחליפים אותו בעותק ל-"M4A " (ותאימויות 3g*
 *  ל-"isom") ומנסים שוב. ב-AMR זה לא יעזור - Whisper אינו מכיר את הקודק. */
function rebrandFtyp(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  if (ascii(4, 8) !== "ftyp" || !ascii(8, 10).startsWith("3g")) return null;
  const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  if (size < 16 || size > 256 || size > bytes.length) return null;
  const out = bytes.slice();
  const put = (at: number, s: string) => [...s].forEach((ch, i) => (out[at + i] = ch.charCodeAt(0)));
  put(8, "M4A ");
  for (let at = 16; at + 4 <= size; at += 4) if (ascii(at, at + 2) === "3g") put(at, "isom");
  return out;
}

/** סוג הקובץ לפי הבתים הראשונים - בשביל הלוג, כשהסיומת משקרת. */
export function sniff(bytes: Uint8Array): string {
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  if (ascii(4, 8) === "ftyp") return `mp4(${ascii(8, 12)},${mp4Codec(bytes)})`;
  if (ascii(0, 4) === "OggS") return "ogg";
  if (ascii(0, 4) === "RIFF") return "wav";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "mp3";
  if (bytes[0] === 0x1a && bytes[1] === 0x45) return "webm";
  if (ascii(0, 6) === "#!AMR\n") return "amr";
  return [...bytes.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

/** ‏Whisper שומע שמות מקומות לפי מה שהוא מכיר: בסימולציה הראשונה שעברה,
 *  "רובע יזרעאל" (שכונה בעפולה שבה יש לסוכן שלושה נכסים) יצא "ברוב הישראל",
 *  ו"לשכור" יצא "לזכור". ה-prompt של Whisper הוא רמז אוצר מילים: מילות
 *  התחום, ואחריהן הערים והשכונות של הסוכן/ת - מהנכסים ומהלקוחות שלו/ה,
 *  לפי שכיחות. ‏Whisper קורא רק את ~224 הטוקנים האחרונים, ולכן החיתוך.
 *  אותה רשימה עוברת גם לסיכום, כדי ש-Claude יתקן שם שבכל זאת השתבש. */
export const WHISPER_DOMAIN = "שיחת נדל״ן בין מתווך ללקוח: שכירות, לשכור, קנייה, לקנות, מכירה, דירה, חדרים, מ״ר, " +
  "קומה, מעלית, חניה, ממ״ד, מרפסת, תקציב, מיליון, אלף שקל, משכנתא, בלעדיות, פינוי, כניסה.";
const WHISPER_HINT_MAX = 500;

export async function agentPlaces(supabase: SupabaseClient, agentId: string): Promise<string> {
  const count = new Map<string, number>();
  const add = (s: unknown, w = 1) => {
    const k = typeof s === "string" ? s.trim() : "";
    if (k) count.set(k, (count.get(k) || 0) + w);
  };
  try {
    const [{ data: props }, { data: clients }] = await Promise.all([
      supabase.from("properties").select("city, neighborhood_id").eq("agent_id", agentId).limit(1000),
      supabase.from("agent_clients").select("cities").eq("agent_id", agentId).limit(1000),
    ]);
    const nbIds = [...new Set((props || []).map((p) => p.neighborhood_id).filter(Boolean))];
    const { data: nbs } = nbIds.length
      ? await supabase.from("neighborhoods").select("id, name").in("id", nbIds)
      : { data: [] as Array<{ id: string; name: string }> };
    const nbName = new Map((nbs || []).map((n) => [n.id, n.name]));
    for (const p of props || []) {
      add(p.city, 2);
      add(nbName.get(p.neighborhood_id));
    }
    for (const c of clients || []) for (const city of (c.cities || []) as string[]) add(city);
  } catch (err) {
    console.error("vocabulary hint failed", err);
  }
  let places = "";
  for (const [name] of [...count].sort((a, b) => b[1] - a[1])) {
    // "לב העמק C1" -> "לב העמק": קוד המתחם אינו מה שאומרים בטלפון
    const spoken = name.replace(/\s+[A-Z]\d*$/, "").replace(/\s*\(.*?\)\s*/g, " ").trim();
    if (!spoken || places.includes(spoken)) continue;
    const next = places ? `${places}, ${spoken}` : spoken;
    if (WHISPER_DOMAIN.length + next.length + 8 > WHISPER_HINT_MAX) break;
    places = next;
  }
  return places;
}

async function whisperOnce(
  openaiKey: string,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  ext: string,
  hint: string,
) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), `call.${ext}`);
  form.append("model", "whisper-1");
  form.append("language", "he");
  // ‏verbose_json: אותו text, ובנוסף duration - Whisper מחויב לפי דקות (ai_usage_log)
  form.append("response_format", "verbose_json");
  if (hint) form.append("prompt", hint);
  return await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
  });
}

export async function transcribe(
  openaiKey: string,
  bytes: Uint8Array<ArrayBuffer>,
  mime = "audio/mpeg",
  ext = "mp3",
  hint = WHISPER_DOMAIN,
): Promise<string | null> {
  if (!openaiKey) return null;
  // לפי הבתים ולא לפי מה שהדפדפן אמר: ‏ftyp הוא mp4/m4a גם אם הקובץ נקרא אחרת
  const kind = sniff(bytes);
  if (kind.startsWith("mp4(") && ext !== "m4a" && ext !== "mp4") ext = "m4a";
  const attempts: Array<[Uint8Array<ArrayBuffer>, string, string]> =
    [[ext, mime] as [string, string], ...(WHISPER_RETRY[ext] || [])].map(([e, m]) => [bytes, e, m]);
  // מותג 3gp נדחה בכל שם - העותק עם המותג המתוקן קודם לכל השאר
  const rebranded = rebrandFtyp(bytes);
  if (rebranded) attempts.unshift([rebranded, "m4a", "audio/mp4"]);
  try {
    for (const [b, e, m] of attempts) {
      let res = await whisperOnce(openaiKey, b, m, e, hint);
      // תקלה זמנית (רשת, 429, 5xx) - ניסיון אחד נוסף. דחיית פורמט ממשיכה
      // לניסיונות השם החלופי; מכסה או מפתח לא.
      if (!res.ok && (res.status === 429 || res.status >= 500)) {
        console.error("whisper retry", res.status, `as .${e}`);
        await new Promise((r) => setTimeout(r, 700));
        res = await whisperOnce(openaiKey, b, m, e, hint);
      }
      if (res.ok) {
        const out = await res.json();
        logAiUsage(unitsRow("transcribe", "openai", "whisper-1", (Number(out?.duration) || 0) / 60));
        return ((out?.text as string) || "").trim() || null;
      }
      const body = (await res.text()).slice(0, 300);
      console.error("whisper failed", res.status, `as .${e} (${m})${b === bytes ? "" : " rebranded"}`,
        `sniff=${kind}`, body);
      // רק דחיית פורמט שווה ניסיון נוסף בשם אחר; מכסה, מפתח או תקלה - לא
      if (res.status !== 400 || !/file format/i.test(body)) return null;
    }
    return null;
  } catch (err) {
    // נפילה ברשת לפני תשובה - ניסיון אחד, ואז אומרים לסוכן/ת.
    console.error("transcription failed", err);
    try {
      await new Promise((r) => setTimeout(r, 700));
      const res = await whisperOnce(openaiKey, bytes, mime, ext, hint);
      if (res.ok) {
        const out = await res.json();
        logAiUsage(unitsRow("transcribe", "openai", "whisper-1", (Number(out?.duration) || 0) / 60));
        return ((out?.text as string) || "").trim() || null;
      }
    } catch (err2) {
      console.error("transcription retry failed", err2);
    }
    return null;
  }
}
