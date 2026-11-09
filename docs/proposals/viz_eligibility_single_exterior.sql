-- ============================================================================
-- זכאות להדמיה: לא לדירה בבניין ולא למסחרי שיש להם רק תמונת חוץ אחת (PR 1010, P1-K1, ד-12).
-- הצעה (‏docs/proposals): לא רצה. תומר מאשר ומעביר ל-supabase/migrations עם version חדש.
--
-- החלטת תומר (28.10): בית פרטי ודו משפחתי נשארים זכאים גם עם תמונת חזית אחת (שיפוץ חזית).
-- 28.10 (קריאה בלבד): יחסמו רק 4d4a5470 ו-679b1ebc (דירות, חזית אחת). ‏2b247567 (דו
-- משפחתי) ו-567248c0 (משרדים, 8 תמונות) נשארים זכאים.
-- נפילה כשאין תיוג לתמונה: תמונה אחת + סוג "משרד|בניין|מבנ" - לא זכאי.
-- הדמיות קיימות אינן נמחקות: ה-views (‏_public, ‏_recent) מסננים דרך הפונקציה, ולכן הן
-- פשוט מפסיקות להיות מוצגות ומוצעות. ‏property-visualize וה-backfill נשענים על אותה פונקציה.
-- הגוף הנוכחי נקרא מהפרודקשן ב-28.10; השינוי הוא ה-and not (...) בסוף. אידמפוטנטית.
-- ============================================================================

create or replace function public.property_visualizations_enabled(p_property_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.properties p
    join public.agency_members m on m.id = p.agent_id
    where p.id = p_property_id
      and p.status = 'active'
      and m.active = true
      and m.tier = 'premium'
      and m.billing_status = 'active'
      and not (
        coalesce(array_length(array_remove(p.images, null), 1), 0) = 1
        and (p.category = 'commercial'
             or coalesce(p.property_type, '') !~ '(פרטי|דו.?משפחתי|קוטג|וילה|משק|חד.?משפחתי)')
        and (
          exists (select 1 from public.property_image_tags t
                   where t.property_id = p.id and t.image_url = p.images[1] and t.photo_type = 'exterior')
          or (not exists (select 1 from public.property_image_tags t
                           where t.property_id = p.id and t.image_url = p.images[1])
              and coalesce(p.property_type, '') ~ '(משרד|בניין|מבנ)')
        )
      )
  );
$function$;

-- ההרשאות לא משתנות ב-create or replace (הפונקציה כבר פתוחה ל-anon - הדפדפן שואל אותה).

-- המשך אפשרי (לא כאן): view ‏property_viz_sources_public (‏property_id, target, source_image_url)
-- בלי PII, כדי שהלשונית בהחלקה תציג תמונת פנים מתחת ל"חלל העסק" גם בלי הדמיה קיימת.
