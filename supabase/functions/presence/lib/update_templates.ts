// ── Updates kept as templates (builder list item 221) ───────────────────────
// The rules for an update a studio keeps to start an update for any client
// (agency/update_templates.ts holds the routes, migration 0221 the table). What is kept
// is the subject and the words as written, fill-ins and all, so {{first_name}},
// {{business_name}} and {{booking_link}} fill in for whichever client uses it. A photo
// line is left out: the photo is one of the client's own files, and on another client's
// site it would draw nothing. Pure.
import { cleanBody, cleanSubject } from './broadcast.ts';
import { IMAGE_LINE_RE } from './update_media.ts';

export const MAX_UPDATE_TEMPLATES = 50;
export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_SUBJECT_MAX = 200;
export const TEMPLATE_BODY_MAX = 20000;
export const TEMPLATE_PREVIEW = 140;

/** A template's name: one line, tidied, at most 80 characters; '' when there is none. */
export function cleanTemplateName(raw: unknown): string {
  return String(raw ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TEMPLATE_NAME_MAX).trim();
}

/** What a template keeps of an update: its subject, its words with the photo lines left
 *  out (and the blank lines they leave tidied), and how many photos stayed behind. */
export function templateFromUpdate(u: { subject?: unknown; body?: unknown }): { subject: string; body: string; photos_left: number } {
  const subject = cleanSubject(u.subject).slice(0, TEMPLATE_SUBJECT_MAX);
  let photos = 0;
  const kept = cleanBody(u.body).replace(/\r/g, '').split('\n').filter((line) => {
    if (IMAGE_LINE_RE.test(line.trim())) { photos++; return false; }
    return true;
  });
  const body = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, TEMPLATE_BODY_MAX);
  return { subject, body, photos_left: photos };
}

/** The first words of a template, for the list: one line, cut at a word. */
export function templatePreview(body: unknown): string {
  const one = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (one.length <= TEMPLATE_PREVIEW) return one;
  const cut = one.slice(0, TEMPLATE_PREVIEW);
  const sp = cut.lastIndexOf(' ');
  return (sp > TEMPLATE_PREVIEW / 2 ? cut.slice(0, sp) : cut).replace(/[\s,.;:]+$/, '') + '…';
}

export interface TemplateRow { id: string; name: string; subject: string; body?: string; created_from_site?: string | null; from_name?: string | null; created_by?: string | null; created_at?: string | null }
/** One template as the list shows it: never the whole body, which comes with Use. */
export function templateListItem(r: TemplateRow): { id: string; name: string; subject: string; preview: string; from_site: string | null; from_name: string; created_by: string; created_at: string | null } {
  return { id: r.id, name: r.name, subject: r.subject, preview: templatePreview(r.body), from_site: r.created_from_site || null, from_name: String(r.from_name || ''), created_by: String(r.created_by || ''), created_at: r.created_at || null };
}
