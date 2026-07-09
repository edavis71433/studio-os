// ── Phase DAM-2: LIVE integration — Files approval lifecycle (real DB) ────────
// Proves the staged-replace approval against real Postgres: an approval-gated
// replace stays PENDING (old stays live), surfaces in the feed, and only on
// APPROVE does it repoint references live; a REJECT discards it and leaves the
// old version live. Isolated throwaway rows; skips when creds absent.
//   SUPABASE_URL=<staging> SERVICE_ROLE_KEY=<sr> deno run --allow-env --allow-net --allow-read tests/presence/dam2_integration_test.mjs
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SR = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
if (!SB_URL || !SR) { console.log('SKIP dam2_integration (creds not set)'); Deno.exit(0); }

const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
const { handleAssetReplace, handleAssetStatus } = await import('../../supabase/functions/presence/routes/assets.ts');
const { handlePortalFeed } = await import('../../supabase/functions/presence/routes/workspace.ts');

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const arr = (r) => (Array.isArray(r.json) ? r.json : []);
const uuid = () => crypto.randomUUID();

const site = arr(await svc(`presence_sites?select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition&limit=1`))[0];
if (!site) { console.log('SKIP — no site'); Deno.exit(0); }
const SITE = site.id;
const cors = {};
// force the ENTERPRISE (required) policy for this site's client during the test
const entRow = arr(await svc(`presence_entitlements?client_id=eq.${site.client_id}&product=eq.presence&select=plan&limit=1`))[0];
const ENT_EXISTED = !!entRow; const ORIG_PLAN = entRow?.plan ?? null;
const principal = { kind: 'client', userId: uuid(), email: 'owner@itest.com', jwt: '', requestId: 'itest' };
const reviewer = { kind: 'client', userId: uuid(), email: 'reviewer@itest.com', jwt: '', requestId: 'itest' };
const created = { media: [], offering: null };

async function mkMedia(tag) {
  const r = await svc('presence_media', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: SITE, storage_path: `presence-media/${SITE}/dam2-${tag}-${uuid()}.png`, alt_text: `dam2 ${tag}`, mime: 'image/png', bytes: 1234, asset_status: 'approved' }) });
  const id = arr(r)[0]?.id; created.media.push(id); return id;
}

try {
  if (ENT_EXISTED) await svc(`presence_entitlements?client_id=eq.${site.client_id}&product=eq.presence`, { method: 'PATCH', body: JSON.stringify({ plan: 'enterprise' }) });
  else await svc('presence_entitlements', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ client_id: site.client_id, product: 'presence', status: 'active', plan: 'enterprise' }) });

  const OLD = await mkMedia('old'), NEW = await mkMedia('new');
  const offR = await svc('presence_offerings', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: SITE, name: 'DAM2 offering', category: 'itest', description: '', price_text: '', media_id: OLD, is_visible: false }) });
  const OFF = arr(offR)[0]?.id; created.offering = OFF;

  // ── replace under REQUIRED policy → STAGED (pending), NOT live yet ──
  const rep = await (await handleAssetReplace(new Request('http://x', { method: 'POST', body: JSON.stringify({ with: NEW }) }), site, principal, OLD, cors)).json();
  ok('replace under required policy → pending, not applied', rep.data.pending === true);
  ok('replace pending: the offering STILL points at the OLD (live) file', arr(await svc(`presence_offerings?id=eq.${OFF}&select=media_id`))[0].media_id === OLD);
  const newRow = arr(await svc(`presence_media?id=eq.${NEW}&select=asset_status,metadata`))[0];
  ok('replace pending: new file marked pending + linked', newRow.asset_status === 'pending' && newRow.metadata.pending_replace === true && newRow.metadata.replaces === OLD);

  // ── it surfaces in the approval feed (Inbox/Today), reusing pending_approvals ──
  const feed = (await (await handlePortalFeed('', site, principal, cors)).json()).data;
  ok('pending file appears in the ONE approval feed (Inbox/Today)', (feed.pending_approvals || []).some((p) => p.kind === 'file' && p.id === NEW && p.href === `/files.html?focus=${NEW}`));

  // (reviewer approve/reject-only restriction is unit-guarded in the handler.)
  void reviewer;

  // ── APPROVE → now it goes live: references repoint, old retired ──
  const appr = await (await handleAssetStatus(new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'approve' }) }), site, principal, NEW, cors)).json();
  ok('approve: applies the replacement (requires publish)', appr.data.applied === true && appr.data.requires_publish === true);
  ok('approve: the offering now points at the NEW file', arr(await svc(`presence_offerings?id=eq.${OFF}&select=media_id`))[0].media_id === NEW);
  ok('approve: the OLD file is retired (soft-deleted)', !!arr(await svc(`presence_media?id=eq.${OLD}&select=deleted_at`))[0].deleted_at);
  const approvedRow = arr(await svc(`presence_media?id=eq.${NEW}&select=asset_status,metadata`))[0];
  ok('approve: new file approved + stamped who/when', approvedRow.asset_status === 'approved' && !!approvedRow.metadata.approved_by && !approvedRow.metadata.pending_replace);

  // ── REJECT path: a second staged replace, then reject → old stays live ──
  const NEW2 = await mkMedia('new2');
  await (await handleAssetReplace(new Request('http://x', { method: 'POST', body: JSON.stringify({ with: NEW2 }) }), site, principal, NEW, cors)).json(); // replace the now-live NEW
  const rej = await (await handleAssetStatus(new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'reject' }) }), site, principal, NEW2, cors)).json();
  ok('reject: proposed replacement discarded (archived)', rej.data.status === 'archived' && rej.data.applied === false);
  ok('reject: the offering STILL points at the last-approved file (NEW)', arr(await svc(`presence_offerings?id=eq.${OFF}&select=media_id`))[0].media_id === NEW);
} finally {
  if (created.offering) await svc(`presence_offerings?id=eq.${created.offering}`, { method: 'DELETE' });
  for (const m of created.media) if (m) await svc(`presence_media?id=eq.${m}`, { method: 'DELETE' });
  // restore original plan (or remove the row we created)
  if (ENT_EXISTED) await svc(`presence_entitlements?client_id=eq.${site.client_id}&product=eq.presence`, { method: 'PATCH', body: JSON.stringify({ plan: ORIG_PLAN }) });
  else await svc(`presence_entitlements?client_id=eq.${site.client_id}&product=eq.presence`, { method: 'DELETE' });
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ DAM-2 APPROVAL LIVE INTEGRATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
