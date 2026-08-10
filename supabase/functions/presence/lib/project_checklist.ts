// ── The studio's standard delivery checklist ─────────────────────────────────
// A converted deal used to become an EMPTY project: "PROGRESS 0% · 0/0 tasks",
// forever, because progress is computed from tasks (lib/service_delivery.ts
// progressOf) and there were none. The studio's real delivery is the same ten
// steps every time, so the project now starts as that checklist — ten steps,
// each worth exactly 10%, so the bar moves the moment work does.
//
// DISTINCT FROM lib/project_templates.ts. That is the OPTIONAL, milestone-shaped
// starter a studio picks in the New Project form ("Website build"). This is the
// UNCONDITIONAL spine of a deal→project handoff: fewer, flatter, and — the part
// a template can never be — partly SELF-TICKING. Two of these steps are facts
// the system already owns, so they must not wait on a human to remember them:
//
//   agreement_signed  ← the contract-sign path (routes/sales.ts)
//   deposit_paid      ← a purpose='deposit' invoice marked paid (stripe-webhook)
//   site_live         ← the customer's site reaching status 'live' (routes/publish.ts
//                       and the reconcile that finalizes an async deploy)
//
// THE KEY IS THE `source` COLUMN. presence_tasks.source is free text (0075,
// default 'manual'; the picker template writes 'template'), so each step carries
// `checklist:<key>`. That makes the auto-tick a single WHERE-matched PATCH
// against ONE addressable row — no title matching, no positional guessing, and
// no second table. It is also what makes the tick IDEMPOTENT: the PATCH filters
// on `status=neq.done`, so a re-fired Stripe webhook or a re-published site
// matches zero rows and changes nothing.
//
// CLIENT VISIBILITY follows the convention applyTemplate already established
// (routes/projects.ts): a task is shared with the customer exactly when it
// NEEDS THE CUSTOMER TO ACT — `client_visible = client_action_required`. Seven
// of these ten are the studio's own work and stay internal; the three that are
// genuinely the client's homework are shared, and are therefore titled in the
// client's voice, because the portal renders the raw title on their to-do card.
//
// …BUT SEEING AN ASK IS NOT THE SAME AS SETTLING IT. Those two booleans answer
// two different questions and the checklist needs different answers:
//
//   client_visible          → may the customer SEE this row?          yes ×3
//   client_action_required  → is the customer the one being ASKED?    yes ×3
//   may the customer TICK IT DONE themselves?                          NO ×10
//
// The third question is NOT a third column. It is already answered by `source`,
// because "who gets to assert this step is finished" is the checklist's whole
// point: three of the ten tick themselves from facts the system owns (above),
// and NONE of the ten was ever meant to move on a claim. Only the studio knows
// whether the questionnaire really came back — and the studio's progress bar is
// computed from these very rows (progressOf), so a customer ticking "Send your
// content and photos" would move THE STUDIO'S number on evidence the studio
// does not have. So: a `checklist:` row is OPERATOR-VERIFIED. See clientMayTick
// below — the one predicate, read by routes/client_delivery.ts (the server-side
// refusal) and mirrored by client.html (which simply omits the Mark done
// button). Ordinary manual/template tasks are untouched: they carry no
// `checklist:` source, so they keep the client Mark-done button they have had
// since P2-D.
//
// Pure data + pure helpers. Every insert/update lives in lib/service_bridge.ts.

export interface ChecklistStep {
  /** stable id — persisted as presence_tasks.source = `checklist:<key>`. NEVER rename. */
  key: string;
  title: string;
  /** true → the CUSTOMER has to do this, so it is shared with them and appears
   *  in the portal's "Your to-dos" as their ask. READ-ONLY there: the studio
   *  ticks it when the thing actually arrives (see clientMayTick). */
  clientAction?: boolean;
  /** documents that the system ticks this step itself (see the tick call sites). */
  auto?: 'contract_signed' | 'deposit_paid' | 'site_live';
}

export const CHECKLIST_SOURCE_PREFIX = 'checklist:';
/** The presence_tasks.source value that addresses one step of one project. */
export const checklistSource = (key: string): string => `${CHECKLIST_SOURCE_PREFIX}${key}`;

/** Is this presence_tasks row one of the delivery checklist's steps? */
export const isChecklistSource = (source: unknown): boolean =>
  String(source ?? '').startsWith(CHECKLIST_SOURCE_PREFIX);

/** May the CLIENT mark this task done themselves?
 *
 *  NO for every checklist step, including the three that are addressed to them.
 *  They still SEE those three and are still asked for them — client_visible and
 *  client_action_required both stay true — but the tick is the studio's, because
 *  the studio's progress bar is computed from these rows and only the studio can
 *  see that the questionnaire actually arrived. A checklist step is settled by
 *  EVIDENCE (a signed contract, a paid deposit, a live site) or by the operator
 *  looking at the thing; never by a claim.
 *
 *  YES for everything else — a manual task or a starter-template task
 *  (lib/project_templates.ts) flagged client_action_required keeps the Mark done
 *  button it has had since P2-D. Nothing about those rows changes.
 *
 *  Enforced server-side in routes/client_delivery.ts (handleClientTaskDone) and
 *  mirrored in client.html, which omits the button. The UI is the courtesy; the
 *  route is the rule. */
export const clientMayTick = (source: unknown): boolean => !isChecklistSource(source);

/** The ten steps, in delivery order. Ten steps = 10% each, by construction —
 *  nothing stores that number, progressOf just counts done/total. */
export const DELIVERY_CHECKLIST: ChecklistStep[] = [
  { key: 'agreement_signed',       title: 'Agreement signed',                    auto: 'contract_signed' },
  { key: 'deposit_paid',           title: 'Deposit paid',                        auto: 'deposit_paid' },
  // The client's homework — titled as the ASK, because this exact string is what
  // client.html prints on their to-do card. "Questionnaire returned" is the
  // studio's word for a thing the client has not done yet.
  { key: 'questionnaire_returned', title: 'Send back your project questionnaire', clientAction: true },
  { key: 'content_received',       title: 'Send your content and photos',         clientAction: true },
  { key: 'draft_shared',           title: 'Design draft shared' },
  { key: 'client_review',          title: 'Review the design draft',              clientAction: true },
  { key: 'revisions',              title: 'Revisions' },
  { key: 'domain_connected',       title: 'Domain connected' },
  { key: 'site_live',              title: 'Site live',                            auto: 'site_live' },
  { key: 'handover',               title: 'Handover' },
];

/** Lookup by key (null for anything not in the list). */
export const checklistStep = (key: string): ChecklistStep | null =>
  DELIVERY_CHECKLIST.find((s) => s.key === key) || null;

/** The rows to insert for a project, in order. Pure — the caller supplies ids.
 *  sort_order strides by 10 so a studio can hand-insert between steps later
 *  (the same stride nextSortOrder/applyTemplate use). */
export function checklistRows(siteId: string, projectId: string): Array<Record<string, unknown>> {
  return DELIVERY_CHECKLIST.map((s, i) => ({
    site_id: siteId,
    project_id: projectId,
    title: s.title,
    detail: '',
    status: 'todo',
    priority: 'normal',
    // Both stay true for the client's three: they SEE it, and it IS their ask.
    // What they cannot do is tick it — that is read off `source` below, not off
    // either of these flags (clientMayTick).
    client_visible: s.clientAction === true,
    client_action_required: s.clientAction === true,
    sort_order: i * 10,
    source: checklistSource(s.key),
  }));
}
