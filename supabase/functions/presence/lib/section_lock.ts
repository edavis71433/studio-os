// ── Locked sections (builder list item 155, Nov 2026) ──
// The studio locks a section so its client can't break it by accident: the section carries
// `lock: { id, words }` in the stored list (settings.blocks for Home, settings.pages[].blocks
// for a page). A locked section can't be removed, moved to another page, restyled or rebuilt
// by the client; with `words` its words may still change. Only the studio sets or clears a
// lock. The editor hides what a client can't do; this is the server's half, so the rule holds
// for any save. Pure.
type Block = Record<string, unknown>;
interface Lists { blocks?: unknown; pages?: unknown }
export interface Lock { id: string; words: boolean }
export interface LockedEdit { name: string; what: 'removed' | 'changed' | 'locked' }

const isObj = (v: unknown): v is Block => !!v && typeof v === 'object' && !Array.isArray(v);
const LOCK_ID = /^[a-z0-9-]{6,40}$/;

/** A section's lock, or null when it has none (or a malformed one). */
export function lockOf(b: unknown): Lock | null {
  const l = isObj(b) ? b.lock : null;
  return isObj(l) && typeof l.id === 'string' && LOCK_ID.test(l.id) ? { id: l.id, words: l.words === true } : null;
}

// What a section's words are not: its kind, its lock, its look and when it shows, and the
// photos and forms it points at. Everything else that is a string is words.
const NOT_WORDS = new Set(['type', 'id', 'lock', 'style', 'look', 'variant', 'show_from', 'show_until', 'hidden', 'layout', 'theme', 'size', 'kind', 'mode', 'shape', 'aspect', 'position', 'icon', 'anim', 'bg', 'background']);
const notWords = (key: string) => NOT_WORDS.has(key) || /(^|_)(id|media|color|colour|style|align|layout|variant)$/.test(key);

// The section as the lock sees it: with words open, every word is the same blank, so only a
// change to something else counts. Keys sorted, so the order a save writes them in doesn't matter.
function seen(v: unknown, words: boolean, key = '', frozen = false): string {
  if (Array.isArray(v)) return '[' + v.map((x) => seen(x, words, key, frozen)).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + seen(v[k], words, k, frozen || notWords(k))).join(',') + '}';
  if (typeof v === 'string' && words && !frozen && !notWords(key)) return '"·"';
  return JSON.stringify(v ?? null);
}

// A section's name for a sentence: its heading, else its kind.
function nameOf(b: Block): string {
  const t = [b.title, b.heading, b.name].find((x) => typeof x === 'string' && x.trim());
  return String(t || b.type || 'section').trim().slice(0, 60);
}

// Home's list under '' and each page's list under its slug, from what's stored or being saved.
// A page whose address the save renames is looked for under its new one.
function listsOf(x: Lists, which: { home: boolean; pages: boolean }, renamed: Record<string, string> = {}): Map<string, Block[]> {
  const out = new Map<string, Block[]>();
  if (which.home) out.set('', Array.isArray(x.blocks) ? x.blocks.filter(isObj) : []);
  if (which.pages) for (const p of Array.isArray(x.pages) ? x.pages : []) {
    if (isObj(p) && typeof p.slug === 'string' && p.slug) out.set(renamed[p.slug] || p.slug, Array.isArray(p.blocks) ? p.blocks.filter(isObj) : []);
  }
  return out;
}

/** What a client's save would do to locked sections: each one it removes (or unlocks, or
 *  moves to another page), changes beyond what its lock allows, or a lock it sets. Only the
 *  lists the save carries are compared: a save of Home's sections leaves the pages alone.
 *  `renamed` maps a page's old address to the new one the save gives it. */
export function lockedEdits(stored: Lists, saving: Lists, renamed: Record<string, string> = {}): LockedEdit[] {
  const which = { home: Array.isArray(saving.blocks), pages: Array.isArray(saving.pages) };
  if (!which.home && !which.pages) return [];
  const before = listsOf(stored, which, renamed), after = listsOf(saving, which);
  const out: LockedEdit[] = [];
  for (const [where, list] of before) {
    const next = new Map<string, Block>();
    for (const b of after.get(where) || []) { const l = lockOf(b); if (l && !next.has(l.id)) next.set(l.id, b); }
    for (const b of list) {
      const l = lockOf(b); if (!l) continue;
      const n = next.get(l.id);
      if (!n) { out.push({ name: nameOf(b), what: 'removed' }); continue; }
      const nl = lockOf(n)!;
      if (nl.words !== l.words || seen(n, l.words) !== seen(b, l.words)) out.push({ name: nameOf(b), what: 'changed' });
    }
  }
  for (const [where, list] of after) {
    const had = new Set((before.get(where) || []).map((b) => lockOf(b)?.id).filter(Boolean));
    const twice = new Set<string>();
    for (const b of list) {
      const l = lockOf(b); if (!l) continue;
      if (!had.has(l.id) || twice.has(l.id)) out.push({ name: nameOf(b), what: 'locked' });
      twice.add(l.id);
    }
  }
  return out;
}

/** The one sentence a refused save answers with. */
export function lockedMessage(edits: LockedEdit[]): string {
  const e = edits[0];
  if (!e) return '';
  if (e.what === 'locked') return 'Only your studio can lock a section. Nothing was changed.';
  return `Your studio locked “${e.name}” so it stays as designed. Ask them if it needs to change. Nothing was changed.`;
}
