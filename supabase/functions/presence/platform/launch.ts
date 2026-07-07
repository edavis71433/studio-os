// ── The Launch Assistant (M14) — a checklist derived from ACTUAL state, PURE ─
// "I don't have to leave Studio OS to launch my website." Each item is
// derived from observed reality (evidence, zone, probes, content), states
// done / todo / n/a honestly, and says HOW in plain words. It never acts
// alone — every 'how' points at an existing surface (a plan, the room, an
// observation run).

export interface LaunchInput {
  edition: string;
  domain: string | null;
  apex_resolves: boolean | null;        // null = not probed
  https_ok: boolean | null;
  published: boolean;
  monitor_verified: boolean;
  sitemap_present: boolean | null;
  gbp_connected: boolean;               // absence of local_presence.profile_unconnected in latest evidence
  analytics_connected: boolean;         // absence of analytics.not_connected
  email_has_mx: boolean;
  email_authenticated: boolean;         // SPF + DMARC answering
  accessibility_criticals: number;      // from latest evidence
  review_done: boolean;                 // an open/any review report exists
}

export interface LaunchItem { step: string; state: 'done' | 'todo' | 'n/a'; how: string }

export function buildLaunchChecklist(i: LaunchInput): { items: LaunchItem[]; done: number; total: number; launched: boolean; sentence: string } {
  const isMonitor = i.edition === 'monitor';
  const items: LaunchItem[] = [
    { step: 'Domain connected', state: i.domain ? 'done' : 'todo',
      how: i.domain ? `${i.domain} is the address.` : 'Prepare the connect-domain plan in the technical-side sheet — two records, everything explained.' },
    { step: 'DNS answering', state: i.domain ? (i.apex_resolves === null ? 'todo' : i.apex_resolves ? 'done' : 'todo') : 'n/a',
      how: i.apex_resolves ? 'The domain resolves.' : 'The connect-domain plan carries the exact records; drift repair is one click after that.' },
    { step: 'Security certificate active', state: i.https_ok === null ? (isMonitor ? 'n/a' : 'todo') : i.https_ok ? 'done' : 'todo',
      how: i.https_ok ? 'HTTPS answers; renewal is automatic.' : 'Certificates provision themselves once DNS answers — nothing to buy, nothing to renew by hand.' },
    { step: isMonitor ? 'Website connected & verified' : 'Website published',
      state: isMonitor ? (i.monitor_verified ? 'done' : 'todo') : (i.published ? 'done' : 'todo'),
      how: isMonitor ? (i.monitor_verified ? 'Observation is running.' : 'Connect your site in the room — one read-only proof, nothing changes on it.')
        : (i.published ? 'Live.' : 'Preview, then publish from the room whenever the draft feels right.') },
    { step: 'Search indexing requested', state: i.sitemap_present === true ? 'done' : i.published || i.monitor_verified ? 'todo' : 'n/a',
      how: i.sitemap_present ? 'The sitemap answers; search engines can find everything.' : 'A sitemap ships with publishing; submitting it to Search Console is one guided step.' },
    { step: 'Business profile connected', state: i.gbp_connected ? 'done' : 'todo',
      how: i.gbp_connected ? 'Connected.' : 'Google Business Profile is where nearby customers actually find you — the observer will confirm once it’s linked.' },
    { step: 'Analytics connected', state: i.analytics_connected ? 'done' : 'todo',
      how: i.analytics_connected ? 'Measured.' : 'Optional but honest: without it, traffic trends stay invisible. Connect when ready.' },
    { step: 'Email authenticated', state: !i.email_has_mx ? 'n/a' : i.email_authenticated ? 'done' : 'todo',
      how: !i.email_has_mx ? 'No email runs on this domain.' : i.email_authenticated ? 'SPF and DMARC answer — inboxes can trust you.' : 'The email-protection plan prepares the records; approve it and place them.' },
    { step: 'Accessibility reviewed', state: i.accessibility_criticals === 0 && i.review_done ? 'done' : 'todo',
      how: i.accessibility_criticals > 0 ? `${i.accessibility_criticals} critical item${i.accessibility_criticals > 1 ? 's' : ''} to fix — the review desk lists them in plain words.` : i.review_done ? 'Reviewed.' : 'Run “Look things over → Review” once — findings arrive as sentences.' },
  ];
  const counted = items.filter((x) => x.state !== 'n/a');
  const done = counted.filter((x) => x.state === 'done').length;
  const launched = done === counted.length;
  return {
    items, done, total: counted.length, launched,
    sentence: launched ? 'Everything on the launch list is standing. The website is fully launched and watched.'
      : `${done} of ${counted.length} launch steps are standing — the rest are listed with exactly how, nothing requires leaving here.`,
  };
}
