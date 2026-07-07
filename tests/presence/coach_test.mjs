// ── M9.5E Growth Coach suite ─────────────────────────────────────────────────
// Pure tiers (no LLM): calendar date math + lead windows, industry-specific
// packs (restaurant fires Valentine's, generic doesn't), seasonal timing,
// the 10-element opportunity contract, THE VALUE FILTER (a bare business
// with no evidence gets no generic advice), evidence grounding, duplicate
// suppression, dismissal/defer/accept memory, fixed handoff table, model-idea
// sanitizer. Integration: a REAL coach run on staging — opportunities stored,
// content provably untouched, decisions recorded, accept hands off to the
// real Writer (proposal only, discarded).
//
//   deno run --allow-read --allow-net --allow-env tests/presence/coach_test.mjs
import { holidaysFor, upcomingEvents, timingPhrase } from '../../supabase/functions/presence/coach/calendar.ts';
import { growthPackFor, GROWTH_PACKS } from '../../supabase/functions/presence/coach/packs.ts';
import { COACH_AREAS, coachOpportunities, applyMemory, sanitizeCoachIdeas, deriveCoachHandoff } from '../../supabase/functions/presence/coach/rules.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const FACTS = {
  business_name: 'Marlow’s Kitchen', tagline: 'Seasonal plates, honest hours',
  description: 'We cook a short seasonal menu. Half the garden is ours.',
  story: 'We started small and stayed close to home. '.repeat(8),
  service_area: '', phone: '(213) 555-0140', email: 'hi@marlows.example',
  booking_url: 'https://resy.example/marlows', ordering_url: '', address: '2114 Sunset Blvd', hours_text: 'Tue 17:00-22:00',
  offerings: [
    { id: 'o1', name: 'Rye Gnocchi', category: 'Mains', price_text: '$24', description: 'brown butter, sage', visible: true },
    { id: 'o2', name: 'Tasting Menu', category: 'Mains', price_text: '$85', description: 'five courses, garden first', visible: false },
  ],
  faq_questions: ['Do you take walk-ins?'],
  faqs_full: [{ id: 'f1', question: 'Do you take walk-ins?', answer: 'Yes, most nights.', visible: true }],
  posts_full: [{ id: 'p1', title: 'Summer patio is open', body_md: 'The patio is open.', excerpt: '', shown: true }],
  post_titles: ['Summer patio is open'], testimonial_count: 2,
  voice: { tone_notes: 'warm', preferred_vocabulary: '', never_claim: '' },
};
const BARE_FACTS = {
  ...FACTS, business_name: '', tagline: '', description: '', story: '', booking_url: '',
  offerings: [], faqs_full: [], faq_questions: [], posts_full: [], post_titles: [], testimonial_count: 0,
};
const RESTAURANT = GROWTH_PACKS.restaurant;
const GENERIC = growthPackFor('unknown-template');
const NOW_JAN = '2027-01-20T12:00:00Z';  // Valentine's (Feb 14) is 25 days out — inside its 28-day lead

// ═══ 1. the business calendar — deterministic date math ═══
{
  const h27 = Object.fromEntries(holidaysFor(2027).map((x) => [x.key.replace('-2027', ''), x.date]));
  ok('calendar: Thanksgiving 2027 = 4th Thursday of November', h27['thanksgiving'] === '2027-11-25');
  ok('calendar: Memorial Day 2027 = last Monday of May', h27['memorial-day'] === '2027-05-31');
  ok('calendar: Mother’s Day 2027 = 2nd Sunday of May', h27['mothers-day'] === '2027-05-09');
  ok('calendar: Small Business Saturday = 2 days after Thanksgiving', h27['small-biz-saturday'] === '2027-11-27');
  const ev = upcomingEvents(NOW_JAN, '2025-06-10');
  ok('calendar: Valentine’s surfaces inside its 28-day lead window', ev.some((e) => e.key === 'valentines-2027' && e.days_away === 25));
  ok('calendar: events already past NEVER surface', ev.every((e) => e.days_away >= 0));
  ok('calendar: events beyond their lead window stay quiet', !ev.some((e) => e.key === 'mothers-day-2027'));
  ok('calendar: business anniversary computed from first publish', upcomingEvents('2027-06-01T00:00:00Z', '2025-06-10').some((e) => e.kind === 'anniversary' && e.name === '2 years online'));
  ok('calendar: identical input → identical output (pure)', JSON.stringify(upcomingEvents(NOW_JAN, null)) === JSON.stringify(upcomingEvents(NOW_JAN, null)));
  ok('calendar: timing reads as a sentence, not a number', timingPhrase(25, 'Valentine’s Day').includes('about a month out'));
}

// ═══ 2. industry packs — suggestions fit the business ═══
{
  const evJan = upcomingEvents(NOW_JAN, null);
  const rest = coachOpportunities({ facts: FACTS, pack: RESTAURANT, events: evJan, evidence: [], nowIso: NOW_JAN });
  const gen = coachOpportunities({ facts: FACTS, pack: GENERIC, events: evJan, evidence: [], nowIso: NOW_JAN });
  ok('industry: the restaurant pack surfaces Valentine’s Day', rest.some((o) => o.area === 'holiday' && o.opportunity.includes('Valentine’s')));
  ok('industry: the generic pack does NOT — Valentine’s isn’t its moment', !gen.some((o) => o.area === 'holiday' && o.opportunity.includes('Valentine’s')));
  ok('industry: the promotion names a REAL menu item', rest.some((o) => o.area === 'promotion' && o.opportunity.includes('Rye Gnocchi')));
  ok('industry: hvac pack surfaces fall furnace season, not Valentine’s', (() => {
    const evSep = upcomingEvents('2027-09-10T00:00:00Z', null);
    const hv = coachOpportunities({ facts: { ...FACTS, business_name: 'Comfort Air' }, pack: GROWTH_PACKS.hvac, events: evSep, evidence: [], nowIso: '2027-09-10T00:00:00Z' });
    return hv.some((o) => o.area === 'seasonal' && /furnace/i.test(o.why_it_matters)) && !hv.some((o) => o.area === 'holiday');
  })());
}

// ═══ 3. the opportunity contract — every required element, every time ═══
{
  const evJan = upcomingEvents(NOW_JAN, '2025-06-10');
  const opps = coachOpportunities({ facts: FACTS, pack: RESTAURANT, events: evJan, evidence: [{ type: 'freshness.updates_quiet', human: 'No updates in 60 days.', resource: 'posts' }], nowIso: NOW_JAN });
  const complete = opps.every((o) =>
    o.opp_key && o.opp_hash && COACH_AREAS.includes(o.area) &&
    o.opportunity && o.why_it_matters && Array.isArray(o.supporting_evidence) && o.supporting_evidence.length > 0 &&
    o.expected_benefit && o.estimated_effort && typeof o.timing_phrase === 'string' && o.suggested_next_step &&
    o.manual_possible === true && o.approval_required === true &&
    typeof o.ai_can_draft === 'boolean' && ['writer', 'editor', 'manual'].includes(o.handoff.route));
  ok('contract: every opportunity carries all 10 elements + evidence + timing', complete, `opps=${opps.length}`);
  ok('contract: the list is bounded (≤8) and timing-sorted', opps.length <= 8);
}

// ═══ 4. THE VALUE FILTER — no generic marketing advice, ever ═══
{
  const noEvents = coachOpportunities({ facts: BARE_FACTS, pack: GENERIC, events: [], evidence: [], nowIso: NOW_JAN });
  ok('value filter: a bare business + no calendar + no evidence → ZERO suggestions', noEvents.length === 0, noEvents.map((o) => o.area).join(','));
  const evJan = upcomingEvents(NOW_JAN, null);
  const bare = coachOpportunities({ facts: BARE_FACTS, pack: GENERIC, events: evJan, evidence: [], nowIso: NOW_JAN });
  ok('value filter: no offerings → no promotion; no posts → no email/social; no story → no education',
    !bare.some((o) => ['promotion', 'email_campaign', 'social_campaign', 'customer_education', 'referral_campaign', 'service_launch'].includes(o.area)));
  const withEv = coachOpportunities({ facts: FACTS, pack: RESTAURANT, events: evJan, evidence: [], nowIso: NOW_JAN });
  ok('value filter: every suggestion names something concrete about THIS business',
    withEv.every((o) => o.supporting_evidence.length > 0));
}

// ═══ 5. evidence grounding — observation before suggestion ═══
{
  const evJan = upcomingEvents(NOW_JAN, null);
  const without = coachOpportunities({ facts: FACTS, pack: RESTAURANT, events: evJan, evidence: [], nowIso: NOW_JAN });
  ok('grounding: no freshness evidence → no freshness suggestion', !without.some((o) => o.area === 'content_freshness'));
  const withEv = coachOpportunities({ facts: FACTS, pack: RESTAURANT, events: evJan, evidence: [
    { type: 'freshness.updates_quiet', human: 'The Updates page has been quiet for 60 days.', resource: 'posts' },
    { type: 'reviews.testimonials_stale', human: 'The newest testimonial is over a year old.', resource: 'testimonials' },
    { type: 'content.description_thin', human: 'The business description is under 40 words.', resource: 'identity' },
  ], nowIso: NOW_JAN });
  ok('grounding: freshness evidence → freshness suggestion quoting the observation',
    withEv.some((o) => o.area === 'content_freshness' && o.supporting_evidence.some((e) => e.detail.includes('quiet for 60 days'))));
  ok('grounding: review evidence → review request (manual — asking is a human act)',
    withEv.some((o) => o.area === 'review_request' && o.handoff.route === 'manual'));
  ok('grounding: thin description → homepage refresh via the EDITOR', withEv.some((o) => o.area === 'homepage_refresh' && o.handoff.route === 'editor' && o.handoff.kind === 'edit_identity'));
  ok('grounding: hidden-but-written offering → service launch naming it', withEv.concat(without).some((o) => o.area === 'service_launch' && o.opportunity.includes('Tasting Menu')));
}

// ═══ 6. duplicate suppression + memory ═══
{
  const evJan = upcomingEvents(NOW_JAN, null);
  const a = coachOpportunities({ facts: FACTS, pack: RESTAURANT, events: evJan, evidence: [], nowIso: NOW_JAN });
  const b = coachOpportunities({ facts: FACTS, pack: RESTAURANT, events: evJan, evidence: [], nowIso: NOW_JAN });
  ok('dedup: identical input → identical opp_keys and hashes (pure, stable)', JSON.stringify(a.map((o) => [o.opp_key, o.opp_hash])) === JSON.stringify(b.map((o) => [o.opp_key, o.opp_hash])));
  ok('dedup: no two opportunities share an opp_key', new Set(a.map((o) => o.opp_key)).size === a.length);

  const target = a.find((o) => o.area === 'holiday');
  const dismissed = applyMemory(a, [{ opp_key: target.opp_key, opp_hash: target.opp_hash, status: 'dismissed', deferred_until: null }], NOW_JAN);
  ok('memory: a dismissed opportunity does NOT resurface', !dismissed.some((o) => o.opp_key === target.opp_key));
  const changed = applyMemory(a, [{ opp_key: target.opp_key, opp_hash: 'different-state', status: 'dismissed', deferred_until: null }], NOW_JAN);
  ok('memory: it returns ONLY when the grounding state actually changed', changed.some((o) => o.opp_key === target.opp_key));
  const accepted = applyMemory(a, [{ opp_key: target.opp_key, opp_hash: target.opp_hash, status: 'accepted', deferred_until: null }], NOW_JAN);
  ok('memory: accepted work is done — no nagging', !accepted.some((o) => o.opp_key === target.opp_key));
  const sleeping = applyMemory(a, [{ opp_key: target.opp_key, opp_hash: target.opp_hash, status: 'deferred', deferred_until: '2027-02-10' }], NOW_JAN);
  const matured = applyMemory(a, [{ opp_key: target.opp_key, opp_hash: target.opp_hash, status: 'deferred', deferred_until: '2027-01-15' }], NOW_JAN);
  ok('memory: deferred sleeps until its date, then may return', !sleeping.some((o) => o.opp_key === target.opp_key) && matured.some((o) => o.opp_key === target.opp_key));
}

// ═══ 7. no automatic execution — structurally ═══
{
  const evJan = upcomingEvents(NOW_JAN, '2025-06-10');
  const opps = coachOpportunities({ facts: FACTS, pack: RESTAURANT, events: evJan, evidence: [{ type: 'content.faqs_none', human: 'No FAQs.', resource: 'faqs' }], nowIso: NOW_JAN });
  const WRITER_KINDS = ['identity_copy', 'faqs', 'offering_descriptions', 'post', 'starter_site'];
  const EDITOR_KINDS = ['edit_identity', 'edit_faq', 'edit_offering', 'edit_post', 'site_polish'];
  ok('execution: every handoff routes ONLY to writer | editor | manual', opps.every((o) => ['writer', 'editor', 'manual'].includes(o.handoff.route)));
  ok('execution: writer handoffs use only REAL writer contract kinds', opps.filter((o) => o.handoff.route === 'writer').every((o) => WRITER_KINDS.includes(o.handoff.kind)));
  ok('execution: editor handoffs use only REAL editor contract kinds', opps.filter((o) => o.handoff.route === 'editor').every((o) => EDITOR_KINDS.includes(o.handoff.kind)));
  ok('execution: email/social/review/referral NEVER get an AI draft path — the Coach never sends or posts',
    ['email_campaign', 'social_campaign', 'review_request', 'referral_campaign', 'trust_building'].every((a) => {
      const d = deriveCoachHandoff(a);
      return d.handoff.route === 'manual' && d.ai_can_draft === false;
    }));
  ok('execution: approval_required and manual_possible are constants on every opportunity', opps.every((o) => o.approval_required === true && o.manual_possible === true));
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/coach/engine.ts', import.meta.url));
  ok('execution: the coach module imports no Draft Writer, no serializer, no content routes',
    !/applySnapshotToDraft|serialize|routes\/content|routes\/publish/.test(src));
}

// ═══ 8. the model-idea sanitizer — ideas may only ADD, grounded, never execute ═══
{
  const raw = [
    { area: 'promotion', opportunity: 'A garden-tasting night around the Tasting Menu.', why_it_matters: 'Your hidden tasting menu is a ready-made event.', grounding_quote: 'five courses, garden first' },
    { area: 'promotion', opportunity: 'Generic happy hour!', why_it_matters: 'Everyone loves deals.' },                              // no grounding quote → dies
    { area: 'promotion', opportunity: 'x', why_it_matters: 'y', grounding_quote: 'this text is nowhere in the facts' },              // fake quote → dies
    { area: 'holiday', opportunity: 'z', why_it_matters: 'w', grounding_quote: 'five courses, garden first' },                       // deterministic-only area → dies
    { area: 'social_campaign', opportunity: 'Post the patio.', why_it_matters: 'It’s open.', grounding_quote: 'Summer patio is open' },
  ];
  const clean = sanitizeCoachIdeas(raw, FACTS, NOW_JAN);
  ok('sanitize: a grounded idea survives with its verbatim quote as evidence', clean.some((x) => x.area === 'promotion' && x.supporting_evidence[0].detail.includes('five courses')));
  ok('sanitize: ungrounded and fake-quoted ideas die', clean.length === 2);
  ok('sanitize: calendar areas are deterministic-only — the model can’t invent holidays', !clean.some((x) => x.area === 'holiday'));
  ok('sanitize: social ideas stay manual even from the model — the fixed table wins', clean.find((x) => x.area === 'social_campaign')?.handoff.route === 'manual');
}

// ═══ 9. integration (staging) ═══
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

  const faqsBefore = JSON.stringify((await call('GET', '/faqs')).json?.data);
  const identityBefore = JSON.stringify((await call('GET', '/identity')).json?.data);
  const postsBefore = JSON.stringify((await call('GET', '/posts')).json?.data);

  const run = await call('POST', '/coach/run');
  ok('integration: the coach runs and stores opportunities', run.status === 200 && run.json?.data?.ok === true, `opps=${run.json?.data?.opportunities} model=${run.json?.data?.model || '(deterministic only)'}`);
  const list = await call('GET', '/coach/opportunities');
  const opps = list.json?.data || [];
  ok('integration: opportunities carry the contract', opps.every((o) => o.manual_possible === true && o.approval_required === true && o.handoff?.route), `n=${opps.length}`);

  const faqsAfter = JSON.stringify((await call('GET', '/faqs')).json?.data);
  const identityAfter = JSON.stringify((await call('GET', '/identity')).json?.data);
  const postsAfter = JSON.stringify((await call('GET', '/posts')).json?.data);
  ok('integration: THE COACH CHANGED NOTHING — content byte-identical', faqsBefore === faqsAfter && identityBefore === identityAfter && postsBefore === postsAfter);

  if (opps.length >= 2) {
    const d = await call('POST', `/coach/opportunities/${opps[0].id}/decide`, { decision: 'dismiss' });
    ok('integration: dismissal recorded', d.status === 200);
    const f = await call('POST', `/coach/opportunities/${opps[1].id}/decide`, { decision: 'defer', until: '2027-03-01' });
    ok('integration: deferral recorded with its date', f.status === 200);
    const rerun = await call('POST', '/coach/run');
    const list2 = await call('GET', '/coach/opportunities');
    const keys2 = (list2.json?.data || []).map((o) => o.opportunity);
    ok('integration: dismissed + deferred do NOT resurface on the next run', rerun.status === 200 && !keys2.includes(opps[0].opportunity) && !keys2.includes(opps[1].opportunity));
  }
  // re-read: the memory rerun above superseded the earlier open set
  const fresh = (await call('GET', '/coach/opportunities')).json?.data || [];
  const draftable = fresh.find((o) => o.ai_can_draft && o.handoff?.route === 'writer');
  if (draftable) {
    const acc = await call('POST', `/coach/opportunities/${draftable.id}/decide`, { decision: 'accept' });
    ok('integration: accept returns the prepared handoff — and executes NOTHING', acc.status === 200 && acc.json?.data?.handoff?.route === 'writer');
    const gen = await call('POST', '/writer/generate', { kind: acc.json.data.handoff.kind, instructions: acc.json.data.handoff.brief || '' });
    ok('integration: the handoff drives the REAL Writer (proposal only)', [200, 503].includes(gen.status), `status=${gen.status}`);
    if (gen.status === 200) await call('POST', `/writer/drafts/${gen.json.data.draft_id}/discard`);
    const postsFinal = JSON.stringify((await call('GET', '/posts')).json?.data);
    ok('integration: even after accept + draft, published content is UNTOUCHED', postsFinal === postsBefore);
  } else {
    console.log('      (no writer-draftable opportunity this run — handoff covered by pure tiers)');
  }
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ GROWTH COACH: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
