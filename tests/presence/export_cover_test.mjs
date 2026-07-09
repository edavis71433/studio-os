// ── BR-1 · branded export cover (extends the existing export; no PDF engine) ──
//   deno run --allow-read --allow-env tests/presence/export_cover_test.mjs
import { exportCoverHtml } from '../../supabase/functions/presence/lib/export_cover.ts';
import { brandFromKit } from '../../supabase/functions/presence/lib/email_brand.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };

const brand = brandFromKit({ primary: '#2f5d8a' }, "Marlow’s Kitchen");
const html = exportCoverHtml(brand, { exportedAt: '2026-07-09T12:00:00Z', pages: 8, photos: 12, hasBrand: true, domain: 'marlows.com' });

ok('cover is a full self-contained HTML doc, no external assets', /^<!doctype html>/i.test(html) && html.includes('</html>') && !/https?:\/\//.test(html));
ok('cover carries the brand name + brand accent (Brand Kit is the source)', html.includes("Marlow’s Kitchen") && html.includes('#2f5d8a'));
ok('cover shows the export summary (pages, photos, brand, domain)', html.includes('>8<') && html.includes('>12<') && html.includes('Included') && html.includes('marlows.com'));
ok('cover shows the export date', html.includes('2026-07-09'));
ok('brand profile absent + no domain → clean fallback', (() => { const h = exportCoverHtml(brand, { exportedAt: '2026-07-09', pages: 1, photos: 0, hasBrand: false, domain: null }); return h.includes('>—<') && !h.includes('Domain'); })());
ok('a hostile business name is escaped', exportCoverHtml(brandFromKit(null, '<script>x</script>'), { exportedAt: '2026-01-01', pages: 0, photos: 0, hasBrand: false, domain: null }).includes('&lt;script&gt;'));
ok('no Brand Kit → the Studio OS default brand', exportCoverHtml(brandFromKit(null, ''), { exportedAt: '2026-01-01', pages: 0, photos: 0, hasBrand: false, domain: null }).includes('Studio OS'));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ EXPORT COVER: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
