// ── /reviews/* — native reviews / reputation loop (request → collect → approve → show) ──
// The MVP native reputation loop. Split, exactly like booking + forms:
//   • PUBLIC (pre-auth, authorized by the site id itself):
//       GET  /reviews/:siteId          → a calm, branded, first-party review page
//       POST /reviews/:siteId          → leave a review (honeypot + rate-limit + ip_hash
//                                         + validation + escaping — the SAME safety as a
//                                         form/booking submit). Stored 'pending'.
//   • OWNER (authed, site-scoped; a client_reviewer is refused by the boundary gate):
//       GET  /reviews                  → the moderation queue (pending/approved/hidden) + aggregate
//       POST /reviews/request          → email a customer a branded "leave a review" link
//       POST /reviews/:id/approve      → show it (propose-then-approve; shown ONLY after this)
//       POST /reviews/:id/hide         → keep it, never show it
//       POST /reviews/:id/reply        → attach a short public owner response
//
// THE MOAT: a review is NEVER shown until the owner approves it, and the displayed
// schema.org (AggregateRating + Review) counts ONLY approved rows (honest — baked by
// the serializer, never fabricated here). Reuse-first, no parallel systems:
//   • request email  → commerce/account.ts sendEmail (suppression + one-click
//                       unsubscribe at the ONE send point) + lib/email_brand
//   • owner alert     → lib/notice.raiseNotice (the ONE notice model → bell + push)
//   • CRM             → find-or-create presence_contacts (site+email), like a lead
//   • validation      → lib/reviews.ts (pure, tested)
//
// Deploy-order-tolerant (mirrors 0094–0100): before migration 0101 is applied every
// query returns not-ok and we answer calmly ("reviews need a database update" /
// "not available") rather than erroring — the routes are dormant until owner-apply.

import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import { raiseNotice } from '../lib/notice.ts';
import { sendEmail } from '../commerce/account.ts';
import { loadEmailBrand, type EmailBrand } from '../lib/email_brand.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { validateReviewInput, cleanOwnerReply, aggregateApproved, aggregateText, starString } from '../lib/reviews.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const APPROVAL_SECRET = Deno.env.get('APPROVAL_SECRET') || Deno.env.get('SCHEDULER_SECRET') || '';
const fnBase = () => (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const siteBase = () => (Deno.env.get('SITE_URL') || 'https://presence.davisdigitalstudio.com').replace(/\/$/, '');
/** the public review page URL a request email links to (first-party, function-served). */
const reviewPageUrl = (siteId: string) => `${fnBase()}/functions/v1/presence/reviews/${siteId}`;

async function hashIp(req: Request): Promise<string> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  if (!ip) return '';
  const salt = APPROVAL_SECRET || Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'salt';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + salt));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ═══════════════════════════ PUBLIC endpoints ═══════════════════════════════
// Handled before the auth gate; authorized by the site id itself (like the form
// submit + booking + analytics collector). Always answer calmly — never leak internals.

/** PUBLIC — the branded, first-party "leave a review" page (server-rendered HTML,
 *  zero external origins). Posts to POST /reviews/:siteId. */
export async function handleReviewPage(req: Request, siteId: string, cors: Record<string, string>): Promise<Response> {
  const htmlHeaders = { ...cors, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
  if (!UUID_RE.test(siteId)) return new Response('<!doctype html><meta charset="utf-8"><title>Not found</title><p>This review page could not be found.</p>', { status: 404, headers: htmlHeaders });
  if (!(await rateAllow(`rev:page:ip:${clientIp(req)}`, 60, 60))) return new Response('<!doctype html><meta charset="utf-8"><p>Please slow down and try again in a moment.</p>', { status: 429, headers: htmlHeaders });
  const brand = await loadEmailBrand(siteId);
  const endpoint = reviewPageUrl(siteId);
  return new Response(reviewPageHtml(brand, endpoint), { status: 200, headers: htmlHeaders });
}

/** PUBLIC — create a review. Honeypot + rate-limit + validation + ip_hash, mirroring
 *  the form + booking submit. Stored 'pending' (never shown until the owner approves). */
export async function handleReviewSubmit(req: Request, siteId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(siteId)) return json({ error: 'not_found' }, 404, cors);
  // throttle the public submit — per-IP and per-site fixed windows (like forms/booking)
  if (!(await rateAllow(`rev:submit:ip:${clientIp(req)}`, 5, 60)) || !(await rateAllow(`rev:submit:site:${siteId}`, 30, 60))) return tooMany(cors);

  let b: any = {};
  const ctype = (req.headers.get('content-type') || '').toLowerCase();
  if (ctype.includes('application/x-www-form-urlencoded') || ctype.includes('multipart/form-data')) {
    try { const fd = await req.formData(); for (const k of new Set(fd.keys())) b[k] = String(fd.get(k) ?? ''); } catch { /* */ }
  } else {
    try { b = await req.json(); } catch { /* */ }
  }

  // Honeypot: a filled `_hp` is a bot — answer success without writing (bots think
  // they succeeded), exactly like the form + booking submit.
  const spam = !!String(b?._hp ?? '').slice(0, 100).trim();
  const calmOk = (msg: string) => json({ data: { ok: true, message: msg } }, 200, cors);
  if (spam) return calmOk('Thanks — your review was received.');

  const v = validateReviewInput(b);
  if (!v.ok) {
    const message = v.error === 'need_name' ? 'Please add your name.'
      : v.error === 'need_body' ? 'Please write a few words about your experience.'
      : v.error === 'bad_email' ? 'That email doesn’t look right.'
      : 'Please choose a rating from 1 to 5 stars.';
    return json({ error: v.error, message }, 400, cors);
  }

  // Verify the table exists (pre-0101 → dormant) with a light probe write attempt.
  // Attach/create a CRM contact (find-or-create by site+email), like a lead. Phone
  // isn't collected on a review; the contact is best-effort and email-only.
  let contactId: string | null = null;
  try {
    if (v.review.email) {
      const existing = rows(await svc(`presence_contacts?site_id=eq.${siteId}&email=eq.${encodeURIComponent(v.review.email)}&deleted_at=is.null&select=id&limit=1`))[0];
      if (existing) contactId = existing.id;
      else {
        const ins = await svc('presence_contacts', { method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ site_id: siteId, name: v.review.name, email: v.review.email }) });
        contactId = rows(ins)[0]?.id || null;
      }
    }
  } catch { /* contact is best-effort — never block a review on it */ }

  const ipHash = await hashIp(req);
  const ins = await svc('presence_reviews', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: siteId, contact_id: contactId,
      reviewer_name: v.review.name, reviewer_email: v.review.email,
      rating: v.review.rating, body: v.review.body,
      status: 'pending', source: 'website', ip_hash: ipHash,
    }),
  });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'unavailable', message: 'Reviews need a quick database update before they can be received. Please try again shortly.' }, 503, cors);
  const review = rows(ins)[0];

  // Owner alert (best-effort, non-blocking): the ONE notice model (→ bell + push).
  notifyOwnerOfReview(siteId, review).catch(() => {});
  return calmOk('Thank you — your review was received. It’ll appear once the owner approves it.');
}

async function notifyOwnerOfReview(siteId: string, review: any): Promise<void> {
  const site = rows(await svc(`presence_sites?id=eq.${siteId}&select=client_id&limit=1`))[0];
  const clientId = site?.client_id || '';
  const who = String(review.reviewer_name || 'A customer').slice(0, 60);
  // Owner notice on the ONE model (→ bell + push), once per review (period = its id).
  if (clientId) {
    await raiseNotice({
      siteId, clientId, kind: 'new_review', period: `review:${review.id}`,
      headline: `New review from ${who} — approve to show it`,
      body: `${'★'.repeat(Math.max(1, Math.min(5, Number(review.rating) || 0)))} “${String(review.body || '').slice(0, 120)}” — open Reviews to approve, reply, or hide it.`,
    }).catch(() => {});
  }
  // Owner email (best-effort; mirrors notifyOwnerOfBooking / notifyOwnerOfLead).
  const ident = rows(await svc(`presence_identity?site_id=eq.${siteId}&select=business_name,email&limit=1`))[0];
  const to = ident?.email;
  if (!to) return;
  const brand = await loadEmailBrand(siteId);
  await sendEmail(String(to), `New review from ${who}`,
    `<p>You have a new review from your website — it’s waiting for your OK before it shows.</p>` +
    `<p style="font-size:1.3rem;letter-spacing:2px;color:${brand.accent};margin:6px 0">${starString(Number(review.rating) || 0)}</p>` +
    `<blockquote style="margin:8px 0;padding:8px 14px;border-left:3px solid ${brand.accent};color:#444">“${esc(String(review.body || '').slice(0, 500))}”</blockquote>` +
    `<p style="color:#666">— ${esc(who)}</p>` +
    `<p class="cta"><a href="${siteBase()}/presence.html#reviews" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Approve, reply, or hide it →</a></p>`, brand);
}

// ═══════════════════════════ OWNER (authed) endpoints ════════════════════════
// Site-scoped via the boundary gate in index.ts (a client_reviewer never reaches
// these — Studio-side surface). The owner moderates + invites reviews.

const unavailable = (cors: Record<string, string>) =>
  json({ error: 'unavailable', message: 'Reviews need a one-time database update before they can be switched on.' }, 503, cors);

/** The moderation queue: pending first (what needs the owner), then approved + hidden,
 *  plus the HONEST aggregate over approved rows (mirrors what the site displays). */
export async function handleReviewsList(req: Request, site: SiteRow, cors: Record<string, string>): Promise<Response> {
  const u = new URL(req.url);
  const filter = u.searchParams.get('status');   // optional: pending|approved|hidden
  const scope = (filter === 'pending' || filter === 'approved' || filter === 'hidden') ? `&status=eq.${filter}` : '';
  const r = await svc(`presence_reviews?site_id=eq.${site.id}${scope}&select=id,reviewer_name,reviewer_email,rating,body,status,owner_reply,source,created_at,approved_at&order=created_at.desc&limit=300`);
  if (!r.ok) return unavailable(cors);
  const all = rows(r);
  const approved = all.filter((x) => x.status === 'approved');
  const agg = aggregateApproved(approved.map((x) => ({ rating: Number(x.rating), status: 'approved' })));
  return json({ data: {
    reviews: all,
    counts: {
      pending: all.filter((x) => x.status === 'pending').length,
      approved: approved.length,
      hidden: all.filter((x) => x.status === 'hidden').length,
    },
    aggregate: agg,
    aggregate_text: aggregateText(agg),
  } }, 200, cors);
}

/** Dismiss the "new review" bell nudge tied to ONE review once the owner has acted. */
async function clearReviewNotice(siteId: string, id: string): Promise<void> {
  await svc(`presence_plan_notices?site_id=eq.${siteId}&kind=eq.new_review&period=eq.${encodeURIComponent(`review:${id}`)}&status=eq.active`, {
    method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }),
  }).catch(() => {});
}

/** Approve a review → it becomes eligible to display (shown after the next publish). */
export async function handleReviewApprove(site: SiteRow, id: string, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const up = await svc(`presence_reviews?id=eq.${id}&site_id=eq.${site.id}&status=in.(pending,hidden)&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'approved', approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  if (!up.ok) return unavailable(cors);
  if (!rows(up)[0]) return json({ error: 'not_found', message: 'That review can’t be approved (it may already be handled).' }, 404, cors);
  clearReviewNotice(site.id, id).catch(() => {});
  return json({ data: { ok: true, status: 'approved' } }, 200, cors);
}

/** Hide a review → kept, never shown (reversible; the owner can approve later). */
export async function handleReviewHide(site: SiteRow, id: string, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const up = await svc(`presence_reviews?id=eq.${id}&site_id=eq.${site.id}&status=in.(pending,approved)&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'hidden', updated_at: new Date().toISOString() }) });
  if (!up.ok) return unavailable(cors);
  if (!rows(up)[0]) return json({ error: 'not_found', message: 'That review is no longer available to hide.' }, 404, cors);
  clearReviewNotice(site.id, id).catch(() => {});
  return json({ data: { ok: true, status: 'hidden' } }, 200, cors);
}

/** Attach (or clear) a short public owner reply, shown under the review on the site. */
export async function handleReviewReply(req: Request, site: SiteRow, id: string, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const reply = cleanOwnerReply(b?.reply ?? b?.owner_reply);
  const up = await svc(`presence_reviews?id=eq.${id}&site_id=eq.${site.id}&select=id,owner_reply`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ owner_reply: reply, updated_at: new Date().toISOString() }) });
  if (!up.ok) return unavailable(cors);
  if (!rows(up)[0]) return json({ error: 'not_found', message: 'That review no longer exists.' }, 404, cors);
  return json({ data: { ok: true, owner_reply: reply } }, 200, cors);
}

/** Owner-initiated: email a customer a branded link to the public review page. The
 *  customer's action (leaving the review) is what creates a pending review — this
 *  never posts a review on their behalf. Target by contact_id OR a raw email+name. */
export async function handleReviewRequest(req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  let email = String(b?.email || '').trim().toLowerCase();
  let name = String(b?.name || '').trim().slice(0, 120);
  const contactId = String(b?.contact_id || '').trim();
  if (!email && UUID_RE.test(contactId)) {
    const c = rows(await svc(`presence_contacts?id=eq.${contactId}&site_id=eq.${site.id}&deleted_at=is.null&select=name,email&limit=1`))[0];
    if (c) { email = String(c.email || '').trim().toLowerCase(); name = name || String(c.name || '').trim().slice(0, 120); }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'bad_email', message: 'Add a valid email to send the request to.' }, 400, cors);

  const ident = rows(await svc(`presence_identity?site_id=eq.${site.id}&select=business_name&limit=1`))[0];
  const biz = ident?.business_name || 'us';
  const brand = await loadEmailBrand(site.id);
  const link = reviewPageUrl(site.id);
  const hi = name ? `Hi ${esc(name)},` : 'Hi there,';
  const sent = await sendEmail(email, `How was your experience with ${biz}?`,
    `<p>${hi}</p>` +
    `<p>Thanks for choosing ${esc(biz)}. If you have a moment, we’d love a quick review — it really helps.</p>` +
    `<p class="cta"><a href="${esc(link)}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:11px 20px;border-radius:999px;text-decoration:none;font-weight:600">Leave a review →</a></p>` +
    `<p style="color:#888;font-size:.85rem;margin-top:14px">It only takes a minute, and your words appear on our site once we’ve seen them.</p>`, brand);
  // sendEmail returns false when suppressed (opt-out/bounce) — report calmly either way.
  return json({ data: { ok: true, sent, email } }, 200, cors);
}

// ═════════ the public review page HTML (self-contained, zero external origins) ═════════
// A calm star picker + name + optional email + a short review. Submits via fetch to the
// SAME endpoint (JSON); degrades to a labelled note with JS off (the widget, like
// booking, needs JS for the live thank-you). Honeypot field `_hp` mirrors the form.
function reviewPageHtml(brand: EmailBrand, endpoint: string): string {
  const name = esc(brand.name);
  const accent = brand.accent, accentDark = brand.accentDark;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Leave a review — ${name}</title><meta name="robots" content="noindex,nofollow">
<style>
:root{--a:${accent};--ad:${accentDark}}
*{box-sizing:border-box}
body{margin:0;background:#f4f2ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b1525;line-height:1.55;padding:28px 14px}
.card{max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(27,21,37,.09)}
.top{height:6px;background:var(--a)}
.pad{padding:26px 28px}
h1{font-size:1.35rem;margin:0 0 4px}
.sub{color:#6b6478;margin:0 0 18px;font-size:.98rem}
label{display:block;font-weight:600;font-size:.9rem;margin:14px 0 5px}
input[type=text],input[type=email],textarea{width:100%;padding:10px 12px;border:1px solid #d9d5e0;border-radius:9px;font:inherit;background:#fff}
textarea{min-height:120px;resize:vertical}
.stars{display:flex;flex-direction:row-reverse;justify-content:flex-end;gap:4px;font-size:2rem;line-height:1}
.stars input{position:absolute;left:-9999px}
.stars label{margin:0;cursor:pointer;color:#d9d5e0;transition:color .1s;font-weight:400}
.stars input:checked ~ label,.stars label:hover,.stars label:hover ~ label{color:var(--a)}
.stars input:focus-visible + label{outline:2px solid var(--ad);outline-offset:2px;border-radius:4px}
.hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:999px;background:var(--a);color:#fff;font:inherit;font-weight:600;font-size:1rem;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
.msg{margin-top:14px;padding:12px 14px;border-radius:10px;font-size:.94rem}
.msg.ok{background:#eaf7ef;color:#166534}.msg.err{background:#fdecea;color:#b42318}
.foot{padding:14px 28px;border-top:1px solid #eee9e0;font-size:.78rem;color:#938ba3}
.hint{color:#8a8398;font-size:.82rem;margin:4px 0 0}
</style></head>
<body>
<main class="card"><div class="top"></div><div class="pad">
<h1>Leave a review</h1>
<p class="sub">Your feedback for ${name} — it appears on their site once they’ve seen it.</p>
<form id="rv" novalidate>
<p class="hp" aria-hidden="true"><label for="rv-hp">Leave this field empty</label><input id="rv-hp" name="_hp" tabindex="-1" autocomplete="off"></p>
<fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:600;font-size:.9rem;margin-bottom:5px">Your rating</legend>
<div class="stars" role="radiogroup" aria-label="Your rating, 1 to 5 stars">
<input type="radio" name="rating" id="s5" value="5"><label for="s5" title="5 stars" aria-label="5 stars">★</label>
<input type="radio" name="rating" id="s4" value="4"><label for="s4" title="4 stars" aria-label="4 stars">★</label>
<input type="radio" name="rating" id="s3" value="3"><label for="s3" title="3 stars" aria-label="3 stars">★</label>
<input type="radio" name="rating" id="s2" value="2"><label for="s2" title="2 stars" aria-label="2 stars">★</label>
<input type="radio" name="rating" id="s1" value="1"><label for="s1" title="1 star" aria-label="1 star">★</label>
</div></fieldset>
<label for="rv-name">Your name</label><input type="text" id="rv-name" name="name" maxlength="120" autocomplete="name" required>
<label for="rv-email">Email <span style="font-weight:400;color:#8a8398">(optional)</span></label><input type="email" id="rv-email" name="email" maxlength="200" autocomplete="email">
<label for="rv-body">Your review</label><textarea id="rv-body" name="body" maxlength="2000" required placeholder="What was your experience like?"></textarea>
<p class="hint">Please don’t include sensitive personal, financial, or medical information.</p>
<button type="submit" id="rv-go">Send review</button>
<div id="rv-msg" hidden></div>
<noscript><p class="msg err" style="margin-top:14px">Please turn on JavaScript to leave a review, or contact ${name} directly.</p></noscript>
</form>
</div><div class="foot">Powered by Studio OS · your review is held for the owner’s approval before it appears.</div></main>
<script>
(function(){
var F=document.getElementById('rv'),M=document.getElementById('rv-msg'),B=document.getElementById('rv-go');
function show(cls,txt){M.hidden=false;M.className='msg '+cls;M.textContent=txt;}
F.addEventListener('submit',function(e){e.preventDefault();
var data={};new FormData(F).forEach(function(v,k){data[k]=v;});
if(!data.rating){show('err','Please choose a rating from 1 to 5 stars.');return;}
B.disabled=true;show('ok','Sending…');
fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
.then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
.then(function(res){var j=res.j&&res.j.data?res.j.data:res.j;
if(res.ok&&j&&j.ok){F.style.display='none';show('ok',(j&&j.message)||'Thank you — your review was received.');}
else{B.disabled=false;show('err',(j&&j.message)||'Something went wrong. Please try again.');}})
.catch(function(){B.disabled=false;show('err','Something went wrong. Please try again.');});
});
})();
</script>
</body></html>`;
}
