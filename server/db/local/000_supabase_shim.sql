-- The parts of Supabase that our migrations reference, for a plain Postgres
-- (tests, CI, docker compose). Never run this against a Supabase project.
-- Applied by `npm run migrate -- --local`.

create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key,
  email               text,
  raw_user_meta_data  jsonb not null default '{}'::jsonb
);

-- Supabase reads the caller's id from the JWT claims of the request.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  create role authenticated nologin;
exception when duplicate_object then null;
end
$$;

do $$
begin
  create role anon nologin;
exception when duplicate_object then null;
end
$$;
