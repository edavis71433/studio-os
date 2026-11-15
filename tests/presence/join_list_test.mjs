// ── Builder list item 146: a "Join our list" box that fills the site's own list ──
//   deno run --allow-read --allow-env --allow-net tests/presence/join_list_test.mjs
// Part A: the Newsletter section collects the email itself (the default, and any old box
// left without a link), or links out as before; the box is labelled, asks for a yes, and
// rides the page's sender. Part B drives the form route on a fake database: joining sends
// a "Yes, add me" email (item 203), and pressing it makes (or marks) a contact with when and
// what they agreed to, once; a missing yes or a bad address is said plainly; a robot is
// thanked and nothing kept or sent. Part C: Send an update's
// "People who joined your list" reaches exactly them. Part D: the editor's two choices,
// the database step, and the forward guard the hostile drawing pass asked for.
import { installFakePostgrest } from './fake_pgrst.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const SID = '5e000000-0000-4000-8000-000000000001';
const OTHER = '5e000000-0000-4000-8000-000000000002';
Deno.env.set('APPROVAL_SECRET', 'test-approval-secret');
Deno.env.set('RESEND_KEY', 'test-resend-key');
const db = installFakePostgrest();
const fake = globalThis.fetch;
const mail = [];   // item 203: the "Yes, add me" emails
let otherTab = null;   // the same person's other tab saves them just before this insert; the database's unique rule refuses it
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('/rest/v1/rpc/rate_hit')) return new Response('true', { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://api.resend.com/emails')) { mail.push(JSON.parse(String(init.body))); return new Response('{"id":"e1"}', { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  if (otherTab && (init.method || 'GET') === 'POST' && u.includes('/rest/v1/presence_contacts') && JSON.parse(String(init.body)).email === otherTab.email) {
    db.tables.presence_contacts.push(otherTab); otherTab = null;
    return new Response(JSON.stringify({ code: '23505' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }
  return fake(url, init);
};

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const { validateBlocks, renderSiteBlocks } = await import('../../supabase/functions/presence/lib/site_blocks.ts');
const { esc, attr, safeHref, safeRedirectTo } = await import('../../supabase/functions/presence/lib/markdown.ts');
const { SIGNUP_CONSENT, signupForm, senderTag } = await import('../../supabase/functions/presence/lib/site_send.ts');
const { renderSnapshot } = await import('../../supabase/functions/presence/lib/render.ts');
const { fullFixture, PAGE } = await import('./full_fixture.mjs');
const { handleFormSubmit, handleJoinPost, JOINED, JOIN_CHECK_EMAIL } = await import('../../supabase/functions/presence/routes/commercial.ts');
const { issueTicket, startCheckingSends } = await import('../../supabase/functions/presence/lib/form_check.ts');
const { SEGMENTS, fetchAudienceRows, audienceCount } = await import('../../supabase/functions/presence/lib/broadcast.ts');
const { handleBroadcastSegments } = await import('../../supabase/functions/presence/routes/broadcasts.ts');
const { visitorCors } = await import('../../supabase/functions/_shared/cors.ts');

// ═══ A · the section ═══
const one = (b) => validateBlocks([b])[0];
ok('a new box (no link) collects here', JSON.stringify(one({ type: 'newsletter', title: 'News', url: '' })) === JSON.stringify({ type: 'newsletter', title: 'News', collect: true }));
ok('a box set to collect keeps collecting, whatever link was typed before', one({ type: 'newsletter', url: 'https://example.com/join', collect: true })?.collect === true && !one({ type: 'newsletter', url: 'https://example.com/join', collect: true }).url);
ok('a box with a sign-up link still links out, as before', one({ type: 'newsletter', url: 'https://example.com/join', button: 'Join' })?.url === 'https://example.com/join' && !one({ type: 'newsletter', url: 'https://example.com/join' }).collect);
ok('a link that isn’t one, with no choice made: nothing, as before', validateBlocks([{ type: 'newsletter', url: 'mailchimp.com/x' }]).length === 0);
const FN = 'https://db.test/functions/v1/presence';
const EP = `${FN}/forms/${SID}/submit`;
const ctx = { esc, attr, safeHref, formEndpoint: EP };
{
  const html = renderSiteBlocks([{ type: 'newsletter', title: 'Stay in the loop', text: 'Once a month.', button: 'Join', collect: true }, { type: 'newsletter', collect: true }], ctx).map((r) => r.html).join('');
  ok('the box posts to the site’s form address as a sign-up', html.includes(`<form class="card nl-form" method="post" action="${attr(EP)}"><input type="hidden" name="form_kind" value="signup">`) && html.includes('name="source_page"'));
  ok('…a labelled email field, the button’s words, and a yes the visitor must tick', html.includes('<label class="nl-label" for="nl-1-email">Your email</label><input type="email" id="nl-1-email" name="email" required') && html.includes('>Join</button>') && html.includes(`<input type="checkbox" name="consent" value="yes" required> ${esc(SIGNUP_CONSENT)}</label>`));
  ok('…the hidden box robots fill, and the heading and words around it', html.includes('name="_hp" tabindex="-1"') && html.includes('<h2') && html.includes('Stay in the loop') && html.includes('Once a month.'));
  ok('two boxes on a page don’t share a field id', html.includes('id="nl-2-email"') && html.split('id="nl-1-email"').length === 2);
  ok('on the builder’s canvas (no address) the box has no action', renderSiteBlocks([{ type: 'newsletter', collect: true }], { esc, attr, safeHref })[0].html.includes('<form class="card nl-form" method="post"><input'));
  ok('hostile words in the box are only words', renderSiteBlocks([{ type: 'newsletter', collect: true, button: '<img src=x onerror=alert(1)>', text: '</form><script>alert(1)</script>' }], ctx)[0].html.match(/<script|<img/g) === null);
  ok('the form is the one the browser test drives (lib/site_send.ts signupForm)', html.includes(signupForm('nl-1', EP, 'Join', ' data-dds-field="button"')));
}
{
  const fx = fullFixture('business-classic');
  const files = await renderSnapshot(fx, { baseUrl: 'https://shop.example', formEndpoint: EP });
  const home = String(files['index.html']);
  ok('on a published page the box carries the page’s sender, so it sends in the page with its ticket', home.includes(`action="${attr(EP)}"><input type="hidden" name="form_kind" value="signup">`) && home.includes(senderTag(EP)));
}

// ═══ B · joining ═══
const seed = (contacts = []) => { mail.length = 0; db.reset({
  presence_sites: [{ id: SID, client_id: null, custom_domain: 'shop.example', netlify_site_id: 'nf-1' }],
  presence_settings: [{ site_id: SID, blocks: [], pages: [] }],
  presence_contacts: contacts,
}); };
const contacts = () => (db.tables.presence_contacts || []).filter((c) => c.site_id === SID);
const join = (fields, page = true) => { const fd = new FormData(); for (const [k, v] of Object.entries({ form_kind: 'signup', source_page: '/about/', _hp: '', ...fields })) fd.append(k, v); return handleFormSubmit(new Request(EP, { method: 'POST', body: fd, headers: page ? { accept: 'application/json' } : {} }), SID, visitorCors()); };
const body = async (r) => { try { return await r.json(); } catch { return null; } };
// item 203: they press "Yes, add me" in the email the box sent them (join.html posts the link's token)
const yes = async (email) => {
  const e = mail.filter((m) => (Array.isArray(m.to) ? m.to[0] : m.to) === email).pop();
  const t = /join\.html\?t=([^"&]+)/.exec(String(e?.html || ''))?.[1];
  return t ? handleJoinPost(new Request(`${FN}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: decodeURIComponent(t) }) }), {}) : null;
};
{
  seed();
  const r = await join({ email: ' Sam@Customer.example ', consent: 'yes' });
  const j = await body(r);
  ok('joining: the box says to check their email, and nobody is added yet (item 203)', r.status === 200 && j?.data?.ok === true && j.data.message === JOIN_CHECK_EMAIL && contacts().length === 0 && mail.length === 1);
  await yes('sam@customer.example');
  const c = contacts()[0];
  ok('…“Yes, add me” makes a contact of this site, with when they joined and what they agreed to, where', contacts().length === 1 && c.email === 'sam@customer.example' && !!c.subscribed_at && c.subscribed_note.startsWith(`Joined on /about/: “${SIGNUP_CONSENT}”`) && JOINED === 'You’re on the list. Thank you!', JSON.stringify(c));
  const when = c.subscribed_at;
  await join({ email: 'sam@customer.example', consent: 'yes', source_page: '/' });
  ok('joining twice changes nothing, and sends nothing more', contacts().length === 1 && contacts()[0].subscribed_at === when && contacts()[0].subscribed_note.includes('/about/') && mail.length === 1);
}
{
  seed([{ id: 'c-1', site_id: SID, name: 'Pat Lee', email: 'pat@customer.example', phone: '555', subscribed_at: null, subscribed_note: '', deleted_at: null }]);
  await join({ email: 'pat@customer.example', consent: 'yes' });
  await yes('pat@customer.example');
  ok('someone already in the contacts joins the list, keeping their name', contacts().length === 1 && contacts()[0].name === 'Pat Lee' && !!contacts()[0].subscribed_at);
  seed([{ id: 'c-2', site_id: SID, name: 'Dana', email: 'Dana@Customer.Example', phone: '', subscribed_at: null, subscribed_note: '', deleted_at: null }]);
  await join({ email: 'dana@customer.example', consent: 'yes' });
  const r = await body(await yes('dana@customer.example'));
  ok('…saved with other capitals: found all the same (sales item 110’s match), and marked', r?.data?.ok === true && contacts().length === 1 && !!contacts()[0].subscribed_at && contacts()[0].name === 'Dana');
  seed();
  await join({ email: 'lee@customer.example', consent: 'yes' });
  otherTab = { id: 'c-3', site_id: SID, name: '', email: 'lee@customer.example', phone: '', subscribed_at: null, subscribed_note: '', deleted_at: null };
  const r2 = await body(await yes('lee@customer.example'));
  ok('…pressing it from two tabs at once: the row the other tab saved is the one marked', r2?.data?.ok === true && otherTab === null && contacts().length === 1 && contacts()[0].id === 'c-3' && !!contacts()[0].subscribed_at, JSON.stringify(contacts()));
}
{
  seed();
  const noYes = await join({ email: 'sam@customer.example' });
  const nj = await body(noYes);
  ok('no tick: nothing kept or sent, and the box says why, at the tick', noYes.status === 400 && nj?.field === 'consent' && nj.message === 'Tick the box to say yes to emails.' && contacts().length === 0 && mail.length === 0);
  const bad = await body(await join({ email: 'not-an-email', consent: 'yes' }));
  ok('a bad address: said plainly, at the email field', bad?.field === 'email' && bad.message === 'That email doesn’t look right.' && contacts().length === 0);
  const plain = await join({ email: 'ana@customer.example', consent: 'yes' }, false);
  ok('scripts off: the plain post sends the email and goes to the thank-you page', plain.status === 303 && plain.headers.get('location') === 'https://shop.example/thanks/' && contacts().length === 0 && mail.length === 1);
  await yes('ana@customer.example');
  const robot = await body(await join({ email: 'bot@spam.example', consent: 'yes', _hp: 'gotcha' }));
  ok('a robot (the hidden box filled) is thanked, and nothing is kept or sent', robot?.data?.message === JOIN_CHECK_EMAIL && contacts().length === 1 && mail.length === 1);
}
{
  seed();
  await startCheckingSends(SID);
  db.tables.presence_sales_templates[0].body = JSON.stringify({ since: new Date(Date.now() - 2 * 3600_000).toISOString() });
  await join({ email: 'robot@spam.example', consent: 'yes' });
  ok('once the site checks: a sign-up with no ticket is thanked and dropped, and gets no email', contacts().length === 0 && mail.length === 0);
  await join({ email: 'sam@customer.example', consent: 'yes', _tk: await issueTicket(SID, Math.floor(Date.now() / 1000) - 10) });
  await yes('sam@customer.example');
  ok('…a person with a good ticket joins', contacts().length === 1 && contacts()[0].email === 'sam@customer.example');
}

// ═══ C · Send an update writes to them ═══
{
  db.reset({ presence_contacts: [
    { id: 'a', site_id: SID, name: 'Joined', email: 'joined@x.example', subscribed_at: '2026-11-01T00:00:00Z', deleted_at: null },
    { id: 'b', site_id: SID, name: 'Not joined', email: 'contact@x.example', subscribed_at: null, deleted_at: null },
    { id: 'c', site_id: SID, name: 'Deleted', email: 'gone@x.example', subscribed_at: '2026-11-01T00:00:00Z', deleted_at: '2026-11-02T00:00:00Z' },
    { id: 'd', site_id: OTHER, name: 'Elsewhere', email: 'other@x.example', subscribed_at: '2026-11-01T00:00:00Z', deleted_at: null },
  ] });
  const seg = SEGMENTS.find((s) => s.key === 'subscribers');
  ok('Send an update: “People who joined your list”, right after Your customers', !!seg && seg.label === 'People who joined your list' && SEGMENTS[1].key === 'subscribers' && /Join our list/.test(seg.description));
  const rows = await fetchAudienceRows(SID, 'subscribers', { strict: true });
  ok('…it reaches exactly the people who joined this site’s list', rows.length === 1 && rows[0].email === 'joined@x.example' && await audienceCount(SID, 'subscribers') === 1);
  const r = await body(await handleBroadcastSegments({ id: SID }, {}));
  ok('…and the audience picker lists it with its count', r?.data?.segments?.some((s) => s.key === 'subscribers' && s.count === 1));
}

// ═══ D · the editor, the database step, the forward guard ═══
{
  const ed = read('presence.html');
  ok('editor: a new Newsletter box collects by default', ed.includes('if (def.newsletterSimple) { b.url = ""; b.collect = true; return b; }'));
  ok('editor: two choices, and the link field only for the second', ed.includes('<option value="collect">Collect emails here, into your own list</option><option value="link">Send people to another sign-up page</option>') && ed.includes('u.hidden = !link;') && ed.includes('url: link ? u.value.trim() : "", collect: !link'));
  const mig = read('supabase/migrations/0157_join_our_list.sql'), pack = read('docs/presence/APPLY-0157-prod.sql');
  ok('migration 0157: two columns and an index, safe to run twice', [mig, pack].every((s) => s.includes('add column if not exists subscribed_at timestamptz') && s.includes("add column if not exists subscribed_note text not null default ''") && s.includes('create index if not exists presence_contacts_subscribed_idx')) && pack.includes('-- Check:'));
  ok('0157 is the only migration with that number', [...Deno.readDirSync(new URL('supabase/migrations/', ROOT))].filter((e) => e.name.startsWith('0157_')).length === 1);
  ok('forwards: a site path or an https link, nothing else', safeRedirectTo('/menu/') === '/menu/' && safeRedirectTo('https://resy.example/x') === 'https://resy.example/x' && safeRedirectTo('data:text/html,x') === null && safeRedirectTo('javascript:alert(1)') === null && safeRedirectTo('//evil.example') === null && safeRedirectTo('') === null);
  const drawn = ['atelier', 'aurora', 'business-classic', 'editorial', 'harbor', 'meadow', 'slate'].filter((t) => read(`supabase/functions/presence/templates/${t}/1.0.0/render.ts`).includes('const to = safeRedirectTo(r.to_path); if (to) files['));
  ok('…and every template that draws a forward page asks first', drawn.length === 7, drawn.join(','));
  const fx = fullFixture('harbor');
  fx.content.redirects = [{ from_path: '/old/', to_path: 'data:text/html,<b>x</b>' }, { from_path: '/menu-old/', to_path: '/menu/' }];
  const out = await renderSnapshot(fx, { baseUrl: 'https://shop.example' });
  ok('…so a bad one draws no page, and a good one still forwards', !('old/index.html' in out) && String(out['menu-old/index.html']).includes('content="0;url=/menu/"'));
}

// ═══ E · the privacy page says what joining keeps (after list item 138's rewrite) ═══
{
  const { privacyBody } = await import('../../supabase/functions/presence/lib/legal_pages.ts');
  const facts = (blocks, pages = []) => ({ identity: { business_name: 'Marlow Salon', email: 'hello@salon.example' }, locations: [], settings: { blocks, pages } });
  const page = (c, site = { formEndpoint: EP }) => privacyBody(c, '2026-11-11', site);
  const says = (html) => html.includes('<h2>Our email list</h2>') && html.includes('we keep your email address, when you joined, and that you said yes') && html.includes('use the unsubscribe button in your email app or reply and ask');
  ok('privacy: a box that collects here is described, with how to stop the updates', says(page(facts([{ type: 'newsletter', collect: true }]))));
  ok('privacy: so is one on another page, or inside a column', says(page(facts([], [{ slug: 'news', blocks: [{ type: 'newsletter', collect: true }] }]))) && says(page(facts([{ type: 'columns', columns: [{ block: { type: 'newsletter', collect: true } }] }]))));
  ok('privacy: a box that links out to another sign-up page, none at all, or a site that can’t take forms: not a word', !page(facts([{ type: 'newsletter', url: 'https://example.com/join' }])).includes('Our email list') && !page(facts([])).includes('Our email list') && !page(facts([{ type: 'newsletter', collect: true }]), {}).includes('Our email list'));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ JOIN OUR LIST (item 146): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
