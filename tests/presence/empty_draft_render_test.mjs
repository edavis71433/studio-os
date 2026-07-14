// ── Empty-draft render safety ────────────────────────────────────────────────
// A brand-new / near-empty site (no location, no content) MUST still render — the
// builder canvas is the /preview render, so a render crash = a blank, unusable
// canvas. This pins that every template renders index.html for an empty draft
// without throwing (the ldBusiness/ldRestaurant null-location crash regression).
//
//   deno run --allow-read tests/presence/empty_draft_render_test.mjs
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const TEMPLATES = ['business-classic', 'editorial', 'restaurant-classic'];

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL → ' + n); } };

for (const slug of TEMPLATES) {
  const fx = JSON.parse(read(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`));
  const empty = structuredClone(fx);
  empty.content.identity = { business_name: '', description: '', phone: '', email: '' };
  empty.content.locations = [];
  empty.content.offerings = []; empty.content.testimonials = []; empty.content.faqs = []; empty.content.posts = []; empty.content.redirects = [];
  if (empty.content.settings) { empty.content.settings.blocks = []; delete empty.content.settings.pages; }
  let out = null, threw = null;
  try { out = renderSnapshot(empty, { baseUrl: 'https://x.test' }); } catch (e) { threw = e && e.message; }
  ok(`[${slug}] an empty draft (no location/content) renders without throwing`, !threw && out && typeof out['index.html'] === 'string' && out['index.html'].length > 0);
  if (threw) console.log('    threw: ' + threw);
  // just a business name (still no location) — the common first-save state
  const named = structuredClone(empty); named.content.identity.business_name = 'My Shop';
  let t2 = null; try { renderSnapshot(named, { baseUrl: 'https://x.test' }); } catch (e) { t2 = e && e.message; }
  ok(`[${slug}] a named site with no location yet also renders`, !t2);
}

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  empty-draft render — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
console.log(`\n════ EMPTY-DRAFT RENDER GATE: ${done ? '1/1 PASSED' : 'FAILED'} ════`);
if (!done) Deno.exit(1);
