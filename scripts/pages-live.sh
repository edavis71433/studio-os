#!/usr/bin/env bash
# ── Are the live pages the ones this commit publishes? (builder item 400) ─────────
#   bash scripts/pages-live.sh <commit> release|rollback
# Since item 400 the release can publish the app's pages itself (scripts/publish-pages.sh,
# once scripts/pages-go-live.txt says "release"), and this waits until the live site says it
# carries the released commit. Every build writes the commit it was built from into
# /version.json (scripts/build-public.sh), which nothing caches.
#
# The live pages match when any of these is true:
#   - /version.json names the commit;
#   - it names another commit, and between the two nothing published changed (Netlify
#     skipped the build, scripts/netlify-ignore.sh: the same rule decides both, asked with
#     PAGES_CHANGES_ONLY=1 so that "release" in scripts/pages-go-live.txt, which skips every
#     Netlify build, can't make any older live commit look like a match);
#   - release only: it names a newer commit of main. That is how it looks while Netlify
#     still publishes main on every merge (scripts/pages-go-live.txt says "merge"), and the
#     pages are then ahead of the release, as before item 400.
#
# A release that can't see its pages after PAGES_WAIT_MINUTES (10) fails: the server is
# already live, and the message says what to look at. A rollback only warns, because while
# Netlify publishes main on every merge the pages can't go back from here at all.
set -uo pipefail

SHA="${1:?the commit}"
MODE="${2:-release}"
SITE="${PAGES_URL:-https://app.davisdigitalstudio.com}"
wait_minutes="${PAGES_WAIT_MINUTES:-10}"
poll="${PAGES_POLL_SECONDS:-20}"
give_up=$(( $(date +%s) + wait_minutes * 60 ))
here="$(cd "$(dirname "$0")" && pwd)"

matches() {   # the live commit, the commit released: 0 when the live pages are this commit's
  local live="$1"
  [ "$live" = "$SHA" ] && { echo "The live pages are this commit's."; return 0; }
  git cat-file -e "$live^{commit}" 2>/dev/null || return 1
  if PAGES_CHANGES_ONLY=1 CONTEXT=production CACHED_COMMIT_REF="$live" COMMIT_REF="$SHA" bash "$here/netlify-ignore.sh" > /dev/null 2>&1; then
    echo "The live pages are from ${live:0:8}, and nothing published changed since: they are this commit's pages."
    return 0
  fi
  if [ "$MODE" = release ] && git merge-base --is-ancestor "$SHA" "$live" 2>/dev/null; then
    echo "The live pages are from ${live:0:8}, newer than this release: Netlify still publishes main on every merge (scripts/pages-go-live.txt)."
    return 0
  fi
  return 1
}

last=""
while :; do
  code=$(curl -sS -o version.json -w '%{http_code}' --max-time 20 "$SITE/version.json?t=$(date +%s)" 2>/dev/null) || code=000
  live=""
  [ "$code" = 200 ] && live=$(jq -r '.commit // empty' version.json 2>/dev/null | grep -E '^[0-9a-f]{40}$' || true)
  rm -f version.json
  if [ -n "$live" ] && matches "$live"; then exit 0; fi
  if [ -n "$live" ]; then now="the live pages are from ${live:0:8}"; else now="the live pages don't say their commit (HTTP $code)"; fi
  [ "$now" != "$last" ] && echo "Waiting: $now."
  last="$now"
  [ "$(date +%s)" -ge "$give_up" ] && break
  sleep "$poll"
done

if [ "$MODE" = rollback ]; then
  echo "::warning title=Pages::The functions went back to ${SHA:0:8}, but after $wait_minutes minutes $last. While Netlify publishes main on every merge (scripts/pages-go-live.txt), put the pages back with Netlify's own Publish deploy button on an older deploy."
  exit 0
fi
echo "::error title=Pages::The server is live at ${SHA:0:8}, but after $wait_minutes minutes $last. Open the app site's deploy list at Netlify: a failed build says why. Run this release again once it's fixed, or the rollback to put the server back."
exit 1
