// ── Builder items 379, 383 and 291: what a shared link shows, what Google reads, the days to book ──
//   deno run --allow-read --allow-env --allow-net tests/presence/share_google_booking_test.mjs
// Part A (379): every page of every template carries a share picture: a page's own photo, else
// the site's, else a plain card drawn from the name, town and colours (a real PNG, checked byte
// by byte here); default titles name the town and pages describe themselves in their own words.
// Part B (383): the business data gains a picture, a map point and a price range only where the
// site has them; reviews are told as the wall shows them, a review with no name left out of the
// list, and nothing the owner reads promises stars in Google. Part C (291): booking hours follow
// the business hours until the owner sets different ones; the days a visitor can pick, today
// counted in the business's own day until its last open time; the routes on a fake database.
import { installFakePostgrest } from './fake_pgrst.mjs';
import { withClock } from './clock.mjs';
import { editorSource } from './editor_source.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, note = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${note && !cond ? `  (${note})` : ''}`); };

Deno.env.set('APP_URL', 'https://app.example');
const db = installFakePostgrest();
const fake = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('/rest/v1/rpc/rate_hit')) return new Response('true', { status: 200, headers: { 'Content-Type': 'application/json' } });
  return fake(url, init);
};

const P = '../../supabase/functions/presence';
const { renderSnapshot } = await import(`${P}/lib/render.ts`);
const { TEMPLATES, fixture: sampleOf, fullFixture } = await import('./full_fixture.mjs');
const { shareCard, cardText, cardLayout, cardColours, crc32, CARD_W, CARD_H } = await import(`${P}/lib/share_card.ts`);
const { seoHead } = await import(`${P}/lib/seo_emit.ts`);
const { reviewsSchema } = await import(`${P}/lib/site_blocks.ts`);
const { UNNAMED_REVIEWER } = await import(`${P}/lib/reviews.ts`);
const { HELP_TOPICS } = await import(`${P}/lib/help_assistant.ts`);
const { COMPONENTS } = await import(`${P}/lib/site_components.ts`);
const B = await import(`${P}/lib/booking.ts`);
const R = await import(`${P}/routes/booking.ts`);
const { BOOKING_MONTH_JS, BOOKING_MONTH_PATH, bookingScript } = await import(`${P}/lib/site_send.ts`);

const SITE = { baseUrl: 'https://shop.example' };
const draw = async (snap) => { const r = await renderSnapshot(snap, SITE); return r.files || r; };
const head = (html) => html.slice(0, html.indexOf('</head>'));
const metas = (html, prop) => [...head(html).matchAll(new RegExp(`<meta property="${prop}" content="([^"]*)">`, 'g'))].map((m) => m[1]);
const titleOf = (html) => (/<title>([^<]*)<\/title>/.exec(html) || [])[1] || '';
const descOf = (html) => (/<meta name="description" content="([^"]*)">/.exec(html) || [])[1] || '';
const ldOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const pages = (files) => Object.keys(files).filter((k) => k.endsWith('.html') && k !== '404.html' && typeof files[k] === 'string');
// every photo and logo out of a sample, so the site has nothing of its own to share
const noPhotos = (v) => (Array.isArray(v) ? v.map(noPhotos) : v && typeof v === 'object' ? (v.variants ? null : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, noPhotos(x)]))) : v);
const pic = (name) => ({ alt: name, width: 1600, height: 1000, variants: { w400: `/img/${name}-400.webp`, w800: `/img/${name}-800.webp`, w1600: `/img/${name}-1600.webp` } });

// ═══ Part A · item 379: a share picture on every page ═══
for (const slug of TEMPLATES) {
  const files = await draw(fullFixture(slug));
  const without = pages(files).filter((p) => metas(files[p], 'og:image').length !== 1 || !metas(files[p], 'og:image')[0].startsWith(`${SITE.baseUrl}/`));
  ok(`379 [${slug}]: every page carries one share picture, on the site's own address`, !without.length, without.slice(0, 4).join(', '));
}
{
  const snap = fullFixture('harbor');
  const own = snap.content.settings.pages[0];
  own.blocks = [{ type: 'partners', title: 'Partners', logos: [pic('partner-logo')] }, { type: 'image', title: '', image: pic('own-photo'), caption: '', alt: 'A job', decorative: false }, ...own.blocks];
  snap.content.posts = snap.content.posts.map((p, n) => (n === 0 ? { ...p, hero: null } : { ...p, hero: pic(`post-${n}`) }));
  const files = await draw(snap);
  const home = metas(files['index.html'], 'og:image')[0];
  ok('379: an own page shares its own first photo, never a partner’s logo', metas(files[`${own.slug}/index.html`], 'og:image')[0] === `${SITE.baseUrl}/img/own-photo-1600.webp`, metas(files[`${own.slug}/index.html`], 'og:image')[0]);
  ok('379: a post with a cover shares its cover', metas(files[`updates/${snap.content.posts[1].slug}/index.html`], 'og:image')[0] === `${SITE.baseUrl}/img/post-1-1600.webp`);
  ok('379: a post with no cover shares the site’s picture', metas(files[`updates/${snap.content.posts[0].slug}/index.html`], 'og:image')[0] === home);
  ok('379: About and Contact share the site’s picture (they had none)', metas(files['about/index.html'], 'og:image')[0] === home && metas(files['contact/index.html'], 'og:image')[0] === home);
  ok('379: a photo’s size is not claimed (only the card’s is known)', !metas(files['about/index.html'], 'og:image:width').length);
  ok('379: no card is drawn for a site with photos', !Object.keys(files).some((k) => /^assets\/share-.*\.png$/.test(k)));
}
// a site with no photo and no logo: the plain card
const cardSite = async (slug, tokens) => {
  const snap = noPhotos(sampleOf(slug));
  if (tokens) snap.dev_customization = { ...(snap.dev_customization || {}), theme_tokens: tokens };
  return { snap, files: await draw(snap) };
};
{
  const { snap, files } = await cardSite('harbor');
  const cards = Object.keys(files).filter((k) => /^assets\/share-[0-9a-f]+\.png$/.test(k));
  ok('379: a site with no photo or logo gets one plain card file', cards.length === 1, cards.join(', '));
  const url = `${SITE.baseUrl}/${cards[0]}`;
  const off = pages(files).filter((p) => metas(files[p], 'og:image')[0] !== url || metas(files[p], 'og:image:width')[0] !== String(CARD_W) || metas(files[p], 'og:image:height')[0] !== String(CARD_H));
  ok('379: every page shares the card, with its size', !off.length, off.slice(0, 3).join(', '));
  ok('379: the card shares as a large picture', /<meta name="twitter:card" content="summary_large_image">/.test(files['about/index.html']));
  const biz = ldOf(files['contact/index.html'])[0];
  ok('383: the card is never told to Google as a picture of the business', biz.image === undefined);
  const png = files[cards[0]];
  ok('379: the card is the very bytes the drawing gives for this name, town and colour', png instanceof Uint8Array && png.length < 300_000);
  const again = await cardSite('harbor');
  ok('379: the same site draws the same card, byte for byte', Object.keys(again.files).includes(cards[0]) && again.files[cards[0]].every((b, n) => b === png[n]));
  const renamed = noPhotos(sampleOf('harbor')); renamed.content.identity.business_name = 'Copper Line Plumbing and Drains';
  const r2 = await draw(renamed);
  ok('379: a new name is a new card file, so a shared link fetches the new one', !Object.keys(r2).includes(cards[0]) && Object.keys(r2).some((k) => /^assets\/share-.*\.png$/.test(k)));
  ok('379: the card names the business and its town', snap.content.locations[0].city && cardLayout(snap.content.identity.business_name, `${snap.content.locations[0].city}, ${snap.content.locations[0].region}`).town === cardText(`${snap.content.locations[0].city}, ${snap.content.locations[0].region}`));
}
// the PNG itself: signature, header, chunk checksums, and pixels that inflate back
{
  const png = shareCard({ name: 'Blue Oak Dental', town: 'Burbank, CA', accent: '#1b2a4a' });
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  ok('379: a PNG signature', [137, 80, 78, 71, 13, 10, 26, 10].every((b, n) => png[n] === b));
  const chunks = [];
  for (let at = 8; at < png.length;) {
    const len = dv.getUint32(at), type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + len), crcOk: crc32(png.subarray(at + 4, at + 8 + len)) === dv.getUint32(at + 8 + len) });
    at += 12 + len;
  }
  ok('379: IHDR, PLTE, IDAT, IEND, each with a good checksum', chunks.map((c) => c.type).join() === 'IHDR,PLTE,IDAT,IEND' && chunks.every((c) => c.crcOk));
  const ih = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
  ok('379: 1200 by 630, 8-bit colour palette', ih.getUint32(0) === 1200 && ih.getUint32(4) === 630 && chunks[0].data[8] === 8 && chunks[0].data[9] === 3);
  const raw = new Uint8Array(await new Response(new Blob([chunks[2].data]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  ok('379: the picture data inflates to 630 rows of 1200 pixels', raw.length === 630 * 1201 && [...Array(630).keys()].every((y) => raw[y * 1201] === 0));
  const px = (x, y) => raw[y * 1201 + 1 + x];
  const plte = chunks[1].data, rgb = (i) => '#' + [0, 1, 2].map((k) => plte[i * 3 + k].toString(16).padStart(2, '0')).join('');
  ok('379: the card is the accent colour, words in white on a dark accent', rgb(px(5, 5)) === '#1b2a4a' && rgb(16) === '#ffffff');
  let inked = 0; for (let y = 100; y < 520; y++) for (let x = 0; x < 1200; x++) if (px(x, y) === 16) inked++;
  ok('379: the name is drawn (solid strokes across the middle)', inked > 20_000, String(inked));
  ok('379: the bottom strip is a deeper shade', px(600, 625) === 33 && rgb(33) !== rgb(0));
  const light = cardColours('#f2c94c');
  ok('379: on a light accent the words are near-black', light.ink === '#111827');
}
{
  const L = cardLayout('The Pasadena Family Dental Practice and Orthodontics of the San Gabriel Valley', 'Pasadena, CA');
  ok('379: a long name takes three lines at most, inside the margins', L.lines.length <= 3 && L.lines.length > 0 && L.top >= 80, JSON.stringify(L));
  ok('379: the card’s words: capitals, accents dropped, marks it can’t draw left out', cardText('Café Olé’s #1 bakery™') === "CAFE OLE'S 1 BAKERY");
  ok('379: a name it can’t draw at all still leaves the town', cardLayout('東京', 'Burbank, CA').lines.length === 0 && cardLayout('東京', 'Burbank, CA').town === 'BURBANK, CA');
}
{
  const harbor = await cardSite('harbor', { accent: '#7c3aed' });
  const slate = await cardSite('slate', { accent: '#7c3aed' });
  const first = (files) => files[Object.keys(files).find((k) => /^assets\/share-.*\.png$/.test(k))];
  const paletteFirst = (png) => { for (let at = 8; ;) { const dv = new DataView(png.buffer, png.byteOffset); const len = dv.getUint32(at); const type = String.fromCharCode(...png.subarray(at + 4, at + 8)); if (type === 'PLTE') return '#' + [0, 1, 2].map((k) => png[at + 8 + k].toString(16).padStart(2, '0')).join(''); at += 12 + len; } };
  ok('379: the card takes the owner’s accent', paletteFirst(first(harbor.files)) === '#7c3aed');
  ok('379: Slate keeps its own colours on its card too', paletteFirst(first(slate.files)) !== '#7c3aed');
}
// titles and descriptions
{
  const snap = fullFixture('harbor');
  const id = snap.content.identity, loc = snap.content.locations[0];
  const town = `${loc.city}, ${loc.region}`;
  id.seo_title = '';
  id.story = 'Luis Arroyo started Copper Line in 2009 with one van. Every plumber on the team is licensed.';
  const own = snap.content.settings.pages[0];
  own.blocks = [{ type: 'text', title: 'How we work', body: 'We quote **before** we start, and we clean up after ourselves every time.' }, ...own.blocks];
  const files = await draw(snap);
  ok('379: with no title of the owner’s, the home title names the town', titleOf(files['index.html']) === `${id.business_name.replaceAll('&', '&amp;')} | ${town}`, titleOf(files['index.html']));
  const offer = Object.keys(files).find((k) => /^(services|menu|classes|products)\/index\.html$/.test(k));
  ok('379: the offerings title names the town', titleOf(files[offer]).endsWith(`, ${town}`), titleOf(files[offer]));
  ok('379: About describes itself from the story, not the home page’s words', descOf(files['about/index.html']) === 'Luis Arroyo started Copper Line in 2009 with one van. Every plumber on the team is licensed.' && descOf(files['about/index.html']) !== descOf(files['index.html']));
  ok('379: an own page describes itself in its own words', descOf(files[`${own.slug}/index.html`]) === 'We quote before we start, and we clean up after ourselves every time.', descOf(files[`${own.slug}/index.html`]));
  snap.content.settings.page_seo = { about: { description: 'The owner’s own words.' } };
  id.seo_title = 'Plumber in Glendale';
  const f2 = await draw(snap);
  ok('379: the owner’s own title and description still win', titleOf(f2['index.html']) === 'Plumber in Glendale' && descOf(f2['about/index.html']) === 'The owner’s own words.');
  const long = { ...snap }; long.content = { ...snap.content, settings: { ...snap.content.settings, page_seo: {} }, identity: { ...id, story: 'word '.repeat(80) } };
  const f3 = await draw(long);
  ok('379: a long story is cut at a word near 155 characters', descOf(f3['about/index.html']).length <= 156 && descOf(f3['about/index.html']).endsWith('word…'));
}
// the head: the card's size only when the card is what is shared
{
  const c = { identity: { business_name: 'Shop' }, settings: {} };
  const h = seoHead({ title: 't', description: 'd', path: '/x/', ld: [], ogImage: '/assets/share-1.png', ogImageSize: [1200, 630], shareImage: '/img/own-1600.webp' }, SITE, c, {}, '', '/a.css');
  ok('379: an owner’s own share picture for a page carries no card size', metas(h, 'og:image')[0] === `${SITE.baseUrl}/img/own-1600.webp` && !metas(h, 'og:image:width').length);
}

// ═══ Part B · item 383: what Google is told ═══
{
  const snap = fullFixture('harbor');
  const files = await draw(snap);
  const biz = ldOf(files['contact/index.html'])[0];
  ok('383: the business node carries the site’s picture', biz.image === metas(files['index.html'], 'og:image')[0], `${biz.image}`);
  ok('383: no map point without the owner’s Google Maps link', biz.geo === undefined);
  const priced = fullFixture('harbor');
  priced.content.offerings = [
    { id: 'o1', name: 'Drain cleaning', category: 'Drains', description: '', price_text: '$145', media: null, sort_order: 1 },
    { id: 'o2', name: 'Water heater', category: 'Heaters', description: '', price_text: 'From $1,200', media: null, sort_order: 2 },
    { id: 'o3', name: 'Leak check', category: 'Leaks', description: '', price_text: '$89.50 a visit', media: null, sort_order: 3 },
    { id: 'o4', name: 'Estimate', category: 'Leaks', description: '', price_text: 'Free', media: null, sort_order: 4 },
  ];
  priced.content.identity.social = { ...(priced.content.identity.social || {}), google_maps: 'https://www.google.com/maps/place/Copper+Line/@34.1425,-118.2551,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d34.1426071!4d-118.2550032!16s' };
  const f2 = await draw(priced);
  const b2 = ldOf(f2['contact/index.html'])[0];
  ok('383: the price range is the site’s own lowest to highest price', b2.priceRange === '$89.50-$1,200', b2.priceRange);
  ok('383: the map point is the place’s pin from the owner’s Google Maps link', b2.geo?.latitude === 34.142607 && b2.geo?.longitude === -118.255003, JSON.stringify(b2.geo));
  ok('383: the home page tells the same', JSON.stringify(ldOf(f2['index.html'])[0].geo) === JSON.stringify(b2.geo) && ldOf(f2['index.html'])[0].priceRange === b2.priceRange);
  priced.content.offerings = priced.content.offerings.map((o) => ({ ...o, price_text: o.id === 'o1' ? '£40' : o.price_text }));
  priced.content.locations[0].goes_to_customers = true;
  const f3 = await draw(priced);
  const b3 = ldOf(f3['contact/index.html'])[0];
  ok('383: prices in two currencies give no range', b3.priceRange === undefined);
  ok('383: a business that goes to its customers gives no map point (its base may be a home)', b3.geo === undefined);
  const other = fullFixture('harbor'); other.content.identity.social = { google_maps: 'https://maps.app.goo.gl/abc123' };
  ok('383: a short link with no point in it gives none (nothing guessed)', ldOf((await draw(other))['contact/index.html'])[0].geo === undefined);
  const view = fullFixture('harbor'); view.content.identity.social = { google_maps: 'https://www.google.com/maps/@34.1,-118.2,15z' };
  ok('383: a map view that isn’t the place gives none', ldOf((await draw(view))['contact/index.html'])[0].geo === undefined);
}
{
  const wall = (reviews, extra = {}) => [{ type: 'reviews_wall', title: 'Reviews', reviews, aggregate: { count: 7, average: 4.6 }, ...extra }];
  const s = reviewsSchema(wall([
    { author: 'Dana R.', rating: 5, body: 'Fixed our leak in an hour.', date: '2026-10-02' },
    { author: UNNAMED_REVIEWER, rating: 4, body: 'Quick and tidy.' },
    { author: 'Sam K.', rating: 4, body: 'Fair price.' },
  ]));
  ok('383: the average and count are the ones the wall prints', s.aggregateRating.ratingValue === 4.6 && s.aggregateRating.reviewCount === 7);
  ok('383: a review with no name is left out of the list, never given one', s.review.length === 2 && s.review.every((r) => r.author.name !== UNNAMED_REVIEWER));
  ok('383: a review’s date only when it has one', s.review[0].datePublished === '2026-10-02' && !('datePublished' in s.review[1]));
  const none = reviewsSchema(wall([{ author: UNNAMED_REVIEWER, rating: 5, body: 'Great.' }]));
  ok('383: with only unnamed reviews, the rating stays and no list is told', none.aggregateRating && !('review' in none));
  const promise = /star ratings? (?:for|in) (?:search|google)|stars? (?:in|on) google|help you show up in search|rich result/i;
  ok('383: the help answer promises no stars in Google', !promise.test(HELP_TOPICS.find((t) => t.id === 'reviews').a) && /no stars/.test(HELP_TOPICS.find((t) => t.id === 'reviews').a));
  ok('383: the sections list promises no star rich result', COMPONENTS.filter((c) => /review/.test(c.key)).every((c) => !/honest star ratings for rich results/.test(c.purpose)));
  const editor = await editorSource();
  ok('383: no words in the editor promise stars in search', !/honest star ratings for search|star ratings that help you show up in search/.test(editor));
}

// ═══ Part C · item 291: booking hours and the days a visitor can pick ═══
const HOURS = [
  { day: 'mon', closed: false, intervals: [{ open: '09:00', close: '17:00' }] },
  { day: 'tue', closed: false, intervals: [{ open: '09:00', close: '12:00' }, { open: '13:00', close: '17:00' }] },
  { day: 'wed', closed: true, intervals: [] },
  { day: 'thu', closed: false, intervals: [{ open: '09:00', close: '17:00' }] },
  { day: 'fri', closed: false, intervals: [{ open: '18:00', close: '02:00' }] },
  { day: 'sat', closed: false, intervals: [{ open: 'late', close: '17:00' }] },
  { day: 'sun', closed: false, intervals: [{ open: '10:00', close: '18:00' }] },
];
const HOLIDAYS = [{ date: '2026-11-26', label: 'Thanksgiving', closed: true }, { date: '2026-12-24', label: 'Christmas Eve', closed: false, intervals: [{ open: '09:00', close: '12:00' }] }];
{
  const h = B.bookingHoursFromBusiness(HOURS, HOLIDAYS);
  ok('291: the business week becomes the booking week (Sunday first)', JSON.stringify(h.weekly[1]) === '[{"start":"09:00","end":"17:00"}]' && h.weekly[2].length === 2 && JSON.stringify(h.weekly[0]) === '[{"start":"10:00","end":"18:00"}]');
  ok('291: a closed day takes no bookings; a time past midnight stops at midnight; a bad time is left out', h.weekly[3].length === 0 && JSON.stringify(h.weekly[5]) === '[{"start":"18:00","end":"23:59"}]' && h.weekly[6].length === 0);
  ok('291: a closed holiday is a closed date; a short holiday keeps its own hours', h.closed_dates.join() === '2026-11-26' && JSON.stringify(h.date_hours['2026-12-24']) === '[{"start":"09:00","end":"12:00"}]');
  ok('291: a week with no booking hours follows the business hours; one with any does not', B.followsBusinessHours([[], [], [], [], [], [], []]) && !B.followsBusinessHours([[], [{ start: '09:00', end: '10:00' }], [], [], [], [], []]));
  const cfg = { ...B.normalizeBookingConfig({ lead_time_hours: 0, max_days_ahead: 60, slot_interval_min: 30 }), ...h };
  ok('291: on a short holiday only its own hours are offered', B.generateSlots({ date: '2026-12-24', config: cfg, duration_min: 60, now_local: '2026-11-22T12:00', booked: [] }).join() === '2026-12-24T09:00,2026-12-24T09:30,2026-12-24T10:00,2026-12-24T10:30,2026-12-24T11:00');
  const days = (now, extra = {}) => B.openDays({ from: '2026-11-01', to: '2026-11-30', config: cfg, duration_min: 30, now_local: now, taken: () => [], ...extra });
  const late = days('2026-11-22T17:30');   // a Sunday, open 10 to 6
  ok('291: today is open until its last open time (5:30 for half an hour, closing at 6)', late.today === '2026-11-22' && late.open[0] === '2026-11-22' && late.next === '2026-11-22T17:30', JSON.stringify(late).slice(0, 200));
  const gone = days('2026-11-22T17:31');
  ok('291: after the last time, today is not offered and the next opening is tomorrow’s first', gone.open[0] === '2026-11-23' && gone.next === '2026-11-23T09:00');
  ok('291: past days, closed days and closed holidays are not offered', !late.open.includes('2026-11-21') && !late.open.includes('2026-11-25') && !late.open.includes('2026-11-26') && late.open.includes('2026-11-27'));
  const full = days('2026-11-22T17:30', { taken: (d) => (d === '2026-11-22' ? [{ start: '2026-11-22T17:00', end: '2026-11-22T18:00' }] : []) });
  ok('291: a day whose times are all booked is not offered', !full.open.includes('2026-11-22') && full.next === '2026-11-23T09:00');
  const short = B.openDays({ from: '2026-11-01', to: '2026-11-30', config: { ...cfg, max_days_ahead: 5 }, duration_min: 30, now_local: '2026-11-22T12:00', taken: () => [] });
  ok('291: nothing past the booking window', short.last === '2026-11-27' && short.open.every((d) => d <= '2026-11-27'));
  const quiet = B.openDays({ from: '2026-11-01', to: '2026-11-30', config: { ...cfg, weekly: [[], [], [], [], [], [], []], date_hours: {}, closed_dates: [] }, duration_min: 30, now_local: '2026-11-22T12:00', taken: () => [] });
  ok('291: with no hours at all, no day is offered and there is no next opening', !quiet.open.length && quiet.next === null);
  const later = B.openDays({ from: '2026-12-01', to: '2026-12-31', config: cfg, duration_min: 30, now_local: '2026-11-22T12:00', taken: () => [] });
  ok('291: a later month lists its own days, and the next opening is still the first from now', later.open[0] === '2026-12-01' && later.next === '2026-11-22T12:00');
}
// the month the widget loads at the "pick a day" step ships only with a site that takes bookings
{
  const published = async (snap) => { const r = await renderSnapshot(snap, { ...SITE, bookEndpoint: 'https://db.test/functions/v1/presence/book/5e000000-0000-4000-8000-000000000291' }); return r.files || r; };
  const withBooking = await published(fullFixture('harbor')), without = await published(sampleOf('harbor'));
  ok('291: a site with the booking widget ships the month file the widget loads', withBooking[BOOKING_MONTH_PATH.slice(1)] === BOOKING_MONTH_JS && bookingScript().includes(BOOKING_MONTH_PATH));
  ok('291: a site without it ships no month file, and its pages and stylesheet are as before', !(BOOKING_MONTH_PATH.slice(1) in without));
  ok('291: the month file is named by what it holds', /^\/assets\/book-month-[0-9a-f]{16}\.js$/.test(BOOKING_MONTH_PATH));
}
// the routes, on a fake database: a business in Los Angeles at 5:30 pm on Sunday Nov 22, already Monday in UTC
{
  const SID = '5e000000-0000-4000-8000-000000000291', TYPE = 'a1000000-0000-4000-8000-000000000291';
  const LA = 'America/Los_Angeles';
  const seed = (weekly = [[], [], [], [], [], [], []]) => db.reset({
    presence_sites: [{ id: SID, client_id: 'c1000000-0000-4000-8000-000000000291', status: 'ready' }],
    presence_locations: [{ site_id: SID, city: 'Burbank', region: 'CA', timezone: LA, hours: HOURS, holiday_exceptions: HOLIDAYS, created_at: '2026-01-01T00:00:00Z' }],
    presence_booking_settings: [{ site_id: SID, enabled: true, intro: '', weekly, closed_dates: [], slot_interval_min: 30, buffer_min: 0, lead_time_hours: 0, max_days_ahead: 60, timezone: LA, auto_confirm: true }],
    presence_appointment_types: [{ id: TYPE, site_id: SID, name: 'Haircut', duration_min: 30, price_cents: 4000, description: '', active: true, sort_order: 0, deleted_at: null }],
    presence_appointments: [{ id: 'b1000000-0000-4000-8000-000000000291', site_id: SID, type_id: TYPE, slot_start_local: '2026-11-23T09:00', duration_min: 480, status: 'confirmed' }],
  });
  const get = async (fn, path) => (await (await fn(new Request(`https://db.test/functions/v1/presence/book/${SID}/${path}`), SID, {})).json()).data;
  await withClock('2026-11-23T01:30:00Z', async () => {
    seed();
    const types = await get(R.handleBookingTypes, 'types');
    ok('291: the services say today in the business’s own day, not UTC’s', types.today === '2026-11-22', types.today);
    const d = await get(R.handleBookingDays, `days?type=${TYPE}&from=2026-11-01&to=2026-11-30`);
    ok('291: the days follow the business hours (a Sunday evening is open)', d.today === '2026-11-22' && d.open[0] === '2026-11-22' && d.next === '2026-11-22T17:30', JSON.stringify(d).slice(0, 160));
    ok('291: a closed weekday and a closed holiday are not offered, and a fully booked Monday is not', !d.open.includes('2026-11-25') && !d.open.includes('2026-11-26') && !d.open.includes('2026-11-23') && d.open.includes('2026-11-24'));
    const slots = await get(R.handleBookingSlots, `slots?type=${TYPE}&date=2026-11-22`);
    ok('291: the times for today are the business hours’ last ones', slots.slots.join() === '2026-11-22T17:30');
    const bad = await get(R.handleBookingDays, `days?type=${TYPE}&from=2026-11-30&to=2026-11-01`);
    ok('291: a backwards range gives no days', !bad.open.length && bad.next === null);
    const owner = await (await R.handleBookingSettingsGet({ id: SID }, {})).json();
    ok('291: the desk is told the hours follow the business hours, and what they are', owner.data.hours_from === 'business' && JSON.stringify(owner.data.business_weekly[1]) === '[{"start":"09:00","end":"17:00"}]' && owner.data.weekly.every((x) => !x.length));
    seed([[], [{ start: '12:00', end: '13:00' }], [], [], [], [], []]);
    const own = await get(R.handleBookingDays, `days?type=${TYPE}&from=2026-11-01&to=2026-11-30`);
    ok('291: once the owner sets different hours, only those are offered', own.open.join() === '2026-11-30' && own.next === '2026-11-30T12:00', JSON.stringify(own));
    const owner2 = await (await R.handleBookingSettingsGet({ id: SID }, {})).json();
    ok('291: and the desk is told they are the owner’s own', owner2.data.hours_from === 'own' && !('business_weekly' in owner2.data));
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
