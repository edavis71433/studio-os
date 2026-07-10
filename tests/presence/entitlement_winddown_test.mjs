// ── P2-E W3: lapse gate + enforced site wind-down (structural) ───────────────
//   deno run --allow-read tests/presence/entitlement_winddown_test.mjs
// The lifecycle the product PROMISES must be the lifecycle it ENFORCES:
//   • lapsed  → read-only workspace (view + export), not a hard lockout (M3)
//   • lapsed past the written window → the hosted site actually comes down (H4),
//     while the DB content stays for /export and resubscribe-and-republish.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const gate = read('supabase/functions/presence/middleware/entitlement.ts');
const life = read('supabase/functions/presence/commerce/lifecycle.ts');
const system = read('supabase/functions/presence/routes/system.ts');

// ── M3: the entitlement gate treats a lapse as read-only, not denied ──
ok('gate: active → full', /status === 'active'\) return \{ mode: 'full'/.test(gate));
ok('gate: paused → readonly', /status === 'paused'\) return \{ mode: 'readonly'/.test(gate));
ok('gate: lapsed → readonly (view + export, editing off) — M3', /status === 'lapsed'\) return \{ mode: 'readonly'/.test(gate));
ok('gate: lapsed message tells them to update payment to recover', /lapsed'\) return \{ mode: 'readonly', message: '[^']*payment/.test(gate));
ok('gate: deleted/none → denied (terminal, after the lapsed branch)', /return \{ mode: 'denied'/.test(gate) && gate.lastIndexOf("mode: 'denied'") > gate.indexOf("status === 'lapsed'"));

// ── H4: the sweep ENFORCES the wind-down (not just an email about it) ──
ok('winddown: sweep imports the takedown (deleteSite)', /import \{ deleteSite \} from '\.\.\/lib\/netlify\.ts'/.test(life));
ok('winddown: gated on lapsed AND past the written window (WIND_DOWN_DAYS)', /e\.status === 'lapsed'\)[\s\S]*?lapsedDays >= WIND_DOWN_DAYS/.test(life));
ok('winddown: only touches still-hosted sites (idempotent — archived is skipped)', /status=in\.\(live,paused,ready\)&select=id,netlify_site_id/.test(life));
ok('winddown: removes hosting then archives the workspace (recoverable, not purged)', /deleteSite\(site\.netlify_site_id\)[\s\S]*?status: 'archived', netlify_site_id: null/.test(life));
ok('winddown: NO hard delete of workspace/content (export + resubscribe survive)', !/presence_sites[^\n]*method: 'DELETE'/.test(life));
ok('winddown: counted + surfaced in the sweep result (observable)', /wound_down\+\+/.test(life) && /wound_down: number/.test(life) && /return \{ expired_trials: expired, notices, emails, wound_down \}/.test(life));

// ── wiring: the sweep runs every cron tick (owner scheduler) ──
ok('wiring: runLifecycleSweep is in the default cron cycle', /const lifecycle = await runLifecycleSweep\(limit\)/.test(system) && /lifecycle,/.test(system));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E W3 LAPSE GATE + WIND-DOWN (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
