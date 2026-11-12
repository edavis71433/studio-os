// ── Builder list item 150: is the site usable by everyone? ───────────────────
// The editor reads each page of the draft the way it is drawn and looks for what an owner
// can fix: photos without a description, words too faint for their background, buttons and
// links that only say "Click here", a page with no main heading, a form box with no name.
// (A page still called "New page" is found from the page list, by the editor.) Each finding
// names its section, so its button can open the exact card that fixes it. Nothing here
// changes a page. Loaded only when the check runs; the wording lives here so the fix list,
// the Publish card and Site health all say the same thing.
(function (root) {
  'use strict';
  const KINDS = ['photo', 'faint', 'name', 'link', 'heading', 'field'];   // worst first
  const DOC_KINDS = ['photo', 'faint', 'link', 'heading', 'field'];       // what one drawn page is checked for
  const VAGUE = /^(click here|click|here|read more|learn more|more|more info|info|details|this|link|go|see more|view more|continue)[.!…»›→\s]*$/i;
  const NEW_PAGE = /^(new|untitled) page(\s*\d+)?$/i;

  // WCAG's own sums, on [r, g, b] in 0..255
  const chan = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  /** "rgb(1, 2, 3)", "rgba(1 2 3 / .5)" or "#abc" to [r, g, b, a]; null for anything else. */
  function parseColor(s) {
    s = String(s || '').trim();
    let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (m) { const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]; return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1); }
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const n = p.slice(0, 3).map((v) => /%$/.test(v) ? parseFloat(v) * 2.55 : parseFloat(v));
    const a = p[3] == null ? 1 : /%$/.test(p[3]) ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    return n.some((v) => Number.isNaN(v)) || Number.isNaN(a) ? null : n.concat(a);
  }
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  /** Words this big read at 3 to 1; everything else needs 4.5 to 1. */
  const needs = (px, weight) => (px >= 24 || (px >= 18.66 && weight >= 700)) ? 3 : 4.5;

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const cut = (s, n) => { s = clean(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

  /** Where a finding sits: the section the owner added (its place on the page), or the page's own part. */
  function whereOf(el) {
    const sec = el.closest('[data-dds-src]');
    if (sec) {
      const h = sec.querySelector('h1,h2,h3,[data-dds-field="title"]');
      return { src: Number(sec.getAttribute('data-dds-src')), sid: sec.getAttribute('data-dds-sid') || '', label: cut(h && h.textContent, 48) };
    }
    const core = el.closest('[data-dds-core]');
    if (core) { const h = core.querySelector('h1,h2,h3'); return { src: null, core: core.getAttribute('data-dds-core') || '', label: cut(h && h.textContent, 48) }; }
    if (el.closest('header,nav')) return { src: null, core: 'header', label: 'The top of the page' };
    if (el.closest('footer')) return { src: null, core: 'footer', label: 'The foot of the page' };
    return { src: null, core: '', label: '' };
  }
  const keyOf = (w) => (w.src != null ? 's' + w.src : 'c' + (w.core || ''));

  function shown(el, win) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = win.getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (e.getAttribute('aria-hidden') === 'true' || e.hasAttribute('hidden')) return false;
      // words kept for screen readers only are drawn one pixel square
      if (cs.position === 'absolute' && (parseFloat(cs.width) <= 1 || parseFloat(cs.height) <= 1)) return false;
    }
    return true;
  }
  /** What is drawn behind an element: null when a photo or a gradient is, since that can't be judged from here. */
  function behind(el, win) {
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = win.getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parseColor(cs.backgroundColor);
      if (!c) { if (cs.backgroundColor && cs.backgroundColor !== 'transparent') return null; continue; }
      if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let bg = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return bg;
  }
  const named = (el, doc) => {
    if (clean(el.getAttribute('aria-label')) || clean(el.getAttribute('title'))) return true;
    const by = el.getAttribute('aria-labelledby');
    if (by && by.split(/\s+/).some((id) => { const t = doc.getElementById(id); return t && clean(t.textContent); })) return true;
    return false;
  };

  /** One drawn page's findings, grouped by kind and section. */
  function checkDocument(doc, win) {
    win = win || doc.defaultView;
    const out = new Map();
    const add = (kind, el, more) => {
      const w = whereOf(el), k = kind + '|' + keyOf(w);
      const f = out.get(k) || { kind, ...w, n: 0 };
      f.n++;
      if (more) more(f);
      out.set(k, f);
    };
    const skip = (el) => !!el.closest('#presence-preview-badge,[data-dds-ui],script,style,noscript,template');
    const body = doc.body; if (!body) return [];

    body.querySelectorAll('img').forEach((img) => {
      if (skip(img) || !shown(img, win)) return;
      if (Number(img.getAttribute('width')) === 1 || Number(img.getAttribute('height')) === 1) return;
      const role = img.getAttribute('role');
      if (clean(img.getAttribute('alt')) || role === 'presentation' || role === 'none' || named(img, doc)) return;
      if (img.closest('a,button') && clean(img.closest('a,button').textContent)) return;   // the words beside it name the link
      add('photo', img);
    });

    const seen = new Set();
    const walker = doc.createTreeWalker(body, 4 /* text */);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!clean(t.nodeValue)) continue;
      const el = t.parentElement;
      if (!el || seen.has(el) || skip(el)) continue;
      seen.add(el);
      if (!shown(el, win)) continue;
      const cs = win.getComputedStyle(el);
      const fg0 = parseColor(cs.color); if (!fg0) continue;
      const bg = behind(el, win); if (!bg) continue;
      const fg = over(fg0, bg);
      const r = ratio(fg, bg), min = needs(parseFloat(cs.fontSize) || 16, Number(cs.fontWeight) || 400);
      if (r + 0.005 >= min) continue;
      add('faint', el, (f) => { if (f.ratio == null || r < f.ratio) { f.ratio = Math.round(r * 10) / 10; f.min = min; f.fg = hex(fg); f.bg = hex(bg); f.words = cut(el.textContent, 40); } });
    }

    body.querySelectorAll('a[href],button,[role="button"]').forEach((el) => {
      if (skip(el) || !shown(el, win)) return;
      if (el.tagName === 'BUTTON' && (el.type === 'submit' || el.closest('form'))) { if (clean(el.textContent) || named(el, doc)) return; }
      let words = clean(el.textContent);
      if (!words) { const img = el.querySelector('img[alt]'); words = clean(img && img.getAttribute('alt')); }
      if (!words && (named(el, doc) || el.querySelector('svg title'))) return;
      if (words && !VAGUE.test(words)) return;
      if (words && named(el, doc)) return;   // a fuller name is given to screen readers
      add('link', el, (f) => { if (f.words == null) f.words = words; });
    });

    if (!body.querySelector('h1')) add('heading', body, (f) => { f.src = null; f.core = 'page'; f.label = ''; });

    body.querySelectorAll('input,select,textarea').forEach((el) => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return;
      if (skip(el) || el.closest('[aria-hidden="true"],.hp') || el.tabIndex === -1) return;
      if (named(el, doc) || el.closest('label')) return;
      if (el.id) { const esc = el.id.replace(/["\\]/g, '\\$&'); if (clean((doc.querySelector('label[for="' + esc + '"]') || {}).textContent)) return; }
      add('field', el);
    });
    return [...out.values()];
  }

  const quote = (s) => '“' + s + '”';
  /** One row of the fix list, in the words the owner reads. */
  function rowFor(page, f) {
    const where = [page.title, f.label].filter(Boolean).join(' · ');
    const base = { kind: f.kind, slug: page.slug, page: page.title, src: f.src == null ? null : f.src, core: f.core || '', where, n: f.n || 1 };
    if (f.kind === 'photo') return { ...base, title: f.n === 1 ? 'A photo has no description' : f.n + ' photos have no description', why: 'Screen readers say “image” and nothing more; search engines lose the words too.', fix: f.src == null ? 'Open the page' : f.n === 1 ? 'Describe it' : 'Describe them', worst: (f.n === 1 ? 'A photo' : f.n + ' photos') + ' on ' + page.title + (f.n === 1 ? ' has' : ' have') + ' no description.' };
    if (f.kind === 'faint') return { ...base, ratio: f.ratio, min: f.min, fg: f.fg, bg: f.bg, title: 'Words too faint for their background', why: f.ratio.toFixed(1) + ' to 1 now. ' + (f.min === 3 ? 'Big headings need 3 to 1.' : 'Easy reading needs 4.5 to 1.'), fix: 'Pick colours', worst: 'Words on ' + page.title + ' are too faint for their background.' };
    if (f.kind === 'name') return { ...base, where: page.title, title: 'A page is still called ' + quote(page.title), why: 'It’s the name in the browser tab and in Google.', fix: 'Rename', worst: 'A page is still called ' + quote(page.title) + '.' };
    if (f.kind === 'link') {
      const w = clean(f.words);
      return { ...base, title: w ? 'A button only says ' + quote(w) : 'A button has no words', why: w ? 'Say where it goes: “See the menu”.' : 'Screen readers can’t say where it goes.', fix: f.src == null ? 'Open the page' : 'Change words', worst: (w ? 'A button on ' + page.title + ' only says ' + quote(w) : 'A button on ' + page.title + ' has no words') + '.' };
    }
    if (f.kind === 'heading') return { ...base, where: page.title, title: 'A page has no main heading', why: 'Screen readers and Google use it to say what the page is about.', fix: 'Open the page', worst: page.title + ' has no main heading.' };
    return { ...base, title: f.n === 1 ? 'A form box has no name' : f.n + ' form boxes have no name', why: 'Screen readers can’t say what to type there.', fix: 'Open the page', worst: 'A form box on ' + page.title + ' has no name.' };
  }

  /** Every page's findings as one list, worst first, with what passed and the line Site health shows.
   *  pages: [{ slug, title, findings }], findings from checkDocument (null when a page couldn't be read). */
  function summarize(pages) {
    const rows = []; let passed = 0, unread = 0;
    (pages || []).forEach((p) => {
      const page = { slug: p.slug || '', title: clean(p.title) || 'Home' };
      const found = Array.isArray(p.findings) ? p.findings.slice() : null;
      const newName = !!p.slug && NEW_PAGE.test(page.title);
      if (newName) rows.push(rowFor(page, { kind: 'name' })); else passed++;
      if (!found) { unread++; return; }
      found.forEach((f) => rows.push(rowFor(page, f)));
      DOC_KINDS.forEach((k) => { if (!found.some((f) => f.kind === k)) passed++; });
    });
    const order = (r) => KINDS.indexOf(r.kind);
    rows.sort((a, b) => order(a) - order(b) || (a.kind === 'faint' ? a.ratio - b.ratio : b.n - a.n));
    return { rows, fix: rows.length, passed, unread, worst: rows.length ? rows[0].worst : '' };
  }

  /** What only a person can judge: three ticks, kept with the site. */
  const TICKS = [
    ['photo_words', 'Words inside photos (a menu, a flyer) are also written on the page'],
    ['zoom', 'The site still reads well zoomed to 200%'],
    ['captions', 'Videos have captions'],
  ];
  /** The Publish card's line under "Usable by everyone". */
  function publishLine(fix, toCheck) {
    const a = fix ? fix + (fix === 1 ? ' thing to fix' : ' things to fix') : 'Nothing to fix';
    return toCheck ? a + ' · ' + toCheck + ' to check yourself' : a;
  }

  root.DDSA11Y = { KINDS, TICKS, VAGUE, NEW_PAGE, parseColor, ratio, needs, hex, checkDocument, rowFor, summarize, publishLine };
})(typeof window !== 'undefined' ? window : globalThis);
