# Open punch-list — things raised in conversation (living doc)

Purpose: we keep losing items to context compaction. This is the durable list of
what Eric asked for that is **outstanding or needs Eric**. Updated 2026-07-15.
Legend: ⏳ open · ✅ done this stretch · 🔑 needs Eric (key/secret) · 🚀 needs Eric's `git push` · ❓ needs Eric to clarify.

---

## Needs Eric (do these "all at once")

- ✅ **Stock photos** — DONE 2026-07-14. `PEXELS_API_KEY` set on prod + redeployed (the
  key was in an image Eric pasted, which a text search of the transcript missed). Turns
  on Files → Stock Library + the builder's "Stock photos" picker tab.
- ✅ **Migration `0106`** — Eric applied it. Security Advisor errors closed. (44 warnings
  + 84 suggestions remain — lower priority, mostly function search_path / advisory.)
- ✅ **`git push`** — Eric pushed; the builder/studio frontend is live.
- ✅ **Visual Studio (AI-generated images)** — DONE 2026-07-14. `VISUAL_MODEL_KEY` (an
  OpenAI key, `sk-proj-…`) set on prod + redeployed. Defaults to OpenAI images
  (`gpt-image-1`); if that model needs org verification, switch `VISUAL_MODEL_NAME` to
  `dall-e-3`. All owner keys now in.
- ✅ **Messages** — DONE 2026-07-15. Salesforce-style record thread shipped (messages live
  on the client record) + #181 inbox client grouping shipped. Pending function deploy to
  go live.

## Code — for me to do (Eric will batch-review)

- ✅ **Analytics / Google Search Console connection** — DONE. Reworded the agency card to
  operator framing ("connect it for them — it's your setup, not theirs") and made it a
  working action: links straight to that client's scoped connections
  (`/connections.html?client=<siteId>`) when one client needs it. Deployed.
- ✅ **AEM component parity — Table, Title, Link List, Spotlight** — DONE. All four built
  (backend + builder editor) and deployed; drop them from "Add section". (Existing set
  already had carousel/image/text/accordion/buttons/columns/etc.)
- ✅ **Convert flow** — VERIFIED, no bug. All 3 convert options already land the customer
  in the client portal (`client.html`); the CRM only keeps *your* operator view.
- ✅ **"Add a section shows nothing"** — root-caused + fixed: added blocks are now seeded
  with editable placeholder content so a content section renders the instant you add it;
  media blocks open their editor to pick a file. Deployed + in presence.html (push).
- ✅ **#184 Drop a component into a column** — DONE. A column cell can now hold any
  component (text OR media: video, image, gallery, feature list, stats, table, …) via an
  "Or drop a component here" picker per column, each with a mini-editor. Backend +
  editor, deployed. (1-column was already supported.) Containers can't nest (no infinite
  recursion). NOTE: media already worked standalone (Image/Video/Gallery/Carousel
  components + per-cell image) — this just adds nesting.
- ✅ **More visual templates/themes** (#183) — DONE 2026-07-15. Now **8 template families**
  registered (restaurant-classic, business-classic, editorial, aurora, slate, meadow,
  atelier, harbor — `lib/render.ts` LOADERS). Starter *layouts* remain at 13.

## Done this stretch (verify after push)

- ✅ Builder: real drag-and-drop, "+ Add one section" actually adds, repeat any section,
  remove any built-in section incl. the hero, blank canvas + delete template/page.
- ✅ Editable GLOBAL menu (nav) with dropdowns + page links (migration `0105` applied,
  backend deployed).
- ✅ 13 starter layouts, generic ones at top.
- ✅ Visual Studio added to the builder left rail.
- ✅ Sidebar folded into Design (Today · Design · Photos · Visual Studio · Bookings ·
  Reviews · History).
- ✅ `/studio` no longer silently bounces a no-workspace account to the client portal —
  honest panel + explicit portal link. (Cause of Eric's bounce: signed into /studio with
  a personal/owner-less account; sign in with the **dds owner** account.)
- ✅ AI writing helper in text components; image component uses uploaded photos.

## Backlog tasks already tracked (not conversation-lost — see task list)

#180 Files→Design fold ✅ (both increments) · #181 inbox client grouping ✅ (pending
function deploy) · #174 admin consolidation + freelancer/agency provisioning ✅ (agency
provisioner + invites + door; page retirements can follow) · #166 compliance/doc-truth
✅ docs half (LEGAL HALF NEEDS ERIC: terms/privacy platform-subscription sections +
OpenAI/Pexels in the privacy provider list — drafts on request) · #169 optimization
pass ✅ (migration 0109 + waterfall collapse + context dedupe + vendored supabase-js) ·
#172 final verification ✅ Tier 1 all green 2026-07-15 (see FINAL-VERIFICATION-RUNBOOK.md;
Tier 2 needs staging creds, Tier 3 owner items listed there) ·
#167 seamlessness redesign — STILL GATED, see the standing rule below; Eric declares
the gate clear, not a session.

## 🎨 ADOBE PARITY DECISIONS FROM ERIC (2026-07-15 — do not lose to compaction)

Scope: SMB/mid-market value only, not enterprise (his words: "just the things that
add value for a small/mid business"). Spec: ADOBE-PARITY-ATLAS.md (29 gaps, 3 waves).
The four philosophy decisions, made explicitly by Eric with tradeoffs presented:
1. Per-breakpoint controls → CURATED TOGGLES (hide-on-phone/desktop per section + safe presets).
2. Freeform canvas → **BUILD IT** — Eric chose to add a true drag-anywhere layout mode,
   overriding the founding "structured list, never x/y" law. Build with guardrails
   (snapping, containment, mobile auto-stacking). Large/architectural — design doc first.
3. Template-author tier → SAVE-AS-STARTER-LAYOUT (operator saves a page's arrangement
   as a reusable starter layout; no locked-template role).
4. Per-element style overrides → **ALLOW THEM** — Eric chose full per-element styling,
   overriding contrast-by-construction; ship with contrast warnings, not blocks.
Also standing: the builder (presence.html) joins the workspace brand system (increment 6),
now Adobe-informed: side panel (blocks/files/content-tree tabs), editor modes incl.
Annotate + Timewarp candidates, Page Information menu. Workflows: route-for-review UX
on top of the existing approvals + launches machinery.

**Delivery status 2026-07-16 (deploys #8–#11, all green):** G11 section comments
end-to-end (migration 0112 applied prod+staging) · G18 zoom+captions · G27 overrides
end-to-end (backend + "Style this section" popover; second design-doc decisions:
3 aspect presets · 12 elements/4 canvases caps · brand shades + Custom… hex ·
Apply-Brand clears colors only) · G25 freeform backend slice 1 (editor slice pending;
freeform = a section TYPE, templates/columns stay — Eric confirmed) · G5/G6/G7/G9/G10
publish-pipeline upgrades. NOW: increment 6 builder redesign (spec in
docs/design/builder-redesign-increment-6.md; before/after screenshots to Eric before
merge). Then: G13 in-place editing → freeform editor → G12+G34 → S-finishers →
G33/G14/G35.

## 🎯 CRM REDESIGN DIRECTIVE (Eric, 2026-07-16 — do not lose to compaction)

**"Be very aggressive on the redesign. Especially the messages. I wanted to look
just like salesforce."** Scope EXPANDED (Eric, same day): **the CRM AND the client
portal, redesigned together as one combined Salesforce-style effort** ("do both
simultaneously if you can"). Order is explicit: **"finish the redesign of the
Adobe part and then we can move onto the CRM and the client portal. One thing at
a time."** → increment 6 slices C+D complete FIRST, then CRM+portal, then the
Adobe Wave 2 features. Method: deep Salesforce Lightning UI research (running —
real docs/screenshots/SLDS component anatomy; no guessing, per his messaging
rule), then an aggressive combined spec with his decision points, then slices
with before/after screenshots for approval. Eric offered more links/references
on request. The Jul-14/15 Salesforce-parity work (one-thread-per-client record,
activity model, highlights panel, global search, AR view, deal to-dos 0107/0108)
is the FLOOR, not the target — Salesforce-grade look and organization end to
end, on both sides of the product.

## ⛔ STANDING RULE FROM ERIC (do not lose to compaction — he has repeated this many times)

**The redesign (#167) is GATED behind ALL other updates.** Order of work: updates
first, #172 final verification, only THEN #167. If a future session sees
"start the redesign"-type context, check this list first — if items are open,
do them instead.

**GATE STATUS: CLEARED by Eric 2026-07-15** ("as long as all the updates were done
we can do the redesign") — every update above shipped, deployed (functions +
frontend + migrations 0107–0110 in prod AND staging), and Tier-1 verified. #167
work may proceed: client portal first (increments 1–2 shipped; increment 3 =
approval-flow polish), then the studio side. The rule above still applies to any
NEW update Eric raises mid-redesign: new updates outrank redesign work.
