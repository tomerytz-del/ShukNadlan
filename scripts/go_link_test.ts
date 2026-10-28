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
    location: { search },
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
  }, data };
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

const mig = readFileSync(new URL("../supabase/migrations/20271030210000_visit_click_attribution.sql", import.meta.url), "utf8");
ok("migration has no ip column", !/ip_address|user_agent|inet/i.test(mig));
ok("anon cannot read clicks", /revoke all on table public\.link_clicks from anon, authenticated/.test(mig));
ok("record is anon execute and authenticated revoked", /revoke all on function public\.record_link_click\(text, text, uuid, boolean\) from public, anon, authenticated/.test(mig) && /grant execute on function public\.record_link_click\(text, text, uuid, boolean\) to anon, service_role/.test(mig));
ok("reports are service_role", /grant select on public\.link_click_daily to service_role/.test(mig) && /grant select on public\.visit_attribution_daily to service_role/.test(mig) && !/grant select on public\.link_click_daily to anon/.test(mig));

if (failed) {
  console.log(failed + " failed");
  process.exit(1);
}
console.log("all passed");
