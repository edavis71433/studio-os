// ── Contract/proposal placeholder filling ────────────────────────────────────
// The studio's real agreement template speaks seven placeholders; the filler only
// understood two, so the other five would have reached a CLIENT as literal
// {{tokens}} in a document they're being asked to sign. This suite pins every
// token, and — the part that actually matters — pins what each one degrades to
// when the deal simply doesn't have the data: a readable, honest string. Never a
// bare {{token}}, and never a made-up number.
//
//   deno run --allow-read tests/presence/doc_placeholders_test.mjs
import { buildPlaceholderValues, applyPlaceholders, PLACEHOLDER_TOKENS } from '../../supabase/functions/presence/lib/doc_placeholders.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const AT = new Date(Date.UTC(2026, 7, 7, 12, 0, 0));   // 7 Aug 2026 — a fixed "today"
const FULL = buildPlaceholderValues({
  deal: { title: 'Marlow’s Kitchen website', expected_value_cents: 380000 },
  contact: { name: 'Sam Rivera', company: 'Marlow’s Kitchen' },
  studioName: 'Davis Digital Studio',
  now: AT,
});
const BARE = buildPlaceholderValues({ deal: {}, contact: null, studioName: '', now: AT });

// ═══ 1. Every token the shipped template uses is understood ═══
{
  const TEMPLATE_TOKENS = ['studio_name', 'client_company', 'deal_title', 'deal_value', 'deposit_amount', 'balance_amount', 'today'];
  const missing = TEMPLATE_TOKENS.filter((t) => !(t in FULL));
  ok('every token the studio’s agreement uses is filled', missing.length === 0, missing.join(','));
  ok('{{client_name}} — the ORIGINAL token — still works (back-compatible)', 'client_name' in FULL && FULL.client_name === 'Sam Rivera');
  ok('PLACEHOLDER_TOKENS lists exactly the keys the builder produces', PLACEHOLDER_TOKENS.length === Object.keys(FULL).length && PLACEHOLDER_TOKENS.every((t) => t in FULL));
}

// ═══ 2. Full data → the real values, formatted like the app's money() ═══
{
  ok('client_company prefers the company', FULL.client_company === 'Marlow’s Kitchen');
  ok('deal_title is the deal title', FULL.deal_title === 'Marlow’s Kitchen website');
  ok('studio_name is the studio’s own name', FULL.studio_name === 'Davis Digital Studio');
  ok('deal_value formats like the app’s money() — $3,800', FULL.deal_value === '$3,800');
  ok('deposit/balance are the 50/50 split §2 of the agreement states', FULL.deposit_amount === '$1,900' && FULL.balance_amount === '$1,900', `${FULL.deposit_amount} / ${FULL.balance_amount}`);
  ok('today is a long-form US date', FULL.today === 'August 7, 2026', FULL.today);
  // cents survive the split without inventing or losing a penny
  const odd = buildPlaceholderValues({ deal: { expected_value_cents: 100001 }, contact: null, studioName: '', now: AT });
  // …and the three figures agree with each other: an odd total must not read
  // "$500.01 + $500", which looks like a typo in something someone signs.
  ok('an odd amount splits without losing a cent, and the trio agrees on precision',
    odd.deal_value === '$1,000.01' && odd.deposit_amount === '$500.01' && odd.balance_amount === '$500.00',
    `${odd.deal_value} = ${odd.deposit_amount} / ${odd.balance_amount}`);
  ok('a non-round total keeps its cents', buildPlaceholderValues({ deal: { expected_value_cents: 149950 }, contact: null, studioName: '', now: AT }).deal_value === '$1,499.50');
}

// ═══ 3. DEGRADATION — the part a client would otherwise read ═══
{
  ok('no client at all → client_name reads "the client"', BARE.client_name === 'the client');
  ok('no company → client_company reads "the client"', BARE.client_company === 'the client');
  ok('a contact with a name but no company → the NAME stands in for the company', buildPlaceholderValues({ deal: {}, contact: { name: 'Sam Rivera' }, studioName: '', now: AT }).client_company === 'Sam Rivera');
  ok('no title → deal_title reads "the project"', BARE.deal_title === 'the project');
  ok('no studio name → the studio’s legal name, never blank', BARE.studio_name === 'Davis Digital Studio');
  // A missing amount must NOT become "$0" — that is a misleading number in a
  // document someone signs. It becomes an obvious fill-me-in bracket instead.
  ok('a 0 / missing value → "[project fee]", never $0', BARE.deal_value === '[project fee]');
  ok('a missing value → "[50% deposit]" / "[50% balance]", never $0', BARE.deposit_amount === '[50% deposit]' && BARE.balance_amount === '[50% balance]');
  ok('a null expected_value_cents degrades the same way', buildPlaceholderValues({ deal: { expected_value_cents: null }, contact: null, studioName: '', now: AT }).deal_value === '[project fee]');
}

// ═══ 4. applyPlaceholders — substitution is total and never leaks a token ═══
{
  const body = 'Studio: {{studio_name}}\nClient: {{ client_company }}\nProject: {{deal_title}}\nFee: {{deal_value}} ({{deposit_amount}} + {{balance_amount}})\nDated {{today}}. Hello {{client_name}}.';
  const out = applyPlaceholders(body, FULL);
  ok('no {{token}} survives a fill with full data', !/\{\{/.test(out), out.match(/\{\{[^}]*\}\}/)?.[0] || '');
  ok('no {{token}} survives a fill with NO data either', !/\{\{/.test(applyPlaceholders(body, BARE)));
  ok('whitespace inside the braces is tolerated ({{ client_company }})', out.includes('Client: Marlow’s Kitchen'));
  ok('a repeated token is replaced every time', applyPlaceholders('{{deal_title}} / {{deal_title}}', FULL) === 'Marlow’s Kitchen website / Marlow’s Kitchen website');
  ok('an UNKNOWN token is left alone (never silently blanked)', applyPlaceholders('{{not_a_token}}', FULL) === '{{not_a_token}}');
  // A value containing a $ must not be eaten by replacement-pattern syntax
  ok('a $ in a value survives replacement ($& / $1 are not special here)', applyPlaceholders('{{deal_value}}', FULL) === '$3,800');
  ok('empty / non-string input is safe', applyPlaceholders('', FULL) === '' && applyPlaceholders(null, FULL) === '');
}

// ═══ 5. Purity — no DB, no network, no clock surprises ═══
{
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/lib/doc_placeholders.ts', import.meta.url));
  ok('the module is pure — no fetch, no svc(), no Deno.env', !/\bfetch\(|\bsvc\(|Deno\.env/.test(src));
  ok('“now” is injectable, so the date is testable', /now/.test(src));
}

// ═══ 6. The shipped agreement + the pipeline.html mirror ═══
// The agreement FORM posts its body verbatim (the server fills placeholders only
// on the draft-from-a-saved-template path), so pipeline.html must fill them
// itself before seeding the textarea — otherwise a client receives a literal
// {{token}} in a document they're asked to sign. That hand-mirror, and the
// shipped agreement text, are pinned here.
{
  const pipe = Deno.readTextFileSync(new URL('../../pipeline.html', import.meta.url));
  ok('pipeline.html mirrors the filler (docPlaceholderValues + fillDocPlaceholders)', /function docPlaceholderValues\(/.test(pipe) && /const fillDocPlaceholders=/.test(pipe));
  ok('the mirror covers every token the server fills', PLACEHOLDER_TOKENS.every((t) => new RegExp(`${t}:`).test(pipe)));
  ok('the mirror degrades identically ([project fee] / [50% deposit] / [50% balance])', /\[project fee\]/.test(pipe) && /\[50% deposit\]/.test(pipe) && /\[50% balance\]/.test(pipe));
  ok('the mirror falls back to the same studio name', pipe.includes(`'${'Davis Digital Studio'}'`));

  ok('the studio’s standard agreement ships as DDS_CONTRACT_TEMPLATE', /const DDS_CONTRACT_TEMPLATE=`/.test(pipe));
  const tpl = (pipe.match(/const DDS_CONTRACT_TEMPLATE=`([\s\S]*?)`;/) || [])[1] || '';
  ok('the agreement is the real document (not a stub)', tpl.length > 10000 && tpl.length < 50000, `${tpl.length} chars`);   // clean(b.body, 50000)
  ok('the agreement carries all 19 sections, numbered once each', (() => {
    const heads = [...tpl.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    return heads.length === 19 && heads.every((n, i) => n === i + 1);
  })(), [...tpl.matchAll(/^(\d+)\. /gm)].map((m) => m[1]).join(','));
  ok('the SAMPLE disclaimer is gone', !/\bSAMPLE\b/.test(tpl));
  ok('every {{token}} the agreement uses is one the filler knows', (() => {
    const used = [...new Set([...tpl.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))];
    return used.length > 0 && used.every((t) => PLACEHOLDER_TOKENS.includes(t));
  })(), [...new Set([...tpl.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))].join(','));
  ok('an empty agreement form prefers a SAVED template, then the standard agreement, then the starter',
    /api\('\/sales\/templates\?with_body=contract'\)/.test(pipe) && /bodyEl\.value=DDS_CONTRACT_TEMPLATE\?fillDocPlaceholders\(DDS_CONTRACT_TEMPLATE,vals\):starterAgreement\(/.test(pipe));
  ok('the stale DDS-Contract-Custom-Package-SAMPLE.docx is gone from the repo root', (() => {
    try { Deno.statSync(new URL('../../DDS-Contract-Custom-Package-SAMPLE.docx', import.meta.url)); return false; } catch { return true; }
  })());
}

const passed = results.filter((r) => r.p).length;
const failed = results.length - passed;
console.log(`\n════ DOC PLACEHOLDERS: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''} ════`);
if (failed) Deno.exit(1);
