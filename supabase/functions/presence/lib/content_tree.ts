// ── Client Content Tree (CMS-UX-1) — a READ-ONLY projection ──────────────────
// Gives a non-technical owner a calm map of their website: which pages exist,
// which sections are on each, what's complete/missing/changed/live, and where to
// click to edit. This is a PURE derivation over the existing authoritative model
// — it never stores a second tree, never re-serializes, never renders, never
// publishes. It composes:
//   • pages  ← the active template manifest (manifest.pages: {path, kind})
//   • labels ← the industry vocabulary layer (vocabFor) + plain-language nouns
//   • status ← validateSnapshot() blockers/warnings + describeChanges() + publish state
//   • links  ← the existing editor's hash deep-link contract (/presence.html#<tab>)
// The output carries ONLY presentation-safe data (labels/status/links) — never a
// DB id, block id, manifest key, field path, or JSON. The Website Navigator
// (later milestone) reuses this same adapter; do not fork it.
import type { SnapshotContent, TemplateManifest } from './render_types.ts';
import type { ValidationResult } from './manifest_validate.ts';
import type { Change, ChangeSet } from './diff.ts';
import { vocabFor } from './industry_vocab.ts';

// ── Status vocabulary + deterministic priority ───────────────────────────────
// When several statuses apply to one row, the LOWEST rank wins. Documented order
// (most-urgent first): a failed publish is the loudest thing, then anything that
// blocks publishing, then a soft review nudge, then unpublished edits, then the
// calm states. This order is the contract; the tests pin it.
export type SectionStatus =
  | 'publish_failed'      // the last publish attempt failed (site-level, shown on affected rows)
  | 'missing_required'    // a required field here is empty — can't publish until fixed
  | 'needs_review'        // a soft warning here (e.g. empty menu, no FAQs) — publishable
  | 'draft_changes'       // edited since the last publish — waiting to go live
  | 'scheduled'           // a scheduled publish is pending (site-level)
  | 'published'           // live and unchanged
  | 'complete'            // filled in and valid (not yet published, or first run)
  | 'empty_optional';     // an optional section with nothing in it yet

const RANK: Record<SectionStatus, number> = {
  publish_failed: 0, missing_required: 1, needs_review: 2, draft_changes: 3,
  scheduled: 4, published: 5, complete: 6, empty_optional: 7,
};

// Plain-language, non-technical status labels (never the enum key).
export const STATUS_LABEL: Record<SectionStatus, string> = {
  publish_failed: 'Publish didn’t go through',
  missing_required: 'Needs something before publishing',
  needs_review: 'Worth a look',
  draft_changes: 'Unpublished changes',
  scheduled: 'Scheduled to publish',
  published: 'Published',
  complete: 'Ready',
  empty_optional: 'Empty — optional',
};

// ── Client-safe output shapes (what the app renders) ─────────────────────────
export interface TreeSection {
  key: string;            // stable, non-sensitive area key (for expand-state + deep-link), NOT a DB id
  label: string;          // customer-friendly, vocab-aware
  status: SectionStatus;
  status_label: string;
  required: boolean;
  issue_count: number;    // count of blockers+warnings attributable here
  editor_link: string;    // the existing editor, deep-linked (/presence.html#<tab>)
}
export interface TreePage {
  key: string;
  label: string;
  path: string;           // the public site path (e.g. "/", "/menu/") — safe, already public
  status: SectionStatus;
  status_label: string;
  issue_count: number;
  editor_link: string;
  auto: boolean;          // an automatic page (privacy, thanks…) with nothing to edit
  sections: TreeSection[];
}
export interface ContentTree {
  site_status: 'never_published' | 'live' | 'draft_changes' | 'scheduled' | 'publish_failed';
  has_unpublished_changes: boolean;
  last_published_at: string | null;
  attention_count: number;   // pages/sections that need the owner (missing/needs-review/failed)
  pages: TreePage[];
}

export interface ContentTreeInput {
  manifest: TemplateManifest;
  draft: SnapshotContent;
  live: SnapshotContent | null;
  validation: ValidationResult;              // full result (field paths stay server-side)
  changes: ChangeSet;                        // describeChanges(draft, live)
  publish: {
    lastPublishedAt: string | null;          // completed_at || created_at of the last LIVE publish
    lastPublishFailed: boolean;              // the most recent publish attempt failed
    scheduledPending: boolean;               // a scheduled publish is queued
    everPublished: boolean;
  };
}

// ── Section catalogue: the editable areas, mapped to the real editor tabs ─────
// `tab` is the existing /presence.html hash deep-link (business|offerings|faqs|
// testimonials|updates|media|design). `fields` are the validateSnapshot() field
// PREFIXES this area owns (used only to COUNT/CLASSIFY issues — never surfaced).
// `changeSections` are the describeChanges() sections that map here. `present`
// reads the draft to tell filled-in from empty. Labels come from vocab/plain nouns.
interface AreaDef {
  key: string;
  tab: string;
  required: boolean;
  label: (v: ReturnType<typeof vocabFor>) => string;
  fields: string[];
  changeSections: Change['section'][];
  present: (c: SnapshotContent) => boolean;
}

const AREAS: Record<string, AreaDef> = {
  business: {
    key: 'business', tab: 'business', required: true,
    label: () => 'Business basics',
    fields: ['identity.business_name', 'identity.description', 'identity.phone', 'identity.email', 'identity.seo_title'],
    changeSections: ['business'],
    present: (c) => !!c.identity?.business_name?.trim(),
  },
  story: {
    key: 'story', tab: 'business', required: false,
    label: () => 'Your story',
    fields: [],
    changeSections: ['business'],
    present: (c) => !!(c.identity?.story?.trim() || c.identity?.tagline?.trim()),
  },
  location: {
    key: 'location', tab: 'business', required: true,
    label: () => 'Location & hours',
    fields: ['location'],
    changeSections: ['business'],
    present: (c) => !!(c.locations?.[0]),
  },
  offerings: {
    key: 'offerings', tab: 'offerings', required: false,
    label: (v) => v.offeringLabel,                       // "Menu" / "Services" / "Products" / "Classes" …
    fields: ['offerings'],
    changeSections: ['offerings'],
    present: (c) => (c.offerings?.length ?? 0) > 0,
  },
  testimonials: {
    key: 'testimonials', tab: 'testimonials', required: false,
    label: () => 'Reviews',
    fields: [],
    changeSections: ['testimonials'],
    present: (c) => (c.testimonials?.length ?? 0) > 0,
  },
  faqs: {
    key: 'faqs', tab: 'faqs', required: false,
    label: () => 'Questions',
    fields: ['faqs'],
    changeSections: ['faqs'],
    present: (c) => (c.faqs?.length ?? 0) > 0,
  },
  updates: {
    key: 'updates', tab: 'updates', required: false,
    label: () => 'Updates',
    fields: ['posts'],
    changeSections: ['updates'],
    present: (c) => (c.posts?.length ?? 0) > 0,
  },
  design: {
    key: 'design', tab: 'design', required: false,
    label: () => 'Design & layout',
    fields: [],
    changeSections: ['site'],
    present: (c) => (c.settings?.blocks?.length ?? 0) > 0,
  },
};

// Page kind → the areas that surface on it, in reading order. Keyed by the
// manifest's `kind` so a NEW template page appears automatically (unknown kinds
// fall back to a plain page with no editable sections). Never hardcodes a page
// NAME — the label comes from PAGE_LABEL/vocab below.
const PAGE_AREAS: Record<string, string[]> = {
  home: ['business', 'design', 'testimonials'],
  offerings: ['offerings'],
  about: ['story'],
  contact: ['location'],
  faq: ['faqs'],
  post_index: ['updates'],
};

// Auto/utility page kinds — rendered but not owner-edited (shown read-only).
const AUTO_KINDS = new Set(['thanks', 'privacy', 'accessibility', 'post', 'search']);

// Customer-friendly page labels by kind. Offerings uses the vocab. Unknown kinds
// get a title-cased fallback of the kind, so nothing is ever a raw key.
function pageLabel(kind: string, v: ReturnType<typeof vocabFor>): string {
  switch (kind) {
    case 'home': return 'Home';
    case 'about': return 'About';
    case 'contact': return 'Contact';
    case 'faq': return 'Questions';
    case 'post_index': return 'Updates';
    case 'post': return 'Update';
    case 'thanks': return 'Thank-you page';
    case 'privacy': return 'Privacy policy';
    case 'accessibility': return 'Accessibility';
    case 'offerings': return v.offeringLabel;
    default: return kind.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }
}

// ── Status derivation (deterministic + explainable) ──────────────────────────
function fieldOwned(field: string, prefixes: string[]): boolean {
  return prefixes.some((p) => field === p || field.startsWith(p + '.'));
}

function sectionStatus(area: AreaDef, input: ContentTreeInput): { status: SectionStatus; issues: number } {
  const { validation, changes, draft, publish } = input;
  const blockers = validation.blockers.filter((b) => fieldOwned(b.field, area.fields)).length;
  const warnings = validation.warnings.filter((w) => fieldOwned(w.field, area.fields)).length;
  const changed = changes.changes.some((c) => area.changeSections.includes(c.section));
  const present = area.present(draft);
  const issues = blockers + warnings;

  // Priority order — see RANK. publish_failed and scheduled are site-level signals
  // shown on the rows most likely to carry them (rows with changes / blockers).
  let status: SectionStatus;
  if (publish.lastPublishFailed && (changed || blockers > 0)) status = 'publish_failed';
  else if (blockers > 0) status = 'missing_required';
  else if (warnings > 0) status = 'needs_review';
  else if (changed) status = 'draft_changes';
  else if (publish.scheduledPending && present) status = 'scheduled';
  else if (present && publish.everPublished) status = 'published';
  else if (present) status = 'complete';
  else status = 'empty_optional';
  return { status, issues };
}

const worst = (a: SectionStatus, b: SectionStatus): SectionStatus => (RANK[a] <= RANK[b] ? a : b);
const NEEDS_ATTENTION = new Set<SectionStatus>(['publish_failed', 'missing_required', 'needs_review']);

/** Build the read-only Content Tree. Pure: same inputs → same output. */
export function buildContentTree(input: ContentTreeInput): ContentTree {
  const v = vocabFor(input.draft.settings?.industry);
  const seen = new Set<string>();
  const pages: TreePage[] = [];
  let attention = 0;

  for (const p of input.manifest.pages ?? []) {
    const kind = String(p.kind || '');
    // Collapse repeated page kinds (e.g. many `post`) to one row; skip dup paths.
    const dedupeKey = AUTO_KINDS.has(kind) ? kind : `${kind}:${p.path}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const auto = AUTO_KINDS.has(kind) || !(kind in PAGE_AREAS);
    const areaKeys = PAGE_AREAS[kind] ?? [];
    const sections: TreeSection[] = [];
    for (const ak of areaKeys) {
      const area = AREAS[ak];
      if (!area) continue;                                 // removed/renamed area → skip safely
      const { status, issues } = sectionStatus(area, input);
      if (NEEDS_ATTENTION.has(status)) attention++;
      sections.push({
        key: area.key,
        label: area.label(v),
        status, status_label: STATUS_LABEL[status],
        required: area.required,
        issue_count: issues,
        editor_link: `/presence.html#${area.tab}`,
      });
    }

    // Page rollup: worst section status; a page with no editable sections takes a
    // calm published/complete/empty state from the site as a whole.
    let pageStatus: SectionStatus = auto
      ? (input.publish.everPublished ? 'published' : 'complete')
      : (sections.length ? sections.reduce((acc, s) => worst(acc, s.status), 'empty_optional' as SectionStatus) : 'complete');
    const issue_count = sections.reduce((n, s) => n + s.issue_count, 0);
    if (!auto && NEEDS_ATTENTION.has(pageStatus) && sections.length === 0) attention++;

    pages.push({
      key: kind || p.path,
      label: pageLabel(kind, v),
      path: p.path,
      status: pageStatus, status_label: STATUS_LABEL[pageStatus],
      issue_count,
      editor_link: sections[0]?.editor_link ?? '/presence.html',
      auto,
      sections,
    });
  }

  const site_status: ContentTree['site_status'] =
    input.publish.lastPublishFailed ? 'publish_failed'
      : input.publish.scheduledPending ? 'scheduled'
      : !input.publish.everPublished ? 'never_published'
      : input.changes.count > 0 ? 'draft_changes'
      : 'live';

  return {
    site_status,
    has_unpublished_changes: input.changes.count > 0,
    last_published_at: input.publish.lastPublishedAt,
    attention_count: attention,
    pages,
  };
}
