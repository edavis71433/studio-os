// ── Sales item 124: a "what to do now" note for each deal stage ───────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/stage_notes_124_test.mjs
// The pure rules (lib/stage_notes.ts), the real /sales/stages route on the shared
// in-memory PostgREST, and the pages that show and edit the note.
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const db = installFakePostgrest({ unique: { presence_sales_templates: [{ cols: ['site_id', 'kind', 'name'], where: (r) => r.deleted_at == null && /^__.*__$/.test(String(r.name)) }] } });
const N = await import('../../supabase/functions/presence/lib/stage_notes.ts');
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const cors = {};
const req = (method, b) => new Request('https://fn.test/functions/v1/presence/sales/stages', { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

// ═══ the pure rules ═══
eq('every one of the six stages has a starter note', Object.keys(N.STAGE_NOTE_DEFAULTS), ['lead', 'qualified', 'proposal', 'contract', 'won', 'lost']);
ok('each starter note is a few short steps', Object.values(N.STAGE_NOTE_DEFAULTS).every((t) => t.split('\n').length >= 2 && t.split('\n').length <= 4 && t.split('\n').every((l) => l.length <= N.NOTE_MAX_LINE)));
eq('a note is cleaned: bullets, blank lines and spacing go, one step a line', N.cleanNote('  - Call them\r\n\r\n• Ask   the budget\n3) Send it  \n'), 'Call them\nAsk the budget\nSend it');
eq('at most eight steps', N.cleanNote(Array.from({ length: 12 }, (_, i) => 'Step ' + i).join('\n')).split('\n').length, 8);
ok('a step stops at 160 characters', N.cleanNote('x'.repeat(400)).length === 160);
eq('only real changes are kept: the starter note again is not one', N.normalizeStageNotes({ lead: N.STAGE_NOTE_DEFAULTS.lead, qualified: 'Book the call', nonsense: 'x', won: '   ' }), { qualified: 'Book the call' });
eq('every stage’s note, the studio’s where it wrote one', N.stageNotes({ proposal: 'Call on day two' }).proposal, 'Call on day two');
eq('…and the starter elsewhere', N.stageNotes({ proposal: 'Call on day two' }).lead, N.STAGE_NOTE_DEFAULTS.lead);
eq('changing one stage leaves the others as kept', N.withStageNote({ lead: 'A', won: 'B' }, 'lead', 'C'), { lead: 'C', won: 'B' });
eq('an empty note puts the starter back', N.withStageNote({ lead: 'A', won: 'B' }, 'lead', ''), { won: 'B' });

// ═══ the route ═══
{
  db.reset({ presence_sales_templates: [] });
  const g = await res(await S.handleSalesStages(req('GET'), site, owner, cors));
  ok('GET: with nothing written, every stage reads its starter note', g.status === 200 && JSON.stringify(g.body.data.notes) === JSON.stringify(N.STAGE_NOTE_DEFAULTS) && JSON.stringify(g.body.data.notes_custom) === '{}' && !!g.body.data.note_defaults);
  const p = await res(await S.handleSalesStages(req('PUT', { note: { stage: 'proposal', text: 'Call on day two\nAsk what they’d change' } }), site, owner, cors));
  ok('PUT note: one stage’s note is kept and answered', p.status === 200 && p.body.data.notes.proposal === 'Call on day two\nAsk what they’d change' && p.body.data.notes.lead === N.STAGE_NOTE_DEFAULTS.lead, JSON.stringify(p.body));
  ok('PUT note: names and percents are left as they were', JSON.stringify(p.body.data.custom) === '{}' && p.body.data.chances.proposal === 50);
  // a teammate changed another stage meanwhile: the reserved row says so; ours is applied on top
  const row = db.tables.presence_sales_templates.find((r) => r.name === '__stage_notes__');
  row.body = JSON.stringify({ proposal: 'Call on day two\nAsk what they’d change', won: 'Send the welcome pack' });
  const q = await res(await S.handleSalesStages(req('PUT', { note: { stage: 'lead', text: 'Reply within the hour' } }), site, owner, cors));
  ok('PUT note: a teammate’s note on another stage is never written over', q.body.data.notes.won === 'Send the welcome pack' && q.body.data.notes.lead === 'Reply within the hour' && q.body.data.notes.proposal.startsWith('Call on day two'));
  const back = await res(await S.handleSalesStages(req('PUT', { note: { stage: 'lead', text: '' } }), site, owner, cors));
  ok('PUT note: an empty note puts the starter back', back.body.data.notes.lead === N.STAGE_NOTE_DEFAULTS.lead && !('lead' in back.body.data.notes_custom));
  const bad = await res(await S.handleSalesStages(req('PUT', { note: { stage: 'closed', text: 'x' } }), site, owner, cors));
  ok('PUT note: a stage that isn’t one is refused', bad.status === 422);
  const names = await res(await S.handleSalesStages(req('PUT', { names: { lead: 'Enquiry' } }), site, owner, cors));
  ok('PUT names still works, and still answers the notes', names.status === 200 && names.body.data.labels.lead === 'Enquiry' && names.body.data.notes.won === 'Send the welcome pack');
}
{
  // a notes read that fails answers null, never the starters pretending to be the studio's
  db.reset({ presence_sales_templates: [] });
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => decodeURIComponent(String(url)).includes('name=eq.__stage_notes__') && (init.method || 'GET') === 'GET' ? new Response('{"message":"boom"}', { status: 500 }) : real(url, init);
  const g = await res(await S.handleSalesStages(req('GET'), site, owner, cors));
  globalThis.fetch = real;
  ok('a failed notes read: the names and percents still load, the notes say null', g.status === 200 && g.body.data.notes === null && g.body.data.labels.lead === 'New lead');
}

// ═══ the pages ═══
{
  const crm = read('crm.html'), pipe = read('pipeline.html'), settings = read('settings.html');
  for (const [name, src] of [['the record', crm], ['Pipeline’s deal', pipe]]) {
    ok(`${name}: the note sits under the stage bar`, /class="stage-note"/.test(src) && /What to do now/.test(src));
    ok(`${name}: Edit note is a setting, so it carries data-needs="configure"`, /class="sn-edit" id="snEdit" data-needs="configure">Edit note</.test(src));
    ok(`${name}: it saves one stage’s note through PUT /sales/stages`, /'\/sales\/stages','PUT',\{note:\{stage,text\}\}/.test(src));
    ok(`${name}: the old one-line tip strip is gone`, !/<b>Tip:<\/b>/.test(src));
    ok(`${name}: what the deal itself knows shows even when the notes couldn’t be read, with no Edit note`, /if\(!text&&!fact\)return'';/.test(src) && /const body=!text\?'':NOTE_EDIT/.test(src) && /\$\{NOTE_EDIT\|\|!text\?'':'<button type="button" class="sn-edit"/.test(src));
  }
  ok('Settings: all six notes, with the same save', /id="stageNotes"/.test(settings) && /api\('\/sales\/stages', 'PUT', \{ note \}\)/.test(settings));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
