// ── Phase AN-1: Analytics — plain-English composition (PURE, no AI, no new store) ──
// Analytics is NOT a dashboard and NOT a new engine. It composes signals the
// platform ALREADY stores (inquiries, publishing, journey, health, moments) into
// calm sentences — number in service of the sentence. Everything here is a pure
// function over already-loaded rows, so reading it costs ZERO AI tokens (AN-9).
// What the platform cannot yet measure (website visitors, search performance) is
// stated honestly and never fabricated (AN-4 rule: never fake data).

export type Period = 'week' | 'month';
export const periodWord = (p: Period) => (p === 'week' ? 'week' : 'month');
export const periodDays = (p: Period) => (p === 'week' ? 7 : 30);

/** Count timestamps in the current window vs the immediately prior window. Pure. */
export function windowCounts(isoTimes: Array<string | null | undefined>, nowMs: number, windowDays: number): { current: number; prior: number } {
  const w = windowDays * 86_400_000;
  const curStart = nowMs - w, priorStart = nowMs - 2 * w;
  let current = 0, prior = 0;
  for (const t of isoTimes) {
    if (!t) continue;
    const ms = Date.parse(t);
    if (Number.isNaN(ms)) continue;
    if (ms > curStart && ms <= nowMs) current++;
    else if (ms > priorStart && ms <= curStart) prior++;
  }
  return { current, prior };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A calm trend clause comparing this period to the prior one. Never invents. */
export function trendPhrase(current: number, prior: number, word: string): string {
  if (prior === 0) return current > 0 ? '' : '';
  if (current > prior) return ` — up from ${prior} the ${word} before`;
  if (current < prior) return ` — down from ${prior} the ${word} before`;
  return ` — steady with the ${word} before`;
}

export interface Insight {
  key: string;
  title: string;
  sentence: string;           // the plain-English lead (always present)
  number?: number | null;     // a single supporting figure, or null
  detail?: string;            // one short supporting clause
  href?: string;              // where to act on it
  tone?: 'good' | 'neutral' | 'attention';
}

/** Inquiries — the realest customer metric (presence_form_submissions). AN-1/AN-3. */
export function inquiriesInsight(createdAts: string[], byKind: { contact: number; quote: number; booking: number }, unread: number, nowMs: number, period: Period): Insight {
  const w = periodWord(period);
  const { current, prior } = windowCounts(createdAts, nowMs, periodDays(period));
  let sentence: string, tone: Insight['tone'] = 'neutral';
  if (current === 0 && prior === 0) {
    sentence = `No inquiries yet this ${w} — when someone reaches out through your website, it lands here first.`;
  } else {
    sentence = `You received ${plural(current, 'inquiry', 'inquiries')} this ${w}${trendPhrase(current, prior, w)}.`;
    tone = current > 0 ? 'good' : 'neutral';
  }
  const parts: string[] = [];
  if (byKind.quote) parts.push(plural(byKind.quote, 'quote request', 'quote requests'));
  if (byKind.booking) parts.push(plural(byKind.booking, 'booking', 'bookings'));
  if (byKind.contact) parts.push(plural(byKind.contact, 'message', 'messages'));
  const detail = unread > 0
    ? `${plural(unread, 'inquiry is', 'inquiries are')} still waiting for a reply.`
    : (parts.length ? `This ${w}: ${parts.join(', ')}.` : '');
  return { key: 'inquiries', title: 'Inquiries', sentence, number: current, detail, href: '/leads.html', tone };
}

/** Publishing activity — from presence_publishes. AN-1/AN-2 (the real "website" signal). */
export function publishingInsight(livePublishIsoTimes: string[], lastPublishedAt: string | null, nowMs: number, period: Period): Insight {
  const w = periodWord(period);
  if (!lastPublishedAt) {
    return { key: 'publishing', title: 'Your website', sentence: 'Your website hasn’t been published yet — publishing puts it in front of customers.', number: 0, href: '/presence.html#publish', tone: 'attention' };
  }
  const days = Math.floor((nowMs - Date.parse(lastPublishedAt)) / 86_400_000);
  const { current } = windowCounts(livePublishIsoTimes, nowMs, periodDays(period));
  const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  const updates = current > 0 ? ` You published ${plural(current, 'update', 'updates')} this ${w}.` : '';
  const tone: Insight['tone'] = days > 60 ? 'attention' : 'neutral';
  return { key: 'publishing', title: 'Your website', sentence: `Your website was last updated ${when}.${updates}`, number: current, detail: days > 60 ? 'A fresh update keeps customers (and search engines) confident you’re active.' : '', href: '/presence.html', tone };
}

/** Honest "not measured yet" cards — never a fabricated number. AN-2/AN-4. */
export function notMeasured(gaConnected: boolean, gscConnected: boolean): Insight[] {
  const out: Insight[] = [];
  if (!gaConnected) out.push({ key: 'traffic', title: 'Website visitors', sentence: 'Visitor numbers aren’t turned on yet — connect Google Analytics and Studio OS will tell you how many people visit and where they come from.', number: null, href: '/connections.html', tone: 'neutral' });
  if (!gscConnected) out.push({ key: 'search', title: 'Search performance', sentence: 'Search clicks and impressions aren’t connected yet — connect Google Search Console to see how you show up when people search.', number: null, href: '/connections.html', tone: 'neutral' });
  return out;
}

/** SEO readiness — REAL booleans from search-health (no fake impressions). AN-4. */
export function searchReadinessInsight(x: { verified: boolean; titleSet: boolean; descriptionSet: boolean; sitemap: boolean; brokenLinks: number }): Insight {
  const gaps: string[] = [];
  if (!x.titleSet) gaps.push('a search title');
  if (!x.descriptionSet) gaps.push('a search description');
  if (!x.verified) gaps.push('Google verification');
  let sentence: string, tone: Insight['tone'];
  if (!gaps.length && x.brokenLinks === 0) { sentence = 'Your site is set up to be found: titles, descriptions, and sitemap are all in place.'; tone = 'good'; }
  else if (gaps.length) { sentence = `A few things would help search find you — you’re missing ${gaps.join(', ')}.`; tone = 'attention'; }
  else { sentence = `${plural(x.brokenLinks, 'link', 'links')} on your site point somewhere broken — worth a quick fix.`; tone = 'attention'; }
  return { key: 'search_readiness', title: 'Getting found', sentence, detail: x.sitemap ? 'Your sitemap is published for search engines.' : '', href: '/presence.html#business', tone };
}

/** Agency portfolio, in plain English — composes buildPortfolio rows (AN-7). Pure. */
export interface PortfolioClientLite { name?: string; leads_waiting?: number; unpublished_changes?: boolean; last_published_at?: string | null; attention?: number; }
export function portfolioInsights(clients: PortfolioClientLite[], nowMs: number): { headline: string; insights: Insight[] } {
  const total = clients.length;
  const withLeads = clients.filter((c) => (c.leads_waiting || 0) > 0);
  const needAttention = clients.filter((c) => (c.attention || 0) > 0);
  const stale = clients.filter((c) => c.last_published_at && (nowMs - Date.parse(c.last_published_at)) > 30 * 86_400_000);
  const insights: Insight[] = [];
  if (withLeads.length) insights.push({ key: 'growing', title: 'New inquiries', sentence: `${withLeads.length} of your ${total} clients ${withLeads.length === 1 ? 'has' : 'have'} new inquiries waiting.`, number: withLeads.length, detail: withLeads.slice(0, 4).map((c) => c.name || 'a client').join(', '), tone: 'good' });
  if (needAttention.length) insights.push({ key: 'attention', title: 'Needs attention', sentence: `${needAttention.length} ${needAttention.length === 1 ? 'client needs' : 'clients need'} a look.`, number: needAttention.length, detail: needAttention.slice(0, 4).map((c) => c.name || 'a client').join(', '), tone: 'attention' });
  if (stale.length) insights.push({ key: 'quiet', title: 'Gone quiet', sentence: `${stale.length} ${stale.length === 1 ? 'client hasn’t' : 'clients haven’t'} published in over a month.`, number: stale.length, detail: stale.slice(0, 4).map((c) => c.name || 'a client').join(', '), tone: 'attention' });
  const headline = total === 0 ? 'No clients yet.' : insights.length ? `Across ${total} ${total === 1 ? 'client' : 'clients'}, here’s what stands out.` : `All ${total} clients are quiet and current — nothing needs you.`;
  return { headline, insights };
}
