// ── The one frame around the pages a client lands on without signing in (builder item 349) ──
// A page not found, the terms and privacy pages, a link that isn't working, the unsubscribe
// page and the two pages after paying used to carry no studio at all, or the product's own
// marketing look. This script draws the one frame they share: a band in the studio's colour
// with its logo or name, a plain card for the page's own words, and a footer line with the
// studio's name and the contact details it already shows on its own website.
//
// The page carries the frame's three hooks in its HTML (so nothing jumps when the studio's
// name arrives): [data-pf-band] > [data-pf-studio], [data-pf-card], and [data-pf-foot]. It
// loads public-frame.css in <head> (the look is there before the body paints) and this
// script deferred; a page's own script that needs window.PublicFrame waits for
// DOMContentLoaded, which comes after every deferred script has run.
//
// The frame learns the studio, in this order:
//   1. ?studio=<site id> on the address (the links in a studio's emails carry it, the same
//      one the sign-in page reads): GET /public/studio/<id>/brand, public and cached 15 min.
//      The answer is remembered in localStorage 'dds-studio-brand' (the key the sign-in page
//      and the client portal write), so the next page the same person opens knows at once.
//   2. the remembered 'dds-studio-brand', when there is one.
//   3. nothing: the band keeps the product's plum and names no one. No product name is
//      ever shown to a client here.
// The name and logo fade in; the band's height is reserved so the words below never move.
// The band's words are white: the server's accent is already darkened until white reads on
// it (lib/brand_kit.ts readableOnWhiteText), and a remembered accent came from that server.
(function () {
  var PROD = 'https://qksstlqzbhesadrrofgn.supabase.co', STAGING = 'https://wjlpursnwbmlcdwbeowv.supabase.co';
  var q; try { q = new URLSearchParams(location.search); } catch (e) { q = { get: function () { return null; } }; }
  var FN = (q.get('env') === 'staging' ? STAGING : PROD) + '/functions/v1/presence';
  var HEX = /^#[0-9a-f]{6}$/i, ID = /^[0-9a-f-]{36}$/;


  // a hex mixed toward another: the band's dark edge, and a lighter link colour for dark mode
  function mix(h, to, k) {
    return '#' + [1, 3, 5].map(function (i) {
      var a = parseInt(h.substr(i, 2), 16), z = parseInt(to.substr(i, 2), 16);
      return ('0' + Math.round(a + (z - a) * k).toString(16)).slice(-2);
    }).join('');
  }
  function remembered() {
    try {
      var b = JSON.parse(localStorage.getItem('dds-studio-brand') || 'null');
      return b && typeof b.name === 'string' && b.name.trim() ? b : null;
    } catch (e) { return null; }
  }
  function remember(b) {
    try {
      var old = remembered() || {};
      localStorage.setItem('dds-studio-brand', JSON.stringify({
        name: b.name, logo_url: b.logo_url || null, accent: b.accent || '',
        signin: b.signin || old.signin || null, contact: b.contact || null,
      }));
    } catch (e) { /* storage may be denied */ }
  }
  function cleanName(b) { return b && typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim().slice(0, 80) : ''; }
  function cleanContact(b) {
    var c = b && b.contact && typeof b.contact === 'object' ? b.contact : {};
    var email = typeof c.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim()) ? c.email.trim().slice(0, 120) : '';
    var phone = typeof c.phone === 'string' ? c.phone.replace(/[^\d+() .-]/g, '').trim().slice(0, 32) : '';
    return { email: email, phone: phone };
  }
  function shown(el) {
    if (!el) return;
    // the next frame, so the fade runs even when the words were filled on the first paint
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('pf-shown'); }); });
  }

  var current = null, drawn = false;
  /** Draws a studio on the frame: logo or mark + name on the band, the footer line, the colour, the title. */
  function paint(b) {
    var name = cleanName(b);
    if (!name) return;
    current = { name: name, logo_url: typeof b.logo_url === 'string' && /^https:\/\//.test(b.logo_url) ? b.logo_url : null, accent: HEX.test(b.accent || '') ? b.accent : '', contact: cleanContact(b) };
    var box = document.querySelector('[data-pf-studio]');
    drawn = !!box;
    if (box) {
      box.textContent = '';
      if (current.logo_url) {
        var img = document.createElement('img'); img.src = current.logo_url; img.alt = name; img.decoding = 'async';
        // a logo that won't load shows the name instead, never a broken picture
        img.onerror = function () { current.logo_url = null; paint(current); };
        box.appendChild(img);
      } else {
        var mark = document.createElement('span'); mark.className = 'pf-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = name.charAt(0).toUpperCase();
        var word = document.createElement('span'); word.textContent = name;
        box.appendChild(mark); box.appendChild(word);
      }
      shown(box);
    }
    var foot = document.querySelector('[data-pf-foot]');
    if (foot) {
      foot.textContent = '';
      var who = document.createElement('span'); who.textContent = name; foot.appendChild(who);
      var add = function (href, text) {
        var item = document.createElement('span'); item.className = 'pf-item';
        var dot = document.createElement('span'); dot.className = 'pf-dot'; dot.setAttribute('aria-hidden', 'true'); dot.textContent = '·';
        var a = document.createElement('a'); a.href = href; a.textContent = text;
        item.appendChild(dot); item.appendChild(a); foot.appendChild(item);
      };
      if (current.contact.email) add('mailto:' + current.contact.email, current.contact.email);
      if (current.contact.phone) add('tel:' + current.contact.phone.replace(/[^\d+]/g, ''), current.contact.phone);
      shown(foot);
    }
    if (current.accent) {
      var root = document.documentElement.style;
      root.setProperty('--pf-band-b', current.accent);
      root.setProperty('--pf-band-a', mix(current.accent, '#140c1f', 0.45));
      root.setProperty('--pf-accent', current.accent);
      root.setProperty('--pf-link', current.accent);
      root.setProperty('--pf-link-dark', mix(current.accent, '#ffffff', 0.55));
    }
    try {
      var t = document.title || '';
      if (t && t.indexOf(' | ' + name) < 0) document.title = t + ' | ' + name;
    } catch (e) { /* nothing to do */ }
    document.dispatchEvent(new CustomEvent('pf:brand', { detail: current }));
  }

  // a fetch that gives up: the page must read fine with no answer
  function withTimeout(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }

  var waiting = [];
  var known = new Promise(function (resolve) { waiting.push(resolve); });
  function settle(b) { waiting.splice(0).forEach(function (r) { r(b); }); }

  // what the browser already knows, drawn once (a page's own script may ask before the body is done)
  var synced = false;
  function sync() {
    if (synced) { if (current && !drawn) paint(current); return current; }
    synced = true;
    var old = remembered();
    if (old) paint(old);
    return current;
  }
  function boot() {
    sync();
    var id = String(q.get('studio') || '');
    if (!ID.test(id)) id = '';
    if (!id) { settle(current); return; }
    withTimeout(fetch(FN + '/public/studio/' + id + '/brand', { headers: { Accept: 'application/json' } }), 6000)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var b = j && j.data;
        if (b && b.name && !b.is_default) { paint(b); remember(b); }
        settle(current);
      })
      .catch(function () { settle(current); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.PublicFrame = {
    fn: FN,
    paint: paint,
    /** Resolves with the studio the frame knows (or null) once the address and the memory were read. */
    known: known,
    /** The studio drawn right now (the remembered one, if nothing newer was painted yet), or null. */
    studio: sync,
    remembered: remembered,
  };
})();
