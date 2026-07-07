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
import {
  COFFEE_SHOP_PACK, COFFEE_SHOP_CATALOG, coffeeShopProvider,
  COFFEE_SHOP_JUDGMENT_RULES, COFFEE_SHOP_REC_RULES, COFFEE_SHOP_MOMENT_TEMPLATES,
} from './packs/coffee_shop.ts';
import {
  HOME_SERVICES_PACK, HOME_SERVICES_CATALOG, homeServicesProvider,
  HOME_SERVICES_JUDGMENT_RULES, HOME_SERVICES_REC_RULES, HOME_SERVICES_MOMENT_TEMPLATES,
} from './packs/home_services.ts';
import {
  PET_GROOMING_PACK, PET_GROOMING_CATALOG, petGroomingProvider,
  PET_GROOMING_JUDGMENT_RULES, PET_GROOMING_REC_RULES, PET_GROOMING_MOMENT_TEMPLATES,
} from './packs/pet_grooming.ts';
import type { Provider } from '../evidence/providers.ts';
import type { Rule } from '../judgment/rules.ts';
import type { RecRule } from '../recommendation/rules.ts';
import type { MomentTemplate } from '../moments/rules.ts';

// register installed packs so resolvePack()/composePack() see them.
// Order matters for composePack: a child's parent must be registered too — both
// are here (coffee_shop extends restaurant; the trades will extend home_services).
registerPack(RESTAURANT_PACK);
registerPack(COFFEE_SHOP_PACK);
registerPack(HOME_SERVICES_PACK);
registerPack(PET_GROOMING_PACK);   // L5.4: the third-party SDK sample (self-gating, dormant until a pet-grooming site exists)

// the aggregated contributions the engines spread into their registries
export const PACK_CATALOG: Record<string, any> = { ...RESTAURANT_CATALOG, ...COFFEE_SHOP_CATALOG, ...HOME_SERVICES_CATALOG, ...PET_GROOMING_CATALOG };
export const PACK_PROVIDERS: Provider[] = [restaurantProvider, coffeeShopProvider, homeServicesProvider, petGroomingProvider];
export const PACK_JUDGMENT_RULES: Rule[] = [...RESTAURANT_JUDGMENT_RULES, ...COFFEE_SHOP_JUDGMENT_RULES, ...HOME_SERVICES_JUDGMENT_RULES, ...PET_GROOMING_JUDGMENT_RULES];
export const PACK_REC_RULES: RecRule[] = [...RESTAURANT_REC_RULES, ...COFFEE_SHOP_REC_RULES, ...HOME_SERVICES_REC_RULES, ...PET_GROOMING_REC_RULES];
export const PACK_MOMENT_TEMPLATES: MomentTemplate[] = [...RESTAURANT_MOMENT_TEMPLATES, ...COFFEE_SHOP_MOMENT_TEMPLATES, ...HOME_SERVICES_MOMENT_TEMPLATES, ...PET_GROOMING_MOMENT_TEMPLATES];
