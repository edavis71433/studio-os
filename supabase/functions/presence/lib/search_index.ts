// ── On-site search + post tags — the ONE static, privacy-safe search substrate ──
// A published Studio OS site has zero external origins and zero trackers. So the
// site's own search is built the same way: at publish time we serialize a small
// JSON index of the site's OWN content (pages, offerings, updates, FAQs), ship it
// beside the site, and a tiny FIRST-PARTY inline script filters it in the browser.
// No backend call, no analytics, no third party — a visitor's query never leaves
// their machine. Degrades gracefully: with no JS the /search/ page shows a plain
// browse list (a <noscript> map of the site).
//
// Everything here is PURE (no I/O, no clock, no randomness): SnapshotContent in →
// index entries / HTML / a deterministic script string out. The templates call it
// exactly like lib/legal_pages.ts (shared bodies rendered through each own shell)
// and lib/site_blocks.ts (shared BLOCK_CSS), so search looks + behaves identically
// on every template with ONE implementation.
//
// TAGS: flat, normalized tags on updates (posts). normalizeTags() is the single
// gate; the published updates index renders a tag-filter chip bar (progressive —
// JS reveals it; without JS every update stays visible) and tags also enrich the
// search index + the RSS feed's <category> entries.
import type { SnapshotContent } from './render_types.ts';

// ── The index entry: title · snippet · in-site URL · kind. Kept short (t/s/u/k)
//    because it ships to every visitor; no PII (never phone/email/address text). ──
export type SearchKind = 'page' | 'service' | 'update' | 'faq';
export interface SearchDoc { t: string; s: string; u: string; k: SearchKind; g?: string[] }

/** Strip markdown/HTML to a plain, single-line snippet — escape-free source text
 *  (the renderer escapes at output). Pure, deterministic. */
export function plainSnippet(raw: string, max = 150): string {
  let s = String(raw ?? '');
  s = s.replace(/<[^>]*>/g, ' ');                 // any stray tags → space
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'); // md links/images → their text
  s = s.replace(/[*_`#>~]+/g, ' ');               // md emphasis/heading/quote marks
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  // cut on a word boundary near the cap, add an ellipsis
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

export interface SearchIndexOpts {
  /** the offerings page path + label for this site's industry (e.g. '/menu/' 'Menu'). */
  offeringPath: string;
  offeringLabel: string;
}

/** Build the site's search index from its published content. Deterministic order:
 *  pages first (stable), then offerings, updates (newest first), FAQs. No PII: the
 *  Contact entry carries a generic snippet, never the phone/email/address string. */
export function buildSearchIndex(c: SnapshotContent, opts: SearchIndexOpts): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const i = c.identity || ({} as SnapshotContent['identity']);
  const name = String(i.business_name || 'this site');
  const desc = plainSnippet(i.description || i.tagline || '');

  // Pages — the fixed site map. Snippets from real, public copy (no PII).
  docs.push({ t: 'Home', s: desc || `Welcome to ${name}.`, u: '/', k: 'page' });
  docs.push({ t: `About ${name}`, s: plainSnippet(i.story || i.description || '') || `About ${name}.`, u: '/about/', k: 'page' });
  docs.push({ t: opts.offeringLabel, s: `Browse the ${opts.offeringLabel.toLowerCase()} at ${name}.`, u: opts.offeringPath, k: 'page' });
  if ((c.faqs || []).length) docs.push({ t: 'FAQ', s: `Answers to common questions about ${name}.`, u: '/faq/', k: 'page' });
  if ((c.posts || []).length) docs.push({ t: 'Updates', s: `News and updates from ${name}.`, u: '/updates/', k: 'page' });
  docs.push({ t: 'Contact & hours', s: `How to reach ${name} and when we're open.`, u: '/contact/', k: 'page' });

  // Offerings — one entry each (all live on the offerings page).
  for (const o of c.offerings || []) {
    const t = String(o.name || '').trim();
    if (!t) continue;
    docs.push({ t, s: plainSnippet([o.description, o.price_text].filter(Boolean).join(' · ')), u: opts.offeringPath, k: 'service' });
  }

  // Updates — newest first; tags fold into the entry so a tag is searchable.
  for (const p of [...(c.posts || [])].sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))) {
    const t = String(p.title || '').trim();
    if (!t || !p.slug) continue;
    const tags = normalizeTags((p as { tags?: unknown }).tags);
    docs.push({ t, s: plainSnippet(p.excerpt || p.body_md || ''), u: `/updates/${p.slug}/`, k: 'update', ...(tags.length ? { g: tags } : {}) });
  }

  // FAQs — question is the title, answer the snippet (all on /faq/).
  for (const f of c.faqs || []) {
    const t = String(f.question || '').trim();
    if (!t) continue;
    docs.push({ t, s: plainSnippet(f.answer || ''), u: '/faq/', k: 'faq' });
  }

  return docs;
}

/** The emitted /search-index.json file contents (compact, deterministic). */
export function searchIndexJson(c: SnapshotContent, opts: SearchIndexOpts): string {
  return JSON.stringify(buildSearchIndex(c, opts));
}

// ── Matching — the ONE ranking rule, shared by the on-site client script (mirrored
//    inline below) and the author-side search. Tokenized, title-weighted, phrase
//    bonus. Pure + deterministic (stable sort by score then original order). ──
export function matchDocs(docs: SearchDoc[], query: string, limit = 40): SearchDoc[] {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ d: SearchDoc; score: number; i: number }> = [];
  docs.forEach((d, i) => {
    const title = String(d.t || '').toLowerCase();
    const hay = (title + ' ' + String(d.s || '') + ' ' + (d.g || []).join(' ')).toLowerCase();
    let score = 0;
    for (const tk of tokens) {
      if (title.includes(tk)) score += 3;
      else if (hay.includes(tk)) score += 1;
    }
    if (score === 0) return;                 // every token must hit somewhere
    for (const tk of tokens) if (!hay.includes(tk)) return;
    if (title.startsWith(q)) score += 4;     // strong prefix bonus
    else if (hay.includes(q)) score += 2;    // full-phrase bonus
    scored.push({ d, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.d);
}

// ── Tags — the single normalization gate ─────────────────────────────────────
// Accepts an array OR a comma/newline string (the author types "events, summer").
// lowercase · trimmed · single-spaced · [a-z0-9 & + -] only · de-duped · bounded.
const MAX_TAGS = 12;
const MAX_TAG_LEN = 30;
export function normalizeTags(raw: unknown): string[] {
  let parts: string[];
  if (Array.isArray(raw)) parts = raw.map((x) => String(x ?? ''));
  else parts = String(raw ?? '').split(/[,\n]/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = p.toLowerCase().replace(/[^a-z0-9 &+-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LEN);
    if (!t || seen.has(t)) continue;
    seen.add(t); out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** The distinct tags across a set of posts, sorted — the chip bar's source. */
export function uniquePostTags(posts: Array<{ tags?: unknown }>): string[] {
  const set = new Set<string>();
  for (const p of posts || []) for (const t of normalizeTags(p.tags)) set.add(t);
  return [...set].sort();
}

// ═════════ Rendered UI (shared across every template) ═════════
// The escaper is injected (each template already has esc/attr from markdown.ts),
// so this module needs no template imports — same posture as lib/site_blocks.ts.

type Esc = (s: string) => string;

/** The compact header search box present on every page — a plain GET form to the
 *  /search/ page (works with NO JavaScript). No id (it repeats on every page); the
 *  label is the accessible name. The inline SVG is self-hosted (zero external origins). */
export function searchBoxHtml(): string {
  return `<form class="sitesearch" role="search" action="/search/" method="get">`
    + `<span class="ss-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg></span>`
    + `<input type="search" name="q" aria-label="Search this site" placeholder="Search" autocomplete="off" maxlength="120">`
    + `</form>`;
}

/** The /search/ page body — a search field, a live results region, and a <noscript>
 *  browse map so the page is useful even with scripting off. The client script
 *  (searchClientScript) is appended by the caller. */
export function searchPageBody(esc: Esc, opts: SearchIndexOpts): string {
  const off = esc(opts.offeringPath);
  const label = esc(opts.offeringLabel);
  return `<section class="block wrap search-page">
<h1>Search</h1>
<form class="searchmain" role="search" action="/search/" method="get">
  <label class="sr-only" for="search-q">Search this site</label>
  <input type="search" id="search-q" name="q" placeholder="Search this site…" autocomplete="off" maxlength="120">
</form>
<p class="search-status" id="search-status" role="status" aria-live="polite"></p>
<ol class="search-results" id="search-results"></ol>
<noscript><p class="search-note">Search needs JavaScript turned on. In the meantime you can browse: <a href="/">Home</a> · <a href="${off}">${label}</a> · <a href="/faq/">FAQ</a> · <a href="/updates/">Updates</a> · <a href="/contact/">Contact</a>.</p></noscript>
</section>`;
}

/** The first-party inline search script for the /search/ page. Fetches the same-
 *  origin /search-index.json, filters with the SAME ranking rule as matchDocs()
 *  above, and renders results with createElement/textContent (owner + visitor text
 *  is NEVER interpolated into HTML). Zero external origins. Deterministic string
 *  (no clock/random) so goldens stay stable. `</` is escaped so the literal can
 *  never close the <script> early. */
export function searchClientScript(): string {
  const js = `(function(){
var inp=document.getElementById('search-q'),out=document.getElementById('search-results'),st=document.getElementById('search-status');
if(!inp||!out)return;
var DOCS=null,LOADED=false;
var KIND={page:'Page',service:'Service',update:'Update',faq:'Question'};
function qparam(){try{return new URLSearchParams(location.search).get('q')||'';}catch(e){return '';}}
function match(docs,query){
  var q=String(query||'').toLowerCase().trim();if(!q)return [];
  var tokens=q.split(/\\s+/).filter(Boolean);var scored=[];
  docs.forEach(function(d,i){
    var title=String(d.t||'').toLowerCase();
    var hay=(title+' '+String(d.s||'')+' '+((d.g||[]).join(' '))).toLowerCase();
    var score=0,ok=true;
    tokens.forEach(function(tk){if(title.indexOf(tk)>=0)score+=3;else if(hay.indexOf(tk)>=0)score+=1;});
    if(score===0)return;
    tokens.forEach(function(tk){if(hay.indexOf(tk)<0)ok=false;});
    if(!ok)return;
    if(title.indexOf(q)===0)score+=4;else if(hay.indexOf(q)>=0)score+=2;
    scored.push({d:d,score:score,i:i});
  });
  scored.sort(function(a,b){return b.score-a.score||a.i-b.i;});
  return scored.slice(0,40).map(function(x){return x.d;});
}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function render(q){
  while(out.firstChild)out.removeChild(out.firstChild);
  if(!q){st.textContent='';return;}
  if(!LOADED){st.textContent='Searching…';return;}
  var res=match(DOCS||[],q);
  st.textContent=res.length?(res.length+' result'+(res.length===1?'':'s')+' for “'+q+'”'):('No results for “'+q+'”. Try another word.');
  res.forEach(function(d){
    var li=el('li','search-hit');var a=el('a',null,null);a.href=d.u;
    a.appendChild(el('span','sh-title',d.t));
    a.appendChild(el('span','sh-kind',KIND[d.k]||''));
    if(d.s)a.appendChild(el('span','sh-snip',d.s));
    li.appendChild(a);out.appendChild(li);
  });
}
function load(){
  fetch('/search-index.json',{headers:{accept:'application/json'}}).then(function(r){return r.json();}).then(function(j){DOCS=Array.isArray(j)?j:[];LOADED=true;render(inp.value.trim());}).catch(function(){LOADED=true;st.textContent='Search is unavailable right now.';});
}
var seed=qparam();if(seed){inp.value=seed;}
inp.addEventListener('input',function(){render(inp.value.trim());});
render(inp.value.trim());load();
inp.focus();
})();`;
  return `<script>${js.replace(/<\//g, '<\\/')}</script>`;
}

// ── Tag filter (published updates index) ─────────────────────────────────────

/** The tag string for an article's data-tags attribute (space-joined, escaped). */
export function postTagsAttr(tags: string[], attr: Esc): string {
  return tags.length ? ` data-tags="${attr(tags.join(' '))}"` : '';
}

/** A small, visible tag list under an update (in-index + on the post). */
export function postTagsHtml(tags: string[], esc: Esc): string {
  if (!tags.length) return '';
  return `<ul class="post-tags">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

/** The chip filter bar for the updates index. Hidden by default; the inline script
 *  reveals it (progressive enhancement — with no JS every update stays visible).
 *  Returns '' when the site has no tagged updates (byte-identical to before tags). */
export function tagFilterBar(posts: Array<{ tags?: unknown }>, esc: Esc, attr: Esc): string {
  const tags = uniquePostTags(posts);
  if (!tags.length) return '';
  const chips = [`<button type="button" class="tagchip on" data-tag="" aria-pressed="true">All</button>`]
    .concat(tags.map((t) => `<button type="button" class="tagchip" data-tag="${attr(t)}" aria-pressed="false">${esc(t)}</button>`))
    .join('');
  return `<div class="tagbar" role="group" aria-label="Filter updates by tag" hidden>${chips}</div>`;
}

/** The inline filter script for the updates index — reveals the chip bar and shows/
 *  hides articles by their data-tags. First-party, deterministic, zero origins.
 *  Returns '' when there are no tags (no script emitted). */
export function tagFilterScript(posts: Array<{ tags?: unknown }>): string {
  if (!uniquePostTags(posts).length) return '';
  const js = `(function(){
var bar=document.querySelector('.tagbar');if(!bar)return;bar.hidden=false;
var arts=[].slice.call(document.querySelectorAll('.post-list article'));
bar.addEventListener('click',function(e){
  var b=e.target.closest('.tagchip');if(!b)return;
  var tag=b.getAttribute('data-tag')||'';
  [].slice.call(bar.querySelectorAll('.tagchip')).forEach(function(c){var on=c===b;c.classList.toggle('on',on);c.setAttribute('aria-pressed',String(on));});
  arts.forEach(function(a){var t=(a.getAttribute('data-tags')||'').split(' ');a.hidden=tag?t.indexOf(tag)<0:false;});
});
})();`;
  return `<script>${js.replace(/<\//g, '<\\/')}</script>`;
}

// ── Shared CSS — appended to each template's stylesheet (like BLOCK_CSS). Uses
//    var() fallbacks so it is portable across every template's palette. ──
export const SEARCH_CSS = `
.sitesearch{display:flex;align-items:center;gap:6px;border:1px solid var(--line,#e2e4e1);border-radius:999px;padding:5px 12px;background:var(--card,#fff);max-width:200px}
.sitesearch .ss-ic{color:var(--soft,#5b6572);display:inline-flex}
.sitesearch input{border:0;background:transparent;font:inherit;font-size:.92rem;color:var(--ink,#1c2430);width:100%;outline:none;padding:2px 0}
.sitesearch input::placeholder{color:var(--soft,#5b6572)}
.search-page .searchmain{margin:8px 0 6px}
.search-page input[type=search]{width:100%;max-width:520px;font:inherit;font-size:1.05rem;padding:13px 16px;border:1px solid var(--line,#e2e4e1);border-radius:12px;background:var(--card,#fff);color:var(--ink,#1c2430)}
.search-page input[type=search]:focus{outline:2px solid var(--accent);outline-offset:1px}
.search-status{color:var(--soft,#5b6572);font-size:.95rem;margin:6px 0 14px}
.search-note{color:var(--soft,#5b6572)}
.search-results{list-style:none;margin:0;padding:0;display:grid;gap:2px;max-width:640px}
.search-hit a{display:block;text-decoration:none;color:inherit;padding:13px 14px;border:1px solid transparent;border-radius:12px}
.search-hit a:hover,.search-hit a:focus{background:var(--wash,var(--paper,#f2f4f2));border-color:var(--line,#e2e4e1)}
.search-hit .sh-title{font-weight:700;color:var(--ink,#1c2430);margin-right:9px}
.search-hit .sh-kind{font-size:.72rem;letter-spacing:.05em;text-transform:uppercase;color:var(--accent);vertical-align:middle}
.search-hit .sh-snip{display:block;color:var(--soft,#5b6572);font-size:.92rem;margin-top:3px}
.tagbar{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px}
.tagchip{font:inherit;font-size:.85rem;font-weight:600;padding:6px 13px;border-radius:999px;border:1px solid var(--line,#e2e4e1);background:var(--card,#fff);color:var(--soft,#5b6572);cursor:pointer}
.tagchip:hover{color:var(--ink,#1c2430)}
.tagchip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.post-tags{list-style:none;display:flex;flex-wrap:wrap;gap:7px;margin:8px 0 0;padding:0}
.post-tags li{font-size:.78rem;font-weight:600;color:var(--accent);background:var(--wash,var(--paper,#f2f4f2));border-radius:999px;padding:3px 10px}
@media (max-width:640px){.sitesearch{max-width:150px}}`;
