// ── AI Visibility Check: is the website giving AI something to cite? ────────
// Runs only when the visitor gives a website (spec "AI readiness"). Reuses the
// Site Review crawler (same SSRF guard, timeouts, size cap, bot detection):
// robots.txt allows the AI crawlers; structured data carries name, address and
// phone; there are about and services pages with real text; the title and main
// heading say the business name, the city and what it is. It also reads the
// facts the extraction checks AI answers against (address, phone, hours).

import { robotsAllows, socialProfiles, fetchPublic, looksLikeHtml, type UrlGuard, type FetchLike } from '../../site_discovery.ts';
import { parsePage, type PageFacts } from '../site_review/html.ts';
import { BOT_UA, candidatesFrom, fetchHtml, pickPages } from '../site_review/crawl.ts';
import type { KnownFacts } from './extract.ts';

export const AI_BOTS = [
  { agent: 'gptbot', label: 'ChatGPT (GPTBot)' },
  { agent: 'claudebot', label: 'Claude (ClaudeBot)' },
  { agent: 'perplexitybot', label: 'Perplexity (PerplexityBot)' },
  { agent: 'google-extended', label: 'Google AI (Google-Extended)' },
];

export interface ReadinessCheck { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }
export interface Readiness { checked: true; homeUrl: string; checks: ReadinessCheck[]; score: number; facts: KnownFacts; pagesRead: string[] }
export type ReadinessResult = Readiness | { checked: false; reason: 'no_url' | 'unreachable' | 'blocked' };

/** Is `agent` allowed to fetch `/`? The groups that name the agent apply; if
 *  none do, the * groups (Google's documented rule, used by the AI crawlers too). */
export function agentAllowed(robotsText: string, agent: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: typeof groups[number] | null = null, lastAgent = false;
  for (const raw of String(robotsText || '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const f = m[1].toLowerCase(), v = m[2].trim();
    if (f === 'user-agent') { if (!cur || !lastAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastAgent = true; }
    else if (f === 'allow' || f === 'disallow') { if (cur) cur.rules.push({ allow: f === 'allow', path: v }); lastAgent = false; }
    else lastAgent = false;
  }
  const named = groups.filter((g) => g.agents.includes(agent));
  const applicable = named.length ? named : groups.filter((g) => g.agents.includes('*'));
  return robotsAllows(applicable.flatMap((g) => g.rules), '/');
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const CATEGORY: Record<string, RegExp> = {
  restaurant: /\b(restaurant|kitchen|bistro|cafe|café|bar|grill|eatery|dining|pizzeria|trattoria|diner|bakery|wine)\b/i,
  salon: /\b(salon|hair|stylist|barber|beauty|spa|nails?|lash|brow|color)\b/i,
  retail: /\b(shop|store|boutique|gallery|market|goods|supply|outfitters)\b/i,
  'home services': /\b(plumb\w*|electric\w*|hvac|roof\w*|contractor|repair|cleaning|landscap\w*|pest|handyman|painting|remodel\w*)\b/i,
  'health and wellness': /\b(pilates|yoga|fitness|gym|wellness|studio|massage|therapy|chiropract\w*|acupuncture|clinic|training)\b/i,
  other: /./,
};

function bizNode(pages: PageFacts[]): Record<string, unknown> | null {
  for (const p of pages) for (const it of p.jsonld.items) {
    const t = it['@type'];
    const types = (Array.isArray(t) ? t : [t]).filter((x) => typeof x === 'string') as string[];
    if (types.some((x) => /LocalBusiness|Organization|Restaurant|Store|Salon|Service|Business|Establishment|Clinic|Gym|Spa|Shop|Plumber|Electrician|Bakery|BarOrPub|CafeOrCoffeeShop|Winery/.test(x) && x !== 'WebSite' && x !== 'WebPage')) return it;
  }
  return null;
}
const addrOf = (n: Record<string, unknown> | null): string => {
  const a = n?.address; const o = Array.isArray(a) ? a[0] : a;
  if (typeof o === 'string') return o;
  if (o && typeof o === 'object') { const x = o as Record<string, unknown>; return [x.streetAddress, x.addressLocality, x.addressRegion].filter(Boolean).join(', '); }
  return '';
};
const hoursOf = (n: Record<string, unknown> | null): string => {
  const h = n?.openingHours;
  if (typeof h === 'string') return h;
  if (Array.isArray(h)) return h.filter((x) => typeof x === 'string').join('; ');
  const spec = n?.openingHoursSpecification;
  if (Array.isArray(spec)) return spec.slice(0, 7).map((s: Record<string, unknown>) => `${Array.isArray(s.dayOfWeek) ? (s.dayOfWeek as string[]).map((d) => String(d).replace(/.*\//, '')).join('/') : String(s.dayOfWeek || '').replace(/.*\//, '')} ${s.opens || ''}-${s.closes || ''}`).join('; ');
  return '';
};

export async function checkReadiness(url: string | null, inp: { businessName: string; city: string; businessType: string }, deps: { guard: UrlGuard; fetchImpl?: FetchLike }, budgetMs: number): Promise<ReadinessResult> {
  if (!url) return { checked: false, reason: 'no_url' };
  const deadline = Date.now() + budgetMs;
  const crawl = { guard: deps.guard, fetchImpl: deps.fetchImpl };
  const home = await fetchHtml(url, crawl, Math.min(deadline, Date.now() + 10_000));
  if (typeof home === 'string') return { checked: false, reason: home === 'blocked' ? 'blocked' : 'unreachable' };
  const homeFacts = parsePage(home.html, home.url, socialProfiles);
  const origin = new URL(home.url).origin;

  const robotsP = fetchPublic(`${origin}/robots.txt`, deps.guard, { ua: BOT_UA, accept: 'text/plain,*/*;q=0.5', timeoutMs: 6000, maxBytes: 512 * 1024, fetchImpl: deps.fetchImpl }).catch(() => null);
  // About and services pages only: enough to judge what AI can read.
  const picks = pickPages(candidatesFrom(home.url, homeFacts.links, [])).filter((c) => /about|story|team|services?|menus?|products?|treatments?|classes|what-we-do|work/i.test(c.path + ' ' + c.text)).slice(0, 3);
  const more = await Promise.all(picks.map(async (c) => { const r = await fetchHtml(c.url, crawl, Math.min(deadline, Date.now() + 9000)); return typeof r === 'string' ? null : parsePage(r.html, r.url, socialProfiles); }));
  const pages = [homeFacts, ...more.filter((p): p is PageFacts => !!p)];
  const robots = await robotsP;
  const robotsText = robots && robots.status === 200 && !looksLikeHtml(robots.text) ? robots.text : '';

  const checks: ReadinessCheck[] = [];
  const blocked = robotsText ? AI_BOTS.filter((b) => !agentAllowed(robotsText, b.agent)) : [];
  checks.push({ id: 'ai_crawlers', label: 'AI crawlers allowed in robots.txt', status: blocked.length === 0 ? 'pass' : blocked.length === AI_BOTS.length ? 'fail' : 'warn',
    detail: !robotsText ? 'No robots.txt, so AI crawlers are allowed by default' : blocked.length ? `Blocked: ${blocked.map((b) => b.label).join(', ')}` : 'GPTBot, ClaudeBot, PerplexityBot and Google-Extended are all allowed' });

  const node = bizNode(pages);
  const missing = [!node?.name && 'name', !node?.address && 'address', !node?.telephone && 'phone'].filter(Boolean) as string[];
  checks.push({ id: 'schema_nap', label: 'Structured data with name, address and phone', status: !node ? 'fail' : missing.length ? 'warn' : 'pass',
    detail: !node ? 'No structured data describing the business' : missing.length ? `Structured data is missing the ${missing.join(' and ')}` : 'Name, address and phone are in the structured data' });

  const about = pages.find((p) => p !== homeFacts && /about|story|team/i.test(p.path) && p.wordCount >= 150);
  const services = pages.find((p) => p !== homeFacts && /services?|menus?|products?|treatments?|classes|what-we-do|work/i.test(p.path) && p.wordCount >= 150);
  checks.push({ id: 'about_services', label: 'About and services pages with plain descriptions', status: about && services ? 'pass' : about || services ? 'warn' : 'fail',
    detail: about && services ? `Found ${about.path} (${about.wordCount} words) and ${services.path} (${services.wordCount} words)` : about ? `Found ${about.path}, but no services or menu page with real text` : services ? `Found ${services.path}, but no about page with real text` : 'No about or services page with at least 150 words' });

  const idText = norm([homeFacts.title, ...homeFacts.h1s].join(' '));
  const hasName = nameIn(idText, inp.businessName);
  const hasCity = !!inp.city && norm([homeFacts.title, ...homeFacts.h1s, homeFacts.firstParagraph].join(' ')).includes(norm(inp.city));
  const hasCategory = (CATEGORY[inp.businessType] || CATEGORY.other).test([homeFacts.title, ...homeFacts.h1s].join(' '));
  const idMissing = [!hasName && 'business name', !hasCity && 'city', !hasCategory && 'what you do'].filter(Boolean) as string[];
  checks.push({ id: 'identity', label: 'Name, city and category in the title and main heading', status: !idMissing.length ? 'pass' : idMissing.length === 3 ? 'fail' : 'warn',
    detail: idMissing.length ? `The homepage title ("${homeFacts.title.slice(0, 70)}") and main heading don't say your ${idMissing.join(' or ')}` : 'The homepage title and heading name the business, the city and what it does' });

  const pts = { pass: 1, warn: 0.5, fail: 0 } as const;
  const score = Math.round((checks.reduce((n, c) => n + pts[c.status], 0) / checks.length) * 100);
  const phone = homeFacts.telLinks[0] || homeFacts.phonesInText[0] || (typeof node?.telephone === 'string' ? node.telephone as string : null);
  return {
    checked: true, homeUrl: home.url, checks, score, pagesRead: pages.map((p) => p.path),
    facts: { address: addrOf(node) || pages.map((p) => p.address).find(Boolean) || null, phone: phone || null, hours: hoursOf(node) || null, website: home.url },
  };
}

function nameIn(text: string, name: string): boolean {
  const words = norm(name).split(' ').filter((w) => w.length > 2 && !['the', 'and', 'llc', 'inc'].includes(w));
  return words.length > 0 && words.every((w) => text.includes(w));
}
