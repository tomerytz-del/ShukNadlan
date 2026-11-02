// תגובת אימוג'י בוואטסאפ אינה הודעה לגבריאלה.
//   deno test supabase/functions/whatsapp-webhook/inbound_kind_test.ts

import { isReactionMessage } from "./inbound-kind.ts";

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
