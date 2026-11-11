// ── The hand-over kit (builder list item 176, Nov 2026) ──────────────────────
// Wix Studio's "client kit": what a client needs once their site is theirs —
// who to call, how to do the everyday things, short videos and a few files —
// written once by the studio and shown at the top of Help in the client's
// portal (client.html), beside the facts of their website, which fill in by
// themselves (the address, when it went live, when the domain renews).
//
// One reserved row on the CLIENT's site (`__handover_kit__`), so there is no
// migration. Nothing shows in the portal until the studio turns it on.
// Pure: no DB, no network.

export interface KitContact { name: string; email: string; phone: string; hours: string }
export interface KitGuide { title: string; body: string }
export interface KitVideo { title: string; url: string }
export interface HandoverKit {
  v: 1;
  contact: KitContact;
  guides: KitGuide[];
  videos: KitVideo[];
  files: string[];              // media ids on the client's own site
  shown: boolean;               // in their portal
  shown_at: string | null;
  emailed_at: string | null;    // they were told it's ready
  updated_at: string | null;
  updated_by: string | null;
}

export const GUIDES_MAX = 8;
export const VIDEOS_MAX = 8;
export const FILES_MAX = 10;
const TITLE_MAX = 80, BODY_MAX = 600, URL_MAX = 500;

const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const oneLine = (v: unknown, max: number) => clean(v, max).replace(/\s+/g, ' ');
const PLAIN_EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/** The three how-tos every kit starts with; the studio rewrites them as it likes. */
export const DEFAULT_GUIDES: ReadonlyArray<KitGuide> = [
  { title: 'Change a photo or some words', body: 'Send us the new photo or words in Requests, and we’ll change it for you.' },
  { title: 'Ask for something new', body: 'Open Requests and press Something else? Nothing is charged until we reply.' },
  { title: 'If something looks wrong', body: 'Message us with a screenshot of what you see. If the site is down, call us.' },
];

/** A video link: https only, one address, no spaces. Null when it isn't one. */
export function videoUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > URL_MAX || /\s/.test(s)) return null;
  try { const u = new URL(s); return u.protocol === 'https:' && u.hostname.includes('.') ? u.toString() : null; } catch { return null; }
}

/** A new kit: the studio's own details to call, the starting how-tos, off. */
export function defaultKit(studio: { name?: string | null; email?: string | null; phone?: string | null }): HandoverKit {
  const email = oneLine(studio.email, 254);
  return {
    v: 1,
    contact: { name: oneLine(studio.name, 80), email: PLAIN_EMAIL.test(email) ? email : '', phone: oneLine(studio.phone, 40), hours: '' },
    guides: DEFAULT_GUIDES.map((g) => ({ ...g })), videos: [], files: [],
    shown: false, shown_at: null, emailed_at: null, updated_at: null, updated_by: null,
  };
}

/** A stored kit, read defensively (a damaged row reads as none). */
export function normalizeKit(raw: unknown): HandoverKit | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, any> | null;
  if (!r || r.v !== 1) return null;
  const c = (r.contact && typeof r.contact === 'object' ? r.contact : {}) as Record<string, unknown>;
  const email = oneLine(c.email, 254);
  return {
    v: 1,
    contact: { name: oneLine(c.name, 80), email: PLAIN_EMAIL.test(email) ? email : '', phone: oneLine(c.phone, 40), hours: oneLine(c.hours, 120) },
    guides: (Array.isArray(r.guides) ? r.guides : []).map((g: any) => ({ title: oneLine(g?.title, TITLE_MAX), body: clean(g?.body, BODY_MAX) })).filter((g: KitGuide) => g.title).slice(0, GUIDES_MAX),
    videos: (Array.isArray(r.videos) ? r.videos : []).map((v: any) => ({ title: oneLine(v?.title, TITLE_MAX), url: videoUrl(v?.url) || '' })).filter((v: KitVideo) => v.title && v.url).slice(0, VIDEOS_MAX),
    files: [...new Set((Array.isArray(r.files) ? r.files : []).map((x: unknown) => String(x)).filter((x: string) => /^[0-9a-f-]{36}$/.test(x)))].slice(0, FILES_MAX) as string[],
    shown: r.shown === true, shown_at: iso(r.shown_at), emailed_at: iso(r.emailed_at), updated_at: iso(r.updated_at), updated_by: r.updated_by ? oneLine(r.updated_by, 254) : null,
  };
}

/** The studio's save → the kit to store, or why it can't be. `prev` keeps the dates. */
export function kitFromSave(body: unknown, prev: HandoverKit | null, by: string, nowIso: string): { ok: true; kit: HandoverKit } | { ok: false; message: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const c = (b.contact && typeof b.contact === 'object' ? b.contact : {}) as Record<string, unknown>;
  const email = oneLine(c.email, 254);
  if (email && !PLAIN_EMAIL.test(email)) return { ok: false, message: 'That email address doesn’t look right.' };
  const guidesIn = Array.isArray(b.guides) ? b.guides : [];
  if (guidesIn.length > GUIDES_MAX) return { ok: false, message: `Keep it to ${GUIDES_MAX} how-tos.` };
  const guides = guidesIn.map((g: any) => ({ title: oneLine(g?.title, TITLE_MAX), body: clean(g?.body, BODY_MAX) }));
  if (guides.some((g: KitGuide) => !g.title)) return { ok: false, message: 'Every how-to needs a title.' };
  const videosIn = Array.isArray(b.videos) ? b.videos : [];
  if (videosIn.length > VIDEOS_MAX) return { ok: false, message: `Keep it to ${VIDEOS_MAX} videos.` };
  const videos: KitVideo[] = [];
  for (const v of videosIn) {
    const title = oneLine(v?.title, TITLE_MAX), url = videoUrl(v?.url);
    if (!title) return { ok: false, message: 'Every video needs a title.' };
    if (!url) return { ok: false, message: `“${title}” needs a link that starts with https://` };
    videos.push({ title, url });
  }
  const filesIn = Array.isArray(b.files) ? b.files.map((x: unknown) => String(x)) : [];
  const files = [...new Set(filesIn.filter((x: string) => /^[0-9a-f-]{36}$/.test(x)))] as string[];
  if (files.length > FILES_MAX) return { ok: false, message: `Pick up to ${FILES_MAX} files.` };
  const shown = b.shown === true;
  const contact = { name: oneLine(c.name, 80), email, phone: oneLine(c.phone, 40), hours: oneLine(c.hours, 120) };
  if (shown && !contact.name && !contact.email && !contact.phone) return { ok: false, message: 'Say who to call before it goes in their portal.' };
  return {
    ok: true,
    kit: {
      v: 1, contact, guides, videos, files, shown,
      shown_at: shown ? (prev?.shown && prev.shown_at ? prev.shown_at : nowIso) : null,
      emailed_at: prev?.emailed_at || null, updated_at: nowIso, updated_by: by || null,
    },
  };
}

/** What a Sites card says about the kit. */
export function kitSummary(k: HandoverKit | null) {
  if (!k) return null;
  return { shown: k.shown, shown_at: k.shown_at, emailed_at: k.emailed_at, updated_at: k.updated_at };
}
