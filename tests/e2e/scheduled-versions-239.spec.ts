import { test, expect, Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder item 239: scheduled work used to sign as 'scheduler', which the database refused, so
// nothing scheduled ever went out. It now goes out as the scheduler's hand ('system') on behalf
// of whoever set it. Versions says so: "Published on schedule", beside "Published by you" and
// "Published by your studio" for the rest. The server's half is
// tests/presence/scheduled_work_239_test.mjs.
const SITE = { id: 's1', edition: 'presence', status: 'live', template_slug: 'business-classic', template_version: 1, netlify_site_id: 'n1', last_published_at: '2026-11-15T09:00:00Z' };
const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section></main></body></html>';
const PUBS = [
  { id: 'p-sched', kind: 'publish', status: 'live', summary: 'Scheduled publish', label: '', at: '2026-11-15T09:00:00Z', restorable: true, by_kind: 'system' },
  { id: 'p-revert', kind: 'restore', status: 'live', summary: 'Scheduled revert to an earlier version', label: '', at: '2026-11-14T09:00:00Z', restorable: true, by_kind: 'system' },
  { id: 'p-own', kind: 'publish', status: 'live', summary: 'Changed the opening hours', label: '', at: '2026-11-12T10:42:00Z', restorable: true, by_kind: 'client' },
  { id: 'p-studio', kind: 'publish', status: 'live', summary: 'The new lunch page', label: '', at: '2026-11-08T09:15:00Z', restorable: true, by_kind: 'operator' },
];
async function mount(page: Page) {
  await installApp(page, { api: {
    '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
    '/settings': { data: { blocks: [], section_meta: { blocks: [], pages: {} } } },
    '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
    '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
    '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
    '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] }, '/launches': { data: [] },
    '/publishes': { data: PUBS, stars: [] },
    '/publishes/checkpoints': { data: [] },
    '/site/publish-lock': { data: { on: false, at: null, by_kind: null, words: '', can_change: true } },
    '/preview/status': { data: { draft: { unpublished_changes: 0 }, preview: { exists: false }, live: { published: true, last_published_at: '2026-11-15T09:00:00Z' } } },
    '/portal/context': { data: {
      site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
      is_agency: false, is_operator: false, scope: null, sees_full_workspace: true,
      capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
    } },
  } });
  await page.route('**/functions/v1/presence/preview?**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1, 'publish-atomic': 1 })); } catch { /* storage may be denied */ } });
  await page.goto('/presence.html#history');
}
const rows = (page: Page) => page.locator('#pubList .hentry');

test('Versions says a scheduled publish went out on schedule, and who published the rest', async ({ page }) => {
  await mount(page);
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).nth(0).locator('.hmeta')).toHaveText('Published on schedule');
  await expect(rows(page).nth(1).locator('.hmeta')).toHaveText('A restored version · Published on schedule');
  await expect(rows(page).nth(2).locator('.hmeta')).toHaveText('Published by you');
  await expect(rows(page).nth(3).locator('.hmeta')).toHaveText('Published by your studio');
  // the line fits the row on every screen, a phone's too
  const w = page.viewportSize()!.width;
  for (const m of await page.locator('#pubList .hentry .hmeta').all()) { const r = (await m.boundingBox())!; expect(r.x + r.width).toBeLessThanOrEqual(w + 0.5); }
});
