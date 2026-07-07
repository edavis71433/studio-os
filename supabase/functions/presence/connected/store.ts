// ── Connected Platform store (L4.1) — service role ──────────────────────────
// The token vault + connection lifecycle, one shape for every provider. Tokens
// are sealed (AES-256-GCM) before insert and never leave here in the clear.
import { svc } from '../lib/db.ts';
import { seal, open } from './crypto.ts';
import type { ConnectionStatus } from './contract.ts';

export interface TokenBundle {
  access_token: string;
  refresh_token?: string;
  expires_at?: string | null;   // ISO
  token_type?: string;
  scope?: string;
}

// Seal + upsert the token bundle out-of-row; point the connection at it and mark
// it connected. Returns false if encryption isn't configured (fail closed — we
// never store a token in the clear).
export async function saveTokens(siteId: string, providerKey: string, bundle: TokenBundle, scopesGranted: string[]): Promise<boolean> {
  const sealed = await seal(JSON.stringify(bundle));
  if (!sealed) return false;
  const s = await svc('presence_connection_secrets?on_conflict=site_id,provider_key', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ site_id: siteId, provider_key: providerKey, ciphertext: sealed.ciphertext, iv: sealed.iv }),
  });
  const secretId = s.json?.[0]?.id || null;
  await setConnection(siteId, providerKey, {
    status: 'connected', health: 'ok', scopes_granted: scopesGranted,
    secret_ref: secretId, connected_at: new Date().toISOString(), last_error: '',
  });
  return true;
}

export async function loadTokens(siteId: string, providerKey: string): Promise<TokenBundle | null> {
  const r = await svc(`presence_connection_secrets?site_id=eq.${encodeURIComponent(siteId)}&provider_key=eq.${encodeURIComponent(providerKey)}&select=ciphertext,iv&limit=1`);
  const row = r.json?.[0];
  if (!row) return null;
  const plain = await open({ ciphertext: row.ciphertext, iv: row.iv });
  if (!plain) return null;
  try { return JSON.parse(plain) as TokenBundle; } catch { return null; }
}

export async function getConnection(siteId: string, providerKey: string): Promise<any | null> {
  const r = await svc(`presence_connections?site_id=eq.${encodeURIComponent(siteId)}&provider_key=eq.${encodeURIComponent(providerKey)}&select=provider_key,status,health,scopes_granted,last_sync_at,last_error,connected_at&limit=1`);
  return r.json?.[0] || null;
}

export async function setConnection(siteId: string, providerKey: string, patch: Record<string, unknown>): Promise<void> {
  await svc('presence_connections?on_conflict=site_id,provider_key', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: siteId, provider_key: providerKey, ...patch }),
  });
}

export async function markStatus(siteId: string, providerKey: string, status: ConnectionStatus, health: 'ok' | 'attention' | 'down' | 'unknown', error = ''): Promise<void> {
  await svc(`presence_connections?site_id=eq.${encodeURIComponent(siteId)}&provider_key=eq.${encodeURIComponent(providerKey)}`, {
    method: 'PATCH', body: JSON.stringify({ status, health, last_error: error.slice(0, 300) }),
  });
}

export async function saveConnectedData(siteId: string, providerKey: string, data: unknown): Promise<void> {
  // L4.2: roll the existing snapshot into `prev` before overwriting, so the
  // Evidence Engine can observe MEANINGFUL CHANGE (traffic up, rating up, new
  // reviews) between reads. One row per provider still — this is memory of the
  // last observation, not history. On the very first read prev stays null.
  const existing = await svc(`presence_connected_data?site_id=eq.${encodeURIComponent(siteId)}&provider_key=eq.${encodeURIComponent(providerKey)}&select=data,fetched_at&limit=1`);
  const prevRow = existing.json?.[0] || null;
  const now = new Date().toISOString();
  await svc('presence_connected_data?on_conflict=site_id,provider_key', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      site_id: siteId, provider_key: providerKey, data, fetched_at: now,
      prev: prevRow?.data ?? null, prev_fetched_at: prevRow?.fetched_at ?? null,
    }),
  });
  await svc(`presence_connections?site_id=eq.${encodeURIComponent(siteId)}&provider_key=eq.${encodeURIComponent(providerKey)}`, {
    method: 'PATCH', body: JSON.stringify({ last_sync_at: new Date().toISOString() }),
  });
}

export async function loadAllConnectedData(siteId: string): Promise<Array<{ provider_key: string; data: any; fetched_at: string }>> {
  const r = await svc(`presence_connected_data?site_id=eq.${encodeURIComponent(siteId)}&select=provider_key,data,fetched_at`);
  return (r.ok && Array.isArray(r.json)) ? r.json : [];
}

// Full disconnect: destroy the sealed token, drop the cached data, mark the
// record disconnected, and log it. Always safe; the customer's data at the
// provider is untouched. (Live token revocation at the provider is attempted by
// the caller before this, best-effort.)
export async function disconnect(siteId: string, providerKey: string, actorKind = 'customer'): Promise<void> {
  await svc(`presence_connection_secrets?site_id=eq.${encodeURIComponent(siteId)}&provider_key=eq.${encodeURIComponent(providerKey)}`, { method: 'DELETE' });
  await svc(`presence_connected_data?site_id=eq.${encodeURIComponent(siteId)}&provider_key=eq.${encodeURIComponent(providerKey)}`, { method: 'DELETE' });
  await setConnection(siteId, providerKey, { status: 'disconnected', health: 'unknown', scopes_granted: [], secret_ref: null, connected_at: null, last_error: '' });
  await svc('presence_connection_events', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ site_id: siteId, provider_key: providerKey, action: 'disconnect', detail: 'disconnected; token destroyed, cache cleared', actor_kind: actorKind }),
  });
}
