// ── Phase RL: revenue lifecycle suite ────────────────────────────────────────
// Locks the pure decision logic + the calm copy: trial expiry enforcement (the
// revenue bug — no-card trials never lapsed), event detection per state, and
// the honesty contract of every message (site stays up · nothing deleted ·
// export always available · wind-down window stated).
//   deno run --allow-read --allow-env tests/presence/lifecycle_test.mjs
import { shouldExpireTrial, lifecycleEventsFor, lifecycleCopy, periodOf, WIND_DOWN_DAYS } from '../../supabase/functions/presence/commerce/lifecycle.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const NOW = '2026-07-08T12:00:00.000Z';
const ent = (o) => ({ client_id: 'c1', status: 'active', trial_ends_at: null, stripe_subscription_id: null, ...o });

// ═══ 1. trial expiry (the revenue bug, fixed) ═══
ok('no-card trial past its end → expire', shouldExpireTrial(ent({ trial_ends_at: '2026-07-01T00:00:00Z' }), NOW) === true);
ok('trial still running → keep', shouldExpireTrial(ent({ trial_ends_at: '2026-07-20T00:00:00Z' }), NOW) === false);
ok('Stripe-managed subscription → NEVER force-expired (Stripe owns it)', shouldExpireTrial(ent({ trial_ends_at: '2026-07-01T00:00:00Z', stripe_subscription_id: 'sub_1' }), NOW) === false);
ok('active, no trial → keep', shouldExpireTrial(ent({}), NOW) === false);

// ═══ 2. event detection per state ═══
ok('trial ending within 3 days → trial_ending', lifecycleEventsFor(ent({ trial_ends_at: '2026-07-10T12:00:00Z' }), NOW).includes('trial_ending'));
ok('trial ending in 10 days → quiet (no nag)', lifecycleEventsFor(ent({ trial_ends_at: '2026-07-18T12:00:00Z' }), NOW).length === 0);
ok('trial past end → trial_ended', lifecycleEventsFor(ent({ trial_ends_at: '2026-07-01T00:00:00Z' }), NOW).includes('trial_ended'));
ok('paused → payment_trouble', lifecycleEventsFor(ent({ status: 'paused' }), NOW).includes('payment_trouble'));
ok('lapsed → account_lapsed', lifecycleEventsFor(ent({ status: 'lapsed' }), NOW).includes('account_lapsed'));
ok('healthy paying customer → zero noise', lifecycleEventsFor(ent({ stripe_subscription_id: 'sub_1' }), NOW).length === 0);

// ═══ 3. the honesty contract in every message ═══
{
  const kinds = ['trial_ending', 'trial_ended', 'payment_trouble', 'account_lapsed'];
  ok('every kind has full copy (headline/body/subject/html)', kinds.every((k) => { const c = lifecycleCopy(k, 'Bloom Salon'); return c.headline && c.body && c.subject && c.html.length > 40; }));
  ok('payment trouble says THE SITE IS STILL UP (no scare tactics)', /site is still up/i.test(lifecycleCopy('payment_trouble', 'X').html));
  ok('trial end says nothing was deleted', /nothing (was |is )?(deleted|lost)/i.test(lifecycleCopy('trial_ended', 'X').html));
  ok(`lapse states the wind-down window (${WIND_DOWN_DAYS} days) + export-forever`, lifecycleCopy('account_lapsed', 'X').html.includes(`${WIND_DOWN_DAYS} days`) && /any time/i.test(lifecycleCopy('account_lapsed', 'X').body));
  ok('business name lands in the email', lifecycleCopy('trial_ending', 'Bloom Salon').html.includes('Bloom Salon'));
}

// ═══ 3b. CP-3: wind-down + win-back + welcome-back ═══
{
  const old = (d) => new Date(Date.parse(NOW) - d * 86400_000).toISOString();
  ok('lapsed 30+ days → win_back joins the events', lifecycleEventsFor(ent({ status: 'lapsed', updated_at: old(31) }), NOW).includes('win_back'));
  ok('lapsed 45+ days → winddown_reminder joins', lifecycleEventsFor(ent({ status: 'lapsed', updated_at: old(46) }), NOW).includes('winddown_reminder'));
  ok('freshly lapsed → neither (only the lapse notice)', (() => { const e = lifecycleEventsFor(ent({ status: 'lapsed', updated_at: old(2) }), NOW); return !e.includes('win_back') && !e.includes('winddown_reminder'); })());
  ok('winddown copy: states day-60 + the download door', /day 60/.test(lifecycleCopy('winddown_reminder', 'X').html) && /download/i.test(lifecycleCopy('winddown_reminder', 'X').html));
  ok('win-back copy: nothing deleted, no pressure', /nothing was deleted/i.test(lifecycleCopy('win_back', 'X').html));
  ok('welcome-back copy exists and is warm', /welcome back/i.test(lifecycleCopy('welcome_back', 'X').subject));
}

// ═══ 4. dedupe period ═══
ok('period bucket = YYYY-MM (matches the notices unique key)', periodOf(NOW) === '2026-07');

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
