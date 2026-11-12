// ── A second location on the live site, one way for all eight templates (builder list item 127) ──
// The snapshot carries it as locations[1] (lib/second_location.ts): a name for the place,
// its address and phone, and its hours, the main location's or its own. The footer lists
// it under the main address, the Contact page gives it a card of its own with its own Get
// directions link, and Google reads it as a second place of the same business. Each
// template passes its own hours table, so the card looks like the rest of its page.
// The phone bar, the emails and the legal pages keep reading locations[0]. Pure.
import { attr, esc } from './markdown.ts';
import type { LocationContent, SiteConfig, SnapshotContent } from './render_types.ts';

type Place = LocationContent & { label?: string; same_hours?: true };
const DAY_SCHEMA: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

/** The second location, or null. Pure. */
export const secondPlace = (c: SnapshotContent): Place | null => (c.locations?.[1] as Place | undefined) || null;

const addrHtml = (l: Place): string => [l.address_line1, l.address_line2, `${l.city}, ${l.region} ${l.postal_code}`].filter(Boolean).map(esc).join('<br>');
const telHtml = (phone: string): string => phone ? `<a href="tel:${attr(phone.replace(/[^\d+]/g, ''))}">${esc(phone)}</a>` : '';

/** Directions to one place, made the way the main location's link is. Pure. */
export function placeMapsHref(businessName: string, l: Place): string {
  const q = encodeURIComponent(`${businessName}, ${l.address_line1}, ${l.city}, ${l.region} ${l.postal_code}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** The footer's lines for the second place, under the main address: its name, address
 *  and phone. '' with none. Pure. */
export function footerPlace(c: SnapshotContent): string {
  const l = secondPlace(c); if (!l) return '';
  const tel = telHtml((l.phone || '').trim());
  return `<address class="place2">${l.label ? `<strong>${esc(l.label)}</strong><br>` : ''}${addrHtml(l)}${tel ? `<br>${tel}` : ''}</address>`;
}

/** The Contact page's card for the second place: its address, phone, directions and
 *  hours. With the same hours it says so instead of drawing the week twice. '' with
 *  none. Pure. */
export function contactPlace(c: SnapshotContent, hoursTable: (c: SnapshotContent, caption: string) => string): string {
  const l = secondPlace(c); if (!l) return '';
  const tel = telHtml((l.phone || '').trim());
  const main = c.locations?.[0];
  const hours = l.same_hours
    ? `<p class="place2-same">Open the same hours as ${main?.city ? `our ${esc(main.city)} location` : 'our main location'}.</p>`
    : hoursTable({ ...c, locations: [l] }, 'Hours');
  return `<div class="card place2"><h2>${esc(l.label || 'Our second location')}</h2><address>${addrHtml(l)}</address>${tel ? `<p>${tel}</p>` : ''}<p><a href="${attr(placeMapsHref(c.identity.business_name, l))}" rel="noopener">Get directions</a></p>${hours}</div>`;
}

/** What Google reads about the second place: the same kind of business at its own
 *  address, phone and hours, part of the first. [] with none, so a template spreads it
 *  into a page's list. Pure. */
export function ldPlaces(c: SnapshotContent, site: SiteConfig, schemaType: string): object[] {
  const l = secondPlace(c); if (!l) return [];
  const name = c.identity.business_name;
  const spec = (l.hours || []).filter((d) => !d.closed && d.intervals?.length).flatMap((d) =>
    d.intervals.map((i) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAY_SCHEMA[d.day], opens: i.open, closes: i.close })));
  return [{
    '@context': 'https://schema.org', '@type': schemaType,
    name: l.label ? `${name} (${l.label})` : name, url: `${site.baseUrl}/contact/`,
    telephone: l.phone || undefined,
    address: { '@type': 'PostalAddress', streetAddress: [l.address_line1, l.address_line2].filter(Boolean).join(', '), addressLocality: l.city, addressRegion: l.region, postalCode: l.postal_code, addressCountry: l.country },
    openingHoursSpecification: spec,
    parentOrganization: { '@type': 'Organization', name, url: site.baseUrl },
  }];
}

/** The second place's styles, in each template's own colours. */
export const PLACE_CSS = `
address.place2{margin-top:14px}
.place2-same{color:var(--soft)}
`;
