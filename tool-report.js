/* Free Tools report page: /report/<id>. Loads the report from the tool-report
   function (the server already cut a locked report down to its teaser), draws
   it, and handles the unlock form. Everything from the report is drawn with
   textContent, never parsed as HTML: business names and page titles come from the
   visitor's own site and are untrusted. */
(function () {
  var T = window.DDSTools;
  var $ = function (id) { return document.getElementById(id); };
  var CAL = 'https://calendly.com/eric-davisdigitalstudio/30min';

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    if (text != null) n.textContent = String(text);
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function tone(score) { return score == null ? null : score >= 80 ? 'strong' : score >= 60 ? 'work' : 'fix'; }
  var TONE_COLOR = { strong: '#2f6b4f', work: '#b08d57', fix: '#b4483a' };

  function reportId() {
    var m = location.pathname.match(/\/report\/([0-9a-f-]{36})\/?$/i);
    if (m) return m[1];
    try { return new URLSearchParams(location.search).get('id') || ''; } catch (e) { return ''; }
  }

  function showError(text) {
    $('trLoading').hidden = true;
    $('trReport').hidden = true;
    if (text) $('trErrorText').textContent = text;
    $('trError').hidden = false;
  }

  function scoreRing(score) {
    var box = $('trScore');
    clear(box);
    var r = 58, c = 2 * Math.PI * r, pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 136 136');
    svg.setAttribute('aria-hidden', 'true');
    [['#f3efe6', 1], [TONE_COLOR[tone(score)] || '#b08d57', pct]].forEach(function (s) {
      var circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', '68'); circle.setAttribute('cy', '68'); circle.setAttribute('r', String(r));
      circle.setAttribute('fill', 'none'); circle.setAttribute('stroke', s[0]); circle.setAttribute('stroke-width', '10');
      circle.setAttribute('stroke-linecap', 'round');
      circle.setAttribute('stroke-dasharray', (c * s[1]).toFixed(1) + ' ' + c.toFixed(1));
      svg.appendChild(circle);
    });
    box.appendChild(svg);
    var num = el('div', { class: 'tr-score-num' });
    num.appendChild(el('strong', null, score == null ? '–' : score));
    num.appendChild(el('span', null, 'out of 100'));
    box.appendChild(num);
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', score == null ? 'Overall score not available' : 'Overall score ' + score + ' out of 100');
  }

  function drawPillars(pillars) {
    var wrap = $('trPillars');
    clear(wrap);
    wrap.hidden = !pillars.length;
    pillars.forEach(function (p) {
      var card = el('div', { class: 'tr-pillar' });
      card.appendChild(el('p', { class: 'tr-pillar-name' }, p.name));
      if (p.score == null) {
        card.appendChild(el('p', { class: 'tr-pillar-score' }, '–'));
        card.appendChild(el('p', { class: 'tr-pillar-none' }, p.note || "Couldn't measure today"));
      } else {
        var s = el('p', { class: 'tr-pillar-score' }, Math.round(p.score));
        s.appendChild(el('small', null, ' / 100'));
        card.appendChild(s);
        var bar = el('div', { class: 'tr-bar' });
        var fill = el('i');
        fill.style.width = Math.max(0, Math.min(100, p.score)) + '%';
        fill.style.background = TONE_COLOR[tone(p.score)];
        bar.appendChild(fill);
        card.appendChild(bar);
      }
      wrap.appendChild(card);
    });
  }

  function drawHighlights(items) {
    var wrap = $('trHighlights');
    clear(wrap);
    wrap.hidden = !items.length;
    items.forEach(function (h) {
      var card = el('div', { class: 'tr-highlight' });
      card.appendChild(el('p', { class: 'tr-highlight-label' }, h.label));
      card.appendChild(el('p', { class: 'tr-highlight-value' }, h.value));
      wrap.appendChild(card);
    });
  }

  function drawFindings(r) {
    var wrap = $('trFindings');
    clear(wrap);
    $('trFindingsWrap').hidden = !r.findings.length;
    $('trFindingsTitle').textContent = r.unlocked ? 'What we found' : 'Two things we found';
    r.findings.forEach(function (f) {
      var card = el('div', { class: 'tr-finding' });
      var tags = el('div', { class: 'tr-finding-tags' });
      if (f.priority) tags.appendChild(el('span', { class: 'tr-tag', 'data-p': f.priority }, f.priority));
      if (f.pillar) tags.appendChild(el('span', { class: 'tr-tag tr-tag-pillar' }, f.pillar));
      card.appendChild(tags);
      card.appendChild(el('h3', null, f.title));
      var dl = el('dl');
      [['What we found', f.what_we_found], ['Why it matters', f.why_it_matters], ['The fix', f.fix]].forEach(function (pair) {
        if (!pair[1]) return;
        var row = el('div');
        row.appendChild(el('dt', null, pair[0]));
        row.appendChild(el('dd', null, pair[1]));
        dl.appendChild(row);
      });
      card.appendChild(dl);
      wrap.appendChild(card);
    });
  }

  function drawTopThree(items) {
    var list = $('trTopThree');
    clear(list);
    $('trTopThreeWrap').hidden = !items.length;
    items.forEach(function (t) { list.appendChild(el('li', null, t)); });
  }

  function drawTables(tables) {
    var wrap = $('trTables');
    clear(wrap);
    tables.forEach(function (t) {
      var sec = el('section');
      sec.appendChild(el('h2', null, t.title));
      if (t.note) sec.appendChild(el('p', { class: 'tr-table-note' }, t.note));
      // A table with nothing measured (PageSpeed down) shows its note only.
      if (!(t.rows || []).length) { wrap.appendChild(sec); return; }
      var box = el('div', { class: 'tr-table-wrap' });
      var table = el('table', { class: 'tr-table' });
      var thead = el('thead'), hr = el('tr');
      (t.columns || []).forEach(function (c) { hr.appendChild(el('th', { scope: 'col' }, c)); });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = el('tbody');
      (t.rows || []).forEach(function (row) {
        var tr = el('tr');
        row.forEach(function (cell) { tr.appendChild(el('td', null, cell == null || cell === '' ? '–' : cell)); });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      box.appendChild(table);
      sec.appendChild(box);
      wrap.appendChild(sec);
    });
  }

  function unlockCopy(r) {
    var more = r.findings_total - r.findings.length;
    var bits = [];
    if (more > 0) bits.push(more + ' more finding' + (more === 1 ? '' : 's'));
    else if (r.findings_total > 0) bits.push('every finding');
    bits.push('the three fixes that matter most');
    bits.push(r.tool === 'ai_visibility' ? 'who AI recommends instead and which sources it trusts' : 'a page-by-page breakdown');
    return 'See ' + bits.join(', ') + '. We’ll email you a link to keep.';
  }

  var current = null;

  function render(r) {
    current = r;
    T.setTool(r.tool);
    document.title = r.tool_name + (r.business.name ? ' for ' + r.business.name : '') + ' | Davis Digital Studio';
    $('trTool').textContent = 'Free ' + r.tool_name;
    $('trBusiness').textContent = r.business.name || r.business.url || 'Your report';
    var meta = [];
    if (r.business.url && r.business.name) meta.push(r.business.url);
    if (r.business.city) meta.push(r.business.city);
    if (r.created_at) {
      try { meta.push(new Date(r.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })); } catch (e) {}
    }
    $('trMeta').textContent = meta.join(' · ');

    scoreRing(r.overall);
    var label = $('trLabel');
    label.textContent = r.label || 'Score not available';
    label.setAttribute('data-tone', tone(r.overall) || 'work');
    $('trSummary').textContent = r.summary;
    var notes = $('trNotes');
    clear(notes);
    (r.notes || []).forEach(function (n) { notes.appendChild(el('li', null, n)); });

    drawHighlights(r.highlights || []);
    drawPillars(r.pillars || []);
    drawTopThree(r.top_three || []);
    drawFindings(r);
    drawTables(r.tables || []);

    $('trUnlock').hidden = r.unlocked;
    if (!r.unlocked) $('trUnlockWhat').textContent = unlockCopy(r);
    $('trPdf').hidden = !r.unlocked;
    $('trClosingText').textContent = r.closing.text;
    $('trClosingBtn').href = r.closing.url || CAL;

    $('trLoading').hidden = true;
    $('trError').hidden = true;
    $('trReport').hidden = false;
  }

  function load() {
    var id = reportId();
    if (!id) { showError("This link is missing its report number. Check the link in your email."); return; }
    fetch(T.api('tool-report?id=' + encodeURIComponent(id)), { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (out) {
        if (!out.ok || !out.body.report) { showError(out.body && out.body.message); return; }
        render(out.body.report);
        T.track('report_viewed', { unlocked: out.body.report.unlocked, overall: out.body.report.overall });
      })
      .catch(function () { showError("The report couldn't load just now. Check your connection and try again."); });
  }

  function setMsg(text, kind) {
    var m = $('trUnlockMsg');
    m.textContent = text || '';
    if (kind) m.setAttribute('data-tone', kind); else m.removeAttribute('data-tone');
  }

  $('trUnlockForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!current) return;
    var form = e.target;
    var email = form.email.value.trim();
    var valid = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(email);
    form.email.setAttribute('aria-invalid', valid ? 'false' : 'true');
    if (!valid) { setMsg('Enter a valid email address.', 'error'); form.email.focus(); return; }
    var btn = $('trUnlockBtn');
    btn.disabled = true;
    btn.textContent = 'Unlocking…';
    setMsg('');
    fetch(T.api('unlock-report'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_id: current.id, email: email, name: form.name.value.trim(), consent_marketing: form.consent_marketing.checked }),
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (out) {
        if (!out.ok || !out.body.report) {
          btn.disabled = false;
          btn.textContent = 'Show my full report';
          setMsg((out.body && out.body.message) || 'Something went wrong. Try again in a minute.', 'error');
          return;
        }
        T.track('email_captured', { consent_marketing: form.consent_marketing.checked });
        render(out.body.report);
        $('trNotes').appendChild(el('li', null, out.body.email_queued || out.body.emailed ? 'Done. A copy should reach ' + email + ' in a few minutes. Bookmark this page just in case.' : 'Done. We can\'t email that address, so bookmark this page to come back to it.'));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Show my full report';
        setMsg("We couldn't reach the server. Check your connection and try again.", 'error');
      });
  });

  $('trPdf').addEventListener('click', function () {
    T.track('pdf_downloaded');
    window.print();
  });

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-calendly]');
    if (a) T.track('calendly_clicked', { placement: a.id === 'trClosingBtn' ? 'closing' : 'error' });
  });

  load();
})();
