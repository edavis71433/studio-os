# Runbook: Production Domain Serves a Stale Portal (RCAT B3)

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

1. **Identify what `159.198.67.66` is.** Log into the domain registrar for
   `davisdigitalstudio.com` and read the DNS zone. Common culprits: an old
   hosting A record left in place, registrar "web forwarding"/proxy feature,
   or a third-party CDN/proxy (the APISIX header suggests exactly this).
2. **Point the apex at Netlify**, either way works:
   - *Recommended:* switch the domain's nameservers to **Netlify DNS**
     (Netlify dashboard → Domain management → add `davisdigitalstudio.com`
     → follow the nameserver instructions), or
   - keep current DNS but set the apex **A record → `75.2.60.5`** (Netlify's
     apex load balancer) and `www` **CNAME → `studio-os-dds.netlify.app`**,
     removing the `159.198.67.66` record and any registrar proxy/forwarding.
3. **Disable any registrar-side proxy/cache/forwarding feature** on the domain.
4. In Netlify: Domain settings → verify `davisdigitalstudio.com` +
   `www` both show green/managed, and force HTTPS is on.
5. **Purge:** Netlify dashboard → Deploys → "Clear cache and retry deploy"
   (or `netlify api purgeCache` with the site id). If a third-party proxy was
   involved, purge/disable it at that layer too.
6. Wait out DNS TTL (check the zone's TTL; keep it low, e.g. 300s, during the
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
