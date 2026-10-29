// העתקה או העברה של תמונות. הקובץ משוכפל. המקור נמחק רק אחרי חלון הביטול,
// ורק אם אף נכס לא מצביע עליו. לא משנים סטטוס ולא מפרסמים.
import { planPhotoTransfer, urlsAt, photoUrlsHash } from "../whatsapp-webhook/photo-target.ts";

const BUCKET = "property-images";

export function storagePath(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = String(url).indexOf(marker);
  return i === -1 ? null : decodeURIComponent(String(url).slice(i + marker.length).split("?")[0]);
}

export function publicImageUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
}

/**
 * מותר למחוק רק קובץ בתיקיית הסוכן/ת של הנכס: `{agent_id}/…`.
 * כך עולות תמונות מהטופס ומ-WhatsApp. לוגו, כתבה, או קובץ של סוכן/ת אחר לא.
 */
export function deletableStoragePath(path: string, ownerAgentId: string): boolean {
  const id = String(ownerAgentId || "");
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) return false;
  const p = String(path || "");
  const prefix = `${id}/`;
  if (!p.startsWith(prefix)) return false;
  const rest = p.slice(prefix.length);
  if (!rest || rest.split("/").some((part) => !part || part === "." || part === "..")) return false;
  return true;
}

/** הכתובת השמורה, בלי ?v= ובלי אחוזים, וגם הצורות השכנות. */
export function imageUrlProbes(url: string): string[] {
  const raw = String(url || "").trim();
  if (!raw) return [];
  const out = new Set<string>();
  const add = (s: string) => {
    const t = String(s || "").trim();
    if (t) out.add(t);
  };
  add(raw);
  const noHash = raw.split("#")[0];
  add(noHash);
  const noQuery = noHash.split("?")[0];
  add(noQuery);
  try { add(decodeURI(noQuery)); } catch { /* כתובת שבורה נשארת כמו שהיא */ }
  try { add(decodeURIComponent(noQuery)); } catch { /* same */ }
  try {
    const u = new URL(noQuery);
    const parts = u.pathname.split("/").map((seg, i) => {
      if (!i) return seg;
      try { return encodeURIComponent(decodeURIComponent(seg)); } catch { return seg; }
    });
    add(`${u.origin}${parts.join("/")}`);
  } catch { /* לא URL מלא */ }
  return [...out];
}

type Client = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  storage: { from: (bucket: string) => {
    copy: (from: string, to: string) => PromiseLike<{ error: { message?: string } | null }>;
    remove: (paths: string[]) => PromiseLike<{ error: { message?: string } | null }>;
  } };
};

export async function relocatePropertyPhotos(
  supabase: Client,
  opts: {
    actorId: string;
    fromId: string;
    toId: string;
    positions: number[];
    mode: "move" | "copy";
    place?: "end" | "cover";
    hash: string | null;
    baseUrl: string;
    sameAgent?: boolean;
  },
): Promise<{ ok: true; id: string; moved: number; text: string } | { ok: false; error: string }> {
  const fromQ = await supabase.from("properties").select("id, title, images, agent_id, agency_id, status, listing_number").eq("id", opts.fromId).maybeSingle();
  const toQ = await supabase.from("properties").select("id, title, images, agent_id, agency_id, status, listing_number").eq("id", opts.toId).maybeSingle();
  const from = fromQ.data;
  const to = toQ.data;
  if (!from || !to) return { ok: false, error: "לא נמצא נכס כזה." };
  if (opts.sameAgent && (from.agent_id !== opts.actorId || to.agent_id !== opts.actorId)) {
    return { ok: false, error: "אפשר להעביר רק בין נכסים שלך." };
  }
  const source: string[] = Array.isArray(from.images) ? from.images : [];
  const target: string[] = Array.isArray(to.images) ? to.images : [];
  const picked = urlsAt(source, opts.positions);
  if (!picked) return { ok: false, error: "מספר התמונה לא קיים." };
  if (opts.hash && photoUrlsHash(picked) !== opts.hash.toLowerCase()) {
    return { ok: false, error: "התמונות השתנו בינתיים ולא העברתי." };
  }
  const place = opts.place === "cover" ? "cover" : "end";
  const planned = planPhotoTransfer(source, target, opts.positions, opts.mode, place);
  if (!planned.ok) return { ok: false, error: planned.error };

  const copyPaths: string[] = [];
  const sourcePaths: string[] = [];
  const replacement = new Map<string, string>();
  for (const url of planned.added) {
    const fromPath = storagePath(url);
    if (!fromPath) return { ok: false, error: "לא הצלחתי לקרוא את קובץ התמונה." };
    const ext = fromPath.split(".").pop() || "jpg";
    const toPath = `${to.agent_id}/${opts.toId}/${crypto.randomUUID()}.${ext}`;
    const copied = await supabase.storage.from(BUCKET).copy(fromPath, toPath);
    if (copied.error) return { ok: false, error: "העתקת הקובץ נכשלה. לא שיניתי את הנכסים." };
    copyPaths.push(toPath);
    // קובץ שלא בתיקיית סוכן/ת המקור מועתק, ולא נרשם למחיקה.
    sourcePaths.push(deletableStoragePath(fromPath, String(from.agent_id || "")) ? fromPath : "");
    replacement.set(url, publicImageUrl(opts.baseUrl, toPath));
  }
  const nextTarget = planned.target.map((u) => replacement.get(u) || u);
  const { data: id, error } = await supabase.rpc("relocate_property_images", {
    p_from: opts.fromId,
    p_to: opts.toId,
    p_from_expected: source,
    p_to_expected: target,
    p_from_next: planned.source,
    p_to_next: nextTarget,
    p_mode: opts.mode,
    p_place: place,
    p_source_paths: opts.mode === "move" ? sourcePaths : [],
    p_source_urls: opts.mode === "move" ? planned.added : [],
    p_copy_paths: copyPaths,
    p_actor: opts.actorId,
  });
  if (error || !id) {
    const fresh = await pathsSafeToDelete(
      supabase,
      copyPaths.map((path) => ({ path, url: publicImageUrl(opts.baseUrl, path) })),
      String(to.agent_id || ""),
      opts.baseUrl,
    );
    if (fresh.length) await supabase.storage.from(BUCKET).remove(fresh);
    const message = error?.message || "";
    if (/images_changed/.test(message)) return { ok: false, error: "התמונות השתנו בינתיים ולא העברתי." };
    if (/not_same_office|not_owner/.test(message)) return { ok: false, error: "אפשר להעביר רק בין נכסים של אותו משרד." };
    return { ok: false, error: "ההעברה נכשלה. הקבצים לא נמחקו." };
  }
  await cleanupRelocations(supabase);
  const verb = opts.mode === "copy" ? "הועתקו" : "הועברו";
  const n = planned.added.length;
  return {
    ok: true,
    id: String(id),
    moved: n,
    text: `${n} תמונות ${verb} ל"${to.title || "הנכס"}".`,
  };
}

export async function undoRelocation(
  supabase: Client,
  id: string,
  actorId: string,
  baseUrl = "",
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("relocate_property_images_undo", {
    p_id: id, p_actor: actorId,
  });
  if (error) {
    if (/images_changed/.test(error.message || "")) return { ok: false, error: "לא ביטלתי, הנכס השתנה מאז." };
    if (/undo_closed/.test(error.message || "")) return { ok: false, error: "חלון הביטול נסגר." };
    return { ok: false, error: "לא הצלחתי לבטל." };
  }
  const { data: row, error: rowErr } = await supabase.from("property_image_relocations")
    .select("copy_paths, copy_agent_id")
    .eq("id", id)
    .maybeSingle();
  const paths = Array.isArray(data) ? data as string[] : [];
  const owner = !rowErr && row ? String(row.copy_agent_id || "") : "";
  const drop = await pathsSafeToDelete(
    supabase,
    paths.map((path) => ({ path })),
    owner,
    baseUrl,
  );
  if (drop.length) await supabase.storage.from(BUCKET).remove(drop);
  return { ok: true, text: "ההעברה בוטלה." };
}

export async function imageUrlStillUsed(
  supabase: Client,
  url: string,
  exceptId?: string | null,
): Promise<boolean> {
  const urls = imageUrlProbes(url);
  if (!urls.length) return true;
  const { data, error } = await supabase.rpc("property_image_still_used", {
    p_urls: urls,
    p_except: exceptId || null,
  });
  if (error) return true;
  return data === true;
}

async function pathsSafeToDelete(
  supabase: Client,
  items: Array<{ path: string; url?: string }>,
  ownerAgentId: string,
  baseUrl: string,
): Promise<string[]> {
  if (!ownerAgentId) return [];
  const drop: string[] = [];
  for (const item of items) {
    if (!deletableStoragePath(item.path, ownerAgentId)) continue;
    const stored = item.url || (baseUrl ? publicImageUrl(baseUrl, item.path) : "");
    if (!stored || await imageUrlStillUsed(supabase, stored)) continue;
    drop.push(item.path);
  }
  return drop;
}

async function cleanupRelocations(supabase: Client): Promise<void> {
  const { data } = await supabase.from("property_image_relocations")
    .select("id, source_paths, source_urls, source_agent_id, cleanup_attempts")
    .lt("cleanup_attempts", 5)
    .eq("mode", "move")
    .is("undone_at", null)
    .is("cleaned_at", null)
    .lt("delete_after", new Date().toISOString())
    .limit(20);
  const rows = (data || []) as {
    id: string; source_paths: string[]; source_urls: string[];
    source_agent_id: string | null; cleanup_attempts: number | null;
  }[];
  for (const row of rows) {
    const owned: Array<{ path: string; url: string }> = [];
    for (let i = 0; i < (row.source_urls || []).length; i++) {
      const url = row.source_urls[i];
      const path = row.source_paths?.[i];
      if (!url || !path || storagePath(url) !== path) continue;
      owned.push({ path, url });
    }
    const drop = await pathsSafeToDelete(supabase, owned, String(row.source_agent_id || ""), "");
    let failed = false;
    if (drop.length) {
      const removed = await supabase.storage.from(BUCKET).remove(drop);
      failed = !!removed?.error;
    }
    if (failed) {
      const next = Math.min(5, Number(row.cleanup_attempts || 0) + 1);
      await supabase.from("property_image_relocations").update({ cleanup_attempts: next }).eq("id", row.id);
      continue;
    }
    await supabase.from("property_image_relocations")
      .update({ cleaned_at: new Date().toISOString() }).eq("id", row.id);
  }
}
