#!/usr/bin/env bash
# ── The restore drill: bring production back into a throwaway project (builder item 415) ──
# Nobody had ever brought the data back. This does it once, end to end, into a NEW,
# EMPTY Supabase project made for the drill and deleted after it, never into production:
#   1. the database: production's tables and rows (a fresh copy, with supabase db dump)
#      loaded into the drill project;
#   2. the files: the newest weekly encrypted copy (storage-copy.yml) opened and every
#      file put back in its bucket, each one checked against the copy's own list;
#   3. one client, opened: the newest live site's own rows and every file its pages
#      show, read back from the drill project and compared with production.
# It writes a report (counts only, no names) and refuses to touch production.
#
# Run it from .github/workflows/restore-drill.yml (Actions, "Restore drill", Run workflow),
# which has every tool it needs. docs/RUN-SHEET.md, "Restore", has the steps around it:
# making the throwaway project (it costs money while it exists, about 1.4 cents an hour on
# Supabase's smallest size), the two secrets the run needs, and deleting it all after.
#
#   PROD_DB_URL        production's database address (repository secret SUPABASE_DB_URL)
#   PROD_REF           production's project ref (SUPABASE_PROJECT_REF_PROD)
#   DRILL_DB_URL       the throwaway project's database address (secret DRILL_DB_URL)
#   DRILL_REF          the throwaway project's ref (typed when the run starts)
#   SUPABASE_ACCESS_TOKEN  the deploy token: reads the throwaway project's service key
#   ARCHIVE            the newest uploaded-files-*.tar.gz.enc, BACKUP_PASSPHRASE to open it
#   SUPABASE_CLI_VERSION   as deploy.yml pins it
set -euo pipefail

: "${PROD_DB_URL:?}" "${PROD_REF:?}" "${DRILL_DB_URL:?}" "${DRILL_REF:?}" "${SUPABASE_ACCESS_TOKEN:?}" "${ARCHIVE:?}" "${BACKUP_PASSPHRASE:?}"
CLI_VERSION="${SUPABASE_CLI_VERSION:?set SUPABASE_CLI_VERSION (deploy.yml pins it)}"
MGMT="${SUPABASE_MGMT_API:-https://api.supabase.com}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/restore-drill.XXXXXX")"
REPORT="${REPORT:-$WORK/report.md}"
trap 'rm -rf "$WORK/dump" "$WORK/files"' EXIT

fail() { echo "::error title=Restore drill::$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "Restore drill: stopped. $*" >> "$GITHUB_STEP_SUMMARY"; exit 1; }
say() { printf '\n── %s ──\n' "$*"; }
note() { echo "$*"; echo "- $*" >> "$REPORT"; }

# ── 0. Never production ──────────────────────────────────────────────────────────
[ "$DRILL_REF" != "$PROD_REF" ] || fail "The drill project is production. Nothing was done."
case "$DRILL_DB_URL" in *"$PROD_REF"*) fail "The drill database address points at production. Nothing was done." ;; esac
[ "$DRILL_DB_URL" != "$PROD_DB_URL" ] || fail "The drill database address is production's. Nothing was done."
case "$DRILL_DB_URL" in *"$DRILL_REF"*) ;; *) fail "The drill database address doesn't name the drill project ($DRILL_REF). Nothing was done." ;; esac
# A project made for the drill holds nothing yet: refuse one with tables of ours in it.
mine=$(psql "$DRILL_DB_URL" -At -c "select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'presence_%'") \
  || fail "The drill database doesn't answer."
[ "$mine" = 0 ] || fail "The drill project already has $mine Studio OS tables: use a new, empty project. Nothing was done."
echo "# Restore drill, $(date -u '+%Y-%m-%d %H:%M UTC')" > "$REPORT"; echo >> "$REPORT"

# ── 1. The database ─────────────────────────────────────────────────────────────
say "Copying production's database into the drill project"
mkdir -p "$WORK/dump"
npx --yes "supabase@$CLI_VERSION" db dump --db-url "$PROD_DB_URL" -f "$WORK/dump/roles.sql" --role-only > /dev/null
npx --yes "supabase@$CLI_VERSION" db dump --db-url "$PROD_DB_URL" -f "$WORK/dump/schema.sql" > /dev/null
npx --yes "supabase@$CLI_VERSION" db dump --db-url "$PROD_DB_URL" -f "$WORK/dump/data.sql" --use-copy --data-only > /dev/null
started=$(date +%s)
psql "$DRILL_DB_URL" -X -q --single-transaction -v ON_ERROR_STOP=1 \
  -f "$WORK/dump/roles.sql" -f "$WORK/dump/schema.sql" \
  -c 'set session_replication_role = replica' -f "$WORK/dump/data.sql" > "$WORK/load.log" 2>&1 \
  || { tail -5 "$WORK/load.log" | sed -E 's/(password|secret|key)[^ ]*/\1 [hidden]/Ig'; fail "Loading the copy into the drill project failed (the last lines above)."; }
note "Database loaded into the drill project in $(( $(date +%s) - started )) seconds."
rm -rf "$WORK/dump"

# Every table's rows, production against the drill project (counts only).
COUNT_SQL="select table_name || ' ' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
psql "$PROD_DB_URL" -At -c "$COUNT_SQL" > "$WORK/prod-counts.txt"
psql "$DRILL_DB_URL" -At -c "$COUNT_SQL" > "$WORK/drill-counts.txt"
tables=$(wc -l < "$WORK/prod-counts.txt" | tr -d ' ')
same=$(comm -12 <(sort "$WORK/prod-counts.txt") <(sort "$WORK/drill-counts.txt") | wc -l | tr -d ' ')
# Production keeps working during the drill, so a busy table can be a few rows ahead.
note "Tables with the same number of rows in both: $same of $tables."
comm -23 <(sort "$WORK/prod-counts.txt") <(sort "$WORK/drill-counts.txt") | awk '{print "  differs: " $1}' | tee -a "$REPORT"

# ── 2. The files ────────────────────────────────────────────────────────────────
say "Opening the newest copy of the uploaded files"
mkdir -p "$WORK/files"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:BACKUP_PASSPHRASE -in "$ARCHIVE" \
  | tar -C "$WORK/files" -xzf - || fail "The copy didn't open: a wrong BACKUP_PASSPHRASE, or a damaged file."
[ -f "$WORK/files/manifest.tsv" ] || fail "The copy has no list of its files (manifest.tsv)."
copied_at=$(cat "$WORK/files/copied-at.txt" 2>/dev/null || echo unknown)
files=$(( $(wc -l < "$WORK/files/manifest.tsv") - 1 ))
note "The copy of the uploaded files, made $copied_at, opened: $files files."

code=$(curl -sS -o "$WORK/keys.json" -w '%{http_code}' --max-time 30 -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "$MGMT/v1/projects/$DRILL_REF/api-keys?reveal=true") || code=000
[ "$code" = 200 ] || fail "Couldn't read the drill project's keys (HTTP $code)."
KEY=$(jq -r '([.[] | select(.name == "service_role" and (.api_key // "") != "")] + [.[] | select(.type == "secret" and (.api_key // "") != "")]) | first | .api_key // empty' "$WORK/keys.json")
rm -f "$WORK/keys.json"
[ -n "$KEY" ] || fail "The drill project's keys came back without a service key."
echo "::add-mask::$KEY"
SB="https://$DRILL_REF.supabase.co"

# The buckets come back with the database (storage.buckets); any that didn't is made again,
# private, before its files go back.
for b in $(cut -f1 "$WORK/files/manifest.tsv" | tail -n +2 | sort -u); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 -H "Authorization: Bearer $KEY" -H "apikey: $KEY" "$SB/storage/v1/bucket/$b") || code=000
  if [ "$code" != 200 ]; then
    curl -sS --fail -o /dev/null --max-time 30 -X POST -H "Authorization: Bearer $KEY" -H "apikey: $KEY" -H 'Content-Type: application/json' \
      --data "{\"id\":\"$b\",\"name\":\"$b\",\"public\":false}" "$SB/storage/v1/bucket" || fail "The bucket $b couldn't be made in the drill project."
    note "Bucket $b made again (the database copy didn't bring it)."
  fi
done
put=0; bad=0
while IFS=$'\t' read -r bucket bytes sha name; do
  [ "$bucket" = bucket ] && continue
  enc=$(jq -rn --arg n "$name" '$n | split("/") | map(@uri) | join("/")')
  type=$(file -b --mime-type "$WORK/files/files/$bucket/$name" 2>/dev/null || echo application/octet-stream)
  if curl -sS --fail --max-time 300 -o /dev/null -X POST -H "Authorization: Bearer $KEY" -H "apikey: $KEY" \
       -H "x-upsert: true" -H "Content-Type: $type" --data-binary "@$WORK/files/files/$bucket/$name" \
       "$SB/storage/v1/object/$bucket/$enc" 2>/dev/null; then
    put=$((put + 1))
  else
    bad=$((bad + 1))
  fi
done < "$WORK/files/manifest.tsv"
note "Files put back: $put of $files ($bad failed)."
[ "$bad" = 0 ] || fail "$bad files couldn't be put back into the drill project."

# Read every file back and check it is the same file.
same=0; diff=0
while IFS=$'\t' read -r bucket bytes sha name; do
  [ "$bucket" = bucket ] && continue
  enc=$(jq -rn --arg n "$name" '$n | split("/") | map(@uri) | join("/")')
  got=$(curl -sS --fail --max-time 300 -H "Authorization: Bearer $KEY" -H "apikey: $KEY" \
    "$SB/storage/v1/object/authenticated/$bucket/$enc" 2>/dev/null | sha256sum | cut -d' ' -f1) || got=""
  if [ "$got" = "$sha" ]; then same=$((same + 1)); else diff=$((diff + 1)); fi
done < "$WORK/files/manifest.tsv"
note "Files read back whole: $same of $files."
[ "$diff" = 0 ] || fail "$diff files came back different from the copy."

# ── 3. One client, opened ────────────────────────────────────────────────────────
say "Opening one client in the drill project"
SITE_SQL="select id from public.presence_sites where offline_at is null and (status = 'live' or last_published_at is not null) order by last_published_at desc nulls last limit 1"
site=$(psql "$PROD_DB_URL" -At -c "$SITE_SQL")
[ -n "$site" ] || fail "Production has no live site to open."
ONE_SQL="select (select count(*) from public.presence_sites where id = '$site') || ' ' || (select count(*) from public.presence_media where site_id = '$site') || ' ' || (select count(*) from public.presence_publishes where site_id = '$site')"
[ "$(psql "$PROD_DB_URL" -At -c "$ONE_SQL")" = "$(psql "$DRILL_DB_URL" -At -c "$ONE_SQL")" ] \
  || fail "The newest live site's rows (the site, its files, its publishes) differ between production and the drill project."
media=$(psql "$DRILL_DB_URL" -At -c "select storage_path from public.presence_media where site_id = '$site' and deleted_at is null and storage_path is not null")
opened=0; missing=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  obj="${path#presence-media/}"
  enc=$(jq -rn --arg n "$obj" '$n | split("/") | map(@uri) | join("/")')
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 60 -H "Authorization: Bearer $KEY" -H "apikey: $KEY" \
    "$SB/storage/v1/object/authenticated/presence-media/$enc" 2>/dev/null) || code=000
  if [ "$code" = 200 ]; then opened=$((opened + 1)); else missing=$((missing + 1)); fi
done <<< "$media"
note "The newest live site, opened in the drill project: its rows match production, and $opened of $((opened + missing)) of its files open."
[ "$missing" = 0 ] || fail "$missing of the newest live site's files don't open in the drill project."

echo >> "$REPORT"
echo "Everything came back. Delete the drill project and the DRILL_DB_URL secret now (docs/RUN-SHEET.md, \"Restore\")." >> "$REPORT"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$REPORT" >> "$GITHUB_STEP_SUMMARY"
cat "$REPORT"
