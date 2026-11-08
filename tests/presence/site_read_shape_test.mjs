// ── Item 63: the site read carries what the page reads, and the browser tests fake that shape ──
//   deno run --allow-read --allow-env tests/presence/site_read_shape_test.mjs
// The page reads the address, the hosting, the publish date and the template name from
// `site`. The route sent none of them, while every browser test's fake /site put them
// there, so the suite stayed green while a published site read as "Not live yet".
import { siteOrigin, hostedName } from '../../supabase/functions/presence/lib/site.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// what the route puts inside `site`
const route = read('supabase/functions/presence/routes/site.ts');
const block = route.slice(route.indexOf('      site: {'), route.indexOf('},', route.indexOf('      site: {')));
const SENT = new Set([...block.matchAll(/\b([a-z_]+):/g)].map((m) => m[1]));
for (const k of ['id', 'status', 'edition', 'template', 'template_slug', 'template_version', 'custom_domain', 'netlify_site_id', 'last_published_at']) {
  ok(`route: site carries ${k}`, SENT.has(k), [...SENT].join(','));
}

// every fake /site in the browser tests uses only keys the route sends
const specs = [...Deno.readDirSync(new URL('tests/e2e/', ROOT))].filter((f) => f.name.endsWith('.ts')).map((f) => f.name);
let fakes = 0;
const strays = [];
for (const name of specs) {
  const src = read(`tests/e2e/${name}`);
  for (const m of src.matchAll(/'\/site':\s*\{\s*data:\s*\{\s*site:\s*\{([^}]*)\}/g)) {
    fakes++;
    for (const k of [...m[1].matchAll(/\b([a-z_]+):/g)].map((x) => x[1])) if (!SENT.has(k)) strays.push(`${name}: ${k}`);
  }
}
ok('fakes: the browser tests fake /site somewhere (the check has something to check)', fakes >= 3, String(fakes));
ok('fakes: every key a browser test puts in site is one the route really sends', strays.length === 0, strays.slice(0, 6).join(' | '));

// the address helper: the site's own domain, else its Netlify name, never Netlify's internal id
const ID = '11111111-1111-4111-8111-111111111111';
ok('address: own domain first', siteOrigin({ id: ID, custom_domain: 'marlows.example', netlify_site_id: 'nf' }) === 'https://marlows.example');
ok('address: hosted without a domain → the name the provisioner gives it', siteOrigin({ id: ID, custom_domain: null, netlify_site_id: 'a-netlify-uuid' }) === 'https://presence-111111111111.netlify.app' && hostedName(ID) === 'presence-111111111111');
ok('address: never built from the internal id', !siteOrigin({ id: ID, netlify_site_id: 'a-netlify-uuid' }).includes('a-netlify-uuid'));
ok('address: nothing hosted → empty', siteOrigin({ id: ID, custom_domain: null, netlify_site_id: null }) === '' && siteOrigin(null) === '');
// and no server file builds an address from netlify_site_id any more (gsc.ts keeps a no-id fallback)
const offenders = [];
const walk = (dir) => { for (const e of Deno.readDirSync(new URL(dir, ROOT))) { const p = `${dir}${e.name}`; if (e.isDirectory) walk(`${p}/`); else if (p.endsWith('.ts') && /netlify_site_id\}\.netlify\.app/.test(read(p)) && !p.endsWith('lib/gsc.ts')) offenders.push(p); } };
walk('supabase/functions/');
ok('address: no server file builds a host from netlify_site_id', offenders.length === 0, offenders.join(','));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SITE READ SHAPE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
