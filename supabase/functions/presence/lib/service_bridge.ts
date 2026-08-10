// ── Agency–Client Bridge — store helpers (Presence CMS Phase 2, P2-D hardening) ─
// The tenant-safe link between an agency-site delivery project and the customer's
// own workspace. ONE authoritative project (on the agency site); the customer
// reaches only their linked, client-visible delivery through this bridge. Used by
// the convert handoff (create project + bridge, idempotent) and the /client/*
// endpoints (resolve which projects a customer may see).
import { svc } from './db.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const nowIso = () => new Date().toISOString();

async function projectEventRow(siteId: string, projectId: string, kind: string, actor: string, actorKind: string, clientVisible: boolean, detail: Record<string, unknown> = {}) {
  await svc('presence_project_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ project_id: projectId, site_id: siteId, kind, actor, actor_kind: actorKind, client_visible: clientVisible, detail }) }).catch(() => {});
}

/** Upsert the bridge for a project (idempotent — UNIQUE(project_id)). Enforces the
 *  frozen launch constraint: ONE primary agency per customer. A customer already
 *  owned by a DIFFERENT agency is refused (returns false) — the link is not made. */
export async function ensureBridge(agencySiteId: string, projectId: string, customerClientId: string | null, customerSiteId: string | null, dealId: string | null): Promise<boolean> {
  if (!customerClientId) return false; // a project with no customer (manual studio project) needs no bridge
  // claim the customer's primary agency (first writer wins; PK enforces one-agency)
  await svc('presence_customer_agency?on_conflict=customer_client_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ customer_client_id: customerClientId, agency_site_id: agencySiteId }) }).catch(() => {});
  const owner = rows(await svc(`presence_customer_agency?customer_client_id=eq.${customerClientId}&select=agency_site_id&limit=1`))[0];
  if (owner && owner.agency_site_id !== agencySiteId) return false; // belongs to another agency — refuse (multi-agency is deferred)
  const r = await svc('presence_service_links?on_conflict=project_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ agency_site_id: agencySiteId, project_id: projectId, customer_client_id: customerClientId, customer_site_id: customerSiteId, deal_id: dealId, status: 'active' }),
  });
  return r.ok;
}

export interface DealForHandoff { id: string; title?: string | null; created_project_id?: string | null; converted_client_id?: string | null; converted_site_id?: string | null; }

/** Idempotently ensure a delivery PROJECT + BRIDGE exist for a converted deal.
 *  Creates the project on the AGENCY site (client_id = the customer), stamps
 *  deal.created_project_id (race-safe), links the bridge, and records a handoff
 *  event. Re-running returns the existing project (never a duplicate). */
export async function ensureProjectForDeal(opts: {
  agencySiteId: string; deal: DealForHandoff; clientId: string | null; customerSiteId: string | null; actor: string; actorKind: string;
}): Promise<{ ok: boolean; project: any | null; idempotent: boolean; conflict?: boolean }> {
  const { agencySiteId, deal, clientId, customerSiteId, actor, actorKind } = opts;

  // already handed off → return the existing project (+ ensure the bridge)
  if (deal.created_project_id) {
    const existing = rows(await svc(`presence_projects?id=eq.${deal.created_project_id}&site_id=eq.${agencySiteId}&deleted_at=is.null&select=*&limit=1`))[0];
    if (existing) { await ensureBridge(agencySiteId, existing.id, clientId, customerSiteId, deal.id); return { ok: true, project: existing, idempotent: true }; }
  }

  const ins = await svc('presence_projects', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: agencySiteId, client_id: clientId, deal_id: deal.id, name: String(deal.title || 'New project').slice(0, 200), description: '', status: 'active', client_visible: true }) });
  const project = rows(ins)[0];
  if (!project) return { ok: false, project: null, idempotent: false };

  // claim the handoff atomically (UNIQUE created_project_id backs this)
  const claim = await svc(`presence_deals?id=eq.${deal.id}&site_id=eq.${agencySiteId}&created_project_id=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ created_project_id: project.id }) });
  if (!rows(claim)[0]) { // lost the race → drop our orphan, return the winner
    await svc(`presence_projects?id=eq.${project.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: nowIso() }) }).catch(() => {});
    const fresh = rows(await svc(`presence_deals?id=eq.${deal.id}&site_id=eq.${agencySiteId}&select=created_project_id&limit=1`))[0];
    const won = fresh?.created_project_id ? rows(await svc(`presence_projects?id=eq.${fresh.created_project_id}&site_id=eq.${agencySiteId}&deleted_at=is.null&select=*&limit=1`))[0] : null;
    if (won) { await ensureBridge(agencySiteId, won.id, clientId, customerSiteId, deal.id); return { ok: true, project: won, idempotent: true }; }
    return { ok: false, project: null, idempotent: false, conflict: true };
  }

  await ensureBridge(agencySiteId, project.id, clientId, customerSiteId, deal.id);
  // A handed-off project is NOT an empty shell. Before this, a converted deal
  // produced a project with zero tasks, so the record page read "PROGRESS 0% ·
  // 0/0 tasks" forever — progress is COMPUTED from tasks (progressOf), so with
  // none there was no number to move. It starts as the studio's ten-step
  // delivery checklist instead; two of those steps then tick themselves off the
  // facts the system already owns (signing, the deposit). Best-effort and
  // self-guarding — the handoff is complete with or without it.
  await seedProjectChecklist(agencySiteId, project.id);
  // …and the two self-ticking steps are ALREADY TRUE by the time a project
  // exists: the normal order is sign → pay the deposit → convert, so a freshly
  // seeded checklist that started every step at 'todo' would be lying about two
  // facts nobody would ever go back and tick. Reconcile them from the evidence.
  await reconcileChecklistFacts(agencySiteId, deal.id, project.id);
  await projectEventRow(agencySiteId, project.id, 'project_created', actor, actorKind, true, { name: project.name, from_deal: deal.id });
  return { ok: true, project, idempotent: false };
}

// ── customer-side resolution (the /client/* endpoints) ──
export interface Link { project_id: string; agency_site_id: string; customer_client_id: string; }

/** The active links for a customer (by their clients.id). Bounded. */
export async function linksForCustomer(customerClientId: string): Promise<Link[]> {
  if (!customerClientId) return [];
  return rows(await svc(`presence_service_links?customer_client_id=eq.${customerClientId}&status=eq.active&select=project_id,agency_site_id,customer_client_id&order=created_at.desc&limit=200`)) as Link[];
}

/** Verify a customer is linked to a specific project; returns the link (with the
 *  agency_site_id the data lives on) or null. This is the tenant-isolation gate
 *  for every /client/* project action. */
export async function linkForCustomerProject(customerClientId: string, projectId: string): Promise<Link | null> {
  if (!customerClientId || !projectId) return null;
  return rows(await svc(`presence_service_links?project_id=eq.${projectId}&customer_client_id=eq.${customerClientId}&status=eq.active&select=project_id,agency_site_id,customer_client_id&limit=1`))[0] || null;
}

/** Given an approval / deliverable / survey / support id, resolve the project it
 *  belongs to (on any agency site) then verify the customer is linked to it.
 *  Returns { link, siteId } or null. `table` must be a delivery table with a
 *  project_id column; `parentCol` is the id column to match. */
export async function linkForCustomerVia(customerClientId: string, table: string, id: string, hasProject = true): Promise<{ link: Link; row: any } | null> {
  if (!customerClientId || !id) return null;
  const sel = hasProject ? 'project_id,site_id' : 'site_id';
  const row = rows(await svc(`${table}?id=eq.${id}&deleted_at=is.null&select=id,${sel}&limit=1`))[0];
  if (!row || !row.project_id) return null;
  const link = await linkForCustomerProject(customerClientId, row.project_id);
  return link ? { link, row } : null;
}

/** F3: resolve a requester (their auth uid + email) to THIS agency site's
 *  bridged customer — the write-time client_id stamp for support rows. Matches
 *  the same identities the read paths key on (contacts.auth_user_id →
 *  clients.contact_id; clients.email / contact_email — exact, case-insensitive)
 *  and gates on an ACTIVE service_link to the agency site (tenant-safe: an
 *  unbridged namesake never earns the stamp). Best-effort: null on any failure —
 *  the caller falls back to an unstamped row, never blocks the write. */
export async function clientIdForRequester(agencySiteId: string, requester: { userId?: string | null; email?: string | null }): Promise<string | null> {
  try {
    if (!agencySiteId) return null;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const email = String(requester?.email || '').trim().toLowerCase();
    const uid = String(requester?.userId || '').trim();
    const candidates: string[] = [];
    if (email && !/[(),*"\\]/.test(email)) {
      const enc = encodeURIComponent(email);
      const byEmail = rows(await svc(`clients?or=(email.ilike.${enc},contact_email.ilike.${enc})&deleted_at=is.null&select=id,email,contact_email&limit=25`))
        .filter((c) => String(c.email || '').toLowerCase() === email || String(c.contact_email || '').toLowerCase() === email);
      for (const c of byEmail) { const id = String(c.id); if (UUID_RE.test(id) && !candidates.includes(id)) candidates.push(id); }
    }
    if (uid && UUID_RE.test(uid)) {
      const contacts = rows(await svc(`contacts?auth_user_id=eq.${uid}&select=id&limit=10`)).map((c) => String(c.id)).filter((id) => UUID_RE.test(id));
      if (contacts.length) {
        for (const c of rows(await svc(`clients?contact_id=in.(${contacts.join(',')})&deleted_at=is.null&select=id&limit=25`))) {
          const id = String(c.id); if (UUID_RE.test(id) && !candidates.includes(id)) candidates.push(id);
        }
      }
    }
    if (!candidates.length) return null;
    const links = rows(await svc(`presence_service_links?agency_site_id=eq.${agencySiteId}&status=eq.active&customer_client_id=in.(${candidates.join(',')})&select=customer_client_id&limit=25`));
    const bridged = new Set(links.map((l) => String(l.customer_client_id)));
    return candidates.find((id) => bridged.has(id)) || null;
  } catch { return null; }
}

/** Email the bridged customer about project activity that needs them (a studio
 *  message, an approval request). Without this, the delivery loop stalls unless
 *  the client habitually opens the portal — an approval could sit unseen forever.
 *  Best-effort: resolves project → bridge → customer email; never throws. */
export async function emailBridgedCustomer(agencySiteId: string, projectId: string, subject: string, bodyHtml: string): Promise<boolean> {
  try {
    const link = rows(await svc(`presence_service_links?project_id=eq.${projectId}&agency_site_id=eq.${agencySiteId}&status=eq.active&select=customer_client_id&limit=1`))[0];
    if (!link?.customer_client_id) return false;
    const client = rows(await svc(`clients?id=eq.${link.customer_client_id}&select=email&limit=1`))[0];
    const email = client?.email ? String(client.email) : '';
    if (!email) return false;
    const { sendEmail } = await import('../commerce/account.ts');
    const { loadEmailBrand } = await import('./email_brand.ts');
    const brand = await loadEmailBrand(agencySiteId);
    // Deep-link straight to the project (client.html honors ?project=) — landing
    // on Home and hunting for the approval was the #1 seam in the email loop.
    const btn = `<a href="${(Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com')}/client.html?project=${encodeURIComponent(projectId)}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Open your project →</a>`;
    // critical: this is the "your project needs you" nudge — an opted-out client's
    // approval/message must still reach them (bounces still suppress).
    return await sendEmail(email, subject, `${bodyHtml}<p class="cta">${btn}</p>`, brand, { critical: true, siteId: agencySiteId });
  } catch { return false; }
}

/** Email a customer DIRECTLY by their clients.id — the transactional channel for
 *  a support request that has no project to resolve a recipient through (the
 *  auto-acknowledgement of a new ticket). Same agency brand + "open your project"
 *  button as emailBridgedCustomer. Best-effort: never throws. */
export async function emailCustomerByClient(agencySiteId: string, customerClientId: string | null, subject: string, bodyHtml: string): Promise<boolean> {
  try {
    if (!customerClientId) return false;
    const client = rows(await svc(`clients?id=eq.${customerClientId}&select=email&limit=1`))[0];
    const email = client?.email ? String(client.email) : '';
    if (!email) return false;
    const { sendEmail } = await import('../commerce/account.ts');
    const { loadEmailBrand } = await import('./email_brand.ts');
    const brand = await loadEmailBrand(agencySiteId);
    const btn = `<a href="${(Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com')}/client.html" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Open your project →</a>`;
    return await sendEmail(email, subject, `${bodyHtml}<p class="cta">${btn}</p>`, brand, { critical: true, siteId: agencySiteId });
  } catch { return false; }
}

// ── OPERATOR NOTIFICATIONS — the mirror image of the two helpers above ───────
// A client acting in the portal (a message, a file, a request, an approval
// decision) used to reach the studio ONLY as an in-app row nobody was watching.
// This is the ONE seam that turns those four actions into instant, throttled
// operator mail. It deliberately sits beside emailBridgedCustomer /
// emailCustomerByClient (same agency-site resolution, same brand, same
// best-effort contract) so studio↔client mail has exactly one home.
//
// Callers never act on a result and this never throws — a client's message must
// not fail because the operator's notice or email did. It is NOT, however,
// fire-and-forget: an un-awaited chain can be torn down with the isolate before
// the mail leaves. notifyStudioOfClientAction below owns that policy
// (EdgeRuntime.waitUntil, else a capped inline await); call sites await IT.

/** The four client actions the operator is emailed about (Eric's list). Each is
 *  also a `presence_plan_notices.kind` — widened by migration 0116. */
export type ClientActionKind = 'client_message' | 'client_upload' | 'client_request' | 'client_approval';

const SITE_BASE = () => (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');
const escHtml = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** THROTTLE WINDOW. The notice model's unique key is (client_id, kind, period),
 *  and raiseNotice returns created=true ONLY on the first insert — so `period`
 *  IS the throttle. We key it `<thread>:<15-minute bucket>`.
 *
 *  What that DOES guarantee — one email per EXISTING thread per quarter-hour,
 *  per kind. A client dropping six files into one project sends ONE email; six
 *  messages on one project thread send one; replies onto one open support
 *  request (portal or emailed in — both use `req:<id>`) send one. 15 minutes
 *  mirrors the outbound throttle in project_comms.ts, so the two directions of
 *  the same conversation behave alike.
 *
 *  What it does NOT — throttle across DIFFERENT threads. Opening a brand-new
 *  service request mints a new request id (client_delivery.ts / inbound_email.ts),
 *  so N new requests are N distinct threads and send N emails. That is the
 *  intended reading (each is its own ticket, and collapsing them would hide
 *  one), but it is NOT "one email per conversation per quarter-hour" — say the
 *  weaker, true thing rather than the stronger, false one.
 *  Terminal one-shot events (an approval decision) pass bucket:false: the period
 *  is the bare thread key, so they email exactly once, ever. */
const BUCKET_MS = 15 * 60 * 1000;
export const noticePeriodFor = (threadKey: string, bucket = true): string =>
  bucket ? `${threadKey}:${Math.floor(Date.now() / BUCKET_MS)}` : threadKey;

/** Resolve WHO at the studio receives this. Strictly single-tenant-safe:
 *  every lookup is scoped to `agencySiteId` — the site the delivery lives on,
 *  which is by construction the STUDIO's own site (it comes from
 *  presence_service_links.agency_site_id), never a customer's site.
 *
 *    1. presence_identity.email — that site's own configured contact. This rung
 *       WINS: whatever address sits in that one field is where every operator
 *       notification for this site lands, and rungs 2-3 are only reached when
 *       it is blank. (On the platform's own agency site that means the identity
 *       card, not OPS_ALERT_EMAIL, decides Eric's inbox.)
 *    2. the site owner's OWN clients row (presence_sites.client_id → clients.
 *       email / contact_email). Still strictly that site's operator, so this
 *       can never cross tenants — it just closes the silent `if (!to) return`
 *       hole for a site whose identity card was never filled in.
 *    3. OPS_ALERT_EMAIL — the PLATFORM operator's address, and therefore ONLY
 *       legitimate for the platform's OWN agency site. Gated on an explicit
 *       AGENCY_SITE_ID env match (documented in the env manifest,
 *       routes/system.ts): routing another tenant's client activity to the
 *       platform operator would be a privacy breach, so an unset or
 *       non-matching AGENCY_SITE_ID means this rung simply does not exist.
 *  Nothing left → a clear warn and no send (never a throw, never a wrong inbox).
 *
 *  The two independent rows (the site + its identity card) are read in ONE
 *  wave — this helper sits on the front of a chain that must finish before an
 *  edge response resolves, so every avoidable serial hop is latency the email
 *  might not survive. */
export async function studioRecipient(agencySiteId: string): Promise<{ to: string; ownerClientId: string }> {
  const [siteR, identR] = await Promise.all([
    svc(`presence_sites?id=eq.${agencySiteId}&select=client_id&limit=1`),
    svc(`presence_identity?site_id=eq.${agencySiteId}&select=business_name,email&limit=1`),
  ]);
  const site = rows(siteR)[0];
  const ownerClientId = site?.client_id ? String(site.client_id) : '';
  const ident = rows(identR)[0];
  let to = String(ident?.email || '').trim();
  if (!to && ownerClientId) {
    const owner = rows(await svc(`clients?id=eq.${ownerClientId}&select=email,contact_email&limit=1`))[0];
    to = String(owner?.email || owner?.contact_email || '').trim();
  }
  if (!to && Deno.env.get('AGENCY_SITE_ID') && Deno.env.get('AGENCY_SITE_ID') === agencySiteId) {
    to = String(Deno.env.get('OPS_ALERT_EMAIL') || '').trim();   // the platform's OWN agency site only
  }
  return { to, ownerClientId };
}

const HEADLINE: Record<ClientActionKind, string> = {
  client_message: 'New message from',
  client_upload: 'New file from',
  client_request: 'New request from',
  client_approval: 'Approval decision from',
};
const LEAD: Record<ClientActionKind, string> = {
  client_message: 'wrote to you about their project.',
  client_upload: 'sent you a file.',
  client_request: 'has a request for you.',
  client_approval: 'made a decision on something you sent for approval.',
};

export interface ClientActionNotice {
  agencySiteId: string;             // the STUDIO's site (presence_service_links.agency_site_id)
  kind: ClientActionKind;
  threadKey: string;                // the throttle scope: 'proj:<id>' | 'req:<id>' | 'approval:<id>'
  bucket?: boolean;                 // default true (15-min window); false = once, forever (a terminal event)
  customerClientId?: string | null; // who acted — for the "who" line (best-effort)
  projectId?: string | null;        // which project — for the "what" line (best-effort)
  subject: string;                  // the short what: message subject / filename / request subject / decision
  excerpt?: string;                 // enough of the content to act on without logging in
  href: string;                     // a deep link into the RIGHT studio surface (site-relative)
}

/** How long an INLINE (non-edge) delivery may hold the client's request open.
 *  A hung Resend must never stall a client's upload response — past the cap we
 *  stop waiting and let the work finish (or not) on its own. */
const NOTIFY_INLINE_CAP_MS = 3000;

/** DELIVERY (the call sites' entry point). The work below is a multi-hop chain
 *  ending at Resend, and an edge isolate is free to tear down the moment the
 *  response resolves — an un-awaited `.catch(() => {})` was a coin flip on
 *  whether the email ever left. For a feature whose entire purpose is sending
 *  mail, silent non-delivery is the worst failure, so:
 *
 *    • EdgeRuntime.waitUntil (feature-detected — Supabase Edge Functions have
 *      it, `deno run` and the tests do not) keeps the runtime alive for the
 *      handed-off promise. The client's request pays nothing.
 *    • Otherwise we AWAIT inline, capped by Promise.race, so the work really
 *      completes before the response resolves without a hung dependency ever
 *      stalling the client past `capMs`.
 *
 *  The original guarantee is unchanged and is what makes awaiting safe: this
 *  never throws and never rejects, so a client's message/upload/approval can
 *  never fail because the operator's notification did. Call sites `await` it
 *  (an un-awaited fallback would keep nothing alive — that is the whole point). */
export async function notifyStudioOfClientAction(n: ClientActionNotice, capMs = NOTIFY_INLINE_CAP_MS): Promise<void> {
  try {
    const work = deliverStudioNotification(n).catch(() => false);
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt && typeof rt.waitUntil === 'function') { rt.waitUntil(work); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([work, new Promise<false>((res) => { timer = setTimeout(() => res(false), capMs); })]);
    if (timer !== undefined) clearTimeout(timer);   // never hold the isolate open on the winner's behalf
  } catch { /* delivery is best-effort — the client's request comes first */ }
}

/** Tell the studio a client did something. Raises the notice on the ONE model
 *  (bell + web push) and — ONLY when that notice was newly created, i.e. this
 *  thread hasn't already notified inside the window — emails the operator.
 *  Returns true when an email actually went out. Never throws.
 *  This is the WORKER: call sites use notifyStudioOfClientAction above, which
 *  owns the survive-the-response policy. Exported so it can be driven directly. */
export async function deliverStudioNotification(n: ClientActionNotice): Promise<boolean> {
  try {
    if (!n?.agencySiteId || !n?.kind || !n?.threadKey) return false;
    // ONE wave for every independent hop: the recipient (itself two parallel
    // reads), WHO acted, WHAT it was about, and the notice module. These used to
    // run strictly one after another — five serial round trips on the front of a
    // chain that has to outlive the response.
    const [recipient, whoRow, projRow, noticeMod] = await Promise.all([
      studioRecipient(n.agencySiteId),
      n.customerClientId
        ? svc(`clients?id=eq.${n.customerClientId}&select=name,email&limit=1`).then((r) => rows(r)[0] || null).catch(() => null)
        : Promise.resolve(null),
      n.projectId
        ? svc(`presence_projects?id=eq.${n.projectId}&site_id=eq.${n.agencySiteId}&deleted_at=is.null&select=name&limit=1`).then((r) => rows(r)[0] || null).catch(() => null)
        : Promise.resolve(null),
      import('./notice.ts'),
    ]);
    const { to, ownerClientId } = recipient;
    if (!ownerClientId) {
      // No owner client row → no key for the ONE notice model, so there is no
      // throttle to lean on. Sending unthrottled is worse than not sending.
      console.warn(`[operator-notify] site ${n.agencySiteId} has no owner client_id — skipping ${n.kind} (non-fatal)`);
      return false;
    }
    if (!to) {
      console.warn(`[operator-notify] no operator recipient for site ${n.agencySiteId} (presence_identity.email and the owner's client email are both empty) — skipping ${n.kind} (non-fatal)`);
      return false;
    }

    // WHO acted + WHAT it was about (best-effort; the mail is still sendable
    // without either — mirrors how the booking/lead notifiers degrade).
    const who = String(whoRow?.name || whoRow?.email || 'A client').slice(0, 80);
    const projectName = String(projRow?.name || '').slice(0, 120);

    const subject = String(n.subject || '').slice(0, 200);
    const excerpt = String(n.excerpt || '').slice(0, 600);
    const headline = `${HEADLINE[n.kind]} ${who}${projectName ? ` — ${projectName}` : ''}`;

    // The notice IS the throttle: created===true only on the first insert for
    // this (owner, kind, thread + 15-minute bucket). Pre-0116 the CHECK
    // constraint rejects the insert → created=false → no email, no crash.
    //
    // It is ONLY the throttle — recorded 'dismissed', a silent ledger row.
    // lib/inbox_feed.ts already documents why these four must not COUNT: every
    // one of them is represented in the badge by the same action's other half
    // (a project event, or an open support request), which counts AND clears
    // itself. But excluding them from the count left them still RENDERING as
    // permanent rows — nothing ever cleared them — so the list and the badge
    // openly disagreed, and the rows never went away no matter what the operator
    // did. Pre-dismissing finishes that fix at the source: no row, no
    // double-count, no push, and — because `created` still reflects the FIRST
    // insert on the unique (client, kind, period) key — the email throttle below
    // is completely unaffected.
    const { raiseNotice } = noticeMod;
    const created = await raiseNotice({
      siteId: n.agencySiteId, clientId: ownerClientId, kind: n.kind,
      period: noticePeriodFor(n.threadKey, n.bucket !== false),
      status: 'dismissed',
      // …but STILL buzz the device. Row-silent is not notification-silent: "a
      // client just messaged you" is the most time-sensitive thing the operator
      // can be told, and it is exactly what the pre-dismissed row must not stop.
      // Explicit, because raiseNotice would otherwise default push off for a
      // dismissed row — and that default silently killed all four of these
      // pushes when this line first became a silent ledger.
      push: true,
      headline,
      body: `${subject || LEAD[n.kind]}${excerpt ? ` — “${excerpt.slice(0, 160)}”` : ''}`,
    });
    if (!created) return false;   // already notified for this thread inside the window

    // Past the throttle gate: the send module + the brand are independent — one
    // wave, not two hops (the dynamic imports keep this file free of an import
    // cycle through commerce/account.ts).
    const [{ sendEmail }, { loadEmailBrand }] = await Promise.all([
      import('../commerce/account.ts'), import('./email_brand.ts'),
    ]);
    const brand = await loadEmailBrand(n.agencySiteId);
    const link = `${SITE_BASE()}${n.href.startsWith('/') ? n.href : `/${n.href}`}`;
    const html =
      `<p><b>${escHtml(who)}</b> ${LEAD[n.kind]}</p>` +
      (projectName || subject
        ? `<table style="margin:8px 0;border-collapse:collapse">` +
          (projectName ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Project</td><td><b>${escHtml(projectName)}</b></td></tr>` : '') +
          (subject ? `<tr><td style="padding:2px 12px 2px 0;color:#666">${n.kind === 'client_upload' ? 'File' : n.kind === 'client_approval' ? 'Decision' : 'Subject'}</td><td><b>${escHtml(subject)}</b></td></tr>` : '') +
          `</table>`
        : '') +
      (excerpt ? `<blockquote style="margin:8px 0;padding:8px 14px;border-left:3px solid ${brand.accent};color:#444">${escHtml(excerpt)}</blockquote>` : '') +
      `<p class="cta"><a href="${link}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Open it in your workspace →</a></p>`;

    // ⚠ REPLY-TO — the load-bearing detail of this whole helper.
    // commerce/account.ts sets reply_to to the site's INBOUND WEBHOOK address
    // (<siteId>@RESEND_INBOUND_DOMAIN) whenever opts.siteId is passed. That is
    // right for mail we send TO a customer (their reply should land back on
    // their conversation) and CATASTROPHIC for mail we send to the OPERATOR:
    // Eric hitting Reply would post his text into /email/inbound, where it can
    // be routed onto a client's thread (lib/inbound_email.ts isSelfSender only
    // catches address-exact senders, so replying from a phone's Gmail alias
    // slips straight through). Operator notifications therefore OMIT siteId and
    // keep the human PLATFORM_REPLY_TO. Do not "fix" this by adding siteId.
    // critical:true is REQUIRED: commerce/account.ts maySend silently suppresses
    // non-critical mail for an opted-out address, which would make these
    // notifications vanish with no signal.
    return await sendEmail(to, `${headline}`.slice(0, 180), html, brand, { critical: true });
  } catch (e) {
    console.warn(`[operator-notify] ${n?.kind} failed for site ${n?.agencySiteId}: ${String((e as Error)?.message || e)} (non-fatal)`);
    return false;
  }
}

/** Email the site's OPERATOR about something the system just learned — the one
 *  door every operator-facing email goes through.
 *
 *  WHY IT EXISTS. Five lifecycle sweeps and both money moments used to do this
 *  by hand, and every one of them did it the same broken way:
 *
 *      const owner = ident.json?.[0]?.email;   // presence_identity.email
 *      if (owner) { … }                        // …and silence if it's blank
 *
 *  presence_identity.email is `default ''` (0015_presence_phase1.sql:82). Eric's
 *  is blank, so `if (owner)` was false on every sweep and his deal-followup,
 *  lead-followup, support-aging, renewal and agreement-renewal mail had ALL been
 *  dying silently — no send, no log, nothing to notice. studioRecipient is the
 *  only resolver with a fallback chain (identity → the owner's own clients row →
 *  OPS_ALERT_EMAIL, that last rung gated on AGENCY_SITE_ID), and a dead end here
 *  WARNS instead of vanishing.
 *
 *  Two properties are load-bearing and must not be "simplified":
 *    • NO opts.siteId — that would set reply_to to the site's INBOUND WEBHOOK
 *      address, so the operator hitting Reply would post his text into
 *      /email/inbound. Operator mail keeps the human PLATFORM_REPLY_TO.
 *    • critical:true — maySend silently suppresses non-critical mail for an
 *      opted-out address; operational mail to the studio must survive that
 *      (a bounce/complaint still suppresses, which is correct).
 *
 *  `what` is a short tag for the log line only. `cta` renders the button HERE
 *  rather than at the call site, because only this function has the loaded brand
 *  — a caller building its own button has to hardcode an accent colour, and a
 *  hardcoded accent is wrong for every studio but one. Never throws; returns
 *  whether a send was actually accepted. */
export async function emailOperator(agencySiteId: string, subject: string, html: string, what: string, cta?: { label: string; href: string }): Promise<boolean> {
  try {
    if (!agencySiteId) return false;
    const [{ to }, { sendEmail }, { loadEmailBrand }] = await Promise.all([
      studioRecipient(agencySiteId),
      import('../commerce/account.ts'),
      import('./email_brand.ts'),
    ]);
    if (!to) {
      console.warn(`[operator-mail] no operator recipient for site ${agencySiteId} (presence_identity.email and the owner's client email are both empty) — skipping ${what} (non-fatal)`);
      return false;
    }
    const brand = await loadEmailBrand(agencySiteId);
    // class="cta" is what the branded shell keys its white link text off
    // (lib/email_brand.ts); the background has to be inline for email clients.
    const body = cta
      ? `${html}<p class="cta"><a href="${cta.href}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">${cta.label} →</a></p>`
      : html;
    return await sendEmail(to, subject.slice(0, 180), body, brand, { critical: true });
  } catch (e) {
    console.warn(`[operator-mail] ${what} failed for site ${agencySiteId}: ${String((e as Error)?.message || e)} (non-fatal)`);
    return false;
  }
}

// ── The standard delivery checklist (see lib/project_checklist.ts) ───────────

/** Seed the studio's ten-step checklist onto a project. SELF-GUARDING: it only
 *  ever fills an EMPTY project, so it can be called from the handoff, from a
 *  backfill, or twice in a row, and never duplicates or overwrites a studio's
 *  own tasks. Returns how many steps were written (0 = already had tasks, or the
 *  insert failed). Best-effort — a project must never fail to exist because its
 *  scaffold didn't. */
export async function seedProjectChecklist(siteId: string, projectId: string): Promise<number> {
  try {
    if (!siteId || !projectId) return 0;
    // ANY task row blocks the seed, INCLUDING a soft-deleted one — deliberately
    // stricter than `deleted_at is null`, and the same rule the 0120 backfill
    // uses. A studio that deleted these steps meant it; re-seeding them on the
    // next call (or the next time the backfill is pasted) would resurrect work
    // they threw away.
    const existing = rows(await svc(`presence_tasks?project_id=eq.${projectId}&site_id=eq.${siteId}&select=id&limit=1`));
    if (existing.length) return 0;   // never merge into a project that already has work on it
    const { checklistRows } = await import('./project_checklist.ts');
    const body = checklistRows(siteId, projectId);
    // ONE insert, not ten round trips — and no per-task activity event: this is
    // the scaffold, not a stream of "a task was added" notifications (the same
    // call applyTemplate makes).
    const ins = await svc('presence_tasks', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
    if (!ins.ok) { console.warn(`[checklist] seed failed for project ${projectId}: ${ins.status} (non-fatal)`); return 0; }
    return rows(ins).length;
  } catch (e) {
    console.warn(`[checklist] seed threw for project ${projectId}: ${String((e as Error)?.message || e)} (non-fatal)`);
    return 0;
  }
}

/** Tick one checklist step done. THE IDEMPOTENCY GUARANTEE lives in this one
 *  query: the PATCH is filtered on `source=eq.checklist:<key>` AND
 *  `status=neq.done`, with return=representation, so
 *
 *    • a re-fired Stripe webhook, a second sign POST, or a re-publish matches
 *      ZERO rows — nothing is written and `false` comes back, so the caller's
 *      "we just ticked it" side effects (the activity event) don't fire twice;
 *    • a step the studio already ticked by hand is left exactly as it was,
 *      including its completed_at;
 *    • a project with no checklist (pre-backfill, or a studio that deleted the
 *      step) is a clean no-op.
 *
 *  Never throws — it hangs off signing, payment and publishing, and none of
 *  those may fail because their bookkeeping did. */
export async function tickChecklistStep(siteId: string, projectId: string, key: string, actor = 'system', actorKind = 'system'): Promise<boolean> {
  try {
    if (!siteId || !projectId || !key) return false;
    const { checklistSource } = await import('./project_checklist.ts');
    const src = encodeURIComponent(checklistSource(key));
    const done = nowIso();
    const up = await svc(
      `presence_tasks?project_id=eq.${projectId}&site_id=eq.${siteId}&source=eq.${src}&status=neq.done&deleted_at=is.null&select=id,title,client_visible`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'done', completed_at: done, updated_at: done }) },
    );
    const row = rows(up)[0];
    if (!row) return false;   // already done, or no such step — either way, nothing happened
    await projectEventRow(siteId, projectId, 'task_status_change', actor, actorKind, row.client_visible === true, { task_id: row.id, title: row.title, status: 'done', auto: key });
    return true;
  } catch (e) {
    console.warn(`[checklist] tick ${key} failed for project ${projectId}: ${String((e as Error)?.message || e)} (non-fatal)`);
    return false;
  }
}

/** Tick a step on the project a DEAL was handed off to (deal.created_project_id).
 *  The sign + deposit paths know a deal, not a project. No project yet (the deal
 *  hasn't been converted) → a clean false. */
export async function tickChecklistForDeal(agencySiteId: string, dealId: string, key: string, actor = 'system', actorKind = 'system'): Promise<boolean> {
  try {
    if (!agencySiteId || !dealId) return false;
    const deal = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${agencySiteId}&select=created_project_id&limit=1`))[0];
    if (!deal?.created_project_id) return false;
    return await tickChecklistStep(agencySiteId, String(deal.created_project_id), key, actor, actorKind);
  } catch { return false; }
}

/** Tick a step on whatever delivery project is bridged to a CUSTOMER's site —
 *  the seam publishing needs, since a publish knows only the site it just put
 *  live. Scoped through the ACTIVE service link, so the tick lands on the
 *  agency's project and can never cross tenants. */
export async function tickChecklistForCustomerSite(customerSiteId: string, key: string, actor = 'system', actorKind = 'system'): Promise<boolean> {
  try {
    if (!customerSiteId) return false;
    const link = rows(await svc(`presence_service_links?customer_site_id=eq.${customerSiteId}&status=eq.active&select=project_id,agency_site_id&order=created_at.desc&limit=1`))[0];
    if (!link?.project_id || !link?.agency_site_id) return false;
    return await tickChecklistStep(String(link.agency_site_id), String(link.project_id), key, actor, actorKind);
  } catch { return false; }
}

/** Tick the self-ticking steps from evidence already in the database, rather
 *  than from an event we happened to be present for.
 *
 *  The handoff order is sign → pay the deposit → CONVERT, so by the time a
 *  project exists both of those facts are usually already true and their live
 *  tick call sites (the sign route, the paid webhook) fired long before there
 *  was a checklist to tick. A freshly seeded checklist would therefore start
 *  with two steps at 'todo' that are simply false — and nothing would ever
 *  correct them. This reads the evidence instead: a SIGNED contract on the deal,
 *  and a PAID deposit invoice on the deal.
 *
 *  Same idempotency as every other tick (the PATCH matches only non-done rows),
 *  so calling it on an already-reconciled project writes nothing. Best-effort. */
export async function reconcileChecklistFacts(agencySiteId: string, dealId: string, projectId: string): Promise<void> {
  try {
    if (!agencySiteId || !dealId || !projectId) return;
    const [signedQ, depQ] = await Promise.all([
      svc(`presence_contracts?deal_id=eq.${dealId}&site_id=eq.${agencySiteId}&status=eq.signed&deleted_at=is.null&select=id&limit=1`),
      svc(`presence_invoices?deal_id=eq.${dealId}&site_id=eq.${agencySiteId}&purpose=eq.deposit&status=eq.paid&deleted_at=is.null&select=id&limit=1`),
    ]);
    if (rows(signedQ).length) await tickChecklistStep(agencySiteId, projectId, 'agreement_signed', 'system', 'system');
    if (rows(depQ).length) await tickChecklistStep(agencySiteId, projectId, 'deposit_paid', 'system', 'system');
  } catch { /* the checklist is still usable un-reconciled */ }
}
