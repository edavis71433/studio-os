/* Davis Digital Studio — shared, consent-gated analytics + consent banner.
   ONE place for GA + consent across every public page (all legacy inline GA
   snippets have been replaced with this include). Default is deny: nothing
   loads and no analytics cookies are set until the visitor explicitly allows
   it. Idempotent and safe to include anywhere. */
(function () {
  if (window.__ddsAnalytics) return;
  window.__ddsAnalytics = true;

  var GA_ID = 'G-V4WF04NX7F';
  var consent = null;
  try { consent = localStorage.getItem('cookie_consent'); } catch (e) {}

  function loadGA() {
    if (window.gtag && window.__ddsGaLoaded) return;
    window.__ddsGaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { anonymize_ip: true });
  }

  // If a page already loaded GA inline, respect it and only manage consent state.
  var alreadyInline = typeof window.gtag === 'function';

  if (consent === 'declined') {
    window['ga-disable-' + GA_ID] = true;
  } else if (consent === 'accepted' && !alreadyInline) {
    loadGA();
  }

  // Banner only when the visitor hasn't decided yet.
  if (consent) return;

  function showBanner() {
    if (document.getElementById('ddsCookie') || document.getElementById('cookieBanner')) return;
    var b = document.createElement('div');
    b.id = 'ddsCookie';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Cookie consent');
    b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99998;background:#2A1B4A;color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;font-family:Inter,-apple-system,sans-serif;font-size:13px;box-shadow:0 -4px 20px rgba(0,0,0,.15)';
    b.innerHTML =
      '<span style="flex:1;min-width:200px;color:rgba(255,255,255,.8);line-height:1.5">Okay to use privacy-friendly analytics to see which pages help visitors most? Nothing runs unless you say yes &mdash; the site works fine either way. See the <a href="/privacy" style="color:#c4aee8;text-decoration:underline">Privacy Policy</a>.</span>' +
      '<span style="display:flex;gap:8px;flex-shrink:0">' +
      '<button type="button" id="ddsCookieOk" style="background:#FBFAF7;color:#1B1525;border:none;padding:10px 20px;border-radius:2px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Allow analytics</button>' +
      '<button type="button" id="ddsCookieNo" style="background:transparent;color:rgba(255,255,255,.75);border:1px solid rgba(255,255,255,.28);padding:9px 16px;border-radius:2px;font-size:13px;cursor:pointer;font-family:inherit">No thanks</button>' +
      '</span>';
    document.body.appendChild(b);

    // The full-width banner (z-index 99998) sits on top of the concierge
    // launcher (.dds-cc-launch, fixed bottom:24px, z-index 99995). While the
    // banner is visible, lift the launcher above it; restore on dismiss.
    // The launcher may be injected after the banner (concierge.js loads
    // independently), and the banner's height changes when its text wraps,
    // so re-check on an interval while the banner is on screen.
    function shiftLauncher() {
      var l = document.querySelector('.dds-cc-launch');
      if (!l) return;
      var h = b.offsetHeight || 0;
      l.style.bottom = (24 + h) + 'px';
    }
    var launcherWatch = setInterval(function () {
      if (!document.body.contains(b)) { clearInterval(launcherWatch); return; }
      shiftLauncher();
    }, 500);
    shiftLauncher();
    function restoreLauncher() {
      clearInterval(launcherWatch);
      var l = document.querySelector('.dds-cc-launch');
      if (l) l.style.bottom = '';
    }

    document.getElementById('ddsCookieOk').addEventListener('click', function () {
      try { localStorage.setItem('cookie_consent', 'accepted'); } catch (e) {}
      b.remove();
      restoreLauncher();
      loadGA();
    });
    document.getElementById('ddsCookieNo').addEventListener('click', function () {
      try { localStorage.setItem('cookie_consent', 'declined'); } catch (e) {}
      window['ga-disable-' + GA_ID] = true;
      b.remove();
      restoreLauncher();
    });
  }

  if (document.body) setTimeout(showBanner, 1500);
  else window.addEventListener('DOMContentLoaded', function () { setTimeout(showBanner, 1500); });
})();
