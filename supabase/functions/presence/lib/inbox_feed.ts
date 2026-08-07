// ── The studio Inbox / bell arithmetic, pure ─────────────────────────────────
// Two rules used to live inline inside handleWorkspaceContext / handlePortalFeed
// (routes/workspace.ts), where neither could be tested without standing up a
// whole request. Both got a defect that only a behavioural test would have
// caught, so they live here now: no imports, no I/O, one job each.
//
//   studioBellCount(..)          what the shell bell badge shows
//   shapeClientConversations(..) the per-project Inbox conversation rows
//
// The routes still own every READ; this file only decides what the rows mean.

/** The client-portal notice kinds raised by lib/service_bridge.ts
 *  (notifyStudioOfClientAction, migration 0116).
 *
 *  These notices exist to be the EMAIL THROTTLE KEY — raiseNotice returns
 *  created=true only on the first insert for (client, kind, thread+bucket), and
 *  that flag is what gates the operator email. They also render in the bell
 *  rail. What they must NOT do is COUNT: every one of them is already
 *  represented in the badge by the same action's other half —
 *
 *    client_message  ┐
 *    client_upload   ├─ a presence_project_events row stamped detail.from='client'
 *    client_approval ┘  (counted, and CLEARED, by the last-seen read mark)
 *    client_request  ─── an open presence_support_requests row (counted until resolved)
 *
 *  Counting the notice too double-counted every client action, and — unlike
 *  every other per-event notice kind, which has an explicit clearNotice
 *  teardown — nothing ever cleared it, so the badge only ever rose. Excluding
 *  the four here is exact (never an under-count) and needs no new teardown
 *  path: the half that IS counted already clears itself.
 *
 *  FINISHED at the source: excluding them from the COUNT still left them
 *  RENDERING as permanent rows, so the list and the badge said different things
 *  and no amount of work made the rows go away. notifyStudioOfClientAction now
 *  raises all four pre-dismissed (lib/service_bridge.ts) — a silent ledger that
 *  is only ever the throttle key, exactly as described above. This set stays as
 *  the belt-and-braces guard for rows raised before that change. */
export const CLIENT_ACTIVITY_NOTICE_KINDS: ReadonlySet<string> = new Set([
  'client_message', 'client_upload', 'client_request', 'client_approval',
]);

/** ── WHAT A "DONE" CLICK MAY NEVER HIDE ──────────────────────────────────────
 *  Most needs-you rows now tear themselves down when the work is done, but some
 *  genuine residue is left over, so the list carries a manual "Done". A manual
 *  dismiss is a statement about the ROW, never about the obligation behind it —
 *  and for money and legal obligations those two are the same thing. Hiding
 *  "Still unpaid" does not make an invoice paid; hiding "Deletion requested" or
 *  "Your site is down" or "Publishing failed" only removes the one place the
 *  owner would have found out.
 *
 *  ── THE ENTRY PRICE: A KIND MAY ONLY BE PROTECTED IF SOMETHING CLEARS IT ────
 *  Protection without a teardown is not a guard, it is a TRAP: the row becomes
 *  permanent, both dismiss surfaces refuse it forever, and everything derived
 *  from an active notice (agency/portfolio.ts's `billing_issue` flag, the
 *  attention badge in lib/attention_center.ts) stays lit for work that is long
 *  since done. So every kind below names the code that takes it down:
 *
 *    deal_followup + invremind:  ← the money lands — stripe-webhook's paid echo
 *                                  clears it (first, and again on a retry of an
 *                                  already-paid invoice)
 *    deletion_requested          ← POST /commerce/delete-cancel (routes/commerce.ts)
 *    site_down                   ← the uptime heartbeat recovers (monitor/heartbeat.ts)
 *    publish_failed              ← a publish succeeds (routes/publish.ts)
 *
 *  NOT protected, deliberately: `payment_trouble` and `account_lapsed`. They read
 *  like the most protection-worthy kinds in the product, and they were in this
 *  set for exactly one commit — but they have NO AUTOMATIC TEARDOWN anywhere:
 *  commerce/lifecycle.ts raises them on a 'YYYY-MM' bucket and no billing-sync,
 *  entitlement or webhook path has ever cleared them. Protecting them meant a
 *  customer who fixed their card kept a permanent "Your card failed" row, a
 *  permanent portfolio `billing_issue` flag, and a permanently inflated badge,
 *  with both dismiss surfaces answering 409. The operator's hand is the ONLY
 *  teardown these two have, so it must stay. If a real teardown is ever written
 *  (the billing sync seeing a good charge is the obvious home), add it back here
 *  — tests/presence/needs_you_rfixes_test.mjs enforces that biconditional in
 *  both directions and will tell you.
 *
 *  This is ONE rule with THREE enforcement points — the feed derives each row's
 *  `dismissible` flag from it (so no button is even drawn on Today), the plum
 *  card in presence.html does the same, and the dismiss route re-checks it (so a
 *  hand-rolled API call can't hide an unpaid invoice either). All three import
 *  THIS function; there is deliberately no second copy. */
export const NOTICE_PROTECTED_KINDS: ReadonlySet<string> = new Set([
  'deletion_requested', 'site_down', 'publish_failed',
]);
/** The invoice reminder rides the shared `deal_followup` kind, so the KIND alone
 *  can't tell an unpaid invoice from an ordinary "follow up on this deal" — only
 *  the period prefix can. That is exactly why the feed had to start exposing
 *  `period`. Prefix-anchored, never a substring match.
 *
 *  Its ONE teardown is the money landing. There is no second escape: nothing in
 *  the platform can void a `presence_invoices` row — pipeline.html renders a
 *  "Voided" state but no route ever writes status:'void' — so an invoice raised
 *  in error can only be cleared by paying it or by a hand-written DB update.
 *  That is a real gap, recorded here so the guard's justification stays honest;
 *  it is not a reason to weaken the guard. */
export const NOTICE_PROTECTED_PERIOD_PREFIX = 'invremind:';
export function noticeDismissible(kind: unknown, period: unknown): boolean {
  const k = String(kind ?? '');
  if (NOTICE_PROTECTED_KINDS.has(k)) return false;
  // FAIL CLOSED. A deal_followup with no period cannot be shown to be an
  // ordinary follow-up, and "can't tell" must never resolve to "hide the unpaid
  // invoice". Unreachable while `period` stays `text not null` (migration 0037)
  // and `kind` stays CHECK-constrained — but a money guard must not rest on a DB
  // constraint holding in a different file.
  if (k === 'deal_followup') {
    const p = period == null ? '' : String(period);
    if (p === '' || p.startsWith(NOTICE_PROTECTED_PERIOD_PREFIX)) return false;
  }
  return true;
}

export interface BellInput {
  /** active presence_plan_notices rows (kind only is used) */
  notices: Array<{ kind?: unknown }>;
  /** presence_form_submissions with status=new (raw count — deduped here) */
  newEnquiries: number;
  proposedPlans: number;
  proposedWrites: number;
  /** presence_media rows awaiting a replace decision */
  filesPending: number;
  /** open presence_section_comments from the client */
  openFeedback: number;
  /** open/in-progress presence_support_requests */
  openSupport: number;
  /** presence_project_events on this site, already narrowed to the notifying kinds */
  clientEvents: Array<{ created_at?: unknown; detail?: unknown }>;
  /** presence_activity_reads.last_seen_at for this reader (null = never read) */
  lastSeenAt: string | null;
}

/** The ONE "needs you" number behind the shell bell badge (studio surfaces).
 *  Every input is best-effort upstream, so a missing slot arrives as 0/[] and
 *  simply contributes nothing. */
export function studioBellCount(i: BellInput): number {
  const notices = i.notices || [];
  // FIX 1 dedupe (unchanged): the lead-followup cron already raises a per-lead
  // notice for AGED 'new' leads, so count only the fresh enquiries not yet
  // represented by one — a single lead never stacks two signals.
  const leadFollowups = notices.filter((n) => n && n.kind === 'lead_followup').length;
  const newEnquiries = Math.max(0, (i.newEnquiries || 0) - leadFollowups);
  // F1: the client-portal notices are the email throttle key, not a count.
  const countedNotices = notices.filter((n) => !CLIENT_ACTIVITY_NOTICE_KINDS.has(String(n?.kind ?? ''))).length;
  // detail.from='client' is stamped ONLY by the client door (client_delivery.ts /
  // inbound_email.ts) — actor_kind can't tell the customer from the studio owner
  // (both 'client'), and the studio's own actions must never ring its own bell.
  const unseenClient = (i.clientEvents || []).filter((e) => {
    if (i.lastSeenAt && String(e?.created_at ?? '') <= String(i.lastSeenAt)) return false;
    return ((e?.detail || {}) as Record<string, unknown>).from === 'client';
  }).length;
  return countedNotices + (i.proposedPlans || 0) + (i.proposedWrites || 0)
    + (i.filesPending || 0) + newEnquiries + (i.openFeedback || 0)
    + (i.openSupport || 0) + unseenClient;
}

// ── The Inbox's per-project conversation rows ────────────────────────────────

export interface ConversationEvent {
  project_id?: unknown;
  kind?: unknown;
  detail?: unknown;
  created_at?: unknown;
}

export interface ConversationRow {
  /** the newest COUNTED event — drives the row's timestamp */
  latest: ConversationEvent;
  /** how much conversation this thread holds */
  count: number;
  /** newest client-side activity, or null — the per-thread unread input */
  latestClientAt: string | null;
  /** the client is still waiting on the studio */
  needsReply: boolean;
}

const fromOf = (e: ConversationEvent): string => String(((e?.detail || {}) as Record<string, unknown>).from ?? '');
const at = (e: ConversationEvent): string => String(e?.created_at ?? '');

/** Does this client-side event AWAIT a studio response?
 *  A message or a file the client sent does. A to-do they ticked is progress,
 *  not a question. An approval they decided depends on the decision: a clean
 *  approve is finished business, a rejection / change-request is a new ask.
 *  (Before this, the widened event read flipped a thread to "needs reply" the
 *  moment a client APPROVED something — the opposite of the truth.) */
function awaitsStudio(e: ConversationEvent): boolean {
  const kind = String(e?.kind ?? '');
  if (kind === 'approval_decided') {
    const d = String(((e?.detail || {}) as Record<string, unknown>).decision ?? '');
    return d !== '' && d !== 'approved';
  }
  if (kind === 'task_done' || kind === 'survey_submitted') return false;
  return true;   // message, client_upload, support_message, …
}

/** Should this event be part of the client conversation at all?
 *  A `message` counts whichever direction it went — the row summarises the
 *  whole thread, and the studio's own replies are what clear needs-reply.
 *  Every OTHER kind counts only when the CLIENT did it: routes/projects.ts
 *  projectEvent (the studio door) stamps no detail.from, so widening the read
 *  to approval_decided silently let a STUDIO-side approval decision inflate the
 *  client-conversation count. Unstamped ⇒ studio ⇒ not this client's thread. */
function counts(e: ConversationEvent): boolean {
  return String(e?.kind ?? '') === 'message' || fromOf(e) === 'client';
}

/** Reduce a site's project events into one row per project conversation.
 *  Order-independent (every winner is chosen by explicit timestamp compare), so
 *  it cannot silently depend on the caller's `order=created_at.desc`. */
export function shapeClientConversations(events: ConversationEvent[]): Map<string, ConversationRow> {
  const out = new Map<string, ConversationRow>();
  const newestStudio = new Map<string, string>();   // per project: newest studio-side counted event
  const newestAsk = new Map<string, string>();      // per project: newest client event awaiting a reply
  for (const e of events || []) {
    const pid = String(e?.project_id ?? '');
    if (!pid || !counts(e)) continue;
    const when = at(e);
    const isClient = fromOf(e) === 'client';
    const cur = out.get(pid);
    if (!cur) out.set(pid, { latest: e, count: 1, latestClientAt: isClient ? when : null, needsReply: false });
    else {
      cur.count++;
      if (when > at(cur.latest)) cur.latest = e;
      if (isClient && (cur.latestClientAt === null || when > cur.latestClientAt)) cur.latestClientAt = when;
    }
    if (isClient) { if (awaitsStudio(e) && when > (newestAsk.get(pid) || '')) newestAsk.set(pid, when); }
    else if (when > (newestStudio.get(pid) || '')) newestStudio.set(pid, when);
  }
  for (const [pid, row] of out) {
    const ask = newestAsk.get(pid) || '';
    // still on the studio when the client's newest QUESTION is newer than
    // anything the studio has said since.
    row.needsReply = ask !== '' && ask > (newestStudio.get(pid) || '');
  }
  return out;
}
