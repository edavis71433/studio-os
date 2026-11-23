#!/usr/bin/env bash
# ── A scratch Supabase that can always get its ports ──────────────────────────────
# Sourced, not run, by the scripts that build a throwaway Supabase with Docker on the
# machine they run on: scripts/isolation-scratch.sh (every release),
# scripts/rehearse-changes.sh (every pull request) and scripts/publish-journey.sh
# (switched off). Each defines `supabase` (the pinned CLI, run in its scratch folder)
# first, calls scratch_ports on the config `supabase init` wrote, and starts the stack
# with scratch_start.
#
# Why: `supabase init` puts the stack on ports 54320 to 54329. Those sit inside the range
# a machine hands out to its own outgoing connections (32768 to 60999 on GitHub's Linux
# machines, 49152 to 65535 on a Mac), and `supabase start` opens many of them while it
# downloads its images. Now and then one is given 54322 first, and the database can't
# listen there: "failed to bind host port 0.0.0.0:54322/tcp: address already in use".
# That stopped the walls check of two releases on Nov 23 2026 (01:07 and 03:02 UTC), each
# on a fresh machine. Linux gives outgoing connections even numbers first, which is why it
# was 54322 (the database) and not 54321 (the API). No outgoing connection is ever given
# a port below 32768, on Linux or on a Mac, so the stack moves there: 543NN becomes 243NN.
# tests/workflows/isolation_scope_test.mjs holds this in place.

# Moves every port in a scratch project's config from 543NN to 243NN (the API, the
# database and its shadow, and the services left off), then checks that the two the
# scripts use, the API and the database, are where they should be.
scratch_ports() {   # the scratch project's supabase/config.toml
  local cfg="$1"
  sed -i.bak -E 's/^(([a-z0-9]+_)?port = )543([0-9][0-9])$/\1243\3/' "$cfg" && rm -f "$cfg.bak"
  if ! grep -qx 'port = 24321' "$cfg" || ! grep -qx 'port = 24322' "$cfg"; then
    echo "The scratch config doesn't have the API and database ports where this expects them:"
    grep -nE '^([a-z0-9]+_)?port = ' "$cfg" || true
    return 1
  fi
}

# Starts the stack, its output in the log. If a port was taken anyway (another program
# listening there, or a machine that hands out lower ports), it stops what started,
# waits, and tries once more. Any other failure is the caller's to report.
scratch_start() {   # the log's path, then the arguments for `supabase start`
  local log="$1"; shift
  supabase start "$@" > "$log" 2>&1 && return 0
  grep -q 'address already in use' "$log" || return 1
  echo "A port was taken ($(grep -m1 -oE 'host port [^ ]+/(tcp|udp)' "$log" || echo 'see the log')): stopping the scratch stack and trying once more in ${SCRATCH_RETRY_SECONDS:-30} seconds."
  mv "$log" "$log.first"
  supabase stop --no-backup > /dev/null 2>&1 || true
  sleep "${SCRATCH_RETRY_SECONDS:-30}"
  supabase start "$@" > "$log" 2>&1 && return 0
  if grep -q 'address already in use' "$log"; then
    echo "The port was taken again on the second try: that is the machine, not the code. The check should pass when it runs again."
  fi
  return 1
}
