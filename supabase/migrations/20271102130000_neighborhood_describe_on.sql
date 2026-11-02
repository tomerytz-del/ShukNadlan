-- ============================================================================
-- תיאורי השכונות: קודם ערים שיש בהן נכסים פעילים, וה-job השבועי חוזר לפעול
--
-- ‏1. הסדר. ‏neighborhood_describe_candidates (‏20270729090000) העדיפה שכונה
--    שיש **בה** נכסים פעילים, ואחריה את כל השאר לפי עסקאות. ‏2.11.2026: אחרי
--    11 הטיוטות הראשונות לא נשארה אף שכונה כזו, ומתוך 498 המועמדות רק 11 בעיר
--    שיש בה נכסים - והן היו מתחת לשכונות של קריית ים, עכו ונשר, שאין לנו בהן
--    דבר, רק כי שם יותר עסקאות. הסדר עכשיו: שכונה עם נכסים, אחר כך שכונה
--    **בעיר** עם נכסים (לפי מספר הנכסים בעיר), ורק אז לפי עסקאות.
--
-- ‏2. ה-job. ‏neighborhood-describe נוצר פעיל וכובה ידנית מחוץ לצינור (הסוכן
--    התפעולי, cron_disabled, מ-28.10.2026). הוא אינו מפרסם דבר - הוא כותב 10
--    טיוטות בשבוע לתיבת המשימות, ורק אישור ב"SEO ושכונות" מעלה אותן לדף.
--    התזמון אינו משתנה (שני 06:17 UTC). ‏docs/neighborhood-pages.md.
-- ============================================================================

create or replace function public.neighborhood_describe_candidates(p_limit int default 10)
returns table (neighborhood_id uuid, city_slug text, slug text, name text, city text)
language sql
stable
security definer
set search_path = ''
as $$
  with city_props as (
    select p.city_id, count(*) as n
      from public.properties p
     where p.status = 'active' and p.city_id is not null
     group by p.city_id
  )
  select n.id, i.city_slug, i.slug, i.name, i.city
    from public.neighborhood_page_index i
    join public.cities c on c.slug = i.city_slug
    join public.neighborhoods n on n.city_id = c.id and n.slug = i.slug
    left join city_props cp on cp.city_id = c.id
   where not exists (select 1 from public.neighborhood_descriptions d
                      where d.neighborhood_id = n.id
                        and (d.status in ('approved', 'draft')
                             or (d.status = 'rejected' and d.decided_at > now() - interval '30 days')))
   order by (i.props > 0) desc, i.props desc,
            (coalesce(cp.n, 0) > 0) desc, coalesce(cp.n, 0) desc,
            i.deals desc, i.name
   limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;

comment on function public.neighborhood_describe_candidates(int) is
  'השכונות שיקבלו טיוטת תיאור: עם דף, בלי תיאור מאושר או טיוטה ממתינה, ולא נדחו ב-30 יום. הסדר: נכסים בשכונה, נכסים בעיר, ואז עסקאות. service_role בלבד (neighborhood-describe). docs/neighborhood-pages.md';

revoke all on function public.neighborhood_describe_candidates(int) from public, anon, authenticated;
grant execute on function public.neighborhood_describe_candidates(int) to service_role;

do $$
declare
  v_job bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron אינו מותקן - neighborhood-describe לא הודלק';
    return;
  end if;
  select j.jobid into v_job from cron.job j where j.jobname = 'neighborhood-describe';
  if v_job is null then
    raise notice 'אין job בשם neighborhood-describe - לא הודלק (נוצר ב-20270729090000)';
    return;
  end if;
  perform cron.alter_job(v_job, active := true);
end $$;
