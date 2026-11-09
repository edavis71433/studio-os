// ── The Styles panel's choices reach every template ─────────────────────────────
//   deno run --allow-read --allow-env tests/presence/style_tokens_test.mjs
// Each template's own fixture, rendered as that template, with style choices set the way
// the Styles panel saves them. Fonts: headings, the business name and body text follow
// the choice on every template. Colours: every template takes them, except Slate, which is
// dark and keeps its own (the palettes and Background choice are written for light pages).
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const SITE = { baseUrl: 'https://example.com' };
const TEMPLATES = ['restaurant-classic', 'business-classic', 'editorial', 'aurora', 'slate', 'meadow', 'atelier', 'harbor'];
const TOKENS = { font_display: "'Courier New', ui-monospace, monospace", font_body: 'system-ui, sans-serif', accent: '#23635a', ink: '#1c2430', bg: '#faf6ee' };
// a CSS rule whose selector list names this selector and whose body sets the font from this token
const ruleUses = (css, selector, token) => new RegExp(`(?:^|[}\\n])[^{}]*(?:^|[\\s,}])${selector.replace('.', '\\.')}(?=[\\s,{:])[^{}]*\\{[^}]*font-family:var\\(--${token}`).test(css);

for (const slug of TEMPLATES) {
  const fx = JSON.parse(Deno.readTextFileSync(new URL(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`, ROOT)));
  fx.template_slug = slug; fx.template_version = '1.0.0';
  fx.dev_customization = { theme_tokens: TOKENS, custom_css: '', custom_html: '' };
  const out = renderSnapshot(fx, SITE);
  const css = Object.entries(out).filter(([k]) => k.startsWith('assets/') && k.endsWith('.css')).map(([, v]) => String(v)).join('\n');
  const home = String(out['index.html']);
  ok(`[${slug}] the chosen tokens are on the page`, home.includes('id="presence-dev"') && home.includes('--font-display:') && home.includes('--accent:#23635a'));
  ok(`[${slug}] headings use the chosen display font`, ruleUses(css, 'h1', 'font-display'));
  ok(`[${slug}] the business name uses it too`, ruleUses(css, '.brand', 'font-display'));
  ok(`[${slug}] body text uses the chosen body font`, ruleUses(css, 'body', 'font-body'));
  const locked = /html:root\{[^}]*--ink:#eef1f5[^}]*--paper:#101216[^}]*--accent:#2dd4bf/.test(css);
  if (slug === 'slate') ok('[slate] keeps its own dark colours over any palette or background choice', locked);
  else ok(`[${slug}] takes the colour choices (nothing locks them)`, !/html:root\{/.test(css));
}
{
  const fx = JSON.parse(Deno.readTextFileSync(new URL('supabase/functions/presence/templates/restaurant-classic/1.0.0/fixture.json', ROOT)));
  const css = Object.entries(renderSnapshot(fx, SITE)).filter(([k]) => k.startsWith('assets/') && k.endsWith('.css')).map(([, v]) => String(v)).join('\n');
  ok('[restaurant-classic] the menu’s category headings follow the body font', /\.menu-cat h2\{[^}]*font-family:var\(--font-body/.test(css));
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ STYLE TOKENS: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
