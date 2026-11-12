// ── The change-sentence engine (reconciliation R2) ──────────────────────────
// ONE engine explains what will change: the publish sheet, the draft pill,
// and history summaries all speak through it. Sentences are computed at read
// time by diffing the draft snapshot against the live snapshot — NEVER from
// provenance (which stores field names only, by contract G1 §14).
import { normalizeSnapshotContent } from './render_types.ts';
import type { HoursDay, SnapshotContent } from './render_types.ts';

export interface Change {
  section: 'business' | 'offerings' | 'faqs' | 'testimonials' | 'updates' | 'media' | 'site';
  sentence: string;
  entity_id?: string;
}

export interface ChangeSet { count: number; changes: Change[]; first_publish: boolean }

const DAY: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

function fmtT(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const am = h < 12 || h === 24; const hr = ((h + 11) % 12) + 1;
  return `${hr}${m ? ':' + String(m).padStart(2, '0') : ''}${am ? 'am' : 'pm'}`;
}
const dayText = (d: HoursDay | undefined): string =>
  !d || d.closed || !d.intervals?.length ? 'Closed' : d.intervals.map((i) => `${fmtT(i.open)}–${fmtT(i.close)}`).join(', ');
const q = (s: string, max = 48): string => `“${s.length > max ? s.slice(0, max - 1) + '…' : s}”`;
const jeq = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// a map whose keys were saved in another order is the same map
const sortedKeys = (o: Record<string, unknown>): Array<[string, string]> => Object.keys(o).sort().map((k) => [k, JSON.stringify(o[k] && typeof o[k] === 'object' ? Object.fromEntries(Object.entries(o[k] as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : o[k])]);

/** Describe every difference between the draft and what is live, in plain language. */
export function describeChanges(draftC: SnapshotContent, liveC: SnapshotContent | null): ChangeSet {
  const d = normalizeSnapshotContent(draftC);
  const out: Change[] = [];

  if (!liveC) {
    // first publish — summarize what goes up
    const l0 = d.locations[0];
    out.push({ section: 'site', sentence: 'Your website goes live for the first time.' });
    if (d.identity.business_name) out.push({ section: 'business', sentence: `${q(d.identity.business_name)} — name, description, and contact details go up.` });
    if (l0) out.push({ section: 'business', sentence: 'Your address and weekly hours go up.' });
    if (d.offerings.length) out.push({ section: 'offerings', sentence: `${d.offerings.length} menu item${d.offerings.length > 1 ? 's' : ''} appear on your menu page.` });
    if (d.faqs.length) out.push({ section: 'faqs', sentence: `${d.faqs.length} answered question${d.faqs.length > 1 ? 's' : ''} appear on your FAQ page.` });
    if (d.testimonials.length) out.push({ section: 'testimonials', sentence: `${d.testimonials.length} kind word${d.testimonials.length > 1 ? 's' : ''} from guests appear.` });
    if (d.posts.length) out.push({ section: 'updates', sentence: `${d.posts.length} update${d.posts.length > 1 ? 's' : ''} appear on your Updates page.` });
    return { count: out.length, changes: out, first_publish: true };
  }
  const l = normalizeSnapshotContent(liveC);

  // ── business: identity ──
  const di = d.identity, li = l.identity;
  const idPairs: Array<[keyof typeof di, (a: string, b: string) => string]> = [
    ['business_name', (a, b) => `Your business name changes from ${q(a)} to ${q(b)}.`],
    ['tagline', (_a, b) => b ? `Your tagline changes to ${q(b)}.` : 'Your tagline is removed.'],
    ['description', () => 'Your business description is updated.'],
    ['phone', (_a, b) => b ? `Your phone number changes to ${b}.` : 'Your phone number is removed.'],
    ['email', (_a, b) => b ? `Your email changes to ${b}.` : 'Your email is removed.'],
    ['story', () => 'Your story on the About page is updated.'],
    ['service_area', () => 'Your “where to find us” text is updated.'],
    ['booking_url', (_a, b) => b ? 'Your reservation link is updated.' : 'Your reservation link is removed.'],
    ['ordering_url', (_a, b) => b ? 'Your online-ordering link is updated.' : 'Your online-ordering link is removed.'],
    ['seo_title', () => 'Your search-listing title is updated.'],
    ['seo_description', () => 'Your search-listing description is updated.'],
  ];
  for (const [f, s] of idPairs) {
    const a = String(li[f] ?? ''), b = String(di[f] ?? '');
    if (a !== b) out.push({ section: 'business', sentence: s(a, b) });
  }
  if (!jeq(di.social, li.social)) out.push({ section: 'business', sentence: 'Your social links change.' });

  // ── business: location + hours ──
  const dl = d.locations[0] ?? null, ll = l.locations[0] ?? null;
  if (dl && !ll) out.push({ section: 'business', sentence: 'Your address and hours go up.' });
  else if (!dl && ll) out.push({ section: 'business', sentence: 'Your address and hours are removed.' });
  else if (dl && ll) {
    const addrA = [ll.address_line1, ll.city, ll.region, ll.postal_code].join(', ');
    const addrB = [dl.address_line1, dl.city, dl.region, dl.postal_code].join(', ');
    if (addrA !== addrB) out.push({ section: 'business', sentence: `Your address changes to ${dl.address_line1}, ${dl.city}.` });
    if ((dl.phone || '') !== (ll.phone || '')) out.push({ section: 'business', sentence: dl.phone ? `Your location phone changes to ${dl.phone}.` : 'Your location phone is removed.' });
    const lByDay = new Map((ll.hours || []).map((x) => [x.day, x]));
    for (const dd of dl.hours || []) {
      const prev = lByDay.get(dd.day);
      if (!jeq(dd, prev)) out.push({ section: 'business', sentence: `${DAY[dd.day] || dd.day} hours change from “${dayText(prev)}” to “${dayText(dd)}”.` });
    }
    if (!jeq(dl.holiday_exceptions || [], ll.holiday_exceptions || [])) out.push({ section: 'business', sentence: 'Your holiday hours are updated.' });
    if (!!dl.temporarily_closed !== !!ll.temporarily_closed) {
      out.push({ section: 'business', sentence: dl.temporarily_closed ? 'Your site will show a temporarily-closed notice.' : 'The temporarily-closed notice comes down.' });
    } else if (dl.temporarily_closed && (dl.temporarily_closed_note || '') !== (ll.temporarily_closed_note || '')) {
      out.push({ section: 'business', sentence: 'Your temporarily-closed notice is reworded.' });
    }
  }

  // ── offerings ──
  const lOff = new Map(l.offerings.map((o) => [o.id, o]));
  const dOff = new Map(d.offerings.map((o) => [o.id, o]));
  for (const o of d.offerings) {
    const prev = lOff.get(o.id);
    if (!prev) { out.push({ section: 'offerings', sentence: `${q(o.name)} joins ${o.category}${o.price_text ? ` at ${o.price_text}` : ''}.`, entity_id: o.id }); continue; }
    if (prev.name !== o.name) out.push({ section: 'offerings', sentence: `${q(prev.name)} is renamed ${q(o.name)}.`, entity_id: o.id });
    if ((prev.price_text || '') !== (o.price_text || '')) out.push({ section: 'offerings', sentence: `${q(o.name)} changes from ${prev.price_text || 'no price'} to ${o.price_text || 'no price'}.`, entity_id: o.id });
    if ((prev.description || '') !== (o.description || '')) out.push({ section: 'offerings', sentence: `${q(o.name)}’s description is updated.`, entity_id: o.id });
    if (prev.category !== o.category) out.push({ section: 'offerings', sentence: `${q(o.name)} moves to ${o.category}.`, entity_id: o.id });
    if (!jeq(prev.media, o.media)) out.push({ section: 'media', sentence: o.media ? `${q(o.name)} gets a ${prev.media ? 'new' : ''} photo.`.replace('  ', ' ') : `${q(o.name)}’s photo is removed.`, entity_id: o.id });
  }
  for (const o of l.offerings) if (!dOff.has(o.id)) out.push({ section: 'offerings', sentence: `${q(o.name)} comes off the menu.`, entity_id: o.id });
  if (!jeq(d.settings?.category_order || [], l.settings?.category_order || []) && d.offerings.length) {
    out.push({ section: 'offerings', sentence: 'Menu sections are reordered.' });
  }

  // ── faqs ──
  const lF = new Map(l.faqs.map((f) => [f.id, f])), dF = new Map(d.faqs.map((f) => [f.id, f]));
  for (const f of d.faqs) {
    const prev = lF.get(f.id);
    if (!prev) out.push({ section: 'faqs', sentence: `New answer to ${q(f.question)}.`, entity_id: f.id });
    else if (prev.question !== f.question || prev.answer !== f.answer) out.push({ section: 'faqs', sentence: `The answer to ${q(f.question)} is updated.`, entity_id: f.id });
  }
  for (const f of l.faqs) if (!dF.has(f.id)) out.push({ section: 'faqs', sentence: `${q(f.question)} comes off the FAQ page.`, entity_id: f.id });

  // ── testimonials ──
  const lT = new Map(l.testimonials.map((t) => [t.id, t])), dT = new Map(d.testimonials.map((t) => [t.id, t]));
  for (const t of d.testimonials) {
    const prev = lT.get(t.id);
    if (!prev) out.push({ section: 'testimonials', sentence: `${q(t.quote, 40)} from ${t.author} is featured.`, entity_id: t.id });
    else if (prev.quote !== t.quote || prev.author !== t.author) out.push({ section: 'testimonials', sentence: `${t.author}’s testimonial is edited.`, entity_id: t.id });
  }
  for (const t of l.testimonials) if (!dT.has(t.id)) out.push({ section: 'testimonials', sentence: `${t.author}’s testimonial is unfeatured.`, entity_id: t.id });

  // ── updates (posts) ──
  const lP = new Map(l.posts.map((p) => [p.id, p])), dP = new Map(d.posts.map((p) => [p.id, p]));
  for (const p of d.posts) {
    const prev = lP.get(p.id);
    if (!prev) out.push({ section: 'updates', sentence: `New update: ${q(p.title)}.`, entity_id: p.id });
    else if (prev.title !== p.title || prev.body_md !== p.body_md || (prev.excerpt || '') !== (p.excerpt || '') || !jeq(prev.hero, p.hero)) {
      out.push({ section: 'updates', sentence: `The update ${q(p.title)} is edited.`, entity_id: p.id });
    }
  }
  for (const p of l.posts) if (!dP.has(p.id)) out.push({ section: 'updates', sentence: `The update ${q(p.title)} is unpublished.`, entity_id: p.id });

  // ── redirects (rare; keep honest) ──
  if (!jeq(d.redirects, l.redirects)) out.push({ section: 'site', sentence: 'Link redirects are updated.' });

  // ── the pop-up (item 148) ──
  if (!jeq(d.settings?.popup ?? null, l.settings?.popup ?? null)) {
    out.push({ section: 'site', sentence: !d.settings?.popup ? 'The pop-up comes off your site.' : !l.settings?.popup ? 'Your site gets its pop-up.' : 'The pop-up is changed.' });
  }

  // ── the visit counter (item 61): the counting and the privacy page change together ──
  if ((d.settings?.visit_counter !== false) !== (l.settings?.visit_counter !== false)) {
    out.push({ section: 'site', sentence: d.settings?.visit_counter === false
      ? 'Your site stops counting visits, and its privacy page says so.'
      : 'Your site starts counting visits again, and its privacy page says so.' });
  }
  // ── the AI crawler switch (item 175): robots.txt changes with it ──
  if ((d.settings?.ai_crawlers !== false) !== (l.settings?.ai_crawlers !== false)) {
    out.push({ section: 'site', sentence: d.settings?.ai_crawlers === false
      ? 'AI assistants like ChatGPT, Claude and Perplexity are asked not to read your site. Google and Bing search are not affected.'
      : 'AI assistants can read your site again.' });
  }
  // ── Hide from search and llms.txt (item 124) ──
  if ((d.settings?.search_hidden === true) !== (l.settings?.search_hidden === true)) {
    out.push({ section: 'site', sentence: d.settings?.search_hidden === true
      ? 'Your site is hidden from search engines: every page asks Google and Bing not to list it.'
      : 'Search engines can list your site again.' });
  }
  if (String(d.settings?.llms_txt || '') !== String(l.settings?.llms_txt || '')) {
    out.push({ section: 'site', sentence: d.settings?.llms_txt ? 'Your llms.txt for AI tools is updated.' : 'Your llms.txt is taken down.' });
  }
  // ── ad tags (item 152): the cookie notice and the privacy page change with them ──
  if (JSON.stringify(d.settings?.ad_tags || null) !== JSON.stringify(l.settings?.ad_tags || null)) {
    const t = d.settings?.ad_tags || {};
    const names = [t.google ? 'the Google tag' : '', t.meta ? 'Meta’s pixel' : ''].filter(Boolean).join(' and ');
    out.push({ section: 'site', sentence: names
      ? `Your site asks visitors about cookies and, for those who say yes, loads ${names}. Its privacy page says so.`
      : 'Your site stops loading ad tags and stops asking visitors about cookies.' });
  }

  // ── custom section blocks (home + pages) — without this, two versions that
  //    differ ONLY in blocks reported "identical" (G9 finding). Coarse but
  //    honest: count add/remove/change per page by stable id (type+index else).
  //    They live in the settings: read at the top of the content, as this did until
  //    Nov 2026, they were never found, so a draft that only changed sections said
  //    "nothing to publish" (builder items 48 and 120 found it).
  const blockDelta = (a: unknown[], b: unknown[], where: string) => {
    const key = (x: any, i: number) => (x && typeof x.id === 'string' && x.id ? `id:${x.id}` : `ix:${x?.type}#${i}`);
    const am = new Map((a || []).map((x: any, i: number) => [key(x, i), x]));
    const bm = new Map((b || []).map((x: any, i: number) => [key(x, i), x]));
    let added = 0, removed = 0, changed = 0;
    for (const [k, v] of bm) { if (!am.has(k)) added++; else if (!jeq(am.get(k), v)) changed++; }
    for (const k of am.keys()) if (!bm.has(k)) removed++;
    const bits: string[] = [];
    if (added) bits.push(`${added} section${added > 1 ? 's' : ''} added`);
    if (removed) bits.push(`${removed} removed`);
    if (changed) bits.push(`${changed} changed`);
    if (bits.length) out.push({ section: 'site', sentence: `${bits.join(', ')}${where}.` });
  };
  type Settings = NonNullable<SnapshotContent['settings']>;
  const ds: Settings = d.settings || {}, ls: Settings = l.settings || {};
  blockDelta(ls.blocks || [], ds.blocks || [], ' on your home page');

  // ── the owner's own pages: added, removed, renamed, their sections, and who can see
  //    them (items 48 and 120) ──
  type OwnPage = NonNullable<Settings['pages']>[number];
  const lPages = new Map<string, OwnPage>((ls.pages || []).map((p) => [p.slug, p]));
  const dPages = new Map<string, OwnPage>((ds.pages || []).map((p) => [p.slug, p]));
  for (const p of ds.pages || []) {
    const prev = lPages.get(p.slug);
    if (!prev) {
      out.push({ section: 'site', sentence: p.access === 'private' ? `New page ${q(p.title)}, kept private.` : `New page: ${q(p.title)}.` });
      continue;
    }
    if (prev.title !== p.title) out.push({ section: 'site', sentence: `The page ${q(prev.title)} is renamed ${q(p.title)}.` });
    blockDelta(prev.blocks || [], p.blocks || [], ` on ${q(p.title)}`);
    const was = prev.access || 'everyone', now = p.access || 'everyone';
    if (was !== now) {
      out.push({ section: 'site', sentence: now === 'password' ? `${q(p.title)} will need a password to open.`
        : now === 'private' ? `${q(p.title)} comes off your live site and stays private.`
        : `${q(p.title)} is open to everyone.` });
    } else if (now === 'password' && prev.lock !== p.lock) out.push({ section: 'site', sentence: `${q(p.title)} gets a new password.` });
    const hdr = !!prev.noHeader !== !!p.noHeader, ftr = !!prev.noFooter !== !!p.noFooter;
    if (hdr && ftr && !!p.noHeader === !!p.noFooter) out.push({ section: 'site', sentence: p.noHeader ? `${q(p.title)} leaves out the header and footer.` : `${q(p.title)} shows the header and footer again.` });
    else {
      if (hdr) out.push({ section: 'site', sentence: p.noHeader ? `${q(p.title)} leaves out the header.` : `${q(p.title)} shows the header again.` });
      if (ftr) out.push({ section: 'site', sentence: p.noFooter ? `${q(p.title)} leaves out the footer.` : `${q(p.title)} shows the footer again.` });
    }
  }
  for (const p of ls.pages || []) if (!dPages.has(p.slug)) out.push({ section: 'site', sentence: `The page ${q(p.title)} is removed.` });

  // ── the menu and how pages show on Google ──
  if (!jeq(ds.nav || [], ls.nav || [])) out.push({ section: 'site', sentence: 'Your menu changes.' });
  if (!jeq([...(ds.pages_noindex || [])].sort(), [...(ls.pages_noindex || [])].sort())) out.push({ section: 'site', sentence: 'Which pages show on Google changes.' });
  if (!jeq(sortedKeys(ds.page_seo || {}), sortedKeys(ls.page_seo || {}))) out.push({ section: 'site', sentence: 'How your pages read on Google changes.' });

  return { count: out.length, changes: out, first_publish: false };
}
