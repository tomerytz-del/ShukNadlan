-- ============================================================================
-- מדריך ההתחלה — ששת הצעדים הראשונים של סוכן/ת חדש/ה
--
-- ## מה שבור היום
--
-- סוכן/ת שנרשם/ת מגיע/ה לדשבורד מלא ביכולות, וכל אחת מהן מחכה שיחפשו אותה.
-- מה שקורה בפועל אצל מי שנכנס/ת בפעם הראשונה:
--
-- | מה קיים | מה נעשה איתו בשבוע הראשון |
-- | --- | --- |
-- | עוזר אישי בוואטסאפ (‏mid ומעלה) | לא מחובר — המספר לא נשמר, ולכן הבוט לא מזהה |
-- | דף סוכן/ת ציבורי | בלי תמונה ובלי תמונת נושא — דף אפור עם שם |
-- | דף משרד (למנהל/ת) | בלי לוגו ובלי תמונת נושא |
-- | נכסים, לקוחות, הסכמים | ריק, ואין מה שמזכיר שזו ההתחלה |
-- | חנות הלידים | מלאי שלם שאיש לא נכנס אליו |
--
-- אף אחד מהמצבים האלה אינו שגיאה, ולכן אף אחד מהם לא מדווח על עצמו. הפעמון
-- מדווח על **אירועים**, והתזכורות (`agent_reminder_findings`) מדווחות על
-- **מודעות קיימות** — שתיהן שותקות בדיוק אצל מי שעוד אין לו/ה כלום.
--
-- ## מה נכנס
--
-- שישה צעדים בסדר קבוע, לסוכן/ת במסלול `mid`/`premium` בלבד:
--
--   1. חיבור לעוזר האישי בוואטסאפ
--   2. תמונת פרופיל + תמונת נושא (ולמנהל/ת משרד — גם לוגו ותמונת נושא למשרד)
--   3. הנכס הראשון
--   4. הלקוח/ה הראשון/ה
--   5. ההסכם הראשון
--   6. הליד הראשון מחנות הלידים
--
-- שני הראשונים הם **הכוונה** במסך (הכרטיס ב-crm.html). ארבעת האחרונים הם גם
-- **דרבון בפעמון**: התראה שנולדת ברגע שהצעד שלפניה נסגר, ומובילה לצעד הבא.
--
-- הסדר אינו שרירותי — הוא השרשרת העסקית עצמה: נכס ולקוח/ה הם המלאי, ההסכם
-- הוא ההתחייבות שהופכת אותם לעמלה, וחנות הלידים היא מאיפה מגיע הלקוח/ה הבא.
-- ולכן כל צעד גם **אפשרי** רק אחרי זה שלפניו: אין הסכם בלי צד ובלי נכס.
--
-- ### למה `mid` ומעלה
--
-- הצעד הראשון הוא העוזר בוואטסאפ, והוא עצמו מגודר ל-`mid`/`premium`
-- (‏`whatsapp-webhook`, ראו `docs/pricing-and-tiers.md`). מדריך שמתחיל
-- בהוראה לעשות משהו שהמסלול אינו כולל הוא פרסומת, לא הכוונה.
--
-- ## שלוש החלטות שמסבירות את המבנה
--
-- ### 1. המצב מחושב, ואינו רשימת משימות שמסמנים
--
-- אותה דוקטרינה של `agent_reminder_findings`: אין טבלת צ׳קליסט ואין שורה
-- ש"מסמנים כבוצע". `agent_onboarding_state()` שואלת את המציאות בכל קריאה —
-- יש שורה ב-`whatsapp_conversations`? יש `photo_url`? יש נכס? — ולכן צעד
-- שנסגר **מחוץ לדשבורד** נסגר גם כאן: נכס שנפתח מהעוזר בוואטסאפ סוגר את
-- צעד 3 בדיוק כמו נכס שנפתח בטופס.
--
-- שתי עמודות בלבד נשמרות, ושתיהן על **המדריך** ולא על הצעדים:
-- ‏`onboarding_started_at` (מתי הוא נפתח) ו-`onboarding_done_at` (מתי נסגר).
--
-- ### 2. המדריך נפתח למי שעוד לא התחיל/ה לעבוד, ולא לפי תאריך
--
-- התנאי לפתיחה הוא **אין נכסים ואין לקוחות**. זה מה שמבדיל "נכנס/ה עכשיו"
-- מ"ותיק/ה שלא העלה/תה תמונת נושא", בלי תאריך קסם בקוד שיהפוך לשקר בעוד
-- שנה. ותיק/ה עם 57 נכסים לא יראה/תראה מדריך התחלה גם אם חסרים לו/ה שלושה
-- מהצעדים.
--
-- ### 3. הדרבון הוא טריגר על אירוע, ולא cron ששואל "האם עדיין אין"
--
-- ‏`onboarding_property` נולדת ברגע שהתמונות נשמרות, `onboarding_client`
-- ברגע שהנכס הראשון נוצר, `onboarding_agreement` ברגע שנכנס/ה הלקוח/ה
-- הראשון/ה, ו-`onboarding_lead` ברגע שנוצר ההסכם הראשון. כל אחת נבדקת מול
-- המציאות לפני ההכנסה (אין עדיין נכס / לקוח/ה / הסכם / ליד), וכולן נכנסות
-- **פעם אחת** — `not exists` על הסוג בטבלת ההתראות הוא כל מנגנון ה-de-dup
-- שצריך כאן.
--
-- מה שמכסה את מי שנתקע/ה באמצע הוא מנגנון קיים ולא חדש: `idle_listings`
-- ב-`agent_reminder_findings` מזכיר/ה אחרי שבוע בלי נכס חדש, ויש בו כבר
-- תנאי שמונע נדנוד ביום הראשון.
--
-- הקובץ אידמפוטנטי — אפשר להריץ אותו שוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. שתי העמודות
--
-- אינן נעולות ב-`protect_sensitive_agency_member_fields` בכוונה: הן אינן
-- שדות כסף ואינן שדות הרשאה. הגרוע ביותר שמי שיכתוב/תכתוב אותן מהדפדפן
-- ישיג/תשיג הוא להסתיר לעצמו/ה מדריך — וזו ממילא פעולה שהכרטיס מציע.
-- ---------------------------------------------------------------------------
alter table public.agency_members
  add column if not exists onboarding_started_at timestamptz,
  add column if not exists onboarding_done_at    timestamptz;

comment on column public.agency_members.onboarding_started_at is
  'מתי נפתח מדריך ההתחלה. null = מעולם לא נפתח (ותיק/ה, או מסלול שאינו mid/premium).';
comment on column public.agency_members.onboarding_done_at is
  'מתי המדריך נסגר — בסיום כל הצעדים או בהסתרה ידנית. חוסם גם את ארבע התראות הדרבון.';

-- ---------------------------------------------------------------------------
-- 2. שלושת הפרדיקטים המשותפים
--
-- שלושתם נקראים גם מפונקציית המצב (הדפדפן) וגם מהטריגרים, וזו כל
-- הסיבה שהם פונקציות ולא תנאי משוכפל: תנאי שמופיע בשני מקומות מתפצל, ואז
-- הכרטיס אומר "נשאר צעד אחד" בזמן שההתראה כבר יצאה.
-- ---------------------------------------------------------------------------

-- צעד 2: תמונת פרופיל ותמונת נושא — ולמנהל/ת משרד גם לוגו ותמונת נושא
-- למשרד. מנהל/ת שדף המשרד שלו/ה ריק הוא מנהל/ת שכל הצוות מוצג מתחת לכותרת
-- אפורה, ולכן זה חלק מאותו צעד ולא צעד בפני עצמו.
create or replace function public.agent_onboarding_photos_done(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select btrim(coalesce(m.photo_url, '')) <> ''
       and btrim(coalesce(m.cover_url, '')) <> ''
       and (coalesce(m.role, '') <> 'manager'
            or coalesce((
                 select btrim(coalesce(a.logo_url, '')) <> ''
                    and btrim(coalesce(a.cover_url, '')) <> ''
                   from agencies a
                  where a.id = m.agency_id), false))
      from agency_members m
     where m.id = p_agent_id), false);
$$;

comment on function public.agent_onboarding_photos_done(uuid) is
  'האם צעד התמונות נסגר: תמונת סוכן/ת + תמונת נושא, ולמנהל/ת משרד גם לוגו ותמונת נושא למשרד.';

-- צעד 6: ליד שנרכש. "חנות הלידים" היא מדף אחד בממשק וארבע טבלאות מתחתיו,
-- וכל אחת מהן רושמת את הקנייה אצלה: ליד ישיר נפתח ב-`leads.unlocked_by`
-- (‏`claim_lead`), ושלוש המגירות האחרות מסמנות `sold_to_agent_id` משלהן.
-- בדיקה אחת מהן בלבד הייתה משאירה את הצעד פתוח אצל מי שקנה/תה ליד משכנתא
-- ועשה/תה בדיוק את מה שהתבקש/ה.
--
-- ‏`project_leads` אינו כאן: הוא נמכר ליזם (`sold_to_developer_id`), לא
-- לסוכן/ת, ואין לו מה לסגור במדריך של מתווך/ת.
create or replace function public.agent_onboarding_lead_done(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from leads          l where l.unlocked_by      = p_agent_id)
      or exists (select 1 from saved_searches s where s.sold_to_agent_id = p_agent_id)
      or exists (select 1 from mortgage_leads m where m.sold_to_agent_id = p_agent_id)
      or exists (select 1 from rss_leads      r where r.sold_to_agent_id = p_agent_id);
$$;

comment on function public.agent_onboarding_lead_done(uuid) is
  'האם נרכש ליד אחד לפחות, בכל אחת מארבע המגירות של חנות הלידים.';

-- שני האינדקסים שחסרו לבדיקה הזו. חלקיים בכוונה, כמו mortgage_leads_sold_to_idx
-- שכבר קיים: רק שורה שנמכרה מעניינת כאן, ו-rss_leads היא טבלה שגדלה מעצמה
-- בכל סבב של מנוע הלידים.
create index if not exists leads_unlocked_by_idx
  on public.leads (unlocked_by) where unlocked_by is not null;
create index if not exists rss_leads_sold_to_idx
  on public.rss_leads (sold_to_agent_id) where sold_to_agent_id is not null;

-- האם המדריך פתוח **עכשיו**. המסלול נבדק כאן ולא רק בפתיחה, כי ירידה
-- ל-Pay&GO באמצע המדריך מורידה גם את הצעד הראשון עצמו.
create or replace function public.agent_onboarding_active(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from agency_members m
     where m.id = p_agent_id
       and m.active = true
       and m.tier in ('mid', 'premium')
       and m.onboarding_started_at is not null
       and m.onboarding_done_at is null
  );
$$;

comment on function public.agent_onboarding_active(uuid) is
  'האם מדריך ההתחלה פתוח לסוכן/ת הזה/זו ברגע זה. תנאי מקדים לכל התראות הדרבון.';

-- ---------------------------------------------------------------------------
-- 3. המצב שהדשבורד קורא
--
-- ‏security definer, ובלי ארגומנט: המזהה נגזר מ-`current_agent_id()` ולא
-- מפרמטר. פונקציה שמקבלת `p_agent_id` מהדפדפן הייתה מחייבת שער מפורש
-- שיוודא שהמזהה הוא של הקורא/ת — כאן אין מה לזייף.
--
-- **היא גם כותבת, וזו החלטה ולא תופעת לוואי.** החותמות של פתיחת המדריך
-- וסגירתו נגזרות בדיוק מאותו חישוב שמחזיר את המצב, ולכן הן נעשות איתו
-- באותה קריאה: פיצול לשתי קריאות היה מזמין מרוץ בין שתי לשוניות פתוחות,
-- ומצב שבו המדריך נראה פתוח בזמן שהחותמת אומרת שנסגר.
--
-- ‏`just_finished` אמיתי רק בקריאה שסגרה את המדריך, ולכן הוא מגיע פעם אחת —
-- וזה בדיוק אורך החיים של "סיימת".
-- ---------------------------------------------------------------------------
create or replace function public.agent_onboarding_state()
returns table (
  is_manager     boolean,
  whatsapp_done  boolean,
  profile_done   boolean,
  agency_done    boolean,
  property_done  boolean,
  client_done    boolean,
  agreement_done boolean,
  lead_done      boolean,
  just_finished  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid := public.current_agent_id();
  v_member   record;
  v_wa       boolean;
  v_photos   boolean;
  v_profile  boolean;
  v_agency   boolean;
  v_prop     boolean;
  v_client   boolean;
  v_agr      boolean;
  v_lead     boolean;
  v_just     boolean := false;
  v_rows     integer;
begin
  if v_id is null then
    return;                       -- אין כרטיס סוכן/ת: אין מדריך, ואין שגיאה
  end if;

  select m.id, m.role, m.tier, m.active, m.agency_id, m.photo_url, m.cover_url,
         m.onboarding_started_at, m.onboarding_done_at
    into v_member
    from agency_members m
   where m.id = v_id;

  if not found or v_member.active is not true
     or v_member.tier not in ('mid', 'premium') then
    return;
  end if;

  if v_member.onboarding_done_at is not null then
    return;                       -- הושלם או הוסתר — ולתמיד
  end if;

  v_prop   := exists (select 1 from properties    p where p.agent_id = v_id);
  v_client := exists (select 1 from agent_clients c where c.agent_id = v_id);

  -- הפתיחה: רק למי שעוד לא התחיל/ה לעבוד. ותיק/ה שחסרה לו/ה תמונת נושא
  -- אינו/ה "סוכן/ת חדש/ה", וכרטיס "מדריך ההתחלה" אצלו/ה נראה כמו תקלה.
  if v_member.onboarding_started_at is null then
    if v_prop or v_client then
      return;
    end if;
    update agency_members
       set onboarding_started_at = now()
     where id = v_id
       and onboarding_started_at is null;
  end if;

  v_wa      := exists (select 1 from whatsapp_conversations w where w.agent_id = v_id);
  v_agr     := exists (select 1 from agreements a where a.agent_id = v_id);
  v_lead    := public.agent_onboarding_lead_done(v_id);
  v_photos  := public.agent_onboarding_photos_done(v_id);
  -- ‏profile_done ו-agency_done מוחזרים בנפרד כדי שהכרטיס יוכל לומר *מה*
  -- חסר; ‏v_photos הוא ה-and שלהם, והוא מה שנבדק בכל מקום אחר.
  v_profile := btrim(coalesce(v_member.photo_url, '')) <> ''
           and btrim(coalesce(v_member.cover_url, '')) <> '';
  v_agency  := case when coalesce(v_member.role, '') = 'manager'
                    then coalesce((select btrim(coalesce(a.logo_url, '')) <> ''
                                      and btrim(coalesce(a.cover_url, '')) <> ''
                                     from agencies a where a.id = v_member.agency_id), false)
                    else true end;

  if v_wa and v_photos and v_prop and v_client and v_agr and v_lead then
    update agency_members
       set onboarding_done_at = now()
     where id = v_id
       and onboarding_done_at is null;
    get diagnostics v_rows = row_count;
    v_just := v_rows > 0;
  end if;

  return query select
    coalesce(v_member.role, '') = 'manager',
    v_wa, v_profile, v_agency, v_prop, v_client, v_agr, v_lead, v_just;
end;
$$;

comment on function public.agent_onboarding_state() is
  'מצב מדריך ההתחלה של הסוכן/ת המחובר/ת. מחזירה שורה אחת כשהמדריך פתוח, ואפס שורות אחרת. מחושבת מהמציאות, ומחזיקה את שתי החותמות.';

-- הסתרה ידנית. אין "דילוג על צעד": מי שלא רוצה את המדריך סוגר/ת אותו כולו,
-- ומי שרוצה רק את הצעד הרביעי פשוט עושה אותו — הצעדים אינם נעולים זה בזה.
create or replace function public.agent_onboarding_dismiss()
returns void
language sql
security definer
set search_path = public
as $$
  update agency_members
     set onboarding_done_at = now()
   where id = public.current_agent_id()
     and onboarding_done_at is null;
$$;

comment on function public.agent_onboarding_dismiss() is
  'סגירת מדריך ההתחלה ביוזמת הסוכן/ת. סוגרת גם את התראות הדרבון — הסתרה היא בקשה להפסיק, לא רק להעלים כרטיס.';

-- ---------------------------------------------------------------------------
-- 4. ארבעת סוגי ההתראה
--
-- סוג לכל צעד ולא סוג אחד ל"מדריך", כי `notifications.type` הוא גם הניתוב
-- בלחיצה: כל אחת מהן מובילה לקטגוריה אחרת. סוג אחד היה מחייב לנחש מהכותרת
-- לאן ללכת. הרשימה נכתבת במלואה — זו הדרך היחידה לשנות CHECK.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_lead','system','review_request','review_alert',
                  'client_match','review_new','deal_closed','lead_unrouted',
                  'marketing_copy','agreement_signed','platform_signup',
                  'platform_upgrade','onboarding_property','onboarding_client',
                  'onboarding_agreement','onboarding_lead'));

-- ---------------------------------------------------------------------------
-- 5. הדרבון
--
-- ‏`p_type` אינו טקסט חופשי: שני ערכים מותרים, והשאר יוצא בשקט. הפונקציה
-- נקראת רק מהטריגרים כאן, אבל היא `security definer` שכותבת ל-`notifications`
-- — וכזו לא נשארת עם פרמטר פתוח.
--
-- הכתיבה עטופה ב-`begin/exception`, ומאותו נימוק בדיוק שכתוב ב-
-- `notify_platform_admins_on_tier_upgrade`: היא רצה **בתוך הטרנזקציה של
-- שמירת הנכס או של שמירת הפרופיל**. התראת עידוד שמפילה את הנכס שעליו היא
-- מעודדת היא הכישלון הגרוע ביותר שיכול להיות כאן.
-- ---------------------------------------------------------------------------
create or replace function public.agent_onboarding_nudge(p_agent_id uuid, p_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body  text;
begin
  if p_agent_id is null
     or p_type not in ('onboarding_property', 'onboarding_client',
                       'onboarding_agreement', 'onboarding_lead') then
    return;
  end if;
  if not public.agent_onboarding_active(p_agent_id) then
    return;
  end if;
  -- פעם אחת בחיים, לכל סוג. אין כאן חלון זמן ואין קצב: זו לא תזכורת חוזרת
  -- אלא הצעד הבא במדריך.
  if exists (select 1 from notifications n
              where n.agent_id = p_agent_id and n.type = p_type) then
    return;
  end if;

  if p_type = 'onboarding_property' then
    v_title := 'הנכס הראשון שלך';
    v_body  := 'הפרופיל שלך מוכן ומוצג ללקוחות. עכשיו הנכס הראשון — מהדשבורד, '
            || 'או בהודעה לעוזר בוואטסאפ ("תעלה נכס חדש ב…").';
  elsif p_type = 'onboarding_client' then
    v_title := 'הלקוח/ה הראשון/ה בקובץ';
    v_body  := 'הנכס הראשון באוויר. קובץ הלקוחות הוא מה שמפעיל את ההתאמות: '
            || 'כל לקוח/ה שנכנס/ת מוצלב/ת אוטומטית מול הנכסים החדשים.';
  elsif p_type = 'onboarding_agreement' then
    v_title := 'ההסכם הראשון';
    v_body  := 'יש נכס ויש לקוח/ה — וזה כל מה שצריך להזמנת שירותי תיווך. '
            || 'האשף ממלא את המסמך מהפרטים שכבר במערכת, והחתימה נשלחת בקישור.';
  else
    v_title := 'הליד הראשון מחנות הלידים';
    v_body  := 'ההסכם הראשון נוצר. חנות הלידים היא מאיפה מגיע הלקוח/ה הבא/ה: '
            || 'לידי בעל-נכס, מחפשי דירה ולידי משכנתא, לפי אזורי הפעילות שלך.';
  end if;

  begin
    insert into notifications (agent_id, type, title, body)
    values (p_agent_id, p_type, v_title, v_body);
  exception when others then
    raise warning 'agent_onboarding_nudge failed for % (%): %', p_agent_id, p_type, sqlerrm;
  end;
end;
$$;

comment on function public.agent_onboarding_nudge(uuid, text) is
  'מכניסה התראת דרבון אחת של מדריך ההתחלה, אם המדריך פתוח והיא טרם נשלחה. כישלון בה אינו מפיל את הפעולה שקראה לה.';

-- ---------------------------------------------------------------------------
-- 6. חמשת הטריגרים
--
-- שניים לצעד התמונות (הפרופיל האישי ודף המשרד — שני מקורות לאותו צעד),
-- ואחד לכל אחד משלושת הצעדים שאחריו: הנכס הראשון, הלקוח/ה הראשון/ה וההסכם
-- הראשון. כל אחד מהם פותח את הדרבון על **הצעד הבא**, ולכן השרשרת ממשיכה
-- מעצמה כל עוד היא מתקדמת — וגם אם שלב מסוים נעשה מהעוזר בוואטסאפ.
--
-- אין טריגר על הליד הנרכש: הוא הצעד האחרון, ואין אחריו למה לדרבן. הסגירה
-- שלו נרשמת בקריאה הבאה ל-`agent_onboarding_state()`.
-- ---------------------------------------------------------------------------

-- 6א. תמונות הסוכן/ת נשמרו
create or replace function public.agency_members_onboarding_nudge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- הבדיקה הזולה ראשונה: חיפוש מפתח ראשי אחד ב-agency_members, והוא מוציא
  -- מהדרך את כל מי שאינו בתוך מדריך ההתחלה — כלומר כמעט כל שמירת פרופיל
  -- שתתרחש אי פעם
  if not public.agent_onboarding_active(new.id) then
    return null;
  end if;
  if not public.agent_onboarding_photos_done(new.id) then
    return null;
  end if;
  -- הדרבון הוא "עכשיו הנכס הראשון", ולכן הוא מיותר למי שכבר יש לו/ה נכס
  if exists (select 1 from properties p where p.agent_id = new.id) then
    return null;
  end if;
  perform public.agent_onboarding_nudge(new.id, 'onboarding_property');
  return null;
end;
$$;

drop trigger if exists agency_members_onboarding_nudge on public.agency_members;
create trigger agency_members_onboarding_nudge
  after update of photo_url, cover_url on public.agency_members
  for each row
  when (new.photo_url is distinct from old.photo_url
     or new.cover_url is distinct from old.cover_url)
  execute function public.agency_members_onboarding_nudge();

-- 6ב. מיתוג המשרד נשמר — הצעד נסגר למנהל/ת שהתמונות האישיות שלו/ה כבר שם.
-- הלולאה על מנהלי המשרד ולא על מי שלחץ/ה: השמירה יכולה להגיע גם ממנהל/ת
-- שני/ה באותו משרד, והצעד הוא של כל מי שדף המשרד הזה הוא שלו/ה.
create or replace function public.agencies_onboarding_nudge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager uuid;
begin
  for v_manager in
    select m.id from agency_members m
     where m.agency_id = new.id
       and m.role = 'manager'
       and m.onboarding_started_at is not null
       and m.onboarding_done_at is null
  loop
    if public.agent_onboarding_photos_done(v_manager)
       and not exists (select 1 from properties p where p.agent_id = v_manager) then
      perform public.agent_onboarding_nudge(v_manager, 'onboarding_property');
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists agencies_onboarding_nudge on public.agencies;
create trigger agencies_onboarding_nudge
  after update of logo_url, cover_url on public.agencies
  for each row
  when (new.logo_url is distinct from old.logo_url
     or new.cover_url is distinct from old.cover_url)
  execute function public.agencies_onboarding_nudge();

-- 6ג. הנכס הראשון נוצר
--
-- ‏`after insert` על `properties` ולא קריאה מה-CRM: הנכס הראשון של סוכן/ת
-- חדש/ה נולד לא פעם דווקא מהעוזר בוואטסאפ — שזה, בסך הכול, הצעד הראשון
-- באותו מדריך.
create or replace function public.properties_onboarding_nudge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agent_id is null then
    return null;
  end if;
  -- הזולה ראשונה, וכאן זה נמדד: הטריגר הזה רץ על **כל** נכס שנכנס למערכת,
  -- כולל ייבוא של מאות שורות. חיפוש מפתח ראשי אחד מוציא מהדרך את כל מי
  -- שאינו בתוך מדריך ההתחלה, לפני שנוגעים ב-properties בכלל.
  if not public.agent_onboarding_active(new.agent_id) then
    return null;
  end if;
  -- "הראשון" ולא "עוד אחד"
  if exists (select 1 from properties p
              where p.agent_id = new.agent_id and p.id <> new.id) then
    return null;
  end if;
  -- הדרבון הוא על **הצעד הפתוח הבא**, ולא על השורה הבאה ברשימה: מי
  -- שהכניס/ה לקוח/ה לפני שהיה לו/ה נכס כבר סגר/ה את צעד 4, ודרבון "הוסף
  -- לקוח/ה" אצלו/ה הוא הודעה על משהו שכבר עשה/תה. בלי ההסתעפות הזו הוא
  -- היה נופל בין הכיסאות: הטריגר על הלקוח/ה יצא בלי נכס, וזה יצא בלי
  -- לקוח/ה, ואיש לא היה מדרבן על ההסכם.
  if not exists (select 1 from agent_clients c where c.agent_id = new.agent_id) then
    perform public.agent_onboarding_nudge(new.agent_id, 'onboarding_client');
  elsif not exists (select 1 from agreements a where a.agent_id = new.agent_id) then
    perform public.agent_onboarding_nudge(new.agent_id, 'onboarding_agreement');
  end if;
  return null;
end;
$$;

drop trigger if exists properties_onboarding_nudge on public.properties;
create trigger properties_onboarding_nudge
  after insert on public.properties
  for each row
  execute function public.properties_onboarding_nudge();

-- 6ד. הלקוח/ה הראשון/ה נכנס/ה → הדרבון על ההסכם
create or replace function public.agent_clients_onboarding_nudge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agent_id is null then
    return null;
  end if;
  if not public.agent_onboarding_active(new.agent_id) then
    return null;
  end if;
  if exists (select 1 from agent_clients c
              where c.agent_id = new.agent_id and c.id <> new.id) then
    return null;
  end if;
  -- הזמנת שירותי תיווך צריכה גם צד וגם נכס. מי שהכניס/ה לקוח/ה לפני שיש
  -- לו/ה נכס יקבל/תקבל את הדרבון בסיבוב הבא — כשהנכס הראשון ייכנס.
  if not exists (select 1 from properties p where p.agent_id = new.agent_id) then
    return null;
  end if;
  if exists (select 1 from agreements a where a.agent_id = new.agent_id) then
    return null;
  end if;
  perform public.agent_onboarding_nudge(new.agent_id, 'onboarding_agreement');
  return null;
end;
$$;

drop trigger if exists agent_clients_onboarding_nudge on public.agent_clients;
create trigger agent_clients_onboarding_nudge
  after insert on public.agent_clients
  for each row
  execute function public.agent_clients_onboarding_nudge();

-- 6ה. ההסכם הראשון נוצר → הדרבון על חנות הלידים
--
-- ‏`after insert` על טיוטה גם היא: "יצירת הסכם" היא הפעולה שהמדריך מבקש,
-- והחתימה כבר יש לה התראה משלה (`agreement_signed`).
create or replace function public.agreements_onboarding_nudge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agent_id is null then
    return null;
  end if;
  if not public.agent_onboarding_active(new.agent_id) then
    return null;
  end if;
  if exists (select 1 from agreements a
              where a.agent_id = new.agent_id and a.id <> new.id) then
    return null;
  end if;
  if public.agent_onboarding_lead_done(new.agent_id) then
    return null;
  end if;
  perform public.agent_onboarding_nudge(new.agent_id, 'onboarding_lead');
  return null;
end;
$$;

drop trigger if exists agreements_onboarding_nudge on public.agreements;
create trigger agreements_onboarding_nudge
  after insert on public.agreements
  for each row
  execute function public.agreements_onboarding_nudge();

-- ---------------------------------------------------------------------------
-- 7. הרשאות
--
-- ‏PostgREST חושף כל פונקציה ב-`/rest/v1/rpc/<שם>`, ולכן מה שלא נועד לדפדפן
-- נסגר כאן במפורש. שתי הפונקציות שהדפדפן כן קורא פועלות על
-- ‏`current_agent_id()` בלבד, כלומר על הקורא/ת עצמו/ה.
-- ---------------------------------------------------------------------------
revoke all on function public.agent_onboarding_photos_done(uuid) from public, anon, authenticated;
revoke all on function public.agent_onboarding_lead_done(uuid)   from public, anon, authenticated;
revoke all on function public.agent_onboarding_active(uuid)      from public, anon, authenticated;
revoke all on function public.agent_onboarding_nudge(uuid, text) from public, anon, authenticated;

revoke all on function public.agent_onboarding_state()   from public, anon;
revoke all on function public.agent_onboarding_dismiss() from public, anon;
grant execute on function public.agent_onboarding_state()   to authenticated;
grant execute on function public.agent_onboarding_dismiss() to authenticated;
