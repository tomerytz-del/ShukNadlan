// העתקה או העברה של תמונות. הקובץ משוכפל. המקור נמחק רק אחרי חלון הביטול,
// ורק אם אף נכס לא מצביע עליו. לא משנים סטטוס ולא מפרסמים.
import { planPhotoTransfer, storageDeleteAllowed, urlsAt, photoUrlsHash } from "../whatsapp-webhook/photo-target.ts";

const BUCKET = "property-images";

export function storagePath(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = String(url).indexOf(marker);
  return i === -1 ? null : decodeURIComponent(String(url).slice(i + marker.length).split("?")[0]);
}

export function publicImageUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
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
    sourcePaths.push(fromPath);
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
    await supabase.storage.from(BUCKET).remove(copyPaths);
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
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("relocate_property_images_undo", {
    p_id: id, p_actor: actorId,
  });
  if (error) {
    if (/images_changed/.test(error.message || "")) return { ok: false, error: "לא ביטלתי, הנכס השתנה מאז." };
    if (/undo_closed/.test(error.message || "")) return { ok: false, error: "חלון הביטול נסגר." };
    return { ok: false, error: "לא הצלחתי לבטל." };
  }
  const paths = Array.isArray(data) ? data as string[] : [];
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  return { ok: true, text: "ההעברה בוטלה." };
}

async function cleanupRelocations(supabase: Client): Promise<void> {
  const { data } = await supabase.from("property_image_relocations")
    .select("id, source_paths, source_urls")
    .eq("mode", "move")
    .is("undone_at", null)
    .is("cleaned_at", null)
    .lt("delete_after", new Date().toISOString())
    .limit(20);
  const rows = (data || []) as { id: string; source_paths: string[]; source_urls: string[] }[];
  if (!rows.length) return;
  const { data: props } = await supabase.from("properties").select("images").limit(1000);
  const galleries = ((props || []) as { images: string[] | null }[]).map((p) => p.images || []);
  for (const row of rows) {
    const drop: string[] = [];
    (row.source_urls || []).forEach((url, i) => {
      if (storageDeleteAllowed(url, galleries)) {
        const path = row.source_paths?.[i];
        if (path) drop.push(path);
      }
    });
    if (drop.length) await supabase.storage.from(BUCKET).remove(drop);
    await supabase.from("property_image_relocations").update({ cleaned_at: new Date().toISOString() }).eq("id", row.id);
  }
}
