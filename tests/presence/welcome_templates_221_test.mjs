// ── Builder list item 221: a welcome email, and updates kept as templates ─────
//   deno run --allow-read --allow-env --allow-net tests/presence/welcome_templates_221_test.mjs
// Part A, the welcome email's rules (lib/join_welcome.ts): on from the start in standard
// words, the owner's words kept (or the standard ones put back), the fill-ins filled and
// escaped. Part B, its card's routes (routes/list_welcome.ts) on a fake database: what the
// card reads, a save, a refusal said plainly, a test to the caller only that counts nothing,
// and the send after "Yes, add me" with the count it leaves. Part C, the studio's templates
// (lib/update_templates.ts, agency/update_templates.ts): what is kept and what stays behind,
// the list, one whole, keep, rename, remove, the roles, another studio's, the cap, and the
// days before migration 0221. The join itself is join_list_test's. Fake names only.
import { installFakePostgrest } from './fake_pgrst.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('APP_URL', 'https://app.example');
const db = installFakePostgrest();
const fake = globalThis.fetch;
const mail = [];
let missingTable = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.resend.com/emails')) { mail.push(JSON.parse(String(init.body))); return new Response('{"id":"e1"}', { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  if (u.includes('/rest/v1/rpc/rate_hit')) return new Response('true', { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('/rest/v1/presence_update_templates')) {
    if (missingTable) return new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    // the real PostgREST answers a DELETE with the rows it removed when asked to
    if ((init.method || 'GET').toUpperCase() === 'DELETE') {
      const before = [...(db.tables.presence_update_templates || [])];
      await fake(url, init);
      const after = new Set(db.tables.presence_update_templates || []);
      return new Response(JSON.stringify(before.filter((r) => !after.has(r))), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  }
  return fake(url, init);
};

const W = await import('../../supabase/functions/presence/lib/join_welcome.ts');
const R = await import('../../supabase/functions/presence/routes/list_welcome.ts');
const UT = await import('../../supabase/functions/presence/lib/update_templates.ts');
const { handleUpdateTemplates } = await import('../../supabase/functions/presence/agency/update_templates.ts');
const NOW = '2026-11-15T12:00:00.000Z';

// ═══ A · the welcome email's rules ═══
{
  const d = W.normalizeWelcome(null);
  ok('a site that never set it: on, in the standard words, nothing sent yet', d.enabled === true && d.subject === '' && d.body === '' && d.sent === 0 && W.welcomeWords(d).subject === W.WELCOME_SUBJECT && W.welcomeWords(d).body === W.WELCOME_BODY);
  ok('switched off stays off; a damaged count reads as none', W.normalizeWelcome({ enabled: false }).enabled === false && W.normalizeWelcome({ sent: -3 }).sent === 0 && W.normalizeWelcome({ sent: 'x' }).sent === 0);
  const cur = W.normalizeWelcome(null);
  ok('a save with nothing in it is refused, in words', W.applyWelcomeChange(cur, {}, 'a@b.example', NOW).ok === false);
  const off = W.applyWelcomeChange(cur, { enabled: false }, 'a@b.example', NOW);
  ok('switching it off keeps the words, and who and when', off.ok && off.setting.enabled === false && off.setting.updated_by === 'a@b.example' && off.setting.updated_at === NOW);
  const own = W.applyWelcomeChange(cur, { subject: '  Hello from {{business_name}} ', body: 'Hi {{first_name}},\n\nWelcome aboard.\n' }, 'a@b.example', NOW);
  ok('the owner’s own words are kept, tidied', own.ok && own.setting.subject === 'Hello from {{business_name}}' && own.setting.body === 'Hi {{first_name}},\n\nWelcome aboard.');
  ok('the standard words typed back are kept as “standard”, so they follow a later change', (() => { const r = W.applyWelcomeChange(cur, { subject: W.WELCOME_SUBJECT, body: W.WELCOME_BODY }, null, NOW); return r.ok && r.setting.subject === '' && r.setting.body === ''; })());
  ok('an empty subject or message is refused, saying how to go back', (() => { const a = W.applyWelcomeChange(cur, { subject: '  ' }, null, NOW), b = W.applyWelcomeChange(cur, { body: ' \n ' }, null, NOW); return !a.ok && /standard words/.test(a.message) && !b.ok && /standard words/.test(b.message); })());
  ok('a message over 4,000 characters is refused', !W.applyWelcomeChange(cur, { body: 'x'.repeat(W.WELCOME_BODY_MAX + 1) }, null, NOW).ok);
  const back = W.applyWelcomeChange(own.setting, { standard: true }, null, NOW);
  ok('“Use the standard words” puts both back', back.ok && back.setting.subject === '' && back.setting.body === '');
  const m = W.welcomeEmail(W.welcomeWords(cur), { businessName: 'Marlow <b>Kitchen</b>', accent: '#5b3fa0' });
  ok('the email: the business’s name filled in, and markup in it never becomes markup', m.subject === 'Welcome to Marlow bKitchen/b' && !m.html.includes('<b>Kitchen') && m.html.includes('Hi there,'), m.subject);
  const b = W.welcomeEmail({ subject: 'Hi', body: 'Come in!\n\n{{booking_link}}' }, { businessName: 'Marlow', bookingUrl: 'https://book.example/marlow', accent: '#5b3fa0' });
  ok('a booking line becomes the Book a time button, as in an update', /href="https:\/\/book\.example\/marlow"/.test(b.html) && /Book a time/.test(b.html));
}

// ═══ B · its card's routes, and the send after "Yes, add me" ═══
const SITE = { id: '5e000000-0000-4000-8000-000000000001', client_id: 'c1', status: 'live', last_published_at: NOW, template_slug: 't', template_version: '1', custom_domain: 'marlow.example', netlify_site_id: 'n1', edition: 'presence' };
const owner = { kind: 'client', userId: 'u1', email: 'owner@marlow.example' };
const seedSite = () => { mail.length = 0; db.reset({
  presence_sites: [SITE],
  presence_identity: [{ site_id: SITE.id, business_name: 'Marlow Kitchen', email: 'owner@marlow.example' }],
  presence_sales_templates: [],
}); };
const req = (method, body) => new Request('https://db.test/functions/v1/presence/broadcasts/welcome', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const answer = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
const stored = () => { const row = (db.tables.presence_sales_templates || []).find((r) => r.name === '__join_welcome__'); return row ? JSON.parse(row.body) : null; };
{
  seedSite();
  const g = await answer(await R.handleWelcomeGet(SITE, {}));
  ok('the card: on, the standard words to start from, and where a reply goes', g.status === 200 && g.body.data.enabled === true && g.body.data.words.subject === W.WELCOME_SUBJECT && g.body.data.standard.body === W.WELCOME_BODY && g.body.data.reply_to === 'owner@marlow.example', JSON.stringify(g.body));
  const nul = await answer(await R.handleWelcomePut(new Request('https://db.test/functions/v1/presence/broadcasts/welcome', { method: 'PUT', body: 'null' }), SITE, owner, {}));
  ok('a body of nothing at all is refused in words, not a crash', nul.status === 400 && /welcome email/.test(nul.body.message));
  const bad = await answer(await R.handleWelcomePut(req('PUT', { subject: '' }), SITE, owner, {}));
  ok('a refused save says why and keeps nothing', bad.status === 400 && /subject/.test(bad.body.message) && stored() === null);
  const saved = await answer(await R.handleWelcomePut(req('PUT', { subject: 'Welcome in, from {{business_name}}', body: 'Hi {{first_name}},\n\nGood to have you.' }), SITE, owner, {}));
  ok('a save keeps the words, says who, and answers with the card', saved.status === 200 && saved.body.data.subject === 'Welcome in, from {{business_name}}' && saved.body.data.words.body === 'Hi {{first_name}},\n\nGood to have you.' && stored()?.updated_by === 'owner@marlow.example');
  const t = await answer(await R.handleWelcomeTest(req('POST', { subject: 'Draft subject', body: 'Draft words, not saved yet.' }), SITE, owner, {}));
  const tm = mail[0] || {};
  ok('a test goes to the person asking, marked [Test], with the words as they are on the card', t.status === 200 && t.body.data.sent_to === 'owner@marlow.example' && mail.length === 1 && [].concat(tm.to)[0] === 'owner@marlow.example' && tm.subject === '[Test] Draft subject' && String(tm.html).includes('Draft words, not saved yet.'));
  ok('…and a test counts nothing', (stored()?.sent || 0) === 0);
  ok('a test for a sign-in with no email is refused, plainly', (await R.handleWelcomeTest(req('POST', {}), SITE, { kind: 'client', userId: 'u2', email: '' }, {})).status === 400);

  // the send after "Yes, add me"
  mail.length = 0;
  const r1 = await W.sendJoinWelcome(SITE.id, 'pat@customer.example', NOW);
  const wm = mail[0] || {};
  ok('a new joiner gets the welcome: the owner’s words, from the business', r1 === 'sent' && [].concat(wm.to)[0] === 'pat@customer.example' && wm.subject === 'Welcome in, from Marlow Kitchen' && String(wm.html).includes('Good to have you.') && /"Marlow Kitchen"/.test(String(wm.from)), JSON.stringify({ r1, subject: wm.subject, from: wm.from }));
  ok('…a reply reaches the owner’s own address (item 72)', wm.reply_to === 'owner@marlow.example', String(wm.reply_to));
  ok('…it is list mail: the one-click unsubscribe header, and a visible link', !!wm.headers?.['List-Unsubscribe'] && /Unsubscribe/.test(String(wm.text)));
  ok('…and the card’s count says so', stored()?.sent === 1 && stored()?.last_sent_at === NOW && stored()?.subject === 'Welcome in, from {{business_name}}');
  await answer(await R.handleWelcomePut(req('PUT', { enabled: false }), SITE, owner, {}));
  mail.length = 0;
  ok('switched off: nobody gets one', (await W.sendJoinWelcome(SITE.id, 'lee@customer.example', NOW)) === 'off' && mail.length === 0 && stored()?.sent === 1);
}

// ═══ C · updates kept as templates ═══
{
  const k = UT.templateFromUpdate({ subject: ' Spring offer at {{business_name}} ', body: 'Hi {{first_name}},\n\n![Our patio](media:11111111-2222-4333-8444-555555555555)\n\nThe patio is open.\n\n{{booking_link}}' });
  ok('kept: the subject and words with their fill-ins; the photo stays with the client', k.subject === 'Spring offer at {{business_name}}' && k.body === 'Hi {{first_name}},\n\nThe patio is open.\n\n{{booking_link}}' && k.photos_left === 1, JSON.stringify(k));
  ok('a name: one tidy line, at most 80 characters', UT.cleanTemplateName('  Spring\n  offer ') === 'Spring offer' && UT.cleanTemplateName('x'.repeat(90)).length === 80 && UT.cleanTemplateName('   ') === '');
  ok('the list shows the first words, cut at a word', UT.templatePreview('word '.repeat(60)).endsWith('…') && UT.templatePreview('Short.') === 'Short.');
}
const AG = 'aaaaaaaa-0000-4000-8000-000000000001', AG2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const CLIENT_SITE = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', OTHER_SITE = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', STUDIO_SITE = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';
const member = (over = {}) => ({ agency_id: AG, member_id: 'm1', email: 'sam@bright.example', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {}, ...over });
const deps = { ownSite: async () => ({ id: STUDIO_SITE }) };
const studio = async (method, route, body, m = member()) => {
  const r = new Request('https://db.test/functions/v1/presence' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handleUpdateTemplates(r, route, method, m, {}, deps);
  return res ? answer(res) : null;
};
const seedStudio = () => db.reset({
  presence_agency_clients: [{ agency_id: AG, site_id: CLIENT_SITE, status: 'active' }, { agency_id: AG2, site_id: OTHER_SITE, status: 'active' }],
  presence_identity: [{ site_id: CLIENT_SITE, business_name: 'Marlow Kitchen' }, { site_id: STUDIO_SITE, business_name: 'Bright Studio' }],
  presence_update_templates: [],
});
{
  seedStudio();
  ok('someone else’s route is left alone', (await studio('GET', '/agency/pages')) === null);
  const empty = await studio('GET', '/agency/update-templates');
  ok('none yet: an empty list, kept templates on, and who may keep them', empty.status === 200 && empty.body.data.length === 0 && empty.body.available === true && empty.body.can_manage === true);
  const kept = await studio('POST', '/agency/update-templates', { site_id: CLIENT_SITE, name: 'Spring offer', subject: 'Spring offer at {{business_name}}', body: 'Hi {{first_name}},\n\n![Patio](media:11111111-2222-4333-8444-555555555555)\n\nThe patio is open.' });
  ok('keep one from a client’s update: named, with the client it came from, the photo left behind', kept.status === 201 && kept.body.data.name === 'Spring offer' && kept.body.data.from_name === 'Marlow Kitchen' && kept.body.data.from_site === CLIENT_SITE && kept.body.photos_left === 1 && !('body' in kept.body.data), JSON.stringify(kept.body));
  const row = db.tables.presence_update_templates[0];
  ok('…stored for the studio, words and fill-ins as written, no photo', row.agency_id === AG && row.body === 'Hi {{first_name}},\n\nThe patio is open.' && row.created_by === 'sam@bright.example');
  const fromOwn = await studio('POST', '/agency/update-templates', { site_id: STUDIO_SITE, name: 'Holiday hours', subject: 'Our holiday hours', body: 'We’re closed on the 25th.' });
  ok('the studio’s own site can keep one too', fromOwn.status === 201 && fromOwn.body.data.from_name === 'Bright Studio');
  const theirs = await studio('POST', '/agency/update-templates', { site_id: OTHER_SITE, name: 'Not ours', subject: 'x', body: 'y' });
  ok('another studio’s client is not one of yours (404), and nothing is kept', theirs.status === 404 && db.tables.presence_update_templates.length === 2);
  ok('no name, no subject, or only a photo: refused, each in words', (await studio('POST', '/agency/update-templates', { site_id: CLIENT_SITE, name: ' ', subject: 's', body: 'b' })).body.error === 'bad_name'
    && (await studio('POST', '/agency/update-templates', { site_id: CLIENT_SITE, name: 'n', subject: '', body: 'b' })).body.error === 'bad_subject'
    && /photos stay with the client/.test((await studio('POST', '/agency/update-templates', { site_id: CLIENT_SITE, name: 'n', subject: 's', body: '![Patio](media:11111111-2222-4333-8444-555555555555)' })).body.message));
  const list = await studio('GET', '/agency/update-templates');
  ok('the list: newest first, with the first words, never every whole body', list.body.data.map((t) => t.name).join() === 'Holiday hours,Spring offer' && list.body.data[1].preview === 'Hi {{first_name}}, The patio is open.' && list.body.data.every((t) => !('body' in t)));
  const id = kept.body.data.id;
  const one = await studio('GET', `/agency/update-templates/${id}`);
  ok('one template whole, to start an update from', one.status === 200 && one.body.data.body === 'Hi {{first_name}},\n\nThe patio is open.' && one.body.data.subject === 'Spring offer at {{business_name}}');
  const elsewhere = await studio('GET', `/agency/update-templates/${id}`, undefined, member({ agency_id: AG2 }));
  ok('another studio can’t read it (404)', elsewhere.status === 404);
  const reader = member({ role: 'readonly' });
  ok('a view-only role reads the list but can’t keep, rename or remove (403)', (await studio('GET', '/agency/update-templates', undefined, reader)).status === 200
    && (await studio('POST', '/agency/update-templates', { site_id: CLIENT_SITE, name: 'n', subject: 's', body: 'b' }, reader)).status === 403
    && (await studio('PATCH', `/agency/update-templates/${id}`, { name: 'x' }, reader)).status === 403
    && (await studio('DELETE', `/agency/update-templates/${id}`, undefined, reader)).status === 403);
  const renamed = await studio('PATCH', `/agency/update-templates/${id}`, { name: '  Spring  offer, patio ' });
  ok('rename: tidied and kept', renamed.status === 200 && renamed.body.data.name === 'Spring offer, patio' && db.tables.presence_update_templates.find((t) => t.id === id).name === 'Spring offer, patio');
  ok('rename to nothing is refused', (await studio('PATCH', `/agency/update-templates/${id}`, { name: '' })).status === 400);
  ok('another studio can’t rename or remove it (404)', (await studio('PATCH', `/agency/update-templates/${id}`, { name: 'x' }, member({ agency_id: AG2 }))).status === 404 && (await studio('DELETE', `/agency/update-templates/${id}`, undefined, member({ agency_id: AG2 }))).status === 404 && db.tables.presence_update_templates.length === 2);
  const removed = await studio('DELETE', `/agency/update-templates/${id}`);
  ok('remove: gone from the list; a second remove says it isn’t there', removed.status === 200 && db.tables.presence_update_templates.length === 1 && (await studio('DELETE', `/agency/update-templates/${id}`)).status === 404);
  // the cap
  db.tables.presence_update_templates = Array.from({ length: UT.MAX_UPDATE_TEMPLATES }, (_, i) => ({ id: crypto.randomUUID(), agency_id: AG, name: `T${i}`, subject: 's', body: 'b', created_at: NOW }));
  const full = await studio('POST', '/agency/update-templates', { site_id: CLIENT_SITE, name: 'One more', subject: 's', body: 'b' });
  ok(`a studio keeps up to ${UT.MAX_UPDATE_TEMPLATES}, and the next says so`, full.status === 422 && /Remove one first/.test(full.body.message));
  // before migration 0221
  missingTable = true;
  const before = await studio('GET', '/agency/update-templates');
  const keepBefore = await studio('POST', '/agency/update-templates', { site_id: CLIENT_SITE, name: 'n', subject: 's', body: 'b' });
  missingTable = false;
  ok('before the database step: an empty list that says so, and keeping says it isn’t switched on (503)', before.status === 200 && before.body.available === false && before.body.data.length === 0 && keepBefore.status === 503 && /aren’t switched on yet/.test(keepBefore.body.message));
}

// ═══ D · wiring ═══
{
  const ROOT = new URL('../../', import.meta.url);
  const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
  const idx = read('supabase/functions/presence/index.ts'), ag = read('supabase/functions/presence/agency/routes.ts'), com = read('supabase/functions/presence/routes/commercial.ts');
  ok('the card’s three routes are wired, before the update routes that take an id', idx.indexOf("route === '/broadcasts/welcome' && method === 'PUT'") > 0 && idx.indexOf("route === '/broadcasts/welcome/test'") < idx.indexOf('/^\\/broadcasts\\/([0-9a-f-]{36})$/'));
  ok('the templates are a studio route, after saved pages', ag.indexOf('handleUpdateTemplates(req, route, method, member, cors') > ag.indexOf('handleSavedPages(req, route, method, member, cors'));
  ok('“Yes, add me” sends the welcome only from the press that adds them', /if \(ins\.ok && ins\.json\?\.\[0\]\) return await welcomed\(\);/.test(com) && com.includes('&subscribed_at=is.null&select=id') && /return Array\.isArray\(w\.json\) && w\.json\.length \? await welcomed\(\) : joined\(\);/.test(com));
  const mig = read('supabase/migrations/0221_update_templates.sql'), pack = read('docs/presence/APPLY-0221-prod.sql');
  ok('migration 0221: one table, RLS on, nothing granted, safe to run twice; the pack carries the same and a check', [mig, pack].every((s) => s.includes('create table if not exists public.presence_update_templates') && s.includes('enable row level security') && s.includes('revoke all on public.presence_update_templates from anon, authenticated')) && pack.includes('-- Check'));
  ok('0221 is the only migration with that number', [...Deno.readDirSync(new URL('supabase/migrations/', ROOT))].filter((e) => e.name.startsWith('0221_')).length === 1);
}

const passed = results.filter(Boolean).length;
console.log(`\n════ WELCOME EMAIL AND TEMPLATES (item 221): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
