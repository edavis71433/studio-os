// ── FD-T2 · indexed, lazy-ready template registry ────────────────────────────
//   deno run --allow-read --allow-env tests/presence/registry_test.mjs
// The catalog is metadata-first + memoized, and a mis-keyed template can't ship
// silently (the integrity guard) — what a registry needs to scale to hundreds of
// versions. getTemplate stays synchronous, so the frozen render contract is intact.
import { getTemplate, latestTemplateVersion, listTemplates, templateIndex, registryIntegrity } from '../../supabase/functions/presence/lib/render.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };

const integrity = registryIntegrity();
ok('registry integrity holds (every manifest matches its keys)', integrity.ok, integrity.problems?.join('; '));
ok('the index lists the shipped families', (() => { const s = templateIndex().map((e) => e.slug).sort(); return s.length === 8 && ['restaurant-classic', 'business-classic', 'editorial', 'aurora', 'slate', 'meadow', 'atelier', 'harbor'].every((x) => s.includes(x)); })());
ok('every index entry has latest + a numeric contract version', templateIndex().every((e) => e.latest && e.versions.includes(e.latest) && typeof e.content_contract_version === 'number'));
ok('getTemplate returns render + manifest; unknown → null', (() => { const t = getTemplate('business-classic', '1.0.0'); return t && typeof t.render === 'function' && t.manifest.slug === 'business-classic' && getTemplate('nope', '1.0.0') === null && getTemplate('business-classic', '9.9.9') === null; })());
ok('getTemplate memoizes (same object on repeat)', getTemplate('editorial', '1.0.0') === getTemplate('editorial', '1.0.0'));
ok('latestTemplateVersion resolves via the index', latestTemplateVersion('restaurant-classic') === '1.0.0' && latestTemplateVersion('nope') === null);
ok('listTemplates returns {slug,name,version} for each family', (() => { const l = listTemplates(); return l.length === 8 && l.every((x) => x.slug && x.name && x.version) && l.some((x) => x.slug === 'business-classic') && l.some((x) => x.slug === 'harbor'); })());

const passed = results.filter((r) => r.p).length;
console.log(`\n════ TEMPLATE REGISTRY: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
