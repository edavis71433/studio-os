// ── Wave-2 G11: per-section annotations & review comments — pure core ─────────
// Adobe parity AC-7/WF-6 (Annotate mode, annotation-driven review), SMB-shaped:
// comment threads pinned to the DRAFT's sections, written by the operator in the
// builder and by the CLIENT on the shared draft (/p/s/:token — the same signed,
// expiring, site-scoped token that authorizes the page itself; no new auth).
//
// Everything here is PURE (unit-testable without a database): body validation,
// page-slug/block-id normalization, the stable section-id scheme, thread
// grouping, and the self-contained feedback panel injected into the shared
// draft page. The impure handlers live in routes/comments.ts.

// ── The stable section-id scheme ──────────────────────────────────────────────
// Blocks mostly carry no stored id (only the multi-instance types — form,
// columns, cards — get one from site_blocks.ts uniqueId). The comment key is:
//   • `type`           — the first instance of a type on the page (e.g. "gallery")
//   • `type#N`         — the Nth instance of a repeated no-id type ("richtext#2")
//   • `type:storedId`  — a multi-instance block with its own id ("columns:cols_a")
//   • ''               — the whole page (block_id null/'' in the table)
// Deterministic over the page's block list; mirrored client-side in
// presence.html (cmSectionIds) so the builder and the server always agree.

/** Plain-word names per block type — client-facing, NEVER content. Mirrors the
 *  builder's BLOCK_DEFS names, shortened to calm nouns. */
export const SECTION_NAME: Record<string, string> = {
  features: 'Features', stats: 'Numbers', team: 'Team', process: 'How it works',
  pricing: 'Pricing', certifications: 'Certifications', service_areas: 'Areas served',
  cta: 'Call-to-action banner', gallery: 'Photo gallery', before_after: 'Before & after',
  video: 'Video', partners: 'Logo strip', reviews: 'Review badge', reviews_wall: 'Reviews',
  appointment: 'Booking button', booking: 'Online booking', newsletter: 'Newsletter sign-up',
  social: 'Social links', events: 'Events', map: 'Map & directions', richtext: 'Text',
  image: 'Image', image_text: 'Image + text', accordion: 'Expandable details', tabs: 'Tabs',
  carousel: 'Slideshow', progress: 'Progress bars', buttons: 'Buttons', divider: 'Divider',
  columns: 'Columns', cards: 'Cards', download: 'Download', toc: 'Table of contents',
  title: 'Heading', link_list: 'Links', table: 'Table', spotlight: 'Spotlight', form: 'Form',
};

export const COMMENT_BODY_MAX = 2000;
/** Cap of OPEN client-authored comments per site — the abuse backstop behind the
 *  per-IP rate limit (a shared link is public by design once sent). */
export const MAX_OPEN_CLIENT_COMMENTS = 200;

/** Validate + clean a comment body. Strips control chars (keeps newline/tab),
 *  normalizes CRLF, trims. Refuses empty and over-cap (never silently truncates
 *  someone's words). Pure. */
export function cleanCommentBody(raw: unknown):
  { ok: true; body: string } | { ok: false; error: 'empty' | 'too_long' } {
  let s = '';
  for (const ch of String(raw ?? '')) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 || c === 10 || c === 9) s += ch;
  }
  s = s.replace(/\r\n?/g, '\n').trim();
  if (!s) return { ok: false, error: 'empty' };
  if (s.length > COMMENT_BODY_MAX) return { ok: false, error: 'too_long' };
  return { ok: true, body: s };
}

/** Normalize a page reference — accepts a slug ("about") or a public path form
 *  ("/", "/about/"). '' = the home page. Returns null on anything that isn't a
 *  safe slug (fail closed — never a traversal or a raw key). Pure. */
export function normalizePageSlug(raw: unknown): string | null {
  let s = String(raw ?? '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  if (s === '') return '';
  if (!/^[a-z0-9-]{1,60}$/.test(s)) return null;
  return s;
}

/** Normalize a block id per the scheme above. '' = whole page. null = invalid. Pure. */
export function normalizeBlockId(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  if (!/^[a-z0-9_]+(#[0-9]{1,3}|:[a-z0-9_-]{1,60})?$/i.test(s) || s.length > 80) return null;
  return s;
}

/** The {id, name} pairs for a list of stored blocks — the ONLY data the public
 *  sections route may serve (no titles, no bodies, no media, no field values).
 *  Deterministic; junk entries are skipped, never guessed at. Pure. */
export function sectionIdsFor(blocks: unknown): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  const counts: Record<string, number> = {};
  for (const b of (Array.isArray(blocks) ? blocks : [])) {
    if (!b || typeof b !== 'object') continue;
    const type = String((b as Record<string, unknown>).type || '');
    if (!/^[a-z0-9_]{1,40}$/.test(type)) continue;
    const n = (counts[type] = (counts[type] || 0) + 1);
    const rawId = (b as Record<string, unknown>).id;
    const own = typeof rawId === 'string' && /^[a-z0-9_-]{1,60}$/i.test(rawId) ? rawId : '';
    const id = own ? `${type}:${own}` : (n === 1 ? type : `${type}#${n}`);
    const base = SECTION_NAME[type] || type.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    out.push({ id, name: n === 1 ? base : `${base} (${n})` });
  }
  return out;
}

/** The section list for one page of a snapshot's content ('' = home →
 *  settings.blocks; a slug → that settings.pages[] entry). Unknown page → []. Pure. */
export function sectionsForContent(content: unknown, pageSlug: string): Array<{ id: string; name: string }> {
  const c = (content && typeof content === 'object' ? content : {}) as Record<string, any>;
  const settings = (c.settings && typeof c.settings === 'object' ? c.settings : {}) as Record<string, any>;
  if (!pageSlug) return sectionIdsFor(settings.blocks);
  const pages = Array.isArray(settings.pages) ? settings.pages : [];
  const page = pages.find((p: any) => p && typeof p === 'object' && p.slug === pageSlug);
  return page ? sectionIdsFor(page.blocks) : [];
}

// ── Thread grouping (the operator's GET /comments view) ───────────────────────
export interface CommentRow {
  id: string; page_slug: string; block_id: string | null; author_kind: string;
  body: string; status: string; created_at: string; resolved_at?: string | null;
}
export interface CommentThread { page_slug: string; block_id: string; open_count: number; comments: CommentRow[] }

/** Group rows into threads by (page_slug, block_id); comments newest-first
 *  within each thread; threads newest-activity-first. Counts only OPEN rows. Pure. */
export function groupThreads(rows: CommentRow[]): CommentThread[] {
  const map = new Map<string, CommentThread>();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r || typeof r !== 'object') continue;
    const slug = String(r.page_slug || '');
    const bid = String(r.block_id || '');
    const k = `${slug}\u0000${bid}`;
    let t = map.get(k);
    if (!t) { t = { page_slug: slug, block_id: bid, open_count: 0, comments: [] }; map.set(k, t); }
    t.comments.push(r);
    if (r.status === 'open') t.open_count++;
  }
  const threads = [...map.values()];
  for (const t of threads) t.comments.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  threads.sort((a, b) => String(b.comments[0]?.created_at || '').localeCompare(String(a.comments[0]?.created_at || '')));
  return threads;
}

/** Status transitions: open → resolved is the only move (delete is soft, any
 *  state). Resolving a resolved comment is an idempotent no-op. Pure. */
export function canResolve(status: unknown): boolean { return status === 'open'; }

// ── The "Leave feedback" panel on the shared draft (/p/s/:token) ──────────────
// Self-contained (inline CSS/JS, zero external assets — fits inside the
// published-site CSP), theme-neutral, and blind to operator data: it reads ONLY
// the {id,name} sections route and writes ONLY the token comments route — both
// authorized by the SAME signed token the visitor arrived with.
const FEEDBACK_MARKER = 'id="presence-feedback-panel"';

/** Escape a string for safe embedding inside an inline <script> as a JS string
 *  literal (JSON + unicode-escape of anything that could close the tag). Pure. */
function jsStr(s: string): string {
  return JSON.stringify(String(s ?? '')).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/** Inject the fixed "Leave feedback" panel before </body>. `pfx` is the signed
 *  door's own URL (…/p/s/<token>) — sections + comments are fetched under it, so
 *  the panel holds no authority beyond the link the visitor already has.
 *  Idempotent; pure. */
export function injectFeedbackPanel(html: string, opts: { pfx: string; page: string }): string {
  if (typeof html !== 'string' || html.includes(FEEDBACK_MARKER)) return html;
  const P = jsStr(opts.pfx);
  const PG = jsStr(opts.page || '/');
  const panel = `
<div id="presence-feedback-panel">
<style>
#presence-feedback-panel{position:fixed;right:16px;bottom:56px;z-index:2147483646;font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1525}
#pfb-open{font:inherit;font-weight:700;font-size:13.5px;padding:10px 16px;border:none;border-radius:999px;background:#5b3fa0;color:#fff;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.22)}
#pfb-card{display:none;width:320px;max-width:calc(100vw - 32px);max-height:min(70vh,520px);overflow-y:auto;background:#fff;border:1px solid #e2dcee;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);padding:14px 14px 10px;margin-bottom:10px}
#presence-feedback-panel.open #pfb-card{display:block}
#pfb-card h2{font-size:15px;margin:0 0 2px;color:#3a2470}
#pfb-card .pfb-sub{font-size:12px;color:#6b6478;margin:0 0 10px}
.pfb-row{border-top:1px solid #efeaf7;padding:7px 0}
.pfb-name{font-weight:600;font-size:13px}
.pfb-add{font:inherit;font-size:12px;color:#5b3fa0;background:none;border:none;cursor:pointer;padding:2px 0;text-decoration:underline}
.pfb-box{width:100%;box-sizing:border-box;font:inherit;font-size:13px;border:1px solid #d9d2e8;border-radius:8px;padding:7px;margin-top:6px;min-height:56px;resize:vertical}
.pfb-send{font:inherit;font-size:12.5px;font-weight:700;margin-top:6px;padding:6px 14px;border:none;border-radius:999px;background:#5b3fa0;color:#fff;cursor:pointer}
.pfb-send[disabled]{opacity:.5;cursor:default}
.pfb-done{font-size:12.5px;color:#1f7a4d;font-weight:600;padding:6px 0}
.pfb-err{font-size:12px;color:#a3423a;padding:4px 0}
</style>
<div id="pfb-card" role="dialog" aria-label="Leave feedback on this draft">
  <h2>Leave feedback</h2>
  <p class="pfb-sub">Your notes go straight to the studio — nothing shows on the website.</p>
  <div id="pfb-sections"></div>
</div>
<button type="button" id="pfb-open" aria-expanded="false">&#128172; Leave feedback</button>
<script>
(function(){
  var PFX=${P},PAGE=${PG};
  var root=document.getElementById('presence-feedback-panel');
  var btn=document.getElementById('pfb-open');
  var host=document.getElementById('pfb-sections');
  var loaded=false;
  function boxRow(name,blockId,open){
    var row=document.createElement('div');row.className='pfb-row';
    var nm=document.createElement('div');nm.className='pfb-name';nm.textContent=name;row.appendChild(nm);
    var wrap=document.createElement('div');row.appendChild(wrap);
    function showBox(){
      wrap.textContent='';
      var ta=document.createElement('textarea');ta.className='pfb-box';ta.maxLength=2000;
      ta.placeholder='What should change here?';wrap.appendChild(ta);
      var send=document.createElement('button');send.type='button';send.className='pfb-send';send.textContent='Send';
      wrap.appendChild(send);
      var err=document.createElement('div');err.className='pfb-err';wrap.appendChild(err);
      send.addEventListener('click',function(){
        var body=(ta.value||'').trim();
        if(!body){err.textContent='Write a note first.';return;}
        send.disabled=true;send.textContent='Sending\\u2026';err.textContent='';
        fetch(PFX+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:PAGE,block_id:blockId,body:body})})
          .then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {ok:r.ok,j:j};});})
          .then(function(res){
            if(res.ok){wrap.textContent='';var d=document.createElement('div');d.className='pfb-done';d.textContent='\\u2713 Thanks \\u2014 sent to the studio.';wrap.appendChild(d);}
            else{send.disabled=false;send.textContent='Send';err.textContent=(res.j&&res.j.message)||'That didn\\u2019t send \\u2014 please try again.';}
          })
          .catch(function(){send.disabled=false;send.textContent='Send';err.textContent='That didn\\u2019t send \\u2014 please try again.';});
      });
      ta.focus();
    }
    if(open){showBox();}
    else{var add=document.createElement('button');add.type='button';add.className='pfb-add';add.textContent='Add a note';
      add.addEventListener('click',function(){add.remove();showBox();});wrap.appendChild(add);}
    return row;
  }
  function load(){
    if(loaded)return;loaded=true;
    host.textContent='';
    host.appendChild(boxRow('This whole page','',true));
    fetch(PFX+'/sections?page='+encodeURIComponent(PAGE))
      .then(function(r){return r.ok?r.json():null;})
      .then(function(j){
        var secs=(j&&j.data&&j.data.sections)||[];
        secs.forEach(function(s){if(s&&s.id&&s.name)host.appendChild(boxRow(String(s.name),String(s.id),false));});
      })
      .catch(function(){/* the whole-page box still works */});
  }
  btn.addEventListener('click',function(){
    var open=root.classList.toggle('open');
    btn.setAttribute('aria-expanded',String(open));
    if(open)load();
  });
})();
</script>
</div>`;
  return html.includes('</body>') ? html.replace('</body>', `${panel}</body>`) : `${html}${panel}`;
}
