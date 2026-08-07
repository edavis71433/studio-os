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
  const TEMPLATE_TOKENS = ['studio_name', 'studio_name_upper', 'client_company', 'deal_title', 'deal_value', 'deposit_amount', 'balance_amount', 'today'];
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
  // The letterhead is set in caps in Eric's own document, so the SAME identity
  // gets a second, uppercased token rather than a hardcoded company name.
  ok('studio_name_upper is that same name, uppercased', FULL.studio_name_upper === 'DAVIS DIGITAL STUDIO'
    && buildPlaceholderValues({ deal: {}, contact: null, studioName: 'Northwind Web Co.', now: AT }).studio_name_upper === 'NORTHWIND WEB CO.');
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
  ok('no studio name → the letterhead token degrades the same way', BARE.studio_name_upper === 'DAVIS DIGITAL STUDIO');
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

  // There is no longer ONE agreement: pipeline.html ships one PER PACKAGE, with
  // the scope of work inside it. The set itself (shared §1-19, the Growth scope,
  // the fill-in blanks) is agreement_packages_test.mjs's job — what belongs HERE
  // is that EVERY package body speaks only tokens this filler knows, and names
  // exactly one legal party. So the rules below run over all of them.
  ok('the studio’s standard agreements ship as DDS_AGREEMENT_PACKAGES', /const DDS_AGREEMENT_PACKAGES=\{/.test(pipe));
  const BODIES = (() => {
    const a = pipe.indexOf('/* ==== agreement packages: start'), b = pipe.indexOf('/* ==== agreement packages: end ==== */');
    if (a < 0 || b < a) return {};
    const m = new Function(`${pipe.slice(a, b)}\nreturn DDS_AGREEMENT_PACKAGES;`)();
    return Object.fromEntries(Object.keys(m).map((k) => [k, m[k].body]));
  })();
  const NAMES = Object.keys(BODIES);
  ok('at least the two shipped packages are extractable', NAMES.length >= 2, NAMES.join(','));
  for (const k of NAMES) {
    const tpl = BODIES[k];
    ok(`${k}: the agreement is the real document (not a stub)`, tpl.length > 10000 && tpl.length < 50000, `${tpl.length} chars`);   // clean(b.body, 50000)
    ok(`${k}: the legal terms carry all 19 sections, numbered once each`, (() => {
      const legal = tpl.slice(tpl.indexOf('\nPROJECT AGREEMENT\n\n'));
      const heads = [...legal.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
      return heads.length === 19 && heads.every((n, i) => n === i + 1);
    })());
    ok(`${k}: the SAMPLE disclaimer is gone`, !/\bSAMPLE\b/.test(tpl));
    ok(`${k}: every {{token}} the agreement uses is one the filler knows`, (() => {
      const used = [...new Set([...tpl.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))];
      return used.length > 0 && used.every((t) => PLACEHOLDER_TOKENS.includes(t));
    })(), [...new Set([...tpl.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))].join(','));

    // ── The default contract must name exactly ONE legal party: the TENANT'S own
    // studio. Three places used to hardcode "Davis Digital Studio" — the
    // letterhead, the operative parties clause, and the signature block — so a
    // non-DDS tenant's client would have been asked to sign a binding clause
    // naming a company that is not their counterparty.
    ok(`${k}: the letterhead is the studio’s own name (uppercased), not a hardcode`, tpl.startsWith('{{studio_name_upper}}\n'));
    ok(`${k}: the operative parties clause names the studio by token`, /entered into between \{\{studio_name\}\} \("Studio"\)/.test(tpl));
    // presence_identity carries no PERSON name (business_name/email/phone only), so
    // the signature block prints the BUSINESS above the rule and leaves the printed
    // name blank — never a hardcoded "Eric Davis" on someone else's contract.
    ok(`${k}: the signature block names the studio, never a hardcoded person`, /\n\{\{studio_name\}\} +\[Client Name \/ Title\]/.test(tpl) && !/Eric Davis/.test(tpl));
    ok(`${k}: NO hardcoded studio identity survives anywhere in the agreement`, !/Davis Digital Studio/i.test(tpl));

    // …and the rendered result, for a tenant who is not Eric and for Eric himself.
    const fillFor = (biz) => applyPlaceholders(tpl, buildPlaceholderValues({ deal: {}, contact: null, studioName: biz, now: AT }));
    const tenant = fillFor('Northwind Web Co.');
    ok(`${k}: a non-DDS tenant’s agreement never names Davis Digital Studio`, !/Davis Digital Studio/i.test(tenant));
    ok(`${k}: a non-DDS tenant’s letterhead is THEIR name, uppercased`, tenant.startsWith('NORTHWIND WEB CO.\n'));
    ok(`${k}: a non-DDS tenant is the Studio in the operative parties clause`, tenant.includes('entered into between Northwind Web Co. ("Studio")'));
    ok(`${k}: a non-DDS tenant signs in their own name`, /\nNorthwind Web Co\. +\[Client Name \/ Title\]/.test(tenant));
    const dds = fillFor('');   // Eric's own site, via the fallback chain
    ok(`${k}: Eric’s own site still reads exactly as his document does`, dds.startsWith('DAVIS DIGITAL STUDIO\n')
      && dds.includes('entered into between Davis Digital Studio ("Studio")')
      && /\nDavis Digital Studio +\[Client Name \/ Title\]/.test(dds));
  }
  ok('an empty agreement form prefers a SAVED template, then the CHOSEN package’s agreement',
    /api\('\/sales\/templates\?with_body=contract'\)/.test(pipe) && /bodyEl\.value=fillDocPlaceholders\(DDS_AGREEMENT_PACKAGES\[PKG\]\.body,vals\)/.test(pipe));
  ok('the unreachable starterAgreement’s dead branch is gone', !/starterAgreement/.test(pipe));
  ok('the stale DDS-Contract-Custom-Package-SAMPLE.docx is gone from the repo root', (() => {
    try { Deno.statSync(new URL('../../DDS-Contract-Custom-Package-SAMPLE.docx', import.meta.url)); return false; } catch { return true; }
  })());
}

// ═══ 7. The client mirror is EXECUTED and compared, not just pattern-matched ══
// §6 reads pipeline.html as text, which pins that the mirror EXISTS — it cannot
// see the mirror DRIFT. A behavioural divergence (Math.floor for Math.round, a
// dropped fallback) sails straight past a regex and reaches a client as a wrong
// number in a document they sign. So: pull the two mirror functions out of the
// page, run them, and demand OUTPUT EQUALITY with the server filler on a table
// of inputs chosen to discriminate — odd cents, absent contact, company-absent-
// but-name-present, zero/null, and an amount past the thousands separators.
// (Extraction idiom: design_studio_test.mjs — brace-match the source, new Function.)
{
  const pipe = Deno.readTextFileSync(new URL('../../pipeline.html', import.meta.url));
  // `function NAME(...) {...}` — brace-match from its start
  const fn = (name) => {
    const start = pipe.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('function not found: ' + name);
    let depth = 0;
    for (let j = pipe.indexOf('{', start); j < pipe.length; j++) {
      if (pipe[j] === '{') depth++;
      else if (pipe[j] === '}' && --depth === 0) return pipe.slice(start, j + 1);
    }
    throw new Error('unbalanced braces for ' + name);
  };
  // `const NAME=<one-line arrow>;`
  const arrow = (name) => {
    const line = pipe.split('\n').find((l) => l.startsWith('const ' + name + '='));
    if (!line) throw new Error('const not found: ' + name);
    return line;
  };
  const mirror = new Function(`${arrow('docMoney')}\n${fn('docPlaceholderValues')}\n${arrow('fillDocPlaceholders')}\nreturn { docPlaceholderValues, fillDocPlaceholders };`)();
  ok('the mirror EXECUTES (extracted straight from pipeline.html)', typeof mirror.docPlaceholderValues === 'function' && typeof mirror.fillDocPlaceholders === 'function');

  // Each row is a case the two implementations could plausibly disagree on.
  const CASES = [
    ['whole thousands', { title: 'Acme website', expected_value_cents: 380000 }, { name: 'Sam Rivera', company: 'Marlow’s Kitchen' }, 'Davis Digital Studio'],
    ['odd cents — $3,333.33 (round-half up on the split)', { title: 'Rebuild', expected_value_cents: 333333 }, { name: 'Sam' }, 'Northwind Web Co.'],
    ['odd cents — $1,000.01', { title: 'Refresh', expected_value_cents: 100001 }, { name: 'Sam', company: 'Acme' }, ''],
    ['odd cents — $0.99 (round vs floor differ by a penny)', { title: 'Tiny', expected_value_cents: 99 }, { name: 'Sam' }, 'Studio B'],
    ['no contact at all', { title: 'Anon', expected_value_cents: 250000 }, null, 'Studio B'],
    ['company absent, name present (the fallback rung)', { title: 'Solo', expected_value_cents: 120000 }, { name: 'Dana Fox', company: '' }, 'Studio B'],
    ['company present, name absent', { title: 'Corp', expected_value_cents: 120000 }, { name: '', company: 'Ironwood LLC' }, 'Studio B'],
    ['zero value', { title: 'TBD', expected_value_cents: 0 }, { name: 'Sam' }, 'Studio B'],
    ['null value', { title: 'TBD', expected_value_cents: null }, { name: 'Sam' }, 'Studio B'],
    ['no deal fields at all', {}, null, ''],
    ['huge value — $1,234,567.89', { title: 'Enterprise', expected_value_cents: 123456789 }, { name: 'Sam', company: 'Big Co' }, 'Studio B'],
    ['huge whole value — $10,000,000', { title: 'Enterprise', expected_value_cents: 1000000000 }, { name: 'Sam' }, 'Studio B'],
    ['whitespace-only names degrade like absent ones', { title: '   ', expected_value_cents: 5000 }, { name: '  ', company: '  ' }, '   '],
  ];
  let drift = '';
  for (const [label, deal, contact, biz] of CASES) {
    const server = buildPlaceholderValues({ deal, contact, studioName: biz, now: AT });
    const client = mirror.docPlaceholderValues(deal, contact, biz, AT);
    const keys = [...new Set([...Object.keys(server), ...Object.keys(client)])].sort();
    const bad = keys.filter((k) => server[k] !== client[k]);
    ok(`mirror ≡ server — ${label}`, bad.length === 0, bad.map((k) => `${k}: server=${JSON.stringify(server[k])} client=${JSON.stringify(client[k])}`).join(' · '));
    if (bad.length) drift = label;
  }
  ok('the client mirror and the server filler never disagree on any case', !drift, drift);

  // {{today}} — the Effective date of a signed document. The two halves must
  // agree, so BOTH format in UTC: the same deal drafted from the empty form and
  // from a saved template can otherwise carry different dates across midnight.
  {
    const edge = new Date(Date.UTC(2026, 7, 8, 3, 30, 0));   // 8 Aug UTC; still 7 Aug in every US zone
    const prevTz = Deno.env.get('TZ');
    Deno.env.set('TZ', 'America/Los_Angeles');                // the operator's clock, not the server's
    const local = mirror.docPlaceholderValues({}, null, '', edge).today;
    const server = buildPlaceholderValues({ deal: {}, contact: null, studioName: '', now: edge }).today;
    if (prevTz === undefined) Deno.env.delete('TZ'); else Deno.env.set('TZ', prevTz);
    ok('{{today}} is UTC on BOTH sides (the contract’s Effective date can’t straddle midnight)', local === server, `${local} vs ${server}`);
    ok('the mirror pins timeZone:UTC explicitly', /timeZone:\s*'UTC'/.test(fn('docPlaceholderValues')));
  }

  // Substitution itself must agree too — same body, same values, same output.
  {
    const vals = buildPlaceholderValues({ deal: { title: 'Acme', expected_value_cents: 100001 }, contact: { name: 'Sam' }, studioName: 'Northwind Web Co.', now: AT });
    const bodies = [
      '{{studio_name_upper}}\n{{studio_name}} / {{ client_company }} / {{deal_title}} / {{deal_value}} = {{deposit_amount}} + {{balance_amount}} on {{today}}. Hi {{client_name}}.',
      '{{not_a_token}} stays put; {{deal_value}} does not.',
      '', 'no tokens here at all',
    ];
    for (const [i, b] of bodies.entries()) ok(`fillDocPlaceholders ≡ applyPlaceholders — body ${i}`, mirror.fillDocPlaceholders(b, vals) === applyPlaceholders(b, vals));
    // and every shipped agreement, end to end
    const a = pipe.indexOf('/* ==== agreement packages: start'), z = pipe.indexOf('/* ==== agreement packages: end ==== */');
    const map = new Function(`${pipe.slice(a, z)}\nreturn DDS_AGREEMENT_PACKAGES;`)();
    for (const k of Object.keys(map)) {
      const tplSrc = map[k].body;
      ok(`the two fillers agree on the FULL shipped agreement — ${k}`, tplSrc.length > 10000 && mirror.fillDocPlaceholders(tplSrc, vals) === applyPlaceholders(tplSrc, vals));
    }
  }
}

const passed = results.filter((r) => r.p).length;
const failed = results.length - passed;
console.log(`\n════ DOC PLACEHOLDERS: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''} ════`);
if (failed) Deno.exit(1);
