// ── Items 39 + 117: "Cut out the subject" on the server ──────────────────────
// lib/cutout.ts's pure parts (Replicate's answers, the delivery-host guard, the
// signed job token), then the REAL route handlers against a stand-in for the
// database, storage, Replicate and its delivery host: what is sent, what comes
// back, and every way it says no. No Supabase, no Replicate, no network.
//   deno run --allow-read --allow-env --allow-net tests/presence/cutout_test.mjs
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', REPLICATE_API_TOKEN: 'r8_test_token' })) Deno.env.set(k, v);

const P = '../../supabase/functions/presence';
const C = await import(`${P}/lib/cutout.ts`);
const { handleAssetCutout, handleCutoutJob } = await import(`${P}/routes/assets.ts`);
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PHOTO = '00000001-0000-4000-8000-000000000001', SMALL = '00000002-0000-4000-8000-000000000002', DOC = '00000003-0000-4000-8000-000000000003';
const site = { id: SITE, client_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
const principal = { userId: 'u1', email: 'owner@example.com', jwt: 'jwt' };
const cors = { 'Access-Control-Allow-Origin': '*' };
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3]);
const ROWS = {
  [PHOTO]: { id: PHOTO, site_id: SITE, storage_path: 'presence-media/aaaa/photo.jpg', mime: 'image/jpeg', width: 4032, height: 3024, alt_text: 'A shop', metadata: {} },
  [SMALL]: { id: SMALL, site_id: SITE, storage_path: 'presence-media/aaaa/small.png', mime: 'image/png', width: 1200, height: 800, alt_text: 'A logo', metadata: {} },
  [DOC]: { id: DOC, site_id: SITE, storage_path: 'presence-media/aaaa/menu.pdf', mime: 'application/pdf', width: null, height: null, alt_text: 'Menu', metadata: {} },
};

// ── the stand-in world ──
let W;
const reset = (o = {}) => { W = { calls: [], signs: [], meters: 0, rateOk: true, start: { status: 'succeeded', output: 'https://replicate.delivery/xezq/out.png' }, poll: { status: 'succeeded', output: 'https://replicate.delivery/xezq/out.png' }, result: { status: 200, type: 'image/png', body: PNG }, startStatus: 201, ...o }; };
const reply = (status, body, type = 'application/json') => new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), method = (init.method || 'GET').toUpperCase();
  W.calls.push(`${method} ${u}`);
  if (u.startsWith('http://stub.local/rest/v1/presence_media?')) {
    const id = /id=eq\.([0-9a-f-]{36})/.exec(u)?.[1], row = ROWS[id];
    return reply(200, row && u.includes(`site_id=eq.${row.site_id}`) ? [row] : []);
  }
  if (u === 'http://stub.local/rest/v1/rpc/rate_hit') return reply(200, W.rateOk);
  if (u === 'http://stub.local/rest/v1/rpc/presence_ai_meter') { W.meters++; return reply(200, null); }
  if (u.startsWith('http://stub.local/storage/v1/object/sign/')) {
    W.signs.push({ path: u.slice('http://stub.local/storage/v1/object/sign/'.length), body: JSON.parse(String(init.body || '{}')) });
    return reply(200, { signedURL: '/object/sign/presence-media/aaaa/x.jpg?token=signed' });
  }
  if (u === 'https://api.replicate.com/v1/predictions' && method === 'POST') { W.sent = { headers: init.headers, body: JSON.parse(String(init.body)) }; return reply(W.startStatus, W.start); }
  if (u.startsWith('https://api.replicate.com/v1/predictions/') && method === 'GET') return reply(200, W.poll);
  if (u.startsWith('https://replicate.delivery/')) return reply(W.result.status, W.result.body, W.result.type);
  return reply(599, { error: `unexpected call ${method} ${u}` });
};
const bytesOf = async (r) => new Uint8Array(await r.arrayBuffer());

// ═══ 1. the pure parts ═══
{
  ok('only Replicate’s delivery host counts as a result', C.isDeliveryUrl('https://replicate.delivery/a/b.png') && C.isDeliveryUrl('https://pbxt.replicate.delivery/a.png')
    && !C.isDeliveryUrl('http://replicate.delivery/a.png') && !C.isDeliveryUrl('https://replicate.delivery.evil.example/a.png') && !C.isDeliveryUrl('https://evil.example/replicate.delivery') && !C.isDeliveryUrl(null));
  ok('a finished prediction with a delivery link is done', JSON.stringify(C.readPrediction({ status: 'succeeded', output: 'https://replicate.delivery/x.png' })) === '{"state":"done","output":"https://replicate.delivery/x.png"}');
  ok('…a list of outputs takes the first link', C.readPrediction({ status: 'succeeded', output: [null, 'https://replicate.delivery/y.png'] }).output === 'https://replicate.delivery/y.png');
  ok('…a finished prediction pointing anywhere else is a failure, never fetched', C.readPrediction({ status: 'succeeded', output: 'https://evil.example/x.png' }).state === 'failed');
  ok('starting and processing are waiting, with the id', C.readPrediction({ status: 'starting', id: 'abc123def456' }).id === 'abc123def456' && C.readPrediction({ status: 'processing', id: 'abc123def456' }).state === 'waiting');
  ok('…a waiting answer without a sound id is a failure', C.readPrediction({ status: 'starting', id: '../../etc' }).state === 'failed');
  ok('failed and canceled are failures', C.readPrediction({ status: 'failed', error: 'CUDA' }).state === 'failed' && C.readPrediction({ status: 'canceled' }).state === 'failed' && C.readPrediction(null).state === 'failed');
  ok('a PNG is known by its first eight bytes', C.isPng(PNG) && !C.isPng(new TextEncoder().encode('<html>not a picture</html>')));
  const job = await C.jobFor(SITE, 'abc123def456');
  ok('a job token names the prediction and is signed for the site', /^abc123def456\.[A-Za-z0-9_-]{32}$/.test(job) && await C.idFromJob(SITE, job) === 'abc123def456');
  ok('…another site’s token, or a changed one, names nothing', await C.idFromJob(OTHER, job) === null && await C.idFromJob(SITE, job.slice(0, -1) + (job.endsWith('A') ? 'B' : 'A')) === null && await C.idFromJob(SITE, 'abc123def457' + job.slice(12)) === null && await C.idFromJob(SITE, 'nonsense') === null);
  ok('the model is pinned by version', /^[0-9a-f]{64}$/.test(C.CUTOUT_VERSION) && C.CUTOUT_MODEL === '851-labs/background-remover');
}

// ═══ 2. a cut-out that comes straight back ═══
{
  reset();
  const r = await handleAssetCutout(site, principal, PHOTO, cors);
  ok('a quick cut-out answers the PNG itself', r.status === 200 && r.headers.get('content-type') === 'image/png' && (await bytesOf(r)).length === PNG.length, String(r.status));
  ok('…with the page’s CORS headers, and never cached', r.headers.get('access-control-allow-origin') === '*' && r.headers.get('cache-control') === 'no-store');
  ok('Replicate is sent the pinned model and a signed link, never the key', W.sent.body.version === C.CUTOUT_VERSION && /token=signed/.test(W.sent.body.input.image) && !JSON.stringify(W.sent.body).includes('r8_test_token'));
  ok('…the key goes in the header, and the request waits for the answer', W.sent.headers.Authorization === 'Bearer r8_test_token' && /^wait=\d+$/.test(W.sent.headers.Prefer));
  ok('a big photo is sent shrunk to 3,000 px on its long side, its shape kept, for 15 minutes', W.signs.length === 1 && JSON.stringify(W.signs[0].body) === JSON.stringify({ expiresIn: 900, transform: { width: 3000, height: 3000, resize: 'contain', quality: 90 } }), JSON.stringify(W.signs[0]?.body));
  ok('…it is logged as a zero-cost operation', W.meters === 1);
  reset();
  await handleAssetCutout(site, principal, SMALL, cors);
  ok('a photo already that small is sent as it is (no re-encoding)', W.signs.length === 1 && JSON.stringify(W.signs[0].body) === '{"expiresIn":900}');
}

// ═══ 3. a model that is still starting ═══
{
  reset({ start: { status: 'starting', id: 'pred0000starting' }, startStatus: 201 });
  const r = await handleAssetCutout(site, principal, PHOTO, cors);
  const b = await r.json();
  ok('a model still starting answers 202 with a job to ask after', r.status === 202 && b.data.pending === true && /^pred0000starting\.[A-Za-z0-9_-]{32}$/.test(b.data.job) && /minute or two/.test(b.data.note));
  W.poll = { status: 'processing', id: 'pred0000starting' };
  const again = await handleCutoutJob(site, b.data.job, cors);
  ok('asking while it still works answers 202 again', again.status === 202 && (await again.json()).data.job === b.data.job);
  W.poll = { status: 'succeeded', id: 'pred0000starting', output: 'https://replicate.delivery/xezq/out.png' };
  const done = await handleCutoutJob(site, b.data.job, cors);
  ok('…and the PNG once it’s done', done.status === 200 && (await bytesOf(done)).length === PNG.length);
  const meters = W.meters;
  await handleCutoutJob(site, b.data.job, cors);
  ok('asking after a job is never logged again', W.meters === meters);
  const theirs = await handleCutoutJob({ ...site, id: OTHER }, b.data.job, cors);
  ok('another site can’t read it', theirs.status === 404 && !W.calls.slice(-1)[0].includes('api.replicate.com'));
}

// ═══ 4. every way it says no ═══
{
  reset();
  const doc = await handleAssetCutout(site, principal, DOC, cors);
  ok('a PDF: not a photo', doc.status === 400 && (await doc.json()).error === 'not_an_image');
  const gone = await handleAssetCutout(site, principal, '00000009-0000-4000-8000-000000000009', cors);
  ok('a file that isn’t here: 404', gone.status === 404);
  reset({ rateOk: false });
  const busy = await handleAssetCutout(site, principal, PHOTO, cors);
  ok('past 60 an hour (or 300 a day): 429, and Replicate isn’t asked', busy.status === 429 && !W.calls.some((c) => c.includes('api.replicate.com')));
  reset({ start: { status: 'failed', error: 'out of memory' } });
  const failed = await handleAssetCutout(site, principal, PHOTO, cors);
  ok('a failed prediction: 502 in plain words, and nothing logged', failed.status === 502 && /nothing changed/.test((await failed.json()).message) && W.meters === 0);
  reset({ start: { detail: 'Invalid version' }, startStatus: 422 });
  ok('Replicate refusing the request: 502', (await handleAssetCutout(site, principal, PHOTO, cors)).status === 502);
  reset({ start: { status: 'succeeded', output: 'https://evil.example/steal.png' } });
  const evil = await handleAssetCutout(site, principal, PHOTO, cors);
  ok('an answer pointing outside Replicate’s delivery host is never fetched', evil.status === 502 && !W.calls.some((c) => c.includes('evil.example')));
  reset({ result: { status: 200, type: 'text/html', body: '<html>gotcha</html>' } });
  ok('a result that isn’t a PNG is refused', (await handleAssetCutout(site, principal, PHOTO, cors)).status === 502);
  reset({ result: { status: 404, type: 'text/plain', body: 'gone' } });
  ok('a result that’s gone is refused', (await handleAssetCutout(site, principal, PHOTO, cors)).status === 502);
  reset();
  ok('a malformed job names nothing (404, Replicate not asked)', (await handleCutoutJob(site, 'abc', cors)).status === 404 && !W.calls.length);
  Deno.env.delete('REPLICATE_API_TOKEN');
  reset();
  const off = await handleAssetCutout(site, principal, PHOTO, cors);
  ok('no key: 503, honestly, before anything is signed or sent', off.status === 503 && (await off.json()).error === 'not_available' && !W.signs.length && !W.calls.some((c) => c.includes('replicate')));
  ok('…and asking after a job says the same', (await handleCutoutJob(site, 'abc123def456.' + 'A'.repeat(32), cors)).status === 503);
  Deno.env.set('REPLICATE_API_TOKEN', 'r8_test_token');
}

// ═══ 5. wiring ═══
{
  const idx = read('supabase/functions/presence/index.ts');
  ok('index: POST /assets/:id/cutout and GET /assets/cutout/:job are routed', idx.includes("if (mco && method === 'POST') return handleAssetCutout(site, principal, mco[1], cors);") && idx.includes("if (mcj && method === 'GET') return handleCutoutJob(site, mcj[1], cors);"));
  ok('roles: starting a cut-out is an edit', read('supabase/functions/presence/lib/site_roles.ts').includes('suggest|remove-background|cutout)`'));
  ok('the file’s details say whether this site can cut out', read('supabase/functions/presence/routes/assets.ts').includes("cutout_available: cutoutConfigured() && isImageMime(asset.mime || ''),"));
  ok('/system/health lists the key, and the secrets document says what it is', read('supabase/functions/presence/routes/system.ts').includes("{ name: 'REPLICATE_API_TOKEN', required: false,") && read('docs/presence/ENV-AND-SECRETS.md').includes('| `REPLICATE_API_TOKEN` |'));
  ok('the privacy page names Replicate, and what it gets', read('privacy.html').includes('<strong>Replicate</strong> (only when someone presses &ldquo;Cut out the subject&rdquo;'));
  const files = read('files.html');
  ok('Files offers the cut-out only where the server has a key', files.includes('cutout:d.cutout_available?()=>cutoutOf(a.id):null'));
  ok('Files asks after a slow model for three minutes at most, then says so', files.includes('const CUTOUT_POLL_MS=2500,CUTOUT_POLLS=72;') && files.includes("'/assets/cutout/'+encodeURIComponent(job)"));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ CUT OUT THE SUBJECT: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
