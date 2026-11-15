// ── Builder list item 211: the pitch pack says how fast the prospect's site loads ──
// Review file 01, finding 1: a page Studio OS publishes is about 25 kB; a builder's home page
// is 0.8 to 8 MB. The pitch pack (sales item 113) now shows how long the prospect's homepage
// takes to show on a phone, from Google's own check in their Site Review, beside what a page
// we build weighs (lib/page_weight.ts, kept true by page_weight_211_test).
//   deno run --allow-read --allow-env --allow-net tests/presence/pitch_speed_211_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const db = installFakePostgrest();
const PP = await import('../../supabase/functions/presence/routes/pitch_pack.ts');
const { PAGE_WEIGHT_LIMIT_KB, TYPICAL_PAGE_KB } = await import('../../supabase/functions/presence/lib/page_weight.ts');
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ── Google's phone speed, from a Site Review's PageSpeed run ──
{
  const psi = (value, status, ok = true) => ({ ok, vitals: [{ key: 'cls', value: 0.1, status: 'good' }, { key: 'lcp', value, status, display: `${value / 1000} s`, source: 'lab' }] });
  ok('speed: the main content’s time on a phone, and Google’s word for it', JSON.stringify(PP.phoneSpeedOf(psi(4630.4, 'poor'))) === JSON.stringify({ phone_lcp_ms: 4630, phone_lcp_status: 'poor' }));
  ok('speed: nothing when the check didn’t run or has no time', JSON.stringify(PP.phoneSpeedOf({ ok: false, reason: 'timeout' })) === '{}' && JSON.stringify(PP.phoneSpeedOf(null)) === '{}' && JSON.stringify(PP.phoneSpeedOf({ ok: true, vitals: [] })) === '{}');
  ok('speed: an unknown word is left out, the time kept', JSON.stringify(PP.phoneSpeedOf(psi(1800, 'great'))) === JSON.stringify({ phone_lcp_ms: 1800 }));
  const src = read('supabase/functions/presence/routes/pitch_pack.ts');
  ok('the pack keeps it with the score, from a kept report or a fresh scan', /\.\.\.phoneSpeedOf\(row\.psi \?\? row\.raw_results\?\.psi\)/.test(src) && /select=id,input,scores,findings,created_at\$\{tool === 'site_review' \? ',psi:raw_results->psi' : ''\}/.test(src));
}
// ── the public read carries it, and what a page we build weighs ──
{
  const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  db.reset({
    presence_pitch_packs: [{ token, status: 'ready', site_id: 'site-1', prospect_id: 'p1', built_at: '2026-11-12T00:00:00Z', pieces: { you: { name: 'Old Diner', domain: 'old-diner.example', summary: { overall: 41, label: 'Needs work', top_issues: [], phone_lcp_ms: 4630, phone_lcp_status: 'poor' } }, rivals: [] } }],
    presence_prospects: [{ id: 'p1', business_name: 'Old Diner', address: '2 Main St, Burbank, CA 91501', industry: 'Diner' }],
  });
  const r = await PP.handlePackPublic(token, {});
  const d = (await r.json()).data;
  ok('public read: the prospect’s phone time rides with their score', r.status === 200 && d.you.summary.phone_lcp_ms === 4630 && d.you.summary.phone_lcp_status === 'poor');
  ok('public read: what a page we build weighs, from the limit the test keeps', d.ours && d.ours.typical_kb === TYPICAL_PAGE_KB && d.ours.limit_kb === PAGE_WEIGHT_LIMIT_KB && PAGE_WEIGHT_LIMIT_KB === 100);
}
// ── the page ──
{
  const page = read('pitch.html');
  ok('page: the card sits after the fixes, and never for a business with no website', /\$\{speedCard\(d,you\)\}\s*\$\{you\.no_site\?/.test(page) && /function speedCard\(d,you\)\{\s*if\(you\.no_site\)return '';/.test(page));
  ok('page: their time only when Google’s check ran', /typeof s\.phone_lcp_ms==='number'/.test(page));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
