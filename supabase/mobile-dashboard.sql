-- Single-user mobile companion storage.
-- Run once in Supabase SQL Editor, then keep the secret key server-side only.

create table if not exists public.mobile_snapshots (
  id text primary key,
  schema_version text not null,
  generated_at timestamptz not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.mobile_notes (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[0-9]{6}$'),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists mobile_notes_unconsumed
  on public.mobile_notes (created_at desc)
  where consumed_at is null;

alter table public.mobile_snapshots enable row level security;
alter table public.mobile_notes enable row level security;

-- The hosted app and local sync scripts use a server-side Supabase secret key.
-- Do not add anon/authenticated policies unless the authentication model changes.
revoke all on table public.mobile_snapshots from anon, authenticated;
revoke all on table public.mobile_notes from anon, authenticated;
grant all on table public.mobile_snapshots to service_role;
grant all on table public.mobile_notes to service_role;
