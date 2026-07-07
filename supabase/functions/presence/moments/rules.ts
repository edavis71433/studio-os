// ── The Business Moments rules (M9.3) — calm by construction ────────────────
// momentize() is pure: (recommendations, ctx) → at most THREE moments.
// Selection follows the frozen ladder; related concerns MERGE into one
// moment; dismissal memory keeps a same-fact moment gone unless evidence
// changes (hash), worsens (importance), or the dismissal ages out (30 days).
// The words are deterministic templates in the Direction A voice — a
// thoughtful business partner: never alarmist, never robotic, never blaming.
import type { Moment, MomentType, Tone } from './contract.ts';
import { momentHash } from './contract.ts';
import { PACK_MOMENT_TEMPLATES } from '../industry/compose.ts';

/** The recommendation shape this engine consumes — M9.2's stored fields it needs. */
export interface RecRow {
  recommendation_hash: string;
  rule: string;                       // 'rec_*'
  priority: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  audience: 'customer' | 'operator';
  status: 'active' | 'suppressed';
  value_dimensions: string[];
  timing: string;
  expires_at: string;
}

export interface MomentContext {
  siteId: string;
  now: string;
  previous: Record<string, { first_seen_at: string }>;                       // moment_key → prior state
  dismissals: Record<string, { moment_hash: string; importance: number; dismissed_at: string }>; // moment_key → memory
}

export const DISMISSAL_TTL_DAYS = 30;

export interface MomentTemplate {
  recRule: string;                     // consumes this M9.2 rule
  key: string;                         // moment deduplication_key
  type: MomentType;
  tone: Tone;
  mergeable: boolean;                  // may fold into the improvements bundle when crowded
  bundleWord: string;                  // how this concern reads inside a bundle sentence
  ttlDays: number;
  headline: string;
  summary: string;
}

/** One template per customer-audience recommendation rule (integrity-tested).
 *  Plain merchant words only — the tone lint test enforces the vocabulary. */
export const TEMPLATES: MomentTemplate[] = [
  { recRule: 'rec_site_not_yet_live', key: 'first_publish', type: 'needs_attention', tone: 'encouraging', mergeable: false, bundleWord: '', ttlDays: 14,
    headline: 'Your website is ready when you are.',
    summary: 'Everything you’ve written is waiting in your draft. One look, one button, and customers can start finding you.' },

  { recRule: 'rec_business_facts_incomplete', key: 'missing_basics', type: 'needs_attention', tone: 'attentive', mergeable: false, bundleWord: '', ttlDays: 10,
    headline: 'A few basics are missing.',
    summary: 'Hours, address, or a way to reach you — the facts customers check first. Filling them in takes a few minutes and clears the way to publishing.' },

  { recRule: 'rec_closed_flag_stale', key: 'closed_notice', type: 'needs_attention', tone: 'attentive', mergeable: false, bundleWord: '', ttlDays: 7,
    headline: 'Your site still says temporarily closed.',
    summary: 'If the doors are open again, one switch in Business updates it. If you’re still closed, all good — leave it as it is.' },

  { recRule: 'rec_facts_inconsistent', key: 'facts_disagree', type: 'needs_attention', tone: 'attentive', mergeable: false, bundleWord: '', ttlDays: 10,
    headline: 'Two phone numbers disagree.',
    summary: 'Your business details show one number and your location another. Worth a minute to make them match, so every fact agrees.' },

  { recRule: 'rec_draft_waiting', key: 'draft_waiting', type: 'reminder', tone: 'attentive', mergeable: false, bundleWord: '', ttlDays: 10,
    headline: 'Changes are waiting to publish.',
    summary: 'Work you’ve already done hasn’t reached your website yet. Look it over when you have a minute — publishing is one button, and nothing changes until then.' },

  { recRule: 'rec_public_freshness', key: 'freshness', type: 'reminder', tone: 'encouraging', mergeable: true, bundleWord: 'a small refresh', ttlDays: 21,
    headline: 'Worth confirming things are current.',
    summary: 'It’s been a while since anything on your site changed. If hours and menu are still right, even a small true update tells customers you’re here.' },

  { recRule: 'rec_search_snippets', key: 'search_listing', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'your search listing', ttlDays: 21,
    headline: 'Your search listing could work harder.',
    summary: 'The line customers see under your name in search results is thin in places. A sentence or two of your own words makes it yours.' },

  { recRule: 'rec_accessibility_content', key: 'photo_descriptions', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'photo descriptions', ttlDays: 21,
    headline: 'Some photographs need a few words.',
    summary: 'Short descriptions help customers who can’t see the pictures — and help search engines find your dishes.' },

  { recRule: 'rec_media_quality', key: 'photographs', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'photographs', ttlDays: 21,
    headline: 'Your photographs could do more.',
    summary: 'A couple are heavy enough to slow the page down, and some menu items have no picture at all. Both are quick to put right.' },

  { recRule: 'rec_conversion_paths', key: 'next_step', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'a clearer next step', ttlDays: 21,
    headline: 'Give customers a next step.',
    summary: 'A reservation or ordering link turns a visit into a booking. If you take them, it’s worth adding — if not, ignore this happily.' },

  { recRule: 'rec_content_depth', key: 'more_answers', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'a first answer or update', ttlDays: 28,
    headline: 'Your site can answer more questions.',
    summary: 'A first answered question or a short update gives customers a reason to stay — and gives the people searching for you more to find.' },

  // ── L3.1 optimization moments — plain merchant words, calm, bundleable ──
  { recRule: 'rec_opt_ai_search', key: 'ai_search', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'a hand up in AI search', ttlDays: 30,
    headline: 'Help AI assistants recommend you.',
    summary: 'A couple of your answers are short, and your description doesn’t say where you are. A sentence or two more helps AI tools describe and suggest your business.' },

  { recRule: 'rec_opt_details_everywhere', key: 'details_match', type: 'needs_attention', tone: 'attentive', mergeable: false, bundleWord: '', ttlDays: 14,
    headline: 'A few key details could line up better.',
    summary: 'Your name, address, phone, or hours aren’t all together on your home page, or they differ from place to place. Getting them to agree helps customers — and the tools that recommend you — trust what they see.' },

  { recRule: 'rec_opt_menu_reconcile', key: 'doc_disagrees', type: 'needs_attention', tone: 'attentive', mergeable: false, bundleWord: '', ttlDays: 14,
    headline: 'Your document and your website disagree.',
    summary: 'Something you uploaded — a price, an item, a phone number, or your hours — doesn’t match what’s on your site. A quick look tells us which one is right.' },

  { recRule: 'rec_opt_photos', key: 'add_photos', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'real photographs', ttlDays: 30,
    headline: 'Your site could use some photographs.',
    summary: 'There are no photos yet, so words are doing all the work. A few real pictures of your business help customers picture it before they decide.' },

  { recRule: 'rec_opt_story', key: 'your_story', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'a line about you', ttlDays: 45,
    headline: 'Tell people who’s behind the business.',
    summary: 'Your site doesn’t yet say who runs things. A sentence about you — in your own words — is one of the simplest ways to build trust.' },

  // Monitor-only (these are silent on our editions; they surface as migration value on Monitor)
  { recRule: 'rec_opt_search_hygiene', key: 'search_gaps', type: 'opportunity', tone: 'informative', mergeable: true, bundleWord: 'a few search gaps', ttlDays: 30,
    headline: 'Your current website has a few search gaps.',
    summary: 'A handful of things make your existing site a little harder for search engines and AI tools to read fully. Bringing your site here would set them right for you.' },

  { recRule: 'rec_opt_technical_access', key: 'access_gaps', type: 'opportunity', tone: 'informative', mergeable: true, bundleWord: 'some access gaps', ttlDays: 30,
    headline: 'Some visitors may find your current site hard to use.',
    summary: 'A few parts of your existing site are tricky for people using assistive tools. On a site built here, these are handled for you from the start.' },

  { recRule: 'rec_opt_speed', key: 'site_speed', type: 'opportunity', tone: 'informative', mergeable: true, bundleWord: 'a faster site', ttlDays: 30,
    headline: 'Your current website could load faster.',
    summary: 'Your existing site takes longer than it needs to, which can quietly cost you visitors. Hosting it here would speed it up without you lifting a finger.' },

  { recRule: 'rec_opt_foundations', key: 'foundations', type: 'needs_attention', tone: 'attentive', mergeable: false, bundleWord: '', ttlDays: 21,
    headline: 'Worth a look at your website’s foundations.',
    summary: 'The behind-the-scenes pieces that keep your site and email working — your web address, its security, and its mail settings — could be steadier. We can take care of these for you.' },

  // ── L4.2 connected intelligence moments ──
  // Reputation: mergeable, so it folds into the improvements bundle — connected
  // data enriches the customer's list, it doesn't add a fresh interruption.
  { recRule: 'rec_connected_reputation', key: 'reviews_reply', type: 'opportunity', tone: 'encouraging', mergeable: true, bundleWord: 'a reply to a review or two', ttlDays: 21,
    headline: 'A few reviews are waiting for a reply.',
    summary: 'Some recent reviews on your connected accounts haven’t been answered yet. A short, warm reply — even a simple thank-you — is one of the easiest ways to show customers you’re listening.' },

  // Celebration: measured good news, one calm moment however many metrics improved.
  { recRule: 'rec_connected_improved', key: 'connected_win', type: 'celebration', tone: 'celebratory', mergeable: false, bundleWord: '', ttlDays: 7,
    headline: 'More people are finding you lately.',
    summary: 'One of your connected accounts is showing real improvement — more visits, more interest from search, or kinder words from customers. Nothing to do here; it’s simply a good sign worth knowing.' },

  // ── L5.1 Industry Pack moment templates (customer copy in the industry's words) ──
  ...PACK_MOMENT_TEMPLATES,
];

const ALL_WELL: Omit<MomentTemplate, 'recRule' | 'mergeable' | 'bundleWord'> = {
  key: 'all_well', type: 'good_news', tone: 'reassuring', ttlDays: 2,
  headline: 'Everything customers can see is current.',
  summary: 'Your website matches what you’ve told us, and nothing needs your attention today.',
};

const BUNDLE: Omit<MomentTemplate, 'recRule' | 'mergeable' | 'bundleWord' | 'summary'> = {
  key: 'improvements_bundle', type: 'opportunity', tone: 'encouraging', ttlDays: 21,
  headline: 'A few improvements are ready when you are.',
};

/* the frozen ladder: critical business issues > trust > accuracy > search >
   accessibility > performance > growth > informational — deterministic score */
const PRIORITY_BASE: Record<string, number> = { critical: 800, high: 600, medium: 400, low: 200, informational: 100 };
const DIM_BONUS: Record<string, number> = {
  trust: 50, business_accuracy: 45, search_visibility: 40, accessibility: 35,
  performance: 30, reputation: 28, conversion: 20, freshness: 18, customer_experience: 15,
};
const ladder = (r: RecRow): number =>
  PRIORITY_BASE[r.priority] + Math.max(0, ...r.value_dimensions.map((d) => DIM_BONUS[d] || 0));
const importanceOf = (score: number): number => (score >= 800 ? 5 : score >= 600 ? 4 : score >= 400 ? 3 : score >= 200 ? 2 : 1);
const daysBetween = (a: string, b: string) => (new Date(a).getTime() - new Date(b).getTime()) / 86400000;

function finish(m: Omit<Moment, 'status' | 'suppression_reason' | 'first_seen_at'>, ctx: MomentContext): Moment {
  return { ...m, status: 'active', suppression_reason: '', first_seen_at: ctx.previous[m.deduplication_key]?.first_seen_at || ctx.now };
}

export interface MomentizeResult {
  moments: Moment[];                  // at most three, plus remembered suppressions
  deferred: string[];                 // moment keys that lost the seat race this pass
  untranslated_rules: string[];       // customer recs with no template — visibility, not failure
}

/** The Business Moments Engine's pure core. */
export function momentize(recs: RecRow[], ctx: MomentContext): MomentizeResult {
  const tpl = new Map(TEMPLATES.map((t) => [t.recRule, t]));
  const untranslated: string[] = [];

  // eligible: active, customer-audience, unexpired — one per rule, stable order
  const eligible = new Map<string, RecRow>();
  for (const r of [...recs].sort((a, b) => a.rule.localeCompare(b.rule))) {
    if (r.status !== 'active' || r.audience !== 'customer') continue;
    if (new Date(r.expires_at) <= new Date(ctx.now)) continue;
    if (!eligible.has(r.rule)) eligible.set(r.rule, r);
  }

  // candidates in ladder order
  type Cand = { t: MomentTemplate; r: RecRow; score: number };
  const cands: Cand[] = [];
  for (const [rule, r] of eligible) {
    const t = tpl.get(rule);
    if (!t) { untranslated.push(rule); continue; }
    cands.push({ t, r, score: ladder(r) });
  }
  cands.sort((a, b) => (b.score - a.score) || a.t.key.localeCompare(b.t.key));

  const expiresAt = (ttl: number, rec?: RecRow) => new Date(Math.min(
    new Date(ctx.now).getTime() + ttl * 86400000,
    rec ? new Date(rec.expires_at).getTime() : Infinity,
  )).toISOString();

  const build = (t: { key: string; type: MomentType; tone: Tone; ttlDays: number; headline: string }, summary: string, supporting: string[], score: number, rec?: RecRow): Moment =>
    finish({
      moment_id: momentHash(ctx.siteId, t.key, supporting),
      timestamp: ctx.now,
      supporting_recommendation_ids: supporting,
      moment_type: t.type, headline: t.headline, summary, tone: t.tone,
      importance: importanceOf(score), dismissable: t.key !== 'all_well',
      deduplication_key: t.key, expires_at: expiresAt(t.ttlDays, rec), future_follow_up: null,
    }, ctx);

  /** dismissal memory: gone unless evidence changed, got worse, or memory aged out */
  const remembered = (m: Moment): boolean => {
    const d = ctx.dismissals[m.deduplication_key];
    if (!d) return false;
    if (daysBetween(ctx.now, d.dismissed_at) >= DISMISSAL_TTL_DAYS) return false; // dismissal expired
    if (m.moment_id !== d.moment_hash) return false;                              // new evidence exists
    if (m.importance > d.importance) return false;                                // materially worse
    return true;                                                                  // stays gone
  };

  // MERGING LAW (standing, not crowd-triggered): two or more related
  // improvement concerns always become ONE moment. A single one stands alone.
  const solo = cands.filter((c) => !c.t.mergeable);
  const mergeable = cands.filter((c) => c.t.mergeable);

  type Seatable = { moment: Moment; key: string; score: number };
  const seatables: Seatable[] = solo.map((c) => ({
    moment: build(c.t, c.t.summary, [c.r.recommendation_hash], c.score, c.r), key: c.t.key, score: c.score,
  }));
  if (mergeable.length >= 2) {
    const words = mergeable.map((c) => c.t.bundleWord).filter(Boolean);
    // L3.1 calm: name at most three concerns so the bundle reads like a friend's
    // shortlist, not an audit's inventory; the rest fold into "a few more".
    const shown = words.slice(0, 3);
    const joined = shown.length > 1 ? shown.slice(0, -1).join(', ') + ' and ' + shown[shown.length - 1] : shown[0];
    const list = words.length > shown.length ? `${joined}, and a few more small things,` : joined;
    const summary = `Nothing is wrong — ${list} could each use a little care. Any one of them takes minutes, and none of them is waiting on the others.`;
    const supporting = mergeable.map((c) => c.r.recommendation_hash).sort();
    // breadth edge: a bundle carrying N concerns outranks a single concern of
    // equal priority — deterministic (+1 per member), never a class jump
    const score = Math.max(...mergeable.map((c) => c.score)) + mergeable.length;
    seatables.push({ moment: build(BUNDLE, summary, supporting, score), key: BUNDLE.key, score });
  } else if (mergeable.length === 1) {
    const c = mergeable[0];
    seatables.push({ moment: build(c.t, c.t.summary, [c.r.recommendation_hash], c.score, c.r), key: c.t.key, score: c.score });
  }

  // THE THREE-MOMENT LAW: everything competes for three seats by the ladder
  seatables.sort((a, b) => (b.score - a.score) || a.key.localeCompare(b.key));
  const seated: Moment[] = [];
  const suppressed: Moment[] = [];
  const deferred: string[] = [];
  for (const s of seatables) {
    if (remembered(s.moment)) {
      s.moment.status = 'suppressed'; s.moment.suppression_reason = 'dismissed_remembered';
      s.moment.future_follow_up = new Date(new Date(ctx.dismissals[s.key].dismissed_at).getTime() + DISMISSAL_TTL_DAYS * 86400000).toISOString();
      suppressed.push(s.moment);
      continue;
    }
    if (seated.length < 3) seated.push(s.moment);
    else deferred.push(s.key);
  }

  // a day with nothing to say says everything is okay — exactly once
  if (!seated.length && !suppressed.length) {
    seated.push(build({ ...ALL_WELL }, ALL_WELL.summary, [], 100));
  }

  // stable output: importance desc, then key
  seated.sort((a, b) => (b.importance - a.importance) || a.deduplication_key.localeCompare(b.deduplication_key));

  return { moments: [...seated, ...suppressed], deferred: deferred.sort(), untranslated_rules: untranslated.sort() };
}
