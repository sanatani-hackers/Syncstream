-- Tracks which migrations have been applied. Run this first, once.
create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
);
