// ── What the one-tap approval page shows (sales item 92) ────────────────────
// approve.html showed a title and one line, with "Davis Digital Studio" hard-coded
// whoever sent it, and "Not yet" took no comment. The two kinds of change it
// approves already carry plain words for what they do: a connected change (a
// Google post, new hours…) has what_changes / what_stays / reversible / rollback,
// and a website-and-domain plan has steps ({ what, why }) / reversible /
// rollback_note. These pure helpers turn a row into what the page lists, and
// clean the note a client leaves on "Not yet". Drawn in Figma first: page
// "One-tap approval page — sales item 92".

export interface ApprovalDetail {
  tag: string;                                         // what kind of change, in two words
  changes: string[];                                   // what changes
  stays: string[];                                     // what stays the same
  undo: { reversible: boolean; how: string } | null;   // can it be undone, and how
  post: string | null;                                 // a Google post: the exact words being approved
}

const LINES_MAX = 12, LINE_MAX = 300;
/** Plain lines from a list of strings or of { what } steps. Pure. */
export function planLines(v: unknown): string[] {
  return (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as { what?: unknown }).what === 'string' ? String((x as { what: string }).what) : ''))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, LINES_MAX)
    .map((s) => s.slice(0, LINE_MAX));
}

const WRITE_TAGS: Record<string, string> = {
  gbp_post: 'Google listing', gbp_hours: 'Google listing', gsc_verify: 'Google Search',
  calendar_hold: 'Calendar', email_draft: 'Email', social_draft: 'Social post',
};
const PLAN_TAGS: Record<string, string> = {
  connect_domain: 'Web address', dns_repair: 'Web address', registrar_care: 'Web address',
  domain_transfer_in: 'Web address', domain_transfer_out: 'Web address',
  email_auth: 'Email settings', email_setup: 'Email settings',
  hosting_restore: 'Website', migration: 'Website move',
};

function undoOf(reversible: unknown, how: unknown): ApprovalDetail['undo'] {
  const h = String(how ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (typeof reversible !== 'boolean' && !h) return null;
  return { reversible: reversible !== false, how: h };
}

/** What the page lists for one pending change. `kind` is the approval token's. Pure. */
export function approvalDetail(kind: 'connected' | 'infrastructure', row: Record<string, unknown> | null | undefined): ApprovalDetail {
  const r = row || {};
  if (kind === 'connected') {
    const payload = (r.payload && typeof r.payload === 'object') ? r.payload as Record<string, unknown> : {};
    const post = r.workflow === 'gbp_post' && typeof payload.summary === 'string' ? payload.summary.trim().slice(0, 1500) : '';
    return { tag: WRITE_TAGS[String(r.workflow || '')] || 'Change', changes: planLines(r.what_changes), stays: planLines(r.what_stays), undo: undoOf(r.reversible, r.rollback), post: post || null };
  }
  return { tag: PLAN_TAGS[String(r.kind || '')] || 'Change', changes: planLines(r.steps), stays: [], undo: undoOf(r.reversible, r.rollback_note), post: null };
}

/** The note a client leaves on "Not yet": plain text, line breaks kept, control
 *  characters dropped, at most NOT_YET_NOTE_MAX characters. Pure. */
export const NOT_YET_NOTE_MAX = 1000;
export function cleanNote(v: unknown): string {
  return String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, NOT_YET_NOTE_MAX);
}
