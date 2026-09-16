-- ============================================================================
-- העוזר בוואטסאפ: שת"פ והפקת סרטון
--
-- שתי יכולות שקיימות בדשבורד ולא היו נגישות לסוכן/ת מהצ'אט:
--
--   ‏1. **פתיחת נכס לשת"פ וביטולה.** הכפתורים יושבים ב"הנכסים שלי"
--      (‏docs/property-sharing.md), והבוט לא ידע להגיע אליהם.
--   ‏2. **הפקת סרטון שיווקי מהתמונות של הנכס** (‏docs/property-marketing-video.md).
--
-- ## למה צריך גרסאות "עם מזהה סוכן/ת מפורש"
--
-- ‏`share_property_with_partners` ו-`unshare_property` גוזרות את הזהות מ-
-- ‏`auth.uid()`. זו ההחלטה הנכונה לדפדפן: אפשר לחשוף אותן ל-`authenticated`
-- בלי שאפשר יהיה להפיץ נכס של מישהו אחר. אבל **לבוט אין JWT** — הוא מזהה את
-- הסוכן/ת לפי מספר הטלפון ורץ עם `service_role`, ולכן `auth.uid()` שם הוא
-- ‏null וכל קריאה הייתה חוזרת `agent_not_found`.
--
-- זו בדיוק התבנית של `agent_client_matches` ואחיותיה במיגרציה
-- ‏20261029090000: **המנוע עובר לפונקציה שמקבלת `p_agent_id`, והפונקציה
-- שחשופה לדפדפן נשארת כעטיפה שמזהה ומאצילה.** הקוד אינו משוכפל, ולכן
-- הדשבורד והבוט לא יכולים להתפצל בהתנהגות — מה שהיה קורה תוך חודש לשני
-- עותקים של אותה לוגיקת הפצה.
--
-- ## ומה חדש כאן שאינו רק "אותו דבר בערוץ אחר"
--
-- **‏`agent_property_video_quote`** — שאלה בלי תשובה עד היום: *כמה זה יעלה
-- לי, ומה נשאר לי במכסה?* בדשבורד הכפתור פשוט לא מוצג למי שאינו זכאי/ת,
-- והמחיר כתוב בעמוד המחירים. בצ'אט אין כפתור שאפשר להסתיר, ויש דבר אחר:
-- **‏₪25 יורדים מהארנק ברגע שהבקשה נפתחת.** סוכן/ת שכתב/ה "תעשה לי סרטון"
-- ומצא/ה חיוב שלא ציפה/תה לו הוא בדיוק מה שאסור שיקרה בערוץ שבו אין מסך
-- אישור. לכן יש כלי קריאה שמחזיר מחיר, יתרה ומכסה **בלי לגעת בכלום**,
-- וההוראות לבוט מחייבות לומר את המחיר ולקבל "כן" לפני ההפקה.
--
-- **התראת סיום** — ההפקה לוקחת דקות, וה-CRM עושה polling. מי שביקש/ה
-- בוואטסאפ סגר/ה את הצ'אט וממילא אין למה לעשות polling; ומי שביקש/ה
-- בדשבורד רשאי/ת לסגור את הדפדפן (זה כתוב במפורש בתיעוד), ואז גם הוא/היא
-- לא יודע/ת שהסרטון מוכן. ההתראה נכתבת ב-`complete_property_video_job`
-- וב-`fail_property_video_job` — כלומר בשתי נקודות הסיום היחידות, ששתיהן
-- כבר אידמפוטנטיות — ולכן שני הערוצים מקבלים אותה בלי קוד נוסף.
--
-- הסוג הוא `marketing_copy` ולא סוג חדש, ובכוונה: ‏`whatsapp_types` היא
-- רשימת מאושרים, וסוג חדש נולד **כבוי** אצל כל מי שכבר סימן את ההעדפות
-- שלו/ה (ראו 20261029090000 §7). סרטון שיווקי הוא תוכן שיווקי לנכס, בדיוק
-- כמו הטקסט השיווקי שכבר משתמש בסוג הזה, והוא מוביל לאותו מקום בדשבורד
-- (‏accProperties). סוג חדש היה מגיע אל אפס נמענים ביום שנולד.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. הפצת נכס לשת"פ — המנוע, עם מזהה סוכן/ת מפורש
--
-- הגוף הועבר לכאן מ-`share_property_with_partners` כלשונו, פרט לשורות
-- הזיהוי: במקום `auth.uid()` מגיע `p_agent_id`, ו-`active = true` נבדק
-- באותה שאילתה — סוכן/ת שכרטיסו/ה כובה אינו/ה מפיץ/ה נכסים, בדיוק כמו קודם.
-- ---------------------------------------------------------------------------
create or replace function public.share_property_for_agent(
  p_agent_id    uuid,
  p_property_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent       public.agency_members%rowtype;
  v_prop        public.properties%rowtype;
  v_agency_name text;
  v_added       int := 0;
  v_revoked     int := 0;
  v_total       int := 0;
begin
  select * into v_agent from public.agency_members
   where id = p_agent_id and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  if v_agent.agency_id is null then
    return jsonb_build_object('error', 'agent_without_agency');
  end if;

  -- ‏for update מסדר שתי בקשות מקבילות בטור, כך שהספירה המוחזרת לא תשקר
  select * into v_prop from public.properties where id = p_property_id for update;
  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;
  if v_prop.agent_id <> v_agent.id then
    return jsonb_build_object('error', 'not_your_property');
  end if;
  if v_prop.status <> 'active' then
    return jsonb_build_object('error', 'property_not_active');
  end if;

  select name into v_agency_name from public.agencies where id = v_agent.agency_id;

  -- ביטול הפצות למשרדים שהוסרו מרשימת השת"פ מאז ההפצה הקודמת
  -- (וגם למשרד של הסוכן/ת עצמו/ה, אם השתנה שיוך המשרד מאז)
  delete from public.property_shares ps
   where ps.property_id = p_property_id
     and (ps.shared_with_agency_id = v_agent.agency_id
          or exists (select 1 from public.agent_share_exclusions ex
                      where ex.agent_id = v_agent.id
                        and ex.agency_id = ps.shared_with_agency_id));
  get diagnostics v_revoked = row_count;

  -- ההפצה עצמה + ההתראות, בהצהרה אחת. ה-CTE של ההתראות נשען על ה-returning
  -- של ההוספה, ולכן מי שכבר קיבל את הנכס בעבר (on conflict do nothing) לא
  -- מקבל התראה שנייה על אותו נכס.
  with targets as (
    select a.id
      from public.agencies a
     where a.id is distinct from v_agent.agency_id
       and not exists (select 1 from public.agent_share_exclusions ex
                        where ex.agent_id = v_agent.id and ex.agency_id = a.id)
  ),
  ins as (
    insert into public.property_shares
      (property_id, owner_agent_id, owner_agency_id, shared_with_agency_id)
    select p_property_id, v_agent.id, v_agent.agency_id, t.id from targets t
    on conflict (property_id, shared_with_agency_id) do nothing
    returning shared_with_agency_id
  ),
  notified as (
    insert into public.notifications (agent_id, type, title, body)
    select m.id,
           'system',
           'נכס חדש שותף איתך',
           coalesce(v_agency_name, 'משרד שותף') || ' שיתף/ה איתך נכס: ' || v_prop.title
      from ins
      join public.agency_members m
        on m.agency_id = ins.shared_with_agency_id
       and m.active = true
    returning 1
  )
  select count(*) into v_added from ins;

  select count(*) into v_total from public.property_shares where property_id = p_property_id;

  -- ‏0 משרדים = הוסרו כולם מרשימת השת"פ (או שאין עדיין משרד נוסף בפלטפורמה).
  -- במקרה כזה הדגל נשאר כבוי, כדי שלא תופיע תגית "משותף" על נכס שאיש לא קיבל.
  update public.properties
     set shared_with_partners = (v_total > 0),
         shared_at            = case when v_total > 0 then now() else null end,
         updated_at           = now()
   where id = p_property_id;

  return jsonb_build_object(
    'success',      true,
    'shared_count', v_total,
    'newly_shared', v_added,
    'revoked',      v_revoked,
    'title',        v_prop.title
  );
end;
$$;

comment on function public.share_property_for_agent(uuid, uuid) is
  'מפיץ נכס לכל משרדי השת"פ של הסוכן/ת לפי מזהה מפורש — המנוע של share_property_with_partners, לשרת (הבוט בוואטסאפ) שאין לו JWT.';

revoke all on function public.share_property_for_agent(uuid, uuid) from public;
revoke all on function public.share_property_for_agent(uuid, uuid) from anon, authenticated;
grant execute on function public.share_property_for_agent(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. ביטול הפצה — המנוע
-- ---------------------------------------------------------------------------
create or replace function public.unshare_property_for_agent(
  p_agent_id    uuid,
  p_property_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title   text;
  v_owner   uuid;
  v_removed int := 0;
begin
  if p_agent_id is null then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  if not exists (select 1 from public.agency_members
                  where id = p_agent_id and active = true) then
    return jsonb_build_object('error', 'agent_not_found');
  end if;

  select agent_id, title into v_owner, v_title
    from public.properties where id = p_property_id for update;
  if not found then
    return jsonb_build_object('error', 'property_not_found');
  end if;
  if v_owner <> p_agent_id then
    return jsonb_build_object('error', 'not_your_property');
  end if;

  delete from public.property_shares where property_id = p_property_id;
  get diagnostics v_removed = row_count;

  update public.properties
     set shared_with_partners = false,
         shared_at            = null,
         updated_at           = now()
   where id = p_property_id;

  return jsonb_build_object('success', true, 'removed', v_removed, 'title', v_title);
end;
$$;

comment on function public.unshare_property_for_agent(uuid, uuid) is
  'מסיר נכס מכל משרדי השת"פ לפי מזהה סוכן/ת מפורש — המנוע של unshare_property, לשרת שאין לו JWT.';

revoke all on function public.unshare_property_for_agent(uuid, uuid) from public;
revoke all on function public.unshare_property_for_agent(uuid, uuid) from anon, authenticated;
grant execute on function public.unshare_property_for_agent(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. שתי הפונקציות של הדפדפן — עכשיו עטיפות
--
-- החתימה, ההרשאה וההתנהגות זהות למה שהיה; רק הגוף הוחלף בזיהוי + האצלה.
-- זה מה שמבטיח ששת"פ מהצ'אט ושת"פ מהדשבורד יישארו אותה פעולה בדיוק —
-- כולל ההתראות שיוצאות למשרדים שקיבלו את הנכס וכולל הסנכרון מול רשימת
-- ההסרות. שני עותקים של הלוגיקה הזו היו מתפצלים בשינוי הראשון.
--
-- ‏`current_agent_id()` ולא `auth.uid()` ישירות: זו כבר ההגדרה האחת של
-- "מי הסוכן/ת המחובר/ת" בפרויקט. ‏`active = true` נבדק בתוך המנוע.
-- ---------------------------------------------------------------------------
create or replace function public.share_property_with_partners(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent_id uuid;
begin
  v_agent_id := public.current_agent_id();
  if v_agent_id is null then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  return public.share_property_for_agent(v_agent_id, p_property_id);
end;
$$;

comment on function public.share_property_with_partners(uuid) is
  'מפיץ נכס לכל משרדי השת"פ של הסוכן/ת המחובר/ת ומתריע לחברי המשרדים שקיבלו אותו כעת. עטיפה מזהה מעל share_property_for_agent.';

revoke all on function public.share_property_with_partners(uuid) from public;
revoke all on function public.share_property_with_partners(uuid) from anon;
grant execute on function public.share_property_with_partners(uuid) to authenticated;

create or replace function public.unshare_property(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent_id uuid;
begin
  v_agent_id := public.current_agent_id();
  if v_agent_id is null then
    return jsonb_build_object('error', 'agent_not_found');
  end if;
  return public.unshare_property_for_agent(v_agent_id, p_property_id);
end;
$$;

comment on function public.unshare_property(uuid) is
  'מסיר נכס מכל משרדי השת"פ שקיבלו אותו ומכבה את סימון השיתוף. עטיפה מזהה מעל unshare_property_for_agent.';

revoke all on function public.unshare_property(uuid) from public;
revoke all on function public.unshare_property(uuid) from anon;
grant execute on function public.unshare_property(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. מצב השת"פ של נכס — קריאה, לבוט
--
-- "האם הנכס הזה פתוח לשת"פ ולכמה משרדים" נענה בדשבורד בתגית על שורת הנכס.
-- בצ'אט צריך מספר. ‏`excluded` הוא מה שמסביר תוצאה שנראית שגויה: סוכן/ת
-- שהסיר/ה את כל המשרדים מרשימת השת"פ יקבל/תקבל `shared_count = 0` אחרי
-- הפצה מוצלחת, וזו לא תקלה אלא ההגדרה שלו/ה.
-- ---------------------------------------------------------------------------
create or replace function public.agent_property_share_status(
  p_agent_id    uuid,
  p_property_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agency  uuid;
  v_prop    public.properties%rowtype;
  v_count   int := 0;
  v_names   text[];
  v_targets int := 0;
  v_excl    int := 0;
begin
  select agency_id into v_agency from public.agency_members
   where id = p_agent_id and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;

  select * into v_prop from public.properties
   where id = p_property_id and agent_id = p_agent_id;
  if not found then
    return jsonb_build_object('error', 'not_your_property');
  end if;

  select count(*), array_agg(a.name order by a.name)
    into v_count, v_names
    from public.property_shares ps
    join public.agencies a on a.id = ps.shared_with_agency_id
   where ps.property_id = p_property_id;

  select count(*) into v_excl
    from public.agent_share_exclusions where agent_id = p_agent_id;

  select count(*) into v_targets
    from public.agencies a
   where a.id is distinct from v_agency
     and not exists (select 1 from public.agent_share_exclusions ex
                      where ex.agent_id = p_agent_id and ex.agency_id = a.id);

  return jsonb_build_object(
    'success',          true,
    'property_id',      p_property_id,
    'title',            v_prop.title,
    'status',           v_prop.status,
    'shared',           coalesce(v_prop.shared_with_partners, false),
    'shared_count',     v_count,
    -- עד עשרה שמות: בוואטסאפ רשימה ארוכה מזה היא קיר, והמספר כבר נמסר.
    'shared_with',      (select array_agg(n)
                           from unnest(coalesce(v_names, '{}'::text[]))
                                with ordinality t(n, i)
                          where i <= 10),
    'targets_now',      v_targets,
    'excluded_count',   v_excl
  );
end;
$$;

comment on function public.agent_property_share_status(uuid, uuid) is
  'מצב השת"פ של נכס לפי מזהה סוכן/ת מפורש: האם מופץ, לכמה משרדים ולכמה היה מופץ אילו היה מסונכרן עכשיו. קריאה בלבד, ל-service_role.';

revoke all on function public.agent_property_share_status(uuid, uuid) from public;
revoke all on function public.agent_property_share_status(uuid, uuid) from anon, authenticated;
grant execute on function public.agent_property_share_status(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. הצעת מחיר להפקת סרטון — בלי לגעת בכלום
--
-- **הפונקציה הזו לא כותבת שורה ולא מזיזה שקל**, וזו כל מטרתה. ‏`start_property_video_job`
-- בודקת זכאות **ומחייבת** באותה טרנזקציה, וזו ההחלטה הנכונה שם (חיוב
-- ופתיחת בקשה חייבים להיות אטומיים). אבל היא גם אומרת שאין דרך לשאול "כמה
-- זה עולה" בלי לשלם — ובצ'אט זו הפעולה הראשונה שצריך.
--
-- מה שמוחזר הוא בדיוק מה שצריך כדי לנסח משפט אחד בעברית: זכאות, מחיר,
-- יתרה, מכסה חודשית שנותרה, האם כבר יש סרטון, והאם יש מספיק תמונות.
-- ‏`blocker` נושא את **אותם קודים** ש-`start_property_video_job` מחזירה,
-- ובאותו סדר בדיקה. זה לא נוי: הצעה שאומרת "אפשר" ופתיחה שמסרבת, או שני
-- ניסוחים לאותו מצב, הן בדיוק מה שגורם לסוכן/ת לחשוב שמשהו השתנה בין
-- השאלה לתשובה.
-- ---------------------------------------------------------------------------
create or replace function public.agent_property_video_quote(
  p_agent_id    uuid,
  p_property_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member   public.agency_members%rowtype;
  v_prop     public.properties%rowtype;
  v_tier     text;
  v_price    numeric := 0;
  v_cap      numeric;
  v_used     integer := 0;
  v_images   int := 0;
  v_min      numeric;
  v_open     boolean;
  v_reason   text := null;
begin
  select * into v_member from public.agency_members
   where id = p_agent_id and active = true;
  if not found then
    return jsonb_build_object('error', 'agent_not_found');
  end if;

  select * into v_prop from public.properties
   where id = p_property_id and agent_id = p_agent_id;
  if not found then
    return jsonb_build_object('error', 'not_your_property');
  end if;

  -- אותה פונקציה שקובעת זכאות בפתיחת הבקשה, ולא העתק של התנאים שלה.
  v_tier := public.property_video_tier(p_property_id, p_agent_id);

  -- ‏`images` הוא text[]. הספירה מדלגת על ריקים ו-null בדיוק כמו
  -- ‏`images.filter(Boolean)` ב-property-video-create — אחרת ההצעה הייתה
  -- מבטיחה סרטון שהפונקציה עצמה דוחה ב-not_enough_images.
  select count(*) into v_images
    from unnest(coalesce(v_prop.images, '{}'::text[])) u
   where u is not null and btrim(u) <> '';

  select coalesce(value, 2) into v_min
    from public.pricing_config where key = 'property_video_min_clips';
  v_min := coalesce(v_min, 2);

  v_open := exists (
    select 1 from public.property_video_jobs
     where property_id = p_property_id
       and status in ('generating_clips', 'merging', 'uploading')
  );

  if v_tier = 'premium' then
    select coalesce(value, 8) into v_cap
      from public.pricing_config where key = 'property_video_premium_monthly_cap';
    v_cap := coalesce(v_cap, 8);

    select count(*) into v_used
      from public.property_video_jobs
     where agent_id = p_agent_id
       and status <> 'failed'
       and created_at >= date_trunc('month', now());
  elsif v_tier is not null then
    select coalesce(value, 20) into v_price
      from public.pricing_config where key = 'property_video_price_mid';
    v_price := coalesce(v_price, 20);
  end if;

  -- החסימה הראשונה שתתקבל בפועל, באותם קודים של start_property_video_job.
  -- הסדר הוא סדר הבדיקות שם, כדי שההצעה לא תבטיח מה שהפתיחה תסרב לו.
  if v_tier is null then
    v_reason := 'not_eligible';
  elsif v_open then
    v_reason := 'job_in_progress';
  elsif v_images < v_min then
    v_reason := 'not_enough_images';
  elsif v_prop.video_url is not null then
    -- אינו חוסם: הוא דורש אישור מפורש להחליף. ראו replace_existing.
    v_reason := 'video_exists';
  elsif v_tier = 'premium' and v_used >= v_cap then
    v_reason := 'monthly_cap_reached';
  elsif v_tier <> 'premium' and coalesce(v_member.credit_balance, 0) < v_price then
    v_reason := 'insufficient_balance';
  end if;

  return jsonb_build_object(
    'success',           true,
    'property_id',       p_property_id,
    'title',             v_prop.title,
    'tier',              v_tier,
    'eligible',          v_tier is not null,
    'price',             v_price,
    'included',          v_tier = 'premium',
    'monthly_cap',       v_cap,
    'monthly_used',      v_used,
    'monthly_left',      case when v_tier = 'premium' then greatest(v_cap - v_used, 0) end,
    'credit_balance',    coalesce(v_member.credit_balance, 0),
    'images',            v_images,
    'min_images',        v_min,
    'has_video',         v_prop.video_url is not null,
    'job_in_progress',   v_open,
    'blocker',           v_reason
  );
end;
$$;

comment on function public.agent_property_video_quote(uuid, uuid) is
  'כמה תעלה הפקת סרטון לנכס ומה חוסם אותה — קריאה בלבד, בלי לפתוח בקשה ובלי לחייב. הקודים ב-blocker זהים לאלה של start_property_video_job.';

revoke all on function public.agent_property_video_quote(uuid, uuid) from public;
revoke all on function public.agent_property_video_quote(uuid, uuid) from anon, authenticated;
grant execute on function public.agent_property_video_quote(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. התראה כשהסרטון מוכן — ובאותה מידה כשהוא נכשל
--
-- ההפקה לוקחת דקות, ועד עכשיו הדרך היחידה לדעת שהיא נגמרה הייתה להשאיר את
-- ה-CRM פתוח ולחכות ל-polling. התיעוד עצמו מבטיח שאפשר לסגור את הדפדפן —
-- וזה נכון, ההפקה אינה תלויה בו — אבל מי שסגר/ה לא ידע/ה שהסרטון עלה.
-- מהצ'אט זה חמור יותר: הבוט אינו יוזם הודעה, ולכן בלי התראה אין שום סימן.
--
-- **גם הכישלון מודיע, ובמפורש על ההחזר.** בקשה שנכשלת מזכה את הארנק, ואם
-- איש לא אומר את זה — סוכן/ת רואה ₪25 שיורדים, סרטון שלא הגיע, ושקט.
--
-- שתי הפונקציות כבר אידמפוטנטיות (‏`status = 'done'` יוצא מוקדם, ‏`refunded`
-- מונע החזר כפול), ולכן ההתראה נכתבת בדיוק פעם אחת גם כששני מסלולים —
-- ה-callback וה-reconcile — מגיעים לאותה בקשה.
-- ---------------------------------------------------------------------------
create or replace function public.complete_property_video_job(p_job_id uuid, p_result_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job   public.property_video_jobs;
  v_title text;
begin
  select * into v_job from public.property_video_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('error', 'job_not_found');
  end if;
  if v_job.status = 'done' then
    return jsonb_build_object('success', true, 'already_done', true, 'result_url', v_job.result_url);
  end if;

  update public.properties set video_url = p_result_url where id = v_job.property_id
    returning title into v_title;

  update public.property_video_jobs
     set status = 'done', result_url = p_result_url, error_detail = null, updated_at = now()
   where id = p_job_id;

  -- ‏marketing_copy ולא סוג חדש: ראו ההסבר בראש הקובץ. הטריגר
  -- ‏notifications_apply_preferences מסנן בשקט סוכן/ת שהשתיק/ה את הסוג.
  insert into public.notifications (agent_id, type, title, body)
  values (
    v_job.agent_id,
    'marketing_copy',
    'הסרטון מוכן: ' || coalesce(v_title, 'נכס'),
    'הסרטון השיווקי הופק והוצמד לנכס.'
      || case when v_job.replaced_existing then ' הסרטון הקודם הוחלף.' else '' end
  );

  return jsonb_build_object(
    'success', true,
    'result_url', p_result_url,
    'previous_video_url', v_job.previous_video_url
  );
end;
$$;

comment on function public.complete_property_video_job(uuid, text) is
  'מצמידה את הסרטון לנכס, סוגרת את הבקשה ומודיעה לסוכן/ת. אידמפוטנטית — בקשה שכבר done יוצאת מוקדם, ולכן ההתראה נכתבת פעם אחת.';

revoke all on function public.complete_property_video_job(uuid, text) from public;
revoke all on function public.complete_property_video_job(uuid, text) from anon;
revoke all on function public.complete_property_video_job(uuid, text) from authenticated;
grant execute on function public.complete_property_video_job(uuid, text) to service_role;

create or replace function public.fail_property_video_job(p_job_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job     public.property_video_jobs;
  v_refund  numeric := 0;
  v_title   text;
  v_notify  boolean := false;
begin
  select * into v_job from public.property_video_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('error', 'job_not_found');
  end if;
  if v_job.status = 'done' then
    return jsonb_build_object('error', 'already_done');
  end if;

  -- ‏ההתראה יוצאת רק במעבר לכישלון. ‏reconcile ו-callback יכולים שניהם להגיע
  -- לאותה בקשה, ובקשה שכבר failed לא מתריעה שוב — בדיוק כמו שהיא לא מחזירה
  -- כסף שוב.
  if v_job.status <> 'failed' then
    update public.property_video_jobs
       set status = 'failed', error_detail = p_reason, updated_at = now()
     where id = p_job_id;
    v_notify := true;
  end if;

  if v_job.amount_charged > 0 and not v_job.refunded then
    update public.agency_members
       set credit_balance = credit_balance + v_job.amount_charged
     where id = v_job.agent_id;

    update public.property_video_jobs set refunded = true where id = p_job_id;
    update public.property_video_charges
       set status = 'refunded'
     where job_id = p_job_id and status = 'charged';

    v_refund := v_job.amount_charged;
  end if;

  if v_notify then
    select title into v_title from public.properties where id = v_job.property_id;
    insert into public.notifications (agent_id, type, title, body)
    values (
      v_job.agent_id,
      'marketing_copy',
      'הפקת הסרטון נכשלה: ' || coalesce(v_title, 'נכס'),
      case when v_refund > 0
           -- ‏rtrim על הנקודה: ‎FM…0.99‎ מחזיר "25." לסכום עגול, ו-"‏₪25." בהודעה
           -- נראה כמו מספר שנקטע.
           then 'הארנק זוכה ב-₪' || rtrim(trim(to_char(v_refund, 'FM999999990.99')), '.') || '. אפשר לנסות שוב.'
           else 'לא נגבה תשלום. אפשר לנסות שוב.' end
    );
  end if;

  return jsonb_build_object('success', true, 'refunded', v_refund);
end;
$$;

comment on function public.fail_property_video_job(uuid, text) is
  'מסמנת בקשת סרטון ככושלת, מזכה את הארנק ומודיעה לסוכן/ת. אידמפוטנטית — החזר והתראה יוצאים פעם אחת בלבד.';

revoke all on function public.fail_property_video_job(uuid, text) from public;
revoke all on function public.fail_property_video_job(uuid, text) from anon;
revoke all on function public.fail_property_video_job(uuid, text) from authenticated;
grant execute on function public.fail_property_video_job(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. מעקב אחרי בקשה פתוחה — לפי נכס, לא לפי job_id
--
-- ‏`property_video_job_status` מקבלת `job_id`, וזה נכון ל-CRM שפתח/ה את
-- הבקשה ומחזיק/ה בו. בצ'אט הסוכן/ת שואל/ת "מה קורה עם הסרטון של הדירה
-- בעלייה 20" — המזהה שיש הוא של הנכס. הבעלות נבדקת כאן מפורשות, כי בניגוד
-- ל-job_id שם הנכס אינו סוד.
-- ---------------------------------------------------------------------------
create or replace function public.agent_property_video_status(
  p_agent_id    uuid,
  p_property_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job    public.property_video_jobs;
  v_prop   public.properties%rowtype;
  v_total  int := 0;
  v_done   int := 0;
  v_failed int := 0;
begin
  select * into v_prop from public.properties
   where id = p_property_id and agent_id = p_agent_id;
  if not found then
    return jsonb_build_object('error', 'not_your_property');
  end if;

  select * into v_job from public.property_video_jobs
   where property_id = p_property_id
   order by created_at desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'success', true, 'has_job', false,
      'title', v_prop.title, 'video_url', v_prop.video_url
    );
  end if;

  select count(*),
         count(*) filter (where status = 'done'),
         count(*) filter (where status = 'failed')
    into v_total, v_done, v_failed
    from public.property_video_clips where job_id = v_job.id;

  return jsonb_build_object(
    'success',      true,
    'has_job',      true,
    'title',        v_prop.title,
    'status',       v_job.status,
    'created_at',   v_job.created_at,
    'clips_total',  v_total,
    'clips_done',   v_done,
    'clips_failed', v_failed,
    'result_url',   v_job.result_url,
    'error_detail', v_job.error_detail,
    'video_url',    v_prop.video_url
  );
end;
$$;

comment on function public.agent_property_video_status(uuid, uuid) is
  'מצב הפקת הסרטון האחרונה של נכס, לפי מזהה נכס ומזהה סוכן/ת — הגרסה של property_video_job_status לבוט, שאין לו את ה-job_id.';

revoke all on function public.agent_property_video_status(uuid, uuid) from public;
revoke all on function public.agent_property_video_status(uuid, uuid) from anon, authenticated;
grant execute on function public.agent_property_video_status(uuid, uuid) to service_role;
