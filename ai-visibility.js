/* AI Visibility Check form (ai-visibility.html). Same flow as site-review.js:
   Turnstile, POST to the ai-visibility function, loading steps driven by the
   real progress stream, then the hosted report (teaser + unlock). An
   ambiguous business name comes back as needs_detail: the street or
   neighborhood field appears and the visitor submits again.
   GA4: scan_started, scan_completed, scan_failed (with reason). */
(function () {
  var T = window.DDSTools;
  var $ = function (id) { return document.getElementById(id); };
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var SITE_KEY = LOCAL ? '1x00000000000000000000AA' : '0x4AAAAAAFl7hPNwYacRr2Z2';
  var STEPS = ['asking', 'website', 'reading', 'writing'];
  var widgetId = null;
  var busy = false;
  var turnstileDown = false;   // the bot check never loaded (ad blocker, strict network)

  T.setTool('ai_visibility');

  function renderTurnstile() {
    if (widgetId !== null || !window.turnstile) return;
    try { widgetId = window.turnstile.render('#srTurnstile', { sitekey: SITE_KEY, theme: 'light', size: 'flexible', appearance: 'interaction-only', 'error-callback': function () { turnstileDown = true; return true; } }); } catch (e) { widgetId = null; }
  }
  (function waitForTurnstile(n) {
    if (window.turnstile) { renderTurnstile(); return; }
    if (n > 100) { turnstileDown = true; return; }
    setTimeout(function () { waitForTurnstile(n + 1); }, 100);
  })(0);
  function token() { try { return widgetId !== null && window.turnstile ? window.turnstile.getResponse(widgetId) || '' : ''; } catch (e) { return ''; } }
  function resetTurnstile() { try { if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId); } catch (e) {} }

  var BOT_CHECK_DOWN = 'The quick check that you’re a person (from Cloudflare) couldn’t load. If you use a strict ad blocker or a company network, allow challenges.cloudflare.com and reload this page, or book a call and I’ll run it by hand.';

  // A scan should be over inside about a minute; if the stream stalls (a
  // hung function, a proxy that buffers), say so instead of spinning forever.
  function watchdog() {
    setTimeout(function () { if (busy) fail('connection', 'This is taking longer than it should. Please try again in a minute.'); }, 150000);
  }
  // The back button after a finished scan restores this page from the
  // browser's cache mid-"loading": put the form back.
  window.addEventListener('pageshow', function (e) { if (e.persisted && busy) { busy = false; show('form'); resetTurnstile(); } });

  function setMsg(text, tone) {
    var m = $('srMsg');
    m.textContent = text || '';
    if (tone) m.setAttribute('data-tone', tone); else m.removeAttribute('data-tone');
  }
  function show(which) {
    $('srIntro').hidden = which !== 'form';
    $('srFormCard').hidden = which !== 'form';
    $('srWhat').hidden = which !== 'form';
    $('srLoading').hidden = which !== 'loading';
    $('srError').hidden = which !== 'error';
  }

  var hasUrl = false;
  function markStep(step, detail) {
    var idx = STEPS.indexOf(step);
    var items = $('srSteps').querySelectorAll('li');
    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      var s = li.getAttribute('data-step');
      if (s === 'website') li.hidden = !hasUrl;
      li.setAttribute('data-state', i < idx ? 'done' : i === idx ? 'active' : 'todo');
      if (s === 'asking') li.querySelector('.sr-label').textContent = 'Asking AI what your customers ask' + (step === 'asking' && detail ? ' (' + detail + ')' : '');
      if (s === 'reading') li.querySelector('.sr-label').textContent = 'Reading the answers' + (step === 'reading' && detail ? ' (' + detail + ')' : '');
    }
  }

  function fail(reason, message) {
    busy = false;
    T.track('scan_failed', { reason: reason });
    var titles = { bot_check: 'Our bot check couldn’t load', resting: 'The tools are resting for today', rate_limited: 'That’s a lot of checks for now', engines_failed: 'The AI services didn’t answer' };
    $('srErrorTitle').textContent = titles[reason] || 'We couldn’t finish your check';
    $('srErrorText').textContent = message || 'Something went wrong on our side. Try again in a minute.';
    show('error');
    resetTurnstile();
  }

  function needsDetail(message) {
    busy = false;
    show('form');
    $('srDetailWrap').hidden = false;
    setMsg(message || 'Add the street or neighborhood so we check the right business.', 'error');
    resetTurnstile();
    $('srForm').detail.focus();
    T.track('scan_failed', { reason: 'ambiguous' });
  }

  function done(reportId) {
    T.track('scan_completed', {});
    var items = $('srSteps').querySelectorAll('li');
    for (var i = 0; i < items.length; i++) items[i].setAttribute('data-state', 'done');
    var keep = '';
    try { var api = new URLSearchParams(location.search).get('api'); if (api) keep = '?api=' + encodeURIComponent(api); } catch (e) {}
    location.href = '/report/' + encodeURIComponent(reportId) + keep;
  }

  function handleEvent(ev) {
    if (!ev || typeof ev !== 'object') return false;
    if (ev.type === 'progress') { markStep(ev.step, ev.total ? ev.done + ' of ' + ev.total : ''); return false; }
    if (ev.type === 'done' && ev.report_id) { done(ev.report_id); return true; }
    if (ev.type === 'needs_detail') { needsDetail(ev.message); return true; }
    if (ev.type === 'error') { fail(ev.error || 'failed', ev.message); return true; }
    return false;
  }

  function readStream(res) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';
    var finished = false;
    function pump() {
      return reader.read().then(function (r) {
        if (r.value) buf += decoder.decode(r.value, { stream: !r.done });
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          try { if (handleEvent(JSON.parse(lines[i]))) finished = true; } catch (e) {}
        }
        if (r.done) {
          if (buf.trim()) { try { if (handleEvent(JSON.parse(buf))) finished = true; } catch (e) {} }
          if (!finished) fail('connection', 'The connection dropped before your check finished. Please try again.');
          return;
        }
        return pump();
      });
    }
    return pump();
  }

  $('srForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var f = e.target;
    var name = f.business_name.value.trim(), city = f.city.value.trim(), url = f.url.value.trim();
    f.business_name.setAttribute('aria-invalid', name.length < 2 ? 'true' : 'false');
    f.city.setAttribute('aria-invalid', city.length < 2 ? 'true' : 'false');
    if (name.length < 2) { setMsg('Enter your business name.', 'error'); f.business_name.focus(); return; }
    if (city.length < 2) { setMsg('Enter your city or neighborhood.', 'error'); f.city.focus(); return; }
    if (url && !/^(https?:\/\/)?[^\s\/]+\.[^\s]{2,}/i.test(url)) { setMsg('That website doesn’t look right. Try yourbusiness.com, or leave it blank.', 'error'); f.url.focus(); return; }
    var t = token();
    if (!t) {
      if (turnstileDown || !window.turnstile) { fail('bot_check', BOT_CHECK_DOWN); return; }
      renderTurnstile(); setMsg('One moment while we check you’re a person, then press the button again.', 'error'); return;
    }
    busy = true;
    hasUrl = !!url;
    setMsg('');
    $('srHost').textContent = name;
    markStep('asking', '');
    show('loading');
    T.track('scan_started', { business_type: f.business_type.value, has_website: hasUrl });
    watchdog();

    fetch(T.api('ai-visibility'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name: name, city: city, business_type: f.business_type.value, search_phrases: f.search_phrases.value.trim(), url: url, detail: f.detail.value.trim(), turnstile_token: t }),
    })
      .then(function (res) {
        var type = res.headers.get('content-type') || '';
        if (type.indexOf('ndjson') !== -1 && res.body && res.body.getReader) return readStream(res);
        return res.json().then(function (body) {
          if (res.ok && body && body.type === 'done') { handleEvent(body); return; }
          if (res.status === 400) { busy = false; show('form'); setMsg(body && body.message || 'Check the form and try again.', 'error'); resetTurnstile(); return; }
          fail(body && body.error || 'failed', body && body.message);
        });
      })
      .catch(function () { fail('connection', 'We couldn’t reach our server. Check your connection and try again.'); });
  });

  $('srRetry').addEventListener('click', function () { busy = false; show('form'); resetTurnstile(); $('srForm').business_name.focus(); });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-calendly]');
    if (a) T.track('calendly_clicked', { placement: 'ai_visibility_error' });
  });
})();
