// ── Phase PT-2B: premium experience pure cores ───────────────────────────────
// PT-6 health coach · PT-7 customer timeline · PT-8 admin health center ·
// PT-9 AI business memory. Each is a PURE aggregator over existing signals —
// plain English, no scores, no duplicate architecture.
//   deno run --allow-read --allow-env tests/presence/premium_experience_test.mjs
import { coachRead } from '../../supabase/functions/presence/lib/health_coach.ts';
import { buildTimeline } from '../../supabase/functions/presence/lib/customer_timeline.ts';
import { summarizeHealthCenter } from '../../supabase/functions/presence/lib/health_center.ts';
import { buildBusinessMemory, memorySentence } from '../../supabase/functions/presence/lib/business_memory.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-07-08T12:00:00Z';

// ═══ PT-6 — Business Health Coach (plain English, never a score) ═══
{
  const healthy = coachRead({ live: true, lastPublishedAt: '2026-01-01T00:00:00Z', pendingApprovals: 0, connectedNeedingAttention: 0, searchIssues: 0, leadsWaiting: 0, unpublishedChanges: false, domainExpiringDays: null }, NOW);
  ok('coach: all clear → "Everything looks healthy." + no suggestions', healthy.status === 'healthy' && healthy.headline === 'Everything looks healthy.' && healthy.suggestions.length === 0);
  const one = coachRead({ live: true, lastPublishedAt: '2026-01-01T00:00:00Z', pendingApprovals: 0, connectedNeedingAttention: 0, searchIssues: 0, leadsWaiting: 1, unpublishedChanges: false, domainExpiringDays: null }, NOW);
  ok('coach: one issue → "One thing could help." + a lead suggestion to /leads.html', one.status === 'attention' && one.headline === 'One thing could help.' && one.suggestions[0].href === '/leads.html');
  const many = coachRead({ live: true, lastPublishedAt: '2026-01-01T00:00:00Z', pendingApprovals: 2, connectedNeedingAttention: 1, searchIssues: 3, leadsWaiting: 2, unpublishedChanges: true, domainExpiringDays: 5 }, NOW);
  ok('coach: many issues → "A couple of things could help." capped at 3 suggestions', many.headline === 'A couple of things could help.' && many.suggestions.length === 3);
  const fresh = coachRead({ live: false, lastPublishedAt: null, pendingApprovals: 0, connectedNeedingAttention: 0, searchIssues: 0, leadsWaiting: 0, unpublishedChanges: false, domainExpiringDays: null }, NOW);
  ok('coach: brand-new → "getting set up", never alarmed', fresh.status === 'new' && /getting set up/.test(fresh.headline));
  ok('coach: never emits a numeric score or grade', ![healthy, one, many, fresh].some((r) => /\b\d+\s*(\/|out of|%|points|score|grade)/i.test(JSON.stringify(r))));
}

// ═══ PT-7 — Customer Timeline (celebrate real milestones) ═══
{
  const full = buildTimeline({ createdAt: '2025-06-01T00:00:00Z', firstPublishedAt: '2025-06-10T00:00:00Z', searchVerified: true, firstInquiryAt: '2025-07-01T00:00:00Z', firstCustomerAt: '2025-06-05T00:00:00Z', renewsAt: '2026-06-01T00:00:00Z' }, NOW);
  ok('timeline: six milestones in order', full.milestones.length === 6 && full.milestones[0].key === 'created' && full.milestones.at(-1).key === 'renewal');
  ok('timeline: published + inquiry marked achieved with dates', full.milestones.find((m) => m.key === 'published').achieved && full.milestones.find((m) => m.key === 'first_inquiry').at === '2025-07-01T00:00:00Z');
  ok('timeline: latest celebration is the most recent 🎉 milestone (the inquiry)', full.latestCelebration && full.latestCelebration.key === 'first_inquiry');
  const early = buildTimeline({ createdAt: '2026-07-01T00:00:00Z', firstPublishedAt: null, searchVerified: false, firstInquiryAt: null, firstCustomerAt: null, renewsAt: null }, NOW);
  ok('timeline: unachieved milestones are anticipatory, not faked', !early.milestones.find((m) => m.key === 'published').achieved && early.latestCelebration === null && /Publish when/.test(early.milestones.find((m) => m.key === 'published').note));
}

// ═══ PT-8 — Admin Health Center (one read, honest) ═══
{
  const healthy = summarizeHealthCenter({ nowIso: NOW, cronLastRunAt: '2026-07-08T11:50:00Z', secretsMissingRequired: [], domainsWatched: 3, domainsExpiringSoon: 0, billing: { active: 5, paused: 0, lapsed: 0 }, aiConfigured: true, aiOpsThisMonth: 12, emailConfigured: true, sitesLive: 5, failedPublishes: 0, failedRuns: 0, activeNotices: 0, backupsVerified: true });
  ok('health center: all-good → overall ok, one area per concern', healthy.overall === 'ok' && healthy.areas.length === 10);
  const troubled = summarizeHealthCenter({ nowIso: NOW, cronLastRunAt: '2026-07-08T09:00:00Z', secretsMissingRequired: ['SCHEDULER_SECRET'], domainsWatched: 3, domainsExpiringSoon: 1, billing: { active: 4, paused: 1, lapsed: 2 }, aiConfigured: false, emailConfigured: false, aiOpsThisMonth: 0, sitesLive: 4, failedPublishes: 1, failedRuns: 2, activeNotices: 3, backupsVerified: false });
  ok('health center: stale cron flagged attention', troubled.areas.find((a) => a.key === 'cron').state === 'attention');
  ok('health center: billing trouble + missing config + errors + expiring domain all flagged', ['billing', 'platform', 'errors', 'domains', 'alerts'].every((k) => troubled.areas.find((a) => a.key === k).state === 'attention'));
  ok('health center: unconfigured AI/email read as "off", not broken', troubled.areas.find((a) => a.key === 'ai').state === 'off' && troubled.areas.find((a) => a.key === 'email').state === 'off');
  ok('health center: backups honest — attention until a restore drill is confirmed', troubled.areas.find((a) => a.key === 'backups').state === 'attention' && healthy.areas.find((a) => a.key === 'backups').state === 'ok');
  ok('health center: overall attention when anything needs a look', troubled.overall === 'attention');
}

// ═══ PT-9 — AI Business Memory (from existing data, one memory) ═══
{
  const est = buildBusinessMemory({ industry: 'restaurant', voiceTone: 'friendly and local', identityDescription: 'A family trattoria', serviceArea: 'Portland', siteStatus: 'live', lastPublishedAt: '2025-01-01T00:00:00Z', offeringsCount: 24, live: true }, NOW);
  ok('memory: industry label + tone + established stage + seasonality', est.industry === 'Restaurant' && est.tone === 'friendly and local' && est.stage === 'established' && /Holidays|patio/.test(est.seasonality));
  const setup = buildBusinessMemory({ industry: 'plumber', siteStatus: 'draft', lastPublishedAt: null, offeringsCount: 0, live: false }, NOW);
  ok('memory: setting-up stage → priorities lead with "get live" + "add offerings"', setup.stage === 'setting_up' && /live/i.test(setup.priorities[0]) && setup.priorities.some((p) => /offer/i.test(p)));
  ok('memory: tone falls back to a plain default, never blank', setup.tone.length > 0 && /jargon/.test(setup.tone));
  const nl = buildBusinessMemory({ industry: 'salon', siteStatus: 'live', lastPublishedAt: NOW, live: true, offeringsCount: 5 }, NOW);
  ok('memory: just-published reads as newly_live', nl.stage === 'newly_live');
  ok('memory: unknown industry → graceful seasonality + prettified label', buildBusinessMemory({ industry: 'artisan_forge', live: true, lastPublishedAt: NOW, offeringsCount: 1 }, NOW).industry === 'Artisan Forge');
  ok('memory sentence is one plain line, no score', /^I know /.test(memorySentence(est)) && !/\d+\s*(\/|%|score)/.test(memorySentence(est)));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PREMIUM EXPERIENCE (PT-6/7/8/9): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
