// ── M9.5B AI Editor suite ────────────────────────────────────────────────────
// Pure tiers (no LLM): the action taxonomy, before-builders, compare packs,
// deterministic change summaries, fact/voice preservation via the guard with
// existing-content allowance, in-place composition (never appends), sanitizer
// id discipline, whole-site shape, approval flow. Integration tier: a REAL
// in-place improvement of an existing FAQ on staging, accepted through the
// unmodified Draft Writer, then reverted.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/editor_test.mjs
import { EDIT_ACTIONS, buildBefore, changeSummary, comparePack, editGuard, sanitizeEditPayload } from '../../supabase/functions/presence/writer/editor.ts';
import { composeMerged } from '../../supabase/functions/presence/writer/engine.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const FACTS = {
  business_name: 'Marlow’s Kitchen', tagline: 'Seasonal plates, honest hours',
  description: 'A neighborhood kitchen in Echo Park.', story: 'We started small.', service_area: '',
  phone: '(213) 555-0140', email: 'hi@marlows.example', booking_url: '', ordering_url: '',
  address: '2114 Sunset Blvd, Los Angeles, CA, 90026', hours_text: 'Tue 17:00-22:00',
  offerings: [{ id: 'o1', name: 'Rye Gnocchi', category: 'Mains', price_text: '$24', description: 'brown butter and sage', visible: true }],
  faq_questions: ['Do you take walk-ins?'],
  faqs_full: [{ id: 'f1', question: 'Do you take walk-ins?', answer: 'Yes we do, most nights, but weekends fill up fast so its best to come early.', visible: true }],
  posts_full: [{ id: 'p1', title: 'Summer patio is open', body_md: 'The patio is open again. Come by.', excerpt: '', shown: true }],
  post_titles: ['Summer patio is open'],
  testimonial_count: 0,
  voice: { tone_notes: 'warm, unfussy', preferred_vocabulary: 'neighborhood, seasonal', never_claim: 'organic, best in town' },
};

// ═══ 1. the action taxonomy — 22 actions, each self-explaining ═══
{
  const wanted = ['rewrite','expand','condense','simplify','clarify','modernize','readability','accessibility','seo','aeo','conversion','trust','cta','headlines','linking','structure','flow','scannability','grammar','consistency','tone','brand'];
  const missing = wanted.filter((a) => !EDIT_ACTIONS[a]);
  ok(`taxonomy: all ${wanted.length} editing actions present`, missing.length === 0, missing.join(','));
  const incomplete = Object.entries(EDIT_ACTIONS).filter(([, v]) => !v.instruction || !v.why || !v.benefit);
  ok('taxonomy: every action carries instruction + why + expected benefit', incomplete.length === 0);
  const jargonFree = Object.values(EDIT_ACTIONS).every((v) => !/\b(SEO|AEO|HTML|schema)\b/.test(v.why + v.benefit));
  ok('taxonomy: why/benefit lines speak merchant, not engineering', jargonFree);
}

// ═══ 2. before-builders ═══
{
  const faq = buildBefore('edit_faq', FACTS, 'f1', undefined);
  ok('before: edit_faq loads the actual current text', faq.ok && faq.before.answer.includes('weekends fill up fast'));
  ok('before: missing target answered honestly', buildBefore('edit_faq', FACTS, 'nope', undefined).error === 'target_not_found');
  const polish = buildBefore('site_polish', FACTS, undefined, undefined);
  ok('before: site_polish gathers identity + faqs + offering descriptions', polish.ok && polish.before.description && polish.before['faq:f1'] && polish.before['offering:o1']);
  ok('before: empty site → nothing_to_edit (honest)', buildBefore('site_polish', { ...FACTS, tagline: '', description: '', story: '', service_area: '', faqs_full: [], offerings: [] }, undefined, undefined).error === 'nothing_to_edit');
  ok('before: edit_document needs real text', buildBefore('edit_document', FACTS, undefined, 'hi').error === 'text_too_short');
}

// ═══ 3. fact preservation — the guard with existing-content allowance ═══
{
  const before = { answer: 'Yes we do, most nights. Call (213) 555-0140.' };
  const keeps = editGuard({ faqs_edit: [{ id: 'f1', question: 'Do you take walk-ins?', answer: 'Yes — most nights. Weekends fill quickly, so early is best. Call (213) 555-0140.' }] }, FACTS, before);
  ok('guard: edits may keep every existing fact (phone already present)', keeps.ok, keeps.violations.join(';'));
  const invents = editGuard({ faqs_edit: [{ id: 'f1', question: 'Do you take walk-ins?', answer: 'Yes, and parties over 6 get 20% off.' }] }, FACTS, before);
  ok('guard: an edit inventing an offer/number is rejected', !invents.ok);
  const brand = editGuard({ identity: { description: 'The best in town neighborhood kitchen.' } }, FACTS, {});
  ok('guard: never-claims still bind during edits', !brand.ok);
}

// ═══ 4. compare pack + deterministic change summary ═══
{
  const before = { question: 'Do you take walk-ins?', answer: FACTS.faqs_full[0].answer };
  const payload = { faqs_edit: [{ id: 'f1', question: 'Do you take walk-ins?', answer: 'Yes — most nights. Weekends fill quickly, so earlier is easier.' }] };
  const pack = comparePack(before, payload, EDIT_ACTIONS.simplify.why, EDIT_ACTIONS.simplify.benefit);
  ok('compare: pack carries before + change summary + why + benefit', pack.before.answer.length > 0 && /answer: revised/.test(pack.change_summary) && pack.why.length > 10 && pack.expected_benefit.length > 10);
  ok('compare: unchanged fields say so', /question: unchanged/.test(pack.change_summary));
  const s1 = changeSummary(before, payload), s2 = changeSummary(before, payload);
  ok('compare: change summary is deterministic', s1 === s2);
}

// ═══ 5. sanitizer id discipline ═══
{
  const dirty = sanitizeEditPayload({
    faqs_edit: [{ id: 'f1', question: 'Q', answer: 'A' }, { id: 'ghost', question: 'X', answer: 'Y' }],
    posts_edit: [{ id: 'p1', title: 'T', body_md: 'B' }, { id: 'phantom', title: 'X', body_md: 'Y' }],
  }, 'edit_faq', FACTS);
  ok('sanitize: only EXISTING faq ids survive (never invents entities)', dirty.faqs_edit?.length === 1 && dirty.faqs_edit[0].id === 'f1');
  ok('sanitize: posts_edit ignored on edit_faq kind (closed shape per kind)', !dirty.posts_edit);
  const forPost = sanitizeEditPayload({ posts_edit: [{ id: 'p1', title: 'T', body_md: 'B' }] }, 'edit_post', FACTS);
  ok('sanitize: edit_post keeps only real post ids', forPost.posts_edit?.length === 1);
}

// ═══ 6. in-place composition — improves, never appends ═══
{
  const current = {
    identity: { business_name: 'Marlow’s Kitchen', description: 'Old words.', phone: '(213) 555-0140' },
    locations: [{ address_line1: '2114 Sunset Blvd', city: 'LA', region: 'CA', postal_code: '90026', country: 'US', timezone: 'America/Los_Angeles', hours: [] }],
    settings: {}, offerings: [{ id: 'o1', name: 'Rye Gnocchi', category: 'Mains', price_text: '$24', description: 'old desc' }],
    testimonials: [], faqs: [{ id: 'f1', question: 'Old q?', answer: 'Old a.' }, { id: 'f2', question: 'Keep?', answer: 'Yes.' }],
    posts: [{ id: 'p1', title: 'Old title', slug: 'old', body_md: 'Old body', published_at: '2026-07-01T00:00:00Z' }], redirects: [],
  };
  const merged = composeMerged(current, {
    faqs_edit: [{ id: 'f1', question: 'Better q?', answer: 'Better a.' }],
    posts_edit: [{ id: 'p1', title: 'Better title', body_md: 'Better body' }],
    offering_descriptions: [{ id: 'o1', description: 'better desc' }],
    identity: { description: 'Better words.' },
  }, null);
  ok('compose: faq improved IN PLACE — count unchanged, same id', merged.faqs.length === 2 && merged.faqs[0].id === 'f1' && merged.faqs[0].answer === 'Better a.' && merged.faqs[1].answer === 'Yes.');
  ok('compose: post improved in place — slug and date preserved', merged.posts.length === 1 && merged.posts[0].slug === 'old' && merged.posts[0].title === 'Better title' && merged.posts[0].published_at === '2026-07-01T00:00:00Z');
  ok('compose: offering + identity improved, facts intact', merged.offerings[0].description === 'better desc' && merged.identity.phone === '(213) 555-0140');
  const edited = composeMerged(current, { faqs_edit: [{ id: 'f1', question: 'Model q', answer: 'Model a' }] }, { faqs_edit: [{ id: 'f1', question: 'Customer rewrote it', answer: 'Entirely.' }] });
  ok('compose: customer edits win entirely over the model’s edit', edited.faqs[0].question === 'Customer rewrote it');
}

// ═══ 7. integration (staging — real edit, in place, reversible) ═══
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

  // a known faq to improve (create, then edit, then clean up)
  const seed = await call('POST', '/faqs', { question: 'Can I book the patio for events?', answer: 'yes we do events sometimes just call us and ask about it and we will see what we can do for you' });
  const faqId = seed.json?.data?.id;
  const beforeText = seed.json?.data?.answer;

  const gen = await call('POST', '/editor/improve', { kind: 'edit_faq', action: 'simplify', target_id: faqId });
  if (gen.status === 503) {
    ok('integration: without a key the editor refuses honestly', gen.json?.error === 'editor_unavailable');
    await call('DELETE', `/faqs/${faqId}`);
  } else {
    ok('integration: real improvement stores a proposal', gen.status === 200 && gen.json?.data?.ok === true && gen.json.data.options >= 1, `options=${gen.json?.data?.options} dropped=${gen.json?.data?.dropped_options}`);
    const draft = await call('GET', `/writer/drafts/${gen.json.data.draft_id}`);
    const opt0 = draft.json?.data?.options?.[0];
    ok('integration: options carry the compare pack (before/after/summary/why/benefit)',
      !!opt0?.compare?.before?.answer && !!opt0?.compare?.change_summary && !!opt0?.compare?.why && !!opt0?.compare?.expected_benefit,
      opt0?.compare?.change_summary);
    ok('integration: the guard passed the faithful edit', opt0?.fact_guard?.ok === true);

    const beforeCount = (await call('GET', '/faqs')).json?.data?.length;
    const accept = await call('POST', `/writer/drafts/${gen.json.data.draft_id}/accept`, { option: 0 });
    const after = await call('GET', '/faqs');
    const editedRow = (after.json?.data || []).find((f) => f.id === faqId);
    ok('integration: acceptance improved the SAME faq in place (no append)',
      accept.status === 200 && after.json?.data?.length === beforeCount && !!editedRow && editedRow.answer !== beforeText,
      `“${(editedRow?.answer || '').slice(0, 70)}…”`);
    // reversible: restore the original text by hand (manual parity)
    await call('PATCH', `/faqs/${faqId}`, { answer: beforeText });
    const restored = (await call('GET', '/faqs')).json?.data?.find((f) => f.id === faqId);
    ok('integration: fully reversible by hand', restored?.answer === beforeText);
    await call('DELETE', `/faqs/${faqId}`);
  }
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ AI EDITOR: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
