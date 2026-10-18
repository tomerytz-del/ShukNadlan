/* ============================================================================
   ‏הבדיקה של השווקים המקומיים: לאן מפנים, מה מזריקים, ומה בשום אופן לא
   ----------------------------------------------------------------------------
   שלושה חלקים, וכל אחד מהם שקט כשהוא נשבר:

     ‏1. ‏ShukMarkets.locate - נקודה → שוק. שוק שגוי הוא דף של עיר אחרת.
     ‏2. ‏decide() - ההפניה מ-‎/‎. הפניה לשוק שעוד לא נפתח, הפניה של סורק או
        הפניה שדורסת בחירה מפורשת - כולן נראות תקינות למי שבודק מהבית.
     ‏3. ‏inject() - שוק שעוד לא נפתח חייב noindex ואסור לו canonical; שוק
        חי חייב canonical עצמי ואחת בלבד.

   הרצה:

       node --experimental-strip-types scripts/markets_test.ts

   התיעוד: ‎docs/regional-pages.md‎.
   ========================================================================== */

import { decide, registry } from "../netlify/edge-functions/lib/markets.ts";
import { inject } from "../netlify/edge-functions/market-pages.ts";
import searchPages from "../netlify/edge-functions/search-pages.ts";

const reg = registry()!;

/* ‏הבדיקה בודקת התנהגות ולא את המצב היום: הקריות מתחילות סגורות כאן
   בזיכרון, ונדלקות במקרים שצריכים אותן - כדי שהבדיקה לא תיכשל ביום שהן
   באמת נדלקות ב-assets/markets.js. (עד 27.9.2026 זה היה "חיפה והקריות".) */
const krayotLiveInFile = reg.bySlug("krayot")!.live;
reg.bySlug("krayot")!.live = false;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`✓ ${name}`);
  else { failed++; console.log(`✗ ${name}${detail ? "\n    " + detail : ""}`); }
}

/* ---------- 1. נקודה → שוק ---------- */

const AFULA = [32.6078, 35.2897];
const KIRYAT_BIALIK = [32.8275, 35.0857];
const NESHER = [32.766, 35.044];
const TEL_AVIV = [32.0853, 34.7818];
const JAFFA = [32.05, 34.755];
const RAMAT_AVIV = [32.113, 34.80];
const RAMAT_HAHAYAL = [32.11, 34.84];
const HATIKVA = [32.052, 34.79];
const EILAT = [29.557, 34.952];
// מחוץ לכל שוק, ורחוק יותר מ-NEAR_KM מכל מרכז - הר חריף שבמערב הנגב (אילת וקריית שמונה,
// שהחזיקו את התפקיד הזה קודם, קיבלו שווקים ב-18.10.2026)
const HAR_HARIF = [30.2, 34.45];
const KIRYAT_SHMONA = [33.207, 35.571];
const HOLON = [32.016, 34.78];
const BAT_YAM = [32.017, 34.75];
const AZOR = [32.024, 34.805];
const RISHON = [31.964, 34.80];
const RISHON_WEST = [31.98, 34.74];
const REHOVOT = [31.894, 34.81];
const NESS_ZIONA = [31.93, 34.80];
const YAVNE = [31.877, 34.74];
const GEDERA = [31.81, 34.778];
const GAN_YAVNE = [31.787, 34.706];
const MODIIN = [31.898, 35.008];
const SHOHAM = [31.998, 34.946];
const BEN_SHEMEN = [31.952, 34.925];
const LOD = [31.951, 34.895];
const RAMLA = [31.928, 34.872];
const BEER_YAAKOV = [31.94, 34.84];
const KFAR_CHABAD = [31.99, 34.853];
const BEIT_DAGAN = [31.999, 34.829];
const ASHDOD = [31.80, 34.65];
const KIRYAT_MALACHI = [31.73, 34.745];
const NITZAN = [31.74, 34.635];
const ASHKELON = [31.668, 34.571];
const KIRYAT_GAT = [31.61, 34.77];
const SDEROT = [31.525, 34.596];
const NETIVOT = [31.42, 34.59];
const OFAKIM = [31.315, 34.62];
const BEER_SHEVA = [31.252, 34.791];
const JERUSALEM = [31.778, 35.205];
const BEIT_SHEMESH = [31.747, 34.988];
const RAMAT_GAN = [32.068, 34.824];
const GIVATAYIM = [32.071, 34.81];
const RG_BURSA = [32.083, 34.803];
const KIRYAT_ONO = [32.063, 34.856];
const OR_YEHUDA = [32.03, 34.855];
const YEHUD = [32.033, 34.89];
const BNEI_BRAK = [32.087, 34.835];
const ELAD = [32.052, 34.952];
const PETAH_TIKVA = [32.087, 34.887];
const ROSH_HAAYIN = [32.095, 34.957];
const GIVAT_SHMUEL = [32.078, 34.852];
const KFAR_SIRKIN = [32.08, 34.925];
const BEEROT_YITZHAK = [32.045, 34.905];
/* מרכזי יישוב בקירוב (מעלות-דקות) - מספיק למבחן תיבה, לא לפין */
const KIRYAT_TIVON = [32.717, 35.133];
const REKHASIM = [32.75, 35.1];
const AKKO = [32.927, 35.083];
const NAHARIYA = [33.006, 35.095];
const SHLOMI = [33.075, 35.145];
const MAALOT = [33.016, 35.27]; // ברצועה הצפונית של עכו, מעל כרמיאל
const KFAR_VRADIM = [32.995, 35.27];
const KARMIEL = [32.919, 35.296];
const YODFAT = [32.838, 35.272];
const NAZARETH = [32.70, 35.30];
const NOF_HAGALIL = [32.71, 35.33];
const MIGDAL_HAEMEK = [32.68, 35.24];
const TEL_ADASHIM = [32.656, 35.303]; // מפיני העסקאות - הגבול הדרומי של נצרת
const KFAR_TAVOR = [32.69, 35.42];
const ATLIT = [32.688, 34.94];
const EIN_AYALA = [32.633, 34.95]; // הדרומי שבחלק של חוף הכרמל שבשוק
const ZICHRON = [32.57, 34.955];
const HADERA = [32.437, 34.918];
const HARISH = [32.46, 35.045];
const PARDES_HANNA = [32.473, 34.97];
const OR_AKIVA = [32.508, 34.918];
const CAESAREA = [32.50, 34.90];
const NETANYA = [32.32, 34.855];
const KFAR_YONA = [32.316, 34.935];
const TEL_MOND = [32.255, 34.917];
const KFAR_SABA_PT = [32.178, 34.907];
const RAANANA = [32.184, 34.871];
const HOD_HASHARON = [32.15, 34.89];
const KOCHAV_YAIR = [32.224, 34.995];
const HERZLIYA = [32.166, 34.843];
const HERZLIYA_PITUACH = [32.175, 34.805];
const RAMAT_HASHARON = [32.146, 34.84];
const KFAR_SHMARYAHU = [32.183, 34.82];
const SHEFAYIM = [32.218, 34.822];
const TZUR_YITZHAK = [32.239, 34.99];
const HAIFA = [32.805, 35.0];
const KIRYAT_HAIM = [32.832, 35.058]; // שכונה של חיפה, צמודה לקריית ים
const KIRYAT_ATA = [32.805, 35.105];
const RAMAT_YISHAI = [32.705, 35.167]; // הגבול: 3 ק"מ מזרחית לטבעון, בעמק

check("עפולה → afula-emek", reg.locate(AFULA[0], AFULA[1])?.slug === "afula-emek");
check("קריית ביאליק → krayot", reg.locate(KIRYAT_BIALIK[0], KIRYAT_BIALIK[1])?.slug === "krayot");
check("נשר → haifa", reg.locate(NESHER[0], NESHER[1])?.slug === "haifa");
check("קריית טבעון → haifa", reg.locate(KIRYAT_TIVON[0], KIRYAT_TIVON[1])?.slug === "haifa");
check("רכסים → haifa", reg.locate(REKHASIM[0], REKHASIM[1])?.slug === "haifa");
check("רמת ישי (מעבר לגבול עם טבעון) → afula-emek", reg.locate(RAMAT_YISHAI[0], RAMAT_YISHAI[1])?.slug === "afula-emek");
check("עכו → akko-nahariya", reg.locate(AKKO[0], AKKO[1])?.slug === "akko-nahariya");
check("נהריה → akko-nahariya", reg.locate(NAHARIYA[0], NAHARIYA[1])?.slug === "akko-nahariya");
check("שלומי → akko-nahariya", reg.locate(SHLOMI[0], SHLOMI[1])?.slug === "akko-nahariya");
check("מעלות-תרשיחא → akko-nahariya (לא כרמיאל, 11 ק\"מ דרומה)", reg.locate(MAALOT[0], MAALOT[1])?.slug === "akko-nahariya");
check("כפר ורדים → akko-nahariya", reg.locate(KFAR_VRADIM[0], KFAR_VRADIM[1])?.slug === "akko-nahariya");
check("כרמיאל → karmiel-misgav", reg.locate(KARMIEL[0], KARMIEL[1])?.slug === "karmiel-misgav");
check("יודפת (משגב) → karmiel-misgav", reg.locate(YODFAT[0], YODFAT[1])?.slug === "karmiel-misgav");
check("הגבול: 32.975 → כרמיאל, 32.98 → עכו (הרצועה של מעלות)",
  reg.locate(32.975, 35.27)?.slug === "karmiel-misgav" && reg.locate(32.98, 35.27)?.slug === "akko-nahariya");

/* תיבות locate של שני שווקים לעולם אינן חופפות - אחרת סדר השורות מחליט */
{
  type Box = [number, number, number, number];
  const boxesOf = (m: { bbox: Box; boxes?: Box[] }) => m.boxes || [m.bbox];
  const hit = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  const list = reg.list as unknown as Array<{ slug: string; bbox: Box; boxes?: Box[] }>;
  const clashes: string[] = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      for (const a of boxesOf(list[i])) for (const b of boxesOf(list[j]))
        if (hit(a, b)) clashes.push(`${list[i].slug} ↔ ${list[j].slug}`);
  check("אין חפיפה בין תיבות locate של שווקים", clashes.length === 0, clashes.join(", "));
  /* והמסגרת מכילה את התיבות - הסריקה של ייבוא השכונות רצה עליה */
  const inside = (a: Box, f: Box) => a[0] >= f[0] && a[1] >= f[1] && a[2] <= f[2] && a[3] <= f[3];
  const outside = list.filter((m) => !boxesOf(m).every((b) => inside(b, m.bbox))).map((m) => m.slug);
  check("כל תיבת locate בתוך המסגרת של השוק", outside.length === 0, outside.join(", "));
}
check("הגבול: 32.89 (קצה הקריות) → krayot, 32.9 → akko-nahariya",
  reg.locate(32.89, 35.08)?.slug === "krayot" && reg.locate(32.9, 35.08)?.slug === "akko-nahariya");
check("נצרת (לא בשום שוק) → נוף הגליל ומגדל העמק כשוק הקרוב, עד שיהיה שוק לנצרת", reg.locate(NAZARETH[0], NAZARETH[1])?.slug === "nof-hagalil-migdal");
check("נוף הגליל → nof-hagalil-migdal", reg.locate(NOF_HAGALIL[0], NOF_HAGALIL[1])?.slug === "nof-hagalil-migdal");
check("מגדל העמק → nof-hagalil-migdal", reg.locate(MIGDAL_HAEMEK[0], MIGDAL_HAEMEK[1])?.slug === "nof-hagalil-migdal");
check("תל עדשים (צמודה מדרום) → afula-emek", reg.locate(TEL_ADASHIM[0], TEL_ADASHIM[1])?.slug === "afula-emek");
check("כפר תבור (ממזרח) → afula-emek", reg.locate(KFAR_TAVOR[0], KFAR_TAVOR[1])?.slug === "afula-emek");
check("רק שווקים חיים: נוף הגליל → עפולה והעמק כשוק הקרוב, עד שהשוק ייפתח",
  reg.locate(NOF_HAGALIL[0], NOF_HAGALIL[1], true)?.slug === "afula-emek");
check("עתלית → haifa", reg.locate(ATLIT[0], ATLIT[1])?.slug === "haifa");
check("עין איילה → haifa", reg.locate(EIN_AYALA[0], EIN_AYALA[1])?.slug === "haifa");
check("זכרון יעקב → hadera", reg.locate(ZICHRON[0], ZICHRON[1])?.slug === "hadera");
check("הגבול: 32.619 → חדרה (דור ונחשולים), 32.62 → חיפה",
  reg.locate(32.619, 34.93)?.slug === "hadera" && reg.locate(32.62, 34.93)?.slug === "haifa");
check("חדרה → hadera", reg.locate(HADERA[0], HADERA[1])?.slug === "hadera");
check("חריש → hadera", reg.locate(HARISH[0], HARISH[1])?.slug === "hadera");
check("פרדס חנה-כרכור → hadera", reg.locate(PARDES_HANNA[0], PARDES_HANNA[1])?.slug === "hadera");
check("אור עקיבא → hadera", reg.locate(OR_AKIVA[0], OR_AKIVA[1])?.slug === "hadera");
check("קיסריה → hadera", reg.locate(CAESAREA[0], CAESAREA[1])?.slug === "hadera");
check("נתניה → netanya", reg.locate(NETANYA[0], NETANYA[1])?.slug === "netanya");
check("כפר יונה → netanya", reg.locate(KFAR_YONA[0], KFAR_YONA[1])?.slug === "netanya");
check("תל מונד → netanya", reg.locate(TEL_MOND[0], TEL_MOND[1])?.slug === "netanya");
check("כפר סבא → kfar-saba-raanana", reg.locate(KFAR_SABA_PT[0], KFAR_SABA_PT[1])?.slug === "kfar-saba-raanana");
check("רעננה → kfar-saba-raanana", reg.locate(RAANANA[0], RAANANA[1])?.slug === "kfar-saba-raanana");
check("הוד השרון → kfar-saba-raanana", reg.locate(HOD_HASHARON[0], HOD_HASHARON[1])?.slug === "kfar-saba-raanana");
check("כוכב יאיר (מעל 32.22, מזרחית ל-34.975) → kfar-saba-raanana, לא נתניה", reg.locate(KOCHAV_YAIR[0], KOCHAV_YAIR[1])?.slug === "kfar-saba-raanana");
check("צור יצחק → kfar-saba-raanana", reg.locate(TZUR_YITZHAK[0], TZUR_YITZHAK[1])?.slug === "kfar-saba-raanana");
check("הגבול עם נתניה: 32.2199 → כפר סבא, 32.22 → נתניה (מערבית ל-34.975)",
  reg.locate(32.2199, 34.92)?.slug === "kfar-saba-raanana" && reg.locate(32.22, 34.92)?.slug === "netanya");
check("הגבול עם נתניה ממזרח: 32.2549 → כפר סבא, 32.255 → נתניה (35.0)",
  reg.locate(32.2549, 35.0)?.slug === "kfar-saba-raanana" && reg.locate(32.255, 35.0)?.slug === "netanya");
check("הרצליה → herzliya", reg.locate(HERZLIYA[0], HERZLIYA[1])?.slug === "herzliya");
check("הרצליה פיתוח → herzliya", reg.locate(HERZLIYA_PITUACH[0], HERZLIYA_PITUACH[1])?.slug === "herzliya");
check("רמת השרון → herzliya", reg.locate(RAMAT_HASHARON[0], RAMAT_HASHARON[1])?.slug === "herzliya");
check("כפר שמריהו → herzliya", reg.locate(KFAR_SHMARYAHU[0], KFAR_SHMARYAHU[1])?.slug === "herzliya");
check("שפיים (חוף, מערבית לנתניה) → herzliya", reg.locate(SHEFAYIM[0], SHEFAYIM[1])?.slug === "herzliya");
check("הגבול עם רעננה: 34.8499 → הרצליה, 34.85 → כפר סבא (32.19)",
  reg.locate(32.19, 34.8499)?.slug === "herzliya" && reg.locate(32.19, 34.85)?.slug === "kfar-saba-raanana");
check("הגבול עם הוד השרון: 34.8649 → רמת השרון, 34.865 → כפר סבא (32.145)",
  reg.locate(32.145, 34.8649)?.slug === "herzliya" && reg.locate(32.145, 34.865)?.slug === "kfar-saba-raanana");
check("הגבול עם נתניה בחוף: 34.8299 → הרצליה, 34.83 → נתניה (32.24)",
  reg.locate(32.24, 34.8299)?.slug === "herzliya" && reg.locate(32.24, 34.83)?.slug === "netanya");
check("הגבול: 32.384 → נתניה, 32.385 → חדרה",
  reg.locate(32.384, 34.9)?.slug === "netanya" && reg.locate(32.385, 34.9)?.slug === "hadera");
check("חיפה → haifa", reg.locate(HAIFA[0], HAIFA[1])?.slug === "haifa");
check("קריית חיים (שכונה של חיפה) → haifa", reg.locate(KIRYAT_HAIM[0], KIRYAT_HAIM[1])?.slug === "haifa");
check("קריית אתא → krayot", reg.locate(KIRYAT_ATA[0], KIRYAT_ATA[1])?.slug === "krayot");
check("תל אביב → tel-aviv", reg.locate(TEL_AVIV[0], TEL_AVIV[1])?.slug === "tel-aviv");
check("יפו → tel-aviv", reg.locate(JAFFA[0], JAFFA[1])?.slug === "tel-aviv");
check("רמת אביב → tel-aviv", reg.locate(RAMAT_AVIV[0], RAMAT_AVIV[1])?.slug === "tel-aviv");
check("רמת החייל → tel-aviv", reg.locate(RAMAT_HAHAYAL[0], RAMAT_HAHAYAL[1])?.slug === "tel-aviv");
check("שכונת התקווה → tel-aviv", reg.locate(HATIKVA[0], HATIKVA[1])?.slug === "tel-aviv");
check("הגבול עם הרצליה: 32.1269 → תל אביב, 32.127 → הרצליה (34.80)",
  reg.locate(32.1269, 34.80)?.slug === "tel-aviv" && reg.locate(32.127, 34.80)?.slug === "herzliya");
check("גבעתיים (ממזרח, 34.815) אינה בתיבה של תל אביב", !reg.contains(reg.bySlug("tel-aviv")!, 32.072, 34.812));
check("רמת גן → ramat-gan", reg.locate(RAMAT_GAN[0], RAMAT_GAN[1])?.slug === "ramat-gan");
check("גבעתיים → ramat-gan", reg.locate(GIVATAYIM[0], GIVATAYIM[1])?.slug === "ramat-gan");
check("הבורסה ברמת גן (ממערב לבני ברק) → ramat-gan", reg.locate(RG_BURSA[0], RG_BURSA[1])?.slug === "ramat-gan");
check("קריית אונו → ramat-gan", reg.locate(KIRYAT_ONO[0], KIRYAT_ONO[1])?.slug === "ramat-gan");
check("אור יהודה → ramat-gan", reg.locate(OR_YEHUDA[0], OR_YEHUDA[1])?.slug === "ramat-gan");
check("יהוד → ramat-gan", reg.locate(YEHUD[0], YEHUD[1])?.slug === "ramat-gan");
check("הגבול עם תל אביב באיילון: 34.80 → תל אביב, 34.8001 → רמת גן (32.08)",
  reg.locate(32.08, 34.80)?.slug === "tel-aviv" && reg.locate(32.08, 34.8001)?.slug === "ramat-gan");
check("הגבול בדרום: 34.815 → תל אביב (התקווה), 34.8151 → רמת גן (32.05)",
  reg.locate(32.05, 34.815)?.slug === "tel-aviv" && reg.locate(32.05, 34.8151)?.slug === "ramat-gan");
check("בני ברק אינה בתיבה של רמת גן", !reg.contains(reg.bySlug("ramat-gan")!, BNEI_BRAK[0], BNEI_BRAK[1]));
check("בני ברק → bnei-brak-elad", reg.locate(BNEI_BRAK[0], BNEI_BRAK[1])?.slug === "bnei-brak-elad");
check("אלעד → bnei-brak-elad (שוק אחד, 20 ק\"מ מבני ברק)", reg.locate(ELAD[0], ELAD[1])?.slug === "bnei-brak-elad");
check("הגבול עם רמת גן: 34.8249 → רמת גן, 34.825 → בני ברק (32.085)",
  reg.locate(32.085, 34.8249)?.slug === "ramat-gan" && reg.locate(32.085, 34.825)?.slug === "bnei-brak-elad");
check("הגבול עם תל אביב: 32.0999 → בני ברק, 32.10 → תל אביב (34.835)",
  reg.locate(32.0999, 34.835)?.slug === "bnei-brak-elad" && reg.locate(32.10, 34.835)?.slug === "tel-aviv");
check("פתח תקווה (בין שתי התיבות) אינה בבני ברק ואלעד", !reg.contains(reg.bySlug("bnei-brak-elad")!, 32.09, 34.885));
check("ראש העין אינה בתיבה של אלעד", !reg.contains(reg.bySlug("bnei-brak-elad")!, 32.095, 34.957));
check("פתח תקווה → petah-tikva", reg.locate(PETAH_TIKVA[0], PETAH_TIKVA[1])?.slug === "petah-tikva");
check("ראש העין → petah-tikva", reg.locate(ROSH_HAAYIN[0], ROSH_HAAYIN[1])?.slug === "petah-tikva");
check("גבעת שמואל → petah-tikva", reg.locate(GIVAT_SHMUEL[0], GIVAT_SHMUEL[1])?.slug === "petah-tikva");
check("כפר סירקין → petah-tikva", reg.locate(KFAR_SIRKIN[0], KFAR_SIRKIN[1])?.slug === "petah-tikva");
check("בארות יצחק (ממערב לאלעד) → petah-tikva", reg.locate(BEEROT_YITZHAK[0], BEEROT_YITZHAK[1])?.slug === "petah-tikva");
check("אלעד נשארת בבני ברק ואלעד, באמצע פתח תקווה", reg.locate(ELAD[0], ELAD[1])?.slug === "bnei-brak-elad");
check("הגבול עם בני ברק: 34.8459 → בני ברק, 34.846 → פתח תקווה (32.085)",
  reg.locate(32.085, 34.8459)?.slug === "bnei-brak-elad" && reg.locate(32.085, 34.846)?.slug === "petah-tikva");
check("הגבול עם תל אביב: 34.85 → תל אביב, 34.8501 → פתח תקווה (32.105)",
  reg.locate(32.105, 34.85)?.slug === "tel-aviv" && reg.locate(32.105, 34.8501)?.slug === "petah-tikva");
check("הגבול עם כפר סבא: 32.1149 → פתח תקווה, 32.115 → כפר סבא (34.9)",
  reg.locate(32.1149, 34.9)?.slug === "petah-tikva" && reg.locate(32.115, 34.9)?.slug === "kfar-saba-raanana");
check("הגבול עם רמת גן: 34.90 → רמת גן, 34.9001 → פתח תקווה (32.065)",
  reg.locate(32.065, 34.90)?.slug === "ramat-gan" && reg.locate(32.065, 34.9001)?.slug === "petah-tikva");
check("גבעת שמואל אינה בתיבה של רמת גן", !reg.contains(reg.bySlug("ramat-gan")!, 32.078, 34.852));
check("בת ים (מדרום, 32.02) אינה בתיבה של תל אביב", !reg.contains(reg.bySlug("tel-aviv")!, 32.02, 34.75));
check("חולון → holon-bat-yam", reg.locate(HOLON[0], HOLON[1])?.slug === "holon-bat-yam");
check("בת ים → holon-bat-yam", reg.locate(BAT_YAM[0], BAT_YAM[1])?.slug === "holon-bat-yam");
check("אזור → holon-bat-yam", reg.locate(AZOR[0], AZOR[1])?.slug === "holon-bat-yam");
check("ראשון לציון → rishon", reg.locate(RISHON[0], RISHON[1])?.slug === "rishon");
check("מערב ראשון → rishon", reg.locate(RISHON_WEST[0], RISHON_WEST[1])?.slug === "rishon");
check("הגבול עם חולון: 31.9949 → ראשון, 31.995 → חולון ובת ים (34.78)",
  reg.locate(31.9949, 34.78)?.slug === "rishon" && reg.locate(31.995, 34.78)?.slug === "holon-bat-yam");
check("נס ציונה אינה בתיבה של ראשון", !reg.contains(reg.bySlug("rishon")!, 31.928, 34.80));
check("רחובות → rehovot", reg.locate(REHOVOT[0], REHOVOT[1])?.slug === "rehovot");
check("נס ציונה → rehovot", reg.locate(NESS_ZIONA[0], NESS_ZIONA[1])?.slug === "rehovot");
check("יבנה → rehovot", reg.locate(YAVNE[0], YAVNE[1])?.slug === "rehovot");
check("גדרה → rehovot", reg.locate(GEDERA[0], GEDERA[1])?.slug === "rehovot");
check("גן יבנה → rehovot", reg.locate(GAN_YAVNE[0], GAN_YAVNE[1])?.slug === "rehovot");
check("הגבול עם ראשון: 31.9449 → רחובות, 31.945 → ראשון (34.79)",
  reg.locate(31.9449, 34.79)?.slug === "rehovot" && reg.locate(31.945, 34.79)?.slug === "rishon");
check("באר יעקב אינה בתיבה של רחובות", !reg.contains(reg.bySlug("rehovot")!, 31.937, 34.838));
check("אשדוד אינה בתיבה של רחובות", !reg.contains(reg.bySlug("rehovot")!, 31.80, 34.65));
check("מודיעין → modiin", reg.locate(MODIIN[0], MODIIN[1])?.slug === "modiin");
check("שוהם → modiin", reg.locate(SHOHAM[0], SHOHAM[1])?.slug === "modiin");
check("בן שמן → modiin", reg.locate(BEN_SHEMEN[0], BEN_SHEMEN[1])?.slug === "modiin");
check("הגבול עם פתח תקווה: 32.0199 → מודיעין, 32.02 → פתח תקווה (34.95)",
  reg.locate(32.0199, 34.95)?.slug === "modiin" && reg.locate(32.02, 34.95)?.slug === "petah-tikva");
check("לוד אינה בתיבה של מודיעין", !reg.contains(reg.bySlug("modiin")!, 31.952, 34.895));
check("כפר שמואל (גזר, ליד רמלה) אינו בתיבה של מודיעין", !reg.contains(reg.bySlug("modiin")!, 31.88, 34.93));
check("לוד → lod-ramla", reg.locate(LOD[0], LOD[1])?.slug === "lod-ramla");
check("רמלה → lod-ramla", reg.locate(RAMLA[0], RAMLA[1])?.slug === "lod-ramla");
check("באר יעקב → lod-ramla", reg.locate(BEER_YAAKOV[0], BEER_YAAKOV[1])?.slug === "lod-ramla");
check("כפר חב\"ד → lod-ramla", reg.locate(KFAR_CHABAD[0], KFAR_CHABAD[1])?.slug === "lod-ramla");
check("בית דגן → lod-ramla (ולא חולון)", reg.locate(BEIT_DAGAN[0], BEIT_DAGAN[1])?.slug === "lod-ramla");
check("כפר שמואל (גזר) → lod-ramla", reg.locate(31.88, 34.93)?.slug === "lod-ramla");
check("הגבול עם חולון: 34.825 → חולון, 34.8251 → לוד ורמלה (32.0)",
  reg.locate(32.0, 34.825)?.slug === "holon-bat-yam" && reg.locate(32.0, 34.8251)?.slug === "lod-ramla");
check("הגבול עם מודיעין: 34.9149 → לוד, 34.915 → מודיעין (31.96)",
  reg.locate(31.96, 34.9149)?.slug === "lod-ramla" && reg.locate(31.96, 34.915)?.slug === "modiin");
check("אשדוד → ashdod", reg.locate(ASHDOD[0], ASHDOD[1])?.slug === "ashdod");
check("צפון אשדוד → ashdod", reg.locate(31.85, 34.66)?.slug === "ashdod");
check("קריית מלאכי → ashdod", reg.locate(KIRYAT_MALACHI[0], KIRYAT_MALACHI[1])?.slug === "ashdod");
check("ניצן → ashdod", reg.locate(NITZAN[0], NITZAN[1])?.slug === "ashdod");
check("הגבול עם רחובות: 34.6949 → אשדוד, 34.695 → רחובות (31.80)",
  reg.locate(31.80, 34.6949)?.slug === "ashdod" && reg.locate(31.80, 34.695)?.slug === "rehovot");
check("גן יבנה נשארת ברחובות", reg.locate(GAN_YAVNE[0], GAN_YAVNE[1])?.slug === "rehovot");
check("אשקלון אינה בתיבה של אשדוד", !reg.contains(reg.bySlug("ashdod")!, 31.668, 34.571));
check("אשקלון → ashkelon", reg.locate(ASHKELON[0], ASHKELON[1])?.slug === "ashkelon");
check("יד מרדכי → ashkelon", reg.locate(31.588, 34.556)?.slug === "ashkelon");
check("הגבול עם אשדוד: 31.6799 → אשקלון, 31.68 → אשדוד (34.62)",
  reg.locate(31.6799, 34.62)?.slug === "ashkelon" && reg.locate(31.68, 34.62)?.slug === "ashdod");
check("שדרות אינה בתיבה של אשקלון", !reg.contains(reg.bySlug("ashkelon")!, 31.525, 34.596));
check("קריית גת אינה בתיבה של אשקלון", !reg.contains(reg.bySlug("ashkelon")!, 31.61, 34.77));
check("קריית גת → kiryat-gat", reg.locate(KIRYAT_GAT[0], KIRYAT_GAT[1])?.slug === "kiryat-gat");
check("בית גוברין → kiryat-gat", reg.locate(31.61, 34.895)?.slug === "kiryat-gat");
check("הגבול עם אשקלון: 34.70 → אשקלון, 34.7001 → קריית גת (31.62)",
  reg.locate(31.62, 34.70)?.slug === "ashkelon" && reg.locate(31.62, 34.7001)?.slug === "kiryat-gat");
check("קריית מלאכי נשארת באשדוד", reg.locate(KIRYAT_MALACHI[0], KIRYAT_MALACHI[1])?.slug === "ashdod");
check("שדרות אינה בתיבה של קריית גת", !reg.contains(reg.bySlug("kiryat-gat")!, 31.525, 34.596));
check("שדרות → sderot-netivot", reg.locate(SDEROT[0], SDEROT[1])?.slug === "sderot-netivot");
check("נתיבות → sderot-netivot", reg.locate(NETIVOT[0], NETIVOT[1])?.slug === "sderot-netivot");
check("אופקים → sderot-netivot", reg.locate(OFAKIM[0], OFAKIM[1])?.slug === "sderot-netivot");
check("ברור חיל (31.547) → sderot-netivot, לא אשקלון", reg.locate(31.547, 34.645)?.slug === "sderot-netivot");
check("הגבול עם אשקלון: 31.57 → שדרות, 31.5701 → אשקלון (34.60)",
  reg.locate(31.57, 34.60)?.slug === "sderot-netivot" && reg.locate(31.5701, 34.60)?.slug === "ashkelon");
check("הגבול עם קריית גת: 34.70 → שדרות, 34.7001 → קריית גת (31.52)",
  reg.locate(31.52, 34.70)?.slug === "sderot-netivot" && reg.locate(31.52, 34.7001)?.slug === "kiryat-gat");
check("נתיב העשרה (31.57) נשארת באשקלון", reg.locate(31.5705, 34.53)?.slug === "ashkelon");
check("באר שבע אינה בתיבה של שדרות", !reg.contains(reg.bySlug("sderot-netivot")!, 31.252, 34.791));
check("הגבול עם ראשון: 34.84 → ראשון, 34.8401 → לוד (31.97)",
  reg.locate(31.97, 34.84)?.slug === "rishon" && reg.locate(31.97, 34.8401)?.slug === "lod-ramla");
check("הגבול עם יפו: 32.0299 → חולון ובת ים, 32.03 → תל אביב (34.76)",
  reg.locate(32.0299, 34.76)?.slug === "holon-bat-yam" && reg.locate(32.03, 34.76)?.slug === "tel-aviv");
check("הגבול עם אור יהודה: 32.0249 → חולון ובת ים, 32.025 → רמת גן (34.82)",
  reg.locate(32.0249, 34.82)?.slug === "holon-bat-yam" && reg.locate(32.025, 34.82)?.slug === "ramat-gan");
check("הר חריף → אין שוק (ולא הקרוב ביותר)", reg.locate(HAR_HARIF[0], HAR_HARIF[1]) === null);
check("קריית שמונה → kiryat-shmona", reg.locate(KIRYAT_SHMONA[0], KIRYAT_SHMONA[1])?.slug === "kiryat-shmona");
check("מטולה → kiryat-shmona", reg.locate(33.278, 35.578)?.slug === "kiryat-shmona");
check("יסוד המעלה → kiryat-shmona", reg.locate(33.06, 35.60)?.slug === "kiryat-shmona");
check("צפת → safed", reg.locate(32.965, 35.496)?.slug === "safed");
check("ראש פינה → safed", reg.locate(32.97, 35.54)?.slug === "safed");
check("חצור הגלילית → safed", reg.locate(32.98, 35.545)?.slug === "safed");
check("סאסא → safed", reg.locate(33.03, 35.39)?.slug === "safed");
check("קצרין → golan", reg.locate(32.99, 35.69)?.slug === "golan");
check("מרום גולן → golan", reg.locate(33.13, 35.78)?.slug === "golan");
check("רמות (חוף הכנרת) → golan", reg.locate(32.85, 35.66)?.slug === "golan");
check("הגבול עם קריית שמונה: 35.6999 → קריית שמונה, 35.70 → הגולן (33.24)",
  reg.locate(33.24, 35.6999)?.slug === "kiryat-shmona" && reg.locate(33.24, 35.70)?.slug === "golan");
check("הגבול עם קריית שמונה: 33.0599 → צפת, 33.06 → קריית שמונה (35.55)",
  reg.locate(33.0599, 35.55)?.slug === "safed" && reg.locate(33.06, 35.55)?.slug === "kiryat-shmona");
check("הגבול עם כרמיאל: 35.40 → כרמיאל, 35.4001 → צפת (32.95)",
  reg.locate(32.95, 35.40)?.slug === "karmiel-misgav" && reg.locate(32.95, 35.4001)?.slug === "safed");
check("אילת → eilat", reg.locate(EILAT[0], EILAT[1])?.slug === "eilat");
check("יטבתה (חבל אילות) → eilat", reg.locate(29.90, 35.06)?.slug === "eilat");
check("עין יהב (הערבה התיכונה) → eilat", reg.locate(30.66, 35.24)?.slug === "eilat");
check("הגבול עם דימונה: 35.0999 → דימונה, 35.10 → אילת (30.70)",
  reg.locate(30.70, 35.0999)?.slug === "dimona-arad" && reg.locate(30.70, 35.10)?.slug === "eilat");
check("הגבול עם דימונה: 30.90 → אילת, 30.9001 → דימונה (35.30)",
  reg.locate(30.90, 35.30)?.slug === "eilat" && reg.locate(30.9001, 35.30)?.slug === "dimona-arad");
check("באר שבע → beer-sheva", reg.locate(BEER_SHEVA[0], BEER_SHEVA[1])?.slug === "beer-sheva");
check("עומר → beer-sheva", reg.locate(31.265, 34.85)?.slug === "beer-sheva");
check("להבים → beer-sheva", reg.locate(31.372, 34.813)?.slug === "beer-sheva");
check("מיתר → beer-sheva", reg.locate(31.325, 34.937)?.slug === "beer-sheva");
check("הגבול עם שדרות: 34.70 → שדרות, 34.7001 → באר שבע (31.30)",
  reg.locate(31.30, 34.70)?.slug === "sderot-netivot" && reg.locate(31.30, 34.7001)?.slug === "beer-sheva");
check("הגבול עם קריית גת: 31.4999 → באר שבע, 31.50 → קריית גת (34.80)",
  reg.locate(31.4999, 34.80)?.slug === "beer-sheva" && reg.locate(31.50, 34.80)?.slug === "kiryat-gat");
check("דימונה אינה בתיבה של באר שבע (החלטה)", !reg.contains(reg.bySlug("beer-sheva")!, 31.069, 35.033));
check("ירושלים → jerusalem", reg.locate(JERUSALEM[0], JERUSALEM[1])?.slug === "jerusalem");
check("מבשרת ציון → jerusalem", reg.locate(31.80, 35.15)?.slug === "jerusalem");
check("צור הדסה → jerusalem", reg.locate(31.72, 35.10)?.slug === "jerusalem");
check("רמות (צפון העיר, 31.87) → jerusalem", reg.locate(31.87, 35.19)?.slug === "jerusalem");
check("מעלה אדומים (מזרח העיר, 35.33) → jerusalem", reg.locate(31.775, 35.33)?.slug === "jerusalem");
check("גבעת זאב → jerusalem", reg.locate(31.862, 35.17)?.slug === "jerusalem");
check("ביתר עילית (31.69) → jerusalem", reg.locate(31.69, 35.115)?.slug === "jerusalem");
check("הגבול עם מודיעין: 31.8599 → ירושלים, 31.86 → מודיעין (35.05)",
  reg.locate(31.8599, 35.05)?.slug === "jerusalem" && reg.locate(31.86, 35.05)?.slug === "modiin");
check("בית שמש אינה בתיבה של ירושלים (שוק נפרד)", !reg.contains(reg.bySlug("jerusalem")!, 31.75, 34.99));
check("בית שמש → beit-shemesh", reg.locate(BEIT_SHEMESH[0], BEIT_SHEMESH[1])?.slug === "beit-shemesh");
check("צרעה → beit-shemesh", reg.locate(31.776, 34.985)?.slug === "beit-shemesh");
check("נחשון → beit-shemesh", reg.locate(31.83, 34.965)?.slug === "beit-shemesh");
check("צפרירים (עמק האלה) → beit-shemesh", reg.locate(31.665, 34.96)?.slug === "beit-shemesh");
check("הגבול עם ירושלים: 35.0299 → בית שמש, 35.03 → ירושלים (31.75)",
  reg.locate(31.75, 35.0299)?.slug === "beit-shemesh" && reg.locate(31.75, 35.03)?.slug === "jerusalem");
check("הגבול עם קריית גת: 34.95 → קריית גת, 34.9501 → בית שמש (31.70)",
  reg.locate(31.70, 34.95)?.slug === "kiryat-gat" && reg.locate(31.70, 34.9501)?.slug === "beit-shemesh");
check("אריאל → samaria", reg.locate(32.105, 35.18)?.slug === "samaria");
check("קרני שומרון → samaria", reg.locate(32.17, 35.10)?.slug === "samaria");
check("קדומים → samaria", reg.locate(32.21, 35.16)?.slug === "samaria");
check("מחולה (צפון הבקעה) → samaria", reg.locate(32.36, 35.50)?.slug === "samaria");
check("הגבול עם כפר סבא: 35.03 → כפר סבא, 35.0301 → השומרון (32.18)",
  reg.locate(32.18, 35.03)?.slug === "kfar-saba-raanana" && reg.locate(32.18, 35.0301)?.slug === "samaria");
check("הגבול עם חדרה: 35.14 → חדרה, 35.1401 → השומרון (32.45)",
  reg.locate(32.45, 35.14)?.slug === "hadera" && reg.locate(32.45, 35.1401)?.slug === "samaria");
check("בית אל → binyamin", reg.locate(31.94, 35.22)?.slug === "binyamin");
check("שילה → binyamin", reg.locate(32.05, 35.29)?.slug === "binyamin");
check("בית אריה → binyamin", reg.locate(32.035, 35.05)?.slug === "binyamin");
check("מצפה יריחו (הבקעה) → binyamin", reg.locate(31.83, 35.40)?.slug === "binyamin");
check("הגבול עם ירושלים: 31.90 → ירושלים, 31.9001 → בנימין (35.20)",
  reg.locate(31.90, 35.20)?.slug === "jerusalem" && reg.locate(31.9001, 35.20)?.slug === "binyamin");
check("הגבול עם השומרון: 32.0799 → בנימין, 32.08 → השומרון (35.20)",
  reg.locate(32.0799, 35.20)?.slug === "binyamin" && reg.locate(32.08, 35.20)?.slug === "samaria");
check("אפרת → gush-etzion", reg.locate(31.655, 35.15)?.slug === "gush-etzion");
check("אלון שבות → gush-etzion", reg.locate(31.65, 35.13)?.slug === "gush-etzion");
check("קריית ארבע → gush-etzion", reg.locate(31.53, 35.12)?.slug === "gush-etzion");
check("כרמל (הר חברון) → gush-etzion", reg.locate(31.42, 35.13)?.slug === "gush-etzion");
check("הגבול עם ירושלים: 31.6799 → גוש עציון, 31.68 → ירושלים (35.15)",
  reg.locate(31.6799, 35.15)?.slug === "gush-etzion" && reg.locate(31.68, 35.15)?.slug === "jerusalem");
check("הגבול עם באר שבע: 35.05 → באר שבע, 35.0501 → גוש עציון (31.40)",
  reg.locate(31.40, 35.05)?.slug === "beer-sheva" && reg.locate(31.40, 35.0501)?.slug === "gush-etzion");
check("דימונה → dimona-arad", reg.locate(31.069, 35.033)?.slug === "dimona-arad");
check("ערד → dimona-arad", reg.locate(31.26, 35.21)?.slug === "dimona-arad");
check("ירוחם → dimona-arad", reg.locate(30.99, 34.93)?.slug === "dimona-arad");
check("מצפה רמון → dimona-arad", reg.locate(30.61, 34.80)?.slug === "dimona-arad");
check("עין גדי → dimona-arad", reg.locate(31.45, 35.38)?.slug === "dimona-arad");
check("הגבול עם באר שבע: 31.15 → באר שבע, ו-35.0501 → דימונה וערד (31.20)",
  reg.locate(31.20, 35.05)?.slug === "beer-sheva" && reg.locate(31.20, 35.0501)?.slug === "dimona-arad");
check("הגבול עם שדרות: 31.10 → שדרות, 31.0999 → דימונה וערד (34.50)",
  reg.locate(31.10, 34.50)?.slug === "sderot-netivot" && reg.locate(31.0999, 34.50)?.slug === "dimona-arad");
check("הגבול עם מודיעין: 31.8599 → בית שמש, 31.86 → מודיעין (35.00)",
  reg.locate(31.8599, 35.00)?.slug === "beit-shemesh" && reg.locate(31.86, 35.00)?.slug === "modiin");
check("רק שווקים חיים: קריית ביאליק → אין (הקריות עוד לא נפתחו)",
  reg.locate(KIRYAT_BIALIK[0], KIRYAT_BIALIK[1], true) === null);
check("קואורדינטה פסולה → אין", reg.locate(NaN, 35) === null);

/* ---------- 2. ההפניה מ-‎/‎ ---------- */

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const IL = (p: number[]) => ({ latitude: p[0], longitude: p[1], country: { code: "IL" } });

/* ‏הקריות אינן חיות עדיין - ולכן לבדוק את ההפניה עצמה צריך שוק חי שאינו
   ברירת המחדל. מדליקים אותו כאן בזיכרון בלבד, ומכבים בסוף. */
const krayot = reg.bySlug("krayot")!;

let d = decide(reg, { cookie: "", userAgent: UA, geo: IL(KIRYAT_BIALIK), search: "" });
check("שוק שאינו חי: IP מהקריות אינו מפנה", d.location === null);

d = decide(reg, { cookie: "shuk_market=krayot%7Cgps", userAgent: UA, geo: null, search: "" });
check("שוק שאינו חי: GPS שמור אינו מפנה", d.location === null);

/* ‏soon - פס "נפתחים בקרוב" בדף הבית, בלי הפניה (assets/market-soon-strip.js) */
const KFAR_SABA = [32.178, 34.907]; // 16 ק"מ ממרכז נתניה, מחוץ לתיבה שלה
d = decide(reg, { cookie: "", userAgent: UA, geo: IL(NETANYA), search: "" });
check("IP מנתניה: אין הפניה, soon=netanya", d.location === null && d.soon === "netanya" && d.geoCookie === null, JSON.stringify(d));
d = decide(reg, { cookie: "", userAgent: UA, geo: IL(HADERA), search: "" });
check("IP מחדרה: soon=hadera", d.location === null && d.soon === "hadera");
d = decide(reg, { cookie: "", userAgent: UA, geo: IL(KFAR_SABA), search: "" });
check("IP מכפר סבא: soon=kfar-saba-raanana (לא נתניה, 16 ק\"מ משם)", d.soon === "kfar-saba-raanana", JSON.stringify(d));
d = decide(reg, { cookie: "", userAgent: UA, geo: IL(TEL_AVIV), search: "" });
check("IP מתל אביב: soon=tel-aviv", d.location === null && d.soon === "tel-aviv", JSON.stringify(d));
d = decide(reg, { cookie: "", userAgent: UA, geo: IL(HAR_HARIF), search: "" });
check("IP מהר חריף: אין soon", d.soon === null);
d = decide(reg, { cookie: "", userAgent: UA, geo: IL(AFULA), search: "" });
check("IP מעפולה (שוק חי): אין soon", d.soon === null);
d = decide(reg, { cookie: "shuk_market=netanya%7Cgps", userAgent: UA, geo: null, search: "" });
check("GPS שמור בנתניה: soon=netanya, בלי הפניה", d.location === null && d.soon === "netanya");
d = decide(reg, { cookie: "shuk_market=afula-emek%7Cchoice", userAgent: UA, geo: IL(NETANYA), search: "" });
check("בחירה מפורשת בעפולה גוברת על IP מנתניה: אין soon", d.soon === null);
d = decide(reg, { cookie: "", userAgent: "Googlebot/2.1", geo: IL(NETANYA), search: "" });
check("סורק: אין soon", d.soon === null);

krayot.live = true;

d = decide(reg, { cookie: "", userAgent: UA, geo: IL(KIRYAT_BIALIK), search: "" });
check("IP מהקריות → ‎/krayot‎", d.location === "/krayot", JSON.stringify(d));
check("וגם עוגיית shuk_geo של השוק", (d.geoCookie || "").startsWith("krayot|"));

d = decide(reg, { cookie: "", userAgent: UA, geo: IL(KIRYAT_BIALIK), search: "?utm_source=fb" });
check("פרמטרי מעקב נוסעים עם ההפניה", d.location === "/krayot?utm_source=fb");

d = decide(reg, { cookie: "shuk_market=afula-emek%7Cchoice", userAgent: UA, geo: IL(KIRYAT_BIALIK), search: "" });
check("בחירה מפורשת בעפולה גוברת על IP מהקריות", d.location === null);

d = decide(reg, { cookie: "shuk_market=krayot%7Cgps", userAgent: UA, geo: IL(AFULA), search: "" });
check("GPS שמור בקריות גובר על IP מעפולה", d.location === "/krayot");

d = decide(reg, { cookie: "", userAgent: UA, geo: IL(AFULA), search: "" });
check("IP מעפולה → אין הפניה (ברירת המחדל), עם עוגייה", d.location === null && !!d.geoCookie);

d = decide(reg, { cookie: "", userAgent: UA, geo: IL(HAR_HARIF), search: "" });
check("IP מהר חריף → אין הפניה ואין עוגייה", d.location === null && d.geoCookie === null);

d = decide(reg, { cookie: "", userAgent: UA, geo: { ...IL(KIRYAT_BIALIK), country: { code: "US" } }, search: "" });
check("IP מחוץ לישראל → אין הפניה", d.location === null);

for (const bot of ["Googlebot/2.1", "WhatsApp/2.23", "facebookexternalhit/1.1"]) {
  d = decide(reg, { cookie: "shuk_market=krayot%7Cchoice", userAgent: bot, geo: IL(KIRYAT_BIALIK), search: "" });
  check(`סורק אינו מופנה (${bot})`, d.location === null);
}

d = decide(reg, { cookie: "shuk_market=%3Cscript%3E", userAgent: UA, geo: null, search: "" });
check("עוגייה פסולה → אין הפניה", d.location === null);

krayot.live = false;

/* ---------- 3. ההזרקה ---------- */

const PAGE = [
  "<!doctype html><html><head>",
  "<title>נפתחים בקרוב | שוק נדל״ן</title>",
  '<meta name="robots" content="noindex,follow">',
  '<link rel="canonical" href="https://shuknadlan.co.il/">',
  '<meta name="description" content="כללי">',
  '<script src="assets/markets.js"></script>',
  "</head><body></body></html>",
].join("\n");

let html = inject(PAGE, krayot);
check("שוק שאינו חי: noindex", /<meta name="robots" content="noindex,follow">/.test(html));
check("שוק שאינו חי: בלי canonical", !/rel="canonical"/.test(html));
check("הכותרת של השוק", html.includes("<title>שוק נדל״ן | הקריות והסביבה</title>"));
check("og:url של השוק", html.includes('property="og:url" content="https://shuknadlan.co.il/krayot"'));
check("תיאור אחד בלבד", (html.match(/name="description"/g) || []).length === 1);
check("SHUK_MARKET לפני markets.js",
  html.indexOf("window.SHUK_MARKET") > -1 && html.indexOf("window.SHUK_MARKET") < html.indexOf('src="assets/markets.js"'));

krayot.live = true;
html = inject(PAGE, krayot);
check("שוק חי: canonical עצמי, אחת בלבד",
  (html.match(/rel="canonical"/g) || []).length === 1 &&
  html.includes('<link rel="canonical" href="https://shuknadlan.co.il/krayot">'));
check("שוק חי: בלי noindex", !/noindex/.test(html));
krayot.live = false;

const evil = { ...krayot, label: "</script><script>alert(1)</script>" };
html = inject(PAGE, evil);
check("תווית עם ‎</script>‎ אינה סוגרת את התג", !html.includes("</script><script>alert(1)"));

/* ---------- 4. הפונקציה עצמה: ‎search-pages.ts‎ על ‎/‎ ---------- */

const HOME = "<!doctype html><html><head><title>בית</title></head><body></body></html>";
const ctx = (geo: unknown = null) => ({
  geo,
  next: async () => new Response(HOME, { headers: { "content-type": "text/html; charset=utf-8" } }),
}) as never;
const req = (path: string, cookie = "") =>
  new Request("https://shuknadlan.co.il" + path, { headers: { cookie, "user-agent": UA } });

krayot.live = true;
let r = await searchPages(req("/", "shuk_market=krayot%7Cchoice"), ctx());
check("‎/‎ עם בחירה בקריות → 302 ל-‎/krayot‎, בלי מטמון",
  r.status === 302 && r.headers.get("location") === "/krayot" &&
  (r.headers.get("cache-control") || "").includes("no-store"));

r = await searchPages(req("/?deal=sale&rooms=4", "shuk_market=krayot%7Cchoice"), ctx());
check("עמוד תוצאות אינו מופנה (הפרמטרים הם תוכן)", r.status === 200);

r = await searchPages(req("/", ""), ctx(IL(AFULA)));
check("‎/‎ מעפולה: 200, עם עוגיית shuk_geo", r.status === 200 && (r.headers.get("set-cookie") || "").startsWith("shuk_geo=afula-emek"));
krayot.live = false;

r = await searchPages(req("/", "shuk_market=krayot%7Cchoice"), ctx());
check("‎/‎ עם בחירה בשוק שאינו חי: 200, הדף כמו שהוא", r.status === 200 && (await r.text()) === HOME);

r = await searchPages(req("/", ""), ctx(IL(NETANYA)));
check("‎/‎ מנתניה: 200, עם עוגיית shuk_soon ובלי shuk_geo",
  r.status === 200 && (r.headers.get("set-cookie") || "").includes("shuk_soon=netanya") &&
  !(r.headers.get("set-cookie") || "").includes("shuk_geo="));

r = await searchPages(req("/", ""), ctx(IL(HAR_HARIF)));
check("‎/‎ מהר חריף: בלי עוגיות", r.status === 200 && !r.headers.get("set-cookie"));

reg.bySlug("krayot")!.live = krayotLiveInFile;

console.log(failed ? `\n✗ ${failed} מקרים נכשלו` : "\n✓ השווקים: זיהוי, הפניה והזרקה מתנהגים כמתוכנן.");
if (failed) (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
