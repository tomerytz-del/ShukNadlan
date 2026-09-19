"""מה שהמשתמשים עושים — ואיפה הם נושרים.

## למה אין כאן "שיעור יציאה מדף"

שיעור היציאה, זמן השהייה ומסלול הגלישה יושבים ב-GA4, ואין לנו גישת API
אליו. מה שכן יש הוא **המשפכים שנגמרים במסד**, והם עונים על אותה שאלה
בצורה ישירה יותר: לא "כמה אחוז יצאו מדף הנכס" אלא "כמה נכסים נצפו
עשרות פעמים ואיש לא פנה לגביהם". השני הוא מספר שאפשר לפעול לפיו.

הפער המדויק, ומה כן כדאי לפתוח ב-GA4: `docs/ops-agent.md`.
"""

from __future__ import annotations

from typing import Iterator

from ..models import Finding


def run(ctx) -> Iterator[Finding]:
    yield from _views_without_leads(ctx)
    yield from _pwa_funnel(ctx)
    yield from _alert_failures(ctx)
    yield from _untouched_leads(ctx)
    yield from _listings_without_images(ctx)
    yield from _saved_search_silence(ctx)


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
