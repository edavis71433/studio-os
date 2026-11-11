// ── Free tools backend guard (Oct 2026) ─────────────────────────────────────
// Locks in the fixes behind the public Free Site Review and Local Visibility
// Score on davisdigitalstudio.com (Squarespace):
//   - every clever-api response carries the caller's allowed CORS origin
//   - the deep audit reads up to 2MB of HTML (footers hold the address/phone)
//   - visitor lead emails are sanitized (no outside links, images, scripts)
//   - per-tool subject lines, no empty "()" when there is no URL
//   - psi_fetch `lite` mode for the public tool (no ~500KB report per scan)
//   - the AI knowledge no longer claims "13 enterprise websites"
//   - the day-7 nurture skips Local Visibility quiz leads and uses clean URLs
//
//   deno run --allow-read tests/presence/free_tools_backend_test.mjs
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const src = Deno.readTextFileSync(new URL('../../supabase/functions/clever-api/index.ts', import.meta.url));
const life = Deno.readTextFileSync(new URL('../../supabase/functions/presence/commerce/lifecycle.ts', import.meta.url));

// ── structure ──
ok('CORS: the request handler is wrapped so every response gets the caller origin', /serveWithRequestCors\(async \(req\) =>/.test(src) && /CORS_ORIGINS\.includes\(origin\)/.test(src));
ok('CORS: CORS_ORIGINS is imported from the shared module', /import \{[^}]*CORS_ORIGINS[^}]*\} from '\.\.\/_shared\/cors\.ts'/.test(src));
ok('deep audit: HTML cap is 2MB, not 600KB', /slice\(0, 2000000\)/.test(src) && !/slice\(0, 600000\)/.test(src));
ok('audit_lead: visitor email is sanitized before sending', /sanitizeLeadEmailHtml\(userConfirmHtml\)/.test(src));
ok('audit_lead: Local Visibility subjects', /New Local Visibility lead:/.test(src) && /Your Local Visibility results for/.test(src));
ok('audit_lead: no hard-coded "(${url})" subject left', !/New Audit Lead: \$\{clientName\} \(\$\{url\}\)/.test(src));
ok('psi_fetch: lite mode returns the trimmed report', /body\.lite \? trimPsiReport\(psiData\) : psiData/.test(src));
ok('AI knowledge: no "13 enterprise websites" claim', !/13 enterprise websites/i.test(src));
ok('nurture: skips Local Visibility quiz leads', /tool=neq\.local_visibility/.test(life));
ok('nurture: clean URLs, no .html links', !/davisdigitalstudio\.com\/(audit|contact)\.html/.test(life));

// ── behavior: pull the pure helpers out of the monolith and run them ──
function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2)
    .replace(/\((input|name): unknown\): string \{/, '($1) {');   // drop the TS signature types
}
const linkOk = new RegExp(src.match(/const LEAD_EMAIL_LINK_OK = \/(.+)\/i;/)[1], 'i');
const sanitize = new Function('LEAD_EMAIL_LINK_OK', `${extractFn('sanitizeLeadEmailHtml')}; return sanitizeLeadEmailHtml;`)(linkOk);
const subjectName = new Function(`${extractFn('leadSubjectName')}; return leadSubjectName;`)();

const s = (h) => sanitize(h);
ok('sanitize: keeps studio links', /href="https:\/\/davisdigitalstudio\.com"/.test(s('<a href="https://davisdigitalstudio.com">site</a>')));
ok('sanitize: keeps the booking link', /href="https:\/\/calendly\.com\/eric-davisdigitalstudio\/30min"/.test(s('<a href="https://calendly.com/eric-davisdigitalstudio/30min">book</a>')));
ok('sanitize: keeps mailto Eric', /href="mailto:eric@davisdigitalstudio\.com"/.test(s('<a href="mailto:eric@davisdigitalstudio.com">x</a>')));
ok('sanitize: strips outside links but keeps the text', (() => { const o = s('<a href="https://evil.example/win">Claim</a>'); return !/href/.test(o) && /Claim/.test(o); })());
ok('sanitize: strips look-alike domains', !/href/.test(s('<a href="https://davisdigitalstudio.com.evil.example/">x</a>')) && !/href/.test(s('<a href="https://calendly.com/someone-else">x</a>')));
ok('sanitize: strips javascript: links', !/javascript/i.test(s('<a href="javascript:alert(1)">x</a>')));
ok('sanitize: removes scripts', !/script|alert/i.test(s('<p>a</p><script>alert(1)</script><p>b</p>')));
ok('sanitize: removes images (tracking pixels)', !/<img|evil/i.test(s('<p>a</p><img src="https://evil.example/p.gif" width="1">')));
ok('sanitize: removes iframes and forms', !/iframe|form|input/i.test(s('<iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="x"></form>')));
ok('sanitize: removes inline event handlers', !/onclick|onmouseover/i.test(s('<div onclick="x()" onmouseover=\'y()\'>hi</div>')));
ok('sanitize: neutralizes CSS url()', !/url\(|evil/i.test(s('<div style="background:url(https://evil.example/x.png)">x</div>')));
ok('sanitize: removes meta refresh', !/http-equiv/i.test(s('<meta http-equiv="refresh" content="0;url=https://evil.example">')));
const template = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f7f4fd;"><div style="max-width:560px;"><p style="font-size:15px;color:#1B1525;">Hi Rosa,</p><table role="presentation"><tr><td style="width:32px;">1</td><td>Fix this</td></tr></table><a href="https://davisdigitalstudio.com" style="color:#5b3fa0;">davisdigitalstudio.com</a></div></body></html>';
ok('sanitize: leaves the real report template intact', s(template) === template);
ok('sanitize: caps very large input', s('x'.repeat(500000)).length <= 200000);

ok('subject name: drops links', subjectName('Cheap pills https://evil.example now') === 'Cheap pills now');
ok('subject name: one line, no angle brackets', subjectName('Rosa\r\nBcc: x@y.z <b>') === 'Rosa Bcc: x@y.z b');
ok('subject name: bounded length', subjectName('a'.repeat(300)).length === 80);
ok('subject name: fallback when empty', subjectName('') === 'your business');

// ── SSRF guard: the deep audit's own copy of _shared/tools/url_guard.ts ──
// The URL parser rewrites [::ffff:127.0.0.1] as [::ffff:7f00:1]; an IPv6 address
// that carries an IPv4 one must be judged by that IPv4 address in both copies.
const guardSrc = ['_ipv4Blocked', '_ipv6Groups', '_ipv6Blocked', '_ipBlocked', '_isIpLiteral'].map(extractFn).join('\n') + '\nasync ' + extractFn('assertPublicHttpUrl');
const cleverGuard = await import('data:application/typescript,' + encodeURIComponent(`${guardSrc}\nexport { _ipBlocked, assertPublicHttpUrl };`));
const { ipBlocked } = await import('../../supabase/functions/_shared/tools/url_guard.ts');
const cleverRefuses = async (u) => { try { await cleverGuard.assertPublicHttpUrl(u); return false; } catch { return true; } };
const through = [];
for (const u of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:169.254.169.254]/latest', 'http://[::ffff:a9fe:a9fe]/',
  'http://[::ffff:10.0.0.5]/', 'http://[::ffff:c0a8:101]/', 'http://[::127.0.0.1]/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://[2002:c0a8:101::1]/',
  'http://[::1]/', 'http://[fe80::1]/', 'http://[fd12::1]/', 'http://127.0.0.1/', 'http://0xa9fea9fe/']) if (!(await cleverRefuses(u))) through.push(u);
ok('SSRF guard: refuses loopback, metadata and private addresses, IPv6 that carries one included', through.length === 0, through.join(' '));
ok('SSRF guard: allows a public address, written as IPv6 too', !(await cleverRefuses('http://[::ffff:5db8:d822]/')) && !(await cleverRefuses('http://[2002:5db8:d822::1]/')) && !(await cleverRefuses('http://[2606:4700:4700::1111]/')) && !(await cleverRefuses('http://93.184.216.34/')));
const sample = ['127.0.0.1', '10.0.0.5', '169.254.169.254', '100.64.0.1', '93.184.216.34', '8.8.8.8', '::', '::1', '[::ffff:7f00:1]',
  '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', '::ffff:5db8:d822', '::ffff:93.184.216.34', '::7f00:1', '64:ff9b::a9fe:a9fe', '64:ff9b::5db8:d822',
  '2002:c0a8:101::1', '2002:5db8:d822::1', 'fe80::1', 'fc00::1', 'fec0::1', 'ff02::1', '::ffff:0:7f00:1', '64:ff9b:1::a00:5', '2606:4700:4700::1111'];
const differ = sample.filter((a) => cleverGuard._ipBlocked(a) !== ipBlocked(a));
ok('SSRF guard: judges every address as _shared/tools/url_guard.ts does', differ.length === 0, differ.join(' '));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
