// ── CMS-UX-4 — Website Health: pure adapter ──────────────────────────────────
// "Is my website healthy?" — a calm, plain-English health check a business owner
// with no technical knowledge can read. NOT Lighthouse, NOT a monitoring
// dashboard. It PROJECTS truth the platform already knows into reassuring cards.
//
// Reuse-first: this adapter takes signals that already exist —
//   • the CMS-UX-1 Content Tree (validation → customer-safe content/publish state)
//   • the Launch Assistant checklist (buildLaunchChecklist — honest done/todo/n-a
//     probes for domain, secure connection, search, analytics, email)
//   • presence_connections (connected services + health)
//   • real evidence for the contact form (a received message) and saved versions
// — and re-groups them. It writes no validator and invents no data.
//
// Honesty Rule: a check appears ONLY when the platform can actually verify it.
// Anything n/a or unverifiable is omitted (same standard as SSL / reviews /
// milestones). Categories with no evidence are not shown.
//
// Colour is never the only signal: every check carries a word (`status_label`)
// and the frontend adds an icon — screen-reader and colour-blind complete.

export interface LaunchItem { step: string; state: 'done' | 'todo' | 'n/a'; how?: string }

export interface WebsiteHealthInput {
  now: string;
  // from the Content Tree
  site_status: 'never_published' | 'live' | 'draft_changes' | 'scheduled' | 'publish_failed';
  has_unpublished_changes: boolean;
  publish_failed: boolean;
  last_published_at: string | null;
  missing_count: number;
  missing_href: string | null;
  scheduled: boolean;
  // from the Launch Assistant checklist (reused verbatim)
  launch: LaunchItem[];
  // from presence_connections
  connections: Array<{ label: string; state: 'ok' | 'attention' }>;
  // real evidence
  contact_form_working: boolean;   // a non-spam submission has been received
  versions_saved: boolean;         // at least one saved version exists
  domain: string | null;
  // Uptime heartbeat (real, not inferred): the latest live-URL probe. Optional —
  // when absent (never probed / pre-migration) we fall back to the publish-state
  // inference below. `true`=answered, `false`=didn't answer just now.
  online_now?: boolean | null;
  uptime_checked_at?: string | null;
}

export type CheckState = 'ok' | 'attention' | 'coming' | 'off';
export interface HealthCheck {
  title: string;              // what this is, as a statement
  why: string;                // why it matters
  state: CheckState;
  status_label: string;       // a word, so colour is never the only signal
  action_label?: string;      // what to do (one clear action)
  action_href?: string;
}
export interface HealthCategory { key: string; label: string; checks: HealthCheck[] }
export interface WebsiteHealth {
  overall: 'healthy' | 'attention' | 'new';
  headline: string;
  summary: string;
  ok_count: number;
  attention_count: number;
  categories: HealthCategory[];
}

const STATUS_WORD: Record<CheckState, string> = { ok: 'Working', attention: 'Needs a look', coming: 'Scheduled', off: 'Not set up' };

/** Calm "how long ago" for the last uptime check. PURE. */
function checkedAgo(now: string, checkedAt: string | null | undefined): string {
  if (!checkedAt) return 'just now';
  const mins = Math.max(0, Math.round((Date.parse(now) - Date.parse(checkedAt)) / 60000));
  if (!Number.isFinite(mins) || mins <= 1) return 'less than a minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? 'about an hour ago' : `${hrs} hours ago`;
}
const check = (title: string, why: string, state: CheckState, action?: { label: string; href: string }): HealthCheck =>
  ({ title, why, state, status_label: STATUS_WORD[state], ...(action ? { action_label: action.label, action_href: action.href } : {}) });

/** Build the calm Website Health projection from existing signals. Pure. */
export function buildWebsiteHealth(i: WebsiteHealthInput): WebsiteHealth {
  const cats: HealthCategory[] = [];
  const push = (key: string, label: string, checks: HealthCheck[]) => { if (checks.length) cats.push({ key, label, checks }); };
  const step = (...names: string[]) => i.launch.find((x) => names.includes(x.step));

  // ── Website Status ─────────────────────────────────────────────────────────
  {
    const c: HealthCheck[] = [];
    const online = step('Website published', 'Website connected & verified');
    if (typeof i.online_now === 'boolean') {
      // The REAL signal: a live-URL probe (uptime heartbeat), not an inference.
      // When we've actually fetched the site, that truth replaces the publish-state
      // guess — "is it up right now?" is what an owner actually wants to know.
      c.push(i.online_now
        ? check('Your website is online right now', `We check it around the clock — last checked ${checkedAgo(i.now, i.uptime_checked_at)}. Visitors can reach it.`, 'ok')
        : check('Your website isn’t responding right now', 'We just checked and it didn’t answer. We’re watching closely and will tell you the moment it’s back — often this clears within minutes.', 'attention', { label: 'See what’s happening', href: '/presence.html#foundations' }));
    } else if (online) {
      c.push(online.state === 'done'
        ? check('Your website is online', 'Visitors can reach your site right now.', 'ok')
        : check('Your website isn’t published yet', 'It won’t be visible to visitors until you publish it.', 'attention', { label: 'Review & publish', href: '/presence.html#history' }));
    }
    if (i.domain) c.push(check('Your domain is connected', `Your site answers at ${i.domain}.`, 'ok'));
    else c.push(check('No custom domain yet', 'Your site is live on its Studio address — you can connect your own domain whenever you’re ready.', 'off', { label: 'Connect a domain', href: '/presence.html#foundations' }));
    if (i.contact_form_working) c.push(check('Your contact form is working', 'You’ve received messages through it, so visitors can reach you.', 'ok'));
    push('website_status', 'Website status', c);
  }

  // ── Content ────────────────────────────────────────────────────────────────
  {
    const c: HealthCheck[] = [];
    if (i.missing_count > 0) {
      c.push(check('Some content still needs completing',
        'A few required details are needed before your next update can go live.',
        'attention', { label: 'Finish these items', href: i.missing_href || '/content-tree.html' }));
    } else if (i.site_status !== 'never_published') {
      c.push(check('Your content is complete', 'Every required part of your site is filled in.', 'ok'));
    }
    push('content', 'Content', c);
  }

  // ── Visibility ─────────────────────────────────────────────────────────────
  {
    const c: HealthCheck[] = [];
    const search = step('Search indexing requested');
    if (search && search.state !== 'n/a') {
      c.push(search.state === 'done'
        ? check('Search engines can find you', 'Your site tells search engines about its pages, so people can discover you.', 'ok')
        : check('Not listed on search yet', 'Asking search engines to list you helps new customers find you.', 'attention', { label: 'See how', href: '/presence.html#foundations' }));
    }
    const analytics = step('Analytics connected');
    if (analytics) {
      c.push(analytics.state === 'done'
        ? check('Visitor insights are on', 'You can see how many people visit and what they look at.', 'ok')
        : check('Visitor insights aren’t set up', 'Without them, visitor trends stay invisible — optional, and easy to add when you’re ready.', 'off', { label: 'Connect', href: '/connections.html' }));
    }
    push('visibility', 'Visibility', c);
  }

  // ── Security ───────────────────────────────────────────────────────────────
  {
    const c: HealthCheck[] = [];
    // only claim a secure connection when we can actually verify the customer's
    // own domain — otherwise omit (the Studio address is secure by default).
    if (i.domain) {
      const ssl = step('Security certificate active');
      if (ssl && ssl.state !== 'n/a') {
        c.push(ssl.state === 'done'
          ? check('Your connection is secure', 'Visitors’ information is protected with a secure (https) connection.', 'ok')
          : check('Your secure certificate isn’t active yet', 'A secure connection protects your visitors and is expected by every browser.', 'attention', { label: 'See what’s needed', href: '/presence.html#foundations' }));
      }
    }
    const email = step('Email authenticated');
    if (email && email.state !== 'n/a') {
      c.push(email.state === 'done'
        ? check('Your email is protected', 'Messages from your domain are authenticated, so inboxes trust them.', 'ok')
        : check('Your email isn’t fully protected', 'Without protection, messages from your domain can be marked as spam.', 'attention', { label: 'See what’s needed', href: '/presence.html#foundations' }));
    }
    push('security', 'Security', c);
  }

  // ── Connections ────────────────────────────────────────────────────────────
  {
    const c: HealthCheck[] = i.connections.map((x) => x.state === 'ok'
      ? check(`${x.label} is connected`, 'It’s linked and keeping your information current.', 'ok')
      : check(`${x.label} needs a quick reconnect`, 'It stopped updating — reconnecting keeps your numbers current.', 'attention', { label: 'Reconnect', href: '/connections.html' }));
    push('connections', 'Connections', c);
  }

  // ── Publishing ─────────────────────────────────────────────────────────────
  {
    const c: HealthCheck[] = [];
    if (i.publish_failed) {
      c.push(check('A recent publish didn’t finish', 'Your latest changes may not be visible to visitors yet.', 'attention', { label: 'Try publishing again', href: '/presence.html#history' }));
    } else if (i.has_unpublished_changes) {
      c.push(check('You have unpublished changes', 'You’ve made edits that aren’t live yet — publish when you’re happy with them.', 'attention', { label: 'Review & publish', href: '/presence.html#history' }));
    }
    if (i.scheduled) c.push(check('An update is scheduled', 'Your next update will go live automatically — nothing to do.', 'coming', { label: 'View', href: '/presence.html#history' }));
    if (i.last_published_at && !i.publish_failed && !i.has_unpublished_changes) {
      c.push(check('Your website is up to date', 'Everything you’ve approved is live.', 'ok'));
    }
    if (i.versions_saved) c.push(check('Every version of your site is saved', 'You can restore an earlier version anytime — nothing is ever lost.', 'ok'));
    push('publishing', 'Publishing', c);
  }

  // ── overall ────────────────────────────────────────────────────────────────
  const all = cats.flatMap((x) => x.checks);
  const ok_count = all.filter((x) => x.state === 'ok').length;
  const attention_count = all.filter((x) => x.state === 'attention').length;
  const overall: WebsiteHealth['overall'] =
    i.site_status === 'never_published' ? 'new' : (attention_count > 0 ? 'attention' : 'healthy');
  const headline = overall === 'new'
    ? 'Your website is almost ready.'
    : overall === 'healthy'
      ? 'Your website is healthy.'
      : attention_count === 1 ? 'One thing could use a look.' : `${attention_count} things could use a look.`;
  const summary = attention_count > 0
    ? `${ok_count} looking good · ${attention_count} to look at`
    : `${ok_count} check${ok_count === 1 ? '' : 's'} — all looking good`;

  return { overall, headline, summary, ok_count, attention_count, categories: cats };
}
