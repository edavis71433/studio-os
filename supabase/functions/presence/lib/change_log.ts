// ── Changes: who changed what, and when (builder list item 215, Nov 2026) ──────
// Netlify keeps an audit log in sentences ("Site custom domain changed … by Eric Davis
// on Oct 23 at 6:07 PM"). Studio OS recorded every save, publish, invite and checkpoint
// but showed none of it, so "who changed my hours?" had no answer in the product. The
// Changes page answers it, for one site and for the whole studio, in sentences, from
// what is already kept:
//   presence_change_events  every save, with who and the names of the fields it touched
//   presence_publishes      every publish and restore, with who, and whether it went live
//   presence_site_members   who was invited, by whom, and who no longer has access
//   presence_launches       checkpoints, with who saved them
// Nothing new is asked of anyone. Values are never read (provenance keeps field names
// only), so a sentence says what changed ("the opening hours"), never to what.
// Everything here is pure: rows in, sentences out.

export type ChangeArea = 'website' | 'photos' | 'live' | 'people' | 'settings';
export const CHANGE_AREAS: ChangeArea[] = ['website', 'photos', 'live', 'people', 'settings'];
export const AREA_WORDS: Record<ChangeArea, string> = { website: 'Website', photos: 'Photos', live: 'Going live', people: 'People', settings: 'Settings' };

/** Who did it, as the viewer sees it. */
export type WhoSide = 'you' | 'studio' | 'owner' | 'seat' | 'support' | 'auto' | 'unknown';
export interface Person { name: string; email: string; side: 'studio' | 'owner' | 'seat' | 'support'; role?: string }

/** One kept record, from any of the four sources, before it is put in words. */
export interface RawChange {
  id: string; at: string; site_id: string;
  source: 'event' | 'publish' | 'member' | 'checkpoint';
  actor: string | null;                      // a sign-in id, an email, or null
  actor_kind?: string | null;                // client | staff | operator | system
  entity_type?: string; action?: string; summary?: string; fields?: string[]; entity_id?: string | null;
  kind?: string; status?: string; label?: string; unchanged?: boolean;   // a publish
  email?: string; role?: string; state?: 'invited' | 'removed';         // a seat
  name?: string;                                                         // a checkpoint
}

export interface ChangeItem {
  id: string; at: string; from: string | null; site_id: string;   // at: the newest save; from: a folded run's first
  area: ChangeArea;
  who: string;          // "Sam Lee", "You", "Studio OS"; '' when the record keeps no one
  who_note: string;     // "the owner", "staff", "from your studio"; '' when nothing is added
  side: WhoSide;
  text: string;         // "changed the opening hours"; a whole sentence when `who` is ''
  where: string;        // "Website › Hours and location"
  go: string | null;    // the page and place it opens, on the site's own pages
  count: number;        // saves folded into this line
  publish_id?: string;  // a publish that went live can show what went live
  key: string;          // what folds: the same person doing the same thing
}

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plainSummary = (s: string) => {
  const t = String(s || '').replace(/\s*→\s*/g, ' to ').replace(/\s+—\s+/g, ': ').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return t ? t.charAt(0).toLowerCase() + t.slice(1) : '';
};
/** "Mia Chen" from mia.chen@studio.example; '' when the address has nothing to go on. Pure. */
export function nameFromEmail(email: string): string {
  const local = lower(email).split('@')[0] || '';
  const words = local.split(/[._+-]+/).filter((w) => w && !/^\d+$/.test(w));
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
const listWords = (xs: string[]) => xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

// ── what a save touched, from the field names it kept ──
const IDENTITY: Record<string, string> = {
  business_name: 'the business name', tagline: 'the tagline', description: 'the business description', phone: 'the phone number',
  email: 'the email address', story: 'the About story', service_area: 'where they serve', booking_url: 'the booking link',
  ordering_url: 'the ordering link', seo_title: 'the title on Google', seo_description: 'the description on Google',
  short_description: 'the short description', social: 'the social links', website_url: 'the website address',
};
const LOCATION: Record<string, string> = {
  hours: 'the opening hours', holiday_exceptions: 'the holiday hours', address_line1: 'the address', address_line2: 'the address',
  city: 'the address', region: 'the address', postal_code: 'the address', country: 'the address', phone: 'the phone number',
  temporarily_closed: 'the temporarily closed notice', temporarily_closed_note: 'the temporarily closed notice', lat: 'the map pin', lng: 'the map pin',
};
const SETTINGS: Record<string, [string, ChangeArea]> = {
  blocks: ['the page sections', 'website'], pages: ['the pages', 'website'], nav: ['the menu', 'website'],
  sections_order: ['which sections show, and their order', 'website'], sections_hidden: ['which sections show, and their order', 'website'],
  announcement_text: ['the announcement bar', 'website'], announcement_url: ['the announcement bar', 'website'], announcement_expires_at: ['the announcement bar', 'website'],
  popup: ['the pop-up', 'website'], hero_layout: ['the top of the home page', 'website'], nav_style: ['how the menu looks', 'website'],
  footer_hours: ['the footer', 'website'], footer_social: ['the footer', 'website'], category_order: ['the order of the categories', 'website'],
  post_categories: ['the blog’s categories', 'website'], post_authors: ['the blog’s authors', 'website'],
  pages_noindex: ['which pages Google may show', 'website'], page_seo: ['how the pages read on Google', 'website'],
  logo_media_id: ['the logo', 'website'], cover_media_id: ['the cover photo', 'website'], og_media_id: ['the picture shown when the site is shared', 'website'],
  icon_media_id: ['the site icon', 'website'], theme_tokens: ['the colours and fonts', 'website'], template_slug: ['the site’s look', 'website'],
  industry_key: ['the kind of business', 'settings'], visit_counter: ['the visit counter', 'settings'],
  google_site_verification: ['the Google verification code', 'settings'], bing_site_verification: ['the Bing verification code', 'settings'],
  search_hidden: ['whether Google may list the site', 'settings'], llms_txt: ['the note for AI tools (llms.txt)', 'settings'],
  monitor_connection: ['the website address it watches', 'settings'], redirect: ['the forwarded addresses', 'settings'],
};
/** The words for an item of a kind: "menu item", "service". */
export interface Vocab { item: string; items: string; offeringsLabel: string }
export const DEFAULT_VOCAB: Vocab = { item: 'service', items: 'services', offeringsLabel: 'Services' };
const COLLECTION: Record<string, { one: (v: Vocab) => string; many: (v: Vocab) => string; where: (v: Vocab) => string; go: string }> = {
  offering: { one: (v) => v.item, many: (v) => v.items, where: (v) => `Website › ${v.offeringsLabel}`, go: '/presence.html#offerings' },
  testimonial: { one: () => 'review', many: () => 'reviews', where: () => 'Website › Reviews on the site', go: '/presence.html#testimonials' },
  faq: { one: () => 'question', many: () => 'questions', where: () => 'Website › Questions', go: '/presence.html#faqs' },
  post: { one: () => 'blog post', many: () => 'blog posts', where: () => 'Website › Blog', go: '/presence.html#updates' },
};
const VERB: Record<string, [string, string]> = {   // action → [one, more]
  create: ['added', 'added'], update: ['changed', 'changed'], delete: ['removed', 'removed'],
  hide: ['hid', 'hid'], show: ['showed again', 'showed again'], reorder: ['reordered', 'reordered'],
};

export interface Words { text: string; many?: (n: number) => string; area: ChangeArea; where: string; go: string | null; sig: string }

/** One save in words, or null when another source tells it better (a publish's own record)
 *  or it isn't a change to the site. `names` are current names for kept ids. Pure. */
export function describeEvent(r: RawChange, vocab: Vocab = DEFAULT_VOCAB, names: Map<string, string> = new Map()): Words | null {
  const et = String(r.entity_type || ''), action = String(r.action || ''), fields = (r.fields || []).map(String);
  const summary = String(r.summary || '');
  const said = plainSummary(summary);
  switch (et) {
    case 'identity': {
      const w = [...new Set(fields.map((f) => IDENTITY[f]).filter(Boolean))];
      const what = w.length && w.length <= 3 ? listWords(w) : 'the business details';
      return { text: `changed ${what}`, many: (n) => `changed ${what} ${n} times`, area: 'website', where: 'Website › Business details', go: '/presence.html#business', sig: `identity:${what}` };
    }
    case 'location': {
      const w = [...new Set(fields.map((f) => LOCATION[f]).filter(Boolean))];
      const what = w.length && w.length <= 3 ? listWords(w) : 'the hours and location';
      return { text: `changed ${what}`, many: (n) => `changed ${what} ${n} times`, area: 'website', where: 'Website › Hours and location', go: '/presence.html#business', sig: `location:${what}` };
    }
    case 'offering': case 'testimonial': case 'faq': case 'post': {
      const c = COLLECTION[et];
      // a blog post's own sentences ("Published a blog post") say more than the action
      if (et === 'post' && /blog post/i.test(summary)) return { text: said, area: 'website', where: c.where(vocab), go: c.go, sig: `post:${said}` };
      const verb = VERB[action] || VERB.update;
      const name = r.entity_id ? names.get(r.entity_id) : '';
      if (action === 'reorder') return { text: `reordered the ${c.many(vocab)}`, area: 'website', where: c.where(vocab), go: c.go, sig: `${et}:reorder` };
      const one = name ? `“${name}”` : `a ${c.one(vocab)}`;
      const priceOnly = et === 'offering' && action === 'update' && fields.length > 0 && fields.every((f) => f === 'price_text');
      const text = priceOnly && name ? `changed the price of ${one}` : `${verb[0]} ${one}`;
      return { text, many: (n) => `${verb[1]} ${n} ${c.many(vocab)}`, area: 'website', where: c.where(vocab), go: c.go, sig: `${et}:${action}` };
    }
    case 'media': {
      if (action === 'create' && /^added a photo$/i.test(summary.trim())) return { text: 'added a photo', many: (n) => `added ${n} photos`, area: 'photos', where: 'Files › Photos', go: '/files.html', sig: 'media:add' };
      if (action === 'delete' && /^removed a photo$/i.test(summary.trim())) return { text: 'removed a photo', many: (n) => `removed ${n} photos`, area: 'photos', where: 'Files › Photos', go: '/files.html', sig: 'media:remove' };
      // the file manager's own sentences ("Moved 3 files from …"); a code-like one ("File approve → approved") says less
      const coded = /^file \w+ to \w+$/i.test(said);
      return { text: coded ? 'changed a file' : said || 'changed a photo', many: (n) => coded || !said ? `changed ${n} files` : `${said} (${n} times)`, area: 'photos', where: 'Files', go: '/files.html', sig: `media:${coded ? 'coded' : said}` };
    }
    case 'settings': {
      if (said && !/^updated site settings$/i.test(summary.trim())) {
        // its own sentence ("Changed the site’s look to …", "Duplicated the “About” page as …")
        const area: ChangeArea = fields.some((f) => SETTINGS[f]?.[1] === 'settings') || /verif|connected website|disconnected website|edition set/i.test(summary) ? 'settings' : 'website';
        return { text: said, area, where: area === 'settings' ? 'Site settings' : 'Website', go: area === 'settings' ? '/settings.html' : '/presence.html#design', sig: `settings:${said}` };
      }
      const known = fields.filter((f) => SETTINGS[f]);
      const w = [...new Set(known.map((f) => SETTINGS[f][0]))];
      const area: ChangeArea = known.length && known.every((f) => SETTINGS[f][1] === 'settings') ? 'settings' : 'website';
      const what = w.length && w.length <= 3 ? listWords(w) : area === 'settings' ? 'the site settings' : 'the website';
      const where = what === 'the page sections' || what === 'the pages' ? 'Website › Pages' : what === 'the menu' ? 'Website › Menu' : area === 'settings' ? 'Site settings' : 'Website';
      return { text: `changed ${what}`, many: (n) => what === 'the page sections' ? `edited the page sections ${n} times` : `changed ${what} ${n} times`, area, where, go: area === 'settings' ? '/settings.html' : '/presence.html#design', sig: `settings:${what}` };
    }
    case 'redirect': return { text: said || 'changed the forwarded addresses', area: 'settings', where: 'Website › Old addresses', go: '/presence.html#search', sig: `redirect:${said}` };
    case 'voice': return { text: 'changed the writing voice', area: 'website', where: 'Website', go: null, sig: 'voice' };
    case 'domain': return { text: said || 'changed the domain', area: 'settings', where: 'Domain', go: '/presence.html#domain', sig: `domain:${said}` };
    case 'site': {
      if (!said) return null;
      if (/^provisioned/i.test(summary)) return { text: 'set up the website', area: 'settings', where: 'Website', go: null, sig: 'site:setup' };
      const status = summary.match(/^site status: (\w+) → (\w+)$/i);
      if (status) return { text: `changed the site from ${status[1]} to ${status[2]}`, area: 'settings', where: 'Site settings', go: null, sig: `site:${status[2]}` };
      const people = /hand(ing)? the site|owns the site|transfer|co-owner/i.test(summary);
      const notes = /review note|feedback|left a note/i.test(summary);
      return { text: said, area: people ? 'people' : notes ? 'website' : 'settings', where: people ? 'People' : notes ? 'Website › Notes' : 'Site settings', go: people ? '/sharing.html' : notes ? '/presence.html#design' : null, sig: `site:${said}` };
    }
    case 'publish':
      // a publish's own record (presence_publishes) tells it, with whether it went live;
      // naming a kept version is the one publish event that isn't a publish
      if (action === 'update' && said) return { text: said, area: 'live', where: 'Website › Versions', go: '/presence.html#history', sig: `publish:${said}` };
      return null;
    case 'restore':
      // restores that went live are publishes; these are restores into the draft
      if (action === 'restore' && /restored the version from|brought the website back online|rolled back launch|instant restore/i.test(summary)) return null;
      return { text: said || 'brought an earlier version into the draft', area: 'website', where: 'Website › Versions', go: '/presence.html#history', sig: `restore:${said}` };
    case 'launch':
      return null;   // checkpoints are read from presence_launches
    default:
      return said ? { text: said, area: 'settings', where: 'Website', go: null, sig: `${et}:${said}` } : null;
  }
}

/** "2 settings changes, 1 photos change" (a publish's kept summary) as a count. Pure. */
export function countFromSummary(summary: string): number | null {
  const m = String(summary || '').match(/(\d+)\s+[a-z ]+?changes?\b/gi);
  if (!m) return null;
  return m.reduce((a, x) => a + (Number(x.match(/\d+/)?.[0]) || 0), 0);
}

/** A publish or restore in words. A skipped publish (nothing had changed) says nothing. Pure. */
export function describePublish(r: RawChange): Words | null {
  if (r.unchanged) return null;
  const n = countFromSummary(r.summary || '');
  const label = String(r.label || '').trim();
  if (r.status === 'failed') return { text: r.kind === 'restore' ? 'tried to restore an earlier version; it didn’t go live' : 'tried to publish; it didn’t go live', area: 'live', where: 'Website › Versions', go: '/presence.html#history', sig: `fail:${r.id}` };
  if (r.status !== 'live') return null;   // still on its way; the next read tells it
  if (r.kind === 'restore') {
    const said = plainSummary(r.summary || '');
    return { text: said && /^restored|^brought|^rolled/i.test(said) ? `${said}, and it went live` : 'put an earlier version back live', area: 'live', where: 'Website › Versions', go: '/presence.html#history', sig: `restore:${r.id}` };
  }
  const what = n ? `${n} change${n === 1 ? '' : 's'} went live` : 'the changes went live';
  return { text: `published the site${label ? ` as “${label}”` : ''}. ${what.charAt(0).toUpperCase()}${what.slice(1)}`, area: 'live', where: 'Website › Versions', go: '/presence.html#history', sig: `publish:${r.id}` };
}

const ROLE_WORDS: Record<string, string> = { business_owner: 'a Co-owner', business_staff: 'Staff', developer: 'a Developer', client_reviewer: 'a Reviewer', designer: 'a Designer' };
const SEAT_NOTE: Record<string, string> = { business_owner: 'co-owner', business_staff: 'staff', developer: 'developer', client_reviewer: 'reviewer', designer: 'designer' };

/** Who did it, from the kept sign-in id or email, as the viewer reads it. Pure. */
export function whoOf(r: RawChange, i: { viewer: string | null; viewerSide: 'studio' | 'client'; people: Map<string, Person>; ownerOf?: Map<string, Person> }): { who: string; who_note: string; side: WhoSide; key: string } {
  const a = lower(r.actor);
  if (!a || r.actor_kind === 'system' || !UUID.test(a) && !a.includes('@') && a !== 'owner') return { who: 'Studio OS', who_note: '', side: 'auto', key: 'auto' };
  if (i.viewer && a === lower(i.viewer)) return { who: 'You', who_note: '', side: 'you', key: `p:${a}` };
  const p = a === 'owner' ? i.ownerOf?.get(r.site_id) : i.people.get(a);
  if (p) {
    const name = p.name || nameFromEmail(p.email) || p.email;
    if (p.side === 'studio') return { who: name, who_note: i.viewerSide === 'studio' ? '' : 'from your studio', side: 'studio', key: `p:${lower(p.email) || a}` };
    if (p.side === 'owner') return { who: name, who_note: 'the owner', side: 'owner', key: `p:${lower(p.email) || a}` };
    if (p.side === 'seat') return { who: name, who_note: SEAT_NOTE[p.role || ''] || '', side: 'seat', key: `p:${lower(p.email) || a}` };
    return { who: name, who_note: 'Studio OS support', side: 'support', key: `p:${lower(p.email) || a}` };
  }
  // a sign-in nobody here knows any more: said by the side the record keeps
  if (r.actor_kind === 'operator') return { who: i.viewerSide === 'studio' ? 'Someone at your studio' : 'Your studio', who_note: '', side: 'studio', key: `k:operator:${a}` };
  if (r.actor_kind === 'staff') return { who: 'Studio OS support', who_note: '', side: 'support', key: `k:staff:${a}` };
  return { who: i.viewerSide === 'studio' ? 'Someone on the client’s side' : 'Someone on your team', who_note: '', side: 'unknown', key: `k:client:${a}` };
}

/** Every record in words, newest first, a run of the same thing by the same person folded
 *  into one line ("added 4 photos"). `canPeople` keeps the People lines for those who may
 *  manage who has access. Pure. */
export const FOLD_MS = 30 * 60_000;
export function changeItems(rows: RawChange[], i: { viewer: string | null; viewerSide: 'studio' | 'client'; people: Map<string, Person>; ownerOf?: Map<string, Person>; vocab?: (siteId: string) => Vocab; names?: Map<string, string>; canPeople: boolean }): ChangeItem[] {
  const sorted = rows.slice().sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const out: ChangeItem[] = [];
  for (const r of sorted) {
    let w: Words | null = null;
    let who = whoOf(r, i);
    if (r.source === 'event') w = describeEvent(r, i.vocab ? i.vocab(r.site_id) : DEFAULT_VOCAB, i.names);
    else if (r.source === 'publish') w = describePublish(r);
    else if (r.source === 'checkpoint') w = { text: `saved a checkpoint${r.name ? ` “${r.name}”` : ''}`, area: 'website', where: 'Website › Versions', go: '/presence.html#history', sig: `checkpoint:${r.id}` };
    else if (r.source === 'member') {
      const role = ROLE_WORDS[r.role || ''] || 'a member';
      if (r.state === 'removed') {
        // the record keeps no one for a removal: said without a who, never a guess
        w = { text: `${r.email || 'Someone'} no longer has access`, area: 'people', where: 'People', go: '/sharing.html', sig: `member:off:${r.id}` };
        who = { who: '', who_note: '', side: 'unknown', key: `member:${r.id}` };
      } else w = { text: `invited ${r.email || 'someone'} as ${role}`, many: (n) => `invited ${n} people`, area: 'people', where: 'People', go: '/sharing.html', sig: 'member:invite' };
    }
    if (!w) continue;
    if (w.area === 'people' && !i.canPeople) continue;
    const prev = out[out.length - 1];
    const key = `${r.site_id}|${who.key}|${w.sig}`;
    // a run folds while each save follows the last within half an hour
    if (prev && prev.key === key && w.many && Date.parse(prev.from || prev.at) - Date.parse(r.at) <= FOLD_MS) {
      prev.count += 1; prev.from = r.at;
      prev.text = w.many(prev.count);
      continue;
    }
    out.push({ id: `${r.source}:${r.id}`, at: r.at, from: null, site_id: r.site_id, area: w.area, who: who.who, who_note: who.who_note, side: who.side, text: w.text, where: w.where, go: w.go, count: 1, key, ...(r.source === 'publish' && r.status === 'live' && !r.unchanged ? { publish_id: r.id } : {}) });
  }
  return out;
}

/** Which side a line is on for the band and the Who filter: the viewer's own lines ("You")
 *  are on the viewer's side. Pure. */
export function sideOf(s: WhoSide, viewerSide: 'studio' | 'client' = 'studio'): 'studio' | 'client' | 'auto' {
  if (s === 'auto') return 'auto';
  if (s === 'you') return viewerSide;
  return s === 'studio' || s === 'support' ? 'studio' : 'client';
}

/** The band's numbers: changes in the window by who made them (the studio, the client's
 *  side, Studio OS by itself), the people by name, what went live, and per day. Pure. */
export function changeSummary(items: ChangeItem[], days: string[], dayOf: (iso: string) => string, viewerSide: 'studio' | 'client' = 'studio'): {
  total: number; went_live: number; by_side: { studio: number; client: number; auto: number };
  people: Array<{ who: string; who_note: string; side: WhoSide; count: number }>;
  days: Array<{ day: string; studio: number; client: number; auto: number }>;
  sites: Array<{ site_id: string; count: number }>;
} {
  const side = (s: WhoSide) => sideOf(s, viewerSide);
  const by = { studio: 0, client: 0, auto: 0 };
  const people = new Map<string, { who: string; who_note: string; side: WhoSide; count: number }>();
  const perDay = new Map(days.map((d) => [d, { day: d, studio: 0, client: 0, auto: 0 }]));
  const perSite = new Map<string, number>();
  let total = 0, live = 0;
  for (const it of items) {
    if (!it.who) continue;   // a line the record keeps no one for (a removal) is no one's change to count
    const n = it.count;
    total += n;
    if (it.publish_id) live += 1;
    by[side(it.side)] += n;
    const k = it.side === 'auto' ? 'auto' : `${it.who}|${it.who_note}`;
    if (it.who) { const p = people.get(k) || { who: it.who, who_note: it.who_note, side: it.side, count: 0 }; p.count += n; people.set(k, p); }
    const d = perDay.get(dayOf(it.at)); if (d) d[side(it.side)] += n;
    perSite.set(it.site_id, (perSite.get(it.site_id) || 0) + n);
  }
  return {
    total, went_live: live, by_side: by,
    people: [...people.values()].sort((a, b) => b.count - a.count || a.who.localeCompare(b.who)),
    days: [...perDay.values()],
    sites: [...perSite.entries()].map(([site_id, count]) => ({ site_id, count })).sort((a, b) => b.count - a.count),
  };
}
