-- Local development only: creates the two roles and the databases.
--   hk_owner : owns the schema, runs migrations (DATABASE_MIGRATION_URL)
--   hk_app   : application role, subject to Row-Level Security (DATABASE_URL)
-- CREATEDB lets `prisma migrate dev` create its shadow database.
CREATE ROLE hk_owner LOGIN PASSWORD 'hk_owner_dev' CREATEDB;
CREATE ROLE hk_app LOGIN PASSWORD 'hk_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

CREATE DATABASE harvest_kids OWNER hk_owner;
CREATE DATABASE harvest_kids_test OWNER hk_owner;

\connect harvest_kids
ALTER SCHEMA public OWNER TO hk_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO hk_app;

\connect harvest_kids_test
ALTER SCHEMA public OWNER TO hk_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO hk_app;
