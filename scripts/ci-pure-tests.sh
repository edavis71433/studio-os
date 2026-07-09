#!/usr/bin/env bash
# ── Pure regression sweep (Presence CMS Phase 1, M1) ─────────────────────────
# Runs every tests/presence/*_test.mjs that does NOT require live Supabase
# credentials, and fails if any pure suite fails. Integration-tier suites
# self-report "need SB, SR_KEY, ANON" (or similar) and are skipped here — they
# run against staging separately. The golden render suite is included, so a
# renderer change that alters byte output fails until the golden baseline is
# intentionally regenerated (`deno run --allow-read --allow-write \
# tests/presence/render_test.mjs --update-golden`) and committed.
#
# Local use mirrors CI:  DENO=/path/to/deno bash scripts/ci-pure-tests.sh
set -uo pipefail
export TMPDIR="${TMPDIR:-/tmp}"
DENO="${DENO:-deno}"

pass=0; fail=0; skip=0; failed=""
for f in tests/presence/*_test.mjs; do
  out=$("$DENO" run --allow-read --allow-env --allow-net "$f" 2>&1); rc=$?
  # Exit code decides. A suite that returns 0 PASSED its pure portion (it may
  # additionally print an "integration tier skipped" note for optional live
  # tests — that is not a skip of the whole suite). Only a NON-ZERO exit whose
  # output announces missing live-Supabase credentials is an integration-only
  # suite skipped here; any other non-zero exit is a real failure.
  if [ "$rc" -eq 0 ]; then
    pass=$((pass+1)); echo "PASS  $f"
  elif printf '%s' "$out" | grep -qiE "need SB|SB, SR_KEY, ANON|SR_KEY, ANON|need .*SR_KEY"; then
    skip=$((skip+1)); echo "SKIP  $f (integration-only — needs live Supabase)"
  else
    fail=$((fail+1)); failed="$failed\n  $f"; echo "FAIL  $f"; printf '%s\n' "$out" | tail -6
  fi
done

echo ""
echo "════ CI pure sweep: $pass passed, $fail failed, $skip skipped ════"
if [ "$fail" -ne 0 ]; then printf "Failed suites:%b\n" "$failed"; exit 1; fi
