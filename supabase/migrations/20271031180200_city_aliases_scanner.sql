-- supabase/migrations/20271031180200_city_aliases_scanner.sql
insert into public.city_aliases (city_id, alias)
select c.id, v.alias
  from (values ('יוקנעם', 'יקנעם עילית'),
               ('יוקנעם עילית', 'יקנעם עילית'),
               ('טבעון', 'קריית טבעון'),
               ('נצרת עילית', 'נוף הגליל')   -- NOT נצרת: different city
       ) as v(alias, city_name)
  join public.cities c on c.name_key = public.city_name_key(v.city_name) and c.active
 where not exists (select 1 from public.cities x where x.name_key = public.city_name_key(v.alias))
on conflict (alias_key) do nothing;
