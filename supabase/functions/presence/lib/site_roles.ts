// ── Site-level roles (A7) — the audience WITHIN one site ─────────────────────
// Distinct from the agency principal (spans a portfolio) and the operator
// (`staff`). A site's owning client is always the business_owner; additional
// people are granted a role via presence_site_members. Permissions as DATA, one
// place, pure. ADDITIVE: with no members assigned, the owner sees everything —
// exactly today's behavior — so nothing regresses. Deny-by-default.
//
// This is the foundation the client-portal differentiation, the read-only
// stakeholder, business staff, and Developer-Mode prep all build on. It does NOT
// change tenant isolation (which site) — only the audience within a site.

export type SiteRole = 'business_owner' | 'business_staff' | 'client_reviewer' | 'developer';

export const SITE_ROLES: readonly SiteRole[] = ['business_owner', 'business_staff', 'client_reviewer', 'developer'];
export function isSiteRole(r: string): r is SiteRole { return (SITE_ROLES as readonly string[]).includes(r); }

export type SiteCapability =
  | 'view_all'             // see the full business-owner workspace
  | 'view_shared'          // see only items shared to the client (the client portal)
  | 'edit'                 // edit content/drafts
  | 'approve'              // approve plans / drafts (the sign-off)
  | 'publish'              // publish to the live site
  | 'connect'              // manage connected services
  | 'configure'            // settings
  | 'delete'
  | 'export'               // download everything you can see (ownership)
  | 'invite'               // invite / manage site members
  | 'comment'              // leave comments on shared items
  | 'use_developer_mode';  // A8 prep — off unless the role grants it

// The one capability table. Business owner = full; business staff = operate but
// not delete/configure/invite; client reviewer = the client portal (review,
// approve, comment, export shared); developer = full + developer mode (no
// delete/invite by default).
const CAPS: Record<SiteRole, SiteCapability[]> = {
  business_owner: ['view_all', 'edit', 'approve', 'publish', 'connect', 'configure', 'delete', 'export', 'invite', 'comment'],
  business_staff: ['view_all', 'edit', 'approve', 'publish', 'connect', 'export', 'comment'],
  client_reviewer: ['view_shared', 'approve', 'export', 'comment'],
  developer: ['view_all', 'edit', 'approve', 'publish', 'connect', 'configure', 'export', 'comment', 'use_developer_mode'],
};

export function siteCan(role: SiteRole, cap: SiteCapability): boolean {
  return (CAPS[role] || []).includes(cap);
}

export function capabilitiesOf(role: SiteRole): SiteCapability[] {
  return [...(CAPS[role] || [])];
}

/** A reviewer is the "client" audience — sees only shared items. Everyone else
 *  (owner/staff/developer, and the operator) sees the full workspace. */
export function seesFullWorkspace(role: SiteRole): boolean {
  return siteCan(role, 'view_all');
}

// ── What a member's write on the content data path needs ─────────────────────
// A member reaches content through the service role (lib/db.ts siteDb), so RLS
// can't hold them to the table above: routes/workspace.ts memberWriteGate does,
// with this. Owners and a studio scoped in never pass through it.
//
// presence_settings is one row holding two kinds of thing. These fields are the
// website itself, so 'edit' covers them. Anything else, including a field added
// later, is account configuration (verification codes, automation switches) and
// needs 'configure'.
export const SETTINGS_CONTENT_FIELDS: ReadonlySet<string> = new Set([
  'category_order', 'cover_media_id', 'logo_media_id', 'og_media_id',
  'announcement_text', 'announcement_url', 'announcement_expires_at',
  'popup',   // builder list item 148: the site's pop-up is content, like the announcement bar
  'hero_layout', 'nav_style', 'sections_hidden', 'sections_order', 'footer_hours', 'footer_social',
  'pages_noindex', 'page_seo', 'blocks', 'pages', 'nav',
  'post_categories', 'post_authors',   // builder list item 40: the blog's categories and authors are content
]);

/** The capability this write needs, or null when it isn't a write on the content
 *  data path. Pure. `settingsFields` is the body's keys, for PUT /settings only. */
export function contentWriteNeeds(route: string, method: string, settingsFields: string[] = []): SiteCapability | null {
  if (method === 'PUT' && (route === '/identity' || route === '/location' || route === '/brand/profile')) return 'edit';
  if (method === 'POST' && route === '/pages/duplicate') return 'edit';
  if (method === 'POST' && /^\/pages\/deleted\/[0-9a-f-]{36}\/restore$/.test(route)) return 'edit';   // item 154: putting a deleted page back is an edit of the pages
  if (method === 'PUT' && route === '/settings') return settingsFields.every((f) => SETTINGS_CONTENT_FIELDS.has(f)) ? 'edit' : 'configure';
  const m = route.match(/^\/(?:offerings|testimonials|faqs|posts)(\/[0-9a-f-]{36})?$/);
  if (!m) return null;
  if (method === 'POST' && !m[1]) return 'edit';
  if ((method === 'PUT' || method === 'PATCH') && m[1]) return 'edit';
  if (method === 'DELETE' && m[1]) return 'delete';
  return null;
}

// ── What a member's write anywhere else needs ────────────────────────────────
// Every other route writes with the service role whoever calls it, so this list is
// what holds a member to the table above. Owners, a studio scoped in and platform
// staff never pass through it. Audited route by route and decided 2026-11-05.
//
// Only delete and configure refuse anyone today: staff, developer and owner seats
// all hold the rest, and a reviewer stops at reviewerAllowed first. A write that
// isn't listed is refused, so a new route is closed to members until it is decided.
//
// 'open' needs no capability: a mark on the caller's own reading, a question that
// writes nothing, or a route that checks the role itself and says why in its answer.
export type MemberWriteNeed = SiteCapability | 'open';

const ID = '[0-9a-f-]{36}';
const KEY = '[a-z0-9_]+';
const MEMBER_WRITES: Array<[MemberWriteNeed, string[]]> = [
  ['delete', [
    `POST /client/retainers/${ID}/cancel`,   // sales item 117: stopping the business's own recurring payment is the owner's call
    `DELETE /(media|assets|redirects|content-library|publishes/checkpoints|bookings/types|knowledge/docs)/${ID}`,
    `DELETE /sales/(contacts|deals|proposals|contracts|templates|estimates)/${ID}`,
    `DELETE /sales/prospects/${ID}`,   // sales review item 112: taking a prospect off the list
    `DELETE /projects/${ID}/deliverables/${ID}`,
    `DELETE /projects/templates/${ID}`,   // sales item 106: removing a saved project template, like a saved proposal template
    `DELETE /sales/todo-templates/${ID}`,   // sales item 106: removing a saved to-do list, the same
    `POST /comments/${ID}/delete`,
    `POST /sales/invoices/${ID}/void`,
    `POST /sales/invoices/${ID}/payment/undo`,   // sales review item 77: taking back a recorded payment changes the books, like a void
    `POST /sales/deals/${ID}/retainer/cancel`,
    `POST /sales/recurring/${ID}/stop`,   // sales review item 47: stopping a recurring invoice ends its billing, like cancelling a retainer
    'DELETE /broadcasts/lists/[A-Za-z0-9-]{6,40}',   // sales review items 31 + 39: removing a picked list
    `POST /sales/contacts/imports/${ID}/undo`,   // sales review item 86: undoing an import takes the people it added off the list
    `POST /sales/contacts/${ID}/(merge|unmerge)`,   // items 86 + 105: a merge folds one record away (and its undo brings it back)
  ]],
  ['configure', [
    'PUT /sales/stages',   // sales review item 38: renaming the studio's deal stages is a setting
    '(POST|DELETE) /calendar/link',   // sales review item 46: making or turning off the private calendar link is a setting
    '(POST|DELETE) /email/log-address',   // sales review item 69: the private log-this-email address is a setting too
    'POST /reviews/google-link',   // sales review item 115: where Google review requests send people is a setting
    'POST /sales/setup',   // sales item 105: hiding Home's setup strip is the studio's setting
    'PUT /report/monthly', 'POST /report/monthly/preview',   // builder list item 58: the client's monthly report is a setting; its preview emails the caller
    '(POST|DELETE) /foundations/domain',
    '(POST|DELETE) /foundations/domain/forward',   // builder list item 174: another domain forwarding here is a domain setting
    'POST /foundations/prepare',
    'POST /preview/settings',
    'POST /site/(offline|online|password)',   // list item 175: a visitor password is a setting, like taking the site offline
    'PUT /bookings/settings',
    'PUT /sales/contacts/fields',
  ]],
  ['approve', [
    `POST /foundations/plans/${ID}/decide`,
    `POST /connections/${KEY}/write/${ID}/decide`,
    `POST /launches/${ID}/decide`,
    `POST /assets/${ID}/status`,
    `POST /visual/plans/${ID}/decide`,
    `POST /(client/)?approvals/${ID}/decide`,
  ]],
  ['connect', [
    'POST /connections/ask',
    `POST /connections/${KEY}/(connect|callback|refresh|disconnect|property)`,
    `POST /connections/${KEY}/write/(prepare(/(decide|execute|rollback))?|${ID}/(execute|rollback))`,
    'POST /monitor/(connect|verify)',
    'DELETE /monitor/connection',
  ]],
  ['publish', [
    'POST /(publish|restore|preview/promote|schedule)',
    `POST /posts/${ID}/(publish|unpublish)`,   // builder list item 40: one blog post onto (or off) the live site, on its own
    `POST /schedule/${ID}/cancel`,
    `POST /launches/${ID}/(schedule|promote|rollback)`,
    `POST /broadcasts/${ID}/send`,
  ]],
  ['comment', [
    'POST /comments',
    `POST /comments/${ID}/resolve`,
    `POST /client/approvals/${ID}/notes`,   // builder list item 179: a note on one part of the website draft
    `POST /(client/)?projects/${ID}/messages`,
    `POST /(client/)?support/${ID}/messages`,
    'POST /client/support',
    `POST /(client/)?surveys/${ID}/respond`,
  ]],
  ['edit', [
    'POST /redirects',
    'POST /visibility/check',
    'PUT /visibility/follow',   // builder item 181: the searches the site follows on Google
    'PUT /visibility/phrases',   // builder item 160: the two or three phrases the business wants to be found for
    'PUT /visibility/ai/questions',   // builder item 182: the questions its monthly AI check asks (the switch is configure)
    'POST /preview/(publish|share-link|section)',   // section: draws one unsaved section for the canvas, stores nothing
    'POST /publishes/checkpoints',
    'POST /page-locks',   // builder items 48 and 120: a page's password, as editing the page's settings is
    `POST /publishes/checkpoints/${ID}/restore`,
    `POST /publishes/${ID}/label`,
    'POST /restore-to-draft',
    'POST /launches',
    `POST /launches/${ID}/(recapture|cancel)`,
    'POST /media/upload-url',
    `PUT /media/${ID}`,
    'POST /stock/import',
    'POST /content-library',
    `PUT /content-library/${ID}`,
    'POST /assets/bulk',
    'POST /assets/folders/move',   // item 56: rename a folder, or take its files out — no file is deleted
    `PATCH /assets/${ID}`,
    `POST /assets/${ID}/(replace|rollback|duplicate|suggest|remove-background|cutout)`,
    'POST /visual/generate',
    `POST /visual/plans/${ID}/(vary|edit)`,
    `POST /notes/${ID}/(dismiss|accept)`,
    `POST /moments/${ID}/dismiss`,
    'POST /broadcasts',
    'POST /broadcasts/lists',   // sales review items 31 + 39: keep the people picked for an update
    'PUT /sales/views',         // sales review item 31: the team's saved list views
    'POST /broadcasts/draft-assist',
    `PATCH /broadcasts/${ID}`,
    `POST /broadcasts/${ID}/cancel`,
    `POST /broadcasts/${ID}/test`,   // bold redesign: "Send me a test" — only ever to the member's own address, so edit, not publish
    'POST /sales/(contacts|customers|deals|templates)',
    'POST /sales/(tasks|people/activity)',   // sales items 85 and 106: a to-do for anyone, a call logged for a person with no deal
    'POST /sales/email',   // sales item 80: one email to one person on file, like the Inbox's reply to an enquiry
    'POST /handover/notify',   // sales item 93: the studio tells a business its hand-over pack is ready (the route itself refuses anyone but the studio)
    'POST /sales/contacts/imports',   // sales review item 86: starting an import (each row is a POST /sales/contacts)
    'POST /sales/prospects(/discover)?',   // sales review item 112: find businesses, save the ticked ones
    `POST /sales/prospects/${ID}/(convert|draft|pack)`,   // item 112: start the deal; a draft only returns words — nothing sends; item 113: pack builds a share link
    `PATCH /sales/prospects/${ID}`,
    `PATCH /sales/(contacts|deals|deal-tasks)/${ID}`,
    `POST /sales/(contacts|deals)/${ID}/restore`,   // sales item 83: bringing back a deleted deal loses nothing, like a contact
    'PUT /sales/services',
    `POST /sales/deals/${ID}/(stage|activity|tasks|proposals|contracts|convert|resend-invite|invoice|schedule|retainer|send|estimates|recurring)`,
    `POST /sales/estimates/${ID}/(send|proposal|invoice)`,   // sales review item 47: send an estimate, or turn it into a proposal or an invoice (drafts)
    `PATCH /sales/recurring/${ID}`,
    `POST /sales/recurring/${ID}/(pause|resume|skip)`,
    `POST /sales/invoices/${ID}/(send|payment)`,   // item 77: recording a check, cash, transfer or Zelle payment is everyday bookkeeping
    `POST /sales/contracts/${ID}/(term|send)`,
    `POST /sales/proposals/${ID}/(send|revise)`,
    'POST /projects',
    'POST /projects/templates',   // sales item 106: saving a project as a template
    'POST /sales/todo-templates',   // sales item 106: saving a deal's to-dos as a list
    `POST /sales/deals/${ID}/tasks/from-template`,   // sales item 106: adding a saved list's to-dos to a deal
    `PATCH /projects/${ID}`,
    `POST /projects/${ID}/(status|tasks|checklist|milestones|approvals|surveys|deliverables|deliverables/upload-url)`,
    `PATCH /projects/${ID}/(tasks|milestones|deliverables)/${ID}`,
    `POST /client/projects/${ID}/tasks/${ID}/done`,
    `POST /client/projects/${ID}/(upload-url|uploads)`,
    'POST /support',
    `PATCH /support/${ID}`,
    'PUT /service/(saved-replies|faq)',
    `POST /forms/inbox/${ID}(/reply)?`,
    'POST /approve/send',
    'POST /bookings/types',
    `PATCH /bookings/types/${ID}`,
    `POST /bookings/appointments/${ID}/(confirm|cancel|complete|no_show)`,
    'POST /reviews/request',
    `POST /reviews/${ID}/(approve|hide|reply)`,
    'POST /writer/(generate|rewrite)',
    `POST /writer/drafts/${ID}/(accept|discard)`,
    'POST /editor/improve',
    'POST /(review/run|brand/review|coach/run|knowledge/import)',
    `POST /(review|brand)/reports/${ID}/dismiss`,
    `POST /coach/opportunities/${ID}/decide`,
  ]],
  ['open', [
    'POST /(client/)?notifications/read',
    'POST /threads/read',
    'POST /concierge/ask',
    // these check the role themselves: the owner, a developer, or a studio
    'POST /portal/(members|shares)',
    `POST /portal/members/${ID}/(revoke|role)`,   // builder item 53: changing a seat's role is managing people, like the invite
    'POST /portal/transfer(/cancel)?',   // builder item 53: only the owner, or their studio asking the owner; the route refuses anyone else and says why
    'PUT /dev/(customization|brand-kit)',
    'POST /dev/brand-kit/apply',
    'PUT /site/template',
    // sales review final pass (S1): only the site's owner answers a studio's request; the route refuses anyone else and says why
    `POST /portal/studio-requests/${ID}/(accept|decline)`,
    'POST /crm/notes',
    `POST /crm/notes/${ID}/pin`,
    `DELETE /crm/notes/${ID}`,
  ]],
];
const MEMBER_WRITE_RULES = MEMBER_WRITES.flatMap(([need, patterns]) => patterns.map((p) => [new RegExp(`^${p}$`), need] as const));

/** What a member's write off the content path needs, or null when it isn't listed.
 *  Pure. Content routes answer from contentWriteNeeds, not here. */
export function memberWriteNeeds(route: string, method: string): MemberWriteNeed | null {
  const asked = `${method} ${route}`;
  return MEMBER_WRITE_RULES.find(([rule]) => rule.test(asked))?.[1] ?? null;
}
