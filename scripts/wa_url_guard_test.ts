// כלל 30.10.2026: גוף וואטסאפ בלי כתובת גלויה. הכפתור נבנה מהכתובת.
//
//   node --experimental-strip-types scripts/wa_url_guard_test.ts

import {
  buttonLabelForUrl,
  MAX_WA_MESSAGES,
  payloadsForText,
  planWaText,
  WA_EMPTY_BODY,
  WA_NO_BUTTON,
} from "../supabase/functions/_shared/wa-url-guard.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}`, detail === undefined ? "" : detail);
  }
}

const clean = planWaText("שלום, הנכס מחכה.");
check("בלי כתובת לא נוגעים", !clean.stripped && clean.text === "שלום, הנכס מחכה." && clean.links.length === 0);

const one = planWaText("לפרטים: https://shuknadlan.co.il/crm?goto=accLeads");
check("כתובת אחת יוצאת מהגוף", one.stripped && !one.text.includes("http") && one.links.length === 1);
check("כפתור CRM", one.links[0]?.label === "פתיחה ב-CRM" && one.links[0]?.kind === "cta");
check("המשפט נשאר", one.text.startsWith("לפרטים"));

const several = planWaText(
  "דף הנכס https://shuknadlan.co.il/property?id=abc וגם https://shuknadlan.co.il/pricing",
);
check("שתי כתובות", several.links.length === 2 && !several.text.includes("http"));
check("תוויות שונות", several.links.map((l) => l.label).join(",") === "לדף הנכס,למסלולים");

const dup = planWaText("https://shuknadlan.co.il/pricing https://shuknadlan.co.il/pricing");
check("כפילות נספרת פעם", dup.links.length === 1);

const wa = planWaText("אפשר גם לכתוב ישירות.\nwa.me/972501234567");
check("wa.me בלי סכמה", wa.links[0]?.url === "https://wa.me/972501234567" && wa.links[0]?.label === "שליחת הודעה");
check("המספר לא בגוף", !wa.text.includes("972") && !wa.text.includes("wa.me"));

const video = planWaText("הסרטון: https://abc.supabase.co/storage/v1/object/public/v/clip.mp4");
check("mp4 הוא מדיה", video.links[0]?.kind === "video" && !video.text.includes("http"));

const home = planWaText("האתר: https://shuknadlan.co.il/");
check("שורש האתר", home.links[0]?.label === "לאתר");

const payloads = payloadsForText("972500000000", several.text.includes("http") ? "" : 
  "דף https://shuknadlan.co.il/property?id=abc\nhttps://shuknadlan.co.il/pricing\nhttps://shuknadlan.co.il/sign?t=1");
check("כפתור אחד בהודעה הראשונה", payloads.payloads[0]?.type === "interactive");
check("לכל היותר שתי הודעות", payloads.payloads.length === MAX_WA_MESSAGES);
check("גוף בלי כתובת", JSON.stringify(payloads.payloads).includes("https://") 
  ? (payloads.payloads as { type: string; interactive?: { body?: { text?: string } }; text?: { body?: string } }[])
      .every((p) => {
        const body = p.interactive?.body?.text || p.text?.body || "";
        return !body.includes("http") && !body.includes("wa.me");
      })
  : false);
const first = payloads.payloads[0] as { interactive: { body: { text: string }; action: { parameters: { display_text: string; url?: string } } } };
const second = payloads.payloads[1] as { interactive: { body: { text: string }; action: { parameters: { display_text: string } } } };
check("מה שנשאר הולך לאתר", second.interactive.body.text === "לאתר" && second.interactive.action.parameters.display_text === "לאתר");
check("כותרת בתוך 20", Array.from(first.interactive.action.parameters.display_text).length <= 20);

const two = payloadsForText("972500000000", "דף https://shuknadlan.co.il/property?id=abc\nhttps://shuknadlan.co.il/pricing");
const twoSecond = two.payloads[1] as { interactive: { body: { text: string }; action: { parameters: { display_text: string } } } };
check("המשך של יעד אחד הוא שם היעד", two.payloads.length === 2 && twoSecond.interactive.body.text === "למסלולים" && twoSecond.interactive.action.parameters.display_text === "למסלולים");

const tooMany = planWaText(Array.from({ length: 8 }, (_, i) => `https://shuknadlan.co.il/property?id=${i}`).join("\n"));
const capped = payloadsForText("972500000000", tooMany.text + "\n" + Array.from({ length: 8 }, (_, i) => `https://shuknadlan.co.il/crm?goto=accProperties&property=${i}`).join(" "));
check("תקרה של שתי הודעות", capped.payloads.length === MAX_WA_MESSAGES);

const empty = planWaText("https://shuknadlan.co.il/agreement?t=1");
check("גוף ריק מקבל משפט", empty.text === WA_EMPTY_BODY && empty.links[0]?.label === "להסכם");

check("הרשמה אינה חתימה", buttonLabelForUrl("https://shuknadlan.co.il/signup") === "להצטרפות");
check("agency-signup אינה משרד ואינה חתימה", buttonLabelForUrl("https://shuknadlan.co.il/agency-signup") === "להצטרפות");
check("חתימה נשארת חתימה", buttonLabelForUrl("https://shuknadlan.co.il/sign?t=abc") === "לחתימה");
check("תווית פגישה", buttonLabelForUrl("https://shuknadlan.co.il/meeting?t=abc") === "לפגישה");
check("תווית מיניסייט", buttonLabelForUrl("https://shuknadlan.co.il/showcase?t=abc") === "לעמוד האישי");
check("תווית הסרה", buttonLabelForUrl("https://example.com/saved-search-manage?action=unsubscribe&token=1") === "הפסקת עדכונים");
check("משפט בלי כפתור", WA_NO_BUTTON === "פרטים ב-CRM" && !WA_NO_BUTTON.includes("http"));

const long = `${"א".repeat(1100)} https://shuknadlan.co.il/property?id=abc`;
const split = payloadsForText("972500000000", long);
check("גוף ארוך יוצא כטקסט ואז כפתור", split.payloads.length === 2
  && (split.payloads[0] as { type?: string }).type === "text"
  && (split.payloads[1] as { type?: string }).type === "interactive");
const longBody = (split.payloads[0] as { text: { body: string } }).text.body;
check("הטקסט הארוך לא נחתך ל-1024", longBody.length > 1024 && !longBody.includes("http"));
check("הכפתור שאחריו קצר", (split.payloads[1] as { interactive: { body: { text: string } } }).interactive.body.text === WA_EMPTY_BODY);

const withButton = payloadsForText(
  "972500000000",
  "הסרטון https://cdn.example.com/a.mp4 והדף https://shuknadlan.co.il/property?id=abc",
);
check("וידאו ואז כפתור", withButton.payloads.length === 2
  && (withButton.payloads[0] as { type?: string }).type === "video"
  && (withButton.payloads[1] as { type?: string }).type === "interactive");

const longVideo = payloadsForText(
  "972500000000",
  `${"א".repeat(1500)} https://cdn.example.com/a.mp4 https://shuknadlan.co.il/property?id=abc https://shuknadlan.co.il/pricing`,
);
const longTypes = longVideo.payloads.map((p) => (p as { type?: string }).type);
const longButton = longVideo.payloads[2] as { interactive?: { body?: { text?: string }; action?: { parameters?: { url?: string; display_text?: string } } } };
check("גוף ארוך עם וידאו יוצא כטקסט קודם", longTypes.join(",") === "text,video,interactive"
  && (longVideo.payloads[0] as { text: { body: string } }).text.body.length > 1024);
check("הכפתור הוא היעד הראשון ולא דף הבית", longButton.interactive?.action?.parameters?.display_text === "לדף הנכס"
  && String(longButton.interactive?.action?.parameters?.url || "").includes("/property")
  && longButton.interactive?.body?.text === "לדף הנכס");

const videoPayloads = payloadsForText("972500000000", "מוכן https://cdn.example.com/a.mp4");
check("וידאו לא כפתור", videoPayloads.payloads.length === 2
  && videoPayloads.payloads.some((p) => (p as { type?: string }).type === "video")
  && videoPayloads.payloads.every((p) => (p as { type?: string }).type !== "interactive"));

if (failed) {
  console.log(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ שמירת כתובות בוואטסאפ: כל הבדיקות עברו");
