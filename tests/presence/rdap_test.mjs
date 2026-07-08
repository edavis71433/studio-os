// ── Phase INF: domain intelligence (RDAP parse + registrar tips + windows) ───
//   deno run --allow-read --allow-env tests/presence/rdap_test.mjs
import { parseRdap, daysUntil, registrarTip } from '../../supabase/functions/presence/lib/rdap.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

// ═══ 1. RDAP parse (standard shape) ═══
{
  const doc = {
    events: [
      { eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' },
      { eventAction: 'expiration', eventDate: '2026-08-15T04:00:00Z' },
    ],
    entities: [
      { roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Private Person']]] },
      { roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'GoDaddy.com, LLC']]] },
    ],
  };
  const p = parseRdap(doc);
  ok('expiration event parsed to ISO', p.expires_at === '2026-08-15T04:00:00.000Z');
  ok('registrar fn extracted (registrar role only, not registrant)', p.registrar === 'GoDaddy.com, LLC');
  ok('handle fallback when no fn', parseRdap({ entities: [{ roles: ['registrar'], handle: 'R-123' }] }).registrar === 'R-123');
  ok('garbage in → nulls out, never throws', parseRdap(null).expires_at === null && parseRdap({ events: 'x', entities: 42 }).registrar === '');
}

// ═══ 2. expiry windows ═══
{
  const NOW = '2026-07-08T12:00:00Z';
  ok('daysUntil counts down correctly', daysUntil('2026-07-15T12:00:00Z', NOW) === 7 && daysUntil('2026-07-08T18:00:00Z', NOW) === 0);
  ok('past expiry goes negative; bad input null', daysUntil('2026-07-01T00:00:00Z', NOW) < 0 && daysUntil('nope', NOW) === null && daysUntil(null, NOW) === null);
}

// ═══ 3. registrar-aware guidance ═══
{
  ok('major registrars get their own words', /GoDaddy: My Products/.test(registrarTip('GoDaddy.com, LLC')) && /Namecheap: Domain List/.test(registrarTip('NAMECHEAP INC')) && /Cloudflare/.test(registrarTip('Cloudflare, Inc.')));
  ok('google → squarespace migration handled', /Squarespace Domains/.test(registrarTip('Google Domains LLC')));
  ok('unknown registrar → honest generic naming it', registrarTip('Weird Registrar GmbH').includes('Weird Registrar GmbH'));
  ok('no registrar → empty (sentence stays clean)', registrarTip('') === '');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
