# Customer & Administrator Guide — Studio OS Presence

Plain-language guide for the people who use the product: the **customer** (a small-business owner) and the **administrator/operator** (studio staff who support them). No engineering knowledge required.

---

## Part A — Customer User Guide

### Getting started (onboarding)
1. **Sign up & choose a plan** from the public site → checkout → your workspace is created automatically (one workspace per account).
2. **Your two screens:** **Today** (`today.html`) is your calm daily view — at most a few things worth a look. **Your workspace** (`portal.html`) is where you edit, create, and publish.

### The daily rhythm — Business Moments
Open **Today**. If nothing needs you, it says so. If something does, you'll see a short, plain-language card — never a score or a dashboard. Tap **"Walk me through it"** to have the Concierge explain, or **"Not now"** to set it aside. Good news is celebrated quietly.

### Editing your content
In your workspace, edit your business info, hours, offerings/menu, FAQs, photos, and updates. You edit **facts**, not pages — the site is built for you. Everything you change stays a **draft** until you publish.

### Creative Studio (writing help)
Ask for a draft (an update, a description) and you'll get options in your voice. You **always approve** before anything is used, and you can always write it yourself — the manual way is never slower or hidden. Nothing is invented: if a fact is missing, you'll be asked for it.

### Visual Studio (images)
Need a page banner, a social post, or a link-preview image? Describe it in your own words; you'll get a few options shaped by your brand. Pick one, add a short description, and it's saved to your library. Your own photos always work too — this never replaces them. *(If it says "not switched on yet," image-making isn't enabled for your studio — uploading still works.)*

### Connecting a service
On **Your connections**, connect the services you already use — your Google listing, reviews, analytics. Everything is **read-only**, always with your approval, and yours to **disconnect any time** — your account is untouched. Connecting simply lets Presence be more sure and helpful. *(If a service reads "not available yet," it isn't enabled in this environment yet.)*

### Growth
The Growth Coach quietly suggests the right thing at the right season. You approve; the studio prepares. It encourages, never nags.

### Publishing
When your draft is ready, **Publish**. Your live site updates atomically; every version is kept, so you can **restore** any earlier version. If a publish ever fails, your live site is unchanged and nothing is lost.

### Ownership
Your content and domain are always yours. You can **export everything** you own at any time and leave — no lock-in, no metered fees.

---

## Part B — Administrator / Support Guide

- **How you work:** through the presence **admin API** with a staff login (entitlement-bypass). Routine operations never need the Netlify dashboard or direct database access. Step-by-step procedures: [RUNBOOKS](RUNBOOKS.md) + [runbooks/](../runbooks/).
- **New customer → live site:** provisioning is idempotent (re-running repairs a partial state). See [RUNBOOKS § Creating a new customer](RUNBOOKS.md).
- **Approving / rejecting work:** infrastructure, connected writes, marketplace, and org changes are Approved Plans — review the plan (what changes / what stays / risk / rollback) and approve or abandon. Everything is audited.
- **Editions & capacity:** plans gate capability; generative AI has a generous soft monthly envelope that raises one calm notice when exceeded (never a hard block, never a number shown). See [OPERATIONS](OPERATIONS.md).
- **Advanced tiers:** Marketplace (pack install), Enterprise (multi-location), Agency (portfolio/queues) are operator surfaces — see their docs.

---

## FAQ

- **Does it change my site automatically?** No. Nothing goes live until you publish; AI only drafts.
- **Can I do everything by hand?** Yes — every AI feature has an equal manual path.
- **Are my connections safe?** They're read-only, approved by you on the service's own screen, and disconnectable any time; your account is untouched.
- **Are AI images "mine"?** Yes — an image you approve is yours, the same as anything you type; we record that it was AI-made for honesty only.
- **What if I want to leave?** Export everything and go — your content and domain are yours.

## Troubleshooting

| Symptom | Meaning / action |
|---|---|
| "Not switched on yet" / "not available yet" | That feature's key/app isn't set in this environment (owner activation) — not an error. |
| A connection shows "Needs a quick reconnect" | The service's permission expired — reconnect it. |
| Publish didn't go through | Your live site is unchanged; try again. Persistent failures → support. |
| "Please sign in" | Your session ended — sign in again. |
| AI draft asks for a fact | The Writer never invents facts — provide the missing one. |

## Known issues (V1)

- Live third-party features (Google connections, AI drafting, AI images, live billing) require **owner activation** (keys/apps) before they work end-to-end — until then they read honestly as "not available yet." See [Owner Activation](RELEASE-NOTES.md#owner-activation-checklist).
- Marketplace / Enterprise / Agency have no self-serve **customer** UI in V1 (operator-run; UIs deferred to V1.1).

## Support

Operators: use the runbooks and the admin API. Escalate genuine defects (not activation gaps) to engineering with the request id and plain description; the change/audit ledgers make any action traceable.
