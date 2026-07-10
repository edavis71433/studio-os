// ── Preview hardening (Presence CMS Phase 1, M8) ─────────────────────────────
//   deno run --allow-read --allow-env tests/presence/preview_hardening_test.mjs
// Pure cache (LRU/TTL/keying) + signed-link (sign/verify/expiry/tamper/scope)
// + structural wiring. No network.
Deno.env.delete('PREVIEW_CACHE_MAX');
Deno.env.delete('PREVIEW_CACHE_TTL_MS');

const C = await import('../../supabase/functions/presence/lib/preview_cache.ts');
const { PreviewCache, previewCacheKey } = C;
const L = await import('../../supabase/functions/presence/lib/preview_link.ts');
const { signPreviewToken, verifyPreviewToken, clampTtlSeconds, previewLinkSecret,
  PREVIEW_LINK_DEFAULT_TTL_S, PREVIEW_LINK_MAX_TTL_S, PREVIEW_LINK_MIN_TTL_S } = L;

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';
const entry = (tag) => ({ fileMap: { 'index.html': `<html>${tag}</html>` }, mediaManifest: [], blockers: 0, warnings: 0 });

// ── cache key: content-addressed + site-scoped ──
ok('key: draft key includes site + kind + hash', previewCacheKey(SITE_A, 'draft', 'abc') === `${SITE_A}:draft:abc`);
ok('key: snap key distinct from draft key', previewCacheKey(SITE_A, 'snap', 'abc') !== previewCacheKey(SITE_A, 'draft', 'abc'));
ok('key: same disc on two sites → different keys (tenant-scoped)', previewCacheKey(SITE_A, 'draft', 'h') !== previewCacheKey(SITE_B, 'draft', 'h'));

// ── cache hit / miss ──
{
  const c = new PreviewCache(4, 60_000);
  const k = previewCacheKey(SITE_A, 'draft', 'h1');
  ok('cache: miss on empty', c.get(k, 1000) === null);
  c.set(k, entry('v1'), 1000);
  ok('cache: hit after set (same key)', c.get(k, 1500)?.fileMap['index.html'] === '<html>v1</html>');
}

// ── invalidation: a changed draft hash is simply a NEW key → old never served ──
{
  const c = new PreviewCache(4, 60_000);
  c.set(previewCacheKey(SITE_A, 'draft', 'hashOLD'), entry('old'), 0);
  ok('invalidation: the new-hash key misses (never serves stale after an edit)', c.get(previewCacheKey(SITE_A, 'draft', 'hashNEW'), 10) === null);
  ok('invalidation: the old-hash entry is still its own value (harmless, ages out)', c.get(previewCacheKey(SITE_A, 'draft', 'hashOLD'), 10)?.fileMap['index.html'] === '<html>old</html>');
}

// ── TTL expiry (injected clock) ──
{
  const c = new PreviewCache(4, 5_000);
  const k = previewCacheKey(SITE_A, 'snap', 's1');
  c.set(k, entry('x'), 1_000);
  ok('ttl: within window → hit', c.get(k, 3_000) !== null);
  ok('ttl: past window → miss (evicted)', c.get(k, 6_500) === null);
  ok('ttl: expired entry removed from the map', c.size === 0);
}

// ── LRU eviction over capacity ──
{
  const c = new PreviewCache(3, 60_000);
  c.set(previewCacheKey(SITE_A, 'snap', 'a'), entry('a'), 1);
  c.set(previewCacheKey(SITE_A, 'snap', 'b'), entry('b'), 2);
  c.set(previewCacheKey(SITE_A, 'snap', 'c'), entry('c'), 3);
  c.get(previewCacheKey(SITE_A, 'snap', 'a'), 4); // touch 'a' → most-recent
  c.set(previewCacheKey(SITE_A, 'snap', 'd'), entry('d'), 5); // over cap → evict LRU ('b')
  ok('lru: capacity bounded at max', c.size === 3);
  ok('lru: least-recently-used (b) evicted', c.get(previewCacheKey(SITE_A, 'snap', 'b'), 6) === null);
  ok('lru: recently-touched (a) survives', c.get(previewCacheKey(SITE_A, 'snap', 'a'), 6) !== null);
}

// ── per-site invalidation hook ──
{
  const c = new PreviewCache(8, 60_000);
  c.set(previewCacheKey(SITE_A, 'draft', 'h'), entry('a'), 1);
  c.set(previewCacheKey(SITE_B, 'draft', 'h'), entry('b'), 1);
  c.invalidateSite(SITE_A);
  ok('invalidateSite: drops only the target site', c.get(previewCacheKey(SITE_A, 'draft', 'h'), 2) === null && c.get(previewCacheKey(SITE_B, 'draft', 'h'), 2) !== null);
}

// ── SIGNED LINKS ──
const SECRET = 'test-secret-value-please-ignore';
const NOW = 1_700_000_000; // fixed epoch seconds
{
  const tok = await signPreviewToken({ site_id: SITE_A, exp: NOW + 3600, scope: 'preview' }, SECRET);
  const v = await verifyPreviewToken(tok, SECRET, NOW);
  ok('sign/verify: valid unexpired token verifies', v.ok === true && v.payload.site_id === SITE_A);

  // expiry enforced (fail closed)
  const expired = await signPreviewToken({ site_id: SITE_A, exp: NOW - 1, scope: 'preview' }, SECRET);
  const ve = await verifyPreviewToken(expired, SECRET, NOW);
  ok('expiry: an expired token FAILS CLOSED (error=expired)', ve.ok === false && ve.error === 'expired');

  // wrong secret → bad signature (fail closed)
  const vw = await verifyPreviewToken(tok, 'different-secret', NOW);
  ok('signature: wrong secret → bad_signature (no bypass)', vw.ok === false && vw.error === 'bad_signature');

  // tampered signature → bad signature
  const [body] = tok.split('.');
  const vt = await verifyPreviewToken(`${body}.deadbeef`, SECRET, NOW);
  ok('signature: tampered signature → bad_signature', vt.ok === false && vt.error === 'bad_signature');

  // tampered payload (swap site_id) keeping old sig → bad signature (site-scope integrity)
  const forged = await signPreviewToken({ site_id: SITE_B, exp: NOW + 3600, scope: 'preview' }, SECRET);
  const forgedBody = forged.split('.')[0];
  const origSig = tok.split('.')[1];
  const vp = await verifyPreviewToken(`${forgedBody}.${origSig}`, SECRET, NOW);
  ok('scope: cannot swap site_id under an old signature → bad_signature (cross-tenant blocked)', vp.ok === false && vp.error === 'bad_signature');

  // malformed shapes
  ok('malformed: empty token → malformed', (await verifyPreviewToken('', SECRET, NOW)).error === 'malformed');
  ok('malformed: no separator → malformed', (await verifyPreviewToken('justonepart', SECRET, NOW)).error === 'malformed');

  // scope must be 'preview'
  const wrongScope = await signPreviewToken({ site_id: SITE_A, exp: NOW + 3600, scope: 'other' }, SECRET);
  ok('scope: a non-preview scope is rejected', (await verifyPreviewToken(wrongScope, SECRET, NOW)).ok === false);
}

// ── TTL clamp ──
ok('ttl-clamp: absent → default 24h', clampTtlSeconds(undefined) === PREVIEW_LINK_DEFAULT_TTL_S && PREVIEW_LINK_DEFAULT_TTL_S === 24 * 3600);
ok('ttl-clamp: over max → capped at 7d', clampTtlSeconds(999 * 24 * 3600) === PREVIEW_LINK_MAX_TTL_S && PREVIEW_LINK_MAX_TTL_S === 7 * 24 * 3600);
ok('ttl-clamp: below min → floored', clampTtlSeconds(5) === PREVIEW_LINK_MIN_TTL_S && PREVIEW_LINK_MIN_TTL_S === 60);
ok('ttl-clamp: in range → honored', clampTtlSeconds(3600) === 3600);

// ── secret resolution (fail-closed when none) ──
{
  for (const n of ['PREVIEW_LINK_SECRET', 'APPROVAL_SECRET', 'STATE_SIGNING_SECRET', 'SCHEDULER_SECRET']) Deno.env.delete(n);
  ok('secret: none configured → null (mint/verify fail closed)', previewLinkSecret() === null);
  Deno.env.set('SCHEDULER_SECRET', 'x');
  ok('secret: falls back to SCHEDULER_SECRET (reuses existing config)', previewLinkSecret() === 'x');
  Deno.env.set('APPROVAL_SECRET', 'y');
  ok('secret: prefers APPROVAL_SECRET over SCHEDULER_SECRET', previewLinkSecret() === 'y');
  Deno.env.delete('APPROVAL_SECRET'); Deno.env.delete('SCHEDULER_SECRET');
}

// ── structural wiring ──
{
  const prev = read('supabase/functions/presence/routes/preview.ts');
  ok('wiring: authed preview caches the render keyed by the M3 hash', /computeDraftHash\(snapshot\)/.test(prev) && /previewCache\.(get|set)/.test(prev) && /previewCacheKey\(site\.id, 'draft'/.test(prev));
  ok('wiring: draft watermark injected in preview (draft/preview versions only)', /injectPreviewBadge\(/.test(prev) && /version === 'draft' \|\| version === 'preview'/.test(prev));

  const render = read('supabase/functions/presence/lib/render.ts');
  ok('SAFETY: the publish renderer never injects the preview badge (watermark can’t reach a live deploy)', !/presence-preview-badge/.test(render) && !/injectPreviewBadge/.test(render));

  const penv = read('supabase/functions/presence/routes/preview_env.ts');
  ok('wiring: shared public renderer caches by snapshot id', /previewCacheKey\(siteId, 'snap', snapshotId\)/.test(penv));
  ok('wiring: signed preview handler verifies + fails closed on missing secret', /verifyPreviewToken\(/.test(penv) && /previewLinkSecret\(\)/.test(penv) && /fail closed/.test(penv));
  ok('wiring: mint route is site-scoped to the caller’s site', /signPreviewToken\(\{ site_id: site\.id/.test(penv));

  const idx = read('supabase/functions/presence/index.ts');
  ok('wiring: signed preview route is PUBLIC (pre-auth) and matched before the opaque door', /\\\/p\\\/s\\\//.test(idx) && /handleSignedPreview/.test(idx));
  ok('wiring: mint route is behind the authed site resolution', /\/preview\/share-link.*handlePreviewShareLink/.test(idx));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PREVIEW HARDENING (M8): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
