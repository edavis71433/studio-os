/* ============================================================
   Davis Digital Studio — nav.js
   Shared, sitewide chrome behavior. Progressive enhancement only:
   every interaction here already works via CSS (:hover/:focus-within
   for the mega-menu) or plain markup (the burger toggles a class).
   This file adds keyboard convenience — Escape to close, aria-expanded
   sync, focus return — on top of behavior that functions without it.
   No dependencies. Loaded with `defer` on every marketing page.
   ============================================================ */
(function(){
  'use strict';

  var burgers = document.querySelectorAll('.burger');
  var subs = document.querySelectorAll('.nav-has-sub');

  // At mobile widths the CSS force-shows the submenu (styles.css keeps
  // .nav-sub visible ≤880px, both inline and inside the drawer), so the
  // toggle link is not a disclosure control there — leaving it claiming
  // aria-expanded="false" over a visible menu would be a lie. Strip the
  // popup ARIA on mobile; restore the collapsed-popup semantics on desktop,
  // where hover/focus genuinely opens and closes it.
  var mobileMq = window.matchMedia('(max-width:880px)');
  function syncSubAria(){
    subs.forEach(function(sub){
      var toggle = sub.querySelector('.nav-sub-toggle');
      if(!toggle) return;
      if(mobileMq.matches){
        toggle.removeAttribute('aria-haspopup');
        toggle.removeAttribute('aria-expanded');
      } else if(!toggle.hasAttribute('aria-expanded')){
        toggle.setAttribute('aria-haspopup', 'true');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
  syncSubAria();
  if(mobileMq.addEventListener) mobileMq.addEventListener('change', syncSubAria);
  else if(mobileMq.addListener) mobileMq.addListener(syncSubAria);

  // ---- Mobile drawer ----------------------------------------------------
  burgers.forEach(function(btn){
    btn.addEventListener('click', function(){
      var open = document.body.classList.toggle('mobile-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  // ---- Mega-menu: aria-expanded sync + Escape-to-close ------------------
  subs.forEach(function(sub){
    var toggle = sub.querySelector('.nav-sub-toggle');
    if(!toggle) return;

    // Guards the single focusin that results from this script calling
    // toggle.focus() after Escape — without it, that programmatic focus
    // would immediately re-trigger :focus-within-driven "open" logic and
    // the menu would appear to reopen on the same frame it just closed.
    var suppressNextOpen = false;

    function open(){
      if(suppressNextOpen){ suppressNextOpen = false; return; }
      sub.classList.remove('closed');
      if(!mobileMq.matches) toggle.setAttribute('aria-expanded', 'true');
    }
    function close(){
      if(!mobileMq.matches) toggle.setAttribute('aria-expanded', 'false');
    }
    sub.addEventListener('mouseenter', open);
    sub.addEventListener('mouseleave', function(){
      sub.classList.remove('closed'); // a real mouse-driven interaction cancels any stale escape-close
      close();
    });
    sub.addEventListener('focusin', open);
    sub.addEventListener('focusout', function(e){
      // only close if focus left the whole submenu group, not moving
      // between two links inside it. A NULL relatedTarget is NOT "focus left
      // the document": iOS Safari blurs on tap without focusing anything, so
      // acting on it mid-tap would flip aria-expanded to "false" over a menu
      // that is still on screen (:hover/:focus-within drive the visuals) — and
      // any future close() that hides the menu would eat the tap outright.
      var to = e.relatedTarget;
      if(!to) return;                       // iOS tap / focus left the document — keep open
      if(!sub.contains(to)) close();
    });

    sub.escapeClose = function(){
      sub.classList.add('closed');
      if(!mobileMq.matches) toggle.setAttribute('aria-expanded', 'false');
      suppressNextOpen = true;
      toggle.focus();
    };
  });

  // ---- Escape key: close whichever layer is open, return focus ---------
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;

    if(document.body.classList.contains('mobile-open')){
      document.body.classList.remove('mobile-open');
      burgers.forEach(function(btn){ btn.setAttribute('aria-expanded', 'false'); });
      if(burgers[0]) burgers[0].focus();
      return;
    }

    for(var i=0; i<subs.length; i++){
      var sub = subs[i];
      if(sub.matches(':hover') || sub.matches(':focus-within')){
        sub.escapeClose();
        break;
      }
    }
  });
})();
