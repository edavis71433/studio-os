# Free Tools audit — 2026-10-26

Scope: everything built for the Site Review and AI Visibility Check (Phases 1–4), at commit 56c135f. Four independent reviews (gate/data/email, Site Review, AI Visibility, page/PDF/ops), each ran the test suites and probe scripts against the real modules; the top items in each were re-checked by hand. Live usage data came from the production database.

Verdict: the build is sound where it matters most. All 186 tests pass, report data never leaks, no XSS path exists on the pages, the database is locked to the service key, Turnstile is verified server-side on every scan, and the emails escape every user string. The findings below are about abuse resistance, accuracy of what the tools say about a real site, and polish. Nothing here is on fire; the first group should be fixed before the tools get real traffic.

Priority key: **P1** fix before promoting the tools · **P2** fix soon (wrong or embarrassing results) · **P3** polish and enhancements.

---

## 1. Gate, data and email (security and cost)

| # | Pri | What | Where | Fix |
|---|-----|------|-------|-----|
| 1.1 | ~~P1~~ not exploitable | Per-IP limits trust the **first** address in `X-Forwarded-For`. **Probed in production 2026-10-26:** 14 unlock calls with 14 different spoofed values all landed in one rate bucket, so Supabase's gateway replaces the header and the first entry is the real client. No change needed; the code now carries a comment saying so. | `_shared/tools/guard.ts:16-18` | None. Re-probe if the functions ever move host. |
| 1.2 | P1 ✅ PR | Spend cap is check-then-charge: cost is logged only after a scan finishes (20–40 s). Many scans started at $9.90 all pass. A scan that dies mid-way is never counted. *(confirmed)* | `guard.ts:159-166` | Reserve an estimated cost in `beginScan`, reconcile in `finishScan`. |
| 1.3 | P1 ✅ PR | Unlock emails any typed address, from `eric@davisdigitalstudio.com`, with the visitor's free-text name in the greeting ("Hi Pat — your invoice is overdue…") and a PDF. `consent_marketing` is recorded from the request body unverified, and the report email is sent as "critical", overriding a prior opt-out. | `unlock-report/handler.ts:85-90,113`, `email.ts:57,70`, `email_infra.ts:67` | Drop or whitelist the name in the greeting; treat consent as pending until a click; respect opt-outs; consider sending from a sub-domain. |
| 1.4 | P2 | Unlock is not atomic: a double-click creates two leads, two emails, two alerts, and burns both weekly unlocks. A DB error after `rateHit` still spends an unlock. The test fake returns 204 for every PATCH so tests can't catch it. | `unlock-report/handler.ts:71-93` | PATCH with `unlocked=is.false` and `Prefer: return=representation`; treat zero rows as already unlocked. |
| 1.5 | P2 | IPv6-mapped IPv4 literals in hex (`[::ffff:7f00:1]`, NAT64, 6to4) pass the SSRF guard on redirect hops; only dotted `::ffff:a.b.c.d` is caught. Exploitable only if the runtime has a dual-stack socket (unverified). | `url_guard.ts:23-34`, `site_discovery.ts:149` | Parse the literal to 16 bytes, extract the embedded IPv4, run the IPv4 block on it. |
| 1.6 | P3 | DNS is resolve-then-fetch (rebinding window); a host with an empty A set falls through as allowed. | `url_guard.ts:59-66` | Reject empty answers; document the limitation. |
| 1.7 | P3 | Raw email is written to `tool_usage_log` (header comment says it never is); IP-hash salt defaults to the service-role key; nothing prunes `tool_usage_log`, `rate_limit_state`, expired cache rows. | `guard.ts:61-63,117` | Set `TOOLS_HASH_SALT`; store an email hash; add a pg_cron purge. |
| 1.8 | P3 | `logUsage` for blocked/cache-hit paths is fire-and-forget (not awaited, not in `waitUntil`) so attack signals can be lost; `suppressionOf` has no timeout. | `guard.ts:136,154`, `email_infra.ts:41` | `waitUntil` the log; add `AbortSignal.timeout`. |
| 1.9 | P3 | Lead-alert subject and Reply-To are visitor-chosen text (CR/LF not stripped). | `email.ts:89,105`, `send-lead-alert/handler.ts:39` | Fixed subject; business name in the body. |

Checked and sound: Turnstile fail-closed with 10 s timeout; atomic `rate_hit` with correct UTC windows and LA-local spend day; UUID report ids, teaser cut server-side, cached copies are locked clones; `send-lead-alert` needs the service key (constant-time compare); RLS on, anon revoked, indexes cover every query; `esc()` on every HTML email string; `pdfName` sanitised; unsubscribe HMAC + one-click headers; CORS allow-list with `Vary: Origin`; `fetchPublic` guards every hop, 3-hop cap, body cap; error bodies are generic.

## 2. Site Review (accuracy on real sites)

| # | Pri | What | Where | Fix |
|---|-----|------|-------|-----|
| 2.1 | P2 | City field "Burbank, CA" or "Burbank and Glendale" never matches, so a correct site gets a **Fix now** local failure (weight 3, about −33 Local points). *(confirmed)* | `site_review/checks.ts:412-421` | Split on `,`/`and`/`&`/`/`, drop state codes, pass on any token. |
| 2.2 | P2 | A homepage title under 30 or over 60 characters is **Fix now**. Most Squarespace/Wix titles ("Sample Bistro") trip it, and it lands in the teaser ahead of real problems. *(confirmed)* | `checks.ts:138-144` | Homepage out-of-range → warn, or fail only under 20 / over 70. |
| 2.3 | P2 | "First screen" is cut at the first `<h2>`, so the H1 → tagline H2 → button hero (the default on Squarespace 7.1, Wix, Webflow) reports "doesn't ask visitors to do anything" as **Fix now** (weight 3). | `html.ts:153-158` | Cut at the second `<h2>` or after the first link/button; scan submit inputs. |
| 2.4 | P2 | Cloudflare's bot-management script (`/cdn-cgi/challenge-platform/…`) on a normal 200 page counts as a bot wall → "Your site blocked our checker" and the lead is sent to Calendly. *(confirmed)* | `crawl.ts:25-27` | For 200s require a challenge title or near-empty body. |
| 2.5 | P2 | Shopify and any site with pages one level deep (`/pages/about`, `/collections/all`) is reviewed from the homepage plus one page, with no note saying so. *(confirmed)* | `crawl.ts:96-108` | Treat `/pages|collections|blogs|products/<slug>` as top-level, or allow depth 2 when under 3 top-level candidates. |
| 2.6 | P2 | Footer legal pages (`/privacy`, `/terms`) get crawled; a `noindex` on them becomes **Fix now** and their short titles warn. | `crawl.ts:47,104-106`, `checks.ts:216-222` | Add legal slugs to `SKIP_PATH`; inner-page noindex → warn. |
| 2.7 | P2 | Business type "Other" fails specific schema (`Dentist`, `Attorney` → "not a type specific to a other business"); `AutoRepair`, `Hotel`, `RealEstateAgent`, `LegalService` aren't recognised as businesses at all → **Fix now** and NAP checks skipped. | `checks.ts:74,77,266-274` | For `other`, pass any LocalBusiness subtype; extend `LOCALISH`; fix the article. |
| 2.8 | P2 | Street-address regex takes the first hit in the whole page: "5000 square feet" becomes the address and triggers a NAP mismatch warning. | `html.ts:81,148`, `checks.ts:445-447` | Require state+ZIP nearby; prefer the footer match. |
| 2.9 | P2 | Narrative grounding checks numbers only in `title`/`what_we_found`, so Haiku can still put "53% of visitors leave after 3 seconds" in `why_it_matters`/`fix`; and it is over-strict where it does apply (a legitimate "30 to 60 characters" in `what_we_found` throws the finding back to the template). *(confirmed)* | `narrative.ts:72-79` | Check all four fields; add the known thresholds to the allowed set. |
| 2.10 | P3 | Pages over 2 MB are truncated silently (Wix SSR pages often are) and the footer, where address/phone/social live, is the part lost → up to six false findings. | `site_discovery.ts:160-166`, `scan.ts` | Raise the homepage cap to ~4 MB; when truncated, add a note and set those checks to `na`. |
| 2.11 | P3 | http→https probe follows one hop only; `http → http://www → https` fails as "insecure version still open". | `crawl.ts:144-148` | Follow up to 3 hops through the guard. |
| 2.12 | P3 | Heading-order check includes footer h4–h6 column titles, so builder footers always warn. | `html.ts:114,183`, `checks.ts:195` | Compute from `contentHtml`. |

Checked and sound: scoring math (no NaN, no out-of-range, `na` skipped, live-pillar reweighting); PSI mobile+desktop in parallel with timers cleared and Lighthouse 13 ids; budget arithmetic leaves ≥16 s for checks + narrative in the worst case; SSRF/redirect handling; dedupe by final path; structured-output narrative with refusal/max_tokens handling and correct Haiku pricing ($0.001–0.002 per scan); single done/error on the stream; Turnstile token consumed once per submit; robots.txt precedence; canonical tolerance.

## 3. AI Visibility Check (accuracy of what it says)

| # | Pri | What | Where | Fix |
|---|-----|------|-------|-----|
| 3.1 | P2 | "Sources AI cited" merges every URL **returned by web search** with the real citations. So "Yelp was cited in 5 answers" and "Your website was cited in 2 answers" mean "showed up in search results", not "was read". Drives the Sources table, the own-site check, the "AI leans on Yelp" finding and competitor attribution. *(confirmed)* | `ai_visibility/engines.ts:34-41`, `score.ts:76-84,197,221-231` | Keep cited and returned as two lists; drive findings from citations. |
| 3.2 | P2 | "Where the wrong facts came from" is chosen **alphabetically** when every source has count 1 (one flagged answer), so the fix told you to correct davismedia.org and davismedia.studio, two unrelated domains. *(confirmed on the live report)* | `score.ts:83,211` | Attribute only to sources the flagged answer cited, prefer directories, else drop the clause. |
| 3.3 | P2 | `confused_with_other` fires when the AI **correctly** says "the closest match is X, which is a different business". That cost 25 Accuracy points on the Davis Digital Studio report and produced the mix-up headline. | `extract.ts:85-87`, `score.ts:139-140` | Flag only when another business's details are attributed *to the target*; a "did you mean" is `knows: no`, no flag. |
| 3.4 | P2 | Name match accepts any longer name containing all tokens of a short one, both ways: `Union` = `Union Station Cafe`, `Joe's Pizza` = `Pizza`. Inflates recommendation rate for one-word names and merges distinct competitors. *(confirmed)* | `extract.ts:45-55` | Require the shorter side to be the target, or ≥2 shared distinctive tokens. |
| 3.5 | P2 | City contradiction turns neighborhoods into mismatches ("Los Angeles" vs "Silver Lake"), so the business can be listed as its own competitor; `DavisDigitalStudio.com` as a mention doesn't match either. | `extract.ts:51-54` | City as a tiebreaker only when the name match is weak. |
| 3.6 | P2 | Retail and home-services questions ignore the search phrase in 4 of 5 questions ("What's the best home services company in Burbank?" for an emergency plumber) and pluralise as "companys". *(confirmed)* | `prompts.ts:55-60` | Use the phrase-driven set for every type when a phrase is given; proper plurals. |
| 3.7 | P2 | No retry on 429/529: one attempt per question, 7 concurrent Sonnet calls; four failures kill the scan after the money is spent and the attempt still counts against the visitor's 3/hour. | `engines.ts:80`, `scan.ts:92-95` | One retry with backoff when budget allows; stagger the calls. |
| 3.8 | P2 | Extraction budget collapses to 3–6 s when engines run long (`Promise.all` waits for the slowest, then `max(3000, min(12000, deadline-now-14000))`); timed-out answers silently drop out of every denominator. | `scan.ts:82,104` | Extract each answer as it arrives; add a note when N answers couldn't be read. |
| 3.9 | P2 | Readiness "about/services page" requires separate pages with matching paths and ≥150 words; every one-page site fails (−25 readiness points). | `readiness.ts:104-107` | Pass when the homepage has enough words under an about/services heading. |
| 3.10 | P3 | Structured-data check takes the first business-like node, not the richest, so an `Organization` stub before a full `LocalBusiness` warns "missing address and phone". | `readiness.ts:54-60` | Score candidates by name/address/phone. |
| 3.11 | P3 | `NOT_A_COMPETITOR` is case-insensitive for acronyms: "Score Pilates", "Sba Landscaping", "Tourism Bakery" are dropped. | `score.ts:38` | Case-sensitive test for the acronyms. |
| 3.12 | P3 | `max_tokens: 3000` counts thinking across the whole server-tool turn (truncated answers → error, no retry); cost is always computed at Sonnet rates even when `fallbacks` served another model (`j.model` ignored); country hard-coded `US`. | `engines.ts:64,66,79` | Raise max_tokens; log `j.model`. |

Checked and sound: score math (position weights, 40/25/20/15 with live-pillar renormalisation, Accuracy null when never discussed, no NaN); competitor dedupe per answer and target exclusion; source canonicalisation; no business-name leakage into unbranded questions; strict extraction schema with caps; current API shape (`web_search_20260209`, server-side fallback beta, `pause_turn` resumed); ambiguity check ~$0.0003 and skipped with detail; robots parsing; narrative grounding on title/what; `rebuildFromRaw` reproduces scores bit-for-bit; raw_results ~100 KB with no visitor PII; front-end NDJSON reader and Turnstile reset. Cost sanity: $0.30–0.43 per scan is the expected range, $0.31 is typical, not a ceiling (live: $0.31 and $0.40).

## 4. Pages, PDF, delivery and ops

| # | Pri | What | Where | Fix |
|---|-----|------|-------|-----|
| 4.1 | P2 ✅ PR | After unlock the page says "A copy of this link is on its way to …" whenever `email_queued` is true, which is **before** the email is attempted. If Resend is down or the address is suppressed, the visitor is told it's coming and closes the tab. *(confirmed)* | `tool-report.js:256`, `unlock-report/handler.ts:121` | "Should arrive in a few minutes; bookmark this page just in case." |
| 4.2 | P2 | `app.davisdigitalstudio.com/report/<id>` serves the page, but the function only allows the `davisdigitalstudio.com` and tools origins, so the report shows a misleading "check your connection" error on the app host. *(confirmed live)* | `_redirects:85`, `config.ts:62-67` | Host-scoped 301 from app. to tools. for `/report/*`, `/site-review`, `/ai-visibility`. |
| 4.3 | P2 | `/report/*`, `/site-review`, `/ai-visibility` are served `Cache-Control: public, max-age=3600` (the `/*.html` no-cache rule doesn't match clean URLs); no `X-Robots-Tag` on reports. Staleness after a deploy, not leakage. *(confirmed live)* | `_headers` | Path-scoped block: `no-cache`, `X-Robots-Tag: noindex`. |
| 4.4 | P2 | If Turnstile never loads (Brave, uBlock, corporate proxies), the page waits 10 s silently, then every submit says "One moment while we check you're a person" forever. | `site-review.js:26-31,136-140`, `ai-visibility.js:22-26,131` | After the wait or on `error-callback`, explain and link Calendly. |
| 4.5 | P2 | Back button after a finished scan restores a dead loading screen from bfcache (`busy = true`, form hidden, no `pageshow` handler); no client watchdog if the stream stalls. | `site-review.js:80-88,123-126`, `ai-visibility.js:77-84` | `pageshow` reset + ~150 s watchdog. |
| 4.6 | P2 | Static site and functions ship on different triggers (Netlify on push; functions on manual dispatch) with no static-host smoke test. A page change that needs a new function field is live before the function is. | `deploy.yml:11-21,136-147` | Curl the tools pages in the smoke; document the "functions first" rule. |
| 4.7 | P3 | Contrast: gold `#b08d57` on white (3.09:1) and `#9a7134` on cream (3.82:1) on small labels; `<main aria-live="polite">` wraps the whole report; focus is dropped after unlock. | `tool-report.css:9,15,63,98,104`, `report.html:25` | Darker gold for small text; `aria-live` on the notes only; move focus to the unlocked content. |
| 4.8 | P3 | PDF: score-panel items don't wrap (overflow with highlights but no pillars); tables split without repeating the header and headings orphan at page bottom (seen on the live PDF, pages 3–4); "Online version" line can land alone on a new page. | `pdf.ts:100-123,146-148,182-190` | `need()` for the first row before the heading; redraw header after a break. |
| 4.9 | P3 | Non-Latin business names become "???" in the PDF headline (Korean, Armenian, CJK, Š/Œ). | `pdf.ts:24-31` | If encoding turns half the name into `?`, use the URL or "Your report" for the headline. |
| 4.10 | P3 | `sitemap.xml`, `manifest.json` shortcut and `sw.js` still name `/audit`, `/local-visibility`, `/roi-calculator`, `/pricing-estimator`, `/tools`; the tools pages are in no sitemap; `/free-site-review` is a two-hop redirect. | `sitemap.xml`, `manifest.json:26-30`, `sw.js:12`, `_redirects:58-60` | Update all three; add the tools pages to a sitemap. |
| 4.11 | P3 | The service worker (registered by older app pages) is cache-first for `/report/*` on the app host. | `sw.js:92-104` | Exclude tool paths; bump `CACHE_NAME`. |

Checked and sound: no `innerHTML` anywhere with report data; the only data-driven href is the server constant Calendly URL; `?api=` override is localhost-only; report JSON is `no-store`; `noindex` meta + `referrer: no-referrer` on report pages; HSTS, frame DENY, nosniff, CSP covering Supabase/Turnstile/fonts; redirects correct and 301 targets live; PDF byte offsets exact (parses cleanly, 4 pages, link annotation present); PDF content and order match the web report; emails have text alternatives and one-click unsubscribe; print CSS; table headers and ARIA on the ring; deploy gate runs every suite and `deno check` first.

## 5. Live numbers (production, through 2026-10-26 07:04 UTC)

- Site Review: 3 scans, 21–30 s each, ~$0.001 each, narrative from Claude every time.
- AI Visibility: 5 scans + 1 ambiguity stop (Starbucks). 28–34 s each. Cost $0.94 and $0.68 on Opus; $0.31 and $0.40 on Sonnet.
- 7 blocked attempts (rate-limited or Turnstile failed), all from testing. 4 live AI cache rows, 3 Site Review rows. 3 leads (all Eric's addresses). Spend "today" is counted in Pacific time.
- Supabase edge logs show something polling `GET /health` every 5 minutes and getting 403 (pre-existing, not part of this build).

## 6. Enhancements worth doing (beyond fixes)

1. **Cost reservation** in `beginScan` (fixes 1.2 and counts dead scans).
2. **Cited vs returned sources**, shown as two columns ("Claude read Yelp in 3 answers; your site showed up in search but was never read"). Sharper and more honest.
3. **Extract each answer as it arrives** and start the website readiness check before the ambiguity check: 5–10 s off the critical path, and no extraction squeeze.
4. **Phrase-driven questions for every business type**, plus a category for each named business so off-trade names ("Advanced Computer & Technology" for web design) show as "also named (different trade)" instead of competitors.
5. **B2B directories** (clutch.co, upcity, designrush, expertise.com, linkedin.com) in `DIRECTORIES` so service businesses get a named "AI leans on X" fix.
6. **Detect JavaScript-only shells** in Site Review and emit one note with Search/Content checks `na`, instead of a dozen thin-content failures.
7. **`HEAD /favicon.ico` fallback** before warning "No site icon".
8. **Start discoverability and the https probe alongside the homepage fetch**: 1–3 s per scan.
9. **Self-host Inter/Playfair** from `/fonts` with preload: two fewer render-blocking third-party requests on the lead pages.
10. **Static-host smoke in deploy.yml** plus a multi-page PDF test with a real parser.
11. **pg_cron retention**: `rate_limit_state` > 8 d, expired cache, null `tool_usage_log.email` after 90 d.
12. **Send from a sub-domain** (`tools@mail.…`, Reply-To eric@) to isolate domain reputation from unlock-form abuse.
13. **Prompt caching** on the shared extraction prefix; log `j.model` per answer so fallback-served answers are visible in cost reports.
14. **Log Turnstile `error-codes` and `hostname`** in the blocked note, so 403s become a signal (misconfigured key vs bots).
15. **Add the thresholds and derived counts** to the narrative payload so more Claude text survives grounding.
