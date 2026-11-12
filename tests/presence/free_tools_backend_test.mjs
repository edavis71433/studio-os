// ── Free tools backend guard (Oct 2026) ─────────────────────────────────────
// Locks in the fixes behind the public free tools:
//   - every clever-api response carries the caller's allowed CORS origin
//   - the AI knowledge no longer claims "13 enterprise websites"
//   - the day-7 nurture skips Local Visibility quiz leads and uses clean URLs
//   - the address guard refuses private, loopback and metadata addresses
// The old tools' own routes in clever-api (the deep audit, psi_fetch, audit_lead
// and their lead-email cleaner) left with builder item 213: the free tools at
// tools.davisdigitalstudio.com run on their own functions (site-review,
// ai-visibility) and the one address guard, _shared/tools/url_guard.ts.
//
//   deno run --allow-read tests/presence/free_tools_backend_test.mjs
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const src = Deno.readTextFileSync(new URL('../../supabase/functions/clever-api/index.ts', import.meta.url));
const life = Deno.readTextFileSync(new URL('../../supabase/functions/presence/commerce/lifecycle.ts', import.meta.url));

// ── structure ──
ok('CORS: the request handler is wrapped so every response gets the caller origin', /serveWithRequestCors\(async \(req\) =>/.test(src) && /CORS_ORIGINS\.includes\(origin\)/.test(src));
ok('CORS: CORS_ORIGINS is imported from the shared module', /import \{[^}]*CORS_ORIGINS[^}]*\} from '\.\.\/_shared\/cors\.ts'/.test(src));
ok('the old tools left the old server: no deep audit, psi_fetch or audit_lead', !/deepAudit|'psi_fetch'|'audit_lead'|'deep_audit'|sanitizeLeadEmailHtml/.test(src));
ok('AI knowledge: no "13 enterprise websites" claim', !/13 enterprise websites/i.test(src));
ok('nurture: skips Local Visibility quiz leads', /tool=neq\.local_visibility/.test(life));
ok('nurture: clean URLs, no .html links', !/davisdigitalstudio\.com\/(audit|contact)\.html/.test(life));

// ── SSRF guard: _shared/tools/url_guard.ts, the one copy left ──
// The URL parser rewrites [::ffff:127.0.0.1] as [::ffff:7f00:1]; an IPv6 address
// that carries an IPv4 one must be judged by that IPv4 address (PR 292).
const { ipBlocked, assertPublicHttpUrl } = await import('../../supabase/functions/_shared/tools/url_guard.ts');
const refuses = async (u) => { try { await assertPublicHttpUrl(u, null); return false; } catch { return true; } };
const through = [];
for (const u of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:169.254.169.254]/latest', 'http://[::ffff:a9fe:a9fe]/',
  'http://[::ffff:10.0.0.5]/', 'http://[::ffff:c0a8:101]/', 'http://[::127.0.0.1]/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://[2002:c0a8:101::1]/',
  'http://[::1]/', 'http://[fe80::1]/', 'http://[fd12::1]/', 'http://127.0.0.1/', 'http://0xa9fea9fe/']) if (!(await refuses(u))) through.push(u);
ok('SSRF guard: refuses loopback, metadata and private addresses, IPv6 that carries one included', through.length === 0, through.join(' '));
ok('SSRF guard: allows a public address, written as IPv6 too', !(await refuses('http://[::ffff:5db8:d822]/')) && !(await refuses('http://[2002:5db8:d822::1]/')) && !(await refuses('http://[2606:4700:4700::1111]/')));
const BLOCKED = ['127.0.0.1', '10.0.0.5', '169.254.169.254', '100.64.0.1', '::', '::1', '[::ffff:7f00:1]', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe',
  '::7f00:1', '64:ff9b::a9fe:a9fe', '2002:c0a8:101::1', 'fe80::1', 'fc00::1', 'fec0::1', 'ff02::1', '::ffff:0:7f00:1', '64:ff9b:1::a00:5'];
const PUBLIC = ['93.184.216.34', '8.8.8.8', '::ffff:5db8:d822', '::ffff:93.184.216.34', '64:ff9b::5db8:d822', '2002:5db8:d822::1', '2606:4700:4700::1111'];
const wrong = [...BLOCKED.filter((a) => !ipBlocked(a)), ...PUBLIC.filter((a) => ipBlocked(a))];
ok('SSRF guard: judges each sample address as private or public correctly', wrong.length === 0, wrong.join(' '));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
