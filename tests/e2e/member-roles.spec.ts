import { test, expect, Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { capabilitiesOf, type SiteRole } from '../../supabase/functions/presence/lib/site_roles';

// An invited member's pages offer only what their role can use (MC-3). The server has
// refused a member's delete and configure writes since MC-2; this proves nobody with
// such a seat is left holding a button that answers 403, and that everyone the server
// doesn't hold to the table sees what they always saw. Capabilities come from the real
// table (lib/site_roles.ts), so a change there changes what these expect.
const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
const SCOPE = { site_id: CLIENT, name: 'Alpha' };
const contextOf = (role: SiteRole, extra: Record<string, unknown> = {}) => ({ data: {
  site_role: role, edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: false, is_operator: false, is_managed_client: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: capabilitiesOf(role), landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null, scope: null,
  ...extra,
} });

type Need = 'delete' | 'configure' | 'owner';
interface Person { who: string; ctx: { data: Record<string, unknown> }; lacks: Need[]; scoped?: boolean }
const PEOPLE: Person[] = [
  { who: 'the owner', ctx: contextOf('business_owner'), lacks: [] },
  { who: 'a studio scoped in', ctx: contextOf('business_owner', { is_agency: true, scope: SCOPE }), lacks: [], scoped: true },
  // index.ts stamps a seat for a client caller alone, so the server never holds this person to it
  { who: 'a studio scoped in who also holds a staff seat there', ctx: contextOf('business_staff', { is_agency: true, scope: SCOPE }), lacks: [], scoped: true },
  { who: 'platform staff', ctx: contextOf('business_owner', { is_operator: true }), lacks: [] },
  { who: 'a staff member', ctx: contextOf('business_staff'), lacks: ['delete', 'configure', 'owner'] },
  { who: 'a developer', ctx: contextOf('developer'), lacks: ['delete', 'owner'] },
];
const STAFF = PEOPLE.find((p) => p.who === 'a staff member')!;
const DEVELOPER = PEOPLE.find((p) => p.who === 'a developer')!;
const OWNER = PEOPLE.find((p) => p.who === 'the owner')!;
const withScope = (url: string, p: Person) => (p.scoped ? url + (url.includes('?') ? '&' : '?') + 'client=' + CLIENT : url);

/** Each control was drawn, and it shows exactly when this person's role can use it. */
async function expectControls(page: Page, p: Person, controls: Array<[string, Need]>) {
  for (const [sel, need] of controls) {
    const c = page.locator(sel).first();
    await expect(c, `${sel} was drawn`).toBeAttached();
    if (p.lacks.includes(need)) await expect(c, `${sel} is gone for ${p.who}`).toBeHidden();
    else await expect(c, `${sel} is there for ${p.who}`).toBeVisible();
  }
}
/** For a control that lives in a panel or fold the test didn't open: the role rule alone decides its display. */
async function expectDisplay(page: Page, p: Person, sel: string, need: Need) {
  const c = page.locator(sel).first();
  await expect(c, `${sel} was drawn`).toBeAttached();
  const display = await c.evaluate((n) => getComputedStyle(n).display);
  if (p.lacks.includes(need)) expect(display, `${sel} is gone for ${p.who}`).toBe('none');
  else expect(display, `${sel} is there for ${p.who}`).not.toBe('none');
}
const pin = (page: Page, key: string, value: string) =>
  page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* denied */ } }, [key, value]);

// ── the mechanism ────────────────────────────────────────────────────────────
const ROSTER = [{ id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', updated_at: '2026-07-01T00:00:00Z' }];
const CONTACTS_API = { '/sales/contacts/fields': { data: [] }, '/sales/contacts': { data: ROSTER } };

test.describe('what a role lacks', () => {
  for (const p of PEOPLE) {
    test(`${p.who}: <html> says ${p.lacks.join(', ') || 'nothing'}`, async ({ page }) => {
      await installApp(page, { api: { ...CONTACTS_API, '/portal/context': p.ctx } });
      await page.goto(withScope('/contacts.html', p));
      await expect(page.locator('#dds-shell')).toBeAttached();
      await expect(page.locator('[data-del="ct-1"]').first()).toBeAttached();
      await page.waitForFunction(() => (window as unknown as { __ddsContext?: unknown }).__ddsContext);
      const said = await page.evaluate(() => document.documentElement.getAttribute('data-dds-lacks'));
      if (p.lacks.length) expect(said!.split(' ').sort()).toEqual([...p.lacks].sort());
      else expect(said).toBeNull();
      expect(await page.evaluate(() => (window as unknown as { ddsLacks: (n: string) => boolean }).ddsLacks('delete'))).toBe(p.lacks.includes('delete'));
    });
  }

  test('a context that fails to load hides nothing: the server still answers', async ({ page }) => {
    await installApp(page, { api: CONTACTS_API });
    await page.route('**/functions/v1/presence/portal/context', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await page.goto('/contacts.html');
    await expect(page.locator('#manageFields')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-dds-lacks'))).toBeNull();
  });

  test('a context with no capability list hides nothing', async ({ page }) => {
    const { capabilities: _gone, ...rest } = contextOf('business_staff').data;
    await installApp(page, { api: { ...CONTACTS_API, '/portal/context': { data: rest } } });
    await page.goto('/contacts.html');
    await expect(page.locator('#manageFields')).toBeVisible();
    await page.waitForFunction(() => (window as unknown as { __ddsContext?: unknown }).__ddsContext);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-dds-lacks'))).toBeNull();
  });

  test('a button drawn BEFORE the role is known goes as soon as it is', async ({ page }) => {
    await installApp(page, { api: { ...CONTACTS_API } });
    let release = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/presence/portal/context', async (r) => {
      await held;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STAFF.ctx) });
    });
    await page.goto('/contacts.html');
    await expect(page.locator('#manageFields')).toBeVisible();   // no role yet: an owner must never see a gap here
    release();
    await expect(page.locator('#manageFields')).toBeHidden();
  });
});

// ── Files ────────────────────────────────────────────────────────────────────
const ASSET = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Logo', kind: 'image', mime: 'image/png', in_use: false, favorite: false, alt_text: 'Logo', tags: [], collection: 'Brand', state: 'live', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' };
const FILES_API = {
  '/assets/collections': { data: [] }, '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [ASSET], total: 1, shown: 1, live_count: 1, policy: 'immediate' } },
  ['/assets/' + ASSET.id]: { data: { asset: ASSET, usage: [], versions: { has_history: false }, summary: { headline: 'Not in use.' } } },
};
test.describe('Files', () => {
  for (const p of PEOPLE) {
    test(`${p.who}: permanent Delete, and they keep Archive`, async ({ page }) => {
      await pin(page, 'dds-display:files', 'table');
      await installApp(page, { api: { ...FILES_API, '/portal/context': p.ctx } });
      await page.goto(withScope('/files.html', p));
      await page.locator('tbody tr', { hasText: 'Logo' }).click();
      await expect(page.locator('#panel')).toHaveClass(/on/);
      await expectControls(page, p, [['#panel [data-needs="delete"]', 'delete']]);
      await expect(page.locator('#panel').getByRole('button', { name: 'Archive' })).toBeVisible();   // "archiving a file is not deleting it" (decided 2026-11-05)
    });
  }
});

// ── Contacts ─────────────────────────────────────────────────────────────────
test.describe('Contacts', () => {
  for (const p of PEOPLE) {
    test(`${p.who}: Delete and Manage fields, and they keep Edit`, async ({ page }) => {
      await pin(page, 'dds-display:contacts', 'table');
      await installApp(page, { api: { ...CONTACTS_API, '/portal/context': p.ctx } });
      await page.goto(withScope('/contacts.html', p));
      await expectControls(page, p, [['[data-del="ct-1"]', 'delete'], ['#manageFields', 'configure']]);
      await expect(page.locator('#new')).toBeVisible();
    });
  }
});

// ── Pipeline: a deal's drafts, invoices, retainer and saved templates ────────
const DEAL = '44444444-4444-4444-8444-444444444444';
const INV = 'aaaaaaa1-1111-4111-8111-aaaaaaaaaaaa';
const OPEN_INV = { id: INV, title: 'Website build', amount_cents: 320000, purpose: 'service', status: 'open', stripe_url: 'https://pay.example/a', due_at: null, sent_at: '2026-07-01T00:00:00Z' };
const DEAL_OF = (retainer: unknown) => ({ data: {
  deal: { id: DEAL, title: 'Acme website', stage: 'proposal', expected_value_cents: 320000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'ct-1', converted_client_id: null, retainer },
  contact: { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', notes: '' },
  proposals: [{ id: 'p-draft', title: 'Website build', status: 'draft', version: 1, line_items: [{ label: 'Build', qty: 1, unit_cents: 320000 }], first_viewed_at: null, expires_at: null }],
  contracts: [{ id: 'k-draft', title: 'Service agreement', status: 'draft', signer_name: null, signed_at: null, version: 1, terms_snapshot: null }],
  events: [], timeline: [], invoices: [OPEN_INV], last_contacted_at: null,
} });
const PIPELINE_API = {
  '/sales/deals': { data: [] }, [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  '/sales/summary': { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [] } },
  '/sales/contacts': { data: ROSTER },
  '/sales/templates': { data: [{ id: 't-prop', kind: 'proposal', name: 'Standard build', body: {} }, { id: 't-con', kind: 'contract', name: 'Standard terms', body: {} }] },
  '/sales/services': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } }, '/identity': { data: { business_name: 'Test Studio' } },
};
test.describe('Pipeline deal page', () => {
  for (const p of PEOPLE) {
    test(`${p.who}: void, draft and template removal, retainer cancel, deal delete, and they keep Send`, async ({ page }) => {
      const api = { ...PIPELINE_API, [`/sales/deals/${DEAL}`]: DEAL_OF({ amount_cents: 50000, interval: 'month', status: 'active' }), '/portal/context': p.ctx };
      await installApp(page, { api });
      await page.goto(withScope(`/pipeline.html?deal=${DEAL}&dtab=billing`, p));
      await expectControls(page, p, [
        ['[data-del-prop="p-draft"]', 'delete'],
        ['[data-del-con="k-draft"]', 'delete'],
        ['[data-del-tpl]', 'delete'],
        [`[data-void-inv="${INV}"]`, 'delete'],
        ['#cancelRetainer', 'delete'],
        ['#delDeal', 'delete'],
      ]);
      await expect(page.locator(`[data-send-inv="${INV}"]`).first()).toBeVisible();   // staff can still send what they can't withdraw
    });
  }

  for (const p of [OWNER, STAFF, DEVELOPER]) {
    test(`${p.who}: Void on the "Who owes you" list, and they keep Send`, async ({ page }) => {
      const item = { id: INV, title: 'Deposit', amount_cents: 40000, due_date: null, overdue: false, deal_id: DEAL, deal: 'Acme website', stripe_url: 'https://pay.example/fc' };
      const summary = { data: { total: 1, open: { count: 1, value_cents: 40000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 40000, count: 1, overdue_cents: 0, overdue_count: 0 } } };
      await installApp(page, { api: { ...PIPELINE_API, '/sales/summary': summary, '/sales/receivables': { data: { items: [item], total_cents: 40000, overdue_cents: 0 } }, '/portal/context': p.ctx } });
      await page.goto('/pipeline.html');
      await page.locator('#arOpen').click();
      await expect(page.locator('#detailInner')).toContainText('Who owes you');
      await expectControls(page, p, [[`.rcv-row [data-void-inv="${INV}"]`, 'delete']]);
      await expect(page.locator(`.rcv-row [data-send-inv="${INV}"]`)).toBeVisible();
    });
  }
});

// ── The client record ────────────────────────────────────────────────────────
const CID = 'ffffffff-6666-4666-8666-ffffffffffff';
const RECORD = (identity: Record<string, unknown>, sections: Record<string, boolean>, tab: string) => ({ data: {
  identity: { contact_id: null, deal_id: null, client_id: null, customer_site_id: null, project_id: null, ...identity },
  header: { name: 'Sam Rivera', company: 'Acme', email: 'c@example.com', phone: '', status: 'customer' }, highlights: {},
  sections: { overview: false, details: false, deal: false, delivery: false, ...sections }, default_tab: tab, canonical: { key: 'contact', value: CID },
} });
test.describe('Client record', () => {
  for (const p of PEOPLE) {
    test(`${p.who}: Delete this contact`, async ({ page }) => {
      const detail = { data: { contact: { id: CID, name: 'Sam Rivera', company: 'Acme', email: 'c@example.com', phone: '', custom: {} }, custom_fields: [], deals: [], timeline: [], last_contacted_at: null } };
      await installApp(page, { api: { '/crm/record': RECORD({ contact_id: CID }, { details: true }, 'details'), ['/sales/contacts/' + CID]: detail, '/portal/context': p.ctx } });
      await page.goto(`/crm.html?contact=${CID}&tab=details`);
      await page.getByRole('button', { name: 'Edit' }).click();
      await expectControls(page, p, [['#ec-del', 'delete']]);
      await expect(page.locator('#ec-save')).toBeVisible();
    });

    test(`${p.who}: Void and Cancel retainer on Billing`, async ({ page }) => {
      const deal = { data: {
        deal: { id: DEAL, title: 'Acme', stage: 'won', expected_value_cents: 320000, converted_client_id: 'cl-1', retainer: { amount_cents: 50000, interval: 'month', status: 'active' } },
        proposals: [], contracts: [], invoices: [{ id: 'i-2', title: 'Invoice', purpose: 'service', amount_cents: 160000, status: 'open', stripe_url: 'https://pay.test/b' }],
      } };
      await installApp(page, { api: { '/crm/record': RECORD({ deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT }, { overview: true, details: true, deal: true }, 'details'), [`/sales/deals/${DEAL}`]: deal, '/crm/activity': { data: { items: [] } }, '/portal/context': p.ctx } });
      await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
      await expectControls(page, p, [['[data-void-inv="i-2"]', 'delete'], ['[data-ret-cancel]', 'delete']]);
      await expect(page.locator('[data-send-inv="i-2"]')).toBeVisible();
    });
  }
});

// ── Settings ─────────────────────────────────────────────────────────────────
const SETTINGS_API = {
  '/identity': { data: { business_name: 'Test Studio', email: 'hello@example.com', phone: '', service_area: 'Anytown' } },
  '/connections': { data: { providers: [] } },
};
test.describe('Settings', () => {
  for (const p of PEOPLE.filter((x) => !x.scoped)) {
    test(`${p.who}: kind of business and the automations`, async ({ page }) => {
      await installApp(page, { api: { ...SETTINGS_API, '/settings': { data: { industry_key: 'generic' } }, '/portal/context': p.ctx } });
      await page.goto('/settings.html');
      await expect(page.locator('[data-card="studio"]')).toBeVisible();
      await expect(page.locator('#f-name')).toHaveValue('Test Studio');
      await expectControls(page, p, [['[data-card="auto"]', 'configure'], ['#f-industry', 'configure'], ['[data-card="billing"]', 'owner']]);
      const auto = page.locator('#automations');
      if (p.lacks.includes('configure')) await expect(auto).toBeHidden();
      else await expect(auto).toBeAttached();
      // /commerce answers for the caller's own account: a member has none, and was told "we couldn't find a plan"
      if (p.lacks.includes('owner')) await expect(page.locator('#billing')).toBeHidden();
      else await expect(page.locator('#plan')).not.toBeEmpty();
    });
  }

  // the select still reads "generic" for a site with no industry yet, which differs from
  // the row, so Save used to send it: the name saved, the 403 came back, and the toast said
  // nothing had changed.
  const saving = async (page: Page, p: Person) => {
    const sent: string[] = [];
    await installApp(page, { api: { ...SETTINGS_API, '/settings': { data: {} }, '/portal/context': p.ctx } });
    page.on('request', (r) => { if (r.method() === 'PUT') sent.push(new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '')); });
    await page.goto('/settings.html');
    await expect(page.locator('#f-name')).toHaveValue('Test Studio');
    await page.waitForFunction(() => (window as unknown as { __ddsContext?: unknown }).__ddsContext);
    await page.locator('#f-name').fill('Renamed Studio');
    await page.locator('#profileSave').click();
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'Saved.' }).first()).toBeVisible();
    return sent.sort();
  };
  test('a staff member saving the profile on a site with no industry sends only the name', async ({ page }) => {
    expect(await saving(page, STAFF)).toEqual(['/identity']);
  });
  test('a developer saving the same still sends the industry: configure is theirs', async ({ page }) => {
    expect(await saving(page, DEVELOPER)).toEqual(['/identity', '/settings']);
  });
  test('the owner saving the same still sends the industry', async ({ page }) => {
    expect(await saving(page, OWNER)).toEqual(['/identity', '/settings']);
  });
});

// ── The builder ──────────────────────────────────────────────────────────────
const PIC = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const BUILDER_API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [{ id: 'o1', name: 'Pasta', category: 'Mains', description: '', price_text: '$12', is_visible: true }] },
  '/faqs': { data: [{ id: 'f1', question: 'Open Sundays?', answer: 'Yes.', is_visible: true }] },
  '/testimonials': { data: [{ id: 'q1', quote: 'Lovely.', author_name: 'Sam', is_visible: true }] },
  '/posts': { data: [{ id: 'u1', title: 'New menu', body: 'Fresh.', tags: [], status: 'draft' }] },
  '/media': { data: [{ id: 'm1', alt_text: 'Pasta', thumb: PIC, created_at: '2026-01-01T00:00:00Z', used_by: [] }] },
  '/settings': { data: {} }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [] } },
  '/schedule': { data: { scheduled: [] } },
  '/content-library': { data: [{ id: 'cl1', name: 'Saved hero', block: { type: 'title' }, used_on: [] }] },
  '/website-health': { data: { categories: [] } }, '/content-tree': { data: { items: [] } }, '/website-timeline': { data: { items: [] } },
  '/foundations/domain': { data: null },
  '/foundations': { data: { dns: { sentence: 'Temporary address.', records: [] }, ssl: { sentence: 'Padlock on.' }, email: { sentence: 'No email yet.', has_mail: true, spf: false, dmarc: false }, hosting: { sentence: 'Hosted.' } } },
  '/foundations/plans': { data: [] }, '/launch': { data: { launched: true, sentence: 'Live.', items: [] } },
  '/preview/status': { data: { draft: { unpublished_changes: 0 }, preview: { exists: true, url: 'https://preview.example', has_password: false }, live: { published: true, last_published_at: '2026-07-01T00:00:00Z', summary: '' } } },
  '/publishes/checkpoints': { data: [{ id: 'cp1', name: 'Before the redesign', created_at: '2026-07-01T00:00:00Z' }] },
  '/bookings/settings': { data: { enabled: true, weekly: [[], [], [], [], [], [], []], closed_dates: [] } },
  '/bookings/types': { data: { types: [{ id: 'b1', name: 'Consultation', duration_min: 30, price_text: '', active: true }] } },
  '/bookings/appointments': { data: { appointments: [] } },
  '/redirects': { data: [{ id: 'r1', from_path: '/old', to_path: '/new' }] },
  '/knowledge/docs': { data: [{ id: 'k1', filename: 'menu.pdf', items: 3 }] },
  '/comments': { data: { threads: [{ page_slug: '', block_id: '', open_count: 1, comments: [{ id: 'cm1', status: 'open', body: 'Love this.', author_kind: 'client', author: 'Sam', created_at: '2026-07-01T00:00:00Z' }] }] } },
  '/site/templates': { data: { current: { slug: 'business-classic', version: '1.0.0' }, templates: [{ slug: 'business-classic', name: 'Business classic', version: '1.0.0' }, { slug: 'editorial', name: 'Editorial', version: '1.0.0' }] } },
};
const openBuilder = async (page: Page, p: Person, hash: string, extra: Record<string, unknown> = {}) => {
  await installApp(page, { api: { ...BUILDER_API, ...extra, '/portal/context': p.ctx } as never });
  await page.goto(withScope('/presence.html', p) + hash);
  await page.waitForFunction(() => (window as unknown as { __ddsContext?: unknown }).__ddsContext);
};

/** Runs a line of the builder's own script: its names live in the page's global scope. */
const builderScript = (page: Page, body: string) =>
  page.evaluate((src) => new Function(`return (async () => { ${src} })()`)(), body);

test.describe('The builder', () => {
  for (const p of PEOPLE) {
    test(`${p.who}: photos`, async ({ page }) => {
      await openBuilder(page, p, '#media');
      await expectControls(page, p, [['#mediaGrid button.del', 'delete']]);
    });

    test(`${p.who}: "Remove for good" on a service, a question, a kind word and an update, and they keep Save`, async ({ page }) => {
      await openBuilder(page, p, '#offerings');
      await page.getByText('Pasta', { exact: true }).first().click();
      await expectControls(page, p, [['#view-offerings [data-act="del"]', 'delete']]);
      await expect(page.locator('#view-offerings [data-act="save"]').first()).toBeVisible();
      for (const [hash, view] of [['#faqs', '#view-faqs'], ['#testimonials', '#view-testimonials'], ['#updates', '#view-updates']]) {
        await page.goto(withScope('/presence.html', p) + hash);
        await page.locator(`${view} button.quietact:text-is("edit")`).first().click();
        await expectControls(page, p, [[`${view} [data-act="del"]`, 'delete']]);
        await expect(page.locator(`${view} [data-act="save"]`).first()).toBeVisible();
      }
    });

    test(`${p.who}: bookings — the on/off and hours, and removing a service, and they keep the services`, async ({ page }) => {
      await openBuilder(page, p, '#bookings');
      await expect(page.getByText('Consultation')).toBeVisible();
      await expectControls(page, p, [
        ['#view-bookings .bk-enabled', 'configure'],
        ['#view-bookings .bk-closed', 'configure'],
        ['#view-bookings button:has-text("Remove")', 'delete'],
      ]);
      await expect(page.locator('#view-bookings button:has-text("Edit")').first()).toBeVisible();
      const note = page.getByText('Ask the account owner to change your hours');
      if (p.lacks.includes('configure')) await expect(note).toBeVisible(); else await expect(note).toBeHidden();
    });

    test(`${p.who}: history — preview password and reset, a checkpoint, and they keep Promote`, async ({ page }) => {
      await openBuilder(page, p, '#history');
      const hist = '#view-history';
      await expectControls(page, p, [
        [`${hist} button:has-text("Password-protect")`, 'configure'],
        [`${hist} button:has-text("Reset link")`, 'configure'],
        [`${hist} button:text-is("Remove")`, 'delete'],
      ]);
      await expect(page.locator(`${hist} button:has-text("Promote to Live")`)).toBeVisible();
      await expect(page.locator(`${hist} button:has-text("Update preview from draft")`)).toBeVisible();
      await expect(page.locator(`${hist} button:has-text("Bring into draft")`)).toBeVisible();
    });
  }

  for (const p of PEOPLE.filter((x) => !x.scoped)) {
    test(`${p.who}: the domain card and desk`, async ({ page }) => {
      await openBuilder(page, p, '');
      const card = page.locator('#domainCard');
      await expect(card).toContainText('temporary address');
      await expectControls(page, p, [['#domainCard button:has-text("Connect your domain")', 'configure']]);
      const cardNote = card.getByText('Ask the account owner to connect it.');
      if (p.lacks.includes('configure')) await expect(cardNote).toBeVisible(); else await expect(cardNote).toBeHidden();

      await page.goto('/presence.html#domain');
      await expect(page.getByText('Right now your site is at a temporary address.')).toBeVisible();
      await expectControls(page, p, [['button:has-text("I already have a domain")', 'configure']]);
      await expect(page.getByText('Ask the account owner to connect it.').last()).toBeVisible({ visible: p.lacks.includes('configure') });
    });

    test(`${p.who}: a connected domain's Remove, and email protection`, async ({ page }) => {
      await openBuilder(page, p, '#domain', {
        '/foundations/domain': { data: { custom_domain: 'marlows.example', health: 'ok' } },
      });
      await expect(page.getByText('marlows.example is live and secure.').first()).toBeVisible();
      await expectControls(page, p, [
        ['button:has-text("Remove this domain")', 'configure'],
        ['button:has-text("Set up email protection")', 'configure'],
      ]);
      await expect(page.getByText('Ask the account owner to set this up.')).toBeVisible({ visible: p.lacks.includes('configure') });
    });

    test(`${p.who}: account deletion`, async ({ page }) => {
      await openBuilder(page, p, '#business');
      await expectControls(page, p, [['#deleteCard', 'owner']]);
    });

    test(`${p.who}: the Sharing link in the rail, and they keep Connections`, async ({ page }) => {
      await openBuilder(page, p, '');
      await expectControls(page, p, [['#view-today a[href="/sharing.html"]', 'owner']]);
      await expect(page.locator('#view-today a[href="/connections.html"]').first()).toBeVisible();
    });
  }

  for (const p of PEOPLE) {
    test(`${p.who}: industry on Business info, verification codes on Search, and they keep the announcement`, async ({ page }) => {
      await openBuilder(page, p, '#business');
      await expectControls(page, p, [['#view-business .field:has(#f-industry)', 'configure']]);
      await expect(page.locator('#ann-text')).toBeVisible();
      await page.locator('#nav .navitem[data-view="search"]').click();
      await expectControls(page, p, [['#view-search details:has(#f-gsv)', 'configure']]);
    });

    test(`${p.who}: taking the site offline, from the Page menu`, async ({ page }) => {
      await openBuilder(page, p, '#design');
      await page.locator('#btnPageInfo').click();
      const off = page.locator('#piOffline');
      await expect(off).toBeAttached();
      await expect(off).toHaveText('Take site offline…');
      if (p.lacks.includes('configure')) await expect(off).toBeHidden(); else await expect(off).toBeVisible();
    });

    test(`${p.who}: the template gallery`, async ({ page }) => {
      await openBuilder(page, p, '#design');
      await expect(page.locator('#designGallery .tg-card').first()).toBeAttached();
      await expectDisplay(page, p, '#designGallery', 'owner');
    });

    test(`${p.who}: forwards, reference documents, saved sections and a comment, and they keep Resolve`, async ({ page }) => {
      await openBuilder(page, p, '#business');
      await expectDisplay(page, p, 'button[title="Remove this forward"]', 'delete');
      await expectDisplay(page, p, '#knowledgeList button.quietact', 'delete');
      await page.goto(withScope('/presence.html', p) + '#design');
      await page.waitForFunction(() => (window as unknown as { __ddsContext?: unknown }).__ddsContext);
      await expect(page.locator('#blocksCard')).toBeAttached();
      // both sit behind several panels of the canvas, so this opens them the way those panels do
      await builderScript(page, 'CL_SHOW = true; CL_ITEMS = (await api("GET", "/content-library")).data; renderBlocksCard(); await cmLoad(); openCommentsThread("", null, "Home");');
      await expectDisplay(page, p, 'button[title="Remove from library"]', 'delete');
      await expectDisplay(page, p, '#cmPanelBody .cm-itemacts button:text-is("Remove")', 'delete');
      await expect(page.locator('#cmPanelBody .cm-itemacts button:text-is("Resolve")')).toBeAttached();
    });

    test(`${p.who}: the look chooser's "Use this look"`, async ({ page }) => {
      await openBuilder(page, p, '#history');
      await builderScript(page, 'LOOK_OPEN = true; PV.template = "editorial"; await mountLookSeg();');
      await expectDisplay(page, p, '#lookSeg button:has-text("Use this look")', 'owner');
    });
  }
});

// ── Undo: undoing an add sends DELETE, which a role without delete can't do ──
const NEW_ROW = 'dddddddd-4444-4444-8444-dddddddddddd';
test.describe('Undo in the builder', () => {
  for (const p of PEOPLE) {
    test(`${p.who}: adding a service ${p.lacks.includes('delete') ? 'offers no Undo that would be refused' : 'can be undone'}`, async ({ page }) => {
      await openBuilder(page, p, '#offerings');
      const deletes: string[] = [];
      await page.route(/\/functions\/v1\/presence\/offerings/, (r) => {
        const m = r.request().method();
        if (m === 'GET') return r.fallback();
        if (m === 'DELETE') deletes.push(new URL(r.request().url()).pathname.split('/').pop()!);
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: NEW_ROW, name: 'Soup', category: 'Mains', price_text: '' } }) });
      });
      await builderScript(page, 'await api("POST", "/offerings", { name: "Soup", category: "Mains", price_text: "" });');
      const undo = page.locator('#btnUndoTop');
      if (p.lacks.includes('delete')) {
        await expect(undo).toHaveAttribute('hidden', '');
      } else {
        await expect(undo).toBeEnabled();
        await undo.evaluate((b) => (b as HTMLElement).click());
        await expect.poll(() => deletes).toEqual([NEW_ROW]);
      }
    });
  }

  test('a staff member keeps Undo for what they can put back: an edit goes back with PATCH, and an add before it stays off the history', async ({ page }) => {
    await openBuilder(page, STAFF, '#offerings');
    const writes: string[] = [];
    await page.route(/\/functions\/v1\/presence\/offerings/, (r) => {
      const m = r.request().method();
      if (m === 'GET') return r.fallback();
      writes.push(m);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: NEW_ROW, name: 'Pasta' } }) });
    });
    await builderScript(page, 'await api("POST", "/offerings", { name: "Soup", category: "Mains", price_text: "" }); await api("PATCH", "/offerings/o1", { name: "Pasta al forno" });');
    const undo = page.locator('#btnUndoTop');
    await expect(undo).toBeEnabled();
    await undo.evaluate((b) => (b as HTMLElement).click());
    await expect.poll(() => writes).toEqual(['POST', 'PATCH', 'PATCH']);
    await expect(undo).toBeDisabled();   // nothing left, and the add was never offered
  });
});

// ── Styles: the template and the design cards ────────────────────────────────
test.describe('The Styles panel', () => {
  for (const p of PEOPLE) {
    test(`${p.who}: ${p.lacks.includes('configure') ? 'no way in, and a note if reached another way' : 'opens as it did'}`, async ({ page }) => {
      // the real answer for staff: routes/dev.ts designAllowed is the owner or a developer
      const staff = p.lacks.includes('configure');
      await page.route('**/functions/v1/presence/dev/**', (r) => (staff ? r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"forbidden"}' }) : r.fallback()));
      await openBuilder(page, p, '#design');
      await expectDisplay(page, p, '#btnSettingsOpen', 'configure');
      await builderScript(page, 'openSettingsPanel("styles");');
      const note = page.locator('#stylesAsk');
      if (staff) await expect(note).toBeVisible(); else await expect(note).toBeHidden();
      await builderScript(page, 'openSettingsPanel("forms");');
      await expect(note).toBeHidden();   // the panel's other modes are staff's to use
    });
  }
});

// ── Nothing marked is left showing, wherever a member can land ───────────────
test.describe('A member, page by page', () => {
  const PAGES: Array<[string, string, Record<string, unknown>]> = [
    ['/contacts.html', '[data-del="ct-1"]', CONTACTS_API],
    ['/pipeline.html?deal=' + DEAL + '&dtab=billing', '#delDeal', { ...PIPELINE_API, [`/sales/deals/${DEAL}`]: DEAL_OF({ amount_cents: 50000, interval: 'month', status: 'active' }) }],
    ['/presence.html#bookings', '#view-bookings .bk-enabled', BUILDER_API],
    ['/presence.html#history', '#view-history button:has-text("Reset link")', BUILDER_API],
  ];
  for (const [url, drawn, api] of PAGES) {
    test(`a staff member on ${url} can't see one marked control`, async ({ page }) => {
      await installApp(page, { api: { ...api, '/portal/context': STAFF.ctx } as never });
      await page.goto(url);
      await expect(page.locator(drawn).first()).toBeAttached();
      await expect(page.locator(drawn).first()).toBeHidden();
      const showing = await page.evaluate(() => Array.from(document.querySelectorAll('[data-needs]')).filter((n) => n.getClientRects().length > 0).map((n) => (n as HTMLElement).outerHTML.slice(0, 120)));
      expect(showing).toEqual([]);
    });
  }
});
