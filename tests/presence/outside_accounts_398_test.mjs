// ── Builder item 398: the accounts Studio OS depends on, ticked each quarter ──────
//   deno run --allow-read --allow-env --allow-net tests/presence/outside_accounts_398_test.mjs
// The settings that keep Studio OS safe live in other companies' dashboards and were written
// down nowhere (Nov 22 2026 review, file 07 finding 6). The Health page now lists them with a
// tick the platform owner sets after looking. Every date is pinned.
//   1  the list: five accounts, each with what to check and where; sign-ups off is on it
//   2  due: never ticked, or ticked more than a quarter ago
//   3  the routes: anyone on the platform's staff reads; only the owner ticks; nothing else
//   4  before the table exists: listed as never checked, and a tick says it couldn't save
import { installFakePostgrest } from './fake_pgrst.mjs';
const db = installFakePostgrest();
const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const A = await import('../../supabase/functions/presence/lib/outside_accounts.ts');
const R = await import('../../supabase/functions/presence/routes/accounts_check.ts');
const NOW = Date.parse('2026-11-22T18:00:00Z');
const day = 86_400_000;

// ═══ 1. the list ═══
{
  const keys = A.OUTSIDE_ACCOUNTS.map((a) => a.key);
  ok('the five accounts the review names: Supabase, GitHub, Netlify, Stripe, Resend', JSON.stringify(keys) === '["supabase","github","netlify","stripe","resend"]');
  ok('each says why it matters, what to check and where', A.OUTSIDE_ACCOUNTS.every((a) => a.why && a.checks.length >= 2 && /^https:\/\//.test(a.where)));
  const supa = A.OUTSIDE_ACCOUNTS[0].checks.join(' ');
  ok('Supabase: sign-ups off, confirm email on, no unverified sign-ins, the leaked-password check, two-step sign-in', /sign-ups are off/i.test(supa) && /Confirm email/.test(supa) && /unverified email sign-ins/.test(supa) && /leaked-password/.test(supa) && /Two-step/.test(supa));
  ok('every account asks for two-step sign-in', A.OUTSIDE_ACCOUNTS.every((a) => a.checks.some((c) => /two-step sign-in/i.test(c))));
  ok('plain words: no dash used as punctuation in anything the card shows', A.OUTSIDE_ACCOUNTS.every((a) => ![a.name, a.why, ...a.checks].some((t) => /—|–/.test(t))));
}

// ═══ 2. due ═══
{
  const lines = A.accountLines([
    { account: 'supabase', checked_at: new Date(NOW - 10 * day).toISOString(), checked_by: 'owner@platform.example' },
    { account: 'github', checked_at: new Date(NOW - 93 * day).toISOString(), checked_by: 'owner@platform.example' },
    { account: 'netlify', checked_at: 'not a date', checked_by: 'x' },
    { account: 'retired_account', checked_at: new Date(NOW).toISOString(), checked_by: 'x' },
  ], NOW);
  const by = Object.fromEntries(lines.map((l) => [l.key, l]));
  ok('ticked ten days ago: not due, with when and who', by.supabase.due === false && by.supabase.checked_by === 'owner@platform.example');
  ok('ticked 93 days ago: due again', by.github.due === true && by.github.checked_at !== null);
  ok('a tick that isn\'t a date, or none: due, and not called checked', by.netlify.due === true && by.netlify.checked_at === null && by.stripe.due === true);
  ok('a tick for an account that left the list is dropped', lines.length === 5 && !lines.some((l) => l.key === 'retired_account'));
  ok('the edge: 92 days is still this quarter, 92 days and a minute is due', A.accountLines([{ account: 'stripe', checked_at: new Date(NOW - 92 * day).toISOString(), checked_by: '' }], NOW)[3].due === false && A.accountLines([{ account: 'stripe', checked_at: new Date(NOW - 92 * day - 60_000).toISOString(), checked_by: '' }], NOW)[3].due === true);
}

// ═══ 3. the routes ═══
const OWNER = { kind: 'staff', role: 'owner', userId: 'u-owner', email: 'owner@platform.example', tenantId: 't', jwt: 'j', requestId: 'r' };
const STAFF = { ...OWNER, role: 'staff', userId: 'u-staff', email: 'staff@platform.example' };
const body = async (res) => ({ status: res.status, json: await res.json() });
{
  db.tables.platform_account_checks = [];
  const list = await body(await R.handleAccountsList(STAFF, {}, NOW));
  ok('staff read the list: five accounts, all due, and they may not tick', list.status === 200 && list.json.data.accounts.length === 5 && list.json.data.due === 5 && list.json.data.can_tick === false && list.json.data.ready === true);
  const refused = await body(await R.handleAccountChecked('github', STAFF, {}, NOW));
  ok('a staff member who isn\'t the owner can\'t tick, and nothing is written', refused.status === 403 && db.tables.platform_account_checks.length === 0);
  const unknown = await body(await R.handleAccountChecked('bank', OWNER, {}, NOW));
  ok('an account not on the list: 404, nothing written', unknown.status === 404 && db.tables.platform_account_checks.length === 0);
  const ticked = await body(await R.handleAccountChecked('github', OWNER, {}, NOW));
  const row = db.tables.platform_account_checks.find((r) => r.account === 'github');
  ok('the owner ticks GitHub: saved with today and who', ticked.status === 200 && row?.checked_by === 'owner@platform.example' && row?.checked_at === new Date(NOW).toISOString());
  ok('…and the answer is the fresh list: GitHub checked, four due, the owner may tick', ticked.json.data.accounts.find((a) => a.key === 'github').due === false && ticked.json.data.due === 4 && ticked.json.data.can_tick === true);
  await R.handleAccountChecked('github', OWNER, {}, NOW + day);
  ok('ticking again moves the date on, one row an account', db.tables.platform_account_checks.filter((r) => r.account === 'github').length === 1 && db.tables.platform_account_checks.find((r) => r.account === 'github').checked_at === new Date(NOW + day).toISOString());
}

// ═══ 4. before the table exists ═══
{
  db.fail.add('platform_account_checks');
  const list = await body(await R.handleAccountsList(OWNER, {}, NOW));
  ok('the card still lists every account, as never checked, and says the ticks can\'t be saved yet', list.status === 200 && list.json.data.ready === false && list.json.data.due === 5);
  const t = await body(await R.handleAccountChecked('stripe', OWNER, {}, NOW));
  ok('a tick says it couldn\'t save, in plain words', t.status === 502 && /didn’t save/.test(t.json.message));
  db.fail.delete('platform_account_checks');
}

const passed = results.filter(Boolean).length;
console.log(`\n════ OUTSIDE ACCOUNTS, ITEM 398: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
