// ── Where an enquiry's visitor came from (sales item 89, Nov 2026) ───────────
// The site's own visit counter (routes/collect.ts) keeps, for each page view, the
// host that sent the visitor and any campaign tags, under a hash of the visitor
// that changes every day: never a cookie, never the full address they came from.
// When the same visitor sends a form, the enquiry notes where their visit began
// (fields.__visit), and "How did they find you?" can start from it. These pure
// helpers pick the visit and say where it came from; routes/visit_source.ts
// finds the page views.
import { sourceLabel, aiAssistantOf, AI_SOURCE } from './visits.ts';

export type VisitView = { ts: string; path?: string; ref_host?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string };
/** What an enquiry keeps about the visit that led to it (fields.__visit). */
export type EnquiryVisit = { from: string; ref_host: string; utm_source: string; utm_medium: string; utm_campaign: string; landing: string; at: string; found_via: string };

/** Page views more than this far apart are two visits. */
export const VISIT_GAP_MS = 30 * 60_000;

const hasSource = (v: VisitView) => !!(v.ref_host || v.utm_source);

/** The page view a visit began with, for an enquiry sent at `sentAtMs`: the start of
 *  the visit it was sent in, or, when that visit came straight to the site, the start
 *  of the latest earlier one that day that came from somewhere (they found the site on
 *  Google in the morning and came back to send the form). null with no page views. */
export function landingOf(views: VisitView[], sentAtMs: number): VisitView | null {
  const seen = views.filter((v) => { const t = Date.parse(v.ts); return Number.isFinite(t) && t <= sentAtMs + 60_000; })
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (!seen.length) return null;
  const starts: VisitView[] = [];
  let last = -Infinity;
  for (const v of seen) { const t = Date.parse(v.ts); if (t - last > VISIT_GAP_MS) starts.push(v); last = t; }
  const now = starts[starts.length - 1];
  if (hasSource(now)) return now;
  for (let i = starts.length - 2; i >= 0; i--) if (hasSource(starts[i])) return starts[i];
  return now;
}

const SOCIAL = new Set(['Facebook', 'Instagram', 'X / Twitter', 'LinkedIn']);
const SOCIAL_HOST = /(^|\.)(tiktok\.com|pinterest\.[a-z.]+|youtube\.com|youtu\.be|nextdoor\.com|reddit\.com|threads\.net|lnkd\.in|m\.facebook\.com|l\.facebook\.com|lm\.facebook\.com|l\.instagram\.com)$/;
const GOOGLE_TAG = /^(google|gbp|gmb|google[ _-]?(business|maps|my[ _-]?business))\b/i;
const SOCIAL_TAG = /^(facebook|fb|instagram|ig|tiktok|linkedin|pinterest|youtube|nextdoor|twitter|x)$/i;

/** "How did they find you?" from where the visit began: Google, Social, Referral, Other,
 *  or '' when it came straight to the site (a typed address could be anything). */
export function foundViaOf(v: VisitView | null): string {
  if (!v || !hasSource(v)) return '';
  const host = String(v.ref_host || ''), tag = String(v.utm_source || '').trim();
  if (aiAssistantOf(host, tag)) return 'Other';
  if (tag) return GOOGLE_TAG.test(tag) ? 'Google' : SOCIAL_TAG.test(tag) ? 'Social' : 'Other';
  const label = sourceLabel(host, '');
  if (label === 'Google') return 'Google';
  if (SOCIAL.has(label) || SOCIAL_HOST.test(host)) return 'Social';
  if (label === 'Bing' || label === 'DuckDuckGo' || /(^|\.)(search\.yahoo|yahoo|ecosia|search\.brave)\.[a-z.]+$/.test(host)) return 'Other';
  return 'Referral';
}

/** Where the visit began, in words for the Inbox: "a Google search", "ChatGPT",
 *  "Facebook", "a link on yelp.com", "a link tagged spring-sale", or "straight to the site". */
export function cameFrom(v: VisitView | null): string {
  if (!v || !hasSource(v)) return 'straight to the site';
  const host = String(v.ref_host || ''), tag = String(v.utm_source || '').trim();
  const ai = aiAssistantOf(host, tag);
  if (ai) return ai;
  if (tag) return GOOGLE_TAG.test(tag) ? (/cpc|ppc|paid|ads?$/i.test(String(v.utm_medium || '')) ? 'a Google ad' : 'Google') : SOCIAL_TAG.test(tag) ? tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase() : `a link tagged ${tag}`;
  const label = sourceLabel(host, '');
  if (label === 'Google') return /(^|\.)maps\.google\./.test(host) ? 'Google Maps' : 'a Google search';
  if (label === 'Bing' || label === 'DuckDuckGo') return `a ${label} search`;
  if (label !== host && label !== 'Direct' && label !== AI_SOURCE) return label;
  return `a link on ${host}`;
}

/** What the enquiry keeps: where the visit began, its first page and when; null with no visit. */
export function enquiryVisit(views: VisitView[], sentAtMs: number): EnquiryVisit | null {
  const v = landingOf(views, sentAtMs);
  if (!v) return null;
  const s = (x: unknown, n: number) => String(x ?? '').slice(0, n);
  return { from: cameFrom(v), ref_host: s(v.ref_host, 120), utm_source: s(v.utm_source, 60), utm_medium: s(v.utm_medium, 60), utm_campaign: s(v.utm_campaign, 80), landing: s(v.path || '/', 200), at: s(v.ts, 40), found_via: foundViaOf(v) };
}

/** The visit an enquiry noted (fields.__visit), cleaned for the Inbox; null for none. */
export function leadVisit(fields: unknown): EnquiryVisit | null {
  const v = fields && typeof fields === 'object' ? (fields as Record<string, unknown>).__visit : null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>, s = (k: string, n: number) => String(o[k] ?? '').slice(0, n);
  return { from: s('from', 80) || 'straight to the site', ref_host: s('ref_host', 120), utm_source: s('utm_source', 60), utm_medium: s('utm_medium', 60), utm_campaign: s('utm_campaign', 80), landing: s('landing', 200) || '/', at: s('at', 40), found_via: s('found_via', 30) };
}
