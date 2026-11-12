-- The PostgreSQL image runs this script once in POSTGRES_DB on a fresh volume.
-- Service folders group ownership within the shared public schema.
\set ON_ERROR_STOP on

-- Create parent tables before tables that reference them with foreign keys.
\ir account/schema.sql
\ir room/schema.sql
\ir booking/schema.sql

-- Normal startup loads room inventory. Verification can opt into the full fixture set.
\set seed_demo false
\getenv seed_demo PAWINN_SEED_DEMO
\if :seed_demo
  \ir seed.psql
\else
  \ir room/seed.sql
\endif
