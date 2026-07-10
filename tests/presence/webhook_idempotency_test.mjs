// ── P2-E W4: atomic webhook idempotency + livemode guard (structural) ────────
//   deno run --allow-read tests/presence/webhook_idempotency_test.mjs
// The webhook is the single source of payment truth, so its duplicate/retry and
// live-vs-test handling must be provably correct, not "usually fine".
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const wh = read('supabase/functions/stripe-webhook/index.ts');
const mig = read('supabase/migrations/0083_webhook_idempotency_claim.sql');

// ── M1: claim-first atomicity replaces SELECT-then-INSERT ──
ok('claim: idempotency is a claim-first INSERT (ignore-duplicates, return=representation)', /dbInsertReturning\('stripe_webhook_events'[\s\S]*?resolution=ignore-duplicates/.test(wh));
ok('claim: the old SELECT-then-process race is GONE (no alreadyProcessed gate)', !/alreadyProcessed/.test(wh));
ok('claim: a won INSERT → claimed; a conflict is resolved by the row status', /return 'claimed'/.test(wh) && /if \(status === 'failed'\) return 'retry'/.test(wh) && /if \(status === 'processing'\) return 'processing'/.test(wh));
ok('claim: done/processing duplicates are acknowledged WITHOUT re-processing', /claim === 'done' \|\| claim === 'processing'\)[\s\S]*?acknowledged without re-processing/.test(wh));
ok('settle: success marks the event done; failure releases the claim for retry', /if \(res\.status === 200\) await markEventDone/.test(wh) && /else await markEventFailed/.test(wh));
ok('settle: a failed prior attempt (status=failed) re-processes on Stripe retry', /claimEvent[\s\S]*?'retry'/.test(wh) && /'failed'\) return 'retry'/.test(wh));
ok('resilient: falls back to legacy schema if 0083 columns not applied yet (deploy-order safe)', /ins\.code >= 400 \|\| ins\.code === 0/.test(wh) && /received_at: receivedAt \}/.test(wh) && /legacy row already exists/.test(wh));

// ── L3: livemode guard ──
ok('livemode: expected mode derived from the key prefix or STRIPE_EXPECT_LIVEMODE', /function expectedLivemode\(\)[\s\S]*?STRIPE_EXPECT_LIVEMODE[\s\S]*?sk_live_/.test(wh));
ok('livemode: a mismatch is ignored (200, nothing touched) — no cross-mode billing', /LIVEMODE MISMATCH[\s\S]*?ignored, nothing touched[\s\S]*?status: 200/.test(wh));
ok('livemode: guard runs BEFORE the claim + dispatch', wh.indexOf('LIVEMODE MISMATCH') < wh.indexOf('const claim = await claimEvent'));
ok('livemode: FAILS OPEN when mode is unknown (never silently drop a real payment)', /if \(expect !== null && livemode !== null/.test(wh));

// ── signature verification still gates everything (unchanged, must survive) ──
ok('signature: still verified first; unverified → 400, nothing touched', /verifyStripeSignature\(raw/.test(wh) && /invalid signature[\s\S]*?status: 400/.test(wh));

// ── migration: status/processed_at/livemode + backfill + rollback ──
ok('migration: adds status + processed_at + livemode (additive)', /add column if not exists status text not null default 'processing'/.test(mig) && /add column if not exists processed_at/.test(mig) && /add column if not exists livemode/.test(mig));
ok('migration: backfills existing rows to done (old code inserted only after success)', /update public\.stripe_webhook_events set status = 'done'/.test(mig));
ok('migration: status CHECK (processing|done|failed) + rollback present', /check \(status in \('processing','done','failed'\)\)/.test(mig) && /drop column if exists status/.test(mig));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E W4 WEBHOOK IDEMPOTENCY + LIVEMODE (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
