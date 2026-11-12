/**
 * OpenTTD Vehicle Running Costs & Terrain/Slope Speed Drag Mechanics
 *
 * Derived directly from official OpenTTD C++ source files:
 * - `src/train_cmd.cpp` (`Train::Tick`, `Train::OnNewEconomyDay`, `_accel_slowdown`, `AffectSpeedByZChange`)
 * - `src/roadveh_cmd.cpp` (`RoadVehicle::OnNewEconomyDay`, `RoadZPosAffectSpeed`)
 * - `src/ground_vehicle.hpp` & `src/ground_vehicle.cpp` (`GetSlopeResistance`, `CargoChanged`, `GetAcceleration`)
 */

export type VehicleOperatingState = 'moving' | 'loading' | 'stopped' | 'depot';
export type TransportNetworkKind = 'road' | 'rail';

/**
 * Classroom monthly running-cost multipliers by vehicle activity state, extending OpenTTD's
 * `running_ticks` accumulation (`train_cmd.cpp:4209,4296` and `roadveh_cmd.cpp:1665,1739`):
 * - `moving`:  100% (full traction fuel/electricity + crew)
 * - `loading`:  60% (station dwell / signal idling)
 * - `stopped`:  25% (manually stopped on line, standby crew upkeep)
 * - `depot`:    10% (parked inside depot, minimal storage maintenance)
 */
export const RUNNING_COST_STATE_MULTIPLIERS: Record<VehicleOperatingState, number> = {
  moving: 1.0,
  loading: 0.6,
  stopped: 0.25,
  depot: 0.1,
};

/**
 * OpenTTD Original-acceleration uphill per-Z-step speed retention constants:
 * - Rail (`train_cmd.cpp:3148,3165`): `z_up = 256 / 4 = 64` -> `(256 - 64) / 256 = 0.75` (-25% per grade step)
 * - Road (`roadveh_cmd.cpp:872`): `cur_speed * 232 / 256 = 0.90625` (~-9.4% per grade step)
 */
export const OPENTTD_RAIL_UPHILL_FACTOR = 192 / 256; // 0.75
export const OPENTTD_ROAD_UPHILL_FACTOR = 232 / 256; // 0.90625

export const MIN_RAIL_SLOPE_SPEED_FACTOR = 0.25;
export const MIN_ROAD_SLOPE_SPEED_FACTOR = 0.4;

/**
 * Vehicle monthly running cost (100% moving, 60% loading/waiting, 25% stopped, 10% in depot).
 * In OpenTTD (`OnNewEconomyDay`), annual running cost is prorated over `DAYS_IN_YEAR * DAY_TICKS`;
 * here it is prorated to monthly (`baseAnnualCostKr / 12`) times the operating state factor.
 */
export function calculateMonthlyRunningCost(
  baseAnnualCostKr: number,
  state: VehicleOperatingState
): number {
  if (baseAnnualCostKr <= 0 || !Number.isFinite(baseAnnualCostKr)) {
    return 0;
  }
  const factor = RUNNING_COST_STATE_MULTIPLIERS[state] ?? 1.0;
  return Math.max(0, Math.round((baseAnnualCostKr / 12) * factor));
}

/**
 * Terrain/slope speed multiplier based on OpenTTD uphill grade penalty:
 * - Uphill (`nextElev > currentElev`): rail is penalized more steeply (`0.75^delta` from
 *   `AffectSpeedByZChange`, `train_cmd.cpp:3165`) than road trucks (`(232/256)^delta` from
 *   `RoadZPosAffectSpeed`, `roadveh_cmd.cpp:872`).
 * - Flat (`nextElev === currentElev`): `1.0`.
 * - Downhill (`nextElev < currentElev`): capped at `1.0` of max vehicle speed, matching OpenTTD
 *   `if (spd <= cached_max_track_speed) cur_speed = spd` (`train_cmd.cpp:3168`, `roadveh_cmd.cpp:875`).
 */
export function calculateSlopeSpeedFactor(
  currentElev: number,
  nextElev: number,
  network: TransportNetworkKind
): number {
  if (!Number.isFinite(currentElev) || !Number.isFinite(nextElev)) {
    return 1.0;
  }

  const elevDelta = nextElev - currentElev;

  // Flat or downhill: slight downhill acceleration recovers lost uphill speed, capped at 1.0 * maxSpeed
  if (elevDelta <= 0) {
    return 1.0;
  }

  if (network === 'rail') {
    const factor = Math.pow(OPENTTD_RAIL_UPHILL_FACTOR, elevDelta);
    return Math.max(MIN_RAIL_SLOPE_SPEED_FACTOR, Number(factor.toFixed(4)));
  }

  const factor = Math.pow(OPENTTD_ROAD_UPHILL_FACTOR, elevDelta);
  return Math.max(MIN_ROAD_SLOPE_SPEED_FACTOR, Number(factor.toFixed(4)));
}
