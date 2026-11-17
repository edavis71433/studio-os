// ── The one deal stage bar (builder item 102) ────────────────────────────────────
//   deno run --allow-read tests/presence/deal_path_102_test.mjs
//
// deal-path.js draws the stage steps and the "What to do now" note for both the record
// (crm.html) and the Pipeline's deal (pipeline.html); each kept a copy before. This drives
// the real file: which steps are done, current or upcoming, which ONE step can be pressed
// to move back, what a screen reader hears, and what the note shows in each state. The
// pages' own use of it runs in the browser (stage-notes-124, pipeline, crm specs).
globalThis.window = globalThis;
await import('../../deal-path.js');
const P = globalThis.ddsDealPath;

let pass = 0, fail = 0;
const ok = (name, cond, note = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`); };

// the board's legal moves, as both pages hold them
const NEXT = { lead: ['qualified', 'lost'], qualified: ['proposal', 'lead', 'lost'], proposal: ['contract', 'qualified', 'lost'], contract: ['proposal', 'lost'], won: [], lost: ['lead'] };
const LABELS = { lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' };
const label = (s) => LABELS[s] || s;

// a small reader for the buttons the bar draws: one object per <button>
function read(html) {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => {
    const a = {}; for (const [, k, v] of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) a[k] = v === undefined ? true : v;
    const cls = String(a.class || '').split(/\s+/).filter(Boolean);
    return { stage: a['data-pstep'], cls, label: a['aria-label'], tabindex: a.tabindex, disabled: a['aria-disabled'], expanded: a['aria-expanded'], type: a.type, text: inner.replace(/<[^>]+>/g, '') };
  });
}

ok('it knows the four sales stages, in order', JSON.stringify(P.STEPS) === JSON.stringify(['lead', 'qualified', 'proposal', 'contract']));

// ── a deal at Proposal sent ──
{
  const b = read(P.steps({ stage: 'proposal', next: NEXT, label, guideOpen: true }));
  ok('four steps, each a plain button (never a form submit)', b.length === 4 && b.every((x) => x.type === 'button'));
  ok('New lead and Qualified are done, with a tick', b[0].cls.includes('done') && b[1].cls.includes('done') && b[0].text === '✓ New lead' && b[1].text === '✓ Qualified');
  ok('Proposal sent is the current step and says whether its note is open', b[2].cls.includes('current') && b[2].expanded === 'true' && b[2].text === 'Proposal sent');
  ok('Agreement out is still to come', !b[3].cls.includes('done') && !b[3].cls.includes('current') && b[3].text === 'Agreement out');
  ok('only Qualified can be pressed to move back (the board allows one step back)', b[1].cls.includes('canback') && !b[0].cls.includes('canback') && b.filter((x) => x.cls.includes('canback')).length === 1);
  ok('the steps that can\'t be pressed are out of the tab order', [b[0], b[3]].every((x) => x.tabindex === '-1' && x.disabled === 'true') && b[1].tabindex === undefined && b[2].tabindex === undefined);
  ok('a screen reader hears each step\'s state and what pressing does',
    b[0].label === 'New lead — complete' && b[1].label === 'Qualified — complete. Activate to move the deal back here.'
    && b[2].label === 'Proposal sent — current stage. Activate to show or hide the stage guidance.' && b[3].label === 'Agreement out — upcoming');
  ok('the tick is not read twice (the button\'s name is its label)', /<span class="pck" aria-hidden="true">✓ <\/span>/.test(P.steps({ stage: 'proposal', next: NEXT, label })));
  const shut = read(P.steps({ stage: 'proposal', next: NEXT, label, guideOpen: false }));
  ok('with the note hidden the current step says so', shut[2].expanded === 'false');
}
// ── the ends of the road ──
{
  const won = read(P.steps({ stage: 'won', next: NEXT, label }));
  ok('a won deal shows every step done, and none can be pressed', won.every((x) => x.cls.includes('done') && !x.cls.includes('canback') && x.tabindex === '-1'));
  const lost = read(P.steps({ stage: 'lost', next: NEXT, label }));
  ok('a deal that wasn\'t a fit shows a closed road: nothing done, nothing current, nothing to press',
    lost.every((x) => x.cls.includes('lost-terminal') && !x.cls.includes('done') && !x.cls.includes('current') && x.tabindex === '-1'));
  const first = read(P.steps({ stage: 'lead', next: NEXT, label }));
  ok('a new lead has nothing done and nothing to move back to', first[0].cls.includes('current') && first.slice(1).every((x) => !x.cls.includes('done')) && !first.some((x) => x.cls.includes('canback')));
}
{
  const odd = read(P.steps({ stage: 'qualified', next: NEXT, label: (s) => (s === 'lead' ? 'Leads <b>"new"</b>' : label(s)) }));
  ok('a studio\'s own stage name is shown as words, never as markup', odd[0].text === '✓ Leads &lt;b&gt;&quot;new&quot;&lt;/b&gt;' && odd[0].label.startsWith('Leads &lt;b&gt;&quot;new&quot;&lt;/b&gt;'));
}

// ── the note under the bar ──
{
  ok('no note and nothing the deal knows: nothing is drawn', P.noteHtml({ stage: 'proposal', label: 'Proposal sent', text: '', fact: null }) === '');
  const fact = P.noteHtml({ stage: 'contract', label: 'Agreement out', text: '', fact: { tip: 'They’ve signed.', action: 'Convert them to a customer to start the project.' } });
  ok('what the deal knows shows even when the notes couldn\'t be read, with no Edit note', /<p class="sn-fact"><b>They’ve signed\.<\/b> Convert them to a customer to start the project\.<\/p>/.test(fact) && !/snEdit/.test(fact) && !/sn-steps/.test(fact));
  const link = P.noteHtml({ stage: 'contract', label: 'Agreement out', text: '', fact: { tip: 'They’ve signed.', action: 'x', html: '<a href="#" id="guideConvert">Convert them ↓</a>' } });
  ok('a page can put its own action in the fact line (the Pipeline\'s Convert link)', /<b>They’ve signed\.<\/b> <a href="#" id="guideConvert">Convert them ↓<\/a>/.test(link));
  const shown = P.noteHtml({ stage: 'proposal', label: 'Proposal sent', text: 'Call on day two\nAsk about the budget', mine: false });
  ok('the starter note shows one step a line, says it is a starter, and offers Edit note to those who can configure',
    (shown.match(/<li>/g) || []).length === 2 && /A starter note for every deal at Proposal sent\./.test(shown) && /id="snEdit" data-needs="configure">Edit note</.test(shown));
  ok('the note names its stage', /<span class="sn-chip">Proposal sent<\/span>/.test(shown) && /<h3 id="snHead">What to do now<\/h3>/.test(shown));
  const mine = P.noteHtml({ stage: 'proposal', label: 'Proposal sent', text: 'Our own step', mine: true });
  ok('the studio\'s own note says so', /Your studio’s note for every deal at Proposal sent\./.test(mine));
  const editing = P.noteHtml({ stage: 'proposal', label: 'Proposal sent', text: 'Our own step', mine: true, editing: true, buttons: { save: 'btn', cancel: 'btn ghost' } });
  ok('editing shows the words in a labelled box, the page\'s own button looks, and the way back to the starter',
    /<label class="sr-only" for="snText">What to do now at Proposal sent, one step a line<\/label><textarea id="snText"[^>]*>Our own step<\/textarea>/.test(editing)
    && /<button type="button" class="btn" id="snSave">Save for every deal<\/button><button type="button" class="btn ghost" id="snCancel">Cancel<\/button>/.test(editing)
    && /id="snReset">Put back the starter note</.test(editing) && !/id="snEdit"/.test(editing));
  const starterEditing = P.noteHtml({ stage: 'proposal', label: 'Proposal sent', text: 'Starter', mine: false, editing: true });
  ok('a starter note being edited has no "put back the starter" (it is the starter)', !/snReset/.test(starterEditing));
  const xss = P.noteHtml({ stage: 'proposal', label: 'Proposal <i>', text: '<img src=x onerror=alert(1)>', fact: { tip: '<b>', action: '<script>' } });
  ok('every word in the note is shown as words', !/<img|<script|<i>/.test(xss) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(xss));
}

console.log(`\n════ ONE DEAL STAGE BAR (builder item 102): ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) Deno.exit(1);
