// ── FD-T2 · indexed, lazy-ready template registry ────────────────────────────
//   deno run --allow-read --allow-env tests/presence/registry_test.mjs
// The catalog is metadata-first + memoized, and a mis-keyed template can't ship
// silently (the integrity guard) — what a registry needs to scale to hundreds of
// versions. getTemplate stays synchronous for manifests; each template's drawing
// code loads on its first draw (item 107), so every entry's code is loaded here.
import { getTemplate, latestTemplateVersion, listTemplates, templateIndex, registryIntegrity, templateCodeLoads } from '../../supabase/functions/presence/lib/render.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };

const integrity = registryIntegrity();
ok('registry integrity holds (every manifest matches its keys)', integrity.ok, integrity.problems?.join('; '));
ok('the index lists the shipped families', (() => { const s = templateIndex().map((e) => e.slug).sort(); return s.length === 8 && ['restaurant-classic', 'business-classic', 'editorial', 'aurora', 'slate', 'meadow', 'atelier', 'harbor'].every((x) => s.includes(x)); })());
ok('every index entry has latest + a numeric contract version', templateIndex().every((e) => e.latest && e.versions.includes(e.latest) && typeof e.content_contract_version === 'number'));
ok('getTemplate returns render + manifest; unknown → null', (() => { const t = getTemplate('business-classic', '1.0.0'); return t && typeof t.render === 'function' && t.manifest.slug === 'business-classic' && getTemplate('nope', '1.0.0') === null && getTemplate('business-classic', '9.9.9') === null; })());
ok('getTemplate memoizes (same object on repeat)', getTemplate('editorial', '1.0.0') === getTemplate('editorial', '1.0.0'));
{
  const bad = [];
  for (const e of templateIndex()) for (const v of e.versions) if (!(await templateCodeLoads(e.slug, v))) bad.push(`${e.slug}@${v}`);
  ok('every template\'s drawing code loads and exports render (item 107: it loads on first use)', bad.length === 0 && templateIndex().length === 8);
  ok('an unknown template\'s code does not load', (await templateCodeLoads('nope', '1.0.0')) === false);
  const t = getTemplate('aurora', '1.0.0'), first = await t.render(structuredClone(JSON.parse(Deno.readTextFileSync(new URL('../../supabase/functions/presence/templates/aurora/1.0.0/fixture.json', import.meta.url)))), t.manifest, { baseUrl: 'https://x.test' });
  ok('a template draws through its stand-in (loads, then returns the real files)', typeof first['index.html'] === 'string' && first['index.html'].includes('<html'));
}
ok('latestTemplateVersion resolves via the index', latestTemplateVersion('restaurant-classic') === '1.0.0' && latestTemplateVersion('nope') === null);
ok('listTemplates returns {slug,name,version} for each family', (() => { const l = listTemplates(); return l.length === 8 && l.every((x) => x.slug && x.name && x.version) && l.some((x) => x.slug === 'business-classic') && l.some((x) => x.slug === 'harbor'); })());

// Drawing is async since item 107. A missed await type-checks wherever the result is only
// walked as an object (Object.entries of a promise is []), so the export once would have
// shipped an empty website. Every draw in the server must wait for its files.
{
  const root = new URL('../../supabase/functions/', import.meta.url);
  const unawaited = [];
  const walk = (dir) => {
    for (const e of Deno.readDirSync(dir)) {
      const u = new URL(e.name + (e.isDirectory ? '/' : ''), dir);
      if (e.isDirectory) { if (e.name !== 'templates') walk(u); continue; }
      if (!e.name.endsWith('.ts')) continue;
      Deno.readTextFileSync(u).split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || /^\s*(export )?(async )?function (renderSnapshot|renderForBuilder)\b/.test(line)) return;
        for (const m of line.matchAll(/(\bawait\s+|return\s+)?(?:[\w$!]+\.render|\brenderSnapshot|\brenderForBuilder)\(/g)) {
          if (!m[1]) unawaited.push(`${u.pathname.split('/functions/')[1]}:${i + 1}`);
        }
      });
    }
  };
  walk(root);
  ok('every template draw in the server is awaited', unawaited.length === 0);
  if (unawaited.length) console.log('  not awaited: ' + unawaited.join(', '));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ TEMPLATE REGISTRY: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
