// ── Site Review: the on-page checks and the rule-based score ─────────────────
// Every check records pass / warn / fail (or na when it can't apply) plus the
// evidence it saw: the actual title text, the count of images without alt, the
// pages involved. Scores come from these rules only, never from Claude (spec:
// "Scoring (rule based, never from Claude)"). Each failing check also carries a
// plain-English finding, which is both the input Claude rewrites and the
// template text the report falls back to if Claude fails twice.

import type { PageFacts } from './html.ts';
import { vitalLimitDisplay, type PsiOutcome } from './psi.ts';
import type { Discoverability } from '../../site_discovery.ts';

export type Pillar = 'performance' | 'search' | 'trust' | 'local';
export type Status = 'pass' | 'warn' | 'fail' | 'na';
export const PILLARS: { key: Pillar; name: string; weight: number }[] = [
  { key: 'performance', name: 'Performance', weight: 30 },
  { key: 'search', name: 'Search', weight: 30 },
  { key: 'trust', name: 'Trust and conversion', weight: 20 },
  { key: 'local', name: 'Local', weight: 20 },
];
export const pillarName = (k: Pillar | string) => PILLARS.find((p) => p.key === k)?.name ?? k;

export interface Draft { title: string; what: string; why: string; fix: string }
export interface Check {
  id: string;
  area: string;
  pillar: Pillar;
  weight: number;
  status: Status;
  score?: number;          // 0..1 when the check is graded on a scale (PageSpeed)
  evidence: string;
  draft?: Draft;           // present on warn/fail
}

export interface SiteData {
  homeUrl: string;
  pages: PageFacts[];      // homepage first
  disc: Discoverability;
  httpRedirect: boolean | null;
  broken: { url: string; status: number }[];
  linksChecked: number;
  psi: PsiOutcome;
  businessName: string;
  businessType: string;
  city: string;
}

const STATUS_SCORE: Record<Exclude<Status, 'na'>, number> = { pass: 1, warn: 0.5, fail: 0 };
const q = (s: string, max = 80) => `"${s.length > max ? s.slice(0, max - 1) + '…' : s}"`;
const list = (xs: string[], n = 3) => xs.length <= n ? xs.join(', ') : `${xs.slice(0, n).join(', ')} and ${xs.length - n} more`;
/** "a", "a and b", "a, b and c": for short lists that should be read in full. */
export const andList = (xs: string[]) => xs.length <= 1 ? (xs[0] || '') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const digits = (s: string) => { const d = String(s || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; };

// What kind of customer each business type is talking to, for the "why it matters" lines.
const WHO: Record<string, string> = {
  restaurant: 'diners choosing where to eat tonight',
  salon: 'clients deciding where to book',
  retail: 'shoppers deciding where to buy',
  'home services': 'homeowners who need someone now',
  'health and wellness': 'people looking for a studio or practitioner',
  other: 'customers comparing their options',
};
const who = (t: string) => WHO[t] || WHO.other;

// Schema types that fit each business type (spec: "type matches the business").
const SCHEMA_FIT: Record<string, RegExp> = {
  restaurant: /^(Restaurant|FoodEstablishment|CafeOrCoffeeShop|BarOrPub|Bakery|Brewery|Winery|FastFoodRestaurant|IceCreamShop|Distillery)$/,
  salon: /^(HairSalon|BeautySalon|NailSalon|DaySpa|HealthAndBeautyBusiness|TattooParlor)$/,
  retail: /^(Store|.+Store|ShoppingCenter|Florist|JewelryStore)$/,
  'home services': /^(HomeAndConstructionBusiness|Plumber|Electrician|HVACBusiness|RoofingContractor|GeneralContractor|HousePainter|Locksmith|MovingCompany|LandscapingBusiness|PestControl|CleaningService|ProfessionalService)$/,
  'health and wellness': /^(HealthAndBeautyBusiness|MedicalBusiness|ExerciseGym|SportsActivityLocation|HealthClub|DaySpa|Physician|Dentist|Physiotherapy|MedicalClinic|Optician)$/,
  other: /^(LocalBusiness|Organization|ProfessionalService|.+Business|.+Service)$/,
};
// Any schema type that describes a business (exact names and the usual suffixes).
const LOCALISH = /^(?:LocalBusiness|Organization|Corporation|NGO|ProfessionalService|Restaurant|Bakery|Brewery|Winery|Distillery|CafeOrCoffeeShop|BarOrPub|Plumber|Electrician|Locksmith|Dentist|Physician|Optician|Florist|Attorney|Notary|DaySpa|HealthClub|ExerciseGym|Physiotherapy|TattooParlor|MovingCompany|HousePainter|PestControl|\w*(?:Business|Store|Service|Establishment|Salon|Restaurant|Contractor|Clinic|Gym|Spa|Shop|Center|Agency|Office))$/;

function typesOf(items: Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const t = it['@type'];
    for (const x of Array.isArray(t) ? t : [t]) if (typeof x === 'string') out.push(x.replace(/^https?:\/\/schema\.org\//, ''));
  }
  return [...new Set(out)];
}
function businessNode(items: Record<string, unknown>[]): Record<string, unknown> | null {
  return items.find((it) => typesOf([it]).some((t) => LOCALISH.test(t) && t !== 'WebSite' && t !== 'WebPage')) || null;
}
function schemaAddress(node: Record<string, unknown> | null): { street: string; city: string } {
  const a = node?.address;
  const one = Array.isArray(a) ? a[0] : a;
  if (typeof one === 'string') return { street: one, city: '' };
  if (one && typeof one === 'object') {
    const o = one as Record<string, unknown>;
    return { street: String(o.streetAddress || ''), city: String(o.addressLocality || '') };
  }
  return { street: '', city: '' };
}

/** The business name to print on the report: og:site_name, then the schema
 *  name, then the homepage title's brand part, then the domain. */
export function deriveBusinessName(home: PageFacts): string {
  const node = businessNode(home.jsonld.items);
  const fromSchema = typeof node?.name === 'string' ? (node.name as string).trim() : '';
  if (home.og.siteName) return home.og.siteName;
  if (fromSchema) return fromSchema.slice(0, 120);
  const parts = home.title.split(/\s+[|–—\-:·]\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    // "Home | Cedar & Core" → the part that isn't a generic page word.
    const generic = /^(home|homepage|welcome|official site|official website)$/i;
    const brand = parts.find((p) => !generic.test(p) && p.length <= 60);
    if (brand) return brand;
  } else if (parts[0] && parts[0].length <= 40) return parts[0];
  try { return new URL(home.url).hostname.replace(/^www\./, ''); } catch { return 'Your business'; }
}

// ── the checks ───────────────────────────────────────────────────────────────

export function runChecks(d: SiteData): Check[] {
  const pages = d.pages;
  const home = pages[0];
  const homePath = home.path;
  const paths = (ps: PageFacts[]) => ps.map((p) => p.path);
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const W = who(d.businessType);
  const name = d.businessName;

  // ── Titles and descriptions (Search)
  const noTitle = pages.filter((p) => !p.title);
  add({
    id: 'title_present', area: 'Titles and descriptions', pillar: 'search', weight: 3,
    status: !home.title ? 'fail' : noTitle.length ? 'warn' : 'pass',
    evidence: noTitle.length ? `No page title on ${list(paths(noTitle))}` : `Every page has a title (homepage: ${q(home.title)})`,
    draft: noTitle.length ? { title: !home.title ? 'Your homepage has no page title' : `${noTitle.length} page${noTitle.length > 1 ? 's have' : ' has'} no page title`, what: `We found no page title (the line Google shows as the blue link) on ${list(paths(noTitle))}.`, why: `Without a title, Google writes its own from whatever text it finds, and ${W} see something vague in the results.`, fix: 'Give every page its own title that says what the page is and who it is for.' } : undefined,
  });
  const badLen = pages.filter((p) => p.title && (p.title.length < 30 || p.title.length > 60));
  add({
    id: 'title_length', area: 'Titles and descriptions', pillar: 'search', weight: 2,
    status: !badLen.length ? 'pass' : badLen.some((p) => p.path === homePath) ? 'fail' : 'warn',
    evidence: badLen.length ? badLen.slice(0, 4).map((p) => `${p.path}: ${q(p.title)} (${p.title.length} characters)`).join('; ') : 'All titles are 30 to 60 characters',
    draft: badLen.length ? (() => { const p = badLen[0]; const short = p.title.length < 30; return { title: short ? `The ${p.path === '/' ? 'homepage' : p.path} title is too short to say much` : `The ${p.path === '/' ? 'homepage' : p.path} title gets cut off in Google`, what: `The title on ${p.path} is ${q(p.title)}, ${p.title.length} characters${badLen.length > 1 ? `, and ${badLen.length - 1} other page${badLen.length > 2 ? 's are' : ' is'} outside the 30 to 60 character range` : ''}.`, why: short ? 'A short title leaves out the words people actually search for, like what you do and where.' : 'Google cuts titles off at about 60 characters, so the end of yours, often the part that says where you are, never shows.', fix: 'Rewrite the title to fit 30 to 60 characters with your service and city in it.' }; })() : undefined,
  });
  const byTitle = new Map<string, string[]>();
  for (const p of pages) if (p.title) byTitle.set(p.title.toLowerCase(), [...(byTitle.get(p.title.toLowerCase()) || []), p.path]);
  const dupTitles = [...byTitle.entries()].filter(([, ps]) => ps.length > 1);
  add({
    id: 'title_unique', area: 'Titles and descriptions', pillar: 'search', weight: 2,
    status: pages.length < 2 ? 'na' : dupTitles.length ? 'warn' : 'pass',
    evidence: dupTitles.length ? dupTitles.map(([t, ps]) => `${list(ps)} share ${q(pages.find((p) => p.title.toLowerCase() === t)!.title)}`).join('; ') : 'Every page title is different',
    draft: dupTitles.length ? { title: `${dupTitles.reduce((n, [, ps]) => n + ps.length, 0)} pages share the same title`, what: `${list(dupTitles[0][1])} are all titled ${q(pages.find((p) => p.title.toLowerCase() === dupTitles[0][0])!.title)}.`, why: 'When pages share a title, Google struggles to tell them apart and may show the wrong one.', fix: 'Give each page a title that says what is on that page.' } : undefined,
  });
  const nameN = norm(name);
  const homeHasName = !!nameN && norm(home.title).includes(nameN);
  add({
    id: 'title_brand', area: 'Titles and descriptions', pillar: 'search', weight: 1,
    status: !home.title || !nameN ? 'na' : homeHasName ? 'pass' : 'warn',
    evidence: homeHasName ? `Homepage title includes ${q(name)}` : `Homepage title ${q(home.title)} doesn't include ${q(name)}`,
    draft: !homeHasName && home.title && nameN ? { title: "Your business name isn't in the homepage title", what: `The homepage title is ${q(home.title)}, which doesn't include ${q(name)}.`, why: 'People who already heard of you search by name, and the title is the first place Google checks for it.', fix: 'Add your business name to the homepage title.' } : undefined,
  });
  const noDesc = pages.filter((p) => !p.metaDescription);
  add({
    id: 'desc_present', area: 'Titles and descriptions', pillar: 'search', weight: 2,
    status: !home.metaDescription ? 'fail' : noDesc.length ? 'warn' : 'pass',
    evidence: noDesc.length ? `No meta description on ${list(paths(noDesc))}` : 'Every page has a meta description',
    draft: noDesc.length ? { title: !home.metaDescription ? 'Your homepage has no search description' : `${noDesc.length} page${noDesc.length > 1 ? 's have' : ' has'} no search description`, what: `We found no meta description (the two lines of text under your link in Google) on ${list(paths(noDesc))}.`, why: `Google fills the gap with random text from the page, which rarely gives ${W} a reason to click.`, fix: 'Write a one or two sentence description for each page that says what you offer and why choose you.' } : undefined,
  });
  const badDesc = pages.filter((p) => p.metaDescription && (p.metaDescription.length < 70 || p.metaDescription.length > 160));
  add({
    id: 'desc_length', area: 'Titles and descriptions', pillar: 'search', weight: 1,
    status: !pages.some((p) => p.metaDescription) ? 'na' : badDesc.length ? 'warn' : 'pass',
    evidence: badDesc.length ? badDesc.slice(0, 3).map((p) => `${p.path}: ${p.metaDescription.length} characters`).join('; ') : 'Descriptions are 70 to 160 characters',
    draft: badDesc.length ? { title: 'Some search descriptions are the wrong length', what: `The description on ${badDesc[0].path} is ${badDesc[0].metaDescription.length} characters${badDesc.length > 1 ? `, and ${badDesc.length - 1} more are outside 70 to 160` : ''}.`, why: 'Too short says too little; too long gets cut off mid-sentence in the results.', fix: 'Bring each description to between 70 and 160 characters.' } : undefined,
  });
  const byDesc = new Map<string, string[]>();
  for (const p of pages) if (p.metaDescription) byDesc.set(p.metaDescription.toLowerCase(), [...(byDesc.get(p.metaDescription.toLowerCase()) || []), p.path]);
  const dupDesc = [...byDesc.values()].filter((ps) => ps.length > 1);
  add({
    id: 'desc_unique', area: 'Titles and descriptions', pillar: 'search', weight: 1,
    status: pages.filter((p) => p.metaDescription).length < 2 ? 'na' : dupDesc.length ? 'warn' : 'pass',
    evidence: dupDesc.length ? `${list(dupDesc[0])} share one description` : 'Every description is different',
    draft: dupDesc.length ? { title: 'Several pages use the same search description', what: `${list(dupDesc[0])} all use the same meta description.`, why: 'Copy-pasted descriptions make your pages look interchangeable in Google.', fix: 'Write a separate description for each of those pages.' } : undefined,
  });

  // ── Headings (Search)
  const h1Bad = pages.filter((p) => p.h1s.length !== 1 || !p.h1s[0]);
  const homeH1 = home.h1s.length !== 1 || !home.h1s[0];
  add({
    id: 'h1_one', area: 'Headings', pillar: 'search', weight: 2,
    status: homeH1 ? 'fail' : h1Bad.length ? 'warn' : 'pass',
    evidence: h1Bad.length ? h1Bad.slice(0, 4).map((p) => `${p.path}: ${p.h1s.length === 0 ? 'no H1' : p.h1s.length > 1 ? `${p.h1s.length} H1s` : 'empty H1'}`).join('; ') : `One main heading per page (homepage: ${q(home.h1s[0] || '')})`,
    draft: h1Bad.length ? { title: homeH1 ? (home.h1s.length === 0 ? 'Your homepage has no main heading' : home.h1s.length > 1 ? `Your homepage has ${home.h1s.length} main headings` : 'Your homepage main heading is empty') : 'Some pages have no single main heading', what: homeH1 ? (home.h1s.length > 1 ? `The homepage has ${home.h1s.length} H1 headings (${list(home.h1s.map((h) => q(h, 40)), 2)})${h1Bad.length > 1 ? `, and ${h1Bad.length - 1} other page${h1Bad.length > 2 ? 's don\u2019t' : ' doesn\u2019t'} have exactly one either` : ''}.` : `The homepage has ${home.h1s.length === 0 ? 'no H1 (main heading)' : 'an empty H1 (main heading)'}${h1Bad.length > 1 ? `, and so do ${h1Bad.length - 1} other pages` : ''}.`) : `${list(paths(h1Bad))} ${h1Bad.length > 1 ? "don't" : "doesn't"} have exactly one H1 (main heading).`, why: 'The main heading is how Google and screen readers learn what a page is about at a glance.', fix: 'Give each page one clear main heading that names what the page offers.' } : undefined,
  });
  const skipped = pages.filter((p) => p.headingLevels.some((l, i) => i > 0 && l > p.headingLevels[i - 1] + 1));
  add({
    id: 'heading_order', area: 'Headings', pillar: 'search', weight: 1,
    status: skipped.length ? 'warn' : 'pass',
    evidence: skipped.length ? `Heading levels skip on ${list(paths(skipped))}` : 'Heading levels run in order',
    draft: skipped.length ? { title: 'Heading levels skip on some pages', what: `On ${list(paths(skipped))}, headings jump levels (for example from H1 straight to H3).`, why: 'Skipped levels make the page outline harder for Google and screen readers to follow.', fix: 'Use heading levels in order so the page reads like an outline.' } : undefined,
  });

  // ── Images (Search; oversized images go with Performance)
  const imgTotal = pages.reduce((n, p) => n + p.images.total, 0);
  const imgMissing = pages.reduce((n, p) => n + p.images.missingAlt, 0);
  const missPct = imgTotal ? Math.round((imgMissing / imgTotal) * 100) : 0;
  const worstAlt = [...pages].sort((a, b) => b.images.missingAlt - a.images.missingAlt)[0];
  add({
    id: 'images_alt', area: 'Images', pillar: 'search', weight: 2,
    status: !imgTotal ? 'na' : missPct < 10 ? 'pass' : missPct < 40 ? 'warn' : 'fail',
    evidence: `${imgMissing} of ${imgTotal} images (${missPct}%) have no alt text`,
    draft: imgTotal && missPct >= 10 ? { title: `${missPct}% of your images have no description`, what: `${imgMissing} of the ${imgTotal} images we found have no alt text (a short written description), including ${worstAlt.images.missingAlt} on ${worstAlt.path}.`, why: 'Google reads alt text to understand photos, and people using screen readers hear nothing for those images.', fix: 'Add a short, plain description to each meaningful photo.' } : undefined,
  });

  // ── Indexing (Search)
  const strayNoindex = pages.filter((p) => p.noindex);
  add({
    id: 'noindex', area: 'Indexing', pillar: 'search', weight: 3,
    status: strayNoindex.length ? 'fail' : 'pass',
    evidence: strayNoindex.length ? `noindex on ${list(paths(strayNoindex))}` : 'No page asks Google to stay away',
    draft: strayNoindex.length ? { title: strayNoindex.some((p) => p.path === homePath) ? 'Your homepage tells Google not to list it' : `${strayNoindex.length} page${strayNoindex.length > 1 ? 's tell' : ' tells'} Google not to list ${strayNoindex.length > 1 ? 'them' : 'it'}`, what: `${list(paths(strayNoindex))} ${strayNoindex.length > 1 ? 'carry' : 'carries'} a "noindex" tag, which keeps the page out of Google entirely.`, why: 'A page with noindex can never show up in search, no matter how good it is. This is often left on by accident after a redesign.', fix: 'Remove the noindex setting from pages you want people to find.' } : undefined,
  });
  const canonBad = pages.filter((p) => {
    if (!p.canonical) return true;
    try { const c = new URL(p.canonical, p.url); const u = new URL(p.url); return c.hostname.replace(/^www\./, '') !== u.hostname.replace(/^www\./, '') || c.pathname.replace(/\/$/, '') !== u.pathname.replace(/\/$/, ''); } catch { return true; }
  });
  const canonMissing = canonBad.filter((p) => !p.canonical);
  add({
    id: 'canonical', area: 'Indexing', pillar: 'search', weight: 1,
    status: !canonBad.length ? 'pass' : 'warn',
    evidence: canonBad.length ? canonBad.slice(0, 3).map((p) => p.canonical ? `${p.path} points to ${p.canonical}` : `${p.path} has none`).join('; ') : 'Each page names itself as the original',
    draft: canonBad.length ? { title: canonMissing.length === canonBad.length ? 'Pages don’t say which address is the original' : 'Some pages point Google at a different address', what: canonBad[0].canonical ? `${canonBad[0].path} has a canonical tag pointing to ${canonBad[0].canonical}.` : `${list(paths(canonMissing))} ${canonMissing.length > 1 ? 'have' : 'has'} no canonical tag (the note that tells Google which address is the real one).`, why: 'Without it, Google can split your ranking between versions of the same page, like with and without "www".', fix: 'Set each page’s canonical tag to its own address.' } : undefined,
  });
  add({
    id: 'robots', area: 'Indexing', pillar: 'search', weight: 2,
    status: d.disc.robotsTxtBlocksAll ? 'fail' : d.disc.robotsTxt ? 'pass' : 'warn',
    evidence: d.disc.robotsTxtBlocksAll ? 'robots.txt blocks Google from the whole site' : d.disc.robotsTxt ? 'robots.txt is present and allows Google in' : 'No robots.txt file',
    draft: d.disc.robotsTxtBlocksAll ? { title: 'Your robots.txt blocks Google from the whole site', what: 'The robots.txt file (the instructions search engines read first) tells Google not to visit any page.', why: 'While that line is there, your site can drop out of Google completely.', fix: 'Change robots.txt so it allows search engines in.' }
      : !d.disc.robotsTxt ? { title: 'No robots.txt file', what: 'Your site has no robots.txt file, the short file search engines read before visiting.', why: 'It isn’t required, but it is where you point Google at your sitemap so new pages get found faster.', fix: 'Add a simple robots.txt that allows search engines and lists your sitemap.' } : undefined,
  });
  add({
    id: 'sitemap', area: 'Indexing', pillar: 'search', weight: 2,
    status: d.disc.sitemapXml ? 'pass' : 'warn',
    evidence: d.disc.sitemapXml ? `Sitemap found at ${d.disc.sitemapUrl} (${d.disc.sitemapUrlCount} entries)` : d.disc.sitemapDeclared ? `robots.txt names ${d.disc.sitemapUrl}, but it didn't load as a sitemap` : 'No sitemap.xml found',
    draft: !d.disc.sitemapXml ? { title: 'No sitemap for Google to follow', what: d.disc.sitemapDeclared ? `robots.txt points to a sitemap at ${d.disc.sitemapUrl}, but it didn’t load as a valid sitemap.` : 'We couldn’t find a sitemap.xml, the list of pages you hand to Google.', why: 'A sitemap helps Google find every page, including new ones, instead of waiting to stumble on them.', fix: 'Publish a sitemap and submit it in Google Search Console.' } : undefined,
  });
  add({
    id: 'lang', area: 'Indexing', pillar: 'search', weight: 1,
    status: home.lang ? 'pass' : 'warn',
    evidence: home.lang ? 'Language is set on the page' : 'No lang attribute on the homepage',
    draft: !home.lang ? { title: 'The page doesn’t say what language it’s in', what: 'The homepage has no language setting (the lang attribute).', why: 'Browsers, translators and screen readers use it to read the page correctly.', fix: 'Set the page language to English in the site settings.' } : undefined,
  });

  // ── Structured data (Search)
  const allItems = pages.flatMap((p) => p.jsonld.items);
  const blocks = pages.reduce((n, p) => n + p.jsonld.blocks, 0);
  const parseErrors = pages.reduce((n, p) => n + p.jsonld.parseErrors, 0);
  const types = typesOf(allItems);
  add({
    id: 'schema_present', area: 'Structured data', pillar: 'search', weight: 2,
    status: !blocks ? 'fail' : parseErrors ? 'warn' : 'pass',
    evidence: !blocks ? 'No JSON-LD structured data on any page' : `${blocks} JSON-LD block${blocks > 1 ? 's' : ''}${parseErrors ? `, ${parseErrors} with errors` : ''}; types: ${list(types, 5) || 'none'}`,
    draft: !blocks ? { title: 'No business details for Google in the code', what: 'We found no structured data (the hidden labels that tell Google your name, address, phone and hours) on any page we checked.', why: 'Without it, Google has to guess your details, and your map listing and search results can drift from your site.', fix: 'Add structured data that matches your Google Business Profile.' }
      : parseErrors ? { title: 'Some of your structured data is broken', what: `${parseErrors} of ${blocks} structured data blocks have errors and can’t be read.`, why: 'Google ignores structured data it can’t read, so those details count for nothing.', fix: 'Fix the broken structured data so it reads cleanly.' } : undefined,
  });
  const fit = SCHEMA_FIT[d.businessType] || SCHEMA_FIT.other;
  const node = businessNode(allItems);
  const nodeTypes = node ? typesOf([node]) : [];
  const fits = nodeTypes.some((t) => fit.test(t));
  add({
    id: 'schema_type', area: 'Structured data', pillar: 'search', weight: 2,
    status: !blocks ? 'na' : fits ? 'pass' : node ? 'warn' : 'fail',
    evidence: node ? `Business type in the code: ${list(nodeTypes)}` : `No business type in the code (found: ${list(types, 4) || 'nothing'})`,
    draft: blocks && !fits ? { title: node ? 'Your structured data uses a generic business type' : 'Your structured data doesn’t describe a business', what: node ? `The structured data calls you a ${list(nodeTypes)}, not a type specific to a ${d.businessType} business.` : `The structured data describes ${list(types, 3) || 'the page'}, but nothing says what kind of business you are.`, why: `A specific type (like ${d.businessType === 'restaurant' ? 'Restaurant' : d.businessType === 'salon' ? 'HairSalon' : 'LocalBusiness'}) helps Google show you for the right searches.`, fix: 'Set the structured data type to the one that matches your business.' } : undefined,
  });
  const hasName = !!node?.name, hasAddr = !!node?.address, hasPhone = !!node?.telephone, hasHours = !!(node?.openingHours || node?.openingHoursSpecification);
  const missingParts = [!hasName && 'name', !hasAddr && 'address', !hasPhone && 'phone', !hasHours && 'hours'].filter(Boolean) as string[];
  add({
    id: 'schema_details', area: 'Structured data', pillar: 'search', weight: 2,
    status: !node ? 'na' : !missingParts.length ? 'pass' : missingParts.length >= 3 ? 'fail' : 'warn',
    evidence: node ? (missingParts.length ? `Structured data is missing ${andList(missingParts)}` : 'Name, address, phone and hours are all in the structured data') : 'No business block to check',
    draft: node && missingParts.length ? { title: `Your structured data is missing your ${andList(missingParts)}`, what: `The business block in your code has no ${andList(missingParts)}.`, why: 'Those are the details Google puts in your search listing and on the map.', fix: `Add your ${andList(missingParts)} to the structured data.` } : undefined,
  });

  // ── Content (Search)
  const thin = pages.filter((p) => p.wordCount < 150);
  add({
    id: 'thin_content', area: 'Content', pillar: 'search', weight: 2,
    status: !thin.length ? 'pass' : thin.length / pages.length > 0.5 || thin.some((p) => p.path === homePath) ? 'fail' : 'warn',
    evidence: thin.length ? thin.map((p) => `${p.path}: ${p.wordCount} words`).join('; ') : 'Every page has 150 words or more',
    draft: thin.length ? { title: thin.some((p) => p.path === homePath) ? 'Your homepage has very little text' : `${thin.length} page${thin.length > 1 ? 's have' : ' has'} very little text`, what: `${thin.slice(0, 3).map((p) => `${p.path} has ${p.wordCount} words`).join(', ')}${thin.length > 3 ? `, and ${thin.length - 3} more ${thin.length - 3 > 1 ? 'are' : 'is'} under 150` : ''}.`, why: `Google needs words to understand what a page offers. Thin pages rarely show up, and ${W} leave without the answers they came for.`, fix: 'Add a few short paragraphs on each thin page about what you offer and where.' } : undefined,
  });
  const ph = pages.filter((p) => p.placeholder);
  add({
    id: 'placeholder', area: 'Content', pillar: 'search', weight: 2,
    status: ph.length ? 'fail' : 'pass',
    evidence: ph.length ? ph.map((p) => `${p.path}: ${q(p.placeholder || '')}`).join('; ') : 'No placeholder text found',
    draft: ph.length ? { title: 'Template placeholder text is still on the site', what: `We found ${q(ph[0].placeholder || '')} on ${list(paths(ph))}.`, why: 'Leftover template text makes the business look unfinished and costs trust in seconds.', fix: 'Replace the placeholder text with your own words.' } : undefined,
  });
  add({
    id: 'broken_links', area: 'Content', pillar: 'search', weight: 2,
    status: !d.linksChecked ? 'na' : !d.broken.length ? 'pass' : d.broken.length >= 3 ? 'fail' : 'warn',
    evidence: d.broken.length ? d.broken.slice(0, 4).map((b) => `${new URL(b.url).pathname} (${b.status})`).join('; ') : `${d.linksChecked} internal links checked, none broken`,
    draft: d.broken.length ? { title: `${d.broken.length} link${d.broken.length > 1 ? 's on your site lead' : ' on your site leads'} nowhere`, what: `Of ${d.linksChecked} internal links we checked, ${list(d.broken.map((b) => `${new URL(b.url).pathname} (error ${b.status})`))} ${d.broken.length > 1 ? 'are' : 'is'} broken.`, why: 'A dead link stops a visitor mid-decision and tells Google the site isn’t looked after.', fix: 'Point those links at pages that exist, or remove them.' } : undefined,
  });

  // ── Mobile (Search)
  const psiFlags = d.psi.ok ? d.psi.mobileFlags : [];
  add({
    id: 'viewport', area: 'Mobile', pillar: 'search', weight: 2,
    status: !home.viewport ? 'fail' : psiFlags.length ? 'warn' : 'pass',
    evidence: !home.viewport ? 'No viewport setting on the homepage' : psiFlags.length ? psiFlags.join('; ') : 'Set up for phones',
    draft: !home.viewport ? { title: 'Your site isn’t set up for phones', what: 'The homepage has no viewport setting, so phones show a shrunken desktop page.', why: 'Most local searches happen on phones, and Google ranks phone-friendly sites first.', fix: 'Add the standard mobile viewport setting to every page.' }
      : psiFlags.length ? { title: 'Parts of the site are hard to use on a phone', what: `Google’s test flagged: ${psiFlags.join('; ').toLowerCase()}.`, why: 'Visitors on phones give up quickly when text is tiny or buttons are hard to tap.', fix: 'Fix the flagged mobile issues so the page is easy to use with one thumb.' } : undefined,
  });

  // ── Security (Trust)
  const https = home.url.startsWith('https://');
  add({
    id: 'https', area: 'Security', pillar: 'trust', weight: 3,
    status: https ? 'pass' : 'fail',
    evidence: https ? 'The site loads over HTTPS' : `The site loads over plain HTTP (${home.url})`,
    draft: !https ? { title: 'Your site shows as "Not secure"', what: `Your homepage loads at ${home.url}, without HTTPS.`, why: 'Browsers label the site "Not secure" and many visitors leave on the spot. Google also ranks it lower.', fix: 'Turn on HTTPS with a free security certificate.' } : undefined,
  });
  const mixed = pages.filter((p) => p.mixedContent.length);
  add({
    id: 'mixed_content', area: 'Security', pillar: 'trust', weight: 1,
    status: !https ? 'na' : mixed.length ? 'warn' : 'pass',
    evidence: mixed.length ? `Insecure files on ${list(paths(mixed))}: ${mixed[0].mixedContent[0]}` : 'No insecure files loaded',
    draft: mixed.length ? { title: 'Some files load without security', what: `${list(paths(mixed))} load${mixed.length > 1 ? '' : 's'} files over plain HTTP, for example ${mixed[0].mixedContent[0]}.`, why: 'Browsers may block those files or show a warning, which can break images or forms.', fix: 'Load every image and script over HTTPS.' } : undefined,
  });
  add({
    id: 'http_redirect', area: 'Security', pillar: 'trust', weight: 2,
    status: !https || d.httpRedirect === null ? 'na' : d.httpRedirect ? 'pass' : 'fail',
    evidence: d.httpRedirect ? 'http:// sends visitors to https://' : d.httpRedirect === false ? 'http:// stays on the insecure version' : 'Could not check',
    draft: https && d.httpRedirect === false ? { title: 'The insecure version of your site is still open', what: 'Typing your address with http:// stays on the insecure version instead of switching to https://.', why: 'Old links and typed addresses land on a "Not secure" page, and Google may see two copies of your site.', fix: 'Redirect every http:// address to its https:// version.' } : undefined,
  });

  // ── Contact and trust (Trust)
  const telPages = pages.filter((p) => p.telLinks.length);
  const phoneText = pages.flatMap((p) => p.phonesInText);
  add({
    id: 'tel_link', area: 'Contact and trust', pillar: 'trust', weight: 2,
    status: telPages.length ? 'pass' : phoneText.length ? 'warn' : 'fail',
    evidence: telPages.length ? `Tap-to-call link: ${telPages[0].telLinks[0]}` : phoneText.length ? `Phone ${phoneText[0]} appears as plain text` : 'No phone number found',
    draft: !telPages.length ? (phoneText.length ? { title: 'Your phone number can’t be tapped to call', what: `${phoneText[0]} appears as plain text on ${list(paths(pages.filter((p) => p.phonesInText.length)))}, not as a tap-to-call link.`, why: `${W[0].toUpperCase() + W.slice(1)} on a phone have to copy the number by hand, and some won’t bother.`, fix: 'Make the phone number a tap-to-call link everywhere it appears.' }
      : { title: 'We couldn’t find a phone number', what: 'None of the pages we checked shows a phone number.', why: 'Many local customers want to call before they visit or book, and a missing number reads as a red flag.', fix: 'Show your phone number in the header or footer of every page.' }) : undefined,
  });
  const emailOrForm = pages.some((p) => p.mailtoLinks || p.forms);
  add({
    id: 'email_or_form', area: 'Contact and trust', pillar: 'trust', weight: 2,
    status: emailOrForm ? 'pass' : 'fail',
    evidence: emailOrForm ? `Email link or form on ${list(paths(pages.filter((p) => p.mailtoLinks || p.forms)))}` : 'No email link or contact form found',
    draft: !emailOrForm ? { title: 'There’s no way to write to you', what: 'None of the pages we checked has an email link or a contact form.', why: 'Some people would rather write than call, especially after hours, and they leave when there’s no way to.', fix: 'Add a short contact form or an email link.' } : undefined,
  });
  const addrPages = pages.filter((p) => p.address);
  add({
    id: 'address_on_site', area: 'Contact and trust', pillar: 'trust', weight: 2,
    status: addrPages.length ? 'pass' : 'warn',
    evidence: addrPages.length ? `Address found: ${q(addrPages[0].address || '')}` : 'No street address found',
    draft: !addrPages.length ? { title: 'We couldn’t find your address', what: 'None of the pages we checked shows a street address.', why: 'An address shows you are a real local business. If you serve customers at their place, a service area does the same job.', fix: 'Show your address, or your service area, on the site.' } : undefined,
  });
  const homeLinks = home.links;
  const contactLink = homeLinks.find((l) => /contact|get-in-touch|reach-us|book|appointment|reserv|visit|find-us|location|directions|^tel:|^mailto:/i.test(l.href + ' ' + l.text));
  add({
    id: 'contact_page', area: 'Contact and trust', pillar: 'trust', weight: 2,
    status: contactLink ? 'pass' : 'warn',
    evidence: contactLink ? `Contact link on the homepage: ${q(contactLink.text || contactLink.href, 40)}` : 'No contact page link on the homepage',
    draft: !contactLink ? { title: 'Contact details are more than one click away', what: 'The homepage has no link to a contact or booking page.', why: 'People ready to reach out shouldn’t have to hunt for how.', fix: 'Link to your contact or booking page from the menu.' } : undefined,
  });
  const privacy = pages.flatMap((p) => p.links).some((l) => /privacy/i.test(l.href + ' ' + l.text));
  add({
    id: 'privacy_policy', area: 'Contact and trust', pillar: 'trust', weight: 1,
    status: privacy ? 'pass' : 'warn',
    evidence: privacy ? 'Privacy policy is linked' : 'No privacy policy link found',
    draft: !privacy ? { title: 'No privacy policy', what: 'We found no link to a privacy policy.', why: 'If the site has a form or newsletter sign-up, a privacy policy is expected, and its absence looks careless.', fix: 'Add a short privacy policy and link it in the footer.' } : undefined,
  });
  const social = [...new Set(pages.flatMap((p) => p.social))];
  add({
    id: 'social_links', area: 'Contact and trust', pillar: 'trust', weight: 1,
    status: social.length ? 'pass' : 'warn',
    evidence: social.length ? `Links to ${list(social, 4)}` : 'No social or review profile links',
    draft: !social.length ? { title: 'No links to your social or review profiles', what: 'We found no links to Instagram, Facebook, Yelp, Google or similar profiles.', why: 'Those profiles carry your photos and reviews, which do a lot of the convincing.', fix: 'Link to your most active profiles in the footer.' } : undefined,
  });

  // ── Conversion (Trust)
  add({
    id: 'cta_first_screen', area: 'Conversion', pillar: 'trust', weight: 3,
    status: home.cta ? 'pass' : 'fail',
    evidence: home.cta ? `First-screen call to action: ${q(home.cta, 40)}` : 'No call to action in the first screen of the homepage',
    draft: !home.cta ? { title: 'The homepage doesn’t ask visitors to do anything', what: 'In the first screen of the homepage we found no clear button or link to book, call, order or get a quote.', why: `${W[0].toUpperCase() + W.slice(1)} decide in seconds. Without an obvious next step, many leave instead of acting.`, fix: 'Put one clear action button at the top of the homepage.' } : undefined,
  });

  // ── Sharing (Trust)
  const ogMissing = [!home.og.title && 'title', !home.og.description && 'description', !home.og.image && 'image'].filter(Boolean) as string[];
  add({
    id: 'og_tags', area: 'Sharing', pillar: 'trust', weight: 1,
    status: !ogMissing.length ? 'pass' : ogMissing.length === 3 ? 'fail' : 'warn',
    evidence: ogMissing.length ? `Share preview missing ${list(ogMissing)}` : 'Share preview has a title, description and image',
    draft: ogMissing.length ? { title: 'Links to your site share without a proper preview', what: `The homepage has no Open Graph ${list(ogMissing)} (what Facebook, iMessage and others show when someone shares your link).`, why: 'A shared link with no picture or a random one gets far fewer taps.', fix: 'Set a share title, description and image for the homepage.' } : undefined,
  });
  add({
    id: 'favicon', area: 'Sharing', pillar: 'trust', weight: 1,
    status: home.favicon ? 'pass' : 'warn',
    evidence: home.favicon ? 'Favicon set' : 'No favicon',
    draft: !home.favicon ? { title: 'No site icon in the browser tab', what: 'The site has no favicon, the small logo in the browser tab and bookmarks.', why: 'It’s a small detail, but its absence makes a site look unfinished next to competitors.', fix: 'Add your logo as the site icon.' } : undefined,
  });

  // ── Local
  const node2 = businessNode(allItems);
  const sAddr = schemaAddress(node2);
  const city = d.city || sAddr.city;
  const cityN = norm(city);
  const cityPlaces = cityN ? [home.title, ...home.h1s, home.firstParagraph] : [];
  const cityHit = cityN && cityPlaces.some((s) => norm(s).includes(cityN));
  const cityAnywhere = cityN && pages.some((p) => [p.title, ...p.h1s, p.firstParagraph].some((s) => norm(s).includes(cityN)));
  add({
    id: 'city_mention', area: 'Local', pillar: 'local', weight: 3,
    status: !cityN ? 'na' : cityHit ? 'pass' : cityAnywhere ? 'warn' : 'fail',
    evidence: !cityN ? 'No city given' : cityHit ? `${city} appears in the homepage title, heading or opening text` : cityAnywhere ? `${city} appears on inner pages but not the homepage title, heading or opening` : `${city} isn't in any page title, heading or opening paragraph`,
    draft: cityN && !cityHit ? { title: `${city} doesn’t appear where Google looks first`, what: `The homepage title is ${q(home.title)} and the main heading is ${q(home.h1s[0] || 'missing')}. Neither${home.firstParagraph ? ', nor the opening paragraph,' : ''} mentions ${city}.`, why: `People search for "${d.businessType === 'other' ? 'your service' : d.businessType} in ${city}". The title and main heading are the strongest local signals on the page.`, fix: `Name ${city} in the homepage title and main heading.` } : undefined,
  });
  const footerAddr = pages.some((p) => p.addressInFooter);
  add({
    id: 'address_footer', area: 'Local', pillar: 'local', weight: 2,
    status: footerAddr ? 'pass' : addrPages.length ? 'warn' : 'fail',
    evidence: footerAddr ? 'Address in the footer' : addrPages.length ? `Address only on ${list(paths(addrPages))}` : 'No address anywhere',
    // With no address anywhere, "We couldn't find your address" (address_on_site)
    // is the one finding; this check still counts in the Local score.
    draft: !footerAddr && addrPages.length ? { title: 'Your address isn’t in the footer', what: `Your address appears on ${list(paths(addrPages))} but not in the site-wide footer.`, why: 'An address on every page is one of the clearest signals that you serve this area.', fix: 'Put your address (or service area) in the footer.' } : undefined,
  });
  const mapPages = pages.filter((p) => p.mapEmbed);
  add({
    id: 'map_embed', area: 'Local', pillar: 'local', weight: 1,
    status: mapPages.length ? 'pass' : 'warn',
    evidence: mapPages.length ? `Map on ${list(paths(mapPages))}` : 'No map embedded',
    draft: !mapPages.length ? { title: 'No map on the site', what: 'None of the pages we checked has an embedded map.', why: 'A map answers "how far is it?" instantly and helps first-time visitors find you.', fix: 'Embed a map on your contact or location page.' } : undefined,
  });
  // Name, address, phone consistency between pages and the schema.
  const pagePhones = new Set([...pages.flatMap((p) => p.telLinks), ...phoneText].map(digits).filter((x) => x.length === 10));
  const schemaPhone = digits(String(node2?.telephone || ''));
  const issues: string[] = [];
  if (pagePhones.size > 1) issues.push(`${pagePhones.size} different phone numbers appear across pages`);
  if (schemaPhone.length === 10 && pagePhones.size && !pagePhones.has(schemaPhone)) issues.push(`the phone in the structured data (${node2?.telephone}) doesn't match the one on the page`);
  const streetNum = (s: string) => (s.match(/^\s*(\d{1,6})\b/) || [])[1] || '';
  const pageStreets = new Set(addrPages.map((p) => streetNum(p.address || '')).filter(Boolean));
  if (sAddr.street && streetNum(sAddr.street) && pageStreets.size && !pageStreets.has(streetNum(sAddr.street))) issues.push(`the street address in the structured data (${sAddr.street}) differs from the page`);
  if (typeof node2?.name === 'string' && nameN && !norm(node2.name as string).includes(nameN) && !nameN.includes(norm(node2.name as string))) issues.push(`the name in the structured data (${node2.name}) differs from ${name}`);
  const canCompare = !!node2 || pagePhones.size > 1;
  add({
    id: 'nap_consistency', area: 'Local', pillar: 'local', weight: 3,
    status: !canCompare ? (pagePhones.size || addrPages.length ? 'warn' : 'fail') : issues.length ? (issues.length > 1 ? 'fail' : 'warn') : 'pass',
    evidence: !canCompare ? 'No structured data to compare the page details against' : issues.length ? issues.join('; ') : 'Name, address and phone match across pages and the structured data',
    // Only when details actually disagree. With no structured data to compare
    // against, the schema_present / schema_type finding already says so.
    draft: issues.length ? { title: 'Your name, address or phone don’t match everywhere', what: `${issues[0][0].toUpperCase() + issues[0].slice(1)}${issues.length > 1 ? `, and ${issues.length - 1} more mismatch${issues.length > 2 ? 'es' : ''}` : ''}.`, why: 'Google cross-checks these details. When they disagree, it trusts the listing less and may show the wrong one.', fix: 'Use exactly the same name, address and phone everywhere.' } : undefined,
  });

  // ── Performance (PageSpeed)
  if (d.psi.ok) {
    const s = d.psi.scores.performance;
    add({
      id: 'perf_score', area: 'Performance', pillar: 'performance', weight: 6,
      status: s == null ? 'na' : s >= 90 ? 'pass' : s >= 50 ? 'warn' : 'fail', score: s == null ? undefined : s / 100,
      evidence: s == null ? 'No performance score returned' : `Google's mobile performance score: ${s} out of 100`,
      draft: s != null && s < 90 ? { title: s < 50 ? 'Your site is slow on phones' : 'Your site could load faster on phones', what: `Google’s mobile speed test scored the homepage ${s} out of 100.`, why: `Every extra second costs visitors, and ${W} on a phone are the least patient of all.`, fix: 'Speed up the homepage, starting with the heaviest images and scripts.' } : undefined,
    });
    for (const v of d.psi.vitals) {
      const st: Status = v.status === 'good' ? 'pass' : v.status === 'needs_work' ? 'warn' : 'fail';
      const plain: Record<string, string> = { lcp: 'the moment the biggest thing on screen appears', cls: 'how much the page jumps around while loading', inp: 'how quickly the page reacts to a tap', tbt: 'how long the page is frozen while loading', fcp: 'when the first thing appears on screen' };
      add({
        id: `vital_${v.key}`, area: 'Core Web Vitals', pillar: 'performance', weight: 1, status: st,
        evidence: `${v.label}: ${v.display} (good is under ${vitalLimitDisplay(v.key)})`,
        draft: st !== 'pass' ? { title: v.key === 'lcp' ? `The main content takes ${v.display} to show on a phone` : v.key === 'cls' ? 'The page jumps around while it loads' : v.key === 'fcp' ? `The screen stays blank for ${v.display}` : 'The page is slow to react to taps', what: `Google measured a ${v.label} (${plain[v.key]}) of ${v.display} on mobile; good is under ${vitalLimitDisplay(v.key)}.`, why: v.key === 'cls' ? 'When buttons move as the page loads, people tap the wrong thing and get frustrated.' : 'Visitors notice the wait, and many leave a page that still looks empty after three seconds.', fix: v.key === 'lcp' || v.key === 'fcp' ? 'Make the first thing on the page load first and lighter.' : v.key === 'cls' ? 'Reserve space for images and banners so nothing shifts.' : 'Cut the scripts that keep the page busy while it loads.' } : undefined,
      });
    }
    if (d.psi.oversizedImages) {
      const o = d.psi.oversizedImages;
      add({
        id: 'oversized_images', area: 'Images', pillar: 'performance', weight: 0, status: 'warn',
        evidence: `${o.count} image${o.count > 1 ? 's' : ''} larger than needed${o.savingsKb ? ` (about ${o.savingsKb} KB to save)` : ''}`,
        draft: { title: `${o.count} image${o.count > 1 ? 's are' : ' is'} bigger than ${o.count > 1 ? 'they need' : 'it needs'} to be`, what: `Google flagged ${o.count} oversized image${o.count > 1 ? 's' : ''} on the homepage${o.savingsKb ? `, about ${o.savingsKb >= 1024 ? `${(o.savingsKb / 1024).toFixed(1)} MB` : `${o.savingsKb} KB`} more than needed` : ''}.`, why: 'Oversized photos are the most common reason small business sites load slowly on phones.', fix: 'Serve each photo at the size it is actually shown.' },
      });
    }
  }
  return checks;
}

// ── scoring ──────────────────────────────────────────────────────────────────

export function checkScore(c: Check): number | null {
  if (c.status === 'na') return null;
  return typeof c.score === 'number' ? c.score : STATUS_SCORE[c.status];
}

export function pillarScores(checks: Check[], psiOk: boolean): { key: Pillar; name: string; weight: number; score: number | null; note?: string }[] {
  return PILLARS.map((p) => {
    if (p.key === 'performance' && !psiOk) return { ...p, score: null, note: "Couldn't measure today" };
    let num = 0, den = 0;
    for (const c of checks) {
      if (c.pillar !== p.key || !c.weight) continue;
      const s = checkScore(c);
      if (s == null) continue;
      num += s * c.weight; den += c.weight;
    }
    return { ...p, score: den ? Math.round((num / den) * 100) : null, ...(den ? {} : { note: 'Not enough to measure' }) };
  });
}

/** Weighted sum of the pillars that could be measured, 0 to 100. A pillar with
 *  no score (Performance when PageSpeed failed) is left out and the others are
 *  re-weighted (spec: "left out of the overall score"). */
export function overallScore(pillars: { weight: number; score: number | null }[]): number | null {
  const live = pillars.filter((p) => p.score != null);
  const w = live.reduce((n, p) => n + p.weight, 0);
  return w ? Math.round(live.reduce((n, p) => n + (p.score as number) * p.weight, 0) / w) : null;
}

export type Priority = 'Fix now' | 'Important' | 'Later';
export function priorityOf(c: Check): Priority {
  // A graded check (Google's speed score) is prioritized by the score itself:
  // under 50 Fix now, 50 to 74 Important, 75 and up Later.
  if (typeof c.score === 'number') return c.score < 0.5 ? 'Fix now' : c.score < 0.75 ? 'Important' : 'Later';
  if (c.status === 'fail' && c.weight >= 2) return 'Fix now';
  if (c.status === 'fail' || c.weight >= 2) return 'Important';
  return 'Later';
}

/** Failing and warning checks, most important first: status, then the check's
 *  weight times its pillar's weight. */
export function rankIssues(checks: Check[]): Check[] {
  const pw = (k: Pillar) => PILLARS.find((p) => p.key === k)!.weight;
  const sev = (c: Check) => (c.status === 'fail' ? 2 : 1) * 1000 + (c.weight || 0.5) * pw(c.pillar);
  return checks.filter((c) => (c.status === 'fail' || c.status === 'warn') && c.draft).sort((a, b) => sev(b) - sev(a));
}
