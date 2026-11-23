#!/usr/bin/env bash
# ── Skip the Netlify build when nothing published changed (builder item 400) ────────
# netlify.toml runs this before every build ([build] ignore). Netlify's rule: exit 0
# stops the build, exit 1 lets it run. Each production deploy costs 15 credits, and in
# November 2026 22% of merges (84 of 376) changed no published file: server code,
# tests, docs, database changes. This stops those builds.
#
# It names what to skip, not what to build, the same way e2e.yml's `scope` step does:
# a file goes on the skip list only once it's clear scripts/build-public.sh can't copy
# it or read it. Anything else, a new folder or file type included, builds. Only a
# production build or a branch deploy can be skipped, and only when Netlify can say what
# it built last: a deploy preview always builds (they're free, and a pull request's
# first preview has nothing to compare with).
#
# The release workflow asks the same question with the same rule, to know whether the
# live pages already match the commit it released (scripts/pages-live.sh). And once
# scripts/pages-go-live.txt says "release", every production build is skipped: the release
# builds and uploads the pages itself (scripts/publish-pages.sh).
#
# Netlify gives it CONTEXT, COMMIT_REF and CACHED_COMMIT_REF (the commit it built last).
# Local use: CONTEXT=production CACHED_COMMIT_REF=<old> COMMIT_REF=<new> bash scripts/netlify-ignore.sh
set -uo pipefail

context="${CONTEXT:-}"
new="${COMMIT_REF:-}"
old="${CACHED_COMMIT_REF:-}"

build() { echo "Netlify build: runs. $*"; exit 1; }
skip() { echo "Netlify build: skipped. $*"; exit 0; }

case "$context" in
  production|branch-deploy) ;;
  *) build "A ${context:-build with no context} always builds." ;;
esac
# Once the release publishes the pages itself (scripts/pages-go-live.txt says "release",
# scripts/publish-pages.sh), Netlify's own production build of a merge is never needed.
mode="$(tr -d '[:space:]' < "$(dirname "$0")/pages-go-live.txt" 2>/dev/null || echo merge)"
if [ "$context" = production ] && [ "$mode" = release ]; then
  skip "The pages go live with the release (scripts/pages-go-live.txt), not on a merge."
fi
[ -n "$new" ] && [ -n "$old" ] || build "Netlify didn't say what it built last."
[ "$new" != "$old" ] || build "Nothing to compare with: this is the commit Netlify built last (a first build, or a retry)."
git cat-file -e "$old^{commit}" 2>/dev/null || build "The commit Netlify built last isn't in this clone."
git cat-file -e "$new^{commit}" 2>/dev/null || build "This commit isn't in this clone."

# --no-renames lists both sides of a move: a page moved into docs/ has left the site.
changed=$(git -c core.quotepath=off diff --name-only --no-renames "$old" "$new") || build "Couldn't compare the two commits."
[ -n "$changed" ] || build "No files changed, so nothing proves the build can be skipped."

while IFS= read -r file; do
  case "$file" in
    # Server code, database changes, tests, docs and workflows: build-public.sh copies only
    # files at the top of the repository and five asset folders (life, case-studies,
    # vendor, fonts, thumbs), so these can't reach what Netlify publishes.
    docs/*|supabase/*|runbooks/*|sql/*|templates/*|tests/*|.github/*) ;;
    # Notes and database files at the top: build-public.sh copies no .md or .sql, and its
    # last step refuses a build that holds one.
    */*) build "$file is in a folder that can reach the site." ;;
    *.md|*.sql) ;;
    # The browser tests' settings and the list of files git ignores.
    playwright.config.ts|.gitignore) ;;
    *) build "$file can reach the site." ;;
  esac
done <<< "$changed"

skip "$(printf '%s\n' "$changed" | grep -c '') changed files since $old, none of them published."
