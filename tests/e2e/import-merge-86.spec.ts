import { test, expect, Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales items 86 + 105 (Nov 2026): an import matches its columns, updates people already
// there and can be undone for a day; two records for one person can be merged (and the
// merge undone). Drawn in Figma, section 13 (frames 6 to 9). Every name is made up.

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const csvFile = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
const GOOGLE = 'First Name,Last Name,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Value,Phone 2 - Value,Organization Name,Organization Title,Address 1 - Formatted,Labels,Notes,Birthday\n'
  + 'Ana,Ruiz,Home,ana@example.com,(555) 010-2211,(555) 010-3300,Bluebird Bakery,Owner,"12 Elm St, Glendale, CA 91203",restaurant ::: * myContacts,Met at the expo,1988-04-02\n'
  + 'Bo,Lee,,bo@example.com,555 0200,,,,,,,\n';
async function importRoutes(page: Page, opts: { existing?: string[] } = {}) {
  const starts: Record<string, unknown>[] = [], rows: Record<string, unknown>[] = [], undos: string[] = [];
  let latest: Record<string, unknown> | null = null;
  await page.route('**/functions/v1/presence/sales/contacts/imports', (route) => {
    if (route.request().method() === 'POST') { starts.push(route.request().postDataJSON()); latest = { id: 'imp-1', created_at: new Date().toISOString(), added: 0, updated: 0, undone_at: null }; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'imp-1', undo: true } }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: latest }) });
  });
  await page.route('**/functions/v1/presence/sales/contacts/imports/*/undo', (route) => { undos.push(route.request().url()); latest = null; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { removed: 1, restored: 1, kept: 0 } }) }); });
  await page.route(/\/functions\/v1\/presence\/sales\/contacts(\?.*)?$/, (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) });
    const b = route.request().postDataJSON(); rows.push(b);
    const here = (opts.existing || []).includes(String(b.email));
    if (latest) { if (here && b.import_id) (latest as { updated: number }).updated++; else if (!here) (latest as { added: number }).added++; }
    return route.fulfill({ status: here ? 200 : 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'ct-' + rows.length }, ...(here ? { deduped: true, updated: !!b.import_id } : {}) }) });
  });
  return { starts, rows, undos };
}

test.describe('Import: match the columns, update people already here, undo (item 86)', () => {
  test('each column says where it goes, the guesses are right, and a column can be changed', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/contacts/fields': { data: [] } } });
    const seen = await importRoutes(page, { existing: ['bo@example.com'] });
    await page.goto('/contacts.html');
    await page.locator('#importCsv').click();
    await page.locator('#csvZone input[type=file]').setInputFiles(csvFile('google-contacts.csv', GOOGLE));
    const map = page.locator('#csvZone .dds-csvmap');
    await expect(map.locator('tbody tr')).toHaveCount(12);
    await expect(page.locator('#csvZone .dds-csvfile')).toHaveText('google-contacts.csv · 2 contacts in the file');
    const goes = async (i: number) => map.locator(`select[data-col="${i}"]`).inputValue();
    expect([await goes(0), await goes(1), await goes(2), await goes(3), await goes(4), await goes(5), await goes(6), await goes(7), await goes(8), await goes(9), await goes(10), await goes(11)])
      .toEqual(['first', 'last', '', 'email', 'phone', 'phone2', 'company', 'job_title', 'address', 'tags', 'notes', '']);
    await expect(map.locator('tbody tr').nth(2)).toHaveClass(/off/);                 // the label column is greyed: not brought in
    await expect(map.locator('tbody tr').nth(8).locator('td').first()).toHaveText('12 Elm St, Glendale, CA 91203');
    await map.locator('select[data-col="11"]').selectOption('notes');                  // Birthday → Notes after all
    await expect(map.locator('tbody tr').nth(11)).not.toHaveClass(/off/);
    await expect(page.locator('.dds-csvexist input[value="update"]')).toBeChecked();
    await page.locator('#csvZone').getByRole('button', { name: 'Import 2' }).click();
    await expect.poll(() => seen.rows.length).toBe(2);
    expect(seen.starts[0]).toEqual({ file_name: 'google-contacts.csv', on_existing: 'update' });
    expect(seen.rows[0]).toMatchObject({ name: 'Ana Ruiz', email: 'ana@example.com', phone: '(555) 010-2211', phone2: '(555) 010-3300', company: 'Bluebird Bakery', job_title: 'Owner',
      address: { street: '12 Elm St, Glendale, CA 91203' }, tags: ['restaurant'], notes: 'Met at the expo', import_id: 'imp-1' });
    await expect(page.locator('.dds-toast').filter({ hasText: '1 added, 1 updated.' })).toBeVisible();
    // the newest import of the day sits above the list, with its Undo
    const strip = page.locator('.impstrip');
    await expect(strip).toContainText('Imported today at');
    await expect(strip).toContainText('1 added, 1 updated.');
    await strip.getByRole('button', { name: 'Undo this import' }).click();
    await page.getByRole('button', { name: 'Yes, undo it' }).click();
    await expect.poll(() => seen.undos.length).toBe(1);
    await expect(page.locator('.dds-toast').filter({ hasText: 'Import undone: 1 taken off, 1 put back as they were.' })).toBeVisible();
    await expect(page.locator('.impstrip')).toHaveCount(0);
  });

  test('"Leave them as they are" is sent with the import, and a file with no name or email column says so', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/contacts/fields': { data: [] } } });
    const seen = await importRoutes(page);
    await page.goto('/contacts.html');
    await page.locator('#importCsv').click();
    await page.locator('#csvZone input[type=file]').setInputFiles(csvFile('list.csv', 'Who,Mail\nAna Ruiz,ana@example.com\n'));
    const map = page.locator('#csvZone .dds-csvmap');
    await expect(map.locator('select[data-col="0"]')).toHaveValue('');
    await page.locator('#csvZone').getByRole('button', { name: 'Import 1' }).click();
    await expect(page.locator('#csvZone .dds-csvwhy')).toHaveText('Pick a column for the name or the email — an import needs one of them.');
    expect(seen.rows.length).toBe(0);
    await map.locator('select[data-col="0"]').selectOption('name');
    await map.locator('select[data-col="1"]').selectOption('email');
    await page.locator('.dds-csvexist input[value="skip"]').check();
    await page.locator('#csvZone').getByRole('button', { name: 'Import 1' }).click();
    await expect.poll(() => seen.rows.length).toBe(1);
    expect(seen.starts[0]).toMatchObject({ on_existing: 'skip' });
    expect(seen.rows[0]).toMatchObject({ name: 'Ana Ruiz', email: 'ana@example.com' });
  });

  test('your own fields are columns an import can fill', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/contacts/fields': { data: [{ key: 'size', label: 'Team size', type: 'number' }] } } });
    const seen = await importRoutes(page);
    await page.goto('/contacts.html');
    await page.locator('#importCsv').click();
    await page.locator('#csvZone input[type=file]').setInputFiles(csvFile('t.csv', 'Name,Email,Team size\nAna Ruiz,ana@example.com,12\n'));
    await expect(page.locator('#csvZone .dds-csvmap select[data-col="2"]')).toHaveValue('custom:size');
    await page.locator('#csvZone').getByRole('button', { name: 'Import 1' }).click();
    await expect.poll(() => seen.rows.length).toBe(1);
    expect(seen.rows[0]).toMatchObject({ custom: { size: '12' } });
  });
});

// ── merging ──
const PEOPLE = [
  { id: 'ct-1', name: 'Jordan Ellis', email: 'jordan@ellis.example', phone: '(555) 010-5521', company: 'Harbor Dental', job_title: 'Dentist', tags: ['referral'], updated_at: '2026-11-01T00:00:00Z', possible_duplicate_of: { id: 'ct-2', name: 'Jordan Ellis', why: 'same name' } },
  { id: 'ct-2', name: 'Jordan Ellis', email: 'j.ellis@mail.example', phone: '(555) 010-7730', company: 'Harbor Dental Group', job_title: '', tags: ['dental'], updated_at: '2026-10-01T00:00:00Z', possible_duplicate_of: { id: 'ct-1', name: 'Jordan Ellis', why: 'same name' } },
];
const DRY = { data: { dry_run: true,
  keep: { id: 'ct-1', name: 'Jordan Ellis', email: 'jordan@ellis.example', phone: '(555) 010-5521', phone2: '', company: 'Harbor Dental', job_title: 'Dentist', address: '8 Oak Ave, Burbank, CA 91502', found_via: 'Referral', tags: ['referral'] },
  other: { id: 'ct-2', name: 'Jordan Ellis', email: 'j.ellis@mail.example', phone: '(555) 010-7730', phone2: '(555) 010-6619', company: 'Harbor Dental Group', job_title: '', address: '', found_via: 'Google', tags: ['dental'] },
  result: {}, moves: { deals: 2, bookings: 1, reviews: 0 }, partial: false } };
test.describe('Merge two records for one person (items 86 + 105)', () => {
  test('a flagged duplicate merges: pick per field, see what moves, then Undo puts both back', async ({ page }, info) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/contacts': { data: PEOPLE, total: 2 } } });
    const merges: Record<string, unknown>[] = [], unmerges: string[] = [];
    await page.route('**/functions/v1/presence/sales/contacts/ct-1/merge', (route) => { const b = route.request().postDataJSON(); merges.push(b);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b.confirm ? { data: { merged: true, merged_away: { id: 'ct-2', name: 'Jordan Ellis' }, moved: { deals: 2, bookings: 1, reviews: 0 } } } : DRY) }); });
    await page.route('**/functions/v1/presence/sales/contacts/ct-2/unmerge', (route) => { unmerges.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { unmerged: true } }) }); });
    await page.goto('/contacts.html');
    const merge = page.locator('[data-merge="ct-1"]').first();
    if (info.project.name === 'mobile') await page.locator('#dispCards').click().catch(() => {});
    await page.locator('[data-merge="ct-1"]').first().click();
    const dlg = page.locator('#mergeDlg');
    await expect(dlg.getByRole('heading', { name: 'Merge two records for one person' })).toBeVisible();
    expect(merges[0]).toEqual({ from: 'ct-2' });                                       // the dry run: nothing written
    await expect(dlg.locator('input[name="mg-email"][value="keep"]')).toBeChecked();
    await expect(dlg.locator('input[name="mg-phone2"][value="other"]')).toBeChecked();   // the kept one has none: the other's by default
    await expect(dlg.locator('.mmoves')).toHaveText('Everything moves to the one you keep: 2 deals (with their proposals, invoices and projects), 1 booking, notes.');
    await expect(dlg).toContainText('Both sets of tags are kept: referral, dental');
    await dlg.locator('input[name="mg-company"][value="other"]').check();
    await dlg.getByRole('button', { name: 'Merge into one' }).click();
    await expect.poll(() => merges.length).toBe(2);
    expect(merges[1]).toMatchObject({ from: 'ct-2', confirm: true, pick: { name: 'keep', email: 'keep', phone: 'keep', phone2: 'other', company: 'other', job_title: 'keep', address: 'keep', found_via: 'keep' } });
    await expect(dlg).toBeHidden();
    const toast = page.locator('.dds-toast').filter({ hasText: 'Merged into one' });
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => unmerges.length).toBe(1);
    await expect(page.locator('.dds-toast').filter({ hasText: 'The merge is undone — both records are back.' })).toBeVisible();
    void merge;
  });

  test('item 121: notes too long to keep in full are said before the merge, and again after', async ({ page }, info) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/contacts': { data: PEOPLE, total: 2 } } });
    await page.route('**/functions/v1/presence/sales/contacts/ct-1/merge', (route) => { const b = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b.confirm ? { data: { merged: true, merged_away: { id: 'ct-2', name: 'Jordan Ellis' }, moved: { deals: 2, bookings: 1, reviews: 0 }, notes_cut: 340 } } : { data: { ...DRY.data, notes_cut: 340 } }) }); });
    await page.goto('/contacts.html');
    if (info.project.name === 'mobile') await page.locator('#dispCards').click().catch(() => {});
    await page.locator('[data-merge="ct-1"]').first().click();
    const dlg = page.locator('#mergeDlg');
    await expect(dlg.locator('#mgCut')).toContainText('the last 340 characters won’t fit');
    await expect(dlg.locator('#mgCut')).toContainText('The line with the old email address stays at the top');
    await dlg.getByRole('button', { name: 'Merge into one' }).click();
    await expect(page.locator('.dds-toast').filter({ hasText: 'Merged into one' })).toContainText('Their notes were cut by 340 characters to fit; Undo brings them back in full.');
  });

  test('Edit can merge with anyone: pick the other record by searching', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/sales/contacts': { data: PEOPLE, total: 2 } } });
    await page.route('**/functions/v1/presence/sales/contacts/ct-1', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { contact: { ...PEOPLE[0], address: {}, custom: {} }, deals: [], timeline: [], custom_fields: [] } }) }));
    await page.route('**/functions/v1/presence/sales/contacts/ct-1/merge', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DRY) }));
    await page.goto('/contacts.html');
    await page.locator('[data-edit="ct-1"]').first().click();
    await page.locator('#e-merge').click();
    const dlg = page.locator('#mergeDlg');
    await expect(dlg.getByRole('heading', { name: 'Merge Jordan Ellis with…' })).toBeVisible();
    await expect(dlg.locator('[data-pick-merge]')).toHaveCount(1);                        // everyone but the record itself
    await dlg.locator('[data-pick-merge="ct-2"]').click();
    await expect(dlg.getByRole('button', { name: 'Merge into one' })).toBeVisible();
  });

  test('a seat that can’t delete isn’t offered Merge or Undo', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': { data: { ...STUDIO_CTX.data, site_role: 'business_staff', capabilities: ['edit', 'publish', 'invite', 'view_all'] } }, '/sales/contacts': { data: PEOPLE, total: 2 } } });
    await page.goto('/contacts.html');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-dds-lacks')?.includes('delete'));
    await expect(page.locator('[data-merge]').first()).toBeHidden();
  });
});
