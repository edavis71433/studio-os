// ── /commerce/* — self-serve signup & commerce (L1) ─────────────────────────
// A public-safe bounded context, handled (like /agency) BEFORE the client/staff
// 401 so a stranger can discover, price, and buy Studio OS with no operator in
// the loop. The authed routes inside (subscription, billing portal, first-run)
// require a signed-in caller and resolve their own site via RLS.
//
// Flow:
//   GET  /commerce/plans            (public)  the catalog + prices
//   POST /commerce/signup           (public)  account → trial-provision OR checkout
//   POST /commerce/verify           (public)  confirm email (non-blocking)
//   GET  /commerce/checkout-status  (public)  did the webhook provision yet?
//   GET  /commerce/subscription     (authed)  the caller's plan/status/renewal
//   POST /commerce/portal           (authed)  Stripe billing portal (manage/cancel/change)
//   GET  /commerce/first-run        (authed)  the welcome checklist (derived)
//   POST /commerce/first-run/dismiss(authed)  dismiss the welcome
import { json } from '../../_shared/http.ts';
import { svc, asUser } from '../lib/db.ts';
import { raiseNotice } from '../lib/notice.ts';
import { noticeDismissible } from '../lib/inbox_feed.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import { resolveSite } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import {
  PLANS, planByKey, isPlanKey, isTerm, displayPrice, priceCents, grantFounder,
  stripeInterval, editionFor, FOUNDERS_OPEN,
} from '../commerce/catalog.ts';
import type { PlanKey, Term } from '../commerce/catalog.ts';
import { supportFor } from '../commerce/support.ts';
import { validEmail, passwordProblem, findClientByEmail, createAuthUser, deleteAuthUser, createContactAndClient, sendEmail } from '../commerce/account.ts';
import { provisionForSignup } from '../commerce/provision.ts';
import { bridgeCustomerToStudio, CONNECT_INTENT_TAG } from './sales.ts';
import { trialEntitlementPatch, entitlementPatchFromSubscription } from '../commerce/subscriptions.ts';
import type { EntitlementPatch } from '../commerce/subscriptions.ts';
import { stripeConfigured, siteUrl, createSubscriptionCheckout, createBillingPortal } from '../commerce/stripe.ts';
import { requestDeletion, cancelDeletion, coolingOffDays } from '../commerce/deletion.ts';
import { recordAcceptance } from '../commerce/terms.ts';
import { applyEntitlementPatch } from '../commerce/entitlement_sync.ts';
import { isServiceRetainerMeta, applyRetainerSync } from '../commerce/retainers.ts';
import { checkAiCeiling } from '../commerce/metering.ts';

const TRIAL_DAYS = 14;

function query(url: string, key: string): string {
  try { return new URL(url).searchParams.get(key) || ''; } catch { return ''; }
}

// ── PUBLIC: the catalog ─────────────────────────────────────────────────────
function planPayload(founder: boolean) {
  return PLANS.map((p) => {
    const price = p.selfServe && p.monthly != null ? {
      founder,
      monthly: displayPrice(p.key, 'monthly', founder),
      annual: displayPrice(p.key, 'annual', founder),
      list_monthly: displayPrice(p.key, 'monthly', false),
      list_annual: displayPrice(p.key, 'annual', false),
    } : null;
    return {
      key: p.key, name: p.name, tagline: p.tagline, edition: p.edition,
      self_serve: p.selfServe, trial_eligible: p.trialEligible, features: p.features, price,
    };
  });
}

function handlePlans(cors: Record<string, string>) {
  // Phase P: every plan ships its SERVICE tier (onboarding/support/AI/implementation/
  // training/maintenance) so software and service packages can never drift apart.
  const plans = planPayload(grantFounder()).map((p: any) => ({ ...p, support: supportFor(p.key) }));
  return json({ data: { founders_open: FOUNDERS_OPEN, trial_days: TRIAL_DAYS, plans } }, 200, cors);
}

// ── Auto-connect: a studio pre-listed this email to connect on signup ────────
// When a studio records an email via contacts.html → "they'll sign up themselves"
// (mode='connect'), it leaves a tagged, site-scoped presence_contacts row. The
// site IS the studio, and presence_contacts.site_id is exactly the agency_site_id
// the frozen bridge keys on. On a successful self-serve signup we look that record
// up and bridge the brand-new customer to that studio — reusing the SAME
// bridgeCustomerToStudio → ensureBridge path convert/add-customer use (never a
// parallel bridge). Idempotent + best-effort: it must NEVER block or fail signup.
// Only the explicit connect-intent tag triggers it (a coincidental CRM lead won't).
// Logs are email-masked.
async function autoConnectPreListedStudio(clientId: string, customerSiteId: string | null, email: string, businessName: string): Promise<void> {
  try {
    const needle = CONNECT_INTENT_TAG.replace(/[^a-z-]/gi, '');   // 'connect-on-signup' — the searchable inner tag (single source of truth)
    const pending = (await svc(`presence_contacts?email=eq.${encodeURIComponent(email)}&notes=ilike.*${needle}*&deleted_at=is.null&select=site_id&order=updated_at.desc&limit=1`)).json?.[0];
    const agencySiteId = pending?.site_id ? String(pending.site_id) : '';
    if (!agencySiteId) return;   // no studio pre-listed this email → nothing to connect
    const r = await bridgeCustomerToStudio({ agencySiteId, clientId, customerSiteId, label: businessName });
    const { maskEmail } = await import('./email_infra.ts');
    console.log(`[signup] auto-connect ${maskEmail(email)} → studio site=${agencySiteId}: ${r.bridged ? 'bridged' : (r.ownedElsewhere ? 'skipped(owned-elsewhere)' : 'noop')}`);
  } catch (e) {
    try { const { maskEmail } = await import('./email_infra.ts'); console.warn(`[signup] auto-connect skipped for ${maskEmail(email)}: ${String((e as Error)?.message || e)}`); } catch { /* logging is best-effort too */ }
  }
}

// ── PUBLIC: signup ──────────────────────────────────────────────────────────
async function handleSignup(req: Request, cors: Record<string, string>) {
  // Phase S / FD-M2: throttle account creation per-IP (brute-force + abuse guard).
  if (!(await rateAllow(`signup:ip:${clientIp(req)}`, 5, 60))) return tooMany(cors);
  let body: any = null;
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'The request body wasn’t valid JSON.' }, 400, cors); }

  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const businessName = String(body?.business_name || '').trim();
  const planKey = String(body?.plan || '');
  const wantsTrial = body?.trial === true || (!body?.term && !!planByKey(planKey)?.trialEligible);
  const term = String(body?.term || '');

  if (!validEmail(email)) return json({ error: 'bad_email', message: 'Please enter a valid email address.' }, 422, cors);
  const pwProblem = passwordProblem(password);
  if (pwProblem) return json({ error: 'bad_password', message: pwProblem }, 422, cors);
  if (!businessName) return json({ error: 'bad_business', message: 'Please tell us your business name.' }, 422, cors);
  const plan = planByKey(planKey);
  if (!plan) return json({ error: 'bad_plan', message: 'Please choose a plan.' }, 422, cors);
  if (!plan.selfServe) return json({ error: 'not_self_serve', message: `${plan.name} is set up with our team — reach out and we’ll get you started.` }, 422, cors);

  // For a paid signup, term is required and valid; for a trial, term is optional.
  const isTrial = wantsTrial && plan.trialEligible;
  if (!isTrial && !isTerm(term)) return json({ error: 'bad_term', message: 'Please choose monthly or annual billing.' }, 422, cors);

  // Already have an account? Send them to sign in — never silently reuse.
  const existing = await findClientByEmail(email);
  if (existing) return json({ error: 'account_exists', message: 'An account with this email already exists. Please sign in instead.' }, 409, cors);

  // Create the auth user, then the contact+client chain (each rolls back the prior on failure)
  const au = await createAuthUser(email, password);
  if ('error' in au) {
    if (au.error === 'account_exists') return json({ error: 'account_exists', message: 'An account with this email already exists. Please sign in instead.' }, 409, cors);
    return json({ error: 'signup_failed', message: 'We couldn’t create your account just now. Please try again.' }, 502, cors);
  }
  const chain = await createContactAndClient(au.id, email, businessName);
  if ('error' in chain) {
    await deleteAuthUser(au.id); // nothing half-made
    return json({ error: 'signup_failed', message: 'We couldn’t finish setting up your account. Please try again.' }, 502, cors);
  }

  // M4 — capture durable clickwrap evidence (which version, when, from where).
  // Best-effort: it must never cost a customer their just-created account.
  await recordAcceptance({
    clientId: chain.clientId, email, ip: clientIp(req),
    userAgent: req.headers.get('user-agent') || '',
    presentedTermsVersion: typeof body?.terms_version === 'string' ? body.terms_version : '',
    method: 'clickwrap_signup', context: isTrial ? 'signup_trial' : 'signup_paid',
  });

  const verifyToken = crypto.randomUUID();
  const founder = grantFounder();
  const signupIns = await svc('presence_signups', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      email, plan: plan.key, term: isTrial ? null : term, business_name: businessName,
      intent: isTrial ? 'trial' : 'paid', auth_user_id: au.id, client_id: chain.clientId,
      verify_token: verifyToken, status: 'account_created',
    }),
  });
  const signupId = signupIns.json?.[0]?.id;

  // Welcome / confirm-your-email — best effort, never blocks the flow.
  const verifyUrl = `${siteUrl()}/welcome.html?verify=${encodeURIComponent(verifyToken)}`;
  sendEmail(email, 'Welcome to Studio OS — confirm your email',
    `<p>Welcome. Your workspace is being set up.</p><p>Please confirm this is you: <a href="${verifyUrl}">confirm my email</a>.</p><p>You can sign in any time at <a href="${siteUrl()}/portal.html">your portal</a>.</p>`,
    undefined, { critical: true },   // account verification = transactional; survives an opt-out
  ).catch(() => {});

  // ── Trial: provision immediately, no card. ──
  if (isTrial) {
    const patch = trialEntitlementPatch(plan.key, new Date(), TRIAL_DAYS);
    const prov = await provisionForSignup({ clientId: chain.clientId, businessName, plan: plan.key, patch, actorEmail: email });
    if (!prov.ok) {
      if (signupId) await svc(`presence_signups?id=eq.${signupId}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', note: prov.error || 'provision_failed' }) });
      // hosting not configured on a Presence trial → tell the truth, don't fake success
      const msg = prov.error === 'hosting_unconfigured'
        ? 'Your account is ready, but website hosting isn’t available on this environment yet. Please reach out and we’ll finish setup.'
        : 'Your account is ready, but we hit a snag setting up your workspace. Please try again or reach out.';
      return json({ error: 'provision_incomplete', message: msg, account_created: true }, 502, cors);
    }
    if (signupId) await svc(`presence_signups?id=eq.${signupId}`, { method: 'PATCH', body: JSON.stringify({ status: 'provisioned', site_id: prov.siteId }) });
    // If a studio pre-listed this email (connect-by-email), connect them now.
    await autoConnectPreListedStudio(chain.clientId, prov.siteId || null, email, businessName);
    return json({ data: { mode: 'trial', message: 'Your workspace is ready.', redirect: `${siteUrl()}/presence.html`, site_id: prov.siteId, trial_days: TRIAL_DAYS } }, 201, cors);
  }

  // ── Paid: hand off to Stripe Checkout; provisioning happens on the webhook. ──
  if (!stripeConfigured()) {
    return json({ error: 'billing_unavailable', message: 'Your account is ready, but checkout isn’t available on this environment yet. Please reach out to finish.', account_created: true }, 503, cors);
  }
  const cents = priceCents(plan.key, term as Term, founder);
  if (cents == null) return json({ error: 'no_price', message: 'That plan can’t be purchased online — please reach out.' }, 422, cors);
  try {
    const co = await createSubscriptionCheckout({
      productName: `Studio OS — ${plan.name}`,
      amountCents: cents, interval: stripeInterval(term as Term),
      email, clientId: chain.clientId, plan: plan.key, term, founder, signupId: signupId || 'nosignup',
    });
    if (signupId) await svc(`presence_signups?id=eq.${signupId}`, { method: 'PATCH', body: JSON.stringify({ status: 'checkout_pending', stripe_session_id: co.id }) });
    // If a studio pre-listed this email (connect-by-email), form the connection now
    // (the customer's workspace provisions on the webhook; the bridge is idempotent).
    await autoConnectPreListedStudio(chain.clientId, null, email, businessName);
    return json({ data: { mode: 'checkout', url: co.url } }, 200, cors);
  } catch (e) {
    return json({ error: 'checkout_failed', message: 'We couldn’t start checkout. Please try again.', detail: String((e as Error).message || e) }, 502, cors);
  }
}

// ── PUBLIC: email verification (non-blocking) ───────────────────────────────
async function handleVerify(req: Request, cors: Record<string, string>) {
  let body: any = null;
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'Invalid request.' }, 400, cors); }
  const token = String(body?.token || '');
  if (!token) return json({ error: 'bad_token', message: 'Missing verification token.' }, 422, cors);
  const r = await svc(`presence_signups?verify_token=eq.${encodeURIComponent(token)}&select=id,verified_at&limit=1`);
  const row = r.json?.[0];
  if (!row) return json({ error: 'not_found', message: 'That link is no longer valid.' }, 404, cors);
  if (!row.verified_at) {
    await svc(`presence_signups?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ verified_at: new Date().toISOString() }) });
  }
  return json({ data: { verified: true } }, 200, cors);
}

// ── PUBLIC: checkout status (poll after returning from Stripe) ──────────────
async function handleCheckoutStatus(req: Request, cors: Record<string, string>) {
  const sessionId = query(req.url, 'session_id');
  if (!sessionId) return json({ error: 'bad_request', message: 'Missing session_id.' }, 422, cors);
  const r = await svc(`presence_signups?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=status,site_id&limit=1`);
  const row = r.json?.[0];
  if (!row) return json({ data: { status: 'unknown', ready: false } }, 200, cors);
  return json({ data: { status: row.status, ready: row.status === 'provisioned', site_id: row.site_id || null } }, 200, cors);
}

// ── AUTHED: subscription summary ────────────────────────────────────────────
async function handleSubscription(jwt: string, cors: Record<string, string>) {
  const site = await resolveSite(jwt);
  if (!site) return json({ error: 'no_site', message: 'No workspace is set up for this account yet.' }, 404, cors);
  const r = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(site.client_id)}&product=eq.presence&select=plan,status,term,founder,trial_ends_at,current_period_end,cancel_at_period_end,grace_until&limit=1`);
  const ent = r.json?.[0];
  if (!ent) return json({ error: 'no_subscription', message: 'No subscription found for this account.' }, 404, cors);
  const def = planByKey(String(ent.plan));
  // The customer's AI position for the month — a calm true/false, NEVER a number
  // or a dollar figure (Law 13). Lets the billing surface say "AI generation for
  // this month is used up — resets next month" honestly.
  const ceiling = await checkAiCeiling(site.client_id);
  const aiPooled = ceiling.ceiling_usd == null;   // pooled-by-contract plan → no hard cap
  const aiAtLimit = ceiling.allowed === false;
  // Does this customer ALSO have agency SERVICE billing (invoices), which is
  // billed SEPARATELY from this software subscription? Keep the two distinct.
  const invCount = (await svc(`invoices?client_id=eq.${encodeURIComponent(site.client_id)}&deleted_at=is.null&select=id&limit=1`)).json;
  return json({ data: {
    billing_type: 'saas',   // this is the Studio OS SOFTWARE subscription (distinct from agency service invoices)
    plan: ent.plan, plan_name: def?.name || ent.plan, status: ent.status, term: ent.term,
    founder: ent.founder === true, trial_ends_at: ent.trial_ends_at, current_period_end: ent.current_period_end,
    cancel_at_period_end: ent.cancel_at_period_end === true, in_grace: !!ent.grace_until, grace_until: ent.grace_until,
    can_manage_billing: !!ent.plan && (def?.selfServe ?? false),
    ai_pooled: aiPooled, ai_at_limit: aiAtLimit,   // calm position, no numbers
    has_service_billing: Array.isArray(invCount) && invCount.length > 0,   // → see /client/billing
  } }, 200, cors);
}

// ── AUTHED: Stripe billing portal (manage / cancel / change plan) ───────────
async function handlePortal(jwt: string, cors: Record<string, string>) {
  const site = await resolveSite(jwt);
  if (!site) return json({ error: 'no_site', message: 'No workspace is set up for this account yet.' }, 404, cors);
  if (!stripeConfigured()) return json({ error: 'billing_unavailable', message: 'Billing management isn’t available on this environment.' }, 503, cors);
  const r = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(site.client_id)}&product=eq.presence&select=stripe_customer_id&limit=1`);
  const customerId = r.json?.[0]?.stripe_customer_id;
  if (!customerId) return json({ error: 'no_billing', message: 'This account isn’t on a paid subscription — there’s nothing to manage yet.' }, 409, cors);
  try {
    const portal = await createBillingPortal(String(customerId), `${siteUrl()}/presence.html`);
    return json({ data: { url: portal.url } }, 200, cors);
  } catch (e) {
    return json({ error: 'portal_failed', message: 'We couldn’t open billing management just now.', detail: String((e as Error).message || e) }, 502, cors);
  }
}

// ── AUTHED: the welcome checklist (derived) ─────────────────────────────────
async function handleFirstRun(jwt: string, cors: Record<string, string>) {
  const site = await resolveSite(jwt);
  if (!site) return json({ error: 'no_site', message: 'No workspace is set up for this account yet.' }, 404, cors);
  const monitor = site.edition === 'monitor';
  const [idn, brand, fr, conn] = await Promise.all([
    asUser(jwt, `presence_identity?site_id=eq.${site.id}&select=business_name,phone,email,description&limit=1`),
    asUser(jwt, `presence_brand_profile?site_id=eq.${site.id}&select=personality,mission,elevator_pitch&limit=1`),
    asUser(jwt, `presence_first_run?site_id=eq.${site.id}&select=dismissed,welcomed_at&limit=1`),
    monitor ? asUser(jwt, `presence_monitor_connections?site_id=eq.${site.id}&select=status&limit=1`) : Promise.resolve({ json: [] as any[] }),
  ]);
  const id = idn.json?.[0] || {};
  const br = brand.json?.[0] || {};
  const firstRun = fr.json?.[0] || {};
  const connStatus = (conn.json?.[0]?.status) || '';

  const detailsDone = !!(id.phone || id.email || (id.description && String(id.description).length > 10));
  const brandDone = !!(br.personality || br.mission || br.elevator_pitch);
  const domainDone = monitor ? connStatus === 'verified' : !!site.custom_domain;
  const liveDone = monitor ? connStatus === 'verified' : !!site.last_published_at;

  const steps = [
    { key: 'details', title: 'Add your business details', done: detailsDone, hint: 'Your name, what you do, how to reach you.' },
    { key: 'brand', title: 'Set how your business sounds', done: brandDone, hint: 'A few words in your voice — guidance, never a score.' },
    monitor
      ? { key: 'connect', title: 'Verify you own your website', done: domainDone, hint: 'A one-time ownership check — nothing on your site changes.' }
      : { key: 'domain', title: 'Connect your domain', done: domainDone, hint: 'Point your web address here, or launch on a free subdomain first.' },
    monitor
      ? { key: 'observe', title: 'See your first read', done: liveDone, hint: 'Once verified, the first observations arrive.' }
      : { key: 'publish', title: 'Publish your website', done: liveDone, hint: 'One calm ritual — preview, then publish.' },
  ];
  const done = steps.filter((s) => s.done).length;
  return json({ data: {
    edition: site.edition, dismissed: firstRun.dismissed === true, welcomed_at: firstRun.welcomed_at || null,
    steps, done, total: steps.length, complete: done === steps.length,
  } }, 200, cors);
}

// ── AUTHED: the commercial capacity notice (the calm "outgrown your plan" card) ──
async function handleNotices(jwt: string, cors: Record<string, string>) {
  const site = await resolveSite(jwt);
  if (!site) return json({ error: 'no_site', message: 'No workspace is set up for this account yet.' }, 404, cors);
  // R-fix F2: the four client-portal kinds (0116) are BELL items, not plan items.
  // The card renders `notices[0]` when nothing matches its priority list, so they
  // showed up as a plum "outgrown your plan" card with a See-plans → pricing CTA.
  // The card filters them too (presence.html PLAN_CARD_EXCLUDE); excluding them
  // HERE additionally stops a chatty client from crowding a real billing notice
  // out of this read's top-3 window. This endpoint has exactly one consumer (that
  // card) — the bell rail reads its notices from /portal/feed, unfiltered.
  // R-fix F3: this card is the THIRD dismiss surface, and it was the one that
  // LIED — it swallowed the route's 409 and removed the card anyway, so the
  // operator watched a protected notice vanish and found it back on reload.
  // NOTICE_PRIORITY can surface protected kinds, so the card needs the same
  // `dismissible` truth Today's list gets: read `period` (the only thing that can
  // tell an unpaid-invoice reminder from an ordinary deal follow-up) and derive
  // the flag from the ONE shared rule — never a second copy of the list.
  const r = await asUser(jwt, `presence_plan_notices?site_id=eq.${site.id}&status=eq.active&kind=not.in.(client_message,client_upload,client_request,client_approval)&select=id,kind,period,headline,body,created_at&order=created_at.desc&limit=3`);
  const notices = (r.ok && Array.isArray(r.json)) ? r.json.map((n: any) => ({
    id: n.id, kind: n.kind, headline: n.headline, body: n.body,
    dismissible: noticeDismissible(n.kind, n.period),
    actions: ['upgrade', 'learn_more', 'dismiss'], // the only three, ever
  })) : [];
  return json({ data: { notices } }, 200, cors);
}

// M2 — dismiss the ONE notice the customer clicked, not every active notice.
// The card can surface several notices over time (capacity, trial, lapse); the
// old dismiss-all silently cleared unseen lifecycle notices whose send-once had
// already fired, so they never reappeared. Scope the PATCH to {id} AND the
// caller's own client_id (svc bypasses RLS, so the ownership check is explicit).
//
// This is also the route behind Today's "Done" button on the Needs-you list, so
// it is now the enforcement point for WHAT MAY NOT BE HIDDEN. The client already
// declines to draw the button for a protected row (the feed ships a `dismissible`
// flag derived from the same rule), but a hand-rolled POST must not be able to
// hide an unpaid invoice, a failed payment, a lapsed account, a pending deletion,
// a site that is down, or a failed publish. The row is READ first — the kind and
// period are what decide, and only the row itself can be trusted for those.
async function handleNoticeDismiss(req: Request, jwt: string, cors: Record<string, string>) {
  const site = await resolveSite(jwt);
  if (!site) return json({ error: 'no_site', message: 'No workspace is set up for this account yet.' }, 404, cors);
  let body: any = null;
  try { body = await req.json(); } catch { body = null; }
  const id = body && typeof body.id === 'string' ? body.id.trim() : '';
  if (id) {
    const row = (await svc(`presence_plan_notices?id=eq.${encodeURIComponent(id)}&client_id=eq.${encodeURIComponent(site.client_id)}&status=eq.active&select=id,kind,period&limit=1`)).json?.[0];
    // not the caller's own active notice → nothing to dismiss (never leak whose it is)
    if (!row) return json({ error: 'not_found', message: 'That item isn’t on your list.' }, 404, cors);
    if (!noticeDismissible(row.kind, row.period)) {
      return json({
        error: 'not_dismissable',
        message: 'This one can’t be cleared by hand — it clears itself the moment it’s genuinely resolved.',
      }, 409, cors);
    }
  }
  const scope = id
    ? `id=eq.${encodeURIComponent(id)}&client_id=eq.${encodeURIComponent(site.client_id)}&status=eq.active`
    // no id (legacy caller): fall back to dismissing this client's capacity card
    // only — never the lifecycle notices, which must run their course.
    : `client_id=eq.${encodeURIComponent(site.client_id)}&kind=eq.capacity&status=eq.active`;
  await svc(`presence_plan_notices?${scope}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) });
  return json({ data: { dismissed: true } }, 200, cors);
}

async function handleFirstRunDismiss(jwt: string, cors: Record<string, string>) {
  const site = await resolveSite(jwt);
  if (!site) return json({ error: 'no_site', message: 'No workspace is set up for this account yet.' }, 404, cors);
  await svc('presence_first_run?on_conflict=site_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ site_id: site.id, dismissed: true }),
  });
  return json({ data: { dismissed: true } }, 200, cors);
}

// ── SYSTEM: billing-sync (called by the stripe-webhook, secret-gated) ───────
// The webhook owns Stripe signature verification (the payment truth); it then
// delegates the business action here, where every secret already lives (service
// role, Netlify). This keeps provisioning in ONE place (commerce/provision.ts)
// instead of duplicating it into the webhook's bundle. Idempotent: the webhook
// already dedups by event id, and provisioning itself is rerunnable.
const BILLING_SYNC_SECRET = Deno.env.get('BILLING_SYNC_SECRET') || Deno.env.get('SCHEDULER_SECRET') || '';

async function businessNameFor(clientId: string): Promise<string> {
  const r = await svc(`clients?id=eq.${encodeURIComponent(clientId)}&select=name&limit=1`);
  return String(r.json?.[0]?.name || '').slice(0, 120);
}

async function handleBillingSync(req: Request, cors: Record<string, string>): Promise<Response> {
  if (!BILLING_SYNC_SECRET || req.headers.get('x-commerce-secret') !== BILLING_SYNC_SECRET) {
    return json({ error: 'forbidden' }, 403, cors);
  }
  let body: any = null;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const type = String(body?.type || '');
  const obj = body?.object || {};

  try {
    // ── SERVICE RETAINER rail (frozen boundary) ──────────────────────────────
    // Routed by PURPOSE METADATA, BEFORE any SaaS branch, so a service retainer's
    // recurring lifecycle NEVER reaches applyEntitlementPatch / provisioning
    // (both scoped product=eq.presence). invoice.* events (recurring-charge
    // settlement) also route here — they resolve a retainer by subscription id and
    // no-op otherwise, so a SaaS renewal invoice can never touch entitlement.
    if (isServiceRetainerMeta(obj.metadata) || type.startsWith('invoice.')) {
      const r = await applyRetainerSync(type, obj);
      return json({ data: { rail: 'service_retainer', ...r } }, 200, cors);
    }

    // First payment landed → provision the workspace.
    if (type === 'checkout.session.completed' && String(obj.mode || '') === 'subscription') {
      const md = obj.metadata || {};
      const clientId = String(md.client_id || '');
      const plan = String(md.plan || '');
      if (!clientId || !isPlanKey(plan)) return json({ data: { ignored: true, reason: 'no_plan_metadata' } }, 200, cors);
      const term = isTerm(md.term) ? md.term : undefined;
      const founder = String(md.founder || '') === 'true';
      const customer = obj.customer ? String(typeof obj.customer === 'string' ? obj.customer : obj.customer.id) : null;
      const subscription = obj.subscription ? String(typeof obj.subscription === 'string' ? obj.subscription : obj.subscription.id) : null;
      const patch: EntitlementPatch = {
        status: 'active', plan, term, founder,
        stripe_customer_id: customer, stripe_subscription_id: subscription,
        current_period_end: null, cancel_at_period_end: false, canceled_at: null, grace_until: null, trial_ends_at: null,
      };
      const businessName = await businessNameFor(clientId);
      const prov = await provisionForSignup({ clientId, businessName, plan, patch, actorEmail: obj.customer_details?.email || obj.customer_email || null });
      if (!prov.ok) {
        // M5 — make the failure LOUD and specific, not just a 502 the webhook echoes.
        console.error(`[billing-sync] provision FAILED client=${clientId} plan=${plan} sub=${subscription || '?'}: ${prov.error || 'unknown'}`);
        return json({ error: 'provision_failed', detail: prov.error }, 502, cors);
      }
      // mark the signup provisioned (by session id, best-effort)
      if (obj.id) await svc(`presence_signups?stripe_session_id=eq.${encodeURIComponent(String(obj.id))}`, { method: 'PATCH', body: JSON.stringify({ status: 'provisioned', site_id: prov.siteId, stripe_customer_id: customer }) });
      console.log(`[billing-sync] provisioned client=${clientId} plan=${plan} site=${prov.siteId}`);
      return json({ data: { provisioned: true, site_id: prov.siteId } }, 200, cors);
    }

    // Ongoing lifecycle → sync the entitlement (renewal, past-due, pause, cancel).
    if (type.startsWith('customer.subscription.')) {
      const patch = entitlementPatchFromSubscription(obj, new Date());
      const md = obj.metadata || {};
      let clientId = String(md.client_id || '');
      if (!clientId && patch.stripe_subscription_id) {
        const r = await svc(`presence_entitlements?stripe_subscription_id=eq.${encodeURIComponent(patch.stripe_subscription_id)}&select=client_id&limit=1`);
        clientId = String(r.json?.[0]?.client_id || '');
      }
      if (!clientId) { console.error(`[billing-sync] ${type} could not resolve a client (sub=${patch.stripe_subscription_id || '?'}) — ignored`); return json({ data: { ignored: true, reason: 'no_client' } }, 200, cors); }
      const applied = await applyEntitlementPatch(clientId, patch);
      let reprovisioned = false;
      if (patch.plan && isPlanKey(patch.plan)) {
        if (!applied) {
          // entitlement not there yet (event race) → provision to create it
          const businessName = await businessNameFor(clientId);
          await provisionForSignup({ clientId, businessName, plan: patch.plan, patch, actorEmail: null });
          reprovisioned = true;
        } else {
          // Upgrade/downgrade that CHANGES edition → re-provision (idempotent):
          // Monitor→Presence provisions hosting + flips edition; Presence→Monitor
          // flips edition but PRESERVES data (nothing is torn down) — capability is
          // removed by the edition gate, content and hosting stay.
          const sr = await svc(`presence_sites?client_id=eq.${encodeURIComponent(clientId)}&select=edition&limit=1`);
          const curEd = sr.json?.[0]?.edition;
          if (curEd && curEd !== editionFor(patch.plan)) {
            const businessName = await businessNameFor(clientId);
            await provisionForSignup({ clientId, businessName, plan: patch.plan, patch, actorEmail: null });
            reprovisioned = true;
          }
        }
      }
      console.log(`[billing-sync] ${type} client=${clientId} → status=${patch.status}${patch.plan ? ` plan=${patch.plan}` : ''}${reprovisioned ? ' reprovisioned' : ''}`);
      return json({ data: { synced: true, status: patch.status, reprovisioned } }, 200, cors);
    }

    return json({ data: { ignored: true } }, 200, cors);
  } catch (e) {
    return json({ error: 'sync_error', detail: String((e as Error).message || e) }, 502, cors);
  }
}

// ── dispatcher ──────────────────────────────────────────────────────────────
// Public routes need no principal; authed routes require a client/staff caller.
export async function handleCommerce(req: Request, route: string, method: string, principal: Principal, cors: Record<string, string>): Promise<Response> {
  // public
  if (route === '/commerce/plans' && method === 'GET') return handlePlans(cors);
  if (route === '/commerce/delete-request' && method === 'POST') {
    // CP-10: self-serve deletion REQUEST → a cancelable cooling-off; the scheduled
    // executor (commerce/deletion.ts runDeletionSweep) actually completes it.
    const jwt = req.headers.get('x-dds-user-jwt') || '';
    const site = jwt ? await resolveSite(jwt) : null;
    if (!site || !site.client_id) return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);
    const days = coolingOffDays();
    const reqd = await requestDeletion(site.client_id, site.id, 'customer');
    const name = await businessNameFor(site.client_id);
    // ── PERIOD = THIS REQUEST, not 'once' ────────────────────────────────────
    // The notice model dedupes on (client_id, kind, period) with
    // `resolution=ignore-duplicates`, and the cancel path below DISMISSES the row
    // rather than deleting it. With a literal 'once' the dismissed row kept the
    // key forever, so every LATER deletion request returned created=false: no
    // notice, no bell, no Today row, no push — silently. That is the worst
    // possible flow to lose, and `deletion_requested` is in
    // NOTICE_PROTECTED_KINDS precisely because it must never go unseen.
    //
    // The dedupe scope is therefore the open request's own row id — exactly what
    // lib/notice.ts documents `period` to be ("a stable event id"). 'once' was
    // only ever correct if an account could be deleted once ever; cancel exists
    // because it cannot. This keeps every property that mattered:
    //   · an idempotent re-click resolves to the SAME open request → the SAME
    //     period → still one row, still no second push or email;
    //   · a CANCELLED request's notice stays dismissed under its OWN period and
    //     can never be resurrected — a re-raise mints a different key;
    //   · nothing is hard-deleted, so the dismissed rows remain the history of
    //     what was asked and withdrawn.
    // `id` is null only if the insert itself failed (in which case there is no
    // request to announce); fall back to the old key rather than raise under an
    // empty period.
    await raiseNotice({ siteId: site.id, clientId: site.client_id, kind: 'deletion_requested', period: reqd.id ? `del:${reqd.id}` : 'once',
      headline: 'Your deletion request is recorded',
      body: `Your account and data will be deleted after ${days} days. Until then you can still download everything you own — or cancel this request.` });
    // Email the confirmation ONCE — only when this POST actually created a new
    // request, not on an idempotent re-click of an already-pending one.
    let emailed = false;
    if (reqd.created) {
      const cl = await svc(`clients?id=eq.${encodeURIComponent(site.client_id)}&select=email&limit=1`);
      if (cl.json?.[0]?.email) emailed = await sendEmail(cl.json[0].email, 'Your deletion request is recorded',
        `<p>We’ve recorded your request to delete the account for <strong>${name}</strong>.</p><p>Deletion completes after ${days} days (on or after ${new Date(reqd.scheduled_for).toDateString()}). Until then, everything you own is still downloadable from your workspace — and if you change your mind, you can cancel the request from your account.</p>`,
        undefined, { critical: true }).catch(() => false);   // deletion confirmation = transactional; survives an opt-out
      const ops = Deno.env.get('OPS_ALERT_EMAIL') || '';
      if (ops) sendEmail(ops, `[Studio OS ops] Deletion requested: ${name}`, `<p>Client ${site.client_id} (${name}) requested account deletion; scheduled ${reqd.scheduled_for}. The executor completes it after the cooling-off.</p>`).catch(() => {});
    }
    return json({ data: { ok: true, completes_within_days: days, scheduled_for: reqd.scheduled_for, already_pending: !reqd.created, emailed } }, 200, cors);
  }
  if (route === '/commerce/delete-cancel' && method === 'POST') {
    const jwt = req.headers.get('x-dds-user-jwt') || '';
    const site = jwt ? await resolveSite(jwt) : null;
    if (!site || !site.client_id) return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);
    const done = await cancelDeletion(site.client_id);
    // Dismiss EVERY active deletion notice for this client, whatever its period —
    // the period is now per-request, and this is the one teardown the protected
    // kind has (lib/inbox_feed.ts). Dismiss, never delete: the row is the record
    // that a request was raised and withdrawn, and the next request raises its
    // own row under its own key rather than reviving this one.
    if (done) await svc(`presence_plan_notices?client_id=eq.${encodeURIComponent(site.client_id)}&kind=eq.deletion_requested&status=eq.active`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) }).catch(() => {});
    return json({ data: { ok: true, canceled: done, message: done ? 'Your deletion request was canceled — your account stays active.' : 'There was no pending deletion request.' } }, 200, cors);
  }
  if (route === '/commerce/signup' && method === 'POST') return handleSignup(req, cors);
  if (route === '/commerce/verify' && method === 'POST') return handleVerify(req, cors);
  if (route === '/commerce/checkout-status' && method === 'GET') return handleCheckoutStatus(req, cors);
  if (route === '/commerce/billing-sync' && method === 'POST') return handleBillingSync(req, cors);

  // authed
  const authed = principal.kind === 'client' || principal.kind === 'staff';
  const jwt = principal.jwt || '';
  if (route === '/commerce/subscription' && method === 'GET') {
    if (!authed) return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);
    return handleSubscription(jwt, cors);
  }
  if (route === '/commerce/portal' && method === 'POST') {
    if (!authed) return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);
    return handlePortal(jwt, cors);
  }
  if (route === '/commerce/first-run' && method === 'GET') {
    if (!authed) return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);
    return handleFirstRun(jwt, cors);
  }
  if (route === '/commerce/first-run/dismiss' && method === 'POST') {
    if (!authed) return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);
    return handleFirstRunDismiss(jwt, cors);
  }
  if (route === '/commerce/notices' && method === 'GET') {
    if (!authed) return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);
    return handleNotices(jwt, cors);
  }
  if (route === '/commerce/notices/dismiss' && method === 'POST') {
    if (!authed) return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);
    return handleNoticeDismiss(req, jwt, cors);
  }
  return json({ error: 'not_found', message: `No commerce route for ${method} ${route}.` }, 404, cors);
}
