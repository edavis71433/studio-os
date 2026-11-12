// ── Builder list item 156: bring in a whole list of old page addresses at once ──
// Moving a client from Wix, Squarespace or WordPress used to mean typing every old
// address and its new home one at a time. Now a pasted list (or a spreadsheet saved as
// CSV) comes in at once, each line read as "old address, where it goes now", and the
// old website's own page list (its sitemap) can be read to suggest the matches. Every
// line says what will happen before anything is saved. Pure: no I/O here.
//
// The rules publishing already keeps (lib/manifest_validate.ts) are kept here too, so an
// import can never leave a site that won't publish: at most 500 forwards, no forward that
// points at itself, and no chains (a forward never lands on another forward's old
// address; an import that would make one goes straight to the final page instead).

export const REDIRECT_CAP = 500;
export const IMPORT_MAX_LINES = 1000;
const OLD_OK = /^\/[a-z0-9\-/_.~%]{0,200}$/;
const NEW_OK = /^\/[a-z0-9\-/_.~%#]{0,200}$/;

export interface ImportPair { line: number; from: string; to: string }
export interface ParseProblem { line: number; text: string; reason: string }

/** One CSV row's cells, quotes and doubled quotes understood. */
function csvCells(line: string): string[] {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
/** The two addresses on one line: tab, comma or semicolon (a spreadsheet), an arrow, or spaces. */
export function splitLine(line: string): string[] {
  const s = line.trim();
  if (s.includes('\t')) return s.split('\t').map((x) => x.trim()).filter(Boolean);
  if (/[,;]/.test(s)) return csvCells(s).filter(Boolean);
  if (/→|->|=>/.test(s)) return s.split(/\s*(?:→|->|=>)\s*/).map((x) => x.trim()).filter(Boolean);
  return s.split(/\s+/).filter(Boolean);
}
const looksLikeAddress = (v: string) => /^(https?:\/\/|\/|www\.)/i.test(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(v);

/** Read a pasted list or a CSV file's text. A first line that isn't addresses ("Old URL,
 *  New URL") is a heading and is left out; a line starting with # is a note. */
export function parseRedirectList(text: unknown): { pairs: ImportPair[]; problems: ParseProblem[] } {
  const pairs: ImportPair[] = [], problems: ParseProblem[] = [];
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).slice(0, IMPORT_MAX_LINES);
  let first = true;
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith('#')) return;
    const cells = splitLine(t);
    if (first) { first = false; if (cells.length >= 2 && !looksLikeAddress(cells[0]) && !looksLikeAddress(cells[1])) return; }
    if (cells.length < 2) { problems.push({ line: i + 1, text: t.slice(0, 200), reason: 'Needs two addresses: the old one, then where it goes now.' }); return; }
    pairs.push({ line: i + 1, from: cells[0], to: cells[1] });
  });
  return { pairs, problems };
}

/** An old address, cleaned to the path the forward listens on: a full address keeps only its
 *  path, letters go lower-case, and a page (not a file like /menu.pdf) ends in a slash. */
export function normalizeOldPath(raw: unknown): { ok: true; path: string } | { ok: false; reason: string } {
  let s = String(raw ?? '').trim();
  if (!s) return { ok: false, reason: 'The old address is empty.' };
  if (/^www\./i.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(s)) s = 'https://' + s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (!/^https?:\/\//i.test(s)) return { ok: false, reason: 'That isn’t a web address.' };
    let u: URL; try { u = new URL(s); } catch { return { ok: false, reason: 'That address can’t be read.' }; }
    if (u.search) return { ok: false, reason: 'An address with a ? part can’t be forwarded; leave the ? part off.' };
    s = u.pathname;
  } else {
    if (s.includes('?')) return { ok: false, reason: 'An address with a ? part can’t be forwarded; leave the ? part off.' };
    s = s.split('#')[0];
  }
  if (!s.startsWith('/')) s = '/' + s;
  s = s.toLowerCase();
  if (s === '/' || s === '') return { ok: false, reason: 'The old home page needs no forward: the new one is at the same address.' };
  if (/\/\/|\/\.\.?(\/|$)/.test(s)) return { ok: false, reason: 'That address has an empty or a dot part.' };
  if (!/\.[a-z0-9]{1,5}$/.test(s) && !s.endsWith('/')) s += '/';
  if (!OLD_OK.test(s)) return { ok: false, reason: 'Old addresses use letters, numbers, dashes, underscores and dots.' };
  return { ok: true, path: s };
}

/** Where it goes now: a page here (/services/), or a full https:// address. A full address
 *  on this site's own hosts becomes its path, so it keeps working if the domain changes. */
export function normalizeNewTarget(raw: unknown, ownHosts: string[] = []): { ok: true; to: string } | { ok: false; reason: string } {
  let s = String(raw ?? '').trim();
  if (!s) return { ok: false, reason: 'Where it goes now is empty.' };
  if (/^www\./i.test(s)) s = 'https://' + s;
  if (/^https?:\/\//i.test(s)) {
    let u: URL; try { u = new URL(s); } catch { return { ok: false, reason: 'That new address can’t be read.' }; }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (ownHosts.map((h) => h.toLowerCase().replace(/^www\./, '')).includes(host)) s = u.pathname + u.hash;
    else if (u.protocol !== 'https:') return { ok: false, reason: 'Send visitors to an https:// address, or to one of your pages.' };
    else return { ok: true, to: u.toString() };
  }
  if (!s.startsWith('/')) s = '/' + s;
  const [p, hash] = s.split('#');
  let path = p.toLowerCase();
  if (!/\.[a-z0-9]{1,5}$/.test(path) && !path.endsWith('/')) path += '/';
  const to = hash ? `${path}#${hash}` : path;
  if (/\/\/|\/\.\.?(\/|$)/.test(path) || !NEW_OK.test(to)) return { ok: false, reason: 'Send visitors to one of your pages (like /services/) or a full https:// address.' };
  return { ok: true, to };
}

export type Verdict = 'add' | 'replace' | 'same' | 'skip';
export interface PlanRow { line: number; from: string; to: string; verdict: Verdict; reason?: string; note?: string }
export interface ImportPlan {
  rows: PlanRow[];
  add: number; replace: number; same: number; skipped: number;
  /** forwards already there whose page is now itself forwarded: they point straight at the final page */
  repoint: Array<{ id: string; from: string; to: string }>;
  total_after: number;
}

/** What each line will do, before anything is saved. `existing` are the site's forwards;
 *  `ownPages` the addresses of its own pages (a forward from one would hide it). */
export function planImport(input: {
  pairs: ImportPair[]; problems?: ParseProblem[];
  existing: Array<{ id: string; from_path: string; to_path: string }>;
  ownPages: Iterable<string>; ownHosts?: string[]; cap?: number;
}): ImportPlan {
  const cap = input.cap ?? REDIRECT_CAP;
  const own = new Set([...input.ownPages].map((p) => String(p).toLowerCase()));
  const rows: PlanRow[] = (input.problems || []).map((p) => ({ line: p.line, from: p.text, to: '', verdict: 'skip' as Verdict, reason: p.reason }));
  const firstLine = new Map<string, number>();
  const fresh: PlanRow[] = [];
  for (const p of input.pairs) {
    const f = normalizeOldPath(p.from);
    if (!f.ok) { rows.push({ line: p.line, from: String(p.from), to: String(p.to), verdict: 'skip', reason: f.reason }); continue; }
    const t = normalizeNewTarget(p.to, input.ownHosts || []);
    if (!t.ok) { rows.push({ line: p.line, from: f.path, to: String(p.to), verdict: 'skip', reason: t.reason }); continue; }
    if (own.has(f.path)) { rows.push({ line: p.line, from: f.path, to: t.to, verdict: 'skip', reason: 'That’s the address of a page on this site; a forward would hide it.' }); continue; }
    if (t.to === f.path || t.to.split('#')[0] === f.path) { rows.push({ line: p.line, from: f.path, to: t.to, verdict: 'skip', reason: 'It points at itself.' }); continue; }
    if (firstLine.has(f.path)) { rows.push({ line: p.line, from: f.path, to: t.to, verdict: 'skip', reason: `Listed twice; line ${firstLine.get(f.path)} keeps it.` }); continue; }
    firstLine.set(f.path, p.line);
    fresh.push({ line: p.line, from: f.path, to: t.to, verdict: 'add' });
  }
  // the whole set as it would stand: what's there, with this list on top
  const map = new Map<string, string>();
  for (const e of input.existing) map.set(String(e.from_path).toLowerCase(), String(e.to_path));
  for (const r of fresh) map.set(r.from, r.to);
  const finalOf = (to: string): string | null => {
    let cur = to; const seen = new Set<string>();
    while (map.has(cur.split('#')[0])) {
      if (seen.has(cur)) return null;
      seen.add(cur); cur = map.get(cur.split('#')[0]) as string;
    }
    return cur;
  };
  const existingByFrom = new Map(input.existing.map((e) => [String(e.from_path).toLowerCase(), e]));
  let adds = 0;
  const room = Math.max(0, cap - input.existing.length);
  for (const r of fresh) {
    const end = finalOf(r.to);
    if (end === null || end.split('#')[0] === r.from) { rows.push({ ...r, verdict: 'skip', reason: 'It would go round in a circle with another forward.' }); map.delete(r.from); continue; }
    if (end !== r.to) { r.note = `Goes straight to ${end}: a forward already sends ${r.to.split('#')[0]} there.`; r.to = end; }
    const was = existingByFrom.get(r.from);
    if (was) {
      if (String(was.to_path) === r.to) rows.push({ ...r, verdict: 'same', note: 'Already forwards there.' });
      else rows.push({ ...r, verdict: 'replace', note: `Replaces the forward to ${was.to_path}.` });
      continue;
    }
    if (adds >= room) { rows.push({ ...r, verdict: 'skip', reason: `A site keeps at most ${cap} forwards.` }); map.delete(r.from); continue; }
    if (r.to.startsWith('/') && !own.has(r.to.split('#')[0]) && r.to !== '/') r.note = r.note || 'Not a page on this site yet.';
    adds++;
    rows.push(r);
  }
  // forwards already there that land on an address this list now forwards: straight to the end
  const repoint: ImportPlan['repoint'] = [];
  for (const e of input.existing) {
    if (fresh.some((r) => r.from === String(e.from_path).toLowerCase())) continue;
    const to = String(e.to_path);
    if (!to.startsWith('/') || !fresh.some((r) => r.from === to.split('#')[0])) continue;
    const end = finalOf(to);
    if (end && end !== to && end.split('#')[0] !== String(e.from_path)) repoint.push({ id: e.id, from: String(e.from_path), to: end });
  }
  rows.sort((a, b) => a.line - b.line);
  const count = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
  return { rows, add: count('add'), replace: count('replace'), same: count('same'), skipped: count('skip'), repoint, total_after: input.existing.length + count('add') };
}

// ── suggestions from the old website's own page list ──
const SAME: Record<string, string> = {
  'about-us': 'about', 'about-me': 'about', 'our-story': 'about', 'who-we-are': 'about', 'contact-us': 'contact', 'get-in-touch': 'contact',
  'our-team': 'team', 'meet-the-team': 'team', 'our-services': 'services', 'what-we-do': 'services', 'faqs': 'faq', 'frequently-asked-questions': 'faq',
  'our-menu': 'menu', 'menus': 'menu', 'book': 'booking', 'book-now': 'booking', 'book-online': 'booking', 'blog': 'updates', 'news': 'updates',
  'gallery': 'photos', 'portfolio': 'work', 'testimonials': 'reviews',
};
const BLOGGY = /^\/(blog|post|posts|news|articles|journal|updates)\//;
const tokens = (s: string) => String(s || '').toLowerCase().replace(/\.[a-z0-9]{1,5}$/, '').split(/[^a-z0-9]+/).filter((t) => t && !['the', 'and', 'a', 'of', 'our', 'us', 'page', 'html', 'php', 'index'].includes(t));

/** For each old address, the closest page here (by its words), the updates page for an old
 *  blog post, or the home page; with how sure the match is. Old addresses this site already
 *  has are left out: they keep working without a forward. */
export function suggestTargets(oldPaths: string[], pages: Array<{ path: string; title?: string }>): Array<{ from: string; to: string; sure: boolean }> {
  const ownPaths = new Set(pages.map((p) => p.path.toLowerCase()));
  const hasUpdates = ownPaths.has('/updates/');
  const out: Array<{ from: string; to: string; sure: boolean }> = [];
  const seen = new Set<string>();
  for (const raw of oldPaths) {
    const f = normalizeOldPath(raw);
    if (!f.ok || ownPaths.has(f.path) || seen.has(f.path)) continue;
    seen.add(f.path);
    const segs = f.path.split('/').filter(Boolean);
    const last = segs[segs.length - 1] || '';
    const alias = SAME[last.replace(/\.[a-z0-9]{1,5}$/, '')];
    let best: { path: string; score: number } | null = null;
    for (const p of pages) {
      if (p.path === '/') continue;
      const slug = p.path.split('/').filter(Boolean).pop() || '';
      if (alias && slug === alias) { best = { path: p.path, score: 1 }; break; }
      const a = new Set(tokens(last)), b = new Set([...tokens(slug), ...tokens(p.title || '')]);
      if (!a.size || !b.size) continue;
      const shared = [...a].filter((t) => b.has(t)).length;
      const score = shared / Math.max(a.size, Math.min(b.size, 3));
      if (!best || score > best.score) best = { path: p.path, score };
    }
    if (best && best.score >= 0.5) out.push({ from: f.path, to: best.path, sure: best.score >= 0.99 || !!alias });
    else if (BLOGGY.test(f.path) && hasUpdates) out.push({ from: f.path, to: '/updates/', sure: false });
    else out.push({ from: f.path, to: '/', sure: false });
  }
  return out;
}

/** The page addresses in a sitemap (or the child sitemaps of a sitemap index). */
export function sitemapLocs(xml: string): { pages: string[]; children: string[] } {
  const locs = [...String(xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  return /<sitemapindex[\s>]/i.test(xml) ? { pages: [], children: locs } : { pages: locs, children: [] };
}
