-- Preferences: one row per user (1:1), created lazily at first read with
-- defaults matching backend/preferences/preferences_service.py's
-- DEFAULT_PREFERENCES. Kept in sync manually — if you change the Python
-- defaults, update this default too.

create table if not exists preferences (
    user_id uuid primary key references users(id) on delete cascade,
    volume real not null default 1.0,
    eq_settings jsonb not null default '{"left":[0,0,0,0,0],"right":[0,0,0,0,0],"linked":true,"bypassed":false}'::jsonb,
    theme text not null default 'dark',
    last_room_id text,
    updated_at timestamptz not null default now()
);

insert into schema_migrations (version) values ('002_preferences')
    on conflict (version) do nothing;
