// ── M9.5C AI Reviewer suite ──────────────────────────────────────────────────
// Pure tiers (no LLM): taxonomy + contract constants, deterministic findings
// (whole site / section / entity scopes), false positives on clean content,
// model-finding sanitizer (fake locations/quotes/categories die), handoff
// derivation (the model never controls it), merge discipline. Integration:
// a REAL whole-site review on staging — findings stored, one dismissed,
// content provably untouched, fix-this handoff drives the real Editor.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/reviewer_test.mjs
import { CATEGORIES, CEDED_TO_GUARDIAN, MODEL_CATEGORIES, deterministicFindings, sanitizeModelFindings, mergeFindings, deriveHandoff, resetFindingSeq } from '../../supabase/functions/presence/reviewer/rules.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const RICH = {
  business_name: 'Marlow’s Kitchen', tagline: 'Seasonal plates, honest hours',
  description: 'We cook a short seasonal menu. Half the garden is ours. The rest comes from the Wednesday market.',
  story: 'We started small and stayed close to home.', service_area: '',
  phone: '(213) 555-0140', email: 'hi@marlows.example', booking_url: 'https://resy.example/marlows', ordering_url: '',
  address: '2114 Sunset Blvd', hours_text: 'Tue 17:00-22:00',
  offerings: [
    { id: 'o1', name: 'Rye Gnocchi', category: 'Mains', price_text: '$24', description: 'brown butter, sage, pecorino', visible: true },
    { id: 'o2', name: 'Half Chicken', category: 'Mains', price_text: '$28', description: 'charred lemon, salsa verde', visible: true },
  ],
  faq_questions: ['Do you take walk-ins?'],
  faqs_full: [{ id: 'f1', question: 'Do you take walk-ins?', answer: 'Yes, most nights. Weekends fill early.', visible: true }],
  posts_full: [{ id: 'p1', title: 'Summer patio is open', body_md: '# Patio\n\nThe patio is open. Book a table and come by.', excerpt: '', shown: true }],
  post_titles: ['Summer patio is open'], testimonial_count: 1,
  voice: { tone_notes: 'warm', preferred_vocabulary: '', never_claim: '' },
};
const MESSY = {
  ...RICH,
  description: 'We leverage best-in-class culinary solutions to utilize a cutting-edge paradigm of gastronomic synergy for discerning connoisseurs of elevated dining experiences worldwide.',
  faqs_full: [
    { id: 'f1', question: 'Do you take walk-ins?', answer: 'Yes.', visible: true },
    { id: 'f2', question: 'do you take walk-ins?', answer: 'We do.', visible: true },
  ],
  offerings: [
    { id: 'o1', name: 'Special', category: 'Mains', price_text: '$24', description: '', visible: true },
    { id: 'o2', name: 'Special', category: 'Mains', price_text: '$28', description: '', visible: true },
    { id: 'o3', name: 'Soup', category: 'Starters', price_text: '', description: '', visible: true },
  ],
  posts_full: [{ id: 'p1', title: 'News', body_md: '# News\n\n#### Deep heading skip\n\nClick here to learn more.', excerpt: '', shown: true }],
};
const SCOPE_SITE = { kind: 'site' };

// ═══ 1. taxonomy + contract ═══
{
  ok('taxonomy: all 21 review categories present', CATEGORIES.length === 21);
  resetFindingSeq();
  const f = deterministicFindings(MESSY, SCOPE_SITE);
  const complete = f.every((x) =>
    x.review_id && x.category && x.severity && x.confidence > 0 && x.location?.kind &&
    x.finding && x.reason && x.expected_benefit && x.suggested_action &&
    typeof x.requires_editor === 'boolean' && typeof x.requires_writer === 'boolean' &&
    x.manual_possible === true && x.approval_required === true &&
    Array.isArray(x.supporting_evidence) && x.status === 'open' && x.handoff?.route);
  ok('contract: every finding carries all 15 fields + constants + handoff', complete, `findings=${f.length}`);
}

// ═══ 2. deterministic tier — the reviewer works with AI off ═══
{
  resetFindingSeq();
  const f = deterministicFindings(MESSY, SCOPE_SITE);
  const cats = new Set(f.map((x) => x.category));
  ok('detects: jargon → plain_language', cats.has('plain_language'));
  ok('detects: duplicate questions and duplicate menu items → duplicate_content', f.filter((x) => x.category === 'duplicate_content').length >= 2);
  ok('detects: undescribed items → missing_information', cats.has('missing_information'));
  ok('detects: heading skip in an update → heading_hierarchy', cats.has('heading_hierarchy'));
  ok('detects: weak call to action → cta', cats.has('cta'));
}

// ═══ 3. false positives — clean content stays clean ═══
{
  resetFindingSeq();
  const f = deterministicFindings(RICH, SCOPE_SITE);
  ok('false positives: rich, well-written content yields at most trivial notes', f.filter((x) => x.severity !== 'note').length === 0, f.map((x) => x.category).join(',') || 'zero findings');
}

// ═══ 4. scopes ═══
{
  resetFindingSeq();
  const section = deterministicFindings(MESSY, { kind: 'section', section: 'faqs' });
  ok('scope: section review only inspects that section', section.every((x) => ['faq', 'site'].includes(x.location.kind)), section.map((x) => x.category).join(','));
  resetFindingSeq();
  const entity = deterministicFindings(MESSY, { kind: 'entity', targetId: 'p1' });
  ok('scope: entity review narrows to the one item', entity.every((x) => !x.location.id || x.location.id === 'p1'));
}

// ═══ 5. the sanitizer — the model does not get to lie ═══
{
  const raw = [
    { category: 'readability', severity: 'suggestion', confidence: 0.8, location: { kind: 'faq', id: 'f1' }, finding: 'The answer reads clipped.', reason: 'Short answers can feel brusque.', expected_benefit: 'warmer welcome', suggested_action: 'A friendlier sentence.', supporting_evidence: ['Yes, most nights.'] },
    { category: 'readability', location: { kind: 'faq', id: 'GHOST' }, finding: 'x', reason: 'y' },             // fake id
    { category: 'made_up_category', location: { kind: 'faq', id: 'f1' }, finding: 'x', reason: 'y' },           // fake category
    { category: 'tone', location: { kind: 'faq', id: 'f1' }, finding: 'x', reason: 'y', supporting_evidence: ['Yes, most nights.'] },  // M9.5G: ceded to the Guardian → dies
    { category: 'seo', location: { kind: 'identity', field: 'admin_password' }, finding: 'x', reason: 'y' },    // fake field
    { category: 'trust', location: { kind: 'site' }, finding: 'Reviews say the food is amazing.', reason: 'z', supporting_evidence: ['this quote does not exist anywhere in the content'] },
  ];
  const clean = sanitizeModelFindings(raw, RICH);
  ok('sanitize: real finding with verbatim quote survives', clean.some((x) => x.category === 'readability' && x.supporting_evidence.includes('Yes, most nights.')));
  ok('sanitize: fake entity ids die', !clean.some((x) => x.location.id === 'GHOST'));
  ok('sanitize: unknown categories die', !clean.some((x) => x.category === 'made_up_category'));
  ok('sanitize: brand categories (tone/brand_voice/consistency) are CEDED to the Guardian and die here (M9.5G)',
    !clean.some((x) => CEDED_TO_GUARDIAN.includes(x.category)) && CEDED_TO_GUARDIAN.length === 3 && MODEL_CATEGORIES.length === 18);
  ok('sanitize: fake identity fields die', !clean.some((x) => x.location.field === 'admin_password'));
  const trustFinding = clean.find((x) => x.category === 'trust');
  ok('sanitize: unquotable “evidence” is stripped, not trusted', !trustFinding || trustFinding.supporting_evidence.length === 0);
}

// ═══ 6. handoff derivation — never model-controlled ═══
{
  const e = deriveHandoff('readability', { kind: 'faq', id: 'f1' });
  ok('handoff: prose critiques route to the Editor with the right kind+action', e.route === 'editor' && e.kind === 'edit_faq' && e.action === 'readability' && e.requires_editor && !e.requires_writer);
  const w = deriveHandoff('customer_questions', { kind: 'site' });
  ok('handoff: missing-content critiques route to the Writer', w.route === 'writer' && w.kind === 'faqs' && w.requires_writer && !w.requires_editor);
  const m = deriveHandoff('local_presence', { kind: 'site' });
  ok('handoff: verify-only critiques stay manual', m.route === 'manual' && !m.requires_editor && !m.requires_writer);
}

// ═══ 7. merge discipline ═══
{
  resetFindingSeq();
  const det = deterministicFindings(MESSY, SCOPE_SITE);
  const modelDupes = sanitizeModelFindings([
    { category: 'plain_language', location: { kind: 'identity', field: 'description' }, finding: 'dupe of deterministic', reason: 'r' },
    { category: 'flow', location: { kind: 'identity', field: 'description' }, finding: 'x', reason: 'y' }, // 'flow' not a review category → dies
    { category: 'scannability', location: { kind: 'identity', field: 'description' }, finding: 'new angle', reason: 'r' },
  ], MESSY);
  const merged = mergeFindings(det, modelDupes);
  ok('merge: deterministic findings win their slot; model adds only new angles',
    merged.filter((x) => x.category === 'plain_language').length === 1 && merged.some((x) => x.category === 'scannability'));
  ok('merge: report bounded at 20 findings', merged.length <= 20);
  ok('merge: attention outranks suggestion outranks note in order',
    merged.every((x, i, a) => i === 0 || ({ attention: 3, suggestion: 2, note: 1 })[a[i - 1].severity] >= ({ attention: 3, suggestion: 2, note: 1 })[x.severity]));
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

  const faqsBefore = JSON.stringify((await call('GET', '/faqs')).json?.data);
  const identityBefore = JSON.stringify((await call('GET', '/identity')).json?.data);

  const run = await call('POST', '/review/run', { scope: 'site' });
  ok('integration: whole-site review runs and stores a report', run.status === 200 && run.json?.data?.ok === true, `findings=${run.json?.data?.findings} model=${run.json?.data?.model || '(deterministic only)'}`);
  const report = await call('GET', `/review/reports/${run.json.data.review_id}`);
  const findings = report.json?.data?.findings || [];
  ok('integration: findings carry the contract + handoffs', findings.every((f) => f.manual_possible === true && f.approval_required === true && f.handoff?.route), `n=${findings.length}`);

  const faqsAfter = JSON.stringify((await call('GET', '/faqs')).json?.data);
  const identityAfter = JSON.stringify((await call('GET', '/identity')).json?.data);
  ok('integration: THE REVIEW CHANGED NOTHING — content byte-identical', faqsBefore === faqsAfter && identityBefore === identityAfter);

  if (findings.length) {
    const d = await call('POST', `/review/reports/${report.json.data.id}/dismiss`, { finding_id: findings[0].review_id });
    const after = await call('GET', `/review/reports/${report.json.data.id}`);
    ok('integration: per-finding dismissal recorded, never deleted', d.status === 200 && (after.json?.data?.findings || []).some((f) => f.review_id === findings[0].review_id && f.status === 'dismissed'));
    const editorFinding = findings.find((f) => f.handoff?.route === 'editor' && f.handoff?.target_id);
    if (editorFinding) {
      const fix = await call('POST', '/editor/improve', { kind: editorFinding.handoff.kind, action: editorFinding.handoff.action, target_id: editorFinding.handoff.target_id });
      ok('integration: “fix this” hands off to the real Editor (proposal only, nothing applied)', [200, 503].includes(fix.status), `status=${fix.status}`);
      if (fix.status === 200) await call('POST', `/writer/drafts/${fix.json.data.draft_id}/discard`);
    } else {
      console.log('      (no editor-routable finding this run — handoff covered by pure tiers)');
    }
  }
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ AI REVIEWER: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
