/* ============================================================
   Davis Digital Studio — enhance.js
   One job: add `.is-scrolled` to .nav once the user leaves the
   hero, so the frosted-glass nav state in enhance.css activates.

   Written to be INP-safe (the Core Web Vital most sites fail):
   - passive scroll listener (never blocks the main thread)
   - requestAnimationFrame throttle (at most one DOM write/frame)
   - reads a class toggle, not layout, so it can't thrash

   HOW TO USE — add once, just before </body>, after your other
   scripts:

     <script src="/enhance.js" defer></script>

   Cache rule already exists in _headers (/*.js = 1 day).
   ============================================================ */
(function () {
  "use strict";

  var nav = document.querySelector(".nav");
  if (!nav) return;

  // Trigger a little before the nav's own height so the state
  // change feels anchored to leaving the hero, not arbitrary.
  var THRESHOLD = 24;
  var ticking = false;
  var lastState = false;

  function apply() {
    ticking = false;
    var scrolled = window.scrollY > THRESHOLD;
    if (scrolled === lastState) return; // no-op if unchanged
    lastState = scrolled;
    nav.classList.toggle("is-scrolled", scrolled);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  apply(); // set correct state on load (e.g. refreshed mid-page)
})();

/* Booking-click tracking: fires a GA4 event when any Calendly booking link is clicked.
   Added once here so it covers every page that loads enhance.js, no per-link edits. */
(function () {
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href*="calendly.com/eric-davisdigitalstudio"]');
    if (!a) return;
    if (typeof gtag === "function") {
      gtag("event", "book_call_click", { location: window.location.pathname });
    }
  }, true);
})();
