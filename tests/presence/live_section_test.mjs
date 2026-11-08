// ── One section of an unsaved list, for the canvas before the save (list item 26) ──
//   deno run --allow-read --allow-env tests/presence/live_section_test.mjs
// draftSectionHtml draws the section the draft would draw at that index, stamped for the
// canvas, reading only what the list needs. The database is a stub that records what was
// asked and answers with this site's rows.
import { draftSectionHtml } from '../../supabase/functions/presence/lib/serializer.ts';
import { getTemplate } from '../../supabase/functions/presence/lib/render.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const manifest = getTemplate('business-classic', '1.0.0').manifest;
const SITE = '11111111-1111-4111-8111-111111111111';
const IMG = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002'];

let asked = [];
const rows = {
  presence_media: IMG.map((id, i) => ({ id, storage_path: `presence-media/${SITE}/photo-${i}.jpg`, alt_text: `Photo ${i + 1}`, mime: 'image/jpeg', width: 1600, height: 1067 })),
  presence_content_library: [],
  presence_reviews: [{ reviewer_name: 'Jordan P.', rating: 5, body: 'On time and tidy.', status: 'approved', approved_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' }],
};
globalThis.fetch = (url) => {
  const u = String(url); asked.push(decodeURIComponent(u));
  const table = Object.keys(rows).find((t) => u.includes(`/rest/v1/${t}?`));
  return Promise.resolve(new Response(JSON.stringify(table ? rows[table] : []), { status: 200, headers: { 'Content-Type': 'application/json' } }));
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

const failed = results.filter((r) => !r.p);
console.log(`\n════ LIVE SECTION: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
