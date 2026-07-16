// ── Per-thread read marks pure-module suite (Inbox slice 2, migration 0113) ──
// Proves the pure half of lib/thread_reads.ts in isolation:
//   • cleanThreadKey — deny-by-default validation of the UUID-free thread key
//     (control-char strip, trim, length cap, allowlisted prefix + charset);
//   • threadUnread — the unread rule (client activity newer than the reader's
//     mark; no mark → the caller's needs-reply heuristic, so a pre-0113
//     database behaves exactly like today — deploy-order tolerance by design).
//
//   • newestClientMessageAt — the F1 latest-client-activity reduction (the
//     newest CLIENT-authored support message per request, staff replies and
//     studio bumps never count);
//   plus a structural pin: loadThreadMarks orders its read (past the 500-row
//   cap an unordered read returns an ARBITRARY subset — dots would flip back).
//
//   deno run --allow-read --allow-env tests/presence/thread_reads_test.mjs
import {
  cleanThreadKey, newestClientMessageAt, threadUnread, THREAD_KEY_MAX, THREAD_KEY_PREFIXES,
} from '../../supabase/functions/presence/lib/thread_reads.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const UUID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

// ═══ 1. cleanThreadKey — the allowlist ═══
{
  ok('client:<uuid> is a valid key', cleanThreadKey(`client:${UUID}`) === `client:${UUID}`);
  ok('support:<uuid> is a valid key', cleanThreadKey(`support:${UUID}`) === `support:${UUID}`);
  ok('lead:<uuid> is a valid key', cleanThreadKey(`lead:${UUID}`) === `lead:${UUID}`);
  ok('surrounding whitespace is trimmed', cleanThreadKey(`  lead:${UUID}  `) === `lead:${UUID}`);
  ok('control characters are stripped before validation', cleanThreadKey('client:\u0001\u0002' + UUID) === `client:${UUID}`);
  ok('an email-suffixed key survives (reader-key shaped ids)', cleanThreadKey('client:owner@example.com') === 'client:owner@example.com');
}

// ═══ 2. cleanThreadKey — deny by default ═══
{
  ok('unknown prefix → null', cleanThreadKey(`project:${UUID}`) === null);
  ok('prefix alone (empty suffix) → null', cleanThreadKey('client:') === null);
  ok('no prefix at all → null', cleanThreadKey(UUID) === null);
  ok('empty / null / undefined → null', cleanThreadKey('') === null && cleanThreadKey(null) === null && cleanThreadKey(undefined) === null);
  ok('non-string input is stringified then rejected', cleanThreadKey({}) === null && cleanThreadKey(42) === null);
  ok(`over the ${THREAD_KEY_MAX}-char cap → null`, cleanThreadKey('client:' + 'a'.repeat(THREAD_KEY_MAX)) === null);
  ok('PostgREST filter grammar cannot ride in (parens/commas/quotes/stars)', ['client:a,b', 'client:a)b', 'client:a"b', 'client:a*b', 'client:a b'].every((k) => cleanThreadKey(k) === null));
  ok('path/traversal characters are rejected', cleanThreadKey('client:../etc') === null && cleanThreadKey('client:a/b') === null);
  ok('the exported prefix allowlist is exactly client:/support:/lead:', THREAD_KEY_PREFIXES.length === 3 && ['client:', 'support:', 'lead:'].every((p) => THREAD_KEY_PREFIXES.includes(p)));
}

// ═══ 3. threadUnread — the unread rule ═══
{
  const T1 = '2026-07-10T00:00:00Z', T2 = '2026-07-12T00:00:00Z';
  ok('client activity NEWER than the mark → unread', threadUnread(T2, T1, false) === true);
  ok('client activity OLDER than the mark → read', threadUnread(T1, T2, true) === false);
  ok('client activity EXACTLY at the mark → read (strictly newer wins)', threadUnread(T1, T1, true) === false);
  ok('no client activity at all → read, whatever the heuristic says', threadUnread(null, T1, true) === false && threadUnread('', T1, true) === false);
}

// ═══ 4. threadUnread — deploy-order tolerance (no mark → the heuristic) ═══
{
  const T1 = '2026-07-10T00:00:00Z';
  ok('mark null (pre-0113 table / never opened) → heuristic true', threadUnread(T1, null, true) === true);
  ok('mark null → heuristic false', threadUnread(T1, null, false) === false);
  ok('mark undefined behaves like null', threadUnread(T1, undefined, true) === true && threadUnread(T1, undefined, false) === false);
  ok('mark empty-string behaves like null (loadThreadMarks may coerce)', threadUnread(T1, '', true) === true);
}

// ═══ 5. newestClientMessageAt — the F1 latest-client-activity reduction ═══
{
  const T1 = '2026-07-10T00:00:00Z', T2 = '2026-07-12T00:00:00Z', T3 = '2026-07-14T00:00:00Z';
  ok('no messages at all → empty map', Object.keys(newestClientMessageAt([])).length === 0);
  ok('staff-only messages → empty map (studio replies are never client activity)',
    Object.keys(newestClientMessageAt([
      { request_id: 'r1', author_kind: 'staff', created_at: T2 },
      { request_id: 'r1', author_kind: 'system', created_at: T1 },
    ])).length === 0);
  ok('the newest CLIENT-authored message wins per request',
    newestClientMessageAt([
      { request_id: 'r1', author_kind: 'client', created_at: T3 },
      { request_id: 'r1', author_kind: 'staff', created_at: T2 },
      { request_id: 'r1', author_kind: 'client', created_at: T1 },
    ])['r1'] === T3);
  ok('order-independent (an unordered read still reduces to the max)',
    newestClientMessageAt([
      { request_id: 'r1', author_kind: 'client', created_at: T1 },
      { request_id: 'r1', author_kind: 'client', created_at: T3 },
      { request_id: 'r1', author_kind: 'client', created_at: T2 },
    ])['r1'] === T3);
  ok('ties are stable (equal timestamps never flip the result)',
    newestClientMessageAt([
      { request_id: 'r1', author_kind: 'client', created_at: T2 },
      { request_id: 'r1', author_kind: 'customer', created_at: T2 },
    ])['r1'] === T2);
  ok('requests reduce independently', (() => {
    const m = newestClientMessageAt([
      { request_id: 'r1', author_kind: 'client', created_at: T1 },
      { request_id: 'r2', author_kind: 'client', created_at: T3 },
      { request_id: 'r2', author_kind: 'staff', created_at: T3 },
    ]);
    return m['r1'] === T1 && m['r2'] === T3;
  })());
  ok('rows missing an id or a timestamp are skipped, "customer" counts as the client side', (() => {
    const m = newestClientMessageAt([
      { request_id: '', author_kind: 'client', created_at: T1 },
      { request_id: 'r1', author_kind: 'client', created_at: '' },
      { request_id: 'r1', author_kind: 'customer', created_at: T2 },
      null,
    ]);
    return Object.keys(m).length === 1 && m['r1'] === T2;
  })());
}

// ═══ 6. loadThreadMarks — structural: the marks read is DETERMINISTIC ═══
{
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/lib/thread_reads.ts', import.meta.url));
  ok('loadThreadMarks orders by last_seen_at.desc (newest marks win past the cap)',
    /presence_thread_reads\?[^`]*order=last_seen_at\.desc[^`]*limit=500/.test(src));
  ok('markThreadRead stays silent ONLY for the pre-0113 missing relation (42P01/table name); other failures log with the [thread_reads] prefix',
    /42P01/.test(src) && /\[thread_reads\]/.test(src));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ THREAD READS (pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
