// ── Sales item 105: the setup strip on Home (Nov 2026) ────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/setup_strip_105_test.mjs
// The steps a studio sets up once, each checked against the real thing; the strip goes
// by itself once all are done, and Hide puts it away for the studio. A step whose check
// can't be read is left off, and a hide that can't be read never brings the strip back.
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222';
const db = installFakePostgrest();
const L = await import('../../supabase/functions/presence/lib/setup_strip.ts');
const R = await import('../../supabase/functions/presence/routes/setup_strip.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}`);

// ═══ 1. pure ═══
const steps = L.setupSteps({ business: true, logo: false, services: null, contact: false, deal: true });
eq('the steps in order, a step that couldn\'t be checked left off', steps.map((s) => [s.key, s.done]), [['business', true], ['logo', false], ['contact', false], ['deal', true]]);
ok('each step has one place to do it', steps.every((s) => s.href.startsWith('/') && s.act && s.title && s.why));
ok('the strip shows while something is left and nobody hid it', L.setupShows(steps, false) && !L.setupShows(steps, true));
ok('it goes by itself once everything is done', !L.setupShows(L.setupSteps({ business: true, logo: true, services: true, contact: true, deal: true }), false));
ok('nothing checkable, nothing shown', !L.setupShows(L.setupSteps({}), false));
eq('the stored choice', [L.setupHidden({ hidden: true }), L.setupHidden({ hidden: false }), L.setupHidden(null), L.setupHidden('yes')], [true, false, false, false]);

// ═══ 2. the route ═══
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: 'u1', email: 'owner@studio.test', jwt: 'jwt', requestId: 't' };
const cors = {};
const world = () => ({
  presence_identity: [{ site_id: SITE, business_name: 'Brightline Studio', email: 'hello@studio.test', service_area: 'Burbank, CA' }],
  presence_locations: [{ site_id: SITE, address_line1: '12 Main St', city: 'Burbank' }],
  presence_settings: [{ site_id: SITE, brand_kit: {}, logo_media_id: null, signs_as_name: 'Pat Example' }],
  presence_sales_templates: [{ id: 'svc', site_id: SITE, kind: 'proposal', name: '__services_catalog__', line_items: [{ label: 'Website build', qty: 1, unit_cents: 300000 }], deleted_at: null, updated_at: '2026-11-01T00:00:00Z' }],
  presence_contacts: [],
  presence_deals: [{ id: 'd1', site_id: SITE, deleted_at: null }, { id: 'd2', site_id: '99999999-9999-4999-8999-999999999999', deleted_at: null }],
});
const get = async () => { const r = await R.handleSetupStrip(new Request('https://fn.test/functions/v1/presence/sales/setup'), site, owner, cors); return { status: r.status, d: (await r.json()).data }; };
const post = async (b) => { const r = await R.handleSetupStrip(new Request('https://fn.test/functions/v1/presence/sales/setup', { method: 'POST', body: JSON.stringify(b) }), site, owner, cors); return { status: r.status, body: await r.json() }; };
db.reset(world());
let r = await get();
eq('route: each step checked against the real thing', r.d.steps.map((s) => [s.key, s.done]), [['business', true], ['logo', false], ['services', true], ['contact', false], ['deal', true], ['goal', false], ['ai', false]]);   // sales item 209: AI help is off
ok('route: it shows, with its count', r.d.shows === true && r.d.hidden === false && r.d.done === 3 && r.d.total === 7);
ok('route: every read is this studio\'s own', db.log.filter((c) => c.method !== 'POST').every((c) => c.url.includes(`site_id=eq.${SITE}`)));
let w = await post({ hidden: true });
const kept = (db.tables.presence_sales_templates || []).filter((t) => t.name === '__setup_strip__' && t.site_id === SITE);
ok('route: Hide is kept for the studio, in one reserved row', w.status === 200 && w.body.data.hidden === true && kept.length === 1 && JSON.parse(kept[0].body).hidden === true && JSON.parse(kept[0].body).by === 'owner@studio.test', JSON.stringify(kept));
r = await get();
ok('route: once hidden it stays away', r.d.hidden === true && r.d.shows === false);
w = await post({ hidden: false });
r = await get();
ok('route: Undo brings it back', w.status === 200 && r.d.shows === true);
w = await post({ hidden: 'please' });
ok('route: a choice that isn\'t one is a 422', w.status === 422);
db.reset(world()); db.fail.add('presence_contacts');
r = await get();
ok('route: a check that couldn\'t be read leaves its step off, never "not done"', !r.d.steps.some((s) => s.key === 'contact') && r.d.total === 6);
db.reset(world()); db.tables.presence_contacts = [{ id: 'c1', site_id: SITE, deleted_at: null }]; db.tables.presence_settings = [{ site_id: SITE, brand_kit: { logo_media_id: 'm1' }, logo_media_id: null, signs_as_name: 'Pat Example' }];
r = await get();
ok('route: the month\'s goal and AI help are the steps left (sales items 94, 209)', r.d.done === 5 && r.d.total === 7 && r.d.shows === true && r.d.steps.find((s) => s.key === 'goal')?.href === '/settings.html#goal');
db.tables.presence_sales_templates.push({ id: 'goal', site_id: SITE, kind: 'proposal', name: '__sales_goal_ai__', body: JSON.stringify({ goal_cents: 800000, ai_on: true }), deleted_at: null, updated_at: '2026-11-02T00:00:00Z' });
r = await get();
ok('route: everything done, the strip goes by itself', r.d.done === 7 && r.d.shows === false);
db.reset(world()); db.failMethod.set('presence_sales_templates', 'GET');
r = await get();
ok('route: a hide that can\'t be read never brings the strip back', r.d.hidden === true && r.d.shows === false);

// ═══ sales item 195: "Your business details" ticks only when the Studio profile boxes it names are filled ═══
const B = (i, s, okRead = true) => L.businessDetailsDone(i, s, okRead);
const full = { business_name: 'Brightline Studio', email: 'hello@studio.test', service_area: 'Burbank, CA' };
eq('195: all four boxes, or not done; an unread row leaves the step off', [B(full, { signs_as_name: 'Pat' }), B({ ...full, email: '' }, { signs_as_name: 'Pat' }), B({ ...full, service_area: '  ' }, { signs_as_name: 'Pat' }), B(full, { signs_as_name: '' }), B({ ...full, business_name: '' }, { signs_as_name: 'Pat' }), B(full, null, false)], [true, false, false, false, false, null]);
ok('195: the step names the boxes it checks and opens their page', (() => { const s = L.SETUP_STEPS.find((x) => x.key === 'business'); return s.why === 'Studio name, email, where you work from and who signs your agreements' && s.href === '/settings.html#studio'; })());
db.reset(world()); db.tables.presence_identity = [{ site_id: SITE, business_name: 'Brightline Studio', email: '', service_area: '' }];
r = await get();
ok('195 route: blank email and "Where you work from" keep it open, an address on a location no longer ticks it', r.d.steps.find((s) => s.key === 'business')?.done === false, JSON.stringify(r.d.steps));
db.reset(world()); db.tables.presence_settings = [{ site_id: SITE, brand_kit: {}, logo_media_id: null, signs_as_name: '' }];
r = await get();
ok('195 route: nobody named to sign agreements, not done', r.d.steps.find((s) => s.key === 'business')?.done === false);
db.reset(world()); db.fail.add('presence_settings');
r = await get();
ok('195 route: the settings row unread, the step is left off rather than ticked', !r.d.steps.some((s) => s.key === 'business'));
ok('195 route: the check reads the boxes the step names', db.log.some((c) => c.url.includes('presence_identity') && c.url.includes('select=business_name,email,service_area')));

// ═══ sales item 209: the switches that make it work for you ═══
{
  const tok = (claims) => 'h.' + btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') + '.s';
  const getAs = async (jwt) => { const q = await R.handleSetupStrip(new Request('https://fn.test/functions/v1/presence/sales/setup'), site, { ...owner, jwt }, cors); return (await q.json()).data; };
  const step = (d, k) => d.steps.find((x) => x.key === k);
  db.reset(world()); db.tables.presence_settings = [{ site_id: SITE, brand_kit: {}, logo_media_id: null, signs_as_name: 'Pat Example', enquiry_followups: false }];
  let d = await getAs(tok({ aal: 'aal1' }));
  ok('209: the follow-ups are a step until switched on, and it opens Settings › Automations', step(d, 'followups')?.done === false && step(d, 'followups')?.href === '/settings.html#automations' && step(d, 'followups')?.title === 'Turn on your follow-ups');
  ok('209: AI help is a step while off, with what it costs', step(d, 'ai')?.done === false && /1 cent a press/.test(step(d, 'ai')?.why || '') && step(d, 'ai')?.href === '/settings.html#goal');
  ok('209: a sign-in without two-step is a step, and it opens Sign-in and security', step(d, 'twostep')?.done === false && step(d, 'twostep')?.href === '/settings.html#security' && step(d, 'twostep')?.title === 'Add two-step sign-in');
  db.tables.presence_settings[0].enquiry_followups = true;
  db.tables.presence_sales_templates.push({ id: 'goal', site_id: SITE, kind: 'proposal', name: '__sales_goal_ai__', body: JSON.stringify({ ai_on: true }), deleted_at: null, updated_at: '2026-11-02T00:00:00Z' });
  d = await getAs(tok({ aal: 'aal2' }));
  ok('209: each is ticked by the real thing (the switch on, AI help on, a two-step sign-in)', step(d, 'followups')?.done === true && step(d, 'ai')?.done === true && step(d, 'twostep')?.done === true);
  d = await getAs('not-a-token');
  ok('209: a sign-in that can\'t be read leaves the two-step step off, never "not done"', !step(d, 'twostep'));
  db.reset(world());
  d = await getAs(tok({ aal: 'aal1' }));
  ok('209: a settings row without the switch leaves the follow-ups step off', !step(d, 'followups'));
  ok('209: the words people read have no dashes standing in for commas', ['followups', 'ai', 'twostep'].every((k) => { const x = L.SETUP_STEPS.find((y) => y.key === k); return x && !/[—–]/.test(x.title + x.why + x.act); }));
}

// ═══ 3. Home draws it ═══
const home = Deno.readTextFileSync(new URL('../../agency.html', import.meta.url));
ok('agency.html: the strip sits under the greeting, for those who may change settings', /<div id="top"><\/div>\s*<!--[^>]*-->\s*<section id="setup" class="setup"[^>]*data-needs="configure"/.test(home));
ok('agency.html: each paint says whether the strip shows (dds:setup), for the greeting that points at it', /dispatchEvent\(new CustomEvent\('dds:setup',\{detail:\{shows:shows\}\}\)\)/.test(home) && /said\(true\)/.test(home) && /said\(false\);return;/.test(home));
ok('agency.html: Hide asks the server, and Undo puts it back', home.includes("apiSend('POST','/sales/setup',{hidden})") && /label:'Undo',onClick:\(\)=>setSetupHidden\(false\)/.test(home));

console.log(`\n════ SALES ITEM 105 (setup strip): ${pass}/${pass + fail} PASSED ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
