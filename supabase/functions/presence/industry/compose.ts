// ── Industry composition (L5.1) — the ONE seam where packs meet the engines ──
// The frozen engines iterate their registries; a pack's contributions are
// appended here, generically. Engine files import these aggregates (never a
// specific pack), so adding the 2nd/50th pack is an entry in THIS file, and the
// engines never learn any industry's name. Self-gating (each provider checks the
// resolved industry) keeps every pack's evidence inert for other industries, so
// composition changes nothing for a site whose industry doesn't match.
import { registerPack } from './registry.ts';
import {
  RESTAURANT_PACK, RESTAURANT_CATALOG, restaurantProvider,
  RESTAURANT_JUDGMENT_RULES, RESTAURANT_REC_RULES, RESTAURANT_MOMENT_TEMPLATES,
} from './packs/restaurant.ts';
import type { Provider } from '../evidence/providers.ts';
import type { Rule } from '../judgment/rules.ts';
import type { RecRule } from '../recommendation/rules.ts';
import type { MomentTemplate } from '../moments/rules.ts';

// register installed packs so resolvePack()/composePack() see them
registerPack(RESTAURANT_PACK);

// the aggregated contributions the engines spread into their registries
export const PACK_CATALOG: Record<string, any> = { ...RESTAURANT_CATALOG };
export const PACK_PROVIDERS: Provider[] = [restaurantProvider];
export const PACK_JUDGMENT_RULES: Rule[] = [...RESTAURANT_JUDGMENT_RULES];
export const PACK_REC_RULES: RecRule[] = [...RESTAURANT_REC_RULES];
export const PACK_MOMENT_TEMPLATES: MomentTemplate[] = [...RESTAURANT_MOMENT_TEMPLATES];
