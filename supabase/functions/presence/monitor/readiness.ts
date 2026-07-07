// ── Migration Readiness (M11) — PURE assessment, quietly maintained ─────────
// While monitoring an external site, Studio OS determines what migration
// would look like: which pages move cleanly, what SEO is preserved, which
// accessibility issues deserve fixing first, and what content the studio
// would improve after arrival. Deterministic — derived from the SAME external
// pages and evidence the pipeline already observes. Nothing here migrates
// anything; it prepares the honest answer to "what would it take?".
// Customers read sentences (Law 13); the internal state word is for operators.

export interface ExtPage { path: string; html: string }
export interface EvidenceLite { category: string; type: string; severity: string; human: string }

export type PageKind = 'home' | 'menu' | 'about' | 'faq' | 'contact' | 'updates' | 'other';
export type PageFit = 'clean' | 'review' | 'manual';

export interface ReadinessReport {
  state: 'ready' | 'mostly_ready' | 'needs_prep';   // operator shorthand — never shown to customers
  pages: Array<{ path: string; title: string; kind: PageKind; fit: PageFit; plan: string }>;
  seo: {
    titles_preserved: number; descriptions_preserved: number; pages_seen: number;
    redirects_needed: string[];       // old paths the publishing pipeline would 301 (draft.redirects exists)
    notes: string[];
  };
  accessibility_first: Array<{ type: string; severity: string; what: string }>;
  content_after: string[];            // what the studio improves post-migration, in sentences
  summary: string[];                  // the customer's plain-language answer
  assessed_from: { pages: number; evidence_items: number };
}

const one = (h: string, re: RegExp) => (h.match(re) || [])[1] ?? '';
const TEMPLATE_PATHS: Record<PageKind, string> = {
  home: '/', menu: '/menu/', about: '/about/', faq: '/faq/', contact: '/contact/', updates: '/updates/', other: '',
};

/** Classify an external page by path + title keywords. Deterministic. */
export function classifyPage(path: string, title: string): PageKind {
  const hay = `${path} ${title}`.toLowerCase();
  if (path === '/' || path === '') return 'home';
  if (/menu|food|dishes|drinks|plates|catering|services|pricing|price/.test(hay)) return 'menu';
  if (/about|story|team|who-we|our-/.test(hay)) return 'about';
  if (/faq|questions|q-?and-?a|help/.test(hay)) return 'faq';
  if (/contact|find-us|location|hours|directions|visit/.test(hay)) return 'contact';
  if (/blog|news|updates|journal|events|posts?\b/.test(hay)) return 'updates';
  return 'other';
}

/** Would this page migrate cleanly onto the Presence template? */
export function pageFit(kind: PageKind, path: string): PageFit {
  if (/cart|checkout|shop|store|account|login|booking-engine|order-online/.test(path.toLowerCase())) return 'manual';
  return kind === 'other' ? 'review' : 'clean';
}

const PLAN: Record<PageFit, (kind: PageKind) => string> = {
  clean: (k) => k === 'home' ? 'Becomes the new homepage — identity, hours, and photos carry over.'
    : `Maps straight onto the ${k === 'menu' ? 'menu' : k} section; content carries over.`,
  review: () => 'Moves as an update or page — worth a quick look at where it fits best.',
  manual: () => 'Commerce or account features — planned separately, not auto-migrated.',
};

export function assessMigrationReadiness(pages: ExtPage[], evidence: EvidenceLite[]): ReadinessReport {
  const pageRows = pages.map((p) => {
    const title = one(p.html, /<title>([^<]*)<\/title>/i).trim();
    const kind = classifyPage(p.path, title);
    const fit = pageFit(kind, p.path);
    return { path: p.path, title, kind, fit, plan: PLAN[fit](kind) };
  });

  // SEO preservation: titles/descriptions carry over; slugs that differ from
  // template paths get 301s through the existing redirects mechanism
  const titles = pageRows.filter((p) => p.title).length;
  const descs = pages.filter((p) => /<meta\s+name="description"\s+content="[^"]+"/i.test(p.html)).length;
  const redirects = pageRows
    .filter((p) => p.fit !== 'manual' && p.kind !== 'other' && (p.path.replace(/\/$/, '') + '/') !== TEMPLATE_PATHS[p.kind] && p.path !== '/')
    .map((p) => p.path);
  const seoNotes = [
    'Page titles and descriptions carry over where they exist.',
    redirects.length ? `${redirects.length} address${redirects.length > 1 ? 'es' : ''} would keep working through redirects — search standing preserved.` : 'Page addresses map directly — nothing for search engines to relearn.',
    'Structured data (business schema, FAQ schema) is regenerated automatically — usually an upgrade.',
  ];

  // accessibility: what deserves fixing FIRST (worst severities, deduped by type)
  const sevRank: Record<string, number> = { critical: 3, warning: 2, info: 1 };
  const a11ySeen = new Set<string>();
  const accessibility_first = evidence
    .filter((e) => e.category === 'accessibility' || e.type === 'media.alt_short')
    .sort((a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0) || a.type.localeCompare(b.type))
    .filter((e) => !a11ySeen.has(e.type) && a11ySeen.add(e.type))
    .slice(0, 5)
    .map((e) => ({ type: e.type, severity: e.severity, what: e.human }));

  // what the studio improves after migration — from evidence, in sentences
  const AFTER: Array<[RegExp, string]> = [
    [/^content\.description_thin|^seo\.thin_content/, 'Thin descriptions get properly written — from your facts, in your voice.'],
    [/^content\.faqs_none|^aeo\.faq_schema_missing|^aeo\.answers_thin/, 'Customer questions get real answers, marked up so search and AI tools can quote them.'],
    [/^seo\.title_|^seo\.description_/, 'Every page gets a deliberate search title and description.'],
    [/^performance\./, 'Pages arrive on fast, compressed, properly-cached hosting.'],
    [/^media\.|^accessibility\.img_alt/, 'Photographs get described and right-sized.'],
    [/^structured_data\.|^aeo\.entity/, 'The business becomes fully legible to AI search — schema, entity links, citation facts.'],
  ];
  const content_after = AFTER.filter(([re]) => evidence.some((e) => re.test(e.type))).map(([, s]) => s);

  // the operator's shorthand
  const clean = pageRows.filter((p) => p.fit === 'clean').length;
  const criticalA11y = accessibility_first.filter((a) => a.severity === 'critical').length;
  const state: ReadinessReport['state'] =
    !pageRows.length || criticalA11y >= 2 ? 'needs_prep'
    : clean / pageRows.length >= 0.7 && titles / Math.max(1, pageRows.length) >= 0.7 ? 'ready'
    : 'mostly_ready';

  // the customer's sentences — never a score, never a state word
  const summary = [
    state === 'ready'
      ? `Your site is ready to move whenever you are — ${clean} of ${pageRows.length} pages map cleanly onto the new home.`
      : state === 'mostly_ready'
        ? `Most of your site moves cleanly (${clean} of ${pageRows.length} pages); a few pieces deserve a decision first.`
        : 'A little preparation first would make the move smooth — nothing that blocks it.',
    seoNotes[1],
    content_after.length ? `After the move: ${content_after[0].toLowerCase()}` : 'Your content arrives as it is — nothing is rewritten without you.',
  ];

  return {
    state, pages: pageRows,
    seo: { titles_preserved: titles, descriptions_preserved: descs, pages_seen: pages.length, redirects_needed: redirects, notes: seoNotes },
    accessibility_first, content_after, summary,
    assessed_from: { pages: pages.length, evidence_items: evidence.length },
  };
}
