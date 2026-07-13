// Uptime heartbeat — pure state-machine + probe tests.
//   deno run -A tests/presence/uptime_heartbeat_test.mjs
// Covers the confirmed-down state machine (no false alarms on a single blip),
// live-URL selection (custom domain vs netlify default), and that a probe error
// is SWALLOWED (returns ok:false, never throws the sweep). The probe I/O is
// injected/mocked — no real network is touched.
import {
  DOWN_THRESHOLD, pickLiveUrl, nextUptimeState, probeSite,
} from '../../supabase/functions/presence/monitor/heartbeat.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL ', name); } };
const eq = (name, a, b) => ok(name + ` (got ${JSON.stringify(a)})`, a === b);

// ── 1. URL selection ─────────────────────────────────────────────────────────
{
  eq('1 custom domain wins', pickLiveUrl({ id: 's', custom_domain: 'shop.com', netlify_site_id: 'nf1' }), 'https://shop.com');
  eq('1 netlify default when no domain', pickLiveUrl({ id: 's', custom_domain: null, netlify_site_id: 'nf1' }), 'https://nf1.netlify.app');
  eq('1 null when nothing to hit', pickLiveUrl({ id: 's', custom_domain: null, netlify_site_id: null }), null);
}

// ── 2. The confirmed-down state machine ──────────────────────────────────────
{
  eq('2 threshold is two', DOWN_THRESHOLD, 2);

  // ok → fail  : a single blip. Streak 1, NO alert.
  const blip = nextUptimeState({ ok: true, fail_streak: 0 }, false);
  eq('2 blip streak 1', blip.fail_streak, 1);
  eq('2 blip does not alert', blip.transition, 'none');
  eq('2 blip surface not-ok', blip.ok, false);

  // fail → fail: second consecutive failure → confirmed down + alert.
  const down = nextUptimeState({ ok: false, fail_streak: 1 }, false);
  eq('2 down streak 2', down.fail_streak, 2);
  eq('2 down alerts once', down.transition, 'confirmed_down');

  // down → down: already alerted — never re-alert (idempotent).
  const still = nextUptimeState({ ok: false, fail_streak: 2 }, false);
  eq('2 still-down no re-alert', still.transition, 'none');
  eq('2 still-down streak grows', still.fail_streak, 3);

  // down → ok  : recovered → clear + reassure once.
  const rec = nextUptimeState({ ok: false, fail_streak: 2 }, true);
  eq('2 recovered', rec.transition, 'recovered');
  eq('2 recovered resets streak', rec.fail_streak, 0);
  eq('2 recovered surface ok', rec.ok, true);

  // blip → ok  : never crossed the threshold, so nothing to clear/announce.
  const bounce = nextUptimeState({ ok: false, fail_streak: 1 }, true);
  eq('2 single-blip recovery is silent', bounce.transition, 'none');
  eq('2 single-blip recovery resets', bounce.fail_streak, 0);

  // first-ever probe, no prior state.
  const firstOk = nextUptimeState(null, true);
  eq('2 first ok is calm', firstOk.transition, 'none');
  const firstFail = nextUptimeState(null, false);
  eq('2 first fail is a blip, not an alert', firstFail.transition, 'none');
  eq('2 first fail streak 1', firstFail.fail_streak, 1);

  // streak is capped (no unbounded growth on a long outage).
  const capped = nextUptimeState({ ok: false, fail_streak: 9 }, false);
  ok('2 streak capped', capped.fail_streak <= 9);
}

// ── 3. A single blip NEVER alerts across a full ok→fail→ok arc ────────────────
{
  let s = { ok: true, fail_streak: 0 };
  const arc = [];
  for (const probeOk of [true, false, true, true]) {   // healthy, one blip, healthy...
    const n = nextUptimeState(s, probeOk);
    arc.push(n.transition);
    s = { ok: n.ok, fail_streak: n.fail_streak };
  }
  ok('3 no confirmed_down anywhere in a single-blip arc', !arc.includes('confirmed_down'));
  ok('3 no phantom recovery', !arc.includes('recovered'));
}

// ── 4. probeSite classification via an injected fetch (no real network) ───────
{
  const res = (status, url) => Promise.resolve({ status, url: url || 'https://x.test/' });
  const p200 = await probeSite('https://x.test/', () => res(200, 'https://x.test/'));
  eq('4 200 is up', p200.ok, true);
  ok('4 200 https detected', p200.https === true);

  const p301 = await probeSite('https://x.test/', () => res(301, 'https://x.test/'));
  eq('4 3xx counts as reachable', p301.ok, true);

  const p503 = await probeSite('https://x.test/', () => res(503, 'https://x.test/'));
  eq('4 5xx is down', p503.ok, false);

  const p404 = await probeSite('https://x.test/', () => res(404, 'https://x.test/'));
  eq('4 404 is down', p404.ok, false);
}

// ── 5. HEAD rejected (405/501) falls back to GET ─────────────────────────────
{
  let sawGet = false;
  const impl = (_url, init) => {
    if ((init?.method) === 'HEAD') return Promise.resolve({ status: 405, url: 'https://x.test/' });
    sawGet = true; return Promise.resolve({ status: 200, url: 'https://x.test/' });
  };
  const p = await probeSite('https://x.test/', impl);
  ok('5 GET fallback used after 405', sawGet);
  eq('5 GET result classified up', p.ok, true);
}

// ── 6. A THROWN probe is swallowed → ok:false, never re-thrown (sweep-safe) ───
{
  let threw = false;
  let p;
  try {
    p = await probeSite('https://x.test/', () => { throw new Error('ECONNREFUSED'); });
  } catch { threw = true; }
  ok('6 probe never throws', !threw);
  eq('6 thrown probe is treated as down', p.ok, false);
  ok('6 error captured', /ECONNREFUSED/.test(p.error));

  // HEAD throws but GET succeeds → still up (some hosts block HEAD entirely).
  const impl = (_url, init) => (init?.method === 'HEAD')
    ? Promise.reject(new Error('HEAD blocked'))
    : Promise.resolve({ status: 200, url: 'https://x.test/' });
  const p2 = await probeSite('https://x.test/', impl);
  eq('6 HEAD-throws GET-ok is up', p2.ok, true);
}

console.log(fail === 0
  ? `\n════ UPTIME HEARTBEAT: ${pass}/${pass} PASS ════`
  : `\n${fail} FAILURE(S), ${pass} passed`);
if (fail) Deno.exit(1);
