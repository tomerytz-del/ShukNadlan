// ============================================================================
// מודיעין שווקים — רשם המתווכים ו-Google Places (docs/marketing-console.md)
//
// ‏**רשם המתווכים** (data.gov.il, ה-resource של broker-license-lookup):
// נשלפת עמודת העיר בלבד, ונשמרת ספירה לכל עיר. שם ומספר רישיון לא נקראים
// בכלל - לא רק "לא נשמרים". מתווך/ת הוא/היא אדם פרטי, וספירה עונה על השאלה
// "כמה מתווכים יש באזור" בלי לבנות מאגר מידע.
//
// ‏**Google Places (New), Text Search**:
//   - סריקה (intel_places_scan): FieldMask של places.id בלבד - ה-SKU הזול,
//     ו-place_id הוא השדה היחיד שתנאי השימוש מתירים לשמור לאורך זמן.
//   - תצוגה חיה (intel_places_live): שם, כתובת, דירוג, אתר - מוחזרים לדפדפן
//     ולא נשמרים. כל צפייה היא קריאה, וזה המחיר של לא לשמור.
//   - עד 3 עמודים של 20. עיר עם יותר מ-60 משרדים מסומנת capped.
//
// שגיאה של גוגל עולה כ-PlacesError עם הסטטוס שלה; REQUEST_DENIED / 403 הם
// כמעט תמיד מפתח שלא הופעל עליו "Places API (New)" או הגבלת API שגויה.
// ============================================================================

const CKAN = "https://data.gov.il/api/3/action/datastore_search";
// אותו resource של רשימת המתווכים המורשים (docs/broker-registry.md).
export const BROKER_RESOURCE = Deno.env.get("BROKER_REGISTRY_RESOURCE_ID") || "a0f56034-88db-4132-8803-854bcdb01ca1";
const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";

export class PlacesError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function ckan(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(`data.gov.il ${res.status}: ${JSON.stringify(body?.error ?? body).slice(0, 200)}`);
  }
  return body.result;
}

// עמודת העיר מזוהה לפי שם ולא מקובעת: המפרסם כבר שינה כתיב של עמודות
// (‏"רשיון" בלי יו"ד), ושם קבוע היה שובר את הספירה בשקט - אפס לכל עיר.
export async function registryCityCounts(): Promise<{ counts: Map<string, number>; total: number; field: string }> {
  const head = await ckan(`${CKAN}?resource_id=${encodeURIComponent(BROKER_RESOURCE)}&limit=1`);
  const field = (head.fields ?? []).map((f: any) => String(f.id)).find((id: string) => /עיר|ישוב|יישוב/.test(id));
  if (!field) throw new Error("לא נמצאה עמודת עיר ברשם המתווכים");
  const total = Number(head.total) || 0;
  const counts = new Map<string, number>();
  const PAGE = 10_000;
  for (let offset = 0; offset < total && offset < 200_000; offset += PAGE) {
    const r = await ckan(`${CKAN}?resource_id=${encodeURIComponent(BROKER_RESOURCE)}&limit=${PAGE}&offset=${offset}` +
      `&fields=${encodeURIComponent(field)}`);
    for (const rec of r.records ?? []) {
      const city = String(rec[field] ?? "").trim();
      if (!city) continue;
      counts.set(city, (counts.get(city) ?? 0) + 1);
    }
  }
  return { counts, total, field };
}

export type PlaceLite = {
  id: string;
  name: string | null;
  address: string | null;
  rating: number | null;
  reviews: number | null;
  website: string | null;
  maps_url: string | null;
  status: string | null;
};

const SCAN_MASK = "places.id,nextPageToken";
const LIVE_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.rating",
  "places.userRatingCount", "places.websiteUri", "places.googleMapsUri", "places.businessStatus", "nextPageToken",
].join(",");

export async function placesSearch(opts: {
  apiKey: string;
  city: string;
  lat?: number | null;
  lng?: number | null;
  live: boolean;
}): Promise<{ places: PlaceLite[]; capped: boolean }> {
  const out: PlaceLite[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 3; page++) {
    const body: Record<string, unknown> = {
      textQuery: `משרד תיווך נדל"ן ${opts.city}`,
      includedType: "real_estate_agency",
      strictTypeFiltering: true,
      languageCode: "he",
      regionCode: "IL",
      pageSize: 20,
    };
    // הטיה סביב מרכז העיר כשהוא ידוע. בלעדיה "קריית ים" מחזירה גם את חיפה.
    if (opts.lat != null && opts.lng != null) {
      body.locationBias = { circle: { center: { latitude: opts.lat, longitude: opts.lng }, radius: 7000 } };
    }
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": opts.apiKey,
        "X-Goog-FieldMask": opts.live ? LIVE_MASK : SCAN_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new PlacesError(res.status, data?.error?.status ?? "UNKNOWN", data?.error?.message ?? `HTTP ${res.status}`);
    }
    for (const p of data.places ?? []) {
      out.push({
        id: String(p.id),
        name: p.displayName?.text ?? null,
        address: p.formattedAddress ?? null,
        rating: typeof p.rating === "number" ? p.rating : null,
        reviews: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        website: p.websiteUri ?? null,
        maps_url: p.googleMapsUri ?? null,
        status: p.businessStatus ?? null,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) return { places: out, capped: false };
  }
  return { places: out, capped: true };
}

// התאמת שם משרד מגוגל לשם משרד בפלטפורמה. גסה בכוונה: מסירה את המילים
// שכל משרד נושא ("תיווך", "נדל"ן", "משרד") ומשווה הכלה. טעות כאן היא
// סימון "בפלטפורמה" שגוי בטבלה - לא נשמר ולא משפיע על דבר.
const NOISE = /(משרד|תיווך|נדל["״']?ן|נדלן|real\s*estate|realty|בע["״']?מ|ltd)/gi;
export function nameKey(s: string | null | undefined): string {
  return String(s ?? "").replace(NOISE, " ").replace(/["'״׳.,\-()]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
export function matchesPlatform(placeName: string | null, platformNames: string[]): boolean {
  const k = nameKey(placeName);
  if (k.length < 3) return false;
  return platformNames.some((n) => {
    const m = nameKey(n);
    return m.length >= 3 && (k.includes(m) || m.includes(k));
  });
}
