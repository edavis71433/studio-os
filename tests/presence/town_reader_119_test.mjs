// ── Sales item 119: one town reader for the pitch pack and the first-email draft ─
// Google's listings end with the country ("…, Burbank, CA 91502, USA"); the pack
// read that town as "CA". A hand-typed address has no country ("2 Main St,
// Burbank, CA 91501"); the draft read that one's street as the town.
//   deno run --allow-read tests/presence/town_reader_119_test.mjs
const T = await import('../../supabase/functions/presence/lib/town.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ═══ the town ═══
eq('Google’s US address ends with the country: the town is Burbank, not CA', T.townFromAddress('123 N San Fernando Blvd, Burbank, CA 91502, USA'), 'Burbank');
eq('a hand-typed address with no country', T.townFromAddress('2 Main St, Burbank, CA 91501'), 'Burbank');
eq('a suite line before the town', T.townFromAddress('100 W Broadway, Suite 4, Glendale, CA 91210, USA'), 'Glendale');
eq('a nine-digit ZIP', T.townFromAddress('9 Elm St, Pasadena, CA 91101-1234, USA'), 'Pasadena');
eq('“United States” spelled out', T.townFromAddress('500 Main St, Springfield, IL 62701, United States'), 'Springfield');
eq('a town and its state, no street', T.townFromAddress('Burbank, CA'), 'Burbank');
eq('a town whose name has two words', T.townFromAddress('1 Market St, San Francisco, CA 94105, USA'), 'San Francisco');
eq('Canada: a province and a postal code', T.townFromAddress('290 Bremner Blvd, Toronto, ON M5V 3L9, Canada'), 'Toronto');
eq('Australia: the town, its state and postcode on one part', T.townFromAddress('1 Macquarie St, Sydney NSW 2000, Australia'), 'Sydney');
eq('the UK: the town and its postcode on one part', T.townFromAddress('10 Downing St, London SW1A 2AA, UK'), 'London');
eq('a street on its own is no town', T.townFromAddress('2 Main St'), '');
eq('nothing is nothing', T.townFromAddress(''), '');
eq('a state on its own is no town', T.townFromAddress('CA 91502, USA'), '');

// ═══ townOf: the address first, else the town it was found in ═══
eq('the address wins over the search', T.townOf({ address: '123 Main St, Burbank, CA 91502, USA', search_query: 'plumbers in Glendale' }), 'Burbank');
eq('no address: the search phrase’s town', T.townOf({ address: null, search_query: 'plumbers in Burbank' }), 'Burbank');
eq('a search town with its state', T.townOf({ search_query: 'diners in Burbank, CA' }), 'Burbank');
eq('neither: nothing', T.townOf({}), '');
eq('a street-only address falls back to the search', T.townOf({ address: '2 Main St', search_query: 'diners in Pasadena' }), 'Pasadena');

// ═══ the parts, for a contact made from a prospect ═══
eq('Google’s US address in parts', T.addressParts('123 N San Fernando Blvd, Burbank, CA 91502, USA'), { state: 'CA', zip: '91502', city: 'Burbank', street: '123 N San Fernando Blvd', country: 'USA' });
eq('a suite stays on the street line', T.addressParts('100 W Broadway, Suite 4, Glendale, CA 91210'), { state: 'CA', zip: '91210', city: 'Glendale', street: '100 W Broadway, Suite 4' });
eq('Australia in parts', T.addressParts('1 Macquarie St, Sydney NSW 2000, Australia'), { city: 'Sydney', state: 'NSW', zip: '2000', street: '1 Macquarie St', country: 'Australia' });
eq('a shape it doesn’t know stays whole, as the street', T.addressParts('Unit 3, The Old Mill'), { street: 'Unit 3, The Old Mill' });
eq('nothing is nothing', T.addressParts(''), {});

// ═══ both readers use it: the pack and the draft carry no town rule of their own ═══
{
  const pack = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/pitch_pack.ts', import.meta.url));
  const pros = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/prospects.ts', import.meta.url));
  ok('the pitch pack reads the town through lib/town.ts', /from '\.\.\/lib\/town\.ts'/.test(pack) && !/split\(','\)/.test(pack));
  ok('the email draft reads it the same way', /from '\.\.\/lib\/town\.ts'/.test(pros) && !/slice\(-3, -2\)/.test(pros));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
