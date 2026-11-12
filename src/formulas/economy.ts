/**
 * OpenTTD Cargo Payment, Station Rating & Secondary Industry Mechanics
 *
 * Derived directly from official OpenTTD C++ source files:
 * - `src/table/cargo_const.h` (`_default_cargo` table: initial_payment, transit_periods[0..1], TownAcceptanceEffect)
 * - `src/economy.cpp` (`GetTransportedGoodsIncome`, `DeliverGoodsToIndustry`, `TriggerIndustryProduction`)
 * - `src/station_cmd.cpp` (`UpdateStationRating`)
 * - `src/industry_cmd.cpp` (`ProduceIndustryGoods`, `ChangeIndustryProduction`)
 */

export type FormulaCargoType =
  | 'PASSENGERS'
  | 'MAIL'
  | 'COAL'
  | 'WOOD'
  | 'GOODS'
  | 'GRAIN'
  | 'FOOD';

export interface CargoSpec {
  cargo: FormulaCargoType;
  labelNo: string;
  /** Calibrated OpenTTD commodity base rate in kr per unit-tile (modest bus fares, strong industrial long-haul freight) */
  baseRateKr: number;
  /** OpenTTD early decay threshold (in transit days) */
  days1: number;
  /** OpenTTD steeper second decay threshold (in transit days) */
  days2: number;
  isTimeSensitive: boolean;
}

/**
 * OpenTTD `GetTransportedGoodsIncome` (`src/economy.cpp:985-986`) time-factor bounds.
 */
export const OPENTTD_MAX_TIME_FACTOR = 255;
export const OPENTTD_MIN_TIME_FACTOR = 31;

/**
 * OpenTTD `UpdateStationRating` (`src/station_cmd.cpp:3982,4017`) internal rating scale.
 */
export const OPENTTD_MAX_STATION_RATING = 255;
export const OPENTTD_INITIAL_STATION_RATING = 175; // ~69%

/**
 * Calibrated cargo table mapping OpenTTD `_default_cargo` (`src/table/cargo_const.h:57-100`)
 * commodity tiers and `transit_periods` into Norwegian Kroner (kr), keeping municipal/intercity
 * passenger & mail fares modest while rewarding bulk/express industrial chains.
 *
 * Reference OpenTTD `_default_cargo` entries:
 * - CT_PASSENGERS: ip=3185, td1=0,  td2=24, TownAcceptanceEffect::Passengers
 * - CT_MAIL:       ip=4550, td1=20, td2=90, TownAcceptanceEffect::Mail
 * - CT_COAL:       ip=5916, td1=7,  td2=255, Bulk
 * - CT_WOOD:       ip=5005, td1=15, td2=255, PieceGoods (Temperate)
 * - CT_GOODS:      ip=6144, td1=5,  td2=28, TownAcceptanceEffect::Goods
 * - CT_GRAIN:      ip=4778, td1=4,  td2=40, Bulk/Potable
 * - CT_FOOD:       ip=5688, td1=0,  td2=30, TownAcceptanceEffect::Food
 */
export const CARGO_SPECS: Record<FormulaCargoType, CargoSpec> = {
  PASSENGERS: {
    cargo: 'PASSENGERS',
    labelNo: 'Passasjerer',
    baseRateKr: 3.2,
    days1: 3,
    days2: 24,
    isTimeSensitive: true,
  },
  MAIL: {
    cargo: 'MAIL',
    labelNo: 'Post',
    baseRateKr: 5.2,
    days1: 15,
    days2: 75,
    isTimeSensitive: true,
  },
  COAL: {
    cargo: 'COAL',
    labelNo: 'Kull',
    baseRateKr: 11.5,
    days1: 18,
    days2: 255,
    isTimeSensitive: false,
  },
  WOOD: {
    cargo: 'WOOD',
    labelNo: 'Tømmer',
    baseRateKr: 10.2,
    days1: 35,
    days2: 255,
    isTimeSensitive: false,
  },
  GOODS: {
    cargo: 'GOODS',
    labelNo: 'Varer',
    baseRateKr: 13.5,
    days1: 12,
    days2: 45,
    isTimeSensitive: true,
  },
  GRAIN: {
    cargo: 'GRAIN',
    labelNo: 'Korn',
    baseRateKr: 9.8,
    days1: 10,
    days2: 50,
    isTimeSensitive: true,
  },
  FOOD: {
    cargo: 'FOOD',
    labelNo: 'Matvarer',
    baseRateKr: 12.2,
    days1: 4,
    days2: 30,
    isTimeSensitive: true,
  },
};

/**
 * Computes the OpenTTD transit time decay numerator (`31..255`) from `GetTransportedGoodsIncome`
 * (`src/economy.cpp:985-1018`):
 * - `transitDays <= days1`: constant `255`
 * - `days1 < transitDays <= days2`: linear `-1` per day
 * - `transitDays > days2`: steeper linear `-2` per day
 * - Floor clamped at `MIN_TIME_FACTOR = 31` (`31 / 255` ~= 12.16% minimum payout).
 */
export function calculateCargoTimeFactor(
  cargo: FormulaCargoType,
  transitDays: number
): number {
  const spec = CARGO_SPECS[cargo];
  const safeDays = Math.max(0, Number.isFinite(transitDays) ? transitDays : 0);
  const daysOver1 = Math.max(0, safeDays - spec.days1);
  const daysOver2 = Math.max(0, safeDays - spec.days2);
  return Math.max(
    OPENTTD_MIN_TIME_FACTOR,
    OPENTTD_MAX_TIME_FACTOR - daysOver1 - daysOver2
  );
}

/**
 * Authentic OpenTTD `GetTransportedGoodsIncome` (`src/economy.cpp:957-1019`) curve:
 * `Manhattan distance * units * baseRate * (timeFactor / 255)`
 * where `timeFactor` starts at `255`, decays `-1/day` after `days1`, `-2/day` after `days2`,
 * and floors at `31/255`.
 */
export function calculateCargoPayment(
  cargo: FormulaCargoType,
  units: number,
  manhattanDistance: number,
  transitDays: number
): number {
  if (units <= 0 || manhattanDistance <= 0) {
    return 0;
  }
  if (!Number.isFinite(units) || !Number.isFinite(manhattanDistance)) {
    return 0;
  }

  const spec = CARGO_SPECS[cargo];
  const timeFactor = calculateCargoTimeFactor(cargo, transitDays);
  const rawIncome =
    (manhattanDistance * units * spec.baseRateKr * timeFactor) /
    OPENTTD_MAX_TIME_FACTOR;

  return Math.max(0, Math.round(rawIncome));
}

/**
 * OpenTTD `UpdateStationRating` (`src/station_cmd.cpp:3967-4072`) mapped to `0..100%`:
 * Combines:
 * 1. `daysSincePickup` score (`station_cmd.cpp:4045-4050`: +130, +95, +50, +25, 0 on 0..255 scale)
 * 2. `vehicleMaxSpeedKmh` score (`station_cmd.cpp:4042-4043`: `(speed - 85) >> 2`, capped at +42)
 * 3. `waitingUnits` stockpile bonus/penalty (`station_cmd.cpp:4052-4057`: -90 base + tiered +130..0)
 * 4. Active service vehicle baseline (`station_cmd.cpp:4062-4065`: +20 when serviced)
 * 5. Classroom HQ proximity perk (`+5%` per HQ tier within HQ radius, passed via `hqBonusPct`)
 */
export function calculateStationRating(
  daysSincePickup: number,
  vehicleMaxSpeedKmh: number,
  waitingUnits: number,
  hqBonusPct: number
): number {
  const safeDays = Math.max(0, Number.isFinite(daysSincePickup) ? daysSincePickup : 0);
  const safeSpeed = Math.max(0, Number.isFinite(vehicleMaxSpeedKmh) ? vehicleMaxSpeedKmh : 0);
  const safeWaiting = Math.max(0, Number.isFinite(waitingUnits) ? waitingUnits : 0);
  const rawHqBonus = Number.isFinite(hqBonusPct) ? hqBonusPct : 0;
  // Normalize in case caller passes fractional 0.05..0.25 vs percentage 5..25
  const normalizedHqBonusPct =
    rawHqBonus > 0 && rawHqBonus < 1 ? rawHqBonus * 100 : rawHqBonus;

  let rating255 = 0;

  // 1. Vehicle max speed contribution (`ge->last_speed - 85` >> 2, capped at 42)
  if (safeSpeed > 85) {
    rating255 += Math.min(42, Math.floor((safeSpeed - 85) / 4));
  }

  // 2. Days since last pickup (`ge->time_since_pickup` in 2.5-day aging ticks -> calendar days)
  if (safeDays <= 21 * 2.5) rating255 += 25; // <= 52.5 days
  if (safeDays <= 12 * 2.5) rating255 += 25; // <= 30 days
  if (safeDays <= 6 * 2.5) rating255 += 45;  // <= 15 days
  if (safeDays <= 3 * 2.5) rating255 += 35;  // <= 7.5 days

  // 3. Waiting cargo penalty/bonus (`station_cmd.cpp:4052-4057`)
  rating255 -= 90;
  if (safeWaiting <= 1500) rating255 += 55;
  if (safeWaiting <= 1000) rating255 += 35;
  if (safeWaiting <= 600) rating255 += 10;
  if (safeWaiting <= 300) rating255 += 20;
  if (safeWaiting <= 100) rating255 += 10;

  // 4. Active modern fleet baseline (`ge->last_age` contribution in `station_cmd.cpp:4062-4065`)
  if (safeSpeed > 0) {
    rating255 += 20;
  }

  const clamped255 = Math.max(0, Math.min(OPENTTD_MAX_STATION_RATING, rating255));
  const basePct = (clamped255 / OPENTTD_MAX_STATION_RATING) * 100;
  const totalPct = Math.round(basePct + normalizedHqBonusPct);

  return Math.max(0, Math.min(100, totalPct));
}

/**
 * OpenTTD `TriggerIndustryProduction` (`src/economy.cpp:1141-1165`) secondary industry conversion ratios
 * (`input_cargo_multiplier / 256`, default `256 / 256 = 1.0` in Temperate/Sub-Arctic).
 */
export const SECONDARY_INDUSTRY_CONVERSION: Partial<
  Record<FormulaCargoType, { outputCargo: FormulaCargoType; ratio: number }>
> = {
  WOOD: { outputCargo: 'GOODS', ratio: 1.0 },
  GRAIN: { outputCargo: 'FOOD', ratio: 1.0 },
};

/**
 * Helper for secondary industries (`SAWMILL`: `WOOD -> GOODS`, `FOOD_PLANT`: `GRAIN -> FOOD`)
 * mirroring OpenTTD `TriggerIndustryProduction` (`ita->waiting * input_cargo_multiplier / 256`).
 */
export function calculateSecondaryIndustryOutput(
  acceptedCargo: FormulaCargoType,
  deliveredUnits: number
): { outputCargo: FormulaCargoType | null; producedUnits: number } {
  const rule = SECONDARY_INDUSTRY_CONVERSION[acceptedCargo];
  if (!rule || deliveredUnits <= 0 || !Number.isFinite(deliveredUnits)) {
    return { outputCargo: null, producedUnits: 0 };
  }
  return {
    outputCargo: rule.outputCargo,
    producedUnits: Math.max(0, Math.floor(deliveredUnits * rule.ratio)),
  };
}
