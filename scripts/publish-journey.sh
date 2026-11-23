#!/usr/bin/env bash
# ── The publish journey, for real, on a test team (builder item 421) ────────────────
# .github/workflows/publish-journey.yml runs this, switched off until Eric agrees to its
# Netlify cost. NOT YET RUN: the first run is its own test, so read its log closely.
#
#   1. a scratch database and the presence server from this commit, the way
#      scripts/isolation-scratch.sh makes them, with NETLIFY_AUTH_TOKEN set to the TEST
#      team's token (NETLIFY_TEST_TOKEN), so every site it makes lands on that team;
#   2. one studio and its website (tests/isolation/scratch_seed.mjs);
#   3. POST /publish as that studio's owner, then wait until the site's publish is live;
#   4. ask Netlify (the test team) for the new site's address, and fetch it: it must
#      answer 200 with the site's own name in its page;
#   5. POST /site/offline, and fetch again: the holding page, not the site;
#   6. delete the test site at Netlify, so nothing piles up on the team.
# It writes the steps' results to the run's summary. Nothing here reaches production.
set -euo pipefail
: "${NETLIFY_TEST_TOKEN:?a token for the separate Netlify test team}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CLI_VERSION="${SUPABASE_CLI_VERSION:?set SUPABASE_CLI_VERSION (deploy.yml pins it)}"
DENO="${DENO:-deno}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/publish-journey.XXXXXX")"
NETLIFY="https://api.netlify.com/api/v1"
supabase() { (cd "$WORK" && npx --yes "supabase@$CLI_VERSION" "$@"); }
. "$REPO/scripts/scratch-stack.sh"   # scratch_ports and scratch_start
say() { printf '\n── %s ──\n' "$*"; }
note() { echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "- $*" >> "$GITHUB_STEP_SUMMARY"; return 0; }
fail() { echo "::error title=Publish journey::$*"; note "Stopped: $*"; exit 1; }
SITE_ID=""
cleanup() {
  [ -n "$SITE_ID" ] && curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $NETLIFY_TEST_TOKEN" "$NETLIFY/sites/$SITE_ID" || true
  [ -n "${SERVE_PID:-}" ] && kill "$SERVE_PID" 2>/dev/null || true
  supabase stop --no-backup > /dev/null 2>&1 || true
}
trap cleanup EXIT

# ── 1. The scratch database and the server ───────────────────────────────────────
say "A scratch database with production's migrations"
supabase init < /dev/null > /dev/null
sed -i.bak 's/^project_id = .*/project_id = "publish-journey"/' "$WORK/supabase/config.toml" && rm -f "$WORK/supabase/config.toml.bak"
scratch_ports "$WORK/supabase/config.toml" || fail "Couldn't move the scratch database off the ports the machine's own connections use."
mkdir -p "$WORK/supabase/migrations"
for f in "$REPO"/supabase/migrations/[0-9]*.sql; do
  case "$(basename "$f")" in 0003_*|0004_*|0005_*) continue ;; esac
  cp "$f" "$WORK/supabase/migrations/"
done
cp -R "$REPO/supabase/functions" "$WORK/supabase/functions"
known="$(supabase start --help 2>&1 || true)"; skip=""
for name in studio imgproxy mailpit inbucket realtime logflare vector supavisor postgres-meta edge-runtime; do
  if printf '%s' "$known" | grep -qE "[[,]$name[],]"; then skip="$skip${skip:+,}$name"; fi
done
scratch_start "$WORK/start.log" ${skip:+-x "$skip"} || { tail -40 "$WORK/start.log"; fail "The scratch database didn't start."; }
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
[ -n "${API_URL:-}" ] && [ -n "${SERVICE_ROLE_KEY:-}" ] || fail "The scratch database didn't say its address and keys."
{
  echo "NETLIFY_AUTH_TOKEN=$NETLIFY_TEST_TOKEN"
  echo "APPROVAL_SECRET=$(openssl rand -hex 32)"
  echo "STATE_SIGNING_SECRET=$(openssl rand -hex 32)"
  echo "SCHEDULER_SECRET=$(openssl rand -hex 32)"
  echo "SITE_URL=http://localhost:8788"
  echo "APP_URL=http://localhost:8788"
  echo "RESEND_KEY=journey-not-a-key"
  echo "RESEND_API_URL=http://127.0.0.1:9/emails"
} > "$WORK/functions.env"
supabase functions serve --no-verify-jwt --env-file "$WORK/functions.env" > "$WORK/functions.log" 2>&1 &
SERVE_PID=$!
for _ in $(seq 1 120); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/functions/v1/presence/commerce/plans" || true)" = 200 ] && break
  sleep 2
done
P="$API_URL/functions/v1/presence"

# ── 2. One studio and its website ────────────────────────────────────────────────
say "Seeding a studio"
SCRATCH_API="$API_URL" SCRATCH_ANON_KEY="$ANON_KEY" SCRATCH_SERVICE_KEY="$SERVICE_ROLE_KEY" \
  "$DENO" run --allow-net --allow-env "$REPO/tests/isolation/scratch_seed.mjs" > "$WORK/seed.env" || fail "The studio couldn't be set up."
JWT=$(sed -n 's/^SALES_E2E_JWT=//p' "$WORK/seed.env")
[ -n "$JWT" ] || fail "The seed gave no sign-in."
rest() { curl -sS -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" "$API_URL/rest/v1/$1"; }

# ── 3. Publish ───────────────────────────────────────────────────────────────────
say "Publishing"
code=$(curl -sS -o "$WORK/publish.json" -w '%{http_code}' -X POST -H "x-dds-user-jwt: $JWT" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: journey-$(date +%s)" --data '{}' "$P/publish") || code=000
[ "$code" = 200 ] || fail "POST /publish answered HTTP $code: $(head -c 300 "$WORK/publish.json")"
site=""
for _ in $(seq 1 60); do
  row=$(rest "presence_publishes?select=status,site_id&order=created_at.desc&limit=1")
  status=$(printf '%s' "$row" | jq -r '.[0].status // empty'); site=$(printf '%s' "$row" | jq -r '.[0].site_id // empty')
  [ "$status" = live ] && break
  [ "$status" = failed ] && fail "The publish failed (presence_publishes says failed)."
  sleep 5
done
[ "$status" = live ] || fail "The publish didn't go live in five minutes (it says \"${status:-nothing}\")."
SITE_ID=$(rest "presence_sites?id=eq.$site&select=netlify_site_id" | jq -r '.[0].netlify_site_id // empty')
[ -n "$SITE_ID" ] || fail "The site has no Netlify site after publishing."
note "Published: the publish went live, on the test team's site."

# ── 4. The site answers with its own words ───────────────────────────────────────
url=$(curl -sS -H "Authorization: Bearer $NETLIFY_TEST_TOKEN" "$NETLIFY/sites/$SITE_ID" | jq -r '.ssl_url // .url // empty')
[ -n "$url" ] || fail "Netlify didn't say the test site's address."
name=$(rest "presence_identity?site_id=eq.$site&select=business_name" | jq -r '.[0].business_name // empty')
[ -n "$name" ] || fail "The site has no business name to look for on its page."
page=""
for _ in $(seq 1 24); do page=$(curl -sS -L --max-time 20 "$url" || true); printf '%s' "$page" | grep -qF "$name" && break; sleep 5; done
printf '%s' "$page" | grep -qF "$name" || fail "The published site didn't answer with its own name."
note "Up: the published site answers, with its own name."

# ── 5. Offline ───────────────────────────────────────────────────────────────────
code=$(curl -sS -o "$WORK/offline.json" -w '%{http_code}' -X POST -H "x-dds-user-jwt: $JWT" -H 'Content-Type: application/json' --data '{}' "$P/site/offline") || code=000
[ "$code" = 200 ] || fail "POST /site/offline answered HTTP $code."
gone=""
for _ in $(seq 1 24); do page=$(curl -sS -L --max-time 20 "$url" || true); printf '%s' "$page" | grep -qF "$name" || { gone=yes; break; }; sleep 5; done
[ -n "$gone" ] || fail "The site still showed itself two minutes after going offline."
note "Offline: the address shows the holding page, not the site."
note "Cleaned up: the test site is deleted at Netlify when the run ends."
