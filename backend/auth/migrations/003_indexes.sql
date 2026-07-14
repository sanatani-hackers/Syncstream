-- All indexes from the architecture review, with one deliberate
-- deviation: users.email and sessions.token_hash are declared UNIQUE in
-- 001_auth_schema.sql, and Postgres automatically creates a backing
-- index for every UNIQUE constraint. Adding an explicit index for either
-- of those two columns here would just be a duplicate index doing
-- nothing but wasting write overhead — so they're intentionally omitted.
-- Every other column from the review list is indexed below.

create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_sessions_expires_at on sessions(expires_at);

create index if not exists idx_otp_codes_email on otp_codes(email);
create index if not exists idx_otp_codes_created_at on otp_codes(created_at);

create index if not exists idx_audit_log_user_id on audit_log(user_id);
create index if not exists idx_audit_log_created_at on audit_log(created_at);
create index if not exists idx_audit_log_event_type on audit_log(event_type);

insert into schema_migrations (version) values ('003_indexes')
    on conflict (version) do nothing;
