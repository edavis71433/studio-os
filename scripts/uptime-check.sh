#!/usr/bin/env bash
# ── The second alarm, from outside (builder item 417) ────────────────────────────
# GitHub runs this every 15 minutes (.github/workflows/uptime.yml). It asks what a
# visitor's browser asks, plus the server's own public status read, and needs no
# secret. When something is wrong the run fails with a plain reason, and GitHub emails
# a failed scheduled run to the person who last changed its schedule: Eric. So this
# route still works when Supabase or Resend, the first alarm's own route, is what's down.
#
# The first alarm is the 5-minute watchdog on the staging project (supabase/ops/
# watchdog-cron.sql), which reads the full health answer with the scheduler's secret and
# emails through Resend at most every 6 hours. The two don't depend on each other.
#
# What it checks, each tried twice 20 seconds apart before it counts as down (a single
# slow answer is not an outage):
#   1. the app's pages answer and still carry the sign-in page;
#   2. the free tools' pages answer;
#   3. the server answers its public price list;
#   4. the server's public status read: database reachable, the 15-minute job finished
#      recently, no crash spike, failures not piling up, required settings present;
#   5. the server still refuses its health answer to a caller without the secret.
#
# Local use (read-only, safe to run any time): bash scripts/uptime-check.sh
set -uo pipefail

APP="${UPTIME_APP_URL:-https://app.davisdigitalstudio.com}"
TOOLS="${UPTIME_TOOLS_URL:-https://tools.davisdigitalstudio.com}"
API="${UPTIME_API_URL:-https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence}"
PAUSE="${UPTIME_RETRY_SECONDS:-20}"
# The status read ships with builder item 417's release. Until that release a server
# without it answers 401 or 404, which is a note, not an outage; from this day on it must
# answer, so a later break can't hide behind the note. (UPTIME_NOW: a test's clock.)
STATUS_LIVE_BY="2026-12-06"
NOW="${UPTIME_NOW:-$(date -u +%s)}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/uptime.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

problems=()
notes=()

# fetch NAME URL [curl args...]: the status code on stdout, the body in $WORK/NAME.
fetch() {
  local name="$1" url="$2"; shift 2
  curl -sS -o "$WORK/$name" -w '%{http_code}' --max-time 20 "$@" "$url" 2>/dev/null || echo 000
}

# check NAME TEST: runs TEST (a function that returns 0 when well, and leaves its reason
# in $why), and once more after a pause when it fails.
check() {
  local name="$1" test="$2"
  why=""
  if "$test"; then echo "ok    $name"; return 0; fi
  sleep "$PAUSE"
  why=""
  if "$test"; then echo "ok    $name (on the second try)"; return 0; fi
  echo "DOWN  $name: $why"
  problems+=("$name: $why")
}

pages() {
  local code; code=$(fetch pages "$APP/today.html" -L)
  [ "$code" = 200 ] || { why="the app's page answered HTTP $code"; return 1; }
  grep -q 'supabase' "$WORK/pages" || { why="the app's page answered without its sign-in script"; return 1; }
}
tools() {
  local code; code=$(fetch tools "$TOOLS/site-review" -L)
  [ "$code" = 200 ] || { why="the free tools' page answered HTTP $code"; return 1; }
  grep -q 'id="srForm"' "$WORK/tools" || { why="the free tools' page answered without its form"; return 1; }
}
server() {
  local code; code=$(fetch plans "$API/commerce/plans" -H 'x-region: us-west-2')
  [ "$code" = 200 ] || { why="the server's price list answered HTTP $code"; return 1; }
  grep -qi 'plan' "$WORK/plans" || { why="the server's price list came back empty"; return 1; }
}
status() {
  local code; code=$(fetch status "$API/status" -H 'x-region: us-west-2')
  if [ "$code" = 404 ] || [ "$code" = 401 ]; then
    # Before item 417's release the other four checks still run, and this one says so
    # instead of failing every 15 minutes; from STATUS_LIVE_BY on it is an outage.
    if [ "$(date -u -d "@$NOW" +%Y-%m-%d 2>/dev/null || date -u -r "$NOW" +%Y-%m-%d)" \< "$STATUS_LIVE_BY" ]; then
      notes+=("The server's status read isn't live yet (HTTP $code; it goes out with the release that carries builder item 417).")
      return 0
    fi
    why="the status read is missing (HTTP $code), and it has been live since builder item 417's release"
    return 1
  fi
  [ "$code" = 200 ] || { why="the status read answered HTTP $code"; return 1; }
  # (not `.data.ok // "missing"`: jq's // treats false as missing)
  local ok; ok=$(jq -r 'if (.data | type) == "object" and (.data.ok | type) == "boolean" then .data.ok else "missing" end' "$WORK/status" 2>/dev/null) || ok=unreadable
  [ "$ok" = true ] && return 0
  if [ "$ok" != false ]; then why="the status read's answer couldn't be read"; return 1; fi
  # Which parts are false, in words. Only these booleans come back: no counts, no names.
  local parts=""
  for part in database schedule failures crashes settings; do
    [ "$(jq -r ".data.$part" "$WORK/status")" = false ] || continue
    case "$part" in
      database) parts="$parts the database isn't answering;" ;;
      schedule) parts="$parts the 15-minute job hasn't finished in 45 minutes;" ;;
      failures) parts="$parts scheduled work keeps failing (10 or more in a day, or a run stuck for two hours);" ;;
      crashes)  parts="$parts the server crashed more than 5 times in the last hour;" ;;
      settings) parts="$parts a setting the server can't run without is missing;" ;;
    esac
  done
  why="the server says it isn't well:${parts:- no reason given}"
  return 1
}
gate() {
  local code; code=$(fetch gate "$API/system/health" -H 'x-region: us-west-2')
  [ "$code" = 403 ] || { why="the health answer should refuse a caller without the secret (403) and answered HTTP $code"; return 1; }
}

echo "Checking Studio OS from outside at $(date -u '+%Y-%m-%d %H:%M UTC')"
check "App pages" pages
check "Free tools" tools
check "Server" server
check "Server status" status
check "Health answer locked" gate

{
  echo "### Studio OS from outside, $(date -u '+%Y-%m-%d %H:%M UTC')"
  echo
  if [ "${#problems[@]}" -eq 0 ]; then
    echo "Everything answered."
  else
    echo "**Down or unwell:**"
    echo
    for p in ${problems[@]+"${problems[@]}"}; do echo "- $p"; done
    echo
    echo "What to do: docs/RUN-SHEET.md, \"When something is down\"."
  fi
  for n in ${notes[@]+"${notes[@]}"}; do echo; echo "$n"; done
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

for n in ${notes[@]+"${notes[@]}"}; do echo "::notice title=Uptime::$n"; done
if [ "${#problems[@]}" -gt 0 ]; then
  for p in ${problems[@]+"${problems[@]}"}; do echo "::error title=Studio OS is down or unwell::$p"; done
  exit 1
fi
echo "Everything answered."
