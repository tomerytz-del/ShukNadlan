-- ============================================================================
-- דירוג המשרד — ציון משלו, ולא תוצר לוואי של דירוג המתווכים
--
-- עד היום למשרד היה "דירוג" רק במובן הטכני: `reviews` נושאת גם `agent_id` וגם
-- `agency_id`, ולכן כל ביקורת על מתווך/ת נספרה אוטומטית גם למשרד, ו-
-- `compute_agency_rankings` חישבה עליהן **ממוצע מאוחד**. שלוש בעיות בזה:
--
--   1. מתווך/ת אחד/ת רועש/ת מכריע/ה את המשרד. משרד עם חמישה מתווכים — אחד עם
--      12 ביקורות של 3★ וארבעה עם ביקורת אחת של 5★ — יוצא 3.5, למרות שארבעה
--      מתוך חמישה מצוינים. ובכיוון ההפוך: כוכב אחד גדול מסתיר צוות חלש.
--
--   2. אין דירוג ישיר. מה ששייך למשרד עצמו — שקיפות התהליך, מי עונה כשהמתווך/ת
--      לא זמין/ה, אם קיימו את מה שהבטיחו — פשוט לא נמדד, כי הלקוח/ה נשאל/ה רק
--      על המתווך/ת.
--
--   3. הפריור מנוון. ממוצע הפלטפורמה חושב מכל הביקורות המפורסמות, שהן היום
--      ביקורת אחת של 5★ — ולכן הפריור עצמו 5.0, וכל ארבעת המשרדים במערכת
--      הציגו בדיוק 5.00. המנגנון לא הבדיל בין אף אחד.
--
-- הקובץ הזה מחליף את השלושה:
--
--   דירוג הצוות = ממוצע של ממוצעי המתווכים (לא של הביקורות), במשקל √n
--   דירוג ישיר  = שאלה שנייה ואופציונלית בטופס הביקורת, על המשרד עצמו
--   ציון המשרד  = (1-wd)·צוות + wd·ישיר,  wd = min(תקרה, n_ישיר/(n_ישיר+k))
--
-- ‏wd דינמי הוא מה שמאפשר להעלות את זה לאוויר בלי לשבור דבר: כל עוד אין
-- דירוגים ישירים הוא 0, כלומר הציון הוא ציון הצוות בלבד. המשקל של הדירוג
-- הישיר עולה רק ככל שנצברות תשובות, ועד תקרה — כדי שהצוות לא יהפוך ללא רלוונטי.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הדירוג הישיר של המשרד
--
-- עמודה נפרדת ולא שורת ביקורת נפרדת, משתי סיבות: היא נשענת על אותו
-- `linked_lead_id` שהוא מנגנון האימות של המערכת (מודול 3 §3.4), ואותה
-- unique(linked_lead_id) ממשיכה להבטיח קול אחד לכל פנייה — גם על המשרד.
--
-- nullable במכוון. השאלה בטופס אופציונלית, כי לא לכל לקוח/ה הייתה בכלל
-- התנהלות מול המשרד מעבר למתווך/ת, וחיוב תשובה שם היה קונה דירוג חסר משמעות
-- במחיר פגיעה באחוז המענה על השאלה העיקרית.
-- ---------------------------------------------------------------------------
alter table public.reviews add column if not exists agency_rating integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reviews_agency_rating_check'
  ) then
    alter table public.reviews add constraint reviews_agency_rating_check
      check (agency_rating is null or agency_rating between 1 and 5);
  end if;
end $$;

comment on column public.reviews.agency_rating is
  'דירוג ישיר של המשרד עצמו (1–5), בנפרד מהדירוג של המתווך/ת ב-rating. אופציונלי.';

-- ---------------------------------------------------------------------------
-- 2. פרמטרים
--
-- כמו כל מספר עסקי בפרויקט — ב-pricing_config ולא בקוד.
-- ---------------------------------------------------------------------------
insert into public.pricing_config (key, value, description) values
  ('agency_direct_rating_k', 5,
   'כמה דירוגים ישירים דרושים כדי שהדירוג הישיר ישקול חצי מהמשקל המרבי שלו'),
  ('agency_direct_rating_max_weight', 0.5,
   'תקרת המשקל של הדירוג הישיר בציון המשרד. השאר תמיד נשען על דירוג הצוות'),
  ('platform_prior_reviews', 20,
   'כמה ביקורות דרושות בפלטפורמה כדי שממוצע הפלטפורמה יחליף את הפריור הניטרלי'),
  ('platform_prior_rating', 4.0,
   'הפריור הניטרלי שאליו מכווצים דירוגים כל עוד אין בפלטפורמה מספיק ביקורות')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. הפריור של הפלטפורמה
--
-- ‏compute_*_rankings לקחו עד היום `avg(rating)` על כל הביקורות המפורסמות
-- כפריור. זה נכון כשיש קורפוס, ומנוון כשאין: עם ביקורת אחת של 5★ הפריור הוא
-- 5.0, ולכן **כל** מי שאין לו ביקורות מקבל 5.00 — וגם מי שיש לו. שדה הדירוג
-- הפסיק להבדיל בין אף אחד, וזה בדיוק מה שהערת ה"נקודה שכדאי לשים לב אליה"
-- ב-docs/agent-reviews.md תיארה.
--
-- כאן הפריור עצמו מכווץ: כל עוד בפלטפורמה פחות מ-platform_prior_reviews
-- ביקורות הוא נשען על ערך ניטרלי קבוע, ורק ככל שנצבר קורפוס אמיתי הוא עובר
-- לממוצע הפלטפורמה בפועל. זו פונקציה משותפת כדי ששלושת מקומות החישוב —
-- מתווכים, משרדים והתצוגה הציבורית — לא ייפרדו זה מזה.
-- ---------------------------------------------------------------------------
create or replace function public.platform_prior_rating()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round((n / (n + m)) * coalesce(a, base) + (m / (n + m)) * base, 4)
  from (
    select
      count(*) filter (where r.status = 'published')::numeric        as n,
      avg(r.rating) filter (where r.status = 'published')::numeric   as a,
      coalesce((select value from pricing_config where key = 'platform_prior_reviews'), 20)::numeric as m,
      coalesce((select value from pricing_config where key = 'platform_prior_rating'), 4.0)::numeric as base
    from reviews r
  ) t;
$$;

comment on function public.platform_prior_rating() is
  'ממוצע הפלטפורמה כפריור לכיווץ בייסיאני, מכווץ בעצמו לערך ניטרלי כל עוד אין מספיק ביקורות.';

-- ---------------------------------------------------------------------------
-- 4. ציון המשרד — מקור אמת אחד
--
-- ‏view ולא שדה מחושב, כי הנוסחה צריכה לשרת שני צרכנים עם דרישות טריות שונות:
-- ‏compute_agency_rankings רצה אחת לשבועיים, ואילו דף המשרד חייב להראות ביקורת
-- שאושרה לפני דקה. אותו view מזין את שניהם, כך שהמספר בדף ובטבלת הדירוגים הוא
-- אותו מספר ולא שתי נוסחאות שנפרדו.
--
-- שלוש החלטות שכדאי לשים לב אליהן:
--
--   • הצבירה היא לפי `reviews.agency_id` ולא דרך השיוך הנוכחי של המתווך/ת.
--     ‏agency_id מקובע בשורה ברגע הכתיבה, ולכן ביקורת נשארת אצל המשרד שבו
--     העסקה נעשתה גם אחרי שמתווך/ת עוזב/ת אליו משרד אחר.
--
--   • כל מתווך/ת מכווץ/ת בנפרד לפני הממוצע. מי שיש לו/ה 5★ בודדת תורם/ת ~4.2
--     ולא 5.0 — הכיווץ ההיררכי הוא מה שמונע ממשרד עם ביקורת אחת להיראות מושלם.
--
--   • המשקל הוא √n ולא n. עם n המשרד חוזר להיות הממוצע המאוחד שממנו ברחנו;
--     בלי משקל בכלל, מתווך/ת עם ביקורת אחת שווה/ה למי שיש לו/ה עשרים. ‏√n הוא
--     הפשרה המקובלת בין השניים.
-- ---------------------------------------------------------------------------
create or replace view public.agency_rating_scores as
with params as (
  select
    coalesce((select value from pricing_config where key = 'bayesian_rating_m'), 3)::numeric               as m,
    coalesce((select value from pricing_config where key = 'agency_direct_rating_k'), 5)::numeric          as k,
    coalesce((select value from pricing_config where key = 'agency_direct_rating_max_weight'), 0.5)::numeric as max_w,
    public.platform_prior_rating()                                                                          as prior
),
-- ביקורת אחת לכל שורה, מפורקת לשני הזרמים שמזינים את הציון.
published as (
  select r.agency_id, r.agent_id, r.rating, r.agency_rating
  from public.reviews r
  where r.status = 'published' and r.agency_id is not null
),
agent_stats as (
  select agency_id, agent_id, count(*)::numeric as n, avg(rating)::numeric as raw_avg
  from published
  where agent_id is not null
  group by agency_id, agent_id
),
agent_scored as (
  select s.agency_id, s.n,
         (s.n / (s.n + p.m)) * s.raw_avg + (p.m / (s.n + p.m)) * p.prior as bayes,
         sqrt(s.n) as w
  from agent_stats s cross join params p
),
team as (
  select agency_id,
         sum(w * bayes) / nullif(sum(w), 0) as team_rating,
         sum(n)::integer                    as team_review_count,
         count(*)::integer                  as rated_agent_count
  from agent_scored
  group by agency_id
),
-- הזרם הישיר. ‏agency_rating היא התשובה המפורשת על המשרד; ביקורת שאין לה
-- ‏agent_id בכלל (ליד שהגיע למשרד ולא לאדם) היא לפי הגדרתה ביקורת על המשרד,
-- ולכן ה-rating שלה נכנס לכאן ולא נופל בין הכיסאות כפי שקרה בממוצע המאוחד.
direct_values as (
  select agency_id,
         coalesce(agency_rating, case when agent_id is null then rating end) as v
  from published
),
direct as (
  select d.agency_id,
         count(*)::integer as direct_review_count,
         (count(*)::numeric / (count(*)::numeric + p.m)) * avg(d.v)
           + (p.m / (count(*)::numeric + p.m)) * p.prior as direct_rating
  from direct_values d cross join params p
  where d.v is not null
  group by d.agency_id, p.m, p.prior
),
pooled as (
  select agency_id, count(*)::integer as pooled_review_count, avg(rating)::numeric as pooled_avg
  from published
  group by agency_id
),
blended as (
  select
    a.id as agency_id,
    t.team_rating,
    coalesce(t.team_review_count, 0)  as team_review_count,
    coalesce(t.rated_agent_count, 0)  as rated_agent_count,
    d.direct_rating,
    coalesce(d.direct_review_count, 0) as direct_review_count,
    coalesce(po.pooled_review_count, 0) as pooled_review_count,
    po.pooled_avg,
    least(p.max_w,
          coalesce(d.direct_review_count, 0)::numeric
            / (coalesce(d.direct_review_count, 0)::numeric + p.k)) as direct_weight
  from public.agencies a
  cross join params p
  left join team   t  on t.agency_id  = a.id
  left join direct d  on d.agency_id  = a.id
  left join pooled po on po.agency_id = a.id
)
select
  b.agency_id,
  -- סך הראיות מאחורי הציון. ‏pooled_review_count הוא מספר הביקורות בפועל,
  -- ולכן הוא זה שמוצג ללקוח/ה — דירוג ישיר אינו ביקורת נוספת אלא שאלה נוספת
  -- באותה ביקורת.
  b.pooled_review_count                       as review_count,
  round(b.pooled_avg, 2)                      as avg_rating,
  round(b.team_rating, 2)                     as team_rating,
  b.team_review_count,
  b.rated_agent_count,
  round(b.direct_rating, 2)                   as direct_rating,
  b.direct_review_count,
  round(b.direct_weight, 3)                   as direct_weight,
  -- הציון עצמו. ‏null כשאין שום ראיה — משרד בלי ביקורות לא מקבל "0 כוכבים"
  -- ולא כוכבים של הפריור, אלא פשוט לא מוצג עם דירוג. זה אותו כלל שכבר נאכף
  -- בכרטיסי המתווכים בדף הבית.
  round(
    case
      when b.team_rating is null and b.direct_rating is null then null
      when b.team_rating is null   then b.direct_rating
      when b.direct_rating is null then b.team_rating
      else (1 - b.direct_weight) * b.team_rating + b.direct_weight * b.direct_rating
    end, 2)                                   as score
from blended b;

comment on view public.agency_rating_scores is
  'הנוסחה עצמה: דירוג הצוות (ממוצע מכווץ של המתווכים במשקל √n) מעורבב עם הדירוג הישיר. score הוא null כשאין ביקורות.';

-- ה-view הציבורי מוסיף רק את composite_score מטבלת הדירוגים. ההפרדה לשניים
-- אינה קוסמטית: `compute_agency_rankings` **כותבת** ל-agency_rankings וקוראת
-- את הנוסחה, ואילו היה זה view אחד היא הייתה קוראת מהטבלה שאותה היא מעדכנת
-- באותה פקודה. ‏agency_rating_scores לא נוגע ב-agency_rankings, ולכן אין מעגל.
create or replace view public.agency_ratings_public as
select
  s.agency_id, s.review_count, s.avg_rating, s.team_rating, s.team_review_count,
  s.rated_agent_count, s.direct_rating, s.direct_review_count, s.direct_weight,
  s.score, ar.composite_score
from public.agency_rating_scores s
left join public.agency_rankings ar on ar.agency_id = s.agency_id;

comment on view public.agency_ratings_public is
  'דירוג המשרד לתצוגה: הציון על מרכיביו, בתוספת composite_score מטבלת הדירוגים.';

-- ‏security_invoker לא מופעל כאן במכוון, באותה תבנית של agent_ratings_public
-- ו-agency_members_public: ה-view נשען על ה-policy שממילא חושפת את הביקורות
-- המפורסמות, ומוסיף עליה רק צבירה — בלי טקסט הביקורות ובלי שורות pending.
revoke all on public.agency_ratings_public from anon, authenticated;
grant select on public.agency_ratings_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. חישוב הדירוגים — צריכת אותה נוסחה
--
-- שתי הפונקציות משתנות באותו אופן: הפריור עובר ל-platform_prior_rating(),
-- ו-compute_agency_rankings מפסיקה לחשב ממוצע מאוחד משלה ולוקחת את הציון
-- מ-agency_ratings_public. שאר המבנה — percent_rank על שלושת הצירים בתוך
-- אזור — נשאר כפי שהוא.
--
-- ‏coalesce לפריור (ולא ל-0) עבור משרד/סוכן/ת ללא ביקורות: זו הייתה ההתנהגות
-- בפועל גם קודם, כי n=0 החזיר את הפריור, והכוונה המתועדת היא שחדש/ה לא
-- נענש/ת על היעדר ביקורות. בטבלת הדירוגים זה בסדר — היא מזינה דירוג ומיון,
-- לא תצוגה. התצוגה נשענת על `score` שב-view, שנשאר null.
-- ---------------------------------------------------------------------------
create or replace function public.compute_agency_rankings()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior numeric;
begin
  v_prior := platform_prior_rating();

  with city_mode as (
    select agency_id, city from (
      select agency_id, city, count(*) as cnt,
        row_number() over (partition by agency_id order by count(*) desc) as rn
      from properties group by agency_id, city
    ) t where rn = 1
  ),
  stats as (
    select
      a.id as agency_id,
      coalesce(cm.city, 'עפולה') as city_region_key,
      (select count(*) from properties p where p.agency_id = a.id and p.status = 'active') as active_properties_count,
      (select count(*) from market_deals md where md.agency_id = a.id and md.sold_at >= (current_date - interval '6 months')) as deal_count_6mo,
      coalesce(ratings.score, v_prior) as bayesian_rating
    from agencies a
    left join city_mode cm on cm.agency_id = a.id
    left join agency_rating_scores ratings on ratings.agency_id = a.id
  ),
  scored as (
    select *,
      percent_rank() over (partition by city_region_key order by active_properties_count) as pr_props,
      percent_rank() over (partition by city_region_key order by deal_count_6mo) as pr_deals,
      percent_rank() over (partition by city_region_key order by bayesian_rating) as pr_rating
    from stats
  )
  insert into agency_rankings (agency_id, city_region_key, active_properties_count, deal_count_6mo, bayesian_rating, composite_score, computed_at)
  select agency_id, city_region_key, active_properties_count, deal_count_6mo,
    round(bayesian_rating::numeric, 2),
    round((((pr_props + pr_deals + pr_rating)/3.0)*100)::numeric, 2), now()
  from scored
  on conflict (agency_id) do update set
    city_region_key = excluded.city_region_key,
    active_properties_count = excluded.active_properties_count,
    deal_count_6mo = excluded.deal_count_6mo,
    bayesian_rating = excluded.bayesian_rating,
    composite_score = excluded.composite_score,
    computed_at = excluded.computed_at;
end;
$$;

comment on function public.compute_agency_rankings() is
  'מרעננת את agency_rankings. הדירוג עצמו מגיע מ-agency_ratings_public — נוסחה אחת לתצוגה ולמיון.';

create or replace function public.compute_agent_rankings()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m numeric;
  v_platform_avg numeric;
begin
  select value into v_m from pricing_config where key = 'bayesian_rating_m';
  v_m := coalesce(v_m, 3);
  -- ההבדל היחיד מהגרסה הקודמת: הפריור מכווץ בעצמו ולא נגרר אחרי ביקורת בודדת.
  v_platform_avg := platform_prior_rating();

  with nbhd_mode as (
    select agent_id, neighborhood_id from (
      select agent_id, neighborhood_id, count(*) as cnt,
        row_number() over (partition by agent_id order by count(*) desc) as rn
      from properties where neighborhood_id is not null group by agent_id, neighborhood_id
    ) t where rn = 1
  ),
  stats as (
    select
      am.id as agent_id,
      coalesce(n.city || ':' || n.name, 'עפולה:כללי') as neighborhood_region_key,
      (select count(*) from properties p where p.agent_id = am.id and p.status = 'active') as active_properties_count,
      (select count(*) from market_deals md where md.agent_id = am.id and md.sold_at >= (current_date - interval '6 months')) as deal_count_6mo,
      (select count(*) from reviews r where r.agent_id = am.id and r.status = 'published') as review_count,
      (select coalesce(avg(rating),0) from reviews r where r.agent_id = am.id and r.status = 'published') as raw_avg_rating
    from agency_members am
    left join nbhd_mode nm on nm.agent_id = am.id
    left join neighborhoods n on n.id = nm.neighborhood_id
    where am.active = true  -- הוסר: and am.role = 'agent' — role ו-ranking הם צירים נפרדים
  ),
  scored as (
    select *,
      (review_count::numeric / nullif(review_count + v_m, 0)) * raw_avg_rating
        + (v_m / nullif(review_count + v_m, 0)) * v_platform_avg as bayesian_rating,
      percent_rank() over (partition by neighborhood_region_key order by active_properties_count) as pr_props,
      percent_rank() over (partition by neighborhood_region_key order by deal_count_6mo) as pr_deals
    from stats
  ),
  scored2 as (
    select *, percent_rank() over (partition by neighborhood_region_key order by bayesian_rating) as pr_rating
    from scored
  )
  insert into agent_rankings (agent_id, neighborhood_region_key, active_properties_count, deal_count_6mo, bayesian_rating, composite_score, computed_at)
  select agent_id, neighborhood_region_key, active_properties_count, deal_count_6mo,
    round(coalesce(bayesian_rating,0)::numeric, 2),
    round((((pr_props + pr_deals + pr_rating)/3.0)*100)::numeric, 2), now()
  from scored2
  on conflict (agent_id) do update set
    neighborhood_region_key = excluded.neighborhood_region_key,
    active_properties_count = excluded.active_properties_count,
    deal_count_6mo = excluded.deal_count_6mo,
    bayesian_rating = excluded.bayesian_rating,
    composite_score = excluded.composite_score,
    computed_at = excluded.computed_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. ריענון מיידי
--
-- ‏maybe_recompute_rankings מדלגת אם עברו פחות מ-14 יום מהחישוב האחרון, ולכן
-- בלי השורה הזו הציונים הישנים — כולם 5.00 — היו נשארים על המסך עד לחישוב
-- הבא. כאן זו הרצה חד-פעמית עם הנוסחה החדשה.
--
-- ‏agency לפני agent הוא רק סדר; שתיהן קוראות לאותו פריור.
-- ---------------------------------------------------------------------------
select public.compute_agent_rankings();
select public.compute_agency_rankings();
