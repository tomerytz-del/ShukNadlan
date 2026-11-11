// ============================================================================
// public_hood_opener_harness.ts
// תור ראשון של הבוט הציבורי על שלוש הודעות פתיחה מדף שכונה.
//
// קורא ל-runPublicTurn האמיתי (SYSTEM_STATIC, הכלים, לולאת השיחה). המסד הוא
// מוק בזיכרון. fetch יוצא רק ל-api.anthropic.com. קריאה ל-graph.facebook.com
// נענית מקומית ולא נשלחת. אין SUPABASE_URL ואין WHATSAPP_TOKEN בזמן הריצה,
// ולכן logAiUsage יוצא מיד ו-Meta לא יכולה לקבל הודעה גם אם השומר נכשל.
//
// בלי מפתח המודל אין תשובה, ואין להמציא אחת:
//
//   ANTHROPIC_API_KEY=... deno run -A scripts/public_hood_opener_harness.ts \
//     --out=/tmp/hood-after.json
//
// אותו סקריפט על הפרומפט של main (בלי לשנות את הענף הזה):
//
//   git worktree add --detach /tmp/shuk-main origin/main
//   cp scripts/public_hood_opener_harness.ts /tmp/shuk-main/scripts/
//   cd /tmp/shuk-main && ANTHROPIC_API_KEY=... deno run -A \
//     scripts/public_hood_opener_harness.ts --out=/tmp/hood-before.json
//
// בדיקה שהשורה יושבת בפרומפט, בלי מודל:
//
//   deno run -A scripts/public_hood_opener_harness.ts --check
//
// טעינת המודול בלי קריאה למודל:
//
//   deno run -A scripts/public_hood_opener_harness.ts --dry
// ============================================================================

const INSTRUCTION =
  "כשהודעת הפתיחה מהאתר מציינת שכונה ועיר, השתמש בהן כנתוני החיפוש ואל תשאל עליהן שוב. שאל רק מה שחסר, למשל קנייה או שכירות, תקציב ומספר חדרים.";

const PROMPT_FILE = new URL(
  "../supabase/functions/whatsapp-webhook/public-agent.ts",
  import.meta.url,
);

/* הפלט של ShukHood.hoodHello (דף /n/): "{שכונה} ב{עיר}", והעיר נשמטת כשהשם
   כבר מכיל אותה כמילה. שלוש הדוגמאות שאושרו לבדיקה. */
const OPENERS: Array<{ id: string; label: string; text: string }> = [
  {
    id: "center",
    label: "מרכז העיר בעפולה",
    text: "שלום, הגעתי מהאתר, מדף שכונת מרכז העיר בעפולה, ואשמח לעזרה במציאת נכס",
  },
  {
    id: "givat",
    label: "גבעת המורה בעפולה",
    text: "שלום, הגעתי מהאתר, מדף שכונת גבעת המורה בעפולה, ואשמח לעזרה במציאת נכס",
  },
  {
    id: "ilit",
    label: "עפולה עלית (בלי סיומת עיר)",
    text: "שלום, הגעתי מהאתר, מדף שכונת עפולה עלית, ואשמח לעזרה במציאת נכס",
  },
];

const SECRET_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_KEY",
  "SUPABASE_SERVICE_KEY",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
];

const HARNESS_PHONE = "972000000000";

const args = Object.fromEntries(
  Deno.args.map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

function promptSource(): string {
  return Deno.readTextFileSync(PROMPT_FILE);
}

function instructionCount(src: string): number {
  let n = 0;
  let i = 0;
  while (true) {
    const at = src.indexOf(INSTRUCTION, i);
    if (at < 0) return n;
    n += 1;
    i = at + INSTRUCTION.length;
  }
}

if (args.check === "true") {
  const n = instructionCount(promptSource());
  if (n !== 1) {
    console.error(`ההוראה מופיעה ${n} פעמים ב-public-agent.ts (צריך 1)`);
    Deno.exit(1);
  }
  console.log("ההוראה מופיעה פעם אחת ב-SYSTEM_STATIC של public-agent.ts");
  Deno.exit(0);
}

const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
if (!apiKey && args.dry !== "true") {
  console.error(
    "ANTHROPIC_API_KEY אינו מוגדר בסביבה הזו. אין תשובות מודל, ולא הומצאו כאלה.\n" +
      "הרצה:\n" +
      "  ANTHROPIC_API_KEY=... deno run -A scripts/public_hood_opener_harness.ts --out=/tmp/hood-after.json\n" +
      "פרומפט של main, אותו סקריפט, בלי לגעת בענף:\n" +
      "  git worktree add --detach /tmp/shuk-main origin/main\n" +
      "  cp scripts/public_hood_opener_harness.ts /tmp/shuk-main/scripts/\n" +
      "  cd /tmp/shuk-main && ANTHROPIC_API_KEY=... deno run -A scripts/public_hood_opener_harness.ts --out=/tmp/hood-before.json",
  );
  Deno.exit(2);
}

for (const k of SECRET_KEYS) Deno.env.delete(k);

type NetEvent = { host: string; method: string; disposition: "passed" | "stubbed" | "blocked" };
const network: NetEvent[] = [];
const toolUses: Array<{ name: string; input: Record<string, unknown> }> = [];
const outbound: Array<{ kind: string; to: string; text: string; buttons?: string[] }> = [];

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
    ? input.href
    : input.url;
  let host = "";
  try {
    host = new URL(url, "https://harness.invalid").host;
  } catch {
    host = String(url).slice(0, 80);
  }
  const method = (init?.method || (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") || "GET")
    .toUpperCase();

  if (host === "api.anthropic.com") {
    network.push({ host, method, disposition: "passed" });
    const res = await realFetch(input, init);
    try {
      const data = await res.clone().json();
      const blocks = Array.isArray(data?.content) ? data.content : [];
      for (const b of blocks) {
        if (b && b.type === "tool_use" && typeof b.name === "string") {
          const inputObj = b.input && typeof b.input === "object" ? b.input as Record<string, unknown> : {};
          toolUses.push({ name: b.name, input: inputObj });
        }
      }
    } catch {
      /* שגיאת API או גוף שאינו JSON. הקורא יראה את החריגה. */
    }
    return res;
  }

  if (host === "graph.facebook.com") {
    network.push({ host, method, disposition: "stubbed" });
    let bodyText = "";
    try {
      if (typeof init?.body === "string") bodyText = init.body;
      else if (init?.body instanceof Uint8Array) bodyText = new TextDecoder().decode(init.body);
    } catch { /* הגוף לא נחוץ כדי לחסום את השליחה */ }
    try {
      const payload = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {};
      const to = String(payload.to || "");
      if (payload.type === "image") {
        const image = payload.image as { caption?: string } | undefined;
        outbound.push({ kind: "image", to, text: String(image?.caption || "") });
      } else if (payload.type === "interactive") {
        const interactive = payload.interactive as {
          body?: { text?: string };
          action?: { buttons?: Array<{ reply?: { title?: string } }> };
        } | undefined;
        const buttons = (interactive?.action?.buttons || [])
          .map((b) => String(b?.reply?.title || ""))
          .filter(Boolean);
        outbound.push({
          kind: "buttons",
          to,
          text: String(interactive?.body?.text || ""),
          buttons,
        });
      } else if (payload.type === "text") {
        const text = payload.text as { body?: string } | undefined;
        outbound.push({ kind: "text", to, text: String(text?.body || "") });
      } else {
        outbound.push({ kind: String(payload.type || "unknown"), to, text: bodyText.slice(0, 500) });
      }
    } catch {
      outbound.push({ kind: "unparsed", to: "", text: bodyText.slice(0, 500) });
    }
    return new Response(JSON.stringify({ messages: [{ id: "wamid.HARNESS_NOT_SENT" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  network.push({ host, method, disposition: "blocked" });
  throw new Error(`harness blocked network call to ${host} ${method}`);
};

type Row = Record<string, unknown>;
type Write = { table: string; op: string };

function likeMatch(value: unknown, pattern: string): boolean {
  const raw = String(pattern).replace(/\\([%_\\])/g, "$1");
  let re = "";
  for (const c of raw) {
    if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$", "i").test(String(value ?? ""));
}

function stubRows(): { properties: Row[]; neighborhoods: Row[]; aliases: Row[] } {
  const hoods: Row[] = [
    { id: "hood-center", name: "מרכז העיר", city: "עפולה" },
    { id: "hood-givat", name: "גבעת המורה", city: "עפולה" },
    { id: "hood-ilit", name: "עפולה עלית", city: "עפולה" },
  ];
  const aliases: Row[] = [
    { neighborhood_id: "hood-center", alias: "מרכז" },
  ];
  const specs: Array<[string, string, string, string, number]> = [
    ["hood-center", "מרכז העיר", "sale", "1450000", 4],
    ["hood-center", "מרכז העיר", "rent", "3800", 3],
    ["hood-givat", "גבעת המורה", "sale", "1680000", 5],
    ["hood-givat", "גבעת המורה", "rent", "4200", 4],
    ["hood-ilit", "עפולה עלית", "sale", "990000", 3],
    ["hood-ilit", "עפולה עלית", "rent", "3100", 3],
  ];
  const properties: Row[] = specs.map(([hood, hoodName, deal, price, rooms], i) => ({
    id: `11111111-1111-4111-8111-11111111111${i}`,
    title: `דירת ${rooms} חדרים`,
    property_type: "דירה",
    deal_type: deal,
    category: "residential",
    price: Number(price),
    price_total: Number(price),
    price_unit: "total",
    rooms,
    size_sqm: 90 + rooms * 5,
    floor: 2,
    total_floors: 5,
    city: "עפולה",
    street: "הנשיא",
    address: "הנשיא",
    house_number: String(10 + i),
    sales_area: null,
    features: ["mamad"],
    condition: "שמור",
    images: ["https://example.invalid/harness-photo.jpg"],
    listing_number: 9000 + i,
    is_promoted: i % 2 === 0,
    bumped_at: "2026-10-01T00:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
    neighborhood_id: hood,
    neighborhoods: { name: hoodName },
    status: "active",
    has_virtual_tour: false,
    video_url: null,
    open_house: false,
  }));
  return { properties, neighborhoods: hoods, aliases };
}

function makeSupabase(): { client: unknown; writes: Write[] } {
  const data = stubRows();
  const writes: Write[] = [];
  const tables: Record<string, Row[]> = {
    properties: data.properties,
    neighborhoods: data.neighborhoods,
    neighborhood_aliases: data.aliases,
    projects_public: [],
  };

  function rowsFor(table: string): Row[] {
    return (tables[table] || []).map((r) => ({ ...r }));
  }

  function apply(table: string, filters: Array<{ op: string; args: unknown[] }>, limit: number | null): Row[] {
    let rows = rowsFor(table);
    for (const f of filters) {
      const [col, val] = f.args;
      if (f.op === "eq") rows = rows.filter((r) => r[String(col)] === val);
      else if (f.op === "ilike") rows = rows.filter((r) => likeMatch(r[String(col)], String(val)));
      else if (f.op === "in") {
        const list = Array.isArray(val) ? val : [];
        rows = rows.filter((r) => list.includes(r[String(col)]));
      } else if (f.op === "gte") rows = rows.filter((r) => Number(r[String(col)]) >= Number(val));
      else if (f.op === "lte") rows = rows.filter((r) => Number(r[String(col)]) <= Number(val));
      else if (f.op === "contains" && Array.isArray(val)) {
        rows = rows.filter((r) => {
          const have = Array.isArray(r[String(col)]) ? r[String(col)] as unknown[] : [];
          return val.every((x) => have.includes(x));
        });
      }
    }
    if (limit !== null) rows = rows.slice(0, limit);
    return rows;
  }

  function from(table: string) {
    const filters: Array<{ op: string; args: unknown[] }> = [];
    let limit: number | null = null;
    const builder: Record<string, unknown> = {};
    const chain = (op: string) => (...fnArgs: unknown[]) => {
      if (op === "limit") limit = Number(fnArgs[0]);
      else filters.push({ op, args: fnArgs });
      return builder;
    };
    for (const op of ["select", "eq", "ilike", "in", "gte", "lte", "contains", "or", "order", "neq", "not", "filter", "match"]) {
      builder[op] = chain(op);
    }
    builder.limit = chain("limit");
    builder.insert = (row: unknown) => {
      const list = Array.isArray(row) ? row : [row];
      for (let i = 0; i < list.length; i++) writes.push({ table, op: "insert" });
      return Promise.resolve({ data: null, error: null });
    };
    builder.upsert = (row: unknown) => {
      writes.push({ table, op: "upsert" });
      void row;
      return Promise.resolve({ data: null, error: null });
    };
    builder.update = (row: unknown) => {
      writes.push({ table, op: "update" });
      void row;
      return builder;
    };
    builder.delete = () => {
      writes.push({ table, op: "delete" });
      return builder;
    };
    builder.maybeSingle = () => {
      const rows = apply(table, filters, limit);
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    };
    builder.single = builder.maybeSingle;
    builder.then = (
      resolve: (v: { data: Row[]; error: null }) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: apply(table, filters, limit), error: null }).then(resolve, reject);
    return builder;
  }

  const client = {
    from,
    rpc(fn: string, rpcArgs?: unknown) {
      writes.push({ table: "rpc:" + fn, op: "rpc" });
      void rpcArgs;
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { client, writes };
}

function filled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function searchSummary(calls: Array<{ name: string; input: Record<string, unknown> }>) {
  return calls.filter((c) => c.name === "search_properties").map((c) => ({
    city: c.input.city ?? null,
    area: c.input.area ?? null,
    city_filled: filled(c.input.city),
    area_filled: filled(c.input.area),
    deal_type: c.input.deal_type ?? null,
    input: c.input,
  }));
}

function visibleText(returned: string): string {
  const parts: string[] = [];
  for (const msg of outbound) {
    if (msg.kind === "image") continue;
    const buttons = msg.buttons?.length ? "\n[" + msg.buttons.join(" | ") + "]" : "";
    parts.push(msg.text + buttons);
  }
  if (returned.trim()) parts.push(returned);
  return parts.join("\n\n");
}

if (args.dry === "true") {
  const { runPublicTurn } = await import("../supabase/functions/whatsapp-webhook/public-agent.ts");
  const { applyPropertyFilters, filterByArea } = await import(
    "../supabase/functions/whatsapp-webhook/property-search.ts"
  );
  if (typeof runPublicTurn !== "function") {
    console.error("runPublicTurn לא נטען");
    Deno.exit(1);
  }
  const leaked = SECRET_KEYS.filter((k) => Deno.env.get(k));
  if (leaked.length) {
    console.error("סודות נשארו אחרי המחיקה: " + leaked.join(", "));
    Deno.exit(1);
  }
  const n = instructionCount(promptSource());
  const { client, writes } = makeSupabase();
  const db = client as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (c: string, v: unknown) => unknown;
      };
    };
  };
  const built = applyPropertyFilters(
    db.from("properties").select("*").eq("status", "active"),
    { city: "עפולה", deal_type: "sale" },
  );
  const { data, error } = await built.query;
  if (error || !Array.isArray(data) || data.length < 1) {
    console.error("המוק לא החזיר נכסים", error, data);
    Deno.exit(1);
  }
  const area = await filterByArea(client as never, data, "גבעת המורה", "עפולה", { withHint: true });
  const names = area.rows.map((r) => String((r as { neighborhoods?: { name?: string } }).neighborhoods?.name || ""));
  if (!names.includes("גבעת המורה") || names.some((name) => name && name !== "גבעת המורה")) {
    console.error("סינון השכונה על המוק החזיר תוצאה לא צפויה", names, area.hint);
    Deno.exit(1);
  }
  const ilit = await filterByArea(client as never, data, "עפולה עלית", null, { withHint: true });
  const ilitNames = ilit.rows.map((r) => String((r as { neighborhoods?: { name?: string } }).neighborhoods?.name || ""));
  if (!ilitNames.includes("עפולה עלית")) {
    console.error("עפולה עלית לא סוננה מהמוק", ilitNames, ilit.hint);
    Deno.exit(1);
  }
  if (writes.length || network.length) {
    console.error("בדיקת המוק נגעה ברשת או בכתיבה", writes, network);
    Deno.exit(1);
  }
  console.log(`dry ok. runPublicTurn נטען. ההוראה בפרומפט: ${n === 1 ? "פעם אחת" : n + " פעמים"}`);
  console.log("המוק מסנן גבעת המורה ועפולה עלית בלי רשת ובלי כתיבה.");
  console.log("לא נקרא מודל. לא נשלח וואטסאפ. לא נכתב למסד.");
  Deno.exit(n === 1 ? 0 : 1);
}

const { runPublicTurn } = await import("../supabase/functions/whatsapp-webhook/public-agent.ts");

const only = args.only ? String(args.only).split(",") : null;
const cases = OPENERS.filter((c) => !only || only.includes(c.id));
const results = [];

for (const opener of cases) {
  toolUses.length = 0;
  outbound.length = 0;
  const beforeNet = network.length;
  const { client, writes } = makeSupabase();
  const conv = {
    history: [] as Array<{ role: string; content: unknown }>,
    last_property_id: null,
    last_saved_search_id: null,
    leads_created: 0,
    leads_window_start: null,
  };
  const t0 = Date.now();
  let returned = "";
  let error = "";
  try {
    const turn = await runPublicTurn({
      // המוק אינו לקוח אמיתי. הוא לא פותח רשת.
      supabase: client as never,
      conv: conv as never,
      userText: opener.text,
      waPhone: HARNESS_PHONE,
      profileName: null,
    });
    returned = turn.text || "";
  } catch (err) {
    error = String((err as Error)?.message || err);
  }
  const calls = toolUses.slice();
  const searches = searchSummary(calls);
  const net = network.slice(beforeNet);
  const row = {
    id: opener.id,
    label: opener.label,
    opener: opener.text,
    returned_text: returned,
    visible_reply: visibleText(returned),
    outbound: outbound.slice(),
    history_assistant: conv.history.filter((m) => m.role === "assistant").map((m) => m.content),
    search_properties: searches,
    tools: calls.map((c) => c.name),
    tool_inputs: calls,
    mock_writes: writes,
    network: net,
    ms: Date.now() - t0,
    error,
  };
  results.push(row);
  console.log("\n========== " + opener.label + " ==========");
  console.log("opener: " + opener.text);
  if (error) console.log("ERROR: " + error);
  console.log("--- visible reply ---");
  console.log(row.visible_reply || "(ריק)");
  console.log("--- returned text (מה ש-reply היה שולח) ---");
  console.log(returned || "(ריק)");
  console.log("--- search_properties ---");
  console.log(JSON.stringify(searches, null, 2));
  console.log("tools: " + (calls.map((c) => c.name).join(", ") || "(none)"));
  console.log("mock writes: " + JSON.stringify(writes));
  console.log("network: " + JSON.stringify(net));
}

const passed = network.filter((n) => n.disposition === "passed").map((n) => n.host);
const badPass = [...new Set(passed.filter((h) => h !== "api.anthropic.com"))];
const blocked = network.filter((n) => n.disposition === "blocked");
const safety = {
  anthropic_only: badPass.length === 0,
  unexpected_passed_hosts: badPass,
  blocked_calls: blocked.length,
  stubbed_whatsapp: network.filter((n) => n.disposition === "stubbed").length,
  production_writes: 0,
  supabase_url_set: !!Deno.env.get("SUPABASE_URL"),
  whatsapp_token_set: !!Deno.env.get("WHATSAPP_TOKEN"),
};

console.log("\n========== safety ==========");
console.log(JSON.stringify(safety, null, 2));

const report = { instruction_present: instructionCount(promptSource()) === 1, safety, results };
if (args.out) {
  await Deno.writeTextFile(String(args.out), JSON.stringify(report, null, 2) + "\n");
  console.log("wrote " + args.out);
}

if (badPass.length || blocked.length || safety.supabase_url_set || safety.whatsapp_token_set) {
  console.error("הריצה נגעה ביעד שלא הותר");
  Deno.exit(1);
}
if (results.some((r) => r.error)) Deno.exit(1);
