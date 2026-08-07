// ── B3: a reply on a support thread FRESHENS the thread ──────────────────────
//   deno run --allow-read tests/presence/support_thread_freshness_test.mjs
//
// presence_support_requests.updated_at is what the studio bell, the Inbox feed
// and every "oldest first" list order by (0079 indexes (site_id, updated_at
// desc); routes/service_intake.ts orders by updated_at.desc; workspace.ts's feed
// does too). A bare INSERT into presence_support_messages does not touch the
// parent row, so a reply that arrives by ANY door has to bump it explicitly —
// otherwise ordering and staleness logic treat a thread that just moved as
// older than it is, and it sinks in exactly the list meant to surface it.
//
// The 0078 trigger presence_support_requests_touch fires BEFORE UPDATE, so any
// PATCH of the row is enough; these tests assert the PATCH exists on each door.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const inbound = read('supabase/functions/presence/routes/inbound_email.ts');
const intake = read('supabase/functions/presence/routes/service_intake.ts');
const delivery = read('supabase/functions/presence/routes/client_delivery.ts');
const mig = read('supabase/migrations/0078_p2d_surveys_support.sql');

/** The slice of `src` that is the body of `fnName` (to the next top-level export). */
function fnBody(src, fnName) {
  const at = src.indexOf(fnName);
  if (at === -1) return '';
  const rest = src.slice(at);
  const end = rest.indexOf('\nexport ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}
/** Does this slice PATCH presence_support_requests to bump updated_at? */
const bumps = (s) => /presence_support_requests\?id=eq\.[^`']*`?,?\s*\{\s*method:\s*'PATCH'[\s\S]{0,220}?updated_at:\s*nowIso\(\)/.test(s);

// ── the ground truth the bump relies on ──────────────────────────────────────
ok('the parent row has an updated_at touch trigger (0078) — a PATCH is enough',
  /create trigger presence_support_requests_touch before update on public\.presence_support_requests/.test(mig));
ok('support lists really order by updated_at (so a missed bump changes ordering)',
  /presence_support_requests\?site_id=eq\.\$\{site\.id\}[^`]*order=updated_at\.desc/.test(intake));

// ── door 1: an emailed-in reply (already correct — pinned against regression) ─
ok('B3 inbound_email.ts: an emailed reply onto an open thread bumps updated_at',
  bumps(inbound.slice(inbound.indexOf('presence_support_messages'))));

// ── door 2: the STUDIO's own reply (and a client posting through the same route)
{
  const body = fnBody(intake, 'export async function handleSupportMessage');
  ok('B3 service_intake.ts: handleSupportMessage found', body.length > 0);
  ok('B3 service_intake.ts: a support reply bumps the request updated_at', bumps(body));
  // The pre-existing open → in_progress PATCH bumps updated_at only for a STUDIO
  // reply on an `open` thread; it is not the general bump and must not be
  // mistaken for one.
  ok('B3 service_intake.ts: the bump is unconditional, not a side effect of the open → in_progress PATCH',
    /status=eq\.open/.test(body) && bumps(body.slice(body.indexOf('status=eq.open') + 20)));
}

// ── door 3: the portal reply (routes/client_delivery.ts) ─────────────────────
// Reported, not fixed: client_delivery.ts is being edited concurrently by
// another agent in this tree (routes/sales.ts + the invoice-void work touches
// handleClientBilling in the same file), so this gap is handed back rather than
// raced. When it lands, flip this to `bumps(...)` — the assertion is written so
// it FAILS LOUDLY the moment the gap is closed, which is the reminder to.
{
  const body = fnBody(delivery, 'export async function handleClientSupportMessage');
  ok('B3 client_delivery.ts: handleClientSupportMessage found', body.length > 0);
  ok('B3 client_delivery.ts: KNOWN GAP — the portal reply still does not bump updated_at (handed back, see inbound_email.ts FOLLOW-UP)',
    !bumps(body), 'the gap is CLOSED — good: delete this assertion and pin the bump instead');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SUPPORT THREAD FRESHNESS (B3): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
