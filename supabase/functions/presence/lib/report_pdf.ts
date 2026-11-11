// ── The monthly report as a PDF to keep (builder list item 184, Nov 2026) ─────────
// The same report the email carries, on US Letter with lib/pdf.ts: the studio's name
// in its colour, the month, the numbers in boxes, then each part in a sentence or
// two: Google and the searches followed, AI answers with a tick or a cross a
// question, reviews, website health, what people read and what changed. A part that
// couldn't be read is left out, never shown as zero. Pure: same data, same bytes.
import { PdfDoc, rgb, wrapText, type PdfFont, type Rgb } from './pdf.ts';
import type { ReportData } from '../ops/monthly_report.ts';

const INK: Rgb = [0.09, 0.082, 0.133], SOFT: Rgb = [0.333, 0.322, 0.416], LINE: Rgb = [0.906, 0.902, 0.937];
const GOOD: Rgb = [0.067, 0.455, 0.29], BAD: Rgb = [0.749, 0.208, 0.208], PANEL: Rgb = [0.965, 0.961, 0.98];
const L = 54, R = 558, W = R - L, TOP = 742, BOTTOM = 64;
const n1 = (n: number) => n.toLocaleString('en-US');

/** "up 18% on September", "down 12% on September", "the same as September", or ''. Pure. */
export function changeOn(now: number | null, before: number | null, priorLabel: string): string {
  if (now === null || before === null) return '';
  if (before === 0) return now > 0 ? `new since ${priorLabel}` : '';
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? `the same as ${priorLabel}` : `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on ${priorLabel}`;
}

/** The file name a client keeps: "Maple-and-Main-Realty-October-2026.pdf". Pure. */
export const reportFileName = (name: string, monthLabel: string) => `${String(name || 'Website').replace(/&/g, 'and').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Website'}-${monthLabel.replace(/\s+/g, '-')}.pdf`;

export function reportPdf(d: ReportData, o: { studioName: string; accent?: string | null; clientName?: string | null; siteName: string }): Uint8Array<ArrayBuffer> {
  const pdf = new PdfDoc(`${o.siteName} · ${d.monthLabel}`);
  let y = TOP;
  const need = (h: number) => { if (y - h < BOTTOM) { pdf.addPage(); y = TOP; } };
  const para = (s: string, size = 10, font: PdfFont = 'R', color: Rgb = INK, indent = 0) => {
    for (const line of wrapText(s, font, size, W - indent)) { need(size * 1.45); if (line) pdf.text(L + indent, y - size, line, { font, size, color }); y -= size * 1.45; }
  };
  const head = (s: string) => { need(34); y -= 8; pdf.line(L, y, R, y, LINE); y -= 6; para(s, 12.5, 'B'); };
  const accent = rgb(o.accent || '#6d3fd4');
  pdf.rect(0, 786, 612, 6, accent);
  pdf.text(L, y - 14, o.studioName, { font: 'B', size: 12, color: accent });
  pdf.textRight(R, y - 14, `${o.siteName} · ${d.monthLabel}`, { size: 9, color: SOFT });
  y -= 40;
  para(`Your website in ${d.monthLabel.replace(/\s\d{4}$/, '')}`, 20, 'B');
  if (d.address) para(d.address.replace(/^https?:\/\//, ''), 10, 'R', SOFT);
  y -= 8;
  // the numbers, in boxes
  const prior = d.priorLabel || 'the month before';
  const boxes: Array<[string, string, string]> = [];
  if (d.visitors !== null) boxes.push(['Visits', n1(d.visitors), changeOn(d.visitors, d.priorVisitors, prior)]);
  if (d.enquiries !== null) boxes.push(['Enquiries', n1(d.enquiries), '']);
  if (d.search) boxes.push(['Google clicks', n1(d.search.clicks), changeOn(d.search.clicks, d.search.priorClicks, prior)]);
  if (d.ai) boxes.push(['AI answers', `${d.ai.named} of ${d.ai.asked}`, d.ai.priorNamed === null ? '' : d.ai.named === d.ai.priorNamed ? 'the same as before' : `${d.ai.named > d.ai.priorNamed ? 'up' : 'down'} ${Math.abs(d.ai.named - d.ai.priorNamed)}`]);
  if (boxes.length) {
    need(62);
    const gap = 10, bw = (W - gap * (boxes.length - 1)) / boxes.length;
    boxes.forEach(([k, v, c], i) => {
      const x = L + i * (bw + gap);
      pdf.rect(x, y - 56, bw, 56, PANEL);
      pdf.text(x + 10, y - 15, k, { size: 8.5, color: SOFT });
      pdf.text(x + 10, y - 34, v, { font: 'B', size: 16, color: INK });
      if (c) pdf.text(x + 10, y - 48, c, { size: 7.5, color: /^down/.test(c) ? BAD : GOOD });
    });
    y -= 66;
  }
  if (d.search) {
    head('On Google');
    para(`${n1(d.search.clicks)} clicks to your site and ${n1(d.search.impressions)} times seen${changeOn(d.search.clicks, d.search.priorClicks, prior) ? `; clicks ${changeOn(d.search.clicks, d.search.priorClicks, prior)}` : ''}.`);
    for (const f of d.followed) {
      const place = f.position === null ? 'not seen this month' : `${Math.round(f.position)}${ordinal(Math.round(f.position))} on Google`;
      const move = f.position !== null && f.priorPosition !== null ? Math.round(f.priorPosition) - Math.round(f.position) : null;
      para(`“${f.term}”: ${place}${move ? `, ${move > 0 ? 'up' : 'down'} ${Math.abs(move)} place${Math.abs(move) === 1 ? '' : 's'}` : ''}${f.clicks ? ` · ${n1(f.clicks)} click${f.clicks === 1 ? '' : 's'}` : ''}`, 10, 'R', INK, 8);
    }
  }
  if (d.ai) {
    head('In AI answers');
    para(`${d.ai.engines || 'Claude'} named you for ${d.ai.named} of the ${d.ai.asked} questions we ask each month${d.ai.priorNamed !== null ? `, ${d.ai.named === d.ai.priorNamed ? 'the same as' : d.ai.named > d.ai.priorNamed ? `up from ${d.ai.priorNamed}` : `down from ${d.ai.priorNamed}`}${d.ai.named === d.ai.priorNamed ? ' the month before' : ''}` : ''}.`);
    for (const q of d.ai.questions) {
      need(16);
      const mark = q.named === true ? 'Yes' : q.named === false ? 'No' : '–';
      pdf.text(L + 8, y - 10, mark, { font: 'B', size: 9.5, color: q.named === true ? GOOD : q.named === false ? BAD : SOFT });
      const lines = wrapText(q.q, 'R', 9.5, W - 40);
      lines.forEach((ln, i) => { if (i) need(14); pdf.text(L + 36, y - 10, ln, { size: 9.5, color: INK }); y -= 14; });
    }
  }
  if (d.reviews) {
    head('Reviews');
    const parts: string[] = [];
    if (d.reviews.rating !== null && d.reviews.count !== null) parts.push(`${d.reviews.rating.toFixed(1)} stars from ${n1(d.reviews.count)} Google review${d.reviews.count === 1 ? '' : 's'}`);
    if (d.reviews.newGoogle) parts.push(`${d.reviews.newGoogle} new on Google in the last 30 days`);
    if (d.reviews.unreplied) parts.push(`${d.reviews.unreplied} waiting for a reply`);
    if (d.reviews.ownNew) parts.push(`${d.reviews.ownNew} new on your site this month`);
    para(parts.length ? parts.join('. ') + '.' : 'No new reviews this month.');
  }
  if (d.health) {
    head('Website health');
    const n = d.health.n;
    para(`${n === 0 ? 'Nothing to look at' : `${n} thing${n === 1 ? '' : 's'} to look at`}${d.health.then !== null ? (d.health.then === n ? ', the same as a month ago' : `, ${Math.abs(d.health.then - n)} ${d.health.then > n ? 'fewer' : 'more'} than a month ago`) : ''}${d.health.fixed ? `. ${d.health.fixed} fixed this month` : ''}.`);
  }
  if (d.topPages.length) {
    head('What people read most');
    d.topPages.forEach((p, i) => para(`${i + 1}. ${p.path === '/' ? 'Home page' : p.path} · ${n1(p.views)} view${p.views === 1 ? '' : 's'}`, 10, 'R', INK, 8));
  }
  if (d.publishes !== null) {
    head('What changed');
    para(d.publishes === 0 ? 'Nothing was published this month. Your site stayed as it was.' : `${d.publishes === 1 ? 'One update went live' : `${n1(d.publishes)} updates went live`}.`);
  }
  const total = pdf.pageCount;
  for (let p = 0; p < total; p++) pdf.onPage(p, () => pdf.textRight(R, 40, `${p + 1} of ${total}`, { size: 8, color: SOFT }));
  return pdf.bytes();
}

function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
}
