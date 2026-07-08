// ── Phase L: navigation / dead-link integrity (FD-E2) ────────────────────────
// Operational-excellence guard: every destination the platform can navigate to
// MUST resolve to a real page. Phase E found /help.html linked in every edition
// but never built — a dead end. This asserts, across every edition and role, that
// buildNav hrefs, landings, and the shell's fixed targets all point at pages that
// exist. Pure filesystem check — cheap, and it fails loudly on the next regression.
//
//   deno run --allow-read --allow-env tests/presence/nav_integrity_test.mjs
import { buildNav, landingFor } from '../../supabase/functions/presence/lib/navigation.ts';
import { EDITIONS } from '../../supabase/functions/presence/commerce/editions.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// repo root = two levels up from tests/presence/
const ROOT = new URL('../../', import.meta.url);
const pages = new Set();
for await (const e of Deno.readDir(ROOT)) { if (e.isFile && e.name.endsWith('.html')) pages.add('/' + e.name); }

// normalize an href to the page file it targets (drop #hash, ?query); external/mailto skipped
const pageOf = (href) => {
  const h = String(href || '').split('#')[0].split('?')[0];
  if (!h.startsWith('/') || h.startsWith('//')) return null;         // external
  if (h === '/') return '/index.html';
  return h.endsWith('.html') ? h : `${h}.html`;
};

// ═══ 1. every buildNav href, across every edition × representative roles, resolves ═══
{
  const roleCaps = {
    business_owner: ['view_all', 'edit', 'publish', 'connect', 'configure', 'invite'],
    developer: ['view_all', 'edit', 'publish', 'connect', 'use_developer_mode'],
    business_staff: ['view_all', 'edit', 'publish', 'connect'],
    client_reviewer: ['view_shared'],
  };
  const missing = new Set();
  let checked = 0;
  for (const ed of EDITIONS) {
    const siteEd = ed === 'monitor' ? 'monitor' : 'presence';
    for (const [role, capabilities] of Object.entries(roleCaps)) {
      for (const isAgency of [false, true]) {
        const ctx = { role, edition: siteEd, capabilities, isAgency, isOperator: false, editionKey: ed };
        for (const sec of buildNav(ctx)) for (const it of sec.items) {
          checked++;
          const pg = pageOf(it.href);
          if (pg && !pages.has(pg)) missing.add(`${pg} (${ed}/${role} → ${it.label})`);
        }
        const land = pageOf(landingFor(ctx));
        if (land && !pages.has(land)) missing.add(`${land} (landing ${ed}/${role})`);
      }
    }
  }
  ok(`buildNav: every href + landing resolves to a real page (checked ${checked} across editions×roles)`, missing.size === 0, [...missing].join('; '));
}

// ═══ 2. the shell's fixed navigation targets resolve ═══
{
  // hard-coded destinations in shell.js / approve.html / help.html (non-buildNav)
  const shellTargets = ['/help.html', '/portal.html', '/dds-studio-manage-9k2p.html', '/pricing.html', '/today.html', '/agency.html', '/client.html', '/developer.html', '/crm.html'];
  const missing = shellTargets.filter((t) => !pages.has(t));
  ok('shell + fixed targets all resolve (help/portal/admin/pricing/…)', missing.length === 0, missing.join(', '));
}

// ═══ 3. the guard itself is meaningful (a known page exists; a fake one doesn't) ═══
{
  ok('sanity: help.html exists, a bogus page does not', pages.has('/help.html') && !pages.has('/definitely-not-a-page.html'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
