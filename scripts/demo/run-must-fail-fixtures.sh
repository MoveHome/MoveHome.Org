#!/usr/bin/env bash
# Run the must-fail isolation fixtures against the demo project.
# Each fixture asserts a forbidden operation is REJECTED, so exit 0 = guard held.
# Pre-provisioning there is no demo project: report BLOCKED and stay green.
set -uo pipefail

if [ -z "${DEMO_SUPABASE_DB_URL:-}" ]; then
  echo "BLOCKED: DEMO_SUPABASE_DB_URL unset — demo project not provisioned (Fook R1)."
  echo "Fixtures run automatically once the demo project exists."
  exit 0
fi

command -v psql >/dev/null || { echo "FAIL: psql is not installed"; exit 1; }

rc=0
for f in supabase/demo-fixtures/*.sql; do
  echo "--- $f"
  if psql "$DEMO_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"; then
    echo "PASS: $f"
  else
    echo "FAIL: $f — a forbidden operation was accepted"
    rc=1
  fi
done
exit $rc
