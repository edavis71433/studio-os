// ── Speed (Nov 15 2026): the studio's calls run beside the database ──────────
// The database is in Oregon (us-west-2), but Supabase runs a function in the region
// nearest the visitor, so from the east coast each of the small database calls behind
// one answer crossed the country: about 1 s an answer, 0.4 s beside the database. The
// client portal asked for Oregon first (client.html's FN_REGION, PR 424); every page
// now does, with the x-region header. This pins:
//   • every call that sends a sign-in or our key to our functions asks for Oregon. Those
//     calls ask the browser's permission first anyway (a preflight), so it costs nothing;
//   • one value everywhere, and production only where a page can point at staging
//     (staging's server doesn't allow the header);
//   • the header, never the address setting (?forceFunctionRegion=): the browser specs'
//     exact page.route globs don't match an address with a query string;
//   • never on a Storage upload or another host (their CORS answer doesn't allow it);
//   • the public link pages that send no key stay "simple" requests, with no preflight;
//   • the server allows the header on the answers these calls get.
//   deno run --allow-read --allow-env tests/presence/fn_region_test.mjs
import { corsFor, visitorCors } from '../../supabase/functions/_shared/cors.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${!p && d ? `\n      ${d}` : ''}`); };

// the files the site serves from its root: pages and their shared scripts
const INTERNAL = new Set(['email-signature.html', 'styleguide.html', 'a11y.html', 'provision.html']);
const files = [...Deno.readDirSync(ROOT)].filter((e) => e.isFile && /\.(html|js)$/.test(e.name) && !INTERNAL.has(e.name)).map((e) => e.name).sort();
const src = Object.fromEntries(files.map((f) => [f, read(f)]));

// The old marketing pages' lead forms send our key to clever-api, one write each, from the
// public website rather than the studio; three are retired behind 301s (_redirects).
const MARKETING = new Set(['contact.html', 'project-survey.html', 'local-visibility.html', 'pricing-estimator.html', 'roi-calculator.html']);
// Public link pages whose calls send no key, so the browser sends them without asking first.
// The header would add that round trip for every visitor, and their visitors are mostly the
// businesses' own customers on the west coast. (The booking page's own routes, and a client
// site's forms, answer with visitorCors, which allows no such header at all.)
const SIMPLE = ['doc.html', 'pitch.html', 'review.html', 'draft.html', 'booking.html', 'join.html', 'spam.html', 'unsubscribe.html', 'intake.html'];
// the pages that can point at staging
const ENV_SWITCH = files.filter((f) => src[f].includes('ENVS.staging') || src[f].includes("q.get('env')==='staging'"));

// the object literal around index i: back to its unmatched "{", on to the matching "}"
function literalAt(s, i) {
  let d = 0, a = i;
  for (; a >= 0; a--) { if (s[a] === '}') d++; else if (s[a] === '{') { if (d === 0) break; d--; } }
  let e = a;
  for (d = 0; e < s.length; e++) { if (s[e] === '{') d++; else if (s[e] === '}' && --d === 0) break; }
  return { start: a, text: s.slice(a, e + 1) };
}
// every header literal that carries a sign-in (x-dds-user-jwt) or our key (apikey, Authorization)
function keyedLiterals(s) {
  const seen = new Map();
  for (const m of s.matchAll(/[{,]\s*(['"]?)(x-dds-user-jwt|apikey|Authorization)\1\s*:/g)) {
    const lit = literalAt(s, m.index + 1);
    if (lit.start >= 0) seen.set(lit.start, lit.text);
  }
  return [...seen.values()];
}
const asks = (lit) => /(['"])x-region\1\s*:/.test(lit) || lit.includes('...REGION_HEADER');

// ── 1. every keyed call asks for Oregon ──────────────────────────────────────
{
  let checked = 0; const missing = [];
  for (const f of files) {
    if (MARKETING.has(f)) continue;
    for (const lit of keyedLiterals(src[f])) { checked++; if (!asks(lit)) missing.push(`${f}: ${lit.slice(0, 140)}`); }
  }
  ok('the scan finds the studio\'s calls (the shell, the pages, the sign-in doors)', checked >= 50, String(checked));
  ok('every call that sends a sign-in or our key asks for Oregon (x-region)', missing.length === 0, missing.join('\n      '));
  for (const f of ['shell.js', 'today.html', 'sites.html', 'pipeline.html', 'crm.html', 'presence.html', 'client.html', 'studio.html', 'portal.html', 'set-password.html']) {
    ok(`${f} asks on each of its keyed calls`, keyedLiterals(src[f]).length > 0 && keyedLiterals(src[f]).every(asks));
  }
  ok('the marketing lead forms are the only keyed calls left as they were', [...MARKETING].every((f) => !src[f] || !src[f].includes('x-region')));
}

// ── 2. one value, and production only where a page can point at staging ──────
{
  const defs = files.flatMap((f) => [...src[f].matchAll(/\bFN_REGION\s*[=:]\s*(['"])([^'"]*)\1/g)].map((m) => `${f}=${m[2]}`));
  ok('every page names the same region: us-west-2, the database\'s', defs.length >= 35 && defs.every((d) => d.endsWith('=us-west-2')), defs.filter((d) => !d.endsWith('=us-west-2')).join(', '));
  const values = files.flatMap((f) => [...src[f].matchAll(/(['"])x-region\1\s*:\s*([^,}\s]+)/g)].map((m) => `${f}: ${m[2]}`));
  ok('every header takes its value from that one constant', values.length > 0 && values.every((v) => /: (FN_REGION|CONFIG\.FN_REGION|"us-west-2")$/.test(v)), values.filter((v) => !/: (FN_REGION|CONFIG\.FN_REGION|"us-west-2")$/.test(v)).join(', '));
  ok('the pages that can point at staging are known', ['presence.html', 'signup.html', 'welcome.html', 'booking.html', 'draft.html', 'join.html', 'review.html', 'spam.html', 'unsubscribe.html'].every((f) => ENV_SWITCH.includes(f)), ENV_SWITCH.join(', '));
  for (const f of ENV_SWITCH.filter((f) => src[f].includes('x-region'))) {
    const s = src[f];
    ok(`${f}: only production's calls carry it (staging's server doesn't allow it)`,
      s.includes('const REGION_HEADER = ENV === ENVS.prod ? { "x-region": "us-west-2" } : {};') && (s.match(/x-region/g) || []).length === 1 && !s.includes('FN_REGION'));
  }
}

// ── 3. the header, never the address setting ─────────────────────────────────
ok('no page asks by address (?forceFunctionRegion=)', files.every((f) => !/forceFunctionRegion/i.test(src[f])), files.filter((f) => /forceFunctionRegion/i.test(src[f])).join(', '));

// ── 4. only our own functions: never a Storage upload or another host ────────
{
  const bad = [];
  for (const f of files) {
    for (const m of src[f].matchAll(/\bfetch\s*\(\s*([^,()]*(?:upload_url|formspree|FORMSPREE)[^,()]*),\s*\{/g)) {
      const init = literalAt(src[f], m.index + m[0].length).text;
      if (/x-region/.test(init)) bad.push(`${f}: fetch(${m[1].trim()}, …)`);
    }
  }
  ok('no upload to Storage, and no other host, is sent the header', bad.length === 0, bad.join('; '));
}

// ── 5. the public link pages stay simple requests ────────────────────────────
for (const f of SIMPLE) ok(`${f} sends no x-region (its calls carry no key, so no preflight)`, src[f] && !src[f].includes('x-region'));
ok('the questionnaire still saves as plain text, without a preflight', src['intake.html'].includes("headers:{'Content-Type':'text/plain;charset=UTF-8'}"));

// ── 6. the server allows it where these calls land ───────────────────────────
{
  const req = new Request('https://fn.example.com/presence/site', { method: 'OPTIONS', headers: { origin: 'https://davisdigitalstudio.com' } });
  ok('presence and clever-api answer with corsFor, which allows x-region', /(^|, )x-region(,|$)/.test(corsFor(req)['Access-Control-Allow-Headers'])
    && read('supabase/functions/clever-api/index.ts').includes('const reqCors = corsFor(req);'));
  ok('a client site\'s own routes (forms, booking slots) allow no such header, so no page sends it there', !/x-region/.test(visitorCors()['Access-Control-Allow-Headers']));
}

const passed = results.filter((r) => r.p).length, failed = results.length - passed;
console.log(`\n════ FUNCTION REGION: ${passed}/${results.length} PASSED ════`);
if (failed) Deno.exit(1);
