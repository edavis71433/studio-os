// ── A deeper blog: categories, authors, a time to go live, photos in posts (builder list item 40) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/blog_40_test.mjs
// Part A: the pure rules in lib/blog.ts. Part B: the snapshot's post, unchanged for a post
// without the new fields. Part C: saving and scheduling through PATCH /posts. Part D: one
// post live on its own (lib/post_publish.ts) and the tick that sends scheduled posts out,
// through a fetch fake. Part E: the routes, the member gate, the migration and its pack.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const B = await import('../../supabase/functions/presence/lib/blog.ts');
const PHOTO = '11111111-2222-4333-8444-555555555555';
const PHOTO2 = '66666666-7777-4888-9999-aaaaaaaaaaaa';

// ═══ A. the pure rules ═══
{
  eq('A1: a category list keeps names, makes safe ids, drops repeats and blanks',
    B.normalizeCategories([{ name: '  News ' }, { id: 'recipes', name: 'Recipes' }, { name: 'news' }, { name: '' }, null, { id: 'BAD ID', name: 'Wine & Events!' }]),
    [{ id: 'news', name: 'News' }, { id: 'recipes', name: 'Recipes' }, { id: 'wine-events', name: 'Wine & Events!' }]);
  ok('A2: at most 30 categories, names capped at 40', B.normalizeCategories(Array.from({ length: 40 }, (_, i) => ({ name: 'Cat ' + i + 'x'.repeat(60) }))).length === 30
    && B.normalizeCategories([{ name: 'y'.repeat(90) }])[0].name.length === 40);
  const au = B.normalizeAuthors([{ name: 'Maria Lopez', bio: 'Owner and head chef', photo_media_id: PHOTO.toUpperCase() }, { name: 'Maria Lopez' }, { name: 'Sam', photo_media_id: 'not-a-uuid', bio: '' }, { name: '   ' }]);
  eq('A3: authors: ids unique even for the same name, a bio and a photo only when real', au, [
    { id: 'maria-lopez', name: 'Maria Lopez', bio: 'Owner and head chef', photo_media_id: PHOTO },
    { id: 'maria-lopez-2', name: 'Maria Lopez' }, { id: 'sam', name: 'Sam' }]);
  ok('A4: control characters never reach a name', B.normalizeAuthors([{ name: 'Sam\u0000\u0007 Ortiz' }])[0].name === 'Sam Ortiz');
  const body = `Intro line.\n\n![Our patio](media:${PHOTO})\n\nMore.\n![The kitchen](media:${PHOTO2} "Chef Ana plating")\n![again](media:${PHOTO})\n![nope](media:not-an-id)\ninline ![x](media:${PHOTO2}) stays text`;
  eq('A5: the photos a post shows, in order, each once', B.postImageIds(body), [PHOTO, PHOTO2]);
  const NOW = '2026-11-12T10:00:00.000Z';
  ok('A6: a time ahead can be scheduled', B.scheduleProblem('2026-11-18T17:00:00.000Z', NOW) === null);
  ok('A7: a past time, now, junk and more than a year away are each refused in a sentence',
    /passed/.test(B.scheduleProblem('2026-11-01T00:00:00.000Z', NOW)) && /passed/.test(B.scheduleProblem(NOW, NOW))
    && /Pick a day/.test(B.scheduleProblem('soon', NOW)) && /more than a year/.test(B.scheduleProblem('2028-01-01T00:00:00.000Z', NOW)));
  eq('A8: a summary is the one written, or the first lines as plain words',
    [B.postSummary({ excerpt: 'Five courses, one table.' }), B.postSummary({ body_md: `## Heading\n![p](media:${PHOTO})\nOur **patio** opens [Friday](https://x.example).\nWith heaters.\n\nSecond paragraph.` })],
    ['Five courses, one table.', 'Our patio opens Friday. With heaters.']);
  ok('A9: a long summary ends on a whole word', /…$/.test(B.postSummary({ body_md: 'word '.repeat(80) }, 50)) && B.postSummary({ body_md: 'word '.repeat(80) }, 50).length <= 50);
  const mail = B.postEmailDraft({ title: 'Summer patio is open', excerpt: 'Our patio opens Friday.', hero_media_id: PHOTO }, 'https://marlows.example/updates/summer-patio/', 'The patio [at night]');
  eq('A10: the email a post becomes: title, cover, summary, then the link on its own line', mail,
    { subject: 'Summer patio is open', body: `![The patio at night](media:${PHOTO})\n\nOur patio opens Friday.\n\n[Read the whole post](https://marlows.example/updates/summer-patio/)` });
  ok('A11: with no cover there is no photo line', !B.postEmailDraft({ title: 'T', body_md: 'Hi.' }, 'https://x.example/updates/t/').body.includes('media:'));
  const refs = { [PHOTO]: { alt: 'stored alt', variants: { w800: '/img/a-800.webp' } } };
  const fig = (m, alt, cap) => `<figure><img src="${m.variants.w800}" alt="${alt}">${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
  const html = B.renderPostBody(`Hello <b>you</b>\n\n![A <patio>](media:${PHOTO} "Chef & co")\n\n![gone](media:${PHOTO2})\nBye`, refs, (m, alt, cap) => fig(m, alt.replace(/</g, '&lt;').replace(/>/g, '&gt;'), cap.replace(/&/g, '&amp;')));
  ok('A12: text stays escaped markdown around a photo', html.startsWith('<p>Hello &lt;b&gt;you&lt;/b&gt;</p>') && html.endsWith('<p>Bye</p>'));
  ok('A13: a photo line becomes the template’s figure, with its caption', html.includes('<figure><img src="/img/a-800.webp" alt="A &lt;patio&gt;"><figcaption>Chef &amp; co</figcaption></figure>'));
  ok('A14: a photo no longer in the library draws nothing', !html.includes('gone') && !html.includes(PHOTO2));
  const posts = [{ id: 'a', category: { id: 'news', name: 'News' } }, { id: 'b' }, { id: 'c', category: { id: 'events', name: 'Events' } }, { id: 'd', category: { id: 'news', name: 'News' } }];
  eq('A15: the categories with posts, each with its posts', B.categoriesWithPosts(posts).map((c) => [c.id, c.posts.map((p) => p.id)]), [['news', ['a', 'd']], ['events', ['c']]]);
  ok('A16: the photo line is the one Send an update reads, with an optional caption',
    B.POST_IMAGE_LINE_RE.test(`![x](media:${PHOTO})`) && B.POST_IMAGE_LINE_RE.test(`![x](media:${PHOTO} "a caption")`) && !B.POST_IMAGE_LINE_RE.test(`![x](https://evil.example/a.png)`));
}

// ═══ B. the snapshot's post ═══
{
  const { postEntry, blogListsOf, mediaResolver } = await import('../../supabase/functions/presence/lib/serializer.ts');
  const manifest = JSON.parse(read('supabase/functions/presence/templates/aurora/1.0.0/manifest.json'));
  const media = [{ id: PHOTO, storage_path: 'presence-media/s/a.jpg', alt_text: 'Patio', mime: 'image/jpeg', width: 1600, height: 900 }, { id: PHOTO2, storage_path: 'presence-media/s/b.jpg', alt_text: 'Kitchen', mime: 'image/jpeg', width: 1600, height: 900 }];
  const plain = { id: 'p1', title: 'Hello', slug: 'hello', body_md: 'Hi.', excerpt: '', hero_media_id: null, published_at: '2026-06-01T10:00:00Z', noindex: false, tags: [] };
  const { ref } = mediaResolver(media, manifest);
  const old = { id: 'p1', title: 'Hello', slug: 'hello', body_md: 'Hi.', excerpt: '', hero: null, published_at: '2026-06-01T10:00:00Z', noindex: false, tags: [] };
  eq('B1: a post without a category, author or photos serializes exactly as before', postEntry(plain, blogListsOf({}), ref), old);
  const lists = blogListsOf({ post_categories: [{ id: 'events', name: 'Events' }], post_authors: [{ id: 'sam', name: 'Sam Ortiz', bio: 'Sommelier', photo_media_id: PHOTO2 }] });
  const e = postEntry({ ...plain, category: 'events', author: 'sam', body_md: `Hi.\n![Patio](media:${PHOTO})` }, lists, ref);
  ok('B2: a post’s category and author arrive resolved, after the old fields', JSON.stringify(Object.keys(e)) === JSON.stringify([...Object.keys(old), 'category', 'author', 'images']) && e.category.name === 'Events' && e.author.name === 'Sam Ortiz' && e.author.bio === 'Sommelier');
  ok('B3: the author’s photo and the photos in the text become refs with variants', !!e.author.photo?.variants?.w400 && !!e.images[PHOTO]?.variants?.w800);
  const r2 = mediaResolver(media, manifest);
  postEntry({ ...plain, category: 'gone', author: 'nobody', body_md: `![x](media:${PHOTO})` }, lists, r2.ref);
  ok('B4: an id no longer on the lists is left off; the manifest names only the photos used', JSON.stringify(Object.keys(postEntry({ ...plain, category: 'gone' }, lists, ref))) === JSON.stringify(Object.keys(old)) && r2.used().map((m) => m.media_id).join() === PHOTO);
  const ser = read('supabase/functions/presence/lib/serializer.ts');
  ok('B5: the draft’s serializer and a post published alone use the one shape', /posts: posts\.map\(\(p: any\) => postEntry\(p, blogListsOf\(settings\), ref\)\)/.test(ser) && read('supabase/functions/presence/lib/post_publish.ts').includes('postEntry(p, pieces.lists, ref)'));
}

// ═══ C. saving and scheduling a post ═══
const calls = [];
let world = {};
const realFetch = globalThis.fetch;
const res = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ method, url, body: init.body ? JSON.parse(init.body) : null });
  const q = new URL(url), table = q.pathname.split('/').pop();
  const handler = world[`${method} ${table}`];
  if (handler) return handler(q, init.body ? JSON.parse(init.body) : null);
  return res([]);
};
{
  const { handleCollection } = await import('../../supabase/functions/presence/routes/content.ts');
  const site = { id: '00000000-0000-4000-8000-000000000001', client_id: '00000000-0000-4000-8000-000000000002', status: 'live' };
  const principal = { kind: 'owner', userId: 'u1', tenantId: null, role: null, email: 'o@example.com', jwt: 'j', requestId: 'r' };
  const POST_ID = '00000000-0000-4000-8000-0000000000a1';
  let dbCalls = [], current = { status: 'draft', published_at: null }, noBlogCols = false;
  const db = async (path, init = {}) => {
    dbCalls.push({ path, method: (init.method || 'GET').toUpperCase(), body: init.body ? JSON.parse(init.body) : null });
    if (noBlogCols && path.includes('category,author')) return { ok: false, status: 400, json: { code: '42703', message: 'column presence_posts.category does not exist' } };
    const body = init.body ? JSON.parse(init.body) : {};
    return { ok: true, status: 200, json: [{ id: POST_ID, ...body }] };
  };
  world = { 'GET presence_posts': () => res([current]) };
  const call = async (method, body, id = POST_ID) => {
    dbCalls = [];
    const req = new Request('https://x.example/posts' + (id ? '/' + id : ''), { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
    const r = await handleCollection(req, db, site, principal, 'posts', id, {});
    return { status: r.status, body: await r.json() };
  };
  const later = new Date(Date.now() + 3 * 86400_000).toISOString();
  let r = await call('PATCH', { status: 'scheduled', published_at: later });
  ok('C1: a post can be scheduled for a time ahead', r.status === 200 && dbCalls.at(-1).body.status === 'scheduled' && dbCalls.at(-1).body.published_at === later, JSON.stringify(r.body));
  r = await call('PATCH', { status: 'scheduled', published_at: '2020-01-01T00:00:00Z' });
  ok('C2: a time that has passed is refused in a sentence, nothing written', r.status === 422 && /passed/.test(r.body.message) && dbCalls.length === 0);
  current = { status: 'draft', published_at: null };
  r = await call('PATCH', { status: 'scheduled' });
  ok('C3: scheduling with no time at all is refused', r.status === 422 && /Pick a day/.test(r.body.message));
  current = { status: 'scheduled', published_at: later };
  r = await call('PATCH', { status: 'scheduled', title: 'New title' });
  ok('C4: a scheduled post keeps its time when only its words change', r.status === 200 && !('published_at' in dbCalls.at(-1).body));
  r = await call('PATCH', { status: 'draft' });
  ok('C5: taking a scheduled post back to a draft forgets its time', r.status === 200 && dbCalls.at(-1).body.published_at === null);
  current = { status: 'published', published_at: '2026-06-01T10:00:00Z' };
  r = await call('PATCH', { status: 'draft' });
  ok('C6: a published post made a draft keeps its date', r.status === 200 && !('published_at' in dbCalls.at(-1).body));
  r = await call('PATCH', { status: 'live-ish' });
  ok('C7: an unknown status is refused, not stored', r.status === 422 && dbCalls.length === 0);
  r = await call('PATCH', { category: 'Events', author: 'sam' });
  ok('C8: a category and an author are saved by id', r.status === 200 && dbCalls.at(-1).body.category === 'events' && dbCalls.at(-1).body.author === 'sam');
  r = await call('PATCH', { category: '../etc' });
  ok('C9: an id that isn’t one is refused', r.status === 422);
  r = await call('POST', { title: 'Wine dinner', status: 'scheduled', published_at: later }, null);
  ok('C10: a new post can start scheduled', r.status === 201 && dbCalls.at(-1).body.status === 'scheduled' && dbCalls.at(-1).body.slug === 'wine-dinner');
  noBlogCols = true;
  r = await call('GET', null, null);
  noBlogCols = false;
  ok('C11: before APPLY-0181 the list is read again without the new columns', r.status === 200 && dbCalls.length === 2 && !dbCalls[1].path.includes('category'));
}

// ═══ D. one post live on its own, and the scheduled ones on time ═══
{
  const [P1, P2, P3, P4] = ['00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b4'];
  const { runDuePosts, groupDue } = await import('../../supabase/functions/presence/ops/scheduled_posts.ts');
  const { mergePosts, mergeManifest } = await import('../../supabase/functions/presence/lib/post_publish.ts');
  eq('D1: posts merge newest first; an updated post replaces its old copy; one taken off goes',
    mergePosts([{ id: 'a', published_at: '2026-01-01' }, { id: 'b', published_at: '2026-03-01' }, { id: 'c', published_at: '2026-02-01' }], [{ id: 'a', published_at: '2026-04-01', title: 'new' }], ['c']).map((p) => p.id + (p.title || '')),
    ['anew', 'b']);
  eq('D2: the manifest keeps each photo once', mergeManifest([{ media_id: 'X' }, { media_id: 'y' }], [{ media_id: 'x' }, { media_id: 'z' }]).map((m) => m.media_id), ['X', 'y', 'z']);
  eq('D3: due posts group by site', [...groupDue([{ id: '1', site_id: 's1' }, { id: '2', site_id: 's2' }, { id: '3', site_id: 's1' }, { id: '', site_id: 's3' }])].map(([s, ps]) => [s, ps.map((p) => p.id)]), [['s1', ['1', '3']], ['s2', ['2']]]);

  const SITES = {
    s1: { status: 'live', netlify_site_id: 'n1', live: true },                  // live: the post goes out now
    s2: { status: 'ready', netlify_site_id: 'n2', live: false },                // never published: the post waits for the first publish
    s3: { status: 'live', netlify_site_id: 'n3', live: true, inflight: true },  // a publish on its way: left for the next tick
    s4: { status: 'live', netlify_site_id: 'n4', live: true, offline: true },   // behind its offline page: stays there
  };
  const DUE = [{ id: P1, site_id: 's1', title: 'Wine dinner' }, { id: P2, site_id: 's2', title: 'Hello' }, { id: P3, site_id: 's3', title: 'Busy' }, { id: P4, site_id: 's4', title: 'Quiet' }];
  let claimed = [];
  const LIVE_CONTENT = { identity: { business_name: 'Marlow’s Kitchen' }, settings: {}, posts: [{ id: 'old', title: 'Old', slug: 'old', published_at: '2026-01-01T00:00:00Z' }] };
  world = {
    'GET presence_posts': (q) => {
      if (q.searchParams.get('status') === 'eq.scheduled') return res(DUE);
      return res([{ id: P1, site_id: 's1', title: 'Wine dinner', slug: 'wine-dinner', body_md: `Five courses.\n![Table](media:${PHOTO})`, excerpt: '', hero_media_id: PHOTO2, status: 'published', published_at: '2026-11-18T17:00:00Z', noindex: false, tags: [], category: 'events', author: 'sam' }]);
    },
    'PATCH presence_posts': (q, body) => { const ids = q.searchParams.get('id').replace(/^in\.\(|\)$/g, '').split(','); claimed.push(...ids); return res(ids.map((id) => ({ id, title: DUE.find((d) => d.id === id)?.title, ...body }))); },
    'GET presence_sites': (q) => { const id = q.searchParams.get('id').replace('eq.', ''); const s = SITES[id]; if (q.searchParams.get('select') === 'offline_at') return res([{ offline_at: s.offline ? '2026-11-01T00:00:00Z' : null }]); return res([{ id, client_id: 'c', status: s.status, netlify_site_id: s.netlify_site_id, template_slug: 'aurora', template_version: '1.0.0', last_published_at: null }]); },
    'GET presence_publishes': (q) => { const id = q.searchParams.get('site_id').replace('eq.', ''); const s = SITES[id]; if (q.searchParams.get('status') === 'eq.live') return res(s.live ? [{ snapshot_id: 'snap-' + id }] : []); return res(s.inflight ? [{ id: 'busy' }] : []); },
    'GET presence_snapshots': () => res([{ content: LIVE_CONTENT, media_manifest: [{ media_id: 'old-photo', storage_path: 'x', variants: [] }], content_contract_version: 1, template_slug: 'aurora', template_version: '1.0.0', dev_customization: null, draft_settings: { blocks: [] } }]),
    'GET presence_settings': () => res([{ post_categories: [{ id: 'events', name: 'Events' }], post_authors: [{ id: 'sam', name: 'Sam Ortiz' }] }]),
    'GET presence_media': () => res([{ id: PHOTO, storage_path: 'presence-media/s1/a.jpg', alt_text: 'Table', mime: 'image/jpeg', width: 1600, height: 900 }, { id: PHOTO2, storage_path: 'presence-media/s1/b.jpg', alt_text: 'Glasses', mime: 'image/jpeg', width: 1600, height: 900 }]),
  };
  const runs = [];
  const run = async (site, principal, kind, arg, summary) => { runs.push({ site: site.id, principal, kind, arg, summary }); return res({ data: { status: 'live' } }); };
  const out = await runDuePosts(25, { run });
  ok('D4: posts on a live site go out; the site busy publishing is left for the next tick', claimed.sort().join() === [P1, P2, P4].join() && !claimed.includes(P3));
  ok('D5: one publish, for the live site only', runs.length === 1 && runs[0].site === 's1' && runs[0].kind === 'publish' && runs[0].principal.kind === 'system');
  const posts = runs[0]?.arg.snapshot.content.posts || [];
  ok('D6: the live version keeps what it had and gains the post, newest first', posts.map((p) => p.id).join() === [P1, 'old'].join() && runs[0].arg.snapshot.content.identity.business_name === 'Marlow’s Kitchen');
  ok('D7: the post arrives with its category, author and photos resolved', posts[0].category?.name === 'Events' && posts[0].author?.name === 'Sam Ortiz' && !!posts[0].images?.[PHOTO] && !!posts[0].hero?.variants?.w1600);
  ok('D8: the manifest keeps the live photos and adds the post’s', runs[0]?.arg.mediaManifest.map((m) => m.media_id).sort().join() === ['old-photo', PHOTO, PHOTO2].sort().join());
  ok('D9: the live version’s own settings ride along for Versions', JSON.stringify(runs[0]?.arg.draftSettings) === JSON.stringify({ blocks: [] }));
  ok('D10: the summary names the post', /Scheduled blog post “Wine dinner” went live/.test(runs[0]?.summary || ''));
  ok('D11: the counts', out.ok && out.due === 4 && out.published === 3 && out.live_sites === 1 && out.waiting_sites === 1 && out.failures === 0, JSON.stringify(out));
  const claimCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/presence_posts?'));
  ok('D12: the claim takes only rows still scheduled, so two ticks can’t both send one', !!claimCall && claimCall.url.includes('status=eq.scheduled') && claimCall.body.status === 'published');
  // a failed deploy: counted, and the post stays published in the draft
  claimed = []; runs.length = 0;
  const failed = await runDuePosts(25, { run: async () => res({ error: 'publish_failed' }, 502) });
  ok('D13: a deploy that fails is a failure the tick reports', !failed.ok && failed.failures === 1 && (failed.errors || [])[0].startsWith('s1:'));
  world['GET presence_posts'] = () => res([]);
  const quiet = await runDuePosts(25, { run });
  ok('D14: nothing due, nothing read beyond the one question', quiet.ok && quiet.due === 0);
}

// ═══ E. routes, the member gate, the tick, the migration ═══
{
  const idx = read('supabase/functions/presence/index.ts');
  ok('E1: the three routes are wired', /posts\\\/\(\[0-9a-f-\]\{36\}\)\\\/\(publish\|unpublish\|email-draft\)\$/.test(idx) && idx.includes('handlePostPublish(site, principal, bm[1], cors)') && idx.includes('handlePostEmailDraft(site, bm[1], cors)'));
  const { memberWriteNeedFor } = await import('../../supabase/functions/presence/lib/site_roles.ts').then((m) => ({ memberWriteNeedFor: m.memberWriteNeed || m.memberWriteNeedFor || null }));
  const roles = read('supabase/functions/presence/lib/site_roles.ts');
  ok('E2: putting a post live or taking it off needs publish', /\['publish', \[[^\]]*`POST \/posts\/\$\{ID\}\/\(publish\|unpublish\)`/.test(roles));
  ok('E3: the blog’s lists are website content, so edit covers them', /'post_categories', 'post_authors'/.test(roles));
  void memberWriteNeedFor;
  const sys = read('supabase/functions/presence/routes/system.ts');
  ok('E4: the tick sends due posts before the other publishes, in both modes', /\['scheduled_posts', \(\) => runDuePosts\(limit \?\? 25\)\],[^\n]*\n\s*\['window_expiry'/.test(sys) && /await step\('scheduled_posts', \(\) => runDuePosts\(25\)\);[^\n]*\n\s*const windowExpiry/.test(sys));
  for (const [name, sql] of [['migration', read('supabase/migrations/0181_blog_categories_authors_schedule.sql')], ['pack', read('docs/presence/APPLY-0181-prod.sql')]]) {
    ok(`E5 ${name}: a post may be scheduled, and the check is re-added so it can run twice`, /drop constraint if exists presence_posts_status_check;/.test(sql) && /check \(status in \('draft','scheduled','published'\)\)/.test(sql));
    ok(`E6 ${name}: category, author and the two lists, empty by default`, /add column if not exists category text not null default ''/.test(sql) && /add column if not exists author text not null default ''/.test(sql) && /add column if not exists post_categories jsonb not null default '\[\]'::jsonb/.test(sql) && /add column if not exists post_authors jsonb not null default '\[\]'::jsonb/.test(sql));
    ok(`E7 ${name}: due posts are found by an index`, /create index if not exists presence_posts_due_idx[\s\S]*where status = 'scheduled' and deleted_at is null/.test(sql));
  }
  const media = read('supabase/functions/presence/lib/media.ts');
  ok('E8: a photo inside a post, or an author’s photo, can’t be deleted from Files', /body_md=like\.\*\$\{mediaId\}\*/.test(media) && /an author’s photo on your blog/.test(media));
  const dw = read('supabase/functions/presence/lib/draft_writer.ts');
  ok('E9: a restore brings a post’s category and author back', /\.\.\.\(p\.category \? \{ category: p\.category\.id \} : \{\}\)/.test(dw) && /\.\.\.\(p\.author \? \{ author: p\.author\.id \} : \{\}\)/.test(dw));
}

globalThis.fetch = realFetch;

// ═══ F. the live site: every template draws the list, a page per category and the post ═══
{
  const { fullFixture, TEMPLATES } = await import('./full_fixture.mjs');
  const { renderSnapshot } = await import('../../supabase/functions/presence/lib/render.ts');
  const SITE = { baseUrl: 'https://vermilionandvine.example' };
  for (const slug of TEMPLATES) {
    const files = await renderSnapshot(fullFixture(slug), SITE);
    const list = String(files['updates/index.html'] || ''), post = String(files['updates/winter-menu-2026/index.html'] || ''), cat = String(files['updates/category/events/index.html'] || '');
    ok(`F1 ${slug}: the list has All and each category as links, the current one marked`, /<nav class="post-cats" aria-label="Categories"><a href="\/updates\/" aria-current="page">All<\/a><a href="\/updates\/category\/events\/">Events<\/a><a href="\/updates\/category\/news\/">News<\/a><\/nav>/.test(list) || /<nav class="post-cats" aria-label="Categories"><a href="\/updates\/" aria-current="page">All<\/a><a href="\/updates\/category\/news\/">News<\/a><a href="\/updates\/category\/events\/">Events<\/a><\/nav>/.test(list));
    ok(`F2 ${slug}: each post in the list says its category and who wrote it`, list.includes('<p class="post-kicker">Events</p>') && list.includes('By Sam Ortiz · <time'));
    ok(`F3 ${slug}: a category's page lists only its posts, and marks itself`, cat.includes('<h1>Events</h1>') && cat.includes('Wine dinner on the patio') && !cat.includes('Winter menu is live') && cat.includes('href="/updates/category/events/" aria-current="page"'));
    ok(`F4 ${slug}: the post: its category, byline, the photo in its text with its caption, and the author`, post.includes('<p class="post-kicker">News</p>') && post.includes('By Maria Lopez · <time') && /<figure class="post-fig">[\s\S]*?<figcaption>Before the doors open<\/figcaption><\/figure>/.test(post) && post.includes('<p class="post-author-name">Written by Maria Lopez</p>') && post.includes('More in News'));
    ok(`F5 ${slug}: Google is told it's a blog post by its author`, /"@type":"BlogPosting"/.test(post) && /"author":\{"@type":"Person","name":"Maria Lopez"\}/.test(post) && /"articleSection":"News"/.test(post));
    ok(`F6 ${slug}: the category pages are in the sitemap and the feed names the category`, String(files['sitemap.xml']).includes('/updates/category/news/</loc>') && /<category>News<\/category>/.test(String(files['feed.xml'])));
  }
  const fx = fullFixture('aurora');
  fx.content.settings.pages_noindex = ['updates'];
  const hidden = await renderSnapshot(fx, SITE);
  ok('F7: with Updates hidden from search, its category pages are too', /noindex/.test(String(hidden['updates/category/news/index.html'])) && !String(hidden['sitemap.xml']).includes('/updates/category/'));
  const plain = fullFixture('aurora');
  plain.content.posts = plain.content.posts.map(({ category, author, images, ...rest }) => rest);
  const pf = await renderSnapshot(plain, SITE);
  ok('F8: posts without categories draw no category links and no category pages', !String(pf['updates/index.html']).includes('post-cats') && !Object.keys(pf).some((k) => k.startsWith('updates/category/')));
  ok('F9: the post styles ship with every template', String(Object.entries(pf).find(([k]) => /^assets\/site-.*\.css$/.test(k))?.[1] || '').includes('.post-row{display:grid'));
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
