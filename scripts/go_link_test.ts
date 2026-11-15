/* ============================================================================
   /go/<code> ושמירת הייחוס בדפדפן
   ----------------------------------------------------------------------------
   ההפניה תמיד לאותו אתר, גם כשהקוד לא מוכר וגם כשהמסד לא עונה.
   קוד שאינו slug לא נרשם. בוט נרשם כדגל, בלי מחרוזת UA.

       node --experimental-strip-types scripts/go_link_test.ts
   ========================================================================== */

import { readFileSync } from "node:fs";
import vm from "node:vm";
import handler, { utmForCode, isBotUserAgent, homeLocation } from "../netlify/edge-functions/go-link.ts";
import { visitAttrFrom, isMissingAttrColumn } from "../supabase/functions/_shared/visit-attr.ts";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("ok  " + name);
    return;
  }
  failed += 1;
  console.log("FAIL " + name + (detail ? " - " + detail : ""));
}

const SITE = "https://shuknadlan.co.il";

function ctx() {
  const jobs: Promise<unknown>[] = [];
  return {
    jobs,
    waitUntil(p: Promise<unknown>) { jobs.push(p); },
  };
}

async function go(path: string, ua = "Mozilla/5.0", method = "GET") {
  const calls: { url: string; body: string }[] = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const c = ctx();
  const res = await handler(new Request(SITE + path, { method, headers: { "user-agent": ua } }), c as never);
  await Promise.all(c.jobs);
  globalThis.fetch = prev;
  return { res, calls, loc: new URL(res.headers.get("location") || "about:blank") };
}

const mapped = utmForCode("seeker-e");
ok("seeker-e map", mapped.source === "facebook" && mapped.medium === "group_comment" && mapped.campaign === "seeker_link" && mapped.content === "seeker-e");
ok("seeker prefix", utmForCode("seeker-c12").campaign === "seeker_link" && utmForCode("seeker-c12").content === "seeker-c12");
ok("office prefix", utmForCode("office-a").campaign === "office_signup");
ok("unknown code default", utmForCode("note9").campaign === "group_comment" && utmForCode("note9").content === "note9");
ok("home is same site", homeLocation(mapped) === SITE + "/?utm_source=facebook&utm_medium=group_comment&utm_campaign=seeker_link&utm_content=seeker-e");
ok("facebookexternalhit is a bot", isBotUserAgent("facebookexternalhit/1.1"));
ok("browser is not a bot", !isBotUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"));

const seeker = await go("/go/seeker-e?v=A1&sl=not-uuid&next=https://evil.example/phish");
ok("302", seeker.res.status === 302);
ok("no-store", seeker.res.headers.get("cache-control") === "no-store" && seeker.res.headers.get("netlify-cdn-cache-control") === "no-store");
ok("location stays on site", seeker.loc.origin === SITE && seeker.loc.pathname === "/");
ok("utm on the homepage", seeker.loc.searchParams.get("utm_source") === "facebook" && seeker.loc.searchParams.get("utm_medium") === "group_comment" && seeker.loc.searchParams.get("utm_campaign") === "seeker_link" && seeker.loc.searchParams.get("utm_content") === "seeker-e");
ok("query is not forwarded", !seeker.loc.search.includes("evil") && !seeker.loc.searchParams.has("next") && !seeker.loc.searchParams.has("sl") && !seeker.loc.searchParams.has("v"));
ok("click recorded", seeker.calls.length === 1 && seeker.calls[0].url.endsWith("/rest/v1/rpc/record_link_click"));
const recorded = JSON.parse(seeker.calls[0].body);
ok("record fields only", recorded.p_code === "seeker-e" && recorded.p_variant === "a1" && recorded.p_scraped_lead_id === null && recorded.p_is_bot === false && !("user_agent" in recorded) && !("ip" in recorded));

const bot = await go("/go/seeker-e", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)");
ok("bot flag", JSON.parse(bot.calls[0].body).p_is_bot === true);
ok("bot still redirects home", bot.loc.pathname === "/" && bot.loc.origin === SITE);

const sl = await go("/go/note9?v=bad_slug&sl=11111111-1111-4111-8111-111111111111");
ok("unknown code still home with its content", sl.loc.searchParams.get("utm_content") === "note9" && sl.loc.searchParams.get("utm_campaign") === "group_comment");
const slBody = JSON.parse(sl.calls[0].body);
ok("uuid kept, bad variant dropped", slBody.p_scraped_lead_id === "11111111-1111-4111-8111-111111111111" && slBody.p_variant === null);

const bad = await go("/go/../https://evil.example");
ok("invalid code is home with no record", bad.loc.href === SITE + "/" && bad.calls.length === 0);

const host = await go("/go/seeker-e");
ok("poisoned path cannot leave the site", host.loc.hostname === "shuknadlan.co.il");

const prevOff = globalThis.fetch;
globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
const offsiteCtx = ctx();
const offsite = await handler(
  new Request("https://evil.example/go/seeker-e", { method: "GET" }),
  offsiteCtx as never,
);
await Promise.all(offsiteCtx.jobs);
globalThis.fetch = prevOff;
ok("request host is ignored", new URL(offsite.headers.get("location") || "").origin === SITE);

const prevFetch = globalThis.fetch;
let started = false;
let release: (v: Response) => void = () => {};
globalThis.fetch = (() => {
  started = true;
  return new Promise<Response>((resolve) => { release = resolve; });
}) as typeof fetch;
const hungCtx = ctx();
const hung = handler(new Request(SITE + "/go/seeker-e"), hungCtx as never);
const quick = await Promise.race([
  hung.then((res) => res.status),
  new Promise<number>((resolve) => setTimeout(() => resolve(0), 200)),
]);
ok("redirect does not wait for the db", quick === 302 && started);
release(new Response(null, { status: 204 }));
await hung;
await Promise.all(hungCtx.jobs);
globalThis.fetch = prevFetch;

const post = await go("/go/seeker-e", "Mozilla/5.0", "POST");
ok("non-GET still redirects and does not record", post.res.status === 302 && post.calls.length === 0 && post.loc.searchParams.get("utm_content") === "seeker-e");

const attr = visitAttrFrom({
  visit_attr: { attr_source: "Facebook", attr_campaign: "seeker_link", attr_code: "seeker-e", agent_id: "x", raw_phone: "050" },
  agent_id: "should-not-move",
});
ok("visit_attr keeps slugs only", attr.attr_source === "facebook" && attr.attr_campaign === "seeker_link" && attr.attr_code === "seeker-e" && !("agent_id" in attr) && !("raw_phone" in attr));
ok("hebrew and spaces are dropped", visitAttrFrom({ visit_attr: { attr_source: "פייסבוק", attr_medium: "a b" } }).attr_source === undefined && visitAttrFrom({ visit_attr: { attr_medium: "a b" } }).attr_medium === undefined);
ok("missing column", isMissingAttrColumn({ code: "PGRST204", message: "attr_source schema cache" }) && !isMissingAttrColumn({ code: "23505", message: "duplicate" }));

const attrSrc = readFileSync(new URL("../assets/visit-attr.js", import.meta.url), "utf8");
function bootAttr(search: string, existing: unknown) {
  const data: Record<string, string> = {};
  if (existing) data.shukVisitAttr = JSON.stringify(existing);
  const sandbox: Record<string, unknown> = {
    localStorage: {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => { data[k] = v; },
      removeItem: (k: string) => { delete data[k]; },
    },
    location: { search, pathname: "" },
    fetch: () => Promise.resolve(),
    URLSearchParams,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(attrSrc, sandbox);
  return { api: sandbox.ShukVisitAttr as {
    decide: (stored: unknown, search: string, now: number) => { exp: number; attr_source: string | null; attr_code: string | null } | null;
    payload: (stored: unknown, now: number) => Record<string, string | null> | null;
    decorate: (input: string, init: { body?: string; method?: string } | undefined, attr: Record<string, string | null> | null) => { body?: string } | undefined;
    stamp: (body: Record<string, unknown>) => Record<string, unknown>;
  }, data, fetch: sandbox.fetch as (input: string, init?: { body?: string; method?: string }) => Promise<unknown> };
}

const now = 1_700_000_000_000;
const first = bootAttr("", null).api.decide(null, "?utm_source=facebook&utm_medium=group_comment&utm_campaign=seeker_link&utm_content=seeker-e", now);
ok("first touch stored", !!first && first.attr_source === "facebook" && first.attr_code === "seeker-e" && first.exp === now + 90 * 24 * 60 * 60 * 1000);
const kept = bootAttr("", null).api.decide(first, "?utm_source=google&utm_campaign=other", now + 1000);
ok("first touch wins", kept?.attr_source === "facebook" && kept?.attr_code === "seeker-e");
const replaced = bootAttr("", null).api.decide(first, "?utm_source=google&utm_campaign=other", (first?.exp || 0) + 1);
ok("expired touch is replaced", replaced?.attr_source === "google" && replaced?.attr_code === null);
const page = bootAttr("?utm_source=facebook&utm_content=seeker-e", null);
const stored = JSON.parse(page.data.shukVisitAttr);
const decorated = page.api.decorate(
  "https://obookujgolazrwycsiyn.supabase.co/functions/v1/owner-lead-intake",
  { method: "POST", body: JSON.stringify({ name: "a", phone: "050" }) },
  page.api.payload(stored, Date.now()),
);
const sent = JSON.parse(decorated?.body || "{}");
ok("intake body gains visit_attr only", sent.name === "a" && sent.visit_attr.attr_code === "seeker-e" && sent.visit_attr.attr_source === "facebook");
const other = page.api.decorate(
  "https://obookujgolazrwycsiyn.supabase.co/functions/v1/lead-claim",
  { method: "POST", body: JSON.stringify({ lead_id: "1" }) },
  page.api.payload(stored, Date.now()),
);
ok("other endpoints stay untouched", JSON.parse(other?.body || "{}").visit_attr === undefined);
const crmSandbox: Record<string, unknown> = {
  localStorage: {
    getItem: () => null,
    setItem: () => { throw new Error("crm must not store utm"); },
    removeItem: () => {},
  },
  location: { search: "?utm_source=facebook&utm_content=seeker-e", pathname: "/crm" },
  fetch: () => Promise.resolve(),
  URLSearchParams,
};
crmSandbox.window = crmSandbox;
crmSandbox.globalThis = crmSandbox;
vm.createContext(crmSandbox);
vm.runInContext(attrSrc, crmSandbox);
const crmApi = crmSandbox.ShukVisitAttr as {
  decorate: (input: string, init: { body?: string }, attr: Record<string, string | null> | null) => { body?: string } | undefined;
};
const crmBody = crmApi.decorate(
  "https://obookujgolazrwycsiyn.supabase.co/functions/v1/owner-lead-intake",
  { body: JSON.stringify({ name: "agent-lead" }) },
  { attr_source: "facebook", attr_medium: null, attr_campaign: null, attr_content: "seeker-e", attr_code: "seeker-e" },
);
ok("crm does not attach the agent utm", JSON.parse(crmBody?.body || "{}").visit_attr === undefined);

const PAID = "?utm_source=meta&utm_medium=paid_social&utm_campaign=swipe_afula&utm_content=reel_a";
const paid = bootAttr(PAID, null);
const paidStored = JSON.parse(paid.data.shukVisitAttr);
const paidAttr = paid.api.payload(paidStored, Date.now());
ok("paid utm maps content to attr_content and attr_code",
  paidAttr?.attr_source === "meta" && paidAttr?.attr_medium === "paid_social" &&
  paidAttr?.attr_campaign === "swipe_afula" && paidAttr?.attr_content === "reel_a" && paidAttr?.attr_code === "reel_a");
const stamped = paid.api.stamp({ property_id: "1", name: "a", phone: "050", source: "swipe" });
const stampedAttr = stamped.visit_attr as { attr_content?: string; attr_code?: string; attr_source?: string };
ok("stamp puts visit_attr on a swipe lead",
  stamped.source === "swipe" && stamped.name === "a" && stampedAttr?.attr_content === "reel_a" &&
  stampedAttr?.attr_code === "reel_a" && stampedAttr?.attr_source === "meta");
ok("stamp leaves an existing visit_attr",
  paid.api.stamp({ source: "swipe", visit_attr: { attr_content: "keep" } }).visit_attr !== undefined &&
  (paid.api.stamp({ source: "swipe", visit_attr: { attr_content: "keep" } }).visit_attr as { attr_content: string }).attr_content === "keep");
ok("stamp without a stored visit returns the body", bootAttr("", null).api.stamp({ source: "swipe" }).visit_attr === undefined);

function intakeBody(path: string, body: Record<string, unknown>) {
  const decorated = paid.api.decorate(
    "https://obookujgolazrwycsiyn.supabase.co/functions/v1/" + path,
    { method: "POST", body: JSON.stringify(body) },
    paidAttr,
  );
  return JSON.parse(decorated?.body || "{}") as { source?: string; visit_attr?: { attr_content?: string; attr_code?: string } };
}
const inquiry = intakeBody("property-inquiry-intake", { property_id: "1", name: "a", phone: "050", source: "swipe" });
ok("property inquiry wrapper carries reel_a", inquiry.source === "swipe" && inquiry.visit_attr?.attr_content === "reel_a" && inquiry.visit_attr?.attr_code === "reel_a");
const alertBody = intakeBody("saved-search-intake", { full_name: "a", phone: "050", source: "swipe_end" });
ok("saved search wrapper carries reel_a", alertBody.source === "swipe_end" && alertBody.visit_attr?.attr_content === "reel_a");
for (const path of ["mortgage-lead-intake", "owner-lead-intake", "property-visualize"]) {
  ok(path + " is an intake the wrapper covers", paid.api.decorate(
    "https://obookujgolazrwycsiyn.supabase.co/functions/v1/" + path,
    { body: JSON.stringify({ source: "swipe" }) },
    paidAttr,
  )?.body?.includes('"attr_content":"reel_a"') === true);
}

const swipeSrc = readFileSync(new URL("../assets/swipe.js", import.meta.url), "utf8");
const postAt = swipeSrc.indexOf("function post(url, body)");
const postFn = swipeSrc.slice(postAt, swipeSrc.indexOf("function errText", postAt));
ok("swipe post stamps visit_attr before fetch", postAt > 0 && postFn.includes("ShukVisitAttr.stamp") && postFn.includes("JSON.stringify(body)"));

function scriptTag(html: string, src: string) {
  const re = new RegExp("<script\\b[^>]*\\bsrc=[\"']" + src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\"'][^>]*>");
  const m = re.exec(html);
  return m ? { index: m.index, tag: m[0] } : null;
}
function pageHtml(name: string) {
  return readFileSync(new URL("../" + name, import.meta.url), "utf8");
}
const pages: Array<[string, string]> = [
  ["swipe.html", "assets/swipe.js"],
  ["property.html", "assets/property.js"],
  ["index.html", "assets/home.js"],
  ["pricing.html", "assets/events.js"],
];
for (const [file, after] of pages) {
  const html = pageHtml(file);
  const attr = scriptTag(html, "assets/visit-attr.js");
  const later = scriptTag(html, after);
  ok(file + " defers visit-attr before " + after,
    !!attr && !!later && attr.index < later.index && /\bdefer\b/.test(attr.tag) && !/\basync\b/.test(attr.tag));
}
const propertyHtml = pageHtml("property.html");
const propertyAttr = scriptTag(propertyHtml, "assets/visit-attr.js");
const propertyEvents = scriptTag(propertyHtml, "assets/events.js");
ok("property visit-attr runs before deferred events.js",
  !!propertyAttr && !!propertyEvents && propertyAttr.index < propertyEvents.index && /\bdefer\b/.test(propertyEvents.tag));

const eventsSrc = readFileSync(new URL("../assets/events.js", import.meta.url), "utf8");
const guardAt = eventsSrc.indexOf("function shukVisitAttrTagged");
const writeAt = eventsSrc.lastIndexOf("document.write");
ok("events.js checks for an existing tag before document.write", guardAt > 0 && writeAt > guardAt && eventsSrc.includes("if (!shukVisitAttrTagged())"));

function runAttrLoader(srcs: Array<string | null>, readyState: string) {
  const written: string[] = [];
  const appended: string[] = [];
  const start = eventsSrc.indexOf("function shukVisitAttrTagged");
  const scripts = srcs.map((src) => ({ getAttribute: (name: string) => (name === "src" ? src : null) }));
  const sandbox: Record<string, unknown> = {
    document: {
      readyState,
      getElementsByTagName: () => scripts,
      write: (html: string) => { written.push(html); },
      createElement: () => ({ src: "" }),
      head: { appendChild: (el: { src: string }) => { appended.push(el.src); } },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(eventsSrc.slice(start), sandbox);
  return { written, appended };
}
const skipped = runAttrLoader(["assets/visit-attr.js"], "interactive");
ok("a page that already tags visit-attr is not injected again", skipped.written.length === 0 && skipped.appended.length === 0);
const parsing = runAttrLoader([], "loading");
ok("a page without the tag still document.writes while parsing", parsing.written.length === 1 && parsing.written[0].includes("/assets/visit-attr.js") && parsing.appended.length === 0);
const late = runAttrLoader([], "interactive");
ok("a deferred events.js without the tag appends the script", late.written.length === 0 && late.appended[0] === "/assets/visit-attr.js");

const mig = readFileSync(new URL("../supabase/migrations/20271031280000_visit_click_attribution.sql", import.meta.url), "utf8");
ok("migration has no ip column", !/ip_address|user_agent|inet/i.test(mig));
ok("anon cannot read clicks", /revoke all on table public\.link_clicks from anon, authenticated/.test(mig));
ok("record is anon execute and authenticated revoked", /revoke all on function public\.record_link_click\(text, text, uuid, boolean\) from public, anon, authenticated/.test(mig) && /grant execute on function public\.record_link_click\(text, text, uuid, boolean\) to anon, service_role/.test(mig));
ok("reports are service_role", /grant select on public\.link_click_daily to service_role/.test(mig) && /grant select on public\.visit_attribution_daily to service_role/.test(mig) && !/grant select on public\.link_click_daily to anon/.test(mig));

if (failed) {
  console.log(failed + " failed");
  process.exit(1);
}
console.log("all passed");
