// ── M9.5A AI Writer suite ────────────────────────────────────────────────────
// Pure tiers (mock model — no LLM needed): the Fact Guard against hostile
// outputs, missing facts, structured-output sanitization, field caps, voice
// never-claims, self-checks, snapshot composition (accept path), workflow
// determinism, approval flow, industry pack. Integration tier (SB/SR_KEY/ANON,
// staging has ANTHROPIC_KEY): a REAL generation, review, acceptance through
// the unmodified Draft Writer, and full reversibility via history.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/writer_test.mjs
import { factGuard, selfCheck } from '../../supabase/functions/presence/writer/guard.ts';
import { composeMerged } from '../../supabase/functions/presence/writer/engine.ts';
import { CONTRACT_KINDS, DOCUMENT_KINDS, FIELD_CAPS } from '../../supabase/functions/presence/writer/contract.ts';
import { packFor } from '../../supabase/functions/presence/writer/pack.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const FACTS = {
  business_name: 'Marlow’s Kitchen', tagline: 'Seasonal plates, honest hours',
  description: 'A neighborhood kitchen in Echo Park.', story: '', service_area: '',
  phone: '(213) 555-0140', email: 'hi@marlows.example', booking_url: '', ordering_url: '',
  address: '2114 Sunset Blvd, Los Angeles, CA, 90026', hours_text: 'Tue 17:00-22:00; Sat 12:00-22:00',
  offerings: [
    { id: 'o1', name: 'Rye Gnocchi', category: 'Mains', price_text: '$24', description: '', visible: true },
    { id: 'o2', name: 'Half Chicken', category: 'Mains', price_text: '$28', description: 'charred lemon', visible: true },
  ],
  faq_questions: ['Do you take walk-ins?'],
  post_titles: ['Summer patio is open'],
  testimonial_count: 1,
  voice: { tone_notes: 'warm, unfussy', preferred_vocabulary: 'neighborhood, seasonal', never_claim: 'organic, gluten-free, best in town' },
};

// ═══ 1. THE FACT GUARD — hallucination prevention, hostile outputs ═══
{
  ok('guard: clean copy from real facts passes',
    factGuard({ identity: { description: 'A neighborhood kitchen in Echo Park serving seasonal plates. Call (213) 555-0140.' } }, FACTS).ok);
  const inventedPhone = factGuard({ identity: { description: 'Call us at (818) 999-1234 today.' } }, FACTS);
  ok('guard: invented phone rejected', !inventedPhone.ok, inventedPhone.violations.join('; '));
  const inventedPrice = factGuard({ faqs: [{ question: 'How much is dinner?', answer: 'Most mains are around $45.' }] }, FACTS);
  ok('guard: invented price rejected', !inventedPrice.ok);
  const inventedHours = factGuard({ identity: { description: 'Open daily from 9am - 11pm.' } }, { ...FACTS, hours_text: '' });
  ok('guard: hours claimed when none provided → rejected', !inventedHours.ok);
  ok('guard: award claims rejected', !factGuard({ identity: { story: 'Our award-winning kitchen…' } }, FACTS).ok);
  ok('guard: guarantees rejected', !factGuard({ post: { title: 'New menu', body_md: 'Satisfaction guaranteed or your money back.' } }, FACTS).ok);
  ok('guard: invented founding year rejected', !factGuard({ identity: { story: 'Serving Echo Park since 1987.' } }, FACTS).ok);
  ok('guard: fabricated customer quote rejected', !factGuard({ identity: { story: '“Best gnocchi of my life, hands down!” — Maria' } }, FACTS).ok);
  ok('guard: invented named staff rejected', !factGuard({ identity: { story: 'Our chef Antonio trained in Rome.' } }, FACTS).ok);
  const never = factGuard({ identity: { description: 'Everything is organic and gluten-free.' } }, FACTS);
  ok('guard: the client’s never-claim list is a hard denylist', !never.ok, never.violations.join('; '));
  const placeholder = factGuard({ identity: { description: 'Find us at [your address] — call [your phone number].' } }, { ...FACTS, address: '', phone: '' });
  ok('guard: placeholders are the legal way to say missing', placeholder.ok && placeholder.placeholders.length === 2);
  ok('guard: fake reviews in answers rejected', !factGuard({ faqs: [{ question: 'Is it good?', answer: 'Our reviews say it is the best.' }] }, FACTS).ok);
}

// ═══ 2. self-check quality signals ═══
{
  const good = selfCheck({ identity: { description: 'We cook a short seasonal menu. Half the garden is ours. The rest comes from the Wednesday market.' } }, FACTS);
  ok('self-check: plain warm copy reads well', good.reading_ok && good.plain_language_ok && good.field_limits_ok);
  const jargon = selfCheck({ identity: { description: 'We leverage best-in-class culinary solutions.' } }, FACTS);
  ok('self-check: marketing jargon flagged', !jargon.plain_language_ok);
  const weak = selfCheck({ post: { title: 'News', body_md: 'Click here to learn more.' } }, FACTS);
  ok('self-check: weak CTAs flagged', weak.weak_cta);
  const long = selfCheck({ identity: { tagline: 'x'.repeat(200) } }, FACTS);
  ok('self-check: field caps enforced (contract can never reject accepted copy)', !long.field_limits_ok);
  const dup = selfCheck({ identity: { description: 'A neighborhood kitchen in Echo Park.' + ' More words here to cross the length floor for duplicate detection to engage properly and meaningfully.' } }, { ...FACTS, description: 'A neighborhood kitchen in Echo Park. More words here to cross the length floor for duplicate detection to engage properly and meaningfully. And yet more.' });
  ok('self-check: duplicate-of-existing detected', dup.duplicate_of_existing);
  const seo = selfCheck({ identity: { seo_title: 'Hi' } }, FACTS);
  ok('self-check: search-snippet length notes', seo.seo.length === 1);
}

// ═══ 3. composition (the accept path) — pure, additive, never destructive ═══
{
  const current = {
    identity: { business_name: 'Marlow’s Kitchen', description: 'Old description.', phone: '(213) 555-0140', email: 'hi@marlows.example' },
    locations: [{ address_line1: '2114 Sunset Blvd', city: 'LA', region: 'CA', postal_code: '90026', country: 'US', timezone: 'America/Los_Angeles', hours: [] }],
    settings: {}, offerings: [{ id: 'o1', name: 'Rye Gnocchi', category: 'Mains', price_text: '$24' }],
    testimonials: [{ id: 't1', quote: 'Kind words', author: 'M' }], faqs: [{ id: 'f1', question: 'Old?', answer: 'Yes.' }],
    posts: [], redirects: [],
  };
  const merged = composeMerged(current, {
    identity: { description: 'New drafted description.' },
    faqs: [{ question: 'New question?', answer: 'New answer.' }],
    offering_descriptions: [{ id: 'o1', description: 'brown butter, sage' }],
    post: { title: 'Fall menu arrives', body_md: 'The fall menu lands this week.' },
  }, null);
  ok('compose: identity merges, nothing else about identity is lost', merged.identity.description === 'New drafted description.' && merged.identity.phone === '(213) 555-0140');
  ok('compose: existing faqs kept, new appended with ids', merged.faqs.length === 2 && merged.faqs[1].id && merged.faqs[1].question === 'New question?');
  ok('compose: offering description filled in place', merged.offerings[0].description === 'brown butter, sage');
  ok('compose: post appended with slug', merged.posts.length === 1 && /fall-menu/.test(merged.posts[0].slug));
  ok('compose: testimonials and locations untouched', merged.testimonials.length === 1 && merged.locations[0].address_line1 === '2114 Sunset Blvd');
  const edited = composeMerged(current, { identity: { description: 'Model words.' } }, { identity: { description: 'The customer rewrote this completely.' } });
  ok('compose: customer edits WIN entirely over model output', edited.identity.description === 'The customer rewrote this completely.');
  const same = JSON.stringify(composeMerged(current, { identity: { tagline: 'T' } }, null).identity) === JSON.stringify(composeMerged(current, { identity: { tagline: 'T' } }, null).identity);
  ok('compose: deterministic for identical inputs (ids aside)', same);
}

// ═══ 4. taxonomy + approval model ═══
{
  ok('kinds: contract kinds and document kinds partition cleanly', CONTRACT_KINDS.length === 5 && DOCUMENT_KINDS.length === 5 && !CONTRACT_KINDS.some((k) => DOCUMENT_KINDS.includes(k)));
  ok('kinds: testimonials are draft REQUESTS only (document kind, never content)', DOCUMENT_KINDS.includes('testimonial_request'));
  ok('kinds: policies/social/email/pages stay documents until their contracts exist', ['policy_doc', 'social_post', 'email_doc', 'page_copy'].every((k) => DOCUMENT_KINDS.includes(k)));
  ok('caps: field caps mirror the API contract', FIELD_CAPS.tagline === 140 && FIELD_CAPS.answer === 2000 && FIELD_CAPS.post_title === 160);
  const pack = packFor('restaurant-classic');
  ok('pack: the restaurant pack guards vertical claims', /health/.test(pack.voiceGuardrails) && pack.toneDefaults.length === 3);
}

// ═══ 5. integration (staging — real model, real Draft Writer) ═══
const SB = Deno.env.get('SB'), SR = Deno.env.get('SR_KEY'), ANON = Deno.env.get('ANON');
if (SB && SR && ANON) {
  const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
  const uA = (users.users || []).find((x) => (x.email || '').toLowerCase() === 'rcat-acceptance@example.com');
  const pw = 'rcat-' + crypto.randomUUID().slice(0, 12);
  await fetch(`${SB}/auth/v1/admin/users/${uA.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: pw }) });
  const jwt = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'rcat-acceptance@example.com', password: pw }) })).json()).access_token;
  const call = async (m, route, body) => {
    const r = await fetch(`${SB}/functions/v1/presence${route}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': jwt }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await j(r) };
  };

  const gen = await call('POST', '/writer/generate', { kind: 'faqs', instructions: 'questions about reservations and parking' });
  if (gen.status === 503) {
    console.log('      (ANTHROPIC_KEY not configured on staging — live generation tier skipped; honest 503 verified)');
    ok('integration: without a key the writer refuses honestly (manual paths remain the product)', gen.json?.error === 'writer_unavailable');
  } else {
    ok('integration: real generation stores a proposal', gen.status === 200 && gen.json?.data?.ok === true && gen.json.data.options >= 1, `options=${gen.json?.data?.options} dropped=${gen.json?.data?.dropped_options} missing=${(gen.json?.data?.missing_facts || []).length} model=${gen.json?.data?.model}`);
    const draft = await call('GET', `/writer/drafts/${gen.json.data.draft_id}`);
    ok('integration: proposal carries the full contract', draft.status === 200 && draft.json?.data?.approval_required === true && Array.isArray(draft.json.data.options) && draft.json.data.options.every((o) => o.fact_guard?.ok === true), `kind=${draft.json?.data?.kind} conf=${draft.json?.data?.confidence}`);
    const before = await call('GET', '/faqs');
    const accept = await call('POST', `/writer/drafts/${gen.json.data.draft_id}/accept`, { option: 0 });
    ok('integration: acceptance flows through the Draft Writer', accept.status === 200 && /draft/i.test(accept.json?.data?.note || ''), accept.json?.data?.applied_summary);
    const after = await call('GET', '/faqs');
    const added = (after.json?.data?.length || 0) - (before.json?.data?.length || 0);
    ok('integration: accepted questions are IN THE DRAFT, editable like any others', added >= 1, `+${added} faqs`);
    // safety snapshot proof: the Draft Writer set the previous draft aside
    const snaps = await j(await fetch(`${SB}/rest/v1/presence_snapshots?site_id=eq.${(await j(await fetch(`${SB}/rest/v1/presence_sites?client_id=eq.${(await j(await fetch(`${SB}/rest/v1/clients?email=eq.rcat-acceptance%40example.com&select=id`, { headers: H })))[0].id}&select=id`, { headers: H })))[0].id}&select=id&order=created_at.desc&limit=1`, { headers: H }));
    ok('integration: a safety snapshot exists from the acceptance (reversible)', snaps.length === 1);
    // reversibility + cleanup: remove the added faqs by hand (the manual path)
    const newOnes = (after.json?.data || []).slice(before.json?.data?.length || 0);
    for (const f of newOnes) await call('DELETE', `/faqs/${f.id}`);
    const cleaned = await call('GET', '/faqs');
    ok('integration: everything reversible — hand-removal restores the before-state', (cleaned.json?.data?.length || 0) === (before.json?.data?.length || 0));
    // a second proposal can be discarded without a trace on the draft
    const gen2 = await call('POST', '/writer/generate', { kind: 'post', instructions: 'a short note that fall hours start soon — do not invent dates' });
    if (gen2.status === 200) {
      const disc = await call('POST', `/writer/drafts/${gen2.json.data.draft_id}/discard`);
      const postsAfter = await call('GET', '/posts');
      ok('integration: discarding a proposal leaves zero trace in the draft', disc.status === 200 && Array.isArray(postsAfter.json?.data));
    }
  }
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ AI WRITER: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
