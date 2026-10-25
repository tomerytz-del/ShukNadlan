// המיתוג של דוח ה-CMA - אותו חוזה כמו loadCmaBrand ב-assets/crm.js, כדי
// ש-renderCmaReport (‏assets/cma-render.js) תציג בדף בדיוק מה שב-CRM.
//
// צבע שאינו hex תקין נופל לפלטת ברירת המחדל (‏BRAND_PALETTES[0] ב-crm.js),
// ותמונה רק ב-https - שדה במסד לא הופך ל-CSS או לכתובת שרירותית בדוח.
// ‏readableOn - אותו כלל WCAG כמו ב-crm.js ו-agency.html: לבן כשהוא עובר
// 4.5:1, אחרת הדיו, וכשאף אחד לא עובר - הגבוה. מי שמשנה אחד משנה את כולם.

const BASE = { primary: "#1c3a5e", primary_dark: "#122840", accent: "#c0912f" };
const ON_COLOR_INK = "#1b1f26";

export function normalizeHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  let v = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) v = "#" + v.slice(1).split("").map((c) => c + c).join("");
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export function readableOn(hex: string): string {
  const onWhite = contrast(hex, "#ffffff");
  const onInk = contrast(hex, ON_COLOR_INK);
  if (onWhite >= 4.5) return "#ffffff";
  if (onInk >= 4.5) return ON_COLOR_INK;
  return onWhite >= onInk ? "#ffffff" : ON_COLOR_INK;
}

const httpsOnly = (u: unknown) => (typeof u === "string" && /^https:\/\//i.test(u.trim())) ? u.trim() : null;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

type Row = Record<string, unknown> | null | undefined;

export function cmaBrand(agent: Row, agency: Row) {
  const c = (agency?.colors && typeof agency.colors === "object" ? agency.colors : {}) as Record<string, unknown>;
  const primary = normalizeHex(c.primary, BASE.primary);
  return {
    agencyName:  text(agency?.name, 120),
    logo:        httpsOnly(agency?.logo_url),
    primary,
    primaryDark: normalizeHex(c.primary_dark, BASE.primary_dark),
    accent:      normalizeHex(c.accent, BASE.accent),
    onPrimary:   readableOn(primary),
    agentName:   text(agent?.display_name, 120),
    agentPhoto:  httpsOnly(agent?.photo_url),
    phone:       text(agent?.phone, 30),
    email:       text(agent?.email, 160),
    license:     text(agent?.license_number, 30),
  };
}
