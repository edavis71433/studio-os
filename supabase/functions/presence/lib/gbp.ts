// ── Google Business Profile — pure helpers (read-only) ───────────────────────
// The GSC/GA4 treatment for "your Google listing". Everything here is pure and
// unit-tested; the calls live in connected/adapters.ts. The request/response
// shapes are transcribed from Google's published API definitions, read Nov 2026:
//
//   accounts   GET mybusinessaccountmanagement.googleapis.com/v1/accounts
//              https://mybusinessaccountmanagement.googleapis.com/$discovery/rest?version=v1
//   locations  GET mybusinessbusinessinformation.googleapis.com/v1/{accounts/*}/locations?readMask=…
//              GET mybusinessbusinessinformation.googleapis.com/v1/{locations/*}?readMask=…
//              https://mybusinessbusinessinformation.googleapis.com/$discovery/rest?version=v1
//   reviews    GET mybusiness.googleapis.com/v4/{accounts/*/locations/*}/reviews
//              https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list
//   actions    GET businessprofileperformance.googleapis.com/v1/{locations/*}:fetchMultiDailyMetricsTimeSeries
//              https://businessprofileperformance.googleapis.com/$discovery/rest?version=v1
//
// A location's resource name carries no account (`locations/123`) but the v4
// reviews API needs one (`accounts/456/locations/123`), which is why a choice
// records both.

export const GBP_READ_MASK = 'name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours,metadata';
export const GBP_METRICS = ['CALL_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'WEBSITE_CLICKS'] as const;

export interface GbpLocation {
  id: string;           // locations/123
  account: string;      // accounts/456
  name: string;
  address: string;
  website: string;
  phone: string;
  maps_uri: string;
  review_uri: string;   // the "leave a review" link Google gives for this listing
  hours_set: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The two id shapes we ever send back to Google. Everything else is refused, so
 *  a tampered pick can't turn into a request for some other path. */
export function gbpLocationPath(raw: unknown): string | null {
  const m = /^(?:locations\/)?(\d{1,32})$/.exec(String(raw ?? '').trim());
  return m ? `locations/${m[1]}` : null;
}
export function gbpAccountPath(raw: unknown): string | null {
  const m = /^(?:accounts\/)?(\d{1,32})$/.exec(String(raw ?? '').trim());
  return m ? `accounts/${m[1]}` : null;
}

export function parseGbpAccounts(resp: any): string[] {
  const rows = (resp && Array.isArray(resp.accounts) && resp.accounts) || [];
  return rows.map((a: any) => gbpAccountPath(a?.name)).filter(Boolean) as string[];
}

/** One line a person recognises their listing by: "12 Main St, Pasadena, CA". */
function addressLine(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const lines = Array.isArray(a.addressLines) ? a.addressLines.filter((x: unknown) => typeof x === 'string' && x) : [];
  return [...lines, str(a.locality), str(a.administrativeArea)].filter(Boolean).join(', ');
}

export function parseGbpLocation(l: any, account: string): GbpLocation | null {
  const id = gbpLocationPath(l?.name);
  if (!id) return null;
  return {
    id, account,
    name: str(l?.title).slice(0, 200) || 'Unnamed listing',
    address: addressLine(l?.storefrontAddress).slice(0, 240),
    website: str(l?.websiteUri).slice(0, 400),
    phone: str(l?.phoneNumbers?.primaryPhone).slice(0, 40),
    maps_uri: str(l?.metadata?.mapsUri).slice(0, 500),
    review_uri: str(l?.metadata?.newReviewUri).slice(0, 500),
    hours_set: Array.isArray(l?.regularHours?.periods) && l.regularHours.periods.length > 0,
  };
}

export function parseGbpLocations(resp: any, account: string): GbpLocation[] {
  const rows = (resp && Array.isArray(resp.locations) && resp.locations) || [];
  return rows.map((l: any) => parseGbpLocation(l, account)).filter(Boolean) as GbpLocation[];
}

const hostOf = (v: unknown) => {
  try { return new URL(String(v)).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; }
};

/** Which listing is this website, without asking? Exactly one listing, or exactly
 *  one whose own website field names this site's domain. Anything else is a
 *  person's choice: a guess here reads some other business's reviews. */
export function autoPickGbp(locations: GbpLocation[], domain: string | null | undefined): GbpLocation | null {
  if (locations.length === 1) return locations[0];
  const d = String(domain || '').replace(/^www\./i, '').toLowerCase();
  if (!d) return null;
  const same = locations.filter((l) => hostOf(l.website) === d);
  return same.length === 1 ? same[0] : null;
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** The reviews.list response → plain quantities. `newReviews` and `unreplied` are
 *  counted over the newest page (the API's maximum is 50), so they are "of your
 *  latest", never a claim about the whole history. Absent totals stay undefined:
 *  a listing Google has told us nothing about is not a listing with no reviews. */
export function parseGbpReviews(resp: any, nowMs: number): { rating?: number; reviewCount?: number; newReviews?: number; unreplied?: number } {
  const rows: any[] = (resp && Array.isArray(resp.reviews) && resp.reviews) || [];
  const since = nowMs - 30 * 86_400_000;
  const rating = typeof resp?.averageRating === 'number' ? Math.round(resp.averageRating * 10) / 10 : undefined;
  const reviewCount = typeof resp?.totalReviewCount === 'number' ? resp.totalReviewCount : undefined;
  // Google omits averageRating on a listing with no reviews at all; a count of
  // zero is then a real answer rather than a missing one.
  const empty = resp && typeof resp === 'object' && !rows.length && reviewCount === undefined;
  return {
    rating,
    reviewCount: empty ? 0 : reviewCount,
    newReviews: rows.filter((r) => { const t = Date.parse(str(r?.createTime)); return Number.isFinite(t) && t >= since; }).length,
    unreplied: rows.filter((r) => !r?.reviewReply && (STARS[str(r?.starRating)] || 0) > 0).length,
  };
}

/** The 30 days the performance read covers, ending three days back: Google's
 *  newest few days are still filling in, and a partial day reads as a dip. */
export function gbpPerformanceWindow(now: Date): { start: { year: number; month: number; day: number }; end: { year: number; month: number; day: number } } {
  const parts = (ms: number) => { const d = new Date(ms); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };
  const endMs = now.getTime() - 3 * 86_400_000;
  return { start: parts(endMs - 29 * 86_400_000), end: parts(endMs) };
}

export function gbpPerformanceQuery(now: Date): string {
  const { start, end } = gbpPerformanceWindow(now);
  const q = new URLSearchParams();
  for (const m of GBP_METRICS) q.append('dailyMetrics', m);
  q.set('dailyRange.startDate.year', String(start.year));
  q.set('dailyRange.startDate.month', String(start.month));
  q.set('dailyRange.startDate.day', String(start.day));
  q.set('dailyRange.endDate.year', String(end.year));
  q.set('dailyRange.endDate.month', String(end.month));
  q.set('dailyRange.endDate.day', String(end.day));
  return q.toString();
}

/** fetchMultiDailyMetricsTimeSeries → totals. DatedValue.value is a STRING and is
 *  omitted on a day with nothing to report, so a missing value counts as zero; a
 *  metric missing from the response altogether stays undefined. */
export function parseGbpPerformance(resp: any): { calls?: number; directions?: number; websiteClicks?: number } {
  const totals: Record<string, number> = {};
  for (const group of (resp?.multiDailyMetricTimeSeries || [])) {
    for (const series of (group?.dailyMetricTimeSeries || [])) {
      const metric = str(series?.dailyMetric);
      if (!metric) continue;
      let sum = totals[metric] || 0;
      for (const dv of (series?.timeSeries?.datedValues || [])) {
        const n = Number(dv?.value);
        if (Number.isFinite(n)) sum += n;
      }
      totals[metric] = sum;
    }
  }
  return { calls: totals.CALL_CLICKS, directions: totals.BUSINESS_DIRECTION_REQUESTS, websiteClicks: totals.WEBSITE_CLICKS };
}

/** Why a listing read failed, as a sentence connected/contract.ts passes straight
 *  through. A new Google Cloud project has a quota of ZERO on these APIs until
 *  Google approves an access request, which answers 429 forever: to a customer
 *  that must not read as "try again shortly". Null = no special wording; the
 *  plain `read NNN` reason covers it. */
export function gbpProblem(status: number, body: any): string | null {
  const reasons: string[] = (body?.error?.details || []).map((d: any) => str(d?.reason));
  if (reasons.includes('SERVICE_DISABLED')) return 'Google’s listing service isn’t switched on for the studio’s Google project yet. Nothing is wrong with your account; the studio needs to finish a one-time setup.';
  if (status === 429) return 'Google hasn’t approved the studio’s access to listings yet. It’s a one-time request to Google, and nothing is wrong with your account.';
  if (status === 403) return 'The sign-in worked, but that Google account doesn’t manage a business listing. Connect the account that manages this one.';
  return null;
}

/** The two problems only the studio can end (Google's approval, the APIs left off).
 *  They show on the card, but a client gets no notice about something they can't do
 *  anything about. */
export function gbpWaitingOnStudio(status: number, body: any): boolean {
  const reasons: string[] = (body?.error?.details || []).map((d: any) => str(d?.reason));
  return status === 429 || reasons.includes('SERVICE_DISABLED');
}
