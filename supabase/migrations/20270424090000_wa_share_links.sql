-- ============================================================================
-- קישור קצר להודעת וואטסאפ מוכנה — ‏/wa/<code>
-- ----------------------------------------------------------------------------
-- ‏`property_link` של גבריאלה נתן לסוכן/ת קישור ‏wa.me/?text= שכל ההודעה
-- מקודדת בתוכו: ברכה, כותרת, כתובת, מחיר והערה חופשית של הסוכן/ת. כל אות
-- עברית היא שישה תווים (‏%D7%…), והקישור הגיע לאלף תווים ויותר. וואטסאפ
-- באייפון הופך ללחיץ רק את תחילת כתובת כזו (12.10.2026).
--
-- ‏המיניסייט נפתר בלי מסד (‏/w/<token>, ‏netlify/edge-functions/showcase-send.ts),
-- כי ההודעה שלו קבועה. כאן אי אפשר: ההערה של הסוכן/ת היא טקסט חופשי, והנכס
-- יכול להיות לא פעיל — כלומר לא קריא ל-anon. לכן ההודעה נשמרת כאן, והקישור
-- נושא קוד של 10 תווים בלבד.
--
-- ‏**הכתיבה — service_role בלבד** (הבוט). ‏**הקריאה — `wa_share_link_get` ל-anon**,
-- לפי הקוד בלבד: אין רשימה ואין חיפוש, והקוד אקראי (‏62^10). מה שהקוד חושף הוא
-- ההודעה שהסוכן/ת ממילא שולח/ת לנמען/ת. קישור ישן מ-90 יום אינו נפתח.
-- הפרטים: docs/client-showcase.md, "הקישור הקצר".
-- ============================================================================

create table if not exists public.wa_share_links (
  code        text primary key check (code ~ '^[0-9A-Za-z]{8,16}$'),
  agent_id    uuid references public.agency_members(id) on delete cascade,
  phone       text check (phone is null or phone ~ '^\d{9,15}$'),
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);

alter table public.wa_share_links enable row level security;

revoke all on table public.wa_share_links from public, anon, authenticated;
grant all on table public.wa_share_links to service_role;

comment on table public.wa_share_links is
  'הודעת וואטסאפ מוכנה מאחורי קישור קצר /wa/<code> (netlify/edge-functions/wa-share.ts). כתיבה מהבוט בלבד; קריאה לפי קוד דרך wa_share_link_get.';

create or replace function public.wa_share_link_get(p_code text)
returns table (phone text, body text)
language sql
stable
security definer
set search_path = public
as $$
  select l.phone, l.body
    from public.wa_share_links l
   where l.code = p_code
     and l.created_at > now() - interval '90 days';
$$;

revoke all on function public.wa_share_link_get(text) from public, anon, authenticated;
grant execute on function public.wa_share_link_get(text) to anon, service_role;
