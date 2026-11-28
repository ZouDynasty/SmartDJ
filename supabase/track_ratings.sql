-- SmartDJ track ratings.
--
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: every statement is idempotent.
--
-- One row per user per track holds that user's 0-5 star rating. Tracks are
-- identified by their Rekordbox track ID, the same as `saved_sets.track_ids`
-- and `playlists.track_ids`. A row with stars = 0 means "cleared" and still
-- overrides whatever rating the Rekordbox import carried; the app never
-- deletes rows.

create table if not exists public.track_ratings (
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  track_id    integer not null,
  stars       smallint not null
                check (stars between 0 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, track_id)
);

-- Keep updated_at honest without the client having to send it.
create or replace function public.track_ratings_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists track_ratings_touch_updated_at on public.track_ratings;
create trigger track_ratings_touch_updated_at
  before update on public.track_ratings
  for each row execute function public.track_ratings_touch_updated_at();

-- Row-level security: each user only ever sees and changes their own rows.
alter table public.track_ratings enable row level security;

drop policy if exists "track_ratings_select_own" on public.track_ratings;
create policy "track_ratings_select_own" on public.track_ratings
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "track_ratings_insert_own" on public.track_ratings;
create policy "track_ratings_insert_own" on public.track_ratings
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "track_ratings_update_own" on public.track_ratings;
create policy "track_ratings_update_own" on public.track_ratings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "track_ratings_delete_own" on public.track_ratings;
create policy "track_ratings_delete_own" on public.track_ratings
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Table privileges. RLS above still limits which rows these apply to.
grant select, insert, update, delete on public.track_ratings to authenticated;
revoke all on public.track_ratings from anon;
