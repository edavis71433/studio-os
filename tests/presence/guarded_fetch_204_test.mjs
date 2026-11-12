// ── Builder list item 204: every fetch of a typed address goes through the one guarded fetcher ──
//   deno run --allow-read --allow-env --allow-net tests/presence/guarded_fetch_204_test.mjs
// Nov 12 review, finding 93: the link checker, the prospect look, the health probes and
// the domain check fetched addresses an owner typed, and followed their redirects, with
// no public-address guard. Part A: guardedFetch (_shared/tools/url_guard.ts) guards the
// first address and every hop. Part B: the places that fetched without it refuse a
// private address, on the first hop and on a redirect, and never reach it. Part C: a
// tripwire over the whole presence function: a fetch of an address that isn't fixed fails
// here until it goes through the guard or is listed below with why it is safe.
Deno.env.set('SUPABASE_URL', 'https://db.test');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// every address the server asks for, and what each one answers
const asked = [];
let answers = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = String(typeof input === 'string' ? input : input.url);
  asked.push({ url: u, method: (init.method || 'GET').toUpperCase(), redirect: init.redirect });
  const a = answers[u];
  if (typeof a === 'function') return a();
  if (a) return a;
  if (u.startsWith('https://db.test/rest/v1/')) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  return new Response('<html><head><title>x</title><meta name="viewport" content="width=device-width"></head></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
};
const moved = (to) => () => new Response(null, { status: 301, headers: { Location: to } });
const reachedPrivate = () => asked.some((a) => /\/\/(127\.|10\.|169\.254\.|192\.168\.|\[::1\]|localhost)/.test(a.url));
const fresh = () => { asked.length = 0; answers = {}; };

const { guardedFetch } = await import('../../supabase/functions/_shared/tools/url_guard.ts');
const { linkOk } = await import('../../supabase/functions/presence/routes/search.ts');
const { quickSiteLook } = await import('../../supabase/functions/presence/routes/prospects.ts');
const { collectOptimization } = await import('../../supabase/functions/presence/optimization/collect.ts');
const { strangerStatus } = await import('../../supabase/functions/presence/routes/publish.ts');
const { handlePushSubscribe } = await import('../../supabase/functions/presence/routes/push.ts');

// ═══ A · the one guarded fetcher ═══
{
  fresh();
  answers['http://203.0.113.5/'] = moved('http://203.0.113.6/next');
  answers['http://203.0.113.6/next'] = new Response('fine', { status: 200 });
  const r = await guardedFetch('http://203.0.113.5/');
  ok('a public address and its public redirect: followed by hand, the last answer comes back', r.status === 200 && (await r.text()) === 'fine' && asked.length === 2 && asked.every((a) => a.redirect === 'manual'));
  fresh();
  let threw = '';
  try { await guardedFetch('http://169.254.169.254/latest/meta-data/'); } catch (e) { threw = e.message; }
  ok('a private first address: refused before anything is asked', threw === 'blocked_ip' && asked.length === 0);
  fresh();
  answers['http://203.0.113.5/'] = moved('http://127.0.0.1:5432/');
  threw = '';
  try { await guardedFetch('http://203.0.113.5/'); } catch (e) { threw = e.message; }
  ok('a redirect to a private address: refused at that hop, never asked', threw === 'blocked_ip' && asked.length === 1 && !reachedPrivate());
  fresh();
  answers['http://203.0.113.5/'] = moved('http://[::ffff:7f00:1]/');
  threw = '';
  try { await guardedFetch('http://203.0.113.5/'); } catch (e) { threw = e.message; }
  ok('…an IPv6 spelling of one too (PR 292)', threw === 'blocked_ip' && asked.length === 1);
  fresh();
  for (let i = 0; i < 6; i++) answers[`http://203.0.113.5/${i}`] = moved(`http://203.0.113.5/${i + 1}`);
  threw = '';
  try { await guardedFetch('http://203.0.113.5/0'); } catch (e) { threw = e.message; }
  ok('too many hops: refused', threw === 'too_many_redirects' && asked.length === 4);
  fresh();
  answers['http://203.0.113.5/'] = moved('http://10.0.0.1/');
  const first = await guardedFetch('http://203.0.113.5/', {}, { follow: false });
  ok('follow: false hands back the redirect itself, and goes no further', first.status === 301 && asked.length === 1);
  ok('a scheme that isn’t the web: refused', await guardedFetch('file:///etc/passwd').then(() => false, (e) => e.message === 'blocked_scheme'));
}

// ═══ B · the places that fetched without it ═══
{
  fresh();
  ok('Search: a typed link to a private address reads as broken, and is never asked', await linkOk('http://127.0.0.1:8080/admin') === false && asked.length === 0);
  fresh();
  answers['http://203.0.113.5/book'] = moved('http://169.254.169.254/latest/meta-data/');
  ok('Search: …nor is a private address its redirect points to', await linkOk('http://203.0.113.5/book') === false && !reachedPrivate());
  fresh();
  answers['http://203.0.113.5/'] = new Response('<html></html>', { status: 200 });
  ok('Search: a public link that answers is fine', await linkOk('http://203.0.113.5/') === true);
  fresh();
  ok('Prospects: a private “website” scores as not working, and is never asked', JSON.stringify(await quickSiteLook('http://10.0.0.5/')) === JSON.stringify({ health: 'unreachable', score: 85 }) && asked.length === 0);
  fresh();
  answers['http://203.0.113.5/'] = moved('http://192.168.1.1/');
  ok('Prospects: …nor a redirect to one', (await quickSiteLook('http://203.0.113.5/')).health === 'unreachable' && !reachedPrivate());
  fresh();
  answers['http://203.0.113.5/'] = moved('http://10.0.0.1/admin');
  const opt = await collectOptimization({ id: 'site-1', custom_domain: '203.0.113.5' }, 'http://127.0.0.1/', null);
  ok('Health probes: a domain whose redirect points inside, and a live address inside, are never asked', !reachedPrivate() && opt.homeProbe === null && opt.robotsTxt === null && opt.sitemapXml === null, JSON.stringify(asked.map((a) => a.url)));
  fresh();
  ok('The live-site check after a password change: a private address is never asked', await strangerStatus('http://127.0.0.1/', () => true, 1, 0) === 0 && asked.length === 0);
  fresh();
  const sub = async (endpoint) => (await handlePushSubscribe(new Request('https://fn.test/push/subscribe', { method: 'POST', body: JSON.stringify({ endpoint, keys: { p256dh: 'k', auth: 'a' } }) }), { kind: 'public', jwt: null }, {})).status;
  ok('Push: a browser can’t hand us a private address to post to later', await sub('https://169.254.169.254/latest') === 422 && await sub('https://10.0.0.1/push') === 422 && !asked.some((a) => a.url.includes('push_subscriptions')));
}

// ═══ C · the tripwire: no fetch of an address that isn't fixed, outside the guard ═══
// A fetch whose address is a variable or built from one, in the presence function. Each one
// here is not a typed address: a fixed service, our own storage, or a script that runs in a
// visitor's browser. A new one fails until it goes through guardedFetch or is listed, with why.
const SAFE = {
  'commerce/stripe.ts': [1, 'the Stripe API, from its fixed base'],
  'commerce/account.ts': [1, 'Resend’s email API, or the stand-in a scratch run names in RESEND_API_URL: a server setting, never a typed address'],
  'connected/adapters.ts': [2, 'a connection provider’s fixed API, from its own spec'],
  'connected/auth.ts': [2, 'a connection provider’s fixed token and revoke endpoints'],
  'connected/execute.ts': [1, 'a connection provider’s fixed write endpoint, from its spec'],
  'lib/media.ts': [2, 'our own storage: a signed upload address and the image transform'],
  'lib/stock/pexels.ts': [1, 'a photo address the Pexels API answered with'],
  'routes/assets.ts': [3, 'our own storage’s signed links, and Replicate’s delivery host (readPrediction)'],
  'visual/model.ts': [2, 'the image model’s endpoint, from the platform’s own settings'],
  // scripts drawn into pages: the visitor's browser runs these, never the server
  'lib/documents.ts': [1, 'a page script'], 'lib/feedback_panel.ts': [2, 'a page script'], 'lib/search_index.ts': [1, 'a page script'],
  'lib/site_send.ts': [3, 'a page script'], 'routes/reviews.ts': [1, 'a page script'],
};
{
  const FIXED = /^(?:['"]https:\/\/|`https:\/\/|`\$\{(?:SB_URL|SB|REST|API|base|url|DOH|APP_URL|RESEND_API|SUPABASE_URL)\})/;
  const found = {};
  const walk = (dir) => {
    for (const e of Deno.readDirSync(new URL(dir, ROOT))) {
      const rel = `${dir}${e.name}`;
      if (e.isDirectory) { walk(`${rel}/`); continue; }
      if (!e.name.endsWith('.ts')) continue;
      for (const m of read(rel).matchAll(/(?<![\w.])fetch\(\s*([^,)]+)/g)) {
        if (FIXED.test(m[1].trim())) continue;
        const key = rel.replace('supabase/functions/presence/', '');
        found[key] = (found[key] || 0) + 1;
      }
    }
  };
  walk('supabase/functions/presence/');
  const unlisted = Object.entries(found).filter(([f, n]) => !SAFE[f] || SAFE[f][0] !== n);
  ok('tripwire: every fetch of an address that isn’t fixed goes through guardedFetch, or is listed with why it is safe', unlisted.length === 0, unlisted.map(([f, n]) => `${f} (${n}, listed ${SAFE[f] ? SAFE[f][0] : 0})`).join(', '));
  const gone = Object.keys(SAFE).filter((f) => !found[f]);
  ok('tripwire: the list names no file that has no such fetch any more', gone.length === 0, gone.join(', '));
  const uses = ['routes/search.ts', 'routes/prospects.ts', 'optimization/collect.ts', 'evidence/collect.ts', 'lib/domain_health.ts', 'routes/services.ts', 'routes/publish.ts', 'routes/commercial.ts', 'lib/webpush.ts', 'monitor/external.ts'];
  const missing = uses.filter((f) => !read(`supabase/functions/presence/${f}`).includes('guardedFetch('));
  ok('the five places the review named, and the five more found with them, use the guarded fetcher', missing.length === 0, missing.join(', '));
}

globalThis.fetch = realFetch;
const passed = results.filter(Boolean).length;
console.log(`\n════ GUARDED FETCH (item 204): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
