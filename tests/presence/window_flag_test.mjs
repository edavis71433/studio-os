// ── The timed-section sweep reads only the sites that need it (list item 90) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/window_flag_test.mjs
// Every 15 minutes runWindowExpiries read every live site's publish and whole snapshot
// to find the few with a timed section. Each site now carries next_window_at (migration
// 0142): the next instant one of its sections appears or comes down. This drives the
// sweep through a fetch fake and checks what it reads, writes and queues, the fallback
// before the migration, the custom pages it used to miss, and the publish paths that
// reset the flag.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const { windowedBlocks, nextWindowBoundary, blocksNeedRewindow } = await import('../../supabase/functions/presence/lib/content_window.ts');

// ═══ PART A — the pure helpers ═══
{
  const home = [{ type: 'cta', show_until: '2026-07-20T00:00:00.000Z' }];
  const pages = [{ slug: 'menu', blocks: [{ type: 'features', show_from: '2026-07-18T00:00:00.000Z' }] }, { slug: 'empty' }, null];
  const all = windowedBlocks({ blocks: home, pages });
  ok('A1: sections from the home page and every page of the owner’s own', all.length === 2 && all[1].type === 'features');
  ok('A2: settings without blocks or pages → none', windowedBlocks({}).length === 0 && windowedBlocks(null).length === 0 && windowedBlocks('junk').length === 0);
  const NOW = '2026-07-10T00:00:00.000Z';
  const blocks = [
    { type: 'a', show_from: '2026-07-01T00:00:00.000Z', show_until: '2026-07-31T23:59:59.999Z' },
    { type: 'b', show_from: '2026-07-15T00:00:00.000Z' },
    { type: 'c' },
    { type: 'd', show_from: '2026-07-12T00:00:00.000Z', show_until: '2026-07-11T00:00:00.000Z' },   // starts after it ends: never shows
  ];
  ok('A3: the soonest future instant across every section', nextWindowBoundary(blocks, NOW) === '2026-07-15T00:00:00.000Z');
  ok('A4: past instants don’t count', nextWindowBoundary(blocks, '2026-07-16T00:00:00.000Z') === '2026-07-31T23:59:59.999Z');
  ok('A5: an instant equal to now has already happened', nextWindowBoundary([{ show_from: NOW }], NOW) === null);
  ok('A6: a window that never shows has no instant', nextWindowBoundary([blocks[3]], NOW) === null);
  ok('A7: no timed sections, or junk → null', nextWindowBoundary([{ type: 'c' }], NOW) === null && nextWindowBoundary(null, NOW) === null);
}

// ═══ PART B — the sweep, through a fetch fake ═══
const { runWindowExpiries } = await import('../../supabase/functions/presence/ops/scheduler.ts');
const LIVE_AT = '2026-01-01T00:00:00.000Z';                         // when every site's live bytes were rendered
const PAST = '2026-02-01T00:00:00.000Z';                            // a boundary between then and now
const FUTURE = '2099-01-01T00:00:00.000Z';
const SITES = {
  s1: { content: { settings: { blocks: [{ type: 'features' }] } } },                                   // nothing timed
  s2: { content: { settings: { blocks: [{ type: 'cta', show_from: FUTURE }] } } },                    // timed, later
  s3: { content: { settings: { blocks: [{ type: 'cta', show_until: PAST }] } } },                     // came down since
  s4: { content: { settings: { blocks: [], pages: [{ slug: 'menu', blocks: [{ type: 'cta', show_from: PAST }] }] } } },   // a custom page's
  s5: { content: { settings: { blocks: [{ type: 'cta', show_until: PAST }] } }, inflight: true },     // due, but a publish is on its way
  s6: { nolive: true },                                                                                // nothing live
};
let calls = [], patches = [], posts = [], noColumn = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method || 'GET').toUpperCase();
  calls.push(`${method} ${url}`);
  const res = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
  const q = new URL(url), table = q.pathname.split('/').pop();
  if (table === 'presence_sites' && method === 'GET') {
    if (q.searchParams.get('or')?.includes('next_window_at') && noColumn) return res({ code: '42703', message: 'column presence_sites.next_window_at does not exist' }, 400);
    return res(Object.keys(SITES).map((id) => ({ id })));
  }
  if (table === 'presence_sites' && method === 'PATCH') { patches.push({ id: q.searchParams.get('id').replace('eq.', ''), body: JSON.parse(init.body) }); return res([]); }
  if (table === 'presence_publishes') {
    const id = q.searchParams.get('site_id').replace('eq.', '');
    if (q.searchParams.get('status') === 'eq.live') return res(SITES[id].nolive ? [] : [{ snapshot_id: 'snap-' + id, created_at: LIVE_AT, completed_at: LIVE_AT }]);
    return res(SITES[id].inflight ? [{ id: 'p-busy' }] : []);
  }
  if (table === 'presence_snapshots') return res([{ content: SITES[q.searchParams.get('id').replace('eq.snap-', '')].content }]);
  if (table === 'presence_scheduled_publishes' && method === 'GET') return res([]);
  if (table === 'presence_scheduled_publishes' && method === 'POST') { posts.push(JSON.parse(init.body)); return res([{ id: 'sched-' + posts.length }]); }
  return res([]);
};
const sweep = async () => { calls = []; patches = []; posts = []; return runWindowExpiries(40); };

{
  const r = await sweep();
  const siteRead = calls.find((c) => c.startsWith('GET') && c.includes('/presence_sites?'));
  ok('B1: it asks only for live sites whose instant has come or isn’t known', !!siteRead && siteRead.includes('status=eq.live') && siteRead.includes('or=(next_window_at.is.null,next_window_at.lte.'));
  const flag = (id) => patches.filter((p) => p.id === id).map((p) => p.body.next_window_at);
  ok('B2: a site with nothing timed is marked never', JSON.stringify(flag('s1')) === '["infinity"]', JSON.stringify(flag('s1')));
  ok('B3: a site timed for later gets that instant', JSON.stringify(flag('s2')) === JSON.stringify([FUTURE]), JSON.stringify(flag('s2')));
  const queued = posts.map((p) => p.site_id).sort();
  ok('B4: a section that came down since the live publish is re-emitted', queued.includes('s3'));
  ok('B5: so is one on a custom page, which the sweep used to miss', queued.includes('s4'));
  ok('B6: a re-emit carries the marker the publisher reads', posts.every((p) => p.created_by === 'scheduler:rewindow' && p.kind === 'publish'));
  ok('B7: a site queued for a re-emit keeps its passed instant, so a failed re-emit is tried again', flag('s3').length === 0 && flag('s4').length === 0);
  ok('B8: a due site with a publish already on its way is left for the next tick, instant unchanged', !queued.includes('s5') && flag('s5').length === 0);
  ok('B9: a site with nothing live is marked never (its next publish resets it)', JSON.stringify(flag('s6')) === '["infinity"]');
  ok('B10: the count it reports', r.ok && r.scanned === 6 && r.enqueued === 2);
}
{
  noColumn = true;
  const r = await sweep();
  noColumn = false;
  const siteReads = calls.filter((c) => c.startsWith('GET') && c.includes('/presence_sites?'));
  ok('B11: before migration 0142 it reads every live site, as it did', siteReads.length === 2 && siteReads[1].includes('order=last_published_at.asc'));
  ok('B12: and writes no instant to a column that isn’t there', patches.length === 0);
  ok('B13: and still re-emits what’s due', r.enqueued === 2);
}
{
  // the old behaviour, pinned: the home page alone missed s4's section
  ok('B14: the custom page’s section is due by the same rule', blocksNeedRewindow(windowedBlocks(SITES.s4.content.settings), LIVE_AT, new Date().toISOString()) && !blocksNeedRewindow(SITES.s4.content.settings.blocks, LIVE_AT, new Date().toISOString()));
}
globalThis.fetch = realFetch;

// ═══ PART C — every live publish resets the instant; the migration ═══
{
  const pub = read('supabase/functions/presence/routes/publish.ts');
  const rec = read('supabase/functions/presence/lib/deploy_reconcile.ts');
  const reset = /PATCH', body: JSON\.stringify\(\{ next_window_at: null \}\) \}\)\.catch\(\(\) => \{\}\)/;
  ok('C1: a publish that goes live in the request resets it, in its own best-effort write', reset.test(pub) && /if \(live\) await svc\(`presence_sites\?id=eq\.\$\{site\.id\}`, \{ method: 'PATCH', body: JSON\.stringify\(\{ next_window_at: null \}\)/.test(pub));
  ok('C2: so does one that goes live later (the reconcile path)', reset.test(rec));
  ok('C3: the status write itself is unchanged, so a missing column can’t fail it', /JSON\.stringify\(\{ status: 'live', last_published_at: new Date\(\)\.toISOString\(\) \}\)/.test(pub) && /JSON\.stringify\(\{ status: 'live', last_published_at: nowIso \}\)/.test(rec));
  const mig = read('supabase/migrations/0142_next_window_at.sql');
  const pack = read('docs/presence/APPLY-0142-prod.sql');
  const body = (sql) => sql.split('\n').filter((l) => !l.startsWith('--') && l.trim()).join('\n').replace(/\nselect[\s\S]*$/, '');
  ok('C4: migration 0142 adds the column and the live-sites index, with its rollback', /add column if not exists next_window_at timestamptz/.test(mig) && /presence_sites_window_due_idx/.test(mig) && /-- rollback:[\s\S]*drop column if exists next_window_at/.test(mig));
  ok('C5: the apply pack runs the same statements, and checks the result', body(pack) === body(mig) && /information_schema\.columns/.test(pack));
  ok('C6: 0142 is the only migration with that number', [...Deno.readDirSync(new URL('supabase/migrations/', ROOT))].filter((e) => e.name.startsWith('0142_')).length === 1);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
