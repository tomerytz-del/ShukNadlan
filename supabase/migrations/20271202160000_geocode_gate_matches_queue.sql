-- ===========================================================================
-- שער הגאוקוד מתאים לתור: נכס עם פין משוער ממתין לפין המדויק שלו
--
-- ‏`geocode_backfill_pending()` הוא השער של ה-cron (כל חמש דקות, רק כשיש
-- עבודה). ב-20271110120000 הורחב התור, `geocode_backfill_queue`, כך שנכס עם
-- פין **משוער** (‏`location_precision` = street / neighborhood / city) ורחוב
-- ומספר בית ממתין לפין מדויק מהשכבה העירונית. השער לא הורחב איתו:
-- הוא עדיין שואל רק `lat is null or lng is null`.
--
-- **התוצאה (26.11.2026):** 11 נכסים פעילים נמצאים בתור, והשער אומר "אין מה
-- לעשות", ולכן 864 הרצות ה-cron של שלושה ימים החזירו "0 rows" ואף אחד מהם
-- לא נוגע בהם. ‏`geocode_attempts` = 0 אצל כולם, חלקם מאוקטובר. נכס כזה
-- נשאר עם פין על מרכז העיר או הרחוב, ולכן **בלי שכונה** (שיוך שכונה נעשה
-- רק מפין מדויק, 20271117160000) - ואחד מכל ארבעה נכסים בלי שכונה
-- ב-342 הפעילים הוא מהסוג הזה או מקרוב אליו. זה הכשל ש-docs/geocoding.md
-- מתאר במפורש: "שער צר מהתור משאיר שורות בתור לנצח, בשקט".
--
-- התיקון: ענף הנכסים של השער זהה לענף הנכסים של התור (התנאי על הפין
-- בלבד נוסף). ענף העסקאות לא השתנה. אותה חתימה, אותן הרשאות.
-- ‏`scripts/check_geocode_gate.py` מצליב את שני הענפים ב-CI, כדי שהם לא
-- יתפצלו שוב.
--
-- אחרי ההחלה ה-cron הבא מגאוקד אותם (עד 3 ניסיונות לנכס), והפין שחוזר מדויק
-- ממלא גם שכונה (‏properties_set_neighborhood_trg). כתובת שאינה קיימת בשכבה
-- יוצאת מהתור אחרי שלושה ניסיונות ונשארת עם הפין המשוער, כמו היום.
--
-- אידמפוטנטית: ‏create or replace.
-- תיעוד: docs/geocoding.md, "השער היה סורק את כל טבלת העסקאות"
-- ===========================================================================

create or replace function public.geocode_backfill_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1
             from public.city_geocode_sources s
             join public.properties p
               on public.city_name_key(p.city) = s.city_key
            where s.active
              and p.status = 'active'
              and (p.lat is null or p.lng is null or p.location_precision in ('street', 'neighborhood', 'city'))
              and nullif(btrim(coalesce(p.street, '')), '')       is not null
              and nullif(btrim(coalesce(p.house_number, '')), '') is not null
              and p.geocode_attempts < 3::smallint
              and (p.geocode_attempted_at is null
                   or p.geocode_attempted_at < now() - interval '20 hours'))
      or exists (
           select 1
             from public.city_geocode_sources s
             join public.market_deals_official o
               on public.city_name_key(o.city) = s.city_key
            where s.active
              and (o.lat is null or o.lng is null)
              and nullif(btrim(coalesce(o.street, '')), '')       is not null
              and nullif(btrim(coalesce(o.house_number, '')), '') is not null
              and o.geocode_attempts < 3::smallint
              and (o.geocode_attempted_at is null
                   or o.geocode_attempted_at < now() - interval '20 hours'));
$$;

comment on function public.geocode_backfill_pending() is
  'האם יש מה לגאוקד - השער של ה-cron. אותם תנאים כמו geocode_backfill_queue (כולל פין משוער, 20271202160000), בלי union ובלי מיון. scripts/check_geocode_gate.py מצליב.';

revoke all on function public.geocode_backfill_pending() from public, anon, authenticated;
grant execute on function public.geocode_backfill_pending() to service_role;
