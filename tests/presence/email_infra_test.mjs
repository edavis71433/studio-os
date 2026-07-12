// ── Email infrastructure (suppression + unsubscribe + svix) — the shared core ─
// Security-sensitive module used by EVERY Resend send in BOTH functions:
// HMAC unsubscribe tokens, the transactional-vs-marketing suppression gate,
// svix webhook verification (constant-time, replay-windowed), log masking.
//
//   deno run --allow-env --allow-net=none tests/presence/email_infra_test.mjs
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'test-signing-key-for-hmac-only');

const core = await import('../../supabase/functions/_shared/email_infra.ts');

// ── unsubscribe token ──
{
  const t1 = await core.unsubscribeToken('User@Example.com');
  const t2 = await core.unsubscribeToken('user@example.com  ');
  ok('token: case/whitespace-normalized (same address → same token)', t1 === t2 && t1.length === 32);
  const t3 = await core.unsubscribeToken('other@example.com');
  ok('token: different address → different token', t1 !== t3);
  const url = await core.unsubscribeUrl('user@example.com');
  ok('url: points at the presence /unsubscribe with e + t params', /\/functions\/v1\/presence\/unsubscribe\?e=user%40example\.com&t=/.test(url));
}

// ── suppression gate (fetch mocked) ──
{
  const realFetch = globalThis.fetch;
  const withReason = (reason) => { globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(reason ? [{ reason }] : []), { status: 200 })); };
  try {
    withReason(null);
    ok('maySend: clean address → ok', (await core.maySend('a@b.com')).ok === true);
    withReason('opt_out');
    ok('maySend: opt_out blocks marketing', (await core.maySend('a@b.com')).ok === false);
    ok('maySend: opt_out does NOT block critical (the printed promise)', (await core.maySend('a@b.com', { critical: true })).ok === true);
    withReason('bounce');
    ok('maySend: bounce blocks even critical (dead address)', (await core.maySend('a@b.com', { critical: true })).ok === false);
    withReason('complaint');
    ok('maySend: complaint blocks even critical', (await core.maySend('a@b.com', { critical: true })).ok === false);
    globalThis.fetch = () => Promise.reject(new Error('store down'));
    ok('suppressionOf: fail-OPEN on store error (a receipt is never blocked by a hiccup)', (await core.maySend('a@b.com')).ok === true);
  } finally { globalThis.fetch = realFetch; }
}

// ── svix verification ──
{
  const secret = 'whsec_' + btoa('svix-test-secret-32-bytes-long!!');
  const id = 'msg_1'; const ts = String(Math.floor(Date.now() / 1000));
  const payload = JSON.stringify({ type: 'email.bounced', data: { to: ['x@y.com'] } });
  const keyRaw = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${payload}`)))));
  ok('svix: valid signature verifies', await core.verifySvix(id, ts, `v1,${sig}`, payload, secret));
  ok('svix: tampered payload rejected', !(await core.verifySvix(id, ts, `v1,${sig}`, payload + 'x', secret)));
  ok('svix: wrong signature rejected', !(await core.verifySvix(id, ts, 'v1,AAAA' + sig.slice(4), payload, secret)));
  const staleTs = String(Math.floor(Date.now() / 1000) - 600);
  const staleSig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${staleTs}.${payload}`)))));
  ok('svix: stale timestamp (>5 min) rejected even with a valid signature', !(await core.verifySvix(id, staleTs, `v1,${staleSig}`, payload, secret)));
  ok('svix: multiple space-separated sigs — any valid one passes', await core.verifySvix(id, ts, `v1,WRONG v1,${sig}`, payload, secret));
  ok('svix: missing secret rejected', !(await core.verifySvix(id, ts, `v1,${sig}`, payload, '')));
}

// ── log masking ──
{
  ok('maskEmail: masks the local part, keeps the domain', core.maskEmail('eric@davisdigitalstudio.com') === 'e***@davisdigitalstudio.com');
  ok('maskEmail: garbage-safe', core.maskEmail('') === '***' && core.maskEmail('nodomain') === '***');
}

// ── wiring: both senders actually use the shared core ──
{
  const read = (p) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));
  const acct = read('supabase/functions/presence/commerce/account.ts');
  const clever = read('supabase/functions/clever-api/index.ts');
  ok('wiring: presence sendEmail gates on maySend + masks logs', /maySend\(to, opts\)/.test(acct) && /maskEmail\(to\)/.test(acct));
  ok('wiring: presence sendEmail supports critical transactional sends', /critical\?: boolean/.test(acct));
  ok('wiring: clever-api imports the SHARED core (_shared, not presence routes)', /_shared\/email_infra\.ts/.test(clever) && !/presence\/routes\/email_infra/.test(clever));
  ok('wiring: clever-api outreach carries a VISIBLE opt-out + postal address (CAN-SPAM)', /Burbank, California/.test(clever) && /unsubscribe<\/a>/.test(clever));
  ok('wiring: the branded shell footer carries the postal address', /Burbank, California/.test(read('supabase/functions/presence/lib/email_brand.ts')));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ EMAIL INFRA (shared core): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
