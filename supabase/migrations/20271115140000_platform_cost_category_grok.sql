-- Grok (xAI) הוא ספק AI: נכנס לקטגוריית ה-AI בתקציב החודשי.
create or replace function public.platform_cost_category(p_service text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_service in ('anthropic_api', 'claude_subscription', 'fal_ai', 'openai', 'replicate', 'gemini', 'grok') then 'ai'
    when p_service in ('meta', 'google_ads') then 'ads'
    else 'infra'
  end;
$$;

revoke all on function public.platform_cost_category(text) from public, anon, authenticated;
