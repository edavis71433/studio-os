// ── Notice recurrence — the once-per-lifetime trap, closed for good ─────────
//   deno run --allow-read --allow-env --allow-net tests/presence/notice_recurrence_test.mjs
//
// clearNotice (lib/notice.ts) only ever PATCHes status='dismissed' — the row
// SURVIVES and holds the unique (client_id, kind, period) key forever. So any
// notice whose period is a static per-entity constant AND which has a
// clear/teardown path fires ONCE PER LIFETIME:
//   · site_down keyed `site:<id>`      → outage #2 of any site, silent forever
//   · connection_expired `conn:<key>`  → every re-expiry after one reconnect, silent
//   · deal_followup `deal:<id>`        → a re-stalled deal, silent
//
// PART A is THE INVARIANT: walk every raiseNotice call site in the shipped
// source; any kind that has a clearNotice/clearNoticePrefix (or raw
// PATCH-dismissed) teardown ANYWHERE must carry a time bucket in its period —
// or be explicitly justified below as a genuinely terminal per-EVENT id (an
// invoice pays once; a publish attempt fails once). This fails RED on the three
// defects above pre-fix, and on every future kind that repeats the mistake.
// PART B proves the bucket helpers actually bucket (a helper that returned a
// constant would satisfy Part A's text scan and reopen the hole).
// PART C drives the real code through a fetch fake: the second outage notifies,
// the second token expiry notifies, the re-stalled deal re-nudges, and every
// teardown clears by prefix + the pre-bucket legacy key.
const ROOT = new URL('../../', import.meta.url);
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('PLATFORM_REPLY_TO', 'eric@davisdigitalstudio.com');
Deno.env.set('OPS_ALERT_EMAIL', 'ops@davisdigitalstudio.com');

// ═══════════════════════════════════════════════════════════════════════════
// PART A — THE INVARIANT (source scan, automatic discovery)
// ═══════════════════════════════════════════════════════════════════════════
function walkTs(dir, out = []) {
  for (const e of Deno.readDirSync(dir)) {
    const u = new URL(e.name + (e.isDirectory ? '/' : ''), dir);
    if (e.isDirectory) { if (e.name !== 'node_modules') walkTs(u, out); }
    else if (e.name.endsWith('.ts')) out.push(u);
  }
  return out;
}
const FILES = walkTs(new URL('supabase/functions/', ROOT)).map((u) => ({
  path: u.pathname.split('supabase/functions/')[1],
  src: (() => { try { return Deno.readTextFileSync(u); } catch { return ''; } })(),
}));
ok('A0: the scan reads the platform source (guard against an empty haystack)',
  FILES.length > 50 && FILES.reduce((a, f) => a + f.src.length, 0) > 200_000);

// 1) every raiseNotice/raiseNoticeDetailed call site → (file, kind, period expr)
const raises = [];
for (const f of FILES) {
  const re = /raiseNotice(?:Detailed)?\(\{/g;
  let m;
  while ((m = re.exec(f.src)) !== null) {
    const win = f.src.slice(m.index, m.index + 700);
    const kind = (win.match(/kind:\s*'([^']+)'/) || [])[1] || null;
    const period = (win.match(/period:\s*([^\n]+?),(?:\s*(?:headline|status|\n))/) || win.match(/period:\s*([^\n]+?),?\s*\n/) || [])[1] || '';
    raises.push({ file: f.path, kind, period: period.trim() });
  }
}
ok('A0: the raise-site scan finds the fleet (>= 20 sites)', raises.length >= 20, `found ${raises.length}`);
// non-literal kinds must be ONLY the service-bridge wrapper (its client_* kinds
// are silent throttle ledgers with no teardown) and the reviewer-decision helper.
const dynamicKinds = raises.filter((r) => !r.kind);
// service_bridge: the client_* throttle wrapper (silent ledger, no teardown).
// lib/notice: notifyOwnerOfReviewerDecision (approval_decided, no teardown).
// lifecycle: the LifecycleKind loop (`kind, period: dedupe` — trial/lapse/
// win-back comms; none of those kinds has a teardown anywhere).
ok('A0: every dynamic-kind raise site is a known wrapper, not an escape hatch',
  dynamicKinds.every((r) => /service_bridge\.ts|lib\/notice\.ts/.test(r.file) || (/commerce\/lifecycle\.ts/.test(r.file) && r.period.includes('dedupe'))),
  dynamicKinds.map((r) => `${r.file} (${r.period})`).join(', '));

// 2) every kind that has a teardown anywhere (shared helpers or raw PATCH)
const ALL_SRC = FILES.map((f) => f.src).join('\n');
const clearedKinds = new Set();
for (const m of ALL_SRC.matchAll(/clearNotice(?:Prefix)?\([^,)]+,\s*'([^']+)'/g)) clearedKinds.add(m[1]);
for (const m of ALL_SRC.matchAll(/kind=eq\.([a-z_]+)[\s\S]{0,260}?PATCH[\s\S]{0,260}?status['":\s]+['"`]dismissed/g)) clearedKinds.add(m[1]);
ok('A0: the teardown scan sees the known clears', ['site_down', 'connection_expired', 'deal_followup', 'support_aging', 'publish_failed', 'retainer_status'].every((k) => clearedKinds.has(k)),
  [...clearedKinds].join(', '));

// 3) THE RULE. A cleared kind's period must carry a TIME BUCKET (a recurring
// condition can recur), unless the period is a justified per-EVENT id — an id
// minted once per occurrence, so a new occurrence gets a new key by itself.
const BUCKET_TOKENS = /supportAgingPeriod\(|dealFollowupPeriod\(|leadFollowupPeriod\(|connExpiredPeriod\(|siteDownPeriod\(|retainerNoticePeriod\(|dealTaskPeriod\(|nextStepPeriod\(|noticeWeekBucket\(|periodOf\(/;
const TERMINAL_OK = [
  // marker in the period expr → why once-per-key is HONEST for it
  { kind: 'publish_failed', marker: 'pub:', why: 'each publish attempt has its own pubId — a new failure is a new event id' },
  { kind: 'deal_followup', marker: 'invremind:', why: 'an invoice settles exactly once (paid or voided); "never nag" is by design' },
  { kind: 'deal_followup', marker: 'remind:', why: 'the unsigned-doc reminder is deliberately once-ever (a silent ledger row)' },
  { kind: 'deal_followup', marker: 'declined:', why: 'a proposal is declined once; period is per-deal — see the adjacent-finding note' },
  { kind: 'deal_signed', marker: '${event}:', why: 'signing/acceptance is terminal per deal; the clear (convert) is terminal too' },
  { kind: 'deletion_requested', marker: 'del:', why: 'a cancelled deletion request that is re-requested mints a NEW request id' },
  { kind: 'new_review', marker: 'review:', why: 'one row per review; moderating THAT review is terminal — a new review mints a new id' },
  { kind: 'new_booking', marker: 'appt:', why: 'one row per appointment; deciding THAT booking is terminal — a new booking mints a new id' },
];
const clearedRaises = raises.filter((r) => r.kind && clearedKinds.has(r.kind));
ok('A0: cleared-kind raise sites exist to check (>= 8)', clearedRaises.length >= 8, `found ${clearedRaises.length}`);
for (const r of clearedRaises) {
  const bucketed = BUCKET_TOKENS.test(r.period);
  const terminal = TERMINAL_OK.find((t) => t.kind === r.kind && r.period.includes(t.marker));
  ok(`A1: [${r.file}] kind '${r.kind}' period ${r.period || '(?)'} is bucket-carrying or justified terminal`,
    bucketed || !!terminal,
    'this kind has a clearNotice teardown somewhere: a static per-entity period means ONCE PER LIFETIME — bucket it (see lib/notice.ts) or justify it in TERMINAL_OK');
}
// the allowlist must not go stale: every entry must still match a live site.
for (const t of TERMINAL_OK) {
  ok(`A2: TERMINAL_OK entry '${t.kind}' + '${t.marker}' still matches a real raise site`,
    clearedRaises.some((r) => r.kind === t.kind && r.period.includes(t.marker)),
    'remove or update the stale justification');
}

// 4) the documented pass: email_auth has NO clear path today, so its once-ever
// `emailauth:<site>` period is fine — and the invariant must SAY so, not trip.
ok('A3: email_auth is raised once-ever per site (emailauth:<siteId>)',
  raises.some((r) => r.kind === 'email_auth' && r.period.includes('emailauth:')));
ok('A3: …and has no teardown anywhere, so the invariant deliberately passes it',
  !clearedKinds.has('email_auth'));

// 5) the paired teardown rule: every bucketed cleared kind must be cleared by
// PREFIX (all buckets at once) somewhere, plus the pre-bucket legacy exact key.
for (const [kind, prefixHelper, legacyHelper] of [
  ['site_down', 'siteDownPeriodPrefix', 'siteDownLegacyPeriod'],
  ['connection_expired', 'connExpiredPeriodPrefix', 'connExpiredLegacyPeriod'],
  ['deal_followup', 'dealFollowupPeriodPrefix', 'dealFollowupLegacyPeriod'],
]) {
  ok(`A4: '${kind}' is cleared via ${prefixHelper} (every bucket at once)`,
    new RegExp(`clearNoticePrefix\\([^)]*'${kind}',\\s*${prefixHelper}\\(`).test(ALL_SRC));
  ok(`A4: '${kind}' also clears the pre-bucket legacy key (${legacyHelper})`,
    new RegExp(`clearNotice\\([^)]*'${kind}',\\s*${legacyHelper}\\(`).test(ALL_SRC));
}
ok(`A4: 'support_aging' keeps its prefix + legacy pair (the idiom this fix copies)`,
  /clearNoticePrefix\([^)]*'support_aging',\s*supportAgingPeriodPrefix\(/.test(ALL_SRC) &&
  /clearNotice\([^)]*'support_aging',\s*supportAgingLegacyPeriod\(/.test(ALL_SRC));
ok(`A4: 'retainer_status' recovery clears by its prefix`,
  /clearNoticePrefix\([^)]*'retainer_status',\s*retainerNoticePeriodPrefix\(/.test(ALL_SRC));

// ═══════════════════════════════════════════════════════════════════════════
// PART B — the bucket helpers actually bucket (pure)
// ═══════════════════════════════════════════════════════════════════════════
const N = await import('../../supabase/functions/presence/lib/notice.ts');
const WEEK = 7 * 86400_000;
const t0 = Date.parse('2026-07-20T12:00:00Z');
{
  const start = Math.floor(t0 / WEEK) * WEEK;
  for (const [name, fn, prefix] of [
    ['connExpiredPeriod', (t) => N.connExpiredPeriod('google_search_console', t), N.connExpiredPeriodPrefix('google_search_console')],
    ['dealFollowupPeriod', (t) => N.dealFollowupPeriod('d-1', t), N.dealFollowupPeriodPrefix('d-1')],
    ['leadFollowupPeriod', (t) => N.leadFollowupPeriod('l-1', t), 'lead:l-1:'],
  ]) {
    ok(`B1 ${name}: stable across its whole 7-day slot`, fn(start) === fn(start + WEEK - 1));
    ok(`B1 ${name}: changes the instant the slot rolls`, fn(start + WEEK - 1) !== fn(start + WEEK));
    ok(`B1 ${name}: every bucket shares the prefix the teardown clears`, [t0, t0 + WEEK, t0 + 9 * WEEK].every((t) => fn(t).startsWith(prefix)));
    ok(`B1 ${name}: a non-finite clock degrades cleanly (never NaN in a dedupe key)`, !/NaN|undefined/.test(fn(NaN)));
  }
  // the legacy keys are EXCLUDED by the prefix's trailing colon (load-bearing:
  // LIKE 'deal:<id>:%' must not reach 'deal:<id>' — the legacy clear handles it)
  ok('B1: legacy keys do not match the bucket prefix (trailing colon is load-bearing)',
    !N.dealFollowupLegacyPeriod('d-1').startsWith(N.dealFollowupPeriodPrefix('d-1')) &&
    !N.connExpiredLegacyPeriod('gsc').startsWith(N.connExpiredPeriodPrefix('gsc')) &&
    !N.siteDownLegacyPeriod('s-1').startsWith(N.siteDownPeriodPrefix('s-1')));
  // …and one deal's prefix can never reach another deal's rows
  ok('B1: prefixes are id-terminated (deal d-1 never clears deal d-12)',
    !N.dealFollowupPeriod('d-12', t0).startsWith(N.dealFollowupPeriodPrefix('d-1')));
}
{
  // site_down buckets by UTC DAY: a new outage the next day alerts again; a
  // flapping site pages at most once per day.
  ok('B2 siteDownPeriod: same day, same key', N.siteDownPeriod('s-1', t0) === N.siteDownPeriod('s-1', t0 + 3600_000));
  ok('B2 siteDownPeriod: next day, new key', N.siteDownPeriod('s-1', t0) !== N.siteDownPeriod('s-1', t0 + 86400_000));
  ok('B2 siteDownPeriod: carries the day, human-readable', N.siteDownPeriod('s-1', t0) === 'site:s-1:2026-07-20');
  ok('B2 siteDownPeriod: non-finite clock degrades cleanly', !/NaN|undefined|Invalid/.test(N.siteDownPeriod('s-1', NaN)));
}
{
  const R = await import('../../supabase/functions/presence/commerce/retainers.ts');
  const start = Math.floor(t0 / WEEK) * WEEK;
  ok('B3 retainerNoticePeriod: weekly bucket per transition',
    R.retainerNoticePeriod('d-1', 'past_due', start) === R.retainerNoticePeriod('d-1', 'past_due', start + WEEK - 1) &&
    R.retainerNoticePeriod('d-1', 'past_due', start) !== R.retainerNoticePeriod('d-1', 'past_due', start + WEEK));
  ok('B3 retainerNoticePeriod: shares the prefix recovery clears',
    R.retainerNoticePeriod('d-1', 'canceled', t0).startsWith(R.retainerNoticePeriodPrefix('d-1')));
}

// ═══════════════════════════════════════════════════════════════════════════
// PART C — behavioral: the second event NOTIFIES (fetch fake)
// ═══════════════════════════════════════════════════════════════════════════
const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const SITE = '99999999-9999-4999-8999-999999999999';
const CLIENT = '22222222-2222-4222-8222-222222222222';

/** A tiny PostgREST fake with a REAL unique-key memory for plan_notices, so the
 *  dedupe/clear dance is observed as it would actually behave: an insert
 *  returns a row only for an UNSEEN (kind, period); a PATCH …status=dismissed
 *  keeps the key held (exactly the trap under test — dismissal never frees it). */
function installFake() {
  const held = new Set();      // keys ever inserted (never freed — like the DB)
  const calls = [];
  const sent = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('api.resend.com/emails')) { sent.push(body); return jr({ id: 're_1' }, 200); }
    if (url.includes('suppressed_emails')) return jr([]);
    if (url.includes('presence_plan_notices') && method === 'POST') {
      const key = `${body?.kind}|${body?.period}`;
      if (held.has(key)) return jr([], 201);          // conflict → ignore-duplicates → empty
      held.add(key);
      return jr([{ id: `n_${held.size}` }], 201);
    }
    if (url.includes('presence_plan_notices') && method === 'PATCH') return jr(null, 204);
    if (url.includes('presence_sites')) return jr([{ id: SITE, client_id: CLIENT }]);
    if (url.includes('clients?id=eq.')) return jr([{ email: 'owner@biz.test', name: 'Biz' }]);
    if (url.includes('presence_identity')) return jr([{ business_name: 'Biz', email: 'owner@biz.test' }]);
    if (url.includes('presence_brand_kits') || url.includes('brand_kit')) return jr([]);
    if (url.includes('presence_push_subscriptions')) return jr([]);
    if (url.includes('presence_settings')) return jr([]);
    return jr([]);
  };
  return { calls, sent, held };
}
const restore = () => { globalThis.fetch = realFetch; };

// C1 — SECOND OUTAGE NOTIFIES (monitor/heartbeat.ts)
{
  const { notifyConfirmedDown, notifySiteRecovered } = await import('../../supabase/functions/presence/monitor/heartbeat.ts');
  const { calls, sent } = installFake();
  const site = { id: SITE, client_id: CLIENT, custom_domain: 'biz.test' };
  const day1 = Date.parse('2026-07-20T09:00:00Z');
  const day2 = Date.parse('2026-07-21T09:00:00Z');

  await notifyConfirmedDown(site, 'https://biz.test', day1);
  // count only the DOWN alerts to the owner — recovery sends its own calm
  // "back online" note, which must not be mistaken for a page.
  const ownerMails = () => sent.filter((s) => s?.to === 'owner@biz.test' && /didn.t respond/i.test(String(s?.subject || '')));
  ok('C1: outage #1 raises site_down on the day-scoped key and emails the owner',
    calls.some((c) => c.method === 'POST' && c.url.includes('presence_plan_notices') && c.body?.kind === 'site_down' && c.body?.period === `site:${SITE}:2026-07-20`) &&
    ownerMails().length === 1);

  await notifySiteRecovered(site);
  const clears = calls.filter((c) => c.method === 'PATCH' && c.url.includes('presence_plan_notices') && c.url.includes('kind=eq.site_down'));
  ok('C1: recovery clears by prefix (LIKE site:<id>:*) AND the legacy exact key',
    clears.some((c) => c.url.includes(`period=like.${encodeURIComponent('site\\:' + SITE + '\\:').replace(/%5C/gi, '%5C')}`) || /period=like\./.test(c.url)) &&
    clears.some((c) => c.url.includes(`period=eq.${encodeURIComponent(`site:${SITE}`)}`)),
    clears.map((c) => c.url).join('\n'));

  await notifyConfirmedDown(site, 'https://biz.test', day2);
  ok('C1: OUTAGE #2 (next day) NOTIFIES — new key, new email (the fix)',
    calls.some((c) => c.method === 'POST' && c.body?.kind === 'site_down' && c.body?.period === `site:${SITE}:2026-07-21`) &&
    ownerMails().length === 2);

  await notifyConfirmedDown(site, 'https://biz.test', day2 + 3600_000);
  ok('C1: a same-day flap does NOT storm (dedupe holds inside the day)', ownerMails().length === 2);
  restore();
}

// C2 — SECOND TOKEN EXPIRY NOTIFIES (connected/store.ts markStatus)
{
  const { markStatus } = await import('../../supabase/functions/presence/connected/store.ts');
  const { calls } = installFake();
  const week1 = Date.parse('2026-07-02T09:00:00Z');
  const week2 = week1 + 8 * 86400_000;
  const realNow = Date.now;

  Date.now = () => week1;
  await markStatus(SITE, 'google_search_console', 'expired', 'down', 'token revoked');
  const raisesOf = () => calls.filter((c) => c.method === 'POST' && c.url.includes('presence_plan_notices') && c.body?.kind === 'connection_expired');
  ok('C2: expiry #1 raises connection_expired on a week-bucketed per-provider key',
    raisesOf().length === 1 && raisesOf()[0].body.period.startsWith('conn:google_search_console:w'));

  Date.now = () => week1 + 3600_000;
  await markStatus(SITE, 'google_search_console', 'expired', 'down', 'token revoked');
  ok('C2: a re-fire within the week re-raises NOTHING (send-once inside the bucket)',
    raisesOf().length === 2 && calls.filter((c) => c.method === 'POST' && c.body?.kind === 'connection_expired').length === 2,
    'markStatus fires per sync attempt; the second insert must hit the held key');
  // (two POST attempts, but the fake's unique memory returned a row only once)

  Date.now = () => week1 + 2 * 3600_000;
  await markStatus(SITE, 'google_search_console', 'connected', 'ok');
  const clears = calls.filter((c) => c.method === 'PATCH' && c.url.includes('kind=eq.connection_expired'));
  ok('C2: reconnect clears by prefix AND the legacy exact key',
    clears.some((c) => /period=like\./.test(c.url)) && clears.some((c) => c.url.includes(`period=eq.${encodeURIComponent('conn:google_search_console')}`)),
    clears.map((c) => c.url).join('\n'));

  Date.now = () => week2;
  await markStatus(SITE, 'google_search_console', 'expired', 'down', 'token revoked again');
  const periods = raisesOf().map((c) => c.body.period);
  ok('C2: EXPIRY #2 (a later week) NOTIFIES — new bucket, new row (the fix)',
    new Set(periods).size === 2, periods.join(', '));
  Date.now = realNow;
  restore();
}

// C3 — RE-STALLED DEAL RE-NUDGES (commerce/lifecycle.runDealFollowups)
{
  const { runDealFollowups } = await import('../../supabase/functions/presence/commerce/lifecycle.ts');
  const DEAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const realNow = Date.now;
  const { calls, held } = installFake();
  const stale = { id: DEAL, site_id: SITE, title: 'Bacchus website', stage: 'proposal' };
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('presence_deals?') && url.includes('stage=in.(qualified,proposal,contract)')) return jr([stale]);
    if (url.includes('presence_deal_tasks')) return jr([]);
    if (url.includes('presence_deals?') && url.includes('next_step_at')) return jr([]);
    return orig(input, init);
  };

  const week1 = Date.parse('2026-07-02T09:00:00Z');
  Date.now = () => week1;
  await runDealFollowups(5);
  const nudges = () => calls.filter((c) => c.method === 'POST' && c.url.includes('presence_plan_notices') && c.body?.kind === 'deal_followup' && c.body?.period?.startsWith(`deal:${DEAL}:`));
  ok('C3: stall #1 nudges on the week-bucketed key', nudges().length === 1 && /w\d+$/.test(nudges()[0].body.period));

  await runDealFollowups(5);
  ok('C3: still-stalled within the week does not storm (key held)', nudges().length === 2 && held.size >= 1);

  // …the deal wakes (sales.ts clears by prefix — proven structurally in A4) and
  // stalls again a few weeks later:
  Date.now = () => week1 + 3 * 7 * 86400_000;
  await runDealFollowups(5);
  const uniquePeriods = new Set(nudges().map((c) => c.body.period));
  ok('C3: STALL #2 (a later week) RE-NUDGES — a new bucket, a new row (the fix)', uniquePeriods.size === 2, [...uniquePeriods].join(', '));
  Date.now = realNow;
  restore();
}

const passed = results.filter(Boolean).length;
console.log(`\n════ NOTICE RECURRENCE (invariant + buckets + behaviour): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
