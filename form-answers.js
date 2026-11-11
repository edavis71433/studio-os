// ── Builder list item 147: one form's own table of answers ───────────────────
// Opened from the website editor's Forms card ("Answers" on a form). It reads GET
// /forms/answers?form=<id>&page=<slug> through the editor's own signed-in api(), and
// shows the answers as a table: the form's questions as columns, newest first (a file
// question shows its files' names); how many are new; and, over the last 30 days, how many visitors saw a
// page the form is on against how many sent it. "Download spreadsheet" saves the same
// table as a CSV file that Excel, Numbers and Google Sheets open. Each row links to the
// enquiry in the Inbox, where it is answered and its files open. Loaded on first use
// (presence.html loadFormAnswers); bump its ?v= there when this file changes.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // a cell a spreadsheet would read as a formula starts with a quote mark instead
  const csvCell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const sentOn = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const STATUS = { new: 'New', read: 'Read', replied: 'Replied', not_a_fit: 'Not a fit', archived: 'Not a fit', converted: 'In pipeline' };
  // the form's questions as columns (a "Photo or file" answer is its files' names), between when and where it stands
  const columns = (form) => [{ key: '__sent', label: 'Sent' }, ...form.fields.map((f) => ({ key: f.key, label: f.label })), { key: '__status', label: 'Status' }];
  const cell = (row, c) => (c.key === '__sent' ? sentOn(row.created_at) : c.key === '__status' ? (STATUS[row.status] || '') : String((row.values || {})[c.key] || ''));

  /** The table as a CSV file's text (with the mark that tells Excel it is UTF-8). */
  function csv(data) {
    const cols = columns(data.form);
    const lines = [cols.map((c) => csvCell(c.label)).join(',')].concat((data.rows || []).map((r) => cols.map((c) => csvCell(cell(r, c))).join(',')));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
  function fileName(title) {
    const slug = String(title || 'form').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'form';
    return `${slug}-answers-${new Date().toISOString().slice(0, 10)}.csv`;
  }
  function seenLine(l) {
    if (!l) return '';
    if (l.seen == null) return `In the last 30 days ${l.sent} sent it. Visits to its page couldn’t be counted just now.`;
    if (!l.seen) return `In the last 30 days ${l.sent} sent it. No visits to its page were counted.`;
    const pct = Math.round((l.sent / l.seen) * 1000) / 10;
    return `In the last 30 days about ${l.seen} visitor${l.seen === 1 ? '' : 's'} saw it and ${l.sent} sent it (${pct}%).`;
  }

  const CSS = `.fa-dlg{width:min(1000px,calc(100vw - 24px));max-height:calc(100vh - 32px);margin:auto;border:0;border-radius:18px;padding:0;color:var(--ink,#1b1525);background:var(--sheet,#fff);box-shadow:0 24px 64px rgba(20,12,40,.28)}
.fa-dlg::backdrop{background:rgba(20,12,40,.38)}
.fa-in{display:flex;flex-direction:column;max-height:calc(100vh - 32px)}
.fa-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px 10px}
.fa-head h2{margin:0;font-size:18px;flex:1}
.fa-sub{margin:4px 0 0;color:var(--ink-3,#6b6478);font-size:13.5px}
.fa-x{border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:inherit;padding:4px 8px;border-radius:8px}
.fa-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:0 20px 12px}
.fa-bar button{font:inherit;font-size:13px;font-weight:600;border-radius:999px;padding:7px 14px;cursor:pointer;border:1px solid var(--plum,#5b3fa0);background:var(--plum,#5b3fa0);color:#fff}
.fa-bar button:disabled{opacity:.5;cursor:default}
.fa-scroll{overflow:auto;border-top:1px solid var(--hair,#e8e3ef);padding:0 0 8px}
.fa-t{border-collapse:collapse;width:100%;font-size:13.5px}
.fa-t th,.fa-t td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--hair,#eee9f3);vertical-align:top;max-width:280px;overflow-wrap:anywhere}
.fa-t th{position:sticky;top:0;background:var(--sheet,#fff);font-size:12.5px;color:var(--ink-3,#6b6478);font-weight:600}
.fa-t tr.is-new td:first-child{font-weight:700}
.fa-t a{color:var(--plum,#5b3fa0)}
.fa-empty{padding:28px 20px;color:var(--ink-3,#6b6478)}
@media (max-width:640px){.fa-dlg{width:100vw;max-width:100vw;height:100%;max-height:100%;margin:0;border-radius:0}.fa-in{max-height:100%}}`;
  let styled = false;

  /** Open the answers of one form. `get(route)` is the page's signed-in GET. */
  async function open(o) {
    if (!styled) { const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); styled = true; }
    const dlg = document.createElement('dialog');
    dlg.className = 'fa-dlg';
    dlg.setAttribute('aria-labelledby', 'faTitle');
    dlg.innerHTML = `<div class="fa-in"><div class="fa-head"><div style="flex:1;min-width:0"><h2 id="faTitle">Answers to “${esc(o.title || 'this form')}”</h2><p class="fa-sub" id="faSub">Loading…</p><p class="fa-sub" id="faSeen"></p></div><button type="button" class="fa-x" aria-label="Close">×</button></div>
<div class="fa-bar"><button type="button" id="faCsv" disabled>Download spreadsheet</button></div><div class="fa-scroll" id="faBody"></div></div>`;
    document.body.appendChild(dlg);
    const close = () => { dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); if (o.opener && o.opener.focus) o.opener.focus(); });
    dlg.querySelector('.fa-x').addEventListener('click', close);
    dlg.showModal();
    let data;
    try {
      const q = `/forms/answers?form=${encodeURIComponent(o.formId)}${o.page ? `&page=${encodeURIComponent(o.page)}` : ''}`;
      data = (await o.get(q)).data;
    } catch (e) {
      dlg.querySelector('#faSub').textContent = (e && e.message) || 'The answers couldn’t load just now. Try again in a moment.';
      return dlg;
    }
    const rows = data.rows || [];
    const n = rows.length;
    dlg.querySelector('#faSub').textContent = n ? `${data.more ? `Your newest ${n}` : `${n} answer${n === 1 ? '' : 's'}`} · ${data.new} new` : 'No answers yet';
    dlg.querySelector('#faSeen').textContent = seenLine(data.last30);
    const body = dlg.querySelector('#faBody');
    if (!n) { body.innerHTML = '<p class="fa-empty">When someone sends this form, their answers show here, one row each.</p>'; return dlg; }
    const cols = columns(data.form);
    body.innerHTML = `<table class="fa-t"><thead><tr>${cols.map((c) => `<th scope="col">${esc(c.label)}</th>`).join('')}<th scope="col"><span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Open</span></th></tr></thead><tbody>${
      rows.map((r) => `<tr class="${r.status === 'new' ? 'is-new' : ''}">${cols.map((c) => `<td>${esc(cell(r, c))}</td>`).join('')}<td><a href="/inbox.html#enquiries?sel=lead:${encodeURIComponent(r.id)}">Open</a></td></tr>`).join('')
    }</tbody></table>`;
    const dl = dlg.querySelector('#faCsv');
    dl.disabled = false;
    dl.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([csv(data)], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = fileName(data.form && data.form.title); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    return dlg;
  }

  window.DDSFormAnswers = { open, csv, fileName, seenLine };
})();
