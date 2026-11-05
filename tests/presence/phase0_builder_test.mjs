// ── Website builder, Phase 0 pins (Nov 2026) ─────────────────────────────────
//   deno run --allow-read tests/presence/phase0_builder_test.mjs
// Static checks on things the hermetic browser suite can't see: it serves pages
// from a plain local server, so the production _headers file never applies to it.
// That is how a CSP that blocked every Supabase image survived from July to
// November with the whole suite green.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const results = [];
const ok = (n, p) => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

// ── the app's image rule ─────────────────────────────────────────────────────
const headers = read('_headers');
const csp = (headers.match(/Content-Security-Policy:\s*(.+)/) || [])[1] || '';
const imgSrc = (csp.match(/img-src ([^;]+)/) || [])[1] || '';
ok('CSP img-src allows Supabase storage (every library photo and preview image)', /https:\/\/\*\.supabase\.co/.test(imgSrc));
ok('CSP img-src allows blob: (the photo size check on upload)', /(^| )blob:( |$)/.test(imgSrc));
ok('CSP img-src still allows the stock library', /https:\/\/images\.pexels\.com/.test(imgSrc));
ok('CSP keeps default-src self and object-src none', /default-src 'self'/.test(csp) && /object-src 'none'/.test(csp));
ok('only one CSP in _headers (no rule shadowing this one)', headers.match(/Content-Security-Policy:/g).length === 1);

// ── the apply pack must not narrow the notice kinds ──────────────────────────
const pack = read('docs/presence/APPLY-0099-0101-prod.sql');
const packSql = pack.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const beforeVerify = packSql.split('commit;')[0];
ok('pack never touches presence_plan_notices', !/presence_plan_notices/.test(beforeVerify));
for (const t of ['presence_appointment_types', 'presence_booking_settings', 'presence_appointments', 'presence_reviews']) {
  ok(`pack creates ${t} idempotently, with RLS on`,
    beforeVerify.includes(`create table if not exists public.${t}`) && beforeVerify.includes(`alter table public.${t} enable row level security`));
}
ok('pack admits no_show on appointments', /presence_appointments_status_check[\s\S]*no_show/.test(beforeVerify));
ok('pack is one transaction', /^begin;$/m.test(packSql) && /^commit;$/m.test(packSql));
ok('pack is plain ASCII (the clipboard mangles anything else)', [...pack].every((c) => c.charCodeAt(0) < 128));

// the kinds the pack relies on are all in the newest migration that declares the check
const m135 = read('supabase/migrations/0135_approval_due_date_reminders.sql');
for (const k of ['new_booking', 'booking_reminder', 'booking_followup', 'new_review']) ok(`notice kind ${k} is carried by 0135`, m135.includes(`'${k}'`));

// ── the two server changes ───────────────────────────────────────────────────
const room = read('supabase/functions/presence/routes/room.ts');
ok('/changes names the blockers', /blocker_list:\s*st\.blockerList/.test(room) && /blockerList:\s*v\.blockers/.test(room));
const commercial = read('supabase/functions/presence/routes/commercial.ts');
ok('a form submit looks through the custom pages too', /select=blocks,pages/.test(commercial) && /stored\.pages\.map/.test(commercial));

// ── the builder ──────────────────────────────────────────────────────────────
const page = read('presence.html');
ok('no emoji left as a builder control', !/[\u{1F4AC}\u{1F5D1}\u{1F648}\u{1F3E0}\u{1F4C4}\u{1F4CB}\u{1F517}\u{1F512}\u{1F5BC}\u{2728}]/u.test(page.replace(/\/\/[^\n]*/g, '')));
ok('the icon helper has its own name: `bi` is a section index all over the canvas', /function uiIcon\(/.test(page) && !/function bi\(/.test(page));
ok('account notices stay out of a client view', /get\("client"\)\) \{\s*renderFirstRun\(\);\s*renderPlanNotice\(\);/.test(page));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
