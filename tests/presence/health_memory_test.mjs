// ── Builder list item 183: Website health with a memory ──
//   deno run --allow-read --allow-env tests/presence/health_memory_test.mjs
// The kept days become a weekly line, "fewer than four weeks ago", what was fixed and
// what is new since last week, today's problems under the seven plain headings, and a
// PDF; never the studio's 0 to 100 number (Law 13). The route reads the memory on its
// own, and before migration 0170 the Health check still loads. No Supabase is touched.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const P = '../../supabase/functions/presence';
const M = await import(`${P}/lib/health_memory.ts`);
const read = (p) => Deno.readTextFileSync(new URL(p, import.meta.url));

const day = (back) => new Date(Date.UTC(2026, 10, 11) - back * 86_400_000).toISOString().slice(0, 10);
const fp = (type, res) => `s|${type}|${res}`;
// eight weeks of days, the count falling from 6 to 2
const days = [];
for (let b = 0; b <= 56; b++) {
  const n = b >= 42 ? 6 : b >= 28 ? 5 : b >= 14 ? 4 : b >= 7 ? 3 : 2;
  days.push({ day: day(b), critical: b >= 7 ? 1 : 0, warning: n - (b >= 7 ? 1 : 0), fingerprints: b >= 7 ? [fp('links.internal_broken', '/team/'), fp('seo.description_missing', '/about/'), fp('accessibility.img_alt_missing', 'm1')] : [fp('seo.description_missing', '/'), fp('performance.image_oversized', 'm9')], run_id: b === 0 ? 'run-today' : null });
}
const items = [
  { type: 'seo.description_missing', severity: 'warning', resource: '/', human: 'The home page has no description.', next_action: 'Write a one-sentence description for this page.' },
  { type: 'performance.image_oversized', severity: 'warning', resource: 'm9', human: 'A photo is 4 MB.', next_action: 'Replace with a smaller photograph.' },
  { type: 'website.hosting_missing', severity: 'warning', resource: 'site' },
  { type: 'media.unused', severity: 'info', resource: 'm2' },
];

// ── 1. the memory ──
{
  const m = M.buildHealthMemory({ days: days.slice().reverse(), items, live: true, todayIso: '2026-11-11T09:40:00Z' });
  ok('memory: kept, since the first day', m.kept && m.since_day === day(56));
  eq('memory: one point a week, eight weeks, oldest first', m.points.map((p) => p.n), [6, 6, 5, 5, 4, 4, 3, 2]);
  eq('memory: the points are a week apart', [m.points[0].day, m.points[7].day], [day(49), day(0)]);
  eq('memory: today', m.now, { day: day(0), n: 2, critical: 0, warning: 2 });
  eq('memory: four weeks ago', m.then, { day: day(28), n: 5 });
  eq('memory: since a week ago, what was fixed, by type with the place', m.since.fixed.map((c) => [c.title, c.n, c.resources]), [['Links to pages that aren’t there', 1, ['/team/']], ['Pages without a search description', 1, ['/about/']], ['Photos without a description', 1, ['m1']]].sort((a, b) => a[0].localeCompare(b[0])));
  eq('memory: …and what is new', m.since.added.map((c) => c.title).sort(), ['Pages without a search description', 'Photos bigger than they need to be']);
  eq('memory: since which day', m.since.day, day(7));
  eq('memory: today’s problems, state and ideas left out, by title when alike', m.issues.map((x) => [x.type, x.heading, x.resources]), [['seo.description_missing', 'google', ['/']], ['performance.image_oversized', 'speed', ['m9']]]);
  ok('memory: each problem carries its fix', m.issues.every((x) => x.next_action.length > 10));
  eq('memory: the seven headings with their counts', m.headings.map((h) => h.n), [0, 1, 1, 0, 0, 0, 0]);
  ok('memory: no score anywhere a client reads (Law 13)', !/score/.test(JSON.stringify(m)));
  const fresh = M.buildHealthMemory({ days: [], items: [], live: true, todayIso: '2026-11-11T00:00:00Z' });
  eq('memory: nothing kept yet is said, not invented', [fresh.kept, fresh.now, fresh.then, fresh.since, fresh.points], [false, null, null, null, []]);
  const two = M.buildHealthMemory({ days: days.slice(0, 3), items, live: true, todayIso: '2026-11-11T00:00:00Z' });
  eq('memory: under a week kept, no fixed-and-new yet', [two.since, two.then], [null, null]);
}

// ── 2. the words ──
{
  eq('words: counts', [M.thingsWords(0), M.thingsWords(1), M.thingsWords(3)], ['Nothing to look at', '1 thing to look at', '3 things to look at']);
  eq('words: the change', [M.changeWords(2, { day: '2026-10-14', n: 5 }), M.changeWords(6, { day: '2026-10-14', n: 5 }), M.changeWords(5, { day: '2026-10-14', n: 5 }), M.changeWords(5, null)], ['3 fewer than Oct 14', '1 more than Oct 14', 'The same as Oct 14', '']);
}

// ── 3. the PDF ──
{
  const m = M.buildHealthMemory({ days, items, live: true, todayIso: '2026-11-11T09:40:00Z' });
  const bytes = M.healthPdf(m, { studio: { name: 'Brightline Studio', accent: '#6d3fd4' }, site: 'Maple & Main Realty', address: 'https://maple.example', facts: ['Online 100% of the last 30 days', 'Loads in 2.1 s for visitors'], todayIso: '2026-11-11T09:40:00Z' });
  const text = new TextDecoder().decode(bytes);
  // the PDF writes WinAnsi: the middle dot and the curly apostrophe as octal escapes
  const enc = (t) => t.replace(/[()\\]/g, '\\$&').replace(/·/g, '\\267').replace(/’/g, '\\222');
  ok('pdf: a real PDF file', text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'));
  for (const s of ['Brightline Studio', 'Website health: Maple & Main Realty', '2 things to look at', '3 fewer than Oct 14', 'Since Nov 4', 'Fixed: Links to pages that aren', 'New: Photos bigger than they need to be', 'Speed · 1 to look at', 'Links · All good', 'Online 100% of the last 30 days', '1 of 1']) ok(`pdf: says “${s}”`, text.includes(enc(s)), s);
  ok('pdf: no score in it', !/out of 100|score/i.test(text));
  const blank = new TextDecoder().decode(M.healthPdf(M.buildHealthMemory({ days: [], items: [], live: true, todayIso: '2026-11-11T00:00:00Z' }), { studio: { name: 'S' }, site: 'X', address: '', facts: [], todayIso: '2026-11-11T00:00:00Z' }));
  ok('pdf: nothing kept yet says the line fills in', blank.includes('so the line fills in week by week'));
}

// ── 4. the route reads it on its own ──
{
  const src = read(`${P}/routes/health_page.ts`);
  ok('route: the memory is one more best-effort read beside the Health check', /loadHealthMemory\(site, now\)\.catch\(\(\) => \(\{ memory: null, ready: true \}\)\)/.test(src) && /memory: mem\.memory, memory_ready: mem\.ready/.test(src));
  ok('route: before 0170 the memory is "not ready", not a failure', /ready: !\(d\.status === 404/.test(src));
  ok('route: today’s problems come from the run behind the newest kept day, this site only', /presence_evidence\?run_id=eq\.\$\{runId\}&site_id=eq\.\$\{site\.id\}&severity=in\.\(critical,warning\)/.test(src));
  ok('route: the PDF is on the studio’s brand, downloaded, never cached', /presence_service_links\?customer_site_id=eq\.\$\{site\.id\}/.test(src) && /'Content-Type': 'application\/pdf'/.test(src) && /'Cache-Control': 'no-store'/.test(src));
  ok('route: wired', /route === '\/website-health\/pdf' && method === 'GET'\) return handleWebsiteHealthPdf\(site, cors\)/.test(read(`${P}/index.ts`)));
  ok('route: the page on the app’s host can read the file’s name', read(`${P}/routes/health_page.ts`).includes(`'Access-Control-Expose-Headers': 'Content-Disposition'`));
  const days2 = [{ day: '2026-11-11', critical: 0, warning: 1, fingerprints: ['s|seo.title_missing|/'], run_id: 'run-1' }];
  let missing = false;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url)); const table = u.pathname.replace('/rest/v1/', '');
    if (table === 'presence_health_days') return missing ? new Response(JSON.stringify({ code: 'PGRST205' }), { status: 404 }) : new Response(JSON.stringify(days2), { status: 200 });
    if (table === 'presence_evidence') return new Response(JSON.stringify([{ type: 'seo.title_missing', severity: 'critical', resource: '/', human: 'No title.', next_action: 'Set a title.' }]), { status: 200 });
    return new Response('[]', { status: 200 });
  };
  const { loadHealthMemory } = await import(`${P}/routes/health_page.ts`);
  const site = { id: 's', client_id: 'c', status: 'live', last_published_at: null, template_slug: 't', template_version: '1', custom_domain: null, netlify_site_id: null, edition: 'presence' };
  const got = await loadHealthMemory(site, '2026-11-11T10:00:00Z');
  eq('route: today’s count and the problem behind it', [got.ready, got.memory.now.n, got.memory.issues[0].title], [true, 1, 'Pages without a title for Google']);
  missing = true;
  const before = await loadHealthMemory(site, '2026-11-11T10:00:00Z');
  eq('route: before 0170', [before.ready, before.memory], [false, null]);
}

const failed = results.filter((r) => !r.p).length;
console.log(`health_memory: ${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
