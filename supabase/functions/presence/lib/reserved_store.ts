// ── Reserved JSON rows (no migration) ────────────────────────────────────────
// Small studio-level settings kept as ONE reserved presence_sales_templates row
// each (kind=proposal, a reserved name, the JSON in `body`): the same site-scoped,
// deny-all, function-mediated store the services catalog and contact fields use.
// The templates list leaves every reserved name out (routes/sales.ts).
import { svc } from './db.ts';

export const RESERVED_NAMES = {
  intakeForm: '__intake_form__',          // builder list item 176: a client site's content form and its link (lib/intake_form.ts)
  intakeAnswers: '__intake_answers__',    // builder list item 176: what the client wrote on it, and their files
  handoverKit: '__handover_kit__',        // builder list item 176: the client's hand-over kit (lib/handover_kit.ts)
  savedViews: '__saved_views__',          // sales review item 31
  sitePins: '__site_pins__',              // builder list item 45: each member's pinned sites (agency/sites.ts)
  broadcastLists: '__broadcast_lists__',  // sales review items 31 + 39
  stageNames: '__stage_names__',          // sales review item 38
  stageChances: '__stage_chances__',      // sales review item 69: the chance each open stage closes
  emailLog: '__email_log__',              // sales review item 69: the private "log this email" address
  calendarFeed: '__calendar_feed__',      // sales review item 46: the private calendar link
  navHidden: '__nav_hidden__',            // builder list item 54: the menu areas the studio hides (agency/routes.ts, routes/workspace.ts)
  monthlyReport: '__monthly_report__',    // builder list item 58: the client's monthly report email (on, the studio's line, last month sent) (ops/monthly_report.ts)
  siteNotify: '__site_notify__',          // builder list item 126: what the studio hears about each client site, and how (lib/site_notify.ts)
  versionStars: '__version_stars__',      // builder list item 158: the versions starred in Versions (routes/publish.ts)
  followedSearches: '__followed_searches__',   // builder list item 181: the searches a client follows on Google, ten at most (lib/search_tools.ts)
  searchPhrases: '__search_phrases__',    // builder list item 160: the two or three phrases the business wants to be found for (lib/search_phrases.ts)
  aiQuestions: '__ai_questions__',        // builder list item 182: the questions a client's monthly AI check asks, ten at most (lib/ai_watch.ts)
  doNext: '__do_next__',                  // builder list item 184: what the studio marked Done or Not relevant on a client's Do next list (lib/do_next.ts)
  copiedFrom: '__copied_from__',          // builder list item 145: what Duplicate or a template copied onto a new site, until changed or kept (lib/site_layout.ts)
  domainNotes: '__domain_notes__',        // builder list item 162: the studio's notes on a client's domain (whose account, renews by itself, a note) (agency/sites.ts)
  domainMail: '__domain_mail__',          // builder list item 163: the domain's email records as they were, to say so if they vanish (lib/domain_notify.ts)
  domainLive: '__domain_live__',          // builder list item 164: the domain the "your website is live" email went out for, so it goes once (lib/domain_notify.ts)
  formCheck: '__form_check__',           // builder list item 140: since when the site's pages ask for a time ticket (lib/form_check.ts)
  spamSenders: '__spam_senders__',        // builder list item 140: hashes of the addresses the owner marked as spam (lib/form_check.ts)
  bookingOptions: '__booking_options__',  // builder list item 149: customers may change or cancel; the owner's own calendar's private address (lib/booking_links.ts)
  projectTemplates: '__project_templates__',   // sales item 106: the studio's own project templates (lib/project_templates.ts)
  todoLists: '__todo_lists__',            // sales item 106: the studio's saved lists of deal to-dos (lib/todo_templates.ts)
  bookingBusy: '__booking_busy__',        // builder list item 149: the busy times last read from that calendar, and how the last read went (routes/booking.ts)
} as const;

const rowsOf = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
// Final pass (Nov 8, F2 + F9): one row per site and name — migration 0138 makes
// the database refuse a second — and the newest row wins wherever two exist
// (before the migration lands, or for a moment during a race).
const live = (siteId: string, name: string) => `presence_sales_templates?site_id=eq.${siteId}&kind=eq.proposal&name=eq.${encodeURIComponent(name)}&deleted_at=is.null`;
const path = (siteId: string, name: string, sel: string) => `${live(siteId, name)}&select=${sel}&order=updated_at.desc&limit=1`;
const parse = (body: unknown): unknown => { try { return body ? JSON.parse(String(body)) : null; } catch { return null; } };

/** The same read, but a failed read THROWS instead of answering null — for a
 *  caller that keeps what it read (lib/stage_names.ts) and must never keep a
 *  failure as if it were "nothing saved". */
export async function readReservedJsonOrThrow(siteId: string, name: string): Promise<unknown> {
  const r = await svc(path(siteId, name, 'body'));
  if (!r.ok) throw new Error('reserved_read_failed');
  const row = rowsOf(r)[0];
  return row ? parse(row.body) : null;
}

/** The stored JSON, or null when there is none or it can't be read. */
export async function readReservedJson(siteId: string, name: string): Promise<unknown> {
  try {
    const r = await svc(path(siteId, name, 'body'));
    if (!r.ok) return null;
    const row = rowsOf(r)[0];
    return row ? parse(row.body) : null;
  } catch { return null; }
}

/** Store `value` as the whole setting. Every live row of the name gets it, so a
 *  stray duplicate can never keep an old value (a calendar link "turned off" in
 *  one row stayed on in the other). Creates the row when there is none; a
 *  second writer racing to create it gets the database's unique refusal and
 *  writes over the winner instead. False on any failure. */
export async function writeReservedJson(siteId: string, name: string, value: unknown, createdBy: string): Promise<boolean> {
  try {
    const body = JSON.stringify(value);
    const patch = () => svc(`${live(siteId, name)}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ body, updated_at: new Date().toISOString() }) });
    const p1 = await patch();
    if (p1.ok && rowsOf(p1).length) return true;
    const ins = await svc('presence_sales_templates', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: siteId, kind: 'proposal', name, title: '', body, created_by: createdBy }) });
    if (ins.ok && rowsOf(ins).length) return true;
    if (ins.status === 409) { const p2 = await patch(); return p2.ok && rowsOf(p2).length > 0; }   // lost the race to create it
    return false;
  } catch { return false; }
}

/** Change PART of a setting (one list's saved views, one picked list) without
 *  losing a change someone else saved a moment earlier (F9: read, change, write
 *  used to drop the other person's save). The write only lands if the row is
 *  still the version that was read; otherwise it reads again and re-applies the
 *  change. `change` gets the current value (null when there is none) and
 *  returns the new one. Returns the stored value, or null when it couldn't. */
export async function updateReservedJson<T>(siteId: string, name: string, change: (current: unknown) => T, createdBy: string, tries = 5): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const cur = rowsOf(await svc(path(siteId, name, 'id,body,updated_at')))[0];
      const next = change(cur ? parse(cur.body) : null);
      const body = JSON.stringify(next);
      if (cur) {
        const w = await svc(`presence_sales_templates?id=eq.${cur.id}&site_id=eq.${siteId}&updated_at=eq.${encodeURIComponent(String(cur.updated_at))}&select=id`, {
          method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ body, updated_at: new Date().toISOString() }),
        });
        if (w.ok && rowsOf(w).length) return next;
        if (!w.ok) return null;
        continue;   // someone saved in between — read their version and apply ours to it
      }
      const ins = await svc('presence_sales_templates', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: siteId, kind: 'proposal', name, title: '', body, created_by: createdBy }) });
      if (ins.ok && rowsOf(ins).length) return next;
      if (ins.status !== 409) return null;   // a racing first save made the row — go round and apply ours to it
    } catch { return null; }
  }
  return null;
}
