// ── Website health with a memory (builder list item 183, Nov 2026) ────────────────
// Semrush's Site Audit keeps every crawl: a trend, "3 fixed, 2 new since the last
// check", problems in themed groups, and a PDF. The evidence engine already checks
// each site through the day, and since migration 0170 each day's health is kept
// (presence_health_days, lib/health_score.ts). This reads that memory for one site:
//   • a line: the things to look at, one point a week for the last eight weeks;
//   • now against four weeks ago ("3 fewer than Oct 14");
//   • since last week: what was fixed and what is new, by page or part;
//   • today's problems under the seven plain headings, each with its fix;
//   • the same as a PDF to keep or send.
// Law 13: everything here is words and counts, never the studio's 0 to 100 number,
// because the client reads this. Pure.
import { HEADINGS, headingOf, titleOf, counts, typeOfFingerprint, sinceThen } from './health_score.ts';
import type { HeadingKey } from './health_score.ts';
import { PdfDoc, rgb, wrapText, type PdfFont, type Rgb } from './pdf.ts';

export interface DayRow { day: string; critical: number; warning: number; fingerprints?: string[] | null; run_id?: string | null }
export interface CurrentItem { type: string; severity: string; resource?: string | null; human?: string | null; next_action?: string | null }
export interface MemoryChange { type: string; title: string; n: number; resources: string[] }
export interface MemoryIssue { type: string; title: string; severity: 'critical' | 'warning'; heading: HeadingKey; n: number; resources: string[]; human: string; next_action: string }
export interface HealthMemory {
  kept: boolean;                                   // any day kept yet
  since_day: string | null;                        // the first day kept
  points: Array<{ day: string; n: number }>;       // one a week, oldest first, up to eight
  now: { day: string; n: number; critical: number; warning: number } | null;
  then: { day: string; n: number } | null;         // the day nearest four weeks ago
  since: { day: string; fixed: MemoryChange[]; added: MemoryChange[] } | null;   // against a week ago
  headings: Array<{ key: HeadingKey; title: string; n: number }>;
  issues: MemoryIssue[];
}

const dayMs = (d: string) => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
const nOf = (r: DayRow) => (Number(r.critical) || 0) + (Number(r.warning) || 0);
const RESOURCES_SHOWN = 5;

/** The newest kept day on or before `ms`, or null. `rows` newest first. */
function onOrBefore(rows: DayRow[], ms: number): DayRow | null {
  return rows.find((r) => dayMs(r.day) <= ms) || null;
}

/** Group fingerprints by problem type, the biggest first. */
function byType(fps: string[], titles: Map<string, string>): MemoryChange[] {
  const m = new Map<string, MemoryChange>();
  for (const fp of fps) {
    const type = typeOfFingerprint(fp);
    if (!type) continue;
    const res = String(fp).split('|').slice(2).join('|');
    const cur = m.get(type) || { type, title: titleOf(type, titles.get(type)), n: 0, resources: [] };
    cur.n++;
    if (res && cur.resources.length < RESOURCES_SHOWN) cur.resources.push(res);
    m.set(type, cur);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.title.localeCompare(b.title));
}

/** The memory, from the kept days (any order) and the latest run's problems. Pure. */
export function buildHealthMemory(i: { days: DayRow[] | null; items: CurrentItem[] | null; live: boolean; hidden?: boolean; todayIso: string }): HealthMemory {
  const rows = (i.days || []).filter((r) => r && r.day).slice().sort((a, b) => dayMs(b.day) - dayMs(a.day));
  const today = dayMs(i.todayIso.slice(0, 10));
  const latest = rows[0] || null;
  // today's problems, grouped by type, under their headings (the run behind the latest day)
  const issuesBy = new Map<string, MemoryIssue>();
  const titles = new Map<string, string>();
  for (const it of i.items || []) {
    const sev = it?.severity;
    if (sev !== 'critical' && sev !== 'warning') continue;
    const type = String(it.type || '');
    if (!type || !counts(type, { live: i.live, hidden: i.hidden })) continue;
    if (it.human && !titles.has(type)) titles.set(type, String(it.human));
    const cur = issuesBy.get(type) || { type, title: titleOf(type, it.human), severity: sev, heading: headingOf(type), n: 0, resources: [], human: String(it.human || ''), next_action: String(it.next_action || '') };
    cur.n++;
    if (sev === 'critical') cur.severity = 'critical';
    const res = String(it.resource || '').trim();
    if (res && cur.resources.length < RESOURCES_SHOWN && !cur.resources.includes(res)) cur.resources.push(res);
    issuesBy.set(type, cur);
  }
  const issues = [...issuesBy.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1) || b.n - a.n || a.title.localeCompare(b.title));
  const headings = HEADINGS.map((h) => ({ key: h.key, title: h.title, n: issues.filter((x) => x.heading === h.key).length }));
  // a point a week: the newest kept day on or before each of the last eight weekly marks
  const points: HealthMemory['points'] = [];
  const base = latest ? dayMs(latest.day) : today;
  for (let w = 7; w >= 0; w--) {
    const r = onOrBefore(rows, base - w * 7 * 86_400_000);
    if (r && !points.some((p) => p.day === r.day)) points.push({ day: String(r.day).slice(0, 10), n: nOf(r) });
  }
  const then = latest ? onOrBefore(rows, dayMs(latest.day) - 28 * 86_400_000) : null;
  const week = latest ? onOrBefore(rows, dayMs(latest.day) - 7 * 86_400_000) : null;
  let since: HealthMemory['since'] = null;
  if (latest && week && Array.isArray(week.fingerprints) && Array.isArray(latest.fingerprints)) {
    const d = sinceThen(week.fingerprints, latest.fingerprints);
    since = { day: String(week.day).slice(0, 10), fixed: byType(d.fixed, titles), added: byType(d.added, titles) };
  }
  return {
    kept: rows.length > 0,
    since_day: rows.length ? String(rows[rows.length - 1].day).slice(0, 10) : null,
    points,
    now: latest ? { day: String(latest.day).slice(0, 10), n: nOf(latest), critical: Number(latest.critical) || 0, warning: Number(latest.warning) || 0 } : null,
    then: then ? { day: String(then.day).slice(0, 10), n: nOf(then) } : null,
    since, headings, issues,
  };
}

/** "Oct 14" (UTC). */
export const shortDay = (d: string): string => new Date(dayMs(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
/** "2 things to look at", "Nothing to look at". */
export const thingsWords = (n: number): string => (n === 0 ? 'Nothing to look at' : n === 1 ? '1 thing to look at' : `${n} things to look at`);
/** "3 fewer than Oct 14", "1 more than Oct 14", "The same as Oct 14". */
export function changeWords(now: number, then: { day: string; n: number } | null): string {
  if (!then) return '';
  const d = now - then.n, when = shortDay(then.day);
  return d === 0 ? `The same as ${when}` : d < 0 ? `${-d} fewer than ${when}` : `${d} more than ${when}`;
}

// ── The PDF (US Letter, lib/pdf.ts) ──
const INK: Rgb = [0.09, 0.082, 0.133], SOFT: Rgb = [0.333, 0.322, 0.416], LINE: Rgb = [0.906, 0.902, 0.937];
const GOOD: Rgb = [0.067, 0.455, 0.29], BAD: Rgb = [0.749, 0.208, 0.208], WARN: Rgb = [0.58, 0.325, 0.039], PANEL: Rgb = [0.965, 0.961, 0.98];
const L = 54, R = 558, W = R - L, TOP = 742, BOTTOM = 64;

/** Website health as a PDF to keep or send: the count and its change, the eight-week
 *  line, fixed and new since last week, every heading, then each problem with its fix.
 *  `facts` are the Health check's own lines (online, speed). Pure. */
export function healthPdf(m: HealthMemory, o: { studio: { name: string; accent?: string }; site: string; address: string; facts: string[]; todayIso: string }): Uint8Array<ArrayBuffer> {
  const pdf = new PdfDoc(`Website health · ${o.site}`);
  let y = TOP;
  const need = (h: number) => { if (y - h < BOTTOM) { pdf.addPage(); y = TOP; } };
  const para = (s: string, size = 10, font: PdfFont = 'R', color: Rgb = INK, indent = 0) => {
    for (const line of wrapText(s, font, size, W - indent)) { need(size * 1.45); if (line) pdf.text(L + indent, y - size, line, { font, size, color }); y -= size * 1.45; }
  };
  const accent = rgb(o.studio.accent || '#6d3fd4');
  pdf.rect(0, 786, 612, 6, accent);
  pdf.text(L, y - 14, o.studio.name, { font: 'B', size: 12, color: accent });
  pdf.textRight(R, y - 14, shortDay(o.todayIso) + ', ' + o.todayIso.slice(0, 4), { size: 9, color: SOFT });
  y -= 40;
  para(`Website health: ${o.site}`, 20, 'B');
  if (o.address) para(o.address.replace(/^https?:\/\//, ''), 10, 'R', SOFT);
  y -= 6;
  const n = m.now ? m.now.n : m.issues.length;
  para(thingsWords(n) + (m.now && m.then ? ` · ${changeWords(n, m.then)}` : ''), 14, 'B', n === 0 ? GOOD : INK);
  for (const f of o.facts) para(f, 10, 'R', SOFT);
  // the line: things to look at, one point a week
  if (m.points.length > 1) {
    need(130); y -= 8;
    const top = y, h = 90, max = Math.max(4, ...m.points.map((p) => p.n));
    pdf.rect(L, top - h - 24, W, h + 24, PANEL);
    const step = (W - 60) / (m.points.length - 1), at = (k: number) => [L + 30 + k * step, top - 12 - (1 - m.points[k].n / max) * (h - 24)] as const;
    for (let k = 0; k < m.points.length; k++) {
      const [x, py] = at(k);
      if (k) { const [px, pp] = at(k - 1); pdf.line(px, pp, x, py, WARN, 1.6); }
      pdf.rect(x - 2, py - 2, 4, 4, WARN);
      pdf.text(x - 4, py + 6, String(m.points[k].n), { font: 'B', size: 8, color: INK });
      pdf.text(x - 12, top - h - 16, shortDay(m.points[k].day), { size: 7.5, color: SOFT });
    }
    y = top - h - 34;
    para('Things to look at, one point a week.', 8.5, 'R', SOFT);
  }
  if (m.since) {
    y -= 6; para(`Since ${shortDay(m.since.day)}`, 12, 'B');
    if (!m.since.fixed.length && !m.since.added.length) para('Nothing fixed and nothing new.', 10, 'R', SOFT);
    for (const c of m.since.fixed) para(`Fixed: ${c.title}${c.n > 1 ? ` (${c.n})` : ''}${c.resources.length ? ` · ${c.resources.join(', ')}` : ''}`, 10, 'R', GOOD);
    for (const c of m.since.added) para(`New: ${c.title}${c.n > 1 ? ` (${c.n})` : ''}${c.resources.length ? ` · ${c.resources.join(', ')}` : ''}`, 10, 'R', BAD);
  }
  y -= 6;
  for (const h of m.headings) {
    const mine = m.issues.filter((x) => x.heading === h.key);
    need(40); y -= 4; pdf.line(L, y, R, y, LINE); y -= 6;
    para(h.title + (mine.length ? ` · ${mine.length} to look at` : ' · All good'), 12, 'B', mine.length ? INK : GOOD);
    for (const x of mine) {
      para(`${x.title}${x.n > 1 ? ` (${x.n})` : ''}`, 10.5, 'B', x.severity === 'critical' ? BAD : INK, 8);
      if (x.resources.length) para(x.resources.join(', '), 9, 'R', SOFT, 8);
      if (x.next_action) para(x.next_action, 9.5, 'R', INK, 8);
    }
  }
  if (!m.kept) { y -= 8; para('Each day’s check is kept from now on, so the line fills in week by week.', 9, 'R', SOFT); }
  const total = pdf.pageCount;   // read before onPage, which shows the callback one page at a time
  for (let p = 0; p < total; p++) pdf.onPage(p, () => pdf.textRight(R, 40, `${p + 1} of ${total}`, { size: 8, color: SOFT }));
  return pdf.bytes();
}
