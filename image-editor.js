// ── The photo editor (builder items 39 + 117) ────────────────────────────────
// Crop to a shape (square, 4:3, 16:9 and others), rotate and flip, seven
// sliders, named filters drawn on the owner's own photo, and "Remove a plain
// background" for logos and photos on a plain wall. Everything happens in the
// browser on the photo's own pixels: no server work, no outside service, and
// nothing to download beyond this file.
//
// It NEVER touches the original. open() hands the finished picture to the
// page's onSave, and the Files page stores it as a NEW file beside the original
// (files.html saveEdited). Replace was ruled out on purpose: a replaced file is
// soft-deleted, and media_gc removes its stored object after 7 days.
//
// One self-contained file, so the builder's photo picker (presence.html) can
// load the same editor later: <script src="/image-editor.js?v=1">, then
// DDSImageEditor.open({ src, name, mime, onSave }). Bump ?v= on every change:
// _headers lets browsers keep a .js file for a day.
//
// The pure core (geometry, colour, the cut-out) touches no DOM, so
// tests/presence/image_editor_test.mjs imports this file in Deno and checks it
// on plain pixel arrays; tests/e2e/image-editor.spec.ts drives the dialog.
(function (root) {
  'use strict';

  // ═══ shapes, sliders and filters ═══════════════════════════════════════════
  // ratio: null = free, 'original' = the photo's own proportions, else w/h.
  const SHAPES = [
    { key: 'free', label: 'Free', ratio: null },
    { key: 'original', label: 'Original', ratio: 'original' },
    { key: 'square', label: 'Square', ratio: 1 },
    { key: '4:3', label: '4:3', ratio: 4 / 3 },
    { key: '3:2', label: '3:2', ratio: 3 / 2 },
    { key: '16:9', label: '16:9', ratio: 16 / 9 },
    { key: '4:5', label: '4:5', ratio: 4 / 5 },     // a portrait post
    { key: '9:16', label: '9:16', ratio: 9 / 16 },  // a story
  ];
  // The seven sliders. fade and sepia have no slider: only filters use them.
  const ADJUST = [
    { key: 'brightness', label: 'Brightness' },
    { key: 'contrast', label: 'Contrast' },
    { key: 'saturation', label: 'Saturation' },
    { key: 'warmth', label: 'Warmth' },
    { key: 'highlights', label: 'Highlights' },
    { key: 'shadows', label: 'Shadows' },
    { key: 'vignette', label: 'Vignette', min: 0 },   // darker corners
  ];
  // Named filters: plain words, each a set of the same settings the sliders
  // move, so Strength scales a filter and the sliders still work on top of it.
  const FILTERS = [
    { key: 'none', label: 'Original', p: {} },
    { key: 'bright', label: 'Bright', p: { brightness: 24, contrast: 8, shadows: 14 } },
    { key: 'warm', label: 'Warm', p: { warmth: 45, saturation: 10, brightness: 4 } },
    { key: 'cool', label: 'Cool', p: { warmth: -42, contrast: 6 } },
    { key: 'vivid', label: 'Vivid', p: { saturation: 45, contrast: 18 } },
    { key: 'soft', label: 'Soft', p: { fade: 35, contrast: -12, saturation: -12, brightness: 6 } },
    { key: 'golden', label: 'Golden', p: { warmth: 60, highlights: 15, saturation: 15, fade: 10 } },
    { key: 'mono', label: 'Black & white', p: { saturation: -100, contrast: 10 } },
    { key: 'dramatic', label: 'Dramatic', p: { saturation: -100, contrast: 45, shadows: -20, vignette: 35 } },
    { key: 'vintage', label: 'Vintage', p: { sepia: 60, fade: 25, contrast: -6, vignette: 30 } },
  ];
  const PARAM_KEYS = ['brightness', 'contrast', 'saturation', 'warmth', 'highlights', 'shadows', 'vignette', 'fade', 'sepia'];
  const RANGE = { vignette: [0, 100], fade: [0, 100], sepia: [0, 100] };   // the rest run -100 to 100
  // The saved picture: at most 3840 px on its long side and 12 megapixels
  // (a phone's 4032×3024 photo comes out 3840×2880), under the upload door's
  // 10 MB. Big enough for any website, small enough for a phone's canvas.
  const MAX_EDGE = 3840, MAX_AREA = 12e6, MAX_BYTES = 10 * 1024 * 1024 - 64 * 1024;
  const FULL = { x: 0, y: 0, w: 1, h: 1 };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const tidy = (r) => {
    const n = (v) => Math.round(clamp(v, 0, 1) * 1e6) / 1e6;
    const x = n(r.x), y = n(r.y);
    return { x, y, w: Math.min(n(r.w), 1 - x), h: Math.min(n(r.h), 1 - y) };
  };

  // ═══ geometry — rectangles are normalised (0 to 1) in the turned picture ═══
  function orientedSize(w, h, rot) { return rot % 180 ? { w: h, h: w } : { w, h }; }
  /** The pixel width-to-height ratio a shape holds, or null for Free. */
  function shapeRatio(key, turned, Wo, Ho) {
    const s = SHAPES.find((x) => x.key === key) || SHAPES[0];
    if (s.ratio === null) return null;
    if (s.ratio === 'original') return Wo / Ho;
    return turned ? 1 / s.ratio : s.ratio;
  }
  /** What a shape's button says: 4:3 turned tall reads 3:4. */
  function shapeLabel(key, turned) {
    const s = SHAPES.find((x) => x.key === key) || SHAPES[0];
    if (!turned || typeof s.ratio !== 'number' || s.ratio === 1) return s.label;
    return s.label.split(':').reverse().join(':');
  }
  /** The biggest rectangle of that ratio, in the middle of the picture. */
  function largestRect(ratio, Wo, Ho) {
    if (!ratio) return { ...FULL };
    let w = 1, h = 1;
    if (Wo / Ho > ratio) w = (ratio * Ho) / Wo; else h = Wo / (ratio * Ho);
    return tidy({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  }
  function minSide(Wo, Ho) { return Math.max(8, Math.min(Wo, Ho) * 0.02); }
  function moveRect(r, dx, dy) {
    return tidy({ x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h), w: r.w, h: r.h });
  }
  /** Drag one handle (n, s, e, w or a corner) by dx, dy (normalised), from the
   *  rectangle the drag started on. A held ratio keeps its shape: a corner keeps
   *  the opposite corner still and follows whichever way the pull moved more
   *  (so a pull straight sideways still resizes), an edge keeps the middle of
   *  the other two sides. */
  function resizeRect(r, handle, dx, dy, ratio, Wo, Ho) {
    const m = minSide(Wo, Ho);
    let L = r.x * Wo, T = r.y * Ho, R = (r.x + r.w) * Wo, B = (r.y + r.h) * Ho;
    const DX = dx * Wo, DY = dy * Ho;
    const n = handle.includes('n'), s = handle.includes('s'), w = handle.includes('w'), e = handle.includes('e');
    if (!ratio) {
      if (w) L = clamp(L + DX, 0, R - m);
      if (e) R = clamp(R + DX, L + m, Wo);
      if (n) T = clamp(T + DY, 0, B - m);
      if (s) B = clamp(B + DY, T + m, Ho);
    } else if ((n || s) && (w || e)) {
      const ax = e ? L : R, ay = s ? T : B;
      const w1 = e ? R + DX - L : R - (L + DX), h1 = s ? B + DY - T : B - (T + DY);
      const lo = Math.max(m, m * ratio), hi = Math.min(e ? Wo - ax : ax, (s ? Ho - ay : ay) * ratio);
      if (hi < lo) return { ...r };
      const w0 = R - L, byH = h1 * ratio;
      const ww = clamp(Math.abs(w1 - w0) >= Math.abs(byH - w0) ? w1 : byH, lo, hi), hh = ww / ratio;
      if (e) { L = ax; R = ax + ww; } else { R = ax; L = ax - ww; }
      if (s) { T = ay; B = ay + hh; } else { B = ay; T = ay - hh; }
    } else if (w || e) {
      const cy = (T + B) / 2;
      const lo = Math.max(m, m * ratio), hi = Math.min(e ? Wo - L : R, 2 * Math.min(cy, Ho - cy) * ratio);
      if (hi < lo) return { ...r };
      const ww = clamp(e ? R + DX - L : R - (L + DX), lo, hi), hh = ww / ratio;
      if (e) R = L + ww; else L = R - ww;
      T = cy - hh / 2; B = cy + hh / 2;
    } else {
      const cx = (L + R) / 2;
      const lo = Math.max(m, m / ratio), hi = Math.min(s ? Ho - T : B, (2 * Math.min(cx, Wo - cx)) / ratio);
      if (hi < lo) return { ...r };
      const hh = clamp(s ? B + DY - T : B - (T + DY), lo, hi), ww = hh * ratio;
      if (s) B = T + hh; else T = B - hh;
      L = cx - ww / 2; R = cx + ww / 2;
    }
    return tidy({ x: L / Wo, y: T / Ho, w: (R - L) / Wo, h: (B - T) / Ho });
  }
  /** The crop turns with the picture: dir 1 is a quarter turn clockwise. */
  function rotateRect(r, dir) {
    return tidy(dir > 0 ? { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w } : { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w });
  }
  function flipRect(r, axis) {
    return tidy(axis === 'h' ? { x: 1 - r.x - r.w, y: r.y, w: r.w, h: r.h } : { x: r.x, y: 1 - r.y - r.h, w: r.w, h: r.h });
  }
  /** Whole pixels of the turned picture, never empty, never past an edge. */
  function cropPixels(r, Wo, Ho) {
    const x = clamp(Math.round(r.x * Wo), 0, Wo - 1), y = clamp(Math.round(r.y * Ho), 0, Ho - 1);
    return { x, y, w: clamp(Math.round(r.w * Wo), 1, Wo - x), h: clamp(Math.round(r.h * Ho), 1, Ho - y) };
  }
  function capOutput(w, h, maxEdge = MAX_EDGE, maxArea = MAX_AREA) {
    const s = Math.min(1, maxEdge / Math.max(w, h), Math.sqrt(maxArea / (w * h)));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scaled: s < 1 };
  }

  // ═══ colour ═════════════════════════════════════════════════════════════════
  /** The sliders plus the filter at its strength, each held to its range. */
  function combineParams(adjust, filterKey, strength) {
    const f = FILTERS.find((x) => x.key === filterKey) || FILTERS[0];
    const k = clamp(Number.isFinite(strength) ? strength : 100, 0, 100) / 100;
    const out = {};
    for (const key of PARAM_KEYS) {
      const [lo, hi] = RANGE[key] || [-100, 100];
      out[key] = clamp((Number(adjust && adjust[key]) || 0) + (Number(f.p[key]) || 0) * k, lo, hi);
    }
    return out;
  }
  const isNeutral = (p) => PARAM_KEYS.every((k) => !p[k]);
  /** One tone curve for all three channels, 0 to 1 in and out. Every step keeps
   *  black and white where they are or moves them gently, and none reverses
   *  the order of two tones (the tests hold every slider end to that). */
  function toneLut(p) {
    const b = p.brightness / 100, c = p.contrast / 100, hi = p.highlights / 100, sh = p.shadows / 100, fade = p.fade / 100;
    const gamma = Math.pow(2, -b * 0.9);
    const C = c * 160, k = (259 * (C + 255)) / (255 * (259 - C));
    const lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let x = Math.pow(i / 255, gamma);
      x = clamp((x - 0.5) * k + 0.5, 0, 1);
      // 0.35 over a 0.6-wide band keeps each curve's slope above zero at the
      // slider's end (0.4 over 0.55 dipped below it: Shadows +100 reversed tones)
      const wH = smooth(0.4, 1, x), wS = 1 - smooth(0, 0.6, x);
      x += hi * 0.35 * wH * (hi > 0 ? 1 - x : x);
      x += sh * 0.35 * wS * (sh > 0 ? 1 - x : x);
      x = fade * 0.14 + x * (1 - fade * 0.24);
      lut[i] = clamp(x, 0, 1);
    }
    return lut;
  }
  /** Warmth tips red up and blue down (cool is the reverse), on the tone curve. */
  function channelLuts(p) {
    const base = toneLut(p), t = p.warmth / 100;
    return [1 + 0.16 * t, 1 + 0.04 * t, 1 - 0.16 * t].map((g) => {
      const L = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) L[i] = base[i] * g * 255;
      return L;
    });
  }
  const mul3 = (A, B) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return o; };
  /** Saturation (toward or away from each pixel's own grey), then sepia. */
  function colorMatrix(p) {
    const s = 1 + p.saturation / 100, lr = 0.2126, lg = 0.7152, lb = 0.0722;
    let m = [lr * (1 - s) + s, lg * (1 - s), lb * (1 - s), lr * (1 - s), lg * (1 - s) + s, lb * (1 - s), lr * (1 - s), lg * (1 - s), lb * (1 - s) + s];
    const q = p.sepia / 100;
    if (q > 0) {
      const S = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
      m = mul3(S.map((v, i) => (1 - q) * (i % 4 === 0 ? 1 : 0) + q * v), m);
    }
    return m;
  }
  /** Colour every pixel in place (RGBA). `region` is where the photo really is
   *  in this buffer, which the vignette centres on. Alpha is never touched. */
  function applyPixels(data, w, h, p, region) {
    if (isNeutral(p)) return;
    const [LR, LG, LB] = channelLuts(p), m = colorMatrix(p);
    const same = m.every((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) < 1e-9);
    const vig = p.vignette / 100;
    let vx = null, vy = null;
    if (vig > 0) {
      const g = region || { x: 0, y: 0, w, h };
      vx = new Float32Array(w); vy = new Float32Array(h);
      for (let x = 0; x < w; x++) { const d = ((x + 0.5 - g.x) / g.w - 0.5) * 2; vx[x] = d * d; }
      for (let y = 0; y < h; y++) { const d = ((y + 0.5 - g.y) / g.h - 0.5) * 2; vy[y] = d * d; }
    }
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i += 4) {
        let r = LR[data[i]], g = LG[data[i + 1]], b = LB[data[i + 2]];
        if (!same) {
          const r2 = m[0] * r + m[1] * g + m[2] * b, g2 = m[3] * r + m[4] * g + m[5] * b, b2 = m[6] * r + m[7] * g + m[8] * b;
          r = r2; g = g2; b = b2;
        }
        if (vx) { const f = 1 - vig * 0.65 * smooth(0.3, 1.05, Math.sqrt((vx[x] + vy[y]) / 2)); r *= f; g *= f; b *= f; }
        data[i] = r; data[i + 1] = g; data[i + 2] = b;   // a Uint8ClampedArray rounds and clamps
      }
    }
  }

  // ═══ the plain-background cut-out ═══════════════════════════════════════════
  // The colour at the photo's edges is the background. Starting from the edges,
  // every touching pixel close to that colour turns see-through (a flood fill,
  // so a white shirt in the middle of a white wall's photo survives unless
  // "inside" asks for every match). A pixel on the boundary is part background
  // and part subject: it keeps as much of itself as it is "of" its most solid
  // neighbour, and loses the background's tint, so a logo keeps a smooth edge.
  const dist2 = (data, i, ref) => { const dr = data[i] - ref.r, dg = data[i + 1] - ref.g, db = data[i + 2] - ref.b; return dr * dr + dg * dg + db * db; };
  const near = (data, i, ref, thr2) => dist2(data, i, ref) <= thr2;
  /** The edge colour (the middle value of each channel along all four edges),
   *  or null when the edges are already see-through. */
  function edgeColor(data, w, region) {
    const g = region, rs = [], gs = [], bs = [];
    const step = Math.max(1, Math.floor((2 * (g.w + g.h)) / 2400));
    const take = (x, y) => { const i = ((g.y + y) * w + g.x + x) * 4; if (data[i + 3] < 16) return; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); };
    for (let x = 0; x < g.w; x += step) { take(x, 0); take(x, g.h - 1); }
    for (let y = 0; y < g.h; y += step) { take(0, y); take(g.w - 1, y); }
    if (!rs.length) return null;
    const mid = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
    return { r: mid(rs), g: mid(gs), b: mid(bs) };
  }
  /** amount 0 to 100 (how far from the edge colour still counts as background),
   *  inside = also clear matching colour the edges don't reach. Returns the
   *  region's alpha plus what the editor says about it. */
  function cutout(data, w, h, region, opts) {
    const g = region || { x: 0, y: 0, w, h }, N = g.w * g.h;
    const alpha = new Uint8Array(N).fill(255);
    const ref = edgeColor(data, w, g);
    if (!ref) return { alpha, ref: null, plain: 1, share: 0 };
    const thr = 10 + clamp(Number(opts && opts.amount) || 0, 0, 100) * 1.4, thr2 = thr * thr;
    const idx = (k) => ((g.y + ((k / g.w) | 0)) * w + g.x + (k % g.w)) * 4;
    const bg = (k) => { const i = idx(k); return data[i + 3] < 16 || near(data, i, ref, thr2); };
    const gone = new Uint8Array(N), q = new Int32Array(N);
    let head = 0, tail = 0, edgeAll = 0, edgeBg = 0;
    const seed = (k) => { edgeAll++; if (bg(k)) { edgeBg++; if (!gone[k]) { gone[k] = 1; q[tail++] = k; } } };
    for (let x = 0; x < g.w; x++) { seed(x); if (g.h > 1) seed((g.h - 1) * g.w + x); }
    for (let y = 1; y < g.h - 1; y++) { seed(y * g.w); if (g.w > 1) seed(y * g.w + g.w - 1); }
    while (head < tail) {
      const k = q[head++], x = k % g.w;
      if (x > 0 && !gone[k - 1] && bg(k - 1)) { gone[k - 1] = 1; q[tail++] = k - 1; }
      if (x < g.w - 1 && !gone[k + 1] && bg(k + 1)) { gone[k + 1] = 1; q[tail++] = k + 1; }
      if (k >= g.w && !gone[k - g.w] && bg(k - g.w)) { gone[k - g.w] = 1; q[tail++] = k - g.w; }
      if (k + g.w < N && !gone[k + g.w] && bg(k + g.w)) { gone[k + g.w] = 1; q[tail++] = k + g.w; }
    }
    if (opts && opts.inside) for (let k = 0; k < N; k++) if (!gone[k] && bg(k)) gone[k] = 1;
    let removed = 0;
    for (let k = 0; k < N; k++) {
      if (gone[k]) { alpha[k] = 0; removed++; continue; }
      const x = k % g.w, y = (k / g.w) | 0;
      let touch = false, far = 0;   // far: the most solid kept neighbour, as a distance from the background
      for (let yy = Math.max(0, y - 1); yy <= Math.min(g.h - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(g.w - 1, x + 1); xx++) {
          const n = yy * g.w + xx;
          if (gone[n]) touch = true; else far = Math.max(far, dist2(data, idx(n), ref));
        }
      }
      if (!touch) continue;
      const d = Math.sqrt(dist2(data, idx(k), ref)), D = Math.sqrt(far);
      alpha[k] = Math.round(clamp((d - thr) / Math.max(1, D - thr), 0, 1) * 255);
    }
    return { alpha, ref, plain: edgeAll ? edgeBg / edgeAll : 0, share: removed / N };
  }
  /** Put a cut-out's alpha on the pixels; a half-see-through edge pixel loses
   *  the background colour mixed into it. A pixel already see-through stays so. */
  function applyCutout(data, w, region, cut) {
    if (!cut || !cut.ref) return;
    const g = region, ref = cut.ref;
    for (let y = 0, k = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++, k++) {
        const a = cut.alpha[k];
        if (a === 255) continue;
        const i = ((g.y + y) * w + g.x + x) * 4;
        if (a > 0) {
          const f = a / 255;
          data[i] = (data[i] - (1 - f) * ref.r) / f;
          data[i + 1] = (data[i + 1] - (1 - f) * ref.g) / f;
          data[i + 2] = (data[i + 2] - (1 - f) * ref.b) / f;
        }
        data[i + 3] = Math.min(data[i + 3], a);
      }
    }
  }
  function hasTransparency(data) { for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true; return false; }

  // ═══ what was done, saved with the copy (metadata.edits) ═══
  function recipe(st, W0, H0) {
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    const adjust = {};
    for (const a of ADJUST) if (st.adjust[a.key]) adjust[a.key] = Math.round(st.adjust[a.key]);
    return {
      v: 1, source: { width: W0, height: H0 },
      crop: { x: r4(st.rect.x), y: r4(st.rect.y), w: r4(st.rect.w), h: r4(st.rect.h) },
      shape: st.shape, turned: !!st.turned, rotate: st.rot, flip_h: !!st.flipH, flip_v: !!st.flipV,
      adjust, filter: st.filter, strength: st.filter === 'none' ? 100 : st.strength,
      background: st.bg.on ? { amount: st.bg.amount, inside: !!st.bg.inside } : null,
    };
  }

  /** Draw region r (normalised, of the turned and flipped picture) of the
   *  source image into a dw × dh canvas. Rotation comes first, then the flips:
   *  the order Rotate and Flip are kept in (see rotate() below). */
  function drawOriented(ctx, img, W0, H0, o, r, dw, dh) {
    const O = orientedSize(W0, H0, o.rot);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dw, dh);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.scale(dw / (r.w * O.w), dh / (r.h * O.h));
    ctx.translate(-r.x * O.w, -r.y * O.h);
    if (o.flipH) { ctx.translate(O.w, 0); ctx.scale(-1, 1); }
    if (o.flipV) { ctx.translate(0, O.h); ctx.scale(1, -1); }
    if (o.rot === 90) { ctx.translate(O.w, 0); ctx.rotate(Math.PI / 2); }
    else if (o.rot === 180) { ctx.translate(O.w, O.h); ctx.rotate(Math.PI); }
    else if (o.rot === 270) { ctx.translate(0, O.h); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(img, 0, 0, W0, H0);
    ctx.restore();
  }

  // ═══ the dialog ═════════════════════════════════════════════════════════════
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const signed = (v) => (v > 0 ? '+' + v : v < 0 ? '−' + Math.abs(v) : '0');
  const PREVIEW_EDGE = 1600, PREVIEW_AREA = 2.4e6, TILE_W = 160, TILE_H = 120;

  const CSS = `
dialog.dds-ie{--ie-stage:#e7e4ec;--ie-card:var(--dds-card,#fff);--ie-ink:var(--dds-ink,#1b1525);--ie-soft:var(--dds-soft,#6b6478);--ie-line:var(--dds-line,#eee9e0);--ie-p:var(--dds-p,#5b3fa0);--ie-p-soft:var(--dds-p-soft,#efeafa);--ie-bad:var(--dds-bad,#9a4242);
  border:none;padding:0;margin:auto;width:min(1180px,calc(100vw - 32px));height:min(820px,calc(100vh - 32px));max-width:none;max-height:none;border-radius:var(--dds-r-lg,16px);background:var(--ie-card);color:var(--ie-ink);box-shadow:0 24px 70px rgba(20,14,34,.35);overflow:hidden;font-size:14px}
@supports (height:100dvh){dialog.dds-ie{height:min(820px,calc(100dvh - 32px))}}
dialog.dds-ie[open]{display:flex;flex-direction:column}
dialog.dds-ie::backdrop{background:rgba(20,14,34,.6)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) dialog.dds-ie{--ie-stage:#141218}}
:root[data-theme="dark"] dialog.dds-ie{--ie-stage:#141218}
.dds-ie *{box-sizing:border-box}
.dds-ie button,.dds-ie input{font:inherit;color:inherit}
.dds-ie .ie-top{display:flex;align-items:center;gap:12px;padding:10px 12px 10px 18px;border-bottom:1px solid var(--ie-line);flex:none}
.dds-ie .ie-top h2{font-size:17px;font-weight:600;margin:0;white-space:nowrap}
.dds-ie .ie-name{font-size:13px;color:var(--ie-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.dds-ie .ie-x{background:none;border:none;font-size:26px;line-height:1;color:var(--ie-soft);cursor:pointer;padding:4px 10px;border-radius:var(--dds-r-sm,8px)}
.dds-ie .ie-x:hover{background:var(--ie-p-soft);color:var(--ie-ink)}
.dds-ie .ie-main{flex:1;min-height:0;display:flex}
.dds-ie .ie-stage{flex:1;min-width:0;position:relative;background:var(--ie-stage);display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
.dds-ie .ie-frame{position:relative;line-height:0}
.dds-ie .ie-frame canvas{display:block;max-width:none}
.dds-ie .ie-frame.checker canvas{background:repeating-conic-gradient(#cfcbd8 0% 25%,#fff 0% 50%) 0 0/16px 16px}
.dds-ie .ie-layer{position:absolute;inset:0}
.dds-ie .ie-crop{position:absolute;box-shadow:0 0 0 9999px rgba(12,9,18,.56);outline:1px solid rgba(255,255,255,.95);cursor:move;touch-action:none}
.dds-ie .ie-crop:focus-visible{outline:2px solid #fff;outline-offset:0}
.dds-ie .ie-g{position:absolute;inset:0;pointer-events:none;border:0 solid transparent;background:
  linear-gradient(to right,transparent 33.2%,rgba(255,255,255,.5) 33.2%,rgba(255,255,255,.5) 33.5%,transparent 33.5%,transparent 66.5%,rgba(255,255,255,.5) 66.5%,rgba(255,255,255,.5) 66.8%,transparent 66.8%),
  linear-gradient(to bottom,transparent 33.2%,rgba(255,255,255,.5) 33.2%,rgba(255,255,255,.5) 33.5%,transparent 33.5%,transparent 66.5%,rgba(255,255,255,.5) 66.5%,rgba(255,255,255,.5) 66.8%,transparent 66.8%)}
.dds-ie .ie-h{position:absolute;width:24px;height:24px;margin:-12px 0 0 -12px;touch-action:none}
.dds-ie .ie-h:after{content:"";position:absolute;inset:7px;background:#fff;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,.45)}
@media (pointer:coarse){.dds-ie .ie-h{width:40px;height:40px;margin:-20px 0 0 -20px}.dds-ie .ie-h:after{inset:13px}}
.dds-ie .ie-h[data-h="nw"]{left:0;top:0;cursor:nwse-resize}.dds-ie .ie-h[data-h="n"]{left:50%;top:0;cursor:ns-resize}.dds-ie .ie-h[data-h="ne"]{left:100%;top:0;cursor:nesw-resize}
.dds-ie .ie-h[data-h="e"]{left:100%;top:50%;cursor:ew-resize}.dds-ie .ie-h[data-h="se"]{left:100%;top:100%;cursor:nwse-resize}.dds-ie .ie-h[data-h="s"]{left:50%;top:100%;cursor:ns-resize}
.dds-ie .ie-h[data-h="sw"]{left:0;top:100%;cursor:nesw-resize}.dds-ie .ie-h[data-h="w"]{left:0;top:50%;cursor:ew-resize}
.dds-ie .ie-msg{position:absolute;left:16px;right:16px;top:50%;transform:translateY(-50%);text-align:center;font-size:14px;color:var(--ie-soft);line-height:1.5}
.dds-ie .ie-msg[hidden]{display:none}
.dds-ie .ie-side{width:340px;flex:none;border-left:1px solid var(--ie-line);display:flex;flex-direction:column;min-height:0}
.dds-ie .ie-tabs{display:flex;gap:2px;padding:6px 8px 0;border-bottom:1px solid var(--ie-line);flex:none}
.dds-ie .ie-tabs [role="tab"]{flex:1;font-size:13.5px;font-weight:500;padding:10px 4px;background:none;border:none;border-bottom:2px solid transparent;color:var(--ie-soft);cursor:pointer;white-space:nowrap}
.dds-ie .ie-tabs [role="tab"][aria-selected="true"]{color:var(--ie-p);border-bottom-color:var(--ie-p);font-weight:600}
.dds-ie .ie-tabs [role="tab"]:focus-visible{outline:2px solid var(--ie-p);outline-offset:-2px}
.dds-ie .ie-panels{flex:1;overflow-y:auto;padding:14px 16px 18px;-webkit-overflow-scrolling:touch}
.dds-ie [role="tabpanel"][hidden]{display:none}
.dds-ie .ie-lbl{font-size:12px;font-weight:500;color:var(--ie-soft);margin:2px 0 8px}
.dds-ie .ie-lbl+.ie-lbl,.dds-ie .ie-row+.ie-lbl,.dds-ie .ie-turn+.ie-lbl{margin-top:16px}
.dds-ie .ie-shapes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.dds-ie .ie-shape{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:58px;padding:8px 2px;border:1px solid var(--ie-line);border-radius:var(--dds-r-sm,8px);background:none;cursor:pointer;font-size:12px}
.dds-ie .ie-shape:hover{border-color:var(--ie-p)}
.dds-ie .ie-shape[aria-pressed="true"]{border-color:var(--ie-p);background:var(--ie-p-soft);color:var(--ie-p);font-weight:600}
.dds-ie .ie-sw{display:block;border:1.5px solid currentColor;border-radius:2px;opacity:.8}
.dds-ie .ie-sw.free{border-style:dashed}
.dds-ie .ie-btn{border:1px solid var(--ie-line);background:var(--ie-card);border-radius:var(--dds-r-sm,8px);padding:8px 12px;font-size:13px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.dds-ie .ie-btn:hover:not(:disabled){border-color:var(--ie-p)}
.dds-ie .ie-btn:disabled{opacity:.45;cursor:default}
.dds-ie .ie-btn[aria-pressed="true"]{border-color:var(--ie-p);background:var(--ie-p-soft);color:var(--ie-p)}
.dds-ie .ie-btn:focus-visible,.dds-ie .ie-shape:focus-visible,.dds-ie .ie-fil:focus-visible,.dds-ie .ie-x:focus-visible{outline:2px solid var(--ie-p);outline-offset:2px}
.dds-ie .ie-primary{background:var(--ie-p);border-color:var(--ie-p);color:var(--dds-on-p,#fff);font-weight:600}
.dds-ie .ie-quiet{border-color:transparent;background:none;color:var(--ie-soft)}
.dds-ie .ie-turn{margin-top:8px}
.dds-ie #ie-reset-top{display:none}   /* a phone's top bar carries Start over, so the foot fits one row */
.dds-ie .ie-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.dds-ie .ie-row .ie-btn{justify-content:center;white-space:nowrap;padding:8px 6px;font-size:12.5px;gap:5px}
.dds-ie .ie-dim{font-size:12.5px;color:var(--ie-soft);margin:14px 0 6px;font-variant-numeric:tabular-nums}
.dds-ie .ie-help{font-size:12.5px;color:var(--ie-soft);line-height:1.45;margin:6px 0}
.dds-ie .ie-sl{display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 8px;margin:0 0 12px}
.dds-ie .ie-sl label{font-size:13px;font-weight:500}
.dds-ie .ie-sl output{font-size:12px;color:var(--ie-soft);font-variant-numeric:tabular-nums;min-width:3ch;text-align:right}
.dds-ie .ie-sl input{grid-column:1/-1;width:100%;accent-color:var(--ie-p);margin:4px 0 0;height:28px}
.dds-ie .ie-sl.off{opacity:.45}
.dds-ie .ie-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:14px}
.dds-ie .ie-fil{border:1px solid var(--ie-line);border-radius:var(--dds-r-sm,8px);background:none;padding:4px 4px 6px;cursor:pointer;text-align:center;font-size:12.5px}
.dds-ie .ie-fil canvas{display:block;width:100%;height:auto;aspect-ratio:4/3;border-radius:5px;background:var(--ie-stage);margin-bottom:5px}
.dds-ie .ie-fil[aria-pressed="true"]{border-color:var(--ie-p);box-shadow:0 0 0 1px var(--ie-p) inset;color:var(--ie-p);font-weight:600}
.dds-ie .ie-h3{font-size:14.5px;font-weight:600;margin:0 0 4px}
.dds-ie .ie-switch{display:flex;align-items:center;gap:10px;font-weight:500;margin:14px 0;cursor:pointer;position:relative}
.dds-ie .ie-switch input{position:absolute;opacity:0;width:1px;height:1px}
.dds-ie .ie-switch i{width:36px;height:21px;border-radius:999px;background:var(--dds-line-strong,#d2d2db);position:relative;flex:none}
.dds-ie .ie-switch i:after{content:"";position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:#fff}
.dds-ie .ie-switch input:checked+i{background:var(--ie-p)}
.dds-ie .ie-switch input:checked+i:after{left:auto;right:2px}
.dds-ie .ie-switch input:focus-visible+i{outline:2px solid var(--ie-p);outline-offset:2px}
.dds-ie .ie-check{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.4;margin:4px 0 10px;cursor:pointer}
.dds-ie .ie-check input{margin-top:2px;accent-color:var(--ie-p)}
.dds-ie .ie-say{font-size:12.5px;line-height:1.45;color:var(--ie-ink);background:var(--ie-p-soft);border-radius:var(--dds-r-sm,8px);padding:8px 10px;margin:6px 0 10px}
.dds-ie .ie-say:empty{display:none}
.dds-ie .ie-foot{display:flex;align-items:center;gap:8px 12px;padding:10px 16px;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--ie-line);flex-wrap:wrap;flex:none}
.dds-ie .ie-hist,.dds-ie .ie-go{display:flex;gap:6px;flex-wrap:wrap}
.dds-ie .ie-go{margin-left:auto}
.dds-ie .ie-note{font-size:12.5px;color:var(--ie-soft);flex:1 1 220px;margin:0;line-height:1.4}
.dds-ie .ie-err{color:var(--ie-bad);font-weight:600}
.dds-ie .ie-ask{position:absolute;inset:0;background:rgba(20,14,34,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:5}
.dds-ie .ie-ask[hidden]{display:none}
.dds-ie .ie-askbox{background:var(--ie-card);border-radius:14px;padding:20px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(20,14,34,.3)}
.dds-ie .ie-askbox h3{font-size:15px;font-weight:600;margin:0 0 6px}
.dds-ie .ie-askbox p{font-size:13px;color:var(--ie-soft);margin:0 0 14px}
.dds-ie .ie-askbox div{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
@media (max-width:899.98px) and (orientation:portrait){
  .dds-ie .ie-main{flex-direction:column}
  .dds-ie .ie-stage{flex:1 1 52%;min-height:180px}
  .dds-ie .ie-side{width:auto;border-left:none;border-top:1px solid var(--ie-line);flex:1 1 48%}
  .dds-ie .ie-filters{grid-template-columns:repeat(auto-fill,minmax(96px,1fr))}
}
@media (max-height:540px) and (orientation:landscape){.dds-ie .ie-side{width:300px}}
/* a phone: the whole screen; shapes and filters scroll sideways in one strip,
   so the photo keeps most of the height and each tab fits without scrolling */
@media (max-width:719.98px),(max-height:540px){
  dialog.dds-ie{width:100vw;height:100vh;border-radius:0}
  @supports (height:100dvh){dialog.dds-ie{height:100dvh}}
  .dds-ie .ie-top{padding:6px 6px 6px 14px}
  .dds-ie .ie-panels{padding:10px 12px 12px}
  .dds-ie .ie-shapes,.dds-ie .ie-filters{display:flex;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:2px}
  .dds-ie .ie-shape{flex:0 0 64px;min-height:54px}
  .dds-ie .ie-fil{flex:0 0 92px}
  .dds-ie .ie-filters{margin-bottom:10px}
  .dds-ie .ie-dim{margin-top:10px}
  .dds-ie .ie-foot{padding:8px 12px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));gap:6px 8px}
  .dds-ie .ie-hist .ie-btn{padding:7px 10px}
  .dds-ie .ie-hist #ie-reset{display:none}
  .dds-ie #ie-reset-top{display:inline-flex;flex:none;padding:6px 8px}
  .dds-ie .ie-note{order:3;flex-basis:100%;font-size:12px}
  .dds-ie .ie-go{margin-left:auto}
}`;
  function injectStyle() {
    if (document.getElementById('dds-ie-style')) return;
    const s = document.createElement('style'); s.id = 'dds-ie-style'; s.textContent = CSS; document.head.appendChild(s);
  }
  const ICON = {
    rotl: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    rotr: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fliph: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v18M9 6 3 18h6zM15 6l6 12h-6z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    flipv: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 12h18M6 9 18 3v6zM6 15l12 6v-6z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  };
  function swatch(s) {
    if (s.ratio === null) return '<i class="ie-sw free" style="width:18px;height:18px"></i>';
    if (s.ratio === 'original') return '<i class="ie-sw" style="width:20px;height:15px;border-radius:3px"></i>';
    const w = s.ratio >= 1 ? 22 : Math.round(22 * s.ratio), h = s.ratio >= 1 ? Math.round(22 / s.ratio) : 22;
    return `<i class="ie-sw" style="width:${w}px;height:${h}px"></i>`;
  }

  function markup(o) {
    const shapes = SHAPES.map((s) => `<button type="button" class="ie-shape" data-shape="${s.key}" aria-pressed="false">${swatch(s)}<span>${esc(s.label)}</span></button>`).join('');
    const sliders = ADJUST.map((a) => `<div class="ie-sl"><label for="ie-a-${a.key}">${esc(a.label)}</label><output id="ie-o-${a.key}" for="ie-a-${a.key}">0</output><input type="range" id="ie-a-${a.key}" data-adj="${a.key}" min="${a.min === 0 ? 0 : -100}" max="100" step="1" value="0"></div>`).join('');
    const filters = FILTERS.map((f) => `<button type="button" class="ie-fil" data-filter="${f.key}" aria-pressed="false"><canvas width="${TILE_W}" height="${TILE_H}" aria-hidden="true"></canvas><span>${esc(f.label)}</span></button>`).join('');
    const tab = (k, label) => `<button type="button" role="tab" id="ie-t-${k}" aria-controls="ie-p-${k}" aria-selected="false" tabindex="-1">${label}</button>`;
    return `
<div class="ie-top"><h2 id="ie-title">${esc(o.title)}</h2><span class="ie-name" title="${esc(o.name)}">${esc(o.name)}</span><button type="button" class="ie-btn ie-quiet ie-reset" id="ie-reset-top" disabled>Start over</button><button type="button" class="ie-x" id="ie-close" aria-label="Close the editor">×</button></div>
<div class="ie-main">
  <div class="ie-stage" id="ie-stage">
    <div class="ie-frame" id="ie-frame">
      <canvas id="ie-cv" role="img" aria-label="Your photo, as it will be saved" width="1" height="1"></canvas>
      <div class="ie-layer" id="ie-layer" hidden>
        <div class="ie-crop" id="ie-crop" tabindex="0" role="group" aria-label="Crop area" aria-describedby="ie-crop-help"><i class="ie-g"></i>${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<span class="ie-h" data-h="${h}"></span>`).join('')}</div>
      </div>
    </div>
    <div class="ie-msg" id="ie-msg" role="status">Opening your photo…</div>
  </div>
  <div class="ie-side">
    <div class="ie-tabs" role="tablist" aria-label="Ways to edit">${tab('crop', 'Crop')}${tab('adjust', 'Adjust')}${tab('filters', 'Filters')}${tab('background', 'Background')}</div>
    <div class="ie-panels">
      <section role="tabpanel" id="ie-p-crop" aria-labelledby="ie-t-crop" hidden>
        <div class="ie-lbl" id="ie-shape-lbl">Shape</div>
        <div class="ie-shapes" role="group" aria-labelledby="ie-shape-lbl">${shapes}</div>
        <button type="button" class="ie-btn ie-turn" id="ie-turn" disabled>Make it tall</button>
        <div class="ie-lbl">Rotate and flip</div>
        <div class="ie-row">
          <button type="button" class="ie-btn" id="ie-rotl">${ICON.rotl}Rotate left</button>
          <button type="button" class="ie-btn" id="ie-rotr">${ICON.rotr}Rotate right</button>
          <button type="button" class="ie-btn" id="ie-fliph" aria-pressed="false">${ICON.fliph}Flip sideways</button>
          <button type="button" class="ie-btn" id="ie-flipv" aria-pressed="false">${ICON.flipv}Flip upside down</button>
        </div>
        <p class="ie-dim" id="ie-dim" aria-live="polite"></p>
        <p class="ie-help" id="ie-crop-help">Drag the corners or edges to crop, and drag inside to move it. With a keyboard: arrow keys move it, Shift and an arrow key resize it.</p>
      </section>
      <section role="tabpanel" id="ie-p-adjust" aria-labelledby="ie-t-adjust" hidden>
        ${sliders}
        <button type="button" class="ie-btn" id="ie-adj-reset" disabled>Put the sliders back</button>
      </section>
      <section role="tabpanel" id="ie-p-filters" aria-labelledby="ie-t-filters" hidden>
        <div class="ie-filters" role="group" aria-label="Filters">${filters}</div>
        <div class="ie-sl" id="ie-str-row"><label for="ie-str">Strength</label><output id="ie-o-str" for="ie-str">100</output><input type="range" id="ie-str" min="0" max="100" step="1" value="100"></div>
      </section>
      <section role="tabpanel" id="ie-p-background" aria-labelledby="ie-t-background" hidden>
        <h3 class="ie-h3">Remove a plain background</h3>
        <p class="ie-help">For logos, and photos taken against a plain wall or backdrop. Everything that matches the colour at the edges turns see-through.</p>
        <label class="ie-switch"><input type="checkbox" id="ie-bg-on"><i aria-hidden="true"></i>Remove the background</label>
        <div class="ie-sl" id="ie-bg-amt-row"><label for="ie-bg-amt">How much to remove</label><output id="ie-o-bg" for="ie-bg-amt">35</output><input type="range" id="ie-bg-amt" min="0" max="100" step="1" value="35"></div>
        <label class="ie-check"><input type="checkbox" id="ie-bg-in">Also clear that colour inside the shape, like the middle of an “O”</label>
        <p class="ie-say" id="ie-bg-say" aria-live="polite"></p>
        <p class="ie-help">It saves as a PNG, which keeps the see-through parts.</p>
      </section>
    </div>
  </div>
</div>
<div class="ie-foot">
  <div class="ie-hist"><button type="button" class="ie-btn" id="ie-undo" disabled>Undo</button><button type="button" class="ie-btn" id="ie-redo" disabled>Redo</button><button type="button" class="ie-btn ie-quiet ie-reset" id="ie-reset" disabled>Start over</button></div>
  <p class="ie-note" id="ie-note" role="status" aria-live="polite">${esc(o.note)}</p>
  <div class="ie-go"><button type="button" class="ie-btn" id="ie-cancel">Cancel</button><button type="button" class="ie-btn ie-primary" id="ie-save" disabled>${esc(o.saveLabel)}</button></div>
</div>
<div class="ie-ask" id="ie-ask" role="alertdialog" aria-modal="true" aria-labelledby="ie-ask-h" aria-describedby="ie-ask-p" hidden>
  <div class="ie-askbox"><h3 id="ie-ask-h">Leave without saving?</h3><p id="ie-ask-p">Your changes to this photo will be lost. The original stays as it is.</p>
  <div><button type="button" class="ie-btn" id="ie-ask-leave">Leave</button><button type="button" class="ie-btn ie-primary" id="ie-ask-stay">Keep editing</button></div></div>
</div>`;
  }

  function freshState() {
    const adjust = {}; for (const a of ADJUST) adjust[a.key] = 0;
    return { rect: { ...FULL }, shape: 'free', turned: false, rot: 0, flipH: false, flipV: false, adjust, filter: 'none', strength: 100, bg: { on: false, amount: 35, inside: false } };
  }

  /** Open the editor on one photo. opts: src (URL or Blob of the ORIGINAL) and
   *  fallbackSrc (tried if src won't load), name, mime, startTab ('crop' |
   *  'adjust' | 'filters' | 'background'), removeBackground (start with it on),
   *  title, saveLabel, note, and onSave(result), which stores the picture.
   *  result = { blob, mime, width, height, edits }. onSave may return { error }
   *  (or throw): the editor stays open, edits intact, and says so. Resolves
   *  { saved: true, value } once saved, or null when closed. */
  function open(opts) {
    const o = Object.assign({ title: 'Edit photo', name: '', saveLabel: 'Save as a new file', note: 'Saving makes a new file. The original stays exactly as it is.', startTab: 'crop' }, opts || {});
    if (document.querySelector('dialog.dds-ie')) return Promise.resolve(null);   // one at a time
    injectStyle();
    return new Promise((done) => {
      const opener = document.activeElement;
      const dlg = document.createElement('dialog');
      dlg.className = 'dds-ie';
      dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'ie-title');
      // showModal() focuses the dialog itself (a screen reader reads its name; Tab
      // goes on to the controls), not the first button, which WebKit ringed
      dlg.tabIndex = -1; dlg.setAttribute('autofocus', '');
      dlg.innerHTML = markup(o);
      document.body.appendChild(dlg);
      const $ = (id) => dlg.querySelector('#' + id);
      const stage = $('ie-stage'), frame = $('ie-frame'), cv = $('ie-cv'), layer = $('ie-layer'), cropEl = $('ie-crop'), msg = $('ie-msg');
      const ctx = cv.getContext('2d');

      let st = freshState();
      const pristine = JSON.stringify(st);
      let img = null, url = '', W0 = 0, H0 = 0, srcMime = String(o.mime || ''), ready = false, busy = false, closed = false;
      let tab = '', cssW = 1, cssH = 1, pending = 0, dragging = false, drag = null, commitTimer = 0, onKey = null;
      let raw = null, rawKey = '', cut = null, cutKey = '', tileKey = '';
      const hist = [JSON.stringify(st)]; let at = 0;
      const O = () => orientedSize(W0, H0, st.rot);
      const ratio = () => shapeRatio(st.shape, st.turned, O().w, O().h);
      const params = () => combineParams(st.adjust, st.filter, st.strength);
      const changed = () => JSON.stringify(st) !== pristine;

      // ── painting: the view's own pixels are read once per view; a slider move
      //    only re-colours a copy of them (no redraw from the big original) ──
      const viewRect = () => (tab === 'crop' ? FULL : st.rect);
      function layout() {
        const v = viewRect(), Ow = O(), vw = v.w * Ow.w, vh = v.h * Ow.h;
        const sw = Math.max(40, stage.clientWidth - 32), sh = Math.max(40, stage.clientHeight - 32);
        const s = Math.min(sw / vw, sh / vh);
        cssW = Math.max(1, Math.round(vw * s)); cssH = Math.max(1, Math.round(vh * s));
        const dpr = Math.min(2, root.devicePixelRatio || 1);
        let bw = cssW * dpr, bh = cssH * dpr;
        const k = Math.min(1, PREVIEW_EDGE / Math.max(bw, bh), Math.sqrt(PREVIEW_AREA / (bw * bh)), vw / bw);   // never more pixels than the photo has there
        bw = Math.max(1, Math.round(bw * k)); bh = Math.max(1, Math.round(bh * k));
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
        cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
      }
      function ensureRaw() {
        const v = viewRect(), key = [v.x, v.y, v.w, v.h, st.rot, st.flipH, st.flipV, cv.width, cv.height].join(',');
        if (key === rawKey && raw) return;
        const off = document.createElement('canvas'); off.width = cv.width; off.height = cv.height;
        const octx = off.getContext('2d', { willReadFrequently: true });
        drawOriented(octx, img, W0, H0, st, v, off.width, off.height);
        raw = octx.getImageData(0, 0, off.width, off.height); rawKey = key;
      }
      function cropRegion() {
        if (tab !== 'crop') return { x: 0, y: 0, w: cv.width, h: cv.height };
        const x = Math.round(st.rect.x * cv.width), y = Math.round(st.rect.y * cv.height);
        return { x, y, w: Math.max(1, Math.min(cv.width - x, Math.round(st.rect.w * cv.width))), h: Math.max(1, Math.min(cv.height - y, Math.round(st.rect.h * cv.height))) };
      }
      function paint() {
        pending = 0;
        if (!ready || closed) return;
        layout(); ensureRaw();
        const out = new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height);
        const region = cropRegion();
        if (st.bg.on && !dragging) {
          const key = rawKey + '|' + [region.x, region.y, region.w, region.h, st.bg.amount, st.bg.inside].join(',');
          if (key !== cutKey) { cut = cutout(raw.data, raw.width, raw.height, region, st.bg); cutKey = key; }
          applyCutout(out.data, out.width, region, cut);
        }
        applyPixels(out.data, out.width, out.height, params(), region);
        ctx.putImageData(out, 0, 0);
        frame.classList.toggle('checker', st.bg.on || /png|webp/.test(srcMime));
        placeCrop(); sayDims(); sayBg();
        if (tab === 'filters') paintTiles();
      }
      const schedule = () => { if (!pending) pending = root.requestAnimationFrame(paint); };
      function placeCrop() {
        layer.hidden = tab !== 'crop' || !ready;
        const r = st.rect;
        cropEl.style.left = r.x * 100 + '%'; cropEl.style.top = r.y * 100 + '%';
        cropEl.style.width = r.w * 100 + '%'; cropEl.style.height = r.h * 100 + '%';
      }
      function sayDims() {
        if (!ready) return;
        const Ow = O(), px = cropPixels(st.rect, Ow.w, Ow.h), out = capOutput(px.w, px.h);
        $('ie-dim').textContent = `Crop: ${px.w} × ${px.h} px` + (out.scaled ? ` · saved at ${out.w} × ${out.h} px` : '');
      }
      function sayBg() {
        const say = $('ie-bg-say');
        if (!st.bg.on) { say.textContent = ''; return; }
        if (dragging || !cut) return;
        if (!cut.ref) { say.textContent = 'The edges of this picture are already see-through, so there’s no background to take out.'; return; }
        const pct = Math.round(cut.share * 100);
        let t = pct < 1 ? 'Nothing matched the colour at the edges. Move “How much to remove” up.' : `Took out ${pct}% of the picture.`;
        if (cut.plain < 0.55) t += ' The edges aren’t one plain colour, so some of the background may stay. This tool is for plain backgrounds.';
        say.textContent = t;
      }
      function paintTiles() {
        const r = st.rect, key = [r.x, r.y, r.w, r.h, st.rot, st.flipH, st.flipV].join(',');
        if (key === tileKey) return;
        tileKey = key;
        const Ow = O(), rw = r.w * Ow.w, rh = r.h * Ow.h, s = Math.max(TILE_W / rw, TILE_H / rh);
        const cw = TILE_W / s / Ow.w, ch = TILE_H / s / Ow.h;
        const sub = { x: r.x + (r.w - cw) / 2, y: r.y + (r.h - ch) / 2, w: cw, h: ch };   // cover the tile with the middle of the crop
        const off = document.createElement('canvas'); off.width = TILE_W; off.height = TILE_H;
        const octx = off.getContext('2d', { willReadFrequently: true });
        drawOriented(octx, img, W0, H0, st, sub, TILE_W, TILE_H);
        const base = octx.getImageData(0, 0, TILE_W, TILE_H);
        dlg.querySelectorAll('.ie-fil').forEach((b) => {
          const d = new ImageData(new Uint8ClampedArray(base.data), TILE_W, TILE_H);
          applyPixels(d.data, TILE_W, TILE_H, combineParams(null, b.dataset.filter, 100), { x: 0, y: 0, w: TILE_W, h: TILE_H });
          b.querySelector('canvas').getContext('2d').putImageData(d, 0, 0);
        });
      }

      // ── the controls mirror the state (after undo, redo, start over) ──
      function sync() {
        const R = ratio(), numeric = typeof (SHAPES.find((s) => s.key === st.shape) || {}).ratio === 'number' && st.shape !== 'square';
        dlg.querySelectorAll('.ie-shape').forEach((b) => {
          b.setAttribute('aria-pressed', String(b.dataset.shape === st.shape));
          b.querySelector('span').textContent = shapeLabel(b.dataset.shape, b.dataset.shape === st.shape && st.turned);
        });
        const turn = $('ie-turn');
        turn.disabled = !numeric;
        turn.textContent = R && R < 1 ? 'Make it wide' : 'Make it tall';
        $('ie-fliph').setAttribute('aria-pressed', String(st.flipH));
        $('ie-flipv').setAttribute('aria-pressed', String(st.flipV));
        for (const a of ADJUST) { const v = Math.round(st.adjust[a.key]); $('ie-a-' + a.key).value = String(v); $('ie-o-' + a.key).textContent = signed(v); }
        $('ie-adj-reset').disabled = ADJUST.every((a) => !st.adjust[a.key]);
        dlg.querySelectorAll('.ie-fil').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === st.filter)));
        $('ie-str').value = String(st.strength); $('ie-o-str').textContent = String(st.strength);
        $('ie-str').disabled = st.filter === 'none'; $('ie-str-row').classList.toggle('off', st.filter === 'none');
        $('ie-bg-on').checked = st.bg.on;
        $('ie-bg-amt').value = String(st.bg.amount); $('ie-o-bg').textContent = String(st.bg.amount);
        $('ie-bg-amt').disabled = !st.bg.on; $('ie-bg-in').disabled = !st.bg.on; $('ie-bg-in').checked = st.bg.inside;
        $('ie-bg-amt-row').classList.toggle('off', !st.bg.on);
        $('ie-undo').disabled = at === 0; $('ie-redo').disabled = at >= hist.length - 1;
        dlg.querySelectorAll('.ie-reset').forEach((b) => { b.disabled = !changed(); });
        $('ie-save').disabled = !ready || busy || !changed();
        // a button that just went disabled under the keyboard (Start over, Undo at
        // the start) would drop focus to the page: keep it in the editor instead
        const f = document.activeElement;
        if (f && f !== dlg && f.disabled && dlg.contains(f)) dlg.focus();
      }
      function commit() {
        clearTimeout(commitTimer); commitTimer = 0;
        const s = JSON.stringify(st);
        if (s !== hist[at]) { hist.length = at + 1; hist.push(s); if (hist.length > 80) hist.shift(); at = hist.length - 1; }
        sync();
      }
      const commitSoon = () => { clearTimeout(commitTimer); commitTimer = setTimeout(commit, 400); };
      // d = -1 undo, +1 redo; a keyboard nudge still waiting to be kept is kept first
      function step(d) { if (busy) return; commit(); const i = at + d; if (i < 0 || i >= hist.length) return; at = i; st = JSON.parse(hist[at]); sync(); schedule(); }

      // ── tabs ──
      const TABS = ['crop', 'adjust', 'filters', 'background'];
      function setTab(t, focus) {
        tab = TABS.includes(t) ? t : 'crop';
        for (const k of TABS) {
          const b = $('ie-t-' + k), on = k === tab;
          b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
          $('ie-p-' + k).hidden = !on;
        }
        if (focus) $('ie-t-' + tab).focus();
        schedule();
      }
      dlg.querySelector('.ie-tabs').addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) setTab(b.id.slice(5)); });
      dlg.querySelector('.ie-tabs').addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1, Home: -9, End: 9 }[e.key];
        if (!d) return;
        e.preventDefault();
        const i = TABS.indexOf(tab), j = d === -9 ? 0 : d === 9 ? TABS.length - 1 : (i + d + TABS.length) % TABS.length;
        setTab(TABS[j], true);
      });

      // ── crop: shapes, turn, rotate, flip ──
      dlg.querySelector('.ie-shapes').addEventListener('click', (e) => {
        const b = e.target.closest('[data-shape]'); if (!b || !ready) return;
        st.shape = b.dataset.shape; st.turned = false;
        const R = ratio(); if (R) st.rect = largestRect(R, O().w, O().h);
        commit(); schedule();
      });
      $('ie-turn').addEventListener('click', () => { if (!ready) return; st.turned = !st.turned; st.rect = largestRect(ratio(), O().w, O().h); commit(); schedule(); });
      // A quarter turn swaps the flips: turning a sideways-flipped picture is the
      // same as flipping the turned one upside down (drawOriented turns first).
      function rotate(dir) {
        if (!ready) return;
        st.rot = (st.rot + (dir > 0 ? 90 : 270)) % 360;
        st.rect = rotateRect(st.rect, dir);
        [st.flipH, st.flipV] = [st.flipV, st.flipH];
        const s = SHAPES.find((x) => x.key === st.shape);
        if (s && typeof s.ratio === 'number' && s.ratio !== 1) st.turned = !st.turned;   // the crop turned with it
        commit(); schedule();
      }
      $('ie-rotl').addEventListener('click', () => rotate(-1));
      $('ie-rotr').addEventListener('click', () => rotate(1));
      $('ie-fliph').addEventListener('click', () => { if (!ready) return; st.flipH = !st.flipH; st.rect = flipRect(st.rect, 'h'); commit(); schedule(); });
      $('ie-flipv').addEventListener('click', () => { if (!ready) return; st.flipV = !st.flipV; st.rect = flipRect(st.rect, 'v'); commit(); schedule(); });

      // ── crop: drag a handle or the box (mouse, finger or pen) ──
      layer.addEventListener('pointerdown', (e) => {
        if (!ready || busy || !e.target.closest('.ie-crop')) return;
        const h = e.target.closest('.ie-h');
        e.preventDefault();
        drag = { mode: h ? h.dataset.h : 'move', x: e.clientX, y: e.clientY, start: { ...st.rect }, id: e.pointerId };
        try { (h || cropEl).setPointerCapture(e.pointerId); } catch (_) { /* not every pointer can be captured */ }
        cropEl.focus({ preventScroll: true });
      });
      layer.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = (e.clientX - drag.x) / cssW, dy = (e.clientY - drag.y) / cssH;
        st.rect = drag.mode === 'move' ? moveRect(drag.start, dx, dy) : resizeRect(drag.start, drag.mode, dx, dy, ratio(), O().w, O().h);
        if (!dragging) { dragging = true; if (st.bg.on) schedule(); }   // the cut-out waits for the drop
        placeCrop(); sayDims();
      });
      const endDrag = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null;
        if (dragging) { dragging = false; commit(); schedule(); }
      };
      layer.addEventListener('pointerup', endDrag);
      layer.addEventListener('pointercancel', endDrag);
      cropEl.addEventListener('keydown', (e) => {
        const step = e.altKey ? 0.002 : 0.01;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!d || !ready) return;
        e.preventDefault();
        st.rect = e.shiftKey ? resizeRect(st.rect, 'se', d[0], d[1], ratio(), O().w, O().h) : moveRect(st.rect, d[0], d[1]);
        placeCrop(); sayDims(); commitSoon();
        if (st.bg.on) schedule();
      });

      // ── adjust and filters ──
      dlg.querySelectorAll('[data-adj]').forEach((inp) => {
        inp.addEventListener('input', () => { st.adjust[inp.dataset.adj] = Number(inp.value); $('ie-o-' + inp.dataset.adj).textContent = signed(Number(inp.value)); schedule(); });
        inp.addEventListener('change', commit);
      });
      $('ie-adj-reset').addEventListener('click', () => { for (const a of ADJUST) st.adjust[a.key] = 0; commit(); schedule(); });
      dlg.querySelector('.ie-filters').addEventListener('click', (e) => {
        const b = e.target.closest('[data-filter]'); if (!b || !ready) return;
        st.filter = b.dataset.filter; commit(); schedule();
      });
      $('ie-str').addEventListener('input', () => { st.strength = Number($('ie-str').value); $('ie-o-str').textContent = String(st.strength); schedule(); });
      $('ie-str').addEventListener('change', commit);

      // ── background ──
      $('ie-bg-on').addEventListener('change', () => { st.bg.on = $('ie-bg-on').checked; commit(); schedule(); });
      $('ie-bg-amt').addEventListener('input', () => { st.bg.amount = Number($('ie-bg-amt').value); $('ie-o-bg').textContent = String(st.bg.amount); schedule(); });
      $('ie-bg-amt').addEventListener('change', commit);
      $('ie-bg-in').addEventListener('change', () => { st.bg.inside = $('ie-bg-in').checked; commit(); schedule(); });

      // ── undo, redo, start over, leave ──
      $('ie-undo').addEventListener('click', () => step(-1));
      $('ie-redo').addEventListener('click', () => step(1));
      dlg.querySelectorAll('.ie-reset').forEach((b) => b.addEventListener('click', () => { if (busy) return; st = JSON.parse(pristine); commit(); schedule(); }));
      const ask = $('ie-ask');
      function requestClose() {
        if (busy) return;
        if (ready && changed()) { ask.hidden = false; setTimeout(() => $('ie-ask-stay').focus(), 20); }
        else finish(null);
      }
      $('ie-ask-stay').addEventListener('click', () => { ask.hidden = true; $('ie-cancel').focus(); });
      $('ie-ask-leave').addEventListener('click', () => finish(null));
      $('ie-close').addEventListener('click', requestClose);
      $('ie-cancel').addEventListener('click', requestClose);
      // While the editor is open, Escape is the editor's wherever focus is: caught
      // on the way DOWN at the document, so it never reaches the page behind
      // (files.html closes its own panel on Escape). Escaping on the dialog alone
      // missed a keypress made while focus had fallen to the page's body.
      onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (!ask.hidden) { ask.hidden = true; $('ie-cancel').focus(); } else requestClose(); return; }
        if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) { e.preventDefault(); step(e.key === 'y' || e.shiftKey ? 1 : -1); }
      };
      document.addEventListener('keydown', onKey, true);
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });

      // ── save ──
      const note = $('ie-note');
      function say(text, bad) { note.textContent = text; note.classList.toggle('ie-err', !!bad); note.setAttribute('role', bad ? 'alert' : 'status'); }
      async function exportImage() {
        const Ow = O(), px = cropPixels(st.rect, Ow.w, Ow.h), size = capOutput(px.w, px.h);
        const out = document.createElement('canvas'); out.width = size.w; out.height = size.h;
        const octx = out.getContext('2d', { willReadFrequently: true });
        drawOriented(octx, img, W0, H0, st, { x: px.x / Ow.w, y: px.y / Ow.h, w: px.w / Ow.w, h: px.h / Ow.h }, size.w, size.h);
        const p = params();
        let clear = false;
        if (st.bg.on || !isNeutral(p) || /png|webp/.test(srcMime)) {
          const id = octx.getImageData(0, 0, size.w, size.h), region = { x: 0, y: 0, w: size.w, h: size.h };
          if (st.bg.on) applyCutout(id.data, size.w, region, cutout(id.data, size.w, size.h, region, st.bg));
          applyPixels(id.data, size.w, size.h, p, region);
          clear = hasTransparency(id.data);
          octx.putImageData(id, 0, 0);
        }
        const enc = await encode(out, clear);
        return { blob: enc.blob, mime: enc.mime, width: enc.width, height: enc.height, edits: recipe(st, W0, H0) };
      }
      // PNG keeps see-through parts (and a PNG stays a PNG); everything else is a
      // JPEG. Over the size limit: a JPEG steps its quality down, then both shrink.
      async function encode(canvas, clear) {
        let png = clear || srcMime === 'image/png', c = canvas;
        for (let i = 0; i < 8; i++) {
          const type = png ? 'image/png' : 'image/jpeg';
          const blob = await new Promise((res) => c.toBlob(res, type, png ? undefined : [0.92, 0.86, 0.8, 0.74][Math.min(i, 3)]));
          if (blob && blob.size <= MAX_BYTES) return { blob, mime: type, width: c.width, height: c.height };
          if (png && !clear) { png = false; continue; }   // a PNG with nothing see-through fits as a JPEG
          if (png || i >= 3) {
            const s = document.createElement('canvas'); s.width = Math.max(1, Math.round(c.width * 0.8)); s.height = Math.max(1, Math.round(c.height * 0.8));
            const sctx = s.getContext('2d'); sctx.imageSmoothingQuality = 'high'; sctx.drawImage(c, 0, 0, s.width, s.height); c = s;
          }
        }
        throw new Error('too_big');
      }
      $('ie-save').addEventListener('click', async () => {
        if (busy || !ready || !changed()) return;
        commit();
        busy = true; sync(); $('ie-save').textContent = 'Saving…'; say('Saving your edited copy…');
        await new Promise((r) => root.requestAnimationFrame(() => setTimeout(r, 0)));   // let "Saving…" show before the heavy work
        let res;
        try {
          const out = await exportImage();
          res = o.onSave ? await o.onSave(out) : out;
        } catch (e) {
          res = { error: e && e.message === 'too_big' ? 'This photo is too big to save, even made smaller. Try a smaller crop.' : 'Saving didn’t go through, so nothing was saved. Try again.' };
        }
        if (closed) return;
        if (res && res.error) { busy = false; $('ie-save').textContent = o.saveLabel; say(String(res.error), true); sync(); return; }
        finish({ saved: true, value: res });
      });

      let ro = null;
      function finish(result) {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        clearTimeout(commitTimer);
        if (pending) root.cancelAnimationFrame(pending);
        if (ro) ro.disconnect();
        root.removeEventListener('resize', schedule);
        if (url) URL.revokeObjectURL(url);
        try { dlg.close(); } catch (_) { /* already closed */ }
        dlg.remove();
        if (opener && opener.focus && document.contains(opener)) opener.focus();
        done(result);
      }

      // ── open: the original, at full size, from its own pixels ──
      ro = root.ResizeObserver ? new ResizeObserver(() => schedule()) : null;
      if (ro) ro.observe(stage); else root.addEventListener('resize', schedule);
      setTab(o.startTab);
      sync();
      dlg.showModal();
      if (!dlg.contains(document.activeElement)) dlg.focus();   // an engine without dialog autofocus
      (async () => {
        const fetchBlob = async (u) => { const r = await fetch(u, { credentials: 'omit' }); if (!r.ok) throw new Error('fetch ' + r.status); return r.blob(); };
        let blob = null;
        for (const s of [o.src, o.fallbackSrc]) {
          if (!s) continue;
          try { blob = typeof s === 'string' ? await fetchBlob(s) : s; break; } catch (_) { blob = null; }
        }
        try {
          if (!blob) throw new Error('no photo');
          if (!srcMime) srcMime = blob.type || 'image/jpeg';
          url = URL.createObjectURL(blob);
          img = new Image(); img.decoding = 'async'; img.src = url;
          await (img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = rej; }));
          W0 = img.naturalWidth; H0 = img.naturalHeight;
          if (!W0 || !H0) throw new Error('empty');
        } catch (_) {
          if (closed) return;
          msg.textContent = 'We couldn’t open this photo for editing. The photo itself is fine — close this and try again in a moment.';
          return;
        }
        if (closed) return;
        ready = true; msg.hidden = true;
        if (o.removeBackground) { st.bg.on = true; commit(); }
        sync(); schedule();
      })();
    });
  }

  root.DDSImageEditor = {
    version: 1, open, SHAPES, ADJUST, FILTERS,
    core: {
      orientedSize, shapeRatio, shapeLabel, largestRect, moveRect, resizeRect, rotateRect, flipRect, cropPixels, capOutput,
      combineParams, isNeutral, toneLut, channelLuts, colorMatrix, applyPixels, edgeColor, cutout, applyCutout, hasTransparency,
      recipe, freshState, MAX_EDGE, MAX_AREA, MAX_BYTES,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
