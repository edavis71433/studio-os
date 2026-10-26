// ── Site Review: one scan, start to finish ───────────────────────────────────
// Order (spec "What runs, in order"): normalize and fetch the homepage →
// discover and fetch up to 8 pages → PageSpeed (started first, awaited here) →
// on-page checks → pillar scores → Claude narrative. Progress is reported as
// it really happens, for the loading screen. Everything shares one deadline so
// the whole scan stays under 60 seconds.

import { checkDiscoverability, socialProfiles, type FetchLike, type UrlGuard } from '../../site_discovery.ts';
import { parsePage, type PageFacts } from './html.ts';
import { brokenLinks, candidatesFrom, fetchHtml, fetchSitemapLocs, httpRedirectsToHttps, pickPages, BOT_UA, MAX_PAGES, type Fetched } from './crawl.ts';
import { runPsi, vitalLimitDisplay, type PsiOutcome } from './psi.ts';
import { deriveBusinessName, overallScore, pillarScores, rankIssues, runChecks, type Check } from './checks.ts';
import { writeNarrative, type Narrative } from './narrative.ts';
import { scoreLabel } from '../report_view.ts';

export const SCAN_BUDGET_MS = 58_000;

export type Progress =
  | { step: 'pages'; done: number; total: number }
  | { step: 'speed' }
  | { step: 'search' }
  | { step: 'trust' }
  | { step: 'writing' };

export interface ScanInput { url: string; businessType: string; city: string }
export interface ScanDeps {
  guard: UrlGuard;
  siteFetch?: FetchLike;              // the business's own site
  psiFetch?: typeof fetch;            // Google PageSpeed
  claudeFetch?: typeof fetch;         // Anthropic
  now?: () => number;
  onProgress?: (p: Progress) => void;
}

export type ScanResult =
  | { ok: true; input: Record<string, unknown>; scores: Record<string, unknown>; findings: Record<string, unknown>; raw: Record<string, unknown>; costUsd: number; narrativeSource: Narrative['source'] }
  | { ok: false; error: 'unreachable' | 'blocked' };

export const ERROR_MESSAGES = {
  unreachable: "We couldn't load that address. Check the URL or try the homepage.",
  blocked: "Your site blocked our checker. Book a call and I'll review it by hand.",
} as const;

function pageStatus(p: PageFacts): string {
  if (p.noindex) return 'Hidden from Google';
  const issues = [!p.title, !p.metaDescription, p.h1s.length !== 1 || !p.h1s[0], p.images.total > 0 && p.images.missingAlt / p.images.total >= 0.4].filter(Boolean).length;
  if (p.wordCount < 150) return 'Thin';
  return issues ? 'Needs work' : 'Good';
}

export function pageTable(pages: PageFacts[]) {
  return {
    title: 'Page by page',
    note: `The ${pages.length} page${pages.length > 1 ? 's' : ''} we reviewed.`,
    columns: ['Page', 'Title', 'Description', 'H1', 'Images missing alt', 'Words', 'Status'],
    rows: pages.map((p) => [
      p.path,
      p.title || 'Missing',
      p.metaDescription ? `${p.metaDescription.length} characters` : 'Missing',
      p.h1s.length === 1 ? (p.h1s[0] || 'Empty') : p.h1s.length === 0 ? 'Missing' : `${p.h1s.length} H1s`,
      `${p.images.missingAlt} of ${p.images.total}`,
      p.wordCount,
      pageStatus(p),
    ]),
  };
}

export function vitalsTable(psi: PsiOutcome, desktop: PsiOutcome | null = null) {
  if (!psi.ok || !psi.vitals.length) {
    return { title: 'Core Web Vitals (mobile)', note: "Google's speed test couldn't measure your homepage today, so these are left out of the score.", columns: ['Measure', 'Your site', 'Good is under', 'Status'], rows: [] as (string | number)[][] };
  }
  const label = { good: 'Good', needs_work: 'Needs work', poor: 'Slow' } as const;
  // Desktop (Phase 4): shown beside the phone numbers, never part of the score.
  const d = desktop && desktop.ok ? desktop : null;
  const dv = (key: string) => d?.vitals.find((x) => x.key === key)?.display || '–';
  const scores = d && d.scores.performance != null && psi.scores.performance != null
    ? ` Google’s speed score: ${psi.scores.performance} on a phone, ${d.scores.performance} on a computer. Your score uses the phone result, since that is how most local customers arrive.` : '';
  return {
    title: 'Core Web Vitals',
    note: "Google's measures of how fast and steady a page feels. Measured on the homepage" + (psi.vitals.some((v) => v.key === 'tbt') ? '; Total Blocking Time stands in for Interaction to Next Paint, which needs real-visitor data your site doesn’t have yet.' : '.') + scores,
    columns: d ? ['Measure', 'Phone', 'Computer', 'Good is under', 'Phone status'] : ['Measure', 'Your site (phone)', 'Good is under', 'Status'],
    rows: psi.vitals.map((v) => d ? [v.label, v.display, dv(v.key), vitalLimitDisplay(v.key), label[v.status]] : [v.label, v.display, vitalLimitDisplay(v.key), label[v.status]]),
  };
}


// Trimmed page facts for raw_results (no link lists or full text).
const slim = (p: PageFacts) => ({ url: p.url, path: p.path, title: p.title, metaDescription: p.metaDescription, canonical: p.canonical, noindex: p.noindex, h1s: p.h1s, images: p.images, og: p.og, jsonldTypes: p.jsonld.items.map((i) => i['@type']).slice(0, 10), jsonldErrors: p.jsonld.parseErrors, telLinks: p.telLinks, phones: p.phonesInText, address: p.address, mapEmbed: p.mapEmbed, wordCount: p.wordCount, placeholder: p.placeholder, cta: p.cta, social: p.social, mixedContent: p.mixedContent });

export async function runSiteReview(inp: ScanInput, deps: ScanDeps): Promise<ScanResult> {
  const now = deps.now || Date.now;
  const t0 = now();
  const deadline = t0 + SCAN_BUDGET_MS;
  const progress = (p: Progress) => { try { deps.onProgress?.(p); } catch { /* the stream may have closed */ } };
  const crawlDeps = { guard: deps.guard, fetchImpl: deps.siteFetch, now };

  // PageSpeed starts first: it is the slow one.
  const psiPromise = runPsi(inp.url, 40_000, deps.psiFetch);
  const desktopPromise = runPsi(inp.url, 40_000, deps.psiFetch, 'desktop');

  progress({ step: 'pages', done: 0, total: MAX_PAGES });
  const home = await fetchHtml(inp.url, crawlDeps, Math.min(deadline, t0 + 12_000));
  if (typeof home === 'string') return { ok: false, error: home === 'blocked' ? 'blocked' : 'unreachable' };
  const homeFacts = parsePage(home.html, home.url, socialProfiles);
  // A bot wall we don't have a signature for: a "homepage" with no title, no
  // main heading, almost no text and almost no links is not a page we can
  // honestly review.
  if (!homeFacts.title && !homeFacts.h1s.length && homeFacts.wordCount < 200 && homeFacts.links.length < 5) return { ok: false, error: 'blocked' };

  const [disc, httpRedirect] = await Promise.all([
    checkDiscoverability(home.url, deps.guard, BOT_UA, { budgetMs: 9000, fetchImpl: deps.siteFetch }).catch(() => null),
    httpRedirectsToHttps(home.url, crawlDeps),
  ]);
  const discovery = disc || { robotsTxt: false, robotsTxtBlocksAll: false, sitemapDeclared: false, sitemapUrl: null, sitemapXml: false, sitemapUrlCount: 0, sitemapIsIndex: false };
  const locs = discovery.sitemapXml && !discovery.sitemapIsIndex ? await fetchSitemapLocs(discovery.sitemapUrl, home.url, crawlDeps, Math.min(deadline, t0 + 22_000)) : [];
  const picks = pickPages(candidatesFrom(home.url, homeFacts.links, locs));
  const total = 1 + picks.length;
  progress({ step: 'pages', done: 1, total });

  let done = 1;
  const crawlEnd = Math.min(deadline, now() + 14_000);
  const fetched = await Promise.all(picks.map(async (c) => {
    const r = await fetchHtml(c.url, crawlDeps, crawlEnd);
    done++;
    progress({ step: 'pages', done, total });
    return typeof r === 'string' ? null : r;
  }));
  // A redirect can land two picks on one page: keep the first.
  const seenPaths = new Set([homeFacts.path]);
  const pages: PageFacts[] = [homeFacts];
  for (const f of fetched.filter((x): x is Fetched => !!x)) {
    const facts = parsePage(f.html, f.url, socialProfiles);
    if (seenPaths.has(facts.path)) continue;
    seenPaths.add(facts.path);
    pages.push(facts);
  }

  // Broken internal links: up to 30, across every page we fetched.
  const internal = [...new Set(pages.flatMap((p) => p.links.map((l) => { try { const u = new URL(l.href, p.url); u.hash = ''; return u.protocol.startsWith('http') && u.hostname === new URL(home.url).hostname ? u.toString() : ''; } catch { return ''; } })).filter(Boolean))]
    .filter((u) => !pages.some((p) => p.url === u));
  const linkList = internal.slice(0, 30);
  const brokenPromise = brokenLinks(linkList, crawlDeps, Math.min(deadline, now() + 8000));

  progress({ step: 'speed' });
  // Wait for PageSpeed until 42 s in, and always leave 16 s for the checks and
  // the narrative. The timer is cleared so a fast result doesn't leave it running.
  let psiTimer: ReturnType<typeof setTimeout> | undefined;
  const psi = await Promise.race([
    psiPromise,
    new Promise<PsiOutcome>((r) => { psiTimer = setTimeout(() => r({ ok: false, reason: 'timeout' }), Math.max(0, Math.min(deadline - 16_000, t0 + 42_000) - now())); }),
  ]);
  clearTimeout(psiTimer);
  // The desktop run started at the same moment; give it a few more seconds at
  // most, and leave it out if it isn't back.
  let deskTimer: ReturnType<typeof setTimeout> | undefined;
  const desktop = await Promise.race([
    desktopPromise,
    new Promise<PsiOutcome>((r) => { deskTimer = setTimeout(() => r({ ok: false, reason: 'timeout' }), Math.max(0, Math.min(4000, deadline - 16_000 - now()))); }),
  ]);
  clearTimeout(deskTimer);
  const broken = await brokenPromise;

  progress({ step: 'search' });
  const businessName = deriveBusinessName(homeFacts);
  const checks: Check[] = runChecks({ homeUrl: home.url, pages, disc: discovery, httpRedirect, broken, linksChecked: linkList.length, psi, businessName, businessType: inp.businessType, city: inp.city });
  progress({ step: 'trust' });

  const pillars = pillarScores(checks, psi.ok);
  const overall = overallScore(pillars);
  const notes: string[] = [];
  if (!psi.ok) notes.push("Google's speed test couldn't measure your site today, so Performance is left out of the overall score.");
  if (pages.length < 2) notes.push('We could only load your homepage, so this review covers that one page.');

  progress({ step: 'writing' });
  const issues = rankIssues(checks);
  const strengths = checks.filter((c) => c.status === 'pass' && c.weight >= 2).map((c) => c.evidence);
  const narrative = await writeNarrative({
    businessName, businessType: inp.businessType, city: inp.city, url: home.url, overall,
    pillars: pillars.map((p) => ({ name: p.name, score: p.score, note: p.note })),
    issues, strengths, pagesReviewed: pages.map((p) => p.path), notes,
  }, Math.max(0, deadline - now()), deps.claudeFetch, now);

  return {
    ok: true,
    input: { url: inp.url, final_url: home.url, business_name: businessName, business_type: inp.businessType, city: inp.city || null },
    scores: { overall, label: scoreLabel(overall), pillars, notes },
    findings: {
      summary: narrative.summary,
      items: narrative.findings.map(({ check_id: _id, ...f }) => f),
      top_three: narrative.top_three,
      tables: [vitalsTable(psi, desktop), pageTable(pages)],
    },
    raw: {
      pages: pages.map(slim), discoverability: discovery, http_redirect: httpRedirect, broken_links: broken, links_checked: linkList.length,
      psi, psi_desktop: desktop, checks: checks.map(({ draft: _d, ...c }) => c), narrative: { source: narrative.source, attempts: narrative.attempts },
      elapsed_ms: now() - t0,
    },
    costUsd: narrative.costUsd,
    narrativeSource: narrative.source,
  };
}
