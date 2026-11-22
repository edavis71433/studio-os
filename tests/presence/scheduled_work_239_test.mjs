// ── Scheduled work goes out, and every website change reaches the change log (builder item 239) ──
// Found Nov 15 by the Studio insights session. The scheduler signed as userId 'scheduler', the
// blog-post tick the same, and a one-tap approval as 'client-one-tap'. Those names land in uuid
// columns (presence_publishes.actor, presence_change_events.actor_user_id), which refuse them,
// so a scheduled publish answered record_failed and nothing went out. The in-memory database
// here refuses what the real one refuses: the uuid columns, and every check list as the newest
// migration names it. Then the whole thing runs for real, through the one publish pipeline and a
// stubbed host:
//   · the owner schedules a publish with the Schedule route; the tick sends it, live, recorded
//     as the scheduler's on behalf of the owner (actor = the owner, actor_kind 'system')
//   · a scheduled revert, a timed-section re-send (nobody set it) and a scheduled take-offline
//   · a scheduled blog post goes live by itself
//   · a one-tap approval and a "not yet" are kept as the client's, with no sign-in id
//   · the old names are refused (the bug, reproduced), and a refused change line is logged
//   · launch, preview and saved-section lines land; customer, contact and deal lines don't
//
//   deno run --allow-read --allow-env --allow-net tests/presence/scheduled_work_239_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';

Deno.env.set('NETLIFY_AUTH_TOKEN', 'nf-test');
Deno.env.set('APPROVAL_SECRET', 'one-tap-test-secret');
Deno.env.delete('RESEND_API_KEY');
Deno.env.delete('OPS_ALERT_EMAIL');
Deno.env.delete('AGENCY_SITE_ID');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const logged = [];
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = (...a) => logged.push(a.join(' ')); console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };

// ── the real database's rules, from the migrations: the newest definition of each check wins ──
const MIGS = [...Deno.readDirSync(new URL('supabase/migrations/', ROOT))].map((e) => e.name).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
const SQL = MIGS.map((n) => read('supabase/migrations/' + n));
const listOf = (name) => {
  let last = null;
  for (const sql of SQL) { const re = new RegExp(`add constraint ${name}\\s+check \\(\\w+ in\\s*\\(([^)]*)\\)\\)`, 'g'); let m; while ((m = re.exec(sql)) !== null) last = m[1]; }
  return last ? last.split(',').map((s) => s.trim().replace(/^'|'$/g, '')) : [];
};
const STRICT = {
  presence_publishes: { uuid: ['site_id', 'snapshot_id', 'actor'], check: { actor_kind: listOf('presence_publishes_actor_kind_check'), status: listOf('presence_publishes_status_check') } },
  presence_snapshots: { uuid: ['site_id', 'created_by'], check: { created_by_kind: listOf('presence_snapshots_created_by_kind_check') } },
  presence_change_events: { uuid: ['site_id', 'entity_id', 'actor_user_id'], check: { entity_type: listOf('presence_change_events_entity_type_check'), action: listOf('presence_change_events_action_check'), actor_kind: listOf('presence_change_events_actor_kind_check') } },
};
ok('the rules are read from the migrations (0018, 0133, 0229)', STRICT.presence_change_events.check.entity_type.includes('launch') && STRICT.presence_change_events.check.action.includes('approve') && STRICT.presence_publishes.check.actor_kind.includes('system') && STRICT.presence_publishes.check.status.includes('canceled'),
  JSON.stringify(STRICT.presence_change_events.check.entity_type));
const db = installFakePostgrest({ strict: STRICT });
const pg = globalThis.fetch;

const hex = (k, i) => `${k}${i.toString(16).padStart(7, '0')}-0000-4000-8000-000000000000`;
const SITE = hex('a', 1), OWNER_ID = hex('b', 9), LOC = hex('f', 1), LIB = hex('e', 1), POST = hex('d', 1), POST2 = hex('d', 2), PLAN = hex('c', 7), PLAN2 = hex('c', 8);
const MEDIA = [0, 1, 2, 3].map((i) => hex('9', i));
const OWNER = { kind: 'client', userId: OWNER_ID, email: 'owner@example.com', tenantId: null, role: null, jwt: null, requestId: 't' };

// ── the host and the photo store, stubbed ──
const sha1 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();
let nf;
const resetHost = () => { nf = { has: new Set(), deploys: [], live: null, nextId: 1 }; };
resetHost();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.netlify.com') {
    const p = u.pathname.replace('/api/v1', '');
    if (method === 'GET' && /^\/sites\/[^/]+$/.test(p)) return json({ id: 'nf1', name: 'presence-a', default_domain: 'presence-a.netlify.app', custom_domain: null, state: 'current', published_deploy: nf.live ? { id: nf.live } : null });
    if (method === 'POST' && /^\/sites\/[^/]+\/deploys$/.test(p)) {
      const b = JSON.parse(init.body);
      const id = `dep${nf.nextId++}`;
      const required = [...new Set(Object.values(b.files))].filter((d) => !nf.has.has(d));
      nf.deploys.push({ id, files: b.files, title: b.title });
      return json({ id, required });
    }
    if (method === 'PUT' && /^\/deploys\/[^/]+\/files\//.test(p)) { nf.has.add(await sha1(new Uint8Array(await new Response(init.body).arrayBuffer()))); return json({}); }
    if (method === 'GET' && /^\/deploys\/[^/]+$/.test(p)) { const id = p.split('/').pop(); nf.live = id; return json({ id, state: 'ready' }); }
    return json({}, 404);
  }
  if (u.pathname.startsWith('/storage/v1/render/image/') || u.pathname.startsWith('/storage/v1/object/authenticated/')) {
    return new Response(enc.encode(`img:${u.pathname}:${u.searchParams.get('width')}:${u.searchParams.get('format')}`), { status: 200 });
  }
  return pg(url, init);
};

const PUB = await import('../../supabase/functions/presence/routes/publish.ts');
const { handleScheduleCreate, handleApprovePost } = await import('../../supabase/functions/presence/routes/commercial.ts');
const { runDuePublishes } = await import('../../supabase/functions/presence/ops/scheduler.ts');
const { runDuePosts } = await import('../../supabase/functions/presence/ops/scheduled_posts.ts');
const { writeChangeEvent } = await import('../../supabase/functions/presence/lib/provenance.ts');
const { signApprovalToken } = await import('../../supabase/functions/presence/lib/commercial.ts');
const AK = await import('../../supabase/functions/presence/lib/actor_kind.ts');

const hours = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({ day, closed: day === 'sun', intervals: day === 'sun' ? [] : [{ open: '09:00', close: '17:00' }] }));
const SITE_ROW = { id: SITE, client_id: 'client-a', status: 'ready', last_published_at: null, template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: 'nf1', edition: 'presence' };
db.reset({
  presence_sites: [{ ...SITE_ROW }],
  presence_identity: [{ site_id: SITE, business_name: 'Sample Cafe', tagline: 'Good food', description: 'A neighbourhood cafe.', phone: '555-0100', email: '', story: '', service_area: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '' }],
  presence_locations: [{ id: LOC, site_id: SITE, address_line1: '1 Main St', city: 'Town', region: 'CA', postal_code: '90000', country: 'US', timezone: 'America/Los_Angeles', hours, holiday_exceptions: [], temporarily_closed: false, created_at: '2026-01-01T00:00:00Z' }],
  presence_offerings: [0, 1].map((i) => ({ id: hex('7', i), site_id: SITE, name: `Dish ${i}`, category: 'Mains', description: '', price_text: '$9', media_id: MEDIA[i], is_visible: true, sort_order: i, deleted_at: null, created_at: '2026-01-01T00:00:00Z' })),
  presence_testimonials: [], presence_faqs: [], presence_redirects: [], presence_dev_customizations: [], presence_reviews: [],
  presence_posts: [{ id: POST, site_id: SITE, title: 'News', slug: 'news', body_md: 'Hello', excerpt: '', hero_media_id: MEDIA[2], status: 'published', published_at: '2026-02-01T00:00:00Z', noindex: false, tags: [], deleted_at: null }],
  presence_media: MEDIA.map((id, i) => ({ id, site_id: SITE, storage_path: `presence-media/${SITE}/photo-${i}.jpg`, alt_text: `Photo ${i}`, mime: 'image/jpeg', width: 1600, height: 1000, focal_x: null, focal_y: null, deleted_at: null })),
  presence_settings: [{ site_id: SITE, category_order: [], nav: null, blocks: [{ type: 'image', title: 'Welcome', image_id: MEDIA[3] }, { type: 'linked', ref: LIB }], pages: [] }],
  presence_content_library: [{ id: LIB, site_id: SITE, name: 'Opening hours', kind: 'section', payload: { type: 'richtext', body: 'Open every day.' } }],
  presence_publishes: [], presence_snapshots: [], presence_change_events: [], presence_page_locks: [], presence_plan_notices: [],
  presence_scheduled_publishes: [], presence_infra_plans: [],
});
const site = () => ({ ...db.tables.presence_sites[0] });
const pubs = () => db.tables.presence_publishes;
const events = () => db.tables.presence_change_events;
const schedule = async (b) => quiet(async () => { const r = await handleScheduleCreate(new Request('http://x/schedule', { method: 'POST', body: JSON.stringify(b) }), site(), OWNER, {}); return { status: r.status, body: await r.json() }; });
// the time comes: the row as the database keeps it (its defaults: pending, not fired, no error)
const due = (id) => {
  const row = db.tables.presence_scheduled_publishes.find((r) => r.id === id);
  if (!row) return null;
  Object.assign(row, { status: row.status ?? 'pending', fired_at: row.fired_at ?? null, last_error: row.last_error ?? '', scheduled_for: new Date(Date.now() - 60_000).toISOString() });
  return row;
};
const soon = () => new Date(Date.now() + 10 * 60_000).toISOString();

// ═══ 0. the helper the scheduler signs with ═══
{
  const p = AK.schedulerPrincipal('scheduled-publish', OWNER_ID.toUpperCase());
  ok('scheduler: a system hand, on behalf of whoever set it (an id the uuid columns take)', p.kind === 'system' && p.userId === OWNER_ID && p.requestId === 'scheduled-publish');
  ok('scheduler: nobody when the row names no sign-in (owner, a sweep, nothing)', [undefined, null, '', 'owner', 'scheduler:rewindow', 'scheduler'].every((x) => AK.schedulerPrincipal('x', x).userId === null));
  ok('the publish record says system for it; the room reads "published on schedule"', AK.changeActorKind(p) === 'system' && AK.lastPublishDetail('system') === 'published on schedule');
}

// ═══ 1. the first publish, by the owner, by hand ═══
const first = await quiet(async () => { const r = await PUB.handlePublish(null, site(), OWNER, {}); return { status: r.status, body: await r.json() }; });
ok('the owner’s own publish goes live, as before', first.status === 200 && first.body.data.status === 'live' && pubs()[0]?.actor === OWNER_ID && pubs()[0]?.actor_kind === 'client', JSON.stringify(first.body).slice(0, 200));
const firstPub = pubs()[0];
// the database stamps a kept version on the day it's written (the privacy page prints it)
for (const s of db.tables.presence_snapshots) s.created_at = new Date().toISOString();

// ═══ 2. the bug, reproduced: the old name is refused, so nothing goes out ═══
{
  const snap = db.tables.presence_snapshots[0];
  const old = await quiet(() => PUB.runPipeline(site(), { kind: 'system', userId: 'scheduler', tenantId: null, role: null, email: null, jwt: null, requestId: 'scheduled-publish' }, 'publish', { snapshot: { content: snap.content, content_contract_version: snap.content_contract_version, template_slug: snap.template_slug, template_version: snap.template_version, created_at: snap.created_at }, snapshotId: snap.id, mediaManifest: snap.media_manifest || [] }, 'Scheduled publish', {}));
  ok('the old name: the publish record is refused (record_failed), as it would have been on production', old.status === 502 && (await old.json()).error === 'record_failed' && pubs().length === 1);
  logged.length = 0;
  const said = await quiet(() => writeChangeEvent({ siteId: SITE, entityType: 'settings', entityId: null, action: 'update', summary: 'Approved the plan (one-tap): Connect the domain', principal: { kind: 'system', userId: 'client-one-tap', tenantId: null, role: 'client', email: null, jwt: null, requestId: 'approve-token' } }));
  const line = logged.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((x) => x?.evt === 'change_event_refused');
  ok('a refused change line no longer vanishes: false, and the log says what and why', said === false && !!line && line.entity_type === 'settings' && line.action === 'update' && line.status === 400 && line.code === '22P02' && /uuid/.test(line.reason), JSON.stringify(line));
  ok('…without the summary or the failing row (they can name a customer)', !!line && !JSON.stringify(line).includes('Connect the domain') && !JSON.stringify(line).includes('Failing row'));
}

// ═══ 3. a scheduled publish, set by the owner, sent by the tick ═══
{
  db.tables.presence_identity[0].tagline = 'Fresh bread from 7';   // a change in the draft, frozen when scheduled
  const made = await schedule({ kind: 'publish', scheduled_for: soon() });
  const row = made.body?.data?.id ? due(made.body.data.id) : null;
  ok('schedule: the route keeps who set it', made.status === 200 && row?.created_by === OWNER_ID && row?.status === 'pending', JSON.stringify(made.body).slice(0, 160));
  const deploys = nf.deploys.length;
  const cyc = await quiet(() => runDuePublishes());
  const rec = pubs()[pubs().length - 1];
  ok('tick: the publish goes out and the row is done', cyc.ok === true && cyc.ran === 1 && cyc.failures === 0 && row.status === 'done' && row.last_error === '', JSON.stringify(cyc.results));
  ok('tick: live on the host, with the change in it', rec.status === 'live' && nf.deploys.length === deploys + 1 && rec.snapshot_id === row.snapshot_id);
  ok('history: recorded as the scheduler’s, on behalf of the owner who set it', rec.actor === OWNER_ID && rec.actor_kind === 'system' && rec.change_summary === 'Scheduled publish');
  const ev = events().filter((e) => e.entity_type === 'publish' && e.action === 'publish').pop();
  ok('history: the change log keeps it too, under the same hand', !!ev && ev.actor_user_id === OWNER_ID && ev.actor_kind === 'system');
  ok('the site counts as just published', !!db.tables.presence_sites[0].last_published_at && db.tables.presence_sites[0].status === 'live');
}

// ═══ 4. a scheduled revert, and a timed section's re-send that nobody set ═══
{
  const made = await schedule({ kind: 'revert', publish_id: firstPub.id, scheduled_for: soon() });
  const row = made.body?.data?.id ? due(made.body.data.id) : null;
  const cyc = await quiet(() => runDuePublishes());
  const rec = pubs()[pubs().length - 1];
  ok('revert: goes out as a restore of the chosen version, as the owner’s schedule', !!row && cyc.ran === 1 && cyc.failures === 0 && row.status === 'done' && rec.kind === 'restore' && rec.status === 'live' && rec.snapshot_id === firstPub.snapshot_id && rec.actor === OWNER_ID && rec.actor_kind === 'system', JSON.stringify(cyc.results));

  const live = pubs().filter((p) => p.status === 'live').pop();
  db.tables.presence_scheduled_publishes.push({ id: crypto.randomUUID(), site_id: SITE, snapshot_id: live.snapshot_id, kind: 'publish', scheduled_for: new Date(Date.now() - 60_000).toISOString(), status: 'pending', summary: 'A timed section went live or came down', created_by: 'scheduler:rewindow', fired_at: null, last_error: '' });
  const n = pubs().length;
  const sweep = await quiet(() => runDuePublishes());
  const rw = pubs()[pubs().length - 1];
  ok('timed section: the re-send goes out, with nobody named (Studio OS by itself)', sweep.ran === 1 && sweep.failures === 0 && pubs().length === n + 1 && rw.status === 'live' && rw.actor === null && rw.actor_kind === 'system', JSON.stringify(sweep.results));
}

// ═══ 5. a scheduled blog post goes out by itself ═══
{
  db.tables.presence_posts.push({ id: POST2, site_id: SITE, title: 'Winter hours', slug: 'winter-hours', body_md: 'Open late on Fridays.', excerpt: '', hero_media_id: null, status: 'scheduled', published_at: new Date(Date.now() - 60_000).toISOString(), noindex: false, tags: [], deleted_at: null });
  const n = pubs().length;
  const out = await quiet(() => runDuePosts(25));
  const rec = pubs()[pubs().length - 1];
  const post = db.tables.presence_posts.find((p) => p.id === POST2);
  ok('post: claimed and put live in one publish', out.ok === true && out.published === 1 && out.live_sites === 1 && out.failures === 0 && post.status === 'published', JSON.stringify(out));
  ok('post: the publish record is the scheduler’s (nobody pressed anything), and live', pubs().length === n + 1 && rec.status === 'live' && rec.actor === null && rec.actor_kind === 'system' && /^Scheduled blog post “Winter hours” went live$/.test(rec.change_summary), rec.change_summary);
  const snap = db.tables.presence_snapshots.find((s) => s.id === rec.snapshot_id);
  ok('post: its kept version is the scheduler’s too', !!snap && snap.created_by === null && snap.created_by_kind === 'system');
  ok('post: the change log says it went out', events().some((e) => e.entity_type === 'post' && e.entity_id === POST2 && e.summary === 'A scheduled blog post went out' && e.actor_user_id === null && e.actor_kind === 'system'));
}

// ═══ 6. a scheduled take-offline ═══
{
  const made = await schedule({ kind: 'offline', scheduled_for: soon() });
  const row = made.body?.data?.id ? due(made.body.data.id) : null;
  const cyc = await quiet(() => runDuePublishes());
  const ev = events().filter((e) => e.entity_type === 'site').pop();
  ok('offline: the site goes offline on time', !!row && cyc.ran === 1 && cyc.failures === 0 && row.status === 'done' && !!db.tables.presence_sites[0].offline_at, JSON.stringify(cyc.results));
  ok('offline: the change log says so, on schedule, as the owner’s', !!ev && /^Took the website offline on schedule — /.test(ev.summary) && ev.actor_user_id === OWNER_ID && ev.actor_kind === 'system');
}

// ═══ 7. one-tap approvals: the client's decision, no sign-in id ═══
{
  db.tables.presence_infra_plans.push({ id: PLAN, site_id: SITE, kind: 'connect_domain', status: 'proposed', title: 'Connect the domain', summary: 'Point the domain at the site.' });
  db.tables.presence_infra_plans.push({ id: PLAN2, site_id: SITE, kind: 'connect_domain', status: 'proposed', title: 'Turn on email', summary: 'Set up email.' });
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tap = async (plan, decision, note) => quiet(async () => {
    const token = await signApprovalToken({ site_id: SITE, kind: 'infrastructure', plan_id: plan, exp }, 'one-tap-test-secret');
    const r = await handleApprovePost(new Request('http://x/approve', { method: 'POST', body: JSON.stringify({ token, decision, note }) }), {});
    return { status: r.status, body: await r.json() };
  });
  const yes = await tap(PLAN, 'approve');
  const ev = events().find((e) => e.summary === 'Approved the plan (one-tap): Connect the domain');
  ok('one-tap approve: decided, and kept in the change log', yes.status === 200 && db.tables.presence_infra_plans[0].status === 'approved' && !!ev, JSON.stringify(yes.body));
  ok('one-tap approve: as the client’s hand with no sign-in id', !!ev && ev.actor_user_id === null && ev.actor_kind === 'client');
  const no = await tap(PLAN2, 'reject', 'Wait until January');
  ok('one-tap not yet: the plan and the note are both kept', no.status === 200 && events().some((e) => e.summary === 'Set aside the plan (one-tap): Turn on email') && events().some((e) => e.summary === 'Not yet on “Turn on email”: Wait until January' && e.actor_kind === 'client'));
}

// ═══ 8. the kinds the log takes now, and the ones it doesn't ═══
{
  const say = (entityType, action) => quiet(() => writeChangeEvent({ siteId: SITE, entityType, entityId: entityType === 'preview' ? null : crypto.randomUUID(), action, summary: `${entityType} ${action}`, principal: OWNER }));
  const landed = [];
  for (const [t, a] of [['launch', 'create'], ['launch', 'approve'], ['launch', 'reject'], ['launch', 'schedule'], ['launch', 'update'], ['launch', 'publish'], ['launch', 'restore'], ['preview', 'update'], ['preview', 'publish'], ['content_library', 'create'], ['content_library', 'update'], ['content_library', 'delete']]) {
    if (await say(t, a)) landed.push(`${t}/${a}`);
  }
  ok('lands: a launch’s steps, the preview’s link and saved sections (0229)', landed.length === 12, landed.join(' '));
  logged.length = 0;
  const refused = [];
  for (const [t, a] of [['client', 'create'], ['contact', 'connect_pending'], ['deal', 'convert']]) if (!(await say(t, a))) refused.push(t);
  ok('refused, and logged: customer, contact and deal lines (no change to a website)', refused.length === 3 && logged.filter((l) => l.includes('change_event_refused')).length === 3);
}

// ═══ 8. builder item 249: a publish set for later never puts an older site back ═══
{
  const { SKIPPED_NEWER_LIVE } = await import('../../supabase/functions/presence/ops/scheduler.ts');
  db.tables.presence_identity[0].tagline = 'Holiday hours from the 20th';   // frozen into the scheduled copy
  const made = await schedule({ kind: 'publish', scheduled_for: soon(), note: 'Holiday hours' });
  const row = made.body?.data?.id ? due(made.body.data.id) : null;
  ok('249: scheduled, with the draft frozen as it stood', made.status === 200 && !!row && row.status === 'pending', JSON.stringify(made.body).slice(0, 160));
  row.created_at = pubs().at(-1).created_at;   // made after the last publish, on the database's own clock
  // then a newer change goes live by hand, before the date
  db.tables.presence_identity[0].tagline = 'Open late on Fridays';
  const hand = await quiet(async () => { const r = await PUB.handlePublish(null, site(), OWNER, {}); return { status: r.status, body: await r.json() }; });
  ok('249: a publish by hand goes live in the meantime', hand.status === 200 && hand.body.data.status === 'live', JSON.stringify(hand.body).slice(0, 160));
  const deploys = nf.deploys.length, n = pubs().length;
  const cyc = await quiet(() => runDuePublishes());
  ok('249: at the set time the older copy is NOT sent: no deploy, no publish record', cyc.ok === true && cyc.failures === 0 && nf.deploys.length === deploys && pubs().length === n, JSON.stringify(cyc.results));
  ok('249: the row is set aside and says why', row.status === 'canceled' && row.last_error === SKIPPED_NEWER_LIVE, JSON.stringify(row));
  const notice = db.tables.presence_plan_notices.find((x) => x.period === `sched:${row.id}`);
  ok('249: whoever scheduled it is told, once', !!notice && notice.kind === 'publish_failed' && notice.headline === 'A scheduled publish was set aside' && /newer version of your site went live/.test(notice.body), JSON.stringify(notice));
  // a second tick finds nothing to do with it
  const again = await quiet(() => runDuePublishes());
  ok('249: …and it isn’t looked at again', again.ran === 0 && row.status === 'canceled');
  // a scheduled revert is meant to bring an older version back: it still goes
  const rv = await schedule({ kind: 'revert', scheduled_for: soon(), publish_id: firstPub.id });
  const rrow = rv.body?.data?.id ? due(rv.body.data.id) : null;
  if (rrow) rrow.created_at = pubs().at(-1).created_at;
  const rc = await quiet(() => runDuePublishes());
  ok('249: a scheduled return to an earlier version still goes (it is older on purpose)', !!rrow && rc.ran === 1 && rc.failures === 0 && rrow.status === 'done', JSON.stringify(rc.results));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
