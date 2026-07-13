// ── Published-tenant security headers suite ──────────────────────────────────
// Closes the parity gap: tenant sites we publish must ship response-level HSTS,
// clickjacking, MIME-sniff, referrer, permissions + a real CSP header via a
// Netlify `_headers` file (they previously carried only a <meta> CSP). This
// suite verifies the ONE source of truth (lib/security_headers.ts) and that the
// publish-time merge over the REAL template `_headers` produces a correct,
// deterministic, non-clobbering result — mirroring routes/publish.ts exactly.
//
//   deno run --allow-read tests/presence/security_headers_test.mjs
import { mergeSecurityHeaders, SECURITY_RESPONSE_HEADERS, PUBLISHED_CSP_RESPONSE } from '../../supabase/functions/presence/lib/security_headers.ts';
import { PUBLISHED_CSP, renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// The exact publish-time injection: render a real snapshot, then merge over the
// template's own `_headers` the way routes/publish.ts does.
const fixture = JSON.parse(read('supabase/functions/presence/templates/restaurant-classic/1.0.0/fixture.json'));
const fileMap = renderSnapshot(fixture, { baseUrl: 'https://example-tenant.example' });
const templateHeaders = String(fileMap['_headers'] ?? '');
const merged = mergeSecurityHeaders(typeof templateHeaders === 'string' ? templateHeaders : undefined);

// ═══ 1. every required directive is present in the published `_headers` ═══
{
  const required = [
    ['HSTS (>=1yr, includeSubDomains, preload)', /Strict-Transport-Security:\s*max-age=(\d+); includeSubDomains; preload/],
    ['X-Frame-Options DENY', /X-Frame-Options:\s*DENY/],
    ['X-Content-Type-Options nosniff', /X-Content-Type-Options:\s*nosniff/],
    ['Referrer-Policy', /Referrer-Policy:\s*strict-origin-when-cross-origin/],
    ['Permissions-Policy', /Permissions-Policy:\s*camera=\(\), microphone=\(\), geolocation=\(\), payment=/],
    ['Content-Security-Policy header', /Content-Security-Policy:\s*\S/],
    ['CSP frame-ancestors none', /Content-Security-Policy:[^\n]*frame-ancestors 'none'/],
  ];
  let bad = [];
  for (const [label, re] of required) if (!re.test(merged)) bad.push(label);
  ok('_headers ships HSTS + X-Frame + nosniff + Referrer + Permissions + CSP(+frame-ancestors)', bad.length === 0, bad.join(' | '));

  const hsts = merged.match(/Strict-Transport-Security:\s*max-age=(\d+)/);
  ok('HSTS max-age >= 1 year', !!hsts && Number(hsts[1]) >= 31536000, hsts ? `${hsts[1]}s` : 'absent');
}

// ═══ 2. the CSP header mirrors PUBLISHED_CSP (one source of truth) ═══
{
  const m = merged.match(/Content-Security-Policy:\s*(.+)/);
  const csp = m ? m[1].trim() : '';
  ok('CSP response header equals PUBLISHED_CSP_RESPONSE', csp === PUBLISHED_CSP_RESPONSE, csp.slice(0, 70));
  ok('CSP header contains the exact PUBLISHED_CSP policy (no drift, not weakened)', csp.startsWith(PUBLISHED_CSP), `starts-with PUBLISHED_CSP=${csp.startsWith(PUBLISHED_CSP)}`);
  ok('CSP header adds frame-ancestors none to PUBLISHED_CSP and nothing else', csp === `${PUBLISHED_CSP}; frame-ancestors 'none'`);
}

// ═══ 3. non-clobbering merge: template asset-cache blocks survive, no dup nosniff ═══
{
  ok('template /assets/* immutable cache block preserved', /\/assets\/\*\n\s*Cache-Control: public, max-age=31536000, immutable/.test(merged));
  ok('template /img/* immutable cache block preserved', /\/img\/\*\n\s*Cache-Control: public, max-age=31536000, immutable/.test(merged));
  const nosniffCount = (merged.match(/X-Content-Type-Options:/g) || []).length;
  ok('security headers are authoritative in /* — no duplicated nosniff', nosniffCount === 1, `${nosniffCount} occurrence(s)`);
  ok('a /* block exists and holds every security header', /\/\*\n/.test(merged) && SECURITY_RESPONSE_HEADERS.every(([k]) => merged.includes(`  ${k}: `)));
}

// ═══ 4. no directive is empty or malformed (byte-safe for a `_headers` file) ═══
{
  let bad = [];
  for (const [k, v] of SECURITY_RESPONSE_HEADERS) {
    if (!k || !/^[A-Za-z0-9-]+$/.test(k)) bad.push(`bad name "${k}"`);
    if (!v || v.trim() === '') bad.push(`${k}: empty value`);
    if (/[\r\n]/.test(k) || /[\r\n]/.test(v)) bad.push(`${k}: contains newline`);
    // a `_headers` line is "Name: value" — the value must not itself contain a raw colon-newline that would break parsing
  }
  // no ": :" style malformed lines and no header line with an empty value in the rendered file
  for (const line of merged.split('\n')) {
    if (/^\s+\S/.test(line)) {
      const mm = line.trim().match(/^([^:]+):\s?(.*)$/);
      if (!mm) bad.push(`unparseable header line: "${line.trim()}"`);
      else if (mm[2].trim() === '') bad.push(`empty value: "${line.trim()}"`);
    }
  }
  ok('all directives well-formed (valid name, non-empty value, no stray newline)', bad.length === 0, bad.slice(0, 3).join(' | '));
}

// ═══ 5. determinism + reproducibility ═══
{
  const again = mergeSecurityHeaders(templateHeaders);
  ok('merge is deterministic: same input → byte-identical output', again === merged);
  ok('output ends with a trailing newline (well-formed file)', merged.endsWith('\n'));
}

// ═══ 6. merge synthesizes a valid file even when no `_headers` exists ═══
{
  const fromScratch = mergeSecurityHeaders(undefined);
  ok('no pre-existing _headers → still emits a /* block with all security headers',
    /^\/\*\n/.test(fromScratch) && SECURITY_RESPONSE_HEADERS.every(([k]) => fromScratch.includes(`  ${k}: `)));
  ok('CSP present when synthesized from scratch', /Content-Security-Policy:[^\n]*frame-ancestors 'none'/.test(fromScratch));
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ SECURITY HEADERS SUITE: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) { for (const f of fails) console.log(' FAIL:', f.n); Deno.exit(1); }
