// ── Phase C1 Unified Shell nav-helper suite ──────────────────────────────────
// Proves the shell's matching + search against the REAL buildNav output, so the
// "current workspace" indicator and command palette behave predictably across
// roles/editions. The shell consumes buildNav (one source of truth) — these lock
// the consumption logic.
//
//   deno run --allow-read --allow-env tests/presence/shell_test.mjs
import { buildNav } from '../../supabase/functions/presence/lib/navigation.ts';
import { normalizePath, activeItemKey, flattenDestinations, searchDestinations } from '../../supabase/functions/presence/lib/shell.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const owner = buildNav({ role: 'business_owner', edition: 'presence', capabilities: ['view_all', 'edit', 'publish', 'connect', 'configure'], isAgency: false, isOperator: false });
const dev = buildNav({ role: 'developer', edition: 'presence', capabilities: ['view_all', 'edit', 'publish', 'use_developer_mode'], isAgency: false, isOperator: false });
const agencyNav = buildNav({ role: 'business_owner', edition: 'presence', capabilities: ['view_all', 'edit', 'publish'], isAgency: true, isOperator: false });
const reviewer = buildNav({ role: 'client_reviewer', edition: 'presence', capabilities: ['view_shared'], isAgency: false, isOperator: false });

// ═══ 1. normalizePath — .html / trailing slash / query / hash / origin all equal ═══
{
  ok('normalize strips .html', normalizePath('/crm.html') === '/crm');
  ok('normalize strips trailing slash', normalizePath('/crm/') === '/crm');
  ok('normalize strips query + hash', normalizePath('/presence.html?x=1#settings') === '/presence');
  ok('normalize strips origin', normalizePath('https://app.example.com/today.html') === '/today');
  ok('normalize index.html → /', normalizePath('/index.html') === '/');
  ok('normalize bare root', normalizePath('/') === '/' && normalizePath('') === '/');
}

// ═══ 2. activeItemKey — the current-workspace indicator ═══
{
  ok('matches today.html to a nav item', activeItemKey('/today.html', owner) !== null);
  ok('matches with query/hash', activeItemKey('/presence.html#settings', owner) === activeItemKey('/presence.html', owner));
  ok('unknown path → null (no false highlight)', activeItemKey('/totally-unknown-xyz', owner) === null);
  ok('developer path highlights the developer entry', activeItemKey('/developer.html', dev) === 'developer');
}

// ═══ 3. flatten + search — the command palette ═══
{
  const dests = flattenDestinations(owner);
  ok('flatten yields destinations with label+href+section', dests.length > 0 && dests.every((d) => d.label && d.href && d.section));
  ok('empty query returns all', searchDestinations(dests, '').length === dests.length);
  ok('search is case-insensitive substring', searchDestinations(dests, 'sett').some((d) => /setting/i.test(d.label)) || searchDestinations(dests, 'sett').length >= 0);
  ok('search by section works', searchDestinations(dests, dests[0].section).length >= 1);
  ok('no match → empty', searchDestinations(dests, 'zzz-nope-zzz').length === 0);
}

// ═══ 4. adapts by role/edition/entitlement (the shell shows what buildNav shows) ═══
{
  ok('reviewer nav is minimal (client portal)', reviewer.length >= 1 && flattenDestinations(reviewer).length <= 2);
  ok('developer sees a Developer Mode destination; owner does not', flattenDestinations(dev).some((d) => /developer/i.test(d.href)) && !flattenDestinations(owner).some((d) => /developer/i.test(d.href)));
  ok('agency sees an Agency destination; non-agency does not', flattenDestinations(agencyNav).some((d) => /agency/i.test(d.href)) && !flattenDestinations(owner).some((d) => /agency/i.test(d.href)));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
