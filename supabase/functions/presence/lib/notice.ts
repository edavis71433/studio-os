// ── Website-attention notices — ONE model, reused (P2-F G3) ──────────────────
// The workspace already has a single notice model: presence_plan_notices, keyed
// unique (client_id, kind, period), rendered by the calm notice card + counted
// by the bell. This helper is the one way to raise a website-attention item
// (publish failed, connection expired, …) onto that SAME model — so there is no
// second notification system. Idempotent by the unique key: the `period` is the
// dedupe scope (use a stable id like `pub:<id>` for once-per-event, or a month
// bucket for once-per-month). Best-effort; never throws.
import { svc } from './db.ts';
// the ONE filter-grammar rule (pure, no imports of its own — no cycle)
import { filterSafe } from './inbound_email.ts';

export interface NoticeInput {
  siteId: string;
  clientId: string;
  kind: string;      // e.g. 'publish_failed' | 'connection_expired' | 'website_enquiry'
  period: string;    // dedupe scope: a stable event id or a 'YYYY-MM' bucket
  headline: string;
  body: string;
  /** 'active' (default) = a real needs-you ROW on the bell / Today / Inbox.
   *  'dismissed' = a SILENT LEDGER row: it still occupies the unique
   *  (client_id, kind, period) key — so `created` is still the exact send-once /
   *  throttle gate — but it never renders and never pushes. The codebase's
   *  existing idiom for "this is a record that something was sent, not a thing
   *  asking for you" (see runBookingReminders). */
  status?: 'active' | 'dismissed';
  /** Should a NEW row also buzz the owner's device?
   *
   *  Defaults to `status === 'active'`, which is right for almost everything —
   *  but it is a DEFAULT, never a derivation. "Is a row drawn?" and "must the
   *  owner be reached?" are different questions, and conflating them silently
   *  killed the four client_* pushes the moment those kinds became silent-ledger
   *  rows: "a client just messaged you" is the most time-sensitive notification
   *  in the product, and it stopped firing with nothing to show for it.
   *  notifyStudioOfClientAction now passes `push: true` explicitly, so those four
   *  reach the device while staying out of the list; the sales doc reminder
   *  (`status: 'dismissed'`, no push) stays silent, which is what it should be.
   *  Only ever fires on FIRST creation — a re-raise never re-pushes. */
  push?: boolean;
}

/** Raise (or no-op if already present for this client/kind/period) a notice.
 *  Returns true only when a NEW row was inserted — so callers can send an email
 *  or bump a counter exactly once. */
export async function raiseNotice(n: NoticeInput): Promise<boolean> {
  try {
    const status = n.status === 'dismissed' ? 'dismissed' : 'active';
    const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        site_id: n.siteId, client_id: n.clientId, kind: n.kind, period: n.period,
        headline: n.headline.slice(0, 200), body: n.body.slice(0, 1000), status,
      }),
    });
    const created = ins.ok && Array.isArray(ins.json) && ins.json.length > 0;
    // A NEW notice also pushes to the owner's device (best-effort, gated on VAPID
    // keys). Only on first creation so a re-raise never re-pushes. WHETHER to
    // push is its own explicit decision — `status` only defaults it (see the
    // `push` field above); a silent-ledger row that genuinely is urgent can and
    // must still reach the device.
    const wantsPush = n.push === undefined ? status === 'active' : n.push === true;
    if (created && wantsPush) {
      try {
        const { pushToSite } = await import('../routes/push.ts');
        const href = (await import('../routes/workspace.ts')).noticeHref(n.kind);
        pushToSite(n.siteId, { title: n.headline.slice(0, 80), body: n.body.slice(0, 140), url: href, tag: `notice:${n.kind}` }).catch(() => {});
      } catch { /* push is best-effort */ }
    }
    return created;
  } catch (e) {
    console.error(`[notice] failed to raise ${n.kind} for ${n.clientId}: ${String((e as Error)?.message || e)} (non-fatal)`);
    return false;
  }
}

/** Clear an active notice of a kind for a client (e.g. once a publish recovers).
 *  Optional `period` narrows to one event. Best-effort. */
export async function clearNotice(clientId: string, kind: string, period?: string): Promise<void> {
  const scope = `client_id=eq.${encodeURIComponent(clientId)}&kind=eq.${encodeURIComponent(kind)}&status=eq.active${period ? `&period=eq.${encodeURIComponent(period)}` : ''}`;
  await svc(`presence_plan_notices?${scope}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) }).catch(() => {});
}

/** Clear every active notice of a kind whose `period` starts with `prefix`.
 *
 *  Needed once a dedupe key carries a rolling bucket: support-aging now re-nudges
 *  weekly as `support:<id>:w<n>`, so "this request is handled" can no longer be
 *  said with a single exact period — last week's row and this week's row are both
 *  active and both must go.
 *
 *  ── WHY THE GUARD ───────────────────────────────────────────────────────────
 *  This is the one helper in the file that builds a PATTERN rather than an exact
 *  match, and a pattern that widens is a silent mass-dismiss. Two ways that
 *  happens, both invisible at the call site:
 *    · `encodeURIComponent` leaves `_ * ! ~ ' ( ) - .` alone, and PostgREST's
 *      `like` reads BOTH `*` and `_` as wildcards — so a prefix carrying either
 *      quietly matches rows it was never meant to.
 *    · `,` `(` `)` `"` `\` are PostgREST FILTER GRAMMAR — they don't widen the
 *      pattern, they break out of the value.
 *  Today's single caller passes a twice-gated UUID, so neither can happen; that
 *  is a property of the CALLER, not of this function, and the next caller will
 *  not know it. So the guard lives here: filter grammar (and an empty prefix,
 *  which would clear every row of the kind) is REFUSED outright rather than
 *  quietly widened, using the same `filterSafe` rule the inbound-email reads use;
 *  `_` and `%` in the literal part are escaped for LIKE. The trailing `*` is
 *  appended OUTSIDE the encoding, so it is the ONLY wildcard that can ever reach
 *  PostgREST. Best-effort, exactly like clearNotice. */
const likeLiteral = (s: string): string => s.replace(/[\\%_]/g, '\\$&');
export async function clearNoticePrefix(clientId: string, kind: string, prefix: string): Promise<void> {
  const safe = filterSafe(prefix);
  if (safe === null) {
    // Refuse, loudly, rather than clear more than we were asked to.
    console.error(`[notice] refusing clearNoticePrefix for ${kind}: unsafe period prefix ${JSON.stringify(prefix)}`);
    return;
  }
  const scope = `client_id=eq.${encodeURIComponent(clientId)}&kind=eq.${encodeURIComponent(kind)}&status=eq.active&period=like.${encodeURIComponent(likeLiteral(safe))}*`;
  await svc(`presence_plan_notices?${scope}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) }).catch(() => {});
}

/** When a CLIENT REVIEWER decides something (a plan, a connected write, a file,
 *  a launch), the owner must be actively told — "your studio has been told" was
 *  silently untrue before this. Owner deciding their own item = no notice (noise).
 *  Best-effort; idempotent per subject via the period key. */
export async function notifyOwnerOfReviewerDecision(
  site: { id: string; client_id: string },
  principal: { kind: string },
  headline: string,
  period: string,
): Promise<void> {
  try {
    const { resolveSiteRoleCached } = await import('./workspace.ts');
    const role = await resolveSiteRoleCached(principal as never, '', site.id);
    if (role !== 'client_reviewer') return;
    await raiseNotice({
      siteId: site.id, clientId: site.client_id, kind: 'approval_decided', period,
      headline, body: 'Your reviewer made a decision. Nothing needed from you — it’s on the timeline if you want the details.',
    });
  } catch { /* never block a decision on its echo */ }
}
