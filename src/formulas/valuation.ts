/**
 * OpenTTD Company Valuation & Norwegian Dual-Economy Tax Mechanics
 *
 * Derived from:
 * - Official OpenTTD `src/economy.cpp` (`CalculateCompanyAssetValue`, `CalculateCompanyValue`, `CalculateHostileTakeoverValue`)
 * - Classroom Norwegian Dual-Economy Tax Model (Skatt + Arbeidsgiveravgift 14.1%)
 */

export interface CompanyValuationParams {
  cash: number;
  loan: number;
  fleetBookValue: number;
  infrastructureCount: number;
  annualProfit: number;
}

export interface ProgressiveTaxBreakdown {
  gross: number;
  bracket1Tax: number;
  bracket2Tax: number;
  bracket3Tax: number;
  totalIncomeTax: number;
  netPersonalPay: number;
  employerPayrollTax: number;
  totalCorporateCost: number;
}

/**
 * Calibrated asset valuation per owned infrastructure element (track/road/station/depot tile),
 * mirroring OpenTTD `num * _price[Price::StationValue] * 25` (`src/economy.cpp:128`).
 */
export const INFRASTRUCTURE_UNIT_VALUE_KR = 15_000;

/**
 * OpenTTD `CalculateHostileTakeoverValue` (`src/economy.cpp:191`) values positive annual profit
 * at a 2.0x forward earnings multiple when pricing company equity / shares.
 */
export const VALUATION_PROFIT_MULTIPLE = 2.0;

/**
 * Minimum company valuation floor matching OpenTTD `std::max<Money>(value, 1)` (`src/economy.cpp:161,194`).
 */
export const MIN_COMPANY_VALUATION_KR = 1;

/**
 * Simplified Norwegian Progressive Income Tax (Skatt) & Employer Payroll Tax (Arbeidsgiveravgift) constants.
 */
export const TAX_BRACKET_1_LIMIT_KR = 25_000;
export const TAX_BRACKET_2_LIMIT_KR = 50_000;

export const TAX_BRACKET_1_RATE = 0.2;  // 20% on 0 - 25 000 kr/mnd
export const TAX_BRACKET_2_RATE = 0.3;  // 30% on 25 001 - 50 000 kr/mnd
export const TAX_BRACKET_3_RATE = 0.42; // 42% above 50 000 kr/mnd

export const EMPLOYER_PAYROLL_TAX_RATE = 0.141; // 14.1% Arbeidsgiveravgift (Sone 1 standard)

/**
 * Company Valuation & AI Share Price helper combining OpenTTD `CalculateCompanyValue`
 * (`src/economy.cpp:153-162`) and `CalculateHostileTakeoverValue` (`src/economy.cpp:180-195`):
 * - Net liquid position: `cash - loan`
 * - Depreciated vehicle fleet value: `fleetBookValue`
 * - Infrastructure network value: `infrastructureCount * 15 000 kr`
 * - Earnings power: `max(0, annualProfit) * 2`
 * Floored at `1 kr` per OpenTTD `std::max<Money>(value, 1)`.
 */
export function calculateCompanyValuation(params: CompanyValuationParams): number {
  const safeCash = Number.isFinite(params.cash) ? params.cash : 0;
  const safeLoan = Math.max(0, Number.isFinite(params.loan) ? params.loan : 0);
  const safeFleet = Math.max(
    0,
    Number.isFinite(params.fleetBookValue) ? params.fleetBookValue : 0
  );
  const safeInfraCount = Math.max(
    0,
    Number.isFinite(params.infrastructureCount) ? params.infrastructureCount : 0
  );
  const safeProfit = Number.isFinite(params.annualProfit) ? params.annualProfit : 0;

  const netCash = safeCash - safeLoan;
  const infraValue = safeInfraCount * INFRASTRUCTURE_UNIT_VALUE_KR;
  const profitMultipleValue = Math.max(0, safeProfit) * VALUATION_PROFIT_MULTIPLE;

  const rawValuation = netCash + safeFleet + infraValue + profitMultipleValue;
  return Math.max(MIN_COMPANY_VALUATION_KR, Math.round(rawValuation));
}

/**
 * Simplified Norwegian Progressive Income Tax (Skatt) + Employer Payroll Tax (Arbeidsgiveravgift 14.1%):
 * - Bracket 1 (`0 – 25 000 kr/mnd`): `20%`
 * - Bracket 2 (`25 001 – 50 000 kr/mnd`): `30%` on bracket
 * - Bracket 3 (`Over 50 000 kr/mnd`): `42%` on bracket
 *
 * Verification check (`gross = 60 000 kr`):
 * - `bracket1Tax = 5 000 kr`
 * - `bracket2Tax = 7 500 kr`
 * - `bracket3Tax = 4 200 kr`
 * - `totalIncomeTax = 16 700 kr`
 * - `netPersonalPay = 43 300 kr`
 * - `employerPayrollTax = 8 460 kr`
 * - `totalCorporateCost = 68 460 kr`
 */
export function calculateProgressiveTax(
  grossMonthlySalary: number
): ProgressiveTaxBreakdown {
  const gross = Math.max(
    0,
    Math.round(Number.isFinite(grossMonthlySalary) ? grossMonthlySalary : 0)
  );

  const taxableBracket1 = Math.min(gross, TAX_BRACKET_1_LIMIT_KR);
  const taxableBracket2 = Math.max(
    0,
    Math.min(gross, TAX_BRACKET_2_LIMIT_KR) - TAX_BRACKET_1_LIMIT_KR
  );
  const taxableBracket3 = Math.max(0, gross - TAX_BRACKET_2_LIMIT_KR);

  const bracket1Tax = Math.round(taxableBracket1 * TAX_BRACKET_1_RATE);
  const bracket2Tax = Math.round(taxableBracket2 * TAX_BRACKET_2_RATE);
  const bracket3Tax = Math.round(taxableBracket3 * TAX_BRACKET_3_RATE);

  const totalIncomeTax = bracket1Tax + bracket2Tax + bracket3Tax;
  const netPersonalPay = gross - totalIncomeTax;
  const employerPayrollTax = Math.round(gross * EMPLOYER_PAYROLL_TAX_RATE);
  const totalCorporateCost = gross + employerPayrollTax;

  return {
    gross,
    bracket1Tax,
    bracket2Tax,
    bracket3Tax,
    totalIncomeTax,
    netPersonalPay,
    employerPayrollTax,
    totalCorporateCost,
  };
}
