-- SmartDJ playlists.
--
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: every statement is idempotent.
--
-- A playlist is a named, per-user collection of library tracks. Unlike a saved
-- set it has no mix order to preserve and never holds the same track twice.
-- Tracks are stored as Rekordbox track IDs, the same as `saved_sets.track_ids`.

create table if not exists public.playlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  name        text not null
                check (char_length(btrim(name)) between 1 and 100),
  track_ids   integer[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One playlist per name per user, ignoring case ("Warmup" == "warmup").
create unique index if not exists playlists_user_name_key
  on public.playlists (user_id, lower(btrim(name)));

create index if not exists playlists_user_updated_idx
  on public.playlists (user_id, updated_at desc);

-- Keep updated_at honest without the client having to send it.
create or replace function public.playlists_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists playlists_touch_updated_at on public.playlists;
create trigger playlists_touch_updated_at
  before update on public.playlists
  for each row execute function public.playlists_touch_updated_at();

-- Row-level security: each user only ever sees and changes their own rows.
alter table public.playlists enable row level security;

drop policy if exists "playlists_select_own" on public.playlists;
create policy "playlists_select_own" on public.playlists
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "playlists_insert_own" on public.playlists;
create policy "playlists_insert_own" on public.playlists
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "playlists_update_own" on public.playlists;
create policy "playlists_update_own" on public.playlists
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "playlists_delete_own" on public.playlists;
create policy "playlists_delete_own" on public.playlists
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Table privileges. RLS above still limits which rows these apply to.
grant select, insert, update, delete on public.playlists to authenticated;
revoke all on public.playlists from anon;
