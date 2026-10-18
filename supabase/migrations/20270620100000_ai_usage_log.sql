-- ============================================================================
-- יומן שימוש כללי במודלים — כל היכולות שאינן המנטור (docs/platform-costs.md,
-- "עלות AI לפי יכולת")
--
-- ‏20270620090000 פירקה את חשבונית Claude לפי יכולות המנטור, מהיומנים שכבר היו
-- לו. שאר הקריאות למודלים - גבריאלה (הכלי הכי בשימוש), הבוט הציבורי, קריאת
-- PDF, התיאורים השיווקיים, נוסחי המודעות, סיכומי השיחות, התמלול, סיווג
-- התמונות, ההדמיות, ומנועי הלידים והמבזקים - רשמו טוקנים רק ללוג. מעכשיו כל
-- אחת כותבת שורה ל-`ai_usage_log` (‏_shared/ai-usage.ts, ובפייתון
-- ‏ai_usage.py), ו-`ai_usage_costs` סוכמת את שני המקורות.
--
--   1. ‏ai_usage_log — שורה לקריאה. ‏uncached_input_tokens הוא הקלט **בלי**
--      המטמון (כמו ש-Anthropic מחזירה), בניגוד ל-input_tokens של טבלאות המנטור
--      שהוא הסך. ‏units - ליכולת שמתומחרת ביחידות (דקות תמלול).
--   2. ‏ai_model_prices — כתיבה למטמון של שעה (פי 2 מהקלט; גבריאלה משתמשת בה),
--      מחיר ליחידה, והמודלים שגבריאלה והמנועים רצים עליהם.
--   3. ‏ai_usage_costs — אותו חוזה, עם provider בכל שורה.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. היומן
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage_log (
  id                     bigint generated always as identity primary key,
  created_at             timestamptz not null default now(),
  feature                text not null,
  provider               text not null default 'anthropic',
  model                  text not null,
  uncached_input_tokens  int not null default 0,
  cache_read_tokens      int not null default 0,
  cache_write_tokens     int not null default 0,
  cache_write_1h_tokens  int not null default 0,
  output_tokens          int not null default 0,
  units                  numeric(12,3),
  -- לפירוט עתידי לפי משרד; לא מוצג עכשיו. ‏on delete set null - היומן הוא
  -- כסף שכבר הוצא, ונשאר גם כשהמשרד נמחק.
  agency_id              uuid references public.agencies (id) on delete set null,
  agent_id               uuid references public.agency_members (id) on delete set null
);

comment on table public.ai_usage_log is
  'שורה לכל קריאה למודל (חוץ מהמנטור, שיש לו יומנים משלו), לפירוט העלות ב-ai_usage_costs. נכתב ב-service_role בלבד. docs/platform-costs.md';

create index if not exists ai_usage_log_created_idx on public.ai_usage_log (created_at);

alter table public.ai_usage_log enable row level security;
revoke all on table public.ai_usage_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. המחירון
-- ---------------------------------------------------------------------------
alter table public.ai_model_prices add column if not exists cache_write_1h_usd_mtok numeric(10,4);
alter table public.ai_model_prices add column if not exists unit_usd numeric(10,4);
alter table public.ai_model_prices add column if not exists unit_label text;
-- מחיר ליחידה בלבד (תמלול) - בלי מחירי טוקנים
alter table public.ai_model_prices alter column input_usd_mtok drop not null;
alter table public.ai_model_prices alter column output_usd_mtok drop not null;
alter table public.ai_model_prices alter column cache_read_usd_mtok drop not null;
alter table public.ai_model_prices alter column cache_write_usd_mtok drop not null;

update public.ai_model_prices set cache_write_1h_usd_mtok = input_usd_mtok * 2
 where cache_write_1h_usd_mtok is null and input_usd_mtok is not null;

-- קריאה ממטמון לפי עשירית מהקלט כשהמחירון לא נוקב אחרת. Gemini אינו כאן:
-- בלי מחיר שאומת, המודל מוצג "בלי מחיר" עם מספר הקריאות - לא כאפס.
insert into public.ai_model_prices
  (model, input_usd_mtok, output_usd_mtok, cache_read_usd_mtok, cache_write_usd_mtok, cache_write_1h_usd_mtok, unit_usd, unit_label) values
  ('claude-opus-5',   5, 25, 0.50, 6.25, 10, null, null),
  ('claude-sonnet-5', 2, 10, 0.20, 2.50,  4, null, null),
  ('whisper-1',    null, null, null, null, null, 0.006, 'דקה')
on conflict (model) do nothing;

-- ---------------------------------------------------------------------------
-- 3. ‏ai_usage_costs
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
        -- יומני המנטור: input_tokens הוא הסך, ולכן הקלט הרגיל = סך פחות מטמון
        select 'mentor_question'::text feature, 'anthropic'::text provider, model,
               greatest(coalesce(input_tokens, 0) - cache_read_tokens - cache_write_tokens, 0) uncached,
               cache_read_tokens cr, cache_write_tokens cw, 0 cw1h, coalesce(output_tokens, 0) out_t, null::numeric units
          from coach_questions where created_at >= v_from and created_at < v_to
        union all
        select 'agent_daily', 'anthropic', model,
               greatest(coalesce(input_tokens, 0) - cache_read_tokens - cache_write_tokens, 0),
               cache_read_tokens, cache_write_tokens, 0, coalesce(output_tokens, 0), null
          from agent_coach_summaries where created_at >= v_from and created_at < v_to
        union all
        select 'team_weekly', 'anthropic', model,
               greatest(coalesce(input_tokens, 0) - cache_read_tokens - cache_write_tokens, 0),
               cache_read_tokens, cache_write_tokens, 0, coalesce(output_tokens, 0), null
          from team_coach_summaries where created_at >= v_from and created_at < v_to
        union all
        select 'office_weekly', 'anthropic', model,
               greatest(coalesce(input_tokens, 0) - cache_read_tokens - cache_write_tokens, 0),
               cache_read_tokens, cache_write_tokens, 0, coalesce(output_tokens, 0), null
          from office_coach_summaries where created_at >= v_from and created_at < v_to
        union all
        select feature, provider, model, uncached_input_tokens, cache_read_tokens, cache_write_tokens,
               cache_write_1h_tokens, output_tokens, units
          from ai_usage_log where created_at >= v_from and created_at < v_to
      ),
      g as (
        select u.feature, u.provider, u.model,
               count(*)::int calls,
               sum(u.uncached)::bigint uncached,
               sum(u.cr)::bigint cr, sum(u.cw)::bigint cw, sum(u.cw1h)::bigint cw1h,
               sum(u.out_t)::bigint out_t, sum(u.units) units
          from u
         where u.model is not null and u.model <> 'copy'
         group by 1, 2, 3
      )
      select jsonb_agg(jsonb_build_object(
               'feature', g.feature, 'provider', g.provider, 'model', g.model, 'calls', g.calls,
               'input_tokens', g.uncached + g.cr + g.cw + g.cw1h,
               'cache_read_tokens', g.cr, 'cache_write_tokens', g.cw + g.cw1h,
               'output_tokens', g.out_t, 'units', g.units, 'unit_label', p.unit_label,
               'usd', case
                 when p.model is null then null
                 when g.units is not null then round(g.units * p.unit_usd, 4)
                 when p.input_usd_mtok is null then null
                 else round((
                     g.uncached * p.input_usd_mtok
                   + g.cr   * p.cache_read_usd_mtok
                   + g.cw   * p.cache_write_usd_mtok
                   + g.cw1h * coalesce(p.cache_write_1h_usd_mtok, p.input_usd_mtok * 2)
                   + g.out_t * p.output_usd_mtok) / 1000000.0, 4) end
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
  'הערכת עלות AI לפי יכולת, ספק ומודל - יומני המנטור ו-ai_usage_log, כפול ai_model_prices. כבר כלולה בחשבוניות הספקים. למנהל/ת פלטפורמה בלבד.';

revoke all on function public.ai_usage_costs(date, date) from public, anon, authenticated;
grant execute on function public.ai_usage_costs(date, date) to authenticated;
