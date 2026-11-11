// ── Builder list item 148: one calm pop-up per site, and forms that open from a button ──
//   deno run --allow-read --allow-env --allow-net tests/presence/popup_test.mjs
// Part A: the setting is made safe and complete (off unless it can show; times, pages,
// dates and button links held to what's allowed). Part B: a publish draws it on exactly
// the pages it should, with its timing rules, the sign-up box (which brings the page's
// sender) or its buttons, every script valid, hostile words only words, and nothing at all
// while it's off. Part C: a "#form-<id>" link opens that form in a dialog, or goes to it on
// its own page. Part D: the publish summary, the saved setting, the editor's card, the
// database step. The browser half is tests/e2e/popup.spec.ts.
Deno.env.set('SUPABASE_URL', 'https://db.test');

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const { normalizePopup, popupHref, injectPopup, POPUP_PAGE_KEYS } = await import('../../supabase/functions/presence/lib/popup.ts');
const { popupTags, POPUP_AGAIN_DAYS, FORM_LINK_SCRIPT, senderTag, signupForm } = await import('../../supabase/functions/presence/lib/site_send.ts');
const { safeHref } = await import('../../supabase/functions/presence/lib/markdown.ts');
const { renderSnapshot } = await import('../../supabase/functions/presence/lib/render.ts');
const { describeChanges } = await import('../../supabase/functions/presence/lib/diff.ts');
const { fullFixture, PAGE } = await import('./full_fixture.mjs');

// ═══ A · the setting ═══
const BASE = { on: true, heading: '10% off your first visit', text: 'Join our list and we’ll send the code.', action: 'signup' };
ok('off, or nothing to say, is no pop-up', normalizePopup(null) === null && normalizePopup({ ...BASE, on: false }) === null && normalizePopup({ ...BASE, heading: '  ' }) === null && normalizePopup('on') === null);
ok('buttons with nothing usable is no pop-up', normalizePopup({ ...BASE, action: 'buttons', buttons: [{ label: 'Go', url: 'javascript:alert(1)' }, { label: '', url: '/x/' }] }) === null);
{
  const p = normalizePopup(BASE);
  ok('the defaults: after 8 seconds, every page, a week away once closed, phones too, no dates', p && p.after === 'seconds' && p.seconds === 8 && p.pages === 'all' && p.again === 'week' && p.phones === true && p.from === '' && p.until === '' && p.buttons.length === 0);
  const q = normalizePopup({ ...BASE, seconds: 999, scroll: 1, after: 'scroll', again: 'forever', pages: 'pick', picked: ['about', 'page:our-work', 'admin', '<x>'], from: '2026-12-01', until: 'soon', heading: 'x'.repeat(200), text: 'y'.repeat(500) });
  ok('held to what’s allowed: 3 to 60 seconds, 10 to 90 %, known page keys, real dates, short words', q.seconds === 60 && q.scroll === 10 && q.again === 'week' && JSON.stringify(q.picked) === '["about","page:our-work"]' && q.from === '2026-12-01' && q.until === '' && q.heading.length === 80 && q.text.length === 240);
  ok('“These pages” with none picked shows on every page', normalizePopup({ ...BASE, pages: 'pick', picked: [] }).pages === 'all');
  const b = normalizePopup({ ...BASE, action: 'buttons', buttons: [{ label: 'Book now', url: '/book/' }, { label: 'Call', url: 'tel:5551234567' }, { label: 'Third', url: '/x/' }] });
  ok('one or two buttons, never three', b.buttons.length === 2 && b.buttons[1].url === 'tel:5551234567');
}
ok('button links: a page, https, tel, mailto or a form; nothing else', popupHref('/contact/') === '/contact/' && popupHref('https://x.example') === 'https://x.example' && popupHref('mailto:a@b.co') === 'mailto:a@b.co' && popupHref('#form-quote') === '#form-quote' && popupHref('//evil.example') === null && popupHref('javascript:alert(1)') === null && popupHref('#form-<x>') === null);
ok('a "#form-<id>" link is safe anywhere a link is (and other fragments aren’t)', safeHref('#form-quote') === '#form-quote' && safeHref('#form-Quote') === null && safeHref('#top') === null);
ok('the pages a pop-up can be put on', JSON.stringify(POPUP_PAGE_KEYS) === '["home","offerings","about","faq","contact","updates"]');

// ═══ B · what a publish draws ═══
const SID = '5e000000-0000-4000-8000-000000000001';
const EP = `https://db.test/functions/v1/presence/forms/${SID}/submit`;
const SITE = { baseUrl: 'https://shop.example', formEndpoint: EP, bookEndpoint: `https://db.test/functions/v1/presence/book/${SID}` };
const withPopup = (popup, slug = 'harbor') => { const fx = fullFixture(slug); fx.content.settings = { ...fx.content.settings, popup }; return fx; };
const pagesWith = (files, needle) => Object.keys(files).filter((k) => k.endsWith('.html') && String(files[k]).includes(needle)).sort();
const parses = (code) => { try { new Function(code); return true; } catch { return false; } };
{
  const files = await renderSnapshot(withPopup(normalizePopup(BASE)), SITE);
  const on = pagesWith(files, 'id="ps-pop"');
  ok('every page: all the site’s pages', on.includes('index.html') && on.includes('about/index.html') && on.includes(`${PAGE.slug}/index.html`) && on.includes('contact/index.html'), on.join(','));
  ok('…but never the thank-you, “didn’t send”, privacy, accessibility, search or missing page', ['thanks/index.html', 'not-sent/index.html', 'privacy/index.html', 'accessibility/index.html', 'search/index.html', '404.html'].every((k) => !String(files[k] || '').includes('id="ps-pop"')));
  ok('…once per page, before </body>', on.every((k) => String(files[k]).split('id="ps-pop"').length === 2 && String(files[k]).indexOf('id="ps-pop"') < String(files[k]).lastIndexOf('</body>')));
  ok('the sign-up box in it posts to the site’s form address, so the page carries the sender too', String(files['about/index.html']).includes(signupForm('ps-pop-nl', EP, 'Sign up')) && String(files['about/index.html']).includes(senderTag(EP)));
  const bad = Object.entries(files).filter(([k]) => k.endsWith('.html')).flatMap(([k, v]) => [...String(v).matchAll(/<script>([\s\S]*?)<\/script>/g)].filter((m) => !parses(m[1])).map(() => k));
  ok('every inline script on every page is valid code', bad.length === 0, bad.slice(0, 3).join(','));
  const off = await renderSnapshot(withPopup(null), SITE), none = await renderSnapshot(fullFixture('harbor'), SITE);
  ok('off: every page is byte for byte as without one', Object.keys(none).every((k) => off[k] === none[k] || (k.startsWith('assets/') && typeof none[k] !== 'string')) && !Object.values(off).some((v) => typeof v === 'string' && v.includes('ps-pop')));
}
{
  const home = await renderSnapshot(withPopup(normalizePopup({ ...BASE, pages: 'home' })), SITE);
  ok('the home page only', JSON.stringify(pagesWith(home, 'id="ps-pop"')) === '["index.html"]');
  const pick = await renderSnapshot(withPopup(normalizePopup({ ...BASE, pages: 'pick', picked: ['about', 'offerings', `page:${PAGE.slug}`] }), 'business-classic'), SITE);
  const off = 'services/index.html';
  ok('these pages: About, the offerings page (by its own name) and an owner’s page', JSON.stringify(pagesWith(pick, 'id="ps-pop"')) === JSON.stringify(['about/index.html', `${PAGE.slug}/index.html`, off].sort()), pagesWith(pick, 'id="ps-pop"').join(','));
}
{
  const p = normalizePopup({ ...BASE, after: 'scroll', scroll: 60, again: 'month', phones: false, from: '2026-12-01', until: '2026-12-24' });
  const tag = popupTags(p, EP);
  const cfg = JSON.parse(tag.match(/var C=(\{[^\n]*\});/)[1]);
  ok('its rules ride with it: scroll 60 %, a month away, no phones, the dates', cfg.after === 'scroll' && cfg.scroll === 60 && cfg.againDays === 30 && POPUP_AGAIN_DAYS.month === 30 && POPUP_AGAIN_DAYS.two_weeks === 14 && cfg.phones === false && cfg.from === '2026-12-01' && cfg.until === '2026-12-24');
  const k1 = cfg.key, k2 = JSON.parse(popupTags({ ...p, scroll: 30 }, EP).match(/var C=(\{[^\n]*\});/)[1]).key, k3 = JSON.parse(popupTags({ ...p, heading: 'A new offer' }, EP).match(/var C=(\{[^\n]*\});/)[1]).key;
  ok('a closed pop-up stays closed while it says the same; new words show again', k1 === k2 && k1 !== k3);
  ok('a native dialog with a heading for its name and a Close button', tag.startsWith('<dialog id="ps-pop" class="ps-pop" aria-labelledby="ps-pop-h">') && tag.includes('<h2 id="ps-pop-h">10% off your first visit</h2>') && tag.includes('aria-label="Close"'));
  ok('…it never opens over another dialog or a cookie choice still waiting (list item 152), and remembers a close, a button used and a sign-up anywhere on the site', tag.includes("var cc=document.getElementById('presence-consent');if(document.querySelector('dialog[open]')||(cc&&!cc.hidden))return;") && tag.includes("r.closed=Date.now()") && tag.includes("addEventListener('ps-sent'") && senderTag(EP).includes("new CustomEvent('ps-sent',{bubbles:true})"));
  const hostile = popupTags(normalizePopup({ on: true, heading: '<img src=x onerror=alert(1)>', text: '</dialog><script>alert(1)</script>', action: 'buttons', buttons: [{ label: '"><script>x</script>', url: '/a/' }, { label: 'b', url: 'javascript:alert(1)' }] }), EP);
  ok('hostile words are only words; a hostile link is dropped', !/<img|<script>alert|<script>x/.test(hostile.replace(/<script>\(function[\s\S]*?<\/script>/g, '')) && !hostile.includes('javascript:') && (hostile.match(/class="btn/g) || []).length === 1);
}

// ═══ C · a form that opens from a button ═══
{
  const fx = fullFixture('harbor');
  fx.content.settings.blocks = [...fx.content.settings.blocks, { type: 'cta', text: 'Need a quote?', button: 'Get a quote', url: '#form-contact' }, { type: 'cta', text: 'Nope', button: 'Gone', url: '#form-missing' }];
  const files = await renderSnapshot(fx, SITE);
  const home = String(files['index.html']);
  ok('a banner’s “#form-contact” link draws as a link', home.includes('href="#form-contact"'));
  ok('…the page gets that form in a dialog, sending like any form, and the one link script', home.includes('<dialog id="form-contact" class="ps-pop ps-pop-form"') && home.includes(`id="presence-form-contact" class="card presence-form" method="post" action="${EP}"`) && home.split(FORM_LINK_SCRIPT).length === 2 && home.includes(senderTag(EP)));
  ok('…a link to a form that isn’t there opens nothing', !home.includes('id="form-missing"'));
  const own = String(files[`${PAGE.slug}/index.html`]);
  const fx2 = fullFixture('harbor');
  fx2.content.settings.pages[0].blocks = [...fx2.content.settings.pages[0].blocks, { type: 'cta', text: 'Ask us', button: 'Ask', url: '#form-contact' }];
  const own2 = String((await renderSnapshot(fx2, SITE))[`${PAGE.slug}/index.html`]);
  ok('on the page that already shows the form, the link goes to it: no second copy', !own.includes('id="form-contact"') && own2.includes('href="#form-contact"') && !own2.includes('<dialog id="form-contact"') && own2.split('id="presence-form-contact"').length === 2 && own2.includes(FORM_LINK_SCRIPT));
  ok('the link script is valid code', parses(FORM_LINK_SCRIPT.replace(/^<script>|<\/script>$/g, '')));
}

// ═══ D · the summary, the setting, the editor, the database step ═══
{
  const fx = fullFixture('harbor');
  const said = (d, l) => describeChanges(d, l).changes.filter((c) => /pop-up/.test(c.sentence)).map((c) => c.sentence);
  const withP = structuredClone(fx.content); withP.settings.popup = normalizePopup(BASE);
  const changed = structuredClone(withP); changed.settings.popup = { ...withP.settings.popup, heading: 'New' };
  ok('the publish summary says when the pop-up arrives, changes or goes', JSON.stringify(said(withP, fx.content)) === '["Your site gets its pop-up."]' && JSON.stringify(said(changed, withP)) === '["The pop-up is changed."]' && JSON.stringify(said(fx.content, withP)) === '["The pop-up comes off your site."]' && said(withP, withP).length === 0);
  const ser = read('supabase/functions/presence/lib/serializer.ts'), content = read('supabase/functions/presence/routes/content.ts');
  ok('the saved setting: a small object, read only when the database has it, made safe at publish', content.includes("popup: { kind: 'json', json: { bytes: 8 * KB, shape: 'object' } }") && content.includes("const OPTIONAL_SETTINGS_COLS = [POPUP_SETTINGS_COLS,") && ser.includes('...(normalizePopup(settings.popup) ? { popup: normalizePopup(settings.popup)! } : {}),'));
  const ed = read('presence.html'), card = read('popup-card.js');
  ok('editor: the pop-up card under the announcement bar’s, saving with the rest of Settings', ed.includes('s.src = "/popup-card.js?v=1"') && ed.includes('save: (popup) => settingsPut({ popup })') && card.includes('window.DDSPopupCard = { mount }') && card.includes('Show a pop-up on your website'));
  ok('editor: each form says the link that opens it from a button', ed.includes('"To open this form from any button or banner, give it the link #form-" + form.id'));
  const mig = read('supabase/migrations/0161_popup.sql'), pack = read('docs/presence/APPLY-0161-prod.sql');
  ok('migration 0161: one column, safe to run twice, the only 0161', [mig, pack].every((s) => s.includes('alter table public.presence_settings add column if not exists popup jsonb;')) && pack.includes('-- Check:') && [...Deno.readDirSync(new URL('supabase/migrations/', ROOT))].filter((e) => e.name.startsWith('0161_')).length === 1);
}

// ═══ the privacy page says what the pop-up keeps (after list item 138's rewrite) ═══
{
  const { privacyBody } = await import('../../supabase/functions/presence/lib/legal_pages.ts');
  const facts = (settings) => ({ identity: { business_name: 'Marlow Salon', email: 'hello@salon.example' }, locations: [], settings: { blocks: [], pages: [], ...settings } });
  const POP = { on: true, heading: '10% off', action: 'signup' };
  const NOTE = 'your browser keeps a small note that you’ve seen it, so it doesn’t come back too soon. The note stays on your device: it isn’t a cookie, and it’s never sent to us.';
  const on = privacyBody(facts({ popup: POP }), '2026-11-11', { formEndpoint: EP });
  const offCount = privacyBody(facts({ popup: POP, visit_counter: false }), '2026-11-11', { formEndpoint: EP });
  ok('privacy: with a pop-up on, the page says what it keeps on the visitor’s device, and no longer that nothing is', on.includes(NOTE) && !on.includes('stores nothing on your device') && offCount.includes(NOTE) && !offCount.includes('stores nothing on your device') && offCount.includes('does not count or track visits'));
  ok('privacy: a pop-up with the "Join our list" box counts as the email list', on.includes('<h2>Our email list</h2>') && !privacyBody(facts({ popup: { ...POP, action: 'buttons', buttons: [{ label: 'Book', url: '/book/' }] } }), '2026-11-11', { formEndpoint: EP }).includes('<h2>Our email list</h2>'));
  const none = privacyBody(facts({}), '2026-11-11', { formEndpoint: EP }), switchedOff = privacyBody(facts({ popup: { ...POP, on: false } }), '2026-11-11', { formEndpoint: EP });
  ok('privacy: with no pop-up (or one switched off), the words are as before', !none.includes('pop-up') && none.includes('stores nothing on your device') && !switchedOff.includes('pop-up'));
  const tagged = privacyBody(facts({ popup: POP, ad_tags: { google: 'G-ABC1234567' } }), '2026-11-11', { formEndpoint: EP });
  const taggedOff = privacyBody(facts({ popup: POP, ad_tags: { google: 'G-ABC1234567' }, visit_counter: false }), '2026-11-11', { formEndpoint: EP });
  ok('privacy: beside the ad tags’ cookie paragraphs (counter on or off), the pop-up’s note is said once', tagged.includes('loads the Google tag') && tagged.split(NOTE).length === 2 && taggedOff.includes('loads the Google tag') && taggedOff.split(NOTE).length === 2);
}

// ═══ a restore brings the pop-up back as the version had it (after builder list item 187) ═══
{
  const { draftSettingsOf, settingsFromContent, settingsBack } = await import('../../supabase/functions/presence/lib/draft_settings.ts');
  const { SETTINGS_CONTENT_FIELDS } = await import('../../supabase/functions/presence/lib/site_roles.ts');
  const STORED = { ...BASE, on: false, seconds: 20 };   // set up, then switched off: kept as stored all the same
  const SHOWN = normalizePopup(BASE);
  const idOf = () => null;
  ok('restore: the pop-up is website content, so a version keeps it', SETTINGS_CONTENT_FIELDS.has('popup') && JSON.stringify(draftSettingsOf({ popup: STORED }).popup) === JSON.stringify(STORED) && draftSettingsOf(null).popup === null);
  ok('restore: an older version rebuilds it from what it showed: its pop-up, or none', JSON.stringify(settingsFromContent({ popup: SHOWN }, idOf).popup) === JSON.stringify(SHOWN) && settingsFromContent({}, idOf).popup === null);
  ok('restore: it goes back as kept, and a version kept before it existed has none', JSON.stringify(settingsBack({ popup: STORED }, new Set(), new Set()).popup) === JSON.stringify(STORED) && settingsBack({}, new Set(), new Set()).popup === null);
}

const passed = results.filter(Boolean).length;
console.log(`\n════ POP-UP (item 148): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
