// ── Picker pictures, step 1: write the pages to photograph (list item 25) ───────
//   deno run --allow-read --allow-write --allow-env scripts/thumbnails/render.ts <out-dir>
// Writes <out>/templates/<slug>/…, <out>/kinds/<slug>/<family>/… (item 331), <out>/openings/<key>/… (the openings made for a kind of
// business), <out>/sections/<type>/… and <out>/pages/<key>/… (pages.ts builds them), each with the library fonts it draws in, and
// <out>/sources.json (what each picture will show), then: node scripts/thumbnails/shoot.mjs
// <out-dir>. Commit the thumbs/ it makes and tests/presence/golden/pictures.json.
import { allPages, pictureSources, drew, fontFiles, TEMPLATES } from './pages.ts';
import type { FileMap } from '../../supabase/functions/presence/lib/render_types.ts';

const out = Deno.args[0];
if (!out) { console.error('usage: render.ts <out-dir>'); Deno.exit(2); }
async function write(dir: string, files: FileMap) {
  for (const [path, body] of Object.entries(files)) {
    const full = `${dir}/${path}`;
    await Deno.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
    if (typeof body === 'string') await Deno.writeTextFile(full, body); else await Deno.writeFile(full, body);
  }
}
const { templates, sections, pages, kinds, openings, ph } = await allPages();
for (const [slug, files] of Object.entries(templates)) await write(`${out}/templates/${slug}`, { ...files, ...ph, ...fontFiles(files) });
for (const [key, files] of Object.entries(kinds)) await write(`${out}/kinds/${key}`, { ...files, ...ph, ...fontFiles(files) });   // item 331: <template>/<family>
for (const [key, files] of Object.entries(openings)) await write(`${out}/openings/${key}`, { ...files, ...ph, ...fontFiles(files) });
for (const [type, files] of Object.entries(sections)) await write(`${out}/sections/${type}`, { ...files, ...ph });
for (const [key, files] of Object.entries(pages)) await write(`${out}/pages/${key}`, { ...files, ...ph });
await Deno.writeTextFile(`${out}/sources.json`, JSON.stringify(await pictureSources(), null, 1) + '\n');
console.log(JSON.stringify({ templates: TEMPLATES, kinds: Object.keys(kinds).length, openings: Object.keys(openings), sections: Object.entries(sections).filter(([t, f]) => drew(t, f)).map(([t]) => t), pages: Object.keys(pages) }));
