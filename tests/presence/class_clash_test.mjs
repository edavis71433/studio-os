// ── A template class must not borrow a section style that covers the screen ─────
//   deno run --allow-read --allow-env tests/presence/class_clash_test.mjs
// The sections' shared stylesheet (site_blocks BLOCK_CSS) is appended to every template's,
// so its classes reach template markup too. A class it pins over the whole screen
// (position:fixed — the gallery's photo viewer, `lb`) used by a template for anything
// else covers that template's pages. Harbor's "at a glance" labels did, from July to
// November 2026: a dark sheet over every Harbor home page with reviews.
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { BLOCK_CSS } from '../../supabase/functions/presence/lib/site_blocks.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const TEMPLATES = ['restaurant-classic', 'business-classic', 'editorial', 'aurora', 'slate', 'meadow', 'atelier', 'harbor'];

const fixed = new Set();
for (const [, sel, body] of BLOCK_CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  if (!body.includes('position:fixed')) continue;
  for (const part of sel.split(',')) { const m = part.trim().match(/^\.([\w-]+)$/); if (m) fixed.add(m[1]); }
}
ok('the shared section styles pin at least the photo viewer over the screen', fixed.has('lb'), [...fixed].join(','));

for (const slug of TEMPLATES) {
  const fx = JSON.parse(Deno.readTextFileSync(new URL(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`, ROOT)));
  fx.template_slug = slug; fx.template_version = '1.0.0';
  const out = renderSnapshot(fx, { baseUrl: 'https://example.com' });
  const strays = [];
  for (const [path, body] of Object.entries(out)) {
    if (!path.endsWith('.html')) continue;
    // every element carrying one of those classes must be a section's own viewer (they have ids)
    for (const [tag] of String(body).matchAll(/<[a-z]+\b[^>]*\bclass="[^"]*"[^>]*>/g)) {
      const classes = (tag.match(/\bclass="([^"]*)"/) || [, ''])[1].split(/\s+/);
      if (classes.some((c) => fixed.has(c)) && !/\bid="[^"]+"/.test(tag)) strays.push(`${path}: ${tag.slice(0, 80)}`);
    }
  }
  ok(`[${slug}] no page uses a screen-covering section class for its own markup`, strays.length === 0, strays.slice(0, 2).join(' | '));
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ CLASS CLASH: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
