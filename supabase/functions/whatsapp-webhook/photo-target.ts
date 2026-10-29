/** לאן לשייך תמונות, והעברה בין שני נכסים. בלי רשת, כדי שאפשר לבדוק. */

export interface PhotoCandidate {
  id: string;
  title: string;
  property_type?: string | null;
  street?: string | null;
  listing_number?: number | string | null;
  updated_at?: string | null;
}

export type PhotoDecision =
  | { kind: "attach"; id: string; reason: "only" | "text" | "continue" }
  | { kind: "ask"; ids: string[]; reason: "none" | "tie" | "ambiguous" };

const HINTS: Array<[RegExp, RegExp]> = [
  [/מגרש|קרקע/, /מגרש|קרקע|נחלה|משק/],
  [/חנות|חנויות/, /חנות/],
  [/משרד/, /משרד/],
  [/דירה|פנטהאוז|דירת|סטודיו|דופלקס/, /דירה|פנטהאוז|סטודיו|דופלקס|גן/],
  [/בית|וילה|קוטג/, /בית|וילה|קוטג/],
  [/מחסן/, /מחסן/],
];

export function scorePhotoText(text: string, c: PhotoCandidate): number {
  const t = text || "";
  let score = 0;
  const num = c.listing_number != null ? String(c.listing_number) : "";
  if (num && new RegExp(`(^|\\D)${num}(\\D|$)`).test(t)) score += 100;
  const street = (c.street || "").trim();
  if (street.length >= 3 && t.includes(street)) score += 40;
  const kind = c.property_type || "";
  for (const [inText, inType] of HINTS) {
    if (inText.test(t) && inType.test(kind)) score += 30;
  }
  return score;
}

export function choosePhotoTarget(opts: {
  lastId: string | null;
  candidates: PhotoCandidate[];
  recentText: string;
  lastUpdatedAt: string | null;
  now: number;
  idleMs: number;
  conversationIdle: boolean;
}): PhotoDecision {
  const list = opts.candidates;
  if (!list.length) return { kind: "ask", ids: [], reason: "none" };
  if (list.length === 1) return { kind: "attach", id: list[0].id, reason: "only" };

  const scored = list
    .map((c) => ({ c, s: scorePhotoText(opts.recentText, c) }))
    .sort((a, b) => b.s - a.s);
  const top = scored[0];
  const second = scored[1];
  if (top.s >= 30 && top.s > (second?.s || 0)) {
    return { kind: "attach", id: top.c.id, reason: "text" };
  }
  if (top.s >= 30 && second && top.s === second.s) {
    return {
      kind: "ask",
      ids: scored.filter((x) => x.s === top.s).map((x) => x.c.id).slice(0, 8),
      reason: "tie",
    };
  }

  const last = opts.lastId ? list.find((c) => c.id === opts.lastId) : undefined;
  const updated = Date.parse(String(opts.lastUpdatedAt || ""));
  const propertyIdle = !Number.isFinite(updated) || opts.now - updated > opts.idleMs;
  if (last && !opts.conversationIdle && !propertyIdle) {
    return { kind: "attach", id: last.id, reason: "continue" };
  }
  return { kind: "ask", ids: list.slice(0, 8).map((c) => c.id), reason: "ambiguous" };
}

const MOVE_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MOVE_RE = new RegExp(
  `^pmv:(m|c|n):(${MOVE_UUID}):(${MOVE_UUID})(?::([0-9.]+):([0-9a-f]{8}))?$`,
  "i",
);

export function photoUrlsHash(urls: readonly string[]): string {
  let h = 0x811c9dc5;
  const s = urls.join("\n");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function urlsAt(images: readonly string[], positions: readonly number[]): string[] | null {
  const out: string[] = [];
  for (const p of positions) {
    if (!Number.isInteger(p) || p < 1 || p > images.length) return null;
    out.push(images[p - 1]);
  }
  return out;
}

/** מוחקים קובץ רק אם אף נכס לא מצביע עליו. */
export function storageDeleteAllowed(url: string, galleries: readonly (readonly string[])[]): boolean {
  if (!url) return false;
  return !galleries.some((images) => images.includes(url));
}

export function planPhotoTransfer(
  source: readonly string[],
  target: readonly string[],
  positions: readonly number[],
  mode: "move" | "copy",
  place: "end" | "cover",
  maxImages = 8,
): { ok: true; source: string[]; added: string[]; target: string[]; room: number }
  | { ok: false; error: string; room?: number } {
  const planned = planPhotoMove([...source], [...target], [...positions]);
  if (!planned.ok) return planned;
  const room = maxImages - target.length;
  if (room <= 0) return { ok: false, error: "בנכס היעד אין מקום לתמונות נוספות.", room: 0 };
  const added = planned.moved.slice(0, room);
  const have = new Set(target);
  const fresh = added.filter((u) => !have.has(u));
  if (!fresh.length) return { ok: false, error: "התמונות כבר נמצאות בנכס היעד." };
  const nextTarget = place === "cover" ? fresh.concat(target) : target.concat(fresh);
  if (nextTarget.length > maxImages) {
    return { ok: false, error: `נשאר מקום ל-${room} תמונות.`, room };
  }
  const drop = new Set(mode === "move" ? fresh : []);
  const nextSource = mode === "move" ? source.filter((u) => !drop.has(u)) : [...source];
  return { ok: true, source: nextSource, added: fresh, target: nextTarget, room };
}

export function photoMoveButtons(
  fromId: string,
  toId: string,
  positions: readonly number[],
  urls: readonly string[],
): { id: string; title: string }[] | null {
  const pos = [...new Set(positions.map(Number))].filter((p) => Number.isInteger(p) && p >= 1).sort((a, b) => a - b);
  if (!pos.length || !fromId || !toId || fromId === toId) return null;
  const hash = photoUrlsHash(urls);
  const tail = `${pos.join(".")}:${hash}`;
  const move = `pmv:m:${fromId}:${toId}:${tail}`;
  const copy = `pmv:c:${fromId}:${toId}:${tail}`;
  const no = `pmv:n:${fromId}:${toId}`;
  if (move.length > 200 || copy.length > 200) return null;
  return [
    { id: move, title: "כן, להעביר" },
    { id: copy, title: "העתקה במקום" },
    { id: no, title: "ביטול" },
  ];
}

export function parsePhotoMoveButton(buttonId: string): {
  mode: "move" | "copy" | "no";
  fromId: string;
  toId: string;
  positions: number[];
  hash: string | null;
} | null {
  const m = MOVE_RE.exec(String(buttonId || "").trim());
  if (!m) return null;
  const positions = m[4] ? m[4].split(".").map(Number).filter((n) => Number.isInteger(n) && n >= 1) : [];
  const mode = m[1].toLowerCase() === "m" ? "move" : m[1].toLowerCase() === "c" ? "copy" : "no";
  if (mode !== "no" && !positions.length) return null;
  return { mode, fromId: m[2], toId: m[3], positions, hash: m[5] ? m[5].toLowerCase() : null };
}

export function planPhotoMove(
  source: string[],
  target: string[],
  positions: number[],
): { ok: true; source: string[]; target: string[]; moved: string[] } | { ok: false; error: string } {
  const n = source.length;
  const pos = [...new Set(positions.map(Number))].filter((p) => Number.isInteger(p));
  if (!pos.length) return { ok: false, error: "לא נבחרו תמונות." };
  if (pos.some((p) => p < 1 || p > n)) {
    return { ok: false, error: `יש בנכס ${n} תמונות. צריך מספר בין 1 ל-${n}.` };
  }
  pos.sort((a, b) => a - b);
  const moved = pos.map((p) => source[p - 1]);
  const drop = new Set(moved);
  const nextSource = source.filter((u) => !drop.has(u));
  const have = new Set(target);
  const nextTarget = target.concat(moved.filter((u) => !have.has(u)));
  return { ok: true, source: nextSource, target: nextTarget, moved };
}
