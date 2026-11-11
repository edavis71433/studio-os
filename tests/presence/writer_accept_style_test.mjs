// ── Accepting a writing proposal keeps the site's colours, fonts and custom CSS (Nov 2026) ──
// The writer's accept step (writer/engine.ts acceptDraft) hands the Draft Writer
// (lib/draft_writer.ts applySnapshotToDraft) the draft with the proposal's words in it. The
// gate writes the style layer (theme tokens, custom CSS, custom HTML) from the snapshot it
// is handed, clearing it when there is none, and the accept step handed it none: every
// accepted proposal emptied the site's colours, fonts and custom code in the draft. The
// real acceptDraft against the shared in-memory PostgREST:
//   · each kind of proposal that writes into the draft lands its words and keeps the style
//   · the safety copy set aside keeps the style too
//   · the way the route comes in (the read the version check made), with the owner's own
//     edits: the next read of the draft still carries the style
//   · a site with no style layer still has none
//   deno run --allow-read --allow-env --allow-net tests/presence/writer_accept_style_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const hex = (k, i) => `${k}${i.toString(16).padStart(7, '0')}-0000-4000-8000-000000000000`;
const SITE = uuid('a'), U = uuid('3'), PROPOSAL = hex(9, 4), FAQ = hex(4, 1);
const db = installFakePostgrest();
const { acceptDraft } = await import('../../supabase/functions/presence/writer/engine.ts');
const { readDraft } = await import('../../supabase/functions/presence/lib/draft_hash.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
// key order isn't meaning (jsonb doesn't keep it)
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const same = (a, b) => canon(a) === canon(b);
const site = { id: SITE, client_id: 'client-a', status: 'draft', last_published_at: null, template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };

/* ── a draft with a style layer: colours, fonts, a corner radius, custom CSS and HTML ── */
const STYLE = {
  theme_tokens: { accent: '#5b3fa0', ink: '#1b1525', bg: '#fbf8f3', radius: '12px', font_display: '"Playfair Display", Georgia, serif', font_body: 'Inter, system-ui, sans-serif' },
  custom_css: '.hero h1 { letter-spacing: 0.02em; }\n.btn { border-radius: 999px; }',
  custom_html: '<p class="note">Family run, open every day.</p>',
};
const proposal = (kind, payload) => ({ id: PROPOSAL, site_id: SITE, status: 'proposed', kind, prompt_summary: 'A few words', options: [{ label: 'Warm', tone: 'warm', payload }] });
const world = (kind, payload, style = STYLE) => db.reset({
  presence_sites: [{ ...site }],
  presence_identity: [{ site_id: SITE, business_name: 'Sample Cafe', tagline: 'Good food', description: 'A neighbourhood cafe.', phone: '', email: '', story: '', service_area: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '' }],
  presence_locations: [], presence_offerings: [], presence_testimonials: [], presence_posts: [], presence_redirects: [], presence_reviews: [], presence_media: [], presence_content_library: [],
  presence_faqs: [{ id: FAQ, site_id: SITE, question: 'Parking?', answer: 'Yes, out back.', is_visible: true, sort_order: 0, deleted_at: null }],
  presence_settings: [{ site_id: SITE, category_order: [] }],
  presence_dev_customizations: style ? [{ site_id: SITE, ...structuredClone(style), updated_by: U, updated_at: '2026-11-01T00:00:00Z' }] : [],
  presence_snapshots: [], presence_change_events: [],
  presence_ai_drafts: [proposal(kind, payload)],
});
const style = () => db.tables.presence_dev_customizations.find((r) => r.site_id === SITE);
const styleAsItWas = (label) => {
  const s = style();
  ok(`${label}: the colours, fonts and corner radius are as they were`, same(s?.theme_tokens, STYLE.theme_tokens), canon(s?.theme_tokens));
  ok(`${label}: the custom CSS is as it was`, s?.custom_css === STYLE.custom_css, JSON.stringify(s?.custom_css));
  ok(`${label}: the custom HTML is as it was`, s?.custom_html === STYLE.custom_html, JSON.stringify(s?.custom_html));
};

// ═══ 1. every kind of proposal that writes into the draft: its words land, the style stays ═══
for (const [kind, payload, landed] of [
  ['identity_copy', { identity: { tagline: 'Fresh bread every morning' } }, () => db.tables.presence_identity[0].tagline === 'Fresh bread every morning'],
  ['edit_identity', { identity: { description: 'A neighbourhood cafe with a bakery in the back.' } }, () => db.tables.presence_identity[0].description === 'A neighbourhood cafe with a bakery in the back.'],
  ['faqs', { faqs: [{ question: 'Do you take bookings?', answer: 'For six or more.' }] }, () => db.tables.presence_faqs.some((f) => f.question === 'Do you take bookings?' && f.is_visible)],
  ['edit_faq', { faqs_edit: [{ id: FAQ, question: 'Is there parking?', answer: 'Yes, behind the building.' }] }, () => db.tables.presence_faqs.find((f) => f.id === FAQ)?.answer === 'Yes, behind the building.'],
  ['post', { post: { title: 'Winter hours', body_md: 'We open an hour later from December.' } }, () => db.tables.presence_posts.some((p) => p.title === 'Winter hours' && p.status === 'published')],
]) {
  world(kind, payload);
  const r = await acceptDraft(site, PROPOSAL, 0, null, owner);
  ok(`${kind}: accepted`, r.ok === true && db.tables.presence_ai_drafts[0].status === 'accepted', JSON.stringify(r));
  ok(`${kind}: its words are in the draft`, landed());
  styleAsItWas(kind);
}

// ═══ 2. the rest of the draft, and the safety copy ═══
{
  world('identity_copy', { identity: { tagline: 'Fresh bread every morning' } });
  const r = await acceptDraft(site, PROPOSAL, 0, null, owner);
  ok('accept: says what it put in', /business copy/.test(r.applied_summary), r.applied_summary);
  const i = db.tables.presence_identity[0];
  ok('accept: the rest of the business details stay', i.business_name === 'Sample Cafe' && i.description === 'A neighbourhood cafe.');
  const safety = db.tables.presence_snapshots.at(-1);
  ok('accept: the safety copy is the draft before, words and style', db.tables.presence_snapshots.length === 1 && safety?.content?.identity?.tagline === 'Good food' && same(safety?.dev_customization, STYLE), canon(safety?.dev_customization));
}

// ═══ 3. the route's way in: the read the version check made, and the owner's own edits ═══
{
  world('identity_copy', { identity: { tagline: 'Model words' } });
  const found = await readDraft(site);
  ok('the read the check made carries the style', same(found?.snapshot?.dev_customization, STYLE));
  const r = await acceptDraft(site, PROPOSAL, 0, { identity: { tagline: 'Our own words' } }, owner, found);
  ok('edits: accepted, the owner’s words over the model’s', r.ok === true && db.tables.presence_identity[0].tagline === 'Our own words', JSON.stringify(r));
  styleAsItWas('edits');
  const next = await readDraft(site);
  ok('edits: the draft read afterwards (what preview and publish draw) still has the style', same(next?.snapshot?.dev_customization, STYLE), canon(next?.snapshot?.dev_customization));
}

// ═══ 4. a site with no style layer still has none ═══
{
  world('identity_copy', { identity: { tagline: 'Fresh bread every morning' } }, null);
  const r = await acceptDraft(site, PROPOSAL, 0, null, owner);
  const s = style();
  ok('no style: accepted', r.ok === true && db.tables.presence_identity[0].tagline === 'Fresh bread every morning', JSON.stringify(r));
  ok('no style: none made up', !s || (same(s.theme_tokens, {}) && s.custom_css === '' && s.custom_html === ''), canon(s));
  const next = await readDraft(site);
  ok('no style: the draft read afterwards has none', next && !next.snapshot.dev_customization);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
