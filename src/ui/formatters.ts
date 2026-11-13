import type {
  CargoType,
  GameDate,
  IndustryType,
  ScenarioType,
  StationKind,
  TaxBreakdown,
  ToolType,
  VehicleState,
} from '../types/game';

const MONTHS_NO = [
  'jan',
  'feb',
  'mar',
  'apr',
  'mai',
  'jun',
  'jul',
  'aug',
  'sep',
  'okt',
  'nov',
  'des',
];

export function formatNumber(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  const absStr = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return rounded < 0 ? `-${absStr}` : absStr;
}

export function formatKr(value: number, showPlus = false): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  const absStr = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (rounded < 0) return `-${absStr} kr`;
  if (rounded > 0 && showPlus) return `+${absStr} kr`;
  return `${absStr} kr`;
}

export function formatGameDate(date: GameDate): string {
  const mIndex = Math.max(0, Math.min(11, (date.month ?? 1) - 1));
  const day = Math.max(1, Math.min(31, date.day ?? 1));
  const year = Math.max(1, date.year ?? 1);
  const calYear = (date as GameDate & { calendarYear?: number }).calendarYear;
  if (typeof calYear === 'number' && calYear >= 1800) {
    return `${day}. ${MONTHS_NO[mIndex]} ${calYear} (År ${year})`;
  }
  return `${day}. ${MONTHS_NO[mIndex]} År ${year}`;
}

export const CARGO_LABELS_NO: Record<CargoType, string> = {
  PASSENGERS: 'Passasjerer',
  MAIL: 'Post',
  COAL: 'Kull',
  WOOD: 'Tømmer',
  GOODS: 'Varer',
  GRAIN: 'Korn',
  FOOD: 'Matvarer',
};

export const CARGO_COLORS: Record<CargoType, string> = {
  PASSENGERS: '#60a5fa',
  MAIL: '#fbbf24',
  COAL: '#94a3b8',
  WOOD: '#b45309',
  GOODS: '#a78bfa',
  GRAIN: '#eab308',
  FOOD: '#34d399',
};

export const CARGO_UNITS_NO: Record<CargoType, string> = {
  PASSENGERS: 'pass.',
  MAIL: 'sekker',
  COAL: 'tonn',
  WOOD: 'tonn',
  GOODS: 'kasser',
  GRAIN: 'tonn',
  FOOD: 'tonn',
};

export const INDUSTRY_LABELS_NO: Record<IndustryType, string> = {
  FOREST: 'Skogbruk',
  SAWMILL: 'Sagbruk',
  COAL_MINE: 'Kullgruve',
  POWER_PLANT: 'Kraftverk',
  FARM: 'Kornbonde / Gård',
  FOOD_PLANT: 'Matfabrikk',
};

export const STATION_KIND_LABELS_NO: Record<StationKind, string> = {
  TRAIN_STATION: 'Togstasjon',
  BUS_STOP: 'Bussholdeplass',
  TRUCK_BAY: 'Lasteterminal (Bil)',
};

export const VEHICLE_STATE_LABELS_NO: Record<VehicleState, string> = {
  MOVING: 'I fart',
  LOADING: 'Laster / losser',
  WAITING_SIGNAL: 'Venter på grønt signal',
  STOPPED: 'Stoppet',
  IN_DEPOT: 'I depot',
};

export const TOOL_LABELS_NO: Record<ToolType, string> = {
  SELECT: 'Inspeksjon / Velg',
  RAIL: 'Bygg jernbanespor (dra på kartet)',
  ROAD: 'Bygg vei (dra på kartet)',
  RAIL_BRIDGE: 'Bygg jernbanebru (dra rett over vann fra bredd til bredd)',
  ROAD_BRIDGE: 'Bygg veibru (dra rett over vann fra bredd til bredd)',
  RAIL_DEPOT: 'Plasser togdepot',
  ROAD_DEPOT: 'Plasser bildepot',
  TRAIN_STATION: 'Plasser togstasjon',
  BUS_STOP: 'Plasser bussholdeplass',
  TRUCK_BAY: 'Plasser lasteterminal',
  SIGNAL: 'Plasser blokksignal på jernbane',
  BULLDOZE: 'Riv / Bulldoser',
  PLACE_HQ: 'Plasser hovedkontor (betales privat!)',
};

export const TERRAIN_TYPE_LABELS_NO: Record<'flat' | 'hilly' | 'mountainous', string> = {
  flat: 'Flatt lavland',
  hilly: 'Bølgende åser',
  mountainous: 'Norsk fjellterreng',
};

export const WATER_LEVEL_LABELS_NO: Record<'very_low' | 'low' | 'medium' | 'high', string> = {
  very_low: 'Svært lite',
  low: 'Lite',
  medium: 'Middels',
  high: 'Mye vann & øyer (Mange bruer)',
};

export const DENSITY_LABELS_NO: Record<'low' | 'normal' | 'high', string> = {
  low: 'Få',
  normal: 'Normalt',
  high: 'Mange',
};

export const SCENARIO_LABELS_NO: Record<
  ScenarioType,
  { title: string; subtitle: string }
> = {
  standard: {
    title: 'Standard (Klasserom)',
    subtitle: '2 000 000 kr i startlån, balansert norsk økonomi og normal vekst.',
  },
  boom: {
    title: 'Høykonjunktur (Boom)',
    subtitle: 'Høy industriproduksjon og raskere byvekst for raske ruter.',
  },
  challenge: {
    title: 'Utfordring (Stram likviditet)',
    subtitle: 'Høyere rentepress og tøffere kostnader – krever smart ruteplanlegging!',
  },
};

/**
 * Exact progressive personal income tax + 14.1% employer payroll tax preview
 * Matches OpenTTD/SimCore classroom formula:
 * - Trinn 1 (0 – 25 000 kr): 20%
 * - Trinn 2 (25 001 – 50 000 kr): 30%
 * - Trinn 3 (Over 50 000 kr): 42%
 * - Arbeidsgiveravgift (betales av AS): 14.1%
 */
export function previewProgressiveTax(grossMonthlySalary: number): TaxBreakdown {
  const gross = Math.max(0, Math.round(grossMonthlySalary));
  const b1Taxable = Math.min(gross, 25000);
  const b2Taxable = Math.max(0, Math.min(gross, 50000) - 25000);
  const b3Taxable = Math.max(0, gross - 50000);

  const bracket1Tax = Math.round(b1Taxable * 0.2);
  const bracket2Tax = Math.round(b2Taxable * 0.3);
  const bracket3Tax = Math.round(b3Taxable * 0.42);
  const totalIncomeTax = bracket1Tax + bracket2Tax + bracket3Tax;
  const netPersonalPay = gross - totalIncomeTax;
  const employerPayrollTax = Math.round(gross * 0.141);
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
