// ── Draft-version hash (Presence CMS Phase 1, M3) ────────────────────────────
//   deno run --allow-read tests/presence/draft_hash_test.mjs
// Pure: hashes a real template fixture (a Snapshot) and verifies the M3 contract.
import { computeDraftHash, canonicalize, draftHashMaterial } from '../../supabase/functions/presence/lib/draft_hash.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => JSON.parse(Deno.readTextFileSync(new URL(p, ROOT)));
const fixture = read('supabase/functions/presence/templates/restaurant-classic/1.0.0/fixture.json');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const clone = (o) => JSON.parse(JSON.stringify(o));

// 1. deterministic — same content → same hash, and it's a SHA-256 hex string
const h1 = await computeDraftHash(fixture);
const h2 = await computeDraftHash(fixture);
ok('deterministic: same snapshot → identical hash (64-hex)', h1 === h2 && /^[0-9a-f]{64}$/.test(h1));

// 2. the timestamp is NOT content — a different created_at must not move the hash
const diffTime = clone(fixture); diffTime.created_at = '2099-12-31T23:59:59.000Z';
ok('timestamp excluded: created_at does not affect the hash', (await computeDraftHash(diffTime)) === h1);

// 3. stable ordering — reordering OBJECT KEYS is not semantic → same hash
const reordered = clone(fixture);
reordered.content.identity = Object.fromEntries(Object.entries(reordered.content.identity).reverse());
ok('stable ordering: reordering object keys does not change the hash', (await computeDraftHash(reordered)) === h1);

// 4. different content → different hash
const changed = clone(fixture); changed.content.identity.business_name += ' — Annex';
ok('content-sensitive: a changed field yields a different hash', (await computeDraftHash(changed)) !== h1);

// 5. ARRAY order IS semantic — reordering offerings (page order) must change the hash
if (Array.isArray(fixture.content.offerings) && fixture.content.offerings.length >= 2) {
  const arr = clone(fixture); arr.content.offerings.reverse();
  ok('array-order semantic: reordering offerings changes the hash', (await computeDraftHash(arr)) !== h1);
} else {
  ok('array-order semantic: (fixture has <2 offerings — skipped)', true);
}

// 6. the developer layer is part of the draft identity
const dev = clone(fixture); dev.dev_customization = { theme_tokens: { '--accent': '#123456' }, custom_css: '', custom_html: '' };
ok('dev-layer sensitive: adding a dev layer changes the hash', (await computeDraftHash(dev)) !== h1);

// 7. a template switch changes what renders → changes the hash
const tpl = clone(fixture); tpl.template_slug = 'business-classic';
ok('template-sensitive: switching template changes the hash', (await computeDraftHash(tpl)) !== h1);

// 8. canonicalize unit — sorts object keys, preserves array order
ok('canonicalize: object keys sorted', JSON.stringify(canonicalize({ b: 1, a: 2, list: [3, 1, 2] })) === JSON.stringify({ a: 2, b: 1, list: [3, 1, 2] }));
ok('canonicalize: array order preserved', JSON.stringify(canonicalize([3, 1, 2])) === '[3,1,2]');

// 9. material carries the render inputs but NOT the timestamp
{
  const mat = draftHashMaterial(fixture);
  ok('material: includes content + template, excludes created_at', 'content' in mat && 'template_slug' in mat && !('created_at' in mat));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ DRAFT HASH (M3): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
