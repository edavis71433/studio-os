// ── The standard-step picker: adding the steps we already know about ────────
//   deno run --allow-read --allow-env --allow-net tests/presence/project_checklist_picker_test.mjs
//
// ERIC ASKED FOR: "there also should be a drop down for tasks that we know need
// to be completed that we add and once completed the percentage goes up."
//
// The ten steps already existed (lib/project_checklist.ts) — but only the
// deal→project handoff could put them on a project, and only ALL TEN AT ONCE
// onto an EMPTY project. A project that missed that door (every project created
// before the checklist, Bacchus among them) had no way to get them except a SQL
// backfill Eric has not run. This suite pins the door that fixes that:
//
//   POST /projects/:id/checklist  { keys: [...] }  or  { all: true }
//
// WHAT MUST BE TRUE, and why each one is a bug if it isn't:
//   • the row a PICKED step writes is byte-identical to the row the SEEDER
//     writes — same title, same client flags, and above all the same
//     `source = 'checklist:<key>'`, because that source is the ONLY handle the
//     auto-tick has. A hand-made "Site live" task with source='manual' looks
//     right and never ticks when the site goes live.
//   • a step already on the project is NEVER inserted again. The auto-tick
//     PATCHes one addressable row and progressOf counts rows, so a duplicate
//     both breaks the tick and inflates the denominator (10 done of 11).
//   • "add all the standard steps" READS THE EVIDENCE the system already owns
//     (a signed contract, a paid deposit). Without that, Eric adds ten steps to
//     a signed-and-paid project and watches it report 0% — the exact "numbers
//     that lie" problem the checklist exists to end.
//   • none of this touches free-text tasks (source='manual'), and none of it
//     hands the client a tick they were never allowed (6a35aa3).
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const SITE = '11111111-1111-4111-8111-111111111111';
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const chk = await import('../../supabase/functions/presence/lib/project_checklist.ts');
const { DELIVERY_CHECKLIST, checklistRows, checklistRowsFor, checklistState, missingChecklistKeys, checklistKeyOf, checklistSource, clientMayTick } = chk;
const { handleProjectChecklist, handleProject, handleTasksCreate } = await import('../../supabase/functions/presence/routes/projects.ts');
const bridge = await import('../../supabase/functions/presence/lib/service_bridge.ts');

const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const restore = () => { globalThis.fetch = realFetch; };
const STAFF = { kind: 'staff', userId: 'eric', tenantId: null, role: null, email: 'eric@davisdigitalstudio.com', jwt: null, requestId: 't' };
const SITE_ROW = { id: SITE, client_id: null };
const post = (body, project = { id: PROJECT, site_id: SITE, deal_id: DEAL, name: 'Bacchus', client_visible: true }) =>
  handleProjectChecklist(new Request('https://x/checklist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'jwt', SITE_ROW, STAFF, PROJECT, {});

/** cfg:
 *   project      the presence_projects row (null → 404); deal_id null = manual project
 *   held         checklist keys the project ALREADY holds (live rows)
 *   insertStatus 409 → the partial unique index refused (a racing tab got there first)
 *   raceAdds     keys that "appeared" between the first read and the retry read
 *   signed/paid  the evidence reconcileChecklistFacts reads back
 */
function installFetch(cfg = {}) {
  const calls = [];
  let inserts = 0;
  let held = [...(cfg.held || [])];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('presence_projects')) return jr(cfg.project === null ? [] : [cfg.project || { id: PROJECT, site_id: SITE, deal_id: DEAL, name: 'Bacchus', client_visible: true }]);
    if (url.includes('presence_contracts')) return jr(cfg.signed ? [{ id: 'ct1' }] : []);
    if (url.includes('presence_invoices')) return jr(cfg.paid ? [{ id: 'iv1' }] : []);
    if (url.includes('presence_tasks') && method === 'POST') {
      inserts++;
      if (cfg.insertStatus === 409 && inserts === 1) { held = [...held, ...(cfg.raceAdds || [])]; return jr({ code: '23505' }, 409); }
      if (cfg.insertStatus === 409 && cfg.alwaysConflict) return jr({ code: '23505' }, 409);
      if (cfg.insertStatus === 502) return jr({ code: 'x' }, 502);
      const made = (Array.isArray(body) ? body : [body || {}]).map((r, i) => ({ id: `task_${inserts}_${i}`, ...r }));
      held = [...held, ...made.map((r) => checklistKeyOf(r.source)).filter(Boolean)];
      return jr(made, 201);
    }
    if (url.includes('presence_tasks') && method === 'PATCH') return jr([{ id: 'task_auto', title: 'x', client_visible: false }]);
    if (url.includes('presence_tasks')) return jr(held.map((k) => ({ source: checklistSource(k), status: 'todo' })));
    if (url.includes('presence_project_events')) return jr(null, 201);
    return jr([]);
  };
  return { calls, insertsOf: () => inserts };
}

try {
  // ═══════════ PART A · ONE list, ONE row shape (pure) ═══════════
  {
    ok('one list: the picker’s catalog IS the seeder’s list — ten slots, same keys, same order',
      checklistState([]).map((s) => s.key).join(',') === DELIVERY_CHECKLIST.map((s) => s.key).join(','));
    ok('one list: an empty project offers all ten and holds none',
      checklistState([]).every((s) => s.present === false && s.status === null) && missingChecklistKeys([]).length === 10);

    const heldRows = [{ source: 'checklist:deposit_paid', status: 'done' }, { source: 'manual', status: 'todo' }, { source: 'template', status: 'todo' }];
    const st = checklistState(heldRows);
    ok('already present: a step the project holds is marked present, with its real status',
      st.find((s) => s.key === 'deposit_paid').present === true && st.find((s) => s.key === 'deposit_paid').status === 'done');
    ok('already present: …and it is the ONLY one — a manual/template task is not mistaken for a step',
      st.filter((s) => s.present).length === 1 && missingChecklistKeys(heldRows).length === 9 && !missingChecklistKeys(heldRows).includes('deposit_paid'));
    ok('already present: a source that merely LOOKS like a step (unknown key) marks nothing present',
      checklistState([{ source: 'checklist:not_a_real_step', status: 'todo' }]).every((s) => s.present === false) && checklistKeyOf('checklist:not_a_real_step') === null);

    // THE point of the picker: a picked row must be the seeded row.
    const seeded = checklistRows(SITE, PROJECT);
    const picked = checklistRowsFor(SITE, PROJECT, ['site_live', 'agreement_signed', 'content_received']);
    const same = picked.every((p) => JSON.stringify(p) === JSON.stringify(seeded.find((s) => s.source === p.source)));
    ok('row shape: a PICKED step is byte-identical to the row the seeder would have written', same,
      JSON.stringify(picked[0]) + ' vs ' + JSON.stringify(seeded.find((s) => s.source === picked[0].source)));
    ok('row shape: …including the sort_order, which is the STEP’s, not the subset’s — a late add still lands in delivery order',
      picked.map((p) => p.sort_order).join(',') === '0,30,80');
    ok('row shape: …and canonical order is restored however the caller asked',
      checklistRowsFor(SITE, PROJECT, ['handover', 'agreement_signed']).map((r) => r.source).join(',') === 'checklist:agreement_signed,checklist:handover');
    ok('row shape: an unknown key adds nothing (the route reports it; the builder never invents a row)',
      checklistRowsFor(SITE, PROJECT, ['nope', 'revisions']).length === 1);
    ok('client flags: exactly the three client-facing steps carry client_visible + client_action_required',
      picked.filter((p) => p.client_visible === true).map((p) => p.source).join(',') === 'checklist:content_received' &&
      checklistRows(SITE, PROJECT).filter((r) => r.client_visible).length === 3);
    ok('client tick: a step added by the picker is STILL operator-verified — no client tick, not even the three shared ones',
      checklistRowsFor(SITE, PROJECT, DELIVERY_CHECKLIST.map((s) => s.key)).every((r) => clientMayTick(r.source) === false));
  }

  // ═══════════ PART B · the route adds only what's missing ═══════════
  {
    const { calls } = installFetch({ held: ['deposit_paid'] });
    const r = await post({ keys: ['deposit_paid', 'site_live', 'handover'] });
    const out = await r.json();
    const ins = calls.find((c) => c.url.includes('presence_tasks') && c.method === 'POST');
    ok('route: adding steps returns 201 with what it actually added',
      r.status === 201 && out.data?.added === 2 && out.data?.added_keys.join(',') === 'site_live,handover', `${r.status} ${JSON.stringify(out.data)}`);
    ok('route: the step the project ALREADY holds is skipped, not re-inserted',
      (ins?.body || []).length === 2 && !(ins?.body || []).some((x) => x.source === 'checklist:deposit_paid') && out.data?.skipped_keys.join(',') === 'deposit_paid',
      JSON.stringify(ins?.body));
    ok('route: the inserted rows carry the addressable source the auto-tick needs',
      (ins?.body || []).map((x) => x.source).join(',') === 'checklist:site_live,checklist:handover');
    ok('route: …and the right client flags for each step (both internal here)',
      (ins?.body || []).every((x) => x.client_visible === false && x.client_action_required === false && x.status === 'todo' && x.site_id === SITE && x.project_id === PROJECT));
    ok('route: the "what is already here" read uses the SAME predicate as the unique index (live checklist rows only)',
      calls.some((c) => c.method === 'GET' && /presence_tasks\?/.test(c.url) && /deleted_at=is\.null/.test(c.url) && /source=like\.checklist%3A\*/.test(c.url)),
      String(calls.filter((c) => c.url.includes('presence_tasks') && c.method === 'GET').map((c) => c.url)));
    ok('route: ONE summary event, not ten notifications — and it stays internal',
      calls.filter((c) => c.url.includes('presence_project_events') && c.method === 'POST').length === 1 &&
      calls.find((c) => c.url.includes('presence_project_events'))?.body?.kind === 'checklist_steps_added' &&
      calls.find((c) => c.url.includes('presence_project_events'))?.body?.client_visible === false);
    ok('route: the response hands back the whole ten-step state, so the card can repaint without a reload',
      Array.isArray(out.data?.checklist) && out.data.checklist.length === 10 && out.data.checklist.find((s) => s.key === 'site_live').present === true);
    restore();
  }

  // ═══════════ PART C · "add all the standard steps" (Eric's Bacchus) ═══════════
  {
    const { calls } = installFetch({ held: [], signed: true, paid: true });
    const r = await post({ all: true });
    const out = await r.json();
    const ins = calls.find((c) => c.url.includes('presence_tasks') && c.method === 'POST');
    ok('add all: a project with none of them gets all ten in ONE insert',
      r.status === 201 && out.data?.added === 10 && (ins?.body || []).length === 10, `${r.status} ${JSON.stringify(out.data?.added)}`);
    ok('add all: …in delivery order, each addressable',
      (ins?.body || []).map((x) => x.source).join(',') === DELIVERY_CHECKLIST.map((s) => checklistSource(s.key)).join(','));
    // The whole point: a signed + paid project must not land on 0%.
    const ticks = calls.filter((c) => c.url.includes('presence_tasks') && c.method === 'PATCH');
    ok('add all: it READS THE EVIDENCE the system already owns instead of starting at a fresh zero',
      out.data?.reconciled === true && ticks.some((c) => /source=eq\.checklist%3Aagreement_signed/.test(c.url)) && ticks.some((c) => /source=eq\.checklist%3Adeposit_paid/.test(c.url)),
      String(ticks.map((c) => c.url)));
    ok('add all: …by REUSING reconcileChecklistFacts — the same signed-contract + paid-deposit reads the seeder and the SQL backfill use',
      calls.some((c) => /presence_contracts\?deal_id=eq\./.test(c.url) && /status=eq\.signed/.test(c.url)) &&
      calls.some((c) => /presence_invoices\?deal_id=eq\./.test(c.url) && /purpose=eq\.deposit/.test(c.url) && /status=eq\.paid/.test(c.url)));
    restore();
  }
  {
    // IDEMPOTENT: the same button, a second time, on a project that now has them all.
    const { calls } = installFetch({ held: DELIVERY_CHECKLIST.map((s) => s.key), signed: true, paid: true });
    const r = await post({ all: true });
    const out = await r.json();
    ok('add all: a second press adds NOTHING and says so (200, not a duplicate, not an error)',
      r.status === 200 && out.data?.added === 0 && out.data?.skipped_keys.length === 10 &&
      !calls.some((c) => c.url.includes('presence_tasks') && c.method === 'POST'), `${r.status} ${JSON.stringify(out.data)}`);
    ok('add all: …and it writes no event for a no-op',
      !calls.some((c) => c.url.includes('presence_project_events') && c.method === 'POST'));
    ok('add all: …and it does not re-run the evidence reads when there was nothing to add',
      out.data?.reconciled === false && !calls.some((c) => c.url.includes('presence_contracts')));
    restore();
  }
  {
    // PARTIAL: half the steps are already there — add all fills the gap only.
    const { calls } = installFetch({ held: ['agreement_signed', 'deposit_paid', 'site_live'] });
    const r = await post({ all: true });
    const out = await r.json();
    const ins = calls.find((c) => c.url.includes('presence_tasks') && c.method === 'POST');
    ok('add all: on a half-filled project it adds only the gap (7), skipping the 3 it holds',
      out.data?.added === 7 && (ins?.body || []).length === 7 && out.data?.skipped_keys.length === 3, JSON.stringify(out.data?.added_keys));
    ok('add all: …and it does not reconcile when the two evidence steps were already there (nothing new to correct)',
      out.data?.reconciled === false && !calls.some((c) => c.url.includes('presence_contracts')));
    restore();
  }
  {
    // A MANUAL project (no deal) has no contract or deposit to read back.
    const { calls } = installFetch({ project: { id: PROJECT, site_id: SITE, deal_id: null, name: 'Internal ops', client_visible: false }, held: [] });
    const r = await post({ all: true });
    const out = await r.json();
    ok('add all: a project with no deal still gets its ten — and honestly reports no reconciliation',
      r.status === 201 && out.data?.added === 10 && out.data?.reconciled === false && !calls.some((c) => c.url.includes('presence_contracts')));
    restore();
  }

  // ═══════════ PART D · the race, answered honestly ═══════════
  {
    // Another tab (or the 0120 backfill) inserted 'handover' between our read and
    // our write. The unique index refuses the batch; we recompute and add the rest.
    const { calls } = installFetch({ held: [], insertStatus: 409, raceAdds: ['handover'] });
    const r = await post({ keys: ['handover', 'revisions'] });
    const out = await r.json();
    const posts = calls.filter((c) => c.url.includes('presence_tasks') && c.method === 'POST');
    ok('race: a 409 from the unique index is retried against the RECOMPUTED gap, not blindly',
      posts.length === 2 && (posts[1].body || []).map((x) => x.source).join(',') === 'checklist:revisions', JSON.stringify(posts[1]?.body));
    ok('race: …and the answer counts only what THIS request actually added',
      r.status === 201 && out.data?.added === 1 && out.data?.added_keys.join(',') === 'revisions', JSON.stringify(out.data));
    restore();
  }
  {
    // The loser of a genuine race: still conflicting after the retry.
    const { calls } = installFetch({ held: [], insertStatus: 409, alwaysConflict: true });
    const r = await post({ keys: ['handover'] });
    const out = await r.json();
    ok('race: an unresolvable conflict is a plain 409 that says what happened — never a silent success',
      r.status === 409 && out.error === 'conflict' && /just added somewhere else/.test(String(out.message || '')), `${r.status} ${JSON.stringify(out)}`);
    ok('race: …and it hands back the project’s REAL checklist state so the page can repaint the truth',
      Array.isArray(out.checklist) && out.checklist.length === 10);
    ok('race: …and it claims nothing was added when nothing was',
      !calls.some((c) => c.url.includes('presence_project_events') && c.method === 'POST'));
    restore();
  }

  // ═══════════ PART E · the door is narrow ═══════════
  {
    const { calls } = installFetch({ held: [] });
    const r = await post({ keys: ['deposit_paid', 'make_me_a_sandwich'] });
    const out = await r.json();
    ok('validation: an unknown key is refused (422) and NOTHING is written — not even the valid half',
      r.status === 422 && !calls.some((c) => c.method === 'POST' && c.url.includes('presence_tasks')), `${r.status} ${JSON.stringify(out)}`);
    ok('validation: …with a message a human reads, and no step key echoed into it',
      /standard delivery steps/.test(String(out.message || '')) && !/_/.test(String(out.message || '')), String(out.message));
    restore();
  }
  {
    const { calls } = installFetch({ held: [] });
    const r = await post({ keys: [] });
    ok('validation: an empty pick is a 422, not an insert of nothing', (await r.json()) && r.status === 422 && !calls.some((c) => c.method === 'POST' && c.url.includes('presence_tasks')));
    restore();
  }
  {
    const { calls } = installFetch({ project: null });
    const r = await post({ all: true });
    ok('validation: a project that isn’t in this workspace is a 404 before any write',
      r.status === 404 && !calls.some((c) => c.method === 'POST' && c.url.includes('presence_tasks')));
    restore();
  }
  {
    // ONE DOOR. The free-text task route must not be able to mint a second row
    // for a step — `source` is otherwise free text, and a duplicate breaks both
    // the auto-tick's single-row PATCH and the progress denominator.
    const { calls } = installFetch({ held: [] });
    const req = new Request('https://x/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Site live', source: 'checklist:site_live' }) });
    const r = await handleTasksCreate(req, 'jwt', SITE_ROW, STAFF, PROJECT, {});
    const out = await r.json();
    ok('one door: POST /tasks refuses to mint a checklist row by hand (422), so the picker is the only way in',
      r.status === 422 && !calls.some((c) => c.method === 'POST' && c.url.includes('presence_tasks')), `${r.status} ${JSON.stringify(out)}`);
    restore();
  }
  {
    // NO REGRESSION: an ordinary free-text task is untouched — still 'manual'.
    const { calls } = installFetch({ held: [] });
    const req = new Request('https://x/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Call the printer', due_date: '2026-09-01' }) });
    const r = await handleTasksCreate(req, 'jwt', SITE_ROW, STAFF, PROJECT, {});
    const ins = calls.find((c) => c.url.includes('presence_tasks') && c.method === 'POST');
    ok('no regression: a free-text task still saves exactly as before — source "manual", tickable by the studio',
      r.status === 201 && ins?.body?.source === 'manual' && ins?.body?.title === 'Call the printer' && clientMayTick(ins?.body?.source) === true, JSON.stringify(ins?.body));
    restore();
  }
  {
    // The client side must not be able to add steps at all.
    const CLIENT = { kind: 'user', userId: 'u1', tenantId: null, role: null, email: 'claud@bacchus.example', jwt: null, requestId: 't' };
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();
      calls.push({ url, method });
      if (url.includes('/auth/v1/user')) return jr({ id: 'u1', email: 'claud@bacchus.example' });
      if (url.includes('presence_site_members')) return jr([{ id: 'mem1', role: 'client_reviewer', user_id: 'u1' }]);
      return jr([]);
    };
    const r = await handleProjectChecklist(new Request('https://x/checklist', { method: 'POST', body: JSON.stringify({ all: true }) }), 'jwt', SITE_ROW, CLIENT, PROJECT, {});
    ok('perms: the client side cannot add steps — 403 before any read of the project, let alone a write',
      r.status === 403 && !calls.some((c) => c.method === 'POST' && c.url.includes('presence_tasks')), String(r.status));
    restore();
  }
  {
    const r = await handleProjectChecklist(new Request('https://x/checklist', { method: 'GET' }), 'jwt', SITE_ROW, STAFF, PROJECT, {});
    ok('perms: the route is POST-only', r.status === 405);
  }

  // ═══════════ PART F · the record payload feeds the picker ═══════════
  {
    const { calls } = installFetch({ held: ['deposit_paid'] });
    const r = await handleProject(new Request('https://x/p', { method: 'GET' }), 'jwt', SITE_ROW, STAFF, PROJECT, {});
    const out = await r.json();
    ok('payload: the record carries the ten-step state, so the page needs no copy of the list',
      Array.isArray(out.data?.checklist) && out.data.checklist.length === 10 &&
      out.data.checklist.find((s) => s.key === 'deposit_paid').present === true &&
      out.data.checklist.find((s) => s.key === 'site_live').present === false, JSON.stringify(out.data?.checklist?.[1]));
    ok('payload: …and the task read asks for `source`, or "already present" could never be known',
      calls.some((c) => c.method === 'GET' && c.url.includes('presence_tasks') && /select=[^&]*\bsource\b/.test(c.url)));
    ok('payload: the catalog carries the three client-facing steps, quietly marked for the picker',
      out.data.checklist.filter((s) => s.client_action).map((s) => s.key).join(',') === 'questionnaire_returned,content_received,client_review');
    restore();
  }

  // ═══════════ PART G · a picked step still auto-ticks (both doors) ═══════════
  {
    // The auto-tick addresses a step by source. A row the PICKER wrote carries
    // the same source as a row the SEEDER wrote (Part A), so the tick lands —
    // this proves the two halves actually meet, on the live PATCH.
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();
      calls.push({ url, method });
      if (url.includes('presence_service_links')) return jr([{ project_id: PROJECT, agency_site_id: SITE }]);
      if (url.includes('presence_tasks') && method === 'PATCH') return jr([{ id: 'picked_row', title: 'Site live', client_visible: false }]);
      if (url.includes('presence_project_events')) return jr(null, 201);
      return jr([]);
    };
    const ticked = await bridge.tickChecklistForCustomerSite('77777777-7777-4777-8777-777777777777', 'site_live', 'publish', 'system');
    const patch = calls.find((c) => c.method === 'PATCH');
    const pickedRow = checklistRowsFor(SITE, PROJECT, ['site_live'])[0];
    ok('auto-tick: publishing ticks a MANUALLY ADDED site_live step — same source, same one-row PATCH',
      ticked === true && new URL(String(patch?.url)).search.includes(`source=eq.${encodeURIComponent(pickedRow.source)}`), String(patch?.url));
    restore();
    // both doors call the same helper with the same key — neither knows or cares
    // how the row got there
    const pub = read('supabase/functions/presence/routes/publish.ts');
    const rec = read('supabase/functions/presence/lib/deploy_reconcile.ts');
    ok('auto-tick: BOTH publish doors still tick site_live through that one helper (the sync publish and the async reconcile)',
      /tickChecklistForCustomerSite\(site\.id, 'site_live'/.test(pub) && /tickChecklistForCustomerSite\(String\(p\.site_id\), 'site_live'/.test(rec));
  }

  // ═══════════ PART H · the page carries no second copy of the ten ═══════════
  {
    const page = read('projects.html');
    const titles = DELIVERY_CHECKLIST.map((s) => s.title).filter((t) => page.includes(t));
    ok('one source of truth: projects.html hardcodes NONE of the ten step titles', titles.length === 0, titles.join(' | '));
    const keys = DELIVERY_CHECKLIST.map((s) => s.key).filter((k) => page.includes(`'${k}'`) || page.includes(`"${k}"`));
    ok('one source of truth: …and none of the ten step keys', keys.length === 0, keys.join(' | '));
    ok('one source of truth: the page renders whatever data.checklist says, in the server’s order',
      /Array\.isArray\(data\.checklist\)/.test(page) && /steps\.map\(s=>/.test(page));
    ok('picker: a step the project already holds is rendered DISABLED with the reason, never silently missing',
      /s\.present\?' disabled':''/.test(page) && /already on this project/.test(page));
    ok('picker: several steps at once — a checkbox list with a select-all-remaining, one save',
      /input type="checkbox" data-step=/.test(page) && /Select all '\+missing\.length\+' remaining/.test(page) && /'\/projects\/'\+id\+'\/checklist','POST',\{keys\}/.test(page));
    ok('picker: the client-facing three and the self-ticking three are marked, quietly',
      /s\.client_action\?'<span class="tag client">shared<\/span>'/.test(page) && /s\.auto\?'<span class="tag">ticks itself<\/span>'/.test(page));
    ok('add all: the empty-project affordance posts {all:true} and is offered only when NONE are present',
      /chkMissing===CHK\.length/.test(page) && /'\/projects\/'\+id\+'\/checklist','POST',\{all:true\}/.test(page));
    ok('after a write the record re-opens, so the computed percentage repaints without a manual reload',
      (page.match(/toast\(addedMsg\(r\)\);openProject\(id\)/g) || []).length === 2);
    ok('free text survives: the "+ Add" task form still posts a plain title/due/client-action task',
      /id="addTask"/.test(page) && /\{title:v\.title,due_date:v\.due_date\|\|undefined,client_action_required:!!v\.client_action_required\}/.test(page));
  }

  // ═══════════ PART I · wiring + the migration that backs the promise ═══════════
  {
    const idx = read('supabase/functions/presence/index.ts');
    ok('wiring: POST /projects/:id/checklist is dispatched (and nothing else on that path)',
      /\\\/checklist\$\/\);\s*\n\s*if \(m && method === 'POST'\) return handleProjectChecklist\(/.test(idx));
    const sql = read('supabase/migrations/0123_project_checklist_uq.sql');
    const old = read('supabase/migrations/0120_project_checklist_backfill.sql');
    const indexOf = (s) => (s.match(/create unique index if not exists presence_tasks_project_checklist_uq[\s\S]*?;/) || [''])[0].replace(/\s+/g, ' ').trim();
    ok('migration: 0123 gives the uniqueness guarantee on its own — Eric has not run 0120’s backfill',
      indexOf(sql).length > 0 && indexOf(sql) === indexOf(old), indexOf(sql) + ' vs ' + indexOf(old));
    ok('migration: it de-duplicates before building the index, so it cannot fail on a project that already has two',
      /row_number\(\) over \(\s*partition by project_id, source/.test(sql) && /set deleted_at = now\(\)/.test(sql) && !/delete from public\.presence_tasks/.test(sql.split('ROLLBACK')[0]));
    ok('migration: the keeper is chosen so a ticked row is never the one thrown away',
      /order by \(status = 'done'\) desc, created_at asc/.test(sql));
    ok('migration: idempotent + additive — if 0120 already ran, this is a no-op',
      /create unique index if not exists/.test(sql) && !/drop table|alter table|drop column/.test(sql.split('ROLLBACK')[0]));
  }
} finally {
  restore();
}

const passed = results.filter(Boolean).length;
console.log(`\n════ CHECKLIST STEP PICKER: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
