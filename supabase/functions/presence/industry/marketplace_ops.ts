// ── Industry Pack Marketplace — the management core (L5.5), PURE ─────────────
// The Marketplace makes packs behave like installable software: install, enable,
// disable, update, remove, export, import — with dependency resolution, validation,
// clear states, and (crucially) EVERY state-changing operation expressed as an
// Approved Plan (lib/approved_plan.ts). No new approval system, no commerce, no
// engine change. This module is the pure brain; the store does the I/O, the route
// runs the Approved-Plan lifecycle.
import type { IndustryPack } from './contract.ts';
import type { ApprovedPlanBase } from '../lib/approved_plan.ts';
import { validatePack, validatePackAgainstRegistry } from './helpers.ts';
import { isCompatible, compareVersions, PLATFORM_VERSION } from './marketplace.ts';

// ── the full pack lifecycle states ───────────────────────────────────────────
export type PackState =
  | 'available' | 'installed' | 'enabled' | 'disabled' | 'update_available'
  | 'deprecated' | 'unsupported' | 'incompatible' | 'failed_validation'
  | 'pending_approval' | 'removing';
export const PACK_STATES: PackState[] = [
  'available', 'installed', 'enabled', 'disabled', 'update_available',
  'deprecated', 'unsupported', 'incompatible', 'failed_validation', 'pending_approval', 'removing',
];

// the state-changing operations that require an Approved Plan (export/import handled separately)
export type MarketplaceOp = 'install' | 'enable' | 'disable' | 'update' | 'remove';
export const MARKETPLACE_OPS: MarketplaceOp[] = ['install', 'enable', 'disable', 'update', 'remove'];

// an install record (what the store persists per pack)
export interface InstallRecord { pack_key: string; version: string; state: PackState; enabled: boolean; scope: string; }

// ── dependency resolution ────────────────────────────────────────────────────
// The frozen contract's only structural dependency is `extends` (a child needs
// its parent installed). Conflicts are evidence-type collisions. Cycles are a
// cyclic extends chain. (Optional deps are a declared extension point — none in
// the frozen contract yet.)
export interface DependencyResolution {
  requires: string[];          // ancestor pack keys this pack needs installed
  missing: string[];           // required ancestors NOT installed
  conflicts: string[];         // evidence-type collisions with installed packs
  optional: string[];          // declared optional deps (none in the frozen contract)
  cycle: boolean;              // a cyclic extends chain
}
export function resolveDependencies(pack: IndustryPack, byKey: Map<string, IndustryPack>): DependencyResolution {
  const requires: string[] = [];
  let cycle = false;
  // walk the extends chain (bounded, cycle-safe)
  let cur: string | null = pack.extends;
  const seen = new Set<string>([pack.key]);
  while (cur) {
    if (seen.has(cur)) { cycle = true; break; }
    seen.add(cur); requires.push(cur);
    cur = byKey.get(cur)?.extends ?? null;
  }
  const missing = requires.filter((k) => !byKey.has(k));
  const conflicts: string[] = [];
  const mine = new Set(pack.evidence.catalogTypes);
  for (const [k, o] of byKey) {
    if (k === pack.key) continue;
    for (const t of o.evidence.catalogTypes) if (mine.has(t)) conflicts.push(`${t} (with ${k})`);
  }
  return { requires, missing, conflicts, optional: [], cycle };
}

// ── install assessment — reject bad packs BEFORE they install ────────────────
export interface Assessment {
  ok: boolean;
  state: PackState;            // where this pack would land
  problems: string[];          // every reason it can't proceed, each self-explaining
  dependencies: DependencyResolution;
}
export function assessInstall(pack: IndustryPack, installed: IndustryPack[], platformVersion: string = PLATFORM_VERSION): Assessment {
  const byKey = new Map(installed.map((p) => [p.key, p]));
  const problems: string[] = [];
  // 1. manifest integrity + required metadata + naming + semver + capability declarations
  const v = validatePack(pack);
  if (!v.ok) problems.push(...v.problems);
  // 2. duplicate identifier
  if (byKey.has(pack.key)) problems.push(`a pack with key "${pack.key}" is already installed`);
  // 3. registry consistency: collisions / missing deps / cycles
  const reg = validatePackAgainstRegistry(pack, installed);
  if (!reg.ok) problems.push(...reg.problems);
  // 4. platform compatibility
  if (!isCompatible(pack, platformVersion)) problems.push(`requires platform ${pack.marketplace.minPlatformVersion}, running ${platformVersion}`);
  const dependencies = resolveDependencies(pack, byKey);
  // classify the resulting state — incompatibility is its own state, ahead of
  // the general failed_validation bucket.
  let state: PackState = 'installed';
  if (!isCompatible(pack, platformVersion)) state = 'incompatible';
  else if (v.problems.length || dependencies.missing.length || dependencies.cycle || dependencies.conflicts.length) state = 'failed_validation';
  return { ok: problems.length === 0, state, problems, dependencies };
}

// ── a marketplace operation as an APPROVED PLAN ──────────────────────────────
// Plain-language, reuses the shared ApprovedPlanBase — the operator reads it like
// any other approved plan, and it flows the same propose→approve→execute→audit
// →rollback lifecycle (lib/approved_plan.ts). No second approval system.
export interface MarketplacePlan extends ApprovedPlanBase {
  op: MarketplaceOp;
  pack_key: string;
  version: string;
  what_changes: string[];
  what_stays: string[];
  rollback: string;                    // plain-language how-to-undo (shared plan field)
  rollback_op: MarketplaceOp | null;   // the inverse operation, where one exists
  blocked: string[];                    // non-empty ⇒ the operation is refused (assessment failed)
  dependencies: DependencyResolution;
}

const OP_INVERSE: Record<MarketplaceOp, MarketplaceOp | null> = {
  install: 'remove', enable: 'disable', disable: 'enable', update: 'update', remove: 'install',
};

export function planMarketplaceOperation(op: MarketplaceOp, pack: IndustryPack, installed: IndustryPack[], platformVersion: string = PLATFORM_VERSION): MarketplacePlan {
  const assess = assessInstall(pack, installed, platformVersion);
  const blocked: string[] = [];
  // install/update must pass assessment; enable/disable/remove only need the pack to exist installed
  if ((op === 'install' || op === 'update') && !assess.ok) blocked.push(...assess.problems);
  if ((op === 'enable' || op === 'disable' || op === 'remove') && !installed.some((p) => p.key === pack.key)) {
    // (for enable/disable/remove the pack should already be installed — the store enforces the real state)
  }
  const label = pack.label;
  const copy: Record<MarketplaceOp, { title: string; summary: string; changes: string[]; risk: string; reversible: boolean; rollback: string }> = {
    install: { title: `Install ${label}`, summary: `Makes ${label} available for ${pack.key} sites. Nothing changes for existing sites of other industries.`, changes: [`${label} becomes available for ${pack.key} businesses`], risk: 'Low. It only adds an option; no existing site is affected.', reversible: true, rollback: `Uninstall ${label} — no site loses anything, because it was only newly available.` },
    enable: { title: `Enable ${label}`, summary: `Turns ${label} on, so ${pack.key} sites see its features.`, changes: [`${pack.key} sites begin seeing ${label}'s features`], risk: 'Low. Reversible instantly.', reversible: true, rollback: `Disable ${label} again.` },
    disable: { title: `Disable ${label}`, summary: `Turns ${label} off. ${pack.key} sites stop seeing its features; their content is untouched.`, changes: [`${pack.key} sites stop seeing ${label}'s features`], risk: 'Low. No content is deleted; re-enable any time.', reversible: true, rollback: `Enable ${label} again.` },
    update: { title: `Update ${label} to ${pack.version}`, summary: `Moves ${label} to version ${pack.version}. Sites keep working; only the pack's behavior updates.`, changes: [`${label} moves to version ${pack.version}`], risk: 'Low. The previous version can be restored.', reversible: true, rollback: `Roll back to the previous version of ${label}.` },
    remove: { title: `Remove ${label}`, summary: `Uninstalls ${label}. ${pack.key} sites keep all their content; they simply stop getting ${label}'s features.`, changes: [`${label} is uninstalled`], risk: 'Low. Customer content is never touched by removing a pack.', reversible: true, rollback: `Reinstall ${label}.` },
  };
  const c = copy[op];
  return {
    op, pack_key: pack.key, version: pack.version,
    title: c.title, summary: c.summary,
    what_changes: c.changes,
    what_stays: ['Every customer’s content, drafts, domains, and history are untouched.', 'Sites of other industries are unaffected.'],
    risk: c.risk, reversible: c.reversible, rollback: c.rollback, rollback_op: OP_INVERSE[op],
    requires_approval: true, blocked, dependencies: assess.dependencies,
  };
}

// ── customer-facing view — features, never packages ──────────────────────────
// A customer never thinks about packs; they see the capabilities a pack provides,
// in plain words, for their own industry only.
export function customerFeatures(pack: IndustryPack): { features: string[]; updated: boolean } {
  const features: string[] = [];
  if (pack.cms.pages.length) features.push(`${pack.label} pages (${pack.cms.pages.slice(0, 4).join(', ')}…)`);
  if (pack.intelligence.judgmentRules.length) features.push(`${pack.label} guidance`);
  if (pack.growth.pack) features.push(`${pack.label} growth calendar`);
  if (pack.connected.relevantProviders.length) features.push('recommended connections');
  return { features, updated: false };
}

// ── update detection ─────────────────────────────────────────────────────────
export function updateAvailable(installedVersion: string, candidateVersion: string): boolean {
  return compareVersions(candidateVersion, installedVersion) === 1;
}
