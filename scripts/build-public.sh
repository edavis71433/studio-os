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

rm -rf dist
mkdir -p dist

# pages + styles + scripts (all root-level; server code lives under supabase/)
cp ./*.html dist/ 2>/dev/null || true
cp ./*.css dist/ 2>/dev/null || true
cp ./*.js dist/ 2>/dev/null || true

# platform files (exact names — package.json/deno.json are NOT public)
for f in _redirects _headers robots.txt security.txt sitemap.xml manifest.json manifest-app.json; do
  [ -f "$f" ] && cp "$f" dist/
done

# images at root (og-image, favicons, marketing screenshots)
cp ./*.png ./*.jpg ./*.jpeg ./*.webp ./*.svg ./*.ico dist/ 2>/dev/null || true

# public asset directories (marketing photos / case studies / vendored libs)
for d in life case-studies vendor fonts; do
  [ -d "$d" ] && cp -r "$d" dist/
done

echo "build-public: $(find dist -type f | wc -l) files staged"
# tripwire: server code or docs in dist = the allowlist grew a hole
if find dist -name "*.ts" -o -name "*.sql" -o -name "*.md" | grep -q .; then
  echo "build-public: REFUSING — server/doc file matched the allowlist" >&2
  find dist -name "*.ts" -o -name "*.sql" -o -name "*.md" >&2
  exit 1
fi
