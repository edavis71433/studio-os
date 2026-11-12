// ── The website draft in the client portal (builder list item 179, part two) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/client_drafts_test.mjs
// routes/client_drafts.ts against a fake database: the studio's ask captures the
// client's draft; the client reads one page of exactly that draft, only ever of
// their own site; notes land on their own site, on a part of a page that exists,
// and only while the draft still waits for an answer.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const AGENCY = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const APPROVAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SNAP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SITE = { id: 'f0f0f0f0-0000-4000-8000-000000000000', client_id: CUSTOMER, status: 'live', last_published_at: '2026-10-01T00:00:00Z', template_slug: 'business-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence' };
const OTHER_SITE = '0b0b0b0b-0000-4000-8000-000000000000';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const D = await import('../../supabase/functions/presence/routes/client_drafts.ts');
const { previewCache, previewCacheKey } = await import('../../supabase/functions/presence/lib/preview_cache.ts');
const { memberWriteNeeds } = await import('../../supabase/functions/presence/lib/site_roles.ts');
const { isSubjectType } = await import('../../supabase/functions/presence/lib/approvals.ts');

const CONTENT = { settings: {
  blocks: [{ type: 'features', id: 'b1' }, { type: 'gallery', id: 'b2' }],
  pages: [{ slug: 'menu', title: 'Our menu', blocks: [{ type: 'pricing', id: 'p1' }] }, { slug: 'visit-us', title: '', blocks: [] }, { slug: 'menu', title: 'Dupe' }, { slug: '../x', title: 'Bad' }, null],
} };

const realFetch = globalThis.fetch;
const jr = (data, status = 200, headers = {}) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const PRINCIPAL = { kind: 'client', userId: 'u-1', email: 'client@example.com' };
/** A fake PostgREST. `db` shapes the answers; every call is recorded. */
function installFetch(db = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = String(init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('rpc/rate_hit')) return jr(db.limited ? false : true);
    if (url.includes('presence_service_links')) return jr(db.noLink ? [] : [{ project_id: PROJECT, agency_site_id: AGENCY, customer_client_id: CUSTOMER, customer_site_id: SITE.id }]);
    if (url.includes('presence_approvals') && method === 'GET') {
      if (url.includes('select=id,project_id&')) return jr([{ id: APPROVAL, project_id: PROJECT, site_id: AGENCY }]);   // linkForCustomerVia
      return jr([{ id: APPROVAL, project_id: PROJECT, subject_type: db.kind || 'website', subject_id: SNAP, title: 'Your website draft', status: db.status || 'pending', content_hash: 'h' }]);
    }
    if (url.includes('presence_snapshots') && method === 'GET') {
      if (url.includes('select=id&')) return jr(url.includes(`site_id=eq.${db.snapSite || SITE.id}`) && url.includes(`site_id=eq.${SITE.id}`) ? [{ id: SNAP }] : []);
      return jr([{ content: CONTENT, media_manifest: [], content_contract_version: 1, template_slug: 'business-classic', template_version: '1.0.0', created_at: '2026-11-10T00:00:00Z' }]);
    }
    if (url.includes('presence_section_comments')) {
      if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `*/${db.openCount ?? 0}` } });
      if (method === 'POST') return jr([{ id: 'n-new', ...body, created_at: '2026-11-11T12:00:00Z' }], 201);
      return jr(db.notes || []);
    }
    if (url.includes('presence_sites')) return jr(db.site ? [db.site] : []);
    return jr([]);
  };
  return calls;
}
const restore = () => { globalThis.fetch = realFetch; };
const get = (q = '') => new Request(`https://x/client/approvals/${APPROVAL}/draft${q}`);
const post = (b) => new Request('https://x/', { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });

// ═══ pure: the pages and the notes ═══
{
  const pages = D.draftPages(CONTENT);
  ok('pages: Home first, then each page once, junk and repeats skipped', JSON.stringify(pages.map((p) => p.slug)) === JSON.stringify(['', 'menu', 'visit-us']));
  ok('pages: a page with no title reads as its slug in words', pages[2].title === 'Visit us' && pages[1].title === 'Our menu' && pages[0].title === 'Home');
  ok('pages: nothing at all is still Home', JSON.stringify(D.draftPages(null)) === JSON.stringify([{ slug: '', title: 'Home' }]));
  const rows = D.noteRows([
    { id: 'a', page_slug: '', block_id: 'gallery:b2', body: 'Brighter?', status: 'open', created_at: 't1' },
    { id: 'b', page_slug: 'menu', block_id: null, body: 'Sundays', status: 'resolved', created_at: 't2' },
    { id: 'c', page_slug: 'menu', block_id: 'pricing:gone', body: 'x', status: 'open', created_at: 't3' },
    null,
  ], CONTENT);
  ok('notes: a note names its page and part in plain words', rows[0].page_title === 'Home' && rows[0].part === 'Photo gallery' && rows[0].status === 'open');
  ok('notes: no part, or a part that has gone, reads as the whole page', rows[1].part === 'The whole page' && rows[2].part === 'The whole page' && rows[1].page_title === 'Our menu');
  ok('notes: anything the studio dealt with reads as done', rows[1].status === 'done' && rows.length === 3);
}

// ═══ the wiring: one more kind, one write the gate knows ═══
{
  ok('kind: a website approval is a kind the route accepts', isSubjectType('website') && !isSubjectType('site'));
  ok('gate: a note on the draft is a comment, like a note on the shared link', memberWriteNeeds(`/client/approvals/${APPROVAL}/notes`, 'POST') === 'comment');
  const idx = read('supabase/functions/presence/index.ts');
  ok('index: the draft read and the note write are wired', /client\\\/approvals\\\/\(\[0-9a-f-\]\{36\}\)\\\/draft\$/.test(idx) && /handleClientDraftNote\(req, site, principal, m\[1\], cors\)/.test(idx));
  const mig = read('supabase/migrations/0179_website_draft_approvals.sql');
  const pack = read('docs/presence/APPLY-0179-prod.sql');
  ok('0179: the kinds now include website, in the migration and its pack', [mig, pack].every((s) => /check \(subject_type in \('deliverable','task','project','custom','website'\)\)/.test(s) && /drop constraint if exists presence_approvals_subject_type_check/.test(s)));
  const pd = read('supabase/functions/presence/routes/project_delivery.ts');
  ok('ask: a website ask captures the draft before anything is written, and replaces the one waiting', /captureWebsiteDraft\(site\.id, projectId, principal\)/.test(pd) && /project_id=eq\.\$\{projectId\}&subject_type=eq\.website&status=eq\.pending/.test(pd));
  ok('ask: before 0179 a website ask says it isn’t switched on yet', /website && \/subject_type\/\.test\(ins\.text/.test(pd));
  const sb = read('supabase/functions/presence/lib/service_bridge.ts');
  ok('email: the ask’s button opens that approval (the project stays in the link as the fallback)', /\{ approval: a\.id \}\)\.catch/.test(pd) && /\?project=\$\{encodeURIComponent\(projectId\)\}\$\{approval \? `&approval=\$\{approval\}` : ''\}/.test(sb) && /approval \? 'Take a look →' : 'Open your project →'/.test(sb));
}

// ═══ the client reads the draft ═══
{
  previewCache.set(previewCacheKey(SITE.id, 'snap', SNAP), { fileMap: { 'index.html': '<html><head></head><body><a href="/menu/">Menu</a><a href="https://elsewhere.example/">Out</a></body></html>', 'menu/index.html': '<html><head></head><body><h1>Menu</h1></body></html>' }, mediaManifest: [], blockers: 0, warnings: 0, businessName: 'Maria’s Flowers' });
  let calls = installFetch({ notes: [{ id: 'n1', page_slug: '', block_id: 'features:b1', body: 'Bigger?', status: 'open', created_at: 't' }] });
  let r = await D.handleClientDraft(get(), SITE, PRINCIPAL, APPROVAL, {});
  let j = await r.json();
  ok('read: the home page of the draft comes back drawn, with its links kept inside the portal', r.status === 200 && j.data.page === '' && j.data.html.includes('href="#dds-draft-page=%2Fmenu%2F"') && j.data.html.includes('href="https://elsewhere.example/"'));
  ok('read: the drawn page carries the draft badge and is never cached (the photo links expire)', j.data.html.includes('presence-preview-badge') && r.headers.get('Cache-Control') === 'no-store');
  ok('read: it lists the pages, this page’s parts and the client’s notes', j.data.pages.length === 3 && JSON.stringify(j.data.sections.map((s) => s.name)) === JSON.stringify(['Features', 'Photo gallery']) && j.data.notes[0].part === 'Features');
  ok('read: the snapshot must be a version of the caller’s own site', calls.some((c) => c.url.includes('presence_snapshots') && c.url.includes(`id=eq.${SNAP}`) && c.url.includes(`site_id=eq.${SITE.id}`)));
  ok('read: notes are only the client’s own, on their own site', calls.some((c) => c.url.includes('presence_section_comments') && c.url.includes(`site_id=eq.${SITE.id}`) && c.url.includes('author_kind=eq.client')));
  calls = installFetch({});
  r = await D.handleClientDraft(get('?page=menu'), SITE, PRINCIPAL, APPROVAL, {});
  j = await r.json();
  ok('read: another page of the same draft, by its slug', r.status === 200 && j.data.page === 'menu' && j.data.html.includes('<h1>Menu</h1>') && j.data.sections[0].name === 'Pricing');

  installFetch({});
  ok('refuse: a page the draft doesn’t have is 404, a bad page reference 400', (await D.handleClientDraft(get('?page=nowhere'), SITE, PRINCIPAL, APPROVAL, {})).status === 404 && (await D.handleClientDraft(get('?page=..%2Fetc'), SITE, PRINCIPAL, APPROVAL, {})).status === 400);
  installFetch({ noLink: true });
  ok('refuse: an approval on a project the client isn’t linked to is 404', (await D.handleClientDraft(get(), SITE, PRINCIPAL, APPROVAL, {})).status === 404);
  installFetch({ kind: 'deliverable' });
  ok('refuse: an approval of another kind has no draft (404)', (await D.handleClientDraft(get(), SITE, PRINCIPAL, APPROVAL, {})).status === 404);
  installFetch({ snapSite: OTHER_SITE });
  ok('refuse: a snapshot of someone else’s site is never drawn (404)', (await D.handleClientDraft(get(), SITE, PRINCIPAL, APPROVAL, {})).status === 404);
  installFetch({});
  ok('refuse: a malformed approval id is 400', (await D.handleClientDraft(get(), SITE, PRINCIPAL, 'nope', {})).status === 400);
  ok('refuse: a caller with no customer record is 404', (await D.handleClientDraft(get(), { ...SITE, client_id: null }, PRINCIPAL, APPROVAL, {})).status === 404);
}

// ═══ the client leaves a note ═══
{
  let calls = installFetch({});
  let r = await D.handleClientDraftNote(post({ page: '', block_id: 'gallery:b2', body: '  Can the photos be brighter?  ' }), SITE, PRINCIPAL, APPROVAL, {});
  let j = await r.json();
  const ins = calls.find((c) => c.method === 'POST' && c.url.includes('presence_section_comments'));
  ok('note: it lands on the client’s own site, as the client’s, on that part of that page', r.status === 201 && !!ins && ins.body.site_id === SITE.id && ins.body.author_kind === 'client' && ins.body.page_slug === '' && ins.body.block_id === 'gallery:b2' && ins.body.status === 'open' && ins.body.body === 'Can the photos be brighter?');
  ok('note: no personal details are stored with it, and the answer names the part', ins.body.author_key === null && j.data.part === 'Photo gallery' && j.data.status === 'open');
  ok('note: the site’s timeline says a note arrived, never its words', calls.some((c) => c.method === 'POST' && c.url.includes('presence_change_events') && !JSON.stringify(c.body).includes('brighter')));
  calls = installFetch({});
  r = await D.handleClientDraftNote(post({ page: 'menu', block_id: '', body: 'We close at 6 on Sundays.' }), SITE, PRINCIPAL, APPROVAL, {});
  ok('note: the whole of another page is fine', r.status === 201 && calls.find((c) => c.method === 'POST' && c.url.includes('presence_section_comments')).body.block_id === null);

  installFetch({});
  ok('note: a part that isn’t on that page is refused (422)', (await D.handleClientDraftNote(post({ page: 'menu', block_id: 'gallery:b2', body: 'x' }), SITE, PRINCIPAL, APPROVAL, {})).status === 422);
  ok('note: a page the draft doesn’t have is refused (422)', (await D.handleClientDraftNote(post({ page: 'nowhere', body: 'x' }), SITE, PRINCIPAL, APPROVAL, {})).status === 422);
  r = await D.handleClientDraftNote(post({ page: '', body: '   ' }), SITE, PRINCIPAL, APPROVAL, {});
  ok('note: an empty note is refused in words', r.status === 422 && /Write a note first/.test((await r.json()).message));
  installFetch({ status: 'approved' });
  ok('note: once the draft is approved, notes go to Messages instead (409)', (await D.handleClientDraftNote(post({ page: '', body: 'x' }), SITE, PRINCIPAL, APPROVAL, {})).status === 409);
  installFetch({ status: 'changes_requested' });
  ok('note: after asking for changes, more notes are welcome', (await D.handleClientDraftNote(post({ page: '', body: 'And the footer.' }), SITE, PRINCIPAL, APPROVAL, {})).status === 201);
  installFetch({ limited: true });
  ok('note: too many in ten minutes is 429', (await D.handleClientDraftNote(post({ page: '', body: 'x' }), SITE, PRINCIPAL, APPROVAL, {})).status === 429);
  installFetch({ openCount: 200 });
  ok('note: a full inbox of open notes is 429, with no write', (await D.handleClientDraftNote(post({ page: '', body: 'x' }), SITE, PRINCIPAL, APPROVAL, {})).status === 429);
  installFetch({ snapSite: OTHER_SITE });
  ok('note: never on someone else’s draft (404)', (await D.handleClientDraftNote(post({ page: '', body: 'x' }), SITE, PRINCIPAL, APPROVAL, {})).status === 404);
}

// ═══ the studio's ask captures the client's draft ═══
{
  const STUDIO = { kind: 'client', userId: 'u-studio', email: 'studio@example.com' };
  installFetch({ noLink: true });
  let w = await D.captureWebsiteDraft(AGENCY, PROJECT, STUDIO);
  ok('capture: a project with no client website says so (422)', !w.ok && w.status === 422 && w.error === 'no_website');
  installFetch({ site: { ...SITE, edition: 'monitor' } });
  w = await D.captureWebsiteDraft(AGENCY, PROJECT, STUDIO);
  ok('capture: a website on its own host has no draft here (422)', !w.ok && w.error === 'hosted_elsewhere');
  installFetch({ site: { ...SITE, status: 'archived' } });
  w = await D.captureWebsiteDraft(AGENCY, PROJECT, STUDIO);
  ok('capture: an archived website takes no new draft (409)', !w.ok && w.status === 409);
  const calls = installFetch({ site: SITE });
  w = await D.captureWebsiteDraft(AGENCY, PROJECT, STUDIO);
  const link = calls.find((c) => c.url.includes('presence_service_links'));
  ok('capture: the site comes from THIS project’s own link on THIS studio', !!link && link.url.includes(`agency_site_id=eq.${AGENCY}`) && link.url.includes(`project_id=eq.${PROJECT}`) && link.url.includes('status=eq.active'));
  const snapIns = calls.find((c) => c.method === 'POST' && c.url.includes('presence_snapshots'));
  ok('capture: the draft is captured as a snapshot of the client’s site', !!snapIns && snapIns.body.site_id === SITE.id);
}

restore();
const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
