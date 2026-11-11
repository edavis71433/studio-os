// ── Public pages that come from the server open as pages ──
//   deno run --allow-read --allow-env --allow-net tests/presence/public_pages_test.mjs
// Supabase serves an HTML answer from the function's own address (*.supabase.co) as
// plain text, so the review page in review emails, the unsubscribe page and shared draft
// links all showed their code. Each now opens on a viewer page on the app, and a visitor
// who opens the function's address directly is sent there. Item 74 rides along: the
// draft password goes in the body, tries are limited, and the right one earns a pass.
Deno.env.set('SUPABASE_URL', 'https://db.example');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-key');
Deno.env.set('APP_URL', 'https://app.example');
Deno.env.set('PREVIEW_LINK_SECRET', 'test-link-secret');
const { handlePublicPreview, handlePublicPreviewOpen, handleSignedPreview } = await import('../../supabase/functions/presence/routes/preview_env.ts');
const { handleReviewPage } = await import('../../supabase/functions/presence/routes/reviews.ts');
const { handleUnsubscribe } = await import('../../supabase/functions/presence/routes/email_infra.ts');
const { hashPreviewPassword } = await import('../../supabase/functions/presence/lib/preview_env.ts');
const { unsubscribeToken, unsubscribeUrl, unsubscribePageUrl } = await import('../../supabase/functions/_shared/email_infra.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const TOKEN = 'ab'.repeat(16), SITE = '11111111-1111-4111-8111-111111111111';
const HASH = await hashPreviewPassword('open sesame');

// a stubbed database: the link's row, the limiter, the suppression list; no snapshot, so a
// successful open draws the calm "can't be shown" page (the gate is what's under test)
const world = { rate: {}, suppressed: [] };
globalThis.fetch = (url, init = {}) => {
  const u = decodeURIComponent(String(url)), m = (init.method || 'GET').toUpperCase();
  const reply = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  if (u.includes('/presence_site_preview?token=eq.')) return reply(u.includes(TOKEN) ? [{ site_id: SITE, snapshot_id: 'snap-1', password_hash: world.hash ?? null }] : []);
  if (u.includes('/rpc/rate_hit')) { const b = JSON.parse(init.body); const k = `${b.p_bucket}|${b.p_window}`; world.rate[k] = (world.rate[k] || 0) + 1; return reply(world.rate[k] <= b.p_max); }
  if (u.includes('/suppressed_emails') && m === 'POST') { world.suppressed.push(JSON.parse(init.body)); return reply([], 201); }
  return reply([]);
};
const post = (body) => handlePublicPreviewOpen(new Request(`https://db.example/functions/v1/presence/p/${TOKEN}`, { method: 'POST', body: JSON.stringify(body) }), TOKEN, {});

// ── the shared draft's lasting link ──
{
  const r = await handlePublicPreview(new Request(`https://db.example/functions/v1/presence/p/${TOKEN}?page=/menu/`), TOKEN, {});
  ok('opening the function’s link goes on to the viewer, page kept', r.status === 302 && r.headers.get('location') === `https://app.example/draft.html?t=${TOKEN}&page=%2Fmenu%2F`);
  world.hash = null;
  const open = await post({ page: '/' });
  const j = await open.json();
  ok('a link with no password opens straight away, as a page for the viewer to show', typeof j.data?.html === 'string' && j.data.html.includes('<html') && !j.data.pass);
  world.hash = HASH;
  const need = await post({ page: '/' });
  ok('a protected link asks for the password', need.status === 401 && (await need.json()).error === 'password_required');
  const wrong = await post({ page: '/', pw: 'nope' });
  ok('a wrong password is refused in a sentence', wrong.status === 401 && /didn’t match/.test((await wrong.json()).message));
  const right = await post({ page: '/', pw: 'open sesame' });
  const rj = await right.json();
  ok('the right password opens it and earns a pass', typeof rj.data?.html === 'string' && /^\d+\.[0-9a-f]{64}$/.test(rj.data.pass || ''));
  const again = await (await post({ page: '/', pass: rj.data.pass })).json();
  ok('the pass opens the next page without the password', typeof again.data?.html === 'string');
  world.hash = await hashPreviewPassword('new password');
  const stale = await post({ page: '/', pass: rj.data.pass });
  ok('changing the password ends every pass', stale.status === 401);
  world.rate = {};
  let last = 0;
  for (let i = 0; i < 9; i++) last = (await post({ page: '/', pw: 'guess' + i })).status;
  ok('a ninth try in fifteen minutes is refused', last === 429);
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/preview_env.ts', import.meta.url));
  ok('the password never rides in an address any more', !/searchParams\.get\('pw'\)/.test(src) && !/name="pw"/.test(src));
}

// ── the timed link ──
{
  const r = await handleSignedPreview(new Request('https://db.example/functions/v1/presence/p/s/abc.def?page=/about/'), 'abc.def', {});
  ok('opening the timed link goes on to the viewer', r.status === 302 && r.headers.get('location') === 'https://app.example/draft.html?s=abc.def&page=%2Fabout%2F');
  const v = await handleSignedPreview(new Request('https://db.example/functions/v1/presence/p/s/abc.def?embed=1'), 'abc.def', {});
  ok('the viewer’s own ask gets a page (here: the link isn’t valid)', v.status === 404 && (v.headers.get('content-type') || '').includes('text/html'));
}

// ── the review page ──
{
  const r = await handleReviewPage(new Request(`https://db.example/functions/v1/presence/reviews/${SITE}`), SITE, {});
  ok('an emailed review link goes on to the viewer', r.status === 302 && r.headers.get('location') === `https://app.example/review.html?site=${SITE}`);
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/reviews.ts', import.meta.url));
  ok('review emails link the viewer; the page’s form still posts to the function', /const reviewPageUrl = \(siteId: string\) => `\$\{appUrl\(\)\}\/review\.html\?site=\$\{siteId\}`/.test(src) && /const endpoint = reviewEndpoint\(siteId\)/.test(src));
}

// ── unsubscribe ──
{
  const e = 'pat@client.example', t = await unsubscribeToken(e);
  const q = `?e=${encodeURIComponent(e)}&t=${t}`;
  const go = await handleUnsubscribe(new Request(`https://db.example/functions/v1/presence/unsubscribe${q}`), 'GET');
  ok('a clicked unsubscribe link goes on to the page on the app', go.status === 302 && go.headers.get('location') === `https://app.example/unsubscribe.html${q}`);
  const check = await handleUnsubscribe(new Request(`https://db.example/functions/v1/presence/unsubscribe${q}`, { headers: { Accept: 'application/json' } }), 'GET');
  ok('the page can ask whether the link is good', check.status === 200 && (await check.json()).data.valid === true);
  const badQ = `?e=${encodeURIComponent(e)}&t=nope`;
  const bad = await handleUnsubscribe(new Request(`https://db.example/functions/v1/presence/unsubscribe${badQ}`, { headers: { Accept: 'application/json' } }), 'GET');
  ok('a bad link is refused in a sentence', bad.status === 400 && /incomplete or expired/.test((await bad.json()).message));
  const done = await handleUnsubscribe(new Request(`https://db.example/functions/v1/presence/unsubscribe${q}`, { method: 'POST', headers: { Accept: 'application/json' } }), 'POST');
  ok('the page’s button unsubscribes', done.status === 200 && (await done.json()).data.unsubscribed === true && world.suppressed.some((x) => x.email === e));
  const oneClick = await handleUnsubscribe(new Request(`https://db.example/functions/v1/presence/unsubscribe${q}`, { method: 'POST' }), 'POST');
  ok('a mail client’s one-click POST still works and answers with a page', oneClick.status === 200 && (oneClick.headers.get('content-type') || '').includes('text/html'));
  ok('the header link stays the function’s; the link a person clicks is the page', (await unsubscribeUrl(e)).startsWith('https://db.example/functions/v1/presence/unsubscribe?') && (await unsubscribePageUrl(e)).startsWith('https://app.example/unsubscribe.html?'));
  const tools = Deno.readTextFileSync(new URL('../../supabase/functions/unlock-report/handler.ts', import.meta.url));
  const clever = Deno.readTextFileSync(new URL('../../supabase/functions/clever-api/index.ts', import.meta.url));
  ok('the Free Tools report email footer links the page (the old outreach email went with item 186)', /unsubscribeUrl: await unsubscribePageUrl\(email\)/.test(tools) && !/prospect_email_send/.test(clever));
}

// the three viewer pages exist and only ever ask the function
for (const f of ['draft.html', 'review.html', 'unsubscribe.html']) {
  const h = Deno.readTextFileSync(new URL(`../../${f}`, import.meta.url));
  ok(`${f}: noindex, no referrer, asks the function`, h.includes('noindex') && h.includes('no-referrer') && h.includes('/functions/v1/presence'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PUBLIC PAGES: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
