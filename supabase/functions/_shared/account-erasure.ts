// ============================================================================
// מחיקת חשבון: מה שאי אפשר לעשות ב-SQL
//
// ‏erase_agent_account / close_developer_account במסד מוחקות את הפרטים
// ומחזירות שני דברים שנשארו בחוץ: ה-user_id (המשתמש ב-Supabase Auth, שרק
// ה-Admin API מוחק) ורשימת המספרים הווירטואליים שסומנו כמשוחררים (שרק
// Twilio מוחקת). הקובץ הזה משותף ל-close-account (מחיקה מיידית מהאפליקציה)
// ול-account-erasure (הריצה היומית, אחרי סגירה מתוזמנת של מנוי בתשלום).
// ============================================================================

// deno-lint-ignore no-explicit-any
type Sb = any;

const TWILIO_SID = (Deno.env.get("TWILIO_ACCOUNT_SID") || "").trim();
const TWILIO_TOKEN = (Deno.env.get("TWILIO_AUTH_TOKEN") || "").trim();

/** שחרור מספר ב-Twilio. כשל אינו עוצר את המחיקה: השורה כבר released,
 *  והמספר שנשאר ב-Twilio הוא עלות ולא מידע אישי - נרשם ללוג לטיפול ידני. */
async function releaseTwilioNumber(sid: string | null | undefined): Promise<void> {
  if (!sid || !TWILIO_SID || !TWILIO_TOKEN) return;
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/IncomingPhoneNumbers/${sid}.json`,
      { method: "DELETE", headers: { Authorization: "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`) } },
    );
    if (!res.ok && res.status !== 404) console.error("account-erasure: twilio release failed", sid, res.status);
  } catch (err) {
    console.error("account-erasure: twilio release error", sid, err);
  }
}

/** האם לאותו משתמש נשאר פרופיל חי אחר (סוכן/ת שהוא/היא גם חברה יזמית).
 *  אם כן - המשתמש ב-Auth נשאר, כי מחיקתו הייתה נועלת גם את החשבון השני. */
async function otherLiveProfile(sb: Sb, userId: string): Promise<boolean> {
  const [{ data: agent }, { data: dev }] = await Promise.all([
    sb.from("agency_members").select("id").eq("user_id", userId).is("erased_at", null).maybeSingle(),
    sb.from("developers").select("id").eq("user_id", userId).is("erased_at", null).maybeSingle(),
  ]);
  return !!(agent || dev);
}

/** מחיקת המשתמש ב-Auth. ‏404 הוא "כבר נמחק" ולא שגיאה. */
export async function deleteAuthUser(sb: Sb, userId: string | null | undefined): Promise<"deleted" | "kept" | "failed" | "none"> {
  if (!userId) return "none";
  if (await otherLiveProfile(sb, userId)) return "kept";
  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error && !/not.?found/i.test(String(error.message || ""))) {
    console.error("account-erasure: auth delete failed", userId, error.message);
    return "failed";
  }
  return "deleted";
}

/** המחיקה המלאה של סוכן/ת שכבר נסגר/ה. */
export async function eraseAgent(sb: Sb, agentId: string) {
  const { data, error } = await sb.rpc("erase_agent_account", { p_agent_id: agentId });
  if (error) return { error: "db_error", detail: error.message };
  if (data?.error) return { error: data.error };
  for (const line of (data?.lines || []) as Array<{ twilio_sid?: string | null }>) {
    await releaseTwilioNumber(line.twilio_sid);
  }
  const auth = await deleteAuthUser(sb, data?.user_id);
  return { success: true, auth, result: data };
}
