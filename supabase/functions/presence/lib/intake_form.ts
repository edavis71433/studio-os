// ── The content form (builder list item 176, Nov 2026) ───────────────────────
// Wix Studio's "client intake form": before a site is built, the studio picks
// a short set of questions for the kind of business and sends the client a
// link. The client answers and adds photos with no sign-in (intake.html); the
// answers save as they type and the photos land in that site's Files, under
// "From the content form". The studio reads it all from the site's card.
//
// Stored as two reserved rows on the CLIENT's site (lib/reserved_store.ts), so
// there is no migration: the small form row (questions, the link's secret,
// where it stands), which the Sites page reads for every card, and the answers
// row, read only when the form or its answers are opened.
//
// The link carries the site and a secret: /intake?t=<site id as 32 hex><secret
// as 40 hex>. The public routes read the form row of that site and compare the
// secret; the studio can stop the link (and open it again) at any time.
//
// Pure: no DB, no network (crypto only for the secret).

export type IntakeKind = 'food' | 'beauty' | 'trades' | 'health' | 'shop' | 'pro' | 'other';
export type QuestionKind = 'words' | 'files';
export interface IntakeQuestion { id: string; label: string; hint: string; kind: QuestionKind; own?: boolean }
export interface IntakeFile { id: string; name: string; mime: string; at: string }
export interface IntakeAnswer { text?: string; files?: IntakeFile[]; at: string }
export type IntakeAnswers = Record<string, IntakeAnswer>;

export interface IntakeForm {
  v: 1;
  kind: IntakeKind;
  questions: IntakeQuestion[];
  secret: string;               // the link's secret (40 hex); the studio copies the link again from it
  status: 'open' | 'closed';
  business_name: string;        // "Tell us about …"
  studio_site_id: string | null; // whose name and logo the page shows, and where its email replies go
  created_at: string; created_by: string; updated_at: string;
  opened_at: string | null;     // the client first opened the link
  saved_at: string | null;      // the client's last save
  answered: number; total: number; files: number;
  sent_at: string | null;       // the client pressed Send (the latest time)
  seen_at: string | null;       // the studio opened the answers after that
  notified_at: string | null;   // the studio was last emailed that it arrived
  emailed_to: string | null; emailed_at: string | null;
}

export const INTAKE_KINDS: ReadonlyArray<{ key: IntakeKind; label: string }> = [
  { key: 'food', label: 'Restaurant or café' },
  { key: 'beauty', label: 'Salon or beauty' },
  { key: 'trades', label: 'Trades and home services' },
  { key: 'health', label: 'Health and wellness' },
  { key: 'shop', label: 'Shop' },
  { key: 'pro', label: 'Professional services' },
  { key: 'other', label: 'Something else' },
];

const q = (id: string, label: string, hint: string, kind: QuestionKind = 'words'): IntakeQuestion => ({ id, label, hint, kind });
/** Every kind starts with these; the kind's own questions go in after "What you offer". */
const BASE_HEAD = [
  q('about', 'About your business', 'What you do, and who it’s for'),
  q('offer', 'What you offer', 'One per line, with a price if you’d like it shown'),
];
const BASE_TAIL = [
  q('hours', 'Opening hours', 'When you’re open, and any holidays'),
  q('contact', 'How to reach you', 'Phone, email and address for the website'),
  q('story', 'Your story', 'How you started and what makes you different'),
  q('faqs', 'Common questions', 'What customers often ask, with your answers'),
  q('logo', 'Your logo', 'The file you have, any size', 'files'),
  q('people', 'You, your team and your place', 'Faces and the front door build trust', 'files'),
  q('work', 'Your work or products', 'Your best ten or so', 'files'),
  q('likes', 'Websites you like', 'Links to sites you like the look of'),
  q('else', 'Anything else?', 'Anything we should know'),
];
const BY_KIND: Record<IntakeKind, IntakeQuestion[]> = {
  food: [q('menu', 'Your menu', 'A photo or a PDF of it is fine', 'files'), q('diet', 'Dietary options', 'Vegetarian, gluten-free, allergies')],
  beauty: [q('prices', 'Your price list', 'Treatments and prices, one per line'), q('booking', 'How people book', 'Online, by phone, or walk-ins')],
  trades: [q('area', 'Where you work', 'Towns or areas you cover'), q('licence', 'Licences and insurance', 'What customers should know you hold')],
  health: [q('firstvisit', 'A first visit', 'What a new client should know, and what to bring'), q('insurance', 'Insurance and payment', 'Plans you accept, and how people pay')],
  shop: [q('sellers', 'Your best sellers', 'What do people come back for?'), q('delivery', 'Delivery and pick-up', 'Do you deliver, ship or offer pick-up?')],
  pro: [q('clients', 'Who you work with', 'The kind of clients you help most'), q('quals', 'Qualifications', 'Licences, memberships or awards to mention')],
  other: [],
};
/** Off unless ticked: the rest start ticked. */
export const OFF_BY_DEFAULT: ReadonlySet<string> = new Set(['likes']);

export const OWN_MAX = 5;
export const LABEL_MAX = 140;
export const TEXT_MAX = 4000;
export const FILES_PER_QUESTION = 20;
export const FILES_PER_FORM = 60;
export const QUESTIONS_MAX = 24;
/** The studio is emailed that the answers arrived at most this often (a client pressing Send twice). */
export const NOTIFY_GAP_MS = 15 * 60_000;

const isKind = (k: unknown): k is IntakeKind => INTAKE_KINDS.some((x) => x.key === k);
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const oneLine = (v: unknown, max: number) => clean(v, max).replace(/\s+/g, ' ');

/** The questions a kind of business starts with, in order, each with whether it starts ticked. */
export function questionBank(kind: unknown): Array<IntakeQuestion & { on: boolean }> {
  const k: IntakeKind = isKind(kind) ? kind : 'other';
  return [...BASE_HEAD, ...BY_KIND[k], ...BASE_TAIL].map((x) => ({ ...x, on: !OFF_BY_DEFAULT.has(x.id) }));
}

/** The studio's picks → the form's questions: the bank's ticked ones in the bank's
 *  order, then the studio's own (words or files). Null (with why) when nothing is left. */
export function buildQuestions(input: { kind?: unknown; picks?: unknown; own?: unknown }): { ok: true; kind: IntakeKind; questions: IntakeQuestion[] } | { ok: false; message: string } {
  const kind: IntakeKind = isKind(input.kind) ? input.kind : 'other';
  const bank = questionBank(kind);
  const picks = Array.isArray(input.picks) ? new Set(input.picks.map((p) => String(p))) : new Set(bank.filter((b) => b.on).map((b) => b.id));
  const out: IntakeQuestion[] = bank.filter((b) => picks.has(b.id)).map(({ on: _on, ...b }) => b);
  const own = Array.isArray(input.own) ? input.own : [];
  if (own.length > OWN_MAX) return { ok: false, message: `Add up to ${OWN_MAX} of your own questions.` };
  own.forEach((o, n) => {
    const label = oneLine((o as { label?: unknown })?.label, LABEL_MAX);
    if (label.length < 3) return;
    const kindOf = (o as { kind?: unknown })?.kind === 'files' ? 'files' : 'words';
    out.push({ id: `own${n + 1}`, label, hint: '', kind: kindOf, own: true });
  });
  if (!out.length) return { ok: false, message: 'Tick at least one question.' };
  if (out.length > QUESTIONS_MAX) return { ok: false, message: `That’s more than ${QUESTIONS_MAX} questions — untick a few.` };
  return { ok: true, kind, questions: out };
}

/** A stored form, read defensively (a damaged row reads as none). */
export function normalizeForm(raw: unknown): IntakeForm | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, any> | null;
  if (!r || !Array.isArray(r.questions) || !/^[0-9a-f]{40}$/.test(String(r.secret || ''))) return null;
  const questions: IntakeQuestion[] = r.questions
    .filter((x: any) => x && /^[a-z0-9]{2,16}$/.test(String(x.id || '')) && String(x.label || '').trim())
    .slice(0, QUESTIONS_MAX)
    .map((x: any) => ({ id: String(x.id), label: oneLine(x.label, LABEL_MAX), hint: oneLine(x.hint, LABEL_MAX), kind: x.kind === 'files' ? 'files' : 'words', ...(x.own ? { own: true } : {}) }));
  if (!questions.length) return null;
  const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  return {
    v: 1, kind: isKind(r.kind) ? r.kind : 'other', questions, secret: String(r.secret),
    status: r.status === 'closed' ? 'closed' : 'open',
    business_name: oneLine(r.business_name, 120), studio_site_id: /^[0-9a-f-]{36}$/.test(String(r.studio_site_id || '')) ? String(r.studio_site_id) : null,
    created_at: iso(r.created_at) || new Date(0).toISOString(), created_by: oneLine(r.created_by, 254), updated_at: iso(r.updated_at) || iso(r.created_at) || new Date(0).toISOString(),
    opened_at: iso(r.opened_at), saved_at: iso(r.saved_at),
    answered: num(r.answered), total: num(r.total) || questions.length, files: num(r.files),
    sent_at: iso(r.sent_at), seen_at: iso(r.seen_at), notified_at: iso(r.notified_at),
    emailed_to: r.emailed_to ? oneLine(r.emailed_to, 254) : null, emailed_at: iso(r.emailed_at),
  };
}

/** Stored answers, read defensively. */
export function normalizeAnswers(raw: unknown): IntakeAnswers {
  const r = (raw && typeof raw === 'object' ? (raw as { answers?: unknown }).answers : null) as Record<string, any> | null;
  const out: IntakeAnswers = {};
  if (!r || typeof r !== 'object') return out;
  for (const [id, a] of Object.entries(r)) {
    if (!/^[a-z0-9]{2,16}$/.test(id) || !a || typeof a !== 'object') continue;
    const text = typeof a.text === 'string' ? a.text.slice(0, TEXT_MAX) : undefined;
    const files = Array.isArray(a.files) ? a.files.filter((f: any) => f && /^[0-9a-f-]{36}$/.test(String(f.id || ''))).slice(0, FILES_PER_QUESTION)
      .map((f: any) => ({ id: String(f.id), name: oneLine(f.name, 120) || 'A file', mime: String(f.mime || ''), at: String(f.at || '') })) : undefined;
    out[id] = { ...(text !== undefined ? { text } : {}), ...(files && files.length ? { files } : {}), at: String(a.at || '') };
  }
  return out;
}

/** How many of the form's questions have an answer, and how many files there are. */
export function progressOf(questions: IntakeQuestion[], answers: IntakeAnswers): { answered: number; total: number; files: number } {
  let answered = 0, files = 0;
  for (const qq of questions) {
    const a = answers[qq.id];
    const n = a?.files?.length || 0;
    files += n;
    if ((a?.text && a.text.trim()) || n) answered++;
  }
  return { answered, total: questions.length, files };
}

/** The client's words: only for the form's own word questions, each trimmed to
 *  TEXT_MAX. Returns the cleaned changes, or why they can't be kept. */
export function cleanTextAnswers(questions: IntakeQuestion[], body: unknown): { ok: true; changes: Record<string, string> } | { ok: false; message: string } {
  const raw = (body && typeof body === 'object' ? body : null) as Record<string, unknown> | null;
  if (!raw) return { ok: true, changes: {} };
  const words = new Set(questions.filter((x) => x.kind === 'words').map((x) => x.id));
  const changes: Record<string, string> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!words.has(id)) return { ok: false, message: 'One of those answers isn’t on this form any more — reload the page.' };
    if (typeof v !== 'string') return { ok: false, message: 'An answer has to be words.' };
    changes[id] = clean(v, TEXT_MAX);
  }
  return { ok: true, changes };
}

/** Apply text changes to stored answers (an emptied answer stays, empty, so its files are kept). */
export function withText(answers: IntakeAnswers, changes: Record<string, string>, nowIso: string): IntakeAnswers {
  const out: IntakeAnswers = { ...answers };
  for (const [id, text] of Object.entries(changes)) out[id] = { ...(out[id] || {}), text, at: nowIso };
  return out;
}

// ── the link ──
const HEX = /^[0-9a-f]+$/;
export function newSecret(): string {
  const b = new Uint8Array(20); crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function linkToken(siteId: string, secret: string): string { return siteId.replace(/-/g, '').toLowerCase() + secret; }
/** The site and secret a link carries, or null for anything that isn't one. */
export function parseToken(t: unknown): { siteId: string; secret: string } | null {
  const s = String(t || '').toLowerCase();
  if (s.length !== 72 || !HEX.test(s)) return null;
  const h = s.slice(0, 32);
  return { siteId: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`, secret: s.slice(32) };
}
/** Compares in constant time for equal lengths (the secret's length is public). */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** What a Sites card says about the form (never the link or the answers). */
export function formSummary(f: IntakeForm | null) {
  if (!f) return null;
  return { status: f.status, answered: f.answered, total: f.total, files: f.files, opened_at: f.opened_at, saved_at: f.saved_at, sent_at: f.sent_at, seen_at: f.seen_at, emailed_at: f.emailed_at, created_at: f.created_at, unread: !!f.sent_at && (!f.seen_at || f.seen_at < f.sent_at) };
}

/** The file kinds a form takes: photos, and PDFs (a menu, a price list, a vector logo). */
export const INTAKE_MIME: Record<string, { ext: string; max: number }> = {
  'image/jpeg': { ext: 'jpg', max: 10 * 1024 * 1024 },
  'image/png': { ext: 'png', max: 10 * 1024 * 1024 },
  'image/webp': { ext: 'webp', max: 10 * 1024 * 1024 },
  'application/pdf': { ext: 'pdf', max: 25 * 1024 * 1024 },
};
/** A file's name as the client gave it, made safe to show and store. */
export function fileName(raw: unknown, mime: string): string {
  const base = oneLine(raw, 120).replace(/[\\/<>:"|?*]/g, '').trim();
  return base || (mime === 'application/pdf' ? 'A document' : 'A photo');
}
