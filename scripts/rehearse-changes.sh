#!/usr/bin/env bash
# ── Database changes, rehearsed on a scratch database (builder item 420) ───────────
# Production gets each database change by hand, from an apply pack pasted into its SQL
# editor. This is the free dress rehearsal, on every pull request
# (.github/workflows/rehearsal.yml): a throwaway database on the runner, built the way
# production was, then every apply pack from the ledger's start run on top, twice.
#
# What it does, in order:
#   1. starts a scratch Supabase with Docker (the CLI version deploy.yml pins) and applies
#      every migration in supabase/migrations in order, as production has them: 0003 to
#      0005 are fenced and production never applied them, so they're left out here too
#      (the same rule as scripts/isolation-scratch.sh);
#   2. runs each apply pack numbered 0260 or later (docs/presence/APPLY-NNNN-prod.sql),
#      in order, twice: a pack has to be safe to run again, because the SQL editor
#      makes that easy;
#   3. checks the ledger (presence_change_ledger, migration 0260): every migration from
#      0260 on wrote its number, every pack wrote its number on each run, and the newest
#      number is the newest file in supabase/migrations, the same question the release
#      asks production before it goes out (deploy.yml, "Database changes are in place").
#
# Nothing here reads a repository secret or reaches production. Needs docker, node (npx).
# Local use, with Docker running:
#   SUPABASE_CLI_VERSION=2.122.0 bash scripts/rehearse-changes.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CLI_VERSION="${SUPABASE_CLI_VERSION:?set SUPABASE_CLI_VERSION (deploy.yml pins it)}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/rehearse-changes.XXXXXX")"
PROJECT=rehearse-changes
supabase() { (cd "$WORK" && npx --yes "supabase@$CLI_VERSION" "$@"); }
FIRST_LEDGER=260

say() { printf '\n── %s ──\n' "$*"; }
fail() {
  printf '::error title=Database changes rehearsal::%s\n' "$*"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "Database changes rehearsal: failed on $(date -u '+%Y-%m-%d at %H:%M UTC'). $*" >> "$GITHUB_STEP_SUMMARY"
  exit 1
}
cleanup() { supabase stop --no-backup > /dev/null 2>&1 || true; }
trap cleanup EXIT

# ── 1. Every migration, in order ─────────────────────────────────────────────────
say "Setting up a scratch project in $WORK"
supabase init < /dev/null > /dev/null
sed -i.bak "s/^project_id = .*/project_id = \"$PROJECT\"/" "$WORK/supabase/config.toml" && rm -f "$WORK/supabase/config.toml.bak"
mkdir -p "$WORK/supabase/migrations"
copied=0
for f in "$REPO"/supabase/migrations/[0-9]*.sql; do
  case "$(basename "$f")" in
    0003_*|0004_*|0005_*) continue ;;   # fenced: production never applied them
  esac
  cp "$f" "$WORK/supabase/migrations/"
  copied=$((copied + 1))
done
newest=$(ls "$REPO/supabase/migrations/" | sed -nE 's/^([0-9]{4})_.*\.sql$/\1/p' | sort -n | tail -1)
echo "migrations copied: $copied (newest $newest)"

say "Starting the scratch database (Supabase CLI $CLI_VERSION)"
# The database, sign-in and file storage only: the migrations reach into the auth and
# storage schemas. Only names this CLI version knows: an unknown one stops `start`.
known="$(supabase start --help 2>&1 || true)"
skip=""
for name in studio imgproxy mailpit inbucket realtime logflare vector supavisor postgres-meta edge-runtime; do
  if printf '%s' "$known" | grep -qE "[[,]$name[],]"; then skip="$skip${skip:+,}$name"; fi
done
if ! supabase start ${skip:+-x "$skip"} > "$WORK/start.log" 2>&1; then
  grep -nE 'ERROR|error|failed|Applying migration' "$WORK/start.log" | tail -40
  fail "A migration didn't apply on a fresh database (the lines above name it). Production can't be rebuilt from the repository until it does."
fi
applied=$(grep -c 'Applying migration' "$WORK/start.log" || true)
echo "migrations applied in order: $applied"

DB="supabase_db_$PROJECT"
psql_() { docker exec -i "$DB" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql_ -c 'select 1' > /dev/null || fail "The scratch database started but doesn't answer."

# ── 2. Every apply pack from the ledger's start, in order, twice ─────────────────
packs=()
for f in "$REPO"/docs/presence/APPLY-[0-9][0-9][0-9][0-9]-prod.sql; do
  n=$(basename "$f" | sed -E 's/^APPLY-([0-9]{4})-prod\.sql$/\1/')
  [ $((10#$n)) -ge "$FIRST_LEDGER" ] && packs+=("$f")
done
echo "apply packs from $FIRST_LEDGER on: ${#packs[@]}"
for f in ${packs[@]+"${packs[@]}"}; do
  for run in 1 2; do
    say "$(basename "$f"), run $run of 2"
    if ! psql_ < "$f" > "$WORK/pack.log" 2>&1; then
      tail -20 "$WORK/pack.log"
      fail "$(basename "$f") failed on run $run (the lines above say where). A pack has to run cleanly on a database that already has the change."
    fi
  done
done

# ── 3. The ledger says what the release will ask ─────────────────────────────────
say "The ledger"
ledger=$(psql_ -At -F ' ' -c "select number, runs from public.presence_change_ledger order by number" 2>&1) \
  || fail "The ledger (presence_change_ledger, migration 0260) isn't on the scratch database."
echo "$ledger" | sed 's/^/  /'
bad=""
for f in "$REPO"/supabase/migrations/[0-9]*.sql; do
  n=$((10#$(basename "$f" | sed -E 's/^([0-9]{4})_.*/\1/')))
  [ "$n" -ge "$FIRST_LEDGER" ] || continue
  printf '%s\n' "$ledger" | grep -qE "^$n " || bad="$bad migration $(basename "$f") wrote no ledger row;"
done
for f in ${packs[@]+"${packs[@]}"}; do
  n=$((10#$(basename "$f" | sed -E 's/^APPLY-([0-9]{4})-prod\.sql$/\1/')))
  runs=$(printf '%s\n' "$ledger" | awk -v n="$n" '$1 == n {print $2}')
  [ "${runs:-0}" -ge 2 ] || bad="$bad $(basename "$f") didn't write its number on each run (runs: ${runs:-none});"
done
top=$(printf '%s\n' "$ledger" | awk 'END {print $1}')
[ "$top" = "$((10#$newest))" ] || bad="$bad the ledger's newest number is ${top:-none}, and the newest migration is $newest;"
# The release's own question, asked here first (deploy.yml sends the same query to production).
gate=$(psql_ -At -c "select coalesce(max(number), 0) || ' ' || coalesce(bool_or(number = $((10#$newest))), false) from public.presence_change_ledger")
[ "$gate" = "$((10#$newest)) true" ] || bad="$bad the release's question answered \"$gate\";"
[ -z "$bad" ] || fail "${bad# }"

line="Database changes rehearsal: $applied migrations applied in order on a fresh database, ${#packs[@]} apply pack(s) from $FIRST_LEDGER on run twice each, and the ledger's newest change is $newest, on $(date -u '+%Y-%m-%d at %H:%M UTC')."
echo; echo "$line"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$line" >> "$GITHUB_STEP_SUMMARY"
exit 0
