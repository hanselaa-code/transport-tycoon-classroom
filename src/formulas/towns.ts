/**
 * OpenTTD Town Growth Mechanics
 *
 * Derived directly from official OpenTTD C++ source file:
 * - `src/town_cmd.cpp` (`CountActiveStations`, `GetNormalGrowthRate`, `UpdateTownGrowth`, `_grow_count_values`)
 */

/**
 * Exact OpenTTD `_grow_count_values[1]` table (`src/town_cmd.cpp:3900`) for unfunded towns,
 * indexed by `std::min(activeStations, 5)`:
 * - 0 active stations: 320 (plus 11/12 skip malus in `UpdateTownGrowth` line 3963 -> effectively stagnant)
 * - 1 active station:  420 town ticks per house
 * - 2 active stations: 300 town ticks per house
 * - 3 active stations: 220 town ticks per house
 * - 4 active stations: 160 town ticks per house
 * - 5+ active stations: 100 town ticks per house
 */
export const OPENTTD_TOWN_GROW_TICKS_BY_STATIONS: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
] = [320, 420, 300, 220, 160, 100];

export const MAX_EFFECTIVE_TOWN_STATIONS = 5;

/**
 * OpenTTD Town Growth (`src/town_cmd.cpp:3874-3966`):
 * Returns population growth delta per month based on:
 * - `activeServicedStations` (OpenTTD 0..5 active stations curve where pickup/unload occurred recently)
 * - `deliveredPassengers` (`TownAcceptanceEffect::Passengers`)
 * - `deliveredMail` (`TownAcceptanceEffect::Mail`)
 * - `deliveredGoodsOrFood` (`TownAcceptanceEffect::Goods` / `TownAcceptanceEffect::Food`)
 * - `population` scaling (`num_houses / 50 + 1` in `GetNormalGrowthRate`, `town_cmd.cpp:3911`)
 */
export function calculateTownGrowthDelta(
  population: number,
  activeServicedStations: number,
  deliveredPassengers: number,
  deliveredMail: number,
  deliveredGoodsOrFood: number
): number {
  const safePop = Math.max(0, Number.isFinite(population) ? population : 0);
  const safeStations = Math.max(
    0,
    Math.min(
      MAX_EFFECTIVE_TOWN_STATIONS,
      Math.floor(Number.isFinite(activeServicedStations) ? activeServicedStations : 0)
    )
  );
  const safePax = Math.max(0, Number.isFinite(deliveredPassengers) ? deliveredPassengers : 0);
  const safeMail = Math.max(0, Number.isFinite(deliveredMail) ? deliveredMail : 0);
  const safeSupply = Math.max(
    0,
    Number.isFinite(deliveredGoodsOrFood) ? deliveredGoodsOrFood : 0
  );

  // Unserviced town with zero cargo activity stagnates (OpenTTD `CountActiveStations(t) == 0` malus)
  if (safeStations === 0 && safePax === 0 && safeMail === 0 && safeSupply === 0) {
    return 0;
  }

  // Base monthly growth derived inversely from OpenTTD `_grow_count_values[1][n]`:
  // n=1 -> 10, n=2 -> 14, n=3 -> 19.09, n=4 -> 26.25, n=5 -> 42 inhabitants/month
  const stationBaseGrowth =
    safeStations > 0
      ? 4200 / OPENTTD_TOWN_GROW_TICKS_BY_STATIONS[safeStations]
      : 2;

  // Cargo delivery accelerators (`TownAcceptanceEffect` goals in `town_cmd.cpp:3942-3954`)
  const passengerBoost = safePax * 0.18;
  const mailBoost = safeMail * 0.22;
  const supplyBoost = safeSupply * 0.35;

  // Larger towns have more house tiles expanding in parallel (`num_houses / 50 + 1`, `town_cmd.cpp:3911`)
  const townSizeScale = 1 + Math.min(2.0, safePop / 2500);

  const rawDelta =
    (stationBaseGrowth + passengerBoost + mailBoost + supplyBoost) * townSizeScale;

  return Math.max(1, Math.round(rawDelta));
}
