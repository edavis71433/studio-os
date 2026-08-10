// ── Sales lifecycle — pure decision logic (Presence CMS Phase 2, P2-C) ───────
// The stage ladder, proposal math, contract version-integrity, and the
// idempotent convert decision — all pure (no DB, no network) so the commercial
// rules are unit-testable and deterministic. routes/sales.ts wires these to the
// site-scoped tables.

export type Stage = 'lead' | 'qualified' | 'proposal' | 'contract' | 'won' | 'lost';
export const STAGES: Stage[] = ['lead', 'qualified', 'proposal', 'contract', 'won', 'lost'];

// Bounded transitions: forward one, back one, →lost from any active, reopen lost→lead.
// 'won' is terminal (reached only via convert). No arbitrary jumps.
const NEXT: Record<Stage, Stage[]> = {
  lead: ['qualified', 'lost'],
  qualified: ['proposal', 'lead', 'lost'],
  proposal: ['contract', 'qualified', 'lost'],
  contract: ['won', 'proposal', 'lost'],
  won: [],
  lost: ['lead'],
};
export function isStage(s: unknown): s is Stage { return typeof s === 'string' && (STAGES as string[]).includes(s); }
/** May a deal move from → to? Pure. 'won' is reachable only via convert (not here). */
export function canTransition(from: Stage, to: Stage): boolean {
  if (from === to) return false;
  if (to === 'won') return false; // won is set by convert, not a manual stage move
  return (NEXT[from] || []).includes(to);
}

// ── proposals ──
export interface LineItem { label: string; qty: number; unit_cents: number; }
// The proposal's optional discount, flat tax rate, and revise/supersede trail
// ride ONE reserved element in the line_items jsonb array (presence_proposals has
// no spare detail column and adding one to a LIVE table is avoidable). The marker
// key can never collide with a real line item ({label, qty, unit_cents}), and
// splitLineItems() is the single choke point every reader unpacks through, so the
// stored subtotal, the rendered total, and the invoice can never disagree.
export const PROPOSAL_META_KEY = '__meta__';
export const isProposalMetaEl = (el: unknown): boolean =>
  !!el && typeof el === 'object' && !Array.isArray(el) && PROPOSAL_META_KEY in (el as Record<string, unknown>);
/** Validate + normalize line items; returns cleaned items or an error. Pure.
 *  A reserved meta element (discount/tax/trail) is transparently ignored, so a
 *  proposal cloned from a template or a prior version validates cleanly. */
export function normalizeLineItems(raw: unknown): { ok: true; items: LineItem[]; subtotal_cents: number } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'line_items must be a list' };
  const onlyItems = raw.filter((el) => !isProposalMetaEl(el));
  if (onlyItems.length > 100) return { ok: false, error: 'too many line items (max 100)' };
  const items: LineItem[] = [];
  for (const r of onlyItems) {
    const label = String((r && (r as any).label) || '').trim().slice(0, 200);
    const qty = Math.trunc(Number((r as any)?.qty));
    const unit = Math.trunc(Number((r as any)?.unit_cents));
    if (!label) return { ok: false, error: 'each line item needs a label' };
    if (!Number.isFinite(qty) || qty < 0 || qty > 1_000_000) return { ok: false, error: `invalid quantity for “${label}”` };
    if (!Number.isFinite(unit) || unit < 0 || unit > 1_000_000_00) return { ok: false, error: `invalid price for “${label}”` };
    items.push({ label, qty, unit_cents: unit });
  }
  return { ok: true, items, subtotal_cents: subtotalOf(items) };
}
/** Deterministic subtotal in cents. Pure. */
export function subtotalOf(items: LineItem[]): number {
  return (items || []).reduce((n, i) => n + Math.max(0, Math.trunc(i.qty)) * Math.max(0, Math.trunc(i.unit_cents)), 0);
}
export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'declined';
/** A proposal decision is only valid from 'sent'. Pure (idempotent-safe). */
export function canDecideProposal(current: ProposalStatus, decision: 'accepted' | 'declined'): boolean {
  return current === 'sent' && (decision === 'accepted' || decision === 'declined');
}

// ── proposal pricing: honest discount + tax, and the revise trail (no migration) ──
// Total = subtotal − discount + tax(on the post-discount amount). All the state
// beyond the raw line items lives in the reserved PROPOSAL_META_KEY element (see
// above): the owner-entered discount (percent or fixed cents), a flat tax %, and
// the revise trail (`revised_from` on the new version, `superseded_by` stamped on
// the one it replaced). Everything here is pure so the math is deterministic and
// unit-testable; routes/sales.ts and lib/documents.ts read through these helpers.
export interface Discount { mode: 'percent' | 'fixed'; value: number; }   // percent 0..100, or fixed cents
export interface ProposalMeta {
  discount?: Discount | null;
  tax_pct?: number | null;        // flat % 0..100
  revised_from?: string | null;   // the proposal id THIS one revised
  superseded_by?: string | null;  // the proposal id that replaced this one
}
export interface ProposalTotals { subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number; }

/** Separate the real line items from the single reserved meta element. Pure. */
export function splitLineItems(raw: unknown): { items: LineItem[]; meta: ProposalMeta } {
  const arr = Array.isArray(raw) ? raw : [];
  const items: LineItem[] = arr.filter((el) => !isProposalMetaEl(el))
    .map((i: any) => ({ label: String(i?.label ?? ''), qty: Math.trunc(Number(i?.qty)) || 0, unit_cents: Math.trunc(Number(i?.unit_cents)) || 0 }));
  const metaEl = arr.find(isProposalMetaEl) as Record<string, unknown> | undefined;
  const m = metaEl && metaEl[PROPOSAL_META_KEY] && typeof metaEl[PROPOSAL_META_KEY] === 'object' ? metaEl[PROPOSAL_META_KEY] as ProposalMeta : {};
  return { items, meta: m || {} };
}

/** Clean + bound an owner-entered discount. Returns null when there is none. Pure. */
export function normalizeDiscount(raw: unknown): Discount | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const mode = r.mode === 'fixed' ? 'fixed' : r.mode === 'percent' ? 'percent' : null;
  if (!mode) return null;
  let value = Number(r.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  value = mode === 'percent' ? Math.min(100, value) : Math.min(1_000_000_00, Math.trunc(value));  // % 0..100 · cents bounded like a line item
  return { mode, value };
}
/** Clean + bound a flat tax %. Returns null when none. Pure. */
export function normalizeTaxPct(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(100, n);   // a sane 0..100 flat rate
}
/** Build the discount+tax meta from owner input (the revise trail is added separately). Pure. */
export function normalizeProposalMeta(b: unknown): ProposalMeta {
  const src = (b && typeof b === 'object') ? b as Record<string, unknown> : {};
  const meta: ProposalMeta = {};
  const d = normalizeDiscount(src.discount);
  if (d) meta.discount = d;
  const t = normalizeTaxPct(src.tax_pct);
  if (t !== null) meta.tax_pct = t;
  return meta;
}
const metaHasContent = (m: ProposalMeta): boolean =>
  !!(m && (m.discount || m.tax_pct != null || m.revised_from || m.superseded_by));
/** Re-assemble line_items for storage: the real items + (only if it carries
 *  anything) the reserved meta element. Pure. */
export function packLineItems(items: Array<Partial<LineItem>>, meta: ProposalMeta): unknown[] {
  const clean: ProposalMeta = {};
  if (meta?.discount) clean.discount = meta.discount;
  if (meta?.tax_pct != null) clean.tax_pct = meta.tax_pct;
  if (meta?.revised_from) clean.revised_from = meta.revised_from;
  if (meta?.superseded_by) clean.superseded_by = meta.superseded_by;
  const packed: unknown[] = items.map((i) => ({ label: String(i?.label ?? ''), qty: Math.trunc(Number(i?.qty)) || 0, unit_cents: Math.trunc(Number(i?.unit_cents)) || 0 }));
  if (metaHasContent(clean)) packed.push({ [PROPOSAL_META_KEY]: clean });
  return packed;
}

/** The honest breakdown. Discount is clamped to the subtotal and tax to ≥0, so
 *  the total is NEVER negative; rounding is deterministic (Math.round). Pure. */
export function computeProposalTotals(items: LineItem[], meta: ProposalMeta): ProposalTotals {
  const subtotal = subtotalOf(items);
  let discount = 0;
  if (meta?.discount) {
    discount = meta.discount.mode === 'percent'
      ? Math.round(subtotal * Math.min(100, Math.max(0, meta.discount.value)) / 100)
      : Math.trunc(meta.discount.value);
  }
  discount = Math.max(0, Math.min(discount, subtotal));   // never exceeds the subtotal, never negative
  const postDiscount = subtotal - discount;
  const taxPct = (meta?.tax_pct != null && Number.isFinite(Number(meta.tax_pct))) ? Math.min(100, Math.max(0, Number(meta.tax_pct))) : 0;
  const tax = Math.round(postDiscount * taxPct / 100);
  return { subtotal_cents: subtotal, discount_cents: discount, tax_cents: tax, total_cents: Math.max(0, postDiscount + tax) };
}
/** Convenience: split a stored line_items jsonb and compute its totals. Pure. */
export function proposalTotals(rawLineItems: unknown): ProposalTotals {
  const { items, meta } = splitLineItems(rawLineItems);
  return computeProposalTotals(items, meta);
}

// ── contracts: version integrity ──
/** SHA-256 hex over the EXACT bytes a signer sees (body + terms). Signing binds
 *  to this hash, so a signature can never apply to a different version. */
export async function contractHash(body: string, terms: unknown): Promise<string> {
  const material = `${String(body || '')}\n \n${JSON.stringify(terms ?? null)}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export type ContractStatus = 'draft' | 'sent' | 'signed' | 'voided';
/** Signing is valid only from 'sent' AND only when the presented hash matches the
 *  stored one (version integrity — cannot sign a stale/edited version). Pure. */
export function canSignContract(current: ContractStatus, storedHash: string, presentedHash: string): { ok: boolean; reason?: string } {
  if (current === 'signed') return { ok: false, reason: 'already_signed' };
  if (current !== 'sent') return { ok: false, reason: 'not_sent' };
  if (!storedHash || storedHash !== presentedHash) return { ok: false, reason: 'version_mismatch' };
  return { ok: true };
}

/** The SIGNED fact for a deal, derived from its contract rows. Stage 'contract'
 *  CONFLATES "agreement out" and "agreement signed" — the stage ladder has no
 *  signed step (won is convert-only), so anything that words itself off the
 *  stage alone will call a signed deal "waiting to be signed". This is the ONE
 *  place that decides the fact: the drawer guidance (lib/pipeline_guidance.ts)
 *  and the follow-up sweep (commerce/lifecycle.ts) both read it, so the copy on
 *  screen and the copy in a nudge email can never disagree. A soft-deleted
 *  contract row doesn't count. Pure. */
export function agreementSigned(contracts: unknown): boolean {
  return Array.isArray(contracts) && contracts.some((c) =>
    !!c && typeof c === 'object'
    && (c as { status?: unknown }).status === 'signed'
    && !(c as { deleted_at?: unknown }).deleted_at);
}

/** Does the agreement TEXT state an operative engagement term? Returns the term
 *  in months, or null when the document doesn't say. Feeds the renewal-date
 *  default on a signed agreement (the reminder in commerce/lifecycle.ts only
 *  arms off terms_snapshot.term_end): a detected term lets the drawer PREFILL
 *  signed_at + N months for a one-tap confirm — never a silent write.
 *
 *  HONESTY GUARD: only operative term language counts — "12-month term",
 *  "a term of twelve (12) months", "for a term/period of N months". The shipped
 *  agreements' ONLY twelve-month wording is §10's liability lookback ("fees
 *  paid … in the twelve (12) months immediately preceding"), which is a damages
 *  window, not an engagement term — none of these patterns match it, so no date
 *  is ever invented from it. Pure; pipeline.html mirrors this by hand. */
export function impliedTermMonths(body: unknown): number | null {
  const text = String(body ?? '');
  const pats = [
    /\b(\d{1,2})[-\s]month\s+(?:term|engagement)\b/i,                                                    // "12-month term"
    /\b(?:term|period)\s+of\s+(?:this\s+agreement\s+)?(?:is\s+|shall\s+be\s+)?(?:[a-z]+\s+)?\((\d{1,2})\)\s*months?\b/i, // "term of twelve (12) months"
    /\bfor\s+a\s+(?:term|period)\s+of\s+(?:[a-z]+\s+)?\(?(\d{1,2})\)?\s*months?\b/i,                     // "for a term of 12 months"
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 60) return n;
    }
  }
  return null;
}

// ── convert-to-customer (idempotent decision) ──
export interface ConvertibleDeal { stage: Stage; converted_client_id?: string | null; }
export type ConvertOutcome = 'ready' | 'already_converted' | 'blocked_stage' | 'blocked_lost';
/** Decide whether a deal may convert. Idempotent: an already-converted deal
 *  returns `already_converted` (the caller returns the existing result, never a
 *  duplicate). Requires a contract-stage (or already-won) deal. Pure. */
export function convertOutcome(deal: ConvertibleDeal): ConvertOutcome {
  if (deal.converted_client_id) return 'already_converted';
  if (deal.stage === 'lost') return 'blocked_lost';
  if (deal.stage !== 'contract' && deal.stage !== 'won') return 'blocked_stage';
  return 'ready';
}

// ── payment schedules (deposit + balance / staged installments) ──────────────
// A payment schedule is an ORDERED set of staged invoices for one deal — a
// deposit now + balance on completion, or N milestone installments. It is pure
// COMPOSITION over the existing invoice model: each stage becomes one ordinary
// presence_invoices row (label=title, amount_cents, due_date, its own Stripe
// link + reminder sweep), grouped by deal_id and ordered by due_date. No new
// table, column, or migration. This module does the money+date math so the
// stages can never disagree with the deal total; routes/sales.ts mints the rows.
export const MAX_SCHEDULE_STAGES = 12;    // a sane cap — no runaway 500-stage plans
export const MIN_STAGE_CENTS = 50;        // Stripe's ~$0.50 floor (matches the single-invoice route)
export const MAX_TOTAL_CENTS = 1_000_000_00;   // mirrors the presence_invoices amount check
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface StageInput {
  label?: string;
  amount_cents?: number;   // explicit cents (wins over percent)
  percent?: number;        // % of the total (0<pct<100), used when amount_cents is absent
  due_date?: string | null;// 'YYYY-MM-DD' or null (= due now)
  purpose?: 'deposit' | 'service';
}
export interface ScheduleStage {
  label: string;
  amount_cents: number;
  due_date: string | null;
  purpose: 'deposit' | 'service';
}
export type ScheduleResult =
  | { ok: true; stages: ScheduleStage[]; total_cents: number }
  | { ok: false; error: string };

/** Default a stage label when the caller gives none. */
function defaultStageLabel(i: number, n: number, purpose?: string): string {
  if (i === 0 && purpose === 'deposit') return 'Deposit';
  if (i === n - 1) return 'Balance';
  return `Payment ${i + 1}`;
}

/** Add whole days to a 'YYYY-MM-DD' date, returning the same format. Pure &
 *  deterministic (UTC arithmetic — no local clock, no timezone drift). */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = String(iso).split('-').map(Number);
  const t = Date.UTC(y, (m || 1) - 1, d || 1) + Math.trunc(Number(days) || 0) * 86400_000;
  const dt = new Date(t);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** Build + validate a payment schedule. Pure. Guarantees: every stage ≥ $0.50,
 *  the LAST stage absorbs any rounding remainder so the stages ALWAYS sum to the
 *  total exactly, due dates are non-decreasing, and 2..MAX_SCHEDULE_STAGES stages.
 *  A spec whose explicit amounts don't add up to the total (or over-runs it) is
 *  rejected — never silently "fixed". */
export function buildPaymentSchedule(totalCentsRaw: unknown, stagesRaw: unknown): ScheduleResult {
  const total = Math.trunc(Number(totalCentsRaw));
  if (!Number.isFinite(total) || total < MIN_STAGE_CENTS) return { ok: false, error: 'Set the total to schedule first.' };
  if (total > MAX_TOTAL_CENTS) return { ok: false, error: 'That total is over $1,000,000 — double-check it.' };
  if (!Array.isArray(stagesRaw)) return { ok: false, error: 'A payment plan needs a list of stages.' };
  if (stagesRaw.length < 2) return { ok: false, error: 'A payment plan needs at least two stages.' };
  if (stagesRaw.length > MAX_SCHEDULE_STAGES) return { ok: false, error: `A payment plan can have at most ${MAX_SCHEDULE_STAGES} stages.` };

  const stages = stagesRaw as StageInput[];
  const n = stages.length;
  const amounts: number[] = new Array(n).fill(0);
  let sumNonLast = 0;
  for (let i = 0; i < n; i++) {
    const s = stages[i] || {};
    const isLast = i === n - 1;
    let amt: number;
    if (s.amount_cents !== undefined && s.amount_cents !== null && String(s.amount_cents) !== '') {
      amt = Math.trunc(Number(s.amount_cents));
      if (!Number.isFinite(amt)) return { ok: false, error: `Stage ${i + 1} has an invalid amount.` };
    } else if (s.percent !== undefined && s.percent !== null && String(s.percent) !== '') {
      const pct = Number(s.percent);
      if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return { ok: false, error: `Stage ${i + 1} needs a percentage between 0 and 100.` };
      amt = Math.round(total * pct / 100);
    } else if (isLast) {
      amt = total - sumNonLast;   // remainder-on-last (absorbs rounding)
    } else {
      return { ok: false, error: `Stage ${i + 1} needs an amount or a percentage.` };
    }
    amounts[i] = amt;
    if (!isLast) sumNonLast += amt;
  }
  // Reconcile the last stage with the remainder. If the caller gave the last an
  // EXPLICIT amount/percent that disagrees, the stages don't sum to the total → reject.
  const lastSpec = stages[n - 1] || {};
  const lastWasExplicit = (lastSpec.amount_cents !== undefined && lastSpec.amount_cents !== null && String(lastSpec.amount_cents) !== '')
    || (lastSpec.percent !== undefined && lastSpec.percent !== null && String(lastSpec.percent) !== '');
  const remainder = total - sumNonLast;
  if (lastWasExplicit && amounts[n - 1] !== remainder) return { ok: false, error: 'The stages don’t add up to the total.' };
  amounts[n - 1] = remainder;

  for (let i = 0; i < n; i++) {
    if (amounts[i] < MIN_STAGE_CENTS) return { ok: false, error: 'Each stage must be at least $0.50, and the stages can’t add up to more than the total.' };
    if (amounts[i] > MAX_TOTAL_CENTS) return { ok: false, error: 'A stage is over $1,000,000 — check the split.' };
  }

  const out: ScheduleStage[] = [];
  let prevDate = '';
  for (let i = 0; i < n; i++) {
    const s = stages[i] || {};
    let dd: string | null = null;
    if (s.due_date !== undefined && s.due_date !== null && String(s.due_date).trim() !== '') {
      const d = String(s.due_date).trim();
      if (!DATE_ONLY.test(d)) return { ok: false, error: `Stage ${i + 1} has an invalid due date (use YYYY-MM-DD).` };
      dd = d;
    }
    const cmp = dd || '';                        // null (due now) sorts before any date
    if (cmp < prevDate) return { ok: false, error: 'Each stage’s due date must be on or after the one before it.' };
    if (cmp) prevDate = cmp;
    const label = String(s.label || '').trim().slice(0, 120) || defaultStageLabel(i, n, s.purpose);
    out.push({ label, amount_cents: amounts[i], due_date: dd, purpose: s.purpose === 'deposit' ? 'deposit' : 'service' });
  }
  // Defensive invariant: the stages sum to the total, exactly.
  if (out.reduce((a, b) => a + b.amount_cents, 0) !== total) return { ok: false, error: 'The stages don’t add up to the total.' };
  return { ok: true, stages: out, total_cents: total };
}

/** Friendly builder → stage list: a deposit (percent or $) now + the balance
 *  later. The balance amount is left to the remainder (always exact). Pure. */
export function depositBalanceStages(opts: {
  deposit_type: 'percent' | 'amount'; deposit_value: number;
  deposit_due_date?: string | null; balance_due_date?: string | null;
  deposit_label?: string; balance_label?: string;
}): StageInput[] {
  const dep: StageInput = { label: opts.deposit_label || 'Deposit', purpose: 'deposit', due_date: opts.deposit_due_date ?? null };
  if (opts.deposit_type === 'amount') dep.amount_cents = Math.trunc(Number(opts.deposit_value));
  else dep.percent = Number(opts.deposit_value);
  const bal: StageInput = { label: opts.balance_label || 'Balance', purpose: 'service', due_date: opts.balance_due_date ?? null };
  return [dep, bal];
}

/** Friendly builder → stage list: split a total into N equal installments (the
 *  last takes the remainder), optionally dated from a first due date stepping by
 *  interval_days. Pure. */
export function equalInstallmentStages(opts: {
  total_cents: number; count: number; first_due_date?: string | null; interval_days?: number; label_prefix?: string;
}): StageInput[] {
  const count = Math.max(0, Math.trunc(Number(opts.count)) || 0);
  const total = Math.trunc(Number(opts.total_cents)) || 0;
  const per = count > 0 ? Math.floor(total / count) : 0;
  const base = (opts.first_due_date && DATE_ONLY.test(opts.first_due_date)) ? opts.first_due_date : null;
  const step = Math.max(0, Math.trunc(Number(opts.interval_days)) || 0);
  const out: StageInput[] = [];
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    out.push({
      label: `${opts.label_prefix || 'Payment'} ${i + 1} of ${count}`,
      amount_cents: isLast ? undefined : per,        // last → remainder (kept exact)
      due_date: base ? addDaysISO(base, step * i) : null,
      purpose: 'service',
    });
  }
  return out;
}

// ── pipeline summary (pure rollup — the missing "your numbers") ──────────────
// Per-deal values always existed, but nothing rolled them UP: no open-pipeline
// total, no won-this-month, no win rate. This does that math — PURE, deterministic,
// no DB, no probability weighting, and (the whole point) no fabricated numbers:
// every figure is a plain sum or count of the deals passed in, and an honest zero
// stays zero. routes/sales.ts fetches the deals; pipeline.html renders the result.

/** The deal fields the rollup reads (structural — pass a presence_deals row, or any
 *  matching shape). WON = became a customer (converted) OR stage 'won'/'converted';
 *  LOST = stage 'lost'; OPEN = everything else. */
export interface DealForSummary {
  stage?: string | null;
  expected_value_cents?: number | null;
  converted_client_id?: string | null;
  converted_at?: string | null;
  updated_at?: string | null;
}
export interface StageBreakdown { stage: Stage; label: string; count: number; value_cents: number; }
export interface PipelineSummary {
  open: { count: number; value_cents: number };            // non-won, non-lost
  won_month: { count: number; value_cents: number };       // won in the current calendar month (UTC)
  win_rate: { won: number; lost: number; pct: number | null; window_days: number }; // pct null = no closed deals yet
  by_stage: StageBreakdown[];                              // the OPEN stages, in ladder order
  total: number;                                          // deals considered
}

// The active stages that make up "open pipeline" — won/lost are OUTCOMES, not
// pipeline, so they never appear in the per-stage breakdown. Ladder order.
export const OPEN_STAGES: Stage[] = ['lead', 'qualified', 'proposal', 'contract'];
const SUMMARY_STAGE_LABEL: Record<Stage, string> = {
  lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent',
  contract: 'Agreement out', won: 'Won', lost: 'Not a fit',
};
export const WIN_RATE_WINDOW_DAYS = 90;    // a sensible rolling window for "win rate"

const summaryCents = (v: unknown): number => Math.max(0, Math.trunc(Number(v) || 0));
/** A deal that became a customer (or was marked won) — the honest "won" set,
 *  matching the convert route (stage 'won' + converted_client_id/converted_at). */
function summaryIsWon(d: DealForSummary): boolean {
  return !!d.converted_client_id || !!d.converted_at || d.stage === 'won' || d.stage === 'converted';
}
/** When a deal closed — won → converted_at, otherwise its last move (updated_at). */
function summaryClosedAt(d: DealForSummary): string {
  return String(d.converted_at || d.updated_at || '');
}

/** Roll a site's deals into the calm pipeline summary. Pure & deterministic.
 *  `nowIso` fixes "this month" (calendar month, UTC) and the win-rate window, so
 *  the whole result is testable. No probability weighting; no fabricated numbers. */
export function summarizePipeline(deals: unknown, nowIso: string, windowDays = WIN_RATE_WINDOW_DAYS): PipelineSummary {
  const list: DealForSummary[] = Array.isArray(deals) ? deals as DealForSummary[] : [];
  const monthKey = String(nowIso).slice(0, 7);                       // 'YYYY-MM' (UTC)
  const windowStart = Date.parse(nowIso) - Math.max(0, windowDays) * 86400_000;

  let openCount = 0, openValue = 0, wonMonthCount = 0, wonMonthValue = 0, wonInWindow = 0, lostInWindow = 0;
  const byStage = new Map<Stage, { count: number; value_cents: number }>();
  for (const s of OPEN_STAGES) byStage.set(s, { count: 0, value_cents: 0 });

  for (const d of list) {
    if (!d || typeof d !== 'object') continue;
    const value = summaryCents(d.expected_value_cents);
    if (summaryIsWon(d)) {
      const at = summaryClosedAt(d);
      if (at.slice(0, 7) === monthKey) { wonMonthCount++; wonMonthValue += value; }
      const t = Date.parse(at);
      if (Number.isFinite(t) && t >= windowStart) wonInWindow++;
    } else if (d.stage === 'lost') {
      const t = Date.parse(summaryClosedAt(d));
      if (Number.isFinite(t) && t >= windowStart) lostInWindow++;
    } else {
      openCount++; openValue += value;                                // open pipeline
      const bucket = byStage.get(d.stage as Stage);
      if (bucket) { bucket.count++; bucket.value_cents += value; }
    }
  }

  const closed = wonInWindow + lostInWindow;
  return {
    open: { count: openCount, value_cents: openValue },
    won_month: { count: wonMonthCount, value_cents: wonMonthValue },
    win_rate: { won: wonInWindow, lost: lostInWindow, pct: closed > 0 ? Math.round((wonInWindow / closed) * 100) : null, window_days: windowDays },
    by_stage: OPEN_STAGES.map((s) => ({ stage: s, label: SUMMARY_STAGE_LABEL[s], count: byStage.get(s)!.count, value_cents: byStage.get(s)!.value_cents })),
    total: list.length,
  };
}

// ── pagination (bounded list queries — no unbounded scans) ──
export const DEFAULT_PAGE = 25;
export const MAX_PAGE = 100;
export function clampLimit(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE;
  return Math.min(MAX_PAGE, n);
}
