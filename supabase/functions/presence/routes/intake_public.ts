// ── The content form, the client's side (builder list item 176, Nov 2026) ────
// PUBLIC, before sign-in, authorized only by the link's own secret
// (lib/intake_form.ts explains the link). intake.html is the page.
//
//   GET    /intake/:token                    the questions, the answers so far, the studio's name and logo
//   POST   /intake/:token                    { answers: { id: words }, send? } — saves as they type; send tells the studio
//   POST   /intake/:token/files?q=<id>&name= the bytes of one photo (JPEG, PNG, WebP) or PDF → the site's Files
//   DELETE /intake/:token/files/:mediaId     takes one back off the form
//
// Every door is rate-limited per address and site. A photo goes through the one
// path that holds the bytes (importImage): its signature must match its type,
// a phone photo's location is stripped, the site's storage limit applies, and
// it lands in that site's Files under "From the content form". A stopped link
// answers "closed" and shows nothing that was written on it.
import { json } from '../../_shared/http.ts';
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { parseToken, sameSecret, normalizeForm, normalizeAnswers, progressOf, cleanTextAnswers, withText, fileName, INTAKE_MIME, FILES_PER_QUESTION, FILES_PER_FORM, NOTIFY_GAP_MS, TEXT_MAX } from '../lib/intake_form.ts';
import type { IntakeForm, IntakeAnswers } from '../lib/intake_form.ts';
import { importImage, deleteMedia, signThumb, isImageMime } from '../lib/media.ts';
import { svc } from '../lib/db.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import { studioBrandOf } from './studio_brand.ts';
import { sendEmail } from '../commerce/account.ts';

const APP = () => (Deno.env.get('APP_URL') || 'https://app.davisdigitalstudio.com').replace(/\/$/, '');
const COLLECTION = 'From the content form';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const gone = (cors: Record<string, string>) => json({ error: 'not_found', message: 'This link isn’t live. Ask the studio that sent it for a new one.' }, 404, cors);
const closed = (cors: Record<string, string>) => json({ error: 'closed', message: 'This form is closed, so nothing more can be added. If you need to change something, reply to the studio’s email.' }, 409, cors);

/** The form a link opens, or null: the secret must match the site's form. */
async function open(token: string): Promise<{ siteId: string; form: IntakeForm } | null> {
  const t = parseToken(token);
  if (!t) return null;
  const form = normalizeForm(await readReservedJson(t.siteId, RESERVED_NAMES.intakeForm));
  return form && sameSecret(form.secret, t.secret) ? { siteId: t.siteId, form } : null;
}

/** The form row's progress after the answers changed (and when it was saved). */
function saveProgress(siteId: string, form: IntakeForm, answers: IntakeAnswers, nowIso: string, extra: (cur: IntakeForm) => Partial<IntakeForm> = () => ({})) {
  return updateReservedJson(siteId, RESERVED_NAMES.intakeForm, (cur) => {
    const f = normalizeForm(cur) || form;
    return { ...f, ...progressOf(f.questions, answers), saved_at: nowIso, opened_at: f.opened_at || nowIso, ...extra(f) };
  }, 'content form');
}

/** The answers with each file's small picture, for the page. */
async function answersForPage(siteId: string, form: IntakeForm, answers: IntakeAnswers) {
  const ids = [...new Set(Object.values(answers).flatMap((a) => (a.files || []).map((f) => f.id)))];
  const media = ids.length ? ((await svc(`presence_media?id=in.(${ids.join(',')})&site_id=eq.${siteId}&deleted_at=is.null&select=id,storage_path,mime`).catch(() => null))?.json || []) as Array<{ id: string; storage_path: string; mime: string }> : [];
  const byId = new Map(media.map((m) => [m.id, m]));
  const thumbs = new Map(await Promise.all(media.map(async (m) => [m.id, isImageMime(m.mime) ? await signThumb(m.storage_path, m.mime, 240).catch(() => null) : null] as const)));
  const out: Record<string, { text: string; files: Array<{ id: string; name: string; mime: string; thumb_url: string | null }> }> = {};
  for (const q of form.questions) {
    const a = answers[q.id];
    if (!a) continue;
    out[q.id] = { text: a.text || '', files: (a.files || []).filter((f) => byId.has(f.id)).map((f) => ({ id: f.id, name: f.name, mime: f.mime, thumb_url: thumbs.get(f.id) || null })) };
  }
  return out;
}

async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len && len > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { try { await reader.cancel(); } catch { /* already closed */ } return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

export async function handleIntakePublic(req: Request, token: string, rest: string, method: string, cors: Record<string, string>): Promise<Response> {
  const t = parseToken(token);
  if (!t) return gone(cors);
  const ip = clientIp(req);
  const now = new Date().toISOString();

  // ── the page opens ──
  if (!rest && method === 'GET') {
    if (!(await rateAllow(`intake_get:${t.siteId}:${ip}`, 120, 600))) return tooMany(cors, 600);
    const hit = await open(token);
    if (!hit) return gone(cors);
    const { siteId, form } = hit;
    const studio = form.studio_site_id ? await studioBrandOf(form.studio_site_id) : { name: 'Your studio', logo_url: null, accent: '#5b3fa0', is_default: true };
    const brand = { name: studio.name, logo_url: studio.logo_url, accent: studio.accent };
    if (form.status === 'closed') return json({ data: { status: 'closed', business_name: form.business_name, studio: brand } }, 200, { ...cors, 'Cache-Control': 'no-store' });
    const answers = normalizeAnswers(await readReservedJson(siteId, RESERVED_NAMES.intakeAnswers));
    if (!form.opened_at) await updateReservedJson(siteId, RESERVED_NAMES.intakeForm, (cur) => { const f = normalizeForm(cur) || form; return f.opened_at ? f : { ...f, opened_at: now }; }, 'content form');
    const p = progressOf(form.questions, answers);
    return json({ data: {
      status: 'open', business_name: form.business_name, studio: brand,
      questions: form.questions.map(({ id, label, hint, kind }) => ({ id, label, hint, kind })),
      answers: await answersForPage(siteId, form, answers),
      ...p, sent_at: form.sent_at, saved_at: form.saved_at,
      limits: { text: TEXT_MAX, files_per_question: FILES_PER_QUESTION, files_per_form: FILES_PER_FORM, kinds: Object.keys(INTAKE_MIME) },
    } }, 200, { ...cors, 'Cache-Control': 'no-store' });
  }

  // ── words: saved as they type; Send tells the studio ──
  if (!rest && method === 'POST') {
    if (!(await rateAllow(`intake_save:${t.siteId}:${ip}`, 240, 600))) return tooMany(cors, 600);
    const hit = await open(token);
    if (!hit) return gone(cors);
    const { siteId, form } = hit;
    if (form.status !== 'open') return closed(cors);
    let b: Record<string, unknown> = {};
    try { b = await req.json(); } catch { return json({ error: 'bad_request', message: 'That didn’t arrive in one piece — please try again.' }, 400, cors); }
    const cleaned = cleanTextAnswers(form.questions, b.answers);
    if (!cleaned.ok) return json({ error: 'bad_request', message: cleaned.message }, 400, cors);
    const send = b.send === true;
    const changed = Object.keys(cleaned.changes).length > 0;
    let answers = normalizeAnswers(await readReservedJson(siteId, RESERVED_NAMES.intakeAnswers));
    if (changed) {
      const stored = await updateReservedJson(siteId, RESERVED_NAMES.intakeAnswers, (cur) => ({ v: 1, answers: withText(normalizeAnswers(cur), cleaned.changes, now) }), 'content form');
      if (!stored) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
      answers = normalizeAnswers(stored);
    }
    let notify = false;
    const saved = await saveProgress(siteId, form, answers, now, (cur) => {
      notify = send && (!cur.notified_at || Date.parse(now) - Date.parse(cur.notified_at) > NOTIFY_GAP_MS);
      return send ? { sent_at: now, ...(notify ? { notified_at: now } : {}) } : {};
    });
    if (!saved) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
    const f = normalizeForm(saved) || form;
    if (notify && f.created_by) {
      const p = progressOf(f.questions, answers);
      const html = `<p>${esc(f.business_name)} pressed Send on their content form: ${p.answered} of ${p.total} questions answered${p.files ? `, and ${p.files} file${p.files === 1 ? '' : 's'}, now in their site’s Files` : ''}.</p>` +
        `<p style="margin:22px 0"><a href="${APP()}/sites.html#answers=${siteId}" style="display:inline-block;background:#5b3fa0;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Read their answers</a></p>`;
      await sendEmail(f.created_by, `${f.business_name} sent their words and photos`, html).catch(() => false);
    }
    return json({ data: { saved_at: f.saved_at, sent_at: f.sent_at, ...progressOf(f.questions, answers) } }, 200, cors);
  }

  // ── a photo or a PDF ──
  if (rest === '/files' && method === 'POST') {
    if (!(await rateAllow(`intake_files:${t.siteId}:${ip}`, 60, 600))) return tooMany(cors, 600);
    const hit = await open(token);
    if (!hit) return gone(cors);
    const { siteId, form } = hit;
    if (form.status !== 'open') return closed(cors);
    const url = new URL(req.url);
    const q = form.questions.find((x) => x.id === url.searchParams.get('q') && x.kind === 'files');
    if (!q) return json({ error: 'bad_request', message: 'That question doesn’t take files.' }, 400, cors);
    const mime = String(req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const kind = INTAKE_MIME[mime];
    if (!kind) return json({ error: 'unsupported_type', message: 'Send a photo (JPEG, PNG or WebP) or a PDF.' }, 415, cors);
    const before = normalizeAnswers(await readReservedJson(siteId, RESERVED_NAMES.intakeAnswers));
    if ((before[q.id]?.files?.length || 0) >= FILES_PER_QUESTION) return json({ error: 'too_many', message: `That’s ${FILES_PER_QUESTION} for this question — the studio has plenty to start with.` }, 409, cors);
    if (progressOf(form.questions, before).files >= FILES_PER_FORM) return json({ error: 'too_many', message: `That’s ${FILES_PER_FORM} files on this form — the studio has plenty to start with.` }, 409, cors);
    const bytes = await readCapped(req, kind.max);
    if (!bytes) return json({ error: 'too_large', message: mime === 'application/pdf' ? 'PDFs must be under 25MB.' : 'Photos must be under 10MB.' }, 413, cors);
    if (!bytes.byteLength) return json({ error: 'bad_request', message: 'That file was empty.' }, 400, cors);
    if (mime === 'application/pdf' && new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') return json({ error: 'invalid_file', message: 'That file isn’t a PDF — please try another.' }, 422, cors);
    const name = fileName(url.searchParams.get('name'), mime);
    const label = mime === 'application/pdf' ? name : `${q.label} — ${name}`.slice(0, 200);
    const res = await importImage(siteId, bytes, mime, label, { collection: COLLECTION, metadata: { source: 'content_form', question: q.id } });
    if ('error' in res) return json({ error: res.error, message: res.message }, res.error === 'quota_exceeded' ? 409 : 422, cors);
    const file = { id: String(res.media_id), name, mime, at: now };
    const stored = await updateReservedJson(siteId, RESERVED_NAMES.intakeAnswers, (cur) => {
      const a = normalizeAnswers(cur);
      return { v: 1, answers: { ...a, [q.id]: { ...(a[q.id] || {}), files: [...(a[q.id]?.files || []), file], at: now } } };
    }, 'content form');
    if (!stored) { await deleteMedia(siteId, file.id).catch(() => null); return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors); }
    const answers = normalizeAnswers(stored);
    await saveProgress(siteId, form, answers, now);
    const thumb = isImageMime(mime) ? await signThumb(String(res.storage_path), mime, 240).catch(() => null) : null;
    return json({ data: { file: { id: file.id, name, mime, thumb_url: thumb }, ...progressOf(form.questions, answers) } }, 200, cors);
  }

  // ── take one back ──
  const rm = rest.match(/^\/files\/([0-9a-f-]{36})$/);
  if (rm && method === 'DELETE') {
    if (!(await rateAllow(`intake_files:${t.siteId}:${ip}`, 60, 600))) return tooMany(cors, 600);
    const hit = await open(token);
    if (!hit) return gone(cors);
    const { siteId, form } = hit;
    if (form.status !== 'open') return closed(cors);
    const id = rm[1];
    let found = false;
    const stored = await updateReservedJson(siteId, RESERVED_NAMES.intakeAnswers, (cur) => {
      const a = normalizeAnswers(cur);
      found = false;
      for (const [qid, ans] of Object.entries(a)) {
        if ((ans.files || []).some((f) => f.id === id)) { found = true; a[qid] = { ...ans, files: (ans.files || []).filter((f) => f.id !== id), at: now }; }
      }
      return { v: 1, answers: a };
    }, 'content form');
    if (!stored) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
    if (!found) return json({ error: 'not_found', message: 'That file isn’t on this form.' }, 404, cors);
    // out of Files too, unless the studio has already put it on the site (then it stays there)
    await deleteMedia(siteId, id).catch(() => null);
    const answers = normalizeAnswers(stored);
    await saveProgress(siteId, form, answers, now);
    return json({ data: progressOf(form.questions, answers) }, 200, cors);
  }

  return json({ error: 'not_found', message: 'Not found.' }, 404, cors);
}
