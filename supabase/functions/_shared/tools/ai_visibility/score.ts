// ── AI Visibility Check: scores, competitors, sources and findings ───────────
// Every number in the report is an observed count ("appeared in 4 of 15
// answers"), never an invented rating (spec Tool 2). Scores:
//   Recommendation rate  share of unbranded answers naming the business,
//                        weighted by position (1st 1.0, 2nd-3rd 0.7, lower 0.4)
//   Awareness            branded answers: 0, 50 or 100 each
//   Accuracy             100 minus 25 per distinct accuracy flag
//   AI readiness         the website checks (only when a URL was given)
//   Overall              40 / 25 / 20 / 15, readiness's share spread across
//                        the others when there's no URL.

import type { Check } from '../site_review/checks.ts';
import { domainOf, FLAG_LABELS, nameTokens, sameBusiness, type Extraction, type FlagType } from './extract.ts';
import type { Readiness, ReadinessResult } from './readiness.ts';
import type { PromptKind } from './prompts.ts';

export interface AnswerRecord {
  engine: string; engineName: string; promptId: string; kind: PromptKind; question: string;
  ok: boolean; sources: { url: string; title: string }[]; extraction: Extraction | null;
}

export const AI_PILLARS = [
  { key: 'recommendation', name: 'Recommendation rate', weight: 40 },
  { key: 'awareness', name: 'Awareness', weight: 25 },
  { key: 'accuracy', name: 'Accuracy', weight: 20 },
  { key: 'readiness', name: 'AI readiness', weight: 15 },
] as const;
export const aiPillarName = (k: string) => AI_PILLARS.find((p) => p.key === k)?.name || k;

const DIRECTORIES = /(^|\.)(yelp\.com|tripadvisor\.[a-z.]+|google\.com|maps\.google\.com|goo\.gl|opentable\.com|resy\.com|yellowpages\.com|bbb\.org|angi\.com|homeadvisor\.com|thumbtack\.com|nextdoor\.com|facebook\.com|instagram\.com|groupon\.com|mapquest\.com|foursquare\.com|zocdoc\.com|vagaro\.com|styleseat\.com|classpass\.com|mindbodyonline\.com|eater\.com|timeout\.com|infatuation\.com|doordash\.com|ubereats\.com|grubhub\.com|houzz\.com|porch\.com|healthgrades\.com)$/;
export const isDirectory = (d: string) => DIRECTORIES.test(d);
const SOURCE_NAMES: Record<string, string> = { 'yelp.com': 'Yelp', 'google.com': 'Google', 'maps.google.com': 'Google Maps', 'tripadvisor.com': 'TripAdvisor', 'opentable.com': 'OpenTable', 'resy.com': 'Resy', 'facebook.com': 'Facebook', 'instagram.com': 'Instagram', 'nextdoor.com': 'Nextdoor', 'angi.com': 'Angi', 'thumbtack.com': 'Thumbtack', 'bbb.org': 'BBB', 'eater.com': 'Eater', 'timeout.com': 'Time Out', 'infatuation.com': 'The Infatuation', 'yellowpages.com': 'Yellow Pages', 'houzz.com': 'Houzz' };
export const sourceName = (d: string) => SOURCE_NAMES[d] || d;

export interface Competitor { name: string; mentions: number; engines: string[]; aboveYou: boolean; answers: number[] }

export function competitorsFrom(recs: AnswerRecord[], target: { name: string; city: string }): Competitor[] {
  const list: (Competitor & { key: string; aboveCount: number })[] = [];
  recs.forEach((r, ri) => {
    if (r.kind !== 'unbranded' || !r.extraction) return;
    const tpos = r.extraction.targetPosition;
    const seenHere = new Set<string>();
    r.extraction.businesses.forEach((b, i) => {
      if (sameBusiness(target, b)) return;
      let c = list.find((x) => sameBusiness({ name: x.name, city: '' }, { name: b.name, city: null }));
      if (!c) { c = { key: nameTokens(b.name).join(' '), name: b.name, mentions: 0, engines: [], aboveYou: false, answers: [], aboveCount: 0 }; list.push(c); }
      if (seenHere.has(c.key)) return;
      seenHere.add(c.key);
      c.mentions++;
      c.answers.push(ri);
      if (!c.engines.includes(r.engineName)) c.engines.push(r.engineName);
      if (tpos == null || i + 1 < tpos) c.aboveCount++;
    });
  });
  return list
    .map(({ key: _k, aboveCount, ...c }) => ({ ...c, aboveYou: aboveCount * 2 >= c.mentions }))
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name))
    .slice(0, 5);
}

export function sourcesFrom(recs: AnswerRecord[], ownDomain: string | null) {
  const counts = new Map<string, number>();
  for (const r of recs) {
    if (!r.ok) continue;
    for (const d of new Set(r.sources.map((s) => domainOf(s.url)).filter(Boolean))) counts.set(d, (counts.get(d) || 0) + 1);
  }
  return [...counts.entries()].map(([domain, count]) => ({ domain, count, own: !!ownDomain && (domain === ownDomain || domain.endsWith('.' + ownDomain)), directory: isDirectory(domain) }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

const posWeight = (p: number) => (p === 1 ? 1 : p <= 3 ? 0.7 : 0.4);

export function scoreAll(recs: AnswerRecord[], readiness: ReadinessResult) {
  const un = recs.filter((r) => r.kind === 'unbranded' && r.extraction);
  const br = recs.filter((r) => r.kind === 'branded' && r.extraction);
  const rec = un.length ? Math.round((un.reduce((n, r) => n + (r.extraction!.targetFound ? posWeight(r.extraction!.targetPosition || 9) : 0), 0) / un.length) * 100) : null;
  const aw = br.length ? Math.round(br.reduce((n, r) => { const e = r.extraction!; return n + (e.knows === 'no' ? 0 : e.knows === 'yes' && e.describedCorrectly ? 100 : 50); }, 0) / br.length) : null;
  const flagTypes = new Set(recs.flatMap((r) => (r.extraction?.flags || []).map((f) => f.type)));
  const acc = recs.some((r) => r.extraction) ? Math.max(0, 100 - 25 * flagTypes.size) : null;
  const ready = readiness.checked ? readiness.score : null;
  const pillars = AI_PILLARS.map((p) => {
    const score = p.key === 'recommendation' ? rec : p.key === 'awareness' ? aw : p.key === 'accuracy' ? acc : ready;
    const note = p.key === 'readiness' && !readiness.checked ? (readiness.reason === 'no_url' ? 'No website given' : "Couldn't read your website") : undefined;
    return { key: p.key, name: p.name, weight: p.weight, score, ...(note ? { note } : {}) };
  });
  const live = pillars.filter((p) => p.score != null);
  const w = live.reduce((n, p) => n + p.weight, 0);
  const overall = w ? Math.round(live.reduce((n, p) => n + (p.score as number) * p.weight, 0) / w) : null;
  return { pillars, overall, rec, aw, acc, ready, flagTypes: [...flagTypes] as FlagType[] };
}

export function perEngine(recs: AnswerRecord[]) {
  const ids = [...new Set(recs.map((r) => r.engine))];
  return ids.map((id) => {
    const mine = recs.filter((r) => r.engine === id);
    const un = mine.filter((r) => r.kind === 'unbranded' && r.extraction);
    return {
      engine: id, name: mine[0].engineName,
      recommended: un.filter((r) => r.extraction!.targetFound).length, asked: un.length,
      knew: mine.filter((r) => r.kind === 'branded' && r.extraction && r.extraction.knows !== 'no').length,
      brandedAsked: mine.filter((r) => r.kind === 'branded' && r.extraction).length,
      failed: mine.filter((r) => !r.ok || !r.extraction).length,
    };
  });
}

// ── findings ─────────────────────────────────────────────────────────────────

const q = (s: string) => `"${s}"`;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const andList = (xs: string[]) => xs.length <= 1 ? (xs[0] || '') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
const NOUN: Record<string, string> = { restaurant: 'a restaurant', salon: 'a salon', retail: 'a shop', 'home services': 'someone for the job', 'health and wellness': 'a studio', other: 'a business like yours' };

export function buildIssues(a: {
  recs: AnswerRecord[]; target: { name: string; city: string }; businessType: string; url: string | null;
  readiness: ReadinessResult; competitors: Competitor[]; sources: ReturnType<typeof sourcesFrom>; engines: ReturnType<typeof perEngine>;
}): { issues: Check[]; strengths: string[] } {
  const issues: Check[] = [];
  const strengths: string[] = [];
  const name = a.target.name, city = a.target.city;
  const un = a.recs.filter((r) => r.kind === 'unbranded' && r.extraction);
  const br = a.recs.filter((r) => r.kind === 'branded' && r.extraction);
  const found = un.filter((r) => r.extraction!.targetFound);
  const knew = br.filter((r) => r.extraction!.knows !== 'no');
  const engineLine = andList(a.engines.map((e) => `${e.name} ${e.recommended} of ${e.asked}`));
  const add = (c: Omit<Check, 'pillar'> & { pillar: string }) => issues.push(c as unknown as Check);
  const top = a.competitors[0];

  if (un.length && !found.length && br.length && !knew.length) {
    add({ id: 'ai_unknown', area: 'Recommendations', pillar: 'recommendation', weight: 3, status: 'fail',
      evidence: `Named in 0 of ${un.length} local answers; known in 0 of ${br.length} answers that asked about ${name} by name`,
      draft: { title: "AI doesn't know you exist yet", what: `In ${plural(un.length, 'answer')} to local questions like ${q(un[0].question)}, ${name} was never named, and when we asked about ${name} by name, the AI didn't recognize the business in ${br.length === 1 ? 'that answer' : `either of ${br.length} answers`}.`, why: `More people now ask an AI assistant for ${NOUN[a.businessType] || NOUN.other} in ${city}. If it has never heard of you, it sends them to someone else.`, fix: 'Give AI something to find: complete, matching listings on the big directories and a website that plainly says what you do and where.' } });
  } else if (un.length && !found.length) {
    add({ id: 'not_recommended', area: 'Recommendations', pillar: 'recommendation', weight: 3, status: 'fail',
      evidence: `Named in 0 of ${un.length} local answers (${engineLine}); known by name in ${knew.length} of ${br.length}`,
      draft: { title: 'AI knows you, but never recommends you', what: `When we asked about ${name} by name, the AI knew the business in ${knew.length} of ${br.length} answers, but in ${plural(un.length, 'answer')} to local questions it named other businesses every time.`, why: `People asking for ${NOUN[a.businessType] || NOUN.other} in ${city} only hear the names on that list.`, fix: 'Strengthen the signals AI uses to pick recommendations: reviews and complete listings on the sources it cites.' } });
  } else if (un.length && found.length / un.length < 0.6) {
    add({ id: 'low_recommendation', area: 'Recommendations', pillar: 'recommendation', weight: 2, status: 'warn',
      evidence: `Named in ${found.length} of ${un.length} local answers (${engineLine})`,
      draft: { title: `AI recommends you in ${found.length} of ${un.length} local searches`, what: `${name} came up in ${found.length} of ${un.length} answers to local questions (${engineLine}).`, why: 'Every answer that leaves you out sends that person to the businesses it did name.', fix: 'Close the gap on the sources the AI cited most, starting with the ones that named your competitors.' } });
  } else if (found.length) {
    strengths.push(`Named in ${found.length} of ${un.length} local answers (${engineLine})`);
  }

  const multi = a.engines.filter((e) => e.asked > 0);
  if (multi.length > 1) {
    const yes = multi.filter((e) => e.recommended > 0);
    if (yes.length === 1) add({ id: 'one_engine_only', area: 'Recommendations', pillar: 'recommendation', weight: 2, status: 'warn',
      evidence: `Only ${yes[0].name} named you (${engineLine})`,
      draft: { title: `Only ${yes[0].name} recommends you`, what: `${yes[0].name} named ${name} in ${yes[0].recommended} of ${yes[0].asked} answers; ${andList(multi.filter((e) => e !== yes[0]).map((e) => `${e.name} 0 of ${e.asked}`))}.`, why: 'Different people use different assistants. Showing up in one is not showing up.', fix: 'Fix the sources the other assistants rely on so they find you too.' } });
  }

  if (top && top.mentions >= 2 && (!found.length || top.aboveYou)) {
    const compSources = sourcesFrom(top.answers.map((i) => a.recs[i]), null).filter((s) => s.directory).slice(0, 2).map((s) => sourceName(s.domain));
    add({ id: 'competitor_wins', area: 'Competitors', pillar: 'recommendation', weight: 2, status: 'warn',
      evidence: `${top.name} named in ${top.mentions} of ${un.length} local answers${compSources.length ? `; those answers cited ${andList(compSources)}` : ''}`,
      draft: { title: `AI recommends ${top.name} instead`, what: `${top.name} came up in ${top.mentions} of ${un.length} local answers${top.aboveYou ? ', ahead of you' : ''}${compSources.length ? `, in answers that cited ${andList(compSources)}` : ''}.`, why: `That is who people asking for ${NOUN[a.businessType] || NOUN.other} in ${city} are being sent to.`, fix: compSources.length ? `Match ${top.name} where the AI looks: get your ${andList(compSources)} presence complete and reviewed.` : `Match ${top.name} on the sources the AI cites for ${city}.` } });
  }

  // Wrong facts, and where they came from.
  const flagged = a.recs.filter((r) => r.extraction && r.extraction.flags.length);
  if (flagged.length) {
    const flags = flagged.flatMap((r) => r.extraction!.flags.map((f) => ({ ...f, engine: r.engineName })));
    const types = [...new Set(flags.map((f) => f.type))];
    const from = sourcesFrom(flagged, null).filter((s) => !s.own).slice(0, 2).map((s) => sourceName(s.domain));
    const severe = types.some((t) => t === 'marked_closed' || t === 'wrong_address');
    add({ id: 'wrong_facts', area: 'Accuracy', pillar: 'accuracy', weight: severe ? 3 : 2, status: severe ? 'fail' : 'warn',
      evidence: `${types.map((t) => FLAG_LABELS[t]).join('; ')}: ${flags[0].detail}${from.length ? `; those answers cited ${andList(from)}` : ''}`,
      draft: { title: types.includes('marked_closed') ? 'AI thinks you might be closed' : 'AI has some of your facts wrong', what: `${flags[0].detail}${flags.length > 1 ? ` (${plural(flags.length, 'error')} in total: ${andList(types.map((t) => FLAG_LABELS[t].toLowerCase()))})` : ''}${from.length ? `. Those answers drew on ${andList(from)}.` : '.'}`, why: 'A customer who drives to the wrong address or arrives after the hours AI gave them rarely tries again.', fix: from.length ? `Correct your details on ${andList(from)} so AI repeats the right ones.` : 'Correct your details on the listings AI reads so it repeats the right ones.' } });
  } else if (a.recs.some((r) => r.extraction && r.extraction.targetFound)) {
    strengths.push('No wrong facts about the business in any answer');
  }

  // Sources.
  if (a.url && a.readiness.checked) {
    const own = a.sources.find((s) => s.own);
    if (!own && a.sources.length) add({ id: 'own_site_not_cited', area: 'Sources', pillar: 'readiness', weight: 2, status: 'warn',
      evidence: `Your website was cited in 0 answers; ${a.sources.length} other sources were cited`,
      draft: { title: 'AI never cites your own website', what: `Across every answer, the AI cited ${plural(a.sources.length, 'source')}, led by ${andList(a.sources.slice(0, 2).map((s) => sourceName(s.domain)))}, but never your website.`, why: 'When AI only reads about you elsewhere, it repeats whatever those sites say, right or wrong.', fix: 'Give your site pages AI can quote: what you do, where, hours and what makes you different, in plain text.' } });
    else if (own) strengths.push(`Your website was cited in ${plural(own.count, 'answer')}`);
  }
  const lead = a.sources.find((s) => s.directory);
  if (lead && lead.count >= 3) add({ id: 'directory_leads', area: 'Sources', pillar: 'recommendation', weight: 1, status: 'warn',
    evidence: `${sourceName(lead.domain)} cited in ${lead.count} answers`,
    draft: { title: `AI leans on ${sourceName(lead.domain)} for ${city}`, what: `${sourceName(lead.domain)} was cited in ${lead.count} answers, more than any other directory.`, why: 'What that listing says, and how many reviews it has, shapes who AI recommends.', fix: `Make sure your ${sourceName(lead.domain)} listing is complete, current and has recent reviews.` } });

  // Website readiness.
  if (a.readiness.checked) {
    const map: Record<string, { pillar: string; weight: number; title: (c: { detail: string; status: string }) => string; why: string; fix: string }> = {
      ai_crawlers: { pillar: 'readiness', weight: 3, title: (c) => c.status === 'fail' ? 'Your website blocks the AI crawlers' : 'Your website blocks some AI crawlers', why: 'An assistant that is told not to read your site can only repeat what others say about you.', fix: 'Allow the AI crawlers in robots.txt.' },
      schema_nap: { pillar: 'readiness', weight: 2, title: () => 'Your site has no machine-readable business details', why: 'Structured data (hidden labels for your name, address and phone) is the easiest way for AI to get your details right.', fix: 'Add structured data with the same name, address and phone as your listings.' },
      about_services: { pillar: 'readiness', weight: 2, title: () => 'AI has little to quote about what you do', why: 'AI answers are built from plain sentences; a page that says what you offer and where is what it quotes.', fix: 'Add an about page and a services page that say what you do and where, in plain words.' },
      identity: { pillar: 'readiness', weight: 1, title: () => 'Your homepage doesn’t say who, what and where up top', why: 'The title and main heading are the first lines AI reads to decide what a site is about.', fix: 'Put your name, what you do and your city in the homepage title and main heading.' },
    };
    for (const c of (a.readiness as Readiness).checks) {
      if (c.status === 'pass') { strengths.push(c.detail); continue; }
      const m = map[c.id];
      add({ id: `ready_${c.id}`, area: 'AI readiness', pillar: m.pillar, weight: m.weight, status: c.status, evidence: c.detail, draft: { title: m.title(c), what: `${c.detail}.`, why: m.why, fix: m.fix } });
    }
  }

  // Most important first: fails, then weight.
  issues.sort((x, y) => (y.status === 'fail' ? 1 : 0) - (x.status === 'fail' ? 1 : 0) || y.weight - x.weight);
  return { issues, strengths };
}

// ── tables for the full report ───────────────────────────────────────────────

export function buildTables(a: { recs: AnswerRecord[]; target: { name: string }; competitors: Competitor[]; sources: ReturnType<typeof sourcesFrom>; engines: ReturnType<typeof perEngine>; readiness: ReadinessResult }) {
  const tables: { title: string; note?: string; columns: string[]; rows: (string | number)[][] }[] = [];
  tables.push({
    title: 'Answers by AI', note: 'How often each assistant named you when asked for a local recommendation, and whether it knew you when asked by name.',
    columns: ['AI', 'Recommended you', 'Knew you by name', 'Not checked'],
    rows: a.engines.map((e) => [e.name, `${e.recommended} of ${e.asked}`, `${e.knew} of ${e.brandedAsked}`, e.failed ? `${e.failed} answer${e.failed > 1 ? 's' : ''}` : '–']),
  });
  tables.push({
    title: 'Who AI recommends instead', note: 'The businesses named most often in answers to local questions.',
    columns: ['Business', 'Times named', 'Named by', 'Ranked above you'],
    rows: a.competitors.map((c) => [c.name, c.mentions, c.engines.join(', '), c.aboveYou ? 'Yes' : 'No']),
  });
  tables.push({
    title: 'Sources AI cited', note: 'Where the answers got their information. The count is how many answers cited each one.',
    columns: ['Source', 'Answers citing it', 'Note'],
    rows: a.sources.slice(0, 10).map((s) => [sourceName(s.domain), s.count, s.own ? 'Your website' : s.directory ? 'Directory or review site' : '']),
  });
  const flags = a.recs.flatMap((r) => (r.extraction?.flags || []).map((f) => [FLAG_LABELS[f.type], r.engineName, f.detail]));
  if (flags.length) tables.push({ title: 'Wrong facts in AI answers', columns: ['Problem', 'AI', 'What it said'], rows: flags });
  if (a.readiness.checked) tables.push({ title: 'AI readiness of your website', columns: ['Check', 'Status', 'Detail'], rows: a.readiness.checks.map((c) => [c.label, c.status === 'pass' ? 'Good' : c.status === 'warn' ? 'Needs work' : 'Missing', c.detail]) });
  tables.push({
    title: 'The questions we asked', note: 'Each was asked exactly as written, with the assistant’s own web search on.',
    columns: ['Question', 'AI', 'Result'],
    rows: a.recs.map((r) => [r.question, r.engineName, !r.ok || !r.extraction ? 'Could not check' : r.kind === 'branded' ? (r.extraction.knows === 'yes' ? 'Knew you' : r.extraction.knows === 'vague' ? 'Vaguely knew you' : "Didn't know you") : r.extraction.targetFound ? `Named you (#${r.extraction.targetPosition})` : 'Did not name you']),
  });
  return tables;
}
