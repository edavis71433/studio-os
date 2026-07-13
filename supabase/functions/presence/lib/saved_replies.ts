// ── Saved replies (canned responses) — owner-managed snippets, no new table ──
// A short list of reusable reply snippets the studio can drop into a support or
// message reply, so common answers aren't retyped. Stored as JSON on the site
// (presence_settings.saved_replies) exactly like form definitions live inside
// presence_settings — NO new table, NO new pipeline. This module is the PURE
// safety gate: it caps the list, slugs unique ids, strips control characters, and
// (for any studio picker UI) renders an escape-safe list. No I/O, no clock.
//
// The snippet BODY is plain text inserted into a reply textarea; it is never
// interpreted as markup. renderSavedRepliesPicker escapes every title/body so a
// snippet can never inject markup into the studio surface that lists them.
import { esc, attr } from './markdown.ts';

export interface SavedReply { id: string; title: string; body: string; }

const MAX_REPLIES = 50;
const CAP = { id: 40, title: 80, body: 4000 };

// Control-char stripping by codepoint (matches lib/markdown.ts style — avoids
// literal control chars in source). `keepBreaks` retains tab (9) + newline (10)
// so multi-line snippet bodies survive; titles collapse to a single clean line.
function stripControl(x: unknown, keepBreaks: boolean): string {
  let out = '';
  for (const ch of String(x ?? '')) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10) { if (keepBreaks) out += ch; else out += ' '; continue; }
    if (c === 13) { if (keepBreaks) out += '\n'; else out += ' '; continue; }
    if (c >= 32 && c !== 127) out += ch;
  }
  return out;
}
const oneLine = (x: unknown, n: number): string => stripControl(x, false).replace(/\s+/g, ' ').trim().slice(0, n);
const multiLine = (x: unknown, n: number): string => stripControl(x, true).trim().slice(0, n);
const slug = (x: unknown, n: number): string =>
  String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, n);

/** Validate + normalize the saved-reply list. Caps the count, slugs unique ids,
 *  requires a title + body on each, strips control chars. Returns a clean list or
 *  a plain-language error. Pure. */
export function normalizeSavedReplies(raw: unknown):
  { ok: true; replies: SavedReply[] } | { ok: false; error: string } {
  const arr = Array.isArray(raw) ? raw
    : (raw && typeof raw === 'object' && Array.isArray((raw as any).replies) ? (raw as any).replies : null);
  if (!arr) return { ok: false, error: 'Saved replies must be a list.' };
  if (arr.length > MAX_REPLIES) return { ok: false, error: `You can save at most ${MAX_REPLIES} replies.` };
  const out: SavedReply[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i] || {};
    const title = oneLine(r.title, CAP.title);
    if (!title) return { ok: false, error: `Reply ${i + 1} needs a short title.` };
    const body = multiLine(r.body, CAP.body);
    if (!body) return { ok: false, error: `“${title}” needs some text.` };
    let id = slug(r.id, CAP.id) || slug(title, CAP.id) || `reply_${i + 1}`;
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    out.push({ id, title, body });
  }
  return { ok: true, replies: out };
}

/** Render an escape-safe picker for the studio reply UI: a labelled <select> whose
 *  options carry the snippet body in a data attribute (so client JS can insert it
 *  into the reply box). Every title/body is escaped — a snippet can never inject
 *  markup. Pure. Returns '' when there are no replies. */
export function renderSavedRepliesPicker(replies: SavedReply[], selectId = 'saved-reply'): string {
  if (!replies.length) return '';
  const opts = replies.map((r) => `<option value="${attr(r.id)}" data-body="${attr(r.body)}">${esc(r.title)}</option>`).join('');
  return `<label class="saved-reply-picker"><span>Saved replies</span>` +
    `<select id="${attr(selectId)}"><option value="">Insert a saved reply…</option>${opts}</select></label>`;
}
