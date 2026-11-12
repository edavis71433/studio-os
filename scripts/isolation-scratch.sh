#!/usr/bin/env bash
# ── Walls between studios, checked on a scratch database (builder item 212) ──────
# The suites that prove one studio can't read another's data need a real database:
# real sign-ins, the real row rules and the real servers. They last ran on Jul 5 2026,
# on a staging project that no longer exists. This script builds a throwaway one on
# the machine it runs on and runs them there, so every release can run them first
# (.github/workflows/isolation.yml, called by deploy.yml).
#
# What it does, in order:
#   1. starts a scratch Supabase with Docker (the CLI version deploy.yml pins), with
#      the migrations exactly as production has them: 0003 to 0005 are fenced and
#      production never applied them, so they're left out here too;
#   2. serves presence and clever-api from this checkout, with made-up secrets only;
#   3. seeds the DDS tenant and two studios, each with its own owner and website
#      (tests/isolation/scratch_seed.mjs);
#   4. runs tests/isolation/isolation_test.ts and the twelve SALES_E2E suites as
#      studio one and studio two. A suite that skips counts as a failure here: a
#      skip means it didn't get what it needed, not that it passed.
#
# Nothing here reads a repository secret or reaches production. The keys are the
# scratch database's own, made when it starts and gone when the machine is.
#
# Needs: docker, node (npx), deno, curl. Local use, with Docker running:
#   SUPABASE_CLI_VERSION=2.122.0 bash scripts/isolation-scratch.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CLI_VERSION="${SUPABASE_CLI_VERSION:?set SUPABASE_CLI_VERSION (deploy.yml pins it)}"
DENO="${DENO:-deno}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/isolation-scratch.XXXXXX")"
LOG="$WORK/functions.log"
supabase() { (cd "$WORK" && npx --yes "supabase@$CLI_VERSION" "$@"); }

say() { printf '\n── %s ──\n' "$*"; }
fail() { printf '::error title=Walls between studios::%s\n' "$*"; exit 1; }

# ── 1. A scratch database with production's migrations ──────────────────────────
say "Setting up a scratch project in $WORK"
supabase init < /dev/null > /dev/null
sed -i.bak 's/^project_id = .*/project_id = "isolation-scratch"/' "$WORK/supabase/config.toml" && rm -f "$WORK/supabase/config.toml.bak"
mkdir -p "$WORK/supabase/migrations"
copied=0
for f in "$REPO"/supabase/migrations/[0-9]*.sql; do
  case "$(basename "$f")" in
    0003_*|0004_*|0005_*) echo "left out on purpose (fenced, never applied to production): $(basename "$f")"; continue ;;
  esac
  cp "$f" "$WORK/supabase/migrations/"
  copied=$((copied + 1))
done
echo "migrations copied: $copied"
cp -R "$REPO/supabase/functions" "$WORK/supabase/functions"

# The services the suites don't touch stay off: the dashboard, image resizing, the
# test mailbox, realtime, logs, the pooler and the dashboard's helper. Functions are
# served below, from this checkout, so the built-in runtime stays off as well.
say "Starting the scratch database (Supabase CLI $CLI_VERSION)"
# Only names this CLI version knows: an unknown one stops `start` (mailpit was inbucket once).
known="$(supabase start --help 2>&1 || true)"
skip=""
for name in studio imgproxy mailpit inbucket realtime logflare vector supavisor postgres-meta edge-runtime; do
  if printf '%s' "$known" | grep -qE "[[,]$name[],]"; then skip="$skip${skip:+,}$name"; fi
done
echo "left off: ${skip:-nothing}"
if ! supabase start ${skip:+-x "$skip"} > "$WORK/start.log" 2>&1; then
  tail -60 "$WORK/start.log"
  fail "The scratch database didn't start: a migration or a service failed (log above)."
fi
grep -E 'Applying migration|Finished|Started' "$WORK/start.log" | tail -5 || true

# The scratch project's own address and keys. They exist only on this machine.
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY|DB_URL)=')"
[ -n "${API_URL:-}" ] && [ -n "${ANON_KEY:-}" ] && [ -n "${SERVICE_ROLE_KEY:-}" ] || fail "The scratch database started but didn't say its address and keys."
echo "scratch API: $API_URL"

# ── 2. The two servers, from this checkout ───────────────────────────────────────
# Link secrets are made up for this run, so the signed-link checks run too (a token
# made for one studio's proposal must not open another's).
LINK_SECRET="$(openssl rand -hex 32)"
{
  echo "APPROVAL_SECRET=$LINK_SECRET"
  echo "STATE_SIGNING_SECRET=$(openssl rand -hex 32)"
  echo "SCHEDULER_SECRET=$(openssl rand -hex 32)"
  echo "SITE_URL=http://localhost:8788"
  echo "APP_URL=http://localhost:8788"
} > "$WORK/functions.env"

say "Serving presence and clever-api"
supabase functions serve --no-verify-jwt --env-file "$WORK/functions.env" > "$LOG" 2>&1 &
SERVE_PID=$!
cleanup() { kill "$SERVE_PID" 2>/dev/null || true; }
trap cleanup EXIT

ready=""
for _ in $(seq 1 120); do
  v=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/clever-api" -H 'Content-Type: application/json' -d '{"type":"version"}' || true)
  p=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/functions/v1/presence/commerce/plans" || true)
  if [ "$v" = 200 ] && [ "$p" = 200 ]; then ready=yes; break; fi
  sleep 2
done
[ -n "$ready" ] || { tail -80 "$LOG"; fail "The servers didn't answer within four minutes (log above)."; }
echo "both servers answer"

# ── 3. The DDS tenant and two studios ────────────────────────────────────────────
say "Seeding two studios"
SCRATCH_API="$API_URL" SCRATCH_ANON_KEY="$ANON_KEY" SCRATCH_SERVICE_KEY="$SERVICE_ROLE_KEY" \
  "$DENO" run --allow-net --allow-env "$REPO/tests/isolation/scratch_seed.mjs" > "$WORK/seed.env" \
  || fail "The two studios couldn't be set up (seed output above)."
set -a; . "$WORK/seed.env"; set +a
export SALES_E2E_APPROVAL_SECRET="$LINK_SECRET"

# ── 4. The suites ────────────────────────────────────────────────────────────────
passed=0; failed=0; bad=""
run_suite() {   # name, then the command
  local name="$1"; shift
  local out rc=0
  say "$name"
  out=$("$@" 2>&1) || rc=$?
  printf '%s\n' "$out"
  local p f s
  p=$(printf '%s\n' "$out" | grep -cE '^(PASS  |  ✅ )' || true)
  f=$(printf '%s\n' "$out" | grep -cE '^(FAIL  |  ❌ )' || true)
  s=$(printf '%s\n' "$out" | grep -ciE '^SKIP |\(skipped\)|skipped —' || true)
  passed=$((passed + p)); failed=$((failed + f))
  if [ "$rc" -ne 0 ] || [ "$f" -ne 0 ] || [ "$s" -ne 0 ] || [ "$p" -eq 0 ]; then
    bad="$bad $name"
    printf '::error title=%s::exit %s, %s passed, %s failed, %s skipped\n' "$name" "$rc" "$p" "$f" "$s"
  fi
}

run_suite "tenant isolation (RLS and the old server's door)" \
  env STAGING_URL="$API_URL" ANON_KEY="$ANON_KEY" SERVICE_KEY="$SERVICE_ROLE_KEY" \
  "$DENO" run --allow-net --allow-env "$REPO/tests/isolation/isolation_test.ts"

for s in sales_tenant_isolation_e2e sales_closing_isolation_e2e projects_isolation_e2e \
         sales_e2e sales_foundation_e2e sales_closing_e2e projects_e2e project_comms_e2e \
         project_delivery_e2e project_report_e2e service_intake_e2e service_lifecycle_e2e; do
  run_suite "$s" "$DENO" run --allow-net --allow-env "$REPO/tests/presence/${s}_test.mjs"
done

when="$(date -u '+%Y-%m-%d at %H:%M UTC')"
commit="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [ -n "$bad" ]; then
  line="Walls between studios: $failed of $((passed + failed)) checks failed on a scratch database on $when, commit $commit. Suites with a problem:$bad"
else
  line="Walls between studios: all $passed checks passed on a scratch database on $when, commit $commit."
fi
echo; echo "$line"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$line" >> "$GITHUB_STEP_SUMMARY"
if [ -n "$bad" ]; then
  say "Server log (last 60 lines)"; tail -60 "$LOG" || true
  exit 1
fi
