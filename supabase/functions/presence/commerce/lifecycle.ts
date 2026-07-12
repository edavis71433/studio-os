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
import { rdapLookup, daysUntil } from '../lib/rdap.ts';
import { leadFollowupDue, leadFollowupCopy, renewalReminderWindow, renewalNoticePeriod, renewalReminderCopy } from '../lib/commercial.ts';
import { editionFromPlan, EDITION_DEFS } from './editions.ts';
import { sendEmail } from './account.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';

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
      html: `<p>Your website for <strong>${name}</strong> is live and search engines can find it.</p><p>One optional step unlocks Google’s own reports about how people find you: add your free Search Console code in your workspace (Business → Search &amp; discovery). Two minutes, once — we handle everything else automatically.</p>`,
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
export async function runLifecycleSweep(limit = 50): Promise<{ expired_trials: number; notices: number; emails: number; wound_down: number; grace_lapsed: number }> {
  const nowIso = new Date().toISOString();
  let expired = 0, notices = 0, emails = 0, wound_down = 0, grace_lapsed = 0;

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
          if (site.netlify_site_id) await deleteSite(site.netlify_site_id).catch(() => {});
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
      const dedupe = kind === 'win_back' ? 'once' : periodOf(nowIso);
      const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ site_id: siteId, client_id: e.client_id, kind, period: dedupe, headline: copy.headline, body: copy.body, status: 'active' }),
      });
      const fresh = ins.ok && Array.isArray(ins.json) && ins.json.length > 0;
      if (fresh) {
        notices++;
        if (email && (await sendEmail(email, copy.subject, copy.html))) emails++;
      }
    }
  }
  return { expired_trials: expired, notices, emails, wound_down, grace_lapsed };
}

// ── Phase CP-3 (CP-5): the weekly owner digest — the Monday routine, automated ──
export async function runWeeklyDigest(): Promise<{ sent: boolean }> {
  const to = Deno.env.get('OPS_ALERT_EMAIL') || '';
  if (!to) return { sent: false };
  const st = await svc('presence_ops_state?id=eq.1&select=last_digest_at');
  const last = st.json?.[0]?.last_digest_at ? Date.parse(st.json[0].last_digest_at) : 0;
  if (Date.now() - last < 7 * 86400_000) return { sent: false };
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
  const html = `<p>Your Studio OS week, in one glance:</p><ul>
<li><strong>${n(subs)}</strong> new subscription${n(subs) === 1 ? '' : 's'}</li>
<li><strong>${n(paused)}</strong> with payment trouble${n(paused) ? ' — they were told their site is still up' : ''}</li>
<li><strong>${n(lapsed)}</strong> lapsed (wind-down comms run automatically)</li>
<li><strong>${n(leads)}</strong> lead${n(leads) === 1 ? '' : 's'} waiting more than 2 days for a reply</li>
<li><strong>${n(fails)}</strong> failed publish${n(fails) === 1 ? '' : 'es'} this week</li>
</ul><p>Details live in Stripe, the leads inbox, and /system/health. The watchdog emails you separately if production ever goes dark.</p>`;
  const ok = await sendEmail(to, '[Studio OS] Your week in one glance', html);
  await svc('presence_ops_state?id=eq.1', { method: 'PATCH', body: JSON.stringify({ last_digest_at: new Date().toISOString() }) });
  return { sent: ok };
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
      const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ site_id: site.id, client_id: site.client_id, kind: 'domain_expiry', period: periodOf(nowIso),
          headline: `Your domain ${when}`,
          body: `${site.custom_domain} ${when}${info?.registrar ? ` at ${info.registrar}` : ''}. Renew it at your registrar (auto-renew is the calm option) — if it lapses, your website and email stop answering. Nothing else is needed on our side.`,
          status: 'active' }),
      });
      if (ins.ok && Array.isArray(ins.json) && ins.json.length > 0) {
        warned++;
        const cl = await svc(`clients?id=eq.${encodeURIComponent(site.client_id)}&select=email,name&limit=1`);
        if (cl.json?.[0]?.email) {
          const brand = await loadEmailBrand(site.id);   // BR-1: the customer's domain notice, on their brand
          await sendEmail(cl.json[0].email, `Your domain ${site.custom_domain} ${when}`,
            `<p><strong>${site.custom_domain}</strong> ${when}${info?.registrar ? ` at <strong>${info.registrar}</strong>` : ''}.</p><p>Renewing at your registrar (auto-renew is the calm option) keeps your website and email answering. Nothing is needed on our side — this is just the reminder registrars are quiet about.</p>`, brand);
        }
        if (soon) {
          const ops = Deno.env.get('OPS_ALERT_EMAIL') || '';
          if (ops) sendEmail(ops, `[Studio OS ops] Domain ${when}: ${site.custom_domain}`, `<p>Customer domain ${site.custom_domain} ${when}. They have been notified.</p>`).catch(() => {});
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
    const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ site_id: lead.site_id, client_id: clientId, kind: 'lead_followup', period: `lead:${lead.id}`, headline: copy.headline, body: copy.body, status: 'active' }),
    });
    if (ins.ok && Array.isArray(ins.json) && ins.json.length > 0) {
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
    const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ site_id: deal.site_id, client_id: clientId, kind: 'deal_followup', period: `deal:${deal.id}`, headline: `Follow up on ${title}`, body, status: 'active' }),
    });
    if (ins.ok && Array.isArray(ins.json) && ins.json.length > 0) {
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
    const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ site_id: inv.site_id, client_id: clientId, kind: 'deal_followup', period: `invremind:${inv.id}`, headline: `Still unpaid — ${inv.title || what} (${amount})`, body: noticeBody, status: 'active' }),
    });
    if (!(ins.ok && Array.isArray(ins.json) && ins.json.length > 0)) continue;   // already reminded once — never nag
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
    const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ site_id: siteId, client_id: e.client_id, kind: 'renewal_reminder', period: renewalNoticePeriod(e.current_period_end, win), headline: copy.headline, body: copy.body, status: 'active' }),
    });
    if (ins.ok && Array.isArray(ins.json) && ins.json.length > 0) {
      reminded++;
      const ident = await svc(`presence_identity?site_id=eq.${siteId}&select=email&limit=1`);
      const owner = ident.json?.[0]?.email;
      if (owner) sendEmail(String(owner), copy.subject, `<p>${copy.body}</p><p><a href="${base}/portal.html">Review or manage your plan →</a></p>`).catch(() => {});
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
      const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ site_id: doc.site_id, client_id: clientId, kind: 'deal_followup', period: `remind:${doc.id}`, headline: `${email ? 'Reminder sent' : 'Still waiting'} — ${doc.title || `the ${what}`}`, body: noticeBody, status: 'active' }),
      });
      if (!(ins.ok && Array.isArray(ins.json) && ins.json.length > 0)) continue;
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
