// ── One section of an unsaved list, for the canvas before the save (list item 26) ──
//   deno run --allow-read --allow-env tests/presence/live_section_test.mjs
// draftSectionHtml draws the section the draft would draw at that index, stamped for the
// canvas, reading only what the list needs. The database is a stub that records what was
// asked and answers with this site's rows, only those a read names by id.
import { draftSectionHtml, buildSnapshot } from '../../supabase/functions/presence/lib/serializer.ts';
import { getTemplate, renderSnapshot, listTemplates, latestTemplateVersion } from '../../supabase/functions/presence/lib/render.ts';
import { withSampleWords } from '../../supabase/functions/presence/lib/sample_words.ts';
import { SAMPLE_BLOCKS, FILE_ID } from '../../scripts/thumbnails/samples.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
// A check that found a bug left for its own fix: KNOWN while the bug is there, and a failure
// once it's gone, so the fix turns it into an ordinary check.
const known = (n, p, bug) => { results.push({ n: `${n} (fixed: make it an ordinary check)`, p: !p }); console.log(`${p ? 'FAIL' : 'KNOWN'}  ${n} — ${p ? 'fixed: make it an ordinary check' : bug}`); };
const manifest = getTemplate('business-classic', '1.0.0').manifest;
const SITE = '11111111-1111-4111-8111-111111111111';
const IMG = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002'];
const LIB = 'cccccccc-0000-4000-8000-000000000001';
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const photo = (id, i) => ({ id, storage_path: `presence-media/${SITE}/photo-${i}.jpg`, alt_text: `Photo ${i + 1}`, mime: 'image/jpeg', width: 1600, height: 1067 });

let asked = [];
const rows = {
  // these photos, and every photo and file the picker's samples name
  presence_media: [...IMG, ...new Set(JSON.stringify(SAMPLE_BLOCKS).match(UUID_G))].map((id, i) => (id === FILE_ID
    ? { id, storage_path: `presence-media/${SITE}/price-list.pdf`, alt_text: 'Price list', mime: 'application/pdf', width: null, height: null }
    : photo(id, i))),
  presence_content_library: [{ id: LIB, payload: SAMPLE_BLOCKS.gallery }],
  presence_reviews: [{ reviewer_name: 'Jordan P.', rating: 5, body: 'On time and tidy.', status: 'approved', approved_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' }],
};
globalThis.fetch = (url) => {
  const u = decodeURIComponent(String(url)); asked.push(u);
  const table = Object.keys(rows).find((t) => u.includes(`/rest/v1/${t}?`));
  const only = u.match(/[?&]id=in\.\(([^)]*)\)/);
  const out = (table ? rows[table] : []).filter((r) => !only || only[1].split(',').includes(r.id));
  return Promise.resolve(new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};

const LIST = [
  { type: 'title', title: 'Welcome in' },
  { type: 'richtext', title: 'Our story', body: 'Fresh words, **not saved yet**.' },
  { type: 'gallery', title: 'Recent work', image_ids: IMG },
  { type: 'richtext', title: 'A second text box', body: 'Another one.' },
];

{
  asked = [];
  const r = await draftSectionHtml(SITE, manifest, LIST, 1, '2026-11-08T00:00:00Z');
  ok('draws the section at that index, from the unsaved words', r.html.includes('Fresh words') && r.html.includes('<strong>not saved yet</strong>'));
  ok('stamped for the canvas: its place in the list, its id and its key', r.html.includes('data-dds-src="1"') && r.html.includes('data-dds-key="block_richtext"') && r.html.includes('data-dds-sid='));
  ok('only that section', !r.html.includes('Welcome in') && !r.html.includes('Recent work'));
  ok('asks only for the photos the list names, on this site', asked.some((u) => u.includes('presence_media?site_id=eq.' + SITE) && u.includes(`id=in.(${IMG[0]},${IMG[1]})`)));
  ok('no reviews read when the list has no reviews wall', !asked.some((u) => u.includes('presence_reviews')));
  ok('a text section uses no photos', r.mediaManifest.length === 0);
}
{
  const r = await draftSectionHtml(SITE, manifest, LIST, 3, '2026-11-08T00:00:00Z');
  ok('a second section of the same type gets the key the page gives it', r.html.includes('data-dds-key="block_richtext_2"') && r.html.includes('data-dds-src="3"'));
}
{
  const r = await draftSectionHtml(SITE, manifest, LIST, 2, '2026-11-08T00:00:00Z');
  ok('a gallery draws with its photos', (r.html.match(/<img /g) || []).length >= 2);
  ok('and lists them, so the preview can sign their addresses', r.mediaManifest.map((m) => m.media_id).join() === IMG.join() && r.mediaManifest.every((m) => m.variants.every((v) => r.html.includes(v.output_path) || v.format === 'avif')));
}
{
  asked = [];
  const r = await draftSectionHtml(SITE, manifest, [...LIST, { type: 'reviews_wall', title: 'What people say', max: 6 }], 4, '2026-11-08T00:00:00Z');
  ok('a reviews wall reads the approved reviews and shows them', asked.some((u) => u.includes('presence_reviews') && u.includes('status=eq.approved')) && r.html.includes('On time and tidy.'));
}
{
  const r = await draftSectionHtml(SITE, manifest, [{ type: 'richtext', title: 'Emptied', body: '' }, ...LIST], 0, '2026-11-08T00:00:00Z');
  ok('a section emptied of everything draws nothing, as on the site', r.html === '');
}

// ── Every section type the builder offers, on every template (deep pass, Part 7.10) ──
// The canvas puts the drawing's first element where the old section was and signs only the
// photos the drawing lists (presence.html dcLiveNow, routes/preview.ts). So each type, from the
// picker's own sample, draws as one stamped element, lists every photo it shows, and is byte
// for byte the section the draft preview draws from the same list.
const PAGE = Deno.readTextFileSync(new URL('../../presence.html', import.meta.url));
const defs = PAGE.slice(PAGE.indexOf('const BLOCK_DEFS = ['), PAGE.indexOf('\n];', PAGE.indexOf('const BLOCK_DEFS = [')));
const offered = [...defs.matchAll(/\{ type: "([a-z_]+)", name: "/g)].map((m) => m[1]);
const unsampled = offered.filter((t) => !SAMPLE_BLOCKS[t]);
ok('the builder offers the section types it always has, each with a sample', offered.length >= 37 && !unsampled.length, `${offered.length} types${unsampled.length ? '; no sample: ' + unsampled.join(', ') : ''}`);

const NOW = '2026-11-08T00:00:00Z';
const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
/** How many elements a drawing has at its top level. */
function topElements(html) {
  let depth = 0, count = 0;
  const tag = /<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/gi;
  for (let m; (m = tag.exec(html));) {
    if (!m[2]) continue;
    const name = m[2].toLowerCase();
    if (m[1]) { depth--; continue; }
    if (depth === 0) count++;
    if (/^(script|style|textarea|title)$/.test(name)) { const end = html.indexOf(`</${name}`, tag.lastIndex); tag.lastIndex = end < 0 ? html.length : end; depth++; }
    else if (!VOID.has(name) && !m[3]) depth++;
  }
  return count;
}
const firstTag = (html) => (html.replace(/^\s*(?:<!--[\s\S]*?-->\s*)*/, '').match(/^<[a-z][a-z0-9-]*\b[^>]*>/i) || [''])[0];
const photoPaths = (html) => [...new Set(html.match(/\/(?:img\/[0-9a-f]{8}-\d+\.(?:webp|avif)|files\/[0-9a-f]{8}\.[a-z0-9]+)/g) || [])];
/** The home page the draft preview draws from this list. */
function draftPage(list, slug, version, man) {
  const draft = { presence_identity: [], presence_locations: [], presence_offerings: [], presence_testimonials: [], presence_faqs: [], presence_posts: [], presence_redirects: [], presence_dev_customizations: [],
    presence_media: rows.presence_media, presence_reviews: rows.presence_reviews, presence_content_library: rows.presence_content_library, presence_settings: [{ blocks: list }] };
  const { snapshot } = buildSnapshot(draft, man, { templateSlug: slug, templateVersion: version, now: NOW });
  return String(renderSnapshot(withSampleWords(snapshot), { baseUrl: 'https://preview.invalid' })['index.html']).replaceAll('https://preview.invalid', '');
}
{
  const miss = { drew: [], stamp: [], one: [], page: [], unlisted: [], noPhoto: [] };
  const templates = listTemplates().map((t) => t.slug);
  // two lists per template: a page holds at most 32 sections
  const lists = [offered.slice(0, Math.ceil(offered.length / 2)), offered.slice(Math.ceil(offered.length / 2))];
  for (const slug of templates) {
    const version = latestTemplateVersion(slug), man = getTemplate(slug, version).manifest;
    for (const types of lists) {
      const list = types.map((t) => SAMPLE_BLOCKS[t]);
      const page = draftPage(list, slug, version, man);
      for (const [i, type] of types.entries()) {
        const r = await draftSectionHtml(SITE, man, list, i, NOW), at = `${slug}: ${type}`;
        if (!r.html) { miss.drew.push(at); continue; }
        const first = firstTag(r.html);
        if (!first.includes(` data-dds-src="${i}"`) || !first.includes(` data-dds-key="block_${type}`)) miss.stamp.push(at);
        if (topElements(r.html) !== 1) miss.one.push(at);
        if (!page.includes(r.html)) miss.page.push(at);
        const listed = new Set(r.mediaManifest.flatMap((m) => m.variants.map((v) => v.output_path)));
        const shown = photoPaths(r.html);
        if (shown.some((p) => !listed.has(p))) miss.unlisted.push(at);
        if (JSON.stringify(SAMPLE_BLOCKS[type]).match(UUID_G) && !shown.length) miss.noPhoto.push(at);
      }
    }
  }
  const said = (k) => miss[k].slice(0, 6).join('; ') + (miss[k].length > 6 ? ` and ${miss[k].length - 6} more` : '');
  ok(`every type draws on all ${templates.length} templates`, templates.length >= 8 && !miss.drew.length, said('drew'));
  ok('its first element is the section, stamped with its place in the list and its key', !miss.stamp.length, said('stamp'));
  ok('it is one element, so the canvas swaps in all of it', !miss.one.length, said('one'));
  ok('it is the section the draft preview draws from the same list, byte for byte', !miss.page.length, said('page'));
  ok('every photo or file it shows is listed, so the canvas gets its signed address', !miss.unlisted.length, said('unlisted'));
  ok('a section with photos shows them', !miss.noPhoto.length, said('noPhoto'));
}
{
  // each type alone after a heading: reads only what the list needs
  const extra = [];
  for (const type of offered) {
    asked = [];
    await draftSectionHtml(SITE, manifest, [SAMPLE_BLOCKS[type === 'title' ? 'richtext' : 'title'], SAMPLE_BLOCKS[type]], 1, NOW);
    const read = (t) => asked.some((u) => u.includes(`/rest/v1/${t}?`));
    if (read('presence_media') !== !!JSON.stringify(SAMPLE_BLOCKS[type]).match(UUID_G)) extra.push(`${type}: photos`);
    if (read('presence_reviews') !== (type === 'reviews_wall')) extra.push(`${type}: reviews`);
    if (read('presence_content_library')) extra.push(`${type}: saved sections`);
  }
  ok('each type reads photos only when it names some, reviews only for a reviews wall, and no saved sections', !extra.length, extra.join(', '));
}
{
  // a saved section placed as a link draws its current content from the library
  asked = [];
  const r = await draftSectionHtml(SITE, manifest, [SAMPLE_BLOCKS.title, { type: 'linked', ref: LIB }], 1, NOW);
  ok('a linked saved section reads its library item by id', asked.some((u) => u.includes('presence_content_library?site_id=eq.' + SITE) && u.includes(`id=in.(${LIB})`)));
  ok('a linked saved section draws with its photos, as the page does', r.html.includes('data-dds-key="block_gallery"') && photoPaths(r.html).length > 0);
}
{
  // a saved reviews wall placed as a link reads the reviews too: the list itself names none
  const WALL = 'cccccccc-0000-4000-8000-000000000002';
  rows.presence_content_library.push({ id: WALL, payload: { type: 'reviews_wall', title: 'What people say', max: 6 } });
  asked = [];
  const r = await draftSectionHtml(SITE, manifest, [SAMPLE_BLOCKS.title, { type: 'linked', ref: WALL }], 1, NOW);
  ok('a linked reviews wall reads the approved reviews and shows them', asked.some((u) => u.includes('presence_reviews') && u.includes('status=eq.approved')) && r.html.includes('On time and tidy.'));
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ LIVE SECTION: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
