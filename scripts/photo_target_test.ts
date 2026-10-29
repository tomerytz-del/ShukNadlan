// שיוך תמונות והעברה בין נכסים. בלי וואטסאפ ובלי מסד.
//   node --experimental-strip-types scripts/photo_target_test.ts
import { readFileSync } from "node:fs";
import { choosePhotoTarget, parsePhotoMoveButton, photoMoveButtons, photoUrlsHash, planPhotoMove, planPhotoTransfer, storageDeleteAllowed, type PhotoCandidate } from "../supabase/functions/whatsapp-webhook/photo-target.ts";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}

const shop: PhotoCandidate = { id: "shop", title: "חנות במרכז", property_type: "חנות", street: "העצמאות", listing_number: 10 };
const plot: PhotoCandidate = { id: "plot", title: "מגרש בגבעת המורה", property_type: "מגרש", street: "האלון", listing_number: 22 };
const plot2: PhotoCandidate = { id: "plot2", title: "מגרש שני", property_type: "מגרש", street: "הזית", listing_number: 23 };
const now = Date.parse("2026-10-29T12:00:00Z");
const fresh = new Date(now - 60_000).toISOString();
const old = new Date(now - 40 * 60_000).toISOString();

const named = choosePhotoTarget({
  lastId: "shop", candidates: [shop, plot], recentText: "הנה תמונות למגרש",
  lastUpdatedAt: fresh, now, idleMs: 20 * 60_000, conversationIdle: false,
});
check("מגרש לא הולך לחנות", named.kind === "attach" && named.id === "plot");

const cont = choosePhotoTarget({
  lastId: "shop", candidates: [shop, plot], recentText: "",
  lastUpdatedAt: fresh, now, idleMs: 20 * 60_000, conversationIdle: false,
});
check("המשך אלבום נשאר על הנכס האחרון", cont.kind === "attach" && cont.id === "shop");

const idle = choosePhotoTarget({
  lastId: "shop", candidates: [shop, plot], recentText: "",
  lastUpdatedAt: old, now, idleMs: 20 * 60_000, conversationIdle: false,
});
check("שקט ארוך שואל", idle.kind === "ask" && idle.ids.includes("shop") && idle.ids.includes("plot"));

const tie = choosePhotoTarget({
  lastId: "shop", candidates: [shop, plot, plot2], recentText: "תמונות למגרש",
  lastUpdatedAt: fresh, now, idleMs: 20 * 60_000, conversationIdle: false,
});
check("שני מגרשים לא מנחשים", tie.kind === "ask" && tie.ids.includes("plot") && tie.ids.includes("plot2") && !tie.ids.includes("shop"));

const only = choosePhotoTarget({
  lastId: null, candidates: [plot], recentText: "",
  lastUpdatedAt: null, now, idleMs: 20 * 60_000, conversationIdle: true,
});
check("נכס יחיד", only.kind === "attach" && only.id === "plot");

const moved = planPhotoMove(
  ["a", "b", "c"],
  ["cover"],
  [1, 3],
);
check("העברה שומרת ראשית ביעד", moved.ok && moved.source.join() === "b" && moved.target.join() === "cover,a,c");
const bad = planPhotoMove(["a"], ["b"], [4]);
check("מספר לא קיים", !bad.ok);

const copy = planPhotoTransfer(["a", "b"], ["cover"], [1], "copy", "end");
check("העתקה לא מורידה מהמקור", copy.ok && copy.source.join() === "a,b" && copy.target.join() === "cover,a");
const movedCover = planPhotoTransfer(["a", "b", "c"], ["t"], [1], "move", "end");
check("ראשית שהועברה מפנה את הבאה", movedCover.ok && movedCover.source[0] === "b");
check("לא מוחקים קובץ שעוד בשימוש", storageDeleteAllowed("a", [["a"], ["b"]]) === false);
check("מוחקים רק בלי הפניה", storageDeleteAllowed("z", [["a"]]) === true);
const buttons = photoMoveButtons("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", [2], ["https://x/a"]);
const parsed = buttons && parsePhotoMoveButton(buttons[0].id);
check("כפתור נושא טביעה", !!parsed && parsed.mode === "move" && parsed.positions[0] === 2);
check("טביעה אחרת לא תתאים", !!parsed && parsed.hash !== photoUrlsHash(["https://x/other"]));

const index = readFileSync(new URL("../supabase/functions/whatsapp-webhook/index.ts", import.meta.url), "utf8");
const agent = readFileSync(new URL("../supabase/functions/whatsapp-webhook/agent.ts", import.meta.url), "utf8");
const crm = readFileSync(new URL("../assets/crm.js", import.meta.url), "utf8");
check("השאלה לפי שם", index.includes("choosePhotoTarget") && index.includes("sendList"));
check("כלי העברה", agent.includes("move_property_photos") && agent.includes("sameAgent: true"));
check("מחיקה לא מוחקת קובץ משותף", crm.includes(".contains('images'"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
