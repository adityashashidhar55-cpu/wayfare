/**
 * Client entry point for dietary logic. The implementation lives in
 * `@contracts/diet` so the server generator ranks food picks with the
 * exact same rules the UI badges with - re-exported here for `@/lib/diet`
 * imports (PlaceDetailDialog, suggestion cards, AiTripBuilder).
 */
export {
  DIETARIES,
  DIET_META,
  DIET_UNVERIFIED_NOTE,
  dietBadge,
  dietClass,
  dietConfirmed,
  dietFit,
  isFoodPlace,
  isMeatOnly,
  isVegDiet,
  parseDietary,
} from '@contracts/diet';
export type { Dietary, DietBadge, DietBadgeKind, DietClass, DietPlaceLike } from '@contracts/diet';
