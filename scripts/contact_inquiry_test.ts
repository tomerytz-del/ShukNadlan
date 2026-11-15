/* לחיצת וואטסאפ או חיוג בהחלקה ובדף הנכס.
   אין ליד. יש contact_agent עם מזהה הנכס וייחוס הביקור, ו-Contact לפיקסל.

       node --experimental-strip-types scripts/contact_inquiry_test.ts
*/

import { readFileSync } from "node:fs";
import vm from "node:vm";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("ok  " + name);
    return;
  }
  failed += 1;
  console.log("FAIL " + name + (detail ? " - " + detail : ""));
}

const visitSrc = readFileSync(new URL("../assets/visit-attr.js", import.meta.url), "utf8");
const src = readFileSync(new URL("../assets/contact-inquiry.js", import.meta.url), "utf8");
const PID = "34d2fe8c-1111-4222-8333-bdb8811c0001";

function boot(pathname: string, search: string, stored: unknown, linkAttrs: Record<string, string>) {
  const data: Record<string, string> = {};
  if (stored) data.shukVisitAttr = JSON.stringify(stored);
  const attrs: Record<string, string> = { ...linkAttrs };
  const rootAttr: Record<string, string> = {};
  const pixel: unknown[][] = [];
  const sandbox: Record<string, unknown> = {
    localStorage: {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => { data[k] = v; },
      removeItem: (k: string) => { delete data[k]; },
    },
    location: { pathname, search },
    URLSearchParams,
    document: {
      documentElement: {
        getAttribute: (name: string) => rootAttr[name] ?? null,
        setAttribute: (name: string, value: string) => { rootAttr[name] = value; },
      },
    },
    fbq: (...args: unknown[]) => { pixel.push(args); },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(visitSrc, sandbox);
  vm.runInContext(src, sandbox);
  const link = { getAttribute: (name: string) => attrs[name] ?? null };
  const api = sandbox.ShukContactInquiry as {
    inquiryPage: () => string;
    fields: (link: { getAttribute: (name: string) => string | null } | null) => Record<string, string> | null;
    pixel: (method: string, extra: Record<string, string> | null) => boolean;
    propertyId: (link: { getAttribute: (name: string) => string | null } | null) => string;
  };
  return { api, link, pixel, rootAttr, data };
}

const paid = {
  attr_source: "meta",
  attr_medium: "paid_social",
  attr_campaign: "swipe_afula",
  attr_content: "reel_a",
  attr_code: "reel_a",
  exp: Date.now() + 86400000,
};
const swipe = boot("/swipe", "", paid, { "data-property-id": PID });
const swipeFields = swipe.api.fields(swipe.link);
ok("swipe page", swipe.api.inquiryPage() === "swipe");
ok("swipe click carries property and reel_a",
  !!swipeFields && swipeFields.property_id === PID && swipeFields.item_id === PID &&
  swipeFields.attr_source === "meta" && swipeFields.attr_medium === "paid_social" &&
  swipeFields.attr_campaign === "swipe_afula" && swipeFields.attr_content === "reel_a" &&
  !("attr_code" in swipeFields));
ok("pixel Contact", swipe.api.pixel("whatsapp", swipeFields || {}) &&
  swipe.pixel.length === 1 && swipe.pixel[0][0] === "track" && swipe.pixel[0][1] === "Contact" &&
  (swipe.pixel[0][2] as { content_ids: string[]; attr_content: string }).content_ids[0] === PID &&
  (swipe.pixel[0][2] as { attr_content: string }).attr_content === "reel_a");
ok("email is not a pixel contact", swipe.api.pixel("email", swipeFields) === false && swipe.pixel.length === 1);

const short = boot("/p/1162", "", null, {});
short.rootAttr["data-property-id"] = PID.toUpperCase();
const shortFields = short.api.fields(null);
ok("short property url", short.api.inquiryPage() === "property" && shortFields?.property_id === PID);

const query = boot("/property.html", "?id=" + PID, null, {});
ok("property.html ?id=", query.api.inquiryPage() === "property" && query.api.fields(query.link)?.item_id === PID);

const home = boot("/", "?utm_source=meta", paid, { "data-property-id": PID });
ok("home is not a contact-inquiry page", home.api.inquiryPage() === "" && home.api.fields(home.link) === null);

const junk = boot("/swipe", "", null, { "data-property-id": "not-a-uuid" });
ok("junk id is dropped", junk.api.fields(junk.link)?.property_id === undefined);

const events = readFileSync(new URL("../assets/events.js", import.meta.url), "utf8");
ok("events.js asks the helper before contact_agent",
  events.includes("ShukContactInquiry.fields") && events.includes("ShukContactInquiry.pixel") &&
  events.indexOf("ShukContactInquiry.fields") < events.lastIndexOf("shukTrack('contact_agent'"));

function hasScript(file: string) {
  const html = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const attr = html.indexOf('src="assets/visit-attr.js"');
  const helper = html.indexOf('src="assets/contact-inquiry.js"');
  const eventsAt = html.indexOf('src="assets/events.js"');
  return attr > 0 && helper > attr && eventsAt > helper && /<script defer src="assets\/contact-inquiry\.js"><\/script>/.test(html);
}
ok("swipe loads the helper after visit-attr and before events.js", hasScript("swipe.html"));
ok("property loads the helper after visit-attr and before events.js", hasScript("property.html"));

const swipeJs = readFileSync(new URL("../assets/swipe.js", import.meta.url), "utf8");
ok("swipe remembers the current property id", swipeJs.includes("setAttribute('data-property-id'"));
const propertyJs = readFileSync(new URL("../assets/property.js", import.meta.url), "utf8");
ok("property page marks contact links", propertyJs.includes("data-property-id"));

if (failed) {
  console.log(failed + " failed");
  process.exit(1);
}
console.log("all passed");
