// ── Publish guard (Presence CMS Phase 1, M4) ─────────────────────────────────
//   deno run --allow-read tests/presence/publish_guard_test.mjs
// Pure decision logic: idempotency-key parsing, the 60s cooldown, replay shape.
import { parseIdempotencyKey, cooldownRemainingMs, replayData, PUBLISH_COOLDOWN_MS, MAX_IDEMPOTENCY_KEY_LEN }
  from '../../supabase/functions/presence/lib/publish_guard.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ── parseIdempotencyKey ──
ok('idem: absent header → ok, key null (backward-compatible)', (() => { const r = parseIdempotencyKey(null); return r.ok && r.key === null; })());
ok('idem: whitespace-only → ok, key null (treated as absent)', (() => { const r = parseIdempotencyKey('   '); return r.ok && r.key === null; })());
ok('idem: UUID key accepted', (() => { const r = parseIdempotencyKey('a1b2c3d4-0000-4000-8000-abcdef012345'); return r.ok && r.key === 'a1b2c3d4-0000-4000-8000-abcdef012345'; })());
ok('idem: alnum/._:- key accepted', (() => { const r = parseIdempotencyKey('pub_2026-07-09.T12:00'); return r.ok && r.key === 'pub_2026-07-09.T12:00'; })());
ok('idem: whitespace inside → rejected', parseIdempotencyKey('bad key').ok === false);
ok('idem: exotic/control chars → rejected', parseIdempotencyKey('bad;drop').ok === false && parseIdempotencyKey('emoji\u{1F600}').ok === false);
ok('idem: oversized key → rejected', parseIdempotencyKey('x'.repeat(MAX_IDEMPOTENCY_KEY_LEN + 1)).ok === false);
ok('idem: max-length key accepted', (() => { const r = parseIdempotencyKey('x'.repeat(MAX_IDEMPOTENCY_KEY_LEN)); return r.ok && r.key.length === MAX_IDEMPOTENCY_KEY_LEN; })());
ok('idem: key is trimmed', (() => { const r = parseIdempotencyKey('  abc123  '); return r.ok && r.key === 'abc123'; })());

// ── cooldownRemainingMs ──
const NOW = 1_000_000_000_000; // fixed epoch ms (deterministic)
ok('cooldown: no last publish → 0', cooldownRemainingMs(null, NOW) === 0);
ok('cooldown: unparseable timestamp → 0 (fail-open, never wedges)', cooldownRemainingMs('not-a-date', NOW) === 0);
ok('cooldown: 1s ago → nearly the full window remains', (() => { const r = cooldownRemainingMs(new Date(NOW - 1000).toISOString(), NOW); return r > 58_000 && r <= 60_000; })());
ok('cooldown: 30s ago → ~30s remaining', (() => { const r = cooldownRemainingMs(new Date(NOW - 30_000).toISOString(), NOW); return r > 29_000 && r <= 31_000; })());
ok('cooldown: exactly at the window edge → 0', cooldownRemainingMs(new Date(NOW - PUBLISH_COOLDOWN_MS).toISOString(), NOW) === 0);
ok('cooldown: 61s ago → 0 (window passed)', cooldownRemainingMs(new Date(NOW - 61_000).toISOString(), NOW) === 0);
ok('cooldown: window constant is 60s', PUBLISH_COOLDOWN_MS === 60_000);

// ── replayData ──
ok('replay: live → live message + idempotent flag + summary', (() => { const d = replayData({ status: 'live', change_summary: 'x' }); return d.status === 'live' && d.idempotent_replay === true && d.summary === 'x'; })());
ok('replay: deploying → publishing', replayData({ status: 'deploying' }).status === 'publishing');
ok('replay: queued → publishing', replayData({ status: 'queued' }).status === 'publishing');
ok('replay: failed → failed', replayData({ status: 'failed' }).status === 'failed');
ok('replay: missing summary → default', replayData({ status: 'live' }).summary === 'Publishing your site');

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PUBLISH GUARD (M4): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
