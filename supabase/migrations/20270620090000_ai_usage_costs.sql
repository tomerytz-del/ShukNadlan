-- ============================================================================
-- עלות ה-AI לפי יכולת — הערכה מהטוקנים (docs/platform-costs.md, "עלות AI לפי יכולת")
--
-- ‏platform_costs סופרת את **החשבונית** של Anthropic, כלומר כמה שילמנו בסך הכול.
-- מה שאין שם הוא **על מה**: כמה עולה שאלה אחת למנטור, וכמה מהחשבון הם הסיכומים
-- היומיים. את זה אפשר לחשב מהטוקנים שכל קריאה כבר רושמת (‏coach_questions
-- ושלוש טבלאות הסיכומים), כפול מחירון.
--
-- **זו הערכה ולא חיוב:** היא כבר כלולה בחשבונית, והפאנל מציג אותה כפירוט ולא
-- מוסיף אותה לסך. מי שמוסיף/ה אותה לסך סופר/ת את Anthropic פעמיים.
--
--   1. ‏cache_read_tokens / cache_write_tokens בארבע הטבלאות. ‏input_tokens נשאר
--      הסך (קלט + מטמון), כמו שהיה, כדי שקוראים קיימים לא ישתנו. שורות ישנות
--      נושאות 0 בשניהם, ולכן מתומחרות כאילו כל הקלט רגיל - הערכה גבוהה מעט
--      מהאמת כשהיה מטמון, ונמוכה מעט כשהייתה כתיבה למטמון.
--   2. ‏ai_model_prices — המחירון, דולר למיליון טוקנים. מחיר שמשתנה = שורה כאן
--      במיגרציה חדשה. מודל שאין לו שורה מוצג בלי מחיר ולא כאפס.
--   3. ‏ai_usage_costs(from, to) — מה שהפאנל "עלויות" קורא. למנהל/ת פלטפורמה.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. טוקני המטמון בנפרד
-- ---------------------------------------------------------------------------
alter table public.coach_questions        add column if not exists cache_read_tokens  int not null default 0;
alter table public.coach_questions        add column if not exists cache_write_tokens int not null default 0;
alter table public.agent_coach_summaries  add column if not exists cache_read_tokens  int not null default 0;
alter table public.agent_coach_summaries  add column if not exists cache_write_tokens int not null default 0;
alter table public.team_coach_summaries   add column if not exists cache_read_tokens  int not null default 0;
alter table public.team_coach_summaries   add column if not exists cache_write_tokens int not null default 0;
alter table public.office_coach_summaries add column if not exists cache_read_tokens  int not null default 0;
alter table public.office_coach_summaries add column if not exists cache_write_tokens int not null default 0;

-- ---------------------------------------------------------------------------
-- 2. המחירון
-- ---------------------------------------------------------------------------
create table if not exists public.ai_model_prices (
  -- קידומת: ‏claude-sonnet-5-5 מתמחר גם claude-sonnet-5-5-20260901
  model               text primary key,
  input_usd_mtok      numeric(10,4) not null,
  output_usd_mtok     numeric(10,4) not null,
  cache_read_usd_mtok numeric(10,4) not null,
  cache_write_usd_mtok numeric(10,4) not null,
  updated_at          timestamptz not null default now()
);

comment on table public.ai_model_prices is
  'מחירון מודלים בדולר למיליון טוקנים, להערכת עלות ה-AI לפי יכולת (ai_usage_costs). docs/platform-costs.md';

alter table public.ai_model_prices enable row level security;
revoke all on table public.ai_model_prices from anon, authenticated;

-- כתיבה למטמון ~1.25 ממחיר הקלט (מטמון של 5 דקות)
insert into public.ai_model_prices (model, input_usd_mtok, output_usd_mtok, cache_read_usd_mtok, cache_write_usd_mtok) values
  ('claude-sonnet-5-5', 2, 10, 0.20, 2.50),
  ('claude-opus-5-5',   4, 20, 0.20, 5.00)
on conflict (model) do nothing;

-- ---------------------------------------------------------------------------
-- 3. ‏ai_usage_costs — מה שהפאנל קורא
--
-- שורה לכל (יכולת, מודל) בטווח. ‏model = 'copy' (סיכום יומי שהועתק בלי קריאה)
-- אינו קריאה ואינו נספר. סיכומים נשמרים ב-upsert, ולכן הרצה חוזרת על אותו
-- יום/שבוע דורסת את הקודמת - שם המספר הוא רף תחתון.
-- ---------------------------------------------------------------------------
create or replace function public.ai_usage_costs(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz := (coalesce(p_from, (date_trunc('month', now()) - interval '5 months')::date)::timestamp at time zone 'Asia/Jerusalem');
  v_to   timestamptz := ((coalesce(p_to, now()::date) + 1)::timestamp at time zone 'Asia/Jerusalem');
begin
  if not current_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'rows', coalesce((
      with u as (
        select 'mentor_question'::text feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
          from coach_questions where created_at >= v_from and created_at < v_to
        union all
        select 'agent_daily', model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
          from agent_coach_summaries where created_at >= v_from and created_at < v_to
        union all
        select 'team_weekly', model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
          from team_coach_summaries where created_at >= v_from and created_at < v_to
        union all
        select 'office_weekly', model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
          from office_coach_summaries where created_at >= v_from and created_at < v_to
      ),
      g as (
        select u.feature, u.model,
               count(*)::int calls,
               sum(coalesce(u.input_tokens, 0))::bigint input_tokens,
               sum(u.cache_read_tokens)::bigint cache_read_tokens,
               sum(u.cache_write_tokens)::bigint cache_write_tokens,
               sum(coalesce(u.output_tokens, 0))::bigint output_tokens
          from u
         where u.model is not null and u.model <> 'copy'
         group by 1, 2
      )
      select jsonb_agg(jsonb_build_object(
               'feature', g.feature, 'model', g.model, 'calls', g.calls,
               'input_tokens', g.input_tokens, 'cache_read_tokens', g.cache_read_tokens,
               'cache_write_tokens', g.cache_write_tokens, 'output_tokens', g.output_tokens,
               'usd', case when p.model is null then null else round((
                   greatest(g.input_tokens - g.cache_read_tokens - g.cache_write_tokens, 0) * p.input_usd_mtok
                 + g.cache_read_tokens  * p.cache_read_usd_mtok
                 + g.cache_write_tokens * p.cache_write_usd_mtok
                 + g.output_tokens      * p.output_usd_mtok) / 1000000.0, 4) end
             ) order by g.feature, g.model)
        from g
        left join lateral (
          select * from ai_model_prices mp
           where g.model = mp.model or g.model like mp.model || '-%'
           order by length(mp.model) desc limit 1
        ) p on true
    ), '[]'::jsonb),
    'prices', coalesce((select jsonb_agg(to_jsonb(mp) order by mp.model) from ai_model_prices mp), '[]'::jsonb)
  );
end;
$$;

comment on function public.ai_usage_costs(date, date) is
  'הערכת עלות AI לפי יכולת ומודל מהטוקנים ביומנים, כפול ai_model_prices. כבר כלולה בחשבונית Anthropic. למנהל/ת פלטפורמה בלבד.';

revoke all on function public.ai_usage_costs(date, date) from public, anon, authenticated;
grant execute on function public.ai_usage_costs(date, date) to authenticated;
