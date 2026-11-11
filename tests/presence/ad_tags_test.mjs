// ── List item 152: ad tags, behind a cookie notice, on a site that has them ──
//   deno run --allow-read --allow-env tests/presence/ad_tags_test.mjs
// The Google tag and the Meta Pixel: their IDs are held to their exact shapes (they are
// written into a script on the live site), every page of a site with one gets the
// notice and a loader that waits for "yes", the privacy page tells the truth about
// it, and a site without them draws byte for byte as before.
const P = '../../supabase/functions/presence';
const { GOOGLE_TAG_RE, META_PIXEL_RE, adTagsOf, adTagsScript, injectAdTags, adCompanies, adTagNames } = await import(`${P}/lib/ad_tags.ts`);
const { renderSnapshot } = await import(`${P}/lib/render.ts`);
const { describeChanges } = await import(`${P}/lib/diff.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));

// ═══ 1. the IDs ═══
{
  for (const id of ['G-ABC123XYZ9', 'AW-1234567890', 'GT-WQ8T5ZK', 'DC-1234567']) ok(`id: ${id} is a Google tag`, GOOGLE_TAG_RE.test(id));
  for (const id of ['g-abc123', 'G-', 'UA-12345-1', "G-ABC';alert(1)//", 'G-ABC123</script>', 'GTM-ABC12345', 'G-ABC 123']) ok(`id: ${JSON.stringify(id)} is not`, !GOOGLE_TAG_RE.test(id));
  for (const id of ['123456789012345', '1234567890123456']) ok(`id: ${id} is a Meta Pixel`, META_PIXEL_RE.test(id));
  for (const id of ['12345', '1234567890123456789012', '12345678901234a', "123456789');x('"]) ok(`id: ${JSON.stringify(id)} is not`, !META_PIXEL_RE.test(id));
  ok('snapshot: an ID that doesn\'t fit is dropped again at render, whatever got stored', adTagsOf({ ad_tags: { google: "G-1';x()//", meta: '<script>' } }) === null);
  ok('snapshot: the good half of a pair stays', JSON.stringify(adTagsOf({ ad_tags: { google: 'G-ABC123XYZ9', meta: 'nope' } })) === JSON.stringify({ google: 'G-ABC123XYZ9' }));
  const content = read('supabase/functions/presence/routes/content.ts');
  ok('save: /settings takes both IDs, each held to its own shape', /google_tag_id: \{ kind: 'google_tag' \}, meta_pixel_id: \{ kind: 'meta_pixel' \}/.test(content) && /\(rule\.kind === 'google_tag' \? GOOGLE_TAG_RE : META_PIXEL_RE\)\.test\(id\)/.test(content));
  ok('save: the settings read and write step down without the 0155 columns, ahead of the older packs', /AD_SETTINGS_COLS = 'google_tag_id,meta_pixel_id'/.test(content) && /OPTIONAL_SETTINGS_COLS = \[(?:[A-Z_]+_SETTINGS_COLS, )*AD_SETTINGS_COLS, (?:[A-Z_]+_SETTINGS_COLS, )*VISIT_SETTINGS_COLS,/.test(content) && /\+ ',' \+ AD_SETTINGS_COLS\b/.test(content));
}

// ═══ 2. the notice and the loader ═══
const BOTH = { google: 'G-ABC123XYZ9', meta: '1234567890123456' };
{
  const tag = adTagsScript(BOTH);
  ok('notice: names who sets the cookies, and links the privacy page', tag.includes('We use cookies from Google and Meta to see how our ads work.') && tag.includes('href="/privacy/"'));
  ok('notice: a plain yes and no', tag.includes('data-consent="yes"') && tag.includes('Yes, that’s fine') && tag.includes('data-consent="no"') && tag.includes('No, thanks'));
  ok('notice: starts hidden, so a visitor who already answered never sees it flash', /<div id="presence-consent"[^>]* hidden /.test(tag));
  ok('loader: nothing loads unless the answer is yes', /var a=get\(\);if\(a==='yes'\)load\(\);else if\(a!=='no'\)show\(true\)/.test(tag) && /if\(v==='yes'\)load\(\)/.test(tag));
  ok('loader: the Google tag and the pixel, from their own addresses', tag.includes("'https://www.googletagmanager.com/gtag/js?id='+G") && tag.includes("'https://connect.facebook.net/en_US/fbevents.js'") && tag.includes("window.fbq('init',M)"));
  ok('loader: the privacy page\'s button brings the notice back', tag.includes("document.getElementById('presence-consent-change')"));
  ok('markup: no inline event handler, as the published pages never carry one', !/<[a-z][a-z0-9]*\b[^>]*\son\w+\s*=/i.test(tag));
  ok('words: one tag or both', adCompanies({ google: 'G-ABC123XYZ9' }) === 'Google' && adCompanies({ meta: '1234567890123456' }) === 'Meta' && adTagNames(BOTH) === 'the Google tag and Meta’s pixel');
  const files = { 'index.html': '<html><body><p>a</p></body></html>', 'about/index.html': '<html><body></body></html>', 'robots.txt': 'x', 'site.css': 'body{}' };
  ok('pages: a site without tags comes back untouched (the same object)', injectAdTags(files, {}) === files);
  const tagged = injectAdTags(files, { ad_tags: BOTH });
  ok('pages: every page gets the notice once, before </body>; other files are left alone', ['index.html', 'about/index.html'].every((k) => (tagged[k].match(/id="presence-ad-tags"/g) || []).length === 1 && tagged[k].includes('</script></body>')) && tagged['robots.txt'] === 'x' && tagged['site.css'] === 'body{}');
  ok('pages: running it twice adds nothing', JSON.stringify(injectAdTags(tagged, { ad_tags: BOTH })) === JSON.stringify(tagged));
}

// ═══ 3. the published site and its privacy page ═══
{
  const fx = JSON.parse(read('supabase/functions/presence/templates/business-classic/1.0.0/fixture.json'));
  fx.template_slug = 'business-classic'; fx.template_version = '1.0.0';
  const SITE = { baseUrl: 'https://example.com', formEndpoint: 'https://fn.example.com/forms/x/submit' };
  const plain = await renderSnapshot(fx, SITE);
  const withTags = structuredClone(fx); withTags.content.settings = { ...(withTags.content.settings || {}), ad_tags: BOTH };
  const t = await renderSnapshot(withTags, SITE);
  const pages = Object.keys(t).filter((k) => k.endsWith('.html'));
  ok('publish: with tags, every page carries the notice', pages.length > 3 && pages.every((k) => String(t[k]).includes('id="presence-ad-tags"') || String(t[k]).includes('http-equiv="refresh"')));
  ok('publish: without tags, no page does', Object.keys(plain).filter((k) => k.endsWith('.html')).every((k) => !String(plain[k]).includes('presence-ad-tags')));
  const pv = String(t['privacy/index.html']);
  ok('privacy: no longer claims there are no cookies or no banner', !pv.includes('sets <strong>no cookies</strong>') && !pv.includes('no cookie banner'));
  ok('privacy: says it asks first, what loads, who sees what, and that no means nothing loads', pv.includes('This website asks before it uses any cookies.') && pv.includes('it loads the Google tag and Meta’s pixel') && pv.includes('Google and Meta can see which pages you open here') && pv.includes('If you say no, or don’t answer, none of it loads.'));
  ok('privacy: carries the button that brings the notice back', pv.includes('<button type="button" id="presence-consent-change">Change your cookie choice</button>'));
  ok('privacy: the visit counter is still described as it is', pv.includes('It counts its own visits'));
  const one = structuredClone(fx); one.content.settings = { ...(one.content.settings || {}), ad_tags: { google: 'G-ABC123XYZ9' }, visit_counter: false };
  const pv1 = String((await renderSnapshot(one, SITE))['privacy/index.html']);
  ok('privacy: one tag, and the counter off: the right names, and nothing counted', pv1.includes('it loads the Google tag, which sets cookies') && pv1.includes('Google can see which pages') && pv1.includes('under its own privacy policy') && pv1.includes('Apart from that, this website does not count or track visits.'));
  ok('privacy: without tags, the page is as it was', String(plain['privacy/index.html']).includes('sets <strong>no cookies</strong>') && !String(plain['privacy/index.html']).includes('presence-consent-change'));
  const on = describeChanges(withTags.content, fx.content).changes.map((c) => c.sentence);
  const off = describeChanges(fx.content, withTags.content).changes.map((c) => c.sentence);
  ok('changes: adding the tags is a change to publish, in words', on.includes('Your site asks visitors about cookies and, for those who say yes, loads the Google tag and Meta’s pixel. Its privacy page says so.'));
  ok('changes: taking them off is too', off.includes('Your site stops loading ad tags and stops asking visitors about cookies.'));
  ok('changes: nothing to say when neither changes', !describeChanges(fx.content, structuredClone(fx.content)).changes.some((c) => /ad tags|cookies/.test(c.sentence)));
  ok('snapshot: only a set tag reaches the snapshot', /\.\.\.\(settings\.google_tag_id \|\| settings\.meta_pixel_id \? \{ ad_tags:/.test(read('supabase/functions/presence/lib/serializer.ts')));
}

// ═══ 4. the migration and its apply pack ═══
for (const [name, src] of [['migration 0155', read('supabase/migrations/0155_ad_tags.sql')], ['apply pack 0155', read('docs/presence/APPLY-0155-prod.sql')]]) {
  ok(`${name}: adds both IDs, empty by default`, /add column if not exists google_tag_id text not null default '';/.test(src) && /add column if not exists meta_pixel_id text not null default '';/.test(src));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ AD TAGS (item 152): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
