// ── Site Review: Google PageSpeed Insights (mobile) on the homepage ──────────
// The one outbound call that can't meet the 10 s rule: Lighthouse runs take
// 15-40 s. It starts first, runs alongside the crawl, and gets its own budget
// inside the 60 s scan; on timeout or error the report still runs and
// Performance shows "Couldn't measure today" (spec: Errors table). Google's
// endpoint is a fixed host, so no SSRF guard is needed for the call itself.

export interface Vital { key: 'lcp' | 'cls' | 'inp' | 'tbt' | 'fcp'; label: string; value: number; display: string; good: number; poor: number; status: 'good' | 'needs_work' | 'poor'; source: 'field' | 'lab' }
export interface PsiResult {
  ok: true;
  scores: { performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null };
  vitals: Vital[];
  oversizedImages: { count: number; savingsKb: number | null } | null;
  mobileFlags: string[];
  finalUrl: string | null;
}
export type PsiOutcome = PsiResult | { ok: false; reason: 'timeout' | 'error' | 'not_configured' };

// Google's published thresholds (good at or under / poor over).
const LIMITS = {
  lcp: { label: 'Largest Contentful Paint', good: 2500, poor: 4000, unit: 'ms' },
  cls: { label: 'Cumulative Layout Shift', good: 0.1, poor: 0.25, unit: '' },
  inp: { label: 'Interaction to Next Paint', good: 200, poor: 500, unit: 'ms' },
  tbt: { label: 'Total Blocking Time', good: 200, poor: 600, unit: 'ms' },
  fcp: { label: 'First Contentful Paint', good: 1800, poor: 3000, unit: 'ms' },
} as const;

const fmt = (key: keyof typeof LIMITS, v: number) =>
  key === 'cls' ? v.toFixed(2) : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;

export function vital(key: keyof typeof LIMITS, value: number, source: 'field' | 'lab'): Vital {
  const l = LIMITS[key];
  return { key, label: l.label, value, display: fmt(key, value), good: l.good, poor: l.poor, status: value <= l.good ? 'good' : value <= l.poor ? 'needs_work' : 'poor', source };
}
export const vitalLimitDisplay = (key: keyof typeof LIMITS) => fmt(key, LIMITS[key].good);

const pct = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) : null);

// deno-lint-ignore no-explicit-any
export function readPsi(d: any): PsiResult {
  const lr = d?.lighthouseResult || {};
  const cat = lr.categories || {};
  const audits = lr.audits || {};
  const num = (id: string) => (typeof audits[id]?.numericValue === 'number' ? audits[id].numericValue as number : null);
  const vitals: Vital[] = [];
  const lcp = num('largest-contentful-paint'); if (lcp != null) vitals.push(vital('lcp', lcp, 'lab'));
  const cls = num('cumulative-layout-shift'); if (cls != null) vitals.push(vital('cls', cls, 'lab'));
  // INP only exists as real-visitor (CrUX) data; small sites rarely have it, so
  // Total Blocking Time stands in for it, as the spec allows ("INP (or TBT)").
  const fieldInp = d?.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile;
  if (typeof fieldInp === 'number') vitals.push(vital('inp', fieldInp, 'field'));
  else { const tbt = num('total-blocking-time'); if (tbt != null) vitals.push(vital('tbt', tbt, 'lab')); }
  const fcp = num('first-contentful-paint'); if (fcp != null) vitals.push(vital('fcp', fcp, 'lab'));

  // Oversized images: Lighthouse 13's image-delivery insight, or the older audits.
  let oversized: PsiResult['oversizedImages'] = null;
  for (const id of ['image-delivery-insight', 'uses-responsive-images', 'uses-optimized-images', 'modern-image-formats']) {
    const a = audits[id];
    if (!a || a.score === 1 || a.score == null) continue;
    const items = Array.isArray(a.details?.items) ? a.details.items : [];
    const bytes = typeof a.details?.overallSavingsBytes === 'number' ? a.details.overallSavingsBytes
      : items.reduce((s: number, i: { wastedBytes?: number }) => s + (typeof i.wastedBytes === 'number' ? i.wastedBytes : 0), 0);
    if (items.length) { oversized = { count: items.length, savingsKb: bytes ? Math.round(bytes / 1024) : null }; break; }
  }

  const mobileFlags: string[] = [];
  if (audits['viewport'] && audits['viewport'].score === 0) mobileFlags.push('No mobile viewport setting');
  if (audits['font-size'] && audits['font-size'].score === 0) mobileFlags.push('Text too small to read on a phone');
  if (audits['tap-targets'] && audits['tap-targets'].score === 0) mobileFlags.push('Buttons and links too close together to tap');

  return {
    ok: true,
    scores: { performance: pct(cat.performance?.score), seo: pct(cat.seo?.score), accessibility: pct(cat.accessibility?.score), bestPractices: pct(cat['best-practices']?.score) },
    vitals,
    oversizedImages: oversized,
    mobileFlags,
    finalUrl: typeof lr.finalUrl === 'string' ? lr.finalUrl : null,
  };
}

/** strategy 'mobile' drives the score (spec); 'desktop' (Phase 4) is shown
 *  alongside it in the speed table and never changes the score. */
export async function runPsi(url: string, budgetMs: number, fetchImpl: typeof fetch = fetch, strategy: 'mobile' | 'desktop' = 'mobile'): Promise<PsiOutcome> {
  const key = Deno.env.get('PSI_KEY') || Deno.env.get('PSI_API_KEY') || '';
  if (!key) return { ok: false, reason: 'not_configured' };
  const cats = (strategy === 'mobile' ? ['performance', 'seo', 'accessibility', 'best-practices'] : ['performance']).map((c) => `&category=${c}`).join('');
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}${cats}&key=${encodeURIComponent(key)}`;
  try {
    const r = await fetchImpl(api, { signal: AbortSignal.timeout(Math.max(1000, budgetMs)) });
    const d = await r.json();
    if (!r.ok || d?.error || !d?.lighthouseResult) return { ok: false, reason: 'error' };
    if (d.lighthouseResult.runtimeError?.code) return { ok: false, reason: 'error' };
    return readPsi(d);
  } catch (e) {
    return { ok: false, reason: e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'error' };
  }
}
