import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp } from './helpers/app';

// ── Editing and removing a contact ───────────────────────────────────────────
// Eric: "i should be able to edit or delete these contacts." His roster carried
// one person twice — "Claud Beltran / claud.beltran@gmail.com / (626) 234-6081"
// and "Claude Beltran / no email / 6262346081" — and every row's only action was
// "→ New deal". These pin the two new ones.
//
// The delete is the careful half. Claud is a CONVERTED CUSTOMER: a won deal, a
// signed agreement, a paid deposit and a project hang off him. So:
//   • an unconfirmed DELETE writes NOTHING — it is a dry run that returns the
//     inventory, and the confirm NAMES it,
//   • confirming soft-deletes exactly ONE row: nothing cascades,
//   • a failure says what happened, and never looks like a success.

const ROSTER = [
  { id: 'ct-claud', name: 'Claud Beltran', email: 'claud.beltran@gmail.com', phone: '(626) 234-6081', company: 'Bacchus Kitchen + Wine Bar', updated_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    possible_duplicate_of: { id: 'ct-claude', name: 'Claude Beltran', email: '', phone: '6262346081', reasons: ['same phone number', 'same name'], why: 'same phone number and same name' } },
  { id: 'ct-claude', name: 'Claude Beltran', email: '', phone: '6262346081', company: '', updated_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    possible_duplicate_of: { id: 'ct-claud', name: 'Claud Beltran', email: 'claud.beltran@gmail.com', phone: '(626) 234-6081', reasons: ['same phone number', 'same name'], why: 'same phone number and same name' } },
  { id: 'ct-eric', name: 'Eric Test', email: 'edavis7143@yahoo.com', phone: '', company: '', updated_at: new Date(Date.now() - 5 * 86400000).toISOString() },
  { id: 'ct-hettie', name: 'Hettie Smith', email: 'hettie@example.com', phone: '(310) 555-0134', company: 'Smith & Co', updated_at: new Date(Date.now() - 9 * 86400000).toISOString() },
  { id: 'ct-maurice', name: 'Maurice Tobin', email: 'maurice@example.com', phone: '', company: '', updated_at: new Date(Date.now() - 12 * 86400000).toISOString() },
];

// The two shapes the DELETE dry run answers with (the server never writes on an
// unconfirmed DELETE, so BOTH of these are 409s).
const HAS_HISTORY = {
  error: 'has_history', name: 'Claud Beltran', has_history: true, converted: true,
  items: ['1 deal', '1 signed agreement', '1 paid invoice', '1 project'],
  attachments: { deals: 1, won_deals: 1, projects: 1, signed_contracts: 1, paid_invoices: 1, open_invoices: 0, appointments: 0, reviews: 0 },
  unknown: [],
  message: 'Claud Beltran has 1 deal, 1 signed agreement, 1 paid invoice and 1 project. They became a customer. Removing them takes them off your contact list only — the deal, the agreement, the invoices and the project all stay exactly where they are, and nothing is deleted with them.',
};
const NO_HISTORY = {
  error: 'confirm_required', name: 'Claude Beltran', has_history: false, converted: false,
  items: [], attachments: {}, unknown: [],
  message: 'Nothing else in your workspace is attached to Claude Beltran — no deals, invoices, projects or bookings.',
};

const pinTable = (page: Page) =>
  page.addInitScript(() => { try { if (!localStorage.getItem('dds-display:contacts')) localStorage.setItem('dds-display:contacts', 'table'); } catch { /* denied */ } });

/** Serve the roster, and let a test decide what the per-contact routes answer.
 *  Registered AFTER installApp so it wins (Playwright matches newest first). */
async function mockContacts(page: Page, opts: {
  roster?: unknown[];
  detail?: Record<string, unknown>;
  onDelete?: (id: string, confirmed: boolean) => { status: number; body: unknown };
  onPatch?: (body: unknown) => { status: number; body: unknown };
  writes?: string[];             // every non-GET the page makes, as "METHOD path"
} = {}) {
  let roster = opts.roster || ROSTER;
  await page.route(/\/functions\/v1\/presence\/sales\/contacts/, (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const method = req.method();
    if (method !== 'GET' && opts.writes) opts.writes.push(`${method} ${path}${url.search}`);
    const send = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/sales/contacts/fields') return send(200, { data: [] });
    const m = path.match(/^\/sales\/contacts\/([^/]+)$/);
    if (m) {
      const id = m[1];
      if (method === 'DELETE') {
        const confirmed = url.searchParams.get('confirm') === '1';
        const out = opts.onDelete ? opts.onDelete(id, confirmed) : { status: 200, body: { data: { ok: true, deleted: true } } };
        if (out.status === 200 && confirmed) roster = (roster as { id: string }[]).filter((c) => c.id !== id);
        return send(out.status, out.body);
      }
      if (method === 'PATCH') {
        const out = opts.onPatch ? opts.onPatch(req.postDataJSON()) : { status: 200, body: { data: { id } } };
        return send(out.status, out.body);
      }
      return send(200, { data: opts.detail || { contact: (roster as { id: string }[]).find((c) => c.id === id) || {}, deals: [], timeline: [], custom_fields: [] } });
    }
    return send(200, { data: roster });
  });
}

test.describe('Contacts — editing a contact from the row', () => {
  test('Edit round-trips: the dialog opens seeded, PATCHes the change, and the roster shows it', async ({ page }) => {
    await pinTable(page);
    await installApp(page);
    const writes: string[] = [];
    let patched: Record<string, unknown> | null = null;
    const roster = ROSTER.map((c) => ({ ...c }));
    await mockContacts(page, {
      roster,
      detail: { contact: { ...ROSTER[3], custom: { referred_by: 'Word of mouth' } }, deals: [], timeline: [],
        custom_fields: [{ key: 'referred_by', label: 'Referred by', type: 'text' }] },
      onPatch: (body) => {
        patched = body as Record<string, unknown>;
        // the persisted roster now carries the edit — the reload after save must show it
        const row = roster.find((c) => c.id === 'ct-hettie')!;
        Object.assign(row, { name: patched.name, email: patched.email, phone: patched.phone, company: patched.company });
        return { status: 200, body: { data: row } };
      },
      writes,
    });
    await page.goto('/contacts.html');
    await expect(page.locator('tbody tr')).toHaveCount(5);

    await page.locator('[data-edit="ct-hettie"]').click();
    await expect(page.locator('#editDlg')).toBeVisible();
    // seeded from the record, custom fields included (Manage fields defines them here)
    await expect(page.locator('#e-name')).toHaveValue('Hettie Smith');
    await expect(page.locator('#e-email')).toHaveValue('hettie@example.com');
    await expect(page.locator('#e-phone')).toHaveValue('(310) 555-0134');
    await expect(page.locator('#e-company')).toHaveValue('Smith & Co');
    await expect(page.locator('#e-custom [data-cf="referred_by"]')).toHaveValue('Word of mouth');

    await page.locator('#e-name').fill('Hettie Smyth');
    await page.locator('#e-company').fill('Smyth & Co');
    await page.locator('#e-custom [data-cf="referred_by"]').fill('Referral from Claud');
    await page.locator('#e-save').click();

    await expect(page.locator('#editDlg')).toBeHidden();
    expect(patched).toEqual({
      name: 'Hettie Smyth', email: 'hettie@example.com', phone: '(310) 555-0134', company: 'Smyth & Co',
      custom: { referred_by: 'Referral from Claud' },
    });
    // it PERSISTS: the roster reloads and reads back the saved name
    await expect(page.locator('tbody')).toContainText('Hettie Smyth');
    await expect(page.locator('tbody')).not.toContainText('Hettie Smith');
    expect(writes.filter((w) => w.startsWith('PATCH'))).toHaveLength(1);
  });

  test('a rejected edit NAMES the reason and keeps the dialog open', async ({ page }) => {
    await pinTable(page);
    await installApp(page);
    await mockContacts(page, {
      onPatch: () => ({ status: 409, body: { error: 'email_taken', message: 'Another contact already uses that email.' } }),
    });
    await page.goto('/contacts.html');
    await page.locator('[data-edit="ct-claude"]').click();
    await expect(page.locator('#editDlg')).toBeVisible();
    await page.locator('#e-email').fill('claud.beltran@gmail.com');
    await page.locator('#e-save').click();
    // the server's own words, not a generic "that didn't save"
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'Another contact already uses that email.' }).first()).toBeVisible();
    await expect(page.locator('#editDlg')).toBeVisible();
    await expect(page.locator('#e-save')).toBeEnabled();
  });

  test('a contact with no name and no email is refused before any request', async ({ page }) => {
    await pinTable(page);
    await installApp(page);
    const writes: string[] = [];
    await mockContacts(page, { writes });
    await page.goto('/contacts.html');
    await page.locator('[data-edit="ct-claude"]').click();
    await page.locator('#e-name').fill('');
    await page.locator('#e-email').fill('');
    await page.locator('#e-save').click();
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'A contact needs a name or an email.' }).first()).toBeVisible();
    expect(writes).toEqual([]);
  });
});

test.describe('Contacts — removing a contact', () => {
  test('a contact with NOTHING attached deletes on a plain confirm', async ({ page }) => {
    await pinTable(page);
    await installApp(page);
    const writes: string[] = [];
    await mockContacts(page, {
      writes,
      onDelete: (_id, confirmed) => confirmed
        ? { status: 200, body: { data: { ok: true, deleted: true, name: 'Claude Beltran', kept_items: [] } } }
        : { status: 409, body: NO_HISTORY },
    });
    await page.goto('/contacts.html');
    await expect(page.locator('tbody tr')).toHaveCount(5);

    await page.locator('[data-del="ct-claude"]').click();
    await expect(page.locator('#delDlg')).toBeVisible();
    await expect(page.locator('#delBody')).toContainText('Remove Claude Beltran?');
    // the confirm still tells the truth about what is (not) attached
    await expect(page.locator('#delBody')).toContainText('Nothing else in your workspace is attached to Claude Beltran');
    await expect(page.locator('#delBody .delfacts')).toHaveCount(0);

    await page.locator('#del-go').click();
    await expect(page.locator('#delDlg')).toBeHidden();
    // gone from the roster — Eric ends up with ONE Claud
    await expect(page.locator('tbody tr')).toHaveCount(4);
    await expect(page.locator('tbody')).not.toContainText('Claude Beltran');
    await expect(page.locator('tbody')).toContainText('Claud Beltran');
    // exactly two calls: the dry run, then the confirmed delete
    expect(writes).toEqual(['DELETE /sales/contacts/ct-claude', 'DELETE /sales/contacts/ct-claude?confirm=1']);
  });

  test('a contact WITH history is warned about by name, and nothing cascades', async ({ page }) => {
    await pinTable(page);
    await installApp(page);
    const writes: string[] = [];
    const allWrites: string[] = [];
    page.on('request', (r) => { if (r.method() !== 'GET' && r.url().includes('/functions/v1/presence')) allWrites.push(`${r.method()} ${new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '')}`); });
    await mockContacts(page, {
      writes,
      onDelete: (_id, confirmed) => confirmed
        ? { status: 200, body: { data: { ok: true, deleted: true, name: 'Claud Beltran', kept_items: ['1 deal', '1 signed agreement', '1 paid invoice', '1 project'] } } }
        : { status: 409, body: HAS_HISTORY },
    });
    await page.goto('/contacts.html');
    await page.locator('[data-del="ct-claud"]').click();

    await expect(page.locator('#delDlg')).toBeVisible();
    // it names WHAT is attached — not "Are you sure?"
    const facts = page.locator('#delBody .delfacts li');
    await expect(facts).toHaveCount(4);
    await expect(facts.nth(0)).toHaveText('1 deal');
    await expect(facts.nth(1)).toHaveText('1 signed agreement');
    await expect(facts.nth(2)).toHaveText('1 paid invoice');
    await expect(facts.nth(3)).toHaveText('1 project');
    // and it promises the history survives
    await expect(page.locator('#delBody')).toContainText('nothing is deleted with them');
    await expect(page.locator('#delBody')).toContainText('They became a customer');
    // nothing has been written yet — the dry run is a READ in disguise
    expect(writes).toEqual(['DELETE /sales/contacts/ct-claud']);

    await page.locator('#del-go').click();
    await expect(page.locator('#delDlg')).toBeHidden();
    await expect(page.locator('tbody')).not.toContainText('Claud Beltran');
    // the toast says what was KEPT
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'their 1 deal, 1 signed agreement, 1 paid invoice, 1 project stayed' }).first()).toBeVisible();
    // NOTHING CASCADED: the only writes in the whole flow were the two contact calls
    expect(allWrites).toEqual(['DELETE /sales/contacts/ct-claud', 'DELETE /sales/contacts/ct-claud']);
  });

  test('backing out of the confirm writes nothing at all', async ({ page }) => {
    await pinTable(page);
    await installApp(page);
    const writes: string[] = [];
    await mockContacts(page, { writes, onDelete: () => ({ status: 409, body: HAS_HISTORY }) });
    await page.goto('/contacts.html');
    await page.locator('[data-del="ct-claud"]').click();
    await expect(page.locator('#delDlg')).toBeVisible();
    await page.locator('#del-cancel').click();
    await expect(page.locator('#delDlg')).toBeHidden();
    await expect(page.locator('tbody tr')).toHaveCount(5);
    expect(writes).toEqual(['DELETE /sales/contacts/ct-claud']);   // the dry run only
  });

  test('a failed delete says what happened and never reads as success', async ({ page }) => {
    await pinTable(page);
    await installApp(page);
    await mockContacts(page, {
      onDelete: (_id, confirmed) => confirmed
        ? { status: 502, body: { error: 'write_failed', message: 'We couldn’t remove Claud Beltran — the change didn’t reach the database (502). Nothing was deleted; please try again.' } }
        : { status: 409, body: HAS_HISTORY },
    });
    await page.goto('/contacts.html');
    await page.locator('[data-del="ct-claud"]').click();
    await page.locator('#del-go').click();
    // the dialog STAYS open, carrying the reason — a closed dialog would read as done
    await expect(page.locator('#delDlg')).toBeVisible();
    await expect(page.locator('#delBody [role="alert"]')).toContainText('Claud Beltran was NOT removed');
    await expect(page.locator('#delBody [role="alert"]')).toContainText('didn’t reach the database (502)');
    await expect(page.locator('#del-go')).toHaveText('Try again');
    await expect(page.locator('tbody')).toContainText('Claud Beltran');
  });

  test('a removed contact stays gone from the roster AND from search', async ({ page }) => {
    await pinTable(page);
    await installApp(page);
    await mockContacts(page, {
      roster: ROSTER.map((c) => ({ ...c })),
      onDelete: (_id, confirmed) => confirmed
        ? { status: 200, body: { data: { ok: true, deleted: true, kept_items: [] } } }
        : { status: 409, body: NO_HISTORY },
    });
    await page.goto('/contacts.html');
    await page.locator('[data-del="ct-claude"]').click();
    await page.locator('#del-go').click();
    await expect(page.locator('tbody tr')).toHaveCount(4);
    // search finds the survivor and never the removed row
    await page.locator('#q').pressSequentially('belt');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('Claud Beltran');
    // a full reload re-reads the server, which no longer lists them
    await page.goto('/contacts.html');
    await expect(page.locator('tbody tr')).toHaveCount(4);
    await expect(page.locator('#main')).not.toContainText('Claude Beltran');
  });
});

test.describe('Contacts — the possible-duplicate hint', () => {
  test('the roster asks for hints and flags the pair, saying why', async ({ page }) => {
    await pinTable(page);
    await installApp(page);
    const asked = page.waitForRequest((r) => r.method() === 'GET' && /\/sales\/contacts\?/.test(r.url()) && r.url().includes('dupes=1'));
    await mockContacts(page);
    await page.goto('/contacts.html');
    await asked;
    const flags = page.locator('.dupflag');
    await expect(flags).toHaveCount(2);            // the two Clauds, nobody else
    await expect(flags.first()).toHaveText('possible duplicate');
    await expect(page.locator('tr[data-open="ct-claud"] .dupflag')).toHaveAttribute('title', /Claude Beltran — same phone number and same name/);
    await expect(page.locator('tr[data-open="ct-hettie"] .dupflag')).toHaveCount(0);
  });
});

// ── Eric works from his phone ────────────────────────────────────────────────
// At ≤759px the roster defaults to CARDS (the table would need sideways
// scrolling to reach a last-column action). The viewport is pinned explicitly so
// this holds in every project, not only the mobile one. No display is pinned in
// localStorage here — the default is exactly what's being tested.
test.describe('Contacts — reachable at 390px', () => {
  // hasTouch as well as the viewport: the desktop project has no touch context,
  // and these actions have to be TAPPABLE, not merely clickable.
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Edit and Delete are on the card, inside the viewport, and both work', async ({ page }) => {
    await installApp(page);
    await mockContacts(page, {
      onDelete: (_id, confirmed) => confirmed
        ? { status: 200, body: { data: { ok: true, deleted: true, kept_items: [] } } }
        : { status: 409, body: NO_HISTORY },
    });
    await page.goto('/contacts.html');
    await expect(page.locator('.c[data-open]')).toHaveCount(5);      // cards, not the wide table
    await expect(page.locator('tbody tr')).toHaveCount(0);

    const card = page.locator('.c[data-open="ct-claude"]');
    const edit = card.locator('[data-edit]');
    const del = card.locator('[data-del]');
    await expect(edit).toBeVisible();
    await expect(del).toBeVisible();
    // genuinely reachable: inside the 390px viewport, and a real tap target
    for (const btn of [edit, del]) {
      const box = (await btn.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.height).toBeGreaterThanOrEqual(40);                 // ≥ the 40px tap-target floor
    }

    // the edit dialog opens and its Save is tappable (the SS6 phone-dialog pin)
    await edit.tap();
    await expect(page.locator('#editDlg')).toBeVisible();
    const save = (await page.locator('#e-save').boundingBox())!;
    expect(save.y + save.height).toBeLessThanOrEqual(844);
    await page.locator('#e-cancel').tap();

    // and the delete confirm reaches its own button
    await del.tap();
    await expect(page.locator('#delDlg')).toBeVisible();
    const go = (await page.locator('#del-go').boundingBox())!;
    expect(go.y + go.height).toBeLessThanOrEqual(844);
    await page.locator('#del-go').tap();
    await expect(page.locator('.c[data-open]')).toHaveCount(4);
  });
});

test.describe('Contacts — studio scope is not regressed', () => {
  test('scoped into a client the page still says contacts are studio-level, with no row actions', async ({ page }) => {
    await installApp(page);
    await page.route(/\/functions\/v1\/presence\/sales\/contacts/, (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
    await page.goto('/contacts.html?client=site-acme');
    await expect(page.locator('#main')).toContainText('Contacts live at the studio level.');
    await expect(page.locator('[data-edit], [data-del]')).toHaveCount(0);
    await expect(page.locator('a[data-noscope]')).toHaveAttribute('href', '/contacts.html');
  });
});
