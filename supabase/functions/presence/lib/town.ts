// ── The town in an address (sales item 119, Nov 2026) ───────────────────────
// Google's listings end with the country: "123 Main St, Burbank, CA 91502, USA".
// An address typed by hand drops it: "2 Main St, Burbank, CA 91501". The pitch
// pack took the part before the last comma and read Google's town as "CA"; the
// first-email draft took the third part from the end and read a hand-typed
// address's street as the town. One reader for both, tested on both shapes,
// and the parts of the address for a contact made from a prospect.
//
// Pure: no network, no database.

const clean = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();

// the country names Google writes at the end of an English-language address
const COUNTRY = /^(usa|us|u\.s\.a?\.?|united states( of america)?|uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland|ireland|canada|australia|new zealand|mexico|south africa)$/i;
// "CA", "CA 91502", "CA 91502-1234", "ON M5V 2T6", "NSW 2000": a region and its postcode
const REGION_POSTCODE = /^[A-Z]{2,3}(\s+(\d{4,5}(-\d{4})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d))?$/;
// a postcode on its own: "91502", "91502-1234"
const POSTCODE = /^\d{4,6}(-\d{4})?$/;

/** "Sydney NSW 2000" → "Sydney", "London SW1A 2AA" → "London": a town with its
 *  region and postcode written after it, on one part of the address. */
function townBeforeTail(part: string): string {
  const words = part.split(' ');
  while (words.length > 1 && (/\d/.test(words[words.length - 1]) || /^[A-Z]{2,3}$/.test(words[words.length - 1]))) words.pop();
  return words.join(' ');
}

/** The comma parts of an address, the country taken off (and given back). */
function split(address: unknown): { parts: string[]; country: string } {
  const parts = clean(address).split(',').map((s) => s.trim()).filter(Boolean);
  const country = parts.length >= 2 && COUNTRY.test(parts[parts.length - 1]) ? String(parts.pop()) : '';
  return { parts, country };
}

/** The town of an address, or '' when none can be read (a street on its own). */
export function townFromAddress(address: unknown): string {
  const { parts } = split(address);
  if (!parts.length) return '';
  const last = parts[parts.length - 1];
  let town = '';
  if (REGION_POSTCODE.test(last) || POSTCODE.test(last)) town = parts.length >= 2 ? parts[parts.length - 2] : '';
  else town = townBeforeTail(last);
  town = townBeforeTail(town);
  // a street ("2 Main St") is never a town
  return !town || /\d/.test(town) ? '' : town.slice(0, 60);
}

/** The town for a prospect: its address first, else the town it was found in
 *  ("plumbers in Burbank" or "plumbers in Burbank, CA"). */
export function townOf(p: { address?: unknown; search_query?: unknown } | null | undefined): string {
  const fromAddress = townFromAddress(p?.address);
  if (fromAddress) return fromAddress;
  const m = clean(p?.search_query).match(/\sin\s+(.+)$/i);
  if (!m) return '';
  const said = m[1].replace(/[.,;:!?]+$/, '').trim();
  return (townFromAddress(said) || said).slice(0, 60);
}

/** An address's parts for a contact ({street, city, state, zip, country}). When
 *  the shape isn't one this knows, the whole line is kept as the street. */
export function addressParts(address: unknown): { street?: string; city?: string; state?: string; zip?: string; country?: string } {
  const whole = clean(address);
  if (!whole) return {};
  const { parts, country } = split(whole);
  const out: { street?: string; city?: string; state?: string; zip?: string; country?: string } = {};
  const last = parts[parts.length - 1] || '';
  const rp = REGION_POSTCODE.exec(last);
  if (rp && parts.length >= 3) {
    const [state, ...zip] = last.split(' ');
    out.state = state;
    if (zip.length) out.zip = zip.join(' ');
    out.city = parts[parts.length - 2];
    out.street = parts.slice(0, -2).join(', ');
  } else if (parts.length >= 2 && !/\d/.test(townBeforeTail(last)) && townBeforeTail(last) !== last) {
    // "Sydney NSW 2000": the town, then its region and postcode
    out.city = townBeforeTail(last);
    const tail = last.slice(out.city.length).trim().split(' ');
    const zip = tail.filter((w) => /\d/.test(w));
    const state = tail.filter((w) => !/\d/.test(w));
    if (state.length) out.state = state.join(' ');
    if (zip.length) out.zip = zip.join(' ');
    out.street = parts.slice(0, -1).join(', ');
  } else {
    return { street: whole.slice(0, 160) };
  }
  if (country) out.country = country;
  if (!out.street) delete out.street;
  return out;
}
