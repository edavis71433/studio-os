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
  const files = await renderSnapshot(fx, { baseUrl: 'https://example.com' });
  const css = String(files[Object.keys(files).find((k) => k.startsWith('assets/') && k.endsWith('.css'))]);
  const root = /:root\{([^}]*)\}/.exec(css)?.[1] || '';
  const v = (name) => /#[0-9a-fA-F]{3,6}/.exec((new RegExp(`--${name}:([^;]+)`).exec(root) || [])[1] || '')?.[0];
  const link = v('accent-dark') || v('accent');
  const paper = v('paper') || v('bg') || '#ffffff';
  const r = link && paper ? ratio(link, paper) : 0;
  ok(`${slug}: links and small labels pass on the page colour (${r.toFixed(2)}:1)`, r >= 4.5, `${link} on ${paper}`);
}

// ── Item 137: the opening-hours day names read on whatever they sit on ──
// Every template draws its hours table twice: in the footer band and in the contact
// page's card. Business Classic coloured the day names with its grey "soft" text on
// its dark footer (2.64:1, Lighthouse's only miss on that template) and Aurora did the
// same (3.06:1). This works out the colour each template gives the day names in both
// places and the colour behind them, from the template's own rules, under its own
// colours and under every palette and look an owner can pick in the editor.
const PAGE = Deno.readTextFileSync(new URL('../../presence.html', import.meta.url));
const pageArray = (name) => new Function(`return ${PAGE.match(new RegExp(`\\nconst ${name} = (\\[[\\s\\S]*?\\n\\]);`))[1]};`)();
const FIXED = new Set(JSON.parse(/const FIXED_COLOR_TEMPLATES = new Set\((\[[^\]]*\])\)/.exec(PAGE)[1]));
const CHOICES = [...pageArray('PALETTES'), ...pageArray('STYLE_LOOKS')].filter((p) => p.tokens && p.tokens.ink)
  .map((p) => ({ name: p.name, vars: Object.fromEntries(['accent', 'accent_dark', 'ink', 'soft', 'bg'].filter((k) => p.tokens[k]).map((k) => [k.replace('_', '-'), p.tokens[k]])) }));
/** Rules outside @media blocks: print and narrow-screen rules don't recolour the table on screen. */
const screenRules = (css) => {
  let s = css, i;
  while ((i = s.indexOf('@media')) >= 0) {
    let k = s.indexOf('{', i), depth = 0;
    for (; k < s.length; k++) { if (s[k] === '{') depth++; else if (s[k] === '}' && --depth === 0) break; }
    s = s.slice(0, i) + s.slice(k + 1);
  }
  return [...s.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(',').map((x) => x.trim()), decl: m[2] }));
};
/** The last value a rule with exactly this selector gives the property. */
const prop = (rules, sel, name) => {
  let v;
  for (const r of rules) if (r.sels.includes(sel)) { const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(r.decl); if (m) v = m[1].trim(); }
  return v;
};
/** Follows var(--x, fallback), innermost first, to a hex colour. */
const hexOf = (value, vars) => {
  let s = String(value || '');
  for (let n = 0, m; n < 12 && (m = /var\(--([\w-]+)\s*(?:,\s*([^()]*))?\)/.exec(s)); n++) s = s.replace(m[0], vars[m[1]] ?? m[2] ?? '');
  return /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.exec(s)?.[0];
};
for (const { slug } of listTemplates()) {
  const fx = JSON.parse(Deno.readTextFileSync(new URL(`../../supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`, import.meta.url)));
  const files = await renderSnapshot(fx, { baseUrl: 'https://example.com' });
  const rules = screenRules(String(files[Object.keys(files).find((k) => k.startsWith('assets/') && k.endsWith('.css'))]));
  const own = Object.fromEntries(rules.filter((r) => r.sels.includes(':root')).flatMap((r) => [...r.decl.matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()])));
  const home = String(files['index.html']), contact = String(files['contact/index.html'] || '');
  ok(`${slug}: the sample draws the hours table in the footer band`, home.indexOf('<table class="hours"', home.indexOf('<footer class="site"')) > 0);
  ok(`${slug}: the sample draws the hours table in the contact page's card`, /<div class="card"><table class="hours"/.test(contact));
  // a new rule that colours the day names some other way must be taught to this check
  const known = new Set(['table.hours th', 'footer.site table.hours th', '.card table.hours th']);
  const stray = rules.flatMap((r) => r.sels.filter((s) => /\bhours\b.*\bth\b/.test(s) && !/data-today/.test(s) && !known.has(s) && /(?:^|;)\s*color\s*:/.test(r.decl)));
  ok(`${slug}: every rule colouring the day names is one this check reads`, stray.length === 0, stray.join(' | '));
  for (const [place, band] of [['footer band', 'footer.site'], ["contact page's card", '.card']]) {
    const fg = prop(rules, `${band} table.hours th`, 'color') ?? prop(rules, 'table.hours th', 'color') ?? prop(rules, 'table.hours', 'color') ?? prop(rules, band, 'color') ?? prop(rules, 'body', 'color');
    // a band with no colour of its own (Editorial's card is transparent) shows the page behind it
    const bgs = [prop(rules, band, 'background-color'), prop(rules, band, 'background'), prop(rules, 'body', 'background-color'), prop(rules, 'body', 'background')];
    let worst = { r: Infinity };
    for (const c of [{ name: 'its own colours', vars: {} }, ...(FIXED.has(slug) ? [] : CHOICES)]) {
      const vars = { ...own, ...c.vars }, f = hexOf(fg, vars), b = bgs.map((v) => hexOf(v, vars)).find(Boolean);
      const r = f && b ? ratio(f, b) : 0;
      if (r < worst.r) worst = { r, note: `${f} on ${b} with ${c.name}` };
    }
    ok(`${slug}: the day names in the ${place} pass (${worst.r.toFixed(2)}:1 at worst)`, worst.r >= 4.5, worst.note);
  }
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ TEMPLATE CONTRAST: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
