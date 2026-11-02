// קריאת תשובת Whisper, בלי רשת. משותף לתמלול ולקובץ הבדיקות.
//
// הודעה קולית קצרה של סוכן/ת אינה "שיחת מתווך ולקוח". הפרומפט הארוך של
// Whisper הוא הטקסט שקדם להקלטה, ועל קליפ של כמה שניות הוא מחזיר טקסט
// ריק (או את הפרומפט עצמו) בזמן ש-segments לפעמים כן מחזיקים את הדיבור.
// ‏2.11.2026: הודעה של 4 שניות הגיעה בלי מילים, והמודל חזר על שאלות פתוחות.

/** מתחת לזה הודעה קולית (opus של וואטסאפ, בערך עד חצי דקה) נשלחת בלי פרומפט. */
export const VOICE_NOTE_HINT_MAX_BYTES = 48_000;
/** מתחת לזה אין מה לתמלל: קובץ שנחתך בהורדה, לא הודעה של כמה שניות. */
export const VOICE_NOTE_MIN_BYTES = 400;
export const VOICE_NOTE_HINT = "הודעה קולית: פגישה, לקוח, נכס, היום, מחר.";
export const VOICE_NOTE_EMPTY_REPLY = "לא שמעתי מילים בהקלטה. אפשר לשלוח שוב, או לכתוב?";
/** כשל מפתח, מכסה או רשת. לא מציגים את זה כאילו ההקלטה הייתה ריקה. */
export const VOICE_NOTE_ERROR_REPLY = "לא הצלחתי לעבד את ההקלטה עכשיו. אפשר לשלוח שוב, או לכתוב?";

/** שתיקה אמיתית מול כשל תמלול. הקורא רושם את הכשל בלוג. */
export function voiceFailureReply(silent: boolean): { reply: string; error: string } {
  if (silent) return { reply: VOICE_NOTE_EMPTY_REPLY, error: "transcription_silent" };
  return { reply: VOICE_NOTE_ERROR_REPLY, error: "transcription_failed" };
}

/** ‏`audio/ogg; codecs=opus` של וואטסאפ אינו המפתח `audio/ogg` במפה. */
export function normalizeAudioMime(mime: string): string {
  return String(mime || "").split(";")[0].trim().toLowerCase();
}

const AUDIO_MIME_EXT: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
  "audio/aac": "aac", "audio/ogg": "ogg", "audio/opus": "ogg", "audio/wav": "wav", "audio/x-wav": "wav",
  "audio/webm": "webm", "audio/flac": "flac", "audio/amr": "amr", "audio/3gpp": "m4a", "video/mp4": "mp4",
};

/** סיומת לפי סוג ה-MIME, אחרי השמטת פרמטרים. null כשהסוג לא מוכר. */
export function extFromAudioMime(mime: string): string | null {
  return AUDIO_MIME_EXT[normalizeAudioMime(mime)] || null;
}

export function whisperHintFor(opts: {
  call: boolean;
  bytes: number;
  domain: string;
  places: string;
}): string {
  if (!opts.call) {
    return opts.bytes < VOICE_NOTE_HINT_MAX_BYTES ? "" : VOICE_NOTE_HINT;
  }
  return opts.places ? `${opts.domain} מקומות: ${opts.places}.` : opts.domain;
}

export interface WhisperRead {
  text: string | null;
  /** אין דיבור שמיש. לא אומר שה-API נכשל. */
  silent: boolean;
  duration: number;
  /** 0 כשאין segments. גבוה = Whisper בטוח שאין דיבור. */
  noSpeech: number;
  echoed: boolean;
}

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function lettersOf(s: string): string {
  return s.replace(/[^\p{L}\p{N}]/gu, "");
}

function sameWords(a: string, b: string): boolean {
  const na = squash(a).replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  const nb = squash(b).replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  return !!na && na === nb;
}

/** טקסט מ-verbose_json. segments גוברים כשהשדה text ריק. פרומפט שהוחזר כמו שהוא אינו תמלול. */
export function readWhisperBody(out: unknown, hint: string): WhisperRead {
  const o = out && typeof out === "object" ? out as Record<string, unknown> : {};
  const duration = Number(o.duration);
  const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const segments = Array.isArray(o.segments) ? o.segments as Array<Record<string, unknown>> : [];
  const segText = squash(segments.map((s) => String(s.text || "")).join(" "));
  const raw = squash(String(o.text || ""));
  const text = raw || segText;
  const probs = segments.map((s) => Number(s.no_speech_prob)).filter((n) => Number.isFinite(n));
  const noSpeech = probs.length ? Math.max(...probs) : 0;
  const echoed = !!hint && !!text && sameWords(text, hint);
  const letters = lettersOf(echoed ? "" : text);
  if (!letters || letters.length < 2 || echoed) {
    return {
      text: null,
      silent: echoed || dur < 1.2 || noSpeech >= 0.6 || letters.length < 2,
      duration: dur,
      noSpeech,
      echoed,
    };
  }
  if (noSpeech >= 0.85 && letters.length < 12) {
    return { text: null, silent: true, duration: dur, noSpeech, echoed: false };
  }
  return { text: squash(text), silent: false, duration: dur, noSpeech, echoed: false };
}

/**
 * ניסיון שני בלי פרומפט: הקליפ ארוך מספיק לדיבור, ה-API החזיר 200 בלי מילים,
 * ו-Whisper אינו בטוח שזו שתיקה. שתיקה קצרה (no_speech גבוה) אינה ניסיון נוסף.
 */
export function shouldRetryBare(read: WhisperRead, hadHint: boolean): boolean {
  // קריאה שנייה רק כשהפרומפט עצמו חזר. טקסט ריק בלי הד אינו שווה עוד קריאה.
  if (!hadHint || read.text || !read.echoed) return false;
  if (read.duration < 1.2) return false;
  if (read.noSpeech >= 0.9) return false;
  return true;
}

/** ניסיון שני שנכשל ברשת אינו שתיקה. גוף ריק אחרי 200 הוא שתיקה. */
export function detailAfterRetry(
  retry: { ok: false } | { ok: true; read: WhisperRead } | null,
): { text: string | null; silent: boolean } {
  if (!retry || !retry.ok) return { text: null, silent: false };
  if (retry.read.text) return { text: retry.read.text, silent: false };
  return { text: null, silent: true };
}
