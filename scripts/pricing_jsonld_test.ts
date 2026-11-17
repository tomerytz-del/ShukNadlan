/* ============================================================================
   JSON-LD של /pricing מול assets/tiers.js
   ----------------------------------------------------------------------------
   SoftwareApplication נבנה מ-CATALOG. המחיר בבלוק חייב להיות priceMonthly.
   FAQPage נשאר. אין דירוג, אין ביקורות ואין הטבת השקה.

   הרצה: node --experimental-strip-types scripts/pricing_jsonld_test.ts
   ========================================================================== */

import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../pricing.html", import.meta.url), "utf8");
const tiersSrc = readFileSync(new URL("../assets/tiers.js", import.meta.url), "utf8");
const sandbox: { window?: { Tiers?: TiersApi }; Tiers?: TiersApi } = {};
sandbox.window = sandbox as { Tiers?: TiersApi };
vm.runInNewContext(tiersSrc, sandbox, { filename: "assets/tiers.js" });

type Offer = {
  "@type": string;
  name: string;
  price: number;
  priceCurrency: string;
  priceSpecification: {
    "@type": string;
    price: number;
    priceCurrency: string;
    unitCode: string;
    valueAddedTaxIncluded: boolean;
  };
};
type AppLd = {
  "@context": string;
  "@type": string;
  name: string;
  applicationCategory: string;
  operatingSystem: string;
  offers: Offer[];
  aggregateRating?: unknown;
  review?: unknown;
};
type TiersApi = {
  CATALOG: { name: string; priceMonthly: number }[];
  softwareApplicationLd: () => AppLd;
};

const Tiers = sandbox.Tiers!;
const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => {
  return JSON.parse(m[1]) as { "@type"?: string };
});

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) {
    failed++;
    console.log("✗ " + name + (detail != null ? " — " + JSON.stringify(detail) : ""));
  } else {
    console.log("✓ " + name);
  }
}

const faq = blocks.find((b) => b["@type"] === "FAQPage");
const app = blocks.find((b) => b["@type"] === "SoftwareApplication") as AppLd | undefined;
const expected = Tiers.softwareApplicationLd();

check("הבלוק נפרס", !!app);
check("FAQPage נשאר", !!faq && Array.isArray((faq as { mainEntity?: unknown }).mainEntity));
check("סוג ושם", !!app && app["@context"] === "https://schema.org"
  && app.name === "שוק נדל״ן"
  && app.applicationCategory === "BusinessApplication"
  && app.operatingSystem === "Web");
check("הצעה לכל מסלול", !!app && app.offers.length === Tiers.CATALOG.length);
check("זהה ל-tiers.js", JSON.stringify(app) === JSON.stringify(expected), app);

(Tiers.CATALOG || []).forEach((tier, i) => {
  const offer = app && app.offers[i];
  const spec = offer && offer.priceSpecification;
  check(tier.name + " מחיר", !!offer && offer.name === tier.name
    && offer["@type"] === "Offer"
    && offer.price === tier.priceMonthly
    && offer.priceCurrency === "ILS"
    && !!spec
    && spec["@type"] === "UnitPriceSpecification"
    && spec.price === tier.priceMonthly
    && spec.priceCurrency === "ILS"
    && spec.unitCode === "MON"
    && spec.valueAddedTaxIncluded === false, offer);
});

const raw = app ? JSON.stringify(app) : "";
check("בלי דירוג", !!app && !("aggregateRating" in app) && !("review" in app) && !raw.includes("aggregateRating"));
check("בלי הטבת השקה", !/הטב|מתנה|חודשיים/.test(raw));
check("בלי שם או רישיון", !raw.includes("תומר") && !/רישיון/.test(raw));
check("מחירים ידועים", Tiers.CATALOG.map((t) => t.priceMonthly).join(",") === "0,199,399");

if (failed) {
  console.log("\n✗ " + failed + " נכשלו");
  process.exit(1);
}
console.log("\n✓ JSON-LD של המסלולים תואם ל-tiers.js");
