// ── Item 67: every template's link colour passes contrast on its own page colour ──
//   deno run --allow-read --allow-env tests/presence/template_contrast_test.mjs
// The shared section and search styles colour links and small labels with
// var(--accent-dark, var(--accent)). Atelier defined no --accent-dark, so its links fell
// back to the light bronze: 3.8:1 against the 4.5:1 the accessibility page promises.
// This renders each template's own sample and measures that colour on its page colour.
import { renderSnapshot, listTemplates } from '../../supabase/functions/presence/lib/render.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const lum = (hex) => { const h = hex.replace('#', ''); const x = h.length === 3 ? h.split('').map((c) => c + c).join('') : h; return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const { slug } of listTemplates()) {
  const fx = JSON.parse(Deno.readTextFileSync(new URL(`../../supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`, import.meta.url)));
  fx.template_slug = slug; fx.template_version = '1.0.0';
  const files = renderSnapshot(fx, { baseUrl: 'https://example.com' });
  const css = String(files[Object.keys(files).find((k) => k.startsWith('assets/') && k.endsWith('.css'))]);
  const root = /:root\{([^}]*)\}/.exec(css)?.[1] || '';
  const v = (name) => /#[0-9a-fA-F]{3,6}/.exec((new RegExp(`--${name}:([^;]+)`).exec(root) || [])[1] || '')?.[0];
  const link = v('accent-dark') || v('accent');
  const paper = v('paper') || v('bg') || '#ffffff';
  const r = link && paper ? ratio(link, paper) : 0;
  ok(`${slug}: links and small labels pass on the page colour (${r.toFixed(2)}:1)`, r >= 4.5, `${link} on ${paper}`);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ TEMPLATE CONTRAST: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
