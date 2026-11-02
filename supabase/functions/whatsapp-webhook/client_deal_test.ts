// בעל/ת נכס בלי סוג עסקה אינו מוכר/ת.
//   deno test supabase/functions/whatsapp-webhook/client_deal_test.ts

import { clientNeeds, OWNER_DEAL_ASK, ownerDealWrite, SEEKER_DEAL_ASK, seekerDealAsk } from "./client-deal.ts";

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
