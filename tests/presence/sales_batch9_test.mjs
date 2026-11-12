// ── Sales review batch nine (Nov 2026): items 38, 40, 41, 42, 45 ────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_batch9_test.mjs
//
//   38  rename the four open deal stages in Settings (Won and Not a fit keep theirs)
//   40  Inbox notice rows say their kind and "opens in its own page" once per run
//   41  the record keeps three buttons in front; the rest under More
//   42  Customers cards show a fact (what's owed, what's waiting), not "all clear" x4
//   45  the record's timeline starts beside the record read
const S = await import('../../supabase/functions/presence/lib/stage_names.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ── 38: the rules ──
eq('real renames survive, tidied', S.normalizeStageNames({ lead: '  Enquiry  ', proposal: 'Quote   sent' }), { lead: 'Enquiry', proposal: 'Quote sent' });
eq('Won and Not a fit can\'t be renamed; unknown keys are dropped', S.normalizeStageNames({ won: 'Closed', lost: 'Dead', nope: 'x' }), {});
eq('a blank, or the usual name, is no rename', S.normalizeStageNames({ lead: '', qualified: 'QUALIFIED' }), {});
eq('no stage may take Won or Not a fit as its name', S.normalizeStageNames({ contract: 'Won', lead: 'not a fit' }), {});
eq('no two stages may read the same', S.normalizeStageNames({ lead: 'Qualified', proposal: 'Pitch', contract: 'pitch' }), {});
eq('capped at 30 characters', S.normalizeStageNames({ lead: 'x'.repeat(40) }).lead.length, S.MAX_STAGE_NAME);
eq('the full set: renames over the defaults', S.stageLabels({ lead: 'Enquiry' }), { lead: 'Enquiry', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' });
const L = S.stageLabels({ proposal: 'Quote sent' });
eq('"Moved to" lines follow a rename; other lines are left alone', [S.renameMovedTo('Moved to Proposal sent', L), S.renameMovedTo('Moved to Won', L), S.renameMovedTo('Proposal sent', L), S.renameMovedTo('Moved to Something', L)], ['Moved to Quote sent', 'Moved to Won', 'Proposal sent', 'Moved to Something']);

// ── 38: the wiring ──
const sales = read('supabase/functions/presence/routes/sales.ts');
ok('GET/PUT /sales/stages is wired, and PUT is a configure write for team seats', /route === '\/sales\/stages' && \(method === 'GET' \|\| method === 'PUT'\)/.test(read('supabase/functions/presence/index.ts')) && /'PUT \/sales\/stages',/.test(read('supabase/functions/presence/lib/site_roles.ts')));
ok('the Pipeline summary, the deal timeline and the reports use the studio\'s names', /if \(names\) sum\.by_stage = sum\.by_stage\.map/.test(sales) && /text: renameMovedTo\(it\.text, stageNames\)/.test(sales) && /dealsByStage\(deals, lastMoveInto, now, await labelsP(, await chancesP)?\)/.test(sales) && /const labelsP = loadStageLabels\(site\.id\)/.test(sales));
ok('so do the Analytics dashboard and the record\'s activity', /names \? sum\.by_stage\.map/.test(read('supabase/functions/presence/routes/analytics.ts')) && /renameMovedTo\(it\.title, stageNames\)/.test(read('supabase/functions/presence/routes/crm.ts')));
ok('Pipeline and the record read the names (the record at studio level)', /api\('\/sales\/stages'\)\.then/.test(read('pipeline.html')) && /apiAg\('\/sales\/stages'\)\.then/.test(read('crm.html')));
const st = read('settings.html');
ok('Settings: four name boxes, inside the configure-only section', /id="sn-lead" maxlength="30"/.test(st) && /id="sn-contract" maxlength="30"/.test(st) && !/id="sn-won"/.test(st) && /api\('\/sales\/stages', 'PUT', \{ names \}\)/.test(st));

// ── 40 ──
const inbox = read('inbox.html');
ok('a run of notice rows says its kind once, above the run', /if\(it\.tag!==lastTag\)h\+=`<li class="lgroup" role="presentation">/.test(inbox) && !/<span class="txt">Opens in its own page →<\/span>/.test(inbox));
ok('each notice row still says where it opens, to a screen reader', /aria-label="\$\{esc\(\(it\.read\?'Read — ':''\)\+it\.label\+' — '\+it\.tag\+', opens in its own page'\)\}"/.test(inbox));

// ── 41 ──
// sales item 80: Email stands where Message stood when there's an address and no project to message them through
ok('the record keeps three buttons in front', /const FRONT=\['act-log',canEmail\(\)&&!ids\.project\?'act-email':'act-message',both\?'act-send-both':'act-invoice'\];/.test(read('crm.html')));

// ── 42 ──
const cust = read('customers.html');
ok('a card shows what they owe and what is waiting; no "all clear" badge, no duplicate Open', /Owes \$\{esc\(fmtOwed\(owed\)\)\}/.test(cust) && /requests'\} waiting/.test(cust) && !/'all clear'\}<\/span><\/div>\s*<div class="acts">/.test(cust) && !/<button class="btn" data-open=/.test(cust));
ok('owed comes from the same open invoices as Who owes you', /api\('\/sales\/receivables\?today='\+ymd\(new Date\(\)\)\)\.catch\(\(\)=>null\)/.test(cust) && /i\.state==='upcoming'\|\|i\.state==='overdue'/.test(cust));

// ── 45 ──
const crm = read('crm.html');
ok('opened by the customer\'s site alone, the timeline starts beside the record read', /if\(q0\.get\('client'\)&&!q0\.get\('deal'\)&&!q0\.get\('project'\)&&!q0\.get\('contact'\)&&!q0\.get\('client_id'\)\) ACT_EARLY=api\('\/crm\/activity\?today='\+recTodayYmd\(\)\)/.test(crm));   // item 65: with the local day
ok('…and the first timeline load uses that read', /const r=\(early&&scopedCustomer&&\(await early\)\)\|\|await api\('\/crm\/activity\?'\+q\.concat\('today='\+recTodayYmd\(\)\)\.join\('&'\)\);/.test(crm));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
