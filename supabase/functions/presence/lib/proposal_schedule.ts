// ── A proposal paid in parts (sales item 106, borrowed from Wix's proposals) ──
// "Payment 1 of 3, 2 of 3 …" set on the proposal itself, so the client sees how
// they'll pay before they accept, and the parts become invoices on their own:
// part 1 "when you sign" is the deposit the agreement's send already makes (the
// sign page hands it straight over), and signing makes the rest, each with its
// due date. The schedule rides the proposal's reserved meta element
// (lib/sales_lifecycle.ts packLineItems) — no new column — as whole percents, so
// the amounts always follow the total, discount and tax included.
//   when: 'sign'  when they sign the agreement (part 1 only)
//         'date'  on a date
//         'days'  N days after they sign
//         'done'  when the work is done (no date; the studio sends it)
// Pure. pipeline.html (the editor's preview) and sign.html (the client's page)
// carry mirrors that tests/presence/proposal_schedule_test.mjs runs against these.
import type { StageInput } from './sales_lifecycle.ts';
import { formatMoney, formatLongDate } from './doc_placeholders.ts';

export type PayWhen = 'sign' | 'date' | 'days' | 'done';
export interface SchedulePart { pct: number; when: PayWhen; date?: string; days?: number }
export const MAX_PARTS = 6;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WHENS: ReadonlySet<string> = new Set(['sign', 'date', 'days', 'done']);

/** Clean a schedule from the editor. null = paid in one go. Pure. */
export function normalizeSchedule(raw: unknown): { ok: true; parts: SchedulePart[] | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || (Array.isArray(raw) && raw.length === 0)) return { ok: true, parts: null };
  if (!Array.isArray(raw)) return { ok: false, error: 'Send the payment parts as a list.' };
  if (raw.length < 2) return { ok: false, error: 'Paid in parts means two parts or more.' };
  if (raw.length > MAX_PARTS) return { ok: false, error: `A proposal can be paid in up to ${MAX_PARTS} parts.` };
  const parts: SchedulePart[] = [];
  let lastDate = '';
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] && typeof raw[i] === 'object' ? raw[i] as Record<string, unknown> : {};
    const pct = Number(r.pct);
    if (!Number.isInteger(pct) || pct < 1 || pct > 99) return { ok: false, error: `Part ${i + 1} needs a whole percent between 1 and 99.` };
    const when = String(r.when || '');
    if (!WHENS.has(when)) return { ok: false, error: `Say when part ${i + 1} is paid.` };
    if (when === 'sign' && i > 0) return { ok: false, error: 'Only the first part can be paid when they sign.' };
    const p: SchedulePart = { pct, when: when as PayWhen };
    if (when === 'date') {
      const d = String(r.date || '');
      if (!DATE_RE.test(d) || !Number.isFinite(Date.parse(d + 'T00:00:00Z'))) return { ok: false, error: `Pick a date for part ${i + 1}.` };
      if (lastDate && d < lastDate) return { ok: false, error: `Part ${i + 1} is dated before the part above it.` };
      lastDate = d; p.date = d;
    }
    if (when === 'days') {
      const n = Number(r.days);
      if (!Number.isInteger(n) || n < 1 || n > 365) return { ok: false, error: `Part ${i + 1}: how many days after they sign (1 to 365)?` };
      p.days = n;
    }
    parts.push(p);
  }
  const sum = parts.reduce((n, p) => n + p.pct, 0);
  if (sum !== 100) return { ok: false, error: `The parts add up to ${sum}%. Make them 100%.` };
  return { ok: true, parts };
}

/** Each part's amount: its percent of the total, whole cents, the last taking what
 *  rounding left so they always add up exactly. Pure. */
export function scheduleAmounts(parts: SchedulePart[], totalCents: number): number[] {
  const total = Math.max(0, Math.trunc(Number(totalCents)) || 0);
  const out = parts.map((p) => Math.floor(total * p.pct / 100));
  if (out.length) out[out.length - 1] = total - out.slice(0, -1).reduce((n, x) => n + x, 0);
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return `${MONTHS[(m || 1) - 1]} ${d}, ${y}`; };
/** When a part is paid, in the client's words. Pure. */
export function partWhen(p: SchedulePart): string {
  if (p.when === 'sign') return 'When you sign the agreement';
  if (p.when === 'date' && p.date) return 'Due ' + dayWords(p.date);
  if (p.when === 'days' && p.days) return `Due ${p.days} day${p.days === 1 ? '' : 's'} after you sign`;
  return 'Due when the work is done';
}

export interface ScheduleRow { n: number; of: number; pct: number; amount_cents: number; when: PayWhen; words: string; date: string | null; days: number | null }
/** The parts as the pages show them, from a proposal's meta and its total; null
 *  when it is paid in one go. Pure. */
export function scheduleView(schedule: unknown, totalCents: number): ScheduleRow[] | null {
  const s = normalizeSchedule(schedule);
  if (!s.ok || !s.parts) return null;
  const amounts = scheduleAmounts(s.parts, totalCents);
  return s.parts.map((p, i) => ({ n: i + 1, of: s.parts!.length, pct: p.pct, amount_cents: amounts[i], when: p.when, words: partWhen(p), date: p.date || null, days: p.days || null }));
}

/** "Paid in 3 parts · $1,600 when you sign" — the line under the total. Pure. */
export function scheduleSummary(rows: ScheduleRow[] | null, money: (c: number) => string): string {
  if (!rows || !rows.length) return '';
  const first = rows[0];
  return `Paid in ${rows.length} parts` + (first.when === 'sign' ? ` · ${money(first.amount_cents)} when you sign` : '');
}

/** Ready-made splits for the editor. Pure. */
export function presetSchedule(kind: string): SchedulePart[] | null {
  if (kind === 'half') return [{ pct: 50, when: 'sign' }, { pct: 50, when: 'done' }];
  if (kind === 'thirds') return [{ pct: 34, when: 'sign' }, { pct: 33, when: 'days', days: 30 }, { pct: 33, when: 'done' }];
  return null;
}

/** The invoices a signed agreement makes from the schedule (lib/sales_lifecycle.ts
 *  StageInput): every part but a "when you sign" first one, which the agreement's
 *  send already made as the deposit (`withFirst` makes that one too, due the day
 *  they sign). `signedYmd` dates the "days after" parts. Pure. */
export function stagesAfterSigning(parts: SchedulePart[], totalCents: number, signedYmd: string, opts: { withFirst?: boolean } = {}): Array<StageInput & { label: string; amount_cents: number }> {
  const amounts = scheduleAmounts(parts, totalCents);
  const n = parts.length;
  const out: Array<StageInput & { label: string; amount_cents: number }> = [];
  parts.forEach((p, i) => {
    if (i === 0 && p.when === 'sign') {
      if (opts.withFirst) out.push({ label: `Part 1 of ${n}`, amount_cents: amounts[0], due_date: DATE_RE.test(signedYmd) ? signedYmd : null, purpose: 'deposit' });
      return;
    }
    let due: string | null = null;
    if (p.when === 'date' && p.date) due = p.date;
    if (p.when === 'days' && p.days && DATE_RE.test(signedYmd)) {
      const t = Date.parse(signedYmd + 'T00:00:00Z') + p.days * 86_400_000;
      due = new Date(t).toISOString().slice(0, 10);
    }
    // a part with no date says when it is due in its own name (the invoice would otherwise read "due now")
    out.push({ label: `Part ${i + 1} of ${n}` + (p.when === 'done' ? ' · when the work is done' : ''), amount_cents: amounts[i], due_date: due, purpose: 'service' });
  });
  return out;
}
/** The first part's amount when it is paid at signing (the deposit), else null. Pure. */
export function signingPart(parts: SchedulePart[] | null | undefined, totalCents: number): { amount_cents: number; label: string } | null {
  if (!parts || !parts.length || parts[0].when !== 'sign') return null;
  return { amount_cents: scheduleAmounts(parts, totalCents)[0], label: `Part 1 of ${parts.length}` };
}

/** What signing makes, given the deposit invoices already on the deal: the later parts
 *  when that deposit is the schedule's part 1, every part when there is none, and
 *  nothing when the deal's deposit is something else (a half-and-half deposit from an
 *  agreement sent before the parts were set, say): the studio bills those by hand, so
 *  the client is never billed more than the total. Pure. */
export function partsAtSigning(parts: SchedulePart[], totalCents: number, signedYmd: string, deposits: Array<{ amount_cents?: unknown }>): Array<StageInput & { label: string; amount_cents: number }> {
  const first = signingPart(parts, totalCents);
  if (!deposits.length) return stagesAfterSigning(parts, totalCents, signedYmd, { withFirst: true });
  if (!first || deposits.length > 1 || Math.trunc(Number(deposits[0].amount_cents)) !== first.amount_cents) return [];
  return stagesAfterSigning(parts, totalCents, signedYmd);
}

// ── the agreement says the same as the parts ──
// The standard agreement (pipeline.html's packages) promises half to begin and half
// before launch in four places: the cover's Payment line, the fee table, the Project
// fee clause and the legal Payment terms. For a proposal paid in parts each is
// rewritten from the parts, so the agreement, the proposal and the invoices agree.
// These are the passages exactly as the packages write them, before the placeholders
// are filled; tests/presence/proposal_schedule_test.mjs proves every package carries
// them. pipeline.html mirrors this for the agreement it drafts.
export const HALF_PASSAGES = {
  cover: 'Payment:        50% deposit ({{deposit_amount}}) to begin · 50% ({{balance_amount}}) due before launch',
  table: 'Deposit due at signing, 50 percent                      {{deposit_amount}}\nBalance due at launch, 50 percent                       {{balance_amount}}',
  fee: 'The project fee of {{deal_value}} is paid in two parts. Fifty percent, or {{deposit_amount}} , is due at signing and before work begins. The remaining fifty percent, or {{balance_amount}} , is due at launch. The site goes live once the balance is received.',
  terms: 'A non-refundable deposit of 50% of the total project fee is due before work begins. The remaining 50% is due upon project completion, prior to live site launch, DNS transfer, or handoff of final files.',
} as const;
type PassageKey = keyof typeof HALF_PASSAGES;
/** Text that still promises half and half, drafted or filled in. */
export const HALF_AND_HALF_RE = /50% deposit|deposit of 50%|Fifty percent, or|Deposit due at signing, 50 percent|Balance due at launch, 50 percent/;

const COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
// When a part is paid, as each passage says it: the cover and fee table, the clause, the legal terms
function partPhrases(p: SchedulePart): { short: string; clause: string; terms: string } {
  if (p.when === 'sign') return { short: 'when you sign', clause: 'at signing and before work begins', terms: 'upon signing' };
  if (p.when === 'date' && p.date) { const d = 'by ' + formatLongDate(new Date(p.date + 'T00:00:00Z')); return { short: d, clause: d, terms: d }; }
  if (p.when === 'days' && p.days) { const n = `${p.days} day${p.days === 1 ? '' : 's'}`; return { short: `${n} after you sign`, clause: `${n} after signing`, terms: `${n} after signing` }; }
  return { short: 'when the work is done', clause: 'at launch', terms: 'upon project completion, prior to live site launch, DNS transfer, or handoff of final files' };
}

/** The four passages for a schedule, its money from the proposal's total. Pure. */
export function partsPassages(parts: SchedulePart[], totalCents: number): Record<PassageKey, string> {
  const total = Math.max(0, Math.trunc(Number(totalCents)) || 0);
  const amounts = scheduleAmounts(parts, total);
  const wc = [total, ...amounts].some((c) => c % 100 !== 0);   // the figures agree on cents, as the placeholders do
  const m = (c: number) => formatMoney(c, wc);
  const n = parts.length;
  const ph = parts.map(partPhrases);
  const pad = (label: string) => label + ' '.repeat(Math.max(2, 56 - label.length));
  const terms = parts.map((p, i) => `${p.pct}% ${ph[i].terms}`);
  const sep = terms.some((t) => t.includes(',')) ? '; ' : ', ';
  return {
    cover: `Payment:        In ${n} parts: ` + parts.map((p, i) => `${p.pct}% (${m(amounts[i])}) ${ph[i].short}`).join(' · '),
    table: parts.map((p, i) => pad(`Part ${i + 1} of ${n}, ${ph[i].short}, ${p.pct} percent`) + m(amounts[i])).join('\n'),
    fee: `The project fee of ${m(total)} is paid in ${COUNT_WORDS[n] || n} parts. ` + parts.map((p, i) => `Part ${i + 1}, ${p.pct} percent or ${m(amounts[i])}, is due ${ph[i].clause}.`).join(' ') + ' The site goes live once every part due by launch is received.',
    terms: `The total project fee is paid in ${n} parts: ` + (n === 2 ? terms.join(' and ') : terms.slice(0, -1).join(sep) + sep + 'and ' + terms[n - 1]) + '.'
      + (parts[0].when === 'sign' ? ' The first part is a non-refundable deposit due before work begins.' : ''),
  };
}

/** An agreement's text with its half-and-half passages rewritten from the parts. Only
 *  those exact passages change, so the studio's own wording is left as written; `left`
 *  says a half-and-half promise is still in it (the deal page asks before sending).
 *  No parts, or no total yet, changes nothing. Pure. */
export function partsIntoAgreement(text: string | null | undefined, parts: SchedulePart[] | null | undefined, totalCents: number): { text: string; changed: number; left: boolean } {
  let out = String(text ?? '');
  if (!parts || parts.length < 2 || !(Math.trunc(Number(totalCents)) > 0)) return { text: out, changed: 0, left: false };
  const next = partsPassages(parts, totalCents);
  let changed = 0;
  for (const k of Object.keys(HALF_PASSAGES) as PassageKey[]) {
    if (out.includes(HALF_PASSAGES[k])) { out = out.split(HALF_PASSAGES[k]).join(next[k]); changed++; }
  }
  return { text: out, changed, left: HALF_AND_HALF_RE.test(out) };
}
