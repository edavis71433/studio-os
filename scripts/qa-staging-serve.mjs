// ── QA staging serve (P2-C1 human-QA harness) ────────────────────────────────
// The app pages hardcode PROD Supabase config, so a browser can't reach the
// VALIDATED staging schema. This serves the repo's pages UNCHANGED, swapping the
// prod project-ref + prod anon key for staging IN MEMORY (nothing on disk is
// modified). Fully reversible: stop the server (Ctrl+C). No forked config, no
// second environment — it's the same staging backend, reached via a local proxy
// of the static pages. Anon keys only (both are public by design); no service key.
//
//   deno run --allow-read --allow-net scripts/qa-staging-serve.mjs
//   then open http://localhost:8788/  (sign in, then use Pipeline/Messages/Customers)
//
// To mint keys elsewhere: supabase projects api-keys --project-ref <ref>.
let PORT = 8788;
try { const p = Number(Deno.env.get('QA_PORT')); if (Number.isFinite(p) && p > 0) PORT = p; } catch { /* --allow-env not needed */ }
const ROOT = new URL('../', import.meta.url);

const PROD_REF = 'qksstlqzbhesadrrofgn';
const STG_REF  = 'wjlpursnwbmlcdwbeowv';
// public anon keys (the prod one is already committed in every page; staging is equally public)
const PROD_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrc3N0bHF6Ymhlc2FkcnJvZmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NzMwMDMsImV4cCI6MjA5NzU0OTAwM30.4V94Ua7z5cntPWtvtqN24TUnfY5A6K6-zCxY0iEcgYo';
const STG_ANON  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqbHB1cnNud2JtbGNkd2Jlb3d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNzExMzUsImV4cCI6MjA5ODg0NzEzNX0.XAWyxx-7WsDC6Eg4nc2dlcFmHRe6NUKYEVBkjRvkGXQ';

const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', map: 'application/json' };
const SWAPPABLE = new Set(['html', 'js', 'mjs', 'css']);

function swap(text) { return text.split(PROD_ANON).join(STG_ANON).split(PROD_REF).join(STG_REF); }

Deno.serve({ port: PORT, hostname: '0.0.0.0' }, (req) => {
  let path = decodeURIComponent(new URL(req.url).pathname);
  if (path === '/' || path === '') path = '/portal.html';       // start at sign-in
  if (path.includes('..')) return new Response('no', { status: 400 }); // traversal guard
  const ext = (path.split('.').pop() || '').toLowerCase();
  const ct = TYPES[ext] || 'application/octet-stream';
  try {
    const file = new URL('.' + path, ROOT);
    if (SWAPPABLE.has(ext)) {
      const text = swap(Deno.readTextFileSync(file));
      return new Response(text, { headers: { 'content-type': ct, 'cache-control': 'no-store' } });
    }
    return new Response(Deno.readFileSync(file), { headers: { 'content-type': ct, 'cache-control': 'no-store' } });
  } catch {
    return new Response('Not found: ' + path, { status: 404, headers: { 'content-type': 'text/plain' } });
  }
});

console.log(`\nQA staging serve running — pages point at STAGING (${STG_REF}), config swapped in memory.`);
console.log(`  Desktop:  http://localhost:${PORT}/`);
console.log(`  Mobile:   http://<this-machine-LAN-IP>:${PORT}/   (same Wi-Fi)`);
console.log(`Stop with Ctrl+C to revert (no repo files were modified).\n`);
