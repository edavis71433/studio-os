// ── The Concierge's answer engine (M9.4) — pure, grounded, one voice ────────
// Five verbs and no more: EXPLAIN · RECOMMEND · TEACH · GUIDE · CELEBRATE.
// Every sentence is assembled deterministically from the grounding pack.
// The concierge simplifies but never changes meaning, never invents evidence,
// reasoning, priorities, or facts. If it doesn't know, it says so. It speaks
// as one host — no personas, no "AI", no chatbot mannerisms.
import type { Grounding } from './grounding.ts';

export type Verb = 'explain' | 'recommend' | 'teach' | 'guide' | 'celebrate';
export type Intent =
  | 'what_means' | 'why_recommend' | 'why_important' | 'if_ignored'
  | 'how_fix' | 'what_changes' | 'do_it' | 'overview' | 'unsupported'
  // L3.3 optimization follow-ups (deterministic, grounded — never open-ended chat)
  | 'can_wait' | 'will_break' | 'how_long' | 'need_technical'
  | 'affects_email' | 'affects_site' | 'can_you_do' | 'what_first' | 'how_important_relative';

export interface Ask {
  question: string;
  topicId?: string;                       // a moment id
  history?: Array<{ topic_id?: string }>; // current interaction only — the caller holds it
}

export interface ConciergeAnswer {
  verb: Verb;
  text: string;
  topic: { id: string; headline: string } | null;
  actions: Array<{ label: string; section: string }>;  // prepared pointers — never performed
  sources: { moment_id: string | null; recommendation_ids: string[]; evidence_count: number };
  grounded: boolean;
  low_confidence: boolean;
}

/* ── deterministic intent classification ── */
export function classifyIntent(q: string): Intent {
  const s = ' ' + q.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  if (!s.trim()) return 'overview';
  // ── L3.3 optimization follow-ups (specific first, so they win over generics) ──
  if (/( email )/.test(s) && /( affect | change | break | touch | impact | mess | hurt | do to )/.test(s)) return 'affects_email';
  if (/( affect (my )?(web ?site|site|pages?) | change (my )?(web ?site|site|live site|pages?) | touch (my )?(web ?site|site) | do to my (web ?site|site) | impact (my )?(web ?site|site) )/.test(s)) return 'affects_site';
  if (/( will .* break | anything break | is it safe | risky | go wrong | will it hurt | damage | mess .* up | lose anything | break my )/.test(s)) return 'will_break';
  if (/( can i wait | can this wait | does this have to | have to do this now | urgent | in a hurry | how soon | put it off | no rush )/.test(s)) return 'can_wait';
  if (/( how long | how much time | take long | how quick | does it take | time .* take )/.test(s)) return 'how_long';
  if (/( technical | need to know anything | complicated | on my own | by myself | over my head | too hard | am i able )/.test(s)) return 'need_technical';
  if (/( can you (do|handle|set|take care|sort|fix) | can studio os | do you (do|handle) this | is this something you | you handle this | you do this for me | is that something you )/.test(s)) return 'can_you_do';
  if (/( do first | where do i start | start with | first thing | which one first | what .* first | start here )/.test(s)) return 'what_first';
  if (/( compared to | most important | matter most | vs everything | big picture | more important than | biggest | rank )/.test(s)) return 'how_important_relative';
  if (/( ignore | skip | don'?t do | do nothing | leave it | what happens if i don'?t | later )/.test(s)) return 'if_ignored';
  if (/( fix this | do it | go ahead | please do | handle it | take care of it | yes do )/.test(s)) return 'do_it';
  if (/( how do i | how can i | how to | where do i | what do i do | fix )/.test(s)) return 'how_fix';
  if (/( what will change | what changes | goes? live | what happens when | before it )/.test(s)) return 'what_changes';
  if (/( why are you | why recommend | why do you | how do you know | where did this come from | says who | based on )/.test(s)) return 'why_recommend';
  if (/( important | matter | why should | who cares | worth it | big deal )/.test(s)) return 'why_important';
  if (/( mean | what is this | what'?s this | understand | explain )/.test(s)) return 'what_means';
  if (/( today | anything | overview | what'?s going on | how are things )/.test(s)) return 'overview';
  return 'unsupported';
}

/* ── merchant translation maps (deterministic; the only vocabulary used) ── */
const DIM_PHRASE: Record<string, string> = {
  trust: 'how much customers trust what they see',
  search_visibility: 'how easily customers find you when they search',
  accessibility: 'customers who browse with screen readers or other assistive tools',
  business_accuracy: 'whether customers see correct facts about you',
  conversion: 'how easily a visit turns into a booking or an order',
  performance: 'how quickly your pages open',
  reputation: 'how your business comes across',
  freshness: 'whether your site looks current and cared-for',
  customer_experience: 'how the visit feels to a customer',
};
const EFFORT_PHRASE: Record<string, string> = {
  minutes: 'a few minutes', hour: 'under an hour', hours: 'a few hours', project: 'a bigger piece of work',
};
const UNDO_PHRASE: Record<string, string> = {
  not_applicable: 'There’s nothing to undo — it’s a check, not a change.',
  fully_undoable: 'It’s fully undoable.',
  versioned: 'Every version of your site is kept, so anything published can always come back.',
};
const TIMING_PHRASE: Record<string, string> = {
  immediate: 'worth a look now', soon: 'worth a look soon', seasonal: 'a good fit for a quiet moment',
  whenever: 'no rush at all', none: 'no rush at all',
};
/* where each concern is cared for in the room */
const FIX_PLACE: Record<string, { section: string; label: string; steps: string }> = {
  rec_site_not_yet_live: { section: 'publish', label: 'Open the publish page', steps: 'Look over what’s written, preview it if you like, and publish when it reads right.' },
  rec_business_facts_incomplete: { section: 'business', label: 'Open Business', steps: 'The empty facts are on the Business page — name, hours, address, a way to reach you.' },
  rec_closed_flag_stale: { section: 'business', label: 'Open Business', steps: 'The temporarily-closed switch is near the bottom of the Business page.' },
  rec_facts_inconsistent: { section: 'business', label: 'Open Business', steps: 'Both phone fields are on the Business page — make them agree, or clear the one you don’t use.' },
  rec_draft_waiting: { section: 'publish', label: 'Review & publish', steps: 'The publish page reads out every waiting change before anything happens.' },
  rec_public_freshness: { section: 'business', label: 'Open Business', steps: 'Confirm hours and menu are still right; even a small true update counts.' },
  rec_search_snippets: { section: 'business', label: 'Open Business', steps: 'Your description and tagline shape what searchers see under your name.' },
  rec_accessibility_content: { section: 'media', label: 'Open Photographs', steps: 'Each photograph can carry a one-sentence description; the ones missing words are easy to spot.' },
  rec_media_quality: { section: 'media', label: 'Open Photographs', steps: 'Swap the heavy photographs for lighter ones, and give picture-less menu items a photo.' },
  rec_conversion_paths: { section: 'business', label: 'Open Business', steps: 'The reservation and ordering links live on the Business page.' },
  rec_content_depth: { section: 'faqs', label: 'Open Questions', steps: 'Start with the one question customers ask most — one honest answer is plenty.' },
  // L3.2 — optimization tasks the customer owns (their knowledge / their content)
  rec_opt_ai_search: { section: 'faqs', label: 'Open Questions', steps: 'Your answered questions are on the Questions page, and your description on the Business page — a sentence or two more helps AI assistants describe and suggest you.' },
  rec_opt_details_everywhere: { section: 'business', label: 'Open Business', steps: 'Your name, address, phone, and hours all live on the Business page — getting them complete and agreeing with each other is all it takes.' },
  rec_opt_menu_reconcile: { section: 'business', label: 'Open Business', steps: 'The prices, items, phone, and hours on your site are on the Business and Menu pages — a quick compare with your uploaded document tells us which to keep.' },
  rec_opt_photos: { section: 'media', label: 'Open Photographs', steps: 'The Photographs page is where a few real pictures of your business go — the kind that help a customer picture the place.' },
  rec_opt_story: { section: 'business', label: 'Open Business', steps: 'Your story lives on the Business page — a sentence about who’s behind the business is plenty.' },
  // L4.2 — connected reputation: the reviews live on the connected account, and
  // the reply happens there. We point to Connections and explain the rest.
  rec_connected_reputation: { section: 'connections', label: 'Open Connections', steps: 'Your reviews live on your connected accounts — a short, genuine reply to the most recent ones, and to any unhappy one first, does the most good. Nothing on your own website changes.' },
};

// L3.2 — Guided Fix: Studio OS prepares the whole change; the customer only
// approves. Nothing to their domain, email, or security happens until they say
// yes (the frozen infrastructure-approval law, M12/M14).
const GUIDED_FIX: Record<string, { section: string; label: string; steps: string }> = {
  rec_opt_foundations: { section: 'foundations', label: 'Open Foundations', steps: 'This is one Studio OS sets up for you: we prepare the exact change as a plan you can read in plain words, and you just approve it. Nothing to your web address, email, or security happens until you say yes.' },
};

// L3.2 — Platform-owned work (Law 24): silent on our editions, we simply handle
// it; on Monitor it reads as something a move here would take care of.
const PLATFORM_HANDLED = new Set(['rec_opt_search_hygiene', 'rec_opt_technical_access', 'rec_opt_speed']);
const PLATFORM_HANDLED_LINE = 'This is one of ours to handle — on a website built and hosted here, it’s taken care of for you, so there’s nothing on your list for it.';

const APPROVAL_LINE = 'Nothing changes on your live site until you’ve looked it over and published it yourself.';

/* ── helpers ── */
function topicOf(ask: Ask, g: Grounding) {
  const id = ask.topicId || [...(ask.history || [])].reverse().find((h) => h.topic_id)?.topic_id;
  return g.moments.find((m) => m.id === id) || null;
}
function recsFor(moment: NonNullable<ReturnType<typeof topicOf>>, g: Grounding) {
  return g.recommendations.filter((r) => moment.supporting_recommendation_ids.includes(r.hash));
}
function evidenceFor(recs: Grounding['recommendations'], g: Grounding) {
  const jh = new Set(recs.flatMap((r) => r.supporting_judgment_ids));
  const eIds = new Set(g.judgments.filter((j) => jh.has(j.hash)).flatMap((j) => j.evidence_ids));
  return g.evidence.filter((e) => eIds.has(e.id));
}
// L3.3 — which kind of ownership a moment's work is, so answers can reinforce
// it: platform (ours, silent), guided (we prepare, you approve), customer (yours).
type Ownership = 'platform' | 'guided' | 'customer' | 'unknown';
function ownershipOf(recs: Grounding['recommendations']): Ownership {
  if (recs.some((r) => PLATFORM_HANDLED.has(r.rule))) return 'platform';
  if (recs.some((r) => GUIDED_FIX[r.rule])) return 'guided';
  if (recs.some((r) => FIX_PLACE[r.rule])) return 'customer';
  return 'unknown';
}
// Does this work touch email? Only the foundations task can (mail settings).
const touchesEmail = (recs: Grounding['recommendations']) => recs.some((r) => r.rule === 'rec_opt_foundations');

const lowConf = (ev: Grounding['evidence']) => ev.length > 0 && Math.min(...ev.map((e) => e.confidence)) < 0.8;
const uniq = <T>(a: T[]) => [...new Set(a)];
const listWords = (ws: string[]) => ws.length > 1 ? ws.slice(0, -1).join(', ') + ' and ' + ws[ws.length - 1] : (ws[0] || '');

const HONEST_LOW_CONF = ' A note of honesty: part of this is judgment rather than hard measurement, so treat it as a nudge, not a certainty.';
const HONEST_NO_EVIDENCE = 'I can only speak to what’s actually been measured about your presence, and I don’t have anything on that — I’d rather say so than guess.';

function base(verb: Verb, text: string, topic: ReturnType<typeof topicOf>, recs: Grounding['recommendations'], ev: Grounding['evidence'], actions: ConciergeAnswer['actions'] = []): ConciergeAnswer {
  return {
    verb, text,
    topic: topic ? { id: topic.id, headline: topic.headline } : null,
    actions,
    sources: { moment_id: topic?.id ?? null, recommendation_ids: recs.map((r) => r.hash), evidence_count: ev.length },
    grounded: !!(topic || recs.length || ev.length),
    low_confidence: lowConf(ev),
  };
}

/* ── the answer ── */
export function answer(ask: Ask, g: Grounding): ConciergeAnswer {
  const intent = classifyIntent(ask.question || '');
  const topic = topicOf(ask, g);

  // celebration topic: one warm voice, whatever was asked. L4.2: a measured
  // connected win ('celebration') is celebrated the same calm way as an all-well
  // day ('good_news') — good news is intelligence too, and it flows the same pipe.
  if (topic && (topic.moment_type === 'good_news' || topic.moment_type === 'celebration')) {
    return base('celebrate',
      `${topic.summary} Days like this are the point — enjoy it. If anything changes, it’ll appear here first, quietly.`,
      topic, recsFor(topic, g), []);
  }

  // ── L3.3 cross-moment guidance — prioritization works with or without a topic ──
  if (intent === 'what_first') {
    if (!g.moments.length) return base('explain', `Nothing’s waiting for you to start on — when something’s worth your time, it’ll show up here.`, null, [], []);
    const top = g.moments[0];
    const topRecs = recsFor(top, g);
    const dims = uniq(topRecs.flatMap((r) => r.value_dimensions)).map((d) => DIM_PHRASE[d]).filter(Boolean);
    let text = `If you only do one thing, start with “${top.headline}”`;
    text += dims.length ? ` — it’s the one that most touches ${listWords(dims.slice(0, 2))}.` : `.`;
    if (g.moments.length > 1) text += ` The rest can follow in any order, and none is waiting on the others.`;
    return base('guide', text, top, topRecs, []);
  }
  if (intent === 'how_important_relative') {
    const t = topic || g.moments[0] || null;
    if (!t) return base('explain', `There’s nothing on your list right now, so there’s nothing to weigh.`, null, [], []);
    const rank = g.moments.findIndex((m) => m.id === t.id);
    const text = rank <= 0
      ? `Of what’s here, this is the one I’d look at first — but nothing on your list is an emergency; it’s all steady improvement, at your pace.`
      : `A thing or two sits a little ahead of this one, but none of it is urgent — it’s about steady improvement, whenever it suits you.`;
    return base('teach', text, t, recsFor(t, g), []);
  }

  // no topic: overview or honest refusal
  if (!topic) {
    if (intent === 'need_technical') {
      return base('teach', `Not at all. Everything here is in plain words, and anything technical is ours to handle — you decide in business terms, and we take care of the rest.`, null, [], []);
    }
    if (intent === 'will_break') {
      return base('teach', `Nothing here can break your live site. Anything you change waits in a private draft until you publish, publishing happens all at once (never halfway), and every version is kept so anything can come back.`, null, [], []);
    }
    if (intent === 'overview' || intent === 'what_means') {
      if (!g.moments.length) {
        return base('explain', `There’s nothing waiting for you today. When something deserves your attention, it appears here — at most three things, never a flood.`, null, [], []);
      }
      const heads = g.moments.map((m) => `“${m.headline}”`);
      return base('explain', `Here’s what’s worth knowing today: ${listWords(heads)}. Pick any of them and I’ll walk you through it.`, null, [], []);
    }
    return base('explain', HONEST_NO_EVIDENCE + (g.moments.length ? ` What I can speak to today: ${listWords(g.moments.map((m) => `“${m.headline}”`))}.` : ''), null, [], []);
  }

  const recs = recsFor(topic, g);
  const ev = evidenceFor(recs, g);
  const dims = uniq(recs.flatMap((r) => r.value_dimensions)).map((d) => DIM_PHRASE[d]).filter(Boolean);
  const benefits = uniq(recs.map((r) => r.expected_benefit));
  const efforts = uniq(recs.map((r) => EFFORT_PHRASE[r.estimated_effort])).filter(Boolean);
  const places = uniq(recs.map((r) => FIX_PLACE[r.rule]).filter(Boolean).map((p) => JSON.stringify(p))).map((s) => JSON.parse(s)) as Array<{ section: string; label: string; steps: string }>;

  switch (intent) {
    case 'what_means':
    case 'overview': {
      let text = topic.summary;
      if (dims.length) text += ` In plain terms, this touches ${listWords(dims.slice(0, 2))}.`;
      if (lowConf(ev)) text += HONEST_LOW_CONF;
      return base('explain', text, topic, recs, ev);
    }
    case 'why_recommend': {
      if (!ev.length) {
        return base('explain', `Honestly: I don’t have the underlying measurements in front of me for this one — only that it was flagged. ${topic.summary}`, topic, recs, ev);
      }
      const lines = ev.slice(0, 3).map((e) => `— ${e.human}`);
      let text = `Because it was observed, not guessed. Here’s what was actually noticed:\n${lines.join('\n')}`;
      if (ev.length > 3) text += `\n…and ${ev.length - 3} more like these.`;
      if (benefits.length) text += `\nPut right, ${benefits[0].charAt(0).toLowerCase()}${benefits[0].slice(1)}.`;
      if (lowConf(ev)) text += HONEST_LOW_CONF;
      return base('explain', text, topic, recs, ev);
    }
    case 'why_important': {
      let text = dims.length
        ? `It comes down to ${listWords(dims.slice(0, 3))}.`
        : `It’s one of the quieter things that adds up.`;
      if (benefits.length) text += ` ${benefits[0].charAt(0).toUpperCase()}${benefits[0].slice(1)}.`;
      const timing = recs[0] ? TIMING_PHRASE[recs[0].timing] : '';
      if (timing) text += ` It’s ${timing} — not an emergency.`;
      return base('teach', text, topic, recs, ev);
    }
    case 'if_ignored': {
      let text = `Nothing breaks, and nobody will chase you.`;
      if (dims.length) text += ` What quietly continues is the current state of ${listWords(dims.slice(0, 2))}.`;
      text += ` It stays on the list without nagging, and if it ever becomes more serious, you’ll hear about it here — honestly, and only then.`;
      return base('teach', text, topic, recs, ev);
    }
    case 'how_fix': {
      const guided = uniq(recs.map((r) => GUIDED_FIX[r.rule]).filter(Boolean).map((p) => JSON.stringify(p))).map((s) => JSON.parse(s)) as Array<{ section: string; label: string; steps: string }>;
      const platform = recs.some((r) => PLATFORM_HANDLED.has(r.rule));
      const parts: string[] = [];
      if (places.length) parts.push(places.map((p) => p.steps).join(' '));
      for (const g2 of guided) parts.push(g2.steps);
      if (platform && !places.length && !guided.length) parts.push(PLATFORM_HANDLED_LINE);
      else if (platform) parts.push('Some of it is ours to handle — you don’t need to do anything for those parts.');
      if (!parts.length) return base('guide', `${topic.summary} ${APPROVAL_LINE}`, topic, recs, ev);
      let text = parts.join(' ');
      if (places.length && efforts.length) text += ` For your part, it’s ${efforts[0]}.`;
      if (places.length) text += ` ${APPROVAL_LINE}`;
      const actions = [...places.map((p) => ({ label: p.label, section: p.section })), ...guided.map((g2) => ({ label: g2.label, section: g2.section }))];
      return base('guide', text, topic, recs, ev, actions);
    }
    case 'what_changes': {
      const undo = recs[0] ? UNDO_PHRASE[recs[0].undoability] : UNDO_PHRASE.versioned;
      const text = `Anything you edit lands in your draft first — a private copy only you can see. When you publish, the change goes live all at once, never halfway. ${undo}`;
      return base('guide', text, topic, recs, ev);
    }
    case 'do_it': {
      const guided = recs.map((r) => GUIDED_FIX[r.rule]).filter(Boolean) as Array<{ section: string; label: string; steps: string }>;
      if (guided.length) {
        return base('guide', `Happy to. ${guided[0].steps}`, topic, recs, ev, guided.map((g2) => ({ label: g2.label, section: g2.section })));
      }
      if (!places.length && recs.some((r) => PLATFORM_HANDLED.has(r.rule))) {
        return base('guide', PLATFORM_HANDLED_LINE, topic, recs, ev);
      }
      if (!places.length) {
        return base('guide', `This one isn’t something I can set up — it’s a look-and-confirm. ${topic.summary}`, topic, recs, ev);
      }
      const text = `The place for that is ready — ${places.map((p) => p.steps).join(' ')} ${APPROVAL_LINE}`;
      return base('guide', text, topic, recs, ev, places.map((p) => ({ label: p.label, section: p.section })));
    }
    case 'can_wait': {
      const timing = recs[0] ? TIMING_PHRASE[recs[0].timing] : 'no rush at all';
      const text = `You can. It’s ${timing} — waiting costs nothing. It stays here quietly without nagging, and if it ever becomes more serious you’ll hear about it, honestly and only then.`;
      return base('teach', text, topic, recs, ev);
    }
    case 'will_break': {
      const own = ownershipOf(recs);
      const text = own === 'guided'
        ? `Nothing breaks. This is a change we prepare and you approve — nothing to your web address, email, or security happens until you say yes, and it can be undone.`
        : own === 'platform'
          ? `Nothing for you to worry about — this one’s ours to handle, and it never touches anything you’d see or lose.`
          : `Nothing on your live site can break. Anything you change waits in a private draft until you publish, publishing happens all at once — never halfway — and every version is kept, so it can always come back.`;
      return base('guide', text, topic, recs, ev);
    }
    case 'how_long': {
      const own = ownershipOf(recs);
      if (own === 'platform') return base('teach', `No time from you at all — this one’s handled on our side.`, topic, recs, ev);
      if (own === 'guided') return base('teach', `Just a moment to approve — we’ve done the preparing.`, topic, recs, ev);
      return base('teach', `For your part, ${efforts[0] || 'just a few minutes'}.`, topic, recs, ev);
    }
    case 'need_technical': {
      const own = ownershipOf(recs);
      let text = `Not at all — everything here is in plain words.`;
      if (own === 'platform') text += ` This one you don’t touch at all; it’s ours.`;
      else if (own === 'guided') text += ` We prepare the technical part; you just approve it in plain language.`;
      else text += ` It’s about your business, not the machinery — you decide, and I’ll point you to exactly the right spot.`;
      return base('teach', text, topic, recs, ev);
    }
    case 'affects_email': {
      const text = touchesEmail(recs)
        ? `It can touch your email settings — that’s part of keeping your mail trusted and arriving. But it’s a change we prepare and you approve; nothing happens to your email until you say yes.`
        : `No — your email is completely untouched by this. It’s only about your website.`;
      return base('guide', text, topic, recs, ev);
    }
    case 'affects_site': {
      const own = ownershipOf(recs);
      const text = own === 'platform'
        ? `Only for the better, and it’s handled for you — nothing you’d have to touch.`
        : own === 'guided'
          ? `Only the behind-the-scenes settings, and only after you approve — your pages and words stay exactly as they are.`
          : `Only what you choose to change, and only once you publish — until then, your live site stays exactly as it is.`;
      return base('guide', text, topic, recs, ev);
    }
    case 'can_you_do': {
      const own = ownershipOf(recs);
      const guided = recs.map((r) => GUIDED_FIX[r.rule]).filter(Boolean) as Array<{ section: string; label: string; steps: string }>;
      if (own === 'platform') return base('guide', PLATFORM_HANDLED_LINE, topic, recs, ev);
      if (own === 'guided' && guided.length) return base('guide', `Yes — ${guided[0].steps}`, topic, recs, ev, guided.map((g2) => ({ label: g2.label, section: g2.section })));
      if (places.length) {
        return base('guide', `This part is yours — it’s about your own business, which only you can speak to. But it’s ${efforts[0] || 'a few minutes'}, and I’ll take you right to the spot: ${places.map((p) => p.steps).join(' ')}`, topic, recs, ev, places.map((p) => ({ label: p.label, section: p.section })));
      }
      return base('explain', `${topic.summary} This one’s a look-and-confirm rather than something I can set up.`, topic, recs, ev);
    }
    default:
      return base('explain', `${HONEST_NO_EVIDENCE} On this note, what I can tell you: ${topic.summary}`, topic, recs, ev);
  }
}
