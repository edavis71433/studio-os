// ── Location inheritance (L5.6) — PURE resolver ─────────────────────────────
// Resolve a location's effective config from its Organization → Region →
// Location chain. Everything is inherited; a child overrides only the fields it
// sets. Same layered-merge shape as the Industry Pack composePack — one pattern,
// two uses. No engine dependency.
import type { OrgConfigLayer } from './contract.ts';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merge a child layer over a parent: child wins per leaf; objects merge;
 *  arrays REPLACE when the child sets them (an override), else inherit. Neither
 *  input is mutated (pure). */
export function mergeLayer<T extends Record<string, any>>(parent: T, child: Partial<T>): T {
  const out: Record<string, any> = { ...parent };
  for (const [k, cv] of Object.entries(child)) {
    if (cv === undefined) continue;                       // "inherit" — the child said nothing
    const pv = out[k];
    if (isObj(cv) && isObj(pv)) out[k] = mergeLayer(pv, cv);
    else out[k] = cv;                                     // scalar/array override
  }
  return out as T;
}

/** Resolve the effective config for a location from its chain (parents first). */
export function resolveConfig(org: OrgConfigLayer, region?: OrgConfigLayer | null, location?: OrgConfigLayer | null): OrgConfigLayer {
  let cfg: OrgConfigLayer = { ...org };
  if (region) cfg = mergeLayer(cfg, region);
  if (location) cfg = mergeLayer(cfg, location);
  return cfg;
}

/** What a location ACTUALLY overrides vs its resolved parent — for storage and
 *  display ("only differences are stored"). Recursively keeps only differing leaves. */
export function diffFromParent(parent: OrgConfigLayer, full: OrgConfigLayer): Partial<OrgConfigLayer> {
  const diff: Record<string, any> = {};
  for (const [k, fv] of Object.entries(full)) {
    const pv = (parent as any)[k];
    if (isObj(fv) && isObj(pv)) {
      const sub = diffFromParent(pv, fv as OrgConfigLayer);
      if (Object.keys(sub).length) diff[k] = sub;
    } else if (JSON.stringify(fv) !== JSON.stringify(pv)) {
      diff[k] = fv;
    }
  }
  return diff;
}

// ── cross-location aggregation (read-side; the pipeline stays per-location) ──
// The engines run per location unchanged; the ORGANIZATION view is a pure rollup
// of what each location's pipeline already produced. No engine change.
export interface LocationSignal { site_id: string; name: string; active_moments: number; needs_attention: number; }
export interface OrgRollup {
  locations: number;
  total_active_moments: number;
  needs_attention_locations: string[];   // location names above the org's own norm
  calmest: string | null;
  busiest: string | null;
}
export function aggregateLocations(signals: LocationSignal[]): OrgRollup {
  if (!signals.length) return { locations: 0, total_active_moments: 0, needs_attention_locations: [], calmest: null, busiest: null };
  const total = signals.reduce((n, s) => n + s.active_moments, 0);
  const avg = total / signals.length;
  const sorted = [...signals].sort((a, b) => a.active_moments - b.active_moments);
  return {
    locations: signals.length,
    total_active_moments: total,
    // an outlier = a location carrying more open moments than the org average + attention items
    needs_attention_locations: signals.filter((s) => s.needs_attention > 0 || s.active_moments > avg).map((s) => s.name),
    calmest: sorted[0]?.name ?? null,
    busiest: sorted[sorted.length - 1]?.name ?? null,
  };
}
