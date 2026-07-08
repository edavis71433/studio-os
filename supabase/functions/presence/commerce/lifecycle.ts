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
import { svc } from '../lib/db.ts';
import { sendEmail } from './account.ts';

export type LifecycleKind = 'trial_ending' | 'trial_ended' | 'payment_trouble' | 'account_lapsed' | 'search_setup';

export interface EntitlementView {
  client_id: string;
  status: string;                       // active | paused | lapsed | none
  trial_ends_at?: string | null;
  stripe_subscription_id?: string | null;
  updated_at?: string | null;
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
  if (e.status === 'lapsed') out.push('account_lapsed');
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
      html: `<p>Your website for <strong>${name}</strong> is live and search engines can find it.</p><p>One optional step unlocks Google’s own reports about how people find you: add your free Search Console code in your workspace (Business → Search &amp; discovery). Two minutes, once — we handle everything else automatically.</p>`,
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
export async function runLifecycleSweep(limit = 50): Promise<{ expired_trials: number; notices: number; emails: number }> {
  const nowIso = new Date().toISOString();
  let expired = 0, notices = 0, emails = 0;

  const ents = await svc(`presence_entitlements?product=eq.presence&status=in.(active,paused,lapsed)&select=client_id,status,trial_ends_at,stripe_subscription_id&limit=${limit * 4}`);
  const rows: EntitlementView[] = Array.isArray(ents.json) ? ents.json : [];

  for (const e of rows.slice(0, limit * 4)) {
    // enforce trial expiry first (the revenue bug: nothing else ever flips it)
    if (shouldExpireTrial(e, nowIso)) {
      const up = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(e.client_id)}&product=eq.presence&status=eq.active`, {
        method: 'PATCH', body: JSON.stringify({ status: 'lapsed' }),
      });
      if (up.ok) { expired++; e.status = 'lapsed'; }
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

    // Phase SD: the search-setup nudge — published site, no verification code, once ever
    if (e.status === 'active') {
      const sQ = await svc(`presence_sites?client_id=eq.${encodeURIComponent(e.client_id)}&select=id,last_published_at&limit=1`);
      const vQ = sQ.json?.[0]?.id ? await svc(`presence_settings?site_id=eq.${sQ.json[0].id}&select=google_site_verification&limit=1`) : { json: [] as any[] };
      if (sQ.json?.[0]?.last_published_at && !String(vQ.json?.[0]?.google_site_verification || '').trim()) {
        const copy = lifecycleCopy('search_setup', bizName);
        const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
          method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: JSON.stringify({ site_id: sQ.json[0].id, client_id: e.client_id, kind: 'search_setup', period: 'once', headline: copy.headline, body: copy.body, status: 'active' }),
        });
        if (ins.ok && Array.isArray(ins.json) && ins.json.length > 0) { notices++; if (email && (await sendEmail(email, copy.subject, copy.html))) emails++; }
      }
    }
    for (const kind of events) {
      const copy = lifecycleCopy(kind, bizName);
      // send-once: the unique(client,kind,period) key decides — a returned row = newly inserted
      const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ site_id: siteId, client_id: e.client_id, kind, period: periodOf(nowIso), headline: copy.headline, body: copy.body, status: 'active' }),
      });
      const fresh = ins.ok && Array.isArray(ins.json) && ins.json.length > 0;
      if (fresh) {
        notices++;
        if (email && (await sendEmail(email, copy.subject, copy.html))) emails++;
      }
    }
  }
  return { expired_trials: expired, notices, emails };
}
