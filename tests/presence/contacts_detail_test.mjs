// ── Contact detail + custom fields + fuzzy dedupe — pure suite ────────────────
// Proves the pure core of the CRM contacts upgrade:
//   • composeContactDetail merges a contact's deals (each with its own
//     last-contacted) + a recent-activity feed across those deals + the overall
//     last-contacted, reusing the deal-activity timeline machinery.
//   • custom fields normalize to a capped (≤5), typed, deduped set; values
//     validate/coerce per type; a partial patch merges without wiping siblings;
//     angle brackets survive as data (the UI escapes at render).
//   • fuzzy dedupe matches typo'd names / alt formats / same-phone re-entries and
//     does NOT false-positive genuinely distinct people.
//
//   deno run --allow-read --allow-env tests/presence/contacts_detail_test.mjs
import {
  CUSTOM_FIELD_TYPES, MAX_CUSTOM_FIELDS, isCustomFieldType,
  normalizeFieldDefs, normalizeFieldValue, normalizeFieldValues, applyFieldValues, viewFieldValues,
} from '../../supabase/functions/presence/crm/custom_fields.ts';
import {
  normalizeName, phoneDigits, phoneKey, levenshtein, nameSimilarity,
  isPossibleDuplicate, findPossibleDuplicates,
} from '../../supabase/functions/presence/crm/dedupe.ts';
import { composeContactDetail, lastSpokeLabel } from '../../supabase/functions/presence/crm/contact_detail.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-07-13T12:00:00.000Z';
const NUL = String.fromCharCode(0), DEL = String.fromCharCode(127);

// ═══ 1. custom field DEFINITIONS ═══
{
  ok('the four types', JSON.stringify([...CUSTOM_FIELD_TYPES]) === JSON.stringify(['text', 'number', 'date', 'select']));
  ok('isCustomFieldType accepts the four', ['text', 'number', 'date', 'select'].every(isCustomFieldType));
  ok('isCustomFieldType rejects junk', !isCustomFieldType('code') && !isCustomFieldType('') && !isCustomFieldType(null));

  const defs = normalizeFieldDefs([
    { label: 'Referred by', type: 'text' },
    { label: 'Birthday', type: 'date' },
    { label: 'Tier', type: 'select', choices: ['Gold', 'Silver', ''] },
    { label: 'Lifetime value', type: 'number' },
  ]);
  ok('keeps four defs', defs.length === 4);
  ok('slugs a label into a key', defs[0].key === 'referred_by');
  ok('select keeps non-empty choices', JSON.stringify(defs[2].choices) === JSON.stringify(['Gold', 'Silver']));

  ok('caps at MAX_CUSTOM_FIELDS', normalizeFieldDefs(Array.from({ length: 12 }, (_, i) => ({ label: `F${i}`, type: 'text' }))).length === MAX_CUSTOM_FIELDS && MAX_CUSTOM_FIELDS === 5);
  ok('skips blank-label rows silently', normalizeFieldDefs([{ label: '', type: 'text' }, { label: 'Real', type: 'text' }]).length === 1);
  ok('unknown type falls back to text (no error)', normalizeFieldDefs([{ label: 'X', type: 'richtext' }])[0].type === 'text');
  ok('select with no choices degrades to text', normalizeFieldDefs([{ label: 'X', type: 'select' }])[0].type === 'text');
  const dupKeys = normalizeFieldDefs([{ label: 'Note', type: 'text' }, { label: 'Note', type: 'text' }]);
  ok('duplicate labels get distinct keys', dupKeys[0].key !== dupKeys[1].key);
  ok('label is length-capped', normalizeFieldDefs([{ label: 'x'.repeat(200), type: 'text' }])[0].label.length === 60);
}

// ═══ 2. custom field VALUES ═══
{
  const defs = normalizeFieldDefs([
    { label: 'Referred by', type: 'text' },
    { label: 'Lifetime value', type: 'number' },
    { label: 'Birthday', type: 'date' },
    { label: 'Tier', type: 'select', choices: ['Gold', 'Silver'] },
  ]);
  const [text, num, date, sel] = defs;

  ok('number coerces + drops junk', normalizeFieldValue(num, '1,200') === '1200' && normalizeFieldValue(num, 'abc') === '');
  ok('date validates ISO only', normalizeFieldValue(date, '2026-01-05') === '2026-01-05' && normalizeFieldValue(date, '01/05/2026') === '');
  ok('select must be an allowed choice', normalizeFieldValue(sel, 'Gold') === 'Gold' && normalizeFieldValue(sel, 'Bronze') === '');
  ok('text strips control chars + caps', normalizeFieldValue(text, 'a' + NUL + 'b' + DEL) === 'ab' && normalizeFieldValue(text, 'x'.repeat(500)).length === 300);
  // escaping posture: stored raw as data; the UI escapes at render.
  ok('text preserves angle brackets as data', normalizeFieldValue(text, '<b>hi</b>') === '<b>hi</b>');

  const bag = normalizeFieldValues(defs, { referred_by: 'Sam', lifetime_value: '5,000', birthday: 'nope', tier: 'Gold', ghost: 'x' });
  ok('normalizeFieldValues keeps only valid defined keys', JSON.stringify(bag) === JSON.stringify({ referred_by: 'Sam', lifetime_value: '5000', tier: 'Gold' }));
  ok('drops unknown keys entirely', !('ghost' in bag));

  // partial patch merges without wiping siblings; '' clears one field.
  const merged = applyFieldValues(defs, { referred_by: 'Sam', tier: 'Gold' }, { tier: 'Silver' });
  ok('patch changes one, keeps the rest', merged.referred_by === 'Sam' && merged.tier === 'Silver');
  const cleared = applyFieldValues(defs, { referred_by: 'Sam', tier: 'Gold' }, { tier: '' });
  ok('empty string clears just that field', cleared.referred_by === 'Sam' && !('tier' in cleared));
  ok('patch ignores unknown keys', !('ghost' in applyFieldValues(defs, {}, { ghost: 'x' })));

  const view = viewFieldValues(defs, { referred_by: 'Sam' });
  ok('viewFieldValues pairs every def with its value (empty when unset)', view.length === 4 && view[0].value === 'Sam' && view[1].value === '');
}

// ═══ 3. fuzzy dedupe — normalization ═══
{
  ok('normalizeName lowercases + strips punctuation', normalizeName('  O’Brien, Jane!  ') === 'jane obrien');
  ok('normalizeName is word-order independent', normalizeName('Jane Doe') === normalizeName('Doe Jane'));
  ok('normalizeName handles Last, First', normalizeName('Doe, Jane') === normalizeName('Jane Doe'));
  ok('normalizeName drops honorifics + suffixes', normalizeName('Dr. Jane Doe Jr') === normalizeName('Jane Doe'));
  ok('phoneDigits strips formatting', phoneDigits('(555) 123-4567') === '5551234567');
  ok('phoneKey takes last 10 (country-prefix tolerant)', phoneKey('+1 (555) 123-4567') === '5551234567' && phoneKey('555-1234') === '5551234');
  ok('levenshtein basic', levenshtein('kitten', 'sitting') === 3 && levenshtein('abc', 'abc') === 0);
  ok('nameSimilarity: identical canonical = 1', nameSimilarity('Jane Doe', 'Doe, Jane') === 1);
  ok('nameSimilarity: typo is high', nameSimilarity('Jane Doe', 'Jayne Doe') >= 0.82);
  ok('nameSimilarity: distinct is low', nameSimilarity('Jane Doe', 'John Smith') < 0.5);
  ok('nameSimilarity: empty is 0', nameSimilarity('', 'Jane') === 0);
}

// ═══ 4. fuzzy dedupe — the decision ═══
{
  // typo'd name, same phone → same person
  let r = isPossibleDuplicate({ name: 'Jayne Doe', phone: '555-123-4567' }, { name: 'Jane Doe', phone: '(555) 123-4567' });
  ok('typo name + same phone matches', r.match === true, JSON.stringify(r));

  // alt format, same phone → same person
  r = isPossibleDuplicate({ name: 'Doe, Jane', phone: '5551234567' }, { name: 'Jane Doe', phone: '555-123-4567' });
  ok('alt-format name + same phone matches', r.match === true);

  // very similar name, no phones → surfaced (a re-typed entry)
  r = isPossibleDuplicate({ name: 'Jane Doe' }, { name: 'Jayne Doe' });
  ok('similar name, no phones matches', r.match === true);

  // same email → certain match
  r = isPossibleDuplicate({ name: 'Whoever', email: 'JANE@x.com' }, { name: 'Different', email: 'jane@x.com' });
  ok('same email is a certain match (score 1)', r.match === true && r.score === 1);

  // distinct people → no match
  ok('distinct names do NOT match', isPossibleDuplicate({ name: 'Jane Doe', phone: '5551110000' }, { name: 'John Smith', phone: '5552223333' }).match === false);

  // similar name but DIFFERENT phones → suppressed (probably two different people)
  ok('similar name + conflicting phones is suppressed', isPossibleDuplicate({ name: 'Jane Doe', phone: '5551110000' }, { name: 'Jane Doe', phone: '5559998888' }).match === false);

  // same common name, one has no phone → surfaced (can't rule it out)
  ok('same name, one phone missing is surfaced', isPossibleDuplicate({ name: 'Jane Doe' }, { name: 'Jane Doe', phone: '5551110000' }).match === true);
}

// ═══ 5. fuzzy dedupe — find over a pool ═══
{
  const pool = [
    { id: 'a', name: 'Jane Doe', phone: '555-123-4567', email: 'jane@x.com' },
    { id: 'b', name: 'John Smith', phone: '555-999-0000' },
    { id: 'c', name: 'Jane Doe', phone: '555-123-4567' },   // exact-ish
  ];
  const matches = findPossibleDuplicates({ name: 'Jayne Doe', phone: '5551234567' }, pool, 5);
  ok('finds the two Jane-ish rows, not John', matches.length === 2 && matches.every((m) => m.id !== 'b'));
  ok('matches are sorted best-first with reasons', matches[0].score >= matches[1].score && matches[0].reasons.length > 0);
  ok('skips the candidate own row by id', findPossibleDuplicates({ id: 'a', name: 'Jane Doe', phone: '5551234567' }, pool).every((m) => m.id !== 'a'));
  ok('empty pool → no matches', findPossibleDuplicates({ name: 'Jane' }, []).length === 0);
}

// ═══ 6. contact detail composition ═══
{
  const deals = [
    { id: 'd1', title: 'Website refresh', stage: 'proposal', expected_value_cents: 250000, expected_close: '2026-08-01', converted_client_id: null, updated_at: '2026-07-12T10:00:00.000Z' },
    { id: 'd2', title: 'SEO retainer', stage: 'won', expected_value_cents: 100000, expected_close: null, converted_client_id: 'client-9', updated_at: '2026-07-01T10:00:00.000Z' },
  ];
  const events = [
    { id: 'e1', deal_id: 'd1', kind: 'created', actor: 'system', created_at: '2026-07-01T09:00:00.000Z', detail: {} },
    { id: 'a1', deal_id: 'd1', kind: 'note', actor: 'me', created_at: '2026-07-11T09:00:00.000Z', detail: { activity_kind: 'call', body: 'talked scope', occurred_at: '2026-07-11T09:00:00.000Z' } },
    { id: 'a2', deal_id: 'd2', kind: 'note', actor: 'me', created_at: '2026-07-05T09:00:00.000Z', detail: { activity_kind: 'email', body: 'sent recap', occurred_at: '2026-07-05T09:00:00.000Z' } },
  ];
  const c = composeContactDetail(deals, events, { timelineLimit: 30 });

  ok('every deal is summarized', c.deals.length === 2);
  ok('per-deal last_contacted from its own activity', c.deals[0].last_contacted_at === '2026-07-11T09:00:00.000Z' && c.deals[1].last_contacted_at === '2026-07-05T09:00:00.000Z');
  ok('deal value + stage carried through', c.deals[0].expected_value_cents === 250000 && c.deals[1].stage === 'won');
  ok('overall last_contacted = latest activity across deals', c.last_contacted_at === '2026-07-11T09:00:00.000Z');

  ok('timeline merges all deals newest-first', c.timeline.map((i) => i.id).join(',') === 'act:a1,act:a2,evt:e1', c.timeline.map((i) => i.id).join(','));
  ok('each timeline item names its deal', c.timeline[0].deal_id === 'd1' && c.timeline[0].deal_title === 'Website refresh');
  ok('activity item reused from deal-activity mapper (icon + text)', c.timeline[0].icon === '📞' && c.timeline[0].text === 'talked scope');

  ok('lastSpokeLabel is calm + relative', lastSpokeLabel('2026-07-12T12:00:00.000Z', NOW) === 'Last spoke yesterday');
  ok('lastSpokeLabel empty when never', lastSpokeLabel(null, NOW) === '');
}

// ═══ 7. empty / defensive ═══
{
  const c = composeContactDetail([], [], {});
  ok('empty contact detail is calm', c.deals.length === 0 && c.timeline.length === 0 && c.last_contacted_at === null);
  ok('composeContactDetail tolerates undefined', composeContactDetail(undefined, undefined, {}).deals.length === 0);
  ok('normalizeFieldDefs([]) === []', normalizeFieldDefs([]).length === 0 && normalizeFieldDefs(undefined).length === 0);
  ok('normalizeFieldValues tolerates junk', Object.keys(normalizeFieldValues([], null)).length === 0);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
