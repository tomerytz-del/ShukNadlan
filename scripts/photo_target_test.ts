// שיוך תמונות והעברה בין נכסים. בלי וואטסאפ ובלי מסד.
//   node --experimental-strip-types scripts/photo_target_test.ts
import { readFileSync } from "node:fs";
import { canonicalPositions, choosePhotoTarget, clipTitle, parsePhotoMoveButton, photoContextText, photoMoveButtons, photoUrlsHash, planPhotoMove, planPhotoTransfer, storageDeleteAllowed, urlsAt, type PhotoCandidate } from "../supabase/functions/whatsapp-webhook/photo-target.ts";
import { deletableStoragePath } from "../supabase/functions/_shared/photo-relocate.ts";

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
  lastId: "shop",
  candidates: [{ ...shop, updated_at: fresh }, { ...plot, updated_at: fresh }],
  recentText: "הנה תמונות למגרש",
  lastUpdatedAt: fresh, now, idleMs: 20 * 60_000, conversationIdle: false,
});
check("מגרש לא הולך לחנות", named.kind === "attach" && named.id === "plot");

const idleText = choosePhotoTarget({
  lastId: "shop",
  candidates: [{ ...shop, updated_at: fresh }, { ...plot, updated_at: fresh }],
  recentText: "הנה תמונות למגרש",
  lastUpdatedAt: fresh, now, idleMs: 20 * 60_000, conversationIdle: true,
});
check("טקסט אחרי שקט לא מצרף", idleText.kind === "ask");

const idlePlot = choosePhotoTarget({
  lastId: "shop",
  candidates: [{ ...shop, updated_at: fresh }, { ...plot, updated_at: old }],
  recentText: "תמונות למגרש",
  lastUpdatedAt: fresh, now, idleMs: 20 * 60_000, conversationIdle: false,
});
check("טקסט על נכס ישן שואל", idlePlot.kind === "ask" && idlePlot.id === undefined);

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

const onlyFresh = choosePhotoTarget({
  lastId: null, candidates: [{ ...plot, updated_at: fresh }], recentText: "",
  lastUpdatedAt: fresh, now, idleMs: 20 * 60_000, conversationIdle: false,
});
check("נכס יחיד טרי", onlyFresh.kind === "attach" && onlyFresh.id === "plot");
const onlyIdle = choosePhotoTarget({
  lastId: null, candidates: [plot], recentText: "",
  lastUpdatedAt: null, now, idleMs: 20 * 60_000, conversationIdle: true,
});
check("נכס יחיד בשקט שואל", onlyIdle.kind === "ask" && onlyIdle.ids.includes("plot"));
const oldLine = photoContextText(
  [{ role: "user", content: "תמונות למגרש", at: now - 3 * 60 * 60_000 }, { role: "user", content: "היי", at: now - 60_000 }],
  now, 20 * 60_000,
);
check("טקסט ישן לא נספר", oldLine === "היי");
check("כותרת ארוכה נחתכת", Array.from(clipTitle("א".repeat(30), 20)).length === 20 && clipTitle("א".repeat(30), 20).endsWith("…"));

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
const gallery = ["https://x/a", "https://x/b", "https://x/c"];
const buttons = photoMoveButtons("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", [3, 1], gallery);
const parsed = buttons && parsePhotoMoveButton(buttons[0].id);
check("כפתור אחרי מיון", !!parsed && parsed.positions.join() === "1,3" && parsed.hash === photoUrlsHash(urlsAt(gallery, canonicalPositions([3, 1])) || []));
check("טביעה אחרת לא תתאים", !!parsed && parsed.hash !== photoUrlsHash(["https://x/c", "https://x/a"]));

const index = readFileSync(new URL("../supabase/functions/whatsapp-webhook/index.ts", import.meta.url), "utf8");
const agent = readFileSync(new URL("../supabase/functions/whatsapp-webhook/agent.ts", import.meta.url), "utf8");
const crm = readFileSync(new URL("../assets/crm.js", import.meta.url), "utf8");
check("השאלה לפי שם", index.includes("choosePhotoTarget") && index.includes("sendList"));
check("כלי העברה", agent.includes("move_property_photos") && agent.includes("sameAgent: true"));
const relocate = readFileSync(new URL("../supabase/functions/_shared/photo-relocate.ts", import.meta.url), "utf8");
const mig = readFileSync(new URL("../supabase/migrations/20271031150000_photo_relocate.sql", import.meta.url), "utf8");
check("בדיקת שימוש בלי תקרה", relocate.includes("property_image_still_used") && !relocate.includes('select("images").limit(1000)'));
check("חלון ביטול 20 שניות", mig.includes("interval '20 seconds'"));
check("אינדקס וכל ההפניות",
  mig.includes("properties_images_gin") &&
  mig.includes("p.images @> array[p_url]::text[]") &&
  !mig.includes("coalesce(p.images") &&
  mig.includes("p.marketing_image = p_url") &&
  mig.includes("p.video_url = p_url") &&
  mig.includes("p.video_poster_url = p_url") &&
  mig.includes("pending_images") &&
  mig.includes("property_video_clips") &&
  mig.includes("c.source_image_url = p_url") &&
  mig.includes("a.creative_url = p_url") &&
  mig.includes("a.gallery_urls @> array[p_url]::text[]") &&
  mig.includes("m.photo_url = p_url") &&
  mig.includes("a.logo_url = p_url") &&
  mig.includes("articles") &&
  mig.includes("source_agent_id"));
check("שש ההודעות האחרונות",
  index.includes("שש ההודעות האחרונות") &&
  index.includes('order("created_at", { ascending: false })') &&
  index.includes(".reverse()"));
const moveFn = readFileSync(new URL("../supabase/functions/property-image-move/index.ts", import.meta.url), "utf8");
check("הערה של 20 שניות", moveFn.includes("20 שניות") && !moveFn.includes("10 שניות") && !moveFn.includes('action === "release"'));
check("מוחקים רק את הקובץ שהועבר", relocate.includes("storagePath(url) !== path") && relocate.includes("deletableStoragePath") && relocate.includes("source_agent_id"));
const mine = "11111111-1111-1111-1111-111111111111";
const other = "22222222-2222-2222-2222-222222222222";
check("קובץ בתיקיית הסוכן", deletableStoragePath(`${mine}/prop/a.jpg`, mine));
check("כתובת זרה לא נמחקת", !deletableStoragePath(`${other}/prop/a.jpg`, mine));
check("לוגו מחוץ לתיקייה לא נמחק", !deletableStoragePath("professionals/logo.jpg", mine));
check("בלי בעלים אין מחיקה", !deletableStoragePath(`${mine}/a.jpg`, ""));
check("נתיב שיוצא מהתיקייה", !deletableStoragePath(`${mine}/../${other}/a.jpg`, mine));
check("הטופס לא מוחק קובץ", !crm.includes("action: 'release'") && !crm.includes("releasePropertyImage"));
check("בריחה בגיליון", crm.includes("esc(from.title") && crm.includes("esc(text)"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
