// ── Ad tags: the Google tag and the Meta Pixel (list item 152) ───────────────
// An owner who advertises pastes two IDs on Connections. A published site with
// either one asks each visitor first: a small cookie notice at the bottom of every
// page, and the tags load only after "Yes". "No", or no answer, loads nothing, and
// the answer is kept in the visitor's browser so the notice doesn't ask again. The
// privacy page says all of this, and carries a button to change the answer.
//
// The IDs are written into a script on the published site, so they are held to
// their exact shapes here, at save (routes/content.ts) and again at render: letters,
// digits and one dash, nothing that could carry code. Pure, and imports nothing, since a
// browser test (tests/e2e/ad-tags.spec.ts) runs this very script.
type FileMap = Record<string, string | Uint8Array>;
type Settings = { ad_tags?: { google?: unknown; meta?: unknown } } | undefined;

/** A Google tag ID: Google Analytics (G-), Google Ads (AW-), a Google tag (GT-) or
 *  Floodlight (DC-), as Google's own install screens show them. */
export const GOOGLE_TAG_RE = /^(G|AW|GT|DC)-[A-Z0-9]{4,16}$/;
/** A Meta Pixel ID: the digits Meta Events Manager shows (15 or 16 today). */
export const META_PIXEL_RE = /^\d{8,20}$/;

export interface AdTags { google?: string; meta?: string }

/** The site's tags as the snapshot carries them, each one re-checked; null when none. */
export function adTagsOf(settings: Settings): AdTags | null {
  const t = settings?.ad_tags;
  const google = typeof t?.google === 'string' && GOOGLE_TAG_RE.test(t.google) ? t.google : '';
  const meta = typeof t?.meta === 'string' && META_PIXEL_RE.test(t.meta) ? t.meta : '';
  return google || meta ? { ...(google ? { google } : {}), ...(meta ? { meta } : {}) } : null;
}

/** Who sets the cookies, in a sentence: "Google", "Meta", "Google and Meta". */
export const adCompanies = (tags: AdTags): string => [tags.google ? 'Google' : '', tags.meta ? 'Meta' : ''].filter(Boolean).join(' and ');
/** What loads, in a sentence: "the Google tag", "Meta’s pixel", or both. */
export const adTagNames = (tags: AdTags): string => [tags.google ? 'the Google tag' : '', tags.meta ? 'Meta’s pixel' : ''].filter(Boolean).join(' and ');

/** The cookie notice and the loader every page of a site with ad tags carries. The tags
 *  load only once the visitor says yes, on this page and every page after. */
export function adTagsScript(tags: AdTags): string {
  const g = tags.google || '', m = tags.meta || '';
  const notice = `<div id="presence-consent" role="region" aria-label="Cookie choice" hidden style="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483646;max-width:560px;margin:0 auto;background:#1b1b1f;color:#fff;border-radius:12px;padding:14px 16px;font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25)">` +
    `<p style="margin:0 0 10px">We use cookies from ${adCompanies(tags)} to see how our ads work. Is that OK? <a href="/privacy/" style="color:#fff;text-decoration:underline">Privacy</a></p>` +
    `<button type="button" data-consent="yes" style="font:inherit;font-weight:600;border:0;border-radius:999px;padding:8px 16px;margin-right:8px;background:#fff;color:#1b1b1f;cursor:pointer">Yes, that’s fine</button>` +
    `<button type="button" data-consent="no" style="font:inherit;font-weight:600;border:1px solid rgba(255,255,255,.7);border-radius:999px;padding:7px 15px;background:transparent;color:#fff;cursor:pointer">No, thanks</button></div>`;
  const js = `(function(){var K='presence-consent',G='${g}',M='${m}',box=document.getElementById(K);` +
    `function get(){try{return localStorage.getItem(K)}catch(e){return null}}function put(v){try{localStorage.setItem(K,v)}catch(e){}}` +
    `function load(){if(window.__presenceAds)return;window.__presenceAds=1;` +
    `if(G){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+G;document.head.appendChild(s);window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config',G)}` +
    `if(M){!function(f,b,e,v,n,t,x){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;x=b.getElementsByTagName(e)[0];x.parentNode.insertBefore(t,x)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');window.fbq('init',M);window.fbq('track','PageView')}}` +
    `function show(on){if(!box)return;box.hidden=!on;document.body.style.paddingBottom=on?(box.offsetHeight+24)+'px':''}` +
    `if(box)box.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-consent]');if(!b)return;var v=b.getAttribute('data-consent');put(v);show(false);if(v==='yes')load()});` +
    `var c=document.getElementById('presence-consent-change');if(c)c.addEventListener('click',function(){show(true)});` +
    `var a=get();if(a==='yes')load();else if(a!=='no')show(true)})();`;
  return `${notice}<script id="presence-ad-tags">${js}</script>`;
}

/** Add the notice and the loader to every page, before </body>. Unchanged (the same object)
 *  when the site has no ad tags, so such a site draws byte for byte as before. */
export function injectAdTags(fileMap: FileMap, settings: Settings): FileMap {
  const tags = adTagsOf(settings);
  if (!tags) return fileMap;
  const tag = adTagsScript(tags);
  const out: FileMap = {};
  for (const [path, contents] of Object.entries(fileMap)) {
    out[path] = typeof contents === 'string' && path.endsWith('.html') && contents.includes('</body>') && !contents.includes('id="presence-ad-tags"')
      ? contents.replace('</body>', `${tag}</body>`)
      : contents;
  }
  return out;
}
