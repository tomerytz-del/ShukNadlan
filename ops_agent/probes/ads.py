"""קונסולת השיווק — מה שנשבר בשקט בקמפיינים הממומנים (שלב 6,
docs/marketing-console.md).

כל הבדיקות כאן נשענות על מה ש-`ads-admin` כבר כותב למסד: יומן הפעולות
(`ads_actions_log`), הביצועים (`ads_insights_daily`), הלידים (`ads_leads`)
והקמפיינים שנוצרו מהקונסולה (`ads_campaigns`). **אין כאן קריאה למטא** —
הטוקן יושב בסודות של Supabase ולא של GitHub, וסריקה שקוראת למטא כל שש
שעות הייתה מבזבזת את מכסת הקריאות של החשבון בשביל תשובה שכבר נמצאת ביומן.

## למה כל ממצא כאן יכול להיסגר

הלקח של `heavy_query` (docs/ops-agent.md): מדד שרק עולה אינו יכול לסגור
ממצא. לכן:

* **טוקן פג** נבדק על **הקריאה האחרונה** למטא ולא על "היה כשל ב-48 שעות".
  קריאה אחת שהצליחה אחרי הטוקן החדש סוגרת אותו.
* **סנכרון ששותק** נמדד מהסנכרון המוצלח האחרון — כל סנכרון מאפס אותו.
* **קמפיין בלי לידים** נמדד בחלון נע של חמישה ימים מלאים.
"""

from __future__ import annotations

from typing import Iterator

from ..models import Finding

# הפעולות שנוגעות במטא. ‏generate_copy/save_copy ומודיעין השווקים אינם
# כאן - הם לא יודעים דבר על הטוקן של מטא.
META_ACTIONS = ("sync_insights", "sync_leads", "set_status", "set_budget",
                "subscribe_page", "create_campaign", "discard_campaign")


def run(ctx) -> Iterator[Finding]:
    if not ctx.db.has_table("ads_settings"):
        return
    yield from _token(ctx)
    yield from _sync_silent(ctx)
    yield from _campaigns_without_leads(ctx)
    yield from _leads_failed(ctx)
    yield from _leads_unmapped(ctx)
    yield from _partial_campaigns(ctx)


def _enabled(ctx) -> bool:
    row = ctx.db.one("select value from public.ads_settings where key = 'enabled'")
    return bool(row) and row.get("value") is True


def _token(ctx) -> Iterator[Finding]:
    """הטוקן של מטא פג או בוטל (קוד 190).

    הקוד מופיע בטקסט של MetaError (‏"code=190") שנכתב ל-error או לתוך
    response - בסנכרון הוא יושב בתקציר של כל רמה, בפעולה בודדת ב-meta
    עצמו. בודקים רק את הקריאה האחרונה: כשל ישן שאחריו הצלחה כבר טופל.
    """
    if not ctx.db.has_table("ads_actions_log"):
        return
    ctx.count()
    row = ctx.db.one(
        """
        select action, created_at, ok,
               (coalesce(error, '') like '%%code=190%%'
                or coalesce(response::text, '') like '%%code=190%%'
                or response->>'code' = '190') as token_dead
          from public.ads_actions_log
         where action = any(%s)
         order by created_at desc
         limit 1
        """,
        (list(META_ACTIONS),),
    )
    if not row or row.get("ok") or not row.get("token_dead"):
        return
    yield Finding(
        area="health", code="ads_token_invalid", severity="critical",
        subject="meta_ads_token",
        title="הטוקן של חשבון המודעות במטא פג או בוטל",
        detail=("הקריאה האחרונה למטא (%s) נדחתה בקוד 190. הביצועים לא מסתנכרנים, "
                "לידים מטופס לא נמשכים בסנכרון, ואי אפשר להשהות קמפיין מהקונסולה - "
                "והקמפיינים עצמם ממשיכים להוציא כסף." % row["action"]),
        suggestion=("להפיק טוקן System User חדש (meta-ads/references/setup.md) ולעדכן את "
                    "META_ADS_ACCESS_TOKEN ב-Supabase → Edge Functions → Secrets."),
        evidence={"action": row["action"], "at": row["created_at"]},
    )


def _sync_silent(ctx) -> Iterator[Finding]:
    """הסנכרון הלילי דלוק ולא הצליח מעל 36 שעות.

    ה-cron נבדק גם ב-database (‏cron_*), אבל שם רואים רק שה-HTTP יצא.
    ‏ads-admin עונה 207 כשרמה נכשלה, ו-200 עם skipped כשהקונסולה כבויה -
    שניהם "רץ בהצלחה" מנקודת המבט של pg_cron. כאן נמדד מה שחשוב: מתי
    נכתב סנכרון מוצלח.
    """
    if not (ctx.db.has_table("ads_actions_log") and _enabled(ctx)):
        return
    t = ctx.settings.thresholds
    ctx.count()
    row = ctx.db.one(
        """
        select max(created_at) filter (where ok) as last_ok,
               max(created_at) as last_any,
               (select updated_at from public.ads_settings where key = 'enabled') as enabled_at,
               extract(epoch from now() - coalesce(
                 max(created_at) filter (where ok),
                 (select updated_at from public.ads_settings where key = 'enabled'))) / 3600 as hours
          from public.ads_actions_log
         where action = 'sync_insights'
        """
    )
    hours = float(row["hours"]) if row and row.get("hours") is not None else None
    if hours is None or hours < t.ads_sync_silent_hours:
        return
    yield Finding(
        area="health", code="ads_sync_silent", severity="high",
        subject="ads-insights-sync",
        title="ביצועי הקמפיינים לא מסתנכרנים ממטא",
        detail=("הקונסולה דלוקה, והסנכרון המוצלח האחרון היה לפני %d שעות%s. "
                "הדשבורד מציג נתונים ישנים, וסימון השחיקה מחושב עליהם."
                % (int(hours), "" if row.get("last_ok") else " (או שלא היה אף פעם)")),
        suggestion=("לפתוח את ads_actions_log (action = sync_insights) ולראות את השגיאה "
                    "בתקציר; ואם אין שם שורות בכלל - לבדוק את ה-job ads-insights-sync ב-pg_cron."),
        metric=round(hours, 1), metric_unit="שעות",
        evidence={"last_ok": row.get("last_ok"), "last_any": row.get("last_any")},
    )


def _campaigns_without_leads(ctx) -> Iterator[Finding]:
    """קמפיין לידים שהוציא כסף חמישה ימים ולא הביא ליד.

    **רק קמפיין שאמור להביא לידים.** קמפיין תנועה לאתר מביא קליקים ולא
    לידים, וממצא עליו היה מודד יחידה אחרת ממה שהכותרת אומרת. לכן נכללים
    רק (1) קמפיינים שנוצרו מהקונסולה עם יעד טופס או וואטסאפ, ו-(2) קמפיין
    שהביא לידים בחודש שלפני החלון - כלומר כזה שיודע להביא, והפסיק.
    """
    if not ctx.db.has_table("ads_insights_daily"):
        return
    t = ctx.settings.thresholds
    has_console = ctx.db.has_table("ads_campaigns")
    ctx.count()
    rows = ctx.db.rows(
        """
        with win as (
          select campaign_id, max(object_name) as name,
                 sum(spend) as spend, sum(leads) as leads, sum(conversations) as conv
            from public.ads_insights_daily
           where level = 'campaign'
             and day between current_date - %(days)s and current_date - 2
           group by campaign_id
        ),
        before as (
          select campaign_id, sum(leads) + sum(conversations) as results
            from public.ads_insights_daily
           where level = 'campaign'
             and day between current_date - %(days)s - 30 and current_date - %(days)s - 1
           group by campaign_id
        )
        select w.campaign_id, w.name, w.spend, coalesce(b.results, 0) as before_results,
               """ + ("""exists (select 1 from public.ads_campaigns c
                               where c.meta_campaign_id = w.campaign_id
                                 and c.destination in ('lead_form', 'whatsapp')
                                 and c.status = 'created')""" if has_console else "false") + """ as console_lead
          from win w
          left join before b using (campaign_id)
         where w.spend >= %(min_spend)s
           and w.leads + w.conv = 0
        """,
        {"days": t.ads_no_leads_days + 1, "min_spend": t.ads_no_leads_min_spend},
    )
    for r in rows:
        if not (r.get("console_lead") or (r.get("before_results") or 0) > 0):
            continue
        spend = float(r["spend"])
        yield Finding(
            area="behavior", code="ads_campaign_no_leads", severity="medium",
            subject=str(r["campaign_id"]),
            title="קמפיין הוציא %s בחמישה ימים בלי ליד אחד" % ("₪%d" % spend),
            detail=("הקמפיין \"%s\" הוציא ₪%d בחמשת הימים המלאים האחרונים, בלי ליד ובלי שיחה. "
                    "%s" % (r.get("name") or r["campaign_id"], spend,
                            "בחודש שלפני כן הוא כן הביא לידים - משהו השתנה."
                            if (r.get("before_results") or 0) > 0 else
                            "הוא נוצר מהקונסולה כקמפיין לידים.")),
            suggestion=("לבדוק בלשונית הביצועים: מודעה שנדחתה, טופס שנמחק, או קהל ששחק. "
                        "אם זה קמפיין חדש בשלב הלמידה - להחליט אם להמשיך, לא להשאיר בלי מבט."),
            metric=round(spend, 2), metric_unit="₪",
            evidence={"campaign_id": r["campaign_id"], "before_results": r.get("before_results")},
        )


def _leads_failed(ctx) -> Iterator[Finding]:
    """לידים ממטא שלא נכנסו לפלטפורמה.

    ‏ads-admin מנסה שוב כל שעה עד 5 פעמים. ליד שנכשל 5 פעמים כבר לא
    יילקח שוב בלי לחיצה על "נסו שוב" - ואדם שהשאיר טלפון מחכה לשיחה.
    """
    if not ctx.db.has_table("ads_leads"):
        return
    t = ctx.settings.thresholds
    ctx.count()
    row = ctx.db.one(
        """
        select count(*) as n,
               count(*) filter (where attempts >= %(max)s) as dead,
               min(received_at) as oldest,
               array_agg(distinct error) filter (where error is not null) as errors
          from public.ads_leads
         where status = 'failed'
           and (attempts >= %(max)s or received_at < now() - make_interval(hours => %(hours)s))
        """,
        {"max": t.ads_lead_max_attempts, "hours": t.ads_lead_failed_hours},
    )
    n = int(row["n"]) if row else 0
    if not n:
        return
    yield Finding(
        area="health", code="ads_leads_failed", severity="high",
        subject="ads_leads",
        title="לידים ממטא שלא נכנסו לפלטפורמה",
        detail=("%d לידים מטפסי מטא נכשלו בשליחה למסלול הלידים (%d מהם מיצו את 5 הניסיונות). "
                "השגיאות: %s." % (n, int(row["dead"] or 0), ", ".join(row.get("errors") or []) or "-")),
        suggestion=("בלשונית \"לידים ממטא\": לתקן את שיוך הטופס (עיר או סוג נכס ברירת מחדל) "
                    "וללחוץ \"נסו שוב\" על כל ליד."),
        metric=n, metric_unit="לידים",
        evidence={"oldest": row.get("oldest"), "errors": row.get("errors")},
    )


def _leads_unmapped(ctx) -> Iterator[Finding]:
    """לידים שממתינים לשיוך טופס יותר מיממה."""
    if not ctx.db.has_table("ads_leads"):
        return
    t = ctx.settings.thresholds
    ctx.count()
    rows = ctx.db.rows(
        """
        select form_id, max(form_name) as form_name, count(*) as n, min(received_at) as oldest
          from public.ads_leads
         where status = 'new'
           and received_at < now() - make_interval(hours => %s)
         group by form_id
        """,
        (t.ads_lead_unmapped_hours,),
    )
    for r in rows:
        yield Finding(
            area="behavior", code="ads_leads_unmapped", severity="medium",
            subject=str(r.get("form_id") or "-"),
            title="טופס לידים במטא שלא שויך - הלידים ממתינים",
            detail=("%d לידים מהטופס \"%s\" ממתינים מעל יממה, כי הטופס לא שויך למסלול. "
                    "הם לא הגיעו לאף מתווך/ת." % (int(r["n"]), r.get("form_name") or r.get("form_id"))),
            suggestion="לשייך את הטופס בלשונית \"לידים ממטא\" - הלידים שממתינים יישלחו מיד.",
            metric=int(r["n"]), metric_unit="לידים",
            evidence={"oldest": r.get("oldest")},
        )


def _partial_campaigns(ctx) -> Iterator[Finding]:
    """יצירת קמפיין שנעצרה באמצע - אובייקטים יתומים בחשבון המודעות."""
    if not ctx.db.has_table("ads_campaigns"):
        return
    t = ctx.settings.thresholds
    ctx.count()
    rows = ctx.db.rows(
        """
        select id, name, status, error, jsonb_array_length(objects) as objects
          from public.ads_campaigns
         where status in ('failed', 'creating')
           and updated_at < now() - make_interval(hours => %s)
        """,
        (t.ads_campaign_partial_hours,),
    )
    for r in rows:
        yield Finding(
            area="cost", code="ads_campaign_partial", severity="low",
            subject=str(r["id"]),
            title="יצירת קמפיין שנעצרה באמצע",
            detail=("\"%s\" נעצר במצב %s עם %d אובייקטים שכבר נוצרו במטא. הקמפיין מושהה ולא "
                    "מוציא כסף, אבל הוא יושב בחשבון. %s"
                    % (r["name"], r["status"], int(r["objects"] or 0), r.get("error") or "")),
            suggestion="\"מחיקה\" ברשימה \"קמפיינים שנוצרו מכאן\" בלשונית נוסחי המודעות.",
            evidence={"id": r["id"], "error": r.get("error")},
        )
