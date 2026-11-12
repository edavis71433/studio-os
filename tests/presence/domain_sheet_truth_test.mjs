// ── Nov 12 2026 review, builder list item 193: the Domain sheet tells the truth ──
//   deno run --allow-read --allow-env --allow-net tests/presence/domain_sheet_truth_test.mjs
// Findings 13 to 17 of the code pass:
//   13. an approved domain or email plan could never be finished, and each press made another
//   14. "Set up email protection" gave Google's records to everyone
//   15. with "www." as the main name, the email check asked about the wrong name
//   16. the sheet said "live and secure" when its check couldn't run
//   17. the leftover-record check told owners to delete a working "www" record
// The rules first, then the routes against stubbed DNS, hosting, database and email. No
// outside call leaves.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example', RESEND_KEY: 're_test_unused', NETLIFY_AUTH_TOKEN: 'nf-test' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const P = '../../supabase/functions/presence';
const { bareDomain, recordsOfType, NETLIFY_APEX_IP } = await import(`${P}/platform/dns.ts`);
const { detectEmailProvider, emailFacts, EMAIL_PROVIDERS } = await import(`${P}/platform/email_providers.ts`);
const { planEmailAuth } = await import(`${P}/platform/plans.ts`);
const { planRecordsFound, recordAnswers, clearFoundPlans } = await import(`${P}/platform/plan_found.ts`);
const { nameCheckFrom, domainChecklist, domainTruth } = await import(`${P}/lib/domain_health.ts`);
const { handleFoundationsGet, handleFoundationsPrepare, handleFoundationsPlanDone } = await import(`${P}/routes/foundations.ts`);
const { handleDomain } = await import(`${P}/routes/admin.ts`);
const { buildNeedsYou } = await import(`${P}/agency/needs_you.ts`);
const { memberWriteNeeds } = await import(`${P}/lib/site_roles.ts`);

// ═══ 14. who runs the email decides the records ═══
ok('Google’s mail servers are Google', detectEmailProvider(['aspmx.l.google.com', 'alt1.aspmx.l.google.com'])?.slug === 'google_workspace' && detectEmailProvider(['smtp.google.com'])?.slug === 'google_workspace');
ok('Microsoft 365’s are Microsoft', detectEmailProvider(['bistro-example.mail.protection.outlook.com.'])?.slug === 'microsoft365');
ok('Zoho’s are Zoho', detectEmailProvider(['mx.zoho.com', 'mx2.zoho.com'])?.slug === 'zoho' && detectEmailProvider(['mx.zoho.eu'])?.slug === 'zoho');
ok('GoDaddy’s are GoDaddy', detectEmailProvider(['smtp.secureserver.net', 'mailstore1.secureserver.net'])?.slug === 'godaddy');
ok('anyone else is unknown, never guessed', detectEmailProvider(['mx1.mail.example']) === null && detectEmailProvider([]) === null && detectEmailProvider(['notgoogle.com.evil.example']) === null);
{
  const ms = planEmailAuth('bistro.example', { provider: EMAIL_PROVIDERS.microsoft365, hasSpf: false, hasDmarc: false });
  const recs = ms.steps.flatMap((s) => s.records || []);
  ok('on Microsoft 365 the sender record is Microsoft’s, not Google’s', recs.some((r) => r.value === 'v=spf1 include:spf.protection.outlook.com ~all') && !JSON.stringify(ms).includes('google'), JSON.stringify(recs));
  ok('…and it says whose records these are', /Your email runs at Microsoft 365/.test(ms.summary));
  const gd = planEmailAuth('bistro.example', { provider: EMAIL_PROVIDERS.godaddy, hasSpf: false, hasDmarc: false });
  ok('on GoDaddy it is GoDaddy’s', gd.steps.flatMap((s) => s.records || []).some((r) => r.value === 'v=spf1 include:secureserver.net -all'));
  const zo = planEmailAuth('bistro.example', { provider: EMAIL_PROVIDERS.zoho, hasSpf: false, hasDmarc: false });
  ok('on Zoho it is Zoho’s', zo.steps.flatMap((s) => s.records || []).some((r) => r.value === 'v=spf1 include:zohomail.com ~all'));
  const has = planEmailAuth('bistro.example', { provider: EMAIL_PROVIDERS.google_workspace, hasSpf: true, hasDmarc: false });
  const hasRecs = has.steps.flatMap((s) => s.records || []);
  ok('a sender record already there is left alone: only the missing record is given', hasRecs.length === 1 && hasRecs[0].name === '_dmarc.bistro.example' && !hasRecs.some((r) => /v=spf1/.test(r.value)) && /already there/.test(has.summary), JSON.stringify(hasRecs));
  const hasD = planEmailAuth('bistro.example', { provider: EMAIL_PROVIDERS.google_workspace, hasSpf: false, hasDmarc: true });
  ok('…and the other way round', hasD.steps.flatMap((s) => s.records || []).length === 1 && /v=spf1/.test(hasD.steps.flatMap((s) => s.records || [])[0].value));
  const unk = planEmailAuth('bistro.example', { provider: null, mxHost: 'mx1.mail.example', hasSpf: false, hasDmarc: false });
  ok('an unknown email company gets no guessed sender record, and is told who to ask', !unk.steps.flatMap((s) => s.records || []).some((r) => /v=spf1/.test(r.value)) && /mx1\.mail\.example/.test(unk.steps[0].what) && /We don’t guess/.test(unk.steps[0].why));
  ok('with nothing read, nobody gets Google’s records', !JSON.stringify(planEmailAuth('bistro.example')).includes('google'));
  ok('the plan speaks plainly: no SPF, DKIM, DMARC or p=none in its words', [ms, has, unk].every((p) => !/\b(SPF|DKIM|DMARC)\b|p=none/.test([p.title, p.summary, p.risk, ...p.steps.map((s) => s.what)].join(' '))));
}

// ═══ 15. email lives on the bare name ═══
ok('the bare name drops "www." and nothing else', bareDomain('www.bistro.example') === 'bistro.example' && bareDomain('Bistro.Example.') === 'bistro.example' && bareDomain('shop.bistro.example') === 'shop.bistro.example');
{
  // what a resolver says when asked for the MAIL records of a name that is only a pointer
  const pointer = [{ name: 'www.bistro.example.', type: 5, data: 'bistro.example.' }];
  ok('a pointer is not filed as a mail record', recordsOfType('www.bistro.example', 'MX', pointer).length === 0, JSON.stringify(recordsOfType('www.bistro.example', 'MX', pointer)));
  ok('…nor as a text record or an address', recordsOfType('www.bistro.example', 'TXT', pointer).length === 0 && recordsOfType('www.bistro.example', 'A', pointer).length === 0);
  ok('a record for fakes kept at a reporting company (behind a pointer) still counts', recordsOfType('_dmarc.bistro.example', 'TXT', [{ name: '_dmarc.bistro.example.', type: 5, data: 'bistro.reports.example.' }, { name: 'bistro.reports.example.', type: 16, data: '"v=DMARC1; p=none"' }])[0]?.value === 'v=DMARC1; p=none');
  ok('a mail record at the name itself is', recordsOfType('bistro.example', 'MX', [{ name: 'bistro.example.', type: 15, data: '10 mx1.mail.example.' }])[0]?.priority === 10);
  ok('an address reached through a pointer still counts as where the name ends up', recordsOfType('www.bistro.example', 'A', [{ name: 'www.bistro.example.', type: 5, data: 'bistro.example.' }, { name: 'bistro.example.', type: 1, data: NETLIFY_APEX_IP }]).map((r) => r.value).join() === NETLIFY_APEX_IP);
  const f = emailFacts([
    { type: 'MX', name: 'bistro.example', value: 'bistro-example.mail.protection.outlook.com', priority: 0 },
    { type: 'TXT', name: 'bistro.example', value: 'v=spf1 include:spf.protection.outlook.com ~all' },
    { type: 'TXT', name: 'bistro.example', value: 'some-verification=abc' },
  ], 'bistro.example');
  ok('the email facts: mail, whose, and which record is there', f.hasMail && f.provider.slug === 'microsoft365' && f.hasSpf && !f.hasDmarc);
  ok('a record merely named like _dmarc elsewhere is not the record for fakes', !emailFacts([{ type: 'CNAME', name: '_dmarc.bistro.example', value: 'x.example' }, { type: 'TXT', name: '_dmarc.other.example', value: 'v=DMARC1; p=none' }], 'bistro.example').hasDmarc);
}

// ═══ 17. leftovers are real addresses, never a pointer to the same domain ═══
{
  const T = 'presence-abc.netlify.app';
  // "www" pointing at the bare name: the address lookup answers with the pointer first
  const www = nameCheckFrom('www.bistro.example', T, ['bistro.example'], ['bistro.example', NETLIFY_APEX_IP]);
  ok('www pointing at the bare name points here, with nothing to delete', www.points === true && www.leftovers.length === 0, JSON.stringify(www));
  const lines = domainChecklist({ domain: 'bistro.example', names: [{ name: 'bistro.example', points: true, leftovers: [] }, www], padlockOn: true, padlockNames: ['bistro.example', 'www.bistro.example'], serving: 'latest' });
  ok('…so the sheet never says to delete the domain’s own name', !lines.some((l) => /delete bistro\.example/.test(l.words)) && lines.every((l) => l.ok));
  const stray = nameCheckFrom('bistro.example', T, [], ['203.0.113.9', NETLIFY_APEX_IP]);
  ok('a real old address beside ours is still a leftover', stray.leftovers.join() === '203.0.113.9');
  const behind = nameCheckFrom('www.bistro.example', T, ['bistro.example'], ['bistro.example', '203.0.113.9', NETLIFY_APEX_IP]);
  ok('…and it is reported on the name that holds it, not on the name pointing there', behind.leftovers.length === 0);
  ok('www pointing straight at the site has nothing left over either', nameCheckFrom('www.bistro.example', T, [T], [T, '198.51.100.7']).leftovers.length === 0 && nameCheckFrom('www.bistro.example', T, [T], [T, '198.51.100.7']).points);
}

// ═══ 13. records found ═══
{
  const spf = { type: 'TXT', name: 'bistro.example', value: 'v=spf1 include:_spf.google.com ~all' };
  const dmarc = { type: 'TXT', name: '_dmarc.bistro.example', value: 'v=DMARC1; p=none; rua=mailto:postmaster@bistro.example' };
  const zone = [{ type: 'TXT', name: 'Bistro.Example.', value: '"v=spf1 include:_spf.google.com ~all"' }, { type: 'TXT', name: '_dmarc.bistro.example', value: dmarc.value }];
  ok('a record answers whatever the case of its name', recordAnswers(spf, zone) && recordAnswers(dmarc, zone));
  ok('every exact record answering means found', planRecordsFound([{ records: [spf, dmarc] }, { records: [] }], zone));
  ok('one missing means not found', !planRecordsFound([{ records: [spf, dmarc] }], zone.slice(0, 1)));
  ok('a plan of words only is never found this way', !planRecordsFound([{ what: 'Turn on auto-renew' }], zone) && !planRecordsFound(null, zone));
  ok('a key to copy from the email company isn’t an exact record', planRecordsFound([{ records: [spf, { type: 'TXT', name: 'google._domainkey.bistro.example', value: 'v=DKIM1; (copy the key from your email provider’s admin panel)' }] }], zone));
}

// ═══ the routes, against stubs ═══
let w;
function world(over = {}) {
  w = { dns: {}, asked: [], plans: [], inserts: [], planPatches: [], events: [], snapshots: 0, truthFails: false, ssl: 'issued', ...over };
}
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json', ...headers } });
const TYPE = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28, CAA: 257 };
const answers = (n, t) => ((w.dns[n] || {})[t] || []).map((d) => typeof d === 'string' ? { name: n + '.', type: TYPE[t], data: d } : d);
let planSeq = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'cloudflare-dns.com' || u.hostname === 'dns.google') {
    const n = u.searchParams.get('name'), t = u.searchParams.get('type');
    w.asked.push(`${n}|${t}`);
    return reply({ Status: 0, Answer: answers(n, t) });
  }
  if (u.hostname === 'api.netlify.com') {
    if (w.truthFails && method === 'GET' && !u.pathname.endsWith('/ssl')) { w.netlifyGets = (w.netlifyGets || 0) + 1; if (w.netlifyGets > 2) throw new Error('hosting is slow'); }
    if (u.pathname.endsWith('/ssl')) return method === 'POST' ? reply({}) : reply({ state: w.ssl, domains: ['bistro.example', 'www.bistro.example'], expires_at: '2027-02-01T00:00:00Z' });
    return reply({ id: 'nf1', name: 'bistro', default_domain: 'presence-abc.netlify.app', custom_domain: 'bistro.example', domain_aliases: [], state: 'current', ssl_url: null });
  }
  if (u.hostname === 'rdap.org') return reply({}, 404);
  if (u.hostname !== 'stub.local') return reply('<h1>page</h1>', 200, { Server: 'Netlify' });
  const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search);
  if (table === 'presence_infra_plans') {
    const want = (p) => (!/[?&]id=eq\.([^&]+)/.test(q) || p.id === q.match(/[?&]id=eq\.([^&]+)/)[1])
      && (!/[?&]kind=eq\.([^&]+)/.test(q) || p.kind === q.match(/[?&]kind=eq\.([^&]+)/)[1])
      && (!/[?&]kind=in\.\(([^)]+)\)/.test(q) || q.match(/[?&]kind=in\.\(([^)]+)\)/)[1].split(',').includes(p.kind))
      && (!/[?&]status=eq\.([^&]+)/.test(q) || p.status === q.match(/[?&]status=eq\.([^&]+)/)[1])
      && (!/[?&]status=in\.\(([^)]+)\)/.test(q) || q.match(/[?&]status=in\.\(([^)]+)\)/)[1].split(',').includes(p.status));
    if (method === 'POST') { const b = JSON.parse(init.body); const row = { id: `00000000-0000-4000-8000-00000000000${++planSeq}`, status: 'proposed', applied_at: null, created_at: '2026-11-12T10:00:00Z', ...b }; w.plans.unshift(row); w.inserts.push(row); return reply([row], 201); }
    if (method === 'PATCH') { const b = JSON.parse(init.body); const hit = w.plans.filter(want); hit.forEach((p) => Object.assign(p, b)); w.planPatches.push(b); return reply(hit); }
    return reply(w.plans.filter(want));
  }
  if (table === 'presence_zone_snapshots' && method === 'POST') { w.snapshots++; return reply([], 201); }
  if (table === 'presence_change_events' && method === 'POST') { w.events.push(JSON.parse(init.body)); return reply([]); }
  return reply([]);
};
const quiet = async (fn) => { const e = console.error, x = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = x; } };
const jsonOf = async (res) => ({ status: res.status, body: await res.json() });
const SITE = (custom) => ({ id: 'site1', client_id: 'c1', status: 'live', last_published_at: '2026-10-01T00:00:00Z', template_slug: 'business-classic', template_version: '1.0.0', custom_domain: custom, netlify_site_id: 'nf1', edition: 'presence' });
const post = (path, body) => new Request('http://stub.local/functions/v1/presence' + path, { method: 'POST', body: JSON.stringify(body || {}), headers: { 'Content-Type': 'application/json' } });
const OWNER = { kind: 'client', userId: 'u1', email: 'owner@bistro.example', requestId: 'r1' };
const STUDIO = { kind: 'client', userId: 'u2', email: 'eric@studio.example', requestId: 'r2', scope: { site_id: 'site1', name: 'Bistro Nine' } };
const MS_MAIL = { 'bistro.example': { MX: ['0 bistro-example.mail.protection.outlook.com.'] } };
const WWW_POINTER = [{ name: 'www.bistro.example.', type: 5, data: 'bistro.example.' }];

// 14 + 15: the sheet's read, on a site whose main name is www.
world({ dns: { ...MS_MAIL, 'www.bistro.example': { MX: WWW_POINTER, TXT: WWW_POINTER, CNAME: WWW_POINTER, A: [...WWW_POINTER, { name: 'bistro.example.', type: 1, data: NETLIFY_APEX_IP }] } } });
{
  const r = await quiet(async () => jsonOf(await handleFoundationsGet(SITE('www.bistro.example'), {})));
  ok('with www. as the main name, the email check asks about the bare name', w.asked.includes('bistro.example|MX') && w.asked.includes('_dmarc.bistro.example|TXT') && !w.asked.includes('www.bistro.example|MX') && !w.asked.includes('_dmarc.www.bistro.example|TXT'), w.asked.join(' '));
  ok('…finds the email there, and says who runs it', r.body.data.email.has_mail === true && r.body.data.email.provider === 'Microsoft 365' && r.body.data.email.spf === false, JSON.stringify(r.body.data.email));
}
world({ dns: { 'www.bistro.example': { CNAME: WWW_POINTER, A: [...WWW_POINTER, { name: 'bistro.example.', type: 1, data: NETLIFY_APEX_IP }] } } });
{
  const r = await quiet(async () => jsonOf(await handleFoundationsGet(SITE('www.bistro.example'), {})));
  ok('a domain with no email reads as no email, not as unprotected email', r.body.data.email.has_mail === false && /No email runs on this domain/.test(r.body.data.email.sentence));
}

// 14: the plan the button makes
world({ dns: MS_MAIL });
{
  const r = await quiet(async () => jsonOf(await handleFoundationsPrepare(post('/foundations/prepare', { goal: 'email_auth' }), SITE('www.bistro.example'), OWNER, {})));
  const recs = (r.body.data?.steps || []).flatMap((s) => s.records || []);
  ok('email protection on Microsoft 365 gives Microsoft’s records on the bare name', r.status === 200 && recs.some((x) => x.name === 'bistro.example' && /spf\.protection\.outlook\.com/.test(x.value)) && recs.some((x) => x.name === '_dmarc.bistro.example'), JSON.stringify(recs));
  ok('…never Google’s, and never on the www. name', !JSON.stringify(r.body.data).includes('google') && !recs.some((x) => /www\./.test(x.name)) && r.body.data.title === 'Protect email sent from @bistro.example');
  ok('…and remembers whose they were', w.inserts[0]?.extra?.email_provider === 'microsoft365');

  // 13: the same press again
  const again = await quiet(async () => jsonOf(await handleFoundationsPrepare(post('/foundations/prepare', { goal: 'email_auth' }), SITE('www.bistro.example'), OWNER, {})));
  ok('a second press makes no second plan: the open one comes back', again.status === 200 && again.body.data.already === true && again.body.data.id === r.body.data.id && w.inserts.length === 1, `inserts ${w.inserts.length}`);
  w.plans[0].status = 'approved';
  const third = await quiet(async () => jsonOf(await handleFoundationsPrepare(post('/foundations/prepare', { goal: 'email_auth' }), SITE('www.bistro.example'), OWNER, {})));
  ok('…the same once it is approved', third.body.data.already === true && w.inserts.length === 1);
  const prev = await quiet(async () => jsonOf(await handleFoundationsPrepare(post('/foundations/prepare', { goal: 'registrar_care', preview: true }), SITE('bistro.example'), STUDIO, {})));
  ok('a preview still saves nothing', prev.body.data.preview === true && w.inserts.length === 1);
}
world({ dns: { 'bistro.example': { MX: ['0 bistro-example.mail.protection.outlook.com.'], TXT: ['"v=spf1 include:spf.protection.outlook.com ~all"'] } } });
{
  const r = await quiet(async () => jsonOf(await handleFoundationsPrepare(post('/foundations/prepare', { goal: 'email_auth' }), SITE('bistro.example'), OWNER, {})));
  const recs = (r.body.data?.steps || []).flatMap((s) => s.records || []);
  ok('with a sender record already there, the plan adds only the missing one', recs.length === 1 && recs[0].name === '_dmarc.bistro.example', JSON.stringify(recs));
}
world({ dns: { 'bistro.example': { MX: ['0 bistro-example.mail.protection.outlook.com.'], TXT: ['"v=spf1 include:spf.protection.outlook.com ~all"'] }, '_dmarc.bistro.example': { TXT: ['"v=DMARC1; p=none"'] } } });
{
  const r = await quiet(async () => jsonOf(await handleFoundationsPrepare(post('/foundations/prepare', { goal: 'email_auth' }), SITE('bistro.example'), OWNER, {})));
  ok('with both there, no plan is made at all', r.status === 409 && r.body.error === 'already_protected' && w.inserts.length === 0);
}
world();
{
  const r = await quiet(async () => jsonOf(await handleFoundationsPrepare(post('/foundations/prepare', { goal: 'email_auth' }), SITE('bistro.example'), OWNER, {})));
  ok('with no email found, no plan is made either', r.status === 409 && r.body.error === 'no_mail' && w.inserts.length === 0);
}

// 13: an approved plan closes itself once its records answer
const APPROVED = (over = {}) => ({ id: '00000000-0000-4000-8000-0000000000aa', site_id: 'site1', kind: 'email_auth', title: 'Protect email sent from @bistro.example', status: 'approved', applied_at: null,
  steps: [{ what: 'Add Microsoft 365’s sender record', automated: false, done: false, records: [{ type: 'TXT', name: 'bistro.example', value: 'v=spf1 include:spf.protection.outlook.com ~all' }] },
    { what: 'Add the record that tells inboxes what to do with fakes', automated: false, done: false, records: [{ type: 'TXT', name: '_dmarc.bistro.example', value: 'v=DMARC1; p=none; rua=mailto:postmaster@bistro.example' }] }], ...over });
const BOTH_IN = { 'bistro.example': { MX: ['0 bistro-example.mail.protection.outlook.com.'], TXT: ['"v=spf1 include:spf.protection.outlook.com ~all"'] }, '_dmarc.bistro.example': { TXT: ['"v=DMARC1; p=none; rua=mailto:postmaster@bistro.example"'] } };
world({ dns: BOTH_IN, plans: [APPROVED()] });
{
  const r = await quiet(async () => jsonOf(await handleFoundationsGet(SITE('bistro.example'), {})));
  ok('opening the sheet with the records in finishes the approved plan', w.plans[0].status === 'applied' && !!w.plans[0].applied_at && w.plans[0].steps.every((s) => s.done), JSON.stringify(w.planPatches));
  ok('…tells the page which one, and writes it in the history', r.body.data.cleared_plans.join() === APPROVED().id && w.events.some((e) => /Finished by itself, its records were found: Protect email/.test(e.summary)));
}
world({ dns: MS_MAIL, plans: [APPROVED()] });
{
  const r = await quiet(async () => jsonOf(await handleFoundationsGet(SITE('bistro.example'), {})));
  ok('with the records still missing, it stays approved', w.plans[0].status === 'approved' && r.body.data.cleared_plans.length === 0 && w.planPatches.length === 0);
}
world({ dns: BOTH_IN, plans: [APPROVED({ status: 'proposed' })] });
{
  await quiet(async () => handleFoundationsGet(SITE('bistro.example'), {}));
  ok('a plan nobody approved is never finished for them', w.plans[0].status === 'proposed');
}
world({ dns: BOTH_IN, plans: [APPROVED({ kind: 'registrar_care', title: 'Keep bistro.example safely yours', steps: [{ what: 'Turn on auto-renew', automated: false, done: false }] })] });
{
  await quiet(async () => handleFoundationsGet(SITE('bistro.example'), {}));
  ok('a plan with no records to find waits for the studio', w.plans[0].status === 'approved');
}
world({ dns: BOTH_IN, plans: [APPROVED()] });
{
  const ids = await quiet(() => clearFoundPlans('site1', 'bistro.example', '2026-11-12T12:00:00.000Z'));
  ok('the daily check finishes it too, reading the records itself', ids.length === 1 && w.plans[0].status === 'applied' && w.asked.includes('bistro.example|TXT'));
}
world({ dns: BOTH_IN, plans: [] });
{
  const ids = await quiet(() => clearFoundPlans('site1', 'bistro.example', '2026-11-12T12:00:00.000Z'));
  ok('…and with no approved plan it reads nothing', ids.length === 0 && w.asked.length === 0);
}

// 13: the studio marks one done
world({ plans: [APPROVED({ kind: 'registrar_care', title: 'Keep bistro.example safely yours', steps: [{ what: 'Turn on auto-renew', automated: false, done: false }] })] });
{
  const no = await quiet(async () => jsonOf(await handleFoundationsPlanDone(SITE('bistro.example'), APPROVED().id, OWNER, {})));
  ok('the client can’t mark a plan done: that is the studio’s', no.status === 403 && no.body.error === 'studio_only' && w.plans[0].status === 'approved');
  const yes = await quiet(async () => jsonOf(await handleFoundationsPlanDone(SITE('bistro.example'), APPROVED().id, STUDIO, {})));
  ok('the studio can, and the plan is finished', yes.status === 200 && yes.body.data.status === 'applied' && w.plans[0].status === 'applied', JSON.stringify(yes.body));
}
world({ plans: [APPROVED({ status: 'proposed' })] });
{
  const r = await quiet(async () => jsonOf(await handleFoundationsPlanDone(SITE('bistro.example'), APPROVED().id, STUDIO, {})));
  ok('…but never one the client hasn’t approved', r.status === 409 && r.body.error === 'not_approved' && w.plans[0].status === 'proposed');
}
ok('members: marking a plan done is a decided route; the route itself answers the studio only', memberWriteNeeds('/foundations/plans/00000000-0000-4000-8000-0000000000aa/done', 'POST') === 'open');
{
  const idx = read('supabase/functions/presence/index.ts');
  ok('the route is wired', /\/foundations\\\/plans\\\/\(\[0-9a-f-\]\{36\}\)\\\/done\$/.test(idx) && idx.includes('handleFoundationsPlanDone(site, d[1], principal, cors)'));
  const row = buildNeedsYou({ nowIso: '2026-11-12T12:00:00.000Z', links: [{ site_id: 'site1', status: 'active' }], sites: [{ id: 'site1', name: 'Bistro', edition: 'presence', status: 'live' }], plans: [{ id: 'p1', site_id: 'site1', title: 'Protect email', status: 'approved' }] }).find((x) => x.key === 'plan:p1');
  ok('Home’s row no longer says Apply (the sheet has no such button)', !!row && row.verb === 'Finish' && /mark it done/.test(row.what), JSON.stringify(row));
}

// 16: the check couldn't run
const LIVE_DNS = { 'bistro.example': { A: [NETLIFY_APEX_IP] }, 'www.bistro.example': { CNAME: ['presence-abc.netlify.app.'], A: ['presence-abc.netlify.app.', '198.51.100.7'] } };
world({ dns: LIVE_DNS, truthFails: true });
{
  const r = await quiet(async () => jsonOf(await handleDomain(new Request('http://stub.local/functions/v1/presence/foundations/domain'), 'GET', SITE('bistro.example'), OWNER, {})));
  ok('when the full check can’t run, the answer says so and carries no checklist', r.status === 200 && r.body.data.health === 'ok' && r.body.data.check_failed === true && r.body.data.checklist === undefined && r.body.data.all_ok === undefined, JSON.stringify(r.body.data).slice(0, 300));
}
world({ dns: LIVE_DNS });
{
  const r = await quiet(async () => jsonOf(await handleDomain(new Request('http://stub.local/functions/v1/presence/foundations/domain'), 'GET', SITE('bistro.example'), OWNER, {})));
  ok('when it runs, the checklist comes and nothing is flagged', r.body.data.all_ok === true && Array.isArray(r.body.data.checklist) && r.body.data.check_failed === undefined, JSON.stringify(r.body.data).slice(0, 300));
}
// 17, end to end: www pointing at the bare name
world({ dns: { 'bistro.example': { A: [NETLIFY_APEX_IP] }, 'www.bistro.example': { CNAME: ['bistro.example.'], A: [{ name: 'www.bistro.example.', type: 5, data: 'bistro.example.' }, { name: 'bistro.example.', type: 1, data: NETLIFY_APEX_IP }] } } });
{
  const t = await quiet(() => domainTruth({ custom_domain: 'bistro.example', netlify_site_id: 'nf1' }, 'bistro.example'));
  ok('www pointing at the bare name passes every check', t.all_ok === true && !t.checklist.some((l) => /delete/.test(l.words)), t.checklist.map((l) => l.words).join(' | '));
}

// ═══ the page ═══
{
  const page = read('presence.html');
  ok('16: no checklist is no claim, on the sheet', page.includes('const allOk = !!lines && dstat.all_ok === true;') && !page.includes('const allOk = !lines || dstat.all_ok === true;') && page.includes('"We couldn’t check " + dstat.custom_domain + " just now."') && page.includes('el("button", "textact", "Check again")'));
  ok('16: …and on the Search tab’s card', page.includes('!checked ? "We couldn’t check " + d.custom_domain + " just now."') && page.includes('!checked ? "Check again"'));
  ok('13: the studio has Mark as done, and it calls the route', page.includes('el("button", "textact", "Mark as done")') && page.includes('api("POST", `/foundations/plans/${p.id}/done`)'));
  ok('13: nothing is "being handled" by nobody', !page.includes('approved — being handled') && !page.includes('your studio takes it from here'));
  ok('13: the button gives way while its plan waits', page.includes('p.kind === "email_auth" && (p.status === "proposed" || p.status === "approved")') && page.includes('The records to add are at the bottom, under “Waiting for your OK”.'));
  ok('13: plans the server just finished leave the list', page.includes('!clearedPlans.includes(p.id)'));
  ok('14: the card says whose records are coming', page.includes('"Your email runs at " + f.email.provider'));
}

const passed = results.filter((r) => r.p).length;
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
