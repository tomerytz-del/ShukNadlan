/** שורות סיכום "נכס חדש שותף איתך". בלי טלפון, בלי שם מלא, בלי כתובת. */

export type ShareDigestLine = {
  sharer_first_name: string;
  property_type: string;
  price_label: string;
  property_id: string;
};

function nameOf(line: ShareDigestLine): string {
  const name = String(line.sharer_first_name || "").trim();
  return name || "משרד";
}

function typeOf(line: ShareDigestLine): string {
  const type = String(line.property_type || "").trim();
  return type || "נכס";
}

function priceOf(line: ShareDigestLine): string {
  const price = String(line.price_label || "").trim();
  return price || "מחיר לא צוין";
}

/** גוף אחד: שם פרטי, ומתחתיו סוג ומחיר לכל נכס. */
export function shareDigestBody(lines: ShareDigestLine[]): string {
  const groups = new Map<string, ShareDigestLine[]>();
  for (const line of lines) {
    const name = nameOf(line);
    const rows = groups.get(name) || [];
    rows.push(line);
    groups.set(name, rows);
  }
  return [...groups.entries()].map(([name, rows]) => {
    const props = rows.map((row) => `${typeOf(row)} · ${priceOf(row)}`).join("\n");
    return `${name}\n${props}`;
  }).join("\n\n");
}

/** פריט לכל נכס. הסוג אינו system, כדי ש-arrange לא יקפל אותם לשורה אחת. */
export function shareDigestItems(lines: ShareDigestLine[]) {
  return lines.filter((line) => line.property_id).map((line) => ({
    type: "share_digest",
    title: `${nameOf(line)} · ${typeOf(line)}`,
    body: priceOf(line),
    action_path: `/crm?goto=accSharedWithMe&property=${line.property_id}`,
    property_id: line.property_id,
    property_mine: false as const,
  }));
}
