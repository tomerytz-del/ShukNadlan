// תגובת אימוג'י בוואטסאפ אינה הודעה לגבריאלה.
//   deno test supabase/functions/whatsapp-webhook/inbound_kind_test.ts

import {
  FAIR_USE_BUTTON_TYPES, FAIR_USE_CAPTION_TYPES, FAIR_USE_COUNTED_TYPES, fairUseNeverBlocks, isReactionMessage,
} from "./inbound-kind.ts";

function fail(message: string): never {
  throw new Error(message);
}

Deno.test("תגובת אימוג'י נעצרת בלי תשובה ובלי מודל", async () => {
  const reaction = {
    type: "reaction",
    reaction: { message_id: "wamid.abc", emoji: "👍" },
  };
  if (!isReactionMessage(reaction)) fail("תגובה לא זוהתה");
  if (!isReactionMessage({ type: "reaction" })) fail("הסרת תגובה לא נעצרת");
  if (isReactionMessage({ type: "text" })) fail("טקסט");
  if (isReactionMessage({ type: "unsupported" })) fail("unsupported אינו תגובה");
  if (isReactionMessage(null) || isReactionMessage(undefined)) fail("חסר");

  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const handle = src.indexOf("async function handleMessage");
  const gate = src.indexOf("if (isReactionMessage(msg)) return;", handle);
  const typing = src.indexOf("markReadAndTyping(msg.id)", handle);
  const model = src.indexOf("runAgentTurn(", handle);
  const publicCall = src.indexOf("handlePublicMessage(msg)", handle);
  const fallback = src.indexOf("אני יודעת לקבל טקסט, תמונות, הודעות קוליות", handle);
  if (handle < 0 || gate < 0) fail("אין יציאה שקטה");
  if (typing < 0 || gate > typing) fail("התגובה מסמנת הקלדה");
  if (model < 0 || publicCall < 0 || gate > model || gate > publicCall) fail("התגובה מגיעה למודל");
  if (fallback < 0 || gate > fallback) fail("התגובה מקבלת את תשובת הסוג הלא נתמך");

  const rateStart = src.indexOf("async function publicRateExceeded");
  const rateEnd = src.indexOf("async function limitNoticeAlreadySent");
  const inboundStart = src.indexOf("async lastInboundAt");
  const inboundEnd = src.indexOf("async priorWaIds");
  const rate = src.slice(rateStart, rateEnd);
  const inbound = src.slice(inboundStart, inboundEnd);
  if (!rate.includes('.neq("msg_type", "reaction")')) fail("המכסה סופרת תגובות");
  if (!inbound.includes('.neq("msg_type", "reaction")')) fail("חלון 24 השעות נפתח מתגובה");
});

Deno.test("שימוש הוגן: נספרים רק טקסט וקול, וכפתור לעולם אינו נעצר", async () => {
  const counted = new Set(FAIR_USE_COUNTED_TYPES);
  for (const t of ["text", "audio", "voice"]) if (!counted.has(t)) fail(`${t} חייב להיספר`);
  if (!FAIR_USE_CAPTION_TYPES.includes("image")) fail("כיתוב על תמונה הוא טקסט שהסוכן/ת כתב/ה");
  for (const t of FAIR_USE_BUTTON_TYPES) {
    if (counted.has(t) || FAIR_USE_CAPTION_TYPES.includes(t)) fail(`כפתור ${t} נספר`);
  }
  for (const t of ["interactive", "button", "image", "document", "video", "reaction", "contacts"]) {
    if (counted.has(t)) fail(`${t} אינו אמור להיספר`);
  }
  if (!fairUseNeverBlocks({ type: "interactive" })) fail("לחיצה על כפתור של גבריאלה נעצרת");
  if (!fairUseNeverBlocks({ type: "button" })) fail("לחיצה על כפתור בתבנית נעצרת");
  if (fairUseNeverBlocks({ type: "text" }) || fairUseNeverBlocks({ type: "audio" })) fail("טקסט וקול נבדקים");
  if (fairUseNeverBlocks(null)) fail("חסר");

  // החסימה עוברת דרך שלושת התנאים, ובסדר: כפתור, תקרה, ואז שיחה פעילה.
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const gate = src.indexOf('String(agent.tier) === "mid" && !fairUseNeverBlocks(msg)');
  const exceeded = src.indexOf("await fairUseExceeded(agent.id)", gate);
  const session = src.indexOf("!(await fairUseInProgress(agent.id))", gate);
  const model = src.indexOf("runAgentTurn(", gate);
  if (gate < 0 || exceeded < 0 || session < 0) fail("השער אינו בודק כפתור, תקרה ושיחה פעילה");
  if (model < 0 || session > model) fail("השער אחרי המודל");
  if (!/\.in\("msg_type", FAIR_USE_COUNTED_TYPES/.test(src)) fail("המונה אינו מסנן לפי סוג");
  // שיחה פעילה אינה נפתחת מלחיצה על כפתור, ואינה נשענת על pending_images (שאינן נמחקות).
  const inProgress = src.slice(src.indexOf("async function fairUseInProgress"), src.indexOf("async function fairUseShouldAnnounce"));
  if (!inProgress.includes("FAIR_USE_BUTTON_TYPES")) fail("כפתור פותח שיחה פעילה");
  if (inProgress.includes(".select(\"pending_images")) fail("שיחה פעילה נשענת על pending_images");
});
