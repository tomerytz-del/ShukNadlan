-- ============================================================================
-- קישור ניהול לכרטיסיית בעל-מקצוע
--
-- לבעלי מקצוע אין (ולא אמור להיות) חשבון באתר: הם לא סוכנים ולא משרדים,
-- ואין להם שורה ב-agency_members. במקום מסך התחברות, כל כרטיסייה מקבלת
-- אסימון ניהול חד-פעמי — קישור סודי שמאפשר לערוך אך ורק אותה.
--
-- האסימון יושב בטבלה נפרדת ולא כעמודה ב-ad_placements בכוונה: על
-- ad_placements יש policy של קריאה ציבורית לכל שורה פעילה (`status =
-- 'active'`), והיא חלה על כל העמודות — אסימון שהיה יושב שם היה נקרא על
-- ידי כל גולש יחד עם הכרטיסייה, וכל אחד היה יכול לערוך את הכרטיסייה של
-- כל אחד. הטבלה כאן היא עם RLS ובלי אף policy, כלומר אין אליה גישה
-- מלקוח בשום מפתח ציבורי — רק service_role (פונקציות הקצה) מגיע אליה.
--
-- אידמפוטנטי — אפשר להריץ שוב.
-- ============================================================================

create table if not exists public.ad_placement_access (
  placement_id uuid primary key references public.ad_placements(id) on delete cascade,
  manage_token uuid not null default gen_random_uuid(),
  created_at   timestamptz not null default now()
);

create unique index if not exists ad_placement_access_token_key
  on public.ad_placement_access(manage_token);

alter table public.ad_placement_access enable row level security;

comment on table public.ad_placement_access is
  'אסימון הניהול של כרטיסיית פרסום — הסוד שמחליף התחברות לבעל/ת המקצוע. RLS דלוקה ובלי policy: נגיש ל-service_role בלבד, דרך פונקציות הקצה.';
comment on column public.ad_placement_access.manage_token is
  'הסוד שבקישור העריכה (professional-manage.html?token=…). מי שמחזיק בו יכול לערוך את הכרטיסייה הזו בלבד.';

-- כרטיסיות שנרשמו לפני השינוי מקבלות אסימון גם הן, אחרת אין להן דרך
-- להיערך בכלל.
insert into public.ad_placement_access (placement_id)
select id from public.ad_placements
where placement_type = 'professional_card'
on conflict (placement_id) do nothing;
