// ── Each kind of business, its own sample (builder list item 331) ─────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/kind_samples_331_test.mjs
// The design pictures in + New site and Templates showed one peach block for every photo,
// and "good for salons" showed a florist. Now each of the ten kinds has a sample business
// (lib/kind_samples.json) with its own words and its own stand-in picture, every design is
// pictured with every kind (thumbs/templates/<slug>/<family>.jpg), and "See it full size"
// draws a kind's sample live in any design. Part A: the samples. Part B: what the sheet is
// sent. Part C: the full-size page, through the real route.
import { installFakePostgrest } from './fake_pgrst.mjs';
const db = installFakePostgrest();
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);

const G = await import('../../supabase/functions/presence/lib/design_gallery.ts');
const K = await import('../../supabase/functions/presence/lib/kind_samples.ts');
const { listTemplates } = await import('../../supabase/functions/presence/lib/render.ts');
const TEMPLATES = listTemplates().map((t) => t.slug);

// ═══ A. the samples ═══
{
  const photos = (v, out = []) => { if (Array.isArray(v)) v.forEach((x) => photos(x, out)); else if (v && typeof v === 'object') { if (v.variants) out.push(v); else Object.values(v).forEach((x) => photos(x, out)); } return out; };
  const names = new Set();
  for (const f of G.FAMILIES) {
    const c = K.kindSampleContent(f);
    names.add(c.identity.business_name);
    ok(`A1 [${f}]: a whole sample business of its own kind`, !!c.identity.business_name && G.familyOf(c.settings.industry) === f && c.offerings.length >= 3 && c.faqs.length >= 2 && c.testimonials.length >= 2 && c.locations.length === 1 && c.locations[0].hours.length === 7);
    const ps = photos(c);
    ok(`A2 [${f}]: every photo is its kind's stand-in picture, and there's no logo`, ps.length >= 1 && ps.every((p) => Object.values(p.variants).every((v) => v === `/thumbs/stand-ins/${f}.jpg`)) && !('logo' in (c.settings || {})));
  }
  ok('A3: ten kinds, ten different businesses', names.size === 10);
  ok('A4: the new samples speak plainly: no em-dashes', ['health', 'community', 'other'].every((f) => !JSON.stringify(K.kindSampleContent(f)).includes('—')));
  ok('A5: a copy each time, so nobody can change the shared sample', (() => { const a = K.kindSampleContent('beauty'); a.identity.business_name = 'x'; return K.kindSampleContent('beauty').identity.business_name === 'Linden Hair Atelier'; })());
  ok('A6: a kind can be named by its family or by any closer kind', K.sampleFamily('salon') === 'beauty' && K.sampleFamily('beauty') === 'beauty' && K.sampleFamily('plumber') === 'home' && K.sampleFamily('nonsense') === 'other' && K.sampleFamily(null) === 'other');
  ok('A7: a sample is a snapshot of any built-in design, with no clock in it', TEMPLATES.every((t) => K.sampleSnapshot('food', t)?.created_at === K.SAMPLE_CREATED_AT) && K.sampleSnapshot('food', 'no-such-design') === null);
}

// ═══ B. what the sheet is sent ═══
{
  const p = G.galleryPayload(listTemplates().map((t) => ({ slug: t.slug, name: t.name })));
  const missing = p.designs.flatMap((d) => G.FAMILIES.filter((f) => { const u = d.pictures?.[f]; try { return !u || Deno.statSync(new URL('.' + u, ROOT)).size < 1500; } catch { return true; } }).map((f) => `${d.slug}/${f}`));
  ok('B1: each design names its picture for every kind, and every picture is there', p.designs.length === 8 && missing.length === 0, missing.slice(0, 4).join(', '));
  ok('B2: each design says the kind its own sample is', p.designs.every((d) => G.FAMILIES.includes(d.family)) && p.designs.find((d) => d.slug === 'atelier').family === 'beauty' && p.designs.find((d) => d.slug === 'harbor').family === 'home');
  ok('B3: each kind’s sample is named in plain words for "See it full size"', G.FAMILIES.every((f) => typeof p.sample_nouns[f] === 'string' && p.sample_nouns[f].length > 2 && !/_/.test(p.sample_nouns[f])));
  ok('B4: the picture with no kind picked is still the design’s own', p.designs.every((d) => d.picture === `/thumbs/templates/${d.slug}.jpg`));
}

// ═══ C. "See it full size", through the real route ═══
{
  const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');
  const AG = 'aaaaaaaa-0000-4000-8000-000000000001', ME = '11111111-1111-4111-8111-111111111111';
  db.tables.presence_agency_members = [{ id: ME, agency_id: AG, email: 'eric@studio.example', role: 'owner', status: 'active' }];
  const member = (role = 'owner') => ({ agency_id: AG, member_id: ME, email: 'eric@studio.example', role, agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} });
  const call = async (path, role) => {
    const req = new Request('http://stub.local/functions/v1/presence' + path, { method: 'GET' });
    const res = await handleAgency(req, path.split('?')[0], 'GET', member(role), { kind: 'client', userId: 'u', email: 'eric@studio.example' }, {});
    return { status: res.status, body: await res.json() };
  };
  let r = await call('/agency/designs/harbor/sample?kind=salon');
  const html = r.body?.data?.html || '';
  ok('C1: a salon drawn in Harbor: the salon’s words, its stand-in picture, Harbor’s own look', r.status === 200 && html.includes('Linden Hair Atelier') && html.includes('/thumbs/stand-ins/beauty.jpg') && /<style>/.test(html));
  ok('C2: a page a frame can show safely: no scripts, no outside address, one photo size', !/<script/i.test(html) && !html.includes('https://example.com') && !/srcset=|<source/.test(html) && !/rel="(?:preload|canonical|icon)"/.test(html));
  r = await call('/agency/designs/harbor/sample?kind=plumber');
  ok('C3: any closer kind finds its family’s sample', r.status === 200 && r.body.data.html.includes('Copper Line Plumbing'));
  r = await call('/agency/designs/harbor/sample');
  ok('C4: no kind is “Something else”', r.status === 200 && r.body.data.html.includes('Cobalt Auto Care'));
  r = await call('/agency/designs/no-such-design/sample?kind=salon');
  ok('C5: a design that isn’t built in is said plainly', r.status === 404 && /isn’t one of the built-in ones/.test(r.body.message));
  r = await call('/agency/designs/atelier/sample?kind=food', 'readonly');
  ok('C6: anyone in the studio who can see Sites can look', r.status === 200 && r.body.data.html.includes('Vermilion &amp; Vine'));
  const t0 = performance.now(); await call('/agency/designs/harbor/sample?kind=salon'); const t1 = performance.now();
  ok('C7: a page drawn once is kept for the next look', t1 - t0 < 50, `${Math.round(t1 - t0)} ms`);
  const named = (f) => K.kindSampleContent(f).identity.business_name.replaceAll('&', '&amp;');   // drawn as HTML
  const all = await Promise.all(TEMPLATES.flatMap((t) => G.FAMILIES.map(async (f) => (await K.samplePage(f, t))?.includes(named(f)))));
  ok('C8: every kind draws in every design', all.length === 80 && all.every(Boolean));
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
