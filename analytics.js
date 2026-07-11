/* Davis Digital Studio — shared, consent-gated analytics + cookie banner.
   ONE place for GA + consent (was inline-duplicated / missing on key pages).
   Idempotent + safe to include anywhere: it no-ops if GA is already loaded on
   the page, so pages with the legacy inline snippet are unaffected.
   Fixes the audit's #1 finding: contact.html fired generate_lead with no GA. */
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
      '<span style="flex:1;min-width:200px;color:rgba(255,255,255,.8);line-height:1.5">I use privacy-friendly analytics to understand which pages help visitors most. See the <a href="/privacy" style="color:#c4aee8;text-decoration:underline">Privacy Policy</a>.</span>' +
      '<span style="display:flex;gap:8px;flex-shrink:0">' +
      '<button type="button" id="ddsCookieOk" style="background:#5b3fa0;color:#fff;border:none;padding:9px 20px;border-radius:100px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Got it</button>' +
      '<button type="button" id="ddsCookieNo" style="background:transparent;color:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.22);padding:9px 16px;border-radius:100px;font-size:13px;cursor:pointer;font-family:inherit">Decline</button>' +
      '</span>';
    document.body.appendChild(b);
    document.getElementById('ddsCookieOk').addEventListener('click', function () {
      try { localStorage.setItem('cookie_consent', 'accepted'); } catch (e) {}
      b.remove();
      loadGA();
    });
    document.getElementById('ddsCookieNo').addEventListener('click', function () {
      try { localStorage.setItem('cookie_consent', 'declined'); } catch (e) {}
      window['ga-disable-' + GA_ID] = true;
      b.remove();
    });
  }

  if (document.body) setTimeout(showBanner, 1500);
  else window.addEventListener('DOMContentLoaded', function () { setTimeout(showBanner, 1500); });
})();
