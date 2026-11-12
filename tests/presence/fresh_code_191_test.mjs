// ── Builder list item 191: two-step sign-in, a fresh code before the risky things, the owner told ──
//   deno run --allow-read --allow-env --allow-net tests/presence/fresh_code_191_test.mjs
// Part A, pure: codes, what was typed, a person's authenticator app, the emails, and the
// rule that a half-finished sign-in (password, no app code) isn't a sign-in. Part B drives
// requireFresh (lib/fresh_code.ts) on a fake database: an emailed code works once, for ten
// minutes, for its one action, with five tries and three sends; an app code is checked by
// Supabase Auth. Part C: the owner's alert. Part D: each risky route asks before it writes,
// and every sign-in check in both functions applies the second-step rule.
import { installFakePostgrest } from './fake_pgrst.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
Deno.env.set('APPROVAL_SECRET', 'test-approval-secret');
const db = installFakePostgrest();
const fake = globalThis.fetch;
const counts = new Map();
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('/rest/v1/rpc/rate_hit')) {
    const b = JSON.parse(String(init.body)); const k = `${b.p_bucket}|${b.p_window}`;
    counts.set(k, (counts.get(k) || 0) + 1);
    return new Response(JSON.stringify(counts.get(k) <= b.p_max), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return fake(url, init);
};
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const P = '../../supabase/functions/presence';
const F = await import(`${P}/lib/fresh_code.ts`);
const A = await import(`${P}/lib/security_alerts.ts`);
const { secondStepMissing, jwtClaims } = await import('../../supabase/functions/_shared/auth.ts');
const { runRetentionSweep } = await import(`${P}/ops/retention.ts`);

// ═══ A · the pure parts ═══
{
  const codes = Array.from({ length: 3000 }, () => F.newCode());
  ok('a code is six digits, and they vary', codes.every((c) => /^\d{6}$/.test(c)) && new Set(codes).size > 2900 && codes.some((c) => c.startsWith('0')));
  ok('what was typed: spaces and dashes forgiven, anything else is no code', F.typedCode(' 482 913 ') === '482913' && F.typedCode('482-913') === '482913' && F.typedCode('48291') === '' && F.typedCode('48291x') === '' && F.typedCode(undefined) === '');
  const user = (factors) => ({ id: 'u1', factors });
  ok('their authenticator app: a verified TOTP factor; one still being set up isn’t', F.appFactor(user([{ id: 'f1', factor_type: 'totp', status: 'verified' }])) === 'f1' && F.appFactor(user([{ id: 'f2', factor_type: 'totp', status: 'unverified' }])) === null && F.appFactor(user(undefined)) === null);
  const mail = F.codeEmail('482913', 'invite_coowner', 'alex@maple.example as Co-owner of Maple & Main <Realty>');
  ok('the code’s email: the code in the subject and the body, what it’s for, how long, what to do if it wasn’t them', mail.subject === '482913 is your Studio OS code' && mail.html.includes('>482913<') && mail.html.includes('Use this code to invite a co-owner: alex@maple.example as Co-owner of Maple &amp; Main &lt;Realty&gt;.') && mail.html.includes('for 10 minutes') && mail.html.includes('Change your password'));
  ok('…and no link to press (a code is typed, never clicked)', !/href=/.test(mail.html));
  const tok = (claims) => `x.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.y`;
  const withApp = user([{ id: 'f1', factor_type: 'totp', status: 'verified' }]);
  ok('two-step on, password only (aal1): not signed in', secondStepMissing(withApp, tok({ sub: 'u1', aal: 'aal1' })) === true && secondStepMissing(withApp, tok({ sub: 'u1' })) === true);
  ok('two-step on, app code typed (aal2): signed in', secondStepMissing(withApp, tok({ sub: 'u1', aal: 'aal2' })) === false);
  ok('two-step off, or only being set up: signed in as before', secondStepMissing(user([]), tok({ aal: 'aal1' })) === false && secondStepMissing(user([{ status: 'unverified' }]), tok({ aal: 'aal1' })) === false && secondStepMissing(null, tok({})) === false);
  ok('a token’s claims are read, a broken one is nothing', jwtClaims(tok({ aal: 'aal2', sub: 'u1' }))?.aal === 'aal2' && jwtClaims('nope') === null);
}

// ═══ B · requireFresh ═══
const U = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', U2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
let users = {}, sent = [], appSays = true, appCalls = [];
F.freshDeps.user = async (jwt) => users[jwt] || null;
F.freshDeps.send = async (to, subject, html) => { sent.push({ to, subject, html }); return true; };
F.freshDeps.verifyApp = async (jwt, factor, code) => { appCalls.push({ jwt, factor, code }); return appSays === null ? null : appSays && code === '135790'; };
const who = (jwt, extra = {}) => ({ kind: 'client', userId: users[jwt]?.id || null, tenantId: null, role: 'client', email: users[jwt]?.email || null, jwt, requestId: 't', ...extra });
const fresh = () => { db.reset({}); counts.clear(); sent = []; appCalls = []; appSays = true; users = {
  'jwt-email': { id: U, email: 'pat@studio.example', factors: [] },
  'jwt-other': { id: U2, email: 'lee@studio.example', factors: [] },
  'jwt-app': { id: U2, email: 'lee@studio.example', factors: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }] },
}; };
const go = (jwt, code, action = 'invite_coowner') => F.requireFresh(who(jwt), code === undefined ? {} : { fresh_code: code }, action, 'alex@maple.example as Co-owner of Maple & Main Realty', {});
const body = async (r) => (r instanceof Response ? { status: r.status, ...(await r.json()) } : r);
const lastCode = () => /(\d{6}) is your Studio OS code/.exec(sent.at(-1)?.subject || '')?.[1];
const rows = () => db.tables.presence_fresh_codes || [];
{
  fresh();
  ok('the scheduler and the operator’s own tools are never asked', JSON.stringify(await F.requireFresh({ kind: 'system' }, {}, 'transfer', '', {})) === JSON.stringify({ way: 'none' }));
  ok('nobody signed in: asked to sign in, nothing sent', (await body(await F.requireFresh({ kind: 'public', userId: null, jwt: null }, {}, 'transfer', '', {}))).status === 401 && sent.length === 0);
  const first = await body(await go('jwt-email'));
  ok('no code yet: 403, a code is emailed to them, and the answer says where (masked)', first.status === 403 && first.error === 'fresh_code_needed' && first.way === 'email' && first.to === 'p***@studio.example' && sent.length === 1 && sent[0].to === 'pat@studio.example' && first.go === 'Confirm and send the invite');
  ok('…kept as a hash, never the code itself', rows().length === 1 && rows()[0].code_hash.length === 64 && !rows()[0].code_hash.includes(lastCode()) && rows()[0].user_id === U && rows()[0].action === 'invite_coowner' && !rows()[0].used_at);
  const code = lastCode();
  const wrong = await body(await go('jwt-email', code === '000000' ? '111111' : '000000'));
  ok('a wrong code: refused, with the tries left', wrong.status === 403 && wrong.error === 'fresh_code_wrong' && wrong.tries_left === 4 && wrong.message === 'That code isn’t right. 4 tries left.' && rows()[0].tries === 1);
  const other = await body(await go('jwt-other', code));
  ok('someone else’s code doesn’t work for them', other.status === 403 && other.error !== undefined && rows()[0].used_at == null);
  const otherAction = await body(await go('jwt-email', code, 'domain_remove'));
  ok('a code works only for the action it was sent for', otherAction.status === 403 && rows().find((r) => r.action === 'invite_coowner').used_at == null);
  const right = await go('jwt-email', code);
  ok('the right code: through, by email', JSON.stringify(right) === JSON.stringify({ way: 'email' }) && !!rows().find((r) => r.action === 'invite_coowner').used_at);
  const twice = await body(await go('jwt-email', code));
  ok('…once only: the same code again asks for a new one', twice.status === 403 && twice.error === 'fresh_code_expired');
}
{
  fresh();
  await go('jwt-email');
  const code = lastCode(), bad = code === '999999' ? '888888' : '999999';
  for (let i = 0; i < 5; i++) await go('jwt-email', bad);
  const locked = await body(await go('jwt-email', code));
  ok('five wrong tries: the code is spent, even the right one is refused', locked.status === 429 && locked.error === 'fresh_code_tries');
}
{
  fresh();
  await go('jwt-email');
  rows()[0].expires_at = new Date(Date.now() - 1000).toISOString();
  const old = await body(await go('jwt-email', lastCode()));
  ok('a code past its ten minutes: not accepted, and a new one is sent', old.status === 403 && old.error === 'fresh_code_expired' && sent.length === 2 && /run out/.test(old.message));
}
{
  fresh();
  for (let i = 0; i < 3; i++) await go('jwt-email');
  const fourth = await body(await go('jwt-email'));
  ok('three codes in ten minutes, then no more', fourth.status === 429 && fourth.error === 'fresh_code_sends' && sent.length === 3);
}
{
  fresh();
  const ask = await body(await go('jwt-app'));
  ok('two-step on: asked for the app’s code, and nothing is emailed or stored', ask.status === 403 && ask.error === 'fresh_code_needed' && ask.way === 'app' && sent.length === 0 && rows().length === 0);
  const no = await body(await go('jwt-app', '246802'));
  ok('…a wrong app code is refused (Supabase Auth checked it with their own sign-in)', no.status === 403 && no.error === 'fresh_code_wrong' && appCalls.at(-1)?.jwt === 'jwt-app' && appCalls.at(-1)?.factor === 'factor-1');
  ok('…the right one goes through', JSON.stringify(await go('jwt-app', '135790')) === JSON.stringify({ way: 'app' }));
  appSays = null;
  ok('…when Supabase can’t be asked, it waits and says so', (await body(await go('jwt-app', '135790'))).status === 503);
}

// ═══ C · the owner told ═══
{
  const m = A.alertEmail('coowner_added', { business: 'Maple & Main Realty', who: 'alex@maple.example', by: 'pat@studio.example', at: '2026-11-12T15:41:00Z', confirmedWith: 'email' });
  ok('the alert: who, what, when, how it was confirmed, what to do if not, and that it can’t be switched off', m.subject === 'alex@maple.example is now a co-owner of Maple &amp; Main Realty'.replace('&amp;', '&') && m.html.includes('pat@studio.example invited alex@maple.example to Maple &amp; Main Realty as a co-owner.') && m.html.includes('A code emailed to them') && m.html.includes('Nov 12, 2026') && m.html.includes('If not: open People to remove them') && m.html.includes('These can’t be switched off.'));
  ok('the handover and the domain say their own things', /being handed to ana@maple\.example/.test(A.alertEmail('transfer_started', { business: 'X', who: 'ana@maple.example', by: 'sam', at: '', confirmedWith: 'app' }).subject) && /press Stop/.test(A.alertEmail('transfer_started', { business: 'X', who: 'a', by: 'b', at: '', confirmedWith: 'app' }).html) && /removed from X/.test(A.alertEmail('domain_removed', { business: 'X', who: 'x.example', by: 'b', at: '', confirmedWith: 'none' }).subject));
  const out = [];
  A.alertDeps.owner = async (site) => (site === 'owned' ? { to: 'sam@maple.example', business: 'Maple & Main Realty' } : null);
  A.alertDeps.send = async (to, subject) => { out.push({ to, subject }); return true; };
  ok('alertOwner: the owner gets it; a site with no owner, nobody', await A.alertOwner('owned', 'coowner_added', { who: 'alex@maple.example', by: 'pat', confirmedWith: 'app' }) === true && await A.alertOwner('nobody', 'coowner_added', { who: 'a', by: 'b', confirmedWith: 'app' }) === false && out.length === 1 && out[0].to === 'sam@maple.example');
  A.alertDeps.send = async () => { throw new Error('boom'); };
  ok('…and never throws into the action', await A.alertOwner('owned', 'domain_removed', { who: 'x', by: 'y', confirmedWith: 'none' }) === false);
}

// ═══ D · the wiring ═══
{
  const at = (src, a, b) => src.indexOf(a) > -1 && src.indexOf(b) > -1 && src.indexOf(a) < src.indexOf(b);
  const ws = read('supabase/functions/presence/routes/workspace.ts');
  ok('inviting a co-owner asks before the seat is written', at(ws, "requireFresh(principal, body, 'invite_coowner'", 'const res = await addSiteMember(') && ws.includes("if (coOwner) await alertOwner(site.id, 'coowner_added'"));
  ok('making someone a co-owner asks before the role changes', at(ws.slice(ws.indexOf('export async function handleMemberRole')), "requireFresh(principal, body, 'invite_coowner'", 'const res = await changeSiteMemberRole('));
  const tr = read('supabase/functions/presence/routes/site_transfer.ts');
  ok('starting a handover asks before it is made; the owner is alerted when they started it', at(tr, "requireFresh(principal, b, 'transfer'", 'const made = await createTransfer(') && tr.includes("if (side === 'owner') await alertOwner(site.id, 'transfer_started'"));
  ok('the owner agreeing asks before it moves on', at(tr.slice(tr.indexOf("if (verb === 'agree') {")), "requireFresh(principal, ab, 'transfer'", "moveTransfer(t, 'asked_new'"));
  const adm = read('supabase/functions/presence/routes/admin.ts');
  ok('removing the domain asks after the name is typed back, before it is removed', at(adm, "if (typed !== site.custom_domain.toLowerCase())", "requireFresh(principal, body, 'domain_remove'") && at(adm, "requireFresh(principal, body, 'domain_remove'", 'const removed = await setCustomDomain(site.netlify_site_id, null);'));
  const com = read('supabase/functions/presence/routes/commerce.ts');
  ok('closing the account asks before the request is recorded', at(com, "requireFresh(principal, cb, 'close_account'", "const reqd = await requestDeletion(site.client_id, site.id, 'customer');"));
  const auth = read('supabase/functions/_shared/auth.ts');
  ok('the one sign-in check refuses a half-finished sign-in', /const user = await uRes\.json\(\);\n\s*if \(!user \|\| !user\.id\) return null;\n\s*if \(secondStepMissing\(user, jwt\)\) return null;/.test(auth));
  // the older function reads sign-ins only through the shared check (item 213 removed its own reads);
  // one it reads by itself again must apply the rule too
  const clever = read('supabase/functions/clever-api/index.ts');
  const reads = clever.split('auth/v1/user`').length - 1, guarded = clever.split('if (secondStepMissing(user, jwt)) return').length - 1;
  ok('…and so would any sign-in read the older function makes by itself', reads === guarded && /from '\.\.\/_shared\/auth\.ts'/.test(clever), `${guarded} of ${reads}`);
  const mig = read('supabase/migrations/0197_fresh_codes.sql'), pack = read('docs/presence/APPLY-0197-prod.sql');
  const table = (x) => x.slice(x.indexOf('create table if not exists public.presence_fresh_codes'), x.indexOf("'Builder item 191"));
  ok('0197: the migration and its production pack make the same table, service role only', table(mig).length > 300 && table(mig) === table(pack) && mig.includes('enable row level security') && pack.includes('-- Check:'));
  ok('0197 is the only migration with that number', [...Deno.readDirSync(new URL('supabase/migrations/', ROOT))].filter((e) => e.name.startsWith('0197_')).length === 1);
}
{
  db.reset({});
  db.fail.add('presence_fresh_codes');
  const r = await runRetentionSweep();
  ok('the retention sweep clears old codes, and says when it couldn’t', r.fresh_codes === false);
}

const passed = results.filter(Boolean).length;
console.log(`\n════ FRESH CODES AND TWO-STEP SIGN-IN (item 191): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
