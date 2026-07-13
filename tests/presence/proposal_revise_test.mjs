// ── Proposal Revise (versioning) + discount/tax math (pure) ──────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/proposal_revise_test.mjs
// Covers the pure spine of the "Revise" + honest-pricing feature:
//   · the discount/tax breakdown math (percent + fixed discount, tax on the
//     post-discount amount, rounding, never a negative total)
//   · the reserved line_items meta round-trip (split ⇄ pack) that stores discount/
//     tax + the revise trail WITHOUT a migration
//   · the revise CLONE simulation (increments version, carries items + pricing,
//     supersedes the prior) and that a superseded proposal's link can't be accepted
//   · the document + invoice-default both use the FINAL total (post discount+tax)
import {
  normalizeLineItems, subtotalOf, splitLineItems, packLineItems,
  normalizeDiscount, normalizeTaxPct, normalizeProposalMeta,
  computeProposalTotals, proposalTotals, PROPOSAL_META_KEY, isProposalMetaEl,
} from '../../supabase/functions/presence/lib/sales_lifecycle.ts';
import { renderProposalDocument } from '../../supabase/functions/presence/lib/documents.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const items = [{ label: 'Design', qty: 2, unit_cents: 50000 }, { label: 'Hosting', qty: 12, unit_cents: 2500 }]; // 100000 + 30000 = 130000

// ── discount + tax math ──────────────────────────────────────────────────────
{
  const base = subtotalOf(items);
  ok('subtotal is the pure line-item sum ($1,300)', base === 130000);

  // percent discount, then tax on the POST-discount amount
  const t1 = computeProposalTotals(items, { discount: { mode: 'percent', value: 10 }, tax_pct: 8 });
  ok('percent discount: 10% of 130000 = 13000', t1.discount_cents === 13000);
  ok('tax is on the post-discount amount: 8% of 117000 = 9360', t1.tax_cents === 9360);
  ok('total = subtotal − discount + tax (130000 − 13000 + 9360 = 126360)', t1.total_cents === 126360);
  ok('breakdown carries the raw subtotal too', t1.subtotal_cents === 130000);

  // fixed ($) discount
  const t2 = computeProposalTotals(items, { discount: { mode: 'fixed', value: 25000 }, tax_pct: 0 });
  ok('fixed discount subtracts cents (−$250)', t2.discount_cents === 25000 && t2.total_cents === 105000);

  // tax only (no discount)
  const t3 = computeProposalTotals(items, { tax_pct: 10 });
  ok('tax only: +10% = 143000', t3.discount_cents === 0 && t3.tax_cents === 13000 && t3.total_cents === 143000);

  // rounding is deterministic (Math.round): 7.5% of 130000 = 9750 exactly; use an odd rate
  const t4 = computeProposalTotals(items, { tax_pct: 8.25 });
  ok('tax rounds deterministically (8.25% of 130000 = 10725)', t4.tax_cents === 10725);
  const t5 = computeProposalTotals([{ label: 'x', qty: 1, unit_cents: 999 }], { tax_pct: 8.25 }); // 999*.0825=82.4175 → 82
  ok('tax rounds to nearest cent (round 82.4→82)', t5.tax_cents === 82 && t5.total_cents === 1081);

  // NEVER negative: a fixed discount larger than the subtotal is clamped
  const t6 = computeProposalTotals(items, { discount: { mode: 'fixed', value: 999999999 } });
  ok('discount clamped to the subtotal (never a negative total)', t6.discount_cents === 130000 && t6.total_cents === 0);
  const t7 = computeProposalTotals(items, { discount: { mode: 'percent', value: 100 }, tax_pct: 10 });
  ok('100% discount → total 0, and tax on 0 is 0', t7.discount_cents === 130000 && t7.tax_cents === 0 && t7.total_cents === 0);

  // no pricing at all → total equals subtotal
  const t8 = computeProposalTotals(items, {});
  ok('no discount/tax → total is the subtotal', t8.total_cents === 130000 && t8.discount_cents === 0 && t8.tax_cents === 0);
}

// ── input normalization (owner-entered) ──────────────────────────────────────
{
  ok('discount: percent clamps to 100', normalizeDiscount({ mode: 'percent', value: 250 }).value === 100);
  ok('discount: zero/negative → null (no discount)', normalizeDiscount({ mode: 'percent', value: 0 }) === null && normalizeDiscount({ mode: 'fixed', value: -5 }) === null);
  ok('discount: unknown mode → null', normalizeDiscount({ mode: 'wat', value: 10 }) === null);
  ok('discount: fixed truncates to cents + bounds', normalizeDiscount({ mode: 'fixed', value: 12345 }).value === 12345);
  ok('tax: clamps to 100, drops ≤0', normalizeTaxPct(250) === 100 && normalizeTaxPct(0) === null && normalizeTaxPct(-1) === null);
  const m = normalizeProposalMeta({ discount: { mode: 'percent', value: 15 }, tax_pct: 9 });
  ok('meta assembles discount + tax from a body', m.discount.value === 15 && m.tax_pct === 9);
  ok('meta ignores absent fields', Object.keys(normalizeProposalMeta({})).length === 0);
}

// ── reserved line_items meta round-trip (the no-migration storage) ────────────
{
  const meta = { discount: { mode: 'percent', value: 10 }, tax_pct: 8, revised_from: 'p-1' };
  const packed = packLineItems(items, meta);
  ok('pack appends exactly ONE reserved meta element', packed.filter(isProposalMetaEl).length === 1 && packed.length === items.length + 1);
  ok('the meta element uses the reserved key', PROPOSAL_META_KEY in packed[packed.length - 1]);
  const back = splitLineItems(packed);
  ok('split recovers the real items (meta excluded)', back.items.length === 2 && back.items[0].label === 'Design');
  ok('split recovers the discount + tax + trail', back.meta.discount.value === 10 && back.meta.tax_pct === 8 && back.meta.revised_from === 'p-1');
  ok('pack with empty meta stores NO meta element', packLineItems(items, {}).length === items.length && !packLineItems(items, {}).some(isProposalMetaEl));
  ok('normalizeLineItems transparently ignores a meta element (valid)', normalizeLineItems(packed).ok === true && normalizeLineItems(packed).items.length === 2);
  ok('proposalTotals over stored line_items uses the meta', proposalTotals(packed).total_cents === computeProposalTotals(items, meta).total_cents);
}

// ── REVISE: clone + increment version + carry pricing + supersede prior ───────
// Simulate the pure decision the route makes (route I/O is exercised by the live
// sales e2e suites; here we prove the clone/supersede transform is honest).
{
  // A "sent" prior proposal v1 with a discount, stored via the meta element.
  const priorMeta = { discount: { mode: 'fixed', value: 10000 }, tax_pct: 5 };
  const prior = { id: 'p-1', version: 1, status: 'sent', title: 'Website', currency: 'usd', terms: 'Net 30', line_items: packLineItems(items, priorMeta) };

  // Revise clones the prior's items + pricing into a NEW draft at version+1,
  // recording revised_from; the prior is stamped superseded_by the new one.
  const ps = splitLineItems(prior.line_items);
  const newVersion = (Math.trunc(Number(prior.version)) || 1) + 1;
  const newMeta = { discount: ps.meta.discount ?? null, tax_pct: ps.meta.tax_pct ?? null, revised_from: prior.id };
  const revised = {
    id: 'p-2', version: newVersion, status: 'draft', title: prior.title, currency: prior.currency, terms: prior.terms,
    line_items: packLineItems(ps.items, newMeta),
  };
  const priorSuperseded = { ...prior, line_items: packLineItems(ps.items, { ...ps.meta, superseded_by: revised.id }) };

  ok('revise increments the version (v1 → v2)', revised.version === 2);
  ok('revise starts as a fresh draft', revised.status === 'draft');
  ok('revise preserves the line items', splitLineItems(revised.line_items).items.length === 2 && subtotalOf(splitLineItems(revised.line_items).items) === 130000);
  ok('revise carries the prior discount + tax', splitLineItems(revised.line_items).meta.discount.value === 10000 && splitLineItems(revised.line_items).meta.tax_pct === 5);
  ok('revise records the trail back to the prior (revised_from)', splitLineItems(revised.line_items).meta.revised_from === 'p-1');
  ok('revise preserves terms + title', revised.terms === 'Net 30' && revised.title === 'Website');
  ok('the prior is stamped superseded_by the new proposal', splitLineItems(priorSuperseded.line_items).meta.superseded_by === 'p-2');
  ok('a superseded prior still keeps ITS own items + pricing intact', subtotalOf(splitLineItems(priorSuperseded.line_items).items) === 130000 && splitLineItems(priorSuperseded.line_items).meta.discount.value === 10000);

  // Version default: a null-version prior still yields v2.
  ok('null prior version defaults to 1 → revise makes v2', ((Math.trunc(Number({ version: null }.version)) || 1) + 1) === 2);

  // The decide guard keys off superseded_by (the route blocks acceptance of a
  // superseded proposal's old public link).
  const isSuperseded = (p) => !!splitLineItems(p.line_items).meta.superseded_by;
  ok('a superseded proposal is detectable (link no longer acceptable)', isSuperseded(priorSuperseded) === true);
  ok('a live (non-superseded) proposal is NOT flagged', isSuperseded(revised) === false);
}

// ── the document + the invoice-default both use the FINAL total ───────────────
{
  const meta = { discount: { mode: 'percent', value: 20 }, tax_pct: 10 };
  const li = packLineItems(items, meta);
  const t = computeProposalTotals(items, meta); // 130000 − 26000 = 104000; +10% = 10400 → 114400
  ok('sanity: final total is 114400', t.total_cents === 114400);

  // Document renders the breakdown + the FINAL total, not the raw subtotal.
  const html = renderProposalDocument({ title: 'Website', currency: 'usd', status: 'sent', line_items: li });
  ok('document shows a Subtotal line when a discount/tax applies', /Subtotal/.test(html));
  ok('document shows the discount labelled with its %', /Discount \(20%\)/.test(html));
  ok('document shows the tax labelled with its %', /Tax \(10%\)/.test(html));
  ok('document total is the FINAL total ($1,144.00), not the subtotal', html.includes('$1,144.00') && !/>\s*\$1,300\.00\s*<\/td><\/tr>\s*$/.test(html));
  ok('document does NOT print the raw subtotal as the total', /Total<\/td><td>\$1,144\.00/.test(html));

  // A proposal with no discount/tax prints ONE clean Total = subtotal.
  const plain = renderProposalDocument({ title: 'x', currency: 'usd', status: 'sent', line_items: items });
  ok('plain proposal: no Subtotal breakdown row, Total = subtotal', !/Subtotal/.test(plain) && /Total<\/td><td>\$1,300\.00/.test(plain));

  // The invoice-default (accept → invoice) reads proposalTotals(...).total_cents —
  // prove that helper equals the final total (the route uses exactly this).
  ok('invoice default would bill the FINAL total (post discount+tax)', proposalTotals(li).total_cents === 114400);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PROPOSAL REVISE + PRICING (pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
