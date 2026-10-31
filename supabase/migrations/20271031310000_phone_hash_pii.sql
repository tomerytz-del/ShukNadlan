-- supabase/migrations/20271031310000_phone_hash_pii.sql
-- phone_hash is pseudonymous PII. The row is deleted 30 days after the
-- post (scraped_leads_lifecycle), so the hash is not kept forever.
-- The previous comment said "never cleared". That described the column
-- surviving the 7-day phone wipe, not the life of the row.

comment on column public.scraped_leads.phone_hash is
  'Pseudonymous PII: sha256 of phone_tail9(raw_phone) and a fixed salt. Written at intake for dedupe after raw_phone is wiped (7 days or consent). Deleted with the row 30 days after posted_at. Not returned by functions anon or authenticated can call.';

revoke select (phone_hash) on table public.scraped_leads from public, anon, authenticated;
