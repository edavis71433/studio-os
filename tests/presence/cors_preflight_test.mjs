// ── Speed (Nov 10 2026): the browser keeps the "may I?" answer ───────────────
// The app and the server are on different addresses, so the browser sends a
// preflight OPTIONS before each call. Without Access-Control-Max-Age it keeps
// the answer for 5 seconds, so nearly every call was made twice. This pins the
// header on every CORS answer the functions build.
//   deno run --allow-read --allow-env tests/presence/cors_preflight_test.mjs
import { cors, corsFor, PREFLIGHT_MAX_AGE } from '../../supabase/functions/_shared/cors.ts';
import { toolsCors } from '../../supabase/functions/_shared/tools/config.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const from = (origin) => new Request('https://fn.example.com/presence/site', { method: 'OPTIONS', headers: origin ? { origin } : {} });

ok('the max-age is a whole number of seconds, an hour or more', /^\d+$/.test(PREFLIGHT_MAX_AGE) && Number(PREFLIGHT_MAX_AGE) >= 3600);
{
  const h = corsFor(from('https://davisdigitalstudio.com'));
  ok('corsFor: the preflight answer says how long to keep it', h['Access-Control-Max-Age'] === PREFLIGHT_MAX_AGE);
  ok('corsFor: the allowed origin, headers and methods are as before', h['Access-Control-Allow-Origin'] === 'https://davisdigitalstudio.com' && /x-dds-user-jwt/.test(h['Access-Control-Allow-Headers']) && /PATCH/.test(h['Access-Control-Allow-Methods']));
  ok('corsFor: the answer still varies by origin', h['Vary'] === 'Origin');
  ok('corsFor: an origin not on the list gets the same header', corsFor(from('https://elsewhere.example'))['Access-Control-Max-Age'] === PREFLIGHT_MAX_AGE);
}
ok('the canonical cors object carries it too', cors['Access-Control-Max-Age'] === PREFLIGHT_MAX_AGE);
ok('the free tools’ answer carries it too', toolsCors(from('https://tools.davisdigitalstudio.com'))['Access-Control-Max-Age'] === PREFLIGHT_MAX_AGE);

// every function answers OPTIONS from one of those builders
for (const [file, builder] of [
  ['presence/index.ts', /if \(req\.method === 'OPTIONS'\) return new Response\('ok', \{ headers: cors \}\)/],
  ['clever-api/index.ts', /if \(req\.method === 'OPTIONS'\) return new Response\('ok', \{ headers: reqCors \}\)/],
  ['site-review/handler.ts', /toolsCors\(req\)/], ['ai-visibility/handler.ts', /toolsCors\(req\)/],
  ['tool-report/handler.ts', /toolsCors\(req\)/], ['unlock-report/handler.ts', /toolsCors\(req\)/],
]) {
  const src = await Deno.readTextFile(new URL('../../supabase/functions/' + file, import.meta.url));
  ok(`${file}: OPTIONS is answered from a shared builder`, builder.test(src) && !/'Access-Control-Allow-Origin':/.test(src));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
