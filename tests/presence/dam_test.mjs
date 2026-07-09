// ── Phase DAM: Studio Asset Library pure cores ───────────────────────────────
// Policy-based approval, lifecycle, duplicate detection, usage, safe delete,
// health, collections/tags, and the on-demand library search — all over the
// EXISTING presence_media rows. No new store.
//   deno run --allow-read --allow-env tests/presence/dam_test.mjs
import {
  assetApprovalPolicy, assetAvailable, nextAssetStatus, detectDuplicates, dupKey,
  usageMap, canDelete, assetHealth, collectionsOf, tagsOf, searchAssets,
} from '../../supabase/functions/presence/lib/dam.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const A = (id, o = {}) => ({ id, storage_path: `p/${id}.webp`, alt_text: o.alt ?? 'a clear description', width: o.w ?? 800, height: o.h ?? 600, bytes: o.bytes ?? 100000, tags: o.tags ?? [], collection: o.collection ?? '', metadata: o.metadata ?? {}, content_hash: o.hash ?? '', brand: o.brand ?? false, asset_status: o.status ?? 'approved' });

// ═══ DAM-15: policy-based approval ═══
{
  ok('solo owner → immediate', assetApprovalPolicy({}) === 'immediate');
  ok('agency → optional', assetApprovalPolicy({ isAgency: true }) === 'optional');
  ok('enterprise/team → required', assetApprovalPolicy({ isEnterprise: true }) === 'required');
  ok('immediate: any non-archived asset is usable (no friction)', assetAvailable('draft', 'immediate') && assetAvailable('approved', 'immediate') && !assetAvailable('archived', 'immediate'));
  ok('required: only approved/published are usable', !assetAvailable('draft', 'required') && !assetAvailable('pending', 'required') && assetAvailable('approved', 'required') && assetAvailable('published', 'required'));
  ok('optional: pending held back, drafts still fine', assetAvailable('draft', 'optional') && !assetAvailable('pending', 'optional'));
}

// ═══ lifecycle transitions ═══
{
  ok('draft→pending on submit', nextAssetStatus('draft', 'submit', 'required') === 'pending');
  ok('pending→approved on approve', nextAssetStatus('pending', 'approve', 'required') === 'approved');
  ok('immediate policy lets owner approve a draft directly', nextAssetStatus('draft', 'approve', 'immediate') === 'approved' && nextAssetStatus('draft', 'approve', 'required') === null);
  ok('approved→published; anything→archived; archived→restore', nextAssetStatus('approved', 'publish', 'required') === 'published' && nextAssetStatus('approved', 'archive', 'required') === 'archived' && nextAssetStatus('archived', 'restore', 'required') === 'approved');
  ok('illegal transitions return null', nextAssetStatus('published', 'submit', 'required') === null && nextAssetStatus('draft', 'publish', 'required') === null);
}

// ═══ DAM-8: duplicate detection ═══
{
  const assets = [A('1', { hash: 'abc' }), A('2', { hash: 'abc' }), A('3', { hash: 'xyz' }), A('4', { bytes: 5000, w: 100, h: 100 }), A('5', { bytes: 5000, w: 100, h: 100 })];
  const dups = detectDuplicates(assets);
  ok('groups identical content hashes', dups.some((d) => d.key === 'h:abc' && d.ids.length === 2));
  ok('size/dimension heuristic catches hash-less duplicates', dups.some((d) => d.ids.includes('4') && d.ids.includes('5')));
  ok('unique assets are not flagged', !dups.some((d) => d.ids.includes('3')));
  ok('dupKey prefers hash over size heuristic', dupKey(A('x', { hash: 'q', bytes: 1, w: 2, h: 3 })) === 'h:q');
}

// ═══ DAM-11/12: usage + safe delete ═══
{
  const assets = [A('1'), A('2'), A('3')];
  const usage = usageMap(assets, ['1', '3']);
  ok('usage marks referenced assets', usage['1'] === true && usage['2'] === false && usage['3'] === true);
  ok('safe delete refuses an in-use asset', !canDelete(A('1'), true).ok && canDelete(A('1'), true).reason === 'in_use');
  ok('safe delete allows an unused asset', canDelete(A('2'), false).ok);
}

// ═══ DAM-13: asset health ═══
{
  const assets = [A('1', { alt: 'ok description', bytes: 100 }), A('2', { alt: 'x' }), A('3', { bytes: 4000000 }), A('4', { hash: 'd' }), A('5', { hash: 'd' }), A('6', { status: 'pending' })];
  const findings = assetHealth(assets, ['1', '6']);
  ok('flags missing/short alt text', findings.some((f) => f.asset_id === '2' && f.kind === 'missing_alt'));
  ok('flags unused assets (never the used ones)', findings.some((f) => f.asset_id === '3' && f.kind === 'unused') && !findings.some((f) => f.asset_id === '1' && f.kind === 'unused'));
  ok('flags oversized files', findings.some((f) => f.asset_id === '3' && f.kind === 'oversized'));
  ok('flags duplicates (all but the first of a group)', findings.some((f) => f.asset_id === '5' && f.kind === 'duplicate') && !findings.some((f) => f.asset_id === '4' && f.kind === 'duplicate'));
  ok('flags in-use-but-unapproved', findings.some((f) => f.asset_id === '6' && f.kind === 'used_unapproved'));
  ok('health is plain findings, never a numeric score', !findings.some((f) => /\b\d+\s*(\/|%|score|points)/i.test(JSON.stringify(f))));
}

// ═══ DAM-3/4: collections + tags ═══
{
  const assets = [A('1', { collection: 'Team', tags: ['people', 'office'] }), A('2', { collection: 'Team', tags: ['People'] }), A('3', { collection: 'Food', tags: ['dish'] })];
  ok('collections rolled up with counts', collectionsOf(assets).find((c) => c.name === 'Team').count === 2);
  ok('tags normalized (case-insensitive) + counted', tagsOf(assets).find((t) => t.tag === 'people').count === 2);
}

// ═══ DAM-1/2/6: library search (on-demand, ranked) ═══
{
  const assets = [
    A('1', { alt: 'the founder at the counter', tags: ['team', 'people'], collection: 'Team' }),
    A('2', { alt: 'a plated dinner', tags: ['food'], collection: 'Menu', metadata: { caption: 'the special' } }),
    A('3', { alt: 'empty', tags: ['team'], status: 'archived' }),
  ];
  ok('archived hidden by default; shown when asked', searchAssets(assets, {}).length === 2 && searchAssets(assets, { status: 'archived' }).length === 1);
  ok('filter by collection', searchAssets(assets, { collection: 'Menu' }).map((a) => a.id).join() === '2');
  ok('filter by tag (case-insensitive)', searchAssets(assets, { tag: 'TEAM' }).map((a) => a.id).sort().join() === '1');
  ok('keyword search ranks exact tag hits above text hits', searchAssets(assets, { q: 'team' })[0].id === '1');
  ok('keyword search reaches metadata + alt text', searchAssets(assets, { q: 'special' }).map((a) => a.id).join() === '2' && searchAssets(assets, { q: 'founder' }).map((a) => a.id).join() === '1');
  ok('no matches → empty (honest)', searchAssets(assets, { q: 'zzz nothing' }).length === 0);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ DAM ASSET LIBRARY: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
