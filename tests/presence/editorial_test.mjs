// ── Phase PT: editorial template family suite ────────────────────────────────
// Proves the SECOND premium family: a genuinely different design language over
// the SAME engine — same content contract, same industry realization, same
// production laws (a11y/SEO/XSS/determinism/provenance), only the presentation
// differs. If this passes, "Studio OS has two templates" is no longer true.
//
//   deno run --allow-read --allow-env tests/presence/editorial_test.mjs
import { getTemplate, renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const ROOT = new URL('../../', import.meta.url);
const fixture = JSON.parse(await Deno.readTextFile(new URL('supabase/functions/presence/templates/editorial/1.0.0/fixture.json', ROOT)));
const bcCss = await Deno.readTextFile(new URL('supabase/functions/presence/templates/business-classic/1.0.0/render.ts', ROOT));
const SITE = { baseUrl: 'https://example.com', formEndpoint: 'https://fn.example.com/forms/x/submit' };

function snapFor(industry, extra = {}) {
  const s = structuredClone(fixture);
  s.template_slug = 'editorial'; s.template_version = '1.0.0';
  s.content.settings = { ...(s.content.settings || {}), industry, ...extra };
  return s;
}
const render = (industry, extra) => renderSnapshot(snapFor(industry, extra), SITE);
const cssOf = (f) => f[Object.keys(f).find((k) => k.startsWith('assets/site-') && k.endsWith('.css'))];

// ═══ 1. registered + contract ═══
{
  const t = getTemplate('editorial', '1.0.0');
  ok('registered with an Editorial manifest, contract v1', !!t && t.manifest.slug === 'editorial' && t.manifest.name === 'Editorial' && t.manifest.content_contract_version === 1);
}

// ═══ 2. the full production file set ═══
{
  const f = render('plumber');
  const need = ['index.html', 'services/index.html', 'about/index.html', 'faq/index.html', 'contact/index.html', 'thanks/index.html', 'privacy/index.html', 'accessibility/index.html', 'updates/index.html', '404.html', 'sitemap.xml', 'robots.txt', 'favicon.svg'];
  ok('emits the complete file set', need.every((k) => k in f), need.filter((k) => !(k in f)).join(','));
  ok('emits exactly one hashed CSS asset', Object.keys(f).filter((k) => k.startsWith('assets/site-') && k.endsWith('.css')).length === 1);
}

// ═══ 3. a GENUINELY different design language (not Business Classic) ═══
{
  const f = render('plumber');
  const css = cssOf(f);
  ok('serif, print-inspired: serif stack + a double-ruled masthead + uppercase labels', /Iowan Old Style|Palatino|Georgia/.test(css) && css.includes('3px double') && css.includes('text-transform:uppercase'));
  ok('restrained oxblood accent (#6d232a), not the Business-Classic teal (#23635a)', css.includes('#6d232a') && !css.includes('#23635a'));
  ok('offerings are a ruled list, not shadowed cards', css.includes('.svc{border-top:1px solid') && !/\.svc\{[^}]*box-shadow/.test(css));
  ok('the two families do not share a stylesheet (distinct CSS → distinct hashed path)', !bcCss.includes('#6d232a'));
  ok('token-ready: consumes Design Studio dev tokens (accent/font/scale/radius)', /var\(--accent/.test(css) && /var\(--font-display/.test(css) && /var\(--font-scale/.test(css) && /var\(--radius/.test(css));
}

// ═══ 4. the SAME engine underneath — industry realization is reused, not forked ═══
{
  const plumber = render('plumber');
  ok('plumber: /services/ (not /menu/), nav says Services', 'services/index.html' in plumber && !('menu/index.html' in plumber) && plumber['index.html'].includes('>Services</a>'));
  ok('plumber: @type Plumber, ItemList of Service, no Menu/Restaurant', plumber['index.html'].includes('"@type":"Plumber"') && plumber['services/index.html'].includes('"@type":"Service"') && !plumber['index.html'].includes('"@type":"Restaurant"'));
  const rest = render('restaurant');
  ok('restaurant on Editorial: still Menu + @type Restaurant', 'menu/index.html' in rest && rest['index.html'].includes('"@type":"Restaurant"'));
}

// ═══ 5. production laws hold (a11y / form / SEO / provenance) ═══
{
  const f = render('plumber');
  const home = f['index.html'];
  ok('accessibility: lang, skip link, exactly one <h1> on the home page', /<html lang="/.test(home) && home.includes('class="skip"') && (home.match(/<h1[ >]/g) || []).length === 1);
  ok('every <img> carries an alt attribute', [...home.matchAll(/<img\b[^>]*>/g)].every((m) => /\balt=/.test(m[0])));
  ok('contact form: honeypot + thanks page is noindexed', f['contact/index.html'].includes('name="_hp"') && f['thanks/index.html'].includes('name="robots" content="noindex"'));
  ok('editorial keeps ZERO client JavaScript', !Object.entries(f).some(([k, v]) => k.endsWith('.html') && /<script(?![^>]*application\/ld\+json)/.test(v)));
  ok('provenance markers preserved (data-pr on the hero identity)', home.includes('data-pr="identity.business_name"'));
}

// ═══ 6. XSS-safe + deterministic ═══
{
  const hostile = structuredClone(fixture);
  hostile.template_slug = 'editorial';
  hostile.content.identity.business_name = '<script>alert(1)</script>';
  hostile.content.identity.tagline = '"><img src=x onerror=alert(1)>';
  const h = renderSnapshot(hostile, SITE)['index.html'];
  ok('hostile input is escaped, never executed', !h.includes('<script>alert(1)</script>') && !h.includes('<img src=x onerror') && h.includes('&lt;script&gt;'));
  const a = render('plumber'), b = render('plumber');
  ok('deterministic: identical snapshot → identical bytes', Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ EDITORIAL TEMPLATE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
