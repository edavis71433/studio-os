// ── Phase C CRM suite ────────────────────────────────────────────────────────
// Proves the pure relationship core: every source normalizes to a calm timeline
// item with the right audience; the studio-vs-client audience filter never
// over-exposes internal items; merge is newest-first + capped; health is a calm
// word (never a score); the summary is plain sentences; note validation holds.
//
//   deno run --allow-read --allow-env tests/presence/crm_test.mjs
import {
  mapPublish, mapChange, mapConnected, mapMoment, mapApproval, mapNote,
  mergeTimeline, filterTimeline, studioSideSees, deriveClientHealth, relationshipSummary,
  humanWhen, isAudience, cleanNoteBody,
} from '../../supabase/functions/presence/crm/contract.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-07-07T12:00:00.000Z';

// ═══ 1. normalizers → calm items with correct audience ═══
{
  ok('publish → shared', (() => { const i = mapPublish({ id: '1', kind: 'publish', status: 'live', change_summary: '2 menu changes', created_at: NOW }); return i.kind === 'publish' && i.audience === 'shared' && i.title === 'Published the site' && i.detail === '2 menu changes'; })());
  ok('restore → shared, worded', mapPublish({ id: '1', kind: 'restore', created_at: NOW }).title === 'Restored an earlier version');
  ok('content change → shared with label', (() => { const i = mapChange({ id: '2', entity_type: 'offering', action: 'update', created_at: NOW }); return i.audience === 'shared' && i.title === 'Menu items updated'; })());
  ok('internal_note change → internal', mapChange({ id: '3', entity_type: 'internal_note', action: 'update', created_at: NOW }).audience === 'internal');
  ok('connected → shared with label + verb', (() => { const i = mapConnected({ id: '4', provider_key: 'google_business_profile', action: 'connect', created_at: NOW }, 'Google Business Profile'); return i.audience === 'shared' && i.title === 'Google Business Profile connected'; })());
  ok('moment → shared', mapMoment({ id: '5', headline: 'A quiet week', created_at: NOW }).audience === 'shared');
  ok('approval → shared with status detail', (() => { const i = mapApproval({ id: '6', title: 'Update hours on Google', status: 'proposed', provider_key: 'google_business_profile' }, 'connected'); return i.audience === 'shared' && i.detail.includes('awaiting approval'); })());
  ok('note carries its own audience', mapNote({ id: '7', audience: 'internal', body: 'Called owner', created_at: NOW }).audience === 'internal' && mapNote({ id: '8', audience: 'shared', body: 'x', created_at: NOW }).audience === 'shared');
}

// ═══ 2. audience filter — the client side NEVER sees internal ═══
{
  const items = [
    mapNote({ id: 'a', audience: 'internal', body: 'private', created_at: NOW }),
    mapNote({ id: 'b', audience: 'shared', body: 'public', created_at: NOW }),
    mapChange({ id: 'c', entity_type: 'internal_note', action: 'update', created_at: NOW }),
    mapPublish({ id: 'd', kind: 'publish', created_at: NOW }),
  ];
  const studio = filterTimeline(items, true);
  const client = filterTimeline(items, false);
  ok('studio sees all', studio.length === 4);
  ok('client sees only shared (no internal note, no internal change)', client.length === 2 && client.every((i) => i.audience === 'shared'));
  ok('studioSideSees: internal hidden from client', studioSideSees({ audience: 'internal' }, false) === false && studioSideSees({ audience: 'internal' }, true) === true && studioSideSees({ audience: 'shared' }, false) === true);
}

// ═══ 3. merge — newest first, capped ═══
{
  const older = mapPublish({ id: 'o', kind: 'publish', created_at: '2026-01-01T00:00:00Z' });
  const newer = mapPublish({ id: 'n', kind: 'publish', created_at: '2026-06-01T00:00:00Z' });
  const merged = mergeTimeline([[older], [newer]]);
  ok('merge sorts newest first', merged[0].id === 'pub:n' && merged[1].id === 'pub:o');
  ok('merge caps length', mergeTimeline([Array.from({ length: 100 }, (_, i) => mapMoment({ id: String(i), headline: 'h', created_at: NOW }))], 60).length === 60);
  ok('merge drops item without a date', mergeTimeline([[{ id: 'x', at: '', kind: 'note', audience: 'shared', title: 't' }]]).length === 0);
}

// ═══ 4. client health — a calm word, never a score ═══
{
  const base = { business_name: 'X', edition: 'presence', status: 'live', live: true, last_published_at: NOW, members: 1, connected: 2, connected_needing_attention: 0, active_moments: 1, pending_approvals: 0 };
  ok('healthy when live + nothing pending', deriveClientHealth(base, NOW) === 'healthy');
  ok('attention when a connection needs a look', deriveClientHealth({ ...base, connected_needing_attention: 1 }, NOW) === 'attention');
  ok('attention when approvals pending', deriveClientHealth({ ...base, pending_approvals: 2 }, NOW) === 'attention');
  ok('new when never published', deriveClientHealth({ ...base, live: false, last_published_at: null }, NOW) === 'new');
}

// ═══ 5. relationship summary — plain sentences, no numbers-as-scores ═══
{
  const p = { business_name: 'Bacchus Kitchen', edition: 'presence', status: 'live', live: true, last_published_at: '2026-07-01T00:00:00Z', members: 2, connected: 3, connected_needing_attention: 0, active_moments: 1, pending_approvals: 2, health: 'attention' };
  const s = relationshipSummary(p, NOW, NOW);
  ok('summary mentions live + approvals + connected + moments', /live/.test(s) && /waiting for approval/.test(s) && /connected/.test(s) && /moment/.test(s));
  ok('summary has no percentage/score/grade', !/%|score|grade|rank/i.test(s));
  ok('new-account summary is gentle', /getting set up/.test(relationshipSummary({ ...p, health: 'new', live: false, last_published_at: null }, null, NOW)));
  ok('humanWhen is plain', humanWhen('2026-07-06T12:00:00Z', NOW) === 'yesterday' && humanWhen(NOW, NOW) === 'today');
}

// ═══ 6. note validation ═══
{
  ok('isAudience', isAudience('internal') && isAudience('shared') && !isAudience('public') && !isAudience(null));
  ok('cleanNoteBody trims + caps', cleanNoteBody('  hi  ') === '  hi' && cleanNoteBody('x'.repeat(5000)).length === 4000 && cleanNoteBody(null) === '');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
