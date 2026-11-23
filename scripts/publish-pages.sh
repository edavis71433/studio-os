#!/usr/bin/env bash
# ── Publish the pages with the release (builder item 400) ──────────────────────────
#   bash scripts/publish-pages.sh <commit> [folder to build, default this repository]
# Netlify used to build and publish the app's pages on every merge: 358 production deploys
# in November at 15 credits each, the cache emptied every couple of hours, and pages live
# at merge while the server went live only at release. scripts/pages-go-live.txt holds one
# word that says who publishes:
#   merge    Netlify builds main on every merge (as before). This does nothing.
#   release  The release publishes: this builds the pages of <commit> here, on GitHub's
#            machine, exactly as Netlify would (scripts/build-public.sh), uploads them to
#            the app's Netlify site as one deploy, and waits until Netlify says it is live.
#            Netlify's own builds of main are then skipped (scripts/netlify-ignore.sh).
# A rollback publishes the older commit's pages the same way.
#
# Needs, for "release": the repository secret NETLIFY_AUTH_TOKEN (a Netlify personal access
# token) and the variable NETLIFY_SITE_ID (the app site's API ID). docs/RUN-SHEET.md,
# "Pages", has the switch-over steps. Also node and npm, curl, jq, zip.
set -euo pipefail

SHA="${1:?the commit}"
SRC="$(cd "${2:-$(dirname "$0")/..}" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
MODE="$(tr -d '[:space:]' < "$HERE/pages-go-live.txt" 2>/dev/null || echo merge)"
API="${NETLIFY_API:-https://api.netlify.com/api/v1}"
WAIT="${PAGES_DEPLOY_WAIT_SECONDS:-600}"
POLL="${PAGES_POLL_SECONDS:-10}"

if [ "$MODE" != release ]; then
  echo "Pages: Netlify publishes main on every merge (scripts/pages-go-live.txt says \"$MODE\"), so this publishes nothing."
  exit 0
fi
fail() { echo "::error title=Pages::$*"; exit 1; }
[ -n "${NETLIFY_AUTH_TOKEN:-}" ] || fail "scripts/pages-go-live.txt says the release publishes the pages, but the repository secret NETLIFY_AUTH_TOKEN isn't set. The server is live; the pages are still the previous ones. docs/RUN-SHEET.md, \"Pages\"."
[ -n "${NETLIFY_SITE_ID:-}" ] || fail "scripts/pages-go-live.txt says the release publishes the pages, but the repository variable NETLIFY_SITE_ID isn't set. The server is live; the pages are still the previous ones."

WORK="$(mktemp -d "${TMPDIR:-/tmp}/publish-pages.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# 1. The pages of <commit>, built as Netlify builds them.
if [ ! -d "$SRC/node_modules" ]; then (cd "$SRC" && npm ci --no-audit --no-fund > "$WORK/npm.log" 2>&1) || { tail -20 "$WORK/npm.log"; fail "Installing the build's packages failed (above)."; }; fi
(cd "$SRC" && COMMIT_REF="$SHA" BUILD_OUT="$WORK/dist" ${PAGES_BUILD_CMD:-bash scripts/build-public.sh}) > "$WORK/build.log" 2>&1 \
  || { tail -20 "$WORK/build.log"; fail "Building the pages of ${SHA:0:8} failed (above). The server is live; the pages are still the previous ones."; }
[ -f "$WORK/dist/index.html" ] || fail "The build of ${SHA:0:8} made no index.html."
grep -q "\"commit\":\"$SHA\"" "$WORK/dist/version.json" 2>/dev/null || fail "The build doesn't say it is ${SHA:0:8} (version.json)."
files=$(find "$WORK/dist" -type f | wc -l | tr -d ' ')
(cd "$WORK/dist" && zip -qr "$WORK/site.zip" .)

# 2. One deploy, uploaded.
code=$(curl -sS -o "$WORK/deploy.json" -w '%{http_code}' --max-time 300 -X POST \
  -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" -H 'Content-Type: application/zip' \
  --data-binary "@$WORK/site.zip" "$API/sites/$NETLIFY_SITE_ID/deploys") || code=000
case "$code" in
  200|201) ;;
  # Netlify answers 404 (or 401, 403) when the token's login can't see the site: Nov 23 2026,
  # the first try used a token from a second Netlify login.
  401|403|404) fail "Netlify refused the upload (HTTP $code): the token's Netlify login can't see this site (NETLIFY_SITE_ID). Make NETLIFY_AUTH_TOKEN while signed in to the Netlify login that owns the app's site (docs/RUN-SHEET.md, \"Pages\"). The server is live; the pages are still the previous ones." ;;
  *) fail "Netlify refused the upload (HTTP $code). The server is live; the pages are still the previous ones." ;;
esac
id=$(jq -r '.id // empty' "$WORK/deploy.json")
[ -n "$id" ] || fail "Netlify's answer named no deploy."
echo "Pages: uploaded $files files of ${SHA:0:8} as Netlify deploy $id."

# 3. Live once Netlify says it is ready.
give_up=$(( $(date +%s) + WAIT ))
while :; do
  state=$(curl -sS --max-time 30 -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" "$API/deploys/$id" | jq -r '.state // empty' 2>/dev/null || true)
  case "$state" in
    ready) echo "Pages: deploy $id is live."; exit 0 ;;
    error|rejected) fail "Netlify ended deploy $id as \"$state\". The server is live; the pages are still the previous ones." ;;
  esac
  [ "$(date +%s)" -ge "$give_up" ] && fail "Netlify hadn't finished deploy $id after $WAIT seconds (it said \"${state:-nothing}\")."
  sleep "$POLL"
done
