// בורר הנכס של גבריאלה, 1.11.2026.
// שלוש שורות = רשימה אחת ובלי כרטיס; שורה אחת = כרטיס אחד.
// תור עם list_properties ואז create_showcase שולח רק טקסט וכפתורי מיניסייט.
// 'פרץ ציוני' על לקוח/ה שקונה חנות מוסיף רק את החנות למכירה.
//   deno test supabase/functions/whatsapp-webhook/lookup_turn_test.ts

import { parseNavId } from "../_shared/agent-deep-link.ts";
import {
  agentToolMutates,
  pathListed,
  propertyLookupOutbox,
  clientMatchesLimit,
  resolveShowcaseRefs,
  screenOutbox,
  showcaseRefsCall,
  showcaseShownLimit,
  turnOutbound,
  type OutboxItem,
  type ShowcaseMatch,
} from "./lookup_turn.ts";

const APT = "11111111-1111-4111-8111-111111111111";
const SHOP_RENT = "22222222-2222-4222-8222-222222222222";
const SHOP_SALE = "33333333-3333-4333-8333-333333333333";
const SITE = "https://shuknadlan.co.il";
const CATEGORY = "/crm?goto=accProperties";

function fail(message: string): never {
  throw new Error(message);
}

function propertyPath(id: string): string {
  return `/crm?goto=accProperties&property=${id}`;
}

const threeRows = [
  { id: APT, title: "דירה למכירה", address: "פרץ ציוני 5, עפולה" },
  { id: SHOP_RENT, title: "חנות להשכרה", address: "פרץ ציוני 5, עפולה" },
  { id: SHOP_SALE, title: "חנות למכירה", address: "פרץ ציוני 5, עפולה" },
];

function cardsOf(items: OutboxItem[]): OutboxItem[] {
  return items.filter((item) => item.kind === "cta" && item.label === "פתיחה ב-CRM");
}

Deno.test("שלוש שורות: רשימה אחת ובלי כרטיס CRM", () => {
  const built = propertyLookupOutbox(threeRows, CATEGORY, SITE);
  const lists = built.items.filter((item) => item.kind === "list");
  if (lists.length !== 1) fail(`רשימות: ${lists.length}`);
  if (built.items.length !== 1) fail(`הודעות: ${built.items.length}`);
  if (cardsOf(built.items).length !== 0) fail("יש כרטיס נוסף");
  if (built.listed.some((path) => path.includes("wc=") || path.includes("wt="))) {
    fail(`נתיב חתום נשאר להשוואה: ${built.listed.join(" | ")}`);
  }
  for (const row of threeRows) {
    if (!pathListed(built.listed, propertyPath(row.id))) fail(`הנכס לא ברשימה: ${row.title}`);
  }
  const list = lists[0];
  if (list.kind !== "list") fail("לא רשימה");
  const opened = list.rows.filter((row) => row.title !== "הכול");
  if (opened.length !== 3) fail(`שורות נכס: ${opened.length}`);
  for (const row of opened) {
    const path = parseNavId(row.id);
    if (!path || !path.includes("wc=") || !path.includes("wt=listing")) {
      fail("הכפתור עצמו בלי חותמת מדידה");
    }
    if (!pathListed([path], bareOf(path))) fail("השוואה של הנתיב החתום נכשלה");
  }
  if (built.items.some((item) => item.origin !== "lookup")) fail("הרשימה אינה בורר");
});

Deno.test("שורה אחת: כרטיס אחד, בלי כרטיס שני", () => {
  const built = propertyLookupOutbox([threeRows[2]], CATEGORY, SITE);
  if (built.items.length !== 1) fail(`הודעות: ${built.items.length}`);
  const only = built.items[0];
  if (only.kind !== "cta") fail(only.kind);
  if (only.label === "פתיחה ב-CRM") fail("הכרטיס היחיד הוא כרטיס כפול");
  if (!only.url.includes("wc=") || !only.url.includes("wt=listing")) fail("הכרטיס בלי מדידה");
  if (built.listed.length !== 1 || built.listed[0].includes("wc=")) fail(built.listed.join());
  if (!pathListed(built.listed, propertyPath(SHOP_SALE))) fail("הנתיב החשוף לא תאם");
  if (cardsOf(built.items).length !== 0) fail("נוסף כרטיס פתיחה");
});

Deno.test("נתיב חתום ונתיב חשוף הם אותו מסך", () => {
  const bare = propertyPath(SHOP_SALE);
  const stamped = `${bare}&wc=a0123456789b&wt=listing`;
  if (!pathListed([stamped], bare)) fail("חתום מול חשוף");
  if (!pathListed([bare], stamped)) fail("חשוף מול חתום");
});

const showcaseButtons: OutboxItem[] = [
  {
    kind: "cta",
    body: "לחיצה פותחת את הצ'אט עם דנה, והודעת הפתיחה כבר כתובה - רק לשלוח.",
    label: "📤 שליחה לדנה",
    url: `${SITE}/w/tok?n=%D7%93%D7%A0%D7%94&to=972501234567`,
  },
  {
    kind: "buttons",
    body: "לפני השליחה, אפשר גם:",
    buttons: [
      { id: `scx:p:${SHOP_SALE}`, title: "👁 תצוגה מקדימה" },
      { id: `scx:c:${SHOP_SALE}`, title: "📋 נוסח להעתקה" },
    ],
  },
];

Deno.test("תור פעולה שולח את הטקסט ואת כפתורי המיניסייט, בלי הבורר", () => {
  const lookup = propertyLookupOutbox(threeRows, CATEGORY, SITE);
  const reply = "פתחתי לדנה מיניסייט עם נכס אחד.";
  const sent = turnOutbound(reply, [...lookup.items, ...showcaseButtons], [
    "list_properties",
    "create_showcase",
  ]);
  if (sent.text !== reply) fail("הטקסט נעלם");
  if (sent.outbox.length !== showcaseButtons.length) {
    fail(`נשארו ${sent.outbox.length} הודעות: ${sent.outbox.map((item) => item.kind).join(",")}`);
  }
  if (sent.outbox[0]?.kind !== "cta" || sent.outbox[0].label !== "📤 שליחה לדנה") {
    fail("לפני כפתורי המיניסייט יצאה הודעה אחרת");
  }
  if (sent.outbox.some((item) => item.kind === "list" || item.origin === "lookup")) fail("הבורר יצא");
  if (sent.outbox.some((item) => item.kind === "cta" && item.label === "פתיחה ב-CRM")) fail("כרטיס CRM יצא");
  if (cardsOf(sent.outbox).length !== 0) fail("כרטיס");

  const picker = turnOutbound("מצאתי שלושה נכסים בכתובת.", lookup.items, ["list_properties"]);
  if (picker.outbox.length !== 1 || picker.outbox[0].kind !== "list") fail("בורר של חיפוש בלבד נעלם");
  if (picker.text !== "מצאתי שלושה נכסים בכתובת.") fail("טקסט");
});

Deno.test("חיפוש הוא בורר, ויצירת לקוח/ה או עדכון נכס מורידים אותו", () => {
  const found = screenOutbox(
    [{ type: "listing", path: propertyPath(SHOP_SALE), title: "חנות למכירה", body: "פרץ ציוני" }],
    "איזה נכס לפתוח?",
    CATEGORY,
    SITE,
    "lookup",
  );
  if (found.items.length !== 1 || found.items[0].origin !== "lookup") fail("החיפוש לא סומן כבורר");
  const afterCreate = turnOutbound("פתחתי לקוח.", found.items, ["search_properties", "create_client"]);
  if (afterCreate.outbox.length !== 0) fail("הבורר נשאר אחרי יצירת לקוח/ה");
  const afterUpdate = turnOutbound("עדכנתי.", found.items, ["list_properties", "update_property"]);
  if (afterUpdate.outbox.length !== 0) fail("הבורר נשאר אחרי עדכון נכס");
  const searchOnly = turnOutbound("הנה מה שמצאתי.", found.items, ["search_properties"]);
  if (searchOnly.outbox.length !== 1) fail("חיפוש בלי פעולה איבד את הבורר");
  if (!agentToolMutates("create_showcase") || !agentToolMutates("update_client") || !agentToolMutates("create_property")) {
    fail("כלי כתיבה לא סומן");
  }
  if (agentToolMutates("list_properties") || agentToolMutates("search_properties") || agentToolMutates("client_matches")) {
    fail("כלי קריאה סומן ככתיבה");
  }
});

const peretz = (id: string, title: string, deal: string, propertyType: string): ShowcaseMatch => ({
  property_id: id,
  title,
  street: "פרץ ציוני",
  house_number: "5",
  city: "עפולה",
  deal_type: deal,
  property_type: propertyType,
});

const apartment = peretz(APT, "דירה למכירה", "sale", "דירה");
const shopRent = peretz(SHOP_RENT, "חנות להשכרה", "rent", "חנויות/שטח מסחרי");
const shopSale = peretz(SHOP_SALE, "חנות למכירה", "sale", "חנויות/שטח מסחרי");

Deno.test("פרץ ציוני ללקוח שקונה חנות מוסיף רק את החנות למכירה, ובלי בורר לפני הכפתורים", () => {
  // ההתאמות כבר מסוננות: דירה למכירה וחנות להשכרה באותה כתובת אינן בקבוצה.
  const matches = [shopSale];
  const resolved = resolveShowcaseRefs(matches, ["פרץ ציוני"]);
  if (!resolved.ok) fail(resolved.ask);
  if (resolved.ids.join() !== SHOP_SALE) fail(resolved.ids.join());
  if (resolved.ids.includes(APT) || resolved.ids.includes(SHOP_RENT)) fail("נכס שלא בהתאמות נכנס");

  const allAtAddress = [apartment, shopRent, shopSale];
  const mixed = resolveShowcaseRefs(allAtAddress, ["פרץ ציוני"]);
  if (mixed.ok || !mixed.ambiguous) fail("שלושה נכסים בכתובת היו צריכים שאלה, לא בחירה");
  if (mixed.ask.includes("/crm") || mixed.ask.includes("http") || mixed.ask.includes("פתיחה ב-CRM")) {
    fail(`השאלה נושאת בורר: ${mixed.ask}`);
  }
  if (!mixed.ask.includes("דירה") || !mixed.ask.includes("חנות")) fail(mixed.ask);

  const lookup = propertyLookupOutbox(
    allAtAddress.map((row) => ({
      id: String(row.property_id),
      title: String(row.title),
      address: "פרץ ציוני 5, עפולה",
    })),
    CATEGORY,
    SITE,
  );
  const reply = "פתחתי לדנה מיניסייט עם החנות למכירה.";
  const sent = turnOutbound(reply, [...lookup.items, ...showcaseButtons], [
    "list_properties",
    "create_showcase",
  ]);
  if (sent.text !== reply) fail("הטקסט");
  if (sent.outbox.length !== 2) fail(`לפני הכפתורים נשאר בורר: ${sent.outbox.length}`);
  if (sent.outbox[0].kind !== "cta" || !sent.outbox[0].url.includes("/w/")) fail("ההודעה הראשונה אינה שליחת המיניסייט");
  if (sent.outbox[1].kind !== "buttons") fail("כפתורי המיניסייט");
  if (sent.outbox.some((item) => item.origin === "lookup" || item.kind === "list")) fail("בורר יצא לפני הכפתורים");
});

function bareOf(path: string): string {
  return path.replace(/&wc=[^&]*&wt=[^&]*/, "");
}

Deno.test("property_refs מעביר את אותו ויתור של client_matches", () => {
  const required = ["elevator", "mamad"];
  const sameTurn = showcaseRefsCall({
    agentId: "agent",
    clientId: "client",
    required,
    inputWaive: ["mamad"],
    rememberedClientId: "client",
    rememberedWaive: ["elevator"],
  });
  if (sameTurn.p_waive_features.join() !== "elevator") fail(sameTurn.p_waive_features.join());
  if (sameTurn.p_limit !== 30 || sameTurn.p_client_id !== "client") fail("הקריאה לא זהה");

  const otherClient = showcaseRefsCall({
    agentId: "agent",
    clientId: "other",
    required,
    inputWaive: ["mamad", "pool"],
    rememberedClientId: "client",
    rememberedWaive: ["elevator"],
  });
  if (otherClient.p_waive_features.join() !== "mamad") fail(otherClient.p_waive_features.join());

  const none = showcaseRefsCall({
    agentId: "agent",
    clientId: "client",
    required,
    inputWaive: undefined,
  });
  if (none.p_waive_features.length !== 0) fail("בלי ויתור נפתח ויתור");

  const withoutWaive: ShowcaseMatch[] = [];
  const withWaive: ShowcaseMatch[] = [{
    property_id: SHOP_SALE,
    title: "חנות למכירה",
    street: "פרץ ציוני",
    house_number: "5",
    city: "עפולה",
    deal_type: "sale",
    property_type: "חנויות/שטח מסחרי",
    score: 80,
  }];
  const missed = resolveShowcaseRefs(withoutWaive, ["פרץ ציוני"]);
  if (missed.ok) fail("בלי הוויתור החנות לא אמורה להימצא");
  const found = resolveShowcaseRefs(withWaive, ["פרץ ציוני"]);
  if (!found.ok || found.ids.join() !== SHOP_SALE) fail(JSON.stringify(found));
});

Deno.test("רפרנס נפתר רק מול מה שהוצג, עד 15, גם בשאלה", () => {
  const rows: ShowcaseMatch[] = Array.from({ length: 20 }, (_, i) => ({
    property_id: `p${i}`,
    title: i < 15 ? `מוצג ${i}` : `מוסתר ${i}`,
    street: "פרץ ציוני",
    house_number: "5",
    city: "עפולה",
    score: 100 - i,
  }));
  const asked = resolveShowcaseRefs(rows, ["פרץ ציוני"], 15);
  if (asked.ok || !asked.ambiguous) fail("צריך שאלה על החלון שהוצג");
  if (!asked.ask.includes("מוצג 0") || !asked.ask.includes("מוצג 14")) fail(asked.ask);
  if (asked.ask.includes("מוסתר")) fail("שורה מעבר ל-15 נכנסה לשאלה");

  const mixed = rows.map((row, i) => i === 0 || i === 16
    ? { ...row, street: "הנרקיס", title: i === 0 ? "חנות למכירה" : "מוסתר הנרקיס" }
    : row);
  const added = resolveShowcaseRefs(mixed, ["הנרקיס"]);
  if (!added.ok || added.ids.join() !== "p0") fail(JSON.stringify(added));

  const late = rows.map((row, i) => i === 16
    ? { ...row, street: "הדקל", title: "מוסתר הדקל" }
    : row);
  const missed = resolveShowcaseRefs(late, ["הדקל"]);
  if (missed.ok) fail("שורה שלא הוצגה נוספה");
  if (missed.ask.includes("מוסתר הדקל")) fail("השאלה מזכירה שורה שלא הוצגה");

  const narrow = resolveShowcaseRefs(rows, ["פרץ ציוני"], 2);
  if (narrow.ok || !narrow.ask.includes("מוצג 0") || !narrow.ask.includes("מוצג 1")) fail(narrow.ok ? "נוסף" : narrow.ask);
  if (!narrow.ok && narrow.ask.includes("מוצג 2")) fail("מעבר לחלון שהוצג");
});

Deno.test("כשהוצגו 5, שורה 7 לא נבחרת והשאלה רק על המוצגות", () => {
  if (clientMatchesLimit(undefined) !== 5 || clientMatchesLimit(40) !== 15) fail("חלון client_matches");
  if (showcaseShownLimit({ clientId: "c" }) !== 5) fail("בלי זיכרון ברירת המחדל היא 5");
  if (showcaseShownLimit({ clientId: "c", rememberedClientId: "c", rememberedLimit: 8 }) !== 8) {
    fail("החלון שנשמר בתור לא עבר");
  }
  if (showcaseShownLimit({ clientId: "other", rememberedClientId: "c", rememberedLimit: 8 }) !== 5) {
    fail("חלון של לקוח/ה אחר/ת");
  }

  const rows: ShowcaseMatch[] = Array.from({ length: 10 }, (_, i) => ({
    property_id: `p${i}`,
    title: `שורה ${i + 1}`,
    street: i === 6 ? "הדקל" : "פרץ ציוני",
    score: 100 - i,
  }));
  const onlySeventh = resolveShowcaseRefs(rows, ["הדקל"], 5);
  if (onlySeventh.ok) fail("שורה 7 נוספה אף שהוצגו 5");
  if (onlySeventh.ask.includes("שורה 7")) fail("השאלה מזכירה את שורה 7");

  const asked = resolveShowcaseRefs(rows, ["פרץ ציוני"], 5);
  if (asked.ok || !asked.ambiguous) fail("צריך שאלה על החמש שהוצגו");
  for (const n of [1, 2, 3, 4, 5]) {
    if (!asked.ask.includes(`שורה ${n}`)) fail(`חסרה שורה ${n}`);
  }
  if (asked.ask.includes("שורה 6") || asked.ask.includes("שורה 7") || asked.ask.includes("שורה 8")) {
    fail(asked.ask);
  }
});
