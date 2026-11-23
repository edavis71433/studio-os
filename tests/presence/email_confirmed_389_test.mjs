// ── Builder item 389: an email address nobody proved is never matched to anything ──
//   deno run --allow-read --allow-env --allow-net tests/presence/email_confirmed_389_test.mjs
// The server matches a signed-in person to a client record, a site seat or a studio seat by
// their email address. It never checked the address was confirmed, so everything rested on
// two Supabase switches written down nowhere (Nov 22 2026 review, file 07 finding 6). Now:
//   1  emailConfirmed / provenEmail: only a real confirmation time counts
//   2  a client owner, a site seat, a studio seat: matched by email once proved, never before
//   3  what still works: someone who used their invite link, a seat that knows their user id,
//      the platform's staff (by user id), the studio's own sign-in
//   4  the filters quote the address, so a comma or a bracket can't widen them (item 397)
import { installFakePostgrest } from './fake_pgrst.mjs';

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const AT = '2026-11-01T09:00:00Z';
const U = { owner: uuid('1'), stranger: uuid('2'), seat: uuid('3'), seatStranger: uuid('4'), knownSeat: uuid('5'), staff: uuid('6'), studio: uuid('7'), studioStranger: uuid('8'), invited: uuid('9'), contact: uuid('a'), sneaky: uuid('b') };
const USERS = {
  'jwt-owner': { id: U.owner, email: 'Owner@Bakery.example', email_confirmed_at: AT },
  'jwt-owner-unproved': { id: U.stranger, email: 'owner@bakery.example', email_confirmed_at: null },
  'jwt-seat': { id: U.seat, email: 'helper@bakery.example', email_confirmed_at: AT },
  'jwt-seat-unproved': { id: U.seatStranger, email: 'helper@bakery.example', email_confirmed_at: null },
  'jwt-known-seat': { id: U.knownSeat, email: 'known@bakery.example', email_confirmed_at: '' },
  'jwt-staff': { id: U.staff, email: 'ops@platform.example', email_confirmed_at: null },
  'jwt-studio': { id: U.studio, email: 'lead@studio.example', email_confirmed_at: AT },
  'jwt-studio-unproved': { id: U.studioStranger, email: 'lead@studio.example', email_confirmed_at: 'not a date' },
  'jwt-invited': { id: U.invited, email: 'new@bakery.example', invited_at: '2026-11-20T08:00:00Z', email_confirmed_at: '2026-11-20T08:05:00Z' },
  'jwt-contact': { id: U.contact, email: 'unproved@bakery.example', email_confirmed_at: null },
  'jwt-sneaky': { id: U.sneaky, email: 'x@evil.example),email.neq.(none', email_confirmed_at: AT },
};
const db = installFakePostgrest({ users: USERS });
const CLIENT = uuid('c'), SITE = uuid('d'), AGENCY = uuid('e'), CONTACT = uuid('f');
db.tables.memberships = [{ user_id: U.staff, tenant_id: 'tenant-1', role: 'owner' }];
db.tables.clients = [
  { id: CLIENT, email: 'owner@bakery.example', contact_email: null, tenant_id: 'tenant-1' },
  { id: uuid('0'), email: 'linked@bakery.example', contact_id: CONTACT, tenant_id: 'tenant-1' },
];
db.tables.contacts = [{ id: CONTACT, auth_user_id: U.contact }];
db.tables.presence_site_members = [
  { id: uuid('2'), site_id: SITE, email: 'helper@bakery.example', user_id: null, role: 'business_staff', status: 'active', created_at: AT },
  { id: uuid('3'), site_id: SITE, email: 'known@bakery.example', user_id: U.knownSeat, role: 'designer', status: 'active', created_at: AT },
  { id: uuid('4'), site_id: SITE, email: 'new@bakery.example', user_id: null, role: 'client_reviewer', status: 'active', created_at: AT },
];
db.tables.presence_agencies = [{ id: AGENCY, name: 'Studio', status: 'active', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} }];
db.tables.presence_agency_members = [{ id: uuid('5'), agency_id: AGENCY, email: 'lead@studio.example', user_id: null, role: 'owner', status: 'active' }];

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const A = await import('../../supabase/functions/_shared/auth.ts');
const { resolveAgencyMember } = await import('../../supabase/functions/presence/agency/auth.ts');
const { seatFilter } = await import('../../supabase/functions/presence/lib/workspace.ts');
const who = async (jwt) => { A.forgetWhoAsks(); return await A.resolvePrincipal(new Request('http://x/', { headers: { 'x-dds-user-jwt': jwt } }), null); };

// ═══ 1. only a real confirmation counts ═══
ok('a confirmation time counts', A.emailConfirmed({ email_confirmed_at: AT }));
ok('none, null, empty, spaces or not a date: unproved', [{}, { email_confirmed_at: null }, { email_confirmed_at: '' }, { email_confirmed_at: '  ' }, { email_confirmed_at: 'not a date' }, { email_confirmed_at: 1730000000 }, null].every((u) => !A.emailConfirmed(u)));
ok('provenEmail: lower-case once proved, empty before', A.provenEmail(USERS['jwt-owner']) === 'owner@bakery.example' && A.provenEmail(USERS['jwt-owner-unproved']) === '');

// ═══ 2. matched by email once proved, never before ═══
{
  const owner = await who('jwt-owner');
  ok('a client owner who proved the address: the client', owner.kind === 'client' && owner.email === 'owner@bakery.example');
  const stranger = await who('jwt-owner-unproved');
  ok('the same address, never proved: signed in as nobody (not the client), no email carried on', stranger.kind === 'public' && stranger.userId === U.stranger && stranger.email === null);
  const seat = await who('jwt-seat');
  ok('a seat by email, proved: a client-side seat', seat.kind === 'client' && seat.email === 'helper@bakery.example');
  const seatStranger = await who('jwt-seat-unproved');
  ok('the seat\'s address, never proved: nobody', seatStranger.kind === 'public' && seatStranger.email === null);
  ok('…and the seat lookup it would make leaves the email out entirely', seatFilter({ userId: U.seatStranger, email: seatStranger.email }) === `or=(user_id.eq.${U.seatStranger})`);
  const studio = await resolveAgencyMember('jwt-studio');
  ok('a studio member invited by email, proved: the studio seat (and its user id is learned)', studio?.agency_id === AGENCY && db.tables.presence_agency_members[0].user_id === U.studio);
  db.tables.presence_agency_members[0].user_id = null;
  ok('the studio seat\'s address, never proved: no studio seat', (await resolveAgencyMember('jwt-studio-unproved')) === null);
}

// ═══ 3. what still works ═══
{
  const invited = await who('jwt-invited');
  ok('someone who used their invite link (Supabase confirmed them): their seat', invited.kind === 'client' && invited.email === 'new@bakery.example');
  const known = await who('jwt-known-seat');
  ok('a seat that already knows their user id still finds them, address proved or not', known.kind === 'client' && known.email === null);
  const contact = await who('jwt-contact');
  ok('a client linked to their user id through a contact still finds them', contact.kind === 'client' && contact.email === null);
  const staff = await who('jwt-staff');
  ok('the platform\'s staff are found by user id, as before', staff.kind === 'staff' && staff.role === 'owner');
  db.tables.presence_agency_members[0].user_id = U.studio;
  ok('the studio\'s own sign-in, once its user id is known, is found by it', (await resolveAgencyMember('jwt-studio'))?.agency_id === AGENCY);
}

// ═══ 4. the filters quote the address ═══
{
  const sneaky = await who('jwt-sneaky');
  ok('an address made to break out of the filter matches nobody', sneaky.kind === 'public');
  const asked = db.log.filter((l) => l.url.includes('clients?or=') && l.url.includes('evil'));
  ok('…because it went to the database inside quotes, as one value', asked.length > 0 && asked.every((l) => l.url.includes('email.eq."x@evil.example),email.neq.(none"')), asked.map((l) => l.url).join(' | '));
  ok('orValue escapes a quote and a backslash inside the value', decodeURIComponent(A.orValue('a"b\\c')) === '"a\\"b\\\\c"');
  ok('seatFilter: nothing to match by, no filter at all', seatFilter({ userId: null, email: null }) === null);
}

const passed = results.filter(Boolean).length;
console.log(`\n════ CONFIRMED EMAIL, ITEM 389: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
