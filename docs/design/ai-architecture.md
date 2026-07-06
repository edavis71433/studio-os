# Studio OS — AI Workforce Architecture

Status: PROPOSED for review. Nothing here is built. This is the "recommend the
architecture first" deliverable. Building happens one capability at a time,
staging-first, verified, only after approval — same discipline as the pipeline
work.

Guiding principle (Eric's words): reliability, usefulness, automation > flashy
responses. Every agent must save Eric time OR make the client feel they hired a
digital agency. One responsibility per agent. Agents cooperate; they do not each
try to do everything.

---

## PART 1 — Audit of every existing AI feature (evidence-based)

19 live Anthropic call sites, all on `claude-haiku-4-5-20251001`, every one a
raw `fetch` to `api.anthropic.com` with a bespoke inline system prompt. Measured
facts: **0 uses of prompt caching** (`cache_control`), the "no em dashes / Eric
voice" spec is copy-pasted across **~21–25 prompt lines**, and the concierge
re-sends a **5.2 KB static knowledge blob on every single message**.

| # | Feature (route) | What it does | Real value | Verdict |
|---|---|---|---|---|
| 1 | `aiCritique` | Public website review → JSON blocks | HIGH — top of funnel, lead magnet | KEEP → **Website Analysis Agent** |
| 2 | `conciergeChat` | Site chatbot answering pricing/capability | MED — deflects questions, books calls | KEEP, but **cache the knowledge blob** |
| 3 | `narrateHeadline` | 1-line AI header on the Brief | LOW — cosmetic; deterministic fallback already exists | **CUT or batch** (flashy) |
| 4 | `narratePattern` | 1-line "pattern" insight | LOW — cosmetic | **CUT or batch** (flashy) |
| 5 | `draft_action` | Draft a message from one recommendation | MED | MERGE → **Drafting Agent** |
| 6 | `prospect_email_draft` | Cold outreach email | HIGH (lead gen) | MERGE → Drafting Agent (lead-tuned) |
| 7 | `lead_ai_draft` | Draft reply to an inbound lead | MED | MERGE → Drafting Agent |
| 8 | `conversation_summary` | Summarize a thread + sentiment | MED-HIGH | KEEP → **Comprehension Agent** |
| 9 | `quote_ai_build` | Draft quote line items from a convo | MED | KEEP (Drafting Agent, structured) |
| 10 | `gp_quarterly_strategy` | Quarterly strategy write-up | MED | KEEP → **Reporting Agent** |
| 11 | `pi_weekly` | Weekly product-intelligence report | LOW-MED (internal only) | KEEP as-is (already gated on evidence) |
| 12 | `client_talking_points` | Meeting prep bullets | MED-HIGH (saves Eric prep) | KEEP → Reporting Agent |
| 13 | `report_narrative` | Monthly report narrative | HIGH (retention artifact) | KEEP → Reporting Agent |
| 14 | `template_ai_edit` | Rewrite an email (tone/shorten/…) | MED | MERGE → Drafting Agent |
| 15 | `task_breakdown` | Task → 3-6 steps | LOW-MED | KEEP (cheap, Drafting Agent) |
| 16 | `home_brief` | Admin daily executive briefing | HIGH (Eric's morning) | KEEP → **Briefing Agent** |
| 17 | `ai_draft_reply` | Draft a portal reply to a client | MED | MERGE → Drafting Agent |
| 18 | `ai_triage` | Dashboard "what needs you" triage | MED (overlaps home_brief + reasoning engine) | **MERGE into Briefing** |
| 19 | `ai_project_help` | Client portal project Q&A bot | MED | KEEP → Comprehension Agent (client-facing) |

### Cross-cutting findings (the real problems)

1. **No AI gateway.** 19 independent call sites each re-implement headers,
   timeout, JSON parsing, error handling, and the model literal. There is no
   shared retry, no fallback, no telemetry, no cost/token metering, no
   prompt-injection defense, no caching. Changing anything AI-wide means editing
   19 places. **This is the single biggest architectural gap.**
2. **One model for everything.** An 80-token cosmetic headline and a 2,500-token
   strategic report both call Haiku. No tiering by task difficulty — cheap
   mechanical work and genuinely hard reasoning are undifferentiated. (Haiku is
   right for most of this; the point is the *choice* should be deliberate and
   centralized, and the few hard tasks — strategy, quarterly, audits — should be
   able to use a stronger model without touching 19 sites.)
3. **Voice duplication.** ~6 separate "draft a message in Eric's voice" features,
   each re-specifying the same voice (no em dashes, warm, plain) in its own
   prompt. The voice drifts between them and every tweak is a 6-place edit.
4. **Zero prompt caching.** The concierge knowledge blob (5.2 KB) and every
   repeated system prompt are re-billed as fresh input tokens every call.
   Anthropic prompt caching would cut input cost on the repeat-heavy paths
   (concierge, drafting, briefing) by a large margin.
5. **Flashy narrators cost real calls.** Every Brief/Opportunities page load
   fires 2 AI calls (`narrateHeadline` + `narratePattern`) for one-liner
   cosmetics that already have deterministic fallbacks — exactly the "flashy over
   useful" tradeoff Eric deprioritized.
6. **One genuinely good pattern already exists** and should be generalized: the
   reasoning engine's COLLECTORS → INTERPRETER (deterministic ranking) → NARRATOR
   (disposable AI). Business logic stays deterministic and auditable; AI only
   explains. Every new agent should follow this shape.

---

## PART 2 — The target architecture: an AI workforce

Two layers.

### Layer A — the AI Gateway (build this FIRST; everything depends on it)

One internal module every AI feature calls instead of `fetch`-ing Anthropic
directly. Single responsibility: **be the one door to the model.**

```
askAI({
  agent: 'drafting' | 'analysis' | 'reporting' | 'briefing' | 'comprehension' | 'concierge',
  task: string,                 // stable id, for telemetry + cache keys
  system: string,               // cacheable prefix (voice, rubric) — cached
  input: string | object,       // per-call variable content — not cached
  schema?: JSONSchema,          // if set, forces + validates structured output
  tier?: 'fast' | 'deep',       // maps to a model; default per agent
  maxTokens, timeoutMs,
}) → { ok, data|text, usage, cached, model, requestId }
```

What it centralizes (each of these is impossible to do well across 19 sites):
- **Model tiering** — one map from `agent`/`tier` → model id. Change models here,
  once.
- **Prompt caching** — mark the static `system` prefix cacheable; huge savings on
  concierge/drafting/briefing.
- **Structured output** — schema-forced JSON with validate-and-retry, replacing
  the ~10 hand-rolled `JSON.parse(text.replace(/```/…))` blocks that each fail
  differently.
- **Reliability** — timeout, one retry, and a deterministic fallback contract so
  a slow/failed model never breaks the request path (the reasoning engine already
  proves this pattern; make it universal).
- **Telemetry + cost** — one `ai_calls` audit row per call (agent, task, tokens,
  cached, latency, ok) → finally answers "what is AI costing me and where."
- **Injection defense** — one place to wrap untrusted input (client messages,
  scraped site text) so prompts can't be hijacked.

This is additive: features migrate to `askAI` one at a time; nothing else changes
on day one.

### Layer B — the roster (six agents, one responsibility each)

Consolidates the 19 features into 6 cooperating agents. Each is a thin set of
`askAI` calls with one job and one owned prompt-library entry.

| Agent | One responsibility | Absorbs | Consumes |
|---|---|---|---|
| **Drafting** | Write anything in Eric's voice (email, reply, quote, task steps) — ONE voice definition | 5,6,7,9,14,15,17 | Comprehension output; CRM facts |
| **Lead Intelligence** | Grow DDS: find, enrich, score, audit, prioritize, next-best-action, learn | rebuilds 6 + prospect_* + audit | Website Analysis; Drafting |
| **Website Analysis** | Turn a URL into structured findings (SEO/a11y/perf/trust/conversion) | 1 + deep_audit | — (feeds Lead + client tools) |
| **Reporting** | Explain measured facts to a client (monthly report, quarterly, talking points) | 10,12,13 | deterministic metrics only |
| **Briefing** | Tell Eric what needs him today, ranked deterministically, explained by AI | 16,18 + reasoning narrators | reasoning engine (existing) |
| **Comprehension** | Read + summarize (threads, sentiment, docs) → structured facts others use | 8,19 | — (produces facts for Drafting/Briefing) |

Cooperation example: inbound lead → **Comprehension** summarizes the thread →
**Briefing** ranks it into "needs you today" → **Drafting** writes the reply in
Eric's voice. Three specialists, one handoff chain, versus today's one
do-everything prompt.

The two narrators (3,4) get **cut** (deterministic fallback stands) or folded
into one batched Briefing call — not two extra calls per page load.

---

## PART 3 — Lead Intelligence Agent (architecture-first, per the brief)

Purpose: grow Davis Digital Studio by automating the lead pipeline end-to-end,
compliantly. Built on the proven deterministic-core + AI-layer shape.

### Pipeline (each stage independent, resumable, logged)

```
DISCOVER → ENRICH → ANALYZE → SCORE → PRIORITIZE → RECOMMEND → OUTREACH → FOLLOW-UP → LEARN
```

### Capability evaluation (build / defer / skip — with reasons)

| Capability | Cust value | Automation | Maint | Complexity | Verdict |
|---|---|---|---|---|---|
| Discover ICP businesses (Places API) | — (internal) | HIGH | LOW | LOW | **BUILD** (exists; wrap) |
| Enrich from public web (site, GBP) | — | HIGH | MED | MED | **BUILD** |
| Website analysis (SEO/a11y/perf/trust) | HIGH | HIGH | MED | MED | **BUILD** (Website Analysis Agent) |
| Fit scoring (deterministic + learned) | — | HIGH | LOW | MED | **BUILD** |
| Personalized audit summary | HIGH | HIGH | LOW | LOW | **BUILD** (highest ROI) |
| Prioritize outreach / next-best-action | — | HIGH | LOW | MED | **BUILD** |
| Track status / schedule follow-ups | — | HIGH | LOW | LOW | **BUILD** (reuse opportunities table) |
| Memory of prior interactions | — | MED | MED | MED | **BUILD** (lightweight) |
| Learn which leads convert | — | HIGH long-term | MED | HIGH | **DEFER** (needs conversion volume first) |
| Detect "AI opportunities" on a site | LOW | LOW | MED | MED | **SKIP** (vague; low signal) |
| Auto-send outreach without review | — | HIGH | — | — | **SKIP** (compliance + brand risk; always human-approve) |

### Compliance guardrails (non-negotiable, baked into the agent)
- Google Places API used within ToS; **no scraping behind logins**, no CAPTCHA
  bypass, only public business data.
- **CAN-SPAM**: real physical address + one-click unsubscribe on any cold email;
  honor `suppressed_emails` (table exists) before every send.
- **Human-in-the-loop send**: the agent drafts and prioritizes; Eric approves the
  send. No autonomous mass mailing.
- Per-domain/day outreach caps; log every send to the audit trail.

### Data model (additive migrations, staging-first)
- Reuse `prospects`, `audit_leads`, `opportunities` (all exist).
- Add: `lead_signals` (per-lead findings + scores over time, mirrors the
  `signals` pattern), and a `lead_interactions` memory log. Conversion-learning
  reads these once there's volume.

### Why this beats today's lead features
Today: `prospect_discover`, `prospect_insights`, `prospect_email_draft`,
`aiCritique`, `audit_lead` are 5 disconnected routes with no shared memory, no
unified score, no next-best-action. The agent unifies them into one pipeline with
state and a single "what should I do about this lead next" answer.

---

## PART 4 — AI across the modules (challenged; not gimmicks)

Product-review test applied to each: *why it exists, who benefits, frequency,
time saved, perceived value, worth maintaining, before/after launch.*

### Client Portal (make the client feel they hired an agency)
- **Proactive milestone/update summaries** — BUILD. Auto-summarize what shipped
  this period into the portal + email. High perceived value, runs in background.
- **Document summaries** — DEFER. Only if/when docs are actually uploaded at
  volume; low frequency today.
- **Meeting summaries** — SKIP for now. No meeting transcripts are ingested;
  nothing to summarize. Revisit if a transcript source appears.
- **Next-step recommendations / intelligent reminders** — BUILD (cheap; reuse
  reasoning engine). Real "saved me time" for the client.
- **FAQ / onboarding assistance** — the concierge already covers this; extend
  it to logged-in clients rather than a new feature.

### Admin Portal (make Eric dramatically more efficient)
- **Daily executive briefing** — already the strongest feature (`home_brief`);
  promote it to the Briefing Agent and make it the AI centerpiece. BUILD-first.
- **Churn-risk / upsell detection** — BUILD. Deterministic signals already exist
  (client_pulse, opportunities); AI explains, doesn't rank.
- **Proposal/estimate/invoice drafting** — BUILD via Drafting Agent (quote_ai_build
  exists; generalize).
- **Client sentiment** — BUILD (Comprehension already scores it; surface it).
- **Workload balancing** — DEFER. Low signal for a solo operator; revisit if the
  team grows (team management exists but is nascent).

### Analytics
- **Explain trends / detect anomalies / recommend actions** — already exists
  (`admin_analytics` executive brief). KEEP; route through the gateway; don't
  rebuild.

### CRM
- **Relationship summaries / recommended follow-ups / scoring** — BUILD via
  Comprehension + Briefing. High leverage, reuses existing signals.

### Website Tools
- **Better audits + accessibility/SEO/conversion explanations + implementation
  plans** — BUILD (Website Analysis Agent). This is both a lead magnet AND a
  client deliverable — double value. Highest external-value item after the
  audit summary.

---

## PART 5 — Roadmap (highest value first, one at a time)

Each ships staging-first, verified with real tests, production-ready before the
next starts.

1. **AI Gateway (Layer A).** Foundation. Unblocks tiering, caching, telemetry,
   reliability for everything after. Migrate 2–3 existing features onto it as the
   proof (concierge — to land caching — plus home_brief). Measurable win: input
   tokens on concierge drop sharply; one `ai_calls` cost ledger appears.
2. **Drafting Agent.** Collapse 6 duplicated voice prompts into one. Immediate
   maintainability + consistent voice; touches the most surfaces.
3. **Website Analysis Agent.** Structured, reusable findings — powers both the
   public lead magnet and client deliverables.
4. **Lead Intelligence Agent.** Built on 1–3. The growth engine you asked to
   rebuild. Ship the pipeline through "personalized audit summary + next-best-
   action + human-approved outreach"; defer conversion-learning.
5. **Briefing Agent.** Fold home_brief + ai_triage + the cut narrators into one
   ranked, explained morning brief.
6. **Reporting + Comprehension.** Client-facing retention artifacts.

Recommended first build: **the AI Gateway**, because every other item is cheaper,
safer, and measurable once it exists — and it's the one thing that turns 19
scattered calls into a workforce you can actually manage.

---

## Addendum — prompt caching, PROVEN (2026-07-05, staging)

A controlled probe (padded system prompt, write-then-read pairs) settled the
caching question definitively:

| Cached prefix size | 1st call (write) | 2nd call (read) |
|---|---|---|
| ~2,382 tok (drafting today) | 0 | 0 |
| ~4,578 tok | 4,578 | 4,578 |
| ~6,778 tok | 6,778 | 6,778 |
| ~11,178 tok | 11,178 | 11,178 |

**Conclusion:** the gateway's caching is wired correctly (version `2023-06-01` +
`anthropic-beta: prompt-caching-2024-07-31` + `cache_control: ephemeral` on the
system block). It activates cleanly once the cached prefix clears the model's
minimum. **Claude Haiku 4.5's minimum cacheable prefix is ~4096 tokens** — higher
than the 2048 of older Haiku, and above both the concierge (~1.9k) and drafting
(~2.4k) prompts. So those legitimately do not cache; that is expected, not a bug.

**Design implication (drives future agents):**
- Caching helps on the `fast` (Haiku) tier only when the shared system prefix is
  genuinely large (>4096 tok) — e.g. the Website Analysis Agent's full audit
  rubric, or a rich reporting brief.
- On the `deep` (Sonnet) tier the floor is ~1024 tok, so deep-tier agents cache
  readily. Route caching-sensitive, large-context work through `deep` when the
  quality/caching tradeoff fits.
- Do NOT inflate a prompt just to cross the floor. Let caching follow from
  prompts that are large because they need to be.
