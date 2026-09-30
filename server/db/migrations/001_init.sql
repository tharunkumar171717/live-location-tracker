-- auth.users -> profiles -> tracking_sessions -> location_history
-- Run in the Supabase SQL editor, or `npm run migrate` from /server.

create extension if not exists pgcrypto;

-- Profiles -------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Create a profile automatically when a user signs up (email or Google).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Tracking sessions ----------------------------------------------------------
create table if not exists public.tracking_sessions (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  join_code   text not null unique,
  status      text not null default 'active' check (status in ('active', 'ended')),
  created_at  timestamptz not null default now(),
  ended_at    timestamptz
);

create table if not exists public.tracking_session_members (
  session_id  uuid not null references public.tracking_sessions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  joined_at   timestamptz not null default now(),
  primary key (session_id, user_id)
);

create index if not exists tracking_session_members_user_idx
  on public.tracking_session_members (user_id);

-- Location history -----------------------------------------------------------
create table if not exists public.location_history (
  id           bigint generated always as identity primary key,
  session_id   uuid not null references public.tracking_sessions (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  accuracy     double precision,
  heading      double precision,
  speed        double precision,
  recorded_at  timestamptz not null,
  created_at   timestamptz not null default now()
);

create index if not exists location_history_session_user_time_idx
  on public.location_history (session_id, user_id, recorded_at desc);

-- Row Level Security ---------------------------------------------------------
-- The Node server connects as the database owner and enforces access itself.
-- These policies protect the tables if a client ever queries Supabase directly
-- with the publishable key.
alter table public.profiles                 enable row level security;
alter table public.tracking_sessions        enable row level security;
alter table public.tracking_session_members enable row level security;
alter table public.location_history         enable row level security;

create or replace function public.is_session_member(p_session_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.tracking_session_members
    where session_id = p_session_id and user_id = auth.uid()
  );
$$;

drop policy if exists "profiles: read self or co-members" on public.profiles;
create policy "profiles: read self or co-members" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.tracking_session_members m
      where m.user_id = profiles.id and public.is_session_member(m.session_id)
    )
  );

drop policy if exists "profiles: update self" on public.profiles;
create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "sessions: members read" on public.tracking_sessions;
create policy "sessions: members read" on public.tracking_sessions
  for select to authenticated
  using (public.is_session_member(id));

drop policy if exists "members: members read" on public.tracking_session_members;
create policy "members: members read" on public.tracking_session_members
  for select to authenticated
  using (public.is_session_member(session_id));

drop policy if exists "locations: members read" on public.location_history;
create policy "locations: members read" on public.location_history
  for select to authenticated
  using (public.is_session_member(session_id));
