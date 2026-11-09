// ── Picker pictures, step 1: write the pages to photograph (list item 25) ───────
//   deno run --allow-read --allow-write --allow-env scripts/thumbnails/render.ts <out-dir>
// Writes <out>/templates/<slug>/… and <out>/sections/<type>/… (pages.ts builds them), and
// <out>/sources.json (what each picture will show), then: node scripts/thumbnails/shoot.mjs
// <out-dir>. Commit the thumbs/ it makes and tests/presence/golden/pictures.json.
import { allPages, pictureSources, drew, TEMPLATES } from './pages.ts';
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
const { templates, sections, ph } = allPages();
for (const [slug, files] of Object.entries(templates)) await write(`${out}/templates/${slug}`, { ...files, ...ph });
for (const [type, files] of Object.entries(sections)) await write(`${out}/sections/${type}`, { ...files, ...ph });
await Deno.writeTextFile(`${out}/sources.json`, JSON.stringify(await pictureSources(), null, 1) + '\n');
console.log(JSON.stringify({ templates: TEMPLATES, sections: Object.entries(sections).filter(([t, f]) => drew(t, f)).map(([t]) => t) }));
