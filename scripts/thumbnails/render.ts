// ── Picker pictures, step 1: write the pages to photograph (list item 25) ───────
//   deno run --allow-read --allow-write --allow-env scripts/thumbnails/render.ts <out-dir>
// Writes <out>/templates/<slug>/… and <out>/sections/<type>/… (pages.ts builds them),
// then: node scripts/thumbnails/shoot.mjs <out-dir>. Commit the thumbs/ it makes.
import { templatePages, sectionPages, placeholderFiles, drew, TEMPLATES } from './pages.ts';
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
const templates = templatePages(), sections = sectionPages(), ph = placeholderFiles();
for (const [slug, files] of Object.entries(templates)) await write(`${out}/templates/${slug}`, { ...files, ...ph });
for (const [type, files] of Object.entries(sections)) await write(`${out}/sections/${type}`, { ...files, ...ph });
console.log(JSON.stringify({ templates: TEMPLATES, sections: Object.entries(sections).filter(([t, f]) => drew(t, f)).map(([t]) => t) }));
