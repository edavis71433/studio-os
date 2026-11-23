#!/usr/bin/env bash
# ── A weekly copy of every uploaded file, kept outside Supabase (builder item 415) ──
# Supabase's daily backups hold the database, not the files people upload: "Database
# backups do not include objects you store via the Storage API" (Supabase's backups page).
# So every photo, PDF, deliverable and form upload lived in one place. This copies every
# file in every bucket of production into one archive, encrypts it, proves the archive
# opens, and leaves it on the run for 35 days, so five weekly copies are always kept
# (.github/workflows/storage-copy.yml). Restoring from it: scripts/restore-drill.sh.
#
# The repository is public: anyone signed in to GitHub can download a run's artifacts and
# read its log. So the archive is encrypted before it is uploaded (AES-256, the same
# settings as the schema copy), and the log carries counts and sizes, never a file name.
#
# It reads production with the deploy token already in the repository's secrets
# (SUPABASE_ACCESS_TOKEN): Supabase's own API gives it the service key for this run
# (masked in the log) and the list of files. It writes nothing to production.
#
# Needs: curl, jq, openssl, tar, sha256sum (GitHub's runners have them all).
#   SUPABASE_ACCESS_TOKEN  PROJECT_REF  BACKUP_PASSPHRASE  [OUT_DIR]
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?the deploy token (repository secret SUPABASE_ACCESS_TOKEN)}"
: "${PROJECT_REF:?the production project ref (repository secret SUPABASE_PROJECT_REF_PROD)}"
OUT_DIR="${OUT_DIR:-$PWD}"
MGMT="${SUPABASE_MGMT_API:-https://api.supabase.com}"
SB="${SUPABASE_PROJECT_URL:-https://$PROJECT_REF.supabase.co}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/storage-copy.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "::error title=Copy of uploaded files::$*"; exit 1; }

# The ciphertext is public, so a short passphrase could be guessed offline.
if [ "${#BACKUP_PASSPHRASE}" -lt 32 ]; then
  fail "Repository secret BACKUP_PASSPHRASE is missing or under 32 characters. Nothing was read. docs/RUN-SHEET.md, \"Backups\", says how to set it."
fi

# 1. The service key, for this run only.
code=$(curl -sS -o "$WORK/keys.json" -w '%{http_code}' --max-time 30 \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "$MGMT/v1/projects/$PROJECT_REF/api-keys?reveal=true") || code=000
[ "$code" = 200 ] || fail "Supabase's API didn't give the project's keys (HTTP $code). Nothing was read."
KEY=$(jq -r '([.[] | select(.name == "service_role" and (.api_key // "") != "")] + [.[] | select(.type == "secret" and (.api_key // "") != "")]) | first | .api_key // empty' "$WORK/keys.json")
rm -f "$WORK/keys.json"
[ -n "$KEY" ] || fail "The project's keys came back without a service key. Nothing was read."
echo "::add-mask::$KEY"

# 2. The list of files, from the database (every bucket, every folder, in one read).
LIST_SQL="select bucket_id as b, name as n, coalesce((metadata->>'size')::bigint, 0) as s from storage.objects where name is not null order by bucket_id, name"
code=$(jq -n --arg q "$LIST_SQL" '{query: $q}' | curl -sS -o "$WORK/list.json" -w '%{http_code}' --max-time 120 -X POST \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' --data @- \
  "$MGMT/v1/projects/$PROJECT_REF/database/query") || code=000
[ "$code" = 200 ] || [ "$code" = 201 ] || fail "The list of files couldn't be read (HTTP $code). Nothing was copied."
jq -e 'type == "array"' "$WORK/list.json" > /dev/null || fail "The list of files came back in a shape this script doesn't know. Nothing was copied."
listed=$(jq 'length' "$WORK/list.json")
buckets=$(jq -r '[.[].b] | unique | length' "$WORK/list.json")
listed_bytes=$(jq '[.[].s] | add // 0' "$WORK/list.json")
echo "Files listed: $listed in $buckets bucket(s), $listed_bytes bytes."

# A name that climbs out of its folder could write outside the copy.
bad=$(jq '[.[] | select((.n | test("(^|/)\\.\\.(/|$)")) or (.n | startswith("/")) or (.b | test("^[A-Za-z0-9_.-]+$") | not))] | length' "$WORK/list.json")
[ "$bad" = 0 ] || fail "$bad file name(s) climb out of their folder or name an odd bucket. Nothing was copied."

# 3. Every file, eight at a time. Each line of the job list: index, bucket, the name
#    escaped for an address (each folder name on its own), the name as it is.
mkdir -p "$WORK/copy/files"
jq -r 'to_entries[] | [(.key | tostring), .value.b, (.value.n | split("/") | map(@uri) | join("/")), .value.n] | @tsv' "$WORK/list.json" > "$WORK/jobs.tsv"
export KEY SB WORK
fetch_one() {
  IFS=$'\t' read -r i b enc name <<< "$1"
  dest="$WORK/copy/files/$b/$name"
  mkdir -p "$(dirname "$dest")"
  if curl -sS --fail --max-time 300 --retry 2 -o "$dest" \
       -H "Authorization: Bearer $KEY" -H "apikey: $KEY" "$SB/storage/v1/object/authenticated/$b/$enc" 2>/dev/null; then
    printf '%s\t%s\t%s\t%s\n' "$b" "$(wc -c < "$dest" | tr -d ' ')" "$(sha256sum "$dest" | cut -d' ' -f1)" "$name" >> "$WORK/got.$i"
  else
    echo "$i" >> "$WORK/missed.$i"
  fi
}
export -f fetch_one
[ -s "$WORK/jobs.tsv" ] && tr '\n' '\0' < "$WORK/jobs.tsv" | xargs -0 -P 8 -I{} bash -c 'fetch_one "$1"' _ {}

# (find, not a bare glob: with set -e and pipefail, `cat` of a glob that matched nothing ends the run)
each() { find "$WORK" -maxdepth 1 -name "$1.*" -exec cat {} + 2>/dev/null || true; }
got=$(each got | wc -l | tr -d ' ')
missed=$(each missed | wc -l | tr -d ' ')
[ "$missed" = 0 ] || fail "$missed of $listed files couldn't be fetched (their numbers in the list: $(each missed | sort -n | head -20 | xargs)). Nothing was uploaded."
[ "$got" = "$listed" ] || fail "Fetched $got files but $listed were listed. Nothing was uploaded."

# 4. The manifest goes inside the archive, so a restore can prove every file came back whole.
{
  printf 'bucket\tbytes\tsha256\tname\n'
  each got | sort -t $'\t' -k1,1 -k4,4
} > "$WORK/copy/manifest.tsv"
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$WORK/copy/copied-at.txt"
bytes=$(each got | awk -F '\t' '{s += $2} END {print s + 0}')

# 5. One archive, encrypted, opened again before anyone relies on it.
day=$(date -u '+%Y-%m-%d')
tar -C "$WORK/copy" -czf "$WORK/uploaded-files.tar.gz" .
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt -pass env:BACKUP_PASSPHRASE \
  -in "$WORK/uploaded-files.tar.gz" -out "$OUT_DIR/uploaded-files-$day.tar.gz.enc"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:BACKUP_PASSPHRASE \
  -in "$OUT_DIR/uploaded-files-$day.tar.gz.enc" | cmp - "$WORK/uploaded-files.tar.gz" \
  || fail "The encrypted copy didn't open to the same archive. Nothing was uploaded."
size=$(wc -c < "$OUT_DIR/uploaded-files-$day.tar.gz.enc" | tr -d ' ')

line="Copied $got files from $buckets bucket(s), $bytes bytes, into one encrypted archive of $size bytes on $day."
echo "$line"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$line Kept 35 days. To open it: docs/RUN-SHEET.md, \"Backups\"." >> "$GITHUB_STEP_SUMMARY"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "file=uploaded-files-$day.tar.gz.enc" >> "$GITHUB_OUTPUT"
exit 0
