// ── Search preview + three-question setup — pure logic gate (benchmark item 4) ─
// presence.html's Business view shows how the home page (and each page with its
// own wording) reads on Google, with the 60/160 counters, and a three-question
// setup that writes a headline, a description and the "where you work" line.
// This gate EXTRACTS the pure helpers from presence.html's inline script by name
// (the same way design_canvas_test does) and pins them 1:1 — so the page's own
// code is what is tested, and a drift in the wording rules fails here first.
// Pure filesystem; no DOM, no network.
//
//   deno run --allow-read tests/presence/seo_setup_test.mjs
const ROOT = new URL('../../', import.meta.url);
const html = await Deno.readTextFile(new URL('presence.html', ROOT));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}
// the caps the helpers close over — read from the page, so a cap change is a visible diff here
const caps = html.match(/const SEO_TITLE_MAX = (\d+), SEO_DESC_MIN = (\d+), SEO_DESC_MAX = (\d+);/);
if (!caps) throw new Error('SEO caps line not found in presence.html');
const PRELUDE = `const SEO_TITLE_MAX = ${caps[1]}, SEO_DESC_MIN = ${caps[2]}, SEO_DESC_MAX = ${caps[3]};\n`
  + ['seoSplit', 'seoList', 'seoCut', 'seoCounter'].map((n) => extractFn(html, n)).join('\n') + '\n';
const load = (name) => new Function(PRELUDE + extractFn(html, name) + `\nreturn ${name};`)();
const seoSplit = load('seoSplit'), seoList = load('seoList'), seoCut = load('seoCut'), seoCounter = load('seoCounter');
const seoSuggest = load('seoSuggest'), seoPageDefault = load('seoPageDefault'), seoCrumb = load('seoCrumb');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  FAIL → ' + msg); } };
const eq = (a, b, msg) => ok(a === b, msg + ' — got ' + JSON.stringify(a));

// ═══ the caps are Google's: 60 for a headline, 50–160 for a description ═══
eq(caps[1], '60', 'title cap is 60'); eq(caps[2], '50', 'description floor is 50'); eq(caps[3], '160', 'description cap is 160');

// ═══ seoSplit — commas, semicolons, newlines; trimmed; deduped without case ═══
ok(JSON.stringify(seoSplit('Burbank, Glendale; Pasadena')) === '["Burbank","Glendale","Pasadena"]', 'split on , and ;');
ok(JSON.stringify(seoSplit(' burbank ,Burbank,\nGlendale ')) === '["burbank","Glendale"]', 'dedupes case-insensitively, keeps the first spelling');
ok(JSON.stringify(seoSplit('')) === '[]' && JSON.stringify(seoSplit(null)) === '[]', 'empty in → empty out');
ok(JSON.stringify(seoSplit('Italian   restaurant')) === '["Italian restaurant"]', 'inner whitespace collapses');

// ═══ seoList — plain English joins ═══
eq(seoList([]), '', 'no items → empty');
eq(seoList(['Burbank']), 'Burbank', 'one item');
eq(seoList(['Burbank', 'Glendale']), 'Burbank and Glendale', 'two items');
eq(seoList(['a', 'b', 'c']), 'a, b and c', 'three items');

// ═══ seoCut — Google's cut: at a word, then " ...", only when over ═══
eq(seoCut('short', 60), 'short', 'under the cap is untouched');
eq(seoCut('  spaced   out  ', 60), 'spaced out', 'whitespace collapses');
{
  const long = 'Marlow’s Kitchen — Italian restaurant, catering and private events in Burbank';
  const cut = seoCut(long, 60);
  ok(cut.length <= 60, 'cut fits the cap (' + cut.length + ')');
  ok(cut.endsWith(' ...'), 'cut ends with " ..."');
  ok(long.startsWith(cut.slice(0, -4)), 'cut is a prefix at a word boundary');
  ok(!/[,—-] \.\.\.$/.test(cut), 'no dangling punctuation before the dots');
}
eq(seoCut('abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnop', 60).length, 60, 'a single long word is hard-cut to the cap');

// ═══ seoCounter — green ≤60 / amber over; description 50–160 green, short or over amber ═══
{
  const c = seoCounter('title', '', 'Empty — Google shows your business name');
  ok(c.n === 0 && c.state === '' && c.text === 'Empty — Google shows your business name', 'empty title → the empty text, neutral');
  const g = seoCounter('title', 'x'.repeat(60));
  ok(g.state === 'good' && g.text === '60 of 60', '60 chars is still green');
  const w = seoCounter('title', 'x'.repeat(61));
  ok(w.state === 'warn' && w.text === '61 of 60 — may be cut off', '61 chars is amber and says may be cut off');
  const s = seoCounter('description', 'x'.repeat(49));
  ok(s.state === 'warn' && /a little short/.test(s.text) && /50–160/.test(s.text), '49-char description is amber, "a little short", names 50–160');
  const d = seoCounter('description', 'x'.repeat(50));
  ok(d.state === 'good' && d.text === '50 of 160', '50 chars is green');
  const d2 = seoCounter('description', 'x'.repeat(160));
  ok(d2.state === 'good' && d2.text === '160 of 160', '160 chars is green');
  const o = seoCounter('description', 'x'.repeat(161));
  ok(o.state === 'warn' && o.text === '161 of 160 — may be cut off', '161 chars is amber, may be cut off');
  ok(seoCounter('description', '').text === 'Empty', 'no empty text given → "Empty"');
}

// ═══ seoSuggest — the three questions → headline, description, where you work ═══
{
  const s = seoSuggest({ name: 'Marlow’s Kitchen', places: 'Burbank', words: 'Italian restaurant' });
  eq(s.title, 'Marlow’s Kitchen — Italian restaurant in Burbank', 'the benchmark’s example headline');
  eq(s.description, 'Marlow’s Kitchen: Italian restaurant in Burbank. Get in touch to find out more.', 'short description gets the plain closing line');
  ok(s.description.length >= 50 && s.description.length <= 160, 'description sits in 50–160 (' + s.description.length + ')');
  eq(s.service_area, 'Serving Burbank', 'where you work');
}
{
  const s = seoSuggest({ name: 'Marlow’s Kitchen', places: 'Burbank, Glendale', words: 'Italian restaurant, catering, private events, weddings', tagline: 'Warm food, old friends' });
  eq(s.title, 'Marlow’s Kitchen — Italian restaurant in Burbank', 'headline uses the FIRST word and the FIRST place');
  eq(s.description, 'Marlow’s Kitchen: Italian restaurant, catering and private events in Burbank and Glendale. Warm food, old friends.', 'three words max, both places, the tagline ends with a period; long enough to skip the closing line');
  ok(s.words.length === 3 && s.places.length === 2, 'words capped at three, places kept');
  eq(s.service_area, 'Serving Burbank and Glendale', 'where you work lists both');
}
{
  const s = seoSuggest({ name: 'The Long-Named Burbank Family Dental Practice Group', places: 'Burbank', words: 'family dentist' });
  ok(s.title.length <= 60, 'a long name falls back to a shorter shape (' + s.title.length + ')');
  eq(s.title, 'The Long-Named Burbank Family Dental Practice Group', 'the shortest shape that fits is the bare name');
}
{
  const s = seoSuggest({ name: 'A'.repeat(70), places: 'Burbank', words: 'x' });
  ok(s.title.length <= 60 && s.title.endsWith(' ...'), 'a name longer than 60 is cut');
}
{
  const s = seoSuggest({ name: 'Marlow’s Kitchen', places: '', words: 'catering' });
  eq(s.title, 'Marlow’s Kitchen — catering', 'no place → "Name — word"');
  eq(s.description, 'Marlow’s Kitchen: catering. Get in touch to find out more.', 'no place → no "in"');
  eq(s.service_area, '', 'no place → no where-you-work line');
}
{
  const s = seoSuggest({ name: 'Marlow’s Kitchen', places: 'Burbank', words: '' });
  eq(s.title, 'Marlow’s Kitchen — Burbank', 'no words → "Name — Place"');
  eq(s.description, 'Marlow’s Kitchen serves Burbank. Get in touch to find out more.', 'no words → "serves"');
}
{
  const s = seoSuggest({ name: 'Marlow’s Kitchen' });
  eq(s.title, 'Marlow’s Kitchen', 'nothing but the name → the name');
  eq(s.description, 'Marlow’s Kitchen. Get in touch to find out more.', 'nothing but the name → a plain line');
}
{
  const s = seoSuggest({ name: '', places: 'Burbank', words: 'x' });
  eq(s.title, '', 'no name → no headline (the page refuses to save)');
  eq(s.description, '', 'no name → no description');
}
{
  const s = seoSuggest({ name: 'Marlow’s Kitchen', places: 'Burbank', words: 'Italian restaurant', tagline: 'A '.repeat(90) });
  ok(s.description.length <= 160 && s.description.endsWith(' ...'), 'an over-long description is cut at 160 (' + s.description.length + ')');
}
{
  const s = seoSuggest({ name: 'Marlow’s Kitchen', places: 'Burbank', words: 'Italian restaurant', tagline: 'Warm food, old friends!' });
  ok(s.description.endsWith('Warm food, old friends.'), 'a tagline’s own end punctuation becomes a period');
}

// ═══ seoPageDefault — what a blank page field means (mirrors the templates' seoOv shapes) ═══
{
  const c = { name: 'Marlow’s Kitchen', siteDescription: 'Seasonal plates in Burbank.', offeringLabel: 'Menu', pageTitle: 'Private events' };
  eq(seoPageDefault('offerings', c).title, 'Menu — Marlow’s Kitchen', 'offerings title uses the vocabulary word');
  eq(seoPageDefault('offerings', c).description, 'Menu from Marlow’s Kitchen.', 'offerings description');
  eq(seoPageDefault('about', c).title, 'About — Marlow’s Kitchen', 'about title');
  eq(seoPageDefault('about', c).description, 'Seasonal plates in Burbank.', 'about falls back to the site description');
  eq(seoPageDefault('faq', c).title, 'FAQ — Marlow’s Kitchen', 'faq title');
  eq(seoPageDefault('faq', c).description, 'Answers to common questions about Marlow’s Kitchen.', 'faq description');
  eq(seoPageDefault('updates', c).description, 'News and updates from Marlow’s Kitchen.', 'updates description');
  eq(seoPageDefault('contact', c).title, 'Contact & Hours — Marlow’s Kitchen', 'contact title');
  eq(seoPageDefault('contact', c).description, 'Address, phone, and hours for Marlow’s Kitchen.', 'contact description');
  eq(seoPageDefault('page:events', c).title, 'Private events — Marlow’s Kitchen', 'an owner-made page: its title — the name');
  eq(seoPageDefault('page:events', c).description, 'Seasonal plates in Burbank.', 'an owner-made page falls back to the site description');
  eq(seoPageDefault('offerings', {}).title, 'Services — ', 'no vocabulary → Services');
}

// ═══ seoCrumb — Google's address line ═══
eq(seoCrumb('marlows.example', '/'), 'marlows.example', 'home is the bare host');
eq(seoCrumb('marlows.example', '/about/'), 'marlows.example › about', 'one segment');
eq(seoCrumb('marlows.example', '/updates/winter/'), 'marlows.example › updates › winter', 'two segments');

// ═══ the page wires it: fields carry counters, the preview nodes exist, the setup has three questions ═══
ok(/id="cnt-seo_title"/.test(html) && /id="cnt-seo_description"/.test(html), 'both site-level fields have a counter node');
ok(/id="srpTitle"/.test(html) && /id="srpDesc"/.test(html) && /id="srpUrl"/.test(html), 'the home preview has title, description and address nodes');
ok(/id="sw-name"/.test(html) && /id="sw-places"/.test(html) && /id="sw-words"/.test(html), 'the setup asks exactly the three questions');
ok(/id="swSave" class="pillbtn inked"|class="pillbtn inked" id="swSave"/.test(html), 'the setup’s Save is the one filled button');
ok(!/maxlength="60"[^>]*id="f-seo_title"|id="f-seo_title"[^>]*maxlength="60"/.test(html), 'the headline field is no longer hard-capped at 60 (the counter guides instead)');

console.log(`seo_setup: ${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
