// המספר שהתשובה יוצאת ממנו (whatsapp.ts, "שני מספרים"): ההקשר של withSender
// נשמר אחרי await, אחרי setTimeout ובתוך שרשרת שנרשמה בתוך הריצה (כמו
// paceRecipient), ואינו דולף בין ריצות מקבילות. ו-isPublicNumber מכיר את
// המספר הציבורי רק כשהסוד קיים.
//
//   deno test --allow-read --allow-env supabase/functions/whatsapp-webhook/sender_context_test.ts
//
// הסודות נקבעים לפני הייבוא, כי המודול קורא אותם בטעינה.
Deno.env.set("WHATSAPP_PHONE_NUMBER_ID", "111");
Deno.env.set("WHATSAPP_PUBLIC_PHONE_NUMBER_ID", "222");

const { withSender, isPublicNumber, publicNumberConfigured, currentSenderId } = await import("./whatsapp.ts");

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test("isPublicNumber: רק המזהה הציבורי, ורק כשהסוד קיים", () => {
  assert(publicNumberConfigured(), "הסוד הציבורי אמור להיות מוגדר בבדיקה");
  assert(isPublicNumber("222"), "המזהה הציבורי לא זוהה");
  assert(isPublicNumber(" 222 "), "רווחים סביב המזהה אמורים להיגזר");
  assert(!isPublicNumber("111"), "המספר של הסוכנים זוהה כציבורי");
  assert(!isPublicNumber(""), "מזהה ריק זוהה כציבורי");
  assert(!isPublicNumber(undefined), "undefined זוהה כציבורי");
});

Deno.test("withSender: ברירת המחדל בלי הקשר, ובמזהה של הסוכנים", async () => {
  assert(currentSenderId() === "111", "בלי הקשר - המספר של הסוכנים");
  const inside = await withSender("111", async () => currentSenderId());
  assert(inside === "111", "המזהה של הסוכנים אינו פותח הקשר");
  const empty = await withSender("", async () => currentSenderId());
  assert(empty === "111", "מזהה ריק אינו פותח הקשר");
});

Deno.test("withSender: ההקשר נשמר אחרי await ו-setTimeout, ולא דולף בין ריצות", async () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // שרשרת שנוצרה מחוץ לריצה, ו-.then שנרשם בתוכה - הדפוס של paceRecipient
  let chain: Promise<unknown> = Promise.resolve();
  const paced = (fn: () => Promise<string>) => {
    const run = chain.then(fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
  const seen = await Promise.all([
    withSender("222", async () => {
      await sleep(20);
      const a = currentSenderId();
      const b = await paced(async () => { await sleep(5); return currentSenderId(); });
      return `${a},${b}`;
    }),
    withSender("333", async () => {
      await sleep(5);
      const a = currentSenderId();
      const b = await paced(async () => currentSenderId());
      return `${a},${b}`;
    }),
    (async () => { await sleep(10); return currentSenderId(); })(),
  ]);
  assert(seen[0] === "222,222", `הריצה הציבורית איבדה הקשר: ${seen[0]}`);
  assert(seen[1] === "333,333", `ריצה שנייה איבדה הקשר או קיבלה את הראשונה: ${seen[1]}`);
  assert(seen[2] === "111", `ריצה בלי הקשר קיבלה הקשר זר: ${seen[2]}`);
  assert(currentSenderId() === "111", "ההקשר דלף החוצה אחרי הריצות");
});
