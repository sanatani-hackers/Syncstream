# Migrations

Plain, versioned SQL files — no migration framework or runner tool. Keeps
this consistent with the rest of the project's "no unnecessary
dependencies" approach; at this scale, applying four files by hand a
handful of times is simpler than adding a dependency to automate it.

## Applying

Run these **in order**, once, via the Supabase SQL Editor (or `psql`
against the project's connection string):

1. `000_schema_migrations.sql`
2. `001_auth_schema.sql`
3. `002_preferences.sql`
4. `003_indexes.sql`

Every `create table` / `create index` uses `if not exists`, and each
file's own `insert into schema_migrations` uses `on conflict do nothing`
— so re-running a file that's already been applied is harmless.

## Checking what's applied

```sql
select * from schema_migrations order by applied_at;
```

## Adding a new migration later

Next file is `004_<short_description>.sql`. End it with:

```sql
insert into schema_migrations (version) values ('004_short_description')
    on conflict (version) do nothing;
```
