#!/bin/sh
# Production: creates the owner role (migrations) and the application role
# (subject to Row-Level Security), with passwords taken from the environment.
# Runs once, when the data volume is empty.
set -eu
psql -v ON_ERROR_STOP=1 --username postgres \
  -v owner_pw="$HK_OWNER_PASSWORD" -v app_pw="$HK_APP_PASSWORD" <<'SQL'
CREATE ROLE hk_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE hk_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE harvest_kids OWNER hk_owner;
\connect harvest_kids
ALTER SCHEMA public OWNER TO hk_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO hk_app;
SQL
