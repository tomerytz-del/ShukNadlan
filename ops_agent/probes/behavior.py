"""מה שהמשתמשים עושים — ואיפה הם נושרים.

## למה אין כאן "שיעור יציאה מדף"

שיעור היציאה, זמן השהייה ומסלול הגלישה יושבים ב-GA4, ואין לנו גישת API
אליו. מה שכן יש הוא **המשפכים שנגמרים במסד**, והם עונים על אותה שאלה
בצורה ישירה יותר: לא "כמה אחוז יצאו מדף הנכס" אלא "כמה נכסים נצפו
עשרות פעמים ואיש לא פנה לגביהם". השני הוא מספר שאפשר לפעול לפיו.

הפער המדויק, ומה כן כדאי לפתוח ב-GA4: `docs/ops-agent.md`.
"""

from __future__ import annotations

import hashlib
import importlib.util

from typing import Iterator

from ..config import STAND_IN_PINS
from ..models import Finding


def run(ctx) -> Iterator[Finding]:
    yield from _views_without_leads(ctx)
    yield from _pwa_funnel(ctx)
    yield from _alert_failures(ctx)
    yield from _untouched_leads(ctx)
    yield from _listings_without_images(ctx)
    yield from _saved_search_silence(ctx)
    yield from _stand_in_pins(ctx)
    yield from _market_gate(ctx)
    yield from _market_data(ctx)


def _views_without_leads(ctx) -> Iterator[Finding]:
    """נכסים שנצפו הרבה ואיש לא פנה לגביהם.

    זו הצורה שבה "נשירה מדף" נראית במסד שלנו. הסיבה כמעט תמיד אחת
    משלוש: מחיר שלא מתאים לשוק, תמונות חלשות, או שהמודעה עלתה בלי
    תיאור. שלושתן ניתנות לתיקון בדקה, אם יודעים על מי.
    """
    t = ctx.settings.thresholds
    if not (ctx.db.has_table("property_views") and ctx.db.has_table("leads")):
        return
    ctx.count()
    rows = ctx.db.rows(
        """
        with v as (
          select property_id, count(*) as views,
                 count(distinct visitor_session_id) as visitors
            from public.property_views
           where viewed_at > now() - interval '30 days'
           group by property_id
        )
        select v.property_id, v.views, v.visitors,
               p.title, p.city, p.price, p.status,
               coalesce(array_length(p.images, 1), 0) as image_count,
               (p.marketing_description is null
                and p.description is null)           as no_text,
               (select count(*) from public.leads l
                 where l.property_id = v.property_id
                   and l.created_at > now() - interval '30 days') as leads
          from v
          join public.properties p on p.id = v.property_id
         where v.views >= %s
         order by v.views desc
         limit 40
        """,
        (t.zero_lead_min_views,),
    )
    dead = [r for r in rows if not int(r["leads"] or 0)]
    if not dead:
        return

    worst = dead[:8]
    total_views = sum(int(r["views"]) for r in dead)
    yield Finding(
        area="behavior", code="views_without_leads", severity="medium",
        subject="properties",
        title="%d נכסים נצפו ולא הניבו אף פנייה" % len(dead),
        detail="סך %d צפיות ב-30 הימים האחרונים, אפס לידים. המוביל: %s (%d צפיות)."
               % (total_views, (worst[0]["title"] or worst[0]["property_id"]),
                  int(worst[0]["views"])),
        suggestion="שלוש סיבות נפוצות, וכולן ניתנות לתיקון בדקה: מחיר שלא תואם "
                   "לשוק, פחות מ-5 תמונות, או מודעה בלי תיאור. הרשימה כוללת את "
                   "שתי האחרונות לכל נכס.",
        metric=float(len(dead)), metric_unit="נכסים",
        evidence={"properties": [
            {"id": str(r["property_id"]), "title": r["title"], "city": r["city"],
             "views": int(r["views"]), "visitors": int(r["visitors"] or 0),
             "images": int(r["image_count"] or 0), "no_text": bool(r["no_text"])}
            for r in worst]},
    )


def _pwa_funnel(ctx) -> Iterator[Finding]:
    """משפך ההתקנה. ‏banner שעולה ואיש לא לוחץ = רצועה שמפריעה בלי תמורה."""
    t = ctx.settings.thresholds
    if not ctx.db.has_table("pwa_install_events"):
        return
    ctx.count()
    row = ctx.db.one(
        """
        select count(*) filter (where event = 'banner_shown')  as shown,
               count(*) filter (where event = 'install_click') as clicked,
               count(*) filter (where event = 'banner_close')  as closed
          from public.pwa_install_events
         where occurred_at > now() - interval '30 days'
        """
    )
    shown = int((row or {}).get("shown") or 0)
    if shown < t.pwa_min_impressions:
        return
    clicked = int(row["clicked"] or 0)
    rate = clicked / shown
    if rate >= t.pwa_click_rate_floor:
        return
    yield Finding(
        area="behavior", code="pwa_banner_ignored", severity="low",
        subject="pwa_banner",
        title="רצועת ההתקנה כמעט ולא נלחצת — %.1f%%" % (rate * 100),
        detail="עלתה %d פעמים ב-30 ימים, %d לחיצות, %d סגירות."
               % (shown, clicked, int(row["closed"] or 0)),
        suggestion="רצועה שמוצגת ולא נלחצת היא הפרעה בלי תמורה. שתי אפשרויות: "
                   "להציג אותה מאוחר יותר במסע (אחרי צפייה שנייה בנכס), או לנסח "
                   "מחדש את ההבטחה שבה.",
        metric=round(rate * 100, 2), metric_unit="%",
        evidence={"shown": shown, "clicked": clicked},
    )


def _alert_failures(ctx) -> Iterator[Finding]:
    """התראות שנשלחו ונכשלו. ערוץ שבור שותק בדיוק כמו ערוץ ריק."""
    t = ctx.settings.thresholds
    if not ctx.db.has_table("saved_search_alerts"):
        return
    ctx.count()
    row = ctx.db.one(
        """
        select count(*)                                            as attempts,
               count(*) filter (where status = 'failed')           as failed,
               count(*) filter (where whatsapp_status = 'failed')  as wa_failed,
               count(*) filter (where email_status = 'failed')     as mail_failed,
               (array_agg(last_error order by created_at desc)
                 filter (where last_error is not null))[1]         as sample
          from public.saved_search_alerts
         where created_at > now() - interval '7 days'
        """
    )
    attempts = int((row or {}).get("attempts") or 0)
    if attempts < t.alert_min_attempts:
        return
    failed = int(row["failed"] or 0)
    rate = failed / attempts
    if rate < t.alert_fail_rate:
        return
    yield Finding(
        area="health", code="alerts_failing", severity="high",
        subject="saved_search_alerts",
        title="התראות הסוכן החכם נכשלות — %.0f%%" % (rate * 100),
        detail="%d מתוך %d ניסיונות בשבוע האחרון נכשלו (וואטסאפ %d, מייל %d)."
               % (failed, attempts, int(row["wa_failed"] or 0),
                  int(row["mail_failed"] or 0)),
        suggestion="השגיאה האחרונה: %s. הסיבה השכיחה היא תבנית וואטסאפ לא מאושרת "
                   "— טקסט חופשי נדחה על ידי מטא למי שלא כתב/ה לנו ב-24 השעות "
                   "האחרונות." % ((row["sample"] or "—")[:200]),
        metric=round(rate * 100, 1), metric_unit="%",
        evidence={"attempts": attempts, "failed": failed},
    )


def _untouched_leads(ctx) -> Iterator[Finding]:
    """לידים ששולמו ולא נפתחו, ולידים שממתינים בלי בעלים.

    ליד שיושב הוא ההפסד היקר ביותר בפלטפורמה: כבר שילמנו על הרכישה שלו
    בתשומת לב של הגולש/ת, והוא מתקרר בכל שעה.
    """
    if not ctx.db.has_table("leads"):
        return
    ctx.count()
    row = ctx.db.one(
        """
        select count(*) filter (where agent_id is null
                                  and created_at < now() - interval '24 hours'
                                  and created_at > now() - interval '30 days')
                 as unassigned,
               count(*) filter (where agent_id is not null
                                  and unlocked_at is null
                                  and created_at < now() - interval '48 hours'
                                  and created_at > now() - interval '30 days')
                 as unopened
          from public.leads
        """
    )
    unassigned = int((row or {}).get("unassigned") or 0)
    unopened = int((row or {}).get("unopened") or 0)

    if unassigned:
        yield Finding(
            area="behavior", code="leads_unassigned", severity="high",
            subject="leads_unassigned",
            title="%d לידים ממתינים בלי סוכן/ת" % unassigned,
            detail="נוצרו לפני יותר מ-24 שעות ולא שויכו לאיש.",
            suggestion="לבדוק את הניתוב (docs/lead-routing.md): או שאין סוכן/ת "
                       "מתאים/ה באזור, או שהרוטציה נתקעה. ליד שיושב מתקרר.",
            metric=float(unassigned), metric_unit="לידים",
        )
    if unopened:
        yield Finding(
            area="behavior", code="leads_unopened", severity="medium",
            subject="leads_unopened",
            title="%d לידים שויכו ולא נפתחו" % unopened,
            detail="שויכו לסוכן/ת לפני יותר מ-48 שעות ולא נפתחו.",
            suggestion="זו נקודת הנשירה היקרה ביותר: הפנייה הגיעה, שולמה בתשומת "
                       "לב של הגולש/ת, ואיש לא חזר אליה. שווה תזכורת אוטומטית "
                       "(docs/agent-reminders.md כבר עושה זאת — לבדוק שהיא רצה).",
            metric=float(unopened), metric_unit="לידים",
        )


def _listings_without_images(ctx) -> Iterator[Finding]:
    """מודעות פעילות עם מעט מדי תמונות או בלי תיאור."""
    if not ctx.db.has_table("properties"):
        return
    ctx.count()
    row = ctx.db.one(
        """
        select count(*) filter (where coalesce(array_length(images, 1), 0) = 0
                                  and marketing_image is null)
                 as no_image,
               -- ‏1..2 ולא `< 3`: מודעה בלי אף תמונה מדווחת בנפרד למעלה,
               -- ושני ממצאים שסופרים את אותן שורות הם דוח שמכפיל את עצמו.
               count(*) filter (where coalesce(array_length(images, 1), 0)
                                      between 1 and 2)
                 as few_images,
               count(*) filter (where marketing_description is null
                                  and (description is null or description = ''))
                 as no_text,
               count(*) filter (where lat is null or lng is null)
                 as no_geo,
               count(*) as active
          from public.properties
         where status = 'active'
        """
    )
    active = int((row or {}).get("active") or 0)
    if not active:
        return

    # ---- מודעה בלי אף תמונה: ממצא נפרד, ובדרגה גבוהה יותר ----
    # זה לא "פחות תמונות" — זו מודעה שאינה יכולה להתפרסם בפייסבוק בכלל
    # (‏pending_property_publications מסננת אותה), וגם באתר היא כמעט
    # אינה נצפית. הפרדתי אותה מ-`few_images` אחרי שהתברר ששורה שהמתינה
    # בתור הפרסום 51 שעות הייתה למעשה מודעה בלי תמונה — והממצא שהיה
    # צריך לצעוק הוא לא השורה בתור אלא המודעות עצמן.
    no_image = int((row or {}).get("no_image") or 0)
    if no_image:
        blocked = 0
        if ctx.db.has_table("property_publications"):
            ctx.count()
            blocked_row = ctx.db.one(
                """
                select count(*) as n
                  from public.property_publications pub
                  join public.properties p on p.id = pub.property_id
                 where pub.status = 'pending'
                   and coalesce(array_length(p.images, 1), 0) = 0
                   and p.marketing_image is null
                """
            )
            blocked = int((blocked_row or {}).get("n") or 0)

        share = no_image / active * 100
        yield Finding(
            area="behavior", code="listings_no_image",
            severity="high" if share >= 20 else "medium",
            subject="listings_no_image",
            title="%d מודעות פעילות בלי אף תמונה" % no_image,
            detail="מתוך %d מודעות פעילות (%.0f%%)%s."
                   % (active, share,
                      ", ו-%d מהן תקועות בתור הפרסום לפייסבוק בגלל זה" % blocked
                      if blocked else ""),
            suggestion="מודעה בלי תמונה אינה מתפרסמת בפייסבוק כלל — "
                       "‏pending_property_publications מסננת אותה, והשורה שלה "
                       "ממתינה בתור עד שתעלה תמונה. באתר עצמו היא כמעט אינה "
                       "נצפית. זו נקודת הנשירה הזולה ביותר לתיקון בכל הפלטפורמה: "
                       "תמונה אחת מחזירה את המודעה למשפך.",
            metric=round(share, 1), metric_unit="%",
            evidence={"count": no_image, "active": active,
                      "blocked_publications": blocked},
        )

    for code, label, value, why in (
        ("listings_few_images", "עם תמונה אחת או שתיים",
         int(row["few_images"] or 0),
         "מודעה עם פחות מ-3 תמונות נצפית פחות ומניבה פחות פניות מכל גורם אחר. "
         "(מודעה בלי אף תמונה נספרת בממצא נפרד ולא כאן.)"),
        ("listings_no_text", "בלי תיאור", int(row["no_text"] or 0),
         "מנוע התיאורים (property-description) אמור לכתוב לכל נכס. אם המספר "
         "גבוה — התור תקוע או שהמפתח אינו מוגדר."),
        ("listings_no_geo", "בלי מיקום על המפה", int(row["no_geo"] or 0),
         "נכס בלי lat/lng אינו מופיע בחיפוש על המפה כלל."),
    ):
        if not value or value / active < 0.1:
            continue
        yield Finding(
            area="behavior", code=code, severity="medium",
            subject=code,
            title="%d מודעות פעילות %s" % (value, label),
            detail="מתוך %d מודעות פעילות (%.0f%%)." % (active, value / active * 100),
            suggestion=why,
            metric=round(value / active * 100, 1), metric_unit="%",
            evidence={"count": value, "active": active},
        )


def _saved_search_silence(ctx) -> Iterator[Finding]:
    """מחפשי דירה שנרשמו להתראות ולא קיבלו אף אחת.

    זו הבטחה שלא קוימה: מישהו/י השאיר/ה פרטים כדי לקבל עדכון, וקיבל/ה
    שקט. או שהקריטריונים צרים מדי, או שאין מלאי מתאים — ושתיהן מידע
    ניהולי.
    """
    if not ctx.db.has_table("saved_searches"):
        return
    ctx.count()
    row = ctx.db.one(
        """
        select count(*)                                       as total,
               count(*) filter (where coalesce(alerts_sent, 0) = 0
                                  and created_at < now() - interval '14 days')
                                                              as silent
          from public.saved_searches
         where status = 'active'
        """
    )
    total = int((row or {}).get("total") or 0)
    silent = int((row or {}).get("silent") or 0)
    if not total or silent < 3 or silent / total < 0.3:
        return
    yield Finding(
        area="behavior", code="saved_search_silent", severity="medium",
        subject="saved_searches",
        title="%d חיפושים שמורים לא קיבלו אף התראה" % silent,
        detail="מתוך %d חיפושים פעילים (%.0f%%), ותיקים משבועיים."
               % (total, silent / total * 100),
        suggestion="שתי אפשרויות, ושתיהן מידע ניהולי: הקריטריונים צרים מדי "
                   "(שווה להציע הרחבה), או שאין מלאי מתאים באזור — כלומר יש שם "
                   "ביקוש שאיש אינו מספק.",
        metric=round(silent / total * 100, 1), metric_unit="%",
        evidence={"silent": silent, "total": total},
    )


def _stand_in_pins(ctx) -> Iterator[Finding]:
    """פין זמני שאפשר להחזיר: הרחוב נכנס לשכבת הכתובות של העירייה.

    מודעה ברחוב שאינו בשכבה מוצגת על פין של כתובת צמודה — זו הדרך
    היחידה שהיא תופיע על המפה בכלל, וההשאלה מוצהרת ב-`STAND_IN_PINS`.
    ברגע שסנכרון ה-GIS מוצא את הרחוב, ההשאלה מיותרת: מוחקים את הפין,
    והתור פותר מחדש מהכתובת האמיתית.

    **בלי הבדיקה הזו אין שום סימן.** המודעה נראית תקינה, יש לה פין,
    והוא פשוט 60 מטר מהמקום הנכון — לנצח, כי `geocode_backfill_queue`
    בוחרת רק שורות עם `lat is null` ולכן לעולם אינה חוזרת אליה.

    ‏`STAND_IN_PINS` מוצהר ואינו מנוחש, והנימוק המלא — כולל הגלאי
    האוטומטי שנוסה ונפל — יושב לצד ההגדרה ב-`config.py`.
    """
    if not STAND_IN_PINS:
        return
    if not (ctx.db.has_table("properties") and ctx.db.has_table("street_registry")):
        return

    for city, street, lat, lng, borrowed_from, migration in STAND_IN_PINS:
        ctx.count()
        row = ctx.db.one(
            """
            select (select source::text from public.street_registry
                     where city = %s and name = %s)            as src,
                   (select active from public.street_registry
                     where city = %s and name = %s)            as is_active,
                   (select count(*) from public.properties
                     where status = 'active' and city = %s and street = %s
                       and lat = %s and lng = %s)              as still_borrowed
            """,
            (city, street, city, street, city, street, lat, lng),
        )
        if not row:
            continue

        borrowed = int(row.get("still_borrowed") or 0)
        # אף מודעה אינה נושאת עוד את הפין המושאל — ההשאלה נגמרה מעצמה,
        # ואין על מה לדווח. השורה ב-`STAND_IN_PINS` היא שצריכה לרדת,
        # וזה לא משהו שהסוכן יכול לעשות.
        if not borrowed:
            continue

        # הרחוב עדיין אינו בשכבה: זה המצב הרגיל, וההשאלה עדיין נחוצה.
        if (row.get("src") or "") != "gis" or not row.get("is_active"):
            continue

        yield Finding(
            area="behavior", code="listings_stand_in_pin", severity="medium",
            subject="stand_in_pin:%s" % _slug_ascii(street),
            title="‏%d מודעות ברחוב %s עדיין על פין זמני, והרחוב כבר במרשם"
                  % (borrowed, street),
            detail="הפין שלהן הושאל מ%s כי הרחוב לא היה בשכבת הכתובות של "
                   "העירייה (%s). סנכרון ה-GIS מצא אותו מאז, כלומר אפשר "
                   "להחזיר אותן לכתובת האמיתית שלהן."
                   % (borrowed_from, migration),
            suggestion="מיגרציה שמאפסת להן את הפין: "
                       "‏update public.properties set lat = null, lng = null, "
                       "geocode_attempts = 0, geocode_attempted_at = null, "
                       "geocode_error = null where city = '%s' and street = '%s' "
                       "and lat = %s and lng = %s. "
                       "התנאי על הקואורדינטה המדויקת הוא מה ששומר על התיקון "
                       "ממוקד: מודעה שקיבלה בינתיים פין משלה אינה נדרסת. "
                       "אחרי המיזוג יש למחוק את השורה מ-STAND_IN_PINS."
                       % (city, street, lat, lng),
            metric=borrowed, metric_unit="מודעות",
            evidence={"city": city, "street": street, "lat": lat, "lng": lng,
                      "borrowed_from": borrowed_from, "migration": migration,
                      "registry_source": row.get("src")},
        )


# ‏הסף להדלקת שוק - אותו מספר של docs/cities-and-regions.md (`is_live`) ושל
# ‏MARKET_GATE בפאנל השווקים ב-CRM. דף שוק עם פחות מזה מלמד את גוגל שהאתר דק,
# ואת המבקר/ת הראשון/ה שהאתר ריק.
MARKET_GATE_AGENCIES = 1
MARKET_GATE_PROPERTIES = 10


def _load_markets(root) -> list[dict]:
    """‏השווקים מ-assets/markets.js, דרך המפרש של scripts/check_markets.py.

    מפרש אחד ולא שניים: אם הסוכן והבדיקה ב-CI היו קוראים את הקובץ אחרת,
    שוק אחד היה יכול להיות "חי" באחד ו"סגור" בשני.
    """
    path = root / "scripts" / "check_markets.py"
    if not path.exists() or not (root / "assets" / "markets.js").exists():
        return []
    spec = importlib.util.spec_from_file_location("check_markets", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    mod.MARKETS_JS = root / "assets" / "markets.js"
    return mod.parse_markets()


def _market_gate(ctx) -> Iterator[Finding]:
    """שוק מקומי ביחס לסף: חי ומתחת לו, או סגור וכבר מעליו.

    ‏**שני הכיוונים שקטים בלי הבדיקה.** שוק חי שירד מתחת לסף נראה תקין -
    הדף נטען, יש בו שלושה נכסים - ומה שיש בו הוא דף דל. ושוק שעבר את הסף
    ממשיך להגיש "נפתחים בקרוב" עד שמישהו נזכר לבדוק. ‏docs/regional-pages.md,
    והסקיל market-go-live.

    ובנוסף: נכסים פעילים שאינם שייכים לאף שוק - עיר שלא הוכרה, או עיר בלי
    שוק. הם נשמרים ומופיעים בדף הבית של ברירת המחדל, אבל לא בשוק שלהם.
    """
    markets = _load_markets(ctx.root)
    if not markets:
        return
    if not (ctx.db.has_table("cities") and ctx.db.has_table("properties")):
        return

    rows = ctx.db.rows(
        """
        select c.market_slug,
               count(distinct p.id) filter (where p.status = 'active') as props,
               count(distinct a.id)                                    as agencies
          from public.cities c
          left join public.properties p on p.city_id = c.id
          left join public.agencies   a on a.city_id = c.id
         where c.market_slug is not null
         group by c.market_slug
        """
    ) or []
    by_slug = {r.get("market_slug"): r for r in rows}

    for m in markets:
        ctx.count()
        r = by_slug.get(m["slug"]) or {}
        props = int(r.get("props") or 0)
        agencies = int(r.get("agencies") or 0)
        ready = agencies >= MARKET_GATE_AGENCIES and props >= MARKET_GATE_PROPERTIES
        evidence = {"market": m["slug"], "live": m["live"], "active_properties": props,
                    "agencies": agencies, "gate": [MARKET_GATE_AGENCIES, MARKET_GATE_PROPERTIES]}

        # ‏שוק ברירת המחדל הוא דף הבית של כל האתר - הוא לא נסגר, ולכן אין
        # על מה לדווח אם הוא מתחת לסף (הוא יהיה שם גם כשהמסד ריק לגמרי).
        if m["live"] and not ready and not m["default"]:
            yield Finding(
                area="health", code="market_below_gate", severity="high",
                subject="market:%s" % m["slug"],
                title="השוק %s חי עם %d נכסים פעילים ו-%d משרדים - מתחת לסף"
                      % (m["slug"], props, agencies),
                detail="שוק חי הוא דף הבית של כל מי שנמצא/ת באזור, והסף הוא "
                       "משרד אחד ו-10 נכסים פעילים. מתחתיו הדף דל: גוגל לומדת "
                       "שהאתר דק, והמבקר/ת הראשון/ה רואה אתר ריק.",
                suggestion="לגייס מלאי באזור, או לכבות את השוק (live: false ב-"
                           "assets/markets.js ו-market-soon ב-_redirects) - הסקיל "
                           "market-go-live, סעיף 'כיבוי'.",
                metric=props, metric_unit="נכסים", evidence=evidence,
            )
        elif not m["live"] and ready:
            yield Finding(
                area="health", code="market_ready", severity="info",
                subject="market:%s" % m["slug"],
                title="השוק %s עבר את הסף: %d נכסים פעילים ו-%d משרדים"
                      % (m["slug"], props, agencies),
                detail="הכתובת שלו עדיין מגישה 'נפתחים בקרוב'. אפשר להדליק "
                       "אותו לגולשים.",
                suggestion="הסקיל market-go-live: ‏live: true, ‏_redirects ל-/index, "
                           "שורה ב-sitemap.xml, והערים חיות במסד.",
                metric=props, metric_unit="נכסים", evidence=evidence,
            )

    ctx.count()
    loose = ctx.db.one(
        """
        select count(*) as n
          from public.properties p
          left join public.cities c on c.id = p.city_id
         where p.status = 'active' and c.market_slug is null
        """
    ) or {}
    n = int(loose.get("n") or 0)
    if n:
        yield Finding(
            area="behavior", code="listings_no_market", severity="low",
            subject="properties_no_market",
            title="‏%d נכסים פעילים אינם שייכים לאף שוק מקומי" % n,
            detail="עיר שלא הוכרה (כתיב אחר, יישוב שאינו ברישום) או עיר שלא "
                   "שויכה לשוק. הם מופיעים בדף הבית של שוק ברירת המחדל, ולא "
                   "בדף של האזור שלהם. הרשימה המלאה: פאנל 'שווקים מקומיים' "
                   "ב-CRM, בתחתיתו.",
            suggestion="כינוי ב-city_aliases לכתיב חלופי, או שורה במיגרציה "
                       "ששייכת את העיר לשוק (הסקיל new-market). לא לשכתב את "
                       "properties.city.",
            metric=n, metric_unit="נכסים",
        )


# ‏הנתונים של כל שוק - עסקאות רשמיות, פינים ושכונות. הספים נגזרו מהמאגר עצמו
# ב-26.9.2026 (docs/ops-agent.md, "השווקים המקומיים"), ולא מהראש:
#
# - ‏GovMap מחזיר לכל עיר את 1,500 העסקאות האחרונות, ובפועל כל עיר שהודבקה
#   במלואה ישבה בין 1,253 ל-1,512. קריית ביאליק ישבה על 42 - הדבקה של חיפוש
#   אחד מצומצם. 20% מהחציון של ערי השוק תופס אותה בלי לגעת באף עיר אחרת.
# - ‏"עיר" לעומת "יישוב": קריית ביאליק ועין שמר נבדלות בגודל, ולנו אין עמודת
#   אוכלוסייה. שלוש שכונות לפחות הן המבחן: ליישובי העמק אין אף אחת, ולכן
#   ‏13 עסקאות בגדיש אינן "הדבקה חלקית" אלא גדיש.
# - ‏150 יום מהעסקה האחרונה: רשות המיסים מפרסמת עסקה חודשיים-שלושה אחרי
#   שנסגרה, ולכן 45 יום (המצב היום) הוא טרי לגמרי, וחמישה חודשים הם הדבקה
#   שלא חודשה.
# - ‏25% עסקאות בלי פין, ולפחות 100: בקריית מוצקין 0%, בחיפה 31%, בקריית
#   אתא 35%. מתחת ל-100 זה רעש של יישוב קטן.
# - ‏20 עסקאות לשם שכונה שלא הותאם: "קריית ים ב" היה 411, "משכנות אמנים"
#   ‏428. מתחת ל-20 זה שם נדיר, לא כינוי חסר.
MARKET_DEALS_THIN_RATIO = 0.2
MARKET_DEALS_THIN_MEDIAN_MIN = 500
MARKET_CITY_MIN_HOODS = 3
MARKET_DEALS_STALE_DAYS = 150
MARKET_UNPINNED_RATIO = 0.25
MARKET_UNPINNED_MIN = 100
MARKET_HOOD_ALIAS_MIN = 20


def _market_data(ctx) -> Iterator[Finding]:
    """הנתונים של כל שוק מקומי: עסקאות רשמיות, פינים, גבולות ושמות שכונות.

    ‏**בדיקה אחת שרצה בלולאה על השווקים, ולא סוכן לכל שוק.** הבדיקות זהות
    בכל אזור; שוק חדש נכנס לסריקה ברגע שהוא ב-assets/markets.js ובמסד.
    כל ממצא נושא את השוק ב-subject וב-evidence, כך שהדשבורד יכול להפריד.

    כל אחד מחמשת הממצאים כאן היה שקט בלעדיה: דוח CMA שנשען על 42 עסקאות
    בעיר של 40 אלף תושבים נראה כמו דוח, עסקה בלי פין פשוט לא נכנסת לממוצע,
    ושכונה בלי גבול מוצגת כעיגול בלי שאיש יודע שחסר מצולע.
    """
    markets = {m["slug"]: m for m in _load_markets(ctx.root)}
    if not markets:
        return
    if not (ctx.db.has_table("cities") and ctx.db.has_table("market_deals_official")
            and ctx.db.has_table("neighborhoods")):
        return

    cities = ctx.db.rows(
        """
        -- market_data:cities
        select c.market_slug, c.name,
               (select count(*) from public.neighborhoods n where n.city_id = c.id) as hoods,
               (select count(*) from public.neighborhoods n
                 where n.city_id = c.id
                   and (n.boundary is null or jsonb_typeof(n.boundary) <> 'array'
                        or jsonb_array_length(n.boundary) < 3))                     as hoods_no_boundary,
               count(o.id)                                   as deals,
               count(o.id) filter (where o.lat is null)      as unpinned,
               max(o.sold_at)                                as last_sold,
               (current_date - max(o.sold_at))               as last_sold_days
          from public.cities c
          left join public.market_deals_official o
            on public.city_name_key(o.city) = c.name_key
         where c.market_slug is not null
         group by c.id, c.market_slug, c.name
        """
    ) or []

    by_market: dict[str, list[dict]] = {}
    for r in cities:
        by_market.setdefault(r.get("market_slug"), []).append(r)

    for slug, rows in by_market.items():
        if slug not in markets:
            continue
        label = markets[slug].get("label") or slug

        # ---- עיר עם מעט עסקאות לעומת שאר ערי השוק ----
        big = [r for r in rows if int(r.get("hoods") or 0) >= MARKET_CITY_MIN_HOODS]
        counts = sorted(int(r.get("deals") or 0) for r in big)
        median = counts[len(counts) // 2] if counts else 0
        for r in big:
            ctx.count()
            deals = int(r.get("deals") or 0)
            if median >= MARKET_DEALS_THIN_MEDIAN_MIN and deals < median * MARKET_DEALS_THIN_RATIO:
                city = r.get("name") or ""
                yield Finding(
                    area="health", code="market_city_deals_thin", severity="medium",
                    subject="market:%s:city:%s" % (slug, _slug_ascii(city)),
                    title="ב%s (%s) רק %d עסקאות רשמיות, מול כ-%d בשאר ערי השוק"
                          % (city, label, deals, median),
                    detail="דוח ה-CMA של כל נכס בעיר נשען על המאגר הזה. עיר שהודבקה "
                           "במלואה מחזיקה עד 1,500 עסקאות (המגבלה של GovMap), ומספר "
                           "נמוך בהרבה הוא כמעט תמיד הדבקה של חיפוש מצומצם - רחוב, "
                           "גוש או שכונה אחת - ולא עיר שאין בה עסקאות.",
                    suggestion="להדביק שוב את העיר כולה ב-CRM (ייבוא עסקאות רשמיות "
                               "מ-GovMap), בלי סינון לשכונה או לרחוב. ‏"
                               "docs/market-deals-official.md.",
                    metric=deals, metric_unit="עסקאות",
                    evidence={"market": slug, "city": city, "deals": deals,
                              "market_median": median, "hoods": int(r.get("hoods") or 0)},
                )

        for r in rows:
            city = r.get("name") or ""
            deals = int(r.get("deals") or 0)
            unpinned = int(r.get("unpinned") or 0)
            subject_city = "market:%s:city:%s" % (slug, _slug_ascii(city))

            # ---- עסקאות ישנות ----
            ctx.count()
            days = r.get("last_sold_days")
            if deals and days is not None and int(days) > MARKET_DEALS_STALE_DAYS:
                yield Finding(
                    area="health", code="market_city_deals_stale", severity="low",
                    subject=subject_city,
                    title="העסקה האחרונה במאגר של %s (%s) היא מלפני %d ימים"
                          % (city, label, int(days)),
                    detail="המאגר מתעדכן בהדבקה ידנית מ-GovMap. רשות המיסים מפרסמת "
                           "עסקה חודשיים-שלושה אחרי שנסגרה, ולכן פער של יותר מחמישה "
                           "חודשים הוא הדבקה שלא חודשה - ודוח CMA שמשווה למחירים ישנים.",
                    suggestion="הדבקה חוזרת של העיר ב-CRM. ההדבקה אידמפוטנטית: "
                               "עסקה שכבר קיימת מתעדכנת ואינה נכפלת.",
                    metric=int(days), metric_unit="ימים",
                    evidence={"market": slug, "city": city, "deals": deals,
                              "last_sold": str(r.get("last_sold"))},
                )

            # ---- עסקאות בלי פין ----
            ctx.count()
            if unpinned >= MARKET_UNPINNED_MIN and deals and unpinned / deals >= MARKET_UNPINNED_RATIO:
                yield Finding(
                    area="behavior", code="market_deals_unpinned", severity="low",
                    subject=subject_city,
                    title="‏%d מ-%d העסקאות ב%s (%s) בלי פין - %d%%"
                          % (unpinned, deals, city, label, round(100 * unpinned / deals)),
                    detail="עסקה בלי פין אינה נכנסת לממוצע הרדיוס בדוח ה-CMA. מאז "
                           "20270114091000 היא כן נכנסת להשוואה לפי שכונה - אם יש לה "
                           "שם שכונה שהותאם. לרוב אין לה שם רחוב, רק גוש/חלקה, והחלקה "
                           "גדולה מכדי שמרכזה יהיה פין (govmap:parcel_too_large).",
                    suggestion="לבדוק את geocode_error של העסקאות בעיר. קבוצה באותו "
                               "רחוב שכולה address_not_found היא כמעט תמיד שם רחוב "
                               "(docs/market-deals-official.md). אסור לנחש כתובת.",
                    metric=unpinned, metric_unit="עסקאות",
                    evidence={"market": slug, "city": city, "deals": deals,
                              "unpinned": unpinned},
                )

        # ---- שכונות בלי גבול ----
        ctx.count()
        no_b = [(r.get("name") or "", int(r.get("hoods_no_boundary") or 0))
                for r in rows if int(r.get("hoods_no_boundary") or 0)]
        total_no_b = sum(n for _, n in no_b)
        if total_no_b:
            yield Finding(
                area="behavior", code="market_hoods_no_boundary", severity="low",
                subject="market:%s:hoods" % slug,
                title="‏%d שכונות ב%s בלי גבול" % (total_no_b, label),
                detail="שכונה בלי מצולע מוצגת במפת החיפוש כעיגול, ונכס בה אינו "
                       "משויך אליה אוטומטית מהפין שלו (neighborhood_for_point). גם "
                       "שכבת השכונה בדוח ה-CMA נשענת על השיוך הזה.",
                suggestion="CRM ← ניהול שכונות ← ייבוא מ-GovMap לשוק, ומה שנשאר - "
                           "'סימון על המפה' ליד כל שכונה (docs/regional-pages.md).",
                metric=total_no_b, metric_unit="שכונות",
                evidence={"market": slug, "by_city": dict(no_b)},
            )

    # ---- שמות שכונה בעסקאות שלא הותאמו לשום שכונה ----
    if not ctx.db.has_column("market_deals_official", "neighborhood_id"):
        return
    unmatched = ctx.db.rows(
        """
        -- market_data:unmatched
        select c.market_slug, o.city, o.neighborhood, count(*) as n
          from public.market_deals_official o
          join public.cities c on c.name_key = public.city_name_key(o.city)
         where c.market_slug is not null
           and coalesce(o.neighborhood, '') <> ''
           and o.neighborhood_id is null
         group by 1, 2, 3
        having count(*) >= %s
         order by n desc
        """ % int(MARKET_HOOD_ALIAS_MIN)
    ) or []
    per_market: dict[str, list[dict]] = {}
    for r in unmatched:
        per_market.setdefault(r.get("market_slug"), []).append(r)
    for slug, rows in per_market.items():
        ctx.count()
        if slug not in markets:
            continue
        label = markets[slug].get("label") or slug
        total = sum(int(r.get("n") or 0) for r in rows)
        yield Finding(
            area="behavior", code="market_deal_hoods_unmatched", severity="low",
            subject="market:%s:deal_hoods" % slug,
            title="‏%d עסקאות ב%s נושאות שם שכונה שלא הותאם לשום שכונה (%d שמות)"
                  % (total, label, len(rows)),
            detail="השם מגיע ממאגר רשות המיסים, ולפעמים הוא נכתב אחרת מהשכונה אצלנו. "
                   "עסקה כזו אינה נכנסת להשוואה לפי שכונה בדוח ה-CMA. שם שמתאים "
                   "לשתי שכונות (\"הדר\" בחיפה) נשאר כאן בכוונה - לא מנחשים.",
            suggestion="כשהזהות ודאית - שורה ב-neighborhood_aliases במיגרציה, והעסקאות "
                       "מתחברות לבד (טריגר). כשהשכונה חסרה אצלנו - להוסיף אותה. "
                       "‏docs/market-deals-official.md, 'שכונה לעסקה'.",
            metric=total, metric_unit="עסקאות",
            evidence={"market": slug,
                      "names": [{"city": r.get("city"), "name": r.get("neighborhood"),
                                 "deals": int(r.get("n") or 0)} for r in rows[:15]]},
        )


def _slug_ascii(value: str) -> str:
    """מפתח יציב לשם רחוב בעברית.

    ‏`Finding.key` מנקה אותיות שאינן ASCII, ולכן שני רחובות היו מתכנסים
    לאותו מפתח ודורסים זה את הממצא של זה. ‏hash קצר של השם שומר על
    ההפרדה **ועל היציבות בין הרצות** — `hashlib` ולא `hash()` המובנית,
    שהיא מלוחה מחדש בכל תהליך.
    """
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:8]
