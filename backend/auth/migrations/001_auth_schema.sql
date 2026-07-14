-- Core auth tables: users, otp_codes, sessions, audit_log.
-- Run via the Supabase SQL Editor (or psql against the project's
-- connection string). No custom runner tool by design — matches the
-- rest of the project's "no unnecessary dependencies" approach. Every
-- statement is idempotent (if not exists), so re-running this file after
-- it's already been applied is harmless.

create extension if not exists pgcrypto; -- provides gen_random_uuid()

create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    created_at timestamptz not null default now()
);

-- Deliberately NOT foreign-keyed to users — an OTP is requested before we
-- know whether the person is a new or returning user. See
-- docs/AUTH_ARCHITECTURE.md §2 for the full rationale.
create table if not exists otp_codes (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    code_hash text not null,
    expires_at timestamptz not null,
    attempts integer not null default 0,
    used boolean not null default false,
    created_at timestamptz not null default now()
);

create table if not exists sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    token_hash text not null unique,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    last_seen timestamptz not null default now(),
    device_name text
);

create table if not exists audit_log (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references users(id) on delete set null,
    event_type text not null,
    ip_address text,
    user_agent text,
    created_at timestamptz not null default now()
);

insert into schema_migrations (version) values ('001_auth_schema')
    on conflict (version) do nothing;
