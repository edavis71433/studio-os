// ── The welcome section moves like the other home sections, on every template ──
//   deno run --allow-read --allow-env tests/presence/welcome_order_test.mjs
// Each template's own fixture, with the home page's saved section order varied.
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const SITE = { baseUrl: 'https://example.com' };
const TEMPLATES = ['restaurant-classic', 'business-classic', 'editorial', 'aurora', 'slate', 'meadow', 'atelier', 'harbor'];

for (const slug of TEMPLATES) {
  const fx = JSON.parse(Deno.readTextFileSync(new URL(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`, ROOT)));
  const home = async (sections) => {
    const s = structuredClone(fx);
    s.content.settings = { ...(s.content.settings || {}), ...(sections ? { sections } : {}) };
    return String((await renderSnapshot(s, SITE))['index.html']);
  };
  const at = (h, needle) => h.indexOf(needle);
  const HERO = 'data-dds-core="hero"', ABOUT = 'data-dds-core="about"', STRIP = 'class="strip"';

  const plain = await home();
  ok(`[${slug}] the welcome section is stamped movable`, plain.includes(`${HERO} data-dds-movable`));
  ok(`[${slug}] with no saved order it comes first`, at(plain, HERO) > -1 && at(plain, HERO) < at(plain, ABOUT));

  const down = await home({ hidden: [], order: ['about', 'hero', 'offerings', 'testimonials', 'faqs'] });
  ok(`[${slug}] a saved order puts it below About`, at(down, ABOUT) < at(down, HERO));
  ok(`[${slug}] it appears once`, (down.match(/data-dds-core="hero"/g) || []).length === 1);
  if (plain.includes(STRIP)) {
    const s = at(down, STRIP);
    ok(`[${slug}] the address strip moves with it`, s > at(down, HERO) && (down.match(/class="strip"/g) || []).length === 1);
  }

  const older = await home({ hidden: [], order: ['faqs', 'about'] });
  ok(`[${slug}] an order saved before it could move leaves it first`, at(older, HERO) < at(older, ABOUT));

  const off = await home({ hidden: ['hero'], order: ['about', 'hero'] });
  ok(`[${slug}] removed, it is gone`, !off.includes(HERO));
  if (plain.includes(STRIP)) ok(`[${slug}] removed, the strip keeps its place at the top`, at(off, STRIP) > -1 && at(off, STRIP) < at(off, ABOUT));
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ WELCOME ORDER: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
