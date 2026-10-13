-- Demo bots, view-only share links, geofences, and indexes for retention.

-- Bot profiles -----------------------------------------------------------------
-- Demo sessions have simulated members. They need profile rows (locations and
-- memberships reference profiles), but they aren't real sign-ins, so profiles
-- can no longer require an auth.users row. Real users keep their cleanup: a
-- trigger removes the profile when the auth user is deleted.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles add column if not exists is_bot boolean not null default false;

create or replace function public.handle_deleted_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.profiles where id = old.id and not is_bot;
  return old;
end;
$$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_user();

insert into public.profiles (id, email, full_name, is_bot) values
  ('00000000-0000-4000-8000-00000000b001', null, 'Asha (demo)', true),
  ('00000000-0000-4000-8000-00000000b002', null, 'Ravi (demo)', true),
  ('00000000-0000-4000-8000-00000000b003', null, 'Meera (demo)', true),
  ('00000000-0000-4000-8000-00000000b000', null, 'Demo host', true)
on conflict (id) do nothing;

-- Demo sessions -----------------------------------------------------------------
alter table public.tracking_sessions
  add column if not exists is_demo boolean not null default false,
  -- Guest demos end on their own at this time.
  add column if not exists expires_at timestamptz,
  -- The public demo only simulates while someone has watched recently.
  add column if not exists demo_active_until timestamptz;

create index if not exists tracking_sessions_demo_idx
  on public.tracking_sessions (is_demo, status) where is_demo;

-- Share links -------------------------------------------------------------------
-- View-only access without an account. Only a SHA-256 hash of the token is
-- stored, so a database leak doesn't leak working links.
create table if not exists public.share_links (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.tracking_sessions (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists share_links_session_idx on public.share_links (session_id);

-- Geofences ----------------------------------------------------------------------
-- Circular zones. Circles cover the "arrived at office / left home" case and
-- need no PostGIS; distance is haversine in the server.
create table if not exists public.geofences (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.tracking_sessions (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  radius_m    double precision not null check (radius_m between 25 and 5000),
  created_at  timestamptz not null default now()
);

create index if not exists geofences_session_idx on public.geofences (session_id);

-- Whether each member is currently inside each zone. Updated with a
-- conditional upsert, so concurrent instances agree on exactly one transition.
create table if not exists public.geofence_presence (
  geofence_id uuid not null references public.geofences (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  inside      boolean not null,
  changed_at  timestamptz not null default now(),
  primary key (geofence_id, user_id)
);

create table if not exists public.geofence_events (
  id           bigint generated always as identity primary key,
  geofence_id  uuid not null references public.geofences (id) on delete cascade,
  session_id   uuid not null references public.tracking_sessions (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('enter', 'exit')),
  lat          double precision not null,
  lng          double precision not null,
  occurred_at  timestamptz not null default now()
);

create index if not exists geofence_events_session_time_idx
  on public.geofence_events (session_id, occurred_at desc);

-- Retention -------------------------------------------------------------------------
create index if not exists location_history_recorded_at_idx
  on public.location_history (recorded_at);

-- Row Level Security -------------------------------------------------------------------
alter table public.share_links        enable row level security;
alter table public.geofences          enable row level security;
alter table public.geofence_presence  enable row level security;
alter table public.geofence_events    enable row level security;

drop policy if exists "geofences: members read" on public.geofences;
create policy "geofences: members read" on public.geofences
  for select to authenticated
  using (public.is_session_member(session_id));

drop policy if exists "geofence events: members read" on public.geofence_events;
create policy "geofence events: members read" on public.geofence_events
  for select to authenticated
  using (public.is_session_member(session_id));

-- share_links and geofence_presence have no policies: only the server reads them.
