// ── Revenue lifecycle sweep (Phase RL / FD-R1) ───────────────────────────────
// The entitlement states always existed (active/paused/lapsed) but nothing acted
// on them: no trial-ending nudge, no payment-trouble note, no wind-down story —
// and no-card trials NEVER expired (status stayed 'active' forever past
// trial_ends_at — a real revenue bug, fixed here). This sweep runs in the
// existing /system/run cycle and reuses every rail we have:
//   • notices  → presence_plan_notices (one per client/kind/month, dismissible,
//                already rendered by the workspace card)
//   • emails   → sendEmail (graceful no-op without RESEND_KEY)
//   • send-once → the notices table's unique(client,kind,period) IS the dedupe:
//                emails go out only when the notice row is newly inserted.
// Pure decision logic + copy up top (tested); the impure runner below.
import { svc, svcCount } from '../lib/db.ts';
import { deleteSite } from '../lib/netlify.ts';
import { getSite } from '../lib/netlify.ts';
import { rdapLookup, daysUntil } from '../lib/rdap.ts';
import { verifyApex, dkimPresent, NETLIFY_APEX_IP } from '../platform/dns.ts';
import { leadFollowupDue, leadFollowupCopy, renewalReminderWindow, renewalNoticePeriod, renewalReminderCopy } from '../lib/commercial.ts';
import { supportAgingDue, supportAgingPeriod, SUPPORT_AGING_DAYS } from '../lib/intake.ts';
import { editionFromPlan, EDITION_DEFS } from './editions.ts';
import { sendEmail } from './account.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';
import { raiseNotice, clearNotice } from '../lib/notice.ts';
import { summarizePipeline } from '../lib/sales_lifecycle.ts';
import { agreementRenewalWindow, agreementRenewalPeriod, agreementRenewalCopy } from './retainers.ts';
import { planReminder, noShowNudgeDue, humanSlot, priceText, REMINDER_DAY_HRS } from '../lib/booking.ts';

export type LifecycleKind = 'trial_ending' | 'trial_ended' | 'payment_trouble' | 'account_lapsed' | 'search_setup' | 'winddown_reminder' | 'win_back' | 'welcome_back';

export interface EntitlementView {
  client_id: string;
  status: string;                       // active | paused | lapsed | none
  trial_ends_at?: string | null;
  stripe_subscription_id?: string | null;
  updated_at?: string | null;
  grace_until?: string | null;          // L4: past-due grace anchor; enforced when it passes
}

export const WIND_DOWN_DAYS = 60;       // the written policy: site stays live this long after lapse

/** 'YYYY-MM' month bucket — matches the notices table's period semantics. */
export const periodOf = (iso: string): string => iso.slice(0, 7);

/** A no-card trial past its end must LAPSE (Stripe never tells us — we must). Pure. */
export function shouldExpireTrial(e: EntitlementView, nowIso: string): boolean {
  return e.status === 'active' && !e.stripe_subscription_id && !!e.trial_ends_at && e.trial_ends_at < nowIso;
}

/** Which lifecycle notices are due for this entitlement right now. Pure. */
export function lifecycleEventsFor(e: EntitlementView, nowIso: string): LifecycleKind[] {
  const out: LifecycleKind[] = [];
  const now = Date.parse(nowIso);
  if (e.status === 'active' && !e.stripe_subscription_id && e.trial_ends_at) {
    const end = Date.parse(e.trial_ends_at);
    const days = (end - now) / 86400_000;
    if (days > 0 && days <= 3) out.push('trial_ending');
  }
  if (shouldExpireTrial(e, nowIso)) out.push('trial_ended');
  if (e.status === 'paused') out.push('payment_trouble');
  if (e.status === 'lapsed') {
    const lapsedAt = e.updated_at ? Date.parse(e.updated_at) : NaN;
    const days = Number.isFinite(lapsedAt) ? (now - lapsedAt) / 86400_000 : 0;
    // L5 — the monthly lapse notice is BOUNDED, not forever. It rides the
    // wind-down window (month 0 + month 1); after the site comes down at
    // WIND_DOWN_DAYS the customer has had the full sequence (lapse → win-back →
    // wind-down reminder → takedown) and the monthly nag stops. Prevents emailing
    // a long-gone customer every month for years.
    if (days < WIND_DOWN_DAYS) out.push('account_lapsed');
    if (days >= 30 && days < WIND_DOWN_DAYS) out.push('win_back');            // once ever (period 'once')
    if (days >= 45 && days < WIND_DOWN_DAYS) out.push('winddown_reminder');   // day-45 export reminder, bounded to before takedown
  }
  return out;
}

/** The calm copy — one voice for the notice card and the email. Pure. */
export function lifecycleCopy(kind: LifecycleKind, businessName: string): { headline: string; body: string; subject: string; html: string } {
  const name = businessName || 'your business';
  switch (kind) {
    case 'trial_ending': return {
      headline: 'Your trial ends in a few days',
      body: 'Everything you’ve built stays exactly as it is when you pick a plan. If you do nothing, editing pauses at the end of the trial — your work is kept and your data is always yours to download.',
      subject: 'Your Studio OS trial ends in a few days',
      html: `<p>Your trial for <strong>${name}</strong> ends in a few days.</p><p>Pick a plan and everything continues exactly as-is. If you do nothing, editing pauses — nothing is deleted, and your data is always yours to download from the workspace.</p><p><a href="https://davisdigitalstudio.com/pricing.html">See plans</a></p>`,
    };
    case 'trial_ended': return {
      headline: 'Your trial has ended',
      body: 'Editing is paused, but nothing is lost — your site and everything you wrote are kept. Pick a plan to continue, or download everything you own any time.',
      subject: 'Your Studio OS trial has ended — your work is kept',
      html: `<p>The trial for <strong>${name}</strong> has ended, so editing is paused.</p><p>Nothing was deleted: your site and everything you wrote are kept. Pick a plan to pick up where you left off — or download everything you own from the workspace, any time.</p><p><a href="https://davisdigitalstudio.com/pricing.html">See plans</a></p>`,
    };
    case 'payment_trouble': return {
      headline: 'A payment didn’t go through',
      body: 'Your website is still up and nothing is lost. Please update your card in the billing portal — we’ll retry automatically, and everything continues the moment it succeeds.',
      subject: 'A payment didn’t go through — your site is still up',
      html: `<p>A payment for <strong>${name}</strong> didn’t go through.</p><p><strong>Your website is still up</strong> and nothing is lost. Please update your card in the billing portal — payment is retried automatically and everything continues the moment it succeeds.</p>`,
    };
    case 'search_setup': return {
      headline: 'One small step gets you into Google’s reports',
      body: 'Your site is live and Google can find it. Add your free Search Console code (Business → Search & discovery) and you’ll see exactly how people find you. Two minutes, once.',
      subject: 'Your website is live — one small step gets you Google’s reports',
      html: `<p>Your website for <strong>${name}</strong> is live and search engines can find it.</p><p>One optional step unlocks Google’s own reports about how people find you: add your free Search Console code in your workspace (Business → Search &amp; discovery). Two minutes, once — we take care of the rest.</p>`,
    };
    case 'winddown_reminder': return {
      headline: 'Two weeks left before your site comes down',
      body: 'Your subscription ended a while ago, so your published website comes down soon — around day 60. Everything you own is still downloadable, and restarting brings it all back instantly.',
      subject: 'Two weeks left — your website comes down soon',
      html: `<p>The subscription for <strong>${name}</strong> ended about 45 days ago, so your published website comes down soon (around day 60).</p><p>Two doors stay open: <strong>download everything you own</strong> from your workspace any time, or <strong>restart your plan</strong> and everything returns exactly as you left it.</p>`,
    };
    case 'win_back': return {
      headline: 'Your workspace is exactly where you left it',
      body: 'It’s been about a month. Nothing was deleted — your site, words, and photos are all kept. Restart whenever you like and pick up mid-sentence.',
      subject: 'Everything is where you left it',
      html: `<p>It’s been about a month since your subscription for <strong>${name}</strong> ended.</p><p>No pressure — just a reminder that nothing was deleted. Your site, your words, and your photos are kept, and restarting brings it all back exactly as you left it.</p><p><a href="https://davisdigitalstudio.com/pricing.html">See plans</a></p>`,
    };
    case 'welcome_back': return {
      headline: 'Welcome back — everything is just as you left it',
      body: 'Your subscription is active again. Your site, content, and settings are exactly as they were. Pick up right where you stopped.',
      subject: 'Welcome back to Studio OS',
      html: `<p>Welcome back! The subscription for <strong>${name}</strong> is active again.</p><p>Everything is exactly as you left it — your site, your words, your design. Pick up right where you stopped.</p>`,
    };
    case 'account_lapsed': return {
      headline: 'Your subscription has ended',
      body: `Your published website stays up for ${WIND_DOWN_DAYS} days from when the subscription ended, and your data is yours to download at any time — that door never closes. Restart whenever you like and everything is exactly where you left it.`,
      subject: 'Your Studio OS subscription has ended — what happens next',
      html: `<p>The subscription for <strong>${name}</strong> has ended. Here’s exactly what that means:</p><ul><li>Your published website stays up for <strong>${WIND_DOWN_DAYS} days</strong>.</li><li>Everything you own is downloadable at any time — that door never closes.</li><li>Nothing else is deleted; restart whenever you like and it’s all where you left it.</li></ul>`,
    };
  }
}

// ── the impure runner (called from /system/run) ──────────────────────────────
export async function runLifecycleSweep(limit = 50): Promise<{ expired_trials: number; notices: number; emails: number; wound_down: number; grace_lapsed: number; failures: number }> {
  const nowIso = new Date().toISOString();
  let expired = 0, notices = 0, emails = 0, wound_down = 0, grace_lapsed = 0, failures = 0;

  // FAIRNESS (0091): ordered by the last_swept_at rotation cursor + stamped on
  // consideration, so trial-expiry/grace/wind-down reach EVERY entitlement at
  // any scale (the unordered fetch depended on row order beyond limit*4).
  const ECOLS = 'client_id,status,trial_ends_at,stripe_subscription_id,updated_at,grace_until';
  let ents = await svc(`presence_entitlements?product=eq.presence&status=in.(active,paused,lapsed)&select=${ECOLS}&order=last_swept_at.asc.nullsfirst&limit=${limit * 4}`);
  if (!ents.ok) ents = await svc(`presence_entitlements?product=eq.presence&status=in.(active,paused,lapsed)&select=${ECOLS}&limit=${limit * 4}`);
  const rows: EntitlementView[] = Array.isArray(ents.json) ? ents.json : [];
  {
    const { stampCursor } = await import('../ops/scheduler.ts');
    await stampCursor('presence_entitlements', 'client_id', rows.map((r) => String(r.client_id)), { last_swept_at: nowIso }, '&product=eq.presence');
  }

  for (const e of rows.slice(0, limit * 4)) {
    // enforce trial expiry first (the revenue bug: nothing else ever flips it)
    if (shouldExpireTrial(e, nowIso)) {
      const up = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(e.client_id)}&product=eq.presence&status=eq.active`, {
        method: 'PATCH', body: JSON.stringify({ status: 'lapsed' }),
      });
      if (up.ok) { expired++; e.status = 'lapsed'; }
    }
    // L4 — ENFORCE the grace clock. A past-due account stays full+live during the
    // 14-day grace (banner, not lockout), but when the anchored grace_until passes
    // it must lapse — otherwise a card that never recovers keeps full access
    // forever. Reconcile runs earlier in the tick, so a recovered customer has
    // already had grace_until cleared; only the genuinely-delinquent remain.
    if (e.status === 'active' && e.grace_until && Date.parse(e.grace_until) < Date.parse(nowIso)) {
      const up = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(e.client_id)}&product=eq.presence&status=eq.active`, {
        method: 'PATCH', body: JSON.stringify({ status: 'lapsed' }),
      });
      if (up.ok) { grace_lapsed++; e.status = 'lapsed'; }
    }
    const events = lifecycleEventsFor({ ...e, status: e.status }, nowIso)
      .filter((k) => k !== 'trial_ended' || expired > 0 || e.status === 'lapsed'); // trial_ended notice rides the flip
    if (!events.length && e.status !== 'active') continue;   // active rows continue for the SD search-nudge check

    // site + client for the notice row and the email — skip quietly if missing
    const siteQ = await svc(`presence_sites?client_id=eq.${encodeURIComponent(e.client_id)}&select=id&limit=1`);
    const siteId = siteQ.json?.[0]?.id;
    const clientQ = await svc(`clients?id=eq.${encodeURIComponent(e.client_id)}&select=email,name&limit=1`);
    const email = clientQ.json?.[0]?.email || '';
    const bizName = clientQ.json?.[0]?.name || '';
    if (!siteId) continue;

    // H4 — ENFORCE the written wind-down, don't just warn about it. A site lapsed
    // past WIND_DOWN_DAYS comes down: hosting is removed and the workspace is
    // archived. The DB content is untouched, so /export and resubscribe-and-
    // republish both still work. Idempotent: the status filter (only live/paused/
    // ready sites) means an already-archived site is never touched again.
    if (e.status === 'lapsed') {
      const lapsedAt = e.updated_at ? Date.parse(e.updated_at) : NaN;
      const lapsedDays = Number.isFinite(lapsedAt) ? (Date.parse(nowIso) - lapsedAt) / 86400_000 : 0;
      if (lapsedDays >= WIND_DOWN_DAYS) {
        const hosted = await svc(`presence_sites?client_id=eq.${encodeURIComponent(e.client_id)}&status=in.(live,paused,ready)&select=id,netlify_site_id&limit=5`);
        for (const site of (Array.isArray(hosted.json) ? hosted.json : [])) {
          // deleteSite returns {ok:false} rather than throwing — CHECK it. Erasing
          // netlify_site_id after a failed takedown would leave a lapsed customer's
          // site live on Netlify forever, unfindable and unreported. On failure the
          // row keeps its pointer and retries next sweep (counted in failures → sweepIssues pages).
          if (site.netlify_site_id) {
            const del = await deleteSite(site.netlify_site_id).catch(() => ({ ok: false }));
            if (!(del as { ok?: boolean }).ok) { failures++; console.error(`[lifecycle] wind-down takedown FAILED for site ${site.id} — keeping netlify_site_id for retry`); continue; }
          }
          const up = await svc(`presence_sites?id=eq.${encodeURIComponent(site.id)}`, {
            method: 'PATCH', body: JSON.stringify({ status: 'archived', netlify_site_id: null, custom_domain: null }),
          });
          if (up.ok) wound_down++;
        }
      }
    }

    // Phase SD: the search-setup nudge — published site, no verification code, once ever
    if (e.status === 'active') {
      const sQ = await svc(`presence_sites?client_id=eq.${encodeURIComponent(e.client_id)}&select=id,last_published_at&limit=1`);
      const vQ = sQ.json?.[0]?.id ? await svc(`presence_settings?site_id=eq.${sQ.json[0].id}&select=google_site_verification&limit=1`) : { json: [] as any[] };
      if (sQ.json?.[0]?.last_published_at && !String(vQ.json?.[0]?.google_site_verification || '').trim()) {
        const copy = lifecycleCopy('search_setup', bizName);
        const fresh = await raiseNotice({ siteId: sQ.json[0].id, clientId: e.client_id, kind: 'search_setup', period: 'once', headline: copy.headline, body: copy.body });
        if (fresh) { notices++; if (email && (await sendEmail(email, copy.subject, copy.html))) emails++; }
      }
    }
    for (const kind of events) {
      const copy = lifecycleCopy(kind, bizName);
      // send-once: raiseNotice's unique(client,kind,period) key decides — created=true = newly inserted
      const dedupe = kind === 'win_back' ? 'once' : periodOf(nowIso);
      const fresh = await raiseNotice({ siteId, clientId: e.client_id, kind, period: dedupe, headline: copy.headline, body: copy.body });
      if (fresh) {
        notices++;
        // payment_trouble + winddown_reminder are TRANSACTIONAL (payment failure /
        // "your site comes down") — they must survive a marketing opt-out.
        const critical = kind === 'payment_trouble' || kind === 'winddown_reminder' ? { critical: true } : undefined;
        if (email && (await sendEmail(email, copy.subject, copy.html, undefined, critical))) emails++;
      }
    }
  }
  return { expired_trials: expired, notices, emails, wound_down, grace_lapsed, failures };
}

// ── Phase CP-3 (CP-5): the weekly owner digest — the Monday routine, automated ──
// Return shape matters: sweepIssues() treats a non-skipped FALSE boolean as a
// tick failure, so the ~671-of-672 weekly ticks where the digest correctly
// does nothing must read as skipped_* (informational), never `sent: false` —
// that shape marked every healthy tick failed and would page the watchdog
// permanently. Numeric `sent` + explicit skip/failure flags.
export async function runWeeklyDigest(): Promise<{ sent: number; skipped_no_email?: boolean; skipped_dedupe?: boolean; failures?: number }> {
  const to = Deno.env.get('OPS_ALERT_EMAIL') || '';
  if (!to) return { sent: 0, skipped_no_email: true };
  const st = await svc('presence_ops_state?id=eq.1&select=last_digest_at');
  const last = st.json?.[0]?.last_digest_at ? Date.parse(st.json[0].last_digest_at) : 0;
  if (Date.now() - last < 7 * 86400_000) return { sent: 0, skipped_dedupe: true };
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const twoDays = new Date(Date.now() - 2 * 86400_000).toISOString();
  // Exact counts (svcCount) — fetch-to-count saturates at PostgREST max-rows,
  // so the digest would silently under-report at scale.
  const [subs, paused, lapsed, leads, fails] = await Promise.all([
    svcCount(`presence_entitlements?product=eq.presence&created_at=gt.${since}`),
    svcCount('presence_entitlements?product=eq.presence&status=eq.paused'),
    svcCount('presence_entitlements?product=eq.presence&status=eq.lapsed'),
    svcCount(`presence_form_submissions?status=eq.new&spam=is.false&created_at=lt.${twoDays}`),
    svcCount(`presence_publishes?status=eq.failed&created_at=gt.${since}`),
  ]);
  const n = (c: number | null) => c ?? 0;

  // ── "Your business this week" — the owner's OWN pipeline numbers, folded into
  // THIS same weekly email (never a second one). Scoped to the site the digest's
  // recipient actually owns (presence_identity.email == OPS_ALERT_EMAIL), so it is
  // the owner's sales — NOT a fleet-wide sum of customers' pipelines. Best-effort
  // and honest: if the owner owns no Presence site (or a read fails), the block is
  // simply omitted — never a fabricated number, and each figure reads calmly at zero.
  let numbersHtml = '';
  try {
    const ident = await svc(`presence_identity?email=eq.${encodeURIComponent(to)}&select=site_id&limit=1`);
    const ownSite = Array.isArray(ident.json) ? ident.json[0]?.site_id : null;
    if (ownSite) {
      const usd = (c: number) => '$' + (Math.max(0, c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
      const [newLeads, wonCount, paidRows, dealRows] = await Promise.all([
        svcCount(`presence_form_submissions?site_id=eq.${ownSite}&spam=is.false&created_at=gt.${since}`),
        svcCount(`presence_deals?site_id=eq.${ownSite}&deleted_at=is.null&converted_at=gt.${since}`),
        svc(`presence_invoices?site_id=eq.${ownSite}&status=eq.paid&paid_at=gt.${since}&deleted_at=is.null&select=amount_cents&limit=500`),
        svc(`presence_deals?site_id=eq.${ownSite}&deleted_at=is.null&select=stage,expected_value_cents,converted_client_id,converted_at,updated_at&limit=2000`),
      ]);
      const paid = (Array.isArray(paidRows.json) ? paidRows.json : []) as Array<{ amount_cents: number }>;
      const collected = paid.reduce((a, r) => a + (Number(r.amount_cents) || 0), 0);
      const summary = summarizePipeline(Array.isArray(dealRows.json) ? dealRows.json : [], new Date().toISOString());
      const nLeads = n(newLeads), nWon = n(wonCount);
      numbersHtml = `<p style="margin-top:22px"><strong>Your business this week</strong></p><ul>
<li>${nLeads ? `<strong>${nLeads}</strong> new website ${nLeads === 1 ? 'enquiry' : 'enquiries'}.` : 'No new website enquiries this week.'}</li>
<li>${nWon ? `<strong>${nWon}</strong> ${nWon === 1 ? 'deal became a customer' : 'deals became customers'}.` : 'No deals became customers this week.'}</li>
<li>${collected ? `<strong>${usd(collected)}</strong> collected across ${paid.length} ${paid.length === 1 ? 'payment' : 'payments'}.` : 'No payments collected this week.'}</li>
<li>${summary.open.count ? `<strong>${usd(summary.open.value_cents)}</strong> in open pipeline across ${summary.open.count} ${summary.open.count === 1 ? 'deal' : 'deals'}.` : 'No open deals in your pipeline right now.'}</li>
</ul>`;
    }
  } catch { /* the ops digest still sends without the numbers block */ }

  const html = `<p>Your Studio OS week, in one glance:</p><ul>
<li><strong>${n(subs)}</strong> new subscription${n(subs) === 1 ? '' : 's'}</li>
<li><strong>${n(paused)}</strong> with payment trouble${n(paused) ? ' — they were told their site is still up' : ''}</li>
<li><strong>${n(lapsed)}</strong> lapsed (wind-down comms run automatically)</li>
<li><strong>${n(leads)}</strong> lead${n(leads) === 1 ? '' : 's'} waiting more than 2 days for a reply</li>
<li><strong>${n(fails)}</strong> failed publish${n(fails) === 1 ? '' : 'es'} this week</li>
</ul>${numbersHtml}<p style="margin-top:22px">Details live in Stripe, the leads inbox, and /system/health. The watchdog emails you separately if production ever goes dark.</p>`;
  // critical:true — `to` IS OPS_ALERT_EMAIL: this is the OPERATOR's own weekly
  // operational digest of his own platform (failed publishes, payment trouble,
  // leads going stale), not marketing. Without the flag one unsubscribe click
  // silently ends the Monday routine forever, and `sent` would keep reading 1.
  // Bounces/complaints still suppress it (account.ts:112-116).
  const ok = await sendEmail(to, '[Studio OS] Your week in one glance', html, undefined, { critical: true });
  await svc('presence_ops_state?id=eq.1', { method: 'PATCH', body: JSON.stringify({ last_digest_at: new Date().toISOString() }) });
  // a failed weekly send IS tick-worthy (failures>0 → sweepIssues flags it)
  return ok ? { sent: 1 } : { sent: 0, failures: 1 };
}

// ── P3-CRO: the day-7 free-review follow-up (OWNER-GATED outbound) ────────────
// A free-score lead who left an email gets the report and then silence. This
// sends ONE calm second touch, 7–21 days later, referencing their actual score.
// HARD GATE: NURTURE_DRIP=1 must be set by the owner (automated outbound in the
// owner's name is never activated by a deploy). Send-once via nurture_sent_at
// (0092); suppression list respected (marketing — no critical flag); a pre-0092
// environment errors on the select and no-ops cleanly.
export async function runProspectNurture(limit = 10): Promise<{ sent: number; skipped_off?: boolean }> {
  if (Deno.env.get('NURTURE_DRIP') !== '1') return { sent: 0, skipped_off: true };
  const from = new Date(Date.now() - 21 * 86400_000).toISOString();  // not stale
  const to = new Date(Date.now() - 7 * 86400_000).toISOString();     // aged a week
  const q = await svc(`audit_leads?client_email=not.is.null&nurture_sent_at=is.null&status=eq.new&created_at=gte.${encodeURIComponent(from)}&created_at=lte.${encodeURIComponent(to)}&select=id,client_email,business_name,url,score&order=created_at.asc&limit=${limit}`);
  if (!q.ok) return { sent: 0 };
  let sent = 0;
  for (const lead of (Array.isArray(q.json) ? q.json : []) as Array<{ id: string; client_email: string; business_name?: string; url?: string; score?: number }>) {
    const scoreLine = typeof lead.score === 'number'
      ? `it scored <strong>${lead.score}/100</strong> at the time`
      : 'we sent you the findings at the time';
    const html = `<p>Hi${lead.business_name ? ' — this is about ' + lead.business_name : ''},</p>
<p>About a week ago you ran the free site review on <strong>${(lead.url || 'your website').replace(/[<>&"]/g, '')}</strong> — ${scoreLine}.</p>
<p>If you've made changes since, it's worth <a href="https://davisdigitalstudio.com/audit.html">running it again</a> to see the score move. And if any of the findings felt hard to act on, I'm happy to talk them through — a short call, no charge, no pitch.</p>
<p><a href="https://davisdigitalstudio.com/contact.html">Book a free 15-minute call</a></p>
<p>— Eric<br>Davis Digital Studio</p>`;
    const ok = await sendEmail(lead.client_email, 'Your website review, a week later', html);
    // Stamp regardless of send outcome (a suppressed/bounced address must not
    // be retried every tick — that's the whole point of the suppression list).
    await svc(`audit_leads?id=eq.${lead.id}`, { method: 'PATCH', body: JSON.stringify({ nurture_sent_at: new Date().toISOString() }) }).catch(() => {});
    if (ok) sent++;
  }
  return { sent };
}

// ── Phase INF (CP-8): the domain watch — RDAP expiry + registrar, daily ──────
export async function runDomainWatch(limit = 10): Promise<{ checked: number; warned: number }> {
  const nowIso = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 24 * 3600_000).toISOString();
  const q = await svc(`presence_sites?custom_domain=not.is.null&or=(domain_checked_at.is.null,domain_checked_at.lt.${encodeURIComponent(staleBefore)})&select=id,client_id,custom_domain&limit=${limit}`);
  let checked = 0, warned = 0;
  for (const site of (Array.isArray(q.json) ? q.json : []) as Array<{ id: string; client_id: string; custom_domain: string }>) {
    const info = await rdapLookup(site.custom_domain);
    checked++;
    await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({
      domain_checked_at: nowIso,
      ...(info ? { domain_registrar: info.registrar, domain_expires_at: info.expires_at } : {}),
    }) });
    const days = info ? daysUntil(info.expires_at, nowIso) : null;
    if (days !== null && days <= 30) {
      const soon = days <= 7;
      const when = days <= 0 ? 'has expired' : `expires in ${days} day${days === 1 ? '' : 's'}`;
      const fresh = await raiseNotice({ siteId: site.id, clientId: site.client_id, kind: 'domain_expiry', period: periodOf(nowIso),
        headline: `Your domain ${when}`,
        body: `${site.custom_domain} ${when}${info?.registrar ? ` at ${info.registrar}` : ''}. Renew it at your registrar (auto-renew is the calm option) — if it lapses, your website and email stop answering. Nothing else is needed on our side.` });
      if (fresh) {
        warned++;
        const cl = await svc(`clients?id=eq.${encodeURIComponent(site.client_id)}&select=email,name&limit=1`);
        if (cl.json?.[0]?.email) {
          const brand = await loadEmailBrand(site.id);   // BR-1: the customer's domain notice, on their brand
          await sendEmail(cl.json[0].email, `Your domain ${site.custom_domain} ${when}`,
            `<p><strong>${site.custom_domain}</strong> ${when}${info?.registrar ? ` at <strong>${info.registrar}</strong>` : ''}.</p><p>Renewing at your registrar (auto-renew is the calm option) keeps your website and email answering. Nothing is needed on our side — this is just the reminder registrars are quiet about.</p>`, brand);
        }
        if (soon) {
          // OPERATIONAL, to the platform operator (critical:true — an opt-out
          // must not silence it; a bounce/complaint still does).
          const ops = Deno.env.get('OPS_ALERT_EMAIL') || '';
          if (ops) sendEmail(ops, `[Studio OS ops] Domain ${when}: ${site.custom_domain}`, `<p>Customer domain ${site.custom_domain} ${when}. They have been notified.</p>`, undefined, { critical: true }).catch(() => {});
        }
      }
    }
  }
  return { checked, warned };
}

// ── Phase CRM (FD-CRM1): the un-replied lead follow-up nudge ──────────────────
// A lead emails the owner once on arrival; if it then sits 'new' for a day,
// nothing tapped them until the weekly digest — too slow for a hot quote. Raise
// ONE calm notice + email per lead (period = the lead id → exactly once, ever),
// for non-spam leads 1–7 days old still marked 'new'. Same 15-min sweep, same
// notices rail, same send-once semantics as every other lifecycle touch.
export async function runLeadFollowups(limit = 20): Promise<{ nudged: number }> {
  const nowIso = new Date().toISOString();
  const from = new Date(Date.now() - 7 * 86400_000).toISOString();   // still fresh (<1 week)
  const to = new Date(Date.now() - 24 * 3600_000).toISOString();     // aged at least a day
  const q = await svc(`presence_form_submissions?status=eq.new&spam=is.false&created_at=gte.${encodeURIComponent(from)}&created_at=lte.${encodeURIComponent(to)}&select=id,site_id,form_kind,name,email,created_at&order=created_at.asc&limit=${limit}`);
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const base = (Deno.env.get('SITE_URL') || 'https://presence.davisdigitalstudio.com').replace(/\/$/, '');
  let nudged = 0;
  for (const lead of (Array.isArray(q.json) ? q.json : []) as Array<{ id: string; site_id: string; form_kind: string; name?: string; email?: string; created_at: string }>) {
    if (!leadFollowupDue(lead, nowIso)) continue;                    // pure guard (defends the SQL window)
    const siteQ = await svc(`presence_sites?id=eq.${lead.site_id}&select=client_id&limit=1`);
    const clientId = siteQ.json?.[0]?.client_id;
    if (!clientId) continue;
    const who = lead.name || lead.email || 'Someone';
    const copy = leadFollowupCopy(lead.form_kind, who);
    const fresh = await raiseNotice({ siteId: lead.site_id, clientId, kind: 'lead_followup', period: `lead:${lead.id}`, headline: copy.headline, body: copy.body });
    if (fresh) {
      nudged++;
      const ident = await svc(`presence_identity?site_id=eq.${lead.site_id}&select=email&limit=1`);
      const owner = ident.json?.[0]?.email;
      if (owner) {
        const brand = await loadEmailBrand(lead.site_id);   // BR-1: on the owner's brand
        sendEmail(String(owner), copy.subject, `<p>${esc(who)} reached out through your website about a day ago and hasn’t heard back yet.</p><p class="cta"><a href="${base}/leads.html" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Reply now →</a></p><p style="color:#938ba3;font-size:13px">A quick response keeps them warm.</p>`, brand).catch(() => {});
      }
    }
  }
  return { nudged };
}

// ── CRM: nudge stale DEALS (leads had this; deals didn't) ────────────────────
// A deal parked in qualified/proposal/contract with no movement for a few days
// would otherwise sit forever — Pipedrive/Dubsado's whole promise is "no deal
// falls through." Same 15-min sweep, same notices rail, send-once per deal.
export async function runDealFollowups(limit = 20): Promise<{ nudged: number }> {
  const from = new Date(Date.now() - 30 * 86400_000).toISOString();   // not ancient (<30d)
  const to = new Date(Date.now() - 3 * 86400_000).toISOString();      // quiet at least 3 days
  const q = await svc(`presence_deals?deleted_at=is.null&converted_client_id=is.null&stage=in.(qualified,proposal,contract)&updated_at=gte.${encodeURIComponent(from)}&updated_at=lte.${encodeURIComponent(to)}&select=id,site_id,title,stage&order=updated_at.asc&limit=${limit}`);
  let nudged = 0;
  for (const deal of (Array.isArray(q.json) ? q.json : []) as Array<{ id: string; site_id: string; title?: string; stage: string }>) {
    const siteQ = await svc(`presence_sites?id=eq.${deal.site_id}&select=client_id&limit=1`);
    const clientId = siteQ.json?.[0]?.client_id;
    if (!clientId) continue;
    const title = deal.title || 'a deal';
    const body = deal.stage === 'proposal' ? 'A proposal has been out for a few days with no reply — a quick nudge often closes it.'
      : deal.stage === 'contract' ? 'The agreement is sent but not signed yet — a gentle reminder helps it over the line.'
      : 'This deal has gone quiet for a few days — a quick follow-up keeps it moving.';
    const fresh = await raiseNotice({ siteId: deal.site_id, clientId, kind: 'deal_followup', period: `deal:${deal.id}`, headline: `Follow up on ${title}`, body });
    if (fresh) {
      nudged++;
      // Parity with lead follow-ups: a quiet $5k proposal deserves at least the
      // email a fresh $0 lead gets. Send-once (gated on the notice insert above).
      try {
        const ident = await svc(`presence_identity?site_id=eq.${deal.site_id}&select=email&limit=1`);
        const owner = ident.json?.[0]?.email;
        if (owner) {
          const base = (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');
          const brand = await loadEmailBrand(deal.site_id);
          const safeBody = body.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
          sendEmail(String(owner), `Follow up on ${title}`, `<p>${safeBody}</p><p class="cta"><a href="${base}/pipeline.html?deal=${deal.id}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Open the deal →</a></p>`, brand).catch(() => {});
        }
      } catch { /* the notice already carries it */ }
    }
  }
  return { nudged };
}

// ── SUPPORT AGING: nudge the OWNER about a request that has waited (service edge #3) ─
// A submitted support request that sits open/in_progress with no movement for a
// few days would otherwise wait until someone happens to look. Mirroring the
// lead/deal follow-up pattern exactly: same 15-min sweep, same notices rail,
// send-once per request PER WEEK (period = the request id + a 7-day bucket, so a
// still-open request re-nudges rather than going quiet). The nudge goes to the OWNER
// ONLY — the customer already got the calm auto-ack on submit; we never auto-
// message them again here. Best-effort + graceful: pre-0095 the 'support_aging'
// notice fails the kind check and raiseNotice returns false (no email, no throw).
export async function runSupportAging(limit = 20): Promise<{ nudged: number }> {
  const nowIso = new Date().toISOString();
  const from = new Date(Date.now() - 30 * 86400_000).toISOString();                 // not ancient (<30d)
  const to = new Date(Date.now() - SUPPORT_AGING_DAYS * 86400_000).toISOString();   // quiet at least N days
  const q = await svc(`presence_support_requests?deleted_at=is.null&status=in.(open,in_progress)&updated_at=gte.${encodeURIComponent(from)}&updated_at=lte.${encodeURIComponent(to)}&select=id,site_id,subject,status,priority,updated_at&order=updated_at.asc&limit=${limit}`);
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const base = (Deno.env.get('SITE_URL') || 'https://presence.davisdigitalstudio.com').replace(/\/$/, '');
  let nudged = 0;
  for (const r of (Array.isArray(q.json) ? q.json : []) as Array<{ id: string; site_id: string; subject?: string; status: string; priority?: string; updated_at: string }>) {
    if (!supportAgingDue(r, nowIso)) continue;                    // pure guard (defends the SQL window)
    const siteQ = await svc(`presence_sites?id=eq.${r.site_id}&select=client_id&limit=1`);
    const clientId = siteQ.json?.[0]?.client_id;
    if (!clientId) continue;
    const subject = r.subject || 'a support request';
    const urgent = r.priority === 'high' || r.priority === 'urgent';
    const body = urgent
      ? `A ${r.priority}-priority support request has been waiting a few days without a reply — worth a look soon.`
      : 'A support request has been open a few days without a reply — a quick response keeps the customer confident.';
    // WEEKLY, not once-ever. `support:<id>` muted a request permanently after one
    // fire — a ticket that genuinely stalled went silent while still waiting on the
    // owner. supportAgingPeriod buckets by 7 days: send-once inside the week (the
    // sweep runs every 15 min), and it speaks up again next week if it's STILL
    // open. Resolve/close clears every bucket at once (clearNoticePrefix).
    const fresh = await raiseNotice({ siteId: r.site_id, clientId, kind: 'support_aging', period: supportAgingPeriod(r.id, Date.now()), headline: `Waiting on you — ${subject}`, body });
    if (fresh) {
      nudged++;
      // Parity with lead/deal nudges: the owner also gets the email once (send-once
      // gated on the notice insert above), on their own brand.
      try {
        const ident = await svc(`presence_identity?site_id=eq.${r.site_id}&select=email&limit=1`);
        const owner = ident.json?.[0]?.email;
        if (owner) {
          const brand = await loadEmailBrand(r.site_id);
          sendEmail(String(owner), `A support request is waiting — ${subject}`,
            `<p>${esc(body)}</p><p class="cta"><a href="${base}/projects.html?support=${r.id}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Open the request →</a></p>`, brand).catch(() => {});
        }
      } catch { /* the owner notice already carries it */ }
    }
  }
  return { nudged };
}

// ── MONEY FOLLOW-UPS: unpaid invoices/deposits get ONE gentle reminder ────────
// presence_invoices rows carry due_date and a stored payment link, but nothing
// ever swept them — an unpaid deposit simply sat. One reminder per invoice
// (send-once via the notices dedupe), re-using the stored Stripe link, to the
// deal's contact; the owner gets the notice on the same rail.
export async function runInvoiceReminders(limit = 20): Promise<{ reminded: number }> {
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();   // open for 7+ days
  const today = new Date().toISOString().slice(0, 10);
  // Fetch a WIDE candidate window, then drop already-reminded ones up front —
  // otherwise the oldest `limit` open invoices occupy the window forever and
  // invoice #limit+1 never gets its reminder (starvation).
  const q = await svc(`presence_invoices?status=eq.open&deleted_at=is.null&stripe_url=not.is.null&or=(due_date.lt.${today},and(due_date.is.null,created_at.lt.${encodeURIComponent(cutoff)}))&select=id,site_id,deal_id,title,amount_cents,purpose,stripe_url&order=created_at.asc&limit=${limit * 5}`);
  const candidates = (Array.isArray(q.json) ? q.json : []) as Array<{ id: string; site_id: string; deal_id: string | null; title?: string; amount_cents: number; purpose: string; stripe_url: string }>;
  let fresh = candidates;
  if (candidates.length) {
    const periods = candidates.map((i) => `"invremind:${i.id}"`).join(',');
    const seen = await svc(`presence_plan_notices?kind=eq.deal_followup&period=in.(${periods})&select=period&limit=${candidates.length}`);
    const done = new Set(((seen.json as Array<{ period: string }>) || []).map((r) => r.period));
    fresh = candidates.filter((i) => !done.has(`invremind:${i.id}`)).slice(0, limit);
  }
  let reminded = 0;
  for (const inv of fresh) {
    const siteQ = await svc(`presence_sites?id=eq.${inv.site_id}&select=client_id&limit=1`);
    const clientId = siteQ.json?.[0]?.client_id;
    if (!clientId) continue;
    const amount = '$' + ((Number(inv.amount_cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const what = inv.purpose === 'deposit' ? 'deposit' : 'invoice';
    // Discover the client email FIRST — the notice must tell the truth about
    // whether a nudge actually went out (and never burn the once-ever dedupe
    // on a claim that didn't happen).
    let email = '';
    try {
      if (inv.deal_id) {
        const deal = (await svc(`presence_deals?id=eq.${inv.deal_id}&site_id=eq.${inv.site_id}&select=contact_id&limit=1`)).json?.[0];
        email = deal?.contact_id ? String((await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${inv.site_id}&select=email&limit=1`)).json?.[0]?.email || '') : '';
      }
    } catch { /* treated as no email on file */ }
    const noticeBody = email
      ? 'We nudged the client once with the same secure link. If it stays quiet, a personal note usually lands best.'
      : 'There’s no client email on this deal, so no automatic nudge went out — a personal note (or adding their email to the contact) is the way forward.';
    const fresh = await raiseNotice({ siteId: inv.site_id, clientId, kind: 'deal_followup', period: `invremind:${inv.id}`, headline: `Still unpaid — ${inv.title || what} (${amount})`, body: noticeBody });
    if (!fresh) continue;   // already reminded once — never nag
    reminded++;
    if (email) {
      try {
        const brand = await loadEmailBrand(inv.site_id);
        const btn = `<a href="${inv.stripe_url}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Pay ${amount} securely →</a>`;
        sendEmail(email, `A gentle reminder — ${inv.title || what} (${amount})`,
          `<p>Just a friendly nudge: the ${what} for <strong>${amount}</strong> is still open. The same secure link works whenever you're ready — nothing expires.</p><p class="cta">${btn}</p>`, brand).catch(() => {});
      } catch { /* the owner notice already carries it */ }
    }
  }
  return { reminded };
}

// ── PP-2 / CP-3.1: the annual renewal heads-up ───────────────────────────────
// Never surprise a customer with a yearly charge. For annual terms not set to
// cancel, a calm note goes out ~30 days and again ~7 days before the renewal
// date — the plan, the date, what they built this year, and a link to manage it.
// Same notices rail + send-once (period = renewal-date:window) + email.
export async function runRenewalReminders(limit = 50): Promise<{ reminded: number }> {
  const nowIso = new Date().toISOString();
  const within = new Date(Date.now() + 31 * 86400_000).toISOString();
  const base = (Deno.env.get('SITE_URL') || 'https://presence.davisdigitalstudio.com').replace(/\/$/, '');
  const q = await svc(`presence_entitlements?product=eq.presence&term=eq.annual&cancel_at_period_end=eq.false&current_period_end=not.is.null&current_period_end=lte.${encodeURIComponent(within)}&select=client_id,plan,current_period_end&limit=${limit}`);
  let reminded = 0;
  for (const e of (Array.isArray(q.json) ? q.json : []) as Array<{ client_id: string; plan: string; current_period_end: string }>) {
    const win = renewalReminderWindow(e, nowIso);
    if (!win) continue;
    const siteQ = await svc(`presence_sites?client_id=eq.${encodeURIComponent(e.client_id)}&select=id&order=created_at.asc&limit=1`);
    const siteId = siteQ.json?.[0]?.id;
    if (!siteId) continue;
    const pubQ = await svc(`presence_publishes?site_id=eq.${siteId}&status=eq.live&select=id&limit=200`);
    const published = Array.isArray(pubQ.json) ? pubQ.json.length : 0;
    const planName = EDITION_DEFS[editionFromPlan(e.plan)]?.name || 'your';
    const copy = renewalReminderCopy(planName, e.current_period_end, win, published);
    const fresh = await raiseNotice({ siteId, clientId: e.client_id, kind: 'renewal_reminder', period: renewalNoticePeriod(e.current_period_end, win), headline: copy.headline, body: copy.body });
    if (fresh) {
      reminded++;
      const ident = await svc(`presence_identity?site_id=eq.${siteId}&select=email&limit=1`);
      const owner = ident.json?.[0]?.email;
      if (owner) sendEmail(String(owner), copy.subject, `<p>${copy.body}</p><p><a href="${base}/portal.html">Review or manage your plan →</a></p>`).catch(() => {});
    }
  }
  return { reminded };
}

// ── AGREEMENT RENEWAL: nudge the OWNER before a signed agreement's term ends ──
// DISTINCT from the SaaS renewal_reminder (that watches presence_entitlements'
// annual plan). This watches the studio's OWN signed service agreements: a
// term-end date set on a signed contract (terms_snapshot.term_end, 0096) gets ONE
// calm owner nudge ~30 and again ~7 days out — never an auto-renew or auto-charge.
// Same notices rail + send-once (period = term_end:window) + owner email. Pre-0096
// nothing has a term_end, so the jsonb filter matches nothing → a clean no-op.
export async function runAgreementRenewalReminders(limit = 50): Promise<{ reminded: number }> {
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const within = new Date(Date.now() + 31 * 86400_000).toISOString().slice(0, 10);
  const base = (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');
  // ISO date strings compare correctly as text, so the jsonb ->> filter windows by date.
  const q = await svc(`presence_contracts?status=eq.signed&deleted_at=is.null&terms_snapshot->>term_end=gte.${today}&terms_snapshot->>term_end=lte.${within}&select=id,site_id,deal_id,title,terms_snapshot&order=created_at.asc&limit=${limit}`);
  if (!q.ok) return { reminded: 0 };   // pre-0096 / older data → clean no-op
  let reminded = 0;
  for (const c of (Array.isArray(q.json) ? q.json : []) as Array<{ id: string; site_id: string; deal_id: string | null; title?: string; terms_snapshot?: { term_end?: string } }>) {
    const termEnd = c.terms_snapshot?.term_end;
    const win = agreementRenewalWindow(termEnd, nowIso);
    if (!win) continue;
    const siteQ = await svc(`presence_sites?id=eq.${c.site_id}&select=client_id&limit=1`);
    const clientId = siteQ.json?.[0]?.client_id;
    if (!clientId) continue;
    const copy = agreementRenewalCopy(c.title || '', String(termEnd), win);
    const fresh = await raiseNotice({ siteId: c.site_id, clientId, kind: 'agreement_renewal', period: agreementRenewalPeriod(String(termEnd), win), headline: copy.headline, body: copy.body });
    if (fresh) {
      reminded++;
      const ident = await svc(`presence_identity?site_id=eq.${c.site_id}&select=email&limit=1`);
      const owner = ident.json?.[0]?.email;
      if (owner) {
        const link = c.deal_id ? `${base}/pipeline.html?deal=${c.deal_id}` : `${base}/pipeline.html`;
        sendEmail(String(owner), copy.subject, `<p>${copy.body}</p><p><a href="${link}">Open the deal →</a></p>`).catch(() => {});
      }
    }
  }
  return { reminded };
}

// ── UNSIGNED-DOC REMINDERS: one fresh link to the CLIENT per sent doc ─────────
// A proposal/agreement sitting "sent" for 3+ days gets exactly ONE reminder to
// the client with a freshly minted link (the original may be buried or expiring).
// Capped at one-ever per document via the notices dedupe; respects nothing older
// than 21 days (a dead deal shouldn't get a ghost nudge).
export async function runSalesDocReminders(limit = 20): Promise<{ reminded: number }> {
  const { linkSecret, signSalesToken } = await import('../routes/sales.ts');
  const secret = linkSecret();
  if (!secret) return { reminded: 0 };
  const from = new Date(Date.now() - 21 * 86400_000).toISOString();
  const to = new Date(Date.now() - 3 * 86400_000).toISOString();
  const base = (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');
  let reminded = 0;
  for (const kind of ['contract', 'proposal'] as const) {
    const table = kind === 'contract' ? 'presence_contracts' : 'presence_proposals';
    const q = await svc(`${table}?status=eq.sent&deleted_at=is.null&sent_at=gte.${encodeURIComponent(from)}&sent_at=lte.${encodeURIComponent(to)}&select=id,site_id,deal_id,title&order=sent_at.asc&limit=${limit}`);
    for (const doc of (Array.isArray(q.json) ? q.json : []) as Array<{ id: string; site_id: string; deal_id: string; title?: string }>) {
      const siteQ = await svc(`presence_sites?id=eq.${doc.site_id}&select=client_id&limit=1`);
      const clientId = siteQ.json?.[0]?.client_id;
      if (!clientId) continue;
      const what = kind === 'contract' ? 'agreement' : 'proposal';
      // Discover the email FIRST — the notice must tell the truth, and a doc with
      // no reachable client shouldn't burn its once-ever reminder on a no-op.
      let email = '';
      try {
        const deal = (await svc(`presence_deals?id=eq.${doc.deal_id}&site_id=eq.${doc.site_id}&select=contact_id&limit=1`)).json?.[0];
        email = deal?.contact_id ? String((await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${doc.site_id}&select=email&limit=1`)).json?.[0]?.email || '') : '';
      } catch { /* treated as no email */ }
      const noticeBody = email
        ? `The ${what} has been out a few days, so we sent the client one gentle reminder with a fresh link. If it stays quiet, a personal note lands best.`
        : `The ${what} has been out a few days, but there's no client email on the deal — add one to the contact, or reach out personally.`;
      // A SILENT LEDGER, not a row. "Reminder sent — your agreement" is STATUS,
      // not an ask: the studio has nothing to do about it, the deal history
      // already records it, and nothing ever cleared it, so it sat in "Needs you"
      // permanently. Recorded 'dismissed' exactly like runBookingReminders below:
      // it still holds the unique (client, kind, period) key, so `fresh` is still
      // the exact send-once gate for the client email — it simply stops being a
      // thing that claims to need the owner.
      const fresh = await raiseNotice({ siteId: doc.site_id, clientId, kind: 'deal_followup', period: `remind:${doc.id}`, status: 'dismissed', headline: `${email ? 'Reminder sent' : 'Still waiting'} — ${doc.title || `the ${what}`}`, body: noticeBody });
      if (!fresh) continue;
      if (!email) continue;
      try {
        const token = await signSalesToken({ t: kind, id: doc.id, site_id: doc.site_id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, secret);
        const brand = await loadEmailBrand(doc.site_id);
        const btn = `<a href="${base}/sign.html?t=${encodeURIComponent(token)}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">${kind === 'contract' ? 'Review & sign' : 'Review the proposal'} →</a>`;
        sendEmail(email, `Still there for you — ${doc.title || `your ${what}`}`,
          `<p>Just a gentle reminder: your ${what} is ready whenever you are. Here's a fresh link — take your time, nothing is final until you decide.</p><p class="cta">${btn}</p>`, brand).catch(() => {});
        reminded++;
      } catch { /* the owner notice already recorded the attempt */ }
    }
  }
  return { reminded };
}

// ── BOOKING REMINDERS: a calm, transactional reminder to the CUSTOMER (task #164) ─
// Native booking (0099) creates confirmed appointments but nothing reminded the
// customer. This sweep sends ONE branded reminder per band before the slot — a
// ~24h-out "day_before" nudge and a short "same_day" nudge (mutually exclusive
// bands; see lib/booking.ts). It reuses every rail: the ONE send path (sendEmail,
// suppression + one-click unsubscribe inherited), the customer's Brand Kit
// (loadEmailBrand), and the ONE notice model as the SEND-ONCE ledger.
//
// The reminder is TRANSACTIONAL (a direct consequence of the customer's own
// booking, exactly like the confirmation) → critical:true, so it survives a
// marketing opt-out but still respects a hard bounce/complaint. Suppression is
// enforced once, at sendEmail — never re-implemented here.
//
// SEND-ONCE without a schema flag: the notice model's unique (client,kind,period)
// IS the dedupe. We record the ledger row as 'dismissed' (a silent ledger, not an
// active bell card) via a direct insert — because a busy salon books many/day and
// a per-appointment "reminder sent" card would flood the owner's bell. The insert
// returns a row only on FIRST creation → the email goes out exactly once per band.
// Deploy-order-tolerant: pre-0099 the table read fails (clean early return); pre-
// 0100 the 'booking_reminder' kind fails the CHECK so the ledger insert returns no
// row → we simply DON'T send (never a per-tick re-send). Exactly the 0094–0099
// no-op-until-owner-apply behaviour.
export async function runBookingReminders(limit = 50): Promise<{ reminded: number }> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const horizon = new Date(now + REMINDER_DAY_HRS * 3600_000).toISOString();
  const q = await svc(`presence_appointments?status=eq.confirmed&slot_start=gt.${encodeURIComponent(nowIso)}&slot_start=lte.${encodeURIComponent(horizon)}&select=id,site_id,type_name,slot_start,slot_start_local,price_cents,customer_name,customer_email&order=slot_start.asc&limit=${limit}`);
  if (!q.ok) return { reminded: 0 };                          // pre-0099 → clean no-op
  const appts = (Array.isArray(q.json) ? q.json : []) as Array<{ id: string; site_id: string; type_name?: string; slot_start: string; slot_start_local?: string; price_cents?: number | null; customer_name?: string; customer_email?: string }>;
  if (!appts.length) return { reminded: 0 };
  // Pre-fetch which bands are already sent (the notice ledger), like invoiceReminders.
  const periods = appts.flatMap((a) => [`"remind:${a.id}:day_before"`, `"remind:${a.id}:same_day"`]).join(',');
  const seen = await svc(`presence_plan_notices?kind=eq.booking_reminder&period=in.(${periods})&select=period&limit=${appts.length * 2}`);
  const done = new Set(((seen.json as Array<{ period: string }>) || []).map((r) => r.period));
  const clientCache = new Map<string, string>();
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  let reminded = 0;
  for (const a of appts) {
    const sent = new Set<string>();
    if (done.has(`remind:${a.id}:day_before`)) sent.add('day_before');
    if (done.has(`remind:${a.id}:same_day`)) sent.add('same_day');
    const plan = planReminder({ status: 'confirmed', slotStartMs: Date.parse(a.slot_start), customer_email: a.customer_email }, now, sent);
    if (!plan) continue;

    let clientId = clientCache.get(a.site_id);
    if (clientId === undefined) {
      const site = (await svc(`presence_sites?id=eq.${a.site_id}&select=client_id&limit=1`)).json?.[0];
      clientId = String(site?.client_id || '');
      clientCache.set(a.site_id, clientId);
    }
    if (!clientId) continue;

    // ATOMIC send-once: a 'dismissed' ledger row (silent — no bell card, no push).
    // Returns a representation only on first insert; a re-raise (or a pre-0100 CHECK
    // rejection) returns no row → we don't send.
    const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        site_id: a.site_id, client_id: clientId, kind: 'booking_reminder',
        period: `remind:${a.id}:${plan.band}`, status: 'dismissed',
        headline: `Reminder sent — ${String(a.type_name || 'appointment').slice(0, 60)}`,
        body: `We reminded ${String(a.customer_name || 'the customer').slice(0, 80)} about their upcoming appointment.`,
      }),
    }).catch(() => ({ ok: false, json: null } as { ok: boolean; json: unknown }));
    const fresh = (ins as { ok?: boolean; json?: unknown }).ok && Array.isArray((ins as { json?: unknown }).json) && ((ins as { json: unknown[] }).json).length > 0;
    if (!fresh) continue;                                      // already sent, or pre-0100 → no-op

    const to = String(a.customer_email || '');
    if (!to) { reminded++; continue; }                         // (planReminder already excludes phone-only)
    try {
      const ident = (await svc(`presence_identity?site_id=eq.${a.site_id}&select=business_name&limit=1`)).json?.[0];
      const biz = ident?.business_name || 'the team';
      const brand = await loadEmailBrand(a.site_id);
      const when = humanSlot(String(a.slot_start_local || '')) || String(a.slot_start_local || '');
      const price = priceText(a.price_cents);
      const lead = plan.band === 'same_day'
        ? `Just a quick reminder — your appointment with ${esc(biz)} is coming up soon.`
        : `A friendly reminder that your appointment with ${esc(biz)} is coming up.`;
      const body =
        `<p>${lead}</p>` +
        `<table style="margin:8px 0;border-collapse:collapse"><tr><td style="padding:2px 12px 2px 0;color:#666">Service</td><td><b>${esc(a.type_name)}</b></td></tr>` +
        `<tr><td style="padding:2px 12px 2px 0;color:#666">When</td><td><b>${esc(when)}</b></td></tr>` +
        (price ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Price</td><td>${esc(price)}</td></tr>` : '') +
        `</table>` +
        `<p style="color:#666;font-size:.9rem">Need to change or cancel? Just reply to this email.</p>`;
      // Transactional (the customer's own booking) → critical:true; suppression is
      // enforced inside sendEmail (opt-out survived, bounce/complaint respected).
      await sendEmail(to, `Reminder — ${a.type_name} ${when ? `(${when})` : ''}`.trim(), body, brand, { critical: true });
      reminded++;
    } catch { /* the ledger row already marks this band sent — never re-send */ }
  }
  return { reminded };
}

// ── BOOKING FOLLOW-UP: nudge the OWNER after a slot passes (no-show / completion) ─
// A confirmed appointment whose slot has fully ELAPSED but is still 'confirmed'
// means the owner never told us what happened. Left alone it sits 'confirmed'
// forever and skews the upcoming list. We raise ONE calm OWNER notice per
// appointment (period = its id → once ever) asking them to mark it done or a
// no-show — an OWNER action. We NEVER auto-mark and NEVER message the customer
// again here. Same 15-min sweep, same ONE notice model, send-once semantics.
// Best-effort + graceful: pre-0100 the 'booking_followup' kind fails the CHECK and
// raiseNotice returns false (no push, no throw) — exactly like support_aging pre-0095.
export async function runBookingFollowups(limit = 50): Promise<{ nudged: number }> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const from = new Date(now - 14 * 86400_000).toISOString();  // not ancient (a fresh backlog only)
  const q = await svc(`presence_appointments?status=eq.confirmed&slot_end=lt.${encodeURIComponent(nowIso)}&slot_end=gte.${encodeURIComponent(from)}&select=id,site_id,type_name,slot_start_local,slot_end,customer_name&order=slot_end.desc&limit=${limit}`);
  if (!q.ok) return { nudged: 0 };                            // pre-0099 → clean no-op
  const clientCache = new Map<string, string>();
  let nudged = 0;
  for (const a of (Array.isArray(q.json) ? q.json : []) as Array<{ id: string; site_id: string; type_name?: string; slot_start_local?: string; slot_end: string; customer_name?: string }>) {
    if (!noShowNudgeDue({ status: 'confirmed', slotEndMs: Date.parse(a.slot_end) }, now)) continue;  // pure guard
    let clientId = clientCache.get(a.site_id);
    if (clientId === undefined) {
      const site = (await svc(`presence_sites?id=eq.${a.site_id}&select=client_id&limit=1`)).json?.[0];
      clientId = String(site?.client_id || '');
      clientCache.set(a.site_id, clientId);
    }
    if (!clientId) continue;
    const who = String(a.customer_name || 'the customer').slice(0, 40);
    const when = humanSlot(String(a.slot_start_local || '')) || '';
    const fresh = await raiseNotice({
      siteId: a.site_id, clientId, kind: 'booking_followup', period: `noshow:${a.id}`,
      headline: `Did ${who}'s appointment happen?`,
      body: `${a.type_name || 'The appointment'}${when ? ` on ${when}` : ''} has passed. Mark it done or a no-show so your bookings stay accurate.`,
    });
    if (fresh) nudged++;
  }
  return { nudged };
}

// ── EMAIL-AUTH ESCALATION: turn a passive finding into ONE calm owner nudge (DNS #5) ─
// The observation engine already DETECTS unauthenticated email (infrastructure.
// spf_missing / dmarc_missing, and — where a guided email_setup plan named the
// selector — a DKIM record that was never published). But a customer whose mail is
// forgeable only found out passively, buried in the Foundations page. This sweep
// ESCALATES it: when a gap has PERSISTED for EMAIL_AUTH_NUDGE_DAYS, raise exactly
// ONE owner nudge onto the ONE notice model (bell + push), send-once via the notice
// dedupe (period = the site → once ever; a persistent config gap earns one calm
// tap, never a monthly nag). Owner-facing only — the customer is never messaged
// about their own DNS. Best-effort + graceful: pre-0102 the 'email_auth' kind fails
// the CHECK and raiseNotice returns false (no push, no throw) — exactly the
// no-op-until-owner-apply behaviour of 0094–0101.
//
// PURE decision core (tested in dns_hardening_test.mjs); impure runner below.
export const EMAIL_AUTH_NUDGE_DAYS = 7;

export interface EmailAuthState {
  spfMissing: boolean;
  dmarcMissing: boolean;
  dkimMissing: boolean;
  sinceIso: string | null;      // earliest date any ACTIVE gap was first observed
  nowIso: string;
}

/** The named gaps, in a stable order, for the copy. Pure. */
export function emailAuthGaps(s: Pick<EmailAuthState, 'spfMissing' | 'dmarcMissing' | 'dkimMissing'>): string[] {
  const g: string[] = [];
  if (s.spfMissing) g.push('SPF');
  if (s.dmarcMissing) g.push('DMARC');
  if (s.dkimMissing) g.push('DKIM');
  return g;
}

/** Is an email-auth nudge due? Only when at least one gap is UNAUTHENTICATED and it
 *  has persisted `thresholdDays` — so a freshly-detected gap gets a grace period to
 *  self-resolve (records propagating) before the owner is tapped. Pure. */
export function emailAuthNudgeDue(s: EmailAuthState, thresholdDays = EMAIL_AUTH_NUDGE_DAYS): { due: boolean; gaps: string[] } {
  const gaps = emailAuthGaps(s);
  if (!gaps.length || !s.sinceIso) return { due: false, gaps };
  const since = Date.parse(s.sinceIso);
  if (!Number.isFinite(since)) return { due: false, gaps };
  const days = (Date.parse(s.nowIso) - since) / 86400_000;
  return { due: days >= thresholdDays, gaps };
}

/** One calm voice for the bell card + the owner email. Pure. */
export function emailAuthNudgeCopy(gaps: string[], businessName: string): { headline: string; body: string; subject: string; html: string } {
  const name = businessName || 'your business';
  const list = gaps.length <= 1 ? (gaps[0] || 'a key record')
    : gaps.slice(0, -1).join(', ') + ' and ' + gaps[gaps.length - 1];
  return {
    headline: 'Your email isn’t fully set up — messages may go to spam',
    body: `Email sent from your domain is missing ${list}, the record${gaps.length > 1 ? 's' : ''} that prove${gaps.length > 1 ? '' : 's'} your mail is really you. Without ${gaps.length > 1 ? 'them' : 'it'}, inboxes trust your email less and some messages can land in spam. It’s a small, one-time DNS fix — the platform prepares the exact records and checks them for you.`,
    subject: `${name}: a quick fix so your email doesn’t land in spam`,
    html: `<p>Email sent from your domain for <strong>${name}</strong> is missing ${list} — the record${gaps.length > 1 ? 's' : ''} that prove your mail is really you.</p><p>Without ${gaps.length > 1 ? 'them' : 'it'}, inboxes trust your email less and some messages can go to spam. It’s a small, one-time fix: the platform prepares the exact DNS records and verifies them. Nothing about how you send email changes.</p>`,
  };
}

// ── the impure runner (called from /system/run) ──
export async function runEmailAuthNudges(limit = 20): Promise<{ nudged: number }> {
  const nowIso = new Date().toISOString();
  // "still current" window — a gap re-confirmed by an observation run within this
  // span is treated as present now (tolerates a slower run cadence than the sweep).
  const recentFrom = new Date(Date.now() - 10 * 86400_000).toISOString();

  // Candidate sites #1: latest observation runs still flag SPF/DMARC missing.
  const evQ = await svc(`presence_evidence?type=in.(infrastructure.spf_missing,infrastructure.dmarc_missing)&observed_at=gte.${encodeURIComponent(recentFrom)}&select=site_id,type&order=observed_at.desc&limit=${limit * 30}`);
  const cand = new Map<string, { spf: boolean; dmarc: boolean }>();
  for (const r of (Array.isArray(evQ.json) ? evQ.json : []) as Array<{ site_id: string; type: string }>) {
    const c = cand.get(r.site_id) || { spf: false, dmarc: false };
    if (r.type === 'infrastructure.spf_missing') c.spf = true;
    if (r.type === 'infrastructure.dmarc_missing') c.dmarc = true;
    cand.set(r.site_id, c);
  }
  // Candidate sites #2 (DKIM-only): a guided email_setup plan means the owner
  // INTENDED full authentication — so a DKIM record still absent is a real gap even
  // when SPF/DMARC are fine. The selector host is named inside the plan's steps.
  const planQ = await svc(`presence_infra_plans?kind=eq.email_setup&status=in.(approved,applied)&select=site_id&order=created_at.desc&limit=${limit * 5}`);
  for (const p of (Array.isArray(planQ.json) ? planQ.json : []) as Array<{ site_id: string }>) {
    if (!cand.has(p.site_id)) cand.set(p.site_id, { spf: false, dmarc: false });
  }

  let nudged = 0;
  for (const [siteId, cur] of [...cand].slice(0, limit)) {
    const siteQ = await svc(`presence_sites?id=eq.${encodeURIComponent(siteId)}&select=client_id&limit=1`);
    const clientId = siteQ.json?.[0]?.client_id;
    if (!clientId) continue;

    // firstSeen for the active SPF/DMARC gaps (how long has it been unauthenticated?)
    const activeTypes: string[] = [];
    if (cur.spf) activeTypes.push('infrastructure.spf_missing');
    if (cur.dmarc) activeTypes.push('infrastructure.dmarc_missing');
    let sinceMs = Infinity;
    if (activeTypes.length) {
      const fsQ = await svc(`presence_evidence?site_id=eq.${encodeURIComponent(siteId)}&type=in.(${activeTypes.join(',')})&select=observed_at&order=observed_at.asc&limit=1`);
      const fs = fsQ.json?.[0]?.observed_at;
      if (fs && Number.isFinite(Date.parse(fs))) sinceMs = Math.min(sinceMs, Date.parse(fs));
    }

    // DKIM — honestly detectable only when a plan names the selector host. A failed
    // lookup (null) is NOT treated as missing; the "expected" clock starts when the
    // plan was applied/created.
    let dkimMissing = false;
    {
      const dpQ = await svc(`presence_infra_plans?site_id=eq.${encodeURIComponent(siteId)}&kind=eq.email_setup&status=in.(approved,applied)&select=steps,applied_at,created_at&order=created_at.desc&limit=1`);
      const plan = dpQ.json?.[0];
      if (plan) {
        const host = (JSON.stringify(plan.steps || '').match(/([a-z0-9_]+\._domainkey\.[a-z0-9.-]+?)(?=[)"'\s\\])/i) || [])[1];
        if (host && (await dkimPresent(host)) === false) {
          dkimMissing = true;
          const planSince = plan.applied_at || plan.created_at;
          if (planSince && Number.isFinite(Date.parse(planSince))) sinceMs = Math.min(sinceMs, Date.parse(planSince));
        }
      }
    }

    const decision = emailAuthNudgeDue({
      spfMissing: cur.spf, dmarcMissing: cur.dmarc, dkimMissing,
      sinceIso: Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString() : null,
      nowIso,
    });
    if (!decision.due) continue;

    const clientQ = await svc(`clients?id=eq.${encodeURIComponent(clientId)}&select=name,email&limit=1`);
    const bizName = clientQ.json?.[0]?.name || '';
    const email = clientQ.json?.[0]?.email || '';
    const copy = emailAuthNudgeCopy(decision.gaps, bizName);
    // send-once per site (period = the site) — one calm nudge for a persistent gap.
    const fresh = await raiseNotice({ siteId, clientId, kind: 'email_auth', period: `emailauth:${siteId}`, headline: copy.headline, body: copy.body });
    if (fresh) {
      nudged++;
      if (email) { const brand = await loadEmailBrand(siteId); sendEmail(email, copy.subject, copy.html, brand).catch(() => {}); }
    }
  }
  return { nudged };
}

// ── APEX-DRIFT WATCH: de-risk the hard-coded apex IP (DNS business-continuity) ──
// A guided-connected customer's bare domain points home via an apex A record (the
// ONE constant NETLIFY_APEX_IP) OR a self-updating ALIAS/CNAME-flatten to the site's
// netlify target. If that apex ever drifts to a WRONG value (a typo, an old host, a
// stale record), the site is unreachable at the bare domain and nobody is told. This
// sweep VERIFIES the live apex against what it should be (readZone), and surfaces a
// resolving-but-wrong apex as ONE calm owner finding on the ONE notice model
// (monthly period → a persistent break re-alerts monthly, and clears on recovery).
// A NON-resolving apex is left alone — that's the separate dns_apex_unresolved
// observation the engine already emits. Rotation rides the domain_checked_at cursor
// that runDomainWatch advances (no second cursor, no interference: apex watch never
// stamps it). Best-effort + graceful: pre-0102 the 'apex_drift' kind fails the CHECK
// and raiseNotice returns false (no throw).
export async function runApexDriftWatch(limit = 10): Promise<{ checked: number; drifted: number; recovered: number }> {
  const nowIso = new Date().toISOString();
  const q = await svc(`presence_sites?custom_domain=not.is.null&netlify_site_id=not.is.null&status=in.(live,ready,paused)&select=id,client_id,custom_domain,netlify_site_id&order=domain_checked_at.asc.nullsfirst&limit=${limit}`);
  let checked = 0, drifted = 0, recovered = 0;
  for (const site of (Array.isArray(q.json) ? q.json : []) as Array<{ id: string; client_id: string; custom_domain: string; netlify_site_id: string }>) {
    const nf = await getSite(site.netlify_site_id).catch(() => ({ ok: false as const, site: undefined }));
    const target = nf.ok && nf.site ? nf.site.default_domain : null;
    const res = await verifyApex(site.custom_domain, { target, ip: NETLIFY_APEX_IP }, nowIso).catch(() => null);
    if (!res) continue;
    checked++;
    if (res.resolved && !res.ok) {
      const fresh = await raiseNotice({
        siteId: site.id, clientId: site.client_id, kind: 'apex_drift', period: `apex:${periodOf(nowIso)}`,
        headline: 'Your domain isn’t pointing at your site',
        body: `${res.reason} Visitors typing ${site.custom_domain} may reach the wrong place. The platform can prepare the exact record to fix it — the preferred setup follows your site automatically.`,
      });
      if (fresh) {
        drifted++;
        const cl = await svc(`clients?id=eq.${encodeURIComponent(site.client_id)}&select=email,name&limit=1`);
        if (cl.json?.[0]?.email) {
          const brand = await loadEmailBrand(site.id);   // BR-1: on the customer's brand
          // Transactional (the domain is actively broken) → critical, survives an opt-out.
          sendEmail(cl.json[0].email, `Action needed: ${site.custom_domain} isn’t pointing at your site`,
            `<p><strong>${site.custom_domain}</strong> isn’t pointing at your website right now.</p><p>${res.reason}</p><p>The platform can prepare the exact DNS record to fix it — the preferred setup (an ALIAS/CNAME-flattening record where your host supports it) follows your site automatically and never needs updating.</p>`, brand, { critical: true }).catch(() => {});
        }
        // OPERATIONAL, to the platform operator (critical:true — same reason the
        // customer's copy above carries it: the domain is actively broken).
        const ops = Deno.env.get('OPS_ALERT_EMAIL') || '';
        if (ops) sendEmail(ops, `[Studio OS ops] Apex drift: ${site.custom_domain}`, `<p>${site.custom_domain}: ${res.reason} (expected ${target || NETLIFY_APEX_IP}; observed A=[${res.aRecords.join(', ')}] CNAME=[${res.cnames.join(', ')}]). Customer notified.</p>`, undefined, { critical: true }).catch(() => {});
      }
    } else if (res.ok) {
      await clearNotice(site.client_id, 'apex_drift');   // recovered — the bell tells the truth
      recovered++;
    }
  }
  return { checked, drifted, recovered };
}
