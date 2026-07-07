// ── The migration lifecycle (M12) — a PLAN built on M11 readiness, PURE ─────
// Migration Readiness (M11) answers "what would it take?"; this turns the
// answer into an executable-by-humans plan: content mapping, media, redirect
// generation (SEO preservation through the EXISTING draft.redirects
// mechanism), launch verification, post-launch QA, and a real rollback —
// the old site stays alive until DNS moves, so rollback is pointing DNS
// back. Content itself arrives through the existing CMS/studio flows;
// nothing here writes content or infrastructure.
import type { ReadinessReport } from '../monitor/readiness.ts';
import type { InfraPlan, PlanStep } from './plans.ts';

const step = (what: string, why: string, automated: boolean): PlanStep => ({ what, why, automated, done: false });

export interface MigrationPlan extends InfraPlan {
  kind: 'migration';
  content_mapping: Array<{ from: string; to: string; how: string }>;
  redirects: Array<{ from_path: string; to_path: string }>;
  launch_checks: string[];
  post_launch_qa: string[];
}

const KIND_TO_PATH: Record<string, string> = {
  home: '/', menu: '/menu/', about: '/about/', faq: '/faq/', contact: '/contact/', updates: '/updates/',
};

export function planMigration(readiness: ReadinessReport, domain: string): MigrationPlan {
  const mapped = readiness.pages.filter((p) => p.fit !== 'manual');
  const content_mapping = mapped.map((p) => ({
    from: p.path,
    to: p.kind === 'other' ? '/updates/' : KIND_TO_PATH[p.kind] || '/',
    how: p.fit === 'clean'
      ? 'Content moves into the matching section; the studio can draft it from your facts if it needs rewriting.'
      : 'Becomes an update (or a decision) — reviewed with you before launch.',
  }));
  const redirects = readiness.seo.redirects_needed.map((from) => ({
    from_path: from.replace(/\/$/, '') || '/',
    to_path: KIND_TO_PATH[readiness.pages.find((p) => p.path === from)?.kind || 'home'] || '/',
  }));
  const manual = readiness.pages.filter((p) => p.fit === 'manual');

  return {
    kind: 'migration',
    title: `Move the website onto Studio OS — ${domain} keeps its standing`,
    summary: `${mapped.length} page${mapped.length === 1 ? '' : 's'} map onto the new home; ${redirects.length} old address${redirects.length === 1 ? '' : 'es'} keep working through redirects. The current site stays live and untouched until the final DNS step — there is no moment without a website.`,
    steps: [
      step('Build the new site as a draft: content mapped per the table, photographs uploaded to the media library', 'Everything is reviewable in the room before anyone else sees it — the draft/preview/publish ritual is unchanged.', false),
      step('Prepare the redirects so every old address lands on its new home', 'Search engines and old links keep working — standing is preserved, not rebuilt.', false),
      step(`Fix the accessibility items observed on the current site (${readiness.accessibility_first.length} noted)`, 'Cheaper to fix in the move than after it.', false),
      step('Publish, then verify on the temporary address', 'Launch checks run against the real rendered site before the domain moves.', true),
      step(`Point ${domain} at the new hosting (its own approved plan)`, 'The one moment of change — and the one step that rollback reverses.', false),
      step('Post-launch QA: observation run, redirects spot-checked, moments reviewed', 'The evidence pipeline confirms the move measured better, not just felt better.', true),
      ...(manual.length ? [step(`Plan separately: ${manual.map((p) => p.path).join(', ')}`, 'Commerce/account features are their own project — never silently dropped.', false)] : []),
    ],
    content_mapping, redirects,
    launch_checks: [
      'Every mapped page renders with its title and description.',
      'All redirects answer 301 to the right new page.',
      'HTTPS certificate issued and valid.',
      'Structured data present on the homepage.',
      'Phone, address, and hours identical to the old site.',
    ],
    post_launch_qa: [
      'A full observation run comes back without new criticals.',
      'Search console (if connected) shows the redirects being followed.',
      'The old hosting stays paid-but-idle for 30 days — the rollback window.',
    ],
    risk: manual.length
      ? `Medium: ${manual.length} page${manual.length === 1 ? '' : 's'} (commerce/accounts) need their own plan before the old site can be fully retired.`
      : 'Low. The old site remains reachable until DNS moves, and DNS can move back.',
    reversible: true,
    rollback_note: 'Point DNS back at the old hosting (kept alive through the QA window) — the old site returns exactly as it was, within DNS settling time.',
    requires_approval: true,
  };
}
