// ── Which side owns each class name the templates and the sections share ─────────
//   deno run --allow-read --allow-env tests/presence/class_clash_test.mjs
// The sections' shared stylesheet (site_blocks BLOCK_CSS) is appended to every template's,
// so its rules reach template markup too, and a template's rules reach the sections. (A
// published site keeps only the rules its pages use; these checks read them all.) From
// July to November 2026 Harbor's "at a glance" labels used `lb`, the class the gallery's
// photo viewer pins over the whole screen: a dark sheet over every Harbor home page with
// reviews. Every name both sides use is listed below with its owner:
//   template  a template's own markup may carry it, and sections may too, to look like the
//             rest of the site; the section styles never reach a template's element through it.
//   sections  a section's own: a template may restyle it to suit its look, but never puts it
//             on its own markup.
//   both      each side styles it on its own markup, and the section styles, coming last, also
//             set it on a template's.
// A name that becomes shared fails here until someone decides who owns it. Both sides' markup
// comes from the full sample (full_fixture.mjs): every section, the owner's page, the dropdown.
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { BLOCK_CSS, renderSiteBlocks } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { esc, attr, safeHref } from '../../supabase/functions/presence/lib/markdown.ts';
import { TEMPLATES, fixture, fullFixture } from './full_fixture.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const OWNERS = {
  wrap: ['template', 'the page width'],
  block: ['template', 'a band of the page'],
  alt: ['template', 'the band in the second colour'],
  btn: ['template', 'the button'],
  card: ['template', 'a card'],
  cards: ['template', 'a row of cards'],
  cols: ['template', 'columns: the footer, the contact page, the Columns section'],
  'svc-grid': ['template', 'the grid of offerings; the Features section borrows it'],
  svc: ['template', 'one offering; a Features item borrows it'],
  nm: ['template', 'an offering’s name'],
  pr: ['template', 'an offering’s price'],
  ds: ['template', 'an offering’s description'],
  stat: ['template', 'Harbor’s figures in its welcome; the Stats section’s are `card stat`, the only pair the section styles touch'],
  hp: ['template', 'the contact form’s hidden spam trap; the Form section’s carries it too, and only the template’s styles hide it'],
  'block-spotlight': ['sections', 'the Spotlight section; Atelier restyles it'],
  'sp-eyebrow': ['sections', 'the Spotlight section’s small heading; Atelier restyles it'],
  'block-linklist': ['sections', 'the Link list section; Atelier restyles it'],
  linklist: ['sections', 'the Link list section’s list; Atelier restyles it'],
  'block-progress': ['sections', 'the Progress section; Atelier restyles it'],
  'pgb-pct': ['sections', 'a Progress bar’s figure; Atelier restyles it'],
  process: ['sections', 'the How it works steps; Atelier restyles them'],
  'bk-done-ic': ['sections', 'the booking widget’s done mark; Atelier restyles it'],
  prose: ['template', 'written words: a post, the about story, an answer; the Text, Accordion, Tabs, Columns and Spotlight sections carry it too, and the section styles’ spacing reaches only theirs'],
  'block--bg-accent': ['sections', 'a section’s brand-colour band; Restaurant Classic restyles its Features cards on it'],
  'block--bg-dark': ['sections', 'a section’s dark band; Restaurant Classic restyles its Features cards on it'],
};

// ── reading markup and stylesheets ──
const elements = (html) => [...String(html).replace(/<script\b[\s\S]*?<\/script>/g, '').matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)]
  .map((m) => ({ tag: m[1].toLowerCase(), classes: new Set(((/\sclass="([^"]*)"/.exec(m[2]) || [])[1] || '').split(/\s+/).filter(Boolean)), html: m[0] }));
// split at the top level only, never inside (…) or […]
const splitTop = (s, isSep) => { const out = []; let d = 0, cur = ''; for (const c of s) { if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; if (!d && isSep(c)) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };
// every style rule's selectors, inside @media and @supports too
function selectors(css) {
  const out = [], s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (from, to) => {
    let head = '', i = from;
    while (i < to) {
      const c = s[i];
      if (c === '}') { head = ''; i++; continue; }
      if (c !== '{') { head += c; i++; continue; }
      let d = 1, j = i + 1; while (j < to && d) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
      const h = head.trim();
      if (/^@(media|supports)\b/.test(h)) walk(i + 1, j - 1);
      else if (!h.startsWith('@')) out.push(...splitTop(h, (x) => x === ',').map((x) => x.trim()).filter(Boolean));
      head = ''; i = j;
    }
  };
  walk(0, s.length);
  return out;
}
const named = (text) => new Set([...text.replace(/\[[^\]]*\]|"[^"]*"|'[^']*'/g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
// what a compound needs of one element: its tag, the classes outside :is(…)/:not(…)/[…], and one
// class of each :is(…)/:where(…) list made only of classes
const needs = (compound) => {
  let bare = '', d = 0;
  for (const c of compound) { if (c === '(' || c === '[') d++; if (!d) bare += c; if (c === ')' || c === ']') d--; }
  const anyOf = [...compound.matchAll(/:(?:is|where)\(([^()]*)\)/g)].map((m) => m[1].split(',').map((x) => x.trim()))
    .filter((list) => list.every((x) => /^\.[\w-]+$/.test(x))).map((list) => list.map((x) => x.slice(1)));
  return { tag: (/^([a-z][a-z0-9]*)/i.exec(bare) || [])[1]?.toLowerCase() || null, classes: [...named(bare)], anyOf };
};
const fits = (el, n) => (!n.tag || n.tag === el.tag) && n.classes.every((c) => el.classes.has(c)) && n.anyOf.every((list) => list.some((c) => el.classes.has(c)));
// Can a selector select one of these elements? Its last compound must fit an element, and each
// compound before it must fit some element on the same side (the page's shape is not read, so
// this errs towards "yes").
function reaches(selector, els) {
  const compounds = splitTop(selector.replace(/\s*([>+~])\s*/g, '$1'), (c) => c === ' ' || c === '>' || c === '+' || c === '~').filter(Boolean);
  const subject = needs(compounds[compounds.length - 1]);
  return els.filter((el) => fits(el, subject)).length > 0 && compounds.slice(0, -1).every((c) => els.some((el) => fits(el, needs(c))));
}

// ── the two sides, per template ──
const SITE = { baseUrl: 'https://example.com', formEndpoint: 'https://example.com/forms/submit', bookEndpoint: 'https://example.com/book' };
const ctx = { esc, attr, safeHref, formEndpoint: SITE.formEndpoint, bookEndpoint: SITE.bookEndpoint };
const html = (files) => Object.entries(files).filter(([k]) => k.endsWith('.html')).map(([, v]) => String(v)).join('\n');
function sides(slug) {
  const full = fullFixture(slug);
  const { blocks, pages } = full.content.settings;
  const sectionHtml = [...renderSiteBlocks(blocks, ctx), ...renderSiteBlocks(pages[0].blocks, ctx), ...renderSiteBlocks(blocks, { esc, attr, safeHref })].map((b) => b.html).join('\n');
  // the template's own markup: its own sample, and the full sample with the sections taken out
  // (the owner's page and the dropdown stay)
  const bare = structuredClone(full);
  bare.content.settings = { ...bare.content.settings, blocks: [], blocks_src: [], pages: [{ ...pages[0], blocks: [], blocks_src: [] }] };
  const drawn = renderSnapshot(bare, SITE, { allSectionStyles: true });
  const css = String(drawn[Object.keys(drawn).find((k) => k.startsWith('assets/'))]);
  return {
    markup: html(renderSnapshot(fixture(slug), SITE)) + '\n' + html(drawn),
    css: css.replace(BLOCK_CSS, ''),
    hadSectionStyles: css.includes(BLOCK_CSS),
    sectionHtml,
  };
}
const sectionSelectors = selectors(BLOCK_CSS);
function shared(t) {
  const mine = new Set([...elements(t.markup).flatMap((e) => [...e.classes]), ...named(selectors(t.css).join(' '))]);
  const theirs = new Set([...elements(t.sectionHtml).flatMap((e) => [...e.classes]), ...named(sectionSelectors.join(' '))]);
  return [...mine].filter((c) => theirs.has(c));
}
// a section style that selects one of the template's own elements, unless through a 'both' name
function reachProblems(t, owners) {
  const els = elements(t.markup), out = [];
  for (const sel of sectionSelectors) {
    if (!reaches(sel, els)) continue;
    if ([...named(sel)].some((c) => owners[c]?.[0] === 'both')) continue;
    out.push(sel);
  }
  return out;
}
// a section's own name on the template's own markup
const strayProblems = (t, owners) => elements(t.markup).filter((e) => [...e.classes].some((c) => owners[c]?.[0] === 'sections')).map((e) => e.html.slice(0, 80));

const drawn = Object.fromEntries(TEMPLATES.map((slug) => [slug, sides(slug)]));
ok('every template’s stylesheet carries the section styles whole (what these checks read)', TEMPLATES.every((s) => drawn[s].hadSectionStyles));
ok('every owner is template, sections or both, with a reason', Object.values(OWNERS).every(([o, why]) => ['template', 'sections', 'both'].includes(o) && !!why));
{
  const now = new Set(TEMPLATES.flatMap((s) => shared(drawn[s])));
  const unlisted = [...now].filter((c) => !(c in OWNERS)).sort(), stale = Object.keys(OWNERS).filter((c) => !now.has(c)).sort();
  ok('every class name both sides use has an owner in the list above', unlisted.length === 0, `decide who owns: ${unlisted.join(', ')}`);
  ok('every name in the list is still used by both sides', stale.length === 0, `no longer shared: ${stale.join(', ')}`);
}
for (const slug of TEMPLATES) {
  const reach = reachProblems(drawn[slug], OWNERS), stray = strayProblems(drawn[slug], OWNERS);
  ok(`[${slug}] no section style reaches the template’s own markup, but through a name both own`, reach.length === 0, reach.slice(0, 3).join(' | '));
  ok(`[${slug}] the template’s own markup carries none of the sections’ names`, stray.length === 0, stray.slice(0, 2).join(' | '));
}

// The guard itself: Harbor's July labels, put back, are caught whichever owner `lb` is given.
{
  const july = { ...drawn.harbor, markup: drawn.harbor.markup + '\n<div class="hp-stats"><div class="stat"><span class="num">4.9</span><span class="lb">rating</span></div></div>' };
  ok('the guard: the July labels make `lb` a shared name with no owner', shared(july).includes('lb') && !('lb' in OWNERS));
  ok('the guard: as the template’s, the photo viewer’s screen cover reaches the labels', reachProblems(july, { ...OWNERS, lb: ['template', ''] }).some((sel) => /\.lb\b/.test(sel)));
  ok('the guard: as the sections’, the labels carry a section’s name', strayProblems(july, { ...OWNERS, lb: ['sections', ''] }).length > 0);
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ CLASS CLASH: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
