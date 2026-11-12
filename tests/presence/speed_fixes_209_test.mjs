// ── Builder list item 209: smaller speed fixes (review file 06, findings 63, 82, 85, 86, 88) ──
//   · the unfinished-sections count is kept on the site; the bell reads it instead of
//     rebuilding the draft, works it out again only after a change, and never keeps one
//     that a change overtook
//   · Home reads each site's own latest change, so a quiet site never drops out
//   · scheduled jobs read a page at a time in a set order, and go past the first page
//   · a project template writes in two batches; the visit counter's two limits in one call
//   · migration 0206: two indexes, the two columns, the trigger, the pack the same
//
//   deno run --allow-read --allow-env --allow-net tests/presence/speed_fixes_209_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';

Deno.env.delete('RESEND_API_KEY');
Deno.env.delete('OPS_ALERT_EMAIL');
const db = installFakePostgrest();
const pg = globalThis.fetch;

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = () => {}; console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };
const hex = (k, i) => `${k}${i.toString(16).padStart(7, '0')}-0000-4000-8000-000000000000`;

const { unfinishedOf, unfinishedSectionsOf } = await import('../../supabase/functions/presence/lib/unfinished.ts');
const { svcPaged } = await import('../../supabase/functions/presence/lib/db.ts');
const { rateAllowBoth } = await import('../../supabase/functions/presence/lib/ratelimit.ts');
const { gather } = await import('../../supabase/functions/presence/agency/routes.ts');
const { runInvoiceReminders, INVOICE_PAGE } = await import('../../supabase/functions/presence/commerce/lifecycle.ts');
const { handleProjects } = await import('../../supabase/functions/presence/routes/projects.ts');
const { getTemplate } = await import('../../supabase/functions/presence/lib/render.ts');

const SITE = hex('a', 1);
const site = { id: SITE, client_id: 'client-a', status: 'ready', last_published_at: null, template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence' };
const hours = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({ day, closed: false, intervals: [{ open: '09:00', close: '17:00' }] }));
function seedDraft({ name = 'Sample Cafe', unfinished = null, lastChange = '2026-11-12T08:00:00.123456+00:00' } = {}) {
  db.reset({
    presence_sites: [{ ...site, unfinished_sections: unfinished, last_change_at: lastChange }],
    presence_identity: [{ site_id: SITE, business_name: name, description: name ? 'A cafe.' : '', phone: '555', email: '' }],
    presence_locations: [{ id: hex('f', 1), site_id: SITE, address_line1: '1 Main St', city: 'Town', region: 'CA', postal_code: '90000', country: 'US', timezone: 'America/Los_Angeles', hours, holiday_exceptions: [], created_at: '2026-01-01T00:00:00Z' }],
    presence_offerings: [], presence_testimonials: [], presence_faqs: [], presence_posts: [], presence_media: [], presence_redirects: [], presence_settings: [{ site_id: SITE, blocks: [], pages: [] }], presence_dev_customizations: [], presence_reviews: [], presence_content_library: [],
  });
}
const draftReads = () => db.log.filter((c) => c.method === 'GET' && c.url.startsWith('/rest/v1/presence_identity')).length;

// ═══ 1. the unfinished-sections count ═══
{
  const T = getTemplate('restaurant-classic', '1.0.0');
  const snap = (identity, locations) => ({ content: { identity, locations, settings: {}, offerings: [], testimonials: [], faqs: [], posts: [], redirects: [] }, content_contract_version: 1, template_slug: 'restaurant-classic', template_version: '1.0.0', created_at: '2026-11-12T00:00:00Z' });
  const full = { business_name: 'Cafe', description: 'A cafe.', phone: '555' };
  const loc = { address_line1: '1 Main St', city: 'Town', region: 'CA', postal_code: '90000', country: 'US', timezone: 'America/Los_Angeles', hours };
  ok('count: a finished draft has none', unfinishedOf(T.manifest, snap(full, [loc])) === 0);
  const n = unfinishedOf(T.manifest, snap({ business_name: '', description: '' }, []));
  ok('count: missing details and no address make sections to fill in', n >= 2, String(n));

  seedDraft({ unfinished: 3 });
  db.log = [];
  ok('kept: a kept count is read as it is, with no draft rebuilt', (await quiet(() => unfinishedSectionsOf(site))) === 3 && draftReads() === 0);

  seedDraft({ name: '', unfinished: null });
  db.log = [];
  const worked = await quiet(() => unfinishedSectionsOf(site));
  const kept = db.tables.presence_sites[0].unfinished_sections;
  const save = db.log.find((c) => c.method === 'PATCH' && c.url.startsWith('/rest/v1/presence_sites'));
  ok('worked out: after a change it is counted once from the draft, and kept', worked >= 1 && kept === worked && draftReads() === 1, `${worked} ${kept}`);
  ok('worked out: kept only if the site’s latest change didn’t move meanwhile', !!save && save.url.includes('last_change_at=eq.2026-11-12T08:00:00.123456+00:00') && save.url.includes('unfinished_sections=is.null'), save?.url);
  db.log = [];
  ok('worked out: the next read takes the kept count', (await quiet(() => unfinishedSectionsOf(site))) === worked && draftReads() === 0);

  // a change lands while it is being worked out: the stale count is never kept
  seedDraft({ name: '', unfinished: null });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/rest/v1/presence_identity') db.tables.presence_sites[0].last_change_at = '2026-11-12T09:00:00+00:00';   // someone saved
    return realFetch(url, init);
  };
  await quiet(() => unfinishedSectionsOf(site));
  globalThis.fetch = realFetch;
  ok('race: a change during the count leaves it empty, to be counted again', db.tables.presence_sites[0].unfinished_sections === null);

  // before 0206: the columns are refused; counted every time, nothing kept
  seedDraft({ name: '' });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/rest/v1/presence_sites' && /unfinished_sections/.test(decodeURIComponent(u.search) + String(init.body || ''))) return new Response(JSON.stringify({ code: '42703', message: 'column presence_sites.unfinished_sections does not exist' }), { status: 400 });
    return realFetch(url, init);
  };
  db.log = [];
  const before = await quiet(() => unfinishedSectionsOf(site));
  globalThis.fetch = realFetch;
  ok('before 0206: still counted, and nothing written', before >= 1 && !db.log.some((c) => c.method === 'PATCH'));

  const ws = read('supabase/functions/presence/routes/workspace.ts');
  ok('the bell, Inbox and Today read the kept count, not the whole Content Tree', /const unfinishedP: Promise<number \| null> = seesFull \? unfinishedSectionsOf\(site\)/.test(ws) && !/siteContentTree/.test(ws));
}

// ═══ 2. Home: each site's own latest change ═══
{
  const AG = hex('0', 1);
  const sites = [1, 2, 3].map((i) => hex('5', i));
  const base = () => ({
    presence_agency_clients: sites.map((s) => ({ agency_id: AG, site_id: s, status: 'active' })),
    presence_sites: sites.map((s, i) => ({ id: s, client_id: `c${i}`, edition: 'presence', status: 'live', last_published_at: '2026-11-10T00:00:00Z', last_change_at: i === 2 ? '2026-11-11T00:00:00Z' : '2026-11-01T00:00:00Z' })),
    // 1,200 changes on the busy site, all newer than the quiet one's
    presence_change_events: Array.from({ length: 1200 }, (_, i) => ({ site_id: sites[0], entity_type: 'settings', created_at: new Date(Date.parse('2026-11-11T00:00:00Z') + i * 1000).toISOString() })),
    clients: [], presence_entitlements: [],
  });
  db.reset(base());
  const g = await quiet(() => gather(AG, '2026-11-12T00:00:00Z'));
  ok('Home: each site’s latest change is its own, the quiet one included', g.lastChange[sites[2]] === '2026-11-11T00:00:00Z' && g.lastChange[sites[0]] === '2026-11-01T00:00:00Z', JSON.stringify(g.lastChange));
  ok('Home: the change history isn’t read at all', !db.log.some((c) => c.url.startsWith('/rest/v1/presence_change_events')));
  // before 0206 the column is refused: read as before
  db.reset(base());
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/rest/v1/presence_sites' && /last_change_at/.test(decodeURIComponent(u.search))) return new Response(JSON.stringify({ code: '42703', message: 'no column' }), { status: 400 });
    return realFetch(url, init);
  };
  const old = await quiet(() => gather(AG, '2026-11-12T00:00:00Z'));
  globalThis.fetch = realFetch;
  ok('Home before 0206: the sites still load, and changes are read as before', old.sites.length === 3 && !!old.lastChange[sites[0]] && db.log.some((c) => c.url.startsWith('/rest/v1/presence_change_events')));
  const coach = read('supabase/functions/presence/routes/coach.ts');
  ok('the coach reads the site’s own latest change, the history only before 0206', /presence_sites\?id=eq\.\$\{site\.id\}&select=domain_expires_at,last_change_at&limit=1/.test(coach) && /if \(!meta0\.ok\)/.test(coach));
}

// ═══ 3. scheduled jobs: a page at a time, in a set order ═══
{
  db.reset({ presence_sales_templates: Array.from({ length: 250 }, (_, i) => ({ id: hex('6', i), site_id: hex('7', 249 - i), kind: 'proposal', name: 'x', deleted_at: null })) });
  const pages = [];
  for await (const p of svcPaged('presence_sales_templates?kind=eq.proposal&select=site_id', 'site_id.asc', 100)) pages.push(p);
  const flat = pages.flat().map((r) => r.site_id);
  ok('pages: every row, a page at a time, in the set order', pages.map((p) => p.length).join() === '100,100,50' && flat.length === 250 && flat.every((v, i) => !i || flat[i - 1] < v));
  db.log = [];
  for await (const p of svcPaged('presence_sales_templates?kind=eq.proposal&select=site_id', 'site_id.asc', 100)) { if (p) break; }
  ok('pages: a job that has done enough stops reading', db.log.filter((c) => c.method === 'GET').length === 1);
  db.fail.add('presence_sales_templates');
  const none = [];
  for await (const p of svcPaged('presence_sales_templates?select=site_id', 'site_id.asc', 100)) none.push(p);
  ok('pages: a failed read ends the walk', none.length === 0);

  const mr = read('supabase/functions/presence/ops/monthly_report.ts');
  const ai = read('supabase/functions/presence/ops/ai_checks.ts');
  ok('monthly reports: every client with it on, by site, a page at a time', /for await \(const page of svcPaged\(`presence_sales_templates\?kind=eq\.proposal[^`]*`, 'site_id\.asc', REPORT_PAGE, REPORT_PAGES\)\)/.test(mr) && !/limit=\$\{Math\.max\(1, Math\.min\(200, limit \* 5\)\)\}/.test(mr));
  ok('AI checks: the same, never one read of 500 in no order', /for await \(const page of svcPaged\(`presence_sales_templates\?kind=eq\.proposal[^`]*`, 'site_id\.asc', AI_PAGE, AI_PAGES\)\)/.test(ai) && !/select=site_id,body&limit=500/.test(ai));
}
// invoice reminders reach past the first page
{
  const OFF = 230, ON = 3;
  const day = (n) => new Date(Date.parse('2026-09-01T00:00:00Z') + n * 60_000).toISOString();
  const inv = (i, siteId) => ({ id: hex('8', i), site_id: siteId, deal_id: null, title: `Invoice ${i}`, amount_cents: 1000, purpose: 'invoice', stripe_url: 'https://pay.example/x', due_date: '2026-10-01', created_at: day(i), first_sent_at: day(i), status: 'open', deleted_at: null, payment_for: null, processing_since: null, link_gen: 0 });
  const offSite = hex('9', 1), onSites = [0, 1, 2].map((i) => hex('9', 10 + i));
  db.reset({
    presence_invoices: [...Array.from({ length: OFF }, (_, i) => inv(i, offSite)), ...onSites.map((s, k) => inv(OFF + k, s))],
    presence_settings: [{ site_id: offSite, invoice_reminders: false }, ...onSites.map((s) => ({ site_id: s, invoice_reminders: true, invoice_remind_after_days: 7 }))],
    presence_sites: [offSite, ...onSites].map((id, i) => ({ id, client_id: `cl${i}` })),
    presence_plan_notices: [],
  });
  const r = await quiet(() => runInvoiceReminders(20));
  const claims = db.tables.presence_plan_notices.filter((n) => onSites.includes(n.site_id));
  ok(`invoice reminders: invoices past the first ${INVOICE_PAGE} are reached`, OFF > INVOICE_PAGE && r.reminded === ON && claims.length === ON, `${r.reminded} ${claims.length}`);
  const reads = db.log.filter((c) => c.method === 'GET' && c.url.startsWith('/rest/v1/presence_invoices'));
  ok('invoice reminders: oldest first, in a set order, a page at a time', reads.length === 2 && reads.every((c) => c.url.includes('order=created_at.asc,id.asc') && c.url.includes(`limit=${INVOICE_PAGE}`)), reads.map((c) => c.url.slice(-60)).join(' | '));
}

// ═══ 4. small writes batched ═══
{
  db.reset({ presence_projects: [], presence_milestones: [], presence_tasks: [], presence_project_events: [] });
  const res = await quiet(() => handleProjects(new Request('http://x/projects', { method: 'POST', body: JSON.stringify({ name: 'New site', template: 'website', start_date: '2026-11-12' }) }), 'jwt', site, { kind: 'staff', userId: 'u1', email: 'eric@example.com' }, {}));
  const ms = db.tables.presence_milestones, ts = db.tables.presence_tasks;
  const writes = (t) => db.writes(t).filter((c) => c.method === 'POST');
  ok('template: two writes, the milestones and then the steps', res.status === 201 && writes('presence_milestones').length === 1 && writes('presence_tasks').length === 1 && ms.length >= 3 && ts.length >= 6, `${res.status} ${writes('presence_milestones').length} ${writes('presence_tasks').length}`);
  const byMs = new Map(ms.map((m) => [m.id, m.sort_order]));
  ok('template: every step sits under its own milestone, in order', ts.every((t) => byMs.has(t.milestone_id)) && ts.map((t) => t.sort_order).every((v, i, a) => !i || a[i - 1] < v) && ts.filter((t) => t.milestone_id === ms.find((m) => m.sort_order === 0).id).length === 3);
  // a batch the database refuses goes again row by row
  db.reset({ presence_projects: [], presence_milestones: [], presence_tasks: [], presence_project_events: [] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/rest/v1/presence_tasks' && String(init.body || '').startsWith('[')) return new Response(JSON.stringify({ message: 'too big' }), { status: 400 });
    return realFetch(url, init);
  };
  await quiet(() => handleProjects(new Request('http://x/projects', { method: 'POST', body: JSON.stringify({ name: 'New site', template: 'website' }) }), 'jwt', site, { kind: 'staff', userId: 'u1' }, {}));
  globalThis.fetch = realFetch;
  ok('template: a refused batch is written row by row, nothing lost', db.tables.presence_tasks.length >= 6 && db.tables.presence_tasks.every((t) => t.milestone_id));
}
{
  const calls = [];
  let hasBoth = true, firstOver = false;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const b = JSON.parse(String(init.body || '{}'));
    calls.push(u.pathname.split('/').pop() + ':' + (b.p_bucket || b.p_first || ''));
    if (u.pathname.endsWith('/rpc/rate_hit_both')) return hasBoth ? new Response('true', { status: 200 }) : new Response(JSON.stringify({ code: 'PGRST202' }), { status: 404 });
    if (u.pathname.endsWith('/rpc/rate_hit')) return new Response(b.p_bucket.startsWith('px:ip') && firstOver ? 'false' : 'true', { status: 200 });
    return pg(url, init);
  };
  const A = { bucket: 'px:ip:1.2.3.4', max: 120 }, B = { bucket: 'px:site:s', max: 1200 };
  ok('visit limits: one call for both', (await rateAllowBoth(A, B, 60)) === true && calls.join() === 'rate_hit_both:px:ip:1.2.3.4', calls.join());
  calls.length = 0; hasBoth = false;
  ok('visit limits before 0206: the two calls, as before', (await rateAllowBoth(A, B, 60)) === true && calls.join() === 'rate_hit_both:px:ip:1.2.3.4,rate_hit:px:ip:1.2.3.4,rate_hit:px:site:s', calls.join());
  calls.length = 0; firstOver = true;
  ok('visit limits before 0206: a visitor over its limit never counts against the site', (await rateAllowBoth(A, B, 60)) === false && !calls.some((c) => c.includes('px:site')), calls.join());
  globalThis.fetch = pg;
  ok('the counter uses it', /rateAllowBoth\(\{ bucket: `px:ip:\$\{ip\}`, max: 120 \}, \{ bucket: `px:site:\$\{siteId\}`, max: 1200 \}, 60\)/.test(read('supabase/functions/presence/routes/collect.ts')));
}

// ═══ 5. migration 0206 and its pack ═══
{
  const mig = read('supabase/migrations/0206_speed_fixes.sql');
  const pack = read('docs/presence/APPLY-0206-prod.sql');
  ok('0206: the two indexes, matching the two reads', /create index if not exists presence_moments_site_time_idx\s+on public\.presence_moments \(site_id, created_at desc\);/.test(mig) && /create index if not exists presence_evidence_type_time_idx\s+on public\.presence_evidence \(type, observed_at desc\);/.test(mig));
  ok('0206: the reads they serve are the ones in the code', /presence_moments\?site_id=eq\.\$\{site\.id\}&select=[^&]+&order=created_at\.desc/.test(read('supabase/functions/presence/moments/engine.ts')) && /presence_evidence\?type=in\.\([^)]*\)&observed_at=gte\./.test(read('supabase/functions/presence/commerce/lifecycle.ts')));
  ok('0206: the trigger leaves out publishes and restores, and empties the count', /if new\.entity_type in \('publish', 'restore'\) then return new; end if;/.test(mig) && /unfinished_sections = null/.test(mig) && /after insert on public\.presence_change_events/.test(mig));
  const body = (s) => s.slice(s.indexOf('create index if not exists presence_moments_site_time_idx')).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();
  ok('0206: the pack runs exactly the migration', body(pack) === body(mig), `${body(pack).length} vs ${body(mig).length}`);
  ok('0206: the pack says how long each index takes', /136,901 rows/.test(pack) && /about 7 seconds/.test(pack) && /under a second/.test(pack));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
