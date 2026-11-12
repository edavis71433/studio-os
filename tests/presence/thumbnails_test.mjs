// ── The pickers' pictures (list item 25) ────────────────────────────────────────
//   deno run --allow-read --allow-env tests/presence/thumbnails_test.mjs
// Every section type the builder offers has sample content that draws and a picture; every
// template has a picture. The pictures are made by scripts/thumbnails (render.ts, then
// shoot.mjs) and committed: re-run both when a section or template changes how it looks.
// Each picture is recorded beside the page it shows (tests/presence/golden/pictures.json),
// so a picture of a page that no longer draws that way fails here (list item 110).
import { SAMPLE_BLOCKS } from '../../scripts/thumbnails/samples.ts';
import { allPages, pictureSources, drew, TEMPLATES } from '../../scripts/thumbnails/pages.ts';
import { listReadyPages } from '../../supabase/functions/presence/lib/page_layouts.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const jpeg = (path) => { try { const b = Deno.readFileSync(new URL(path, ROOT)); return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b.length > 1500; } catch { return false; } };

// the types the builder offers, read from its own list
const html = Deno.readTextFileSync(new URL('presence.html', ROOT));
const defs = html.slice(html.indexOf('const BLOCK_DEFS = ['), html.indexOf('\n];', html.indexOf('const BLOCK_DEFS = [')));
const offered = [...defs.matchAll(/\{ type: "([a-z_]+)", name: "/g)].map((m) => m[1]);
ok('the builder offers the section types it always has', offered.length >= 37, String(offered.length));

const noSample = offered.filter((t) => !SAMPLE_BLOCKS[t]);
ok('every offered section type has sample content for its picture', noSample.length === 0, noSample.join(', '));
const noPic = offered.filter((t) => !jpeg(`thumbs/sections/${t}.jpg`));
ok('every offered section type has its picture', noPic.length === 0, noPic.join(', '));
const extra = Object.keys(SAMPLE_BLOCKS).filter((t) => !offered.includes(t));
ok('no sample for a type the builder no longer offers', extra.length === 0, extra.join(', '));

const noTemplatePic = TEMPLATES.filter((t) => !jpeg(`thumbs/templates/${t}.jpg`));
ok('every template has its picture', TEMPLATES.length >= 8 && noTemplatePic.length === 0, noTemplatePic.join(', '));

// item 216: every ready-made page in Add a page has its picture, and each draws every section it brings
{
  const ready = listReadyPages();
  const noPagePic = ready.filter((p) => !jpeg(`thumbs/pages/${p.key}.jpg`)).map((p) => p.key);
  ok('every ready-made page has its picture', ready.length >= 24 && noPagePic.length === 0, noPagePic.join(', '));
  const heavy = ready.filter((p) => { try { return Deno.statSync(new URL(`thumbs/pages/${p.key}.jpg`, ROOT)).size > 20000; } catch { return false; } }).map((p) => p.key);
  ok('each page picture stays small, under 20 KB', heavy.length === 0, heavy.join(', '));
  const pages = (await allPages()).pages;
  const short = ready.filter((p) => (String(pages[p.key]?.['index.html'] || '').match(/ data-dds-key="block_/g) || []).length < p.blocks.length).map((p) => p.key);
  ok('each ready-made page draws all of its sections in its picture', short.length === 0, short.join(', '));
}

// every sample still draws through the real renderer
{
  const pages = (await allPages()).sections;
  const missing = offered.filter((t) => !pages[t] || !drew(t, pages[t]));
  ok('every sample draws a section', missing.length === 0, missing.join(', '));
}

// every picture shows its page as it draws today
{
  let record = {};
  try { record = JSON.parse(Deno.readTextFileSync(new URL('tests/presence/golden/pictures.json', ROOT))); } catch { /* absent */ }
  const onDisk = ['templates', 'sections', 'pages'].flatMap((d) => [...Deno.readDirSync(new URL(`thumbs/${d}/`, ROOT))].filter((e) => e.name.endsWith('.jpg')).map((e) => `${d}/${e.name}`)).sort();
  const listed = Object.keys(record).sort();
  const unrecorded = onDisk.filter((k) => !listed.includes(k)), gone = listed.filter((k) => !onDisk.includes(k));
  ok('the record lists every picture, and only them', !unrecorded.length && !gone.length, [unrecorded.length ? `not recorded: ${unrecorded.slice(0, 4).join(', ')}` : '', gone.length ? `recorded, no picture: ${gone.join(', ')}` : ''].filter(Boolean).join('; '));
  const sha = async (b) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const replaced = [];
  for (const k of onDisk) if (record[k] && record[k].picture !== await sha(Deno.readFileSync(new URL(`thumbs/${k}`, ROOT)))) replaced.push(k);
  ok('each picture is the one the record describes', replaced.length === 0, replaced.join(', '));
  const now = await pictureSources();
  const stale = Object.keys(now).filter((k) => record[k]?.page !== now[k]).sort();
  ok('no picture is stale: each was shot from its page as it draws today', stale.length === 0, stale.length
    ? `${stale.length} stale (${stale.slice(0, 6).join(', ')}${stale.length > 6 ? ', …' : ''}); retake them: deno run --allow-read --allow-write --allow-env scripts/thumbnails/render.ts <dir> && node scripts/thumbnails/shoot.mjs <dir>`
    : '');
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ PICKER PICTURES: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
