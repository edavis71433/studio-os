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
      toggle.setAttribute('aria-expanded', 'true');
    }
    function close(){
      toggle.setAttribute('aria-expanded', 'false');
    }
    sub.addEventListener('mouseenter', open);
    sub.addEventListener('mouseleave', function(){
      sub.classList.remove('closed'); // a real mouse-driven interaction cancels any stale escape-close
      close();
    });
    sub.addEventListener('focusin', open);
    sub.addEventListener('focusout', function(e){
      // only close if focus left the whole submenu group, not moving
      // between two links inside it
      if(!sub.contains(e.relatedTarget)) close();
    });

    sub.escapeClose = function(){
      sub.classList.add('closed');
      toggle.setAttribute('aria-expanded', 'false');
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
