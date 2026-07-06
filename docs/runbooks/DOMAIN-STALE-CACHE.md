# Runbook: Production Domain Serves a Stale Portal (RCAT B3)

**RESOLVED 2026-07-06 — gate PASSED (byte-MATCH both files, Server: Netlify,
fresh ETag, www 301→apex).** Root cause was TWO stacked layers, both now fixed:

1. **Namecheap "HTTPS ON" record toggle** (Advanced DNS → HTTPS column): when ON,
   Namecheap does NOT publish the record's real value — it answers with their own
   SSL proxy (`159.198.67.66`, `Server: APISIX`, hosting.namecheap.net), which
   proxies AND CACHES the origin, ignoring `no-store`. The panel showed
   `A @ 75.2.60.5` while authoritative DNS served the proxy IP — panel and zone
   disagree by design when the toggle is on. Fix: toggle OFF on `@` and `www`
   (Netlify provides SSL; the Namecheap proxy is never wanted). Diagnostic that
   cracked it: the zone's SOA serial is a Unix timestamp = last real change date.
2. **Domain attached to the wrong Netlify project**: `davisdigitalstudio.com` was
   owned by the old `dapper-empanada-3430e4` project (pinned to a weeks-old
   deploy), not `studio-os-dds`. With layer 1 removed, the apex served Netlify —
   but the OLD project's deploy (same-bytes marketing pages masked this; only
   files changed since that old deploy differed). Fix: remove both hostnames from
   the old project's Domain management, add them to `studio-os-dds`, Force HTTPS.
   The old project is kept (domainless) — safe to delete later.

**Standing lesson:** "serves Netlify headers" ≠ "serves OUR deploy." Only the
byte-check below proves the domain path. Run it after every deploy.

---

**Status when written (2026-07-05):** `davisdigitalstudio.com/portal.html` serves an
**11+ hour-old cached copy** that is missing code already deployed to the Netlify
origin. This is infrastructure, not code — no repo change can fix it. The RC
release gate is at the bottom of this file.

---

## 1. The evidence (reproduced twice, ~1h apart)

| Probe | Apex domain | Netlify origin |
|---|---|---|
| URL | `https://davisdigitalstudio.com/portal.html` | `https://studio-os-dds.netlify.app/portal.html` |
| `Server` | **APISIX** | Netlify |
| `Cache-Status` | `"Netlify Edge"; hit` | `"Netlify Edge"; fwd=miss` |
| `Age` | 39538 → **40292** (same object, aging) | 0 |
| `ETag` | `af331075d38611f0…` (stale) | `68e9c6f477a1918b…` (current) |
| sha256 vs `main` | **mismatch** (`815cd1ac…` vs `592fae95…`) | **byte-identical to `main`** |
| Messaging retry code (`_state`) | **0 markers (old build)** | 5 markers (current) |

- Cache-busting query strings (`?rcat=1`) do **not** bypass the stale copy.
- `Cache-Control: no-store` is being ignored by whatever is caching.
- Apex DNS resolves to a **single A record `159.198.67.66`** — this is **not**
  Netlify's documented apex load balancer (`75.2.60.5`), and `Server: APISIX`
  indicates a proxy layer in front of (or instead of) Netlify.
- `www.davisdigitalstudio.com` 301-redirects to the apex (also via APISIX).

**Conclusion:** deploys work (origin updates correctly); the apex path through
`159.198.67.66` serves cached content and ignores cache headers. Until fixed,
clients on the real domain receive old builds and future deploys silently
won't reach them.

## 2. Benign look-alike (do NOT chase this)

`index.html` / `privacy.html` on the origin differ from `main` by ~100–150
bytes. That is **Netlify Pretty URLs post-processing** (rewrites
`href="x.html"` → `href='/x'`, requotes attributes). Expected. Only
`portal.html` / `dds-studio-manage-9k2p.html` are served byte-exact, so
**byte-compare only those two** against git; spot-check marketing pages by
content, not hash.

## 3. Fix steps (registrar / Netlify console — manual, Eric)

**RESOLVED 2026-07-05: `159.198.67.66` is Namecheap web hosting**
(`airport-suddenness.rdns.hosting.namecheap.net`; RDAP owner Namecheap, Inc.,
range 159.198.64.0/20; answers for the domain with `Server: APISIX`, the
front of Namecheap's hosting platform). The apex A record points at a
Namecheap hosting/proxy product that mirrors and caches the Netlify site —
that's what ignores `no-store` and swallows deploys.

1. **Log into Namecheap** → Domain List → `davisdigitalstudio.com`.
2. If a Namecheap **hosting package / EasyWP / SiteLock-CDN** is attached to
   the domain, detach or disable it for this domain — that's the APISIX box.
3. **Advanced DNS** → delete the `@ → A → 159.198.67.66` record (and any
   URL-forwarding entries). Then either:
   - *Recommended:* switch nameservers to **Netlify DNS** (Netlify dashboard
     → Domain management → add `davisdigitalstudio.com` → follow the
     nameserver instructions), or
   - keep Namecheap DNS and add: apex **`@ A 75.2.60.5`** (Netlify's apex
     load balancer) + **`www CNAME studio-os-dds.netlify.app`**.
4. Set/keep the record TTL low (300s) until verified.
5. In Netlify: Domain settings → verify `davisdigitalstudio.com` +
   `www` both show green/managed, and force HTTPS is on.
6. **Purge:** Netlify dashboard → Deploys → "Clear cache and retry deploy"
   (or `netlify api purgeCache` with the site id). If the Namecheap hosting
   product had its own cache, disabling/detaching it (step 2) clears that layer.
7. Wait out DNS TTL (check the zone's TTL; keep it low, e.g. 300s, during the
   change).

## 4. CLI verification (repeatable, from this repo)

```bash
# A. Headers: apex must look like the origin (Server: Netlify, Age: 0/low, ETags match)
curl -sI https://davisdigitalstudio.com/portal.html | grep -iE "^age|cache-status|^etag|^server"
curl -sI https://studio-os-dds.netlify.app/portal.html | grep -iE "^age|cache-status|^etag|^server"

# B. Byte-verification (THE RELEASE GATE) — portal + admin vs main
for f in portal.html dds-studio-manage-9k2p.html; do
  live=$(curl -s "https://davisdigitalstudio.com/$f" | sha256sum | cut -d' ' -f1)
  repo=$(git show "main:$f" | sha256sum | cut -d' ' -f1)
  [ "$live" = "$repo" ] && echo "$f: MATCH" || echo "$f: STALE (live=$live main=$repo)"
done

# C. Content sentinel: the messaging retry code must be present on the domain
curl -s https://davisdigitalstudio.com/portal.html | grep -c "_state"   # expect 5 (0 = stale)

# D. DNS: apex should resolve to Netlify (75.2.60.5 or Netlify DNS answers)
nslookup -type=A davisdigitalstudio.com
```

## 5. Release gate

**Do not release until:** step 4B prints `MATCH` for both files **and** 4A shows
`Server: Netlify` (no APISIX) on the apex. Re-run 4B after every production
deploy from now on — add it to the deploy checklist next to the existing
functions byte-check (`docs/runbooks/BYTE-CHECK.md`).

## 6. Rollback

DNS-only change; rollback = restore the previous A record. No repo or deploy
state is touched by any step above.
