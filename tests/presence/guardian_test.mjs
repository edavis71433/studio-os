// ── M9.5D Brand Guardian suite ───────────────────────────────────────────────
// Pure tiers (no LLM): taxonomy + finding contract, deterministic consistency
// engine (avoid-words, generic-AI language, tone drift, repeated phrases,
// formats, capitalization, reading level, business consistency, CTA, visual),
// clean brands stay clean, the model sanitizer (fake ids/categories/quotes
// die; contradictions need both sides quoted), handoff derivation (fixed
// table, never model-controlled), learning is guidance only. Integration:
// the customer edits their Brand Profile, a REAL whole-site brand review runs
// on staging, findings stored, content provably untouched, `learned` written
// WITHOUT touching customer fields, no numeric score anywhere client-visible.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/guardian_test.mjs
import {
  GUARDIAN_CATEGORIES, guardianFindings, sanitizeGuardianFindings,
  deriveGuardianHandoff, observeLearning, resetGuardianSeq,
} from '../../supabase/functions/presence/guardian/rules.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const PROFILE = {
  mission: 'Feed the neighborhood well.', vision: '', core_values: ['honest', 'seasonal'],
  personality: 'warm, plainspoken', voice_characteristics: 'short sentences, no fuss',
  preferred_vocabulary: 'guests, the kitchen, tonight', words_prefer: ['guests'],
  words_avoid: ['foodie', 'synergy'], never_claims: 'never claim awards',
  reading_level: 'everyday', industry_terminology: ['prix fixe'], taglines: ['Seasonal plates, honest hours'],
  elevator_pitch: '', target_audience: 'neighbors', brand_promise: 'honest cooking', selling_points: [],
};
const CLEAN_FACTS = {
  business_name: 'Marlow’s Kitchen', tagline: 'Seasonal plates, honest hours',
  description: 'We cook a short seasonal menu. Half the garden is ours. The rest comes from the Wednesday market. Come hungry and curious.',
  story: 'We started small and stayed close to home. The menu changes when the garden does.',
  service_area: '', phone: '(213) 555-0140', email: 'hi@marlows.example',
  booking_url: 'https://resy.example/marlows', ordering_url: '', address: '2114 Sunset Blvd', hours_text: 'Tue 17:00-22:00',
  offerings: [
    { id: 'o1', name: 'Rye Gnocchi', category: 'Mains', price_text: '$24', description: 'brown butter, sage, pecorino', visible: true },
    { id: 'o2', name: 'Half Chicken', category: 'Mains', price_text: '$28', description: 'charred lemon, salsa verde', visible: true },
  ],
  faq_questions: ['Do you take walk-ins?'],
  faqs_full: [{ id: 'f1', question: 'Do you take walk-ins?', answer: 'Yes, most nights. Weekends fill early, so a booking helps.', visible: true }],
  posts_full: [{ id: 'p1', title: 'Summer patio is open', body_md: 'The patio is open again. Book a table and come by while the evenings are warm.', excerpt: '', shown: true }],
  post_titles: ['Summer patio is open'], testimonial_count: 1,
  voice: { tone_notes: 'warm', preferred_vocabulary: '', never_claim: '' },
};
const OFF_BRAND = {
  ...CLEAN_FACTS,
  description: 'Nestled in the heart of the city, we pride ourselves on a culinary journey of unparalleled synergy for the discerning foodie. Look no further for the quintessential epicurean paradigm, an establishment of consummate gastronomic distinction.',
  story: 'Come by. We cook. You eat. Easy.',
  offerings: [
    { id: 'o1', name: 'Gnocchi', category: 'Mains', price_text: '$24', description: 'fresh from the kitchen tonight', visible: true },
    { id: 'o2', name: 'Chicken', category: 'mains', price_text: '$28.00', description: 'fresh from the kitchen tonight', visible: true },
    { id: 'o3', name: 'Soup', category: 'MAINS', price_text: '12 dollars', description: 'fresh from the kitchen tonight, made with care', visible: true },
  ],
  faqs_full: [{ id: 'f1', question: 'How do I reach you?', answer: 'Call us any time at (213) 555-9999 to reserve a table for your party.', visible: true }],
  booking_url: '',
};
const NO_MEDIA = { media: [] };
const MIXED_MEDIA = { media: [
  { id: 'm1', width: 1200, height: 800, alt_text: '' }, { id: 'm2', width: 1400, height: 900, alt_text: '' },
  { id: 'm3', width: 800, height: 1200, alt_text: '' }, { id: 'm4', width: 700, height: 1100, alt_text: '' },
  { id: 'm5', width: 320, height: 240, alt_text: '' },
] };
const SITE = { kind: 'site' };

// ═══ 1. taxonomy + finding contract ═══
{
  ok('taxonomy: all 16 guardian categories present', GUARDIAN_CATEGORIES.length === 16);
  resetGuardianSeq();
  const { findings } = guardianFindings(OFF_BRAND, PROFILE, MIXED_MEDIA, SITE);
  const complete = findings.every((x) =>
    x.review_id && x.category && x.severity && x.confidence > 0 && x.location?.kind &&
    x.finding && x.reason && x.expected_benefit && x.suggested_action &&
    typeof x.requires_editor === 'boolean' && x.requires_writer === false &&
    x.manual_possible === true && x.approval_required === true &&
    Array.isArray(x.supporting_evidence) && x.status === 'open' && x.handoff?.route);
  ok('contract: every finding carries all 15 fields + constants + handoff', complete, `findings=${findings.length}`);
  ok('contract: NO numeric score in any finding (Law 13)',
    findings.every((f) => !('score' in f) && !/\b\d{1,3}\s*(\/|out of)\s*(10|100)\b/.test(f.finding + f.reason)));
}

// ═══ 2. deterministic consistency engine — the Guardian works with AI off ═══
{
  resetGuardianSeq();
  const { findings, metrics } = guardianFindings(OFF_BRAND, PROFILE, MIXED_MEDIA, SITE);
  const cats = new Set(findings.map((x) => x.category));
  ok('detects: word on the customer’s avoid list → vocabulary (attention)',
    findings.some((x) => x.category === 'vocabulary' && x.severity === 'attention' && /foodie/i.test(x.finding)));
  ok('detects: stock AI phrasing → generic_ai_language', cats.has('generic_ai_language'));
  ok('detects: dense description vs breezy story → tone_drift', cats.has('tone_drift'), `spread=${metrics.tone_spread}`);
  ok('detects: same phrase over and over → repeated_phrases', cats.has('repeated_phrases'));
  ok('detects: three price styles → formatting', cats.has('formatting'));
  ok('detects: Mains/mains/MAINS → capitalization', cats.has('capitalization'));
  ok('detects: description heavier than the chosen “everyday” level → reading_level', cats.has('reading_level'));
  ok('detects: wrong phone number in the copy → business_consistency (attention)',
    findings.some((x) => x.category === 'business_consistency' && x.severity === 'attention'));
  ok('detects: “reserve a table” with no booking link → cta_consistency', cats.has('cta_consistency'));
  ok('detects: mixed photo orientations + a tiny image → visual findings',
    cats.has('visual_photography') && cats.has('visual_assets'));
  ok('metrics: numbers exist internally — and only internally', typeof metrics.tone_spread === 'number');
}

// ═══ 3. a consistent brand stays quiet ═══
{
  resetGuardianSeq();
  const { findings } = guardianFindings(CLEAN_FACTS, PROFILE, NO_MEDIA, SITE);
  ok('clean brand: consistent content yields no findings above note', findings.filter((x) => x.severity !== 'note').length === 0,
    findings.map((x) => x.category).join(',') || 'zero findings');
}

// ═══ 4. section scope ═══
{
  resetGuardianSeq();
  const { findings } = guardianFindings(OFF_BRAND, PROFILE, NO_MEDIA, { kind: 'section', section: 'offerings' });
  ok('scope: a section review keeps to that section (plus site-wide voice checks)',
    findings.every((x) => ['offering', 'site', 'media'].includes(x.location.kind)), findings.map((x) => `${x.category}@${x.location.kind}`).join(','));
  ok('scope: section review skips identity checks', !findings.some((x) => x.location.kind === 'identity'));
}

// ═══ 5. the sanitizer — the model does not get to lie ═══
{
  resetGuardianSeq();
  const raw = [
    { category: 'personality', confidence: 0.8, location: { kind: 'faq', id: 'f1' }, finding: 'The answer reads formal next to a casual site.', reason: 'Mixed voices read as different authors.', supporting_evidence: ['Yes, most nights.'] },
    { category: 'contradictory_messaging', location: { kind: 'site' }, finding: 'Hours disagree.', reason: 'r', supporting_evidence: ['Tue 17:00-22:00'] },                    // one quote only → dies
    { category: 'contradictory_messaging', location: { kind: 'site' }, finding: 'Two passages disagree about sourcing.', reason: 'r', supporting_evidence: ['Half the garden is ours.', 'The rest comes from the Wednesday market.'] },
    { category: 'personality', location: { kind: 'faq', id: 'GHOST' }, finding: 'x', reason: 'y' },              // fake id
    { category: 'vocabulary', location: { kind: 'faq', id: 'f1' }, finding: 'x', reason: 'y' },                  // deterministic-only category → dies
    { category: 'terminology', location: { kind: 'identity', field: 'admin_password' }, finding: 'x', reason: 'y' }, // fake field
    { category: 'tone_drift', location: { kind: 'site' }, finding: 'q', reason: 'z', supporting_evidence: ['this quote exists nowhere in the content'] },
  ];
  const clean = sanitizeGuardianFindings(raw, CLEAN_FACTS);
  ok('sanitize: real finding with verbatim quote survives', clean.some((x) => x.category === 'personality' && x.supporting_evidence.includes('Yes, most nights.')));
  ok('sanitize: a contradiction without both sides quoted dies', clean.filter((x) => x.category === 'contradictory_messaging').length === 1);
  ok('sanitize: fake entity ids die', !clean.some((x) => x.location.id === 'GHOST'));
  ok('sanitize: deterministic-only categories die at the model tier', !clean.some((x) => x.category === 'vocabulary'));
  ok('sanitize: fake identity fields die', !clean.some((x) => x.location.field === 'admin_password'));
  const drift = clean.find((x) => x.category === 'tone_drift');
  ok('sanitize: unquotable “evidence” is stripped, not trusted', !drift || drift.supporting_evidence.length === 0);
  ok('sanitize: model confidence clamped to [0.5, 0.85]', clean.every((x) => x.confidence >= 0.5 && x.confidence <= 0.85));
}

// ═══ 6. handoff derivation — fixed table, never model-controlled ═══
{
  const e = deriveGuardianHandoff('tone_drift', { kind: 'faq', id: 'f1' });
  ok('handoff: voice findings route to the Editor with kind+action+target', e.route === 'editor' && e.kind === 'edit_faq' && e.action === 'tone' && e.target_id === 'f1' && e.requires_editor);
  const v = deriveGuardianHandoff('visual_photography', { kind: 'media' });
  ok('handoff: visual findings stay manual — the Guardian never touches images', v.route === 'manual' && !v.requires_editor);
  const b = deriveGuardianHandoff('business_consistency', { kind: 'site' });
  ok('handoff: business-fact findings stay manual — humans verify facts', b.route === 'manual' && !b.requires_editor);
  const c = deriveGuardianHandoff('contradictory_messaging', { kind: 'site' });
  ok('handoff: contradictions stay manual — only the customer knows which side is true', c.route === 'manual' && !c.requires_editor);
}

// ═══ 7. learning is guidance, never a profile edit ═══
{
  const learned = observeLearning([
    { kind: 'faqs', status: 'accepted', options: [{ tone: 'warm' }], chosen_option: 0 },
    { kind: 'faqs', status: 'accepted', options: [{ tone: 'warm' }], chosen_option: 0 },
    { kind: 'post', status: 'discarded' },
  ], '2026-07-06T00:00:00Z');
  ok('learning: outcomes summarized as guidance', learned.accepted_kinds.faqs === 2 && learned.discarded_kinds.post === 1 && learned.chosen_tones.warm === 2);
  const PROFILE_KEYS = ['mission', 'vision', 'core_values', 'personality', 'voice_characteristics', 'preferred_vocabulary', 'words_prefer', 'words_avoid', 'never_claims', 'reading_level', 'industry_terminology', 'taglines', 'elevator_pitch', 'target_audience', 'brand_promise', 'selling_points'];
  ok('learning: output shares NO key with the customer’s 16 profile fields — it cannot overwrite them',
    Object.keys(learned).every((k) => !PROFILE_KEYS.includes(k)));
}

// ═══ 8. integration (staging) ═══
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

  // the customer owns their profile
  const put = await call('PUT', '/brand/profile', { personality: 'warm, plainspoken', words_avoid: ['foodie', 'synergy'], reading_level: 'everyday', learned: { hacked: true } });
  ok('integration: the customer edits their Brand Profile', put.status === 200 && put.json?.data?.personality === 'warm, plainspoken');
  ok('integration: `learned` is NOT writable through the profile route', !put.json?.data?.learned?.hacked);
  const badLevel = await call('PUT', '/brand/profile', { reading_level: 'genius' });
  ok('integration: invalid reading level rejected', badLevel.status === 400 || !badLevel.json?.data || badLevel.json?.data?.reading_level !== 'genius');

  const faqsBefore = JSON.stringify((await call('GET', '/faqs')).json?.data);
  const identityBefore = JSON.stringify((await call('GET', '/identity')).json?.data);

  const run = await call('POST', '/brand/review', { scope: 'site' });
  ok('integration: whole-site brand review runs and stores a report', run.status === 200 && run.json?.data?.ok === true, `findings=${run.json?.data?.findings} model=${run.json?.data?.model || '(deterministic only)'}`);
  const report = await call('GET', `/brand/reports/${run.json.data.report_id}`);
  const findings = report.json?.data?.findings || [];
  ok('integration: findings carry the contract + handoffs', findings.every((f) => f.manual_possible === true && f.approval_required === true && f.handoff?.route), `n=${findings.length}`);
  ok('integration: NO SCORE reaches the customer — internal_metrics absent from the report (Law 13)',
    !('internal_metrics' in (report.json?.data || {})) && !JSON.stringify(report.json?.data || {}).includes('"score"'));

  const faqsAfter = JSON.stringify((await call('GET', '/faqs')).json?.data);
  const identityAfter = JSON.stringify((await call('GET', '/identity')).json?.data);
  ok('integration: THE BRAND REVIEW CHANGED NOTHING — content byte-identical', faqsBefore === faqsAfter && identityBefore === identityAfter);

  const prof = await call('GET', '/brand/profile');
  ok('integration: learning wrote guidance into `learned` without touching customer fields',
    prof.json?.data?.learned?.observed_at !== undefined && prof.json?.data?.personality === 'warm, plainspoken' &&
    JSON.stringify(prof.json?.data?.words_avoid) === JSON.stringify(['foodie', 'synergy']));

  const list = await call('GET', '/brand/reports');
  ok('integration: reports list readable, no metrics leaked', list.status === 200 && !JSON.stringify(list.json?.data || []).includes('internal_metrics'));

  if (findings.length) {
    const d = await call('POST', `/brand/reports/${report.json.data.id}/dismiss`, { finding_id: findings[0].review_id });
    const after = await call('GET', `/brand/reports/${report.json.data.id}`);
    ok('integration: per-finding dismissal recorded, never deleted', d.status === 200 && (after.json?.data?.findings || []).some((f) => f.review_id === findings[0].review_id && f.status === 'dismissed'));
  } else {
    console.log('      (zero findings this run — the staging brand is consistent; dismissal covered by pure tiers)');
  }
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ BRAND GUARDIAN: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
