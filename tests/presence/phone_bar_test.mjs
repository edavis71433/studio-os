// ── The phone bar: Call, Directions, Hours and Email along the bottom of every page on a phone (builder list item 122, Nov 2026) ──
// One choice turns it on, Light or Dark; it's the style setting phone_bar. This proves:
//   · Off, no choice or a value it doesn't know leaves every page exactly as it was
//   · each button shows only when the business details have something behind it, in the
//     order Call, Directions, Hours, Email, with the right link (an extension isn't dialled)
//   · Hours opens the week, Monday first, written the way the templates write it, or says
//     the business is closed for now; everything the owner typed is escaped
//   · the light bar's icons take the site's accent only when it reads on white
//   · on every template, every page that shows the footer carries the bar once (its style in
//     the head, the bar before the end of the page), a page without the footer is left alone,
//     and it shows on phones only, never on paper
//
//   deno run --allow-read tests/presence/phone_bar_test.mjs
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { applyPhoneBar, phoneBarOf, phoneBarButtons, phoneBarHtml, lightIconColour } from '../../supabase/functions/presence/lib/phone_bar.ts';
import { validateThemeTokens } from '../../supabase/functions/presence/lib/devmode.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const SITE = { baseUrl: 'https://example.test' };
const TEMPLATES = ['business-classic', 'restaurant-classic', 'editorial', 'aurora', 'slate', 'meadow', 'atelier', 'harbor'];
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL  ' + n); } };

const WEEK = [
  { day: 'mon', closed: false, intervals: [{ open: '09:00', close: '17:30' }] },
  { day: 'tue', closed: false, intervals: [{ open: '09:00', close: '12:00' }, { open: '13:00', close: '17:00' }] },
  { day: 'sat', closed: false, intervals: [{ open: '10:00', close: '24:00' }] },
  { day: 'sun', closed: true, intervals: [] },
];
const FULL = {
  identity: { phone: '(555) 010-0100', email: 'hello@marlows.example' },
  locations: [{ address_line1: '12 Mill Lane', address_line2: 'Unit 3', city: 'Burbank', region: 'CA', postal_code: '91502', phone: '', timezone: 'America/Los_Angeles', hours: WEEK }],
};
const keys = (c) => phoneBarButtons(c).map((b) => b.key).join(',');
const href = (c, k) => (phoneBarButtons(c).find((b) => b.key === k) || {}).href;

// the setting
ok('light and dark turn it on; anything else is off', phoneBarOf('light') === 'light' && phoneBarOf('dark') === 'dark' && phoneBarOf('off') === null && phoneBarOf('') === null && phoneBarOf(undefined) === null && phoneBarOf('Dark') === null);
ok('the style setting takes off, light and dark and nothing else', JSON.stringify(validateThemeTokens({ phone_bar: 'dark' }).tokens) === '{"phone_bar":"dark"}'
  && JSON.stringify(validateThemeTokens({ phone_bar: 'off' }).tokens) === '{"phone_bar":"off"}'
  && validateThemeTokens({ phone_bar: 'light;}body{display:none' }).rejected.includes('phone_bar'));

// the buttons
ok('everything filled in: all four, in order', keys(FULL) === 'call,directions,hours,email');
ok('Call dials the number, digits only', href(FULL, 'call') === 'tel:5550100100');
ok('the location’s own number wins, as in the footer', href({ ...FULL, locations: [{ ...FULL.locations[0], phone: '+1 555 010 0199' }] }, 'call') === 'tel:+15550100199');
ok('an extension isn’t dialled', href({ ...FULL, identity: { ...FULL.identity, phone: '555-010-0100 ext. 12' } }, 'call') === 'tel:5550100100'
  && href({ ...FULL, identity: { ...FULL.identity, phone: '555 010 0100 x7' } }, 'call') === 'tel:5550100100');
ok('too short to be a number: no Call', !keys({ ...FULL, identity: { ...FULL.identity, phone: '12-34' } }).includes('call'));
ok('Directions go to the whole address', href(FULL, 'directions') === 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('12 Mill Lane, Unit 3, Burbank, CA 91502'));
ok('no street address (a business that goes to its customers): no Directions', keys({ ...FULL, locations: [{ ...FULL.locations[0], address_line1: ' ' }] }) === 'call,hours,email');
ok('every day closed: no Hours', keys({ ...FULL, locations: [{ ...FULL.locations[0], hours: [{ day: 'mon', closed: true, intervals: [] }] }] }) === 'call,directions,email');
ok('closed for now: Hours says so', keys({ ...FULL, locations: [{ ...FULL.locations[0], hours: [], temporarily_closed: true }] }) === 'call,directions,hours,email');
ok('an email that isn’t one: no Email', !keys({ ...FULL, identity: { ...FULL.identity, email: 'hello at marlows' } }).includes('email'));
ok('nothing filled in: no bar', phoneBarHtml({ identity: {}, locations: [] }) === '' && phoneBarHtml(null) === '' && phoneBarHtml({}) === '');

// the hours tray
const bar = phoneBarHtml(FULL);
const rows = [...bar.matchAll(/<tr data-day="(\w+)"><th scope="row">(\w+)<\/th><td>([^<]*)<\/td><\/tr>/g)].map((m) => m.slice(1).join(' '));
ok('the week, Monday first, every day', rows.length === 7 && rows[0].startsWith('mon Monday') && rows[6].startsWith('sun Sunday'));
ok('times as the templates write them', rows[0] === 'mon Monday 9am–5:30pm' && rows[1] === 'tue Tuesday 9am–12pm, 1pm–5pm' && rows[5] === 'sat Saturday 10am–12am');
ok('a day not given, or closed, says Closed', rows[2] === 'wed Wednesday Closed' && rows[6] === 'sun Sunday Closed');
ok('the tray knows the business’s time zone, for today’s row', bar.includes('data-tz="America/Los_Angeles"'));
ok('Hours is a button that opens the tray, with no page to go to', /<details class="dds-pb-hours"><summary><svg[^>]*>.*?<\/svg>Hours<\/summary><div class="dds-pb-tray"/.test(bar));
const shut = phoneBarHtml({ ...FULL, locations: [{ ...FULL.locations[0], temporarily_closed: true, temporarily_closed_note: 'Back on <b>Monday</b> & ready' }] });
ok('closed for now: the tray says so, with the note escaped', shut.includes('<p class="dds-pb-h">Temporarily closed</p><p>Back on &lt;b&gt;Monday&lt;/b&gt; &amp; ready</p>') && !shut.includes('<table>'));
ok('the links open the phone’s own apps; directions in a new tab', bar.includes('<a href="tel:5550100100">') && bar.includes('<a href="mailto:hello@marlows.example">') && /<a href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=[^"]+" target="_blank" rel="noopener">/.test(bar));
ok('the bar is named for screen readers and its pictures are hidden from them', bar.includes('<nav class="dds-phonebar" aria-label="Call, find or write to us">') && (bar.match(/<svg /g) || []).length === 4 && (bar.match(/aria-hidden="true" focusable="false"/g) || []).length === 4);
ok('a space keeps the end of the page clear of the bar', bar.startsWith('<div class="dds-pb-gap" aria-hidden="true"></div><nav'));

// the light bar's icons
ok('a dark accent colours the icons', lightIconColour('#23635a') === '#23635a' && lightIconColour('#8C3B2E') === '#8c3b2e');
ok('a light accent that wouldn’t read on white gives way to the bar’s ink', lightIconColour('#2dd4bf') === '#1d1b19' && lightIconColour('#ffd400') === '#1d1b19');
ok('short and see-through accents read as their colour; nonsense gives the ink', lightIconColour('#236') === '#223366' && lightIconColour('#23635aff') === '#23635a' && lightIconColour('red') === '#1d1b19' && lightIconColour(undefined) === '#1d1b19');

// the pass
const PAGE = '<!doctype html><html><head><title>x</title></head><body><header class="site"></header><main></main><footer class="site"><p>f</p></footer></body></html>';
const NOFOOT = '<!doctype html><html><head></head><body><main></main></body></html>';
const fm = { 'index.html': PAGE, 'landing/index.html': NOFOOT, 'styles.css': 'body{}', 'img/a.webp': new Uint8Array([1]) };
ok('off, or no choice, or a value it doesn’t know: the very same pages', applyPhoneBar(fm, 'off', FULL) === fm && applyPhoneBar(fm, undefined, FULL) === fm && applyPhoneBar(fm, 'loud', FULL) === fm);
ok('on, with nothing to put on the bar: the very same pages', applyPhoneBar(fm, 'dark', { identity: {}, locations: [] }) === fm);
const on = applyPhoneBar(fm, 'light', FULL, '#23635a');
const h = String(on['index.html']);
ok('a page with the footer gets the style in its head and the bar at its end', h.indexOf('<style id="dds-phonebar-css">') > 0 && h.indexOf('<style id="dds-phonebar-css">') < h.indexOf('</head>') && h.indexOf('<nav class="dds-phonebar"') > h.indexOf('</footer>') && h.indexOf('<nav class="dds-phonebar"') < h.indexOf('</body>'));
ok('the tray’s few lines come with Hours', h.includes('<script id="dds-phonebar-js">') && !String(applyPhoneBar(fm, 'light', { ...FULL, locations: [{ ...FULL.locations[0], hours: [] }] })['index.html']).includes('dds-phonebar-js'));
ok('a page that hides its footer, other files and pictures are left alone', on['landing/index.html'] === NOFOOT && on['styles.css'] === 'body{}' && on['img/a.webp'] === fm['img/a.webp']);
ok('drawn twice, still one bar', (String(applyPhoneBar(on, 'light', FULL)['index.html']).match(/class="dds-phonebar"/g) || []).length === 1);
ok('phones only: hidden by default, shown under 720 pixels, never on paper', h.includes('.dds-phonebar,.dds-pb-gap{display:none}@media screen and (max-width:720px){') && h.includes('@media print{.dds-phonebar,.dds-pb-gap{display:none!important}}'));
ok('light: a white bar, the accent on its icons', h.includes('background:#fff;color:#1d1b19') && h.includes('stroke:#23635a'));
const dk = String(applyPhoneBar(fm, 'dark', FULL, '#23635a')['index.html']);
ok('dark: a dark bar with white words and icons', dk.includes('background:#201b17;color:#fff') && dk.includes('stroke:#fff'));
ok('a draft’s preview banner and comments button move up above it', h.includes('.dds-phonebar~#presence-preview-badge{bottom:calc(64px + env(safe-area-inset-bottom,0px))!important}') && h.includes('.dds-phonebar~#presence-feedback-panel{bottom:'));
const odd = applyPhoneBar({ 'index.html': PAGE }, 'light', { identity: { phone: '555 010 0100', email: 'a$&b$$c@marlows.example' }, locations: [] });
ok('a $ in what the owner typed is written as it is', String(odd['index.html']).includes('mailto:a$&amp;b$$c@marlows.example') && String(odd['index.html']).split('<footer class="site">').length === 2);

// on every template, through the one render entry
for (const slug of TEMPLATES) {
  const fx = JSON.parse(read(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`));
  const plain = await renderSnapshot(fx, SITE);
  const pages = Object.keys(plain).filter((k) => k.endsWith('.html') && String(plain[k]).includes('<footer class="site"'));
  ok(`[${slug}] has pages with the site's footer`, pages.length >= 4);
  ok(`[${slug}] no choice: no bar anywhere`, Object.values(plain).every((v) => typeof v !== 'string' || !v.includes('dds-phonebar')));
  const withTok = (tok) => ({ ...fx, dev_customization: { theme_tokens: tok, custom_css: '', custom_html: '' } });
  const offOut = await renderSnapshot(withTok({ phone_bar: 'off' }), SITE);
  // (every style setting is also written as a variable in the dev layer's style; that's all Off adds)
  ok(`[${slug}] Off: the pages are as with no choice`, pages.every((k) => String(offOut[k]).replace(/<style id="presence-dev">:root\{--phone_bar:off;--phone-bar:off\}<\/style>/, '') === plain[k]));
  for (const v of ['light', 'dark']) {
    const out = await renderSnapshot(withTok({ phone_bar: v }), SITE);
    ok(`[${slug}] ${v}: every page with the footer carries one bar, Call to Email`, pages.every((k) => {
      const p = String(out[k]);
      return (p.match(/<nav class="dds-phonebar"/g) || []).length === 1 && (p.match(/id="dds-phonebar-css"/g) || []).length === 1
        && p.indexOf('id="dds-phonebar-css"') < p.indexOf('</head>') && /Call<\/a><a [^>]*>.*?Directions<\/a><details class="dds-pb-hours">.*?<\/details><a [^>]*>.*?Email<\/a><\/nav>/.test(p);
    }));
  }
  const light = String((await renderSnapshot(withTok({ phone_bar: 'light' }), SITE))[pages[0]]);
  const accent = (/--accent:\s*(#[0-9a-f]{3,8})\b/i.exec(String(plain[pages[0]])) || [])[1];
  ok(`[${slug}] light: icons in the template's accent only where it reads on white`, light.includes('stroke:' + lightIconColour(accent) + ';'));
  const own = String((await renderSnapshot(withTok({ phone_bar: 'light', accent: '#5b3fa0' }), SITE))[pages[0]]);
  ok(`[${slug}] light: the owner's own accent wins`, own.includes('stroke:#5b3fa0;'));
}
// a page that hides the site's footer (page settings, items 48 and 120) has no bar either
{
  const fx = JSON.parse(read('supabase/functions/presence/templates/business-classic/1.0.0/fixture.json'));
  fx.content.settings = { ...(fx.content.settings || {}), pages: [{ slug: 'offers', title: 'Offers', blocks: [{ type: 'richtext', title: 'This week', body: 'Fresh rye' }], noFooter: true }, { slug: 'visit', title: 'Visit', blocks: [{ type: 'richtext', title: 'Find us', body: 'Burbank' }] }] };
  const out = await renderSnapshot({ ...fx, dev_customization: { theme_tokens: { phone_bar: 'dark' }, custom_css: '', custom_html: '' } }, SITE);
  const off = String(out['offers/index.html'] || ''), on = String(out['visit/index.html'] || '');
  ok('a page that hides its footer has no bar; the page beside it has one', off.length > 0 && !off.includes('<footer class="site"') && !off.includes('dds-phonebar') && on.includes('<nav class="dds-phonebar"'));
}
ok('a dark template’s light accent gives way to the ink', String((await renderSnapshot({ ...JSON.parse(read('supabase/functions/presence/templates/slate/1.0.0/fixture.json')), dev_customization: { theme_tokens: { phone_bar: 'light' }, custom_css: '', custom_html: '' } }, SITE))['index.html']).includes('stroke:#1d1b19;'));

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  phone bar — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
if (!done) Deno.exit(1);
