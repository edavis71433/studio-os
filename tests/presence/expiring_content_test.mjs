// ── Phase EXP · auto-expiring content — per-item show-from / show-until window ─
//   deno run --allow-read --allow-env tests/presence/expiring_content_test.mjs
// Proves the window model (pure isVisibleNow across every shape + boundary),
// that validateBlocks parses/normalizes a window and renderSiteBlocks omits a
// section outside it (while a no-window section renders EXACTLY as before), and
// that the boundary-crossing detector the auto-republish sweep relies on fires
// only when a windowed section actually flips.
import {
  isVisibleNow, parseWindow, normalizeWindowBound, visibilityChanged, blocksNeedRewindow,
} from '../../supabase/functions/presence/lib/content_window.ts';
import { validateBlocks, renderSiteBlocks } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { esc, attr, safeHref } from '../../supabase/functions/presence/lib/markdown.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const ctx = (now) => ({ esc, attr, safeHref, now });

const T0 = '2026-07-01T00:00:00.000Z';   // before
const NOW = '2026-07-15T12:00:00.000Z';  // "now"
const T2 = '2026-08-01T00:00:00.000Z';   // after

// ═══ 1. isVisibleNow — every window shape, boundaries, open-ended, invalid ═══
{
  ok('no window → always visible', isVisibleNow({}, NOW) && isVisibleNow(null, NOW) && isVisibleNow(undefined, NOW));
  ok('from only, now after from → visible', isVisibleNow({ show_from: T0 }, NOW));
  ok('from only, now before from → hidden (not yet)', !isVisibleNow({ show_from: T2 }, NOW));
  ok('until only, now before until → visible', isVisibleNow({ show_until: T2 }, NOW));
  ok('until only, now after until → hidden (expired)', !isVisibleNow({ show_until: T0 }, NOW));
  ok('both, now inside window → visible', isVisibleNow({ show_from: T0, show_until: T2 }, NOW));
  ok('both, now before window → hidden', !isVisibleNow({ show_from: NOW, show_until: T2 }, T0));
  ok('both, now after window → hidden', !isVisibleNow({ show_from: T0, show_until: NOW }, T2));
  // boundaries: from ≤ now < until  (from inclusive, until exclusive)
  ok('boundary: now === from → visible (from inclusive)', isVisibleNow({ show_from: NOW }, NOW));
  ok('boundary: now === until → hidden (until exclusive)', !isVisibleNow({ show_until: NOW }, NOW));
  ok('invalid window (from > until) → hidden (rejected)', !isVisibleNow({ show_from: T2, show_until: T0 }, NOW));
}

// ═══ 2. normalizeWindowBound / parseWindow — canonical, day-boundary aware ═══
{
  ok('date-only from → start of day', normalizeWindowBound('2026-07-15', 'from') === '2026-07-15T00:00:00.000Z');
  ok('date-only until → inclusive end of day', normalizeWindowBound('2026-07-15', 'until') === '2026-07-15T23:59:59.999Z');
  ok('full datetime → canonical UTC instant', normalizeWindowBound('2026-07-15T08:30:00-04:00', 'from') === '2026-07-15T12:30:00.000Z');
  ok('blank / junk / impossible date → undefined', normalizeWindowBound('', 'from') === undefined && normalizeWindowBound('not-a-date', 'until') === undefined && normalizeWindowBound('2026-13-40', 'from') === undefined);
  ok('parseWindow normalizes both bounds', JSON.stringify(parseWindow({ show_from: '2026-07-01', show_until: '2026-07-31' })) === JSON.stringify({ show_from: '2026-07-01T00:00:00.000Z', show_until: '2026-07-31T23:59:59.999Z' }));
  ok('parseWindow with no usable bound → undefined (renders byte-identical)', parseWindow({}) === undefined && parseWindow({ show_from: '' }) === undefined && parseWindow(null) === undefined);
  // an owner-picked inclusive "until Jul 15" keeps the section up through the 15th
  const w = parseWindow({ show_until: '2026-07-15' });
  ok('inclusive-day: still visible at noon on the "until" day', isVisibleNow(w, '2026-07-15T12:00:00.000Z') && !isVisibleNow(w, '2026-07-16T00:00:00.000Z'));
}

// ═══ 3. validateBlocks attaches a normalized window; no-window is untouched ═══
{
  const [b] = validateBlocks([{ type: 'features', items: [{ title: 'Holiday hours' }], show_from: '2026-12-20', show_until: '2026-12-27' }]);
  ok('validateBlocks parses + normalizes the window onto the block', b.show_from === '2026-12-20T00:00:00.000Z' && b.show_until === '2026-12-27T23:59:59.999Z');
  const [plain] = validateBlocks([{ type: 'features', items: [{ title: 'Always' }] }]);
  ok('a block with no window carries NO window keys', !('show_from' in plain) && !('show_until' in plain));
  const [bad] = validateBlocks([{ type: 'cta', text: 'x', show_from: 'garbage', show_until: '' }]);
  ok('unusable window values are dropped (no keys added)', !('show_from' in bad) && !('show_until' in bad));
  // window rides through a MEDIA-bearing rebuild path is covered by render below.
}

// ═══ 4. render honors the window — omits out-of-window, includes active ═══
{
  const blocks = validateBlocks([
    { type: 'features', title: 'Always here', items: [{ title: 'A' }] },                                   // no window
    { type: 'stats', title: 'Live special', items: [{ value: '20%', label: 'off' }], show_from: '2026-07-01', show_until: '2026-07-31' }, // active on NOW
    { type: 'cta', text: 'Coming soon', show_from: '2026-08-01' },                                          // future
    { type: 'process', title: 'Ended sale', steps: [{ step: 'x' }], show_until: '2026-07-10' },             // expired
  ]);
  const r = renderSiteBlocks(blocks, ctx(NOW));
  const types = r.map((b) => b.type);
  ok('active + always-on sections render; future + expired are omitted', types.join(',') === 'features,stats' && r.length === 2);
  ok('the omitted sections leave NO html / anchor', !r.some((b) => b.type === 'cta' || b.type === 'process'));
  // determinism: same snapshot clock → identical output
  ok('deterministic at a fixed publish clock', JSON.stringify(renderSiteBlocks(blocks, ctx(NOW))) === JSON.stringify(r));
  // the SAME content at a later clock flips which sections show
  const later = renderSiteBlocks(blocks, ctx(T2)).map((b) => b.type);
  ok('at a later clock: the future section appears, the special has expired', later.join(',') === 'features,cta');
  // no-window default is byte-identical whether or not `now` is supplied
  const noWin = validateBlocks([{ type: 'features', title: 'Always here', items: [{ title: 'A' }] }]);
  ok('no-window output identical with and without a clock', JSON.stringify(renderSiteBlocks(noWin, ctx(NOW))) === JSON.stringify(renderSiteBlocks(noWin, { esc, attr, safeHref })));
}

// ═══ 5. boundary-crossing detection — drives the auto-republish sweep ═══
{
  const special = { show_from: '2026-07-01T00:00:00.000Z', show_until: '2026-07-31T23:59:59.999Z' };
  ok('visibilityChanged across the show_until boundary → true', visibilityChanged(special, '2026-07-15T00:00:00.000Z', '2026-08-01T00:00:00.000Z'));
  ok('visibilityChanged with no boundary between → false', !visibilityChanged(special, '2026-07-10T00:00:00.000Z', '2026-07-20T00:00:00.000Z'));
  const liveBlocks = validateBlocks([
    { type: 'features', items: [{ title: 'A' }] },                                                          // no window — never triggers
    { type: 'cta', text: 'Special', show_from: '2026-07-01', show_until: '2026-07-31' },
  ]);
  ok('blocksNeedRewindow: a crossed boundary since last publish → true', blocksNeedRewindow(liveBlocks, '2026-07-15T00:00:00.000Z', '2026-08-02T00:00:00.000Z'));
  ok('blocksNeedRewindow: nothing crossed → false', !blocksNeedRewindow(liveBlocks, '2026-07-10T00:00:00.000Z', '2026-07-20T00:00:00.000Z'));
  ok('blocksNeedRewindow: a site with no windowed sections → false (never re-fires)', !blocksNeedRewindow(validateBlocks([{ type: 'features', items: [{ title: 'A' }] }]), T0, T2));
  ok('blocksNeedRewindow: non-array / junk → false', !blocksNeedRewindow(null, T0, T2) && !blocksNeedRewindow('nope', T0, T2));
  // an already-flipped section (live clock already past the boundary) does NOT re-fire
  ok('no re-fire once the live bytes were rendered past the boundary', !blocksNeedRewindow(liveBlocks, '2026-08-01T12:00:00.000Z', '2026-08-05T00:00:00.000Z'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ EXPIRING CONTENT: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
