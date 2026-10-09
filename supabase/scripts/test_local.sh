#!/usr/bin/env bash
# Run Dumpr migrations + pgTAP tests against a throwaway database on a plain PostgreSQL
# server (no Docker / Supabase CLI needed). With the Supabase CLI use `supabase test db`.
#
#   PGHOST=... PGPORT=... PGUSER=postgres ./supabase/scripts/test_local.sh
#
# Requires psql, pg_prove and the pgtap + pg_trgm extensions on the server.
set -euo pipefail

shopt -s nullglob
here="$(cd "$(dirname "$0")/.." && pwd)"
db="${DUMPR_TEST_DB:-dumpr_test}"

psql -v ON_ERROR_STOP=1 -qX -d postgres -c "drop database if exists ${db}" -c "create database ${db}"
psql -v ON_ERROR_STOP=1 -qX -d "${db}" -c "alter database ${db} set search_path = \"\$user\", public, extensions"
psql -v ON_ERROR_STOP=1 -qX -d "${db}" -f "${here}/scripts/local_auth_stub.sql"
for f in "${here}"/migrations/*.sql; do
  echo "applying $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -qX -d "${db}" -f "$f"
done
psql -v ON_ERROR_STOP=1 -qX -d "${db}" -f "${here}/seed.sql"
tests=("${here}"/tests/*.test.sql)
if [ "${#tests[@]}" -eq 0 ]; then echo "no pgTAP tests yet"; exit 0; fi
pg_prove -d "${db}" "${tests[@]}"
