// ── The Growth Coach's rules (M9.5E) — observe, plan, prepare; never execute ─
// The Coach helps the customer think ahead. It does not write (the Writer
// does), edit (the Editor does), critique (the Reviewer does), or protect
// voice (the Guardian does). It produces OPPORTUNITIES: specific, grounded,
// timed, explainable — and every one hands off to the existing Writer/Editor
// workflow through the customer, or stays entirely manual.
//
// THE VALUE FILTER is structural: every generator below requires concrete
// grounding (a calendar event the pack says matters here, an evidence
// observation, or the customer's own content) before it may produce anything.
// No grounding, no suggestion. Generic marketing advice cannot be emitted
// because no generator exists that emits ungrounded text.
import type { FactSheet } from '../writer/facts.ts';
import type { GrowthPack } from './packs.ts';
import type { CalendarEvent } from './calendar.ts';
import { timingPhrase } from './calendar.ts';

export type CoachArea =
  | 'seasonal' | 'holiday' | 'industry_event' | 'content_freshness' | 'promotion' | 'landing_page'
  | 'faq_opportunity' | 'gbp_post' | 'email_campaign' | 'social_campaign' | 'homepage_refresh'
  | 'service_launch' | 'trust_building' | 'review_request' | 'customer_education' | 'referral_campaign';
export const COACH_AREAS: CoachArea[] = [
  'seasonal', 'holiday', 'industry_event', 'content_freshness', 'promotion', 'landing_page',
  'faq_opportunity', 'gbp_post', 'email_campaign', 'social_campaign', 'homepage_refresh',
  'service_launch', 'trust_building', 'review_request', 'customer_education', 'referral_campaign'];

export interface EvidenceLite { type: string; human: string; resource: string }

export interface Opportunity {
  opp_key: string;
  opp_hash: string;
  area: CoachArea;
  opportunity: string;
  why_it_matters: string;
  supporting_evidence: Array<{ source: string; detail: string }>;
  expected_benefit: string;
  estimated_effort: string;
  timing_starts: string | null;
  timing_ends: string | null;
  timing_phrase: string;
  suggested_next_step: string;
  manual_possible: true;
  approval_required: true;
  ai_can_draft: boolean;
  handoff: { route: 'writer' | 'editor' | 'manual'; kind?: string; action?: string; target_id?: string; brief?: string };
}

/* handoff derivation — fixed table per area; neither model nor data chooses.
   Writer/editor kinds are EXACTLY the existing contract kinds (M9.5A/B). */
const AREA_HANDOFF: Record<CoachArea, { route: 'writer' | 'editor' | 'manual'; kind?: string; action?: string }> = {
  holiday: { route: 'writer', kind: 'post' },
  seasonal: { route: 'writer', kind: 'post' },
  industry_event: { route: 'writer', kind: 'post' },
  promotion: { route: 'writer', kind: 'post' },
  content_freshness: { route: 'writer', kind: 'post' },
  service_launch: { route: 'writer', kind: 'post' },
  customer_education: { route: 'writer', kind: 'post' },
  landing_page: { route: 'writer', kind: 'post' },
  gbp_post: { route: 'writer', kind: 'post' },
  faq_opportunity: { route: 'writer', kind: 'faqs' },
  homepage_refresh: { route: 'editor', kind: 'edit_identity', action: 'rewrite' },
  review_request: { route: 'manual' },          // asking customers is a human act
  trust_building: { route: 'manual' },          // policies/contact facts are verified, not drafted
  email_campaign: { route: 'manual' },          // the Coach never sends email
  social_campaign: { route: 'manual' },         // the Coach never posts to social
  referral_campaign: { route: 'manual' },
};
export function deriveCoachHandoff(area: CoachArea, brief?: string): { handoff: Opportunity['handoff']; ai_can_draft: boolean } {
  const h = AREA_HANDOFF[area];
  return { handoff: { route: h.route, kind: h.kind, action: h.action, brief }, ai_can_draft: h.route !== 'manual' };
}

/* stable hashes: opp_key names the opportunity; opp_hash names its grounding
   STATE (evidence types + occurrence, never day counts) — so a dismissal
   holds until the evidence actually changes, not until tomorrow. */
export const cHash = (s: string): string => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
};

const EFFORT: Record<CoachArea, string> = {
  holiday: 'about an hour', seasonal: 'about an hour', industry_event: 'about an hour',
  promotion: 'about an hour', content_freshness: 'about an hour', gbp_post: 'about half an hour',
  landing_page: 'an afternoon', faq_opportunity: 'about an hour', homepage_refresh: 'about an hour',
  service_launch: 'an afternoon', customer_education: 'about an hour',
  trust_building: 'about an hour', review_request: 'a few minutes per customer',
  email_campaign: 'an afternoon', social_campaign: 'about an hour', referral_campaign: 'an afternoon',
};

function opp(area: CoachArea, keySuffix: string, hashInput: string, text: {
  opportunity: string; why: string; benefit: string; next: string; brief?: string;
  evidence: Array<{ source: string; detail: string }>;
  starts?: string | null; ends?: string | null; phrase?: string;
}): Opportunity {
  const d = deriveCoachHandoff(area, text.brief);
  return {
    opp_key: `${area}:${keySuffix}`, opp_hash: cHash(`${area}:${keySuffix}|${hashInput}`),
    area, opportunity: text.opportunity, why_it_matters: text.why,
    supporting_evidence: text.evidence.slice(0, 4),
    expected_benefit: text.benefit, estimated_effort: EFFORT[area],
    timing_starts: text.starts ?? null, timing_ends: text.ends ?? null, timing_phrase: text.phrase ?? '',
    suggested_next_step: text.next,
    manual_possible: true, approval_required: true,
    ai_can_draft: d.ai_can_draft, handoff: d.handoff,
  };
}

/* ── the explicit Coach ↔ Moments relationship (M9.5G) ──
   Moments are REACTIVE (the site needs attention now); the Coach is PROACTIVE
   (worth planning for). When both would speak about the same underlying
   evidence, MOMENTS SPEAK AND THE COACH YIELDS: an evidence-gap area is
   suppressed while a moment covering the same concern is active, or was
   dismissed within the moments dismissal memory (30 days) — the customer
   never hears the same thing twice from two mouths. review_request has no
   moment twin (no reviews-driven moment rule exists) and never yields.
   Calendar/industry areas are the Coach's own and never yield. */
export const COACH_YIELDS_TO: Partial<Record<CoachArea, string[]>> = {
  content_freshness: ['freshness', 'improvements_bundle'],
  faq_opportunity: ['more_answers', 'improvements_bundle'],
  homepage_refresh: ['more_answers', 'improvements_bundle'],
  trust_building: ['missing_basics'],
};
export interface MomentLite { moment_key: string; status: string; dismissed_at: string | null }
export function momentSuppressedAreas(moments: MomentLite[], nowIso: string, ttlDays = 30): Set<CoachArea> {
  const speaking = new Set<string>();
  for (const m of moments) {
    if (m.status === 'active') speaking.add(m.moment_key);
    if (m.status === 'dismissed' && m.dismissed_at &&
        (new Date(nowIso).getTime() - new Date(m.dismissed_at).getTime()) / 86400000 < ttlDays) {
      speaking.add(m.moment_key);
    }
  }
  const out = new Set<CoachArea>();
  for (const [area, keys] of Object.entries(COACH_YIELDS_TO)) {
    if ((keys as string[]).some((k) => speaking.has(k))) out.add(area as CoachArea);
  }
  return out;
}

export interface CoachInput {
  facts: FactSheet;
  pack: GrowthPack;
  events: CalendarEvent[];         // from upcomingEvents(now, firstPublishedAt)
  evidence: EvidenceLite[];        // latest finished evidence run (read-only)
  nowIso: string;
  suppressed?: Set<CoachArea>;     // areas yielding to Business Moments this run
}

const ev = (evidence: EvidenceLite[], type: string) => evidence.find((e) => e.type === type);
const holidayBase = (key: string) => key.replace(/-\d{4}$/, '');

export function coachOpportunities(input: CoachInput): Opportunity[] {
  const { facts, pack, events, evidence } = input;
  const out: Opportunity[] = [];
  const biz = facts.business_name || 'the business';
  const visibleOfferings = facts.offerings.filter((o) => o.visible);
  const hiddenOfferings = facts.offerings.filter((o) => !o.visible && o.name && o.description);
  const publishedPosts = facts.posts_full.filter((p) => p.shown);

  // ── holiday: only holidays THIS pack says matter, only inside their window ──
  const packHolidays = events.filter((e) => e.kind === 'holiday' && pack.holidays[holidayBase(e.key)]);
  for (const h of packHolidays.slice(0, 2)) {
    const angle = pack.holidays[holidayBase(h.key)];
    out.push(opp('holiday', h.key, h.key, {
      opportunity: `Get ${biz} ready for ${h.name} (${h.date}).`,
      why: angle,
      benefit: 'customers find your plans before they make theirs',
      next: `Tell people how ${h.name} works at ${biz} — hours, anything special, how to ${facts.booking_url ? 'book' : facts.ordering_url ? 'order' : 'reach you'}.`,
      brief: `A short website update about ${h.name} at ${biz}. ${angle}`,
      evidence: [{ source: 'calendar', detail: `${h.name} falls on ${h.date} — ${h.days_away} days away.` },
                 { source: 'industry', detail: angle }],
      starts: input.nowIso.slice(0, 10), ends: h.date, phrase: timingPhrase(h.days_away, h.name),
    }));
  }

  // ── promotion: the nearest pack holiday + a REAL menu item to hang it on ──
  if (packHolidays.length && visibleOfferings.length) {
    const h = packHolidays[0];
    const item = visibleOfferings[0];
    out.push(opp('promotion', h.key, `${h.key}|${item.id}`, {
      opportunity: `A ${h.name} special built around “${item.name}”.`,
      why: `${pack.holidays[holidayBase(h.key)]} A named special gives people a reason to choose you that day.`,
      benefit: 'a concrete reason to visit on a high-traffic day',
      next: `Decide the special, then announce it as an update.`,
      brief: `Announce a ${h.name} special at ${biz} featuring “${item.name}”. Only facts from the sheet; the owner will fill in the offer details.`,
      evidence: [{ source: 'calendar', detail: `${h.name} is ${h.days_away} days away.` },
                 { source: 'your menu', detail: `“${item.name}” is on your ${pack.slug === 'restaurant' ? 'menu' : 'list'} today.` }],
      starts: input.nowIso.slice(0, 10), ends: h.date, phrase: timingPhrase(h.days_away, h.name),
    }));
  }

  // ── seasonal: the season is turning AND the pack has a real angle for it ──
  const season = events.find((e) => e.kind === 'season' && pack.seasons[e.key.split('-')[1]]);
  if (season) {
    const sKey = season.key.split('-')[1];
    out.push(opp('seasonal', season.key, season.key, {
      opportunity: `${season.name} starts ${season.date} — ${pack.seasons[sKey].split(' — ')[0].toLowerCase()}.`,
      why: pack.seasons[sKey],
      benefit: 'your site reflects the season your customers are living in',
      next: 'A short update about what the new season changes at your business.',
      brief: `A website update for the start of ${season.name.toLowerCase()} at ${biz}. ${pack.seasons[sKey]}`,
      evidence: [{ source: 'calendar', detail: `${season.name} begins ${season.date}.` },
                 { source: 'industry', detail: pack.seasons[sKey] }],
      starts: input.nowIso.slice(0, 10), ends: season.date, phrase: timingPhrase(season.days_away, season.name),
    }));
  }

  // ── industry_event: pack-defined recurring moments ──
  for (const e of events.filter((x) => x.kind === 'anniversary')) {
    out.push(opp('industry_event', e.key, e.key, {
      opportunity: `${biz} turns ${e.name.replace(' online', '')} online on ${e.date}.`,
      why: 'Anniversaries are one of the few marketing moments that are entirely, verifiably yours.',
      benefit: 'a story only you can tell, told on time',
      next: 'A short thank-you update to the customers who got you here.',
      brief: `A warm anniversary update: ${biz} has been online ${e.name}. Thank the neighborhood; no invented history.`,
      evidence: [{ source: 'your history', detail: `The website first went live on this date — ${e.name} ago.` }],
      starts: input.nowIso.slice(0, 10), ends: e.date, phrase: timingPhrase(e.days_away, 'the anniversary'),
    }));
  }

  // ── content_freshness: ONLY when the Evidence Engine observed staleness ──
  const stale = ev(evidence, 'freshness.updates_quiet') || ev(evidence, 'freshness.publish_stale');
  if (stale) {
    out.push(opp('content_freshness', stale.type, stale.type, {
      opportunity: 'The website has gone quiet — a small update would wake it up.',
      why: 'A site that never changes tells customers nothing is happening. Something is always happening.',
      benefit: 'returning visitors see a business in motion',
      next: 'One short update — what’s new, what’s good right now, what’s coming.',
      brief: `A short "what's new" update for ${biz}, grounded only in the fact sheet.`,
      evidence: [{ source: 'evidence', detail: stale.human }],
      phrase: 'any time this week',
    }));
  }

  // ── faq_opportunity: the evidence (or the site itself) shows thin answers ──
  const visibleFaqs = facts.faqs_full.filter((f) => f.visible);
  const faqEv = ev(evidence, 'content.faqs_none');
  if (faqEv || (evidence.length && visibleFaqs.length > 0 && visibleFaqs.length < 3)) {
    out.push(opp('faq_opportunity', 'faqs_thin', `n=${visibleFaqs.length}`, {
      opportunity: visibleFaqs.length ? `Only ${visibleFaqs.length} question${visibleFaqs.length > 1 ? 's are' : ' is'} answered on the site — customers ask more than that.` : 'The site doesn’t answer common questions yet.',
      why: 'Every answered question is a phone call you don’t have to take and a customer who doesn’t bounce.',
      benefit: 'fewer repetitive calls; more confident visitors',
      next: 'Add the questions people actually ask you across the counter.',
      brief: `Propose FAQs for ${biz} based on the fact sheet — placeholders for anything unknown.`,
      evidence: [faqEv ? { source: 'evidence', detail: faqEv.human } : { source: 'your site', detail: `${visibleFaqs.length} FAQ${visibleFaqs.length === 1 ? '' : 's'} currently visible.` }],
      phrase: 'whenever you have an hour',
    }));
  }

  // ── review_request: evidence shows testimonials missing or old ──
  const revEv = ev(evidence, 'reviews.testimonials_none') || ev(evidence, 'reviews.testimonials_stale');
  if (revEv) {
    out.push(opp('review_request', revEv.type, revEv.type, {
      opportunity: 'Ask a few recent customers for a kind word.',
      why: `New visitors look for proof that people like them chose you and were glad. The best time to ask is ${pack.reviewMoment}.`,
      benefit: 'fresh social proof where new customers look for it',
      next: `Pick two or three recent happy customers and ask ${pack.reviewMoment} — then add their words to the site yourself.`,
      evidence: [{ source: 'evidence', detail: revEv.human }],
      phrase: 'ongoing — a little at a time',
    }));
  }

  // ── trust_building: evidence-observed trust gaps stay human-verified ──
  const trustEv = ev(evidence, 'trust.contact_missing') || ev(evidence, 'trust.hours_not_public') || ev(evidence, 'trust.policy_page_missing');
  if (trustEv) {
    out.push(opp('trust_building', trustEv.type, trustEv.type, {
      opportunity: 'Close a small trust gap the site is showing.',
      why: 'Customers check the basics before they call. When one is missing, some quietly leave.',
      benefit: 'fewer silent bounces from almost-customers',
      next: trustEv.human,
      evidence: [{ source: 'evidence', detail: trustEv.human }],
      phrase: 'any time — small and quick',
    }));
  }

  // ── homepage_refresh: the evidence says the description is thin ──
  const thinEv = ev(evidence, 'content.description_thin');
  if (thinEv) {
    out.push(opp('homepage_refresh', thinEv.type, thinEv.type, {
      opportunity: 'The homepage description is thinner than the business deserves.',
      why: 'It’s the first paragraph most visitors read; right now it isn’t carrying its weight.',
      benefit: 'a first impression that matches the real thing',
      next: 'Have the editor propose a fuller version — you approve every word.',
      brief: 'Rewrite the business description more fully, from the fact sheet only.',
      evidence: [{ source: 'evidence', detail: thinEv.human }],
      phrase: 'whenever you have an hour',
    }));
  }

  // ── gbp_post: profile connected + a holiday coming → post idea (WE never post) ──
  const gbpDisconnected = ev(evidence, 'local_presence.profile_unconnected');
  if (evidence.length && !gbpDisconnected && packHolidays.length) {
    const h = packHolidays[0];
    out.push(opp('gbp_post', h.key, h.key, {
      opportunity: `A Google Business Profile post about ${h.name}.`,
      why: 'Profile posts show up right where people are already searching for you — hours questions spike before holidays.',
      benefit: 'searchers see your holiday plans without clicking anywhere',
      next: 'Draft it here, then copy it to your Google Business Profile yourself — nothing posts automatically.',
      brief: `A short post about ${h.name} at ${biz}, suitable for a Google Business Profile.`,
      evidence: [{ source: 'calendar', detail: `${h.name} is ${h.days_away} days away.` }],
      starts: input.nowIso.slice(0, 10), ends: h.date, phrase: timingPhrase(h.days_away, h.name),
    }));
  }

  // ── service_launch: drafted-but-hidden offerings are a launch waiting to happen ──
  if (hiddenOfferings.length) {
    const o = hiddenOfferings[0];
    out.push(opp('service_launch', o.id, `${o.id}|${hiddenOfferings.length}`, {
      opportunity: `“${o.name}” is written but not shown — plan its launch.`,
      why: 'Work that customers can’t see does nothing. A small launch beats a quiet toggle.',
      benefit: 'a new reason for customers to come back',
      next: `Announce “${o.name}” as an update, then make it visible in the same sitting.`,
      brief: `Announce that “${o.name}” is now available at ${biz}. Facts from the sheet only.`,
      evidence: [{ source: 'your site', detail: `“${o.name}” exists with a description but is currently hidden.` }],
      phrase: 'whenever it’s ready',
    }));
  }

  // ── customer_education: the customer's own story grounds an explainer ──
  if (facts.story && facts.story.split(/\s+/).length >= 40 && publishedPosts.length < 5) {
    out.push(opp('customer_education', 'story_explainer', cHash(facts.story.slice(0, 200)), {
      opportunity: `Turn part of your story into ${pack.educationAngle}.`,
      why: 'You already wrote the raw material — customers trust businesses that show their work.',
      benefit: 'customers understand why you cost what you cost',
      next: 'An update that teaches one thing your regulars already know.',
      brief: `An educational update for ${biz}: ${pack.educationAngle}. Ground it in the story on the fact sheet; invent nothing.`,
      evidence: [{ source: 'your site', detail: `Your story: “${facts.story.slice(0, 120)}…”` }],
      phrase: 'no deadline — evergreen',
    }));
  }

  // ── email/social: only when there is a REAL recent update to reuse ──
  if (publishedPosts.length) {
    const p = publishedPosts[0];
    out.push(opp('email_campaign', p.id, p.id, {
      opportunity: `Send “${p.title}” to your regulars by email.`,
      why: 'The update already exists; the people who love you just haven’t seen it.',
      benefit: 'your best customers hear news from you, not from the feed',
      next: `Copy the update into whatever you use for email — nothing sends from here.`,
      evidence: [{ source: 'your site', detail: `“${p.title}” is published and current.` }],
      phrase: 'while the update is fresh',
    }));
    out.push(opp('social_campaign', p.id, p.id, {
      opportunity: `Share “${p.title}” where your customers scroll.`,
      why: 'One good update can honestly fill a week of posts.',
      benefit: 'the same work reaches people who never visit websites',
      next: 'Post a line or two from the update with a photo — nothing posts automatically from here.',
      evidence: [{ source: 'your site', detail: `“${p.title}” is published and current.` }],
      phrase: 'while the update is fresh',
    }));
  }

  // ── referral_campaign: real testimonials prove referral energy exists ──
  if (facts.testimonial_count > 0 && publishedPosts.length > 0) {
    out.push(opp('referral_campaign', 'referrals', `t=${facts.testimonial_count}`, {
      opportunity: 'The customers who wrote kind words would refer you if asked.',
      why: 'People who took time to praise you publicly are your warmest source of new business.',
      benefit: 'new customers who arrive already trusting you',
      next: 'Decide what a thank-you for a referral looks like, then mention it to your regulars personally.',
      evidence: [{ source: 'your site', detail: `${facts.testimonial_count} customer${facts.testimonial_count > 1 ? 's have' : ' has'} written testimonials.` }],
      phrase: 'ongoing — start small',
    }));
  }

  // ── landing_page: a booking/ordering door + a seasonal reason to build a room for it ──
  if ((facts.booking_url || facts.ordering_url) && season) {
    const sKey = season.key.split('-')[1];
    out.push(opp('landing_page', season.key, `${season.key}|door`, {
      opportunity: `A focused ${season.name.toLowerCase()} page that ends at your ${facts.booking_url ? 'booking' : 'ordering'} link.`,
      why: `${pack.seasons[sKey]} A page with one job converts better than a homepage with ten.`,
      benefit: 'seasonal visitors land somewhere built for exactly them',
      next: 'Start it as an update; it can grow into a page when it earns it.',
      brief: `A seasonal update for ${biz} about ${season.name.toLowerCase()}, ending with the ${facts.booking_url ? 'booking' : 'ordering'} link.`,
      evidence: [{ source: 'calendar', detail: `${season.name} begins ${season.date}.` },
                 { source: 'your site', detail: `You have a ${facts.booking_url ? 'booking' : 'ordering'} link customers can land on.` }],
      starts: input.nowIso.slice(0, 10), ends: season.date, phrase: timingPhrase(season.days_away, season.name),
    }));
  }

  // yield to Business Moments: areas a moment already covers stay silent here
  const yielded = input.suppressed ?? new Set<CoachArea>();
  const kept = out.filter((o) => !yielded.has(o.area));

  // timed items first (they expire); untimed by priority — what the site is
  // SHOWING (evidence-backed gaps) outranks nice-to-have ideas; bounded
  const PRIORITY: Record<CoachArea, number> = {
    holiday: 0, seasonal: 0, industry_event: 0, promotion: 0, gbp_post: 1, landing_page: 1,
    content_freshness: 2, review_request: 2, trust_building: 2, homepage_refresh: 2,
    faq_opportunity: 3, service_launch: 3,
    customer_education: 4, email_campaign: 5, social_campaign: 5, referral_campaign: 5,
  };
  kept.sort((a, b) => (a.timing_ends || '9999').localeCompare(b.timing_ends || '9999')
    || PRIORITY[a.area] - PRIORITY[b.area] || a.area.localeCompare(b.area));
  return kept.slice(0, 8);
}

/* ── customer memory: nothing resurfaces without new evidence ──
   dismissed + same hash → gone until the grounding state changes
   accepted + same hash  → done; don't nag about finished work
   deferred until future → sleeping; matured deferral returns
   (ignored = left open; it simply persists without repetition) */
export interface MemoryRow { opp_key: string; opp_hash: string; status: string; deferred_until: string | null }
export function applyMemory(candidates: Opportunity[], memory: MemoryRow[], todayIso: string): Opportunity[] {
  const today = todayIso.slice(0, 10);
  const blocked = new Set<string>();
  for (const m of memory) {
    if ((m.status === 'dismissed' || m.status === 'accepted') && m.opp_hash) blocked.add(`${m.opp_key}|${m.opp_hash}`);
    if (m.status === 'deferred' && m.deferred_until && m.deferred_until > today) blocked.add(`${m.opp_key}|*`);
  }
  return candidates.filter((c) => !blocked.has(`${c.opp_key}|${c.opp_hash}`) && !blocked.has(`${c.opp_key}|*`));
}

/* ── model-idea sanitizer — the model may only ADD ideas in idea areas,
   grounded verbatim in the customer's own content; handoffs come from the
   fixed table regardless of what the model says. It can never execute. ── */
const MODEL_AREAS: CoachArea[] = ['promotion', 'customer_education', 'social_campaign', 'email_campaign'];
export function sanitizeCoachIdeas(raw: unknown, facts: FactSheet, nowIso: string): Opportunity[] {
  if (!Array.isArray(raw)) return [];
  const corpus = JSON.stringify(facts);
  const s = (v: unknown, cap: number) => (typeof v === 'string' ? v.trim().slice(0, cap) : '');
  const out: Opportunity[] = [];
  for (const f of (raw as Array<Record<string, unknown>>).slice(0, 6)) {
    const area = MODEL_AREAS.includes(f?.area as CoachArea) ? f!.area as CoachArea : null;
    if (!area) continue;
    const opportunity = s(f?.opportunity, 200), why = s(f?.why_it_matters, 300);
    if (!opportunity || !why) continue;
    const quote = s(f?.grounding_quote, 160);
    if (quote.length < 8 || !corpus.includes(quote)) continue;  // ungrounded ideas die
    out.push(opp(area, `idea_${cHash(opportunity)}`, quote, {
      opportunity, why,
      benefit: s(f?.expected_benefit, 200) || 'a timely nudge to customers',
      next: s(f?.suggested_next_step, 240) || 'Decide if this fits, then start it as an update.',
      brief: area === 'promotion' || area === 'customer_education' ? `${opportunity} Ground everything in the fact sheet.` : undefined,
      evidence: [{ source: 'your site', detail: `“${quote}”` }],
      phrase: 'no deadline',
    }));
    if (out.length >= 3) break;
  }
  return out;
}
