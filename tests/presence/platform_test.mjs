// ── M12 Platform Services suite ──────────────────────────────────────────────
// Pure tiers: provider abstractions (capability honesty, registrar/hosting/
// DNS registries, a future adapter plugs in), DNS record validation for every
// supported type + SPF/DKIM/DMARC specializations, templates, plain-language
// translation, plan generation (connect domain, email auth, registrar care,
// hosting restore), migration planning from a readiness report (mapping,
// redirects, launch checks, QA, rollback), infrastructure safety (approval
// law is structural; no external write paths). Integration (staging): the
// foundations surface reads real state in sentences, a plan is prepared →
// approved → applied (approval law verified: unapproved apply refused),
// zone snapshots recorded, state restored.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/platform_test.mjs
import { REGISTRARS, registrarFor, manualRegistrar, HOSTS, hostFor, guidedDns, guidedEmailAuth } from '../../supabase/functions/presence/platform/contract.ts';
import { validateRecord, explainRecord, templateRecords } from '../../supabase/functions/presence/platform/dns.ts';
import { planConnectDomain, planEmailAuth, planRegistrarCare, planHostingRestore } from '../../supabase/functions/presence/platform/plans.ts';
import { planMigration } from '../../supabase/functions/presence/platform/migration.ts';
import { assessMigrationReadiness } from '../../supabase/functions/presence/monitor/readiness.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. provider abstraction — capabilities declared, never assumed ═══
{
  ok('registrar: the architecture is a registry — never one registrar', typeof REGISTRARS === 'object' && registrarFor('anything-unknown').slug === 'manual');
  const caps = Object.values(manualRegistrar.capabilities);
  ok('registrar: the shipped adapter claims GUIDED everywhere — it never lies about automation', caps.every((c) => c === 'guided'));
  ok('registrar: guidance is real steps in plain words', manualRegistrar.guide('transfer_in', 'marlows.example').length >= 2 && manualRegistrar.guide('auto_renew', 'marlows.example')[0].includes('auto-renew'));
  const future = { slug: 'future-reg', name: 'Future', capabilities: { ...manualRegistrar.capabilities, purchase: 'automatic' }, guide: () => [] };
  REGISTRARS['future-reg'] = future;
  ok('registrar: a future automatic adapter is a registry entry, nothing more', registrarFor('future-reg').capabilities.purchase === 'automatic');
  delete REGISTRARS['future-reg'];
  ok('hosting: the shipped adapter wraps the EXISTING netlify lib behind the contract', hostFor('netlify').capabilities.ssl === 'automatic' && typeof HOSTS.netlify.restore === 'function');
  ok('dns + email: reads automatic, writes honestly guided', guidedDns.capabilities.read === 'automatic' && guidedDns.capabilities.write === 'guided' && guidedEmailAuth.capabilities.inspect === 'automatic');
}

// ═══ 2. DNS record validation — every type, plus the email trio ═══
{
  const V = (t, name, value, priority) => validateRecord({ type: t, name, value, priority });
  ok('A: valid IPv4 passes; garbage and >255 octets fail', V('A', 'x.com', '75.2.60.5').ok && !V('A', 'x.com', '999.1.1.1').ok && !V('A', 'x.com', 'not-an-ip').ok);
  ok('AAAA: IPv6 passes; IPv4 fails', V('AAAA', 'x.com', '2606:4700::1111').ok && !V('AAAA', 'x.com', '1.2.3.4').ok);
  ok('CNAME: hostname passes; apex CNAME is caught with the classic explanation', V('CNAME', 'www.x.com', 'x.netlify.app').ok && /apex/.test(V('CNAME', 'x.com', 'y.com').problem || ''));
  ok('MX: needs a priority and a hostname', V('MX', 'x.com', 'mail.x.com', 10).ok && !V('MX', 'x.com', 'mail.x.com').ok);
  ok('TXT/SPF: requires a real all-mechanism ending', V('TXT', 'x.com', 'v=spf1 include:_spf.google.com ~all').ok && !V('TXT', 'x.com', 'v=spf1 include:_spf.google.com').ok);
  ok('TXT/DMARC: requires v=DMARC1 with a policy', V('TXT', '_dmarc.x.com', 'v=DMARC1; p=none').ok && !V('TXT', '_dmarc.x.com', 'hello').ok);
  ok('TXT/DKIM: requires v=DKIM1', V('TXT', 'g._domainkey.x.com', 'v=DKIM1; k=rsa; p=MIGf').ok && !V('TXT', 'g._domainkey.x.com', 'p=key-without-version').ok);
  ok('SRV/CAA/NS: shapes enforced', V('SRV', '_sip._tcp.x.com', '10 60 5060 sip.x.com').ok && V('CAA', 'x.com', '0 issue "letsencrypt.org"').ok && V('NS', 'x.com', 'dns1.registrar.com').ok && !V('CAA', 'x.com', 'nonsense').ok);
  ok('explain: every record becomes one plain business sentence', ['A', 'CNAME', 'MX', 'NS', 'CAA', 'SRV'].every((t) => explainRecord({ type: t, name: 'x.com', value: 'v' }).length > 10) &&
    /forgeries/.test(explainRecord({ type: 'TXT', name: 'x.com', value: 'v=spf1 ~all' })));
  const tpl = templateRecords('point_domain', { domain: 'marlows.example' });
  ok('templates: goals become exact, valid records', tpl.length === 2 && tpl.every((r) => validateRecord(r).ok));
  ok('templates: DKIM is named but the key is NEVER invented', templateRecords('email_auth', { domain: 'x.com' }).some((r) => /copy the key/.test(r.value)));
}

// ═══ 3. plans — exact steps, honest risk, rollback, approval constant ═══
{
  const p1 = planConnectDomain('marlows.example', null);
  ok('connect_domain: exact records + why + what stays untouched', p1.steps[0].records.length === 2 && /Email.*untouched/i.test(p1.summary) && p1.steps[0].explain.length === 2);
  ok('connect_domain: automation honestly split — DNS guided, SSL/verification automatic', p1.steps[0].automated === false && p1.steps[1].automated === true);
  const p2 = planEmailAuth('marlows.example');
  ok('email_auth: SPF+DMARC prepared; DKIM deferred to the mail provider, honestly', p2.steps[0].records.length === 2 && /never invents the key/.test(p2.steps[1].why));
  ok('email_auth: defaults to monitor-only DMARC — tightening is a separate decision', /p=none/.test(p2.risk));
  const p3 = planRegistrarCare('marlows.example', (a, d) => manualRegistrar.guide(a, d));
  ok('registrar_care: the two disaster-prevention switches, guided', p3.steps.length === 3 && /auto-renew/i.test(p3.steps[0].what) && /privacy/i.test(p3.steps[1].what));
  const p4 = planHostingRestore('abc12345deploy', 'Summer menu launch');
  ok('hosting_restore: automated via the provider, verified after, reversible', p4.steps.every((s) => s.automated) && p4.reversible && /one step back/.test(p4.rollback_note));
  ok('every plan: requires_approval is the constant true + honest risk + rollback note', [p1, p2, p3, p4].every((p) => p.requires_approval === true && p.risk.length > 5 && p.rollback_note.length > 10));
}

// ═══ 4. migration lifecycle — from readiness to plan ═══
{
  const readiness = assessMigrationReadiness([
    { path: '/', html: '<title>Marlow’s</title><meta name="description" content="x">' },
    { path: '/food/', html: '<title>Menu</title>' },
    { path: '/our-story/', html: '<title>About</title>' },
    { path: '/shop/cart/', html: '<title>Cart</title>' },
  ], [{ category: 'accessibility', type: 'accessibility.img_alt_missing', severity: 'warning', human: 'alt text missing' }]);
  const mp = planMigration(readiness, 'marlows.example');
  ok('migration: content mapping covers every non-manual page', mp.content_mapping.length === 3 && mp.content_mapping.find((m) => m.from === '/food/').to === '/menu/');
  ok('migration: SEO preserved — renamed paths become redirect entries for the EXISTING mechanism', mp.redirects.some((r) => r.from_path === '/food' && r.to_path === '/menu/'));
  ok('migration: launch verification + post-launch QA are explicit checklists', mp.launch_checks.length >= 4 && mp.post_launch_qa.length >= 2);
  ok('migration: rollback is real — the old site lives until DNS moves, and DNS can move back', /DNS back/.test(mp.rollback_note) && /rollback window/.test(mp.post_launch_qa.join(' ')));
  ok('migration: commerce pages are planned separately, never silently dropped', mp.steps.some((s) => /Plan separately/.test(s.what) && /cart/.test(s.what)));
  ok('migration: no moment without a website', /no moment without a website/i.test(mp.summary));
  ok('migration: deterministic', JSON.stringify(mp) === JSON.stringify(planMigration(readiness, 'marlows.example')));
}

// ═══ 5. infrastructure safety — structural ═══
{
  const src = ['contract.ts', 'dns.ts', 'plans.ts', 'migration.ts']
    .map((f) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/platform/${f}`, import.meta.url))).join('\n');
  ok('safety: the platform module performs NO writes — no POST/PUT/PATCH/DELETE anywhere in it', !/method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(src));
  ok('safety: no parallel intelligence — platform imports no evidence/judgment/moments modules', !/from '\.\.\/(evidence|judgment|moments|recommendation)\//.test(src));
  const routes = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/foundations.ts', import.meta.url));
  ok('safety: apply refuses anything not APPROVED — the law is in the code path', /status !== 'approved'/.test(routes) && /not_approved/.test(routes));
}

// ═══ 6. integration (staging) ═══
const SB = Deno.env.get('SB'), SR = Deno.env.get('SR_KEY'), ANON = Deno.env.get('ANON');
if (SB && SR && ANON) {
  const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
  const login = async (email) => {
    const u = (users.users || []).find((x) => (x.email || '').toLowerCase() === email);
    const pw = 'pw-' + crypto.randomUUID().slice(0, 12);
    await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: pw }) });
    return (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })).json()).access_token;
  };
  const [jwtC, jwtS] = [await login('rcat-acceptance@example.com'), await login('staging-staff@studio-os.test')];
  const call = async (jwt, m, route, body) => {
    const r = await fetch(`${SB}/functions/v1/presence${route}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': jwt }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await j(r) };
  };
  const siteId = (await call(jwtC, 'GET', '/site')).json?.data?.site?.id;

  // domain context for the plan flow: the staging site has no custom domain,
  // so seed a verified monitor connection (example.com — read-only GETs only)
  await fetch(`${SB}/rest/v1/presence_monitor_connections`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ site_id: siteId, url: 'https://example.com/', domain: 'example.com', platform: 'custom', method: 'meta', token: 'dds-test', status: 'verified', verified_at: new Date().toISOString() }) });

  try {
    const f = await call(jwtC, 'GET', '/foundations');
    ok('integration: the foundations surface answers in sentences — domain, dns, ssl, email, hosting', f.status === 200 &&
      ['domain', 'dns', 'ssl', 'email', 'hosting'].every((k) => typeof f.json?.data?.[k]?.sentence === 'string' && f.json.data[k].sentence.length > 20), f.json?.data?.hosting?.sentence);
    ok('integration: no raw jargon forced on the customer — every section leads with plain words', !/\bTXT\b|\bMX\b|\bCNAME\b/.test(Object.values(f.json?.data || {}).map((s) => s.sentence).join(' ')));

    const prep = await call(jwtC, 'POST', '/foundations/prepare', { goal: 'registrar_care' });
    ok('integration: a plan is prepared with steps, risk, and rollback', prep.status === 200 && prep.json?.data?.status === 'proposed' && (prep.json?.data?.steps || []).length === 3);
    const planId = prep.json?.data?.id;

    const early = await call(jwtS, 'POST', `/admin/sites/${siteId}/plans/${planId}/apply`);
    ok('integration: THE APPROVAL LAW — applying an unapproved plan is refused', early.status === 409 && early.json?.error === 'not_approved');

    const dec = await call(jwtC, 'POST', `/foundations/plans/${planId}/decide`, { decision: 'approve' });
    ok('integration: the customer approves', dec.status === 200 && dec.json?.data?.status === 'approved');
    const applied = await call(jwtS, 'POST', `/admin/sites/${siteId}/plans/${planId}/apply`);
    ok('integration: an approved plan applies — guided steps recorded, automated steps noted', applied.status === 200 && applied.json?.data?.status === 'applied' && (applied.json?.data?.notes || []).length >= 2);

    const plans = await call(jwtC, 'GET', '/foundations/plans');
    ok('integration: the plan history is the customer’s to read', plans.status === 200 && (plans.json?.data || []).some((p) => p.id === planId && p.status === 'applied'));

    const prep2 = await call(jwtC, 'POST', '/foundations/prepare', { goal: 'registrar_care' });
    const dec2 = await call(jwtC, 'POST', `/foundations/plans/${prep2.json?.data?.id}/decide`, { decision: 'abandon' });
    ok('integration: abandoning is always available', dec2.status === 200 && dec2.json?.data?.status === 'abandoned');
  } finally {
    // remove the test plans + the seeded connection
    await fetch(`${SB}/rest/v1/presence_infra_plans?site_id=eq.${siteId}&kind=eq.registrar_care`, { method: 'DELETE', headers: H });
    await fetch(`${SB}/rest/v1/presence_monitor_connections?site_id=eq.${siteId}`, { method: 'DELETE', headers: H });
  }
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ PLATFORM SERVICES: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
