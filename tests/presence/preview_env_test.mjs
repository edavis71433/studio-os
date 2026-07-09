// ── Phase T · Preview Environment (FD-T20) — pure helpers ────────────────────
//   deno run --allow-read --allow-env tests/presence/preview_env_test.mjs
import { previewBadgeHtml, injectPreviewBadge, hashPreviewPassword, newPreviewToken, shapePreviewStatus } from '../../supabase/functions/presence/lib/preview_env.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };

// badge
ok('badge names the business + carries the marker id', previewBadgeHtml('Joe’s Plumbing').includes('Joe’s Plumbing') && previewBadgeHtml('x').includes('id="presence-preview-badge"'));
ok('badge escapes hostile business names', previewBadgeHtml('<script>x</script>').includes('&lt;script&gt;') && !previewBadgeHtml('<script>x</script>').includes('<script>x'));
ok('inject places the badge before </body>', (() => { const h = injectPreviewBadge('<html><body><h1>hi</h1></body></html>', 'A'); return h.indexOf('presence-preview-badge') < h.indexOf('</body>') && h.indexOf('presence-preview-badge') > h.indexOf('<h1>'); })());
ok('inject is idempotent (never doubles the badge)', (() => { let h = injectPreviewBadge('<body></body>', 'A'); h = injectPreviewBadge(h, 'A'); return (h.match(/presence-preview-badge/g) || []).length === 1; })());
ok('inject with no </body> appends', injectPreviewBadge('<p>bare</p>', 'A').includes('presence-preview-badge'));

// password hashing
{
  const a = await hashPreviewPassword('open sesame');
  const b = await hashPreviewPassword('open sesame');
  const c = await hashPreviewPassword('different');
  ok('password hash is deterministic + 64 hex', a === b && /^[0-9a-f]{64}$/.test(a));
  ok('different passwords → different hashes', a !== c);
  ok('empty / whitespace password → "" (open link)', (await hashPreviewPassword('')) === '' && (await hashPreviewPassword('   ')) === '');
}

// token
ok('a fresh token is long, hex, unguessable, and unique', (() => { const t1 = newPreviewToken(), t2 = newPreviewToken(); return /^[0-9a-f]{64}$/.test(t1) && t1 !== t2; })());

// status shaping
{
  const st = shapePreviewStatus({
    draftChanges: 3,
    preview: { token: 'abcd', snapshot_id: 's1', updated_at: '2026-07-09T00:00:00Z', password_hash: 'h' },
    live: { last_published_at: '2026-07-01T00:00:00Z', summary: '2 changes' },
    baseUrl: 'https://ref.supabase.co/',
  });
  ok('status: preview exists, url built, password flagged', st.preview.exists && st.preview.url.endsWith('/p/abcd') && st.preview.has_password);
  ok('status: draft change count + live published', st.draft.unpublished_changes === 3 && st.live.published && st.live.summary === '2 changes');
  const none = shapePreviewStatus({ draftChanges: 0, preview: null, live: null, baseUrl: 'https://x/' });
  ok('status: no preview → exists false, no url; live unpublished', !none.preview.exists && none.preview.url === null && !none.live.published);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PREVIEW ENV: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
