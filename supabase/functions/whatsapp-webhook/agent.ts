import Anthropic from "npm:@anthropic-ai/sdk@0.120.0";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { geocodeAfula } from "./geocode.ts";

// ה"מוח" של בוט הוואטסאפ: מקבל את מה שהסוכן/ת כתב/ה (או הכתיב/ה בהקלטה),
// מריץ לולאת tool-use מול Claude, ומחזיר את הטקסט לשליחה חזרה בוואטסאפ.
// כל פעולה במסד הנתונים עוברת דרך הכלים כאן — ל-LLM אין גישה ישירה ל-SQL,
// וכל כלי מקבע בעצמו את agent_id/agency_id כדי שלא ניתן יהיה לגעת בנכס של
// סוכן/ת אחר/ת גם אם המודל "ישתכנע" לנסות.

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY") || "",
});

const MODEL = "claude-opus-5";
const MAX_TOOL_ITERATIONS = 6;
// כמה הודעות שיחה קודמות לשמור. מספיק כדי ש"תוסיף לזה מרפסת" יעבוד,
// קצר מספיק כדי שהעלות והלטנטיות לא יזחלו עם הזמן.
const HISTORY_LIMIT = 12;

// ---------------------------------------------------------------------------
// אוצר מילים — משוכפל מ-crm.html (קבצים סטטיים נפרדים, אין מודול משותף).
// אם מוסיפים סוג נכס או מאפיין בטופס ב-CRM, לעדכן גם כאן, אחרת הבוט ייצור
// נכסים עם ערכים שהטופס בדשבורד לא יודע להציג.
// ---------------------------------------------------------------------------
const RESIDENTIAL_PTYPES = [
  "דירה", "דירת גן", "גג/פנטהאוז", "דופלקס", "מרתף/פרטר", "טריפלקס",
  "יחידת דיור", "סטודיו/לופט", "בית פרטי/קוטג'", "דו משפחתי",
  "משק חקלאי/נחלה", "משק עזר", "מגרש", "בניין מגורים", "מחסן", "חניה",
  "קב' רכישה/זכות לנכס",
];
const COMMERCIAL_PTYPES = [
  "משרדים", "חנויות/שטח מסחרי", "מבני תעשייה", "אולמות", "חלל עבודה משותף",
  "בניין משרדים", "מגרשים", "מחסנים", "סטודיו", "כללי", "מרתף", "חניון",
  "בית מלון", "קליניקות",
];
const RESIDENTIAL_FEATURES = [
  "parking", "elevator", "balcony", "ac", "bars", "accessible",
  "renovated_feature", "furnished", "mamad", "exclusive", "building_shelter",
  "mamak", "storage",
];
const COMMERCIAL_FEATURES = [
  "parking", "elevator", "balcony", "ac", "high_ceiling", "cameras",
  "kitchenette", "alarm", "meeting_room", "loading_ramp", "comms", "cold_room",
];
const CONDITIONS = [
  "new_from_contractor", "new", "renovated", "maintained", "needs_renovation",
];
const PROJECT_STATUSES = [
  "planning", "permit_requested", "permit_issued", "construction_complete",
];
const STATUSES = ["active", "sold", "rented", "archived"];

// שדות שמותר ל-LLM לכתוב אליהם. כל מה שלא ברשימה (agent_id, agency_id,
// is_promoted, bumped_at…) נקבע בשרת או לא ניתן לשינוי דרך וואטסאפ.
const WRITABLE_FIELDS = [
  "title", "description", "category", "property_type", "deal_type", "price",
  "rooms", "city", "street", "house_number", "floor", "size_sqm",
  "built_size_sqm", "condition", "project_status", "move_in_date",
  "move_in_soon", "features", "restrooms_location", "storage_location",
  "mamad_location",
] as const;

export interface AgentRow {
  id: string;
  agency_id: string | null;
  display_name: string | null;
  tier: string;
  agencies?: { name?: string } | null;
}

export interface ConversationState {
  history: Anthropic.MessageParam[];
  pending_images: string[];
  last_property_id: string | null;
}

// ---------------------------------------------------------------------------
// הגדרות הכלים
// ---------------------------------------------------------------------------
const propertyFields = {
  category: {
    type: "string",
    enum: ["residential", "commercial"],
    description: "מגורים או מסחרי. ברירת מחדל residential.",
  },
  property_type: {
    type: "string",
    description:
      `סוג הנכס. למגורים אחד מתוך: ${RESIDENTIAL_PTYPES.join(", ")}. ` +
      `למסחרי אחד מתוך: ${COMMERCIAL_PTYPES.join(", ")}.`,
  },
  deal_type: {
    type: "string",
    enum: ["sale", "rent"],
    description: "sale = למכירה, rent = להשכרה.",
  },
  price: { type: "number", description: "מחיר בשקלים. 1.8 מליון = 1800000." },
  title: {
    type: "string",
    description:
      "כותרת המודעה. אם הסוכן/ת לא נתן/נה כותרת — אל תשאל/י, תשאיר/י ריק ותיווצר כותרת אוטומטית.",
  },
  description: { type: "string", description: "תיאור חופשי של הנכס." },
  rooms: { type: "number", description: "מספר חדרים (אפשר 3.5)." },
  city: { type: "string", description: "עיר. ברירת מחדל עפולה." },
  street: { type: "string", description: "שם רחוב בלי מספר בית." },
  house_number: { type: "string", description: "מספר בית בלבד." },
  floor: { type: "integer", description: "קומה." },
  size_sqm: { type: "number", description: 'שטח במ"ר.' },
  built_size_sqm: { type: "number", description: 'שטח בנוי במ"ר.' },
  condition: {
    type: "string",
    enum: CONDITIONS,
    description: "מצב הנכס (רק למגורים).",
  },
  project_status: { type: "string", enum: PROJECT_STATUSES },
  move_in_date: { type: "string", description: "תאריך כניסה בפורמט YYYY-MM-DD." },
  move_in_soon: { type: "boolean", description: "כניסה מיידית/גמיש." },
  features: {
    type: "array",
    items: { type: "string" },
    description:
      `קודי מאפיינים. למגורים: ${RESIDENTIAL_FEATURES.join(", ")}. ` +
      `למסחרי: ${COMMERCIAL_FEATURES.join(", ")}.`,
  },
  restrooms_location: { type: "string", enum: ["building", "unit"] },
  storage_location: { type: "string", enum: ["building", "unit"] },
  mamad_location: { type: "string", enum: ["building", "unit"] },
} as const;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "create_property",
    description:
      "יוצר נכס חדש בשם הסוכן/ת ומפרסם אותו במצב active. תמונות שהגיעו בשיחה " +
      "וטרם שויכו לנכס מתחברות אליו אוטומטית. כשהעיר עפולה ויש רחוב ומספר בית, " +
      "המערכת מנסה למצוא קואורדינטות בעצמה כדי שהנכס יופיע על המפה.",
    input_schema: {
      type: "object",
      properties: propertyFields,
      required: ["property_type", "deal_type", "price"],
    },
  },
  {
    name: "update_property",
    description:
      "מעדכן שדות בנכס קיים של הסוכן/ת. שולחים רק את השדות שמשתנים.",
    input_schema: {
      type: "object",
      properties: {
        property_id: { type: "string", description: "מזהה הנכס (UUID)." },
        ...propertyFields,
      },
      required: ["property_id"],
    },
  },
  {
    name: "set_property_status",
    description:
      "משנה את סטטוס הנכס. archived = הסרה מהאתר (זו הדרך למחוק נכס — אין מחיקה " +
      "אמיתית, בדיוק כמו בדשבורד). sold/rented = נמכר/הושכר.",
    input_schema: {
      type: "object",
      properties: {
        property_id: { type: "string" },
        status: { type: "string", enum: STATUSES },
      },
      required: ["property_id", "status"],
    },
  },
  {
    name: "list_properties",
    description:
      "מחזיר את הנכסים של הסוכן/ת, החדשים קודם. להשתמש כשצריך למצוא את מזהה " +
      "הנכס שהסוכן/ת מתאר/ת במילים ('הדירה באבן גבירול').",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: STATUSES,
          description: "סינון לפי סטטוס. ברירת מחדל: כל הסטטוסים.",
        },
        limit: { type: "integer", description: "כמה להחזיר. ברירת מחדל 20." },
      },
      required: [],
    },
  },
  {
    name: "attach_images",
    description:
      "משייך לנכס קיים את התמונות שהגיעו בשיחה וטרם שויכו. להשתמש כשהסוכן/ת " +
      "שולח/ת תמונות ומבקש/ת לצרף אותן לנכס שכבר קיים.",
    input_schema: {
      type: "object",
      properties: { property_id: { type: "string" } },
      required: ["property_id"],
    },
  },
];

// ---------------------------------------------------------------------------
// מימוש הכלים
// ---------------------------------------------------------------------------
interface ToolContext {
  supabase: SupabaseClient;
  agent: AgentRow;
  conv: ConversationState;
}

const SITE_BASE_URL = (Deno.env.get("SITE_BASE_URL") || "").replace(/\/$/, "");

function propertyLink(id: string): string | undefined {
  return SITE_BASE_URL ? `${SITE_BASE_URL}/property.html?id=${id}` : undefined;
}

/** בונה כותרת סבירה כשהסוכן/ת לא נתן/נה אחת — עדיף מלשאול שאלה מיותרת. */
function autoTitle(p: Record<string, unknown>): string {
  const parts = [String(p.property_type || "נכס")];
  if (p.rooms) parts.push(`${p.rooms} חדרים`);
  const address = [p.street, p.house_number].filter(Boolean).join(" ");
  if (address) parts.push(`ב${address}`);
  if (p.city) parts.push(address ? `, ${p.city}` : `ב${p.city}`);
  return parts.join(" ").replace(" ,", ",");
}

/** מסננת את קלט ה-LLM לשדות שמותר לכתוב אליהם, ומנקה ערכים ריקים. */
function pickWritable(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE_FIELDS) {
    const value = input[key];
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out;
}

/** מוודאת שהנכס באמת שייך לסוכן/ת לפני כל שינוי. */
async function ownedProperty(ctx: ToolContext, propertyId: string) {
  const { data } = await ctx.supabase
    .from("properties")
    .select("id, title, images, street, house_number, city")
    .eq("id", propertyId)
    .eq("agent_id", ctx.agent.id)
    .maybeSingle();
  return data;
}

async function toolCreateProperty(ctx: ToolContext, input: Record<string, unknown>) {
  if (!ctx.agent.agency_id) {
    return { ok: false, error: "לסוכן/ת אין משרד משויך — צריך להשלים הרשמה בדשבורד." };
  }

  const payload = pickWritable(input);
  payload.category ??= "residential";
  payload.city ??= "עפולה";
  payload.agent_id = ctx.agent.id;
  payload.agency_id = ctx.agent.agency_id;
  payload.status = "active";
  if (!payload.title) payload.title = autoTitle(payload);
  // address נגזר משני השדות בדיוק כמו בטופס בדשבורד
  const street = payload.street as string | undefined;
  const houseNumber = payload.house_number as string | undefined;
  if (street || houseNumber) {
    payload.address = [street, houseNumber].filter(Boolean).join(" ");
  }

  // פין על המפה: בלי lat/lng הנכס לא מופיע במפה בעמוד הבית
  if (payload.city === "עפולה" && street && houseNumber) {
    const coords = await geocodeAfula(street, houseNumber);
    if (coords) {
      payload.lat = coords.lat;
      payload.lng = coords.lng;
    }
  }

  // התמונות שהצטברו בשיחה מתחברות מיד לנכס החדש — זו כל הפואנטה של
  // "לצלם את הדירה ולשלוח בוואטסאפ יחד עם הטקסט"
  const images = ctx.conv.pending_images;
  if (images.length) payload.images = images;

  const { data, error } = await ctx.supabase
    .from("properties")
    .insert(payload)
    .select("id, title")
    .single();

  if (error) return { ok: false, error: error.message };

  ctx.conv.last_property_id = data.id;
  ctx.conv.pending_images = [];

  return {
    ok: true,
    property_id: data.id,
    title: data.title,
    images_attached: images.length,
    on_map: payload.lat !== undefined,
    link: propertyLink(data.id),
  };
}

async function toolUpdateProperty(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  const existing = await ownedProperty(ctx, propertyId);
  if (!existing) return { ok: false, error: "לא נמצא נכס כזה אצל הסוכן/ת." };

  const payload = pickWritable(input);
  if (!Object.keys(payload).length) {
    return { ok: false, error: "לא נשלח אף שדה לעדכון." };
  }

  // כשהכתובת משתנה — גם address וגם הפין על המפה צריכים להתעדכן איתה
  const street = (payload.street ?? existing.street) as string | undefined;
  const houseNumber = (payload.house_number ?? existing.house_number) as string | undefined;
  if (payload.street !== undefined || payload.house_number !== undefined) {
    payload.address = [street, houseNumber].filter(Boolean).join(" ") || null;
    const city = (payload.city ?? existing.city) as string | undefined;
    if (city === "עפולה" && street && houseNumber) {
      const coords = await geocodeAfula(street, houseNumber);
      if (coords) {
        payload.lat = coords.lat;
        payload.lng = coords.lng;
      }
    }
  }
  payload.updated_at = new Date().toISOString();

  const { error } = await ctx.supabase
    .from("properties")
    .update(payload)
    .eq("id", propertyId)
    .eq("agent_id", ctx.agent.id);

  if (error) return { ok: false, error: error.message };

  ctx.conv.last_property_id = propertyId;
  return {
    ok: true,
    property_id: propertyId,
    updated_fields: Object.keys(payload).filter((k) => k !== "updated_at"),
    link: propertyLink(propertyId),
  };
}

async function toolSetStatus(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  const status = String(input.status || "");
  if (!STATUSES.includes(status)) return { ok: false, error: "סטטוס לא חוקי." };

  const existing = await ownedProperty(ctx, propertyId);
  if (!existing) return { ok: false, error: "לא נמצא נכס כזה אצל הסוכן/ת." };

  const { error } = await ctx.supabase
    .from("properties")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", propertyId)
    .eq("agent_id", ctx.agent.id);

  if (error) return { ok: false, error: error.message };

  ctx.conv.last_property_id = propertyId;
  return { ok: true, property_id: propertyId, title: existing.title, status };
}

async function toolListProperties(ctx: ToolContext, input: Record<string, unknown>) {
  const limit = Math.min(Number(input.limit) || 20, 50);
  let query = ctx.supabase
    .from("properties")
    .select("id, title, address, city, price, rooms, deal_type, status, created_at")
    .eq("agent_id", ctx.agent.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.status) query = query.eq("status", String(input.status));

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: data.length, properties: data };
}

async function toolAttachImages(ctx: ToolContext, input: Record<string, unknown>) {
  const propertyId = String(input.property_id || "");
  if (!ctx.conv.pending_images.length) {
    return { ok: false, error: "אין תמונות ממתינות בשיחה." };
  }

  const existing = await ownedProperty(ctx, propertyId);
  if (!existing) return { ok: false, error: "לא נמצא נכס כזה אצל הסוכן/ת." };

  const merged = [...(existing.images || []), ...ctx.conv.pending_images];
  const { error } = await ctx.supabase
    .from("properties")
    .update({ images: merged, updated_at: new Date().toISOString() })
    .eq("id", propertyId)
    .eq("agent_id", ctx.agent.id);

  if (error) return { ok: false, error: error.message };

  const added = ctx.conv.pending_images.length;
  ctx.conv.pending_images = [];
  ctx.conv.last_property_id = propertyId;
  return { ok: true, property_id: propertyId, images_added: added, total_images: merged.length };
}

async function runTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    switch (name) {
      case "create_property": return await toolCreateProperty(ctx, input);
      case "update_property": return await toolUpdateProperty(ctx, input);
      case "set_property_status": return await toolSetStatus(ctx, input);
      case "list_properties": return await toolListProperties(ctx, input);
      case "attach_images": return await toolAttachImages(ctx, input);
      default: return { ok: false, error: `כלי לא מוכר: ${name}` };
    }
  } catch (err) {
    console.error(`tool ${name} threw`, err);
    return { ok: false, error: String((err as Error)?.message || err) };
  }
}

// ---------------------------------------------------------------------------
// לולאת השיחה
// ---------------------------------------------------------------------------
function systemPrompt(agent: AgentRow, conv: ConversationState): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "את/ה העוזר/ת של שוק נדל\"ן — מערכת ניהול נכסים לסוכני נדל\"ן בעפולה.",
    "את/ה מדבר/ת עם הסוכן/ת בוואטסאפ ומבצע/ת עבורו/ה פעולות במערכת דרך הכלים.",
    "",
    `הסוכן/ת: ${agent.display_name || "ללא שם"}${agent.agencies?.name ? ` · משרד ${agent.agencies.name}` : ""}.`,
    `תאריך היום: ${today}.`,
    "",
    "כללים:",
    "- ענה/י בעברית, קצר, בסגנון וואטסאפ. אימוג'י אחד לכל היותר.",
    "- מחירים בעברית מדוברת: \"1.8 מליון\" = 1800000, \"5,500 שקל\" = 5500. שכירות היא מחיר חודשי.",
    "- אל תשאל/י שאלות מיותרות. השדות ההכרחיים ליצירת נכס הם סוג נכס, סוג עסקה ומחיר בלבד — אם יש אותם, צור/צרי את הנכס והשלם/י את השאר ממה שנאמר.",
    "- אם חסר אחד מהשלושה, בקש/י בשאלה אחת קצרה רק את מה שחסר.",
    "- לפני שינוי או ארכוב של נכס קיים — ודא/י שאת/ה יודע/ת על איזה נכס מדובר. אם לא, קרא/י ל-list_properties.",
    "- \"תמחק את הנכס\" = set_property_status עם archived. אין מחיקה אמיתית.",
    "- לעולם אל תמציא/י פרטים שלא נאמרו (מחיר, שטח, קומה). מה שלא ידוע נשאר ריק.",
    "- אחרי פעולה מוצלחת אשר/י אותה במשפט אחד עם מה שנוצר/השתנה. אם התקבל link, צרף/י אותו.",
    "- אל תציג/י UUID לסוכן/ת. התייחס/י לנכסים לפי כתובת או כותרת.",
  ];

  if (conv.pending_images.length) {
    lines.push(
      "",
      `יש כרגע ${conv.pending_images.length} תמונות שהתקבלו בשיחה וטרם שויכו לנכס. ` +
        "יצירת נכס חדש תצרף אותן אוטומטית; לצירוף לנכס קיים יש להשתמש ב-attach_images.",
    );
  }
  if (conv.last_property_id) {
    lines.push(
      "",
      `הנכס האחרון שנגעת בו בשיחה הזו: ${conv.last_property_id}. ` +
        "אם הסוכן/ת אומר/ת \"תוסיף לזה\" או \"תעדכן את זה\" — זה הנכס שמדובר בו.",
    );
  }

  return lines.join("\n");
}

/**
 * קריאה ל-Claude. ‏fallbacks מפעיל ניתוב אוטומטי למודל חלופי אם בקשה נדחית
 * על ידי מסנני הבטיחות, כדי שסוכן/ת לא תיתקע בלי תשובה. אם ה-beta לא זמין
 * לחשבון — נופלים לקריאה רגילה במקום להפיל את כל הזרימה.
 */
async function callClaude(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  try {
    // deno-lint-ignore no-explicit-any
    return await (anthropic.beta.messages.create as any)({
      ...params,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (err) {
    console.warn("beta fallbacks unavailable, retrying without", err);
    return await anthropic.messages.create(params);
  }
}

/**
 * מריץ תור אחד של שיחה: קלט הסוכן/ת -> (כלים) -> טקסט תשובה.
 * ‏conv מתעדכן במקום (pending_images / last_property_id) ונשמר על ידי הקורא.
 */
export async function runAgentTurn(opts: {
  supabase: SupabaseClient;
  agent: AgentRow;
  conv: ConversationState;
  userContent: Anthropic.ContentBlockParam[];
  /** תיאור טקסטואלי של התור לשמירה בהיסטוריה (בלי בלוקי תמונה, שלא לנפח אותה) */
  userSummary: string;
}): Promise<string> {
  const { supabase, agent, conv, userContent, userSummary } = opts;
  const ctx: ToolContext = { supabase, agent, conv };

  const messages: Anthropic.MessageParam[] = [
    ...conv.history,
    { role: "user", content: userContent },
  ];

  let finalText = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callClaude({
      model: MODEL,
      max_tokens: 4096,
      // שיחת וואטסאפ היא נתיב רגיש ללטנטיות, והמשימה (חילוץ פרטי נכס והפעלת
      // כלי) פשוטה. אם מתחילים לראות טעויות חילוץ — להעלות ל-medium/high.
      output_config: { effort: "low" },
      system: systemPrompt(agent, conv),
      tools: TOOLS,
      messages,
    } as Anthropic.MessageCreateParamsNonStreaming);

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) finalText = text;

    if ((response.stop_reason as string) === "refusal") {
      finalText = "מצטער, לא הצלחתי לטפל בבקשה הזו. אפשר לנסח אותה אחרת?";
      break;
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUses.length) break;

    messages.push({ role: "assistant", content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const result = await runTool(
        ctx,
        use.name,
        (use.input || {}) as Record<string, unknown>,
      );
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText) {
    finalText = "לא הצלחתי להשלים את הפעולה. אפשר לנסות שוב או לפנות לדשבורד.";
  }

  // ההיסטוריה נשמרת כטקסט בלבד — בלי בלוקי הכלים ובלי התמונות. זה מספיק
  // כדי לפתור התייחסויות ("תוסיף לזה מרפסת"), ומונע היסטוריה שגדלה בלי גבול
  // ומצבים לא חוקיים של tool_result יתום אחרי גזימה.
  conv.history = [
    ...conv.history,
    { role: "user", content: userSummary },
    { role: "assistant", content: finalText },
  ].slice(-HISTORY_LIMIT);

  return finalText;
}
