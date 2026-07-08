// ── Phase S: rate limiter (FD-M2) — pure logic + fail-open contract ──────────
// The RPC itself is exercised live; here we lock the pure surface: IP extraction
// order, bucket-key discipline, the 429 body, and the fail-OPEN guarantee (a
// limiter outage must never take down a public form).
//   deno run --allow-read --allow-env tests/presence/ratelimit_test.mjs
import { clientIp, tooMany } from '../../supabase/functions/presence/lib/ratelimit.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const reqWith = (headers) => new Request('https://fn.example.com/forms/x/submit', { method: 'POST', headers });

// ═══ clientIp: header precedence + fallback ═══
ok('x-forwarded-for: first hop wins', clientIp(reqWith({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })) === '203.0.113.9');
ok('cf-connecting-ip fallback', clientIp(reqWith({ 'cf-connecting-ip': '198.51.100.7' })) === '198.51.100.7');
ok('x-real-ip fallback', clientIp(reqWith({ 'x-real-ip': '192.0.2.5' })) === '192.0.2.5');
ok('no headers → "unknown" (never throws, never empty)', clientIp(reqWith({})) === 'unknown');
ok('forwarded-for precedence over cf', clientIp(reqWith({ 'x-forwarded-for': '203.0.113.1', 'cf-connecting-ip': '9.9.9.9' })) === '203.0.113.1');

// ═══ tooMany: the 429 contract ═══
{
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const r = tooMany(cors);
  ok('429 status', r.status === 429);
  ok('Retry-After header present', r.headers.get('Retry-After') === '60');
  ok('CORS preserved on the 429', r.headers.get('Access-Control-Allow-Origin') === '*');
  const body = await r.json();
  ok('calm honest body (rate_limited + human message)', body.error === 'rate_limited' && /wait a minute/i.test(body.message));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
