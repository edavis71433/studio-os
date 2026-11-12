// Sales item 106 (borrowed from Wix Studio's sales side): a proposal paid in parts on a
// schedule, saved proposal templates that keep their parts and terms, and project
// templates the studio saves from its own projects.
//   deno run --allow-read --allow-env tests/presence/proposal_schedule_test.mjs
import {
  normalizeSchedule, scheduleAmounts, partWhen, scheduleView, scheduleSummary, presetSchedule, stagesAfterSigning, signingPart, MAX_PARTS,
  partsAtSigning, partsPassages, partsIntoAgreement, HALF_PASSAGES, HALF_AND_HALF_RE,
} from '../../supabase/functions/presence/lib/proposal_schedule.ts';
import { packLineItems, splitLineItems } from '../../supabase/functions/presence/lib/sales_lifecycle.ts';
import { renderProposalDocument } from '../../supabase/functions/presence/lib/documents.ts';
import { proposalPdf } from '../../supabase/functions/presence/lib/doc_pdf.ts';
import { templateFromProject, savedTemplates, templateStepCount, dueFromStart, MAX_SAVED_PROJECT_TEMPLATES } from '../../supabase/functions/presence/lib/project_templates.ts';
import { RESERVED_NAMES } from '../../supabase/functions/presence/lib/reserved_store.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// ═══ 1. the parts ═══
{
  ok('one payment: nothing, or an empty list', normalizeSchedule(null).ok && normalizeSchedule(null).parts === null && normalizeSchedule([]).parts === null);
  const three = [{ pct: 34, when: 'sign' }, { pct: 33, when: 'date', date: '2026-12-15' }, { pct: 33, when: 'done' }];
  const n3 = normalizeSchedule(three);
  ok('three parts, cleaned', n3.ok && n3.parts.length === 3 && n3.parts[1].date === '2026-12-15' && n3.parts[2].when === 'done');
  const bad = (raw) => { const r = normalizeSchedule(raw); return r.ok ? '' : r.error; };
  ok('they must add up to 100', bad([{ pct: 50, when: 'sign' }, { pct: 40, when: 'done' }]) === 'The parts add up to 90%. Make them 100%.');
  ok('two to six parts, whole percents', /two parts or more/.test(bad([{ pct: 100, when: 'sign' }])) && /up to 6 parts/.test(bad(Array.from({ length: 7 }, () => ({ pct: 10, when: 'done' })))) && /whole percent/.test(bad([{ pct: 50.5, when: 'sign' }, { pct: 49.5, when: 'done' }])) && MAX_PARTS === 6);
  ok('only the first part is paid when they sign', /Only the first part/.test(bad([{ pct: 50, when: 'done' }, { pct: 50, when: 'sign' }])));
  ok('a dated part needs a date, in order; "days after" needs 1–365', /Pick a date/.test(bad([{ pct: 50, when: 'sign' }, { pct: 50, when: 'date' }])) && /dated before/.test(bad([{ pct: 30, when: 'date', date: '2026-12-15' }, { pct: 70, when: 'date', date: '2026-12-01' }])) && /how many days/.test(bad([{ pct: 50, when: 'sign' }, { pct: 50, when: 'days', days: 0 }])));
  ok('amounts: the last part takes what rounding left', JSON.stringify(scheduleAmounts(n3.parts, 480001)) === JSON.stringify([163200, 158400, 158401]) && scheduleAmounts(n3.parts, 480001).reduce((a, b) => a + b, 0) === 480001);
  ok('when, in words', partWhen({ when: 'sign' }) === 'When you sign the agreement' && partWhen({ when: 'date', date: '2026-12-15' }) === 'Due Dec 15, 2026' && partWhen({ when: 'days', days: 30 }) === 'Due 30 days after you sign' && partWhen({ when: 'days', days: 1 }) === 'Due 1 day after you sign' && partWhen({ when: 'done' }) === 'Due when the work is done');
  const v = scheduleView(three, 480000);
  ok('the view the pages draw', v.length === 3 && v[0].n === 1 && v[0].of === 3 && v[0].amount_cents === 163200 && v[1].words === 'Due Dec 15, 2026' && scheduleView(null, 480000) === null && scheduleView([{ pct: 1, when: 'x' }], 1) === null);
  ok('the line under the total', scheduleSummary(v, (c) => '$' + c / 100) === 'Paid in 3 parts · $1632 when you sign' && scheduleSummary(null, String) === '');
  ok('the ready-made splits add up', normalizeSchedule(presetSchedule('half')).ok && normalizeSchedule(presetSchedule('thirds')).ok && presetSchedule('nope') === null);
  ok('part 1 at signing is the deposit', JSON.stringify(signingPart(n3.parts, 480000)) === JSON.stringify({ amount_cents: 163200, label: 'Part 1 of 3' }) && signingPart([{ pct: 50, when: 'done' }, { pct: 50, when: 'done' }], 100) === null && signingPart(null, 1) === null);
  const st = stagesAfterSigning([{ pct: 34, when: 'sign' }, { pct: 33, when: 'days', days: 30 }, { pct: 33, when: 'date', date: '2027-01-15' }], 300000, '2026-11-20');
  ok('signing makes the later parts, dated', st.length === 2 && st[0].label === 'Part 2 of 3' && st[0].due_date === '2026-12-20' && st[1].due_date === '2027-01-15' && st[0].purpose === 'service' && st[0].amount_cents === 99000 && st[1].amount_cents === 99000);
  ok('a schedule with no signing part makes every part at signing', stagesAfterSigning([{ pct: 50, when: 'done' }, { pct: 50, when: 'done' }], 1000, '2026-11-20').length === 2);
  ok('a part with no date says so in its name', stagesAfterSigning([{ pct: 50, when: 'sign' }, { pct: 50, when: 'done' }], 1000, '2026-11-20')[0].label === 'Part 2 of 2 · when the work is done');
}

// ═══ 2. the parts ride the proposal's meta, through templates and revisions ═══
{
  const packed = packLineItems([{ label: 'Design', qty: 1, unit_cents: 100000 }], { schedule: [{ pct: 50, when: 'sign' }, { pct: 50, when: 'done' }] });
  ok('packed and read back', splitLineItems(packed).meta.schedule.length === 2 && packed.length === 2);
  ok('one payment adds no meta', packLineItems([{ label: 'Design', qty: 1, unit_cents: 1 }], { schedule: null }).length === 1);
  const sales = read('supabase/functions/presence/routes/sales.ts');
  ok('create: the editor\'s parts, else the template\'s; bad parts are refused', /const sch = normalizeSchedule\(b\.schedule !== undefined \? b\.schedule : \(tplMeta\.schedule \?\? null\)\);/.test(sales) && /if \(!sch\.ok\) return json\(\{ error: 'validation', message: sch\.error \}, 422, cors\);/.test(sales));
  ok('revise: the prior\'s parts unless changed', /normalizeSchedule\(b\.schedule !== undefined \? b\.schedule : \(priorSplit\.meta\.schedule \?\? null\)\)/.test(sales));
  ok('templates keep the parts and the terms; using one brings them', /schedule: sp\.meta\.schedule \?\? null \}\); body = clean\(p\.terms, 5000\);/.test(sales) && /terms: b\.terms !== undefined \? b\.terms : String\(t\.body \|\| ''\)/.test(sales));
  ok('the agreement\'s send makes part 1 the deposit, from the proposal it goes with; parts with no signing part make none', /const plan = await proposalSchedule\(site\.id, dealId\)\.catch\(\(\) => null\);\s*const first = plan \? signingPart\(plan\.parts, plan\.total_cents\) : null;\s*if \(plan && !first\) return \{ minted: false \};/.test(sales) && /if \(!first && !\/deposit\/i\.test/.test(sales));
  ok('the proposal it goes with: accepted, else the newest sent or drafted (not superseded)', /list\.find\(\(x: any\) => x\.status === 'accepted'\) \|\| \(acceptedOnly \? null : \(list\.find\(\(x: any\) => x\.status === 'sent'\) \|\| list\.find\(\(x: any\) => x\.status === 'draft'\)\)\)/.test(sales) && /\.filter\(\(x: any\) => !splitLineItems\(x\.line_items\)\.meta\.superseded_by\)/.test(sales));
  ok('signing makes the rest, at most once, from the accepted proposal and the deposit on the deal', /await mintLaterParts\(tok\.site_id, dealId, signedAt\.slice\(0, 10\)\)/.test(sales) && /const plan = await proposalSchedule\(siteId, dealId, true\);/.test(sales) && /const stages = partsAtSigning\(plan\.parts, plan\.total_cents, signedYmd, have\.filter\(\(i: any\) => i\.purpose === 'deposit'\)\);/.test(sales) && /purpose: st\.purpose \|\| 'service'/.test(sales));
  ok('an agreement drafted from a saved template follows the parts too', /if \(plan\) text = partsIntoAgreement\(text, plan\.parts, plan\.total_cents\)\.text;\s*return applyPlaceholders\(text, buildPlaceholderValues/.test(sales));
  ok('the client\'s page gets the parts', /proposal: proposal \? \{ \.\.\.proposal, expired, schedule \} : null/.test(sales) && /\.\.\.p, schedule, ask:/.test(sales));
}

// ═══ 3. the documents ═══
{
  const p = { title: 'Website refresh', status: 'sent', line_items: packLineItems([{ label: 'Design', qty: 1, unit_cents: 300000 }], { schedule: [{ pct: 50, when: 'sign' }, { pct: 50, when: 'done' }] }) };
  const page = renderProposalDocument(p, { name: 'Brightline Studio' });
  ok('page: How you’ll pay, part by part', page.includes('How you’ll pay') && page.includes('Part 1 of 2 · When you sign the agreement') && page.includes('$1,500.00'));
  const pdf = new TextDecoder('latin1').decode(proposalPdf(p, { name: 'Brightline Studio' }));
  ok('pdf: the parts too', pdf.includes('Part 2 of 2') && pdf.includes('Due when the work is done'));
}

// ═══ 4. the editor's mirror ═══
{
  const pipe = read('pipeline.html');
  const grab = (re) => { const m = pipe.match(re); return m ? m[0] : ''; };
  const src = grab(/function schedAmounts\(parts,total\)\{.*?\n/s) + grab(/const PART_MONTHS=.*?\n/s) + grab(/function partWhen\(p\)\{.*?\n/s);
  const mirror = new Function(src + ';return {schedAmounts,partWhen};')();
  const cases = [[{ pct: 34, when: 'sign' }, { pct: 33, when: 'days', days: 30 }, { pct: 33, when: 'done' }], [{ pct: 50, when: 'date', date: '2027-03-01' }, { pct: 50, when: 'days', days: 1 }]];
  ok('pipeline.html mirrors the amounts and the words', cases.every((c) => JSON.stringify(mirror.schedAmounts(c, 123457)) === JSON.stringify(scheduleAmounts(c, 123457)) && c.every((p) => mirror.partWhen(p) === partWhen(p))));
  const presets = pipe.match(/const PAY_PRESETS=(\{.*?\});/);
  ok('pipeline.html: the ready-made splits are the same', !!presets && JSON.stringify(Function('return ' + presets[1])()) === JSON.stringify({ half: presetSchedule('half'), thirds: presetSchedule('thirds') }));
  ok('pipeline.html: Save sends the parts, checked first; a template fills the editor', /if\(PARTS&&partsSum\(\)!==100\)\{toast\('The parts add up to '/.test(pipe) && /body\.schedule=collectSchedule\(\);if\(TPL_ID&&!rev\)body\.template_id=TPL_ID;/.test(pipe) && /data-tpl-fill=/.test(pipe));
}

// ═══ 5. project templates ═══
{
  const t = templateFromProject({ id: '11111111-2222-4333-8444-555555555555', name: ' Website build, our way ', now: '2026-11-12T00:00:00Z', startDate: '2026-11-01',
    milestones: [{ id: 'm2', title: 'Design', sort_order: 20 }, { id: 'm1', title: 'Kickoff', sort_order: 10 }],
    tasks: [
      { title: 'Brief', milestone_id: 'm1', sort_order: 1, due_date: '2026-11-03' },
      { title: 'Send your photos', milestone_id: 'm1', sort_order: 2, client_action_required: true },
      { title: 'Agreement signed', milestone_id: 'm1', sort_order: 3, source: 'checklist:agreement_signed' },
      { title: 'Draft pages', milestone_id: 'm2', sort_order: 4, due_date: '2026-11-15' },
      { title: 'Loose end', milestone_id: null, sort_order: 5 },
    ] });
  ok('from a project: milestones in order, the checklist\'s own steps left out', t.name === 'Website build, our way' && t.milestones.map((m) => m.title).join('|') === 'Kickoff|Design|Other steps' && templateStepCount(t) === 4);
  ok('dates become days from the start; the client\'s steps say so', t.milestones[0].tasks[0].due_days === 2 && t.milestones[1].tasks[0].due_days === 14 && t.milestones[0].tasks[1].client_action_required === true && !('due_days' in t.milestones[0].tasks[1]));
  ok('saved list: junk dropped, capped', savedTemplates([t, { id: 'nope' }, null, { id: t.id }]).length === 1 && savedTemplates(Array.from({ length: 30 }, () => t)).length === MAX_SAVED_PROJECT_TEMPLATES);
  ok('a step\'s due date from the start', dueFromStart('2026-11-20', 14) === '2026-12-04' && dueFromStart('', 3) === null && dueFromStart('2026-11-20', undefined) === null);
  ok('kept as one reserved list, out of the proposal template list', RESERVED_NAMES.projectTemplates === '__project_templates__' && /Object\.values\(RESERVED_NAMES\)/.test(read('supabase/functions/presence/routes/sales.ts')));
  const proj = read('supabase/functions/presence/routes/projects.ts');
  ok('routes: list, save from a project, remove; a new project starts from one, dated from its start', /export async function handleProjectTemplates\(/.test(proj) && /templateFromProject\(\{ id: crypto\.randomUUID\(\)/.test(proj) && /if \(tmpl\) await applyTemplate\(site\.id, project\.id, tmpl, sd\.v \|\| new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\);/.test(proj));
  const roles = read('supabase/functions/presence/lib/site_roles.ts');
  ok('roles: saving is edit, removing is delete', roles.includes("'POST /projects/templates',") && roles.includes('`DELETE /projects/templates/${ID}`,'));
  const page = read('projects.html');
  ok('projects.html: Save as a template on a project, the templates under Start from, Remove marked', /id="saveTpl"/.test(page) && /api\('\/projects\/templates','POST',\{name:v\.name,from_project_id:id\}\)/.test(page) && /<optgroup label="Your templates">/.test(page) && /data-needs="delete" data-del-ptpl=/.test(page));
}

// ═══ 6. signing never bills more than the total ═══
{
  const thirds = presetSchedule('thirds');   // 34 / 33 / 33, the first when they sign
  const T = 300000;
  const none = partsAtSigning(thirds, T, '2026-11-20', []);
  ok('no deposit on the deal: signing makes every part, part 1 due that day as the deposit', none.length === 3 && none[0].label === 'Part 1 of 3' && none[0].purpose === 'deposit' && none[0].due_date === '2026-11-20' && none[0].amount_cents === 102000 && none.reduce((n, x) => n + x.amount_cents, 0) === T);
  const rest = partsAtSigning(thirds, T, '2026-11-20', [{ amount_cents: 102000 }]);
  ok('the deposit is part 1: signing makes the other two', rest.length === 2 && rest[0].label === 'Part 2 of 3' && rest[1].label === 'Part 3 of 3 · when the work is done' && rest.every((x) => x.purpose === 'service'));
  ok('a half-and-half deposit already on the deal: signing makes nothing (no 116%)', partsAtSigning(thirds, T, '2026-11-20', [{ amount_cents: 150000 }]).length === 0);
  ok('two deposits: nothing', partsAtSigning(thirds, T, '2026-11-20', [{ amount_cents: 102000 }, { amount_cents: 102000 }]).length === 0);
  const dated = [{ pct: 50, when: 'date', date: '2026-12-01' }, { pct: 50, when: 'done' }];
  ok('no signing part and no deposit: every part, as dated', partsAtSigning(dated, T, '2026-11-20', []).map((x) => x.due_date).join() === '2026-12-01,');
  ok('no signing part but a deposit on the deal: nothing', partsAtSigning(dated, T, '2026-11-20', [{ amount_cents: 150000 }]).length === 0);
  ok('without withFirst the signing part is left to the send, as before', stagesAfterSigning(thirds, T, '2026-11-20').length === 2);
}

// ═══ 7. the agreement says the same as the parts ═══
{
  const pipe = read('pipeline.html');
  const a = pipe.indexOf('/* ==== agreement packages: start'), b = pipe.indexOf('/* ==== agreement packages: end ==== */');
  const PKGS = new Function(pipe.slice(a, b) + '\nreturn DDS_AGREEMENT_PACKAGES;')();
  const keys = Object.keys(PKGS);
  ok('every package carries the four half-and-half passages exactly as the rewrite expects', keys.length === 3 && keys.every((k) => Object.values(HALF_PASSAGES).every((t) => PKGS[k].body.includes(t))), keys.filter((k) => !Object.values(HALF_PASSAGES).every((t) => PKGS[k].body.includes(t))).join());
  const thirds = presetSchedule('thirds');
  const T = 480000;
  for (const k of keys) {
    const r = partsIntoAgreement(PKGS[k].body, thirds, T);
    ok(`${k}: all four passages follow the parts and nothing half-and-half is left`, r.changed === 4 && r.left === false && !HALF_AND_HALF_RE.test(r.text) && !/\{\{(?:deposit|balance)_amount\}\}/.test(r.text), `changed=${r.changed}`);
  }
  const ps = partsPassages(thirds, T);
  ok('the cover line', ps.cover === 'Payment:        In 3 parts: 34% ($1,632) when you sign · 33% ($1,584) 30 days after you sign · 33% ($1,584) when the work is done', ps.cover);
  ok('the fee table keeps its columns', ps.table.split('\n').length === 3 && ps.table.split('\n').every((l) => /^Part \d of 3, .*\d percent {2,}\$[\d,]+$/.test(l) && l.indexOf('$') >= 56), ps.table);
  ok('the fee clause names every part and adds up', ps.fee === 'The project fee of $4,800 is paid in three parts. Part 1, 34 percent or $1,632, is due at signing and before work begins. Part 2, 33 percent or $1,584, is due 30 days after signing. Part 3, 33 percent or $1,584, is due at launch. The site goes live once every part due by launch is received.', ps.fee);
  ok('the legal terms: the parts, then the deposit', ps.terms === 'The total project fee is paid in 3 parts: 34% upon signing; 33% 30 days after signing; and 33% upon project completion, prior to live site launch, DNS transfer, or handoff of final files. The first part is a non-refundable deposit due before work begins.', ps.terms);
  const two = partsPassages([{ pct: 60, when: 'date', date: '2026-12-15' }, { pct: 40, when: 'days', days: 1 }], 100001);
  ok('no signing part: no deposit promised; a date reads in full; odd cents agree', two.terms === 'The total project fee is paid in 2 parts: 60% by December 15, 2026 and 40% 1 day after signing.' && two.cover.includes('60% ($600.00) by December 15, 2026') && two.cover.includes('40% ($400.01) 1 day after you sign'), two.terms + ' | ' + two.cover);
  ok('one payment, or no total yet, changes nothing', partsIntoAgreement(PKGS.growth.body, null, T).text === PKGS.growth.body && partsIntoAgreement(PKGS.growth.body, thirds, 0).changed === 0);
  const own = 'Our own wording: 50% deposit to start.';
  const r = partsIntoAgreement(own, thirds, T);
  ok('the studio’s own wording is left as written and flagged', r.text === own && r.changed === 0 && r.left === true);
  // the page's mirror, run on the same packages
  const grab = (re) => { const m = pipe.match(re); if (!m) throw new Error('not found: ' + re); return m[0]; };
  const src = [/function schedAmounts\(parts,total\)\{.*?\n/s, /const HALF_PASSAGES=.*?\n/s, /const HALF_AND_HALF_RE=.*?\n/s, /function partPhrases\(p\)\{.*?\n/s, /function partsPassages\(parts,totalCents\)\{.*?\n.*?\n/s, /function partsIntoAgreement\(text,parts,totalCents\)\{.*?\n/s, /const docMoney=.*?\n/s].map(grab).join('');
  const mirror = new Function(src + 'return { partsIntoAgreement };')();
  const cases = [thirds, presetSchedule('half'), [{ pct: 60, when: 'date', date: '2026-12-15' }, { pct: 40, when: 'days', days: 1 }], [{ pct: 25, when: 'sign' }, { pct: 25, when: 'date', date: '2027-01-02' }, { pct: 25, when: 'days', days: 45 }, { pct: 25, when: 'done' }]];
  let drift = '';
  for (const k of keys) for (const c of cases) for (const total of [480000, 333333, 99]) {
    const s1 = partsIntoAgreement(PKGS[k].body, c, total), s2 = mirror.partsIntoAgreement(PKGS[k].body, c, total);
    if (s1.text !== s2.text || s1.changed !== s2.changed || s1.left !== s2.left) drift = `${k} ${JSON.stringify(c)} ${total}`;
  }
  ok('pipeline.html’s mirror writes exactly what the server writes, for every package and split', !drift, drift);
  ok('pipeline.html: the drafted agreement follows the parts of the proposal it goes with', /const CON_PLAN=dealParts\(data\.proposals\);/.test(pipe) && (pipe.match(/fillDocPlaceholders\(withParts\(/g) || []).length === 3 && /id='conParts'/.test(pipe));
  ok('pipeline.html: an agreement still saying half and half asks before every send', (pipe.match(/confirmHalfAndHalf\((?:k|v)\.body,dealParts\(data\.proposals\)\)/g) || []).length === 3);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PAID IN PARTS & TEMPLATES: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
