# AI Policy — Usage, Disclosure & Responsible AI

*Covers deliverables 6 (AI Usage Policy), 7 (AI Disclosure), and 8 (Responsible AI Statement). Every statement is verified against the implementation.*

---

## Part 1 — AI Usage Policy

**What AI does here.** AI *assists* you: it drafts text (Writer/Editor), suggests seasonal opportunities (Growth Coach), and generates images from your description (Visual Studio). It never operates on its own.

**What we send to AI — and what we never send.**
- The **Writer/Editor** receive only the **business facts** you're drafting from, plus your instruction. The **Visual Studio** receives only a **text description** (plus your brand cues).
- We **never** send: your account credentials, your connected-service tokens, other customers' data, or **your uploaded photos**.
- The **Concierge does not use an AI model at all** — it answers deterministically from your own data.

**What's stored.** AI outputs are stored as *your* drafts until you approve or discard them. Approved outputs become your content.

**Gating.** AI features are off unless enabled with a provider key; when off, they say so honestly and the manual path still works.

---

## Part 2 — AI Disclosure (customer-facing)

> **AI-assisted, always with you in control.** Studio OS uses AI to help you draft words and images faster. You review and approve everything before it's used; you can always do it by hand instead; and what you approve is **yours**. We never invent facts, we never publish on our own, and we never send your photos or account details to AI models.

This disclosure is shown at first AI use and summarized on AI surfaces.

---

## Part 3 — Responsible AI Statement

We hold AI to the same laws as the rest of the product:

- **Human approval, always.** AI never publishes or changes anything on its own. Every AI action ends in a step where you approve or reject.
- **Manual parity.** Every AI workflow has an equal manual path that is never slower, hidden, or degraded. You can use the entire product without ever touching AI.
- **No fabrication (the fact law).** The Writer may state only facts you've provided; missing facts become a question to you, never an invention. The Brand Guardian vetoes unattributable claims. Generated **images** are scrubbed of claim-language (no awards, ratings, "#1," or prices) — they are graphics, not evidence.
- **Ownership & provenance.** Approved AI output is yours; we record `ai_approved` provenance for honesty, never to limit your use.
- **Privacy by design.** Minimal, purpose-limited prompts; no credentials or photos sent to models; the Concierge uses no model.
- **Honesty over capability.** If an AI feature isn't enabled, we say so; we never fake a result.

**Limitations.** AI-generated text and images can contain mistakes; that is exactly why approval and manual parity are mandatory. You are responsible for reviewing AI-assisted content before publishing.

*Verified in the [Data Governance & Privacy Audit](../presence/DATA-GOVERNANCE-PRIVACY-AUDIT.md) §5 and the [AI Visual Studio](../presence/AI-VISUAL-STUDIO.md) design.*
