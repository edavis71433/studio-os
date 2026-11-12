// ── AI help on the sales side (sales item 94, Nov 2026) ──────────────────────────────
// Two pieces the record page (crm.html) and the Inbox (inbox.html) share, as drawn in Figma
// (file HSP7ScFSz2mg1xGzHRrEZi, page 307:6224) and approved by Eric:
//   ddsSalesAi.pill(row, o)      a "Draft it for me" pill: the draft lands in the box for
//                                the owner to change, with Try again and Undo draft. Nothing
//                                is ever sent: Send stays theirs, and waits while it writes.
//   ddsSalesAi.summary(host, o)  "Where things stand": three lines and a Next for a record,
//                                kept with its date, so a later visit shows it without paying
//                                again; Refresh asks again.
// Both ask the server (routes/sales_ai.ts), which says when AI help is off (it starts off for
// every studio), when the day's 50 are used, or when it couldn't; each answer is said here in
// the server's own words. o.req(path, method, body) is the page's own request helper, so a
// press goes out in the page's scope.
(function () {
  if (window.ddsSalesAi) return;
  const SPARK = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="currentColor"><path d="M12 2.5l1.9 5.3 5.3 1.9-5.3 1.9L12 16.9l-1.9-5.3-5.3-1.9 5.3-1.9z"/><path d="M19 14.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z"/></svg>';
  const CLOCK = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SETTINGS = '/settings.html#goal';
  let styled = false;
  function style() {
    if (styled) return; styled = true;
    const st = document.createElement('style');
    st.textContent = ''
      + '.ai-pill{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:600;color:var(--dds-p,#5b3fa0);background:var(--dds-p-soft,#efeafa);border:1px solid color-mix(in srgb,var(--dds-p,#5b3fa0) 22%,transparent);border-radius:999px;padding:6px 14px;min-height:32px;cursor:pointer}'
      + '.ai-pill:hover{background:color-mix(in srgb,var(--dds-p,#5b3fa0) 14%,var(--dds-card,#fff))}.ai-pill:disabled{opacity:.6;cursor:default}'
      + '.ai-hint{font-size:12.5px;color:var(--dds-soft,#6b6478)}'
      + '.ai-band{display:flex;align-items:flex-start;gap:8px 10px;flex-wrap:wrap;margin:8px 0 0;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.45;background:var(--dds-p-soft,#efeafa);color:var(--dds-p-deep,#2a1b4a)}'
      + '.ai-band>svg{flex:0 0 auto;margin-top:2px;color:var(--dds-p,#5b3fa0)}.ai-band .ai-say{flex:1 1 200px;min-width:0}'
      + '.ai-band .ai-acts{display:flex;gap:4px 14px;flex-wrap:wrap;margin-left:auto}'
      + '.ai-band button,.ai-band a{font:inherit;font-size:13px;font-weight:600;color:var(--dds-p,#5b3fa0);background:none;border:0;padding:0;cursor:pointer;text-decoration:none;white-space:nowrap}'
      + '.ai-band button:hover,.ai-band a:hover{text-decoration:underline}'
      + '.ai-band.warn{background:var(--dds-warn-soft,#f3ead9);color:var(--dds-ink,#1b1525)}.ai-band.warn>svg,.ai-band.warn button,.ai-band.warn a{color:var(--dds-warn,#775d31)}'
      + '.ai-band.bad{background:color-mix(in srgb,var(--dds-bad,#9a4242) 12%,var(--dds-card,#fff));color:var(--dds-bad,#9a4242)}.ai-band.bad button{color:var(--dds-bad,#9a4242)}'
      + '.ai-sum{border:1px solid color-mix(in srgb,var(--dds-p,#5b3fa0) 22%,var(--dds-line,#eee9e0));border-radius:var(--dds-r-card,16px);background:var(--dds-card,#fff);padding:14px 16px;box-shadow:var(--dds-shadow,none)}'
      + '.ai-sum .ai-h{display:flex;align-items:center;gap:8px}.ai-sum .ai-h svg{color:var(--dds-p,#5b3fa0);flex:0 0 auto}'
      + '.ai-sum h2{font-family:inherit;font-size:15px;font-weight:650;margin:0;flex:1 1 auto;min-width:0}'
      + '.ai-sum .ai-sub{margin:2px 0 0 24px;font-size:12.5px;color:var(--dds-soft,#6b6478)}'
      + '.ai-sum .ai-go{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 0 24px}'
      + '.ai-sum .ai-ref{font:inherit;font-size:12.5px;font-weight:600;color:var(--dds-p,#5b3fa0);background:none;border:0;padding:0;cursor:pointer;white-space:nowrap}'
      + '.ai-sum ul{margin:10px 0 0;padding:0 0 0 18px;display:grid;gap:6px;font-size:13.5px;line-height:1.45}.ai-sum li::marker{color:var(--dds-p,#5b3fa0)}'
      + '.ai-sum .ai-next{margin:10px 0 0;font-size:13.5px;font-weight:650;color:var(--dds-p,#5b3fa0)}'
      + '.ai-sum .ai-foot{margin:8px 0 0;font-size:12px;color:var(--dds-faint,#746b8a)}'
      + '.ai-sum .ai-band{margin-top:10px}'
      + '@media (pointer:coarse),(max-width:767px){.ai-pill{min-height:44px}.ai-band button,.ai-band a,.ai-sum .ai-ref{min-height:44px;display:inline-flex;align-items:center}}';
    document.head.appendChild(st);
  }
  const bandHtml = (cls, icon, say, acts) => `<div class="ai-band${cls ? ' ' + cls : ''}" role="${cls === 'bad' ? 'alert' : 'status'}">${icon}<span class="ai-say">${esc(say)}</span>${acts ? `<span class="ai-acts">${acts}</span>` : ''}</div>`;
  // what the server said, as a band: off (with Open Settings for the owner), the day's limit, couldn't
  function refusal(r, retry) {
    const b = (r && r.body) || {}, msg = b.message || (r && r.status === 0 ? 'You look offline. Try again when you’re back online.' : 'Couldn’t do that just now. Try again in a moment.');
    if (b.error === 'ai_off') return { cls: 'warn', icon: SPARK, say: msg, acts: b.can_switch ? `<a href="${SETTINGS}">Open Settings</a>` : '' };
    if (b.error === 'day_limit' || b.error === 'resting' || b.error === 'not_ready') return { cls: 'warn', icon: SPARK, say: msg, acts: '' };
    return { cls: 'bad', icon: '', say: msg, acts: retry ? '<button type="button" data-ai="retry">Try again</button>' : '' };
  }

  // a draft taller than its box: the box grows to show it, up to almost half the screen
  function fit(ta) {
    try { const cap = Math.max(160, Math.round(window.innerHeight * 0.45)); if (ta.scrollHeight > ta.clientHeight + 2) ta.style.height = Math.min(ta.scrollHeight + 2, cap) + 'px'; } catch (_) { /* not a text box */ }
  }
  // ── Draft it for me ───────────────────────────────────────────────────────────────
  // o: { req, ta (the box), go (Send, or a list of send buttons: each waits while it writes), payload() → the request's body
  //      without `typed`, writing() → the "Writing a draft from …" words, sendLabel, label, hint,
  //      after (where the band goes: after this element; the box by default) }
  function pill(row, o) {
    style();
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'ai-pill'; btn.innerHTML = SPARK + '<span>' + esc(o.label || 'Draft it for me') + '</span>';
    const hint = document.createElement('span'); hint.className = 'ai-hint'; hint.textContent = o.hint || 'AI help · about 1¢ a draft';
    row.appendChild(btn); row.appendChild(hint);
    let band = null, before = null, seq = 0, goWas = null;
    const gos = () => [].concat(o.go || []).filter(Boolean);
    const anchor = () => o.after || o.ta;
    function show(html) {
      if (!band || !band.isConnected) { band = document.createElement('div'); band.className = 'ai-slot'; anchor().insertAdjacentElement('afterend', band); }
      band.innerHTML = html;
      const r = band.querySelector('[data-ai="retry"]'); if (r) r.onclick = () => draft(before);
      const u = band.querySelector('[data-ai="undo"]'); if (u) u.onclick = () => { o.ta.value = before == null ? '' : before; o.ta.dispatchEvent(new Event('input', { bubbles: true })); clear(); o.ta.focus(); };
      const c = band.querySelector('[data-ai="cancel"]'); if (c) c.onclick = () => { seq++; busy(false); o.ta.value = before == null ? '' : before; clear(); o.ta.focus(); };
    }
    function clear() { if (band) band.innerHTML = ''; }
    function busy(on) {
      btn.disabled = on; o.ta.readOnly = on;
      if (on) { goWas = gos().map((g) => g.disabled); gos().forEach((g) => { g.disabled = true; }); }
      else if (goWas) { gos().forEach((g, i) => { g.disabled = !!goWas[i]; }); goWas = null; }
    }
    async function draft(typed) {
      const mine = ++seq;
      before = typed == null ? o.ta.value : typed;
      busy(true);
      show(bandHtml('', CLOCK, (o.writing && o.writing()) || 'Writing a draft…', '<button type="button" data-ai="cancel">Cancel</button>'));
      let r;
      try { r = await o.req('/sales/ai/draft', 'POST', Object.assign({}, o.payload(), { typed: before, tzo: new Date().getTimezoneOffset() })); } catch (_) { r = { ok: false, status: 0, body: {} }; }
      if (mine !== seq || !o.ta.isConnected) return;   // cancelled, or the box was redrawn
      busy(false);
      const d = r && r.ok && r.body && r.body.data;
      if (!d || !d.text) { o.ta.value = before; const f = refusal(r, true); show(bandHtml(f.cls, f.icon, f.say, f.acts)); return; }
      o.ta.value = d.text; o.ta.dispatchEvent(new Event('input', { bubbles: true }));
      fit(o.ta);
      show(bandHtml('', SPARK, `Drafted by AI from ${d.from || 'this conversation'}. Read it and change anything. Nothing is sent until you press ${o.sendLabel || 'Send'}.`, '<button type="button" data-ai="retry">Try again</button><button type="button" data-ai="undo">Undo draft</button>'));
      o.ta.focus(); try { o.ta.setSelectionRange(0, 0); o.ta.scrollTop = 0; } catch (_) { /* not a text box */ }
    }
    btn.addEventListener('click', () => draft(null));
    return { button: btn, draft };
  }

  // ── Where things stand ──────────────────────────────────────────────────────────
  // o: { req, subject ('deal:<id>'…), query() → the record's keys, who (their first name),
  //      dealToo, newSince(iso) → how many things happened after it }
  function summary(host, o) {
    style();
    const st = { kept: null, fresh: false, busy: false, band: null };
    const dayOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
    function draw() {
      if (!host.isConnected) return;
      const k = st.kept, about = `${o.who ? o.who : 'them'}${o.dealToo ? ' and this deal' : ''}`;
      let html = `<section class="ai-sum" aria-labelledby="aiSumH"><div class="ai-h">${SPARK}<h2 id="aiSumH">Where things stand</h2>${k && !st.busy ? '<button type="button" class="ai-ref" data-ai="go">Refresh</button>' : ''}</div>`;
      if (st.busy) html += bandHtml('', CLOCK, `Writing three lines on ${about}…`, '');
      else if (k) {
        const n = o.newSince ? o.newSince(k.at) : 0;
        html += `<ul>${k.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${k.next ? `<p class="ai-next">Next: ${esc(k.next.replace(/^next:\s*/i, ''))}</p>` : ''}`
          + `<p class="ai-foot">${st.fresh ? 'Written by AI from this record just now' : `Written by AI on ${esc(dayOf(k.at))}${n ? ` · ${n} new thing${n === 1 ? '' : 's'} since then` : ''}`} · check it before you rely on it</p>`;
      } else html += `<p class="ai-sub">Three lines on ${esc(about)}, written from this record: calls, emails, money and to-dos.</p><div class="ai-go"><button type="button" class="ai-pill" data-ai="go">${SPARK}<span>Sum them up</span></button><span class="ai-hint">about 1¢</span></div>`;
      if (st.band && !st.busy) html += bandHtml(st.band.cls, st.band.icon, st.band.say, st.band.acts);
      host.innerHTML = html + '</section>';
      host.querySelectorAll('[data-ai="go"],[data-ai="retry"]').forEach((b) => { b.onclick = ask; });
    }
    async function ask() {
      if (st.busy) return;
      st.busy = true; st.band = null; draw();
      let r;
      try { r = await o.req('/sales/ai/summary', 'POST', Object.assign({}, o.query(), { today: new Date().toLocaleDateString('en-CA') })); } catch (_) { r = { ok: false, status: 0, body: {} }; }
      st.busy = false;
      const s = r && r.ok && r.body && r.body.data && r.body.data.summary;
      if (s && s.lines && s.lines.length) { st.kept = s; st.fresh = true; } else { const f = refusal(r, true); st.band = f; }
      draw();
      // the pressed button was redrawn away: the card's heading takes the focus, so it isn't lost
      const h = host.querySelector('#aiSumH');
      if (h && (!document.activeElement || document.activeElement === document.body)) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
    draw();
    if (o.subject) Promise.resolve(o.req('/sales/ai/summary?subject=' + encodeURIComponent(o.subject))).then((r) => {
      const s = r && r.ok && r.body && r.body.data && r.body.data.summary;
      if (s && s.lines && s.lines.length && !st.kept && !st.busy) { st.kept = s; st.fresh = false; draw(); }
    }, () => { /* the card still offers Sum them up */ });
    return { redraw: draw };
  }

  window.ddsSalesAi = { pill, summary, SPARK };
})();
