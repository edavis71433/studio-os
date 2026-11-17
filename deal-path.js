// ── The deal stage bar: one copy (builder item 102) ────────────────────────────
// A deal's stages (New lead · Qualified · Proposal sent · Agreement out) and the "What
// to do now" note under them (sales item 124) show on a customer's record (crm.html) and
// in the Pipeline's deal drawer (pipeline.html). Each page kept its own copy of the
// markup, the rules for which step can be pressed, and the look, "kept in sync by hand".
// They live here now; each page still decides what the button beside the bar does
// (Move to …, Convert) and how a note is saved, because those differ.
//
//   ddsDealPath.steps({ stage, next, label, guideOpen })   → the four step buttons (HTML)
//   ddsDealPath.noteHtml({ stage, label, text, mine, editing, fact, buttons }) → the note (HTML)
//   ddsDealPath.wireNote({ stage, repaint, save })          → its Edit, Cancel, Save and keys
//
// Only two steps can be pressed: the current one (shows or hides the note) and the ONE
// legal step back (next[stage] lists it). Everything else is out of the tab order.
(function () {
  'use strict';
  if (window.ddsDealPath) return;
  var STEPS = ['lead', 'qualified', 'proposal', 'contract'];

  var CSS = [
    '.pathcard{margin-top:var(--dds-s4,16px);background:var(--dds-card,#fff);border:1px solid var(--dds-line,#eee9e0);border-radius:var(--dds-r-lg,10px);padding:var(--dds-s3,12px) var(--dds-s4,16px)}',
    '.pathrow{display:flex;gap:var(--dds-s3,12px);align-items:center;flex-wrap:wrap}',
    '.path{display:flex;gap:6px;flex:1 1 520px;min-width:0}',
    // the bar is a row of top-ruled steps: green when done, the accent on the current one
    '.path .pstep,.path button.pstep{flex:1;min-width:0;border:none;border-top:5px solid #e1e1e8;border-radius:3px 3px 0 0;background:transparent;color:var(--dds-faint,#746b8a);font-family:inherit;font-size:12px;font-weight:500;padding:var(--dds-s2,8px) var(--dds-s1,4px) 0;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default;line-height:1.3}',
    '.path .pstep.done,.path button.pstep.done{border-top-color:var(--dds-good,#33664b);color:var(--dds-soft,#6b6478)}',
    '.path .pstep .pck{font-weight:700}',
    '.path .pstep.current,.path button.pstep.current{border-top-color:var(--dds-p,#5b3fa0);color:var(--dds-p,#5b3fa0);font-weight:600;cursor:pointer}',
    '.path button.pstep.current:hover{color:var(--dds-p-deep,var(--dds-p,#5b3fa0))}',
    '.path button.pstep.canback{cursor:pointer}',
    '.path button.pstep.canback:hover{color:var(--dds-ink,#1b1525)}',
    '.path .pstep.lost-terminal,.path button.pstep.lost-terminal{border-top-color:var(--dds-warn,#775d31);color:var(--dds-warn,#775d31)}',
    // item 57: on a phone the strip scrolls sideways (the page opens it on the current stage)
    '@media (max-width:640px){.path{overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px}.path .pstep,.path button.pstep{flex:0 0 auto;min-width:96px}}',
    '.path-side{display:flex;align-items:center;gap:10px;flex:0 0 auto}',
    '.path-guide{margin-top:10px;font-size:13px;color:var(--dds-soft,#6b6478)}',
    '.path-guide b{color:var(--dds-ink,#1b1525);font-weight:600}',
    '.path-confirm{margin-top:10px;display:flex;gap:var(--dds-s2,8px);align-items:center;font-size:13.5px;flex-wrap:wrap}',
    '.terminal-chip{font-size:12px;font-weight:600;border-radius:999px;padding:var(--dds-s1,4px) 10px}',
    '.terminal-chip.won{background:var(--dds-good-soft,#e7f1ea);color:var(--dds-good,#33664b)}',
    '.terminal-chip.lost{background:var(--dds-warn-soft,#f3ead9);color:var(--dds-warn,#775d31)}',
    // sales item 124: what to do now, under the stage bar
    '.stage-note{display:flex;gap:18px;align-items:flex-start;margin-top:12px;padding:18px 22px 18px 24px;border-radius:16px;background:var(--dds-p-soft,#efeafa);border-left:5px solid var(--dds-p,#5b3fa0);box-shadow:0 6px 18px -6px rgba(27,21,37,.08)}',
    '.stage-note .sn-ic{flex:0 0 auto;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#7a5bd6,var(--dds-p,#5b3fa0))}',
    '.stage-note .sn-body{flex:1;min-width:0}',
    '.stage-note .sn-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    ".stage-note h3{font-family:'Fraunces','Iowan Old Style',Georgia,serif;font-weight:600;font-size:19px;line-height:1.25;margin:0;color:var(--dds-ink,#1b1525)}",
    '.stage-note .sn-chip{font-size:12px;font-weight:600;color:var(--dds-p,#5b3fa0);background:var(--dds-card,#fff);border-radius:999px;padding:3px 10px}',
    '.stage-note .sn-fact{margin:10px 0 0;padding:9px 12px;border-radius:10px;background:var(--dds-good-soft,#e7f1ea);color:var(--dds-good,#33664b);font-size:14px}',
    '.stage-note .sn-fact b{font-weight:600}',
    '.stage-note .sn-steps{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}',
    '.stage-note .sn-steps li{display:flex;gap:10px;align-items:flex-start;font-size:14.5px;line-height:1.45;color:var(--dds-ink,#1b1525)}',
    '.stage-note .sn-ck{flex:0 0 auto;margin-top:1px;color:var(--dds-p,#5b3fa0)}',
    '.stage-note .sn-foot{margin:10px 0 0;font-size:12.5px;color:var(--dds-faint,#746b8a)}',
    '.stage-note .sn-edit{flex:0 0 auto;font:inherit;font-size:13px;font-weight:600;border:1px solid var(--dds-line-strong,#d6d4e2);background:var(--dds-card,#fff);color:var(--dds-ink,#1b1525);border-radius:999px;padding:7px 14px;min-height:36px;cursor:pointer}',
    '.stage-note .sn-edit:hover{background:var(--dds-card,#fff);border-color:var(--dds-p,#5b3fa0)}',
    '.stage-note .sn-text{display:block;width:100%;box-sizing:border-box;font:inherit;font-size:14.5px;line-height:1.6;padding:12px 14px;margin-top:10px;border:2px solid color-mix(in srgb,var(--dds-p,#5b3fa0) 45%,transparent);border-radius:10px;background:var(--dds-card,#fff);color:var(--dds-ink,#1b1525);resize:vertical}',
    '.stage-note .sn-text:focus{outline:2px solid var(--dds-p,#5b3fa0);outline-offset:1px}',
    '.stage-note .sn-help{font-size:12.5px;color:var(--dds-soft,#6b6478);margin:8px 0 0}',
    '.stage-note .sn-acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}',
    '.stage-note .sn-reset{margin-left:auto;font:inherit;font-size:13px;font-weight:600;color:var(--dds-p,#5b3fa0);background:none;border:none;padding:6px 0;cursor:pointer}',
    '@media (max-width:640px){.stage-note{flex-wrap:wrap;gap:12px;padding:16px}.stage-note .sn-ic{width:36px;height:36px}.stage-note .sn-edit{width:100%;min-height:44px}.stage-note .sn-reset{margin-left:0}}',
  ].join('\n');

  var FLAG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></svg>';
  var CK = '<svg class="sn-ck" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css() {
    if (typeof document === 'undefined' || document.getElementById('dds-deal-path-css')) return;
    var st = document.createElement('style'); st.id = 'dds-deal-path-css'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  // The four step buttons for a deal at `stage` ('won' and 'lost' too: won shows every step
  // done, lost shows them as a closed road). next: the board's legal moves from each stage.
  function steps(o) {
    css();
    var stage = String(o.stage || ''), next = o.next || {}, label = o.label || function (s) { return s; };
    var terminal = stage === 'won' || stage === 'lost', cur = STEPS.indexOf(stage);
    return STEPS.map(function (s, i) {
      var done = stage === 'won' || (cur > -1 && i < cur);
      var current = s === stage;
      var canBack = !terminal && (next[stage] || []).indexOf(s) >= 0 && done;
      var cls = (done ? 'done' : current ? 'current' : (stage === 'lost' ? 'lost-terminal' : '')) + (canBack ? ' canback' : '');
      var state = done ? 'complete' : current ? 'current stage' : 'upcoming';
      var attrs = canBack ? '' : current ? ' aria-expanded="' + (o.guideOpen ? 'true' : 'false') + '"' : ' tabindex="-1" aria-disabled="true"';
      var hint = canBack ? '. Activate to move the deal back here.' : current ? '. Activate to show or hide the stage guidance.' : '';
      return '<button type="button" class="pstep ' + cls + '" data-pstep="' + s + '"' + attrs + ' aria-label="' + esc(label(s)) + ' — ' + state + hint + '">'
        + (done ? '<span class="pck" aria-hidden="true">✓ </span>' : '') + esc(label(s)) + '</button>';
    }).join('');
  }

  // The studio's note for the stage (a starter note until it writes one), with the one line
  // the deal itself knows above it. fact: {tip, action, html?}: html is the page's own action
  // (Pipeline's "Convert them ↓" link), already escaped. buttons: the page's classes for
  // {save, cancel}. Editing changes the note for every deal at that stage (data-needs="configure").
  function noteHtml(o) {
    css();
    var text = o.text || '', fact = o.fact || null, label = o.label || '', b = o.buttons || {};
    if (!text && !fact) return '';   // the deal's own fact shows even when the notes couldn't be read
    var body = !text ? '' : o.editing
      ? '<label class="sr-only" for="snText">What to do now at ' + esc(label) + ', one step a line</label><textarea id="snText" class="sn-text" rows="' + Math.min(9, Math.max(3, text.split('\n').length + 1)) + '">' + esc(text) + '</textarea>'
        + '<p class="sn-help">One step a line, up to eight. Everyone on your team sees this on every deal at ' + esc(label) + '.</p>'
        + '<div class="sn-acts"><button type="button" class="' + esc(b.save || '') + '" id="snSave">Save for every deal</button><button type="button" class="' + esc(b.cancel || '') + '" id="snCancel">Cancel</button>'
        + (o.mine ? '<button type="button" class="sn-reset" id="snReset">Put back the starter note</button>' : '') + '</div>'
      : '<ul class="sn-steps">' + text.split('\n').map(function (l) { return '<li>' + CK + '<span>' + esc(l) + '</span></li>'; }).join('') + '</ul>'
        + '<p class="sn-foot">' + (o.mine ? 'Your studio’s note' : 'A starter note') + ' for every deal at ' + esc(label) + '. Tap ' + esc(label) + ' on the bar to hide it.</p>';
    return '<section class="stage-note" aria-labelledby="snHead"><span class="sn-ic">' + FLAG + '</span><div class="sn-body"><div class="sn-head"><h3 id="snHead">What to do now</h3><span class="sn-chip">' + esc(label) + '</span></div>'
      + (fact ? '<p class="sn-fact"><b>' + esc(fact.tip) + '</b> ' + (fact.html != null ? fact.html : esc(fact.action)) + '</p>' : '')
      + body + '</div>' + (o.editing || !text ? '' : '<button type="button" class="sn-edit" id="snEdit" data-needs="configure">Edit note</button>') + '</section>';
  }

  // Edit opens the note for typing, Cancel and Escape close it, Save (or ⌘/Ctrl+Enter) and
  // "Put back the starter note" hand the text to the page's save(stage, text, button).
  // setEditing(bool) is the page's own flag; repaint() draws the bar and the note again.
  function wireNote(o) {
    var $ = function (id) { return document.getElementById(id); };
    var ed = $('snEdit');
    if (ed) ed.onclick = function () { o.setEditing(true); o.repaint(); var t = $('snText'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } };
    var cancel = function () { o.setEditing(false); o.repaint(); var e = $('snEdit'); if (e) e.focus(); };
    var cn = $('snCancel'); if (cn) cn.onclick = cancel;
    var sv = $('snSave'); if (sv) sv.onclick = function () { o.save(o.stage, $('snText').value, sv); };
    var rs = $('snReset'); if (rs) rs.onclick = function () { o.save(o.stage, '', rs); };
    var tx = $('snText');
    if (tx) tx.onkeydown = function (e) { if (e.key === 'Escape') { e.preventDefault(); cancel(); } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (sv) sv.click(); } };
  }

  window.ddsDealPath = { STEPS: STEPS.slice(), steps: steps, noteHtml: noteHtml, wireNote: wireNote, css: css };
})();
