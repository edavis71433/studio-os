// CMS-UX-1 — Client Content Tree: pure adapter tests.
//   deno run --allow-read tests/presence/content_tree_test.mjs
// Covers tree generation, required/optional, template changes, industry vocab,
// the full status-priority ladder, deep-links, removed-section fallback, the
// client-safe response shape, and empty state. (Tenant isolation + edition gating
// + bounded-query behaviour are enforced at the route/DB layer — see the live
// tenant_isolation_test.mjs; the route inherits site scoping and adds no new store.)
import { buildContentTree } from '../../supabase/functions/presence/lib/content_tree.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL ', name); } };
const eq = (name, a, b) => ok(name + ` (got ${JSON.stringify(a)})`, a === b);

// ── fixtures ────────────────────────────────────────────────────────────────
const MANIFEST = {
  name: 'Test', slug: 'business-classic', version: '1.0.0', content_contract_version: 3,
  pages: [
    { path: '/', kind: 'home' },
    { path: '/services/', kind: 'offerings' },
    { path: '/about', kind: 'about' },
    { path: '/contact', kind: 'contact' },
    { path: '/faq', kind: 'faq' },
    { path: '/privacy', kind: 'privacy' },
  ],
  entities: {},
};
const fullDraft = () => ({
  identity: { business_name: 'Rosa’s', description: 'A bakery', phone: '555-1212', email: '', story: 'Since 2019', tagline: 'Fresh daily' },
  locations: [{ address_line1: '1 Main', city: 'Burbank', region: 'CA', postal_code: '91505', timezone: 'America/Los_Angeles', hours: [] }],
  settings: { industry: 'generic', blocks: [{ type: 'features' }] },
  offerings: [{ id: 'a', name: 'Cake', category: 'Sweets' }],
  testimonials: [{ id: 't', quote: 'Great', author: 'X' }],
  faqs: [{ id: 'f', question: 'Q', answer: 'A' }],
  posts: [{ id: 'p', title: 'Hi', slug: 'hi', body_md: 'x', published_at: '2026-01-01' }],
  redirects: [],
});
const base = (over = {}) => ({
  manifest: MANIFEST, draft: fullDraft(), live: null,
  validation: { ok: true, blockers: [], warnings: [] },
  changes: { count: 0, changes: [], first_publish: false },
  publish: { lastPublishedAt: null, lastPublishFailed: false, scheduledPending: false, everPublished: false },
  ...over,
});
const section = (tree, pageKind, key) => tree.pages.find((p) => p.key === pageKind)?.sections.find((s) => s.key === key);

// 1. Tree generation from a manifest
{
  const t = buildContentTree(base());
  eq('1 pages generated from manifest', t.pages.length, 6);
  eq('1 home page labelled', t.pages.find((p) => p.key === 'home')?.label, 'Home');
  ok('1 privacy is an auto page', t.pages.find((p) => p.key === 'privacy')?.auto === true);
}

// 2. Required vs optional sections
{
  const t = buildContentTree(base());
  eq('2 business basics required', section(t, 'home', 'business')?.required, true);
  eq('2 reviews optional', section(t, 'home', 'testimonials')?.required, false);
}

// 3. Template change — a different page set adapts automatically
{
  const m2 = { ...MANIFEST, pages: [{ path: '/', kind: 'home' }, { path: '/blog/', kind: 'post_index' }] };
  const t = buildContentTree(base({ manifest: m2 }));
  eq('3 adapts to new page set', t.pages.length, 2);
  ok('3 updates page present', t.pages.some((p) => p.key === 'post_index' && p.label === 'Updates'));
}

// 4. Industry vocabulary drives the offerings label
{
  const r = buildContentTree(base({ draft: { ...fullDraft(), settings: { industry: 'restaurant' } } }));
  eq('4 restaurant → Menu', r.pages.find((p) => p.key === 'offerings')?.label, 'Menu');
  const g = buildContentTree(base());
  eq('4 generic → Services', g.pages.find((p) => p.key === 'offerings')?.label, 'Services');
  const s = buildContentTree(base({ draft: { ...fullDraft(), settings: { industry: 'retail' } } }));
  eq('4 retail → Products', s.pages.find((p) => p.key === 'offerings')?.label, 'Products');
}

// 5. Draft vs live change → draft_changes
{
  const t = buildContentTree(base({
    changes: { count: 1, changes: [{ section: 'offerings', sentence: 'x' }], first_publish: false },
    publish: { lastPublishedAt: '2026-01-01', lastPublishFailed: false, scheduledPending: false, everPublished: true },
  }));
  eq('5 offerings shows draft_changes', section(t, 'offerings', 'offerings')?.status, 'draft_changes');
}

// 6. Missing required content
{
  const t = buildContentTree(base({
    validation: { ok: false, blockers: [{ field: 'identity.business_name', message: 'required' }], warnings: [] },
  }));
  eq('6 business → missing_required', section(t, 'home', 'business')?.status, 'missing_required');
  eq('6 issue counted', section(t, 'home', 'business')?.issue_count, 1);
}

// 7. Needs review (a warning)
{
  const t = buildContentTree(base({
    validation: { ok: true, blockers: [], warnings: [{ field: 'faqs', message: 'no faqs' }] },
  }));
  eq('7 faqs → needs_review', section(t, 'faq', 'faqs')?.status, 'needs_review');
}

// 8. Published state
{
  const t = buildContentTree(base({
    publish: { lastPublishedAt: '2026-01-01', lastPublishFailed: false, scheduledPending: false, everPublished: true },
  }));
  eq('8 offerings → published', section(t, 'offerings', 'offerings')?.status, 'published');
  eq('8 site_status live', t.site_status, 'live');
}

// 9. Scheduled state
{
  const t = buildContentTree(base({
    publish: { lastPublishedAt: '2026-01-01', lastPublishFailed: false, scheduledPending: true, everPublished: true },
  }));
  eq('9 offerings → scheduled', section(t, 'offerings', 'offerings')?.status, 'scheduled');
  eq('9 site_status scheduled', t.site_status, 'scheduled');
}

// 10. Publish failed state
{
  const t = buildContentTree(base({
    changes: { count: 1, changes: [{ section: 'offerings', sentence: 'x' }], first_publish: false },
    publish: { lastPublishedAt: '2026-01-01', lastPublishFailed: true, scheduledPending: false, everPublished: true },
  }));
  eq('10 offerings → publish_failed', section(t, 'offerings', 'offerings')?.status, 'publish_failed');
  eq('10 site_status publish_failed', t.site_status, 'publish_failed');
}

// 11. Status priority: blocker beats change beats present
{
  const t = buildContentTree(base({
    validation: { ok: false, blockers: [{ field: 'identity.business_name', message: 'r' }], warnings: [] },
    changes: { count: 1, changes: [{ section: 'business', sentence: 'x' }], first_publish: false },
  }));
  eq('11 blocker wins over change', section(t, 'home', 'business')?.status, 'missing_required');
}

// 12. Deep links use the existing editor hash contract
{
  const t = buildContentTree(base());
  const links = t.pages.flatMap((p) => p.sections.map((s) => s.editor_link));
  ok('12 every deep-link targets the editor', links.length > 0 && links.every((l) => l.startsWith('/presence.html#')));
  eq('12 offerings → #offerings', section(t, 'offerings', 'offerings')?.editor_link, '/presence.html#offerings');
}

// 13. Removed / unknown page kind → safe fallback (auto, no sections, no crash)
{
  const m2 = { ...MANIFEST, pages: [{ path: '/x', kind: 'brand_new_kind' }] };
  const t = buildContentTree(base({ manifest: m2 }));
  eq('13 unknown kind still renders one page', t.pages.length, 1);
  ok('13 unknown kind is auto/empty', t.pages[0].auto === true && t.pages[0].sections.length === 0);
  ok('13 unknown kind gets a readable label', t.pages[0].label === 'Brand New Kind');
}

// 14. Client-safe shape: no field paths, no uuids, no internal keys leak
{
  const t = buildContentTree(base({
    validation: { ok: false, blockers: [{ field: 'identity.business_name', message: 'r' }], warnings: [] },
  }));
  const s = JSON.stringify(t);
  ok('14 no validation field paths leak', !s.includes('identity.business_name') && !s.includes('"field"'));
  ok('14 no block ids leak', !s.includes('block_'));
  ok('14 no raw entity keys as labels', !/"label":"offerings"/.test(s));
  ok('14 rows carry only safe fields', t.pages.every((p) => 'label' in p && 'status' in p && 'editor_link' in p));
}

// 15. Empty state (no pages) → empty tree, never_published
{
  const t = buildContentTree(base({ manifest: { ...MANIFEST, pages: [] } }));
  eq('15 empty manifest → no pages', t.pages.length, 0);
  eq('15 never published', t.site_status, 'never_published');
}

// 16. attention_count rolls up rows needing the owner
{
  const t = buildContentTree(base({
    validation: { ok: false, blockers: [{ field: 'identity.business_name', message: 'r' }], warnings: [{ field: 'faqs', message: 'w' }] },
  }));
  ok('16 attention_count > 0 when work remains', t.attention_count >= 2);
}

console.log(fail === 0
  ? `\n════ CONTENT TREE: ${pass}/${pass} PASS ════`
  : `\n${fail} FAILURE(S), ${pass} passed`);
if (fail) Deno.exit(1);
