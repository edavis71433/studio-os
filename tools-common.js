/* Free Tools: shared browser helpers for the report page and (Phase 2+) the
   two tool pages. Exposes window.DDSTools:
     api(path)       absolute URL of a Free Tools edge function
     track(event, p) GA4 event, always tagged with the tool name. A no-op until
                     the visitor allows analytics (analytics.js is consent-gated).
   Spec events: scan_started, scan_completed, scan_failed (with reason),
   email_captured, report_viewed, calendly_clicked, pdf_downloaded. */
(function () {
  if (window.DDSTools) return;

  var API = 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1';
  // Local testing only: ?api=http://localhost:8787 points the page at a local
  // server. Ignored on any real host, so a crafted link can't swap the backend.
  try {
    var host = location.hostname;
    var override = new URLSearchParams(location.search).get('api');
    if (override && (host === 'localhost' || host === '127.0.0.1') && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(override)) API = override;
  } catch (e) {}

  var tool = null;

  window.DDSTools = {
    api: function (path) { return API + '/' + String(path).replace(/^\//, ''); },
    setTool: function (t) { tool = t; },
    track: function (event, params) {
      var p = Object.assign({ tool_name: tool || 'unknown' }, params || {});
      try { if (typeof window.gtag === 'function') window.gtag('event', event, p); } catch (e) {}
      try { (window.__ddsToolEvents = window.__ddsToolEvents || []).push([event, p]); } catch (e) {}
    },
  };
})();
