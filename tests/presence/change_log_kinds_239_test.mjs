// ── The change log takes every website change, and nothing writes what it refuses (builder item 239) ──
// presence_change_events names every kind and action it accepts (0015, 0018, now 0229). About 25
// writes fell outside those lists and were refused without a word. These pins keep it from
// happening again:
//   · every writeChangeEvent call in the functions names a kind and an action the newest
//     migration's checks accept, and never an email where a uuid goes
//   · lib/provenance.ts's lists equal 0229's checks; 0229's trigger skips exactly publish,
//     restore and the kinds that change no draft (launch, preview); the apply pack runs the same
//   · no principal with a made-up sign-in name reaches the change log or the publish pipeline
//   · the readers that count draft changes leave out launch and preview lines; the timelines
//     label the new kinds; a scheduled launch keeps who set it
//
//   deno run --allow-read --allow-env tests/presence/change_log_kinds_239_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

Deno.env.set('SUPABASE_URL', 'https://db.test');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
const P = await import('../../supabase/functions/presence/lib/provenance.ts');
const { mapChange } = await import('../../supabase/functions/presence/crm/contract.ts');
const { buildWebsiteTimeline } = await import('../../supabase/functions/presence/lib/website_timeline.ts');

// ── every .ts file under the functions ──
const FN = 'supabase/functions/';
const files = [];
const walk = (rel) => { for (const e of Deno.readDirSync(new URL(rel, ROOT))) { const p = rel + e.name; if (e.isDirectory) walk(p + '/'); else if (p.endsWith('.ts')) files.push(p); } };
walk(FN);
const callsIn = (src, fn) => {
  const out = []; const re = new RegExp(`\\b${fn}\\(`, 'g'); let m;
  while ((m = re.exec(src)) !== null) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;   // the definition
    let i = m.index + m[0].length, depth = 1, q = null;
    for (; i < src.length && depth; i++) {
      const ch = src[i];
      if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
      if (ch === '\'' || ch === '"' || ch === '`') { q = ch; continue; }
      if (ch === '(' || ch === '{' || ch === '[') depth++; else if (ch === ')' || ch === '}' || ch === ']') depth--;
    }
    out.push({ at: src.slice(0, m.index).split('\n').length, text: src.slice(m.index, i) });
  }
  return out;
};
const arg = (call, key) => { const m = new RegExp(`\\b${key}(?:\\s*:\\s*([^,}]+))?\\s*[,}]`).exec(call); return m ? (m[1] ?? key).trim() : null; };
const literals = (expr) => [...String(expr).matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);

// ═══ 1. every call names what the table takes ═══
{
  const bad = [], seenTypes = new Set(), seenActions = new Set();
  let count = 0;
  for (const f of files) {
    const src = read(f);
    for (const c of callsIn(src, 'writeChangeEvent')) {
      if (f.endsWith('lib/provenance.ts')) continue;
      count++;
      const where = `${f.replace(FN, '')}:${c.at}`;
      let et = arg(c.text, 'entityType'), ac = arg(c.text, 'action'), id = arg(c.text, 'entityId');
      // the kinds a call can name: its literals, or, for the few that pass one along, every value
      // that can reach it (the content routes' tables, a publish's own kind, an edit's verb)
      const types = literals(et).length ? literals(et)
        : /^(spec|cfg)\.entityType$/.test(et) && f.endsWith('routes/content.ts') ? [...src.matchAll(/entityType: '([a-z_]+)'/g)].map((x) => x[1])
        : et === 'kind' && f.endsWith('routes/publish.ts') ? ['publish', 'restore'] : null;
      const actions = literals(ac).length ? literals(ac)
        : ac === 'kind' && f.endsWith('routes/publish.ts') ? ['publish', 'restore']
        : ac === 'action' && f.endsWith('routes/content.ts') ? [...(/const action = ([\s\S]*?);/.exec(src)?.[1] || '').matchAll(/[?:]\s*'([a-z_]+)'/g)].map((x) => x[1]) : null;
      if (!types) { bad.push(`${where} entityType ${et} can't be read`); continue; }
      if (!actions || !actions.length) { bad.push(`${where} action ${ac} can't be read`); continue; }
      for (const t of types) { seenTypes.add(t); if (!P.CHANGE_ENTITY_TYPES.includes(t)) bad.push(`${where} entityType '${t}'`); }
      for (const a of actions) { seenActions.add(a); if (!P.CHANGE_ACTIONS.includes(a)) bad.push(`${where} action '${a}'`); }
      if (id && /email/i.test(id)) bad.push(`${where} entityId ${id} (a uuid column)`);
    }
  }
  ok(`every change-log call names a kind and an action the table takes (${count} calls)`, bad.length === 0 && count > 90, bad.join('; '));
  ok('the new kinds are written where they belong (launches, the preview, saved sections)', ['launch', 'preview', 'content_library'].every((t) => seenTypes.has(t)) && ['approve', 'reject', 'schedule'].every((a) => seenActions.has(a)));
  ok('nobody writes customer, contact or deal lines any more', !['client', 'contact', 'deal'].some((t) => seenTypes.has(t)) && !['invite', 'connect', 'convert', 'connect_requested', 'connect_pending'].some((a) => seenActions.has(a)));
}

// ═══ 2. the lists, the migration and its pack say the same ═══
const mig = read('supabase/migrations/0229_change_log_kinds.sql');
{
  const list = (name) => { const m = new RegExp(`add constraint ${name}\\s+check \\(\\w+ in\\s*\\(([^)]*)\\)\\)`).exec(mig); return m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')) : []; };
  ok('0229: entity_type is provenance.ts’s list (0018’s fourteen and launch, preview, content_library)', same(list('presence_change_events_entity_type_check'), P.CHANGE_ENTITY_TYPES) && P.CHANGE_ENTITY_TYPES.length === 17);
  ok('0229: action is provenance.ts’s list (0015’s eight and approve, reject, schedule)', same(list('presence_change_events_action_check'), P.CHANGE_ACTIONS) && P.CHANGE_ACTIONS.length === 11);
  const skip = /if new\.entity_type in \(([^)]*)\) then return new;/.exec(mig);
  const skipped = skip ? skip[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')) : [];
  ok('0229: the last_change_at trigger skips publish, restore and every kind that changes no draft', same(skipped, ['publish', 'restore', ...P.NOT_DRAFT_TYPES]), skipped.join(','));
  ok('0229: the trigger still stamps last_change_at and empties unfinished_sections, as 0206 did', /set last_change_at = greatest\(coalesce\(last_change_at, new\.created_at\), new\.created_at\),\s*unfinished_sections = null/.test(mig) && /security definer set search_path = public/.test(mig));
  const sqlOnly = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  ok('0229: first line is the rollback note; checks dropped if they exist, then added', /^-- rollback:/.test(mig) && (sqlOnly.match(/drop constraint if exists presence_change_events_(entity_type|action)_check;/g) || []).length === 2);
  const body = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();
  const pack = read('docs/presence/APPLY-0229-prod.sql');
  ok('APPLY-0229: runs exactly the migration, with a verify query', body(pack) === body(mig) && /-- Verify/.test(pack), `${body(pack).length} vs ${body(mig).length}`);
}

// ═══ 3. no made-up sign-in name reaches the change log or the publish pipeline ═══
{
  const bad = [];
  for (const f of files) {
    const src = read(f);
    const named = new Set([...src.matchAll(/(?:const|let)\s+(\w+)(?::\s*Principal)?\s*=\s*\{[^}]*\buserId:\s*'[^']*'/g)].map((m) => m[1]));
    if (!named.size) continue;
    for (const fn of ['writeChangeEvent', 'runPipeline', 'publishPostsOnly', 'takeSiteOffline', 'insertSnapshot']) {
      for (const c of callsIn(src, fn)) {
        const passed = fn === 'writeChangeEvent' ? arg(c.text, 'principal') : c.text;
        for (const n of named) if (new RegExp(`\\b${n}\\b`).test(passed || '')) bad.push(`${f.replace(FN, '')}:${c.at} ${fn} gets ${n}`);
      }
    }
  }
  ok('no principal named with a made-up sign-in id reaches a uuid column', bad.length === 0, bad.join('; '));
  for (const f of ['presence/ops/scheduler.ts', 'presence/ops/scheduled_posts.ts', 'presence/routes/commercial.ts']) {
    const src = read(FN + f);
    ok(`${f.split('/').pop()}: no 'scheduler' or 'client-one-tap' sign-in left`, !/userId:\s*'(scheduler|client-one-tap)'/.test(src));
  }
  const sch = read(FN + 'presence/ops/scheduler.ts');
  ok('scheduler.ts: each row is sent on behalf of whoever set it', /schedulerPrincipal\('scheduled-publish', row\.created_by\)/.test(sch));
  ok('launches.ts: a scheduled launch keeps who set it', /presence_scheduled_publishes'[\s\S]{0,400}created_by: principal\.userId \|\| 'owner'/.test(read(FN + 'presence/routes/launches.ts')));
  ok('publish.ts: the record’s kind is changeActorKind (system for the scheduler)', /let actorKind: string = changeActorKind\(principal\);/.test(read(FN + 'presence/routes/publish.ts')));
}

// ═══ 4. the readers that count draft changes leave the record-only kinds out ═══
{
  ok('provenance: the filter names launch and preview, with anything else asked', P.draftChangesOnly() === 'entity_type=not.in.(launch,preview)' && P.draftChangesOnly(['publish', 'restore']) === 'entity_type=not.in.(publish,restore,launch,preview)');
  const uses = [
    ['presence/routes/publish.ts', /presence_change_events\?site_id=eq\.\$\{siteId\}[\s\S]{0,120}?&\$\{draftChangesOnly\(\)\}&select=entity_type,action/, 'what a publish says changed'],
    ['presence/routes/preview_env.ts', /presence_change_events\?site_id=eq\.\$\{siteId\}[\s\S]{0,120}?&\$\{draftChangesOnly\(\)\}&select=id/, 'the preview’s count of unpublished changes'],
    ['presence/routes/room.ts', /\$\{draftChangesOnly\(\['publish', 'restore'\]\)\}&select=created_at&order=created_at\.asc/, 'the room’s oldest unpublished change'],
    ['presence/evidence/collect.ts', /\$\{draftChangesOnly\(\['publish', 'restore'\]\)\}&select=created_at&order=created_at\.asc&limit=500/, 'the evidence of unpublished changes'],
    ['presence/routes/site.ts', /presence_change_events\?site_id=eq\.\$\{site\.id\}&\$\{draftChangesOnly\(\)\}&select=created_at/, 'the home view’s draft status'],
    ['presence/agency/routes.ts', /presence_change_events\?\$\{IN\}&\$\{draftChangesOnly\(\)\}&select=site_id,created_at/, 'the studio’s site list (before 0206)'],
    ['presence/routes/coach.ts', /presence_change_events\?site_id=eq\.\$\{site\.id\}&\$\{draftChangesOnly\(\)\}&select=created_at/, 'the coach (before 0206)'],
    ['presence/lib/optimistic_lock.ts', /presence_change_events\?site_id=eq\.\$\{site\.id\}&\$\{draftChangesOnly\(\)\}&select=summary,actor_kind,created_at/, 'the editor’s “changed elsewhere”'],
  ];
  for (const [f, re, what] of uses) ok(`reader: ${what} leaves launch and preview lines out`, re.test(read(FN + f)));
  // and no reader of the whole log was missed: every read of change events either filters by kind,
  // reads one kind, or shows the lines themselves (timelines, Changes, a domain's history)
  const shows = ['presence/routes/change_log.ts', 'presence/routes/timeline.ts', 'presence/crm/store.ts', 'presence/agency/sites.ts', 'presence/routes/admin.ts'];
  const missed = [];
  for (const f of files) {
    const src = read(f);
    for (const c of callsIn(src, 'svc')) {
      if (!c.text.startsWith('svc(`presence_change_events?')) continue;
      const q = c.text;
      if (/entity_type=(eq|in)\./.test(q) || /draftChangesOnly/.test(q) || shows.some((s) => f.endsWith(s))) continue;
      missed.push(`${f.replace(FN, '')}: ${q.slice(0, 80)}`);
    }
  }
  ok('every other read of the log is one that shows the lines themselves', missed.length === 0, missed.join('; '));
}

// ═══ 5. the timelines name the new kinds ═══
{
  const row = (entity_type, summary) => ({ id: entity_type, entity_type, action: 'update', summary, created_at: '2026-11-15T10:00:00Z' });
  ok('CRM timeline: a launch, the preview and saved sections have their own titles', mapChange(row('launch', 'Approved launch “Spring”')).title === 'Launch updated' && mapChange(row('preview', 'Updated the preview site')).title === 'Preview updated' && mapChange(row('content_library', 'Saved “Hours” to the content library')).title === 'Saved sections updated');
  const t = buildWebsiteTimeline({ now: '2026-11-15T12:00:00Z', publishes: [], changes: [row('launch', 'Approved launch “Spring”'), row('preview', 'Updated the preview site'), row('content_library', 'Saved “Hours” to the content library')], connections: [], moments: [], enquiries: [], scheduled: [], launches: [], domainActions: [], projectEvents: [] });
  const ev = t.groups.flatMap((g) => g.events);
  const by = (title) => ev.find((e) => e.title === title);
  ok('website timeline: launch and preview lines sit with Publishing and open Versions', by('Launch updated')?.category === 'Publishing' && by('Launch updated')?.href === '/presence.html#history' && by('Preview updated')?.category === 'Publishing' && by('Preview updated')?.href === '/presence.html#history', JSON.stringify(ev.map((e) => [e.title, e.category, e.href])));
  ok('website timeline: saved sections are content, opening the design tab', by('Saved sections updated')?.category === 'Content' && by('Saved sections updated')?.href === '/presence.html#design');
}

// ═══ 6. a refused line in the log ═══
{
  const line = P.refusedLine({ siteId: 's', entityType: 'deal', action: 'convert' }, { status: 400, json: { code: '23514', message: 'new row for relation "presence_change_events" violates check constraint "presence_change_events_entity_type_check"', details: 'Failing row contains (Acme Bakery).' }, text: '' });
  ok('refused: the kinds, the status, the code and the reason', line.evt === 'change_event_refused' && line.entity_type === 'deal' && line.action === 'convert' && line.status === 400 && line.code === '23514' && /entity_type_check/.test(line.reason));
  ok('refused: never the failing row (PostgREST repeats it in details)', !JSON.stringify(line).includes('Acme'));
  const net = P.refusedLine({ siteId: 's', entityType: 'post', action: 'update' }, { status: 0, json: null, text: 'connection reset' });
  ok('refused: a dropped connection says so too', net.status === 0 && net.code === null && net.reason === 'connection reset');
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
