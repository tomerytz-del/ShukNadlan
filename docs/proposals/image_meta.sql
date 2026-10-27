-- PR 1010, Part 6 §7: image metadata (width/height/focal point) and before/after alignment.
-- Written in PR 1010, NOT applied. The owner moves it to supabase/migrations after review.
-- The client already works without it: swipe.js measures naturalWidth/Height on load (fitCard).
-- Still to do before applying: replace property_visualizations_public with the align_* columns
-- at the end (create or replace view, same security_invoker and grants as today).
alter table public.property_image_tags
  add column if not exists width    int,
  add column if not exists height   int,
  add column if not exists focal_x  smallint check (focal_x between 0 and 100),
  add column if not exists focal_y  smallint check (focal_y between 0 and 100),
  add column if not exists meta_at  timestamptz;

alter table public.property_visualizations
  add column if not exists align_scale   real,
  add column if not exists align_tx      real,   -- fraction of width
  add column if not exists align_ty      real,   -- fraction of height
  add column if not exists align_err_pct real,
  add column if not exists align_inliers int,
  add column if not exists aligned_url   text,
  add column if not exists aligned_at    timestamptz;
-- property_visualizations_public: add align_* + aligned_url to the view (create or replace, same security_invoker as today)
