import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales item 106 (borrowed from Wix Studio's sales side): a proposal paid in parts on a
// schedule, saved proposals that fill the editor (lines, discount, tax and parts), and
// project templates saved from a project and picked on + New project. Fake data only.

const DEAL = 'dddddddd-1111-4111-8111-dddddddddddd';
const DETAIL = { data: {
  deal: { id: DEAL, title: 'Corner Café — site', stage: 'qualified', expected_value_cents: 0, contact_id: 'c1', converted_client_id: null, next_step: null, next_step_at: null, notes: '', retainer: null },
  contact: { id: 'c1', name: 'Sam Lee', email: 'sam@example.com', phone: '', company: 'Corner Café', notes: '' },
  proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null,
} };
const TEMPLATE = { id: 'tttttttt-1111-4111-8111-tttttttttttt', kind: 'proposal', name: 'Website, three parts', title: 'Website refresh',
  line_items: [{ label: 'Design of 6 pages', qty: 1, unit_cents: 240000 }, { label: 'Copywriting', qty: 1, unit_cents: 120000 }, { __meta__: { schedule: [{ pct: 50, when: 'sign' }, { pct: 50, when: 'done' }] } }] };
const API = (templates: unknown[] = []) => ({
  [`/sales/deals/${DEAL}`]: DETAIL,
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  '/sales/services': { data: [{ id: 's1', name: 'Website build', price_cents: 300000 }] },
  '/sales/templates': { data: templates },
  '/identity': { data: { business_name: 'Brightline Studio' } },
});
async function openEditor(page: Page) {
  await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
  await page.locator('#addProp').click();
  await expect(page.locator('#propForm #plPay')).toBeVisible();
}
async function capturePosts(page: Page) {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/proposals`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'p-1' } }) });
  });
  return bodies;
}

test.describe('A proposal paid in parts (sales item 106)', () => {
  test('a ready-made split shows in the client’s view and goes with the save', async ({ page }) => {
    await installApp(page, { api: API() });
    const bodies = await capturePosts(page);
    await openEditor(page);
    await page.locator('#propForm [data-svc="0"]').click();
    await page.locator('#plPay').selectOption('thirds');
    const pv = page.locator('#plPreview');
    await expect(pv.locator('.pb-part')).toHaveCount(3);
    await expect(pv.locator('.pb-part').first()).toContainText('Part 1 of 3 · When you sign the agreement');
    await expect(pv.locator('.pb-part').first()).toContainText('$1,020');
    await expect(pv.locator('.pb-part').nth(1)).toContainText('30 days after you sign');
    await expect(page.locator('#ppSum')).toHaveText('Adds up to 100%');
    await page.locator('#plSave').click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].schedule).toEqual([{ pct: 34, when: 'sign' }, { pct: 33, when: 'days', days: 30 }, { pct: 33, when: 'done' }]);
  });

  test('your own parts must add up to 100 before anything saves', async ({ page }) => {
    await installApp(page, { api: API() });
    const bodies = await capturePosts(page);
    await openEditor(page);
    await page.locator('#propForm [data-svc="0"]').click();
    await page.locator('#plPay').selectOption('custom');
    const rows = page.locator('#plParts .pp-row');
    await expect(rows).toHaveCount(2);
    await rows.nth(0).locator('.pp-pct').fill('60');
    await rows.nth(1).locator('.pp-pct').fill('30');
    await expect(page.locator('#ppSum')).toHaveText('Adds up to 90%. Make it 100%.');
    await page.locator('#plSave').click();
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'The parts add up to 90%. Make them 100%.' }).first()).toBeVisible();
    expect(bodies).toHaveLength(0);
    await rows.nth(1).locator('.pp-when').selectOption('date');
    await rows.nth(1).locator('.pp-date').fill('2026-12-15');
    await rows.nth(1).locator('.pp-pct').fill('40');
    await expect(page.locator('#ppSum')).toHaveText('Adds up to 100%');
    await page.locator('#plSave').click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].schedule).toEqual([{ pct: 60, when: 'sign' }, { pct: 40, when: 'date', date: '2026-12-15' }]);
  });

  test('one payment sends no parts; a saved proposal fills the editor, parts and all', async ({ page }) => {
    await installApp(page, { api: API([TEMPLATE]) });
    const bodies = await capturePosts(page);
    await openEditor(page);
    const card = page.locator('#propForm [data-tpl-fill]');
    await expect(card).toContainText('Website, three parts');
    await expect(card).toContainText('$3,600 · 2 lines · paid in 2 parts');
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#propForm .pl-label')).toHaveCount(2);
    await expect(page.locator('#propForm .pl-label').first()).toHaveValue('Design of 6 pages');
    await expect(page.locator('#plPay')).toHaveValue('half');
    await expect(page.locator('#plPreview .pb-part')).toHaveCount(2);
    await page.locator('#plSave').click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].template_id).toBe(TEMPLATE.id);
    expect(bodies[0].schedule).toEqual([{ pct: 50, when: 'sign' }, { pct: 50, when: 'done' }]);
    // back to one payment: the choice is sent as none
    await page.locator('#addProp').click();
    await page.locator('#propForm [data-svc="0"]').click();
    await page.locator('#plPay').selectOption('');
    await page.locator('#plSave').click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1].schedule).toBeNull();
    expect(bodies[1].template_id).toBeUndefined();
  });
});

// ── the agreement says the same as the parts ──
const ACCEPTED_THIRDS = { id: 'p-acc', title: 'Website refresh', status: 'accepted', version: 1, created_at: '2026-11-10T00:00:00Z', decided_at: '2026-11-11T00:00:00Z',
  line_items: [{ label: 'Design', qty: 1, unit_cents: 480000 }, { __meta__: { schedule: [{ pct: 34, when: 'sign' }, { pct: 33, when: 'days', days: 30 }, { pct: 33, when: 'done' }] } }] };
const partsDeal = (contracts: unknown[] = []) => ({ data: { ...DETAIL.data, deal: { ...DETAIL.data.deal, stage: 'contract', expected_value_cents: 480000 }, proposals: [ACCEPTED_THIRDS], contracts } });

test.describe('The agreement says the same as the parts (sales item 106)', () => {
  test('an agreement drafted for a proposal paid in thirds says the thirds, in all four places', async ({ page }) => {
    await installApp(page, { api: { ...API(), [`/sales/deals/${DEAL}`]: partsDeal() } });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    await page.locator('#addCon').click();
    await expect(page.locator('#conParts')).toHaveText('The proposal is paid in 3 parts, so the payment wording below says the same.');
    const body = page.locator('#conForm textarea');
    await expect.poll(async () => (await body.inputValue()).length, { timeout: 7000 }).toBeGreaterThan(10000);
    const text = await body.inputValue();
    expect(text).toContain('Payment:        In 3 parts: 34% ($1,632) when you sign · 33% ($1,584) 30 days after you sign · 33% ($1,584) when the work is done');
    expect(text).toContain('Part 2 of 3, 30 days after you sign, 33 percent         $1,584');
    expect(text).toContain('The project fee of $4,800 is paid in three parts.');
    expect(text).toContain('The total project fee is paid in 3 parts: 34% upon signing;');
    expect(text).not.toMatch(/50% deposit|Fifty percent, or|deposit of 50%/);
    // another package follows the parts too
    await page.locator('#conPkg').selectOption('template_build');
    await expect.poll(async () => (await body.inputValue()).includes('Package:        Template build')).toBe(true);
    expect(await body.inputValue()).toContain('Payment:        In 3 parts:');
  });

  test('an agreement still saying half and half asks before it goes out', async ({ page }) => {
    const k = { id: 'k-half', title: 'Service agreement', status: 'draft', signer_name: null, signed_at: null, version: 1, body: 'Payment: 50% deposit ($2,400) to begin, the rest before launch.' };
    await installApp(page, { api: { ...API(), [`/sales/deals/${DEAL}`]: partsDeal([k]) } });
    const sends: string[] = [];
    await page.route('**/functions/v1/presence/sales/contracts/*/send', (route) => { sends.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' }); });
    const asked: string[] = [];
    page.on('dialog', (d) => { asked.push(d.message()); d.dismiss(); });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    await page.locator('[data-send-contract="k-half"]').first().click();
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toContain('The proposal is paid in 3 parts, but this agreement still says half to begin and half before launch.');
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'make the agreement’s payment wording match the parts first' }).first()).toBeVisible();
    expect(sends).toHaveLength(0);
  });
});

// ── project templates ──
const P1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const PROJ_API = (saved: unknown[] = []) => ({
  '/projects': { data: [{ id: P1, name: 'Website build', status: 'active', client_visible: true, client_id: null, target_date: null, start_date: '2026-11-01' }], is_studio_view: true },
  '/projects/progress': { data: { [P1]: { progress: { done: 1, total: 4, pct: 25 }, pending_approvals: 0, stage: 'kickoff', next: null, waiting: null, overdue: 0 } } },
  '/studio/customers': { data: [] },
  '/support': { data: [] },
  [`/projects/${P1}`]: { data: { project: { id: P1, name: 'Website build', status: 'active', client_visible: true, client_id: null, start_date: '2026-11-01', description: '' }, milestones: [], tasks: [], deliverables: [], approvals: [], progress: { done: 1, total: 4, pct: 25 }, is_studio_view: true } },
  [`/projects/${P1}/report`]: { data: { summary: { progress: { done: 1, total: 4, pct: 25 }, pending_approvals: 0 } } },
  [`/projects/${P1}/messages`]: { data: [] },
  [`/projects/${P1}/surveys`]: { data: [] },
  [`/projects/${P1}/client-messages`]: { data: [], customer: null },
  '/projects/templates': { data: { builtin: [{ key: 'website', label: 'Website build' }], saved } },
});

test.describe('Project templates (sales item 106)', () => {
  test('Save as a template on a project sends its name and the project', async ({ page }) => {
    await installApp(page, { api: PROJ_API() });
    let posted: unknown = null;
    await page.route('**/functions/v1/presence/projects/templates', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'x', name: 'Our website way', steps: 4 } }) });
    });
    await page.goto('/projects.html');
    await page.locator(`[data-open="${P1}"], #list .card[data-id="${P1}"]`).first().click();
    await expect(page.locator('#dtitle')).toContainText('Website build');
    await page.locator('#saveTpl').click();
    await page.locator('#tplForm input').first().fill('Our website way');
    await page.locator('#tplForm form').evaluate((f) => (f as HTMLFormElement).requestSubmit());
    await expect.poll(() => posted).toEqual({ name: 'Our website way', from_project_id: P1 });
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'with 4 steps' }).first()).toBeVisible();
  });

  test('+ New project lists your templates under Start from; Remove takes one off', async ({ page }) => {
    const saved = [{ id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Our website way', milestones: 3, steps: 9, created_at: '2026-11-12T00:00:00Z' }];
    await installApp(page, { api: PROJ_API(saved) });
    let deleted = '';
    await page.route('**/functions/v1/presence/projects/templates/*', (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      deleted = new URL(route.request().url()).pathname.split('/').pop() || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"ok":true}}' });
    });
    let created: Record<string, unknown> | null = null;
    await page.route('**/functions/v1/presence/projects', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      created = route.request().postDataJSON();
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: P1 }, templated: true }) });
    });
    await page.goto('/projects.html');
    await page.locator('.lhead #newProject').click();
    const sel = page.locator('#np-template');
    await expect(sel.locator('optgroup[label="Your templates"] option')).toHaveText(['Our website way — 9 steps']);
    await page.locator('#np-name').fill('Corner Café website');
    await sel.selectOption(saved[0].id);
    const rm = page.locator('#np-tpls [data-del-ptpl]');
    await rm.click();
    await expect(rm).toHaveText('Tap again to remove');
    expect(deleted).toBe('');
    await rm.click();
    await expect.poll(() => deleted).toBe(saved[0].id);
    await page.locator('#newDlg button[type="submit"]').click();
    await expect.poll(() => created).not.toBeNull();
    expect((created as unknown as Record<string, unknown>).name).toBe('Corner Café website');
  });
});
