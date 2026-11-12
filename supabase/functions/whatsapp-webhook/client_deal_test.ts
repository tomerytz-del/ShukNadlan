// בעל/ת נכס בלי סוג עסקה אינו מוכר/ת.
//   deno test supabase/functions/whatsapp-webhook/client_deal_test.ts

import { clientNeeds, dealNullRejected, neighborhoodLabels, OWNER_DEAL_ASK, ownerDealWrite, SEEKER_DEAL_ASK, seekerDealAsk } from "./client-deal.ts";

function fail(message: string): never {
  throw new Error(message);
}

function claimsSide(text: string): boolean {
  return /מוכר|משכיר|קונה|שוכר/.test(text);
}

Deno.test("בעל/ת נכס בלי deal_type נשמר בלי צד ונשאל מוכר או משכיר", () => {
  const write = ownerDealWrite({ client_kind: "owner", full_name: "דנה" }, null);
  if (!write || write.deal_type !== null) fail("השמירה מילאה צד");
  if (write.ask !== OWNER_DEAL_ASK) fail(write.ask);
  if (write.ask !== "מוכר או משכיר?") fail("השאלה אינה הנוסח של תומר");

  const needs = clientNeeds({ client_kind: "owner", deal_type: null, full_name: "דנה" });
  if (claimsSide(needs)) fail(`needs טען צד: ${needs}`);
  if (!needs.includes("בעל/ת נכס")) fail(needs);

  const fromBuyer = ownerDealWrite(
    { client_kind: "owner" },
    { client_kind: "seeker", deal_type: "sale" },
  );
  if (!fromBuyer || fromBuyer.deal_type !== null) fail("sale של קונה נשאר כמוכר");
  const after = clientNeeds({ client_kind: "owner", deal_type: fromBuyer.deal_type });
  if (claimsSide(after)) fail(`אחרי מעבר לבעל/ת נכס: ${after}`);

  const keep = ownerDealWrite({ phone: "050" }, { client_kind: "owner", deal_type: "rent" });
  if (keep !== null) fail("צד שנשמר נמחק");
  const landlord = clientNeeds({ client_kind: "owner", deal_type: "rent" });
  if (!landlord.includes("משכיר/ה")) fail(landlord);

  const stated = ownerDealWrite({ client_kind: "owner", deal_type: "sale" }, null);
  if (stated !== null) fail("sale שנאמר נמחק");
  const seller = clientNeeds({ client_kind: "owner", deal_type: "sale" });
  if (!seller.includes("מוכר/ת") || seller.includes("משכיר")) fail(seller);
});

Deno.test("מעבר מבעל/ת נכס בלי צד למחפש/ת בלי עסקה שואל ולא נשמר", () => {
  const ask = seekerDealAsk(
    { client_kind: "seeker" },
    { client_kind: "owner", deal_type: null },
  );
  if (ask !== SEEKER_DEAL_ASK) fail(String(ask));
  if (ask !== "קנייה או שכירות?") fail(String(ask));
  const kept = seekerDealAsk(
    { client_kind: "seeker" },
    { client_kind: "owner", deal_type: "rent" },
  );
  if (kept !== null) fail("צד שמור נשאל מחדש");
  const create = seekerDealAsk({ full_name: "דנה" }, null);
  if (create !== SEEKER_DEAL_ASK) fail("יצירת מחפש/ת בלי עסקה נשמרה");
  const phoneOnly = seekerDealAsk(
    { phone: "050" },
    { client_kind: "seeker", deal_type: "sale" },
  );
  if (phoneOnly !== null) fail("עדכון טלפון ביקש עסקה");
});

Deno.test("סיכום הכרטיס כולל את שם השכונה, לא רק את העיר", () => {
  const givat = clientNeeds({
    client_kind: "seeker",
    deal_type: "rent",
    property_types: ["דירה"],
    cities: ["עפולה"],
    neighborhoods: { name: "גבעת המורה" },
  });
  if (!givat.includes("עפולה")) fail(givat);
  if (!givat.includes("שכונה: גבעת המורה")) fail(givat);
  if (givat.indexOf("עפולה") > givat.indexOf("גבעת המורה")) fail("השכונה נעלמה אחרי העיר: " + givat);

  const embed = clientNeeds({
    deal_type: "rent",
    cities: ["עפולה"],
    neighborhoods: [{ name: "לב העמק" }],
  });
  if (!embed.includes("שכונה: לב העמק")) fail(embed);

  const named = clientNeeds({
    deal_type: "sale",
    cities: ["עפולה"],
    neighborhood_name: "C1",
  });
  if (!named.includes("שכונה: C1")) fail(named);

  const several = neighborhoodLabels({
    neighborhood_names: ["גבעת המורה", "לב העמק"],
    neighborhood_name: "גבעת המורה",
    neighborhoods: { name: "לב העמק" },
  });
  if (several.join(",") !== "גבעת המורה,לב העמק") fail(several.join(","));
  const both = clientNeeds({ deal_type: "rent", cities: ["עפולה"], neighborhood_names: several });
  if (!both.includes("שכונה: גבעת המורה, לב העמק")) fail(both);

  const cityOnly = clientNeeds({ deal_type: "rent", cities: ["עפולה"], neighborhoods: null });
  if (cityOnly.includes("שכונה")) fail(cityOnly);
  if (!cityOnly.includes("עפולה")) fail(cityOnly);

  const blank = clientNeeds({
    deal_type: "rent",
    cities: ["עפולה"],
    neighborhood_name: "  ",
    neighborhoods: { name: "" },
  });
  if (blank.includes("שכונה")) fail(blank);

  const owner = clientNeeds({
    client_kind: "owner",
    deal_type: null,
    neighborhoods: { name: "גבעת המורה" },
  });
  if (claimsSide(owner)) fail(owner);
  if (!owner.includes("שכונה: גבעת המורה")) fail(owner);
});

Deno.test("הכלים מחזירים את שם השכונה, וההנחיה סומכת על needs", () => {
  const agent = Deno.readTextFileSync(new URL("./agent.ts", import.meta.url));
  const create = agent.slice(agent.indexOf("async function toolCreateClient"), agent.indexOf("async function toolUpdateClient"));
  const update = agent.slice(agent.indexOf("async function toolUpdateClient"), agent.indexOf("function ownerSavedGuidance"));
  for (const [name, block] of [["create", create], ["update", update]] as const) {
    const hoodSelect = block.indexOf("CLIENT_CARD_HOOD");
    const bareSelect = block.lastIndexOf(".select(");
    if (hoodSelect < 0 || bareSelect < 0 || hoodSelect > bareSelect) {
      fail(`${name}: השליפה עם השכונה אינה לפני הניסיון בלי העמודה`);
    }
    if (!block.includes("savedCard(")) fail(`${name}: הסיכום לא עובר ב-savedCard`);
    if (!block.includes("fillNeighborhoodNames")) fail(`${name}: שם חסר לא מושלם מהטבלה`);
  }
  if (!agent.includes('const CLIENT_CARD_HOOD = ", neighborhood_id, neighborhoods(name)"')) {
    fail("שם השכונה לא נשלף מ-neighborhood_id");
  }
  const list = agent.slice(agent.indexOf("async function toolListClients"), agent.indexOf("async function toolListCalls"));
  if (!list.includes("LIST_CLIENT_COLUMNS_HOOD") || !list.includes("savedCard(")) {
    fail("רשימת הלקוחות בלי שם שכונה בסיכום");
  }
  const matches = agent.slice(agent.indexOf("async function toolClientMatches"), agent.indexOf("const SHOWCASE_MATCH_LIMIT"));
  if (!matches.includes("clientDemandRow") || !matches.includes("savedCard(")) {
    fail("client_matches בלי כותרת כרטיס");
  }
  const clientsAt = agent.indexOf("לקוחות והתאמות:");
  const prompt = agent.slice(clientsAt, agent.indexOf("יומן שיחות", clientsAt));
  if (!prompt.includes("שדה שמופיע ב-needs נשמר")) fail("ההנחיה לא אומרת לסמוך על needs");
  if (!prompt.includes("אל תשמרי אותו שוב")) fail("ההנחיה לא עוצרת שמירה כפולה");
  if (!agent.includes("שדה שמופיע ב-needs נשמר. אל תאמרי שאולי לא נשמר")) {
    fail("תשובת הכלי לא אומרת שהשדה נשמר");
  }

  const dir = new URL("../../../supabase/migrations/", import.meta.url);
  const files = [...Deno.readDirSync(dir)].map((entry) => entry.name).filter((name) => name.endsWith(".sql")).sort();
  let matchSrc = "";
  let matchFile = "";
  for (const name of files) {
    const text = Deno.readTextFileSync(new URL(name, dir));
    if (text.includes("function public.client_property_match")) {
      matchSrc = text;
      matchFile = name;
    }
  }
  if (!matchFile) fail("אין client_property_match");
  if (!matchSrc.includes("p_client.neighborhood_id is null")) fail(matchFile + " בלי שער שכונה");
  if (!matchSrc.includes("or p_property.neighborhood_id = p_client.neighborhood_id")) {
    fail(matchFile + " לא מסנן שכונה אחרת");
  }
  if (!matchSrc.includes("or p_property.neighborhood_id is null")) fail(matchFile + " חוסם נכס בלי שכונה");
  if (!matchSrc.includes("then 8 else 0 end") || !matchSrc.includes("שכונה לא מולאה במודעה")) {
    fail(matchFile + " לא מדרג נכס בלי שכונה");
  }
  const rpc = files.filter((name) => Deno.readTextFileSync(new URL(name, dir)).includes("function public.agent_client_matches")).pop();
  if (!rpc) fail("אין agent_client_matches");
  const rpcSrc = Deno.readTextFileSync(new URL(rpc, dir));
  if (!rpcSrc.includes("client_property_match(v_client, p")) fail("client_matches לא מעביר את שורת הלקוח/ה");
});

Deno.test("23514 ו-23502 על deal_type נתפסים לפני שגיאה כללית", () => {
  if (!dealNullRejected({ code: "23514", message: "agent_clients_deal_present_unless_owner" })) {
    fail("23514 לא נתפס");
  }
  if (!dealNullRejected({ code: "23502", message: "null value in column \"deal_type\"" })) {
    fail("23502 לא נתפס");
  }
  if (dealNullRejected({ code: "23514", message: "agent_clients_status_check" })) fail("check אחר נתפס");
  if (dealNullRejected({ code: "23505", message: "deal_type" })) fail("הפרה אחרת נתפסה");
  const agent = Deno.readTextFileSync(new URL("./agent.ts", import.meta.url));
  const update = agent.slice(agent.indexOf("async function toolUpdateClient"), agent.indexOf("function ownerSavedGuidance"));
  const askAt = update.indexOf("seekerDealAsk");
  const writeAt = update.indexOf(".update(payload)");
  if (askAt < 0 || writeAt < 0 || askAt > writeAt) fail("השאלה אינה לפני הכתיבה למסד");
  const matches = agent.slice(agent.indexOf("async function toolClientMatches"), agent.indexOf("const limit = clientMatchesLimit"));
  if (!matches.includes("בלי deal_type הכלי לא שומר ושואל קנייה או שכירות")) {
    fail("הפרומפט עדיין שולח עדכון מחפש/ת בלי עסקה");
  }
});
