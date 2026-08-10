-- ============================================================================
-- PHASE 21 — A home for event pictures that survives deploys
--
-- How the announcement broke, in one paragraph: the event card's picture is a
-- URL in the events row. The only guidance anyone ever had was a placeholder
-- suggesting "assets/festival-crowd.jpg" — a path that changes name on every
-- build (fingerprinting), so it 404s in production; and the workaround people
-- reach for, a Google Drive share link, is an HTML page rather than an image
-- file, so it never renders either. Both failure modes are now closed in the
-- panel (upload + URL conversion) and this bucket is where uploads live:
-- public, image-only, 5 MB cap, admin-write.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-images', 'event-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reads need no policy: a public bucket serves its objects to anyone by URL,
-- which is the point — the front page's visitors are not signed in.

drop policy if exists event_images_admin_insert on storage.objects;
create policy event_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-images' and public.is_admin());

drop policy if exists event_images_admin_update on storage.objects;
create policy event_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'event-images' and public.is_admin());

drop policy if exists event_images_admin_delete on storage.objects;
create policy event_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'event-images' and public.is_admin());
