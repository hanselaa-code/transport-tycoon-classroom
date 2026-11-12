/**
 * Public Barrel for OpenTTD Simulation & Dual-Economy Formulas (`src/formulas/`)
 * Zero external dependencies; deterministic pure functions.
 */

export {
  type FormulaCargoType,
  type CargoSpec,
  OPENTTD_MAX_TIME_FACTOR,
  OPENTTD_MIN_TIME_FACTOR,
  OPENTTD_MAX_STATION_RATING,
  OPENTTD_INITIAL_STATION_RATING,
  CARGO_SPECS,
  SECONDARY_INDUSTRY_CONVERSION,
  calculateCargoTimeFactor,
  calculateCargoPayment,
  calculateStationRating,
  calculateSecondaryIndustryOutput,
} from './economy';

export {
  type VehicleOperatingState,
  type TransportNetworkKind,
  RUNNING_COST_STATE_MULTIPLIERS,
  OPENTTD_RAIL_UPHILL_FACTOR,
  OPENTTD_ROAD_UPHILL_FACTOR,
  MIN_RAIL_SLOPE_SPEED_FACTOR,
  MIN_ROAD_SLOPE_SPEED_FACTOR,
  calculateMonthlyRunningCost,
  calculateSlopeSpeedFactor,
} from './vehicles';

export {
  OPENTTD_TOWN_GROW_TICKS_BY_STATIONS,
  MAX_EFFECTIVE_TOWN_STATIONS,
  calculateTownGrowthDelta,
} from './towns';

export {
  type CompanyValuationParams,
  type ProgressiveTaxBreakdown,
  INFRASTRUCTURE_UNIT_VALUE_KR,
  VALUATION_PROFIT_MULTIPLE,
  MIN_COMPANY_VALUATION_KR,
  TAX_BRACKET_1_LIMIT_KR,
  TAX_BRACKET_2_LIMIT_KR,
  TAX_BRACKET_1_RATE,
  TAX_BRACKET_2_RATE,
  TAX_BRACKET_3_RATE,
  EMPLOYER_PAYROLL_TAX_RATE,
  calculateCompanyValuation,
  calculateProgressiveTax,
} from './valuation';
