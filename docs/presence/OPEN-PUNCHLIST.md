# Open punch-list — things raised in conversation (living doc)

Purpose: we keep losing items to context compaction. This is the durable list of
what Eric asked for that is **outstanding or needs Eric**. Updated 2026-07-14.
Legend: ⏳ open · ✅ done this stretch · 🔑 needs Eric (key/secret) · 🚀 needs Eric's `git push` · ❓ needs Eric to clarify.

---

## Needs Eric (do these "all at once")

- 🔑 **Stock photos** — set edge secret `PEXELS_API_KEY` (free at pexels.com/api). The
  keys Eric sent earlier were **Stripe** (restricted/live) + VAPID — NOT Pexels. Stock
  photos won't turn on without a Pexels key. Turns on Files → Stock Library + the
  builder's "Stock photos" picker tab.
- 🔑 **Visual Studio (AI-generated images)** — set edge secret `VISUAL_MODEL_KEY`
  (separate from the Anthropic *text* key that already exists). This is why Visual
  Studio shows "not switched on."
- 🚀 **`git push`** — every builder + studio fix this stretch is frontend
  (`presence.html`, `studio.html`) and only goes live on Eric's push.
- ❓ **Messages** — Eric says he specified what he wants; it did not survive compaction.
  Messaging was audited + polished earlier (`messaging-ux-polish` merged) and the inbox
  groups client messages by client. **Need one line: what's actually wrong/missing now?**
  (e.g. clients can't message from the portal / grouping wrong / feels slow.)

## Code — for me to do (Eric will batch-review)

- ⏳ **Analytics / Google Search Console connection** (raised on analytics.html):
  - The "1 of 1 client hasn't connected Google Search Console" card is worded as if the
    *client* connects it. Eric: "I should be doing this, not the customer."
  - Reality: `connections.html` is an **operator** page and already supports connecting
    for a specific client via `?client=<siteId>` (→ `x-dds-scope-site`). So the operator
    CAN do it — it's just not framed or surfaced that way.
  - FIX: reword the GSC + Google Analytics "not connected" cards to operator framing;
    add a discoverable **"Connect their Search Console"** entry point in the client's
    profile (today only `crm.html` has a small "Connected services →" link). Scope the
    analytics card's link to the specific client.
- ⏳ **#184 Layout containers / columns** — Eric's repeated ask: "column controls on the
  templates," "each layout container you should also be able to choose a component,"
  "drop arbitrary blocks INTO each column." Columns block exists (1–6 cols, resize) but
  you can't yet drop *arbitrary components* into a cell. Needs render + serializer change.
- ⏳ **AEM component parity check** — Eric wants the full out-of-the-box set (carousel ✅,
  image ✅, text ✅, accordion ✅, buttons ✅, columns ✅, table?, Title, Link List,
  Spotlight). Verify Table/Link-List/Title/Spotlight are actually present (some were
  reverted mid-build) and add any missing.
- ⏳ **More visual templates/themes** (#183) — only 3 template *designs* exist
  (business-classic, editorial, restaurant-classic). Starter *layouts* were expanded to
  13, but Eric also wants more full theme designs.
- ⏳ **Convert flow** — "I selected 'building their site on their own platform' … it took
  me to the CRM … this should go to the client portal." Verify converted customers land
  in the client portal, not CRM.

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

#180 Files→Design fold · #181 inbox client grouping ("client msgs ONLY in client
profile" part) · #174 admin consolidation + freelancer/agency provisioning · #166
compliance/doc-truth · #167 seamlessness redesign · #169 optimization pass · #172 final
verification.
