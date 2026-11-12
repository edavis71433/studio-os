// ── Builder list item 205: closing an account removes the business's customers' details and uploads ──
//   deno run --allow-read --allow-env --allow-net tests/presence/account_close_205_test.mjs
// Nov 12 review, finding 97: a deletion scrubbed the owner's own record and left the
// business's contacts, enquiries, bookings, reviews and files; and each scrub step ignored
// a refusal, so a deletion was marked completed when a step hadn't saved. This drives the
// real sweep (commerce/deletion.ts runDeletionSweep) on a fake database and a fake store.
import { installFakePostgrest } from './fake_pgrst.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const CLIENT = 'c1000000-0000-4000-8000-000000000001', OTHER_CLIENT = 'c1000000-0000-4000-8000-000000000002';
const SITE = '5e000000-0000-4000-8000-000000000001', OTHER = '5e000000-0000-4000-8000-000000000002';
const db = installFakePostgrest();
const { runDeletionSweep } = await import('../../supabase/functions/presence/commerce/deletion.ts');
const { ERASE_TABLES, eraseFolders, eraseDeps } = await import('../../supabase/functions/presence/commerce/erase.ts');

// the store: what each folder holds, and what was removed
let store = {}, removed = [], listFails = false, removeFails = false;
eraseDeps.list = async (folder, offset) => {
  if (listFails) return null;
  const here = store[folder] || [];
  return here.slice(offset, offset + 1000);
};
eraseDeps.remove = async (paths) => { if (removeFails) return false; removed.push(...paths); return true; };

const past = new Date(Date.now() - 86_400_000).toISOString();
const row = (site, extra = {}) => ({ id: crypto.randomUUID(), site_id: site, ...extra });
function seed() {
  const tables = {
    clients: [{ id: CLIENT, name: 'Bloom Salon', email: 'owner@bloom.example', contact_email: null, status: 'active' }, { id: OTHER_CLIENT, name: 'Other Shop', email: 'owner@other.example', contact_email: null, status: 'active' }],
    presence_entitlements: [{ client_id: CLIENT, product: 'presence', status: 'active', stripe_subscription_id: null }],
    presence_sites: [{ id: SITE, client_id: CLIENT, netlify_site_id: null, status: 'live' }, { id: OTHER, client_id: OTHER_CLIENT, netlify_site_id: null, status: 'live' }],
    presence_account_deletions: [{ id: 'd0000000-0000-4000-8000-000000000001', client_id: CLIENT, site_id: SITE, status: 'pending', scheduled_for: past, attempts: 0 }],
    presence_invoices: [row(SITE, { title: 'Spring package', amount_cents: 12000, status: 'paid' }), row(OTHER, { title: 'Theirs', amount_cents: 500, status: 'paid' })],
    presence_media: [row(SITE, { storage_path: `presence-media/${SITE}/a.jpg`, deleted_at: null }), row(OTHER, { storage_path: `presence-media/${OTHER}/b.jpg`, deleted_at: null })],
    presence_publishes: [row(SITE, { status: 'live' })],
  };
  // a customer's row in every table the erase clears, on this business's site and on another one
  for (const t of ERASE_TABLES) tables[t] = [...(tables[t] || []), row(SITE, { name: 'Sam Rivera', email: 'sam@customer.example' }), row(OTHER, { name: 'Pat Lee', email: 'pat@customer.example' })];
  db.reset(tables);
  store = {
    [SITE]: [{ name: 'a.jpg', id: 'o1' }, { name: 'visual', id: null }],
    [`${SITE}/visual`]: [{ name: 'plan-1', id: null }],
    [`${SITE}/visual/plan-1`]: [{ name: 'draft.png', id: 'o2' }],
    [`forms/${SITE}`]: [{ name: 'roof.jpg', id: 'o3' }, { name: 'plan.pdf', id: 'o4' }],
    [`comments/${SITE}`]: [],
    [OTHER]: [{ name: 'b.jpg', id: 'o5' }],
  };
  removed = []; listFails = false; removeFails = false;
}
const T = (t) => db.tables[t] || [];
const onSite = (t, s) => T(t).filter((r) => r.site_id === s);
const deletion = () => T('presence_account_deletions')[0];

// ═══ A · what goes and what stays ═══
{
  seed();
  const res = await runDeletionSweep(5);
  ok('the sweep completes the deletion', res.completed === 1 && res.failed === 0 && deletion().status === 'completed', JSON.stringify({ res, d: deletion() }));
  const left = ERASE_TABLES.filter((t) => onSite(t, SITE).length);
  ok('every table that held this business’s customers is empty for its site', left.length === 0, left.join(', '));
  const touched = ERASE_TABLES.filter((t) => onSite(t, OTHER).length !== 1);
  ok('…another business’s customers are untouched', touched.length === 0, touched.join(', '));
  ok('every file of this site is removed: the media library (sub-folders too), form files, note pictures', JSON.stringify([...removed].sort()) === JSON.stringify([`${SITE}/a.jpg`, `${SITE}/visual/plan-1/draft.png`, `forms/${SITE}/plan.pdf`, `forms/${SITE}/roof.jpg`].sort()), JSON.stringify(removed));
  ok('…and no other site’s file', !removed.some((p) => p.includes(OTHER)));
  ok('the media library’s rows are marked deleted; another site’s are not', onSite('presence_media', SITE).every((m) => !!m.deleted_at) && onSite('presence_media', OTHER).every((m) => !m.deleted_at));
  ok('invoices are kept, for tax (another business’s too)', onSite('presence_invoices', SITE).length === 1 && onSite('presence_invoices', OTHER).length === 1);
  ok('the publish history is kept (no one’s details in it)', onSite('presence_publishes', SITE).length === 1);
  const c = T('clients').find((x) => x.id === CLIENT);
  ok('the owner’s own record is anonymised, as before', c.name === 'Deleted account' && c.email === `deleted-${CLIENT}@deleted.invalid` && c.status === 'deleted' && T('clients').find((x) => x.id === OTHER_CLIENT).name === 'Other Shop');
  ok('the site is marked deleting', T('presence_sites').find((s) => s.id === SITE).status === 'deleting' && T('presence_sites').find((s) => s.id === OTHER).status === 'live');
}

// ═══ B · done only when every step saved ═══
{
  seed();
  db.failMethod.set('presence_contacts', 'DELETE');
  const res = await runDeletionSweep(5);
  ok('a table that refuses: not completed, back to pending, and the step is named', res.completed === 0 && res.failed === 1 && deletion().status === 'pending' && /presence_contacts/.test(deletion().error), JSON.stringify(deletion()));
  ok('…the owner’s record isn’t anonymised yet (the run stopped there)', T('clients').find((x) => x.id === CLIENT).name === 'Bloom Salon');
  db.failMethod.delete('presence_contacts');
  const again = await runDeletionSweep(5);
  ok('…the next run repeats the steps and completes', again.completed === 1 && deletion().status === 'completed' && ERASE_TABLES.every((t) => !onSite(t, SITE).length));
}
{
  seed();
  db.failMethod.set('clients', 'PATCH');
  await runDeletionSweep(5);
  ok('the owner’s record that won’t anonymise: not completed (it used to be)', deletion().status === 'pending' && deletion().error === 'account: not anonymised', JSON.stringify(deletion()));
}
{
  seed();
  db.failMethod.set('contacts', 'PATCH');
  await runDeletionSweep(5);
  ok('the older contacts table that refuses: not completed (it used to be)', deletion().status === 'pending' && /^contacts: not anonymised/.test(deletion().error), JSON.stringify(deletion()));
}
{
  seed();
  listFails = true;
  await runDeletionSweep(5);
  ok('a store that can’t list the files: not completed, and no customer row went before its files', deletion().status === 'pending' && /^customer data on site .*: files in /.test(deletion().error) && ERASE_TABLES.every((t) => onSite(t, SITE).length === 1));
}
{
  seed();
  removeFails = true;
  await runDeletionSweep(5);
  ok('a store that refuses to remove them: the same', deletion().status === 'pending' && /files in /.test(deletion().error) && onSite('presence_contacts', SITE).length === 1);
}
{
  seed();
  db.failMethod.set('presence_sites', 'GET');
  await runDeletionSweep(5);
  ok('the sites that can’t be read are a failed step, never “no sites”', deletion().status === 'pending' && /^sites: /.test(deletion().error) && onSite('presence_contacts', SITE).length === 1);
}
{
  seed();
  db.failMethod.set('presence_account_deletions', 'PATCH');
  const res = await runDeletionSweep(5);
  ok('a run whose “completed” mark didn’t save isn’t counted as completed', res.completed === 0);
}

// ═══ C · the lists ═══
{
  ok('the erase never touches money: no invoice, payment or Stripe table', !ERASE_TABLES.some((t) => /invoice|payment|stripe|entitlement|change_events|^presence_publishes$/.test(t)));
  ok('the saved versions go after the two rows that point at them with no action', ERASE_TABLES.indexOf('presence_snapshots') > ERASE_TABLES.indexOf('presence_launches') && ERASE_TABLES.indexOf('presence_snapshots') > ERASE_TABLES.indexOf('presence_site_preview'));
  ok('a deal goes before the contacts it named, contacts after their imports', ERASE_TABLES.indexOf('presence_deals') < ERASE_TABLES.indexOf('presence_contacts') && ERASE_TABLES.indexOf('presence_contact_imports') < ERASE_TABLES.indexOf('presence_contacts'));
  ok('the folders: the media library, form files, note pictures', JSON.stringify(eraseFolders(SITE)) === JSON.stringify([SITE, `forms/${SITE}`, `comments/${SITE}`]));
  const priv = Deno.readTextFileSync(new URL('../../privacy.html', import.meta.url));
  ok('the privacy page promises what now happens: personal details anonymised, invoices kept', priv.includes('your personal details are anonymized') && priv.includes('invoices and payment records are retained'));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ CLOSING AN ACCOUNT (item 205): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
