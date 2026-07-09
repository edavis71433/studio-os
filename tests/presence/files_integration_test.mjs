// ── Phase DAM-1: Files — LIVE integration (replace + rollback ref-repointing) ──
// Exercises the real route handlers against a real Postgres (staging), on ISOLATED
// throwaway rows, to prove the risky mutation flows actually repoint every content
// reference and maintain the version chain. Skips cleanly when creds are absent.
//   SUPABASE_URL=<staging> SERVICE_ROLE_KEY=<staging sr> SITE=<site uuid?> \
//     deno run --allow-env --allow-net tests/presence/files_integration_test.mjs
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SR = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
if (!SB_URL || !SR) { console.log('SKIP files_integration (SUPABASE_URL / SERVICE_ROLE_KEY not set)'); Deno.exit(0); }

const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
const { handleAssetReplace, handleAssetRollback, handleAssetDuplicate } = await import('../../supabase/functions/presence/routes/assets.ts');
const { createUpload, signDownload } = await import('../../supabase/functions/presence/lib/media.ts');
const PNG1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const arr = (r) => (Array.isArray(r.json) ? r.json : []);
const uuid = () => crypto.randomUUID();

// pick a site to attach isolated test rows to (never touches its real content)
let SITE = Deno.env.get('SITE') || '';
if (!SITE) { const s = await svc('presence_sites?select=id,client_id&limit=1'); SITE = arr(s)[0]?.id; }
const siteRow = arr(await svc(`presence_sites?id=eq.${SITE}&select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition&limit=1`))[0];
if (!siteRow) { console.log('SKIP — no usable site'); Deno.exit(0); }

const principal = { kind: 'client', userId: uuid(), email: 'itest@example.com', tenantId: null, role: 'client', jwt: '', requestId: 'itest' };
const cors = {};
const created = { media: [], offering: null };

async function mkMedia(tag) {
  const r = await svc('presence_media', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: SITE, storage_path: `presence-media/${SITE}/itest-${tag}-${uuid()}.png`, alt_text: `itest ${tag}`, mime: 'image/png', bytes: 1234, asset_status: 'approved' }) });
  const id = arr(r)[0]?.id; created.media.push(id); return id;
}

try {
  const OLD = await mkMedia('old');
  const NEW = await mkMedia('new');
  const offR = await svc('presence_offerings', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: SITE, name: 'ITEST offering', category: 'itest', description: '', price_text: '', media_id: OLD, is_visible: false }) });
  const OFF = arr(offR)[0]?.id; created.offering = OFF;
  ok('setup: created two files + an offering referencing the old one', !!OLD && !!NEW && !!OFF);

  // ── REPLACE: OLD → NEW, must repoint the offering + build the version chain ──
  const req = new Request('http://x/assets/' + OLD + '/replace', { method: 'POST', body: JSON.stringify({ with: NEW }) });
  const res = await handleAssetReplace(req, siteRow, principal, OLD, cors);
  ok('replace: returns ok', res.status === 200);

  const offAfter = arr(await svc(`presence_offerings?id=eq.${OFF}&select=media_id`))[0];
  ok('replace: the offering now points at the NEW file', offAfter?.media_id === NEW);
  const oldAfter = arr(await svc(`presence_media?id=eq.${OLD}&select=deleted_at,metadata`))[0];
  ok('replace: the OLD file is retained as a soft-deleted prior version', !!oldAfter?.deleted_at);
  ok('replace: OLD links forward (metadata.replaced_by === NEW)', oldAfter?.metadata?.replaced_by === NEW);
  const newAfter = arr(await svc(`presence_media?id=eq.${NEW}&select=deleted_at,metadata`))[0];
  ok('replace: NEW is live and links back (metadata.replaces === OLD)', !newAfter?.deleted_at && newAfter?.metadata?.replaces === OLD);

  // ── ROLLBACK: undo, must repoint back + restore the prior version ──
  const rb = await handleAssetRollback(siteRow, principal, NEW, cors);
  ok('rollback: returns ok', rb.status === 200);
  const offBack = arr(await svc(`presence_offerings?id=eq.${OFF}&select=media_id`))[0];
  ok('rollback: the offering points at the OLD file again', offBack?.media_id === OLD);
  const oldBack = arr(await svc(`presence_media?id=eq.${OLD}&select=deleted_at`))[0];
  ok('rollback: the OLD (prior) file is live again', !oldBack?.deleted_at);
  const newBack = arr(await svc(`presence_media?id=eq.${NEW}&select=deleted_at`))[0];
  ok('rollback: the NEW file is now the retired one', !!newBack?.deleted_at);

  // ── DUPLICATE: exercises the real storage copy API with a real object ──
  const up = await createUpload(SITE, { mime: 'image/png', bytes: PNG1x1.length, alt_text: 'itest original' });
  ok('duplicate setup: signed upload issued', !('error' in up) && !!up.media_id);
  if (!('error' in up)) {
    created.media.push(up.media_id);
    const put = await fetch(up.upload_url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: PNG1x1 });
    ok('duplicate setup: original object uploaded to the bucket', put.ok);
    const dupRes = await handleAssetDuplicate(siteRow, principal, up.media_id, cors);
    ok('duplicate: returns created', dupRes.status === 201);
    const dupBody = await dupRes.json().catch(() => ({}));
    const DUP = dupBody?.data?.asset?.id; if (DUP) created.media.push(DUP);
    ok('duplicate: a new file row was created', !!DUP && DUP !== up.media_id);
    const dupRow = arr(await svc(`presence_media?id=eq.${DUP}&select=storage_path`))[0];
    ok('duplicate: the copy has its OWN storage object (distinct path)', !!dupRow && dupRow.storage_path !== up.storage_path);
    const dl = await signDownload(dupRow.storage_path);
    const head = dl ? await fetch(dl, { method: 'GET' }) : { ok: false };
    ok('duplicate: the copied object actually exists in storage (downloadable)', head.ok);
  }
} finally {
  // cleanup — hard-delete the isolated test rows + their storage objects
  // (change-audit events are append-only; a few test rows there are harmless)
  if (created.offering) await svc(`presence_offerings?id=eq.${created.offering}`, { method: 'DELETE' });
  for (const m of created.media) {
    if (!m) continue;
    const row = arr(await svc(`presence_media?id=eq.${m}&select=storage_path`))[0];
    await svc(`presence_media?id=eq.${m}`, { method: 'DELETE' });
    if (row?.storage_path) { const obj = row.storage_path.replace('presence-media/', ''); await fetch(`${SB_URL}/storage/v1/object/presence-media/${obj}`, { method: 'DELETE', headers: { apikey: SR, Authorization: `Bearer ${SR}` } }).catch(() => {}); }
  }
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ FILES LIVE INTEGRATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
