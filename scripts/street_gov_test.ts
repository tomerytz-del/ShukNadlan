/* ============================================================================
   הבדיקה של רחובות מ-data.gov.il (supabase/functions/street-registry-sync/gov.ts)

   המאגר עצמו אינו זמין מ-CI, ולכן השורות מדומות - בצורה של המאגר האמיתי:
   שמות שדות עם קו תחתון, שם יישוב בכתיב הלמ"ס עם רווח בסוף, ו"רחוב" בשם
   היישוב לכל מושב. מה שנבדק הוא מה שנכשל בשקט:

   - "קרית ביאליק " של המאגר מתאים ל"קריית ביאליק" שלנו, והמפתח הוא השם שלנו
   - "רחוב" בשם היישוב (גן נר / גן נר) אינו רחוב
   - יישוב שלא ביקשנו לא נכנס
   - הורדה חלקית זורקת, ומאגר קטן מדי זורק

       node --experimental-strip-types scripts/street_gov_test.ts
   ========================================================================== */
import { streetsByCity, fetchAllRows, detectFields, settlementKey } from "../supabase/functions/street-registry-sync/gov.ts";

let fail = 0;
const ok = (name: string, cond: boolean) => { console.log((cond ? "✓ " : "✗ ") + name); if (!cond) fail++; };

const rows = [
  { _id: 1, "סמל_ישוב": 9500, "שם_ישוב": "קרית ביאליק ", "סמל_רחוב": 101, "שם_רחוב": "ירושלים" },
  { _id: 2, "סמל_ישוב": 9500, "שם_ישוב": "קרית ביאליק ", "סמל_רחוב": 102, "שם_רחוב": "  דרך  עכו " },
  { _id: 3, "סמל_ישוב": 9500, "שם_ישוב": "קרית ביאליק ", "סמל_רחוב": 101, "שם_רחוב": "ירושלים" },
  { _id: 4, "סמל_ישוב": 823, "שם_ישוב": "גן נר", "סמל_רחוב": 9000, "שם_רחוב": "גן נר" },
  { _id: 5, "סמל_ישוב": 823, "שם_ישוב": "גן נר", "סמל_רחוב": 101, "שם_רחוב": "הדקל" },
  { _id: 6, "סמל_ישוב": 70, "שם_ישוב": "אשדוד", "סמל_רחוב": 101, "שם_רחוב": "הרצל" },
  { _id: 7, "סמל_ישוב": 1, "שם_ישוב": "מרחביה (מושב)", "סמל_רחוב": 9000, "שם_רחוב": "מרחביה (מושב)" },
];

const m = streetsByCity(rows, ["קריית ביאליק", "גן נר", "מרחביה (מושב)", "נורית"]);
ok('"קרית ביאליק " של המאגר → "קריית ביאליק" שלנו, בלי כפילות ועם רווחים מנוקים',
   JSON.stringify(m.get("קריית ביאליק")) === JSON.stringify(["דרך עכו", "ירושלים"]));
ok('"גן נר" כרחוב בגן נר אינו רחוב', JSON.stringify(m.get("גן נר")) === JSON.stringify(["הדקל"]));
ok("מושב שכל ה'רחובות' שלו הם שמו - רשימה ריקה", (m.get("מרחביה (מושב)") || []).length === 0);
ok("יישוב שלא במאגר - רשימה ריקה, לא חסר", m.has("נורית") && m.get("נורית")!.length === 0);
ok("אשדוד (לא ביקשנו) לא נכנס", ![...m.values()].flat().includes("הרצל"));
ok("מפתח היישוב: קרית/קריית ומקף", settlementKey("קריית-אתא") === settlementKey("קרית אתא "));

let threw = false;
try { detectFields({ foo: 1, bar: 2 }); } catch { threw = true; }
ok("שדות שהשתנו - זורק (פורמט חדש אינו 'אין רחובות')", threw);

// ---- ההורדה ----
function fakeFetch(total: number, perPage: number[]) {
  let call = 0;
  return (async () => {
    const n = perPage[call++] ?? 0;
    return { ok: true, json: async () => ({ success: true, result: { total, records: Array.from({ length: n }, () => rows[0]) } }) };
  }) as unknown as typeof fetch;
}
const far = Date.now() + 60_000;
const all = await fetchAllRows(fakeFetch(60_000, [32_000, 28_000]), "x", far);
ok("שני עמודים, כל 60 אלף השורות", all.length === 60_000);

let partial = "";
try { await fetchAllRows(fakeFetch(60_000, [32_000, 0]), "x", far); } catch (e) { partial = String(e); }
ok("הורדה חלקית (32 אלף מתוך 60) - זורקת", /partial/.test(partial));

let small = "";
try { await fetchAllRows(fakeFetch(900, [900]), "x", far); } catch (e) { small = String(e); }
ok("מאגר קטן מהצפוי - זורק", /below/.test(small));

console.log(fail ? `\n✗ ${fail} נכשלו` : "\n✓ רחובות מ-data.gov.il מתנהגים כמתוכנן");
process.exit(fail ? 1 : 0);
