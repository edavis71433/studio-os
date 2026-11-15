// ── "Ask for access" on a domain (builder list item 222, Nov 12 review, file 04, finding 2) ──
// A studio that needs to change a client's DNS records used to get the client's registrar
// password, or did it on a call. Every big company lets an owner invite someone to look
// after a domain without sharing the password; most can limit it to the records. The studio
// presses Ask for access on the domain's panel, the client gets that company's own steps by
// email, and the ask waits on the panel until someone ticks "It arrived".
//
// The steps below were read from each company's own help pages on Nov 15 2026. Where a
// company has no records-only level, the email says what the access also allows; where it
// has no way to share access at all (Hover), or only through a partner programme or IAM
// (IONOS, Amazon), the studio is told to send the records instead.
// Pure: the routes (agency/sites.ts) do the reads, the send and the writes.
import { providerGuide } from './rdap.ts';

export interface AccessGuide {
  company: string;      // as lib/rdap.ts names it
  called: string;       // what the company calls sharing access
  sign_in: string;      // where step 1 starts
  asks: 'email' | 'username';   // Porkbun invites a Porkbun username, not an email
  steps: string[];      // {domain} {invite} {studio}
  exact: boolean;       // it can be limited to the records
  caveat: string;       // what else the access allows, told to the client; '' when nothing
  studio_note: string;  // for the studio, in the sheet: what accepting needs
  shareable: boolean;   // false: send the records instead
}

const G = (g: AccessGuide) => g;
export const ACCESS_GUIDES: AccessGuide[] = [
  G({ company: 'GoDaddy', called: 'Delegate Access', sign_in: 'https://account.godaddy.com/access', asks: 'email', exact: true, shareable: true, caveat: '',
    steps: ['Sign in to GoDaddy and open Delegate Access, under your account settings.', 'Under “People who can access my account”, press Invite to Access.', 'Type {studio} and {invite}, choose “Domains Only”, and press Invite.', 'Once we accept, open Domain Portfolio, then the folder icon, All Domains and Edit Folder. Leave “Management Access” on, turn “Transfer Access” off, and save.'],
    studio_note: 'Needs a GoDaddy account at this address; the invitation lasts about two days. If the domain has Domain Protection, each record change asks the client for a code.' }),
  G({ company: 'Namecheap', called: 'Share Access', sign_in: 'https://ap.www.namecheap.com/domains/list/', asks: 'email', exact: true, shareable: true, caveat: '',
    steps: ['Sign in to Namecheap and open Domain List.', 'Press Manage next to {domain}, then open Sharing & Transfer.', 'Under Share Access, type {invite} as the New Manager and press Add.', 'Pick “Give manager some permissions”, untick everything, then tick only “Manage Host Records”.', 'Type your own Namecheap password to confirm.'],
    studio_note: 'Needs a Namecheap account at this address, and the invitation must be accepted within 7 days.' }),
  G({ company: 'Cloudflare', called: 'Members', sign_in: 'https://dash.cloudflare.com/', asks: 'email', exact: true, shareable: true, caveat: '',
    steps: ['Sign in to Cloudflare and open Manage Account, then Members.', 'Press Invite and type {invite}.', 'Add a permission for {domain} only, with the role “Domain DNS”, then send the invitation.'],
    studio_note: 'Needs a Cloudflare login at this address. Only an account’s Super Administrator can invite.' }),
  G({ company: 'Squarespace Domains', called: 'Domain manager', sign_in: 'https://account.squarespace.com/domains', asks: 'email', exact: false, shareable: true,
    caveat: 'Squarespace has one level for this. A domain manager can change the records, and could also move the domain to another company, so take our access away once we’re done.',
    steps: ['Sign in to Squarespace and open Domains, then {domain}.', 'Open Permissions and press Invite domain manager.', 'Type {studio} and {invite}, and send the invitation.'],
    studio_note: 'Squarespace has no records-only level. Needs a free Squarespace account at this address.' }),
  G({ company: 'Porkbun', called: 'Authorized Users', sign_in: 'https://porkbun.com/account/domainsSpeedy', asks: 'username', exact: false, shareable: true,
    caveat: 'Porkbun shares the whole account, and an authorized user could buy with your saved card, though never move or transfer the domain. Take our access away once we’re done.',
    steps: ['Sign in to Porkbun, open the Account menu, then Authorized Users.', 'Type our Porkbun username, {invite}, and press Submit.'],
    studio_note: 'Porkbun invites a Porkbun username, not an email, and both accounts need two-step sign-in.' }),
  G({ company: 'Wix', called: 'Roles & Permissions', sign_in: 'https://manage.wix.com/account/sites', asks: 'email', exact: true, shareable: true, caveat: '',
    steps: ['Sign in to Wix and open your site’s dashboard, then Settings, then Roles & Permissions.', 'Press Invite Collaborators and type {invite}.', 'Tick “Domain Manager” and press Send Invites.'],
    studio_note: 'Needs a free Wix account; the invitation lasts 30 days. Records can be changed only while the domain uses Wix’s nameservers.' }),
  G({ company: 'Network Solutions', called: 'Users & Roles', sign_in: 'https://www.networksolutions.com/my-account/login', asks: 'email', exact: true, shareable: true, caveat: '',
    steps: ['Sign in to Network Solutions, open the menu by your name, then Users & Roles.', 'Press Add User and type {studio} and {invite}.', 'Choose the role “Tech” and press Invite.'],
    studio_note: 'Needs a Network Solutions User ID at this address.' }),
  G({ company: 'DNSimple', called: 'Domain Access Control', sign_in: 'https://dnsimple.com/login', asks: 'email', exact: true, shareable: true, caveat: '',
    steps: ['Sign in to DNSimple, open the gear by your account name, then Members and seats.', 'Press Invite, type {invite}, and choose Limited Access.', 'Open {domain}, then its Access Control tab, and make us a Zone Operator.'],
    studio_note: 'Members need the client’s DNSimple Teams plan or higher, and a seat costs extra there.' }),
  G({ company: 'DigitalOcean', called: 'Teams', sign_in: 'https://cloud.digitalocean.com/login', asks: 'email', exact: true, shareable: true, caveat: '',
    steps: ['Sign in to DigitalOcean and open Settings, then Role Access.', 'Create a custom role with domain read, create and update, and save it.', 'Open Settings, then Invite Members, type {invite} with that role, and send.'],
    studio_note: 'DigitalOcean only runs the records; renewal stays where the name was bought.' }),
  G({ company: 'IONOS', called: 'Agency Partner Program', sign_in: 'https://my.ionos.com/', asks: 'email', exact: false, shareable: false, caveat: '', steps: [],
    studio_note: 'IONOS shares access only through its free Agency Partner Program: join it and send the request from its Partner Portal. Or send the client the records to add.' }),
  G({ company: 'Amazon Route 53', called: 'AWS IAM', sign_in: 'https://console.aws.amazon.com/route53/', asks: 'email', exact: false, shareable: false, caveat: '', steps: [],
    studio_note: 'Route 53 shares access through AWS IAM with a custom policy, which is a job for the client’s AWS person. Or send the client the records to add.' }),
  G({ company: 'Hover', called: '', sign_in: 'https://www.hover.com/signin', asks: 'email', exact: false, shareable: false, caveat: '', steps: [],
    studio_note: 'Hover has no way to share access. Send the client the records to add instead.' }),
];

/** Any company we have no steps for. */
export const OTHER_COMPANY = 'Another company';
export const GENERIC_GUIDE: AccessGuide = {
  company: OTHER_COMPANY, called: '', sign_in: '', asks: 'email', exact: false, shareable: true, caveat: '',
  steps: ['Sign in where {domain}’s settings are kept: usually the company you bought it from.', 'Look in your account settings for “share access”, “delegate access”, “users” or “team members”.', 'Invite {invite}, and if it asks what we may do, choose the DNS records only.'],
  studio_note: 'We don’t have this company’s steps, so the message asks the client to look for sharing in their account.',
};

/** The guide for a company by any of its names (a registrar, a DNS company, a nameserver),
 *  or the general one. Pure. */
export function accessGuide(name: string | null | undefined): AccessGuide {
  const n = String(name || '').trim();
  if (!n || n === OTHER_COMPANY) return GENERIC_GUIDE;
  const exact = ACCESS_GUIDES.find((g) => g.company.toLowerCase() === n.toLowerCase());
  if (exact) return exact;
  const known = providerGuide(n);
  return (known && ACCESS_GUIDES.find((g) => g.company === known.company)) || GENERIC_GUIDE;
}

/** The companies the sheet offers, the one found first. Pure. */
export function accessCompanies(found: string | null | undefined): string[] {
  const first = found ? accessGuide(found).company : '';
  const rest = ACCESS_GUIDES.map((g) => g.company).filter((c) => c !== first);
  return [...(first && first !== OTHER_COMPANY ? [first] : []), ...rest, OTHER_COMPANY];
}

/** The first word of a person's name, for "Hi Dana,". Null for none. Pure. */
export function firstWord(name: unknown): string | null {
  const w = String(name ?? '').replace(/[^\p{L}\p{M}' -]+/gu, ' ').trim().split(/\s+/)[0] || '';
  return w.length >= 2 ? w.slice(0, 40) : null;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fill = (s: string, v: { domain: string; invite: string; studio: string }) => s.replaceAll('{domain}', v.domain).replaceAll('{invite}', v.invite).replaceAll('{studio}', v.studio);

/** Is this what an invite field holds? An email, or for Porkbun a username. Pure. */
export function cleanInvite(raw: unknown, asks: AccessGuide['asks']): string | null {
  const v = String(raw ?? '').trim();
  if (asks === 'username') return /^[A-Za-z0-9_.-]{2,40}$/.test(v) ? v : null;
  return /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[A-Za-z]{2,}$/.test(v) ? v.toLowerCase() : null;
}

/** The email the client gets: their company's steps, what the access allows, that they keep
 *  their password and can take it away. `connected`: the domain already shows the site, so
 *  this is looking after it rather than finishing the connection. Pure. */
export function accessEmail(o: { domain: string; company: string; invite: string; studio: string; firstName?: string | null; note?: string | null; connected?: boolean }): { subject: string; html: string; text: string; steps: string[] } {
  const g = accessGuide(o.company);
  const v = { domain: o.domain, invite: o.invite, studio: o.studio };
  const steps = g.steps.map((s) => fill(s, v));
  const at = g === GENERIC_GUIDE ? '' : ` at ${g.company}`;
  const why = o.connected ? `So we can look after ${o.domain}’s DNS records for you, we need access to them${at}.` : `To finish connecting ${o.domain} to your new website, we need to change its DNS records${at}.`;
  const lead = `${why} You can give us access to just the records, without sharing your password:`;
  const keep = `You keep your password, your account and the right to renew or move the domain. You can take our access away any time${g === GENERIC_GUIDE ? '' : `, on the same ${g.company} page`}.`;
  const after = g === GENERIC_GUIDE ? 'Can’t find it? Reply to this email and we’ll send you the records to add yourself instead.' : `That’s it. ${g.company} sends us an invitation, and we take it from there.`;
  const hi = o.firstName ? `Hi ${o.firstName},` : 'Hello,';
  const note = String(o.note || '').trim().slice(0, 300);
  const subject = `Give ${o.studio} access to ${o.domain}’s records`;
  const html = `<p>${esc(hi)}</p><p>${esc(lead)}</p>` +
    `<ol>${steps.map((s) => `<li style="margin:0 0 8px">${esc(s)}</li>`).join('')}</ol>` +
    `<p>${esc(after)}</p>` +
    (g.sign_in ? `<p><a href="${esc(g.sign_in)}">Sign in to ${esc(g.company)}</a></p>` : '') +
    (g.caveat ? `<p>${esc(g.caveat)}</p>` : '') +
    `<p style="background:#eef7f1;border-radius:10px;padding:12px 14px;color:#1d4f37">${esc(keep)}</p>` +
    (note ? `<p>${esc(note)}</p>` : '') +
    `<p>${esc(o.studio)}</p>`;
  const text = [hi, '', lead, '', ...steps.map((s, i) => `${i + 1}. ${s}`), '', after, ...(g.sign_in ? ['', `Sign in to ${g.company}: ${g.sign_in}`] : []), ...(g.caveat ? ['', g.caveat] : []), '', keep, ...(note ? ['', note] : []), '', o.studio].join('\n');
  return { subject, html, text, steps };
}

// ── the ask, as kept on the client's site (reserved row __domain_access__) ──
export interface DomainAccess { domain: string; status: 'asked' | 'arrived'; company: string; invite: string; to: string; asked_at: string | null; last_asked_at: string | null; asks: number; asked_by: string | null; arrived_at: string | null; arrived_by: string | null }
const iso = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** The ask for this domain, cleaned, or null: nothing asked, or it was for a domain the site
 *  no longer has (a changed domain starts again). Pure. */
export function normalizeAccess(raw: unknown, domain: string | null | undefined): DomainAccess | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = String(domain || '').toLowerCase();
  if (!d || String(r.domain || '').toLowerCase() !== d) return null;
  const status = r.status === 'arrived' ? 'arrived' : r.status === 'asked' ? 'asked' : null;
  if (!status) return null;
  return {
    domain: d, status, company: str(r.company, 60), invite: str(r.invite, 120), to: str(r.to, 200),
    asked_at: iso(r.asked_at), last_asked_at: iso(r.last_asked_at), asks: Math.max(0, Math.min(99, Number(r.asks) || 0)),
    asked_by: str(r.asked_by, 120) || null, arrived_at: iso(r.arrived_at), arrived_by: str(r.arrived_by, 120) || null,
  };
}

/** After a send: asked (again), keeping when it was first asked. Pure. */
export function askedAccess(cur: DomainAccess | null, o: { domain: string; company: string; invite: string; to: string; by: string; now: string }): DomainAccess {
  const again = cur && cur.status === 'asked' ? cur : null;
  return { domain: o.domain.toLowerCase(), status: 'asked', company: o.company, invite: o.invite, to: o.to, asked_at: again?.asked_at || o.now, last_asked_at: o.now, asks: (again?.asks || 0) + 1, asked_by: again?.asked_by || o.by, arrived_at: null, arrived_by: null };
}

/** Ticked off: it arrived (asked or not: "We already have it"). Undo goes back to waiting
 *  when it had been asked, else to nothing. Pure. */
export function tickAccess(cur: DomainAccess | null, o: { domain: string; arrived: boolean; by: string; now: string }): DomainAccess | null {
  if (o.arrived) return { ...(cur || { domain: o.domain.toLowerCase(), company: '', invite: '', to: '', asked_at: null, last_asked_at: null, asks: 0, asked_by: null }), status: 'arrived', arrived_at: o.now, arrived_by: o.by } as DomainAccess;
  return cur && cur.asked_at ? { ...cur, status: 'asked', arrived_at: null, arrived_by: null } : null;
}

/** The row on the Domains list: the pill under the name. Pure. */
export function accessBadge(a: DomainAccess | null): { status: 'asked' | 'arrived'; since: string | null } | null {
  return a ? { status: a.status, since: a.status === 'arrived' ? a.arrived_at : a.asked_at } : null;
}
