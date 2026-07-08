# Phase INF — Hosting, DNS & Infrastructure Excellence

*Phase U's audit verdict stood re-verification: the invisibility ideal was already substantially built (Foundations Desk in plain words, plan-gated DNS with rollback, auto SSL/CDN, the launch assistant, cross-region watchdog). This phase shipped the approved remainders that naturally fit — the domain watch (CP-8/FD-INF3) and registrar-aware guidance (FD-INF2-lite) — and honestly deferred the one that doesn't yet.*

## Shipped (verified: rdap 10/10, lifecycle 22/22, live cycle shows the watch)

**The Domain Watch (CP-8 / FD-INF3).** Every custom domain is checked daily via RDAP (keyless, registry-authoritative): the platform learns **when it expires and where it's registered**, stores both on the site (agency roll-ups become cheap later), and — inside 30 days — warns the owner with a notice + email in the calmest possible words: *"yourdomain.com expires in 12 days at GoDaddy. Renew it at your registrar (auto-renew is the calm option) — if it lapses, your website and email stop answering. Nothing else is needed on our side."* Inside 7 days, ops gets alerted too. Monthly dedupe; 24-hour per-domain check spacing; fenced 6-second lookups that never throw. **This is the failure registrars profit from and hosting companies ignore — a lapsed domain silently kills a site, and now it can't happen silently.**

**Registrar-aware Foundations (FD-INF2-lite).** The Foundations Desk's "your address" sentence now names reality: *"Your address is yourdomain.com, registered at GoDaddy — renews March 2027."* — followed by that registrar's own navigation (*"At GoDaddy: My Products → your domain → Manage DNS"*) for GoDaddy, Namecheap, Cloudflare, Squarespace (including the Google Domains migration), Porkbun, Wix, IONOS, Network Solutions, with an honest generic fallback. The single most disorienting infrastructure moment — "where do I even go?" — now comes with directions.

## Honest deferrals (with the engineering reasons)
- **CP-7 NAP drift-watch**: verified this phase that the GBP adapter's normalized data carries only rating/review metrics — **no name/phone** — so the comparison needs a read-scope extension in the connected engine. It rides with SD-5 (the Search Console provider work, post-Playwright) where that engine is already being opened. Not skipped — sequenced with its true dependency.
- **FD-INF4 agency bulk domain view**: the stored `domain_registrar/expires_at` fields make it a cheap UI read now; deferred to ride the next agency-surface touch rather than reopening the portfolio pipeline solo.
- **FD-INF1 in-product domain purchase**: unchanged (reseller integration; V1.1+).

## Steps 3–5 verdicts (re-verified)
Customers: connect/move/recover/understand — all plan-gated plain-words flows ✅; now with expiry protection + registrar directions. Agencies: per-client desks + the watch covering every linked domain automatically; bulk view queued cheaply. Admin: zero new manual work — the watch, watchdog, digest, and lifecycle all ride the same 15-minute cron; ops only hears about a domain when it's 7 days from death.

## Competitor benchmark (Step 2 — where Studio OS sits, honestly)
- **Cloudflare / Route53 / Netlify / Vercel**: infrastructure consoles for people who *want* to see records. Studio OS deliberately competes on the opposite axis: the customer never sees a record — plans propose, approval applies, rollback undoes. Not comparable surfaces; ours wins for the non-technical owner by definition, theirs for engineers.
- **Squarespace / Wix / Shopify**: closest UX peers — they hide DNS well *for domains they sell*, but BYO-domain guidance is generic ("contact your registrar") and none of them watch a customer's external domain for expiry. The Domain Watch + registrar-named directions now beat all three on the BYO path, which is exactly Studio OS's V1 path.
- **GoDaddy / Namecheap / Porkbun**: registrars profit from lapses and upsells; their renewal emails are marketing-shaped and ignored. Our reminder arrives from the party with nothing to sell, in calm words, with directions into *their* dashboard.
- **Entri / Google Domains-era UX**: Entri-class API auto-connect (records written for you at the registrar) is the one genuinely better mechanism we lack — that's FD-INF2-full, V1.1, and the lite version shipped here is the honest 80%.

## Final questions (answered honestly)
- **Can a customer completely ignore hosting?** Yes — Netlify is invisible; publish/SSL/CDN/caching are outcomes, never surfaces.
- **Completely ignore DNS?** Almost — connecting a BYO domain still means pasting 2 records at the registrar once, but with plan-generated values, registrar-named directions, verification, and rollback. Removing that last paste = Entri-class API (V1.1).
- **Completely ignore SSL?** Yes — issued, renewed, monitored automatically; no customer surface exists, only the green result.
- **Completely ignore email authentication?** For sending: yes — the platform sends from its own authenticated domain. For customers' own MX/SPF on BYO domains: we don't manage their mailbox provider, and honestly say so in the Foundations Desk rather than pretending.
- **Can an agency comfortably manage 100 websites?** Yes for operations (plans, bulk publish, per-client desks, the watch covers every linked domain automatically with zero per-site setup). The portfolio *view* of domain status is the recommended cheap next read (below).
- **Can Studio OS legitimately outperform traditional hosting companies by making infrastructure disappear?** Yes — they sell visibility into infrastructure; we sell its absence, and now also its *supervision* (watch + watchdog + digest), which even the hide-it competitors don't do for BYO domains.
- **Would I personally trust Studio OS to host my own business?** Yes — deny-all RLS, approval-gated changes with rollback, cross-region watchdog, PITR-capable Postgres, export door always open, and now expiry protection. The one caveat I'd give myself as a customer is the same one on the launch board: the human live-browser QA pass hasn't happened yet (Playwright phase is next by design).
- **Anything else before launch?** Nothing new in infrastructure. Everything else outstanding is already tracked and sequenced: Playwright E2E (next phase), owner activation keys, the pre-launch reminder list, and the front-door fence.

## The ONE naturally-emerged recommendation
Now that expiry + registrar live on the site row, **surface them in the agency portfolio as a quiet per-client line** ("domain renews Jan 2027 · GoDaddy") — FD-INF4's cheap half, one read, no new pipeline. Recommend building it with the next agency touch. **Not built — awaiting approval.**

**Phase INF — Hosting, DNS & Infrastructure Excellence complete.**
