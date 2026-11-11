// ── Reviews that go to Google (sales review item 115, extending item 93) ──────
// A review request can point at the business's GOOGLE review box: the link from
// the Google Business Profile listing when its read has run, else the place id
// the owner pastes once (migration 0163) — and the page says plainly when Google
// hasn't approved the listing connection yet. The "ticked list" sends one ask
// per ticked person through the SAME guards as a single ask. Real handlers
// against the shared in-memory PostgREST; all names made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/google_review_routes_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('1'), OWNER = uuid('2'), U = uuid('3');
const CT_A = uuid('a'), CT_B = uuid('b'), CT_C = uuid('c'), DEAL_A = uuid('d'), DEAL_B = uuid('e');
Deno.env.set('RESEND_KEY', 'test-key');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@example.com' } }, ownSite: { 'jwt-owner': SITE } });

// the outside world: the limiter counts for real (the fake PostgREST would always
// allow), Resend records what was sent, anything else outside is refused
const pg = globalThis.fetch;
let emails = [], rate = {};
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'api.resend.com') { emails.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: 'e' + emails.length }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  if (u.pathname === '/rest/v1/rpc/rate_hit') {
    const b = JSON.parse(String(init.body)); const k = `${b.p_bucket}|${b.p_window}`; rate[k] = (rate[k] || 0) + 1;
    return new Response(JSON.stringify(rate[k] <= b.p_max), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.hostname !== 'db.test') return new Response('{}', { status: 404 });
  return pg(url, init);
};
const RV = await import('../../supabase/functions/presence/routes/reviews.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const cors = {};
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };
const req = (method, path, body) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-owner' } });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const list = async () => (await res(await RV.handleReviewsList(req('GET', '/reviews'), site, cors))).body.data;
const GBP_DATA = { rating: 4.6, review_count: 128, new_reviews: 2, unreplied_reviews: 3, listing_name: 'Marlow Studio', listing_maps_uri: 'https://maps.google.com/?cid=1', listing_review_uri: 'https://search.google.com/local/writereview?placeid=FromGoogle123' };
const days = (n) => new Date(Date.now() - n * 86400_000).toISOString();
const world = (over = {}) => {
  db.reset({
    presence_sites: [{ id: SITE, client_id: OWNER }],
    presence_identity: [{ site_id: SITE, business_name: 'Marlow Studio', email: 'owner@marlow.example' }],
    presence_contacts: [
      { id: CT_A, site_id: SITE, name: 'Pat Jones', email: 'pat@client.example' },
      { id: CT_B, site_id: SITE, name: 'No Email', email: '' },
      { id: CT_C, site_id: SITE, name: 'Sam Lee', email: 'sam@client.example' },
    ],
    ...over,
  });
  emails = []; rate = {};
};

// ═══ nothing connected, nothing pasted: honest nulls, and Google asks are refused ═══
{
  world();
  const d = await list();
  ok('bare site: no link, no source, not connected, no Google reviews', d.google.link === null && d.google.source === null && d.google.connected === false && d.google.listing === null, JSON.stringify(d.google));
  ok('bare site: nobody recently paid', Array.isArray(d.recently_paid) && d.recently_paid.length === 0);
  const r = await res(await RV.handleReviewRequest(req('POST', '/reviews/request', { email: 'pat@client.example', destination: 'google' }), site, owner, cors));
  ok('a Google ask without a link: refused in a sentence, nothing sent', r.status === 409 && r.body.error === 'no_google_link' && /place id/.test(r.body.message) && emails.length === 0, JSON.stringify(r));
}

// ═══ the paste-once place id ═══
{
  world();
  let r = await res(await RV.handleReviewGoogleLink(req('POST', '/reviews/google-link', { place_id: 'ChIJPastedPlace_12' }), site, owner, cors));
  ok('pasting a place id saves it and answers the link', r.status === 200 && r.body.data.place_id === 'ChIJPastedPlace_12' && r.body.data.link === 'https://search.google.com/local/writereview?placeid=ChIJPastedPlace_12');
  ok('…stored on the identity row', db.tables.presence_identity.find((i) => i.site_id === SITE)?.google_place_id === 'ChIJPastedPlace_12');
  let d = await list();
  ok('the page now hears: pasted source, the writereview link', d.google.source === 'pasted' && d.google.place_id === 'ChIJPastedPlace_12' && /writereview\?placeid=ChIJPastedPlace_12/.test(d.google.link));

  r = await res(await RV.handleReviewGoogleLink(req('POST', '/reviews/google-link', { place_id: 'https://search.google.com/local/writereview?placeid=FromAUrl_9876' }), site, owner, cors));
  ok('pasting the full “write a review” link keeps only the id', r.status === 200 && r.body.data.place_id === 'FromAUrl_9876');

  r = await res(await RV.handleReviewGoogleLink(req('POST', '/reviews/google-link', { place_id: 'nope!' }), site, owner, cors));
  ok('a wrong paste is refused in a sentence, nothing changed', r.status === 400 && r.body.error === 'bad_place_id' && db.tables.presence_identity[0].google_place_id === 'FromAUrl_9876');

  r = await res(await RV.handleReviewGoogleLink(req('POST', '/reviews/google-link', { place_id: '' }), site, owner, cors));
  d = await list();
  ok('an empty paste clears it', r.status === 200 && r.body.data.place_id === null && d.google.link === null && d.google.source === null);
}

// ═══ the listing's own link wins; connected-but-no-data says "waiting on Google" ═══
{
  world({
    presence_identity: [{ site_id: SITE, business_name: 'Marlow Studio', google_place_id: 'ChIJPastedPlace_12' }],
    presence_connections: [{ site_id: SITE, provider_key: 'google_business_profile', status: 'connected', health: 'ok' }],
    presence_connected_data: [{ site_id: SITE, provider_key: 'google_business_profile', data: GBP_DATA, fetched_at: '2026-11-10T00:00:00Z' }],
  });
  const d = await list();
  ok('with listing data: Google’s own review link wins over the paste', d.google.source === 'google' && d.google.link === GBP_DATA.listing_review_uri);
  ok('…and the Google reviews come in, aggregate only', d.google.listing && d.google.listing.rating === 4.6 && d.google.listing.review_count === 128 && d.google.listing.unreplied === 3 && d.google.listing.maps_uri.includes('maps.google.com'));
}
{
  world({ presence_connections: [{ site_id: SITE, provider_key: 'google_business_profile', status: 'connected', health: 'attention' }] });
  const d = await list();
  ok('connected but no data yet (Google approval pending): connected true, no listing, no link', d.google.connected === true && d.google.listing === null && d.google.link === null);
}

// ═══ before migration 0163 the identity read fails — calm, and the save says so ═══
{
  world();
  db.failMethod.set('presence_identity', 'GET');
  const d = await list();
  ok('pre-0163: the page hears it can’t save a place id, and nothing errors', d.google.can_save_place_id === false && d.google.link === null);
  db.failMethod.set('presence_identity', 'POST');
  const r = await res(await RV.handleReviewGoogleLink(req('POST', '/reviews/google-link', { place_id: 'ChIJPastedPlace_12' }), site, owner, cors));
  ok('pre-0163: saving answers "needs a database update", not an error', r.status === 503 && r.body.error === 'unavailable' && /database update/.test(r.body.message));
}

// ═══ a single Google ask: the email carries the Google link and honest words ═══
{
  world({ presence_identity: [{ site_id: SITE, business_name: 'Marlow Studio', email: 'owner@marlow.example', google_place_id: 'ChIJPastedPlace_12' }] });
  const r = await res(await RV.handleReviewRequest(req('POST', '/reviews/request', { email: 'pat@client.example', name: 'Pat', destination: 'google' }), site, owner, cors));
  ok('the Google ask sends', r.status === 200 && r.body.data.ok === true && r.body.data.destination === 'google' && emails.length === 1, JSON.stringify(r.body));
  const html = String(emails[0]?.html || '');
  ok('…to the Google review box, saying so', html.includes('writereview?placeid=ChIJPastedPlace_12') && html.includes('Review us on Google') && html.includes('straight onto our Google listing'));
  ok('…never the site’s approval words (a Google review is public right away)', !html.includes('once we’ve seen them'));
}

// ═══ the ticked list: one ask per person, each behind the same guards ═══
{
  world();
  const r = await res(await RV.handleReviewRequest(req('POST', '/reviews/request', { contact_ids: [CT_A, CT_B, CT_C, uuid('f')], destination: 'site' }), site, owner, cors));
  ok('ticked: the two with an email are asked, the others skipped with reasons', r.status === 200 && r.body.data.sent === 2 && emails.length === 2, JSON.stringify(r.body));
  const reasons = (r.body.data.skipped || []).map((s) => s.reason).sort();
  ok('…no_email and not_found are named', JSON.stringify(reasons) === JSON.stringify(['no_email', 'not_found']), JSON.stringify(r.body.data.skipped));
  ok('…site asks link the site’s own review page', String(emails[0]?.html || '').includes('/review.html?site=') && String(emails[0]?.html || '').includes('Leave a review'));
  const again = await res(await RV.handleReviewRequest(req('POST', '/reviews/request', { contact_ids: [CT_A] }), site, owner, cors));
  ok('ticking the same person again that month: skipped as asked_recently, nothing sent', again.body.data.sent === 0 && again.body.data.skipped[0]?.reason === 'asked_recently' && emails.length === 2);
  ok('the limiter never sees an address in the clear', !Object.keys(rate).some((k) => k.includes('@')));
}

// ═══ "just paid you": the paid invoices become the ticked list's people ═══
{
  world({
    presence_invoices: [
      { id: uuid('4'), site_id: SITE, deal_id: DEAL_A, status: 'paid', paid_at: days(2), title: 'New website', amount_cents: 120000, purpose: 'final' },
      { id: uuid('5'), site_id: SITE, deal_id: DEAL_A, status: 'paid', paid_at: days(20), title: 'Deposit', amount_cents: 50000, purpose: 'deposit' },
      { id: uuid('6'), site_id: SITE, deal_id: DEAL_B, status: 'paid', paid_at: days(5), title: 'Logo', amount_cents: 40000, purpose: 'final' },
      { id: uuid('7'), site_id: SITE, deal_id: DEAL_A, status: 'open', title: 'Unpaid', amount_cents: 10000, purpose: 'final' },
    ],
    presence_deals: [
      { id: DEAL_A, site_id: SITE, contact_id: CT_A },
      { id: DEAL_B, site_id: SITE, contact_id: CT_B },   // no email → never offered
    ],
  });
  const d = await list();
  ok('one row per person with an email, newest payment first, open invoices ignored',
    d.recently_paid.length === 1 && d.recently_paid[0].contact_id === CT_A && d.recently_paid[0].title === 'New website' && d.recently_paid[0].email === 'pat@client.example', JSON.stringify(d.recently_paid));
}

// ═══ the invoice-paid moment OFFERS the ask (words + a link), never a send ═══
{
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/commerce.ts', import.meta.url));
  ok('the paid notice offers the Reviews tab in words', src.includes('A good moment to ask them for a review, from your Reviews tab.'));
  ok('the operator email links the Reviews tab — a button for the owner, not a send', src.includes('open Reviews to send the ask'));
  ok('nothing about the offer calls sendReviewAsk from the paid path', !src.includes('sendReviewAsk'));
}

console.log(`\n════ GOOGLE REVIEW REQUESTS: ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) Deno.exit(1);
