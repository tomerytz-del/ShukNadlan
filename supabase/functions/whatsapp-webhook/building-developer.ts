// שליחת השאלה "איזו חברה יזמית בנתה" וקליטת "לא יודע".
// ההחלטות ב-building-developer-rules.ts, הכתיבה במסד
// (20271106100000_building_projects.sql). הכפתור נתפס ב-index.ts לפני המודל.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { formatForWhatsapp, sendButtons } from "./whatsapp.ts";
import {
  developerAskBody,
  developerUnknownButton,
} from "./building-developer-rules.ts";

export {
  DEVELOPER_UNKNOWN_TITLE,
  addressLinkable,
  applyDeveloperClaim,
  buildingAddressKey,
  developerAskBody,
  developerSpeech,
  developerUnknownButton,
  developerVerificationPhrase,
  exactProjectMatch,
  isNewConstruction,
  isUnknownDeveloperAnswer,
  parseDeveloperUnknownButton,
  propertyAddressKey,
  shouldEnqueueDeveloperAsk,
  shouldSendDeveloperAsk,
} from "./building-developer-rules.ts";

export async function takeBuildingDeveloperAsk(
  supabase: SupabaseClient,
  propertyId: string,
  deliver: boolean,
): Promise<{ body: string; buttons: { id: string; title: string }[] } | null> {
  if (!deliver || !propertyId) return null;
  const { data, error } = await supabase.rpc("building_developer_prompt_take", {
    p_property_id: propertyId,
    p_deliver: true,
  });
  const row = (data || {}) as { send?: boolean; prompt_id?: string; address_label?: string };
  if (error || row.send !== true || !row.prompt_id) return null;
  const button = developerUnknownButton(String(row.prompt_id));
  return {
    body: developerAskBody(String(row.address_label || "")),
    buttons: [button],
  };
}

/** sent רק אחרי שמטא החזירה מזהה. כשל משאיר את השורה claimed. */
export async function markBuildingDeveloperDelivered(
  supabase: SupabaseClient,
  promptId: string,
): Promise<void> {
  const { error } = await supabase.rpc("building_developer_prompt_delivered", {
    p_prompt_id: promptId,
  });
  if (error) console.error("building developer delivered failed", promptId, error.message);
}

export async function answerBuildingDeveloperUnknown(
  supabase: SupabaseClient,
  agentId: string,
  promptId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("building_developer_prompt_unknown", {
    p_prompt_id: promptId,
    p_agent_id: agentId,
  });
  const row = (data || {}) as { ok?: boolean };
  if (error || row.ok !== true) {
    return "לא שמרתי את זה. אפשר לנסות שוב אחרי עדכון המערכת.";
  }
  return "בסדר, לא אשאל שוב על הבניין הזה. לא רשמתי חברה יזמית.";
}

type ClaimRow = {
  prompt_id: string;
  agent_id: string;
  wa_phone: string;
  address_label: string | null;
};

/** סבב אחד של שאלות שנדחו משעות שקט. כשהדגל כבוי ה-claim מחזיר ריק. */
export async function runBuildingDeveloperAsks(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("building_developer_prompts_claim", { p_limit: 20 });
  if (error) return { error: error.message };
  const rows = (data || []) as ClaimRow[];
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const body = developerAskBody(String(row.address_label || ""));
    const button = developerUnknownButton(row.prompt_id);
    let waId: string | null = null;
    let err: string | null = null;
    try {
      waId = await sendButtons(row.wa_phone, body, [button]);
    } catch (e) {
      err = String((e as Error)?.message || e);
      console.error("building developer ask failed", row.prompt_id, err);
    }
    await supabase.from("whatsapp_messages").insert({
      wa_message_id: waId,
      direction: "out",
      wa_phone: row.wa_phone,
      agent_id: row.agent_id,
      msg_type: "interactive",
      body: formatForWhatsapp(`${body} [${button.title}]`).slice(0, 1000),
      status: waId ? "sent" : null,
      error: err,
    });
    if (waId) {
      await markBuildingDeveloperDelivered(supabase, row.prompt_id);
      sent++;
    } else {
      failed++;
    }
  }
  return { claimed: rows.length, sent, failed };
}
