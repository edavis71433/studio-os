// ── Netlify Deploy API client (the approved deployment architecture) ────────
// Content-addressed: create a deploy with SHA1 digests; Netlify answers with
// the digests it's missing; upload only those; poll until ready. Atomic: the
// live site flips only when the deploy completes. Idempotent: same file map =
// same digests = nothing to upload.
//
// The token lives ONLY as this function's secret. It never reaches builds,
// clients, or any other function.
import { fewAtATime } from './few_at_a_time.ts';

const NETLIFY_TOKEN = Deno.env.get('NETLIFY_AUTH_TOKEN') || '';
const API = 'https://api.netlify.com/api/v1';

export function netlifyConfigured(): boolean { return !!NETLIFY_TOKEN; }

async function nf(path: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { ok: r.ok, status: r.status, json, text };
}

async function sha1Hex(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', data as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const enc = new TextEncoder();
const toBytes = (v: string | Uint8Array): Uint8Array => (typeof v === 'string' ? enc.encode(v) : v);

// ── Item 208 (review file 06, finding 84): only what changed is made and sent ────────
// A photo the live site already has is named by the digest it went up with, and its
// bytes are made only if the host asks for them. The host asks for what it lacks, and
// those go up a few at a time instead of one by one.
/** A file named by its digest; `load` makes its bytes if the host asks for them. */
export interface KnownFile { sha: string; load: () => Promise<Uint8Array | null> }
export type DeployFile = string | Uint8Array | KnownFile;
const isKnown = (v: DeployFile): v is KnownFile => typeof v === 'object' && !(v instanceof Uint8Array);
/** How many files go up to the host at once. */
export const UPLOADS_AT_ONCE = 4;

/** Every file's SHA-1, by its /-prefixed path: what a deploy is asked for with. */
export async function digestFiles(fileMap: Record<string, DeployFile>): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  for (const [p, v] of Object.entries(fileMap)) digests[p.startsWith('/') ? p : `/${p}`] = isKnown(v) ? v.sha : await sha1Hex(toBytes(v));
  return digests;
}

/** Two deploys' files are the same paths with the same digests. Pure. */
export function sameFiles(a: Record<string, string> | null | undefined, b: Record<string, string> | null | undefined): boolean {
  if (!a || !b) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k]);
}

export interface DeployResult {
  ok: boolean;
  deployId?: string;
  state?: string;
  uploaded?: number;
  totalFiles?: number;
  files?: Record<string, string>; // item 208: every file's digest, by path, as sent
  error?: string; // operator-facing only
}

/** Create a content-addressed deploy of fileMap onto netlifySiteId and poll briefly. */
export async function deployFileMap(netlifySiteId: string, fileMap: Record<string, DeployFile>, opts: { title?: string; pollMs?: number; digests?: Record<string, string> } = {}): Promise<DeployResult> {
  if (!NETLIFY_TOKEN) return { ok: false, error: 'NETLIFY_AUTH_TOKEN not configured' };

  // 1. digest every file (path must be /-prefixed for the API); a caller that has them passes them
  const digests = opts.digests ?? await digestFiles(fileMap);
  const files: Record<string, DeployFile> = {};
  for (const [p, v] of Object.entries(fileMap)) files[p.startsWith('/') ? p : `/${p}`] = v;

  // 2. create deploy — Netlify replies with `required` = digests it lacks
  const create = await nf(`/sites/${netlifySiteId}/deploys`, {
    method: 'POST',
    body: JSON.stringify({ files: digests, title: opts.title || 'presence publish' }),
  });
  if (!create.ok || !create.json?.id) return { ok: false, error: `deploy create failed: ${create.status} ${create.text.slice(0, 200)}` };
  const deployId = String(create.json.id);
  const required: string[] = Array.isArray(create.json.required) ? create.json.required : [];

  // 3. upload only missing files (by digest match): identical files share a digest, and
  // one upload satisfies all of them. A few at a time; the first failure stops the rest.
  const pathOf = new Map<string, string>();
  for (const [path, digest] of Object.entries(digests)) if (!pathOf.has(digest)) pathOf.set(digest, path);
  const todo = [...new Set(required)].filter((d) => pathOf.has(d)).map((d) => pathOf.get(d)!);
  let uploaded = 0, failure: string | null = null;
  await fewAtATime(todo, UPLOADS_AT_ONCE, async (path) => {
    if (failure) return;
    const v = files[path];
    const body = isKnown(v) ? await v.load().catch(() => null) : toBytes(v);
    if (!body) { failure ??= `upload failed for ${path}: its file couldn't be made`; return; }
    // one transient-failure retry per file (M6 §7); a second failure aborts the
    // deploy — Netlify only flips the live site on completion, so nothing is
    // ever partially updated
    let up: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      up = await fetch(`${API}/deploys/${deployId}/files${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/octet-stream' },
        body: body as unknown as BodyInit,
      }).catch(() => null);
      if (up?.ok) break;
      await up?.text().catch(() => '');
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
    if (!up || !up.ok) { failure ??= `upload failed for ${path}: ${up?.status ?? 'network'} (after retry)`; return; }
    uploaded++;
  });
  if (failure) return { ok: false, deployId, error: failure };

  // 4. bounded poll (M5: deterministic timeout, configurable via DEPLOY_POLL_MS).
  // On timeout the record stays `deploying` and the reconcile process finalizes
  // it — never an ambiguous status. Not an error: still deploying.
  const deadline = Date.now() + (opts.pollMs ?? (Number(Deno.env.get('DEPLOY_POLL_MS')) || 30_000));
  let state = 'uploading';
  while (Date.now() < deadline) {
    const d = await nf(`/deploys/${deployId}`);
    state = String(d.json?.state || 'unknown');
    if (state === 'ready') return { ok: true, deployId, state, uploaded, totalFiles: Object.keys(digests).length, files: digests };
    if (state === 'error') return { ok: false, deployId, state, error: `deploy state=error: ${String(d.json?.error_message || '').slice(0, 200)}` };
    await new Promise((r) => setTimeout(r, 1500));
  }
  // not an error: still deploying — status-driven record reconciles later
  return { ok: true, deployId, state, uploaded, totalFiles: Object.keys(digests).length, files: digests };
}

export async function deployState(deployId: string): Promise<string | null> {
  if (!NETLIFY_TOKEN) return null;
  const d = await nf(`/deploys/${deployId}`);
  return d.ok ? String(d.json?.state || 'unknown') : null;
}

// ── M6: site provisioning + domain operations (admin-only callers) ──────────
// Same client, same token boundary. Raw Netlify responses NEVER leave the
// presence function — routes translate to plain language.

export interface NetlifySiteInfo {
  id: string;
  name: string;
  default_domain: string;       // <name>.netlify.app
  custom_domain: string | null;
  state: string;
  ssl_url: string | null;
  domain_aliases?: string[];    // item 163: extra names on the site (an old domain kept forwarding)
  published_deploy_id?: string | null;   // item 208: the deploy visitors see now
}

function toSiteInfo(j: any): NetlifySiteInfo {
  return {
    id: String(j.id), name: String(j.name || ''),
    default_domain: String(j.default_domain || `${j.name}.netlify.app`),
    custom_domain: j.custom_domain ? String(j.custom_domain) : null,
    state: String(j.state || 'unknown'), ssl_url: j.ssl_url ? String(j.ssl_url) : null,
    domain_aliases: Array.isArray(j.domain_aliases) ? j.domain_aliases.map((a: unknown) => String(a)) : [],
    published_deploy_id: j.published_deploy?.id ? String(j.published_deploy.id) : null,
  };
}

/** Create a Netlify site with an exact name. 422 = name already taken. */
export async function createSite(name: string): Promise<{ ok: boolean; status: number; site?: NetlifySiteInfo; error?: string }> {
  if (!NETLIFY_TOKEN) return { ok: false, status: 0, error: 'NETLIFY_AUTH_TOKEN not configured' };
  const r = await nf('/sites', { method: 'POST', body: JSON.stringify({ name }) });
  if (!r.ok) return { ok: false, status: r.status, error: `site create failed: ${r.status} ${r.text.slice(0, 200)}` };
  return { ok: true, status: r.status, site: toSiteInfo(r.json) };
}

/** Look up a site by Netlify site id OR by domain (e.g. "name.netlify.app"). */
export async function getSite(idOrDomain: string): Promise<{ ok: boolean; status: number; site?: NetlifySiteInfo }> {
  if (!NETLIFY_TOKEN) return { ok: false, status: 0 };
  const r = await nf(`/sites/${encodeURIComponent(idOrDomain)}`);
  return r.ok ? { ok: true, status: r.status, site: toSiteInfo(r.json) } : { ok: false, status: r.status };
}

/** Permanently delete a Netlify site (lifecycle 'deleting'; DB data is retained). */
export async function deleteSite(netlifySiteId: string): Promise<{ ok: boolean; error?: string }> {
  if (!NETLIFY_TOKEN) return { ok: false, error: 'NETLIFY_AUTH_TOKEN not configured' };
  const r = await nf(`/sites/${encodeURIComponent(netlifySiteId)}`, { method: 'DELETE' });
  // 404 counts as done: the site is already gone
  return r.ok || r.status === 404 ? { ok: true } : { ok: false, error: `site delete failed: ${r.status} ${r.text.slice(0, 200)}` };
}

/** Deploy history (operator view — deploy ids are allowed for staff). */
export async function listDeploys(netlifySiteId: string, limit = 20): Promise<{ ok: boolean; deploys: Array<{ id: string; state: string; created_at: string; published_at: string | null; title: string }> }> {
  if (!NETLIFY_TOKEN) return { ok: false, deploys: [] };
  const r = await nf(`/sites/${encodeURIComponent(netlifySiteId)}/deploys?per_page=${limit}`);
  if (!r.ok || !Array.isArray(r.json)) return { ok: false, deploys: [] };
  return {
    ok: true,
    deploys: r.json.map((d: any) => ({
      id: String(d.id), state: String(d.state || 'unknown'),
      created_at: String(d.created_at || ''), published_at: d.published_at ? String(d.published_at) : null,
      title: String(d.title || ''),
    })),
  };
}

/** Attach (or with null: detach) a custom domain. */
export async function setCustomDomain(netlifySiteId: string, domain: string | null): Promise<{ ok: boolean; site?: NetlifySiteInfo; error?: string }> {
  if (!NETLIFY_TOKEN) return { ok: false, error: 'NETLIFY_AUTH_TOKEN not configured' };
  const r = await nf(`/sites/${encodeURIComponent(netlifySiteId)}`, { method: 'PATCH', body: JSON.stringify({ custom_domain: domain }) });
  if (!r.ok) return { ok: false, error: `domain update failed: ${r.status} ${r.text.slice(0, 200)}` };
  return { ok: true, site: toSiteInfo(r.json) };
}

/** List item 175: put a visitor password on the whole live site, or take it off (empty).
 *  Netlify keeps the password and shows its own password page before any page of the
 *  site; it is never stored on our side. */
export async function setSitePassword(netlifySiteId: string, password: string): Promise<{ ok: boolean; error?: string }> {
  if (!NETLIFY_TOKEN) return { ok: false, error: 'NETLIFY_AUTH_TOKEN not configured' };
  const r = await nf(`/sites/${encodeURIComponent(netlifySiteId)}`, { method: 'PATCH', body: JSON.stringify({ password }) });
  if (!r.ok) return { ok: false, error: `password update failed: ${r.status} ${r.text.slice(0, 200)}` };
  return { ok: true };
}

/** Item 163: set the extra names the site answers on (an old domain kept forwarding). An
 *  empty list clears them. They share the site's certificate. */
export async function setDomainAliases(netlifySiteId: string, aliases: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!NETLIFY_TOKEN) return { ok: false, error: 'NETLIFY_AUTH_TOKEN not configured' };
  const r = await nf(`/sites/${encodeURIComponent(netlifySiteId)}`, { method: 'PATCH', body: JSON.stringify({ domain_aliases: aliases }) });
  return r.ok ? { ok: true } : { ok: false, error: `alias update failed: ${r.status} ${r.text.slice(0, 200)}` };
}

/** Certificate state. 200 with empty body = no cert yet (valid pre-DNS state). */
export async function sslStatus(netlifySiteId: string): Promise<{ ok: boolean; state: string; expires_at: string | null; domains?: string[] }> {
  if (!NETLIFY_TOKEN) return { ok: false, state: 'unknown', expires_at: null };
  const r = await nf(`/sites/${encodeURIComponent(netlifySiteId)}/ssl`);
  if (!r.ok) return { ok: false, state: 'unknown', expires_at: null };
  if (!r.json) return { ok: true, state: 'none', expires_at: null, domains: [] };
  // `domains`: the names the certificate covers (item 134: "the padlock covers both names")
  const domains = Array.isArray(r.json.domains) ? r.json.domains.map((d: unknown) => String(d).toLowerCase()) : [];
  return { ok: true, state: String(r.json.state || 'unknown'), expires_at: r.json.expires_at ? String(r.json.expires_at) : null, domains };
}

/** Ask Netlify to (re)provision the certificate — safe to call repeatedly. */
export async function provisionSsl(netlifySiteId: string): Promise<{ ok: boolean }> {
  if (!NETLIFY_TOKEN) return { ok: false };
  const r = await nf(`/sites/${encodeURIComponent(netlifySiteId)}/ssl`, { method: 'POST' });
  return { ok: r.ok };
}

/** Instant restore: re-publish a previous deploy (operational recovery). */
export async function restoreDeploy(netlifySiteId: string, deployId: string): Promise<{ ok: boolean; error?: string }> {
  if (!NETLIFY_TOKEN) return { ok: false, error: 'NETLIFY_AUTH_TOKEN not configured' };
  const r = await nf(`/sites/${netlifySiteId}/deploys/${deployId}/restore`, { method: 'POST' });
  return r.ok ? { ok: true } : { ok: false, error: `restore failed: ${r.status} ${r.text.slice(0, 200)}` };
}

// ── Builder list item 269 (full review of Nov 22, 2026): what the host's plan really says ──
// The Usage page drew "N of about 330 publishes" from two typed-in numbers, counting client
// publishes only, while the app's own updates (nearly the whole bill) went uncounted. Now the
// team's account is read from Netlify (GET /accounts). What it answers for sure: the plan's
// name, the credits a period includes, when the period started and when the next begins,
// and whether usage is exceeded (production publishes paused). What it does NOT answer
// honestly: credits used, which its API reports as 0 on credit plans (netlify/open-api issue
// 640, still open Nov 2026), so that figure is shown only when it is above zero, and
// otherwise the page says "not known" rather than a number that isn't one.
export interface HostPlan {
  ok: boolean;                 // the account could be read
  team: string | null;         // the team's name, for the studio's own eyes
  plan: string | null;         // "Pro", "Personal"…
  credits_included: number | null;
  credits_used: number | null; // null when the host's answer can't be trusted (it reports 0)
  period_start: string | null;
  next_period_start: string | null;
  exceeded: boolean;           // production publishes paused until the next period
  read_at: string;
  why: string | null;          // when !ok: 'no_token' | 'refused' | 'unreadable'
}
/** Pure: one account's answer, read the honest way (see above). `paidThisPeriod` is how
 *  many deploys Studio OS itself knows went up since the period started: when that is
 *  above zero and the host says 0 used, the host's figure is not believed. */
export function hostPlanFrom(account: unknown, nowIso: string, paidThisPeriod = 0): HostPlan {
  const a = (account && typeof account === 'object' ? account : {}) as Record<string, unknown>;
  const caps = (a.capabilities && typeof a.capabilities === 'object' ? a.capabilities : {}) as Record<string, unknown>;
  const credits = (caps.credits && typeof caps.credits === 'object' ? caps.credits : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null);
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const included = num(a.plan_credits) ?? num(credits.included);
  const usedRaw = num(credits.used);
  const used = usedRaw !== null && (usedRaw > 0 || paidThisPeriod === 0) ? usedRaw : null;
  const exceeded = a.usages_exceeded === true || a.in_operational_mode === true;
  return {
    ok: true, team: str(a.name), plan: str(a.type_name), credits_included: included,
    credits_used: exceeded && used === null && included !== null ? included : used,
    period_start: str(a.current_billing_period_start), next_period_start: str(a.next_billing_period_start),
    exceeded, read_at: nowIso, why: null,
  };
}
let hostCache: { at: number; account: unknown; read_at: string } | null = null;
const HOST_CACHE_MS = 6 * 60 * 60_000;
/** The team's plan, read from the host (its raw answer is kept six hours in this process;
 *  the reading of it is made fresh for each caller's `paidThisPeriod`, as for hostPlanFrom).
 *  Never throws: a failure is a HostPlan with ok:false and why. */
export async function readHostPlan(nowIso = new Date().toISOString(), paidThisPeriod = 0): Promise<HostPlan> {
  const blank = (why: HostPlan['why']): HostPlan => ({ ok: false, team: null, plan: null, credits_included: null, credits_used: null, period_start: null, next_period_start: null, exceeded: false, read_at: nowIso, why });
  if (!NETLIFY_TOKEN) return blank('no_token');
  if (hostCache && Date.now() - hostCache.at < HOST_CACHE_MS) return hostPlanFrom(hostCache.account, hostCache.read_at, paidThisPeriod);
  try {
    const r = await fetch(`${API}/accounts`, { headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` }, signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    if (!r.ok) return blank(r.status === 401 || r.status === 403 ? 'refused' : 'unreadable');
    let json: unknown = null; try { json = JSON.parse(text); } catch { return blank('unreadable'); }
    const first = Array.isArray(json) ? json[0] : json;
    if (!first || typeof first !== 'object') return blank('unreadable');
    hostCache = { at: Date.now(), account: first, read_at: nowIso };
    return hostPlanFrom(first, nowIso, paidThisPeriod);
  } catch { return blank('unreadable'); }
}
