import {
  CargoType,
  HQTierSpec,
  IndustryType,
  StationKind,
  ToolType,
  VehicleCatalogItem,
  VehicleModelId,
  WorldSetupConfig,
} from '../types/game';

export const ALL_CARGO_TYPES: CargoType[] = [
  'PASSENGERS',
  'MAIL',
  'COAL',
  'WOOD',
  'GOODS',
  'GRAIN',
  'FOOD',
];

export const CARGO_LABELS_NO: Record<CargoType, string> = {
  PASSENGERS: 'Passasjerer',
  MAIL: 'Post',
  COAL: 'Kull',
  WOOD: 'Tømmer',
  GOODS: 'Varer',
  GRAIN: 'Korn',
  FOOD: 'Matvarer',
};

export const INDUSTRY_LABELS_NO: Record<IndustryType, string> = {
  FOREST: 'Skogbruk',
  SAWMILL: 'Sagbruk',
  COAL_MINE: 'Kullgruve',
  POWER_PLANT: 'Kraftverk',
  FARM: 'Kornbruk',
  FOOD_PLANT: 'Matfabrikk',
};

export const COMPANY_COLORS: Record<string, string> = {
  player: '#2563eb', // Classic TTD Royal Blue
  'ai-1': '#dc2626', // Crimson Red (Nordic Rail & Cargo)
  'ai-2': '#d97706', // Amber Gold (FjordExpress AS)
  'ai-3': '#7c3aed', // Violet (Sørlandet Transport)
};

export const MULTIPLAYER_PLAYER_COLORS: string[] = [
  '#2563eb', // Royal Blue
  '#16a34a', // Emerald Green
  '#ea580c', // Tangelo Orange
  '#9333ea', // Amethyst Purple
  '#0891b2', // Fjord Cyan
  '#e11d48', // Rose Red
  '#ca8a04', // Nordic Gold
  '#4f46e5', // Indigo
];

export const DEFAULT_WORLD_SETUP: WorldSetupConfig = {
  mapSize: 64,
  gameMode: 'singleplayer',
  playersPerWorld: 1,
  aiEnabled: true,
  maxAiCount: 3,
  terrainType: 'hilly',
  waterLevel: 'medium',
  townDensity: 'normal',
  industryDensity: 'normal',
  startYear: 1950,
  scenario: 'standard',
  seed: 20261112,
};

export const BUILD_COSTS: Record<ToolType, number> = {
  SELECT: 0,
  ROAD: 2_500,
  RAIL: 4_500,
  ROAD_BRIDGE: 12_000,
  RAIL_BRIDGE: 18_000,
  ROAD_DEPOT: 35_000,
  RAIL_DEPOT: 55_000,
  BUS_STOP: 25_000,
  TRUCK_BAY: 30_000,
  TRAIN_STATION: 45_000,
  SIGNAL: 6_000,
  BULLDOZE: 1_500,
  PLACE_HQ: 25_000, // Paid strictly from Personal Cash
};

export const VEHICLE_CATALOG: Record<VehicleModelId, VehicleCatalogItem> = {
  BUS_CITY: {
    id: 'BUS_CITY',
    name: 'MPS / Scania Regal Bus',
    nameNo: 'MPS / Scania Regal Buss',
    network: 'ROAD',
    price: 65_000,
    wagonPrice: 0,
    maxSpeedKmh: 56,
    baseCapacity: 32,
    capacityPerWagon: 0,
    annualRunningCost: 13_200,
    runningCostPerWagon: 0,
    supportedCargos: ['PASSENGERS'],
    defaultCargo: 'PASSENGERS',
    description: 'Klassisk rutebuss for jevn lokal- og intercitytrafikk mellom byer.',
  },
  TRUCK_CARGO: {
    id: 'TRUCK_CARGO',
    name: 'Volvo Titan Cargo Truck',
    nameNo: 'Volvo Titan Lastebil',
    network: 'ROAD',
    price: 72_000,
    wagonPrice: 0,
    maxSpeedKmh: 54,
    baseCapacity: 25,
    capacityPerWagon: 0,
    annualRunningCost: 14_400,
    runningCostPerWagon: 0,
    supportedCargos: ['COAL', 'WOOD', 'GOODS', 'GRAIN', 'FOOD', 'MAIL'],
    defaultCargo: 'WOOD',
    description: 'Solid godslastebil som kan frakte råvarer, varer, mat og post.',
  },
  LOCO_STEAM: {
    id: 'LOCO_STEAM',
    name: 'NSB Type 26 Steam',
    nameNo: 'NSB Type 26 Damplok',
    network: 'RAIL',
    price: 230_000,
    wagonPrice: 32_000,
    maxSpeedKmh: 88,
    baseCapacity: 0,
    capacityPerWagon: 32,
    annualRunningCost: 54_000,
    runningCostPerWagon: 6_000,
    supportedCargos: ['COAL', 'WOOD', 'GOODS', 'GRAIN', 'FOOD', 'PASSENGERS', 'MAIL'],
    defaultCargo: 'COAL',
    description: 'Rimelig og sterkt damplokomotiv. Perfekt for tunge kull- og tømmerlinjer.',
  },
  LOCO_DIESEL: {
    id: 'LOCO_DIESEL',
    name: 'NSB Di 3 Nohab Diesel',
    nameNo: 'NSB Di 3 Diesellok',
    network: 'RAIL',
    price: 380_000,
    wagonPrice: 38_000,
    maxSpeedKmh: 128,
    baseCapacity: 0,
    capacityPerWagon: 38,
    annualRunningCost: 78_000,
    runningCostPerWagon: 7_200,
    supportedCargos: ['COAL', 'WOOD', 'GOODS', 'GRAIN', 'FOOD', 'PASSENGERS', 'MAIL'],
    defaultCargo: 'COAL',
    description: 'Kraftig diesellokomotiv med høy hastighet og stor trekkraft over lange avstander.',
  },
  LOCO_ELECTRIC: {
    id: 'LOCO_ELECTRIC',
    name: 'NSB El 18 Express',
    nameNo: 'NSB El 18 El-lok',
    network: 'RAIL',
    price: 560_000,
    wagonPrice: 44_000,
    maxSpeedKmh: 175,
    baseCapacity: 0,
    capacityPerWagon: 42,
    annualRunningCost: 102_000,
    runningCostPerWagon: 8_400,
    supportedCargos: ['PASSENGERS', 'MAIL', 'GOODS', 'FOOD', 'COAL', 'WOOD', 'GRAIN'],
    defaultCargo: 'PASSENGERS',
    description: 'Toppmodell ekspresslokomotiv. Maksimal fart gir høyest betaling for tidssensitiv last.',
  },
};

export const VEHICLE_CATALOG_LIST: VehicleCatalogItem[] = Object.values(VEHICLE_CATALOG);

export const HQ_TIERS: HQTierSpec[] = [
  {
    tier: 1,
    name: 'Small Wooden Shack',
    nameNo: 'Lite Trebrakke-kontor',
    personalCost: 25_000,
    loanInterestDiscountPct: 0.5,
    nearbyStationRatingBonusPct: 5,
    description: 'Enkelt oppstartskontor i tre. Gir -0,5 % lånerente og +5 % stasjonsrating i nærheten.',
  },
  {
    tier: 2,
    name: 'Brick Office',
    nameNo: 'Klassisk Mursteinskontor',
    personalCost: 100_000,
    loanInterestDiscountPct: 1.0,
    nearbyStationRatingBonusPct: 10,
    description: 'Solid mursteinsbygg som styrker bankens tillit (-1,0 % rente, +10 % lokal rating).',
  },
  {
    tier: 3,
    name: 'Modern Glass Building',
    nameNo: 'Moderne Glassbygg',
    personalCost: 300_000,
    loanInterestDiscountPct: 1.5,
    nearbyStationRatingBonusPct: 15,
    description: 'Moderne regionkontor i glass og stål (-1,5 % rente, +15 % lokal rating).',
  },
  {
    tier: 4,
    name: 'Corporate Tower',
    nameNo: 'Konserntårn',
    personalCost: 750_000,
    loanInterestDiscountPct: 2.0,
    nearbyStationRatingBonusPct: 20,
    description: 'Ruvende konsernbygg som tiltrekker stor trafikk (-2,0 % rente, +20 % lokal rating).',
  },
  {
    tier: 5,
    name: 'Iconic Skyscraper',
    nameNo: 'Ikonisk Skyskraper',
    personalCost: 1_800_000,
    loanInterestDiscountPct: 2.5,
    nearbyStationRatingBonusPct: 25,
    description: 'Et monumentalt landemerke med gullkrone (-2,5 % rente, +25 % lokal rating).',
  },
];

export const BASE_LOAN_INTEREST_RATE = 7.0;
export const LOAN_STEP_KR = 100_000;
export const DEFAULT_MAX_LOAN_KR = 5_000_000;
export const INITIAL_CORPORATE_CASH_KR = 2_000_000;
export const INITIAL_CORPORATE_LOAN_KR = 2_000_000;
export const INITIAL_PERSONAL_CASH_KR = 30_000;
export const INITIAL_MONTHLY_GROSS_SALARY_KR = 30_000;
export const MAX_MONTHLY_GROSS_SALARY_KR = 150_000;

export const STATION_CATCHMENT_RADIUS = 4;
export const ROAD_STATION_CATCHMENT_RADIUS = 3;
export const RAIL_STATION_CATCHMENT_RADIUS = 4;
export const HQ_BONUS_RADIUS = 18;
export const TOTAL_AI_SHARES = 10_000;
export const MAX_PLAYER_AI_SHARE_PCT = 75;
export const AI_SHARE_BLOCK_PCT = 10;

export function getStationCatchmentRadius(kind: StationKind): number {
  return kind === 'TRAIN_STATION'
    ? RAIL_STATION_CATCHMENT_RADIUS
    : ROAD_STATION_CATCHMENT_RADIUS;
}

export function calculateVehiclePurchaseCost(
  modelId: VehicleModelId,
  wagonCount = 3
): number {
  const spec = VEHICLE_CATALOG[modelId];
  if (spec.network === 'ROAD') {
    return spec.price;
  }
  const clampedWagons = Math.max(1, Math.min(6, Math.round(wagonCount)));
  return spec.price + spec.wagonPrice * clampedWagons;
}

export function calculateVehicleCapacity(
  modelId: VehicleModelId,
  wagonCount = 3
): number {
  const spec = VEHICLE_CATALOG[modelId];
  if (spec.network === 'ROAD') {
    return spec.baseCapacity;
  }
  const clampedWagons = Math.max(1, Math.min(6, Math.round(wagonCount)));
  return spec.baseCapacity + spec.capacityPerWagon * clampedWagons;
}

export function calculateVehicleBaseAnnualCost(
  modelId: VehicleModelId,
  wagonCount = 3
): number {
  const spec = VEHICLE_CATALOG[modelId];
  if (spec.network === 'ROAD') {
    return spec.annualRunningCost;
  }
  const clampedWagons = Math.max(1, Math.min(6, Math.round(wagonCount)));
  return spec.annualRunningCost + spec.runningCostPerWagon * clampedWagons;
}

export function getHQTierSpec(tier: number): HQTierSpec | undefined {
  return HQ_TIERS.find((t) => t.tier === tier);
}

export function getHQCumulativeValue(tier: number): number {
  let sum = 0;
  for (const item of HQ_TIERS) {
    if (item.tier <= tier) {
      sum += item.personalCost;
    }
  }
  return sum;
}

export function createEmptyCargoRecord(): Record<CargoType, number> {
  return {
    PASSENGERS: 0,
    MAIL: 0,
    COAL: 0,
    WOOD: 0,
    GOODS: 0,
    GRAIN: 0,
    FOOD: 0,
  };
}

export function createInitialRatingsRecord(): Record<CargoType, number> {
  return {
    PASSENGERS: 0,
    MAIL: 0,
    COAL: 0,
    WOOD: 0,
    GOODS: 0,
    GRAIN: 0,
    FOOD: 0,
  };
}

export function formatNorwegianNumber(value: number): string {
  const rounded = Math.round(value);
  const absStr = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return rounded < 0 ? `-${absStr}` : absStr;
}

export function formatKr(value: number): string {
  return `${formatNorwegianNumber(value)} kr`;
}

export const MONTHS_NO = [
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

export function formatGameDate(
  day: number,
  month: number,
  year: number,
  calendarYear?: number
): string {
  const monthLabel = MONTHS_NO[Math.max(0, Math.min(11, month - 1))] ?? 'jan';
  if (typeof calendarYear === 'number' && calendarYear >= 1800) {
    return `${day}. ${monthLabel} ${calendarYear}`;
  }
  return `${day}. ${monthLabel} År ${year}`;
}
