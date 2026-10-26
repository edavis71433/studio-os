/* Free Site Review form (site-review.html). Verifies the visitor with
   Turnstile, posts to the site-review function, and drives the loading steps
   from the function's real progress stream (newline-delimited JSON). When the
   scan is done it opens the hosted report, which shows the teaser and the
   unlock form. GA4: scan_started, scan_completed, scan_failed (with reason). */
(function () {
  var T = window.DDSTools;
  var $ = function (id) { return document.getElementById(id); };
  // The real widget only works on the studio's domains; on localhost, use
  // Cloudflare's published always-pass test key so the page can be tested.
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var SITE_KEY = LOCAL ? '1x00000000000000000000AA' : '0x4AAAAAAFl7hPNwYacRr2Z2';
  var STEPS = ['pages', 'speed', 'search', 'trust', 'writing'];
  var widgetId = null;
  var busy = false;
  var turnstileDown = false;   // the bot check never loaded (ad blocker, strict network)

  T.setTool('site_review');

  function renderTurnstile() {
    if (widgetId !== null || !window.turnstile) return;
    try {
      widgetId = window.turnstile.render('#srTurnstile', { sitekey: SITE_KEY, theme: 'light', size: 'flexible', appearance: 'interaction-only', 'error-callback': function () { turnstileDown = true; return true; } });
    } catch (e) { widgetId = null; }
  }
  // api.js loads async; render as soon as it is there.
  (function waitForTurnstile(n) {
    if (window.turnstile) { renderTurnstile(); return; }
    if (n > 100) { turnstileDown = true; return; }
    setTimeout(function () { waitForTurnstile(n + 1); }, 100);
  })(0);

  function token() {
    try { return widgetId !== null && window.turnstile ? window.turnstile.getResponse(widgetId) || '' : ''; } catch (e) { return ''; }
  }
  function resetTurnstile() {
    try { if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId); } catch (e) {}
  }

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

  function markStep(step, detail) {
    var idx = STEPS.indexOf(step);
    var items = $('srSteps').querySelectorAll('li');
    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      li.setAttribute('data-state', i < idx ? 'done' : i === idx ? 'active' : 'todo');
      if (li.getAttribute('data-step') === 'pages') {
        li.querySelector('.sr-label').textContent = 'Finding your pages' + (step === 'pages' && detail ? ' (' + detail + ')' : '');
      }
    }
  }

  function fail(reason, message) {
    busy = false;
    T.track('scan_failed', { reason: reason });
    var titles = {
      bot_check: 'Our bot check couldn’t load',
      blocked: 'Your site blocked our checker',
      resting: 'The tools are resting for today',
      rate_limited: 'That’s a lot of scans for now',
      unreachable: 'We couldn’t load that address',
    };
    $('srErrorTitle').textContent = titles[reason] || 'We couldn’t finish your review';
    $('srErrorText').textContent = message || 'Something went wrong on our side. Try again in a minute.';
    show('error');
    resetTurnstile();
  }

  function done(reportId) {
    T.track('scan_completed', {});
    markStep('writing');
    var items = $('srSteps').querySelectorAll('li');
    for (var i = 0; i < items.length; i++) items[i].setAttribute('data-state', 'done');
    var keep = '';
    try { var api = new URLSearchParams(location.search).get('api'); if (api) keep = '?api=' + encodeURIComponent(api); } catch (e) {}
    location.href = '/report/' + encodeURIComponent(reportId) + keep;
  }

  function handleEvent(ev) {
    if (!ev || typeof ev !== 'object') return false;
    if (ev.type === 'progress') { markStep(ev.step, ev.step === 'pages' && ev.total ? ev.done + ' of ' + ev.total : ''); return false; }
    if (ev.type === 'done' && ev.report_id) { done(ev.report_id); return true; }
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
          if (!finished) fail('connection', 'The connection dropped before your review finished. Please try again.');
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
    var form = e.target;
    var url = form.url.value.trim();
    if (!/^(https?:\/\/)?[^\s\/]+\.[^\s]{2,}/i.test(url)) {
      form.url.setAttribute('aria-invalid', 'true');
      setMsg('Enter your website address, like yourbusiness.com.', 'error');
      form.url.focus();
      return;
    }
    form.url.setAttribute('aria-invalid', 'false');
    var t = token();
    if (!t) {
      if (turnstileDown || !window.turnstile) { fail('bot_check', BOT_CHECK_DOWN); return; }
      renderTurnstile();
      setMsg('One moment while we check you’re a person, then press the button again.', 'error');
      return;
    }
    busy = true;
    setMsg('');
    var host = url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    $('srHost').textContent = host;
    markStep('pages', '');
    show('loading');
    T.track('scan_started', { business_type: form.business_type.value });
    watchdog();

    fetch(T.api('site-review'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, business_type: form.business_type.value, city: form.city.value.trim(), turnstile_token: t }),
    })
      .then(function (res) {
        var type = res.headers.get('content-type') || '';
        if (type.indexOf('ndjson') !== -1 && res.body && res.body.getReader) return readStream(res);
        return res.json().then(function (body) {
          if (res.ok && body && body.type === 'done') { handleEvent(body); return; }
          fail(body && body.error || 'failed', body && body.message);
        });
      })
      .catch(function () { fail('connection', 'We couldn’t reach our server. Check your connection and try again.'); });
  });

  $('srRetry').addEventListener('click', function () {
    busy = false;
    show('form');
    resetTurnstile();
    $('srForm').url.focus();
  });

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-calendly]');
    if (a) T.track('calendly_clicked', { placement: 'site_review_error' });
  });

  // Prefill from ?url= (links from the main site's Free tools page).
  try {
    var pre = new URLSearchParams(location.search).get('url');
    if (pre) $('srForm').url.value = pre.slice(0, 500);
  } catch (e) {}
})();
