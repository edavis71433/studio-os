import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// ── Structurally-empty pages under a client scope ────────────────────────────
// shell.js carryScopeGlobally rewrites every same-origin APP_PAGES anchor to
// carry ?client=, so a client scope is STICKY across the whole operator surface
// until the breadcrumb is used. Projects, deals/invoices and contacts live only
// on the STUDIO's own site — presence_projects and presence_deals are keyed
// site_id = the agency site, and ensureProjectForDeal takes agencySiteId — so
// under a client scope those pages read the client's site and can only ever
// come back empty.
//
// "No projects yet · Create a project" is then false twice over: Eric HAS a
// project (ensureProjectForDeal made one when Bacchus converted), and creating
// one from inside a client scope files it where nothing else can see it. A state
// that can never be non-empty must not borrow the wording of one that can.
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

const SCOPED_CTX = { data: {
  site_role: 'business_owner', edition: 'presence',
  edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: true, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV,
  plan_key: 'presence', upsell: null,
  scope: { site_id: CLIENT, name: 'Bacchus Kitchen + Wine Bar' },
} };

test.describe('Scoped into a client, studio-level pages tell the truth', () => {
  test('Projects: says projects live at the studio level, and drops the create trap', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': SCOPED_CTX, '/projects': { data: [], is_studio_view: true } } });
    await page.goto(`/projects.html?client=${CLIENT}`);
    await expect(page.getByRole('heading', { name: 'Projects live at the studio level' })).toBeVisible();
    await expect(page.getByText('You’re looking at Bacchus Kitchen + Wine Bar.')).toBeVisible();
    // the two lies: he HAS a project, and creating one from here is a trap
    await expect(page.getByText('No projects yet')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);
    // a real exit, and one carryScopeGlobally cannot re-scope back into the client
    const exit = page.getByRole('link', { name: /Leave Bacchus Kitchen \+ Wine Bar/ });
    await expect(exit).toHaveAttribute('href', '/projects.html');
  });

  test('Pipeline: says deals live at the studio level, and drops the New deal trap', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': SCOPED_CTX, '/sales/deals': { data: [] } } });
    await page.goto(`/pipeline.html?client=${CLIENT}`);
    await expect(page.getByRole('heading', { name: 'Deals live at the studio level' })).toBeVisible();
    await expect(page.getByText('No deals yet')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New deal' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Leave Bacchus Kitchen \+ Wine Bar/ }))
      .toHaveAttribute('href', '/pipeline.html');
  });

  test('Contacts: says contacts live at the studio level', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': SCOPED_CTX, '/sales/contacts': { data: [] } } });
    await page.goto(`/contacts.html?client=${CLIENT}`);
    await expect(page.getByRole('heading', { name: 'Contacts live at the studio level.' })).toBeVisible();
    await expect(page.getByText('No contacts yet.')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Leave this client and open Contacts →' }))
      .toHaveAttribute('href', '/contacts.html');
  });

  test('UNSCOPED, the normal empty states are untouched', async ({ page }) => {
    // the studio-level notice must never appear when there is no scope —
    // "no projects yet" is the honest answer for a studio with none
    await installApp(page, { api: { '/projects': { data: [], is_studio_view: true } } });
    await page.goto('/projects.html');
    await expect(page.getByText('No projects yet')).toBeVisible();
    await expect(page.getByText('live at the studio level')).toHaveCount(0);
  });
});
