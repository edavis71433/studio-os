#!/usr/bin/env bash
# ── Allowlist publish build ───────────────────────────────────────────────────
# The site used to publish the REPO ROOT behind a _redirects denylist — which a
# security audit live-verified as ineffective for physically-existing files
# (backend source, migrations, and internal docs were downloadable). An
# allowlist is the only reliable posture: this script copies ONLY the files the
# public site consists of into dist/, and Netlify publishes dist/ (netlify.toml).
# The _redirects 404! rules stay as defense-in-depth.
#
# If a new PUBLIC asset type is ever added, add it HERE — a missing asset shows
# up instantly as a broken page (fail-visible), unlike the old fail-open root.
set -euo pipefail
cd "$(dirname "$0")/.."

# MS1 tripwire: every marketing page's header/footer must match the ONE
# canonical chrome (scripts/marketing-chrome.template.html). Hand-copied
# nav drift was the root cause of "my pricing disappeared" — fail the build
# rather than publish a diverged nav.
node scripts/sync-marketing-chrome.mjs --check

# MS5 tripwire: the five industry landers' shared shell must match the ONE
# canonical template (scripts/industry-shell.template.html) — same drift
# class, same defense.
node scripts/sync-industry-shell.mjs --check

# Where to stage: dist/ (what netlify.toml publishes), or BUILD_OUT, so a test can build its
# own copy without racing the one marketing.spec.ts inspects (tests/e2e/packed-site.spec.ts).
OUT="${BUILD_OUT:-dist}"
rm -rf "$OUT"
mkdir -p "$OUT"

# pages + styles + scripts (all root-level; server code lives under supabase/)
cp ./*.html "$OUT"/ 2>/dev/null || true
cp ./*.css "$OUT"/ 2>/dev/null || true
cp ./*.js "$OUT"/ 2>/dev/null || true

# MS6 (overhaul doc §MS7.2): carve INTERNAL pages back out of the *.html glob —
# email-signature (mail-provider setup steps), styleguide (internal design
# instructions), and a11y (internal check page) are repo files, not public
# site. _redirects also force-404s their URLs as defense-in-depth.
# Pinned by tests/e2e/marketing.spec.ts (MS6), which runs this script and
# inspects dist/. provision.html joined the list in Oct 2026 (studio audit
# change 12): an unlinked, unauthenticated provisioning form is not public site.
# Builder item 199 retired that partner pack and deleted the file (Nov 15 2026); its
# name stays on the list so it can never ship again if it comes back.
for f in email-signature.html styleguide.html a11y.html provision.html; do
  rm -f "$OUT/$f"
done

# List item 139: the retired tools stay out too. Each address forwards (_redirects,
# forced 301s): the free tools to tools.davisdigitalstudio.com, the paid-audit checkout
# to the main site's audits page, the resources hub to its free tools page. Pinned by
# tests/e2e/marketing.spec.ts, which runs this script and inspects dist/.
for f in audit.html ai-critique.html report-card.html roi-calculator.html pricing-estimator.html local-visibility.html tools.html buy-audit.html; do
  rm -f "$OUT/$f"
done

# platform files (exact names — package.json/deno.json are NOT public). whats-new.json is the
# What's new panel's entries (builder item 128): public words and picture paths, nothing else.
for f in _redirects _headers robots.txt tools-robots.txt security.txt sitemap.xml tools-sitemap.xml manifest.json manifest-app.json whats-new.json; do
  [ -f "$f" ] && cp "$f" "$OUT"/
done

# images at root (og-image, favicons, marketing screenshots)
cp ./*.png ./*.jpg ./*.jpeg ./*.webp ./*.svg ./*.ico "$OUT"/ 2>/dev/null || true

# public asset directories (marketing photos / case studies / vendored libs / the builder's
# picker pictures, made by scripts/thumbnails)
for d in life case-studies vendor fonts thumbs; do
  [ -d "$d" ] && cp -r "$d" "$OUT"/
done

echo "build-public: $(find "$OUT" -type f | wc -l) files staged"

# Builder item 142 (review file 06, finding 3): pack the code down and give the app's scripts
# and styles an address that changes with their contents, kept a year (/v/* in _headers).
# Only dist/ changes: the repo keeps the readable files, and the tests read those.
node scripts/pack-public.mjs "$OUT"
# tripwire: server code or docs in dist = the allowlist grew a hole
if find "$OUT" -name "*.ts" -o -name "*.sql" -o -name "*.md" | grep -q .; then
  echo "build-public: REFUSING — server/doc file matched the allowlist" >&2
  find "$OUT" -name "*.ts" -o -name "*.sql" -o -name "*.md" >&2
  exit 1
fi
