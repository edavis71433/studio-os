// ── Industry Marketplace lifecycle (L5.0) — the install/version contract ─────
// How future packs are installed, enabled, disabled, updated, versioned,
// exported, and shared — defined as a PURE state machine now, so the mechanism
// exists before any pack does. No storage, no UI, no packs: the contract only.
import type { IndustryPack, PackStatus } from './contract.ts';

// The Industry Platform's own version. Frozen contract at 5.0; the current
// runtime is 5.4 (L5.4). A pack declares the minimum it needs; the platform
// refuses to install a pack that needs a newer platform than is running.
export const PLATFORM_VERSION = '5.4.0';

export type MarketplaceAction = 'install' | 'enable' | 'disable' | 'update' | 'deprecate';

// The lifecycle: planned/draft are author states; available is publishable;
// installed↔disabled is the per-site toggle; deprecated is end-of-life.
const TRANSITIONS: Record<MarketplaceAction, { from: PackStatus[]; to: PackStatus }> = {
  install: { from: ['available'], to: 'installed' },
  enable: { from: ['disabled'], to: 'installed' },
  disable: { from: ['installed'], to: 'disabled' },
  update: { from: ['installed', 'available'], to: 'installed' }, // to a newer version, same status family
  deprecate: { from: ['available', 'installed', 'disabled'], to: 'deprecated' },
};

export const canInstall = (s: PackStatus) => TRANSITIONS.install.from.includes(s);
export const canEnable = (s: PackStatus) => TRANSITIONS.enable.from.includes(s);
export const canDisable = (s: PackStatus) => TRANSITIONS.disable.from.includes(s);
export const canDeprecate = (s: PackStatus) => TRANSITIONS.deprecate.from.includes(s);

/** Apply a lifecycle action to a status; returns the next status or null if the
 *  transition isn't legal (nothing self-transitions, nothing skips). */
export function transition(status: PackStatus, action: MarketplaceAction): PackStatus | null {
  const t = TRANSITIONS[action];
  return t && t.from.includes(status) ? t.to : null;
}

// ── semantic versioning (packs are versioned; updates only go forward) ───────
export function parseVersion(v: string): [number, number, number] {
  const m = String(v).split('.').map((n) => parseInt(n, 10));
  return [m[0] || 0, m[1] || 0, m[2] || 0];
}
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const A = parseVersion(a), B = parseVersion(b);
  for (let i = 0; i < 3; i++) { if (A[i] < B[i]) return -1; if (A[i] > B[i]) return 1; }
  return 0;
}
/** An update is offered only when the candidate is strictly newer. */
export function canUpdate(current: string, candidate: string): boolean {
  return compareVersions(candidate, current) === 1;
}

// ── export / share — a pack is DATA, so it is always serializable ────────────
export interface ExportedPack {
  format: 'studio-os-industry-pack';
  spec_version: 1;
  key: string; version: string; label: string; family: string;
  pack: IndustryPack;                 // the whole pack, verbatim
}
/** Export a pack to a portable document (no secrets, no site data — pack only). */
export function exportPack(pack: IndustryPack): ExportedPack {
  return { format: 'studio-os-industry-pack', spec_version: 1, key: pack.key, version: pack.version, label: pack.label, family: pack.family, pack };
}
/** A pack may be shared/exported only if its author marked it so (default true). */
export const canExport = (pack: IndustryPack) => pack.marketplace.exportable;
export const canShare = (pack: IndustryPack) => pack.marketplace.shareable;

// ── platform compatibility — a pack must not require a newer platform ────────
export function isCompatible(pack: IndustryPack, platformVersion: string = PLATFORM_VERSION): boolean {
  return compareVersions(pack.marketplace.minPlatformVersion, platformVersion) <= 0;
}

