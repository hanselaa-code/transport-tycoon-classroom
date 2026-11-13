export type CargoType =
  | 'PASSENGERS'
  | 'MAIL'
  | 'COAL'
  | 'WOOD'
  | 'GOODS'
  | 'GRAIN'
  | 'FOOD';

export type IndustryType =
  | 'FOREST'
  | 'SAWMILL'
  | 'COAL_MINE'
  | 'POWER_PLANT'
  | 'FARM'
  | 'FOOD_PLANT';

export type ToolType =
  | 'SELECT'
  | 'RAIL'
  | 'ROAD'
  | 'RAIL_BRIDGE'
  | 'ROAD_BRIDGE'
  | 'RAIL_DEPOT'
  | 'ROAD_DEPOT'
  | 'TRAIN_STATION'
  | 'BUS_STOP'
  | 'TRUCK_BAY'
  | 'SIGNAL'
  | 'BULLDOZE'
  | 'PLACE_HQ';

export type GameSpeed = 0 | 1 | 2 | 4;

export type VehicleModelId =
  | 'BUS_CITY'
  | 'TRUCK_CARGO'
  | 'LOCO_STEAM'
  | 'LOCO_DIESEL'
  | 'LOCO_ELECTRIC';

export type ScenarioType = 'standard' | 'boom' | 'challenge';

export type MapSizeOption = 64 | 96 | 128 | 160;

export type WorldTerrainType = 'flat' | 'hilly' | 'mountainous';

export type WaterLevelType = 'very_low' | 'low' | 'medium' | 'high';

export type DensityType = 'low' | 'normal' | 'high';

export interface WorldSetupConfig {
  mapSize: MapSizeOption;
  gameMode: 'singleplayer' | 'multiplayer';
  playersPerWorld: number;
  aiEnabled: boolean;
  maxAiCount: 0 | 1 | 2 | 3;
  terrainType: WorldTerrainType;
  waterLevel: WaterLevelType;
  townDensity: DensityType;
  industryDensity: DensityType;
  startYear: number;
  scenario: ScenarioType;
  seed: number;
}

export type DemoRouteType = 'coal_rail' | 'wood_truck' | 'bus_line';

export type TerrainType = 'WATER' | 'SAND' | 'GRASS' | 'FOREST_TREES';

export type BridgeType = 'WOOD' | 'STEEL' | 'MODERN';

export interface BridgeSpec {
  id: BridgeType;
  nameNo: string;
  qualityLabelNo: string;
  descriptionNo: string;
  roadCostPerTile: number;
  railCostPerTile: number;
  maxSpeedKmh: number;
}

export interface Tile {
  x: number;
  y: number;
  elevation: number;
  terrain: TerrainType;
  road: boolean;
  rail: boolean;
  signal: boolean;
  signalBlocked?: boolean;
  bridge?: 'ROAD' | 'RAIL' | null;
  bridgeAxis?: 'X' | 'Y';
  bridgeType?: BridgeType | null;
  bridgeElevation?: number;
  depot?: 'ROAD' | 'RAIL' | null;
  stationId?: string | null;
  townId?: string | null;
  industryId?: string | null;
  hqOwnerId?: string | null;
  hqOwnerTier?: number;
  ownerId?: string | null;
  buildingTier?: number;
}

export interface Town {
  id: string;
  name: string;
  x: number;
  y: number;
  population: number;
  growthCounter: number;
  monthlyPassengers: number;
  monthlyMail: number;
  servicedStations: number;
  deliveredPassengersThisMonth?: number;
  deliveredMailThisMonth?: number;
  deliveredGoodsOrFoodThisMonth?: number;
}

export interface Industry {
  id: string;
  name: string;
  type: IndustryType;
  x: number;
  y: number;
  width: number;
  height: number;
  produces: CargoType | null;
  accepts: CargoType[];
  monthlyProduction: number;
  storedOutput: number;
}

export type StationKind = 'TRAIN_STATION' | 'BUS_STOP' | 'TRUCK_BAY';

export interface Station {
  id: string;
  name: string;
  ownerId: string;
  kind: StationKind;
  x: number;
  y: number;
  tiles: Array<{ x: number; y: number }>;
  townId: string | null;
  nearbyIndustryIds: string[];
  waitingCargo: Record<CargoType, number>;
  ratings: Record<CargoType, number>;
  daysSincePickup: number;
  lastVehicleMaxSpeedKmh?: number;
}

export type VehicleState =
  | 'MOVING'
  | 'LOADING'
  | 'WAITING_SIGNAL'
  | 'STOPPED'
  | 'IN_DEPOT';

export interface Vehicle {
  id: string;
  name: string;
  ownerId: string;
  network: 'ROAD' | 'RAIL';
  modelId: VehicleModelId;
  cargoType: CargoType;
  capacity: number;
  cargoAmount: number;
  cargoOriginStationId: string | null;
  cargoLoadedDay: number;
  x: number;
  y: number;
  nextX: number;
  nextY: number;
  progress: number;
  direction: number;
  speedKmh: number;
  maxSpeedKmh: number;
  state: VehicleState;
  orders: string[];
  currentOrderIndex: number;
  path: Array<{ x: number; y: number }>;
  profitThisYear: number;
  runningCostPerMonth: number;
  purchaseValue: number;
  ageMonths: number;
  wagonCount: number;
  trail?: Array<{ x: number; y: number }>;
  depotX?: number;
  depotY?: number;
  loadingTicksRemaining?: number;
  waitForFullLoad?: boolean;
  accelTicks?: number;
  fullLoadWaitTicks?: number;
}

export interface FloatingPopup {
  id: string;
  x: number;
  y: number;
  text: string;
  color: 'green' | 'red' | 'amber';
  createdAtMs: number;
}

export interface PnLStatement {
  year: number;
  freightRevenue: number;
  constructionCost: number;
  vehiclePurchaseCost: number;
  vehicleRunningCost: number;
  loanInterestCost: number;
  ownerSalaryCost: number;
  employerPayrollTaxCost: number;
}

export interface CorporateFinance {
  companyName: string;
  playerColor?: string;
  cash: number;
  loan: number;
  maxLoan: number;
  annualInterestRate: number;
  hqTier: number;
  hqTile: { x: number; y: number } | null;
  currentYearPnL: PnLStatement;
  lastYearPnL: PnLStatement;
  companyValue: number;
  isBankruptWarning: boolean;
}

export interface TaxBreakdown {
  gross: number;
  bracket1Tax: number;
  bracket2Tax: number;
  bracket3Tax: number;
  totalIncomeTax: number;
  netPersonalPay: number;
  employerPayrollTax: number;
  totalCorporateCost: number;
}

export interface PersonalFinance {
  ownerName: string;
  cash: number;
  monthlyGrossSalary: number;
  nextMonthGrossSalary: number;
  lifetimeTaxPaid: number;
  lastMonthTaxBreakdown: TaxBreakdown;
  portfolio: Record<string, number>;
  dividendsReceivedTotal: number;
  realizedGainsTotal: number;
  personalNetWorth: number;
}

export interface AICompany {
  id: string;
  name: string;
  color: string;
  spawnMonth: number;
  spawned: boolean;
  cash: number;
  loan: number;
  fleetCount: number;
  annualProfit: number;
  companyValue: number;
  sharePrice: number;
  sharePriceHistory: number[];
  dividendPerQuarter: number;
  playerSharesPct: number;
  routeSummary: string;
}

export interface NewsItem {
  id: string;
  dateLabel: string;
  text: string;
  category: 'INFO' | 'ECONOMY' | 'COMPETITOR' | 'WARNING';
}

export interface VehicleCatalogItem {
  id: VehicleModelId;
  name: string;
  nameNo: string;
  network: 'ROAD' | 'RAIL';
  price: number;
  wagonPrice: number;
  maxSpeedKmh: number;
  baseCapacity: number;
  capacityPerWagon: number;
  annualRunningCost: number;
  runningCostPerWagon: number;
  supportedCargos: CargoType[];
  defaultCargo: CargoType;
  description: string;
}

export interface HQTierSpec {
  tier: number;
  name: string;
  nameNo: string;
  personalCost: number;
  loanInterestDiscountPct: number;
  nearbyStationRatingBonusPct: number;
  description: string;
}

export interface GameDate {
  day: number;
  month: number;
  year: number;
  calendarYear?: number;
  totalDays: number;
  totalMonths: number;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  stationId?: string;
  vehicleId?: string;
  cost?: number;
}

export interface BuyVehicleParams {
  depotX: number;
  depotY: number;
  modelId: VehicleModelId;
  cargoType?: CargoType;
  wagonCount?: number;
  orders?: string[];
  waitForFullLoad?: boolean;
}

export interface TileInspectionInfo {
  x: number;
  y: number;
  terrain: TerrainType;
  terrainLabelNo: string;
  elevation: number;
  slopeLabelNo: string;
  isSloped: boolean;
  road: boolean;
  rail: boolean;
  signal: boolean;
  bridge?: 'ROAD' | 'RAIL' | null;
  bridgeAxis?: 'X' | 'Y' | null;
  bridgeType?: BridgeType | null;
  bridgeElevation?: number | null;
  bridgeMaxSpeedKmh?: number | null;
  bridgeQualityNo?: string | null;
  depot: 'ROAD' | 'RAIL' | null;
  hqTier: number | null;
  ownerId: string | null;
  ownerName: string;
  townId: string | null;
  townName: string | null;
  buildingTier: number;
  industryId: string | null;
  industryName: string | null;
  industryType: IndustryType | null;
  stationId: string | null;
  stationName: string | null;
  stationKind: StationKind | null;
  waitingCargo: Record<CargoType, number> | null;
  accepts: CargoType[];
  produces: CargoType[];
  descriptionNo: string;
}

export interface StationDetailsInfo {
  station: Station;
  ownerId: string;
  ownerName: string;
  ownerColor: string;
  isPlayerOwned: boolean;
  suppliedCargos: CargoType[];
  acceptedCargos: Array<{ cargo: CargoType; sourceName: string }>;
  servicingVehicles: Vehicle[];
  hqBonusPct: number;
}

export interface ModifiedTileDelta {
  x: number;
  y: number;
  road?: boolean;
  rail?: boolean;
  signal?: boolean;
  bridge?: 'ROAD' | 'RAIL' | null;
  bridgeAxis?: 'X' | 'Y';
  bt?: BridgeType;
  be?: number;
  depot?: 'ROAD' | 'RAIL' | null;
  stationId?: string | null;
  hqOwnerId?: string | null;
  hqOwnerTier?: number;
}

export interface RemotePlayerWorldSlice {
  clientId: string;
  ownerName: string;
  companyName: string;
  color: string;
  cash: number;
  companyValue: number;
  annualProfit: number;
  hqTile: { x: number; y: number } | null;
  hqTier: number;
  modifiedTiles: ModifiedTileDelta[];
  stations: Station[];
  vehicles: Vehicle[];
  updatedAt?: number;
}

export interface LocalPlayerIdentity {
  clientId: string;
  ownerName: string;
  companyName: string;
  playerColor: string;
}

export interface GameState {
  mapSize: number;
  tiles: Tile[];
  towns: Town[];
  industries: Industry[];
  stations: Station[];
  vehicles: Vehicle[];
  popups: FloatingPopup[];
  date: GameDate;
  speed: GameSpeed;
  corporate: CorporateFinance;
  personal: PersonalFinance;
  aiCompanies: AICompany[];
  news: NewsItem[];
  scenario: ScenarioType;
  worldSetup?: WorldSetupConfig;
  remotePlayers?: RemotePlayerWorldSlice[];
  networkRevision?: number;
  lastSavedAtMs?: number | null;
}
