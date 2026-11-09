// ── Send an update: "+ Booking link" and "+ Image" (bold redesign, Nov 2026) ──
//   deno run --allow-read --allow-env tests/presence/update_booking_image_test.mjs
//
// {{booking_link}} on a line of its own becomes a "Book a time" button (inside a
// sentence, a "book a time" link) to the booking link saved in Business details;
// ![description](media:<id>) on a line of its own becomes that Files photo, through
// a signed link on this function (the library stays private). Every other line
// renders exactly as before; a missing link or a photo that isn't the site's own
// renders nothing. Pure helpers, the extras reader, the public route and the send.
const ROOT = new URL('../../', import.meta.url);
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');

const { buildEmailHtml, renderSubject, renderMergeTokens, dispatchBroadcast, sendBroadcastTest } = await import('../../supabase/functions/presence/lib/broadcast.ts');
const { renderMarkdown } = await import('../../supabase/functions/presence/lib/markdown.ts');
const M = await import('../../supabase/functions/presence/lib/update_media.ts');
const { imageToken, openToken } = await import('../../supabase/functions/_shared/email_infra.ts');

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P1 = '11111111-2222-4333-8444-555555555555';
const P2 = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const BOOK = 'https://cal.example/brightline';
const tokens = { firstName: 'Ivy', businessName: 'Brightline Studio', bookingUrl: BOOK };

// ── the email body ──
{
  for (const body of ['Hi {{first_name}},\n\nWe have **free** photo sessions.\n\n- one\n- two', 'Line one\nline two\n\n> a quote', '', 'A [link](https://x.example) and *more*'])
    ok(`a message without the new parts renders exactly as before: ${JSON.stringify(body.slice(0, 24))}`, buildEmailHtml(body, tokens) === renderMarkdown(renderMergeTokens(body, tokens)));

  const btn = buildEmailHtml('Spring is here.\n\n{{booking_link}}\n\nSee you soon.', tokens, { accent: '#3a6ea5' });
  ok('a booking-link line is the "Book a time" button, in the studio’s colour', btn.includes(`<p class="cta"><a href="${BOOK}" rel="noopener" style="display:inline-block;margin-top:6px;background:#3a6ea5;color:#ffffff;`) && btn.includes('>Book a time</a></p>'));
  ok('…between the paragraphs around it', btn.indexOf('<p>Spring is here.</p>') < btn.indexOf('Book a time') && btn.indexOf('Book a time') < btn.indexOf('<p>See you soon.</p>'));
  ok('…with the platform colour when the accent isn’t a colour', buildEmailHtml('{{booking_link}}', tokens, { accent: 'red;x' }).includes('background:#5b3fa0;'));
  ok('…and the line may have spaces around it', buildEmailHtml('  {{ booking_link }}  ', tokens).includes('>Book a time</a>'));

  const inl = buildEmailHtml('You can {{booking_link}} any day.', tokens);
  ok('inside a sentence it reads “book a time” as a link', inl === `<p>You can <a href="${BOOK}" rel="noopener">book a time</a> any day.</p>`, inl);

  const none = buildEmailHtml('Hello.\n{{booking_link}}\nYou can {{booking_link}} any day.', { firstName: 'Ivy' });
  ok('with no booking link saved, the button and the link render nothing (no token text left)', !/booking_link|Book a time|book a time/.test(none) && none.includes('You can  any day.'), none);
  for (const bad of ['http://cal.example/x', 'javascript:alert(1)', 'cal.example/x', 'https://cal.example/a b'])
    ok(`a booking link that isn’t a plain https address counts as none: ${bad}`, !buildEmailHtml('{{booking_link}}', { bookingUrl: bad }).includes('Book a time') && M.bookingHref(bad) === '');
  const paren = buildEmailHtml('Please {{booking_link}}.', { bookingUrl: 'https://cal.example/book(1)' });
  ok('brackets in the booking link stay inside the link', paren.includes('href="https://cal.example/book%281%29"') && paren.includes('>book a time</a>.'), paren);

  const images = { [P1]: `https://example.supabase.co/functions/v1/presence/email/img/${P1}.sig` };
  const img = buildEmailHtml(`Our new studio:\n![The shopfront at dusk](media:${P1})\nCome by.`, tokens, { images });
  ok('a photo line is that photo, full width, in its own paragraph', img.includes(`<p style="margin:16px 0"><img src="${images[P1]}" alt="The shopfront at dusk" width="540" style="display:block;width:100%;max-width:540px;height:auto;border:0;border-radius:12px"></p>`), img);
  ok('…and the words around it stay paragraphs', img.startsWith('<p>Our new studio:</p>') && img.endsWith('<p>Come by.</p>'));
  ok('an upper-case id finds its photo', buildEmailHtml(`![x](media:${P1.toUpperCase()})`, tokens, { images }).includes('<img src='));
  const alt = buildEmailHtml(`![He said "hi" <b>](media:${P1})`, tokens, { images });
  ok('a photo’s description is escaped', alt.includes('alt="He said &quot;hi&quot; &lt;b&gt;"') && !alt.includes('<b>'), alt);
  ok('a photo that isn’t the site’s own renders nothing (no "media:" text)', buildEmailHtml(`Hi\n![x](media:${P2})\nBye`, tokens, { images }) === '<p>Hi</p>\n<p>Bye</p>');
  ok('a photo line with other words on it stays words', !buildEmailHtml(`Look ![x](media:${P1})`, tokens, { images }).includes('<img'));
  ok('any other picture stays plain text, as before', !buildEmailHtml('![x](https://other.example/p.png)', tokens, { images }).includes('<img') && !buildEmailHtml('![x](media:not-an-id)', tokens, { images }).includes('<img'));
  ok('a photo block refuses a link that isn’t https', M.imageBlock('http://x.example/a.png', 'a') === '' && M.imageBlock('javascript:alert(1)', 'a') === '' && M.imageBlock('https://x.example/a".png', 'a') === '');
  ok('a subject line never carries the booking link', renderSubject('Book now {{booking_link}} — {{business_name}}', tokens) === 'Book now — Brightline Studio');
  ok('the photos a message names: in order, distinct, lower-case, lines of their own only', JSON.stringify(M.mediaIdsIn(`![a](media:${P2})\ntext ![b](media:${P1})\n![c](media:${P1.toUpperCase()})\n![d](media:${P2})`)) === JSON.stringify([P2, P1]));
}

// ── what the message needs: one read each, only when needed ──
{
  const mk = (answers) => { const seen = []; return { seen, read: async (p) => { seen.push(p); for (const [k, v] of answers) if (p.includes(k)) return typeof v === 'function' ? v(p) : v; return { ok: true, json: [] }; } }; };
  const imageUrl = async (id) => `https://u.example/${id}`;
  let f = mk([]);
  let x = await M.loadUpdateExtras(SITE, 'Hi {{first_name}}', { read: f.read, imageUrl });
  ok('nothing to read for a plain message', f.seen.length === 0 && x.bookingUrl === '' && Object.keys(x.images).length === 0);
  f = mk([['presence_identity', { ok: true, json: [{ booking_url: BOOK }] }]]);
  x = await M.loadUpdateExtras(SITE, 'Hi\n{{booking_link}}', { read: f.read, imageUrl });
  ok('a booking link: one read of Business details, scoped to the site', f.seen.length === 1 && f.seen[0] === `presence_identity?site_id=eq.${SITE}&select=booking_url&limit=1` && x.bookingUrl === BOOK);
  f = mk([['presence_identity', { ok: true, json: [{ booking_url: 'http://insecure.example' }] }]]);
  ok('…an http link counts as none', (await M.loadUpdateExtras(SITE, '{{booking_link}}', { read: f.read, imageUrl })).bookingUrl === '');
  const P3 = 'cccccccc-dddd-4eee-8fff-000000000000', P4 = 'dddddddd-eeee-4fff-8000-111111111111', P5 = 'eeeeeeee-ffff-4000-8111-222222222222';
  f = mk([['presence_media', { ok: true, json: [
    { id: P1, mime: 'image/jpeg', asset_status: 'active', client_private: false },
    { id: P2, mime: 'image/png', asset_status: 'archived' },
    { id: P3, mime: 'image/webp', client_private: true },
    { id: P4, mime: 'application/pdf' },
    { id: 'ffffffff-0000-4111-8222-333333333333', mime: 'image/jpeg' },
  ] }]]);
  x = await M.loadUpdateExtras(SITE, [P1, P2, P3, P4, P5].map((p) => `![p](media:${p})`).join('\n'), { read: f.read, imageUrl });
  ok('photos: one read, the site’s own live rows for exactly the named ids', f.seen.length === 1 && f.seen[0].startsWith(`presence_media?site_id=eq.${SITE}&id=in.(${[P1, P2, P3, P4, P5].join(',')})&deleted_at=is.null&select=id,mime,asset_status,client_private`));
  ok('…only a shared, live image gets a link (not archived, private, a document, or one it didn’t name)', JSON.stringify(x.images) === JSON.stringify({ [P1]: `https://u.example/${P1}` }), JSON.stringify(x.images));
  let n = 0;
  f = mk([['presence_media', (p) => (++n === 1 ? { ok: false, json: { code: '42703', message: 'column presence_media.client_private does not exist' } } : { ok: true, json: [{ id: P1, mime: 'image/jpeg' }] })]]);
  x = await M.loadUpdateExtras(SITE, `![p](media:${P1})`, { read: f.read, imageUrl });
  ok('before 0131 (no client_private yet) it reads again without it, and nothing is private', f.seen.length === 2 && !f.seen[1].includes('client_private') && !!x.images[P1]);
  f = mk([['presence_identity', async () => { throw new Error('down'); }], ['presence_media', { ok: false, json: { message: 'boom' } }]]);
  x = await M.loadUpdateExtras(SITE, `{{booking_link}}\n![p](media:${P1})`, { read: f.read, imageUrl });
  ok('a failed read renders nothing for that part and never throws', x.bookingUrl === '' && Object.keys(x.images).length === 0);
  ok('a site that isn’t an id reads nothing', (await M.loadUpdateExtras('nope', '{{booking_link}}', { read: async () => { throw new Error('read'); }, imageUrl })).bookingUrl === '');
}

// ── the photo's link, and the public route that answers it ──
{
  const u = await M.emailImageUrl(P1.toUpperCase());
  ok('a photo’s link is this function’s own address, the id and a signature', u === `https://example.supabase.co/functions/v1/presence/email/img/${P1}.${await imageToken(P1)}` && /\.[A-Za-z0-9_-]{32}$/.test(u), u);
  ok('the photo signature is its own, never the open counter’s', (await imageToken(P1)) !== (await openToken(P1)));
  ok('no link for anything that isn’t an id', (await M.emailImageUrl('x')) === '');
  const sig = await imageToken(P1);
  const isBlank = async (r) => r.status === 200 && r.headers.get('Content-Type') === 'image/gif' && (await r.arrayBuffer()).byteLength === 43;
  let reads = 0;
  const read = (row) => async () => { reads++; return { ok: true, json: row ? [row] : [] }; };
  let signed = null;
  const sign = async (path, mime, width) => { signed = { path, mime, width }; return 'https://example.supabase.co/storage/v1/object/sign/presence-media/s/p.jpg?token=t'; };
  ok('a wrong signature answers a blank pixel and reads nothing', await isBlank(await M.handleEmailImage(P1, 'x'.repeat(32), { read: read(null), sign })) && reads === 0);
  ok('a deleted photo answers a blank pixel', await isBlank(await M.handleEmailImage(P1, sig, { read: read(null), sign })));
  ok('an archived photo answers a blank pixel', await isBlank(await M.handleEmailImage(P1, sig, { read: read({ storage_path: 'presence-media/s/p.jpg', mime: 'image/jpeg', asset_status: 'archived' }), sign })));
  ok('a document answers a blank pixel', await isBlank(await M.handleEmailImage(P1, sig, { read: read({ storage_path: 'presence-media/s/d.pdf', mime: 'application/pdf' }), sign })));
  const r = await M.handleEmailImage(P1, sig, { read: read({ storage_path: 'presence-media/s/p.jpg', mime: 'image/jpeg' }), sign });
  ok('a good link sends the email app on to a 1200px signed copy', r.status === 302 && r.headers.get('Location').startsWith('https://example.supabase.co/storage/v1/object/sign/') && signed && signed.width === 1200 && signed.path === 'presence-media/s/p.jpg');
  ok('…a hop cached well inside the signed link’s hour', r.headers.get('Cache-Control') === 'private, max-age=600');
  ok('a failed signing answers a blank pixel', await isBlank(await M.handleEmailImage(P1, sig, { read: read({ storage_path: 'presence-media/s/p.jpg', mime: 'image/jpeg' }), sign: async () => null })));
}

// ── the send, the test and the preview use it ──
{
  const brand = { name: 'Brightline Studio', accent: '#3a6ea5', accentDark: '#2a4f78' };
  const b = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', site_id: SITE, subject: 'News {{booking_link}}', body: `Hi {{first_name}},\n![Our studio](media:${P1})\n{{booking_link}}`, audience: 'contacts', status: 'sending' };
  const sent = [];
  const extrasFn = async (siteId, body) => { ok('the send reads the extras once, for this update', siteId === SITE && body === b.body); return { bookingUrl: BOOK, images: { [P1]: `https://u.example/${P1}` } }; };
  const r = await dispatchBroadcast(b, { loadBrand: async () => brand, sendFn: async (to, subject, html) => { sent.push({ to, subject, html }); return true; }, claimFn: async () => 'inserted', resolveFn: async () => ({ recipients: [{ email: 'a@x.example', firstName: 'Al' }, { email: 'b@x.example', firstName: 'Bo' }], suppressed: 0, audience: 2 }), sentInLastDayFn: async () => 0, extrasFn });
  ok('every person’s email has the photo and the button', r.sent === 2 && sent.every((s) => s.html.includes(`<img src="https://u.example/${P1}"`) && s.html.includes('>Book a time</a>') && s.html.includes('background:#3a6ea5')));
  ok('…their own first name, and a clean subject', sent[0].html.includes('Hi Al,') && sent[1].html.includes('Hi Bo,') && sent.every((s) => s.subject === 'News'));
  const tests = [];
  await sendBroadcastTest(b, 'me@x.example', { loadBrand: async () => brand, sendFn: async (to, subject, html) => { tests.push({ to, subject, html }); return true; }, extrasFn: async () => ({ bookingUrl: BOOK, images: { [P1]: `https://u.example/${P1}` } }) });
  ok('“Send me a test” shows the same photo and button', tests.length === 1 && tests[0].html.includes('<img src=') && tests[0].html.includes('Book a time') && tests[0].subject === '[Test] News');
  const routes = Deno.readTextFileSync(new URL('supabase/functions/presence/routes/broadcasts.ts', ROOT));
  ok('the preview renders with the same extras', /loadUpdateExtras\(site\.id, b\.body\)/.test(routes) && /buildEmailHtml\(b\.body, tokens, \{ images: extras\.images, accent: brand\.accent \}\)/.test(routes));
  const index = Deno.readTextFileSync(new URL('supabase/functions/presence/index.ts', ROOT));
  const at = index.indexOf("/^\\/email\\/img\\/([0-9a-f-]{36})\\.([A-Za-z0-9_-]{32})$/i");
  ok('the photo route is public, beside the open counter (before sign-in is required)', at > 0 && at < index.indexOf("route === '/identity'") && at > index.indexOf('/^\\/email\\/open\\/'));
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
