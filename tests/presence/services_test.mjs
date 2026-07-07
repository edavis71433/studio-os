// ── M14 Presence Platform Services suite ─────────────────────────────────────
// Pure tiers: desired-zone validation + drift detection + one-click repair,
// transfer plans (both directions — leaving as guided as arriving), email
// provider presets (records validate; DKIM never invented), import inventory
// extraction, and the Launch Assistant's honest derivation. Integration
// (staging): the export carries EVERYTHING the customer owns (the ownership
// guarantee, verified field by field), DNS editor round-trip with history +
// rollback, drift → repair plan under the approval law, email posture in
// sentences, launch checklist live, import inventory changes NOTHING.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/services_test.mjs
import { validateZone, diffZones, planDnsRepair } from '../../supabase/functions/presence/platform/zone.ts';
import { planTransferIn, planTransferOut } from '../../supabase/functions/presence/platform/transfer.ts';
import { EMAIL_PROVIDERS, planEmailSetup } from '../../supabase/functions/presence/platform/email_providers.ts';
import { buildImportInventory } from '../../supabase/functions/presence/platform/importer.ts';
import { buildLaunchChecklist } from '../../supabase/functions/presence/platform/launch.ts';
import { validateRecord } from '../../supabase/functions/presence/platform/dns.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. the desired zone — validation, drift, repair ═══
{
  const good = [
    { type: 'A', name: 'marlows.example', value: '75.2.60.5' },
    { type: 'CNAME', name: 'www.marlows.example', value: 'marlows.example' },
    { type: 'MX', name: 'marlows.example', value: 'smtp.google.com', priority: 1 },
    { type: 'TXT', name: 'marlows.example', value: 'v=spf1 include:_spf.google.com ~all' },
  ];
  ok('zone: a good zone validates', validateZone(good).ok);
  const v = validateZone([...good, { type: 'A', name: 'marlows.example', value: 'not-an-ip' }, good[0]]);
  ok('zone: bad records and duplicates named by index', !v.ok && v.problems.length === 2 && /IPv4/.test(v.problems[0].problem) && /Duplicate/.test(v.problems[1].problem));

  const observed = [good[0], { type: 'TXT', name: 'marlows.example', value: 'some-verification-we-dont-manage' }];
  const drift = diffZones(good, observed);
  ok('drift: desired-but-missing detected; satisfied counted; unmanaged records NEVER touched',
    drift.missing.length === 3 && drift.satisfied === 1 && drift.observed_extra >= 1);
  ok('drift: normalization — trailing dots and case don’t create false drift',
    diffZones([{ type: 'CNAME', name: 'WWW.Marlows.example', value: 'marlows.example.' }], [{ type: 'CNAME', name: 'www.marlows.example', value: 'MARLOWS.EXAMPLE' }]).missing.length === 0);
  const rp = planDnsRepair('marlows.example', drift);
  ok('repair: one click becomes a plan — exact records, adds only, approval required',
    rp.kind === 'dns_repair' && rp.steps[0].records.length === 3 && /nothing is deleted/i.test(rp.risk) && rp.requires_approval === true);
}

// ═══ 2. transfers — leaving as guided as arriving ═══
{
  const tin = planTransferIn('marlows.example');
  const tout = planTransferOut('marlows.example');
  ok('transfer in: progress steps with the 60-day honesty', tin.steps.length === 5 && /60 days/.test(tin.risk) && /KEEP WORKING/i.test(tin.summary));
  ok('transfer out: a SUPPORTED workflow, not an exception', tout.steps.length === 4 && /Leaving is a supported workflow/i.test(tout.rollback_note) && /no retention hoops/i.test(tout.steps[0].why));
  ok('transfers: both reversible, both approval-gated', [tin, tout].every((p) => p.reversible && p.requires_approval === true));
}

// ═══ 3. email providers — presets as data, DKIM honesty ═══
{
  ok('email: four presets exist (google/microsoft/zoho/other) — a new provider is an entry', Object.keys(EMAIL_PROVIDERS).length === 4);
  for (const slug of ['google_workspace', 'microsoft365', 'zoho']) {
    const p = planEmailSetup('marlows.example', slug);
    const records = p.steps.flatMap((s) => s.records || []);
    ok(`email(${slug}): every prepared record validates; DKIM key comes from the provider`,
      records.every((r) => validateRecord(r).ok) && p.steps.some((s) => /never invents signing keys/i.test(s.why)) && p.kind === 'email_setup');
  }
  const other = planEmailSetup('marlows.example', 'other');
  ok('email(other): no MX invented for unknown providers; MX risk named when mail could move',
    !other.steps.some((s) => (s.records || []).some((r) => r.type === 'MX')) &&
    /Medium if mail already flows/i.test(planEmailSetup('m.example', 'google_workspace').risk));
  ok('email: the platform is NOT an email service — stated in the plan itself', /not an email service/i.test(other.summary));
}

// ═══ 4. import inventory — review before anything moves ═══
{
  const pages = [
    { path: '/', html: '<title>Marlow’s</title><meta name="description" content="Seasonal plates."><h1>Marlow’s Kitchen</h1><nav><a href="/menu">Menu</a></nav><p>' + 'We cook honest food. '.repeat(30) + '</p><img src="/img/patio.jpg"><img src="https://cdn.example/hero.webp">' },
    { path: '/menu/', html: '<title>Menu</title><h1>The Menu</h1><h2>Mains</h2><p>Rye gnocchi and half chicken, plates that change with the market garden.</p><img src="/img/gnocchi.png">' },
  ];
  const inv = buildImportInventory(pages, 'https://marlows.example/');
  ok('inventory: per-page title/description/headings/text/word-count extracted', inv.pages[0].title === 'Marlow’s' && inv.pages[0].headings.includes('Marlow’s Kitchen') && inv.pages[0].word_count > 100 && inv.pages[1].headings.length === 2);
  ok('inventory: nav/footer/script noise excluded from text', !inv.pages[0].text_preview.includes('Menu'));
  ok('inventory: media preserved as absolute URLs, deduped across the site', inv.media.length === 3 && inv.media.every((u) => u.startsWith('http')));
  ok('inventory: pages classified + fitted for the mapping', inv.pages[1].kind === 'menu' && inv.pages[1].fit === 'clean');
  ok('inventory: totals honest; deterministic', inv.totals.pages === 2 && JSON.stringify(inv) === JSON.stringify(buildImportInventory(pages, 'https://marlows.example/')));
}

// ═══ 5. the Launch Assistant — honest derivation ═══
{
  const base = { edition: 'presence', domain: 'marlows.example', apex_resolves: true, https_ok: true, published: true, monitor_verified: false, sitemap_present: true, gbp_connected: true, analytics_connected: true, email_has_mx: true, email_authenticated: true, accessibility_criticals: 0, review_done: true };
  const launched = buildLaunchChecklist(base);
  ok('launch: everything standing → launched, said plainly', launched.launched && launched.done === launched.total && /fully launched and watched/i.test(launched.sentence));
  const fresh = buildLaunchChecklist({ ...base, domain: null, apex_resolves: null, https_ok: null, published: false, sitemap_present: null, gbp_connected: false, analytics_connected: false, email_has_mx: false, email_authenticated: false, review_done: false, accessibility_criticals: 0 });
  ok('launch: a fresh site → todos with HOW in plain words, n/a honestly excluded',
    !fresh.launched && fresh.items.every((i) => i.how.length > 8) && fresh.items.some((i) => i.state === 'n/a'));
  ok('launch: no-email domains never nagged about email', fresh.items.find((i) => i.step === 'Email authenticated').state === 'n/a');
  const monitor = buildLaunchChecklist({ ...base, edition: 'monitor', published: false, monitor_verified: true });
  ok('launch: monitor edition — connected & verified counts as the website step', monitor.items.find((i) => /connected & verified/.test(i.step)).state === 'done');
  ok('launch: accessibility criticals block the reviewed step with a count', buildLaunchChecklist({ ...base, accessibility_criticals: 2 }).items.find((i) => i.step === 'Accessibility reviewed').how.includes('2 critical'));
}

// ═══ 6. ownership, structurally ═══
{
  const src = ['exporter.ts', 'importer.ts', 'zone.ts', 'transfer.ts', 'email_providers.ts', 'launch.ts']
    .map((f) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/platform/${f}`, import.meta.url))).join('\n');
  ok('structure: no module here writes the world — no POST/PUT/PATCH/DELETE, no deploy calls', !/method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(src) && !/netlify|deploy/i.test(src));
  ok('structure: the export declares the ownership note in its own contract', /Nothing here requires Studio OS/i.test(src));
}

// ═══ 7. integration (staging) ═══
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
  const jwt = await login('rcat-acceptance@example.com');
  const call = async (m, route, body) => {
    const r = await fetch(`${SB}/functions/v1/presence${route}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': jwt }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await j(r) };
  };
  const siteId = (await call('GET', '/site')).json?.data?.site?.id;
  // domain context: seed a verified monitor connection (example.com, read-only)
  await fetch(`${SB}/rest/v1/presence_monitor_connections`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ site_id: siteId, url: 'https://example.com/', domain: 'example.com', platform: 'custom', method: 'meta', token: 'dds-m14', status: 'verified', verified_at: new Date().toISOString() }) });

  try {
    // THE OWNERSHIP GUARANTEE — the export carries everything, field by field
    const exp = await call('GET', '/export');
    const d = exp.json?.data;
    ok('integration: the export answers with the full ownership set', exp.status === 200 && d?.format === 'studio-os-export/1' &&
      d.content?.identity && Array.isArray(d.media) && d.brand_profile !== undefined && Array.isArray(d.knowledge_docs) && d.website && Object.keys(d.website).some((k) => k.endsWith('.html')));
    ok('integration: the rendered website in the export is portable HTML', /<html/i.test(d?.website?.['index.html'] || ''));
    ok('integration: the ownership note says it out loud', /Nothing here requires Studio OS/i.test(d?.ownership_note || ''));

    // the Launch Assistant, live
    const launch = await call('GET', '/launch');
    ok('integration: the launch checklist derives from live state', launch.status === 200 && Array.isArray(launch.json?.data?.items) && typeof launch.json.data.sentence === 'string' && launch.json.data.total > 0, launch.json?.data?.sentence);

    // the DNS document: save → history → drift → repair plan → rollback
    const put = await call('PUT', '/foundations/dns', { records: [{ type: 'A', name: 'example.com', value: '75.2.60.5' }], note: 'm14 test' });
    ok('integration: the desired zone saves as a DOCUMENT (reality untouched)', put.status === 200 && /Reality follows through an approved plan/i.test(put.json?.data?.note || ''));
    const bad = await call('PUT', '/foundations/dns', { records: [{ type: 'A', name: 'example.com', value: 'nonsense' }] });
    ok('integration: invalid records are refused with the problem named', bad.status === 400 && (bad.json?.details || []).length === 1);
    const dns = await call('GET', '/foundations/dns');
    ok('integration: desired vs observed with drift in a sentence', dns.status === 200 && (dns.json?.data?.desired || []).length === 1 && typeof dns.json?.data?.drift?.sentence === 'string' && (dns.json?.data?.history || []).length >= 1);
    const repair = await call('POST', '/foundations/prepare', { goal: 'dns_repair' });
    ok('integration: drift → one-click repair PLAN (approval law, not action)', repair.status === 200 && repair.json?.data?.kind === 'dns_repair' && repair.json?.data?.status === 'proposed');
    const hist = dns.json?.data?.history?.[0];
    const rb = await call('POST', '/foundations/dns/rollback', { history_id: hist.id });
    ok('integration: rollback restores a saved version', rb.status === 200 && rb.json?.data?.restored === 1);

    // transfers + email setup as plans
    const tout = await call('POST', '/foundations/prepare', { goal: 'transfer_out' });
    ok('integration: transfer OUT is a first-class supported plan', tout.status === 200 && tout.json?.data?.kind === 'domain_transfer_out');
    const email = await call('POST', '/foundations/prepare', { goal: 'email_setup', provider: 'google_workspace' });
    ok('integration: provider-preset email setup prepared with validated records', email.status === 200 && email.json?.data?.kind === 'email_setup' && (email.json?.data?.steps || []).some((s) => (s.records || []).length));
    const emailHealth = await call('GET', '/foundations/email');
    ok('integration: deliverability posture in plain words', emailHealth.status === 200 && typeof emailHealth.json?.data?.sentence === 'string' && Array.isArray(emailHealth.json?.data?.checks));

    // migration import inventory — review-only, provably
    const before = JSON.stringify((await call('GET', '/identity')).json?.data);
    await fetch(`${SB}/rest/v1/presence_sites?id=eq.${siteId}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ edition: 'monitor' }) });
    const inv = await call('GET', '/monitor/import-inventory');
    ok('integration: the import inventory reads the real external site', inv.status === 200 && inv.json?.data?.totals?.pages >= 1 && /Nothing has been imported/i.test(inv.json?.data?.note || ''));
    await fetch(`${SB}/rest/v1/presence_sites?id=eq.${siteId}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ edition: 'presence' }) });
    const after = JSON.stringify((await call('GET', '/identity')).json?.data);
    ok('integration: THE INVENTORY CHANGED NOTHING — content byte-identical', before === after);
  } finally {
    await fetch(`${SB}/rest/v1/presence_monitor_connections?site_id=eq.${siteId}`, { method: 'DELETE', headers: H });
    await fetch(`${SB}/rest/v1/presence_infra_plans?site_id=eq.${siteId}&kind=in.(dns_repair,domain_transfer_out,email_setup)`, { method: 'DELETE', headers: H });
    await fetch(`${SB}/rest/v1/presence_dns_zones?site_id=eq.${siteId}`, { method: 'DELETE', headers: H });
    await fetch(`${SB}/rest/v1/presence_dns_zone_history?site_id=eq.${siteId}`, { method: 'DELETE', headers: H });
    await fetch(`${SB}/rest/v1/presence_sites?id=eq.${siteId}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ edition: 'presence' }) });
  }
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ PLATFORM SERVICES (M14): ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
