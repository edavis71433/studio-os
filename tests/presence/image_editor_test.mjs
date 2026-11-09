// ── Items 39 + 117: the photo editor's pure core ─────────────────────────────
// image-editor.js does all its work in the browser, on the photo's own pixels:
// crop shapes, quarter turns and flips, seven sliders, named filters and the
// plain-background cut-out. Its core touches no DOM, so this suite imports the
// real file and checks it on made-up pixel arrays, then pins how files.html
// saves the result (a NEW file, never a replace). The dialog itself is driven
// in a browser by tests/e2e/image-editor.spec.ts.
//   deno run --allow-read tests/presence/image_editor_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
await import(new URL('image-editor.js', ROOT).href);
const E = globalThis.DDSImageEditor;
const C = E.core;
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sameRect = (a, b, eps = 1e-6) => near(a.x, b.x, eps) && near(a.y, b.y, eps) && near(a.w, b.w, eps) && near(a.h, b.h, eps);
const show = (r) => `{${['x', 'y', 'w', 'h'].map((k) => k + ':' + Math.round(r[k] * 1e4) / 1e4).join(',')}}`;
/** A made-up picture: fn(x, y) → [r, g, b, a]. */
const picture = (w, h, fn) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(fn(x, y), (y * w + x) * 4); return d; };
const px = (d, w, x, y) => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
const neutral = () => C.combineParams({}, 'none', 100);
const withP = (o) => ({ ...neutral(), ...o });
const FULL = { x: 0, y: 0, w: 1, h: 1 };

// ═══ 1. shapes, turning and flipping (normalised rectangles) ═══
{
  ok('a quarter turn swaps width and height; a half turn doesn’t', JSON.stringify(C.orientedSize(4000, 3000, 90)) === '{"w":3000,"h":4000}' && JSON.stringify(C.orientedSize(4000, 3000, 180)) === '{"w":4000,"h":3000}' && JSON.stringify(C.orientedSize(4000, 3000, 270)) === '{"w":3000,"h":4000}');
  const wide = C.largestRect(16 / 9, 4000, 3000);
  ok('16:9 on a 4:3 photo takes the full width and the middle three quarters', sameRect(wide, { x: 0, y: 0.125, w: 1, h: 0.75 }), show(wide));
  const sq = C.largestRect(1, 4000, 3000);
  ok('Square on a 4:3 photo takes the full height, centred', sameRect(sq, { x: 0.125, y: 0, w: 0.75, h: 1 }), show(sq));
  ok('Free is the whole photo', sameRect(C.largestRect(null, 4000, 3000), FULL));
  ok('Original follows the photo as it’s turned', near(C.shapeRatio('original', false, 4000, 3000), 4 / 3) && near(C.shapeRatio('original', false, 3000, 4000), 3 / 4));
  ok('a turned shape is the same shape, tall', near(C.shapeRatio('4:3', true, 4000, 3000), 3 / 4) && C.shapeRatio('free', true, 1, 1) === null);
  ok('the button names the turned shape (4:3 reads 3:4; Square and Free don’t change)', C.shapeLabel('4:3', true) === '3:4' && C.shapeLabel('16:9', false) === '16:9' && C.shapeLabel('square', true) === 'Square' && C.shapeLabel('free', true) === 'Free');
  ok('the shapes on offer: Free, Original, Square, 4:3, 3:2, 16:9, 4:5, 9:16', E.SHAPES.map((s) => s.key).join(' ') === 'free original square 4:3 3:2 16:9 4:5 9:16');

  const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  let t = r; for (let i = 0; i < 4; i++) t = C.rotateRect(t, 1);
  ok('four quarter turns bring the crop back', sameRect(t, r), show(t));
  ok('a turn right then a turn left bring it back', sameRect(C.rotateRect(C.rotateRect(r, 1), -1), r));
  ok('turning right moves the crop with the picture (top-left goes top-right)', sameRect(C.rotateRect(r, 1), { x: 0.4, y: 0.1, w: 0.4, h: 0.3 }), show(C.rotateRect(r, 1)));
  ok('flipping sideways mirrors the crop; twice brings it back', sameRect(C.flipRect(r, 'h'), { x: 0.6, y: 0.2, w: 0.3, h: 0.4 }) && sameRect(C.flipRect(C.flipRect(r, 'h'), 'h'), r));
  ok('flipping upside down mirrors it top to bottom', sameRect(C.flipRect(r, 'v'), { x: 0.1, y: 0.4, w: 0.3, h: 0.4 }));
  // a held shape survives a turn: the rectangle's pixel ratio becomes the turned ratio
  const W = 4000, H = 3000, k43 = C.largestRect(4 / 3, W, H), turned = C.rotateRect(k43, 1);
  ok('a 4:3 crop turned with the photo is a 3:4 crop of the turned photo', near((turned.w * H) / (turned.h * W), 3 / 4, 1e-4));
}

// ═══ 2. dragging the crop ═══
{
  const W = 1600, H = 900;
  const free = C.resizeRect({ x: 0, y: 0, w: 0.5, h: 0.5 }, 'se', 0.1, 0.1, null, W, H);
  ok('Free: dragging the bottom-right corner grows it by the drag', sameRect(free, { x: 0, y: 0, w: 0.6, h: 0.6 }), show(free));
  const past = C.resizeRect({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'e', 2, 0, null, W, H);
  ok('Free: it never passes the photo’s edge', near(past.x + past.w, 1) && near(past.x, 0.2));
  const tiny = C.resizeRect({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'nw', 0.9, 0.9, null, W, H);
  ok('Free: it never shrinks below the smallest crop (2% of the short side, 8 px at least)', tiny.w * W >= 17.9 && tiny.h * H >= 17.9, show(tiny));

  const R = 16 / 9, start = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };   // 800×450 px: already 16:9
  const c = C.resizeRect(start, 'se', 0.1, 0.02, R, W, H);
  ok('a held shape keeps its shape at a corner', near((c.w * W) / (c.h * H), R, 1e-6), String((c.w * W) / (c.h * H)));
  ok('…and the opposite corner stays where it was', near(c.x, 0.25) && near(c.y, 0.25));
  const side = C.resizeRect(start, 'se', -0.05, 0, R, W, H), up = C.resizeRect(start, 'se', 0, -0.05, R, W, H);
  ok('a corner pulled straight sideways (or straight up) still resizes a held shape', near(side.w, 0.45) && near((side.w * W) / (side.h * H), R, 1e-6) && up.h < 0.5 && near((up.w * W) / (up.h * H), R, 1e-6), `${show(side)} ${show(up)}`);
  const nw = C.resizeRect(start, 'nw', -0.1, 0, R, W, H);
  ok('dragging the top-left corner out keeps the bottom-right still', near(nw.x + nw.w, 0.75) && near(nw.y + nw.h, 0.75) && near((nw.w * W) / (nw.h * H), R, 1e-6));
  const e = C.resizeRect(start, 'e', 0.1, 0, R, W, H);
  ok('an edge keeps the shape and the middle of the other two sides', near((e.w * W) / (e.h * H), R, 1e-6) && near(e.y + e.h / 2, 0.5) && near(e.x, 0.25));
  const big = C.resizeRect(start, 'se', 5, 5, R, W, H);
  ok('a held shape stops at the photo’s edge too', big.x + big.w <= 1 + 1e-9 && big.y + big.h <= 1 + 1e-9 && near((big.w * W) / (big.h * H), R, 1e-6), show(big));
  const mv = C.moveRect(start, 0.6, -0.6);
  ok('moving the crop stops at the edges and keeps its size', near(mv.x, 0.5) && near(mv.y, 0) && near(mv.w, 0.5) && near(mv.h, 0.5));
  const p = C.cropPixels({ x: 0.1, y: 0.1, w: 0.95, h: 0.3 }, 1000, 500);
  ok('the crop in whole pixels never runs past the photo', p.x === 100 && p.y === 50 && p.w === 900 && p.h === 150, JSON.stringify(p));
}

// ═══ 3. how big the saved picture is ═══
{
  const phone = C.capOutput(4032, 3024);
  ok('a phone’s 12-megapixel photo saves at 3840 × 2880', phone.w === 3840 && phone.h === 2880 && phone.scaled);
  const pano = C.capOutput(8000, 1000);
  ok('a long panorama is held to 3840 px on its long side', pano.w === 3840 && pano.h === 480);
  const small = C.capOutput(1200, 800);
  ok('a small picture keeps its size', small.w === 1200 && small.h === 800 && !small.scaled);
  ok('the saved file stays under the upload door’s 10 MB', C.MAX_BYTES < 10 * 1024 * 1024);
}

// ═══ 4. the sliders ═══
{
  const flat = picture(4, 4, () => [128, 128, 128, 255]);
  const run = (p, d = flat, w = 4, h = 4) => { const c = new Uint8ClampedArray(d); C.applyPixels(c, w, h, p, { x: 0, y: 0, w, h }); return c; };
  ok('nothing moved: every byte is the same', run(neutral()).every((v, i) => v === flat[i]));
  ok('the seven sliders, in order', E.ADJUST.map((a) => a.key).join(' ') === 'brightness contrast saturation warmth highlights shadows vignette');
  let mono = true, inRange = true, bad = '';
  for (const key of ['brightness', 'contrast', 'highlights', 'shadows', 'fade']) {
    for (const v of key === 'fade' ? [100] : [-100, 100]) {
      const lut = C.toneLut(withP({ [key]: v }));
      for (let i = 1; i < 256; i++) if (lut[i] < lut[i - 1] - 1e-7) { mono = false; bad = `${key} ${v} at ${i}`; }
      for (let i = 0; i < 256; i++) if (lut[i] < 0 || lut[i] > 1) inRange = false;
    }
  }
  ok('no slider end ever turns a lighter tone darker than a darker one', mono, bad);
  ok('every tone stays between black and white', inRange);
  ok('Brightness up lifts a mid grey; down lowers it', run(withP({ brightness: 50 }))[0] > 140 && run(withP({ brightness: -50 }))[0] < 116);
  ok('Brightness keeps black black', C.toneLut(withP({ brightness: 100 }))[0] === 0);
  const ramp = picture(3, 1, (x) => [[40, 128, 215][x], [40, 128, 215][x], [40, 128, 215][x], 255]);
  const hc = run(withP({ contrast: 50 }), ramp, 3, 1);
  ok('Contrast up: darks darker, lights lighter, the middle about the same', hc[0] < 40 && hc[8] > 215 && Math.abs(hc[4] - 128) <= 2, `${hc[0]} ${hc[4]} ${hc[8]}`);
  const colour = picture(1, 1, () => [200, 120, 60, 255]);
  const g = run(withP({ saturation: -100 }), colour, 1, 1);
  ok('Saturation all the way down is grey', g[0] === g[1] && g[1] === g[2], g.join(','));
  const s = run(withP({ saturation: 60 }), colour, 1, 1);
  ok('Saturation up pulls the channels apart', s[0] - s[2] > 200 - 60, s.join(','));
  const warm = run(withP({ warmth: 60 }));
  ok('Warmth up tips grey toward red, away from blue; down is the reverse', warm[0] > 128 && warm[2] < 128 && run(withP({ warmth: -60 }))[2] > run(withP({ warmth: -60 }))[0]);
  const hl = picture(2, 1, (x) => (x ? [235, 235, 235, 255] : [30, 30, 30, 255]));
  const hd = run(withP({ highlights: -80 }), hl, 2, 1), sd = run(withP({ shadows: 80 }), hl, 2, 1);
  ok('Highlights down brings back a bright tone and leaves a dark one', hd[4] < 230 && Math.abs(hd[0] - 30) <= 1, `${hd[0]} ${hd[4]}`);
  ok('Shadows up opens a dark tone and leaves a bright one', sd[0] > 40 && Math.abs(sd[4] - 235) <= 1, `${sd[0]} ${sd[4]}`);
  const big = picture(21, 21, () => [200, 200, 200, 255]), v = run(withP({ vignette: 80 }), big, 21, 21);
  ok('Vignette darkens the corners and leaves the middle', px(v, 21, 0, 0)[0] < 150 && px(v, 21, 10, 10)[0] === 200, `${px(v, 21, 0, 0)[0]} ${px(v, 21, 10, 10)[0]}`);
  const off = picture(21, 21, () => [200, 200, 200, 255]);
  const vr = new Uint8ClampedArray(off); C.applyPixels(vr, 21, 21, withP({ vignette: 80 }), { x: 0, y: 0, w: 11, h: 11 });
  ok('…centred on the crop, not on the whole picture', px(vr, 21, 5, 5)[0] === 200 && px(vr, 21, 20, 20)[0] < 200);
  const see = picture(2, 1, (x) => [180, 90, 40, x ? 0 : 128]);
  const sa = run(withP({ brightness: 40, saturation: -50, vignette: 50 }), see, 2, 1);
  ok('no slider touches what is see-through', sa[3] === 128 && sa[7] === 0);
}

// ═══ 5. the named filters ═══
{
  const keys = E.FILTERS.map((f) => f.key);
  ok('ten filters, each its own name, the first is the photo as it is', keys.length === 10 && new Set(keys).size === 10 && keys[0] === 'none' && E.FILTERS[0].label === 'Original');
  ok('the names are plain words', E.FILTERS.every((f) => /^[A-Z][a-z]+( & [a-z]+)?$/.test(f.label)), E.FILTERS.map((f) => f.label).join(', '));
  let inRange = true, changes = true, why = '';
  const scene = picture(8, 8, (x, y) => [30 + x * 25, 60 + y * 20, 200 - x * 15, 255]);
  for (const f of E.FILTERS) {
    const p = C.combineParams({}, f.key, 100);
    for (const [k, v] of Object.entries(f.p)) { const [lo, hi] = ['vignette', 'fade', 'sepia'].includes(k) ? [0, 100] : [-100, 100]; if (v < lo || v > hi) { inRange = false; why = f.key + ' ' + k; } }
    const d = new Uint8ClampedArray(scene); C.applyPixels(d, 8, 8, p, { x: 0, y: 0, w: 8, h: 8 });
    const same = d.every((b, i) => b === scene[i]);
    if (f.key === 'none' ? !same : same) { changes = false; why = f.key; }
  }
  ok('every filter’s settings are inside the sliders’ ranges', inRange, why);
  ok('each filter changes the picture (and Original doesn’t)', changes, why);
  const half = C.combineParams({}, 'vivid', 50);
  ok('Strength 50 is half the filter', half.saturation === 22.5 && half.contrast === 9);
  ok('a filter and a slider add up, and stop at the end of the range', C.combineParams({ saturation: -60 }, 'mono', 100).saturation === -100 && C.combineParams({ saturation: 40 }, 'vivid', 100).saturation === 85);
  const grey = picture(1, 1, () => [128, 128, 128, 255]), vin = new Uint8ClampedArray(grey);
  C.applyPixels(vin, 1, 1, C.combineParams({}, 'vintage', 100), { x: 0, y: 0, w: 1, h: 1 });
  ok('Vintage turns grey a warm brown (red over green over blue)', vin[0] > vin[1] && vin[1] > vin[2], Array.from(vin).join(','));
}

// ═══ 6. the plain-background cut-out ═══
{
  // a dark square logo in the middle of a white card
  const W = 40, H = 30;
  const logo = picture(W, H, (x, y) => (x >= 10 && x < 30 && y >= 8 && y < 22 ? [30, 40, 120, 255] : [252, 251, 250, 255]));
  const cut = C.cutout(logo, W, H, { x: 0, y: 0, w: W, h: H }, { amount: 35 });
  ok('the white around a logo is the background', cut.ref && cut.ref.r === 252 && cut.ref.g === 251 && cut.ref.b === 250);
  ok('…it all goes see-through, and the logo stays', cut.alpha[0] === 0 && cut.alpha[W * H - 1] === 0 && cut.alpha[15 * W + 20] === 255);
  ok('…it says how much went', near(cut.share, 1 - (20 * 14) / (W * H), 1e-9), String(cut.share));
  ok('…and that the edges were one plain colour', cut.plain === 1);
  const d = new Uint8ClampedArray(logo); C.applyCutout(d, W, { x: 0, y: 0, w: W, h: H }, cut);
  ok('the pixels get that alpha; the logo’s colour is untouched', d[3] === 0 && px(d, W, 20, 15).join(',') === '30,40,120,255');

  // a ring with a white middle: the middle isn't touching the edges
  const ring = picture(30, 30, (x, y) => { const r = Math.hypot(x - 14.5, y - 14.5); return r < 10 && r >= 5 ? [20, 20, 20, 255] : [255, 255, 255, 255]; });
  const outside = C.cutout(ring, 30, 30, { x: 0, y: 0, w: 30, h: 30 }, { amount: 35 });
  const inside = C.cutout(ring, 30, 30, { x: 0, y: 0, w: 30, h: 30 }, { amount: 35, inside: true });
  ok('the middle of an O stays, unless asked', outside.alpha[15 * 30 + 15] === 255 && inside.alpha[15 * 30 + 15] === 0 && inside.alpha[0] === 0);
  ok('…and the ring itself stays either way', inside.alpha[15 * 30 + 7] === 255 && outside.alpha[15 * 30 + 7] === 255);

  // a soft edge: one pixel halfway between the logo and the white, beside the white
  const soft = picture(9, 9, (x, y) => (x === 4 && y === 4 ? [30, 40, 120, 255] : x === 3 && y === 4 ? [141, 146, 185, 255] : [252, 251, 250, 255]));
  const sc = C.cutout(soft, 9, 9, { x: 0, y: 0, w: 9, h: 9 }, { amount: 20 });
  const a = sc.alpha[4 * 9 + 3];
  ok('a halfway edge pixel is half see-through, so the edge stays smooth', a > 40 && a < 215, String(a));
  const sd = new Uint8ClampedArray(soft); C.applyCutout(sd, 9, { x: 0, y: 0, w: 9, h: 9 }, sc);
  ok('…and loses the white mixed into it', px(sd, 9, 3, 4)[0] < 141 && px(sd, 9, 3, 4)[2] < 185, px(sd, 9, 3, 4).join(','));

  // busy edges: a photo with no plain backdrop
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const busy = picture(40, 30, () => [rnd() * 255, rnd() * 255, rnd() * 255, 255]);
  const bc = C.cutout(busy, 40, 30, { x: 0, y: 0, w: 40, h: 30 }, { amount: 35 });
  ok('a busy background is noticed, so the editor can say this tool is for plain ones', bc.plain < 0.55, String(bc.plain));
  const clear = picture(10, 10, (x, y) => (x > 2 && x < 7 && y > 2 && y < 7 ? [10, 10, 10, 255] : [0, 0, 0, 0]));
  const cc = C.cutout(clear, 10, 10, { x: 0, y: 0, w: 10, h: 10 }, { amount: 35 });
  ok('edges already see-through: nothing to take out', cc.ref === null && cc.alpha.every((v) => v === 255));
  const none = C.cutout(logo, W, H, { x: 0, y: 0, w: W, h: H }, { amount: 0 });
  ok('“How much to remove” at 0 still takes the exact background colour', none.alpha[0] === 0 && none.alpha[15 * W + 20] === 255);

  // the crop tab cuts only inside the crop
  const wide = picture(20, 10, (x) => (x < 10 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const part = C.cutout(wide, 20, 10, { x: 10, y: 0, w: 10, h: 10 }, { amount: 35 });
  const wd = new Uint8ClampedArray(wide); C.applyCutout(wd, 20, { x: 10, y: 0, w: 10, h: 10 }, part);
  ok('a cut-out of the crop leaves the rest of the picture alone', px(wd, 20, 2, 2)[3] === 255 && px(wd, 20, 15, 5)[3] === 0);
  ok('anything see-through is noticed (it decides PNG)', C.hasTransparency(wd) && !C.hasTransparency(wide));
}

// ═══ 7. what the copy remembers ═══
{
  const st = C.freshState();
  st.rect = { x: 0.123456, y: 0, w: 0.5, h: 0.5 }; st.shape = '4:3'; st.rot = 90; st.flipH = true; st.adjust.brightness = 12; st.bg.on = true; st.bg.amount = 50;
  const r = C.recipe(st, 4000, 3000);
  ok('the recipe names the source, the crop, the turn and the flip', r.v === 1 && r.source.width === 4000 && r.crop.x === 0.1235 && r.rotate === 90 && r.flip_h === true && r.flip_v === false && r.shape === '4:3');
  ok('…only the sliders that moved', JSON.stringify(r.adjust) === '{"brightness":12}');
  ok('…and the cut-out, when it’s on', r.background && r.background.amount === 50 && r.filter === 'none' && r.strength === 100);
  ok('…which is small', JSON.stringify(r).length < 400, String(JSON.stringify(r).length));
  ok('…and whether the subject was cut out (off by default)', r.cutout === false && C.freshState().cutout === false && C.recipe({ ...st, cutout: true }, 4000, 3000).cutout === true);
}

// ═══ 8. how the Files page uses it ═══
{
  const files = read('files.html'), ed = read('image-editor.js');
  const acts = files.slice(files.indexOf("${ed?`<div class=\"acts\">"), files.indexOf("`:`<div class=\"acts\"><button class=\"btn\" onclick=\"download("));
  ok('Edit photo and Remove background are offered only with edit rights, and only for photos', acts.includes("${a.kind==='image'?`<button class=\"btn\" id=\"editPhoto\">Edit photo</button><button class=\"btn\" id=\"cutBg\">Remove background</button>`:''}"));
  ok('Remove background opens the editor on its Background tab, already on', files.includes("cb.onclick=()=>editPhoto('background')") && files.includes("removeBackground:tab==='background'"));
  const editFn = files.slice(files.indexOf('async function editPhoto('), files.indexOf('const editedName='));
  ok('the editor opens the ORIGINAL (the untransformed file), never the small thumbnail', editFn.includes('const src=d.thumb_fallback||d.download_url;') && !/\ba\.thumb\b/.test(editFn));
  const save = files.slice(files.indexOf('async function saveEdited('), files.indexOf('async function setShareImage('));
  ok('saving goes through the same upload door, with a content hash', save.includes("api('/media/upload-url','POST',{mime:out.mime,bytes:out.blob.size") && save.includes('content_hash:(await fileHash(out.blob))||undefined'));
  ok('the copy names its original and keeps its folder, tags and caption', save.includes('edited_from:a.id') && save.includes('body.collection=a.collection') && save.includes('body.tags=a.tags') && save.includes('body.caption=meta.caption'));
  ok('a private photo’s copy is made private before it is named', save.indexOf("{client_private:true}") > 0 && save.indexOf("{client_private:true}") < save.indexOf('const body={name:editedName'));
  ok('saving never replaces or deletes the original', !/\/replace|'DELETE'|rollback|status'/.test(save + editFn));
  ok('a failed upload keeps the editor open with the reason', save.includes("return{error:(up.body&&up.body.message)||") && save.includes("return{error:'The upload didn’t finish"));
  ok('the old AI button is gone from the page; its server route stays', !/api\([^)]*remove-background/.test(files) && !files.includes('removeBg(') && read('supabase/functions/presence/index.ts').includes('/remove-background$/'));
  const pageV = (/s\.src='\/image-editor\.js\?v=(\d+)'/.exec(files) || [])[1], edV = (/\bversion: (\d+),/.exec(ed) || [])[1];
  ok('the editor loads on first use, its ?v= the editor’s own version (to bust the day-long cache)', !!pageV && pageV === edV && pageV === String(E.version), `page v=${pageV}, editor ${edV}`);
  ok('the public build copies the editor (every root .js)', read('scripts/build-public.sh').includes('cp ./*.js dist/'));
  ok('an edited copy says what it came from, with a way back', files.includes('An edited copy of “') && files.includes('data-open-orig="${esc(edFrom)}"') && files.includes("openDetail(b.dataset.openOrig)"));
  ok('the editor itself only ever READS: one fetch, for the photo, and no upload of its own', (ed.match(/fetch\(/g) || []).length === 1 && !/method:\s*'(PUT|POST|PATCH|DELETE)'/.test(ed));
  ok('Escape stays inside the editor wherever focus is (the panel behind closes on Escape)', ed.includes("if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation();") && ed.includes("document.addEventListener('keydown', onKey, true);") && ed.includes("document.removeEventListener('keydown', onKey, true);"));
  ok('a button disabled under focus hands focus back to the editor', ed.includes('if (f && f !== dlg && f.disabled && dlg.contains(f)) dlg.focus();'));
  ok('a file dropped on the open editor is not uploaded', files.includes("if(document.querySelector('dialog[open]'))return;"));
  ok('presence.html is untouched by this', !read('presence.html').includes('image-editor.js'));
  // "Cut out the subject": offered only when the page brings a service; a busy edge runs it by itself
  ok('the cut-out is offered only when the page brings a service', ed.includes("${o.cutout ? `<div class=\"ie-cutbox\">") && ed.includes("const cutBtn = $('ie-cut');"));
  ok('Remove background on a busy photo runs the cut-out by itself (a plain one keeps the free tool)', ed.includes('if (autoCut && st.bg.on && cut && !dragging) { autoCut = false; if (cut.ref && cut.plain < 0.55) setTimeout(runCutout, 0); }'));
  ok('a cut-out made once is reused: Undo and “Put the background back” never ask the service again', ed.includes("if (cutPic) { st.cutout = true; st.bg.on = false; commit(); schedule();") && ed.includes("const pic = () => (st.cutout && cutPic ? cutPic : { img, w: W0, h: H0 });"));
  ok('a failed cut-out says why and changes nothing', ed.includes("if (!pc) { sync(); schedule(); sayCut(String((res && res.error) ||"));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ IMAGE EDITOR: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
