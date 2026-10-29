-- העברת תמונות בין נכסים. הקובץ מועתק. מחיקת המקור מחכה לחלון הביטול,
-- ורק אם אף נכס לא מצביע על הכתובת. אין פרסום.

create table if not exists public.property_image_relocations (
  id uuid primary key default gen_random_uuid(),
  from_property_id uuid not null,
  to_property_id uuid not null,
  actor_agent_id uuid,
  mode text not null,
  place text not null default 'end',
  from_before text[] not null,
  to_before text[] not null,
  from_after text[] not null,
  to_after text[] not null,
  source_paths text[] not null default '{}',
  source_urls text[] not null default '{}',
  copy_paths text[] not null default '{}',
  delete_after timestamptz,
  undone_at timestamptz,
  cleaned_at timestamptz,
  created_at timestamptz not null default now(),
  constraint property_image_relocations_mode_chk check (mode in ('move', 'copy')),
  constraint property_image_relocations_place_chk check (place in ('end', 'cover'))
);

revoke all on table public.property_image_relocations from public, anon, authenticated;
grant select, insert, update on table public.property_image_relocations to service_role;

alter table public.property_image_relocations enable row level security;

create or replace function public.relocate_property_images(
  p_from uuid,
  p_to uuid,
  p_from_expected text[],
  p_to_expected text[],
  p_from_next text[],
  p_to_next text[],
  p_mode text,
  p_place text,
  p_source_paths text[],
  p_source_urls text[],
  p_copy_paths text[],
  p_actor uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.agency_members%rowtype;
  v_from public.properties%rowtype;
  v_to public.properties%rowtype;
  v_id uuid;
begin
  if p_from = p_to or p_mode not in ('move', 'copy') then
    raise exception 'bad_move';
  end if;
  select * into v_member from public.agency_members
   where id = p_actor and active = true;
  if not found then
    raise exception 'agent_not_found';
  end if;
  select * into v_from from public.properties where id = p_from for update;
  if not found then
    raise exception 'property_not_found';
  end if;
  select * into v_to from public.properties where id = p_to for update;
  if not found then
    raise exception 'property_not_found';
  end if;
  if v_from.agency_id is distinct from v_to.agency_id
     or v_from.agency_id is distinct from v_member.agency_id then
    raise exception 'not_same_office';
  end if;
  if v_member.role is distinct from 'manager'
     and (v_from.agent_id is distinct from v_member.id
          or v_to.agent_id is distinct from v_member.id) then
    raise exception 'not_owner';
  end if;
  if coalesce(v_from.images, '{}') is distinct from coalesce(p_from_expected, '{}')
     or coalesce(v_to.images, '{}') is distinct from coalesce(p_to_expected, '{}') then
    raise exception 'images_changed';
  end if;
  update public.properties
     set images = coalesce(p_from_next, '{}'), updated_at = now()
   where id = p_from;
  update public.properties
     set images = coalesce(p_to_next, '{}'), updated_at = now()
   where id = p_to;
  insert into public.property_image_relocations (
    from_property_id, to_property_id, actor_agent_id, mode, place,
    from_before, to_before, from_after, to_after,
    source_paths, source_urls, copy_paths, delete_after
  ) values (
    p_from, p_to, p_actor, p_mode, coalesce(p_place, 'end'),
    coalesce(p_from_expected, '{}'), coalesce(p_to_expected, '{}'),
    coalesce(p_from_next, '{}'), coalesce(p_to_next, '{}'),
    coalesce(p_source_paths, '{}'), coalesce(p_source_urls, '{}'),
    coalesce(p_copy_paths, '{}'),
    case when p_mode = 'move' then now() + interval '20 seconds' else null end
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.relocate_property_images(uuid, uuid, text[], text[], text[], text[], text, text, text[], text[], text[], uuid)
  from public, anon, authenticated;
grant execute on function public.relocate_property_images(uuid, uuid, text[], text[], text[], text[], text, text, text[], text[], text[], uuid)
  to service_role;

create or replace function public.relocate_property_images_undo(p_id uuid, p_actor uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.property_image_relocations%rowtype;
  v_from text[];
  v_to text[];
begin
  select * into v_row from public.property_image_relocations where id = p_id for update;
  if not found or v_row.undone_at is not null then
    raise exception 'undo_missing';
  end if;
  if v_row.actor_agent_id is distinct from p_actor then
    raise exception 'not_owner';
  end if;
  if v_row.delete_after is not null and now() > v_row.delete_after then
    raise exception 'undo_closed';
  end if;
  select images into v_from from public.properties where id = v_row.from_property_id for update;
  select images into v_to from public.properties where id = v_row.to_property_id for update;
  if coalesce(v_from, '{}') is distinct from v_row.from_after
     or coalesce(v_to, '{}') is distinct from v_row.to_after then
    raise exception 'images_changed';
  end if;
  update public.properties set images = v_row.from_before, updated_at = now()
   where id = v_row.from_property_id;
  update public.properties set images = v_row.to_before, updated_at = now()
   where id = v_row.to_property_id;
  update public.property_image_relocations
     set undone_at = now(), cleaned_at = now()
   where id = p_id;
  return v_row.copy_paths;
end;
$$;

revoke all on function public.relocate_property_images_undo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.relocate_property_images_undo(uuid, uuid) to service_role;

comment on function public.relocate_property_images(uuid, uuid, text[], text[], text[], text[], text, text, text[], text[], text[], uuid) is
  'מעדכנת את שני מערכי התמונות בעסקה אחת. לא מוחקת קבצים ולא משנה סטטוס. חלון הביטול 20 שניות.';

-- חיפוש כתובת בתוך מערך התמונות. בלי האינדקס הסריקה עוברת על כל הטבלה.
create index if not exists properties_images_gin
  on public.properties using gin (images);

-- האם הכתובת עוד מוצגת: מערך התמונות, תמונת שיווק, סרטון, פוסטר,
-- תמונה שממתינה בוואטסאפ, או הדמיה שנבנתה ממנה. בלי תקרת שורות.
create or replace function public.property_image_still_used(p_url text, p_except uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_url is not null and btrim(p_url) <> '' and (
    exists (
      select 1 from public.properties p
       where (
           (p_except is null or p.id is distinct from p_except)
           and coalesce(p.images, '{}'::text[]) @> array[p_url]::text[]
         )
          or p.marketing_image = p_url
          or p.video_url = p_url
          or p.video_poster_url = p_url
    )
    or exists (
      select 1 from public.whatsapp_conversations c
       where coalesce(c.pending_images, '{}'::text[]) @> array[p_url]::text[]
    )
    or exists (
      select 1 from public.property_visualizations v
       where v.source_image_url = p_url or v.result_url = p_url
    )
    or exists (
      select 1 from public.property_image_tags t
       where t.image_url = p_url
    )
  );
$$;

revoke all on function public.property_image_still_used(text, uuid) from public, anon, authenticated;
grant execute on function public.property_image_still_used(text, uuid) to service_role;
