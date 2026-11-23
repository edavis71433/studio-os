// ── What a studio keeps in its own hands on a client's site (builder item 387) ──
// A studio's client is the owner of their site record, so the server accepted their own
// sign-in for everything an owner may do: Publish, Take offline, the template, the domain,
// inviting people. The portal gives a client no door to the editor, and nothing turned them
// away if they opened its address. Now the studio decides, one client at a time: while
// "They can publish and run their website" is off (the default), only the studio does those
// things on that client's site. Everyone on the client's side can still edit the draft, as
// before (locked sections and custom code stay the studio's either way), and the studio
// publishes what they wrote. A business no studio looks after, the studio's own workspace,
// and the studio working inside a client's site are all exactly as they were.
//
// The switch lives on the studio's link to the client (presence_agency_clients,
// client_runs_site, migration 0265). Only the routes below read it, so no other request
// pays for the extra read.
import { svc } from './db.ts';
import { seatFilter } from './workspace.ts';

export type HeldPower = 'publish' | 'offline' | 'template' | 'domain' | 'people';

const LAUNCH_LIVE = /^\/launches\/[0-9a-f-]{36}\/(?:promote|rollback|schedule)$/;
const MEMBER_CHANGE = /^\/portal\/members\/[0-9a-f-]{36}\/(?:revoke|role)$/;

/** Which of the studio's powers a request asks for, or null for everything else. Reads
 *  never count: a client may always look. Pure. */
export function heldPowerOf(route: string, method: string): HeldPower | null {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return null;
  if (route === '/publish' || route === '/restore' || route === '/schedule' || route === '/preview/publish' || route === '/preview/promote' || route === '/site/coming-soon' || LAUNCH_LIVE.test(route)) return 'publish';
  if (route === '/site/offline' || route === '/site/online' || route === '/site/password') return 'offline';
  if (route === '/site/template') return 'template';
  if (route === '/foundations/domain' || route === '/foundations/domain/forward') return 'domain';
  if (route === '/portal/members' || MEMBER_CHANGE.test(route)) return 'people';
  return null;
}

const SAID: Record<HeldPower, string> = {
  publish: 'Your studio publishes this website, so nothing went live. Your changes are saved in the draft; ask your studio to publish them, or to let you publish yourself.',
  offline: 'Your studio looks after whether this website is online, so nothing changed. Ask your studio if it should go offline, come back, or have a password.',
  template: 'Your studio looks after this website’s design, so the template stayed as it was. Ask your studio if you’d like a different one.',
  domain: 'Your studio looks after this website’s address, so the domain stayed as it was. Ask your studio to change it.',
  people: 'Your studio looks after who works on this website, so nobody was added, changed or removed. Ask your studio to do it.',
};

/** The sentence a refused request answers with. Pure. */
export function heldSentence(power: HeldPower): string { return SAID[power]; }

export interface HoldRow { agency_id: string; client_runs_site?: boolean | null }

/** Does the studio hold this power from this caller? `link`: the site's active studio link
 *  (null when no studio looks after it); `studioMember`: the caller is on that studio's own
 *  team. Pure. */
export function studioHolds(link: HoldRow | null, studioMember: boolean): boolean {
  if (!link) return false;                    // no studio: the business runs its own site
  if (link.client_runs_site === true) return false;   // the studio switched it on for them
  return !studioMember;                       // the studio's own people are the studio
}

/** The answer for a request on `siteId` from someone on the client's side, or null when it
 *  may go ahead. An unreadable link refuses: a held power mustn't give way to a hiccup. */
export async function holdStop(siteId: string, power: HeldPower, who: { userId: string | null; email: string | null }): Promise<{ status: number; body: Record<string, unknown> } | null> {
  try {
    let r = await svc(`presence_agency_clients?site_id=eq.${siteId}&status=eq.active&select=agency_id,client_runs_site&limit=1`);
    // before migration 0265 the switch's column isn't there (400): every client reads as off
    if (r.status === 400) r = await svc(`presence_agency_clients?site_id=eq.${siteId}&status=eq.active&select=agency_id&limit=1`);
    if (!r.ok || !Array.isArray(r.json)) throw new Error('unread');
    const link = (r.json[0] || null) as HoldRow | null;
    if (!link || link.client_runs_site === true) return null;
    let member = false;
    const by = seatFilter(who);
    if (by) {
      const m = await svc(`presence_agency_members?agency_id=eq.${link.agency_id}&status=eq.active&${by}&select=id&limit=1`);
      if (!m.ok || !Array.isArray(m.json)) throw new Error('unread');
      member = m.json.length > 0;
    }
    if (!studioHolds(link, member)) return null;
    return { status: 403, body: { error: 'studio_holds', power, message: heldSentence(power) } };
  } catch {
    return { status: 503, body: { error: 'hold_unreadable', message: 'We couldn’t check with your studio just now, so nothing changed. Try again in a moment.' } };
  }
}
