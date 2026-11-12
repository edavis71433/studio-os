import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Sales item 88 (Nov 2026 review, file 07 findings 8 and 9), the studio's side: who signs
// agreements for the studio (Settings → Studio profile), a declined proposal that says why,
// and an agreement signed by both sides. The client's page is its own piece of work.
// Fake data only.

const IDENTITY = { data: { site_id: 's1', business_name: 'Brightline Studio', email: 'hello@example.com', phone: '', service_area: '', updated_at: '2026-10-01T00:00:00Z' } };
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SCOPED_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
  scope: { site_id: CLIENT, name: 'Corner Café' },
} };

test.describe('Who signs agreements for the studio (sales item 88)', () => {
  test('Studio profile: the name and title save with the profile, and only what changed', async ({ page }) => {
    await installApp(page, { api: { '/identity': IDENTITY, '/settings': { data: { industry_key: 'generic', signs_as_name: '', signs_as_title: '' } } } });
    const puts: Array<{ path: string; body: Record<string, unknown> }> = [];
    await page.route('**/functions/v1/presence/**', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const path = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
      const body = route.request().postDataJSON();
      puts.push({ path, body });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: path === '/identity' ? IDENTITY.data : body }) });
    });
    await page.goto('/settings.html#studio');
    await expect(page.locator('#f-signer')).toBeVisible();
    await expect(page.locator('#signerHow')).toContainText('the moment they sign');
    await page.locator('#f-signer').fill('Alex Rivera');
    await page.locator('#f-signer-title').fill('Owner');
    await page.locator('#profileSave').click();
    await expect.poll(() => puts.find((p) => p.path === '/settings')?.body).toEqual({ signs_as_name: 'Alex Rivera', signs_as_title: 'Owner' });
  });

  test('inside a client the studio’s signer stays out of their profile', async ({ page }) => {
    await installApp(page, { api: { '/identity': IDENTITY, '/settings': { data: { industry_key: 'generic' } }, '/portal/context': SCOPED_CTX } });
    await page.goto('/settings.html?client=' + CLIENT + '#studio');
    await expect(page.locator('#f-name')).toBeVisible();
    await expect(page.locator('#f-signer')).toBeHidden();
  });
});

const DEAL = 'dddddddd-1111-4111-8111-dddddddddddd';
const DETAIL = { data: {
  deal: { id: DEAL, title: 'Corner Café — site', stage: 'contract', expected_value_cents: 480000, contact_id: 'c1', converted_client_id: null, next_step: null, next_step_at: null, notes: '', retainer: null },
  contact: { id: 'c1', name: 'Sam Lee', email: 'sam@example.com', phone: '', company: 'Corner Café', notes: '' },
  proposals: [
    { id: 'p2', title: 'Website refresh', status: 'sent', version: 2, line_items: [{ label: 'Design', qty: 1, unit_cents: 480000 }], sent_at: '2026-11-10T00:00:00Z' },
    { id: 'p1', title: 'Website refresh', status: 'declined', version: 1, line_items: [{ label: 'Design', qty: 1, unit_cents: 520000 }, { __meta__: { superseded_by: null } }], decided_at: '2026-11-08T00:00:00Z', decided_reason: 'timing', decided_note: 'If online ordering could wait until spring' },
  ],
  contracts: [{ id: 'k1', title: 'Project agreement', status: 'signed', signer_name: 'Sam Lee', signed_at: '2026-11-11T23:42:07Z', countersigned_name: 'Alex Rivera', body: 'PROJECT AGREEMENT' }],
  events: [], invoices: [], last_contacted_at: null,
  timeline: [
    { id: 'evt:1', at: '2026-11-11T20:00:00Z', logged_at: '2026-11-11T20:00:00Z', source: 'system', kind: 'client_question', icon: '', who: '', text: 'They asked about the proposal: “Can the catering page take orders too?”', backdated: false },
    { id: 'evt:2', at: '2026-11-08T00:00:00Z', logged_at: '2026-11-08T00:00:00Z', source: 'system', kind: 'proposal_decided', icon: '', who: '', text: 'Proposal declined — The timing: “If online ordering could wait until spring”', backdated: false },
  ],
} };
const DEAL_API = { [`/sales/deals/${DEAL}`]: DETAIL, [`/sales/deals/${DEAL}/tasks`]: { data: [] }, '/sales/services': { data: [] }, '/sales/templates': { data: [] }, '/identity': IDENTITY };

test.describe('The deal says why, and who signed (sales item 88)', () => {
  test('a declined proposal says what would make it a yes; the agreement shows both signatures', async ({ page }) => {
    await installApp(page, { api: DEAL_API });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    const rows = page.locator('#detailInner .lr');
    await expect(rows.filter({ hasText: 'Declined' })).toContainText('Why: The timing: “If online ordering could wait until spring”');
    await expect(page.locator('#detailInner')).toContainText('signed by Sam Lee and by Alex Rivera for you');
  });

  test('the history reads the question and the reason', async ({ page }) => {
    await installApp(page, { api: DEAL_API });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=activity`);
    // the timeline and the Overview's latest three both carry it
    await expect(page.locator('#detailInner .tl-tx:visible').filter({ hasText: 'They asked about the proposal' }).first()).toBeVisible();
    await expect(page.locator('#detailInner .tl-tx:visible').filter({ hasText: 'Proposal declined — The timing' }).first()).toBeVisible();
  });
});
