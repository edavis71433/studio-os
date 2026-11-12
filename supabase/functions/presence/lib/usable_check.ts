// ── Builder list item 150: "Usable by everyone", what's kept with the site ────
// The editor does the checking (a11y-check.js reads each draft page as it is drawn). Two
// things are kept here so they outlast the browser: the three ticks only a person can
// judge, and the last check's count and worst line, which Site health shows without
// drawing every page again. One reserved row ('__usable_check__'), no migration. Pure.
export const USABLE_TICKS = ['photo_words', 'zoom', 'captions'] as const;
export type UsableTick = typeof USABLE_TICKS[number];
export interface UsableLast { at: string; fix: number; passed: number; worst: string }
export interface UsableCheck { ticks: Record<UsableTick, boolean>; last: UsableLast | null }

const WORST_MAX = 200;
const count = (v: unknown) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : 0; };
const line = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, WORST_MAX);

/** What's stored, made safe to hand back. */
export function normalizeUsable(raw: unknown): UsableCheck {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const t = o.ticks && typeof o.ticks === 'object' ? o.ticks as Record<string, unknown> : {};
  const l = o.last && typeof o.last === 'object' ? o.last as Record<string, unknown> : null;
  const at = l && typeof l.at === 'string' && !Number.isNaN(Date.parse(l.at)) ? l.at : null;
  return {
    ticks: { photo_words: t.photo_words === true, zoom: t.zoom === true, captions: t.captions === true },
    last: l && at ? { at, fix: count(l.fix), passed: count(l.passed), worst: count(l.fix) ? line(l.worst) : '' } : null,
  };
}

/** A save: only the ticks named change, and a check's result replaces the last one whole. */
export function applyUsable(current: unknown, asked: unknown, now: string): UsableCheck | { error: string } {
  const cur = normalizeUsable(current);
  const a = asked && typeof asked === 'object' ? asked as Record<string, unknown> : null;
  if (!a || (a.ticks === undefined && a.last === undefined)) return { error: 'Say which tick, or what the check found.' };
  const ticks = { ...cur.ticks };
  if (a.ticks !== undefined) {
    if (!a.ticks || typeof a.ticks !== 'object' || Array.isArray(a.ticks)) return { error: 'Say which tick, on or off.' };
    for (const [k, v] of Object.entries(a.ticks as Record<string, unknown>)) {
      if (!(USABLE_TICKS as readonly string[]).includes(k) || typeof v !== 'boolean') return { error: 'Say which tick, on or off.' };
      ticks[k as UsableTick] = v;
    }
  }
  let last = cur.last;
  if (a.last !== undefined) {
    if (!a.last || typeof a.last !== 'object') return { error: 'Say what the check found.' };
    const l = a.last as Record<string, unknown>;
    last = { at: now, fix: count(l.fix), passed: count(l.passed), worst: count(l.fix) ? line(l.worst) : '' };
  }
  return { ticks, last };
}
