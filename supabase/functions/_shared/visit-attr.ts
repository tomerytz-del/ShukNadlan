// First-touch visit attribution copied onto a lead or signup row.
// The browser sends visit_attr (utm slugs only). This module keeps the
// five columns and drops everything else, so a crafted body cannot set
// agent_id, status, phone, or any other column through this object.
//
// A missing column (site deployed before the migration) must not fail
// the insert. The caller retries the same row without the columns.

const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;

const KEYS = [
  "attr_source",
  "attr_medium",
  "attr_campaign",
  "attr_content",
  "attr_code",
] as const;

export type VisitAttrKey = (typeof KEYS)[number];
export type VisitAttr = Partial<Record<VisitAttrKey, string>>;

export function visitAttrFrom(body: unknown): VisitAttr {
  const raw = body && typeof body === "object"
    ? (body as { visit_attr?: unknown }).visit_attr
    : null;
  if (!raw || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const out: VisitAttr = {};
  for (const key of KEYS) {
    const value = src[key];
    if (typeof value !== "string") continue;
    const slug = value.trim().toLowerCase();
    if (SLUG.test(slug)) out[key] = slug;
  }
  return out;
}

export function isMissingAttrColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;
  const message = String(error.message || "");
  return message.includes("attr_") &&
    (message.includes("column") || message.includes("schema cache"));
}

type WriteResult = { data: any; error: any };

/** Insert row plus validated visit_attr. On a missing column, insert row alone. */
export async function writeVisitInsert(
  run: (row: Record<string, unknown>) => PromiseLike<WriteResult>,
  row: object,
  body: unknown,
): Promise<WriteResult> {
  const attr = visitAttrFrom(body);
  const plain = row as Record<string, unknown>;
  const res = await run({ ...plain, ...attr });
  if (res.error && Object.keys(attr).length > 0 && isMissingAttrColumn(res.error)) {
    return await run(plain);
  }
  return res;
}

/** Stamp attribution after a row exists. A missing column is ignored. */
export async function stampVisitAttr(
  update: (attr: VisitAttr) => PromiseLike<{ error: any }>,
  body: unknown,
): Promise<void> {
  const attr = visitAttrFrom(body);
  if (Object.keys(attr).length === 0) return;
  const { error } = await update(attr);
  if (error && !isMissingAttrColumn(error)) {
    console.warn("visit attr stamp failed", error.code || error.message);
  }
}
