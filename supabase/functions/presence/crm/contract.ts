// ── CRM contract (Phase C) — the Client Relationship Center, as data ─────────
// Studio OS's CRM is an OPERATIONAL RELATIONSHIP HUB, not a sales CRM. It does
// not invent parallel data — it AGGREGATES what the platform already records
// (publishes, content changes, connected events, Business Moments, pending
// approvals) into ONE calm, chronological relationship view, plus the single new
// capability the platform lacked: relationship notes (internal + shared).
//
// This file is PURE: the timeline normalizers, the audience rule, and the calm
// summary. No network, no clock beyond passed-in `now`. Tested in isolation.

export type TimelineKind = 'publish' | 'change' | 'connected' | 'moment' | 'approval' | 'note' | 'lead';
export type Audience = 'internal' | 'shared';

export interface TimelineItem {
  id: string;
  at: string;            // ISO
  kind: TimelineKind;
  audience: Audience;    // 'internal' = studio-only; 'shared' = the client may see it too
  title: string;         // plain language, no scores
  detail?: string;
}

// ── audience rule ────────────────────────────────────────────────────────────
// The studio side (operator + agency) sees everything; the client side (the
// business owner on their own account) sees only shared items. This uses the
// existing principal/agency signals — it does NOT change the permission or
// visibility models.
export function studioSideSees(item: { audience: Audience }, isStudioSide: boolean): boolean {
  return isStudioSide || item.audience === 'shared';
}
export function filterTimeline(items: TimelineItem[], isStudioSide: boolean): TimelineItem[] {
  return items.filter((i) => studioSideSees(i, isStudioSide));
}

// ── per-source normalizers (pure) ────────────────────────────────────────────
// Each turns a raw row into a calm TimelineItem. Content/publish/connected/moment
// activity is SHARED (the client's own site — they may see what happened to it);
// low-level internal-note changes stay internal.

const CHANGE_LABEL: Record<string, string> = {
  identity: 'Business details updated', location: 'Hours & location updated', offering: 'Menu items updated',
  testimonial: 'Testimonials updated', faq: 'FAQs updated', post: 'An update was posted', media: 'Photos updated',
  redirect: 'Links updated', settings: 'Settings updated', voice: 'Voice profile updated',
  publish: 'Site published', restore: 'A previous version was restored',
};

export function mapPublish(r: { id: string; kind?: string; status?: string; change_summary?: string; created_at: string; completed_at?: string }): TimelineItem {
  const restored = r.kind === 'restore';
  return {
    id: `pub:${r.id}`, at: r.completed_at || r.created_at, kind: 'publish', audience: 'shared',
    title: restored ? 'Restored an earlier version' : (r.status === 'failed' ? 'A publish didn’t complete' : 'Published the site'),
    detail: r.change_summary || undefined,
  };
}

export function mapChange(r: { id: string; entity_type: string; action: string; summary?: string; created_at: string; provenance?: string }): TimelineItem {
  const internal = r.entity_type === 'internal_note';
  return {
    id: `chg:${r.id}`, at: r.created_at, kind: 'change', audience: internal ? 'internal' : 'shared',
    title: CHANGE_LABEL[r.entity_type] || 'A change was made',
    detail: r.summary || undefined,
  };
}

export function mapConnected(r: { id: string; provider_key: string; action: string; created_at: string }, label?: string): TimelineItem {
  const verb = r.action === 'connect' ? 'connected' : r.action === 'disconnect' ? 'disconnected' : r.action === 'refresh' ? 'refreshed' : r.action;
  return {
    id: `con:${r.id}`, at: r.created_at, kind: 'connected', audience: 'shared',
    title: `${label || r.provider_key} ${verb}`,
  };
}

export function mapMoment(r: { id: string; headline: string; summary?: string; created_at: string; first_seen_at?: string }): TimelineItem {
  return { id: `mom:${r.id}`, at: r.first_seen_at || r.created_at, kind: 'moment', audience: 'shared', title: r.headline, detail: r.summary || undefined };
}

export function mapApproval(r: { id: string; title?: string; summary?: string; status?: string; created_at?: string; provider_key?: string }, kind: 'infrastructure' | 'connected'): TimelineItem {
  const st = r.status === 'approved' ? 'approved' : r.status === 'proposed' ? 'awaiting approval' : (r.status || '');
  return {
    id: `apr:${kind}:${r.id}`, at: r.created_at || new Date(0).toISOString(), kind: 'approval', audience: 'shared',
    title: r.title || (kind === 'connected' ? 'A connected change' : 'An infrastructure change'),
    detail: [r.provider_key, st, r.summary].filter(Boolean).join(' · ') || undefined,
  };
}

export function mapNote(r: { id: string; audience: Audience; body: string; author?: string; created_at: string; pinned?: boolean }): TimelineItem {
  return { id: `note:${r.id}`, at: r.created_at, kind: 'note', audience: r.audience, title: r.pinned ? 'Pinned note' : 'Note', detail: r.body };
}

/** FD-2: a lead from the published site's form — shared (the client's own inbound). */
export function mapLead(r: { id: string; form_kind: string; name?: string; email?: string; message?: string; created_at: string }): TimelineItem {
  const who = [r.name, r.email].filter(Boolean).join(' · ') || 'Someone';
  const label = r.form_kind === 'quote' ? 'Quote request' : r.form_kind === 'booking' ? 'Booking request' : 'New message';
  return { id: `lead:${r.id}`, at: r.created_at, kind: 'lead', audience: 'shared', title: `${label} from ${who}`, detail: r.message || undefined };
}

/** Merge normalized items into ONE chronological feed (newest first), capped. Pure. */
export function mergeTimeline(groups: TimelineItem[][], limit = 60): TimelineItem[] {
  const all = ([] as TimelineItem[]).concat(...groups).filter((x) => x && x.at);
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return all.slice(0, limit);
}

// ── client health (aggregated, calm — a word + a sentence, never a score) ─────
export type HealthLevel = 'healthy' | 'attention' | 'quiet' | 'new';
export interface ClientProfileSummary {
  business_name: string;
  edition: string;
  status: string;
  live: boolean;
  last_published_at: string | null;
  members: number;
  connected: number;
  connected_needing_attention: number;
  active_moments: number;
  pending_approvals: number;
  health: HealthLevel;
}

/** Derive a calm health word from aggregated signals. No numbers, no ranking. */
export function deriveClientHealth(p: Omit<ClientProfileSummary, 'health'>, nowIso: string): HealthLevel {
  if (!p.live && !p.last_published_at) return 'new';
  if (p.connected_needing_attention > 0) return 'attention';
  if (p.pending_approvals > 0) return 'attention';
  return 'healthy';
}

/** A calm, plain-language relationship summary (Law 13: sentences, not scores).
 *  Deterministic — always available, no AI cost/gating. Pure. */
export function relationshipSummary(p: ClientProfileSummary, lastActivityAt: string | null, nowIso: string): string {
  const name = p.business_name || 'This business';
  const parts: string[] = [];
  if (p.health === 'new') parts.push(`${name} is getting set up — nothing has been published yet.`);
  else if (p.live) parts.push(`${name}’s website is live.`);
  else parts.push(`${name}’s website isn’t live right now.`);

  if (p.last_published_at) parts.push(`Last published ${humanWhen(p.last_published_at, nowIso)}.`);
  if (p.pending_approvals > 0) parts.push(`${p.pending_approvals} ${p.pending_approvals === 1 ? 'change is' : 'changes are'} waiting for approval.`);
  if (p.connected_needing_attention > 0) parts.push(`${p.connected_needing_attention} connected ${p.connected_needing_attention === 1 ? 'service needs' : 'services need'} a look.`);
  else if (p.connected > 0) parts.push(`${p.connected} connected ${p.connected === 1 ? 'service is' : 'services are'} healthy.`);
  if (p.active_moments > 0) parts.push(`${p.active_moments} ${p.active_moments === 1 ? 'moment is' : 'moments are'} worth a look.`);
  return parts.join(' ');
}

export function humanWhen(iso: string, nowIso: string): string {
  const then = Date.parse(iso), now = Date.parse(nowIso);
  if (!isFinite(then) || !isFinite(now)) return 'recently';
  const days = Math.floor((now - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

// ── note validation (pure) ───────────────────────────────────────────────────
export function isAudience(a: unknown): a is Audience { return a === 'internal' || a === 'shared'; }
export function cleanNoteBody(s: unknown): string { return String(s ?? '').replace(/\s+$/,'').slice(0, 4000); }
