// ── Client portal bugs from the Nov 10 2026 review (G6–G12 + the live walk) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/client_portal_bugs_test.mjs
// The server halves, run against a fake database where they can be (sharing a file,
// the services list), and pinned in the source where they can't (the older function's
// survey route, the invitation words, the static pages). The page halves are walked in
// tests/e2e/portal-bugs-nov10.spec.ts.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const AGENCY = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROJECT2 = 'c2c2c2c2-cccc-4ccc-8ccc-cccccccccccc';
const MEDIA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const { quotedTo, peopleOf, offeredTo, serviceKey } = await import('../../supabase/functions/presence/lib/portal_services.ts');
const CD = await import('../../supabase/functions/presence/routes/client_delivery.ts');

const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const SITE = { id: 'f0f0f0f0-0000-4000-8000-000000000000', client_id: CUSTOMER };
const PRINCIPAL = { kind: 'client', userId: 'u-1', email: 'client@example.com' };

/** A fake PostgREST + storage. `db` answers reads by table; every call is recorded. */
function installFetch(db = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = String(init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('/storage/v1/object/upload/sign/')) return jr({ url: '/object/upload/sign/presence-media/x?token=t' });
    if (url.includes('/storage/v1/')) return new Response(null, { status: 200, headers: { 'content-type': 'image/png', 'content-length': '10' } });
    if (url.includes('presence_service_links')) return jr([{ project_id: PROJECT, agency_site_id: AGENCY, customer_client_id: CUSTOMER, status: 'active' }]);
    if (url.includes('presence_media') && method === 'GET') return jr(url.includes('select=bytes') ? [] : (db.media ? [db.media] : []));
    if (url.includes('presence_media') && method === 'POST') return jr([{ id: MEDIA }], 201);
    if (url.includes('presence_media') && method === 'PATCH') {
      if (body && body.metadata && db.stampFails) return jr({ message: 'boom' }, 500);
      return jr(null, 204);
    }
    if (url.includes('presence_deliverables') && method === 'GET') return jr(db.prior ? [db.prior] : []);
    if (url.includes('presence_deliverables') && method === 'POST') return jr([{ id: 'd-new', project_id: PROJECT, media_id: MEDIA, title: body && body.title }], 201);
    for (const t of ['presence_offerings', 'presence_sales_templates', 'presence_deals', 'presence_proposals', 'presence_estimates']) {
      if (url.includes(t + '?')) {
        const v = db[t];
        if (typeof v === 'number') return jr({ message: 'fail' }, v);
        return jr(v || []);
      }
    }
    return jr([]);
  };
  return calls;
}
const restore = () => { globalThis.fetch = realFetch; };
const post = (b) => new Request('https://x/', { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });
const stamped = (over = {}) => ({ id: MEDIA, alt_text: 'Photo', mime: 'image/png', storage_path: 'presence-media/x.png', metadata: { client_upload: true, note: 'Uploaded by the client.', upload_customer: CUSTOMER, upload_project: PROJECT, ...over } });

// ═══ G8 — sharing a file accepts only the upload THIS client started for THIS project ═══
{
  // the upload-url step stamps who and which project on the media row
  let calls = installFetch({});
  let r = await CD.handleClientUploadUrl(post({ mime: 'image/png', bytes: 10, title: 'Logo' }), SITE, PRINCIPAL, PROJECT, {});
  const stamp = calls.find((c) => c.method === 'PATCH' && c.url.includes('presence_media') && c.body && c.body.metadata);
  ok('G8: the upload-url step stamps the media row with this client and this project',
    r.status === 200 && !!stamp && stamp.body.metadata.upload_customer === CUSTOMER && stamp.body.metadata.upload_project === PROJECT && stamp.body.metadata.client_upload === true);
  // …and when the stamp can't be written, the upload stops before any bytes travel
  calls = installFetch({ stampFails: true });
  r = await CD.handleClientUploadUrl(post({ mime: 'image/png', bytes: 10, title: 'Logo' }), SITE, PRINCIPAL, PROJECT, {});
  const binned = calls.find((c) => c.method === 'PATCH' && c.url.includes('presence_media') && c.body && c.body.deleted_at);
  ok('G8: a stamp that fails stops the upload (502, no upload address) and bins the empty row', r.status === 502 && !!binned && !(await r.json()).data);

  const record = async (db, project = PROJECT) => { const c = installFetch(db); const res = await CD.handleClientUploadCreate(post({ media_id: MEDIA, title: 'Logo' }), SITE, PRINCIPAL, project, {}); return { res, c }; };
  const touchedStorage = (c) => c.some((x) => x.url.includes('/storage/v1/'));
  const wroteDeliverable = (c) => c.some((x) => x.method === 'POST' && x.url.includes('presence_deliverables'));
  const binnedMedia = (c) => c.some((x) => x.method === 'PATCH' && x.url.includes('presence_media') && x.body && x.body.deleted_at);

  let t = await record({ media: { id: MEDIA, alt_text: 'Studio file', mime: 'application/pdf', storage_path: 'presence-media/s.pdf', metadata: {} } });
  ok('G8: a studio file (no client stamp) is refused — never attached, never inspected, never thrown away',
    t.res.status === 422 && !wroteDeliverable(t.c) && !touchedStorage(t.c) && !binnedMedia(t.c));
  t = await record({ media: stamped({ upload_customer: OTHER }) });
  ok('G8: another client’s upload is refused', t.res.status === 422 && !wroteDeliverable(t.c) && !touchedStorage(t.c));
  t = await record({ media: stamped({ upload_project: PROJECT2 }) });
  ok('G8: this client’s upload for a different project is refused here', t.res.status === 422 && !wroteDeliverable(t.c));
  t = await record({ media: stamped() });
  ok('G8: the upload this client just made for this project is recorded (201)', t.res.status === 201 && wroteDeliverable(t.c));
  t = await record({ media: stamped(), prior: { id: 'd-1', project_id: PROJECT, media_id: MEDIA, title: 'Logo' } });
  const again = await t.res.json();
  ok('G8: a record step repeated after a lost answer returns the row it already made — never a second listing',
    t.res.status === 200 && again.data && again.data.id === 'd-1' && !wroteDeliverable(t.c));
  restore();
}

// ═══ Live walk — the services list: general offers and the client's own only ═══
{
  const deals = [
    { id: 'deal-me', contact_id: 'ct-me', converted_client_id: CUSTOMER },
    { id: 'deal-me-old', contact_id: 'ct-me', converted_client_id: null },     // the same person, an earlier deal
    { id: 'deal-a', contact_id: 'ct-a', converted_client_id: OTHER },
    { id: 'deal-b', contact_id: null, converted_client_id: null },             // a prospect with no contact yet
  ];
  const docs = [
    { deal_id: 'deal-a', line_items: [{ label: 'Artist page intros (11 pages)', qty: 1, unit_cents: 50000 }, { label: 'Website design', qty: 1, unit_cents: 1 }, { __meta__: { tax_pct: 5 } }] },
    { deal_id: 'deal-b', line_items: [{ label: '  website   DESIGN ', qty: 1, unit_cents: 1 }] },
    { deal_id: 'deal-me-old', line_items: [{ label: 'Logo refresh', qty: 1, unit_cents: 1 }] },
    { deal_id: 'deal-gone', line_items: [{ label: 'Nobody’s', qty: 1, unit_cents: 1 }] },
  ];
  const q = quotedTo(deals, docs);
  const mine = peopleOf(CUSTOMER, deals);
  ok('services: names match ignoring case and spacing', serviceKey('  website   DESIGN ') === 'website design');
  ok('services: a service quoted to exactly one OTHER client is theirs — not offered here', offeredTo('Artist page intros (11 pages)', q, mine) === false);
  ok('services: a service quoted to two or more people is general', offeredTo('Website Design', q, mine) === true);
  ok('services: a service quoted to this client (on any of their deals) is theirs', offeredTo('Logo refresh', q, mine) === true);
  ok('services: a service quoted to nobody yet is general', offeredTo('Monthly care', q, mine) === true && offeredTo('Nobody’s', q, mine) === true);
  ok('services: the proposal’s reserved discount/tax element is not a service', !q.has('') && [...q.keys()].every((k) => !k.includes('meta')));

  // the route, end to end against the fake database
  const db = {
    presence_offerings: [{ id: 'o1', name: 'Website design', category: 'Web', description: '', price_text: '$1' }, { id: 'o2', name: 'Artist page intros (11 pages)', category: 'SEO', description: '', price_text: '$500' }],
    presence_sales_templates: [{ line_items: [{ label: 'Monthly care', qty: 1, unit_cents: 9900 }, { label: 'Services & Artists page descriptions', qty: 1, unit_cents: 30000 }] }],
    presence_deals: deals,
    presence_proposals: [docs[0], docs[1], { deal_id: 'deal-a', line_items: [{ label: 'Services & Artists page descriptions', qty: 1, unit_cents: 30000 }] }],
    presence_estimates: [docs[2]],
  };
  installFetch(db);
  let res = await CD.handleClientServices(new Request('https://x/'), SITE, PRINCIPAL, {});
  const names = ((await res.json()).data || []).map((s) => s.name);
  ok('services route: another client’s services are gone from both lists; general ones and Custom stay',
    res.status === 200 && names.includes('Website design') && names.includes('Monthly care') && names.includes('Custom request')
    && !names.includes('Artist page intros (11 pages)') && !names.includes('Services & Artists page descriptions'), names.join(' | '));
  installFetch({ ...db, presence_estimates: 404 });
  res = await CD.handleClientServices(new Request('https://x/'), SITE, PRINCIPAL, {});
  ok('services route: a database without estimates yet (404) still answers', res.status === 200);
  installFetch({ ...db, presence_proposals: 500 });
  res = await CD.handleClientServices(new Request('https://x/'), SITE, PRINCIPAL, {});
  ok('services route: no quote history → fails closed (502), never the whole list', res.status === 502);
  installFetch({ ...db, presence_estimates: 503 });
  res = await CD.handleClientServices(new Request('https://x/'), SITE, PRINCIPAL, {});
  ok('services route: a failed estimates read fails closed too', res.status === 502);
  restore();
}

// ═══ G6 — the older survey page and its route ═══
{
  const api = read('supabase/functions/clever-api/index.ts');
  const page = read('project-survey.html');
  const route = (api.match(/if \(type === 'survey_response'\) \{[\s\S]*?\n {4}\}\n/) || [''])[0];
  ok('G6: the survey route reports whether the answers were really saved (saved: the insert’s own ok)',
    /saved = ins\.ok;/.test(route) && /return json\(\{ ok: true, saved, emailed: ericEmailed \}\)/.test(route));
  ok('G6: the name comes from the client record when the link carries only an id', /if \(!name && clientId\)[\s\S]*?clients\?id=eq\.\$\{clientId\}&select=name/.test(route));
  ok('G6: the survey email link carries the client id only — no name — on the app’s own address',
    /\/project-survey\?c=\$\{encodeURIComponent\(c\.id\)\}`;/.test(api) && !/project-survey\?c=[^`]*&n=/.test(api) && /APP_URL'\) \|\| 'https:\/\/app\.davisdigitalstudio\.com'\)[^\n]*\/project-survey\?c=/.test(api));
  ok('G6: one send at a time — the button switches off and a second tap does nothing',
    /if \(sending\) return;/.test(page) && /sending = true;/.test(page) && /btn\.disabled = true;/.test(page));
  ok('G6: thanks only once the server says the answers arrived; otherwise the form stays with a try-again line',
    /reached = !!\(resp\.ok && jr && jr\.ok && \(jr\.saved === true \|\| jr\.emailed === true\)\)/.test(page) && /if \(!reached\) \{\s*sendFailed\(/.test(page));
  ok('G6: no more unchecked write straight to the table (anon has no insert grant there)', !/rest\/v1\/project_surveys/.test(page));
  ok('G6: an old link’s ?n= name is wiped from the address bar', /params\.delete\("n"\); history\.replaceState/.test(page));
  ok('G6: "saved" is said only when the server saved it', /if \(jr\.saved === true && jr\.emailed !== true\)/.test(page));
}

// ═══ G10 — a reviewer's invitation, and the password page's support address ═══
{
  const ws = read('supabase/functions/presence/lib/workspace.ts');
  const fn = (ws.match(/async function sendSiteInvite[\s\S]*?\n\}\n/) || [''])[0];
  ok('G10: a reviewer is invited to review, not to "help run" the business',
    /role === 'client_reviewer'[\s\S]*?subject: `\$\{name\} has shared work for you to review`/.test(fn) && /has shared work for you to look over and approve/.test(fn));
  ok('G10: other seats keep their words, and the name is escaped in the email’s HTML',
    /You’ve been invited to help run <strong>\$\{safe\}<\/strong>/.test(fn) && /const safe = name\.replace\(\/\[&<>"\]\/g/.test(fn) && !/<strong>\$\{name\}<\/strong>/.test(fn));
  const sp = read('set-password.html');
  ok('G10: an expired link or code no longer points every studio’s clients at one studio’s address',
    !/mailto:support@davisdigitalstudio\.com\?subject=New%20sign-in/.test(sp) && (sp.match(/freshLinkHtml\(\)/g) || []).length === 3);
  ok('G10: the way back is the reset on the right door, or the client’s own studio by name (escaped)',
    /client \? "\/portal\.html" : "\/studio\.html"/.test(sp) && /localStorage\.getItem\('dds-studio-brand'\)/.test(sp) && /who = who\.replace\(\/\[&<>"'\]\/g/.test(sp));
}

// ═══ G9 / G12 — the static pages ═══
{
  const cancel = read('payment-canceled.html');
  ok('G9: a cancelled payment goes back to the invoices, not just "Sign in"', /id="cta" href="\/client\.html#invoices">Back to your invoices →</.test(cancel));
  const stub = read('approval-center.html');
  ok('G12: an old approval link takes a client (signed in only at the client door) to their portal',
    /has\('dds-client-auth'\) && !has\('dds-portal-auth'\) \? '\/client\.html' : '\/inbox\.html' \+ location\.search \+ '#ok'/.test(stub));
}

// ═══ client.html pins (walked in the browser spec) ═══
{
  const c = read('client.html');
  ok('G3: the portal’s server helper turns no answer into an ordinary failure', /catch\(_\)\{return\{ok:false,status:0,offline:true,body:\{message:OFFLINE_MSG\}\};\}/.test(c));
  ok('G2: a signed-out visit keeps the destination, and the first load after sign-in opens it',
    /keepReturn\(new URLSearchParams\(location\.search\)\);/.test(c) && /const kept=first\?takeReturn\(\):null;/.test(c));
  ok('G12: a remembered reviewer skips the refused projects read, and is re-checked against the answer',
    /skipProj\?Promise\.resolve\(null\):api\('\/client\/projects'\)/.test(c) && /skipProj&&\(c\.is_managed_client\|\|c\.site_role!=='client_reviewer'\)/.test(c));
  ok('walk: owner asks are kept off a client’s Recent updates', /const moments=\(feed\.moments\|\|\[\]\)\.filter\(portalMoment\);/.test(c));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ CLIENT PORTAL BUGS (Nov 10): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
