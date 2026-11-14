import {
  calculateCargoPayment,
  calculateSecondaryIndustryOutput,
  calculateSlopeSpeedFactor,
} from '../formulas';
import {
  ActionResult,
  BridgeType,
  BuyVehicleParams,
  CargoType,
  DemoRouteType,
  DepotStoredWagon,
  FloatingPopup,
  GameSpeed,
  GameState,
  LocalPlayerIdentity,
  MapSizeOption,
  ModifiedTileDelta,
  RemotePlayerWorldSlice,
  RemoteStationSnapshot,
  RemoteVehicleSnapshot,
  ScenarioType,
  Station,
  StationDetailsInfo,
  StationKind,
  StationPlacementPreview,
  Tile,
  TileInspectionInfo,
  ToolType,
  TrainWagon,
  Vehicle,
  VehicleModelId,
  WorldSetupConfig,
} from '../types/game';
import {
  buildConnectedRoute,
  createInitialAICompanies,
  runMonthlyAICompetitorsTick,
} from './aiCompetitors';
import {
  ALL_CARGO_TYPES,
  BRIDGE_CATALOG,
  BUILD_COSTS,
  calculateVehicleBaseAnnualCost,
  calculateVehicleCapacity,
  calculateVehiclePurchaseCost,
  CARGO_LABELS_NO,
  COMPANY_COLORS,
  createEmptyCargoRecord,
  createInitialRatingsRecord,
  DEFAULT_WORLD_SETUP,
  formatGameDate,
  formatKr,
  formatNorwegianNumber,
  getEffectiveStationPlatformLength,
  getEffectiveStationTracks,
  getHQTierSpec,
  getStationCatchmentRadius,
  getTrainRequiredPlatformTiles,
  INDUSTRY_LABELS_NO,
  MAX_STATION_LENGTH,
  MAX_STATION_TRACKS,
  MAX_TRAIN_WAGONS,
  RAIL_WAGON_CATALOG,
  ROAD_REFIT_COST_KR,
  ROAD_VEHICLE_SHOP_LIST,
  VEHICLE_CATALOG,
} from './catalog';
import {
  adjustCorporateLoan,
  buyAICompanyShares,
  calculatePnLOperatingProfit,
  createInitialCorporateFinance,
  createInitialPersonalFinance,
  distributePeriodicCargoOutput,
  doesStationAcceptCargo,
  doesStationCatchmentProduceCargo,
  getStationAcceptedCargosWithSources,
  getStationHQBonusPct,
  getStationSuppliedCargos,
  payQuarterlyDividends,
  placeHQAtTile,
  pushNews,
  recomputeValuationsAndWarnings,
  refreshStationCatchment,
  runMonthlyEconomyTick,
  runYearlyRolloverTick,
  seedInitialStationCargo,
  sellAICompanyShares,
  setOwnerGrossSalary,
  updateStationRatings,
  upgradeCorporateHQ,
} from './dualEconomy';
import {
  expandTownBuildings,
  generateWorld,
  inBounds,
  tileIndex,
} from './mapGenerator';
import {
  canTrainEnterNextTile,
  computeDragLineTiles,
  findNetworkPath,
  getEffectiveTrackElevation,
  getOccupiedRailTileSet,
  GridPoint,
  isTileTraversableForNetwork,
  refreshSignalLampStates,
} from './pathfinder';
import {
  clearSavedStateInLocalStorage,
  deserializeGameState,
  hasSavedStateInLocalStorage,
  loadStateFromLocalStorage,
  saveStateToLocalStorage,
  serializeGameState,
} from './saveManager';

const SUBTICKS_PER_GAME_DAY = 14;
const POPUP_LIFETIME_MS = 2600;
const FULL_LOAD_MAX_WAIT_SUBTICKS = 120;

export type DragTrackTool = 'RAIL' | 'ROAD' | 'RAIL_BRIDGE' | 'ROAD_BRIDGE';

export interface DragPreviewResult {
  ok: boolean;
  tiles: Array<{ x: number; y: number }>;
  cost: number;
  bridgeTileCount: number;
  reason?: string;
}

export interface ApplyToolOptions {
  stationTracks?: number;
  stationLength?: number;
  orientation?: 'X' | 'Y';
  bridgeType?: BridgeType;
}

export interface GameEngineOptions {
  mapSize?: number;
  scenario?: ScenarioType;
  seed?: number;
  worldSetup?: Partial<WorldSetupConfig>;
  autoLoadFromStorage?: boolean;
}

function normalizeMapSizeOption(raw: number | undefined): MapSizeOption {
  if (!raw || raw <= 64) return 64;
  if (raw <= 96) return 96;
  if (raw <= 128) return 128;
  return 160;
}

export function resolveWorldSetup(
  setup?: Partial<WorldSetupConfig>,
  fallbackScenario?: ScenarioType,
  fallbackMapSize?: number,
  fallbackSeed?: number
): WorldSetupConfig {
  const mapSize = normalizeMapSizeOption(setup?.mapSize ?? fallbackMapSize ?? DEFAULT_WORLD_SETUP.mapSize);
  const aiEnabled = setup?.aiEnabled ?? DEFAULT_WORLD_SETUP.aiEnabled;
  const rawMaxAi = setup?.maxAiCount ?? (aiEnabled ? DEFAULT_WORLD_SETUP.maxAiCount : 0);
  const maxAiCount = (!aiEnabled ? 0 : Math.max(0, Math.min(3, Math.round(rawMaxAi)))) as 0 | 1 | 2 | 3;

  return {
    mapSize,
    gameMode: setup?.gameMode ?? DEFAULT_WORLD_SETUP.gameMode,
    playersPerWorld: Math.max(1, Math.min(8, Math.round(setup?.playersPerWorld ?? DEFAULT_WORLD_SETUP.playersPerWorld))),
    aiEnabled,
    maxAiCount,
    terrainType: setup?.terrainType ?? DEFAULT_WORLD_SETUP.terrainType,
    waterLevel: setup?.waterLevel ?? DEFAULT_WORLD_SETUP.waterLevel,
    townDensity: setup?.townDensity ?? DEFAULT_WORLD_SETUP.townDensity,
    industryDensity: setup?.industryDensity ?? DEFAULT_WORLD_SETUP.industryDensity,
    startYear: Math.max(1900, Math.min(2100, Math.round(setup?.startYear ?? DEFAULT_WORLD_SETUP.startYear))),
    scenario: setup?.scenario ?? fallbackScenario ?? DEFAULT_WORLD_SETUP.scenario,
    seed: setup?.seed ?? fallbackSeed ?? DEFAULT_WORLD_SETUP.seed,
  };
}

export class GameEngine {
  private state: GameState;
  private listeners = new Set<(state: GameState) => void>();
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private subTickCounter = 0;
  private aiShareCostBasis: Record<string, number> = {};
  private seed: number;
  private worldSetup: WorldSetupConfig;
  private localIdentity: LocalPlayerIdentity | null = null;
  private syncedPeerIds = new Set<string>();
  private remoteTileBackups = new Map<number, Tile>();

  constructor(options: GameEngineOptions = {}) {
    this.seed = options.worldSetup?.seed ?? options.seed ?? DEFAULT_WORLD_SETUP.seed;
    this.worldSetup = resolveWorldSetup(
      options.worldSetup,
      options.scenario,
      options.mapSize,
      this.seed
    );
    if (options.autoLoadFromStorage) {
      const saved = loadStateFromLocalStorage();
      if (saved) {
        this.state = saved;
        if (!Array.isArray(this.state.depotWagons)) {
          this.state.depotWagons = [];
        }
        for (const v of this.state.vehicles) {
          if (v.network === 'RAIL') {
            this.ensureTrainWagons(v);
          }
        }
        if (saved.worldSetup) {
          this.worldSetup = resolveWorldSetup(saved.worldSetup);
          this.seed = this.worldSetup.seed;
        }
        updateStationRatings(this.state);
        recomputeValuationsAndWarnings(this.state);
        return;
      }
    }
    this.state = this.buildFreshState(this.worldSetup, options.mapSize);
  }

  private buildFreshState(
    setup: WorldSetupConfig,
    rawExplicitMapSize?: number
  ): GameState {
    const effectiveMapSize =
      rawExplicitMapSize !== undefined &&
      rawExplicitMapSize !== 64 &&
      rawExplicitMapSize !== 96 &&
      rawExplicitMapSize !== 128 &&
      rawExplicitMapSize !== 160
        ? Math.max(32, Math.min(160, Math.round(rawExplicitMapSize)))
        : setup.mapSize;

    const world = generateWorld({
      ...setup,
      mapSize: effectiveMapSize as MapSizeOption,
    });
    const corporate = createInitialCorporateFinance(setup.scenario, 1);
    const personal = createInitialPersonalFinance();
    if (this.localIdentity) {
      corporate.companyName = this.localIdentity.companyName;
      corporate.playerColor = this.localIdentity.playerColor;
      personal.ownerName = this.localIdentity.ownerName;
    }

    const aiCompanies = createInitialAICompanies(
      setup.aiEnabled,
      setup.maxAiCount
    );
    this.aiShareCostBasis = {};
    this.subTickCounter = 0;
    this.syncedPeerIds.clear();
    this.remoteTileBackups.clear();

    const initialState: GameState = {
      mapSize: world.mapSize,
      tiles: world.tiles,
      towns: world.towns,
      industries: world.industries,
      stations: [],
      vehicles: [],
      depotWagons: [],
      popups: [],
      date: {
        day: 1,
        month: 1,
        year: 1,
        calendarYear: setup.startYear,
        totalDays: 0,
        totalMonths: 0,
      },
      speed: 1,
      corporate,
      personal,
      aiCompanies,
      news: [],
      scenario: setup.scenario,
      worldSetup: { ...setup },
      remotePlayers: [],
      networkRevision: 1,
      lastSavedAtMs: null,
    };

    const aiNotice =
      setup.aiEnabled && setup.maxAiCount > 0
        ? 'Bygg lønnsomme jernbane- og veiruter før første konkurrent børsnoteres i År 2.'
        : 'Bygg lønnsomme jernbane- og veiruter i en åpen verden uten AI-konkurrenter!';
    pushNews(
      initialState,
      `Velkommen til ${corporate.companyName}! ${aiNotice}`,
      'INFO'
    );
    recomputeValuationsAndWarnings(initialState);
    return initialState;
  }

  public getState(): GameState {
    return this.state;
  }

  public subscribe(listener: (state: GameState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    // Create shallow top-level reference copy so React `useState` / `useSyncExternalStore` always re-renders cleanly
    this.state = {
      ...this.state,
      vehicles: [...this.state.vehicles],
      depotWagons: [...(this.state.depotWagons ?? [])],
      date: { ...this.state.date },
      corporate: {
        ...this.state.corporate,
        currentYearPnL: { ...this.state.corporate.currentYearPnL },
        lastYearPnL: { ...this.state.corporate.lastYearPnL },
      },
      personal: {
        ...this.state.personal,
        lastMonthTaxBreakdown: { ...this.state.personal.lastMonthTaxBreakdown },
        portfolio: { ...this.state.personal.portfolio },
      },
    };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public startLoop(): void {
    if (this.loopTimer !== null) return;
    this.loopTimer = setInterval(() => {
      if (this.state.speed === 0) {
        this.pruneExpiredPopups();
        return;
      }
      const steps =
        this.state.speed === 4 ? 4 : this.state.speed === 2 ? 2 : 1;
      for (let i = 0; i < steps; i++) {
        this.stepSingleSubTick(true);
      }
      this.pruneExpiredPopups();
      this.emit();
    }, 100);
  }

  public stopLoop(): void {
    if (this.loopTimer !== null) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  public setSpeed(speed: GameSpeed): void {
    this.state.speed = speed;
    this.emit();
  }

  /**
   * Advances simulation by `count` sub-ticks (8 sub-ticks = 1 game day).
   * Useful for headless simulation tests and deterministic stepping.
   */
  public tick(count = 1): void {
    const n = Math.max(1, Math.round(count));
    for (let i = 0; i < n; i++) {
      this.stepSingleSubTick(false);
    }
    this.emit();
  }

  /**
   * Advances simulation by `days` full game days (including full vehicle movement & cargo deliveries).
   */
  public advanceDays(days = 1): void {
    const totalSubTicks = Math.max(1, Math.round(days)) * SUBTICKS_PER_GAME_DAY;
    for (let i = 0; i < totalSubTicks; i++) {
      this.stepSingleSubTick(false);
    }
    this.emit();
  }

  /**
   * Fast-forwards `months` game months (30 days each), simulating real vehicle trips,
   * monthly corporate/personal tax ticks, quarterly dividends, and AI competitor spawns.
   */
  public fastForwardMonths(months: number): void {
    const clampedMonths = Math.max(1, Math.min(60, Math.round(months)));
    const totalSubTicks = clampedMonths * 30 * SUBTICKS_PER_GAME_DAY;
    for (let i = 0; i < totalSubTicks; i++) {
      this.stepSingleSubTick(false);
    }
    this.emit();
  }

  private stepSingleSubTick(autoSaveOnMonth: boolean): void {
    for (const v of this.state.vehicles) {
      this.stepVehicleSubTick(v);
    }
    refreshSignalLampStates(this.state.tiles, this.state.mapSize, this.state.vehicles);

    this.subTickCounter += 1;
    if (this.subTickCounter >= SUBTICKS_PER_GAME_DAY) {
      this.subTickCounter = 0;
      this.advanceOneCalendarDay(autoSaveOnMonth);
    }
  }

  private advanceOneCalendarDay(autoSaveOnMonth: boolean): void {
    const d = this.state.date;
    d.totalDays += 1;
    d.day += 1;

    // Station aging counter
    for (const st of this.state.stations) {
      st.daysSincePickup += 1;
    }

    // Every 5 game days: distribute primary/secondary industry & town cargo to nearby stations
    if (d.totalDays % 5 === 0) {
      distributePeriodicCargoOutput(this.state);
    }

    // End of 30-day game month -> Monthly, Quarterly, and Yearly hooks!
    if (d.day > 30) {
      const completedMonth = d.month; // 1..12
      d.day = 1;
      d.totalMonths += 1;

      // 1. Monthly Dual-Economy (running costs, loan interest, salary + arbeidsgiveravgift + progressive tax, town growth)
      runMonthlyEconomyTick(this.state);

      // 2. Quarterly AI Dividends (at end of Q1=month 3, Q2=month 6, Q3=month 9, Q4=month 12)
      if (completedMonth % 3 === 0) {
        payQuarterlyDividends(this.state);
      }

      // 3. Advance calendar month/year
      if (d.month >= 12) {
        d.month = 1;
        d.year += 1;
        const baseStartYear =
          this.state.worldSetup?.startYear ?? DEFAULT_WORLD_SETUP.startYear;
        d.calendarYear = baseStartYear + d.year - 1;
        runYearlyRolloverTick(this.state, d.year);
      } else {
        d.month += 1;
      }

      // 4. Staggered AI Competitor Spawns (Months 12, 24, 36) & monthly AI valuation/routes
      runMonthlyAICompetitorsTick(this.state);
      recomputeValuationsAndWarnings(this.state);

      // 5. Auto-save every game month when running live loop
      if (autoSaveOnMonth) {
        saveStateToLocalStorage(this.state);
      }
    }
  }

  public ensureTrainWagons(vehicle: Vehicle): TrainWagon[] {
    if (vehicle.network !== 'RAIL') return [];
    if (Array.isArray(vehicle.wagons)) {
      return vehicle.wagons;
    }

    const spec = VEHICLE_CATALOG[vehicle.modelId] ?? VEHICLE_CATALOG.LOCO_STEAM;
    const count = Math.max(0, Math.round(vehicle.wagonCount ?? 0));
    const perWagonCap =
      count > 0 && vehicle.capacity > 0
        ? Math.max(1, Math.round(vehicle.capacity / count))
        : spec.capacityPerWagon || RAIL_WAGON_CATALOG[vehicle.cargoType].capacity;

    let remainingCargo = Math.max(0, vehicle.cargoAmount ?? 0);
    const built: TrainWagon[] = [];
    for (let i = 0; i < count; i++) {
      const loaded = Math.min(perWagonCap, remainingCargo);
      remainingCargo -= loaded;
      built.push({
        id: `${vehicle.id}-w-${i + 1}`,
        cargoType: vehicle.cargoType,
        capacity: perWagonCap,
        cargoAmount: loaded,
        cargoOriginStationId: loaded > 0 ? vehicle.cargoOriginStationId : null,
        cargoLoadedDay: vehicle.cargoLoadedDay ?? this.state.date.totalDays,
        purchaseValue:
          spec.wagonPrice > 0
            ? spec.wagonPrice
            : RAIL_WAGON_CATALOG[vehicle.cargoType].price,
        annualRunningCost:
          spec.runningCostPerWagon > 0
            ? spec.runningCostPerWagon
            : RAIL_WAGON_CATALOG[vehicle.cargoType].annualRunningCost,
      });
    }
    vehicle.wagons = built;
    vehicle.wt = built.map((w) => w.cargoType);
    return built;
  }

  private recomputeTrainConsistStats(vehicle: Vehicle): void {
    if (vehicle.network !== 'RAIL') return;
    const wagons = this.ensureTrainWagons(vehicle);
    const locoSpec = VEHICLE_CATALOG[vehicle.modelId] ?? VEHICLE_CATALOG.LOCO_STEAM;

    vehicle.wagonCount = wagons.length;
    vehicle.capacity = wagons.reduce((sum, w) => sum + w.capacity, 0);
    vehicle.cargoAmount = wagons.reduce((sum, w) => sum + w.cargoAmount, 0);

    if (vehicle.cargoAmount === 0) {
      vehicle.cargoOriginStationId = null;
    } else {
      const firstLoaded = wagons.find(
        (w) => w.cargoAmount > 0 && Boolean(w.cargoOriginStationId)
      );
      if (firstLoaded) {
        vehicle.cargoOriginStationId = firstLoaded.cargoOriginStationId;
        vehicle.cargoLoadedDay = firstLoaded.cargoLoadedDay;
      }
    }

    const wagonsPurchase = wagons.reduce((sum, w) => sum + w.purchaseValue, 0);
    vehicle.purchaseValue = locoSpec.price + wagonsPurchase;

    const annualRun =
      locoSpec.annualRunningCost +
      wagons.reduce((sum, w) => sum + w.annualRunningCost, 0);
    vehicle.baseAnnualRunningCost = annualRun;
    vehicle.runningCostPerMonth = Math.round(annualRun / 12);
    vehicle.wt = wagons.map((w) => w.cargoType);

    const baseName = vehicle.name.split(' (')[0];
    if (wagons.length === 0) {
      vehicle.name = `${baseName} (Uten vogner)`;
    } else {
      const counts = new Map<CargoType, number>();
      const distinctInOrder: CargoType[] = [];
      for (const w of wagons) {
        if (!counts.has(w.cargoType)) {
          distinctInOrder.push(w.cargoType);
        }
        counts.set(w.cargoType, (counts.get(w.cargoType) ?? 0) + 1);
      }
      let dominant = wagons[0].cargoType;
      let bestCount = -1;
      for (const ct of distinctInOrder) {
        const c = counts.get(ct) ?? 0;
        if (c > bestCount) {
          bestCount = c;
          dominant = ct;
        }
      }
      vehicle.cargoType = dominant;
      const cargoSummary = distinctInOrder
        .map((c) => CARGO_LABELS_NO[c])
        .join(' + ');
      vehicle.name = `${baseName} (${cargoSummary})`;
    }
  }

  private parkVehicleInDepot(
    vehicle: Vehicle,
    depotX: number,
    depotY: number
  ): void {
    vehicle.x = depotX;
    vehicle.y = depotY;
    vehicle.nextX = depotX;
    vehicle.nextY = depotY;
    vehicle.depotX = depotX;
    vehicle.depotY = depotY;
    vehicle.progress = 0;
    vehicle.speedKmh = 0;
    vehicle.accelTicks = 0;
    vehicle.loadingTicksRemaining = 0;
    vehicle.platformOverhangTiles = 0;
    vehicle.fullLoadWaitTicks = 0;
    vehicle.goingToDepot = null;
    vehicle.state = 'IN_DEPOT';
    vehicle.path = [];
    vehicle.trail = [{ x: depotX, y: depotY }];
  }

  private extendRailPathToPlatformEnd(
    vehicle: Vehicle,
    rawPath: GridPoint[],
    station: Station,
    occupiedByOthers?: Set<number>
  ): GridPoint[] {
    if (
      rawPath.length === 0 ||
      station.kind !== 'TRAIN_STATION' ||
      station.tiles.length <= 1
    ) {
      return rawPath;
    }

    const entry = rawPath[rawPath.length - 1];
    if (!station.tiles.some((t) => t.x === entry.x && t.y === entry.y)) {
      return rawPath;
    }

    const prev =
      rawPath.length >= 2
        ? rawPath[rawPath.length - 2]
        : { x: vehicle.x, y: vehicle.y };
    let stepDx = Math.sign(entry.x - prev.x);
    let stepDy = Math.sign(entry.y - prev.y);

    const entryTile = inBounds(entry.x, entry.y, this.state.mapSize)
      ? this.state.tiles[tileIndex(entry.x, entry.y, this.state.mapSize)]
      : undefined;
    const axis: 'X' | 'Y' | undefined =
      entryTile?.stationAxis ?? station.orientation;

    if (axis === 'X' && stepDx === 0) {
      stepDy = 0;
      stepDx = station.tiles.some(
        (t) => t.x === entry.x + 1 && t.y === entry.y
      )
        ? 1
        : station.tiles.some((t) => t.x === entry.x - 1 && t.y === entry.y)
          ? -1
          : 0;
    } else if (axis === 'Y' && stepDy === 0) {
      stepDx = 0;
      stepDy = station.tiles.some(
        (t) => t.x === entry.x && t.y === entry.y + 1
      )
        ? 1
        : station.tiles.some((t) => t.x === entry.x && t.y === entry.y - 1)
          ? -1
          : 0;
    }

    if (stepDx === 0 && stepDy === 0) {
      return rawPath;
    }

    const extended = [...rawPath];
    let cx = entry.x + stepDx;
    let cy = entry.y + stepDy;
    while (
      inBounds(cx, cy, this.state.mapSize) &&
      station.tiles.some((t) => t.x === cx && t.y === cy)
    ) {
      const idx = tileIndex(cx, cy, this.state.mapSize);
      if (occupiedByOthers && occupiedByOthers.has(idx)) {
        break;
      }
      if (extended.some((p) => p.x === cx && p.y === cy)) {
        break;
      }
      extended.push({ x: cx, y: cy });
      cx += stepDx;
      cy += stepDy;
    }

    return extended;
  }

  private stepVehicleSubTick(vehicle: Vehicle): void {
    if (vehicle.state === 'STOPPED' || vehicle.state === 'IN_DEPOT') {
      vehicle.speedKmh = 0;
      return;
    }

    let goalTiles: GridPoint[] = [];
    let targetStation: Station | undefined;

    if (vehicle.goingToDepot) {
      const gd = vehicle.goingToDepot;
      const depTile = inBounds(gd.x, gd.y, this.state.mapSize)
        ? this.state.tiles[tileIndex(gd.x, gd.y, this.state.mapSize)]
        : null;
      if (!depTile || depTile.depot !== vehicle.network) {
        // Target depot was demolished while en route — fall back to normal orders
        vehicle.goingToDepot = null;
      } else if (vehicle.x === gd.x && vehicle.y === gd.y) {
        this.parkVehicleInDepot(vehicle, gd.x, gd.y);
        return;
      } else {
        goalTiles = [{ x: gd.x, y: gd.y }];
      }
    }

    if (!vehicle.goingToDepot) {
      if (vehicle.orders.length === 0) {
        vehicle.speedKmh = 0;
        return;
      }
      if (
        vehicle.currentOrderIndex >= vehicle.orders.length ||
        vehicle.currentOrderIndex < 0
      ) {
        vehicle.currentOrderIndex = 0;
      }

      const targetStationId = vehicle.orders[vehicle.currentOrderIndex];
      targetStation = this.state.stations.find((s) => s.id === targetStationId);

      if (!targetStation) {
        vehicle.orders = vehicle.orders.filter((id) => id !== targetStationId);
        vehicle.currentOrderIndex = 0;
        vehicle.speedKmh = 0;
        return;
      }

      const atTargetStation = targetStation.tiles.some(
        (t) => t.x === vehicle.x && t.y === vehicle.y
      );

      if (atTargetStation) {
        if (
          vehicle.network === 'RAIL' &&
          vehicle.state !== 'LOADING' &&
          vehicle.path.length > 0 &&
          targetStation.tiles.some(
            (t) => t.x === vehicle.path[0].x && t.y === vehicle.path[0].y
          )
        ) {
          const pullCheck =
            vehicle.progress > 0
              ? { allowed: true }
              : canTrainEnterNextTile(
                  vehicle,
                  vehicle.path[0],
                  this.state.tiles,
                  this.state.mapSize,
                  this.state.vehicles
                );
          if (!pullCheck.allowed) {
            vehicle.path = [];
            this.handleVehicleAtStation(vehicle, targetStation);
            return;
          }
          // Pull forward along the platform until reaching the far-end tile!
        } else {
          this.handleVehicleAtStation(vehicle, targetStation);
          return;
        }
      }

      goalTiles = targetStation.tiles;
    }

    // Ensure valid path to goalTiles (and verify next step wasn't bulldozed)
    const firstPathPt = vehicle.path[0];
    const lastPathPt = vehicle.path[vehicle.path.length - 1];
    const firstStepTile =
      firstPathPt && inBounds(firstPathPt.x, firstPathPt.y, this.state.mapSize)
        ? this.state.tiles[tileIndex(firstPathPt.x, firstPathPt.y, this.state.mapSize)]
        : null;
    const firstStepTraversable = Boolean(
      firstStepTile &&
        (isTileTraversableForNetwork(firstStepTile, vehicle.network) ||
          goalTiles.some(
            (t) => t.x === firstPathPt.x && t.y === firstPathPt.y
          ))
    );
    const pathValid =
      vehicle.path.length > 0 &&
      firstStepTraversable &&
      Boolean(lastPathPt) &&
      goalTiles.some(
        (t) => t.x === lastPathPt.x && t.y === lastPathPt.y
      );

    if (!pathValid) {
      const avoidSet =
        vehicle.network === 'RAIL'
          ? getOccupiedRailTileSet(this.state.vehicles, this.state.mapSize, vehicle.id)
          : undefined;
      vehicle.path = findNetworkPath(
        this.state.tiles,
        this.state.mapSize,
        vehicle.x,
        vehicle.y,
        goalTiles,
        vehicle.network,
        avoidSet
      );
      if (vehicle.path.length === 0 && avoidSet) {
        // Fallback without avoidance so train can wait at signal rather than losing path
        vehicle.path = findNetworkPath(
          this.state.tiles,
          this.state.mapSize,
          vehicle.x,
          vehicle.y,
          goalTiles,
          vehicle.network
        );
      }
      if (vehicle.path.length === 0) {
        vehicle.speedKmh = 0;
        return;
      }
      if (vehicle.network === 'RAIL' && targetStation) {
        vehicle.path = this.extendRailPathToPlatformEnd(
          vehicle,
          vehicle.path,
          targetStation,
          avoidSet
        );
      }
    }

    let nextStep = vehicle.path[0];

    // Rail Block-Signal & Collision Prevention before entering next tile
    if (vehicle.network === 'RAIL' && vehicle.progress === 0) {
      let check = canTrainEnterNextTile(
        vehicle,
        nextStep,
        this.state.tiles,
        this.state.mapSize,
        this.state.vehicles
      );

      if (!check.allowed) {
        // Attempt alternate parallel siding / track if at a switch
        const occupied = getOccupiedRailTileSet(
          this.state.vehicles,
          this.state.mapSize,
          vehicle.id
        );
        const altPath = findNetworkPath(
          this.state.tiles,
          this.state.mapSize,
          vehicle.x,
          vehicle.y,
          goalTiles,
          'RAIL',
          occupied
        );
        if (
          altPath.length > 0 &&
          (altPath[0].x !== nextStep.x || altPath[0].y !== nextStep.y)
        ) {
          const fullAltPath = targetStation
            ? this.extendRailPathToPlatformEnd(
                vehicle,
                altPath,
                targetStation,
                occupied
              )
            : altPath;
          const altCheck = canTrainEnterNextTile(
            { ...vehicle, path: fullAltPath },
            fullAltPath[0],
            this.state.tiles,
            this.state.mapSize,
            this.state.vehicles
          );
          if (altCheck.allowed) {
            vehicle.path = fullAltPath;
            nextStep = fullAltPath[0];
            check = altCheck;
          }
        }
      }

      if (!check.allowed) {
        vehicle.state = 'WAITING_SIGNAL';
        vehicle.speedKmh = 0;
        vehicle.accelTicks = 0;
        vehicle.nextX = vehicle.x;
        vehicle.nextY = vehicle.y;
        return;
      }
    }

    const prevDir = vehicle.direction;
    const nextDir = Math.atan2(nextStep.y - vehicle.y, nextStep.x - vehicle.x);
    const isTurning =
      vehicle.progress === 0 &&
      (vehicle.accelTicks ?? 4) > 0 &&
      Math.abs(nextDir - prevDir) > 0.05;

    vehicle.state = 'MOVING';
    vehicle.nextX = nextStep.x;
    vehicle.nextY = nextStep.y;
    vehicle.direction = nextDir;

    const curTile = this.state.tiles[tileIndex(vehicle.x, vehicle.y, this.state.mapSize)];
    const nextTile = this.state.tiles[tileIndex(nextStep.x, nextStep.y, this.state.mapSize)];
    const slopeFactor = calculateSlopeSpeedFactor(
      getEffectiveTrackElevation(curTile),
      getEffectiveTrackElevation(nextTile),
      vehicle.network === 'RAIL' ? 'rail' : 'road'
    );

    // Gradual acceleration over ~4 subticks after departing a station/signal + 0.78x cornering drag
    const accelStep = Math.min(4, (vehicle.accelTicks ?? 4) + 1);
    vehicle.accelTicks = accelStep;
    const accelFactor = 0.36 + (accelStep / 4) * 0.64;
    const cornerFactor = isTurning ? 0.78 : 1.0;

    let bridgeSpeedCap = Infinity;
    if (curTile.bridge) {
      const bt: BridgeType = curTile.bridgeType ?? 'STEEL';
      bridgeSpeedCap = Math.min(
        bridgeSpeedCap,
        (BRIDGE_CATALOG[bt] ?? BRIDGE_CATALOG.STEEL).maxSpeedKmh
      );
    }
    if (nextTile.bridge) {
      const bt: BridgeType = nextTile.bridgeType ?? 'STEEL';
      bridgeSpeedCap = Math.min(
        bridgeSpeedCap,
        (BRIDGE_CATALOG[bt] ?? BRIDGE_CATALOG.STEEL).maxSpeedKmh
      );
    }

    const cappedMaxSpeed = Math.min(vehicle.maxSpeedKmh, bridgeSpeedCap);
    const effectiveSpeedKmh = Math.min(
      bridgeSpeedCap,
      Math.max(
        10,
        Math.round(cappedMaxSpeed * slopeFactor * accelFactor * cornerFactor)
      )
    );
    vehicle.speedKmh = effectiveSpeedKmh;

    // At 100ms/subtick (1x): 56 km/h bus -> 56 / 620 * 10 = 0.903 tiles/sec (~22s for 20 tiles)
    const stepProgress = Math.min(0.75, effectiveSpeedKmh / 620);
    vehicle.progress += stepProgress;

    if (vehicle.progress >= 1.0) {
      if (!vehicle.trail) vehicle.trail = [];
      vehicle.trail.unshift({ x: vehicle.x, y: vehicle.y });
      if (vehicle.trail.length > 8) vehicle.trail.length = 8;

      vehicle.x = nextStep.x;
      vehicle.y = nextStep.y;
      vehicle.path.shift();
      vehicle.progress = 0;

      if (
        vehicle.goingToDepot &&
        vehicle.x === vehicle.goingToDepot.x &&
        vehicle.y === vehicle.goingToDepot.y
      ) {
        this.parkVehicleInDepot(vehicle, vehicle.x, vehicle.y);
        return;
      }

      if (vehicle.path.length > 0) {
        vehicle.nextX = vehicle.path[0].x;
        vehicle.nextY = vehicle.path[0].y;
      } else {
        vehicle.nextX = vehicle.x;
        vehicle.nextY = vehicle.y;
      }
    }
  }

  private deliverCargoBatchAtStation(
    station: Station,
    cargoType: CargoType,
    amount: number,
    originStationId: string,
    loadedDay: number
  ): number {
    if (amount <= 0 || originStationId === station.id) return 0;
    const acceptance = doesStationAcceptCargo(this.state, station, cargoType);
    if (!acceptance.accepts) return 0;

    const originStation = this.state.stations.find(
      (s) => s.id === originStationId
    );
    const manhattanDist = originStation
      ? Math.max(
          1,
          Math.abs(station.x - originStation.x) +
            Math.abs(station.y - originStation.y)
        )
      : 12;
    const transitDays = Math.max(0, this.state.date.totalDays - loadedDay);

    const payout = calculateCargoPayment(
      cargoType,
      amount,
      manhattanDist,
      transitDays
    );

    // Secondary Industry Production (WOOD -> GOODS, GRAIN -> FOOD)
    if (acceptance.targetIndustryId) {
      const targetInd = this.state.industries.find(
        (i) => i.id === acceptance.targetIndustryId
      );
      if (targetInd) {
        const conv = calculateSecondaryIndustryOutput(cargoType, amount);
        if (conv.outputCargo && conv.producedUnits > 0) {
          targetInd.storedOutput += conv.producedUnits;
          const outCargo = conv.outputCargo;
          const servingStations = this.state.stations.filter(
            (s) =>
              s.nearbyIndustryIds.includes(targetInd.id) &&
              s.kind !== 'BUS_STOP'
          );
          if (servingStations.length > 0) {
            const immediateToPlatform = Math.floor(conv.producedUnits * 0.5);
            targetInd.storedOutput -= immediateToPlatform;
            servingStations[0].waitingCargo[outCargo] =
              (servingStations[0].waitingCargo[outCargo] ?? 0) +
              immediateToPlatform;
          }
        }
      }
    }

    // Town Delivery Tracking & Responsive Town Growth
    const townId = acceptance.targetTownId ?? station.townId;
    if (townId) {
      const town = this.state.towns.find((t) => t.id === townId);
      if (town) {
        if (cargoType === 'PASSENGERS') {
          town.deliveredPassengersThisMonth =
            (town.deliveredPassengersThisMonth ?? 0) + amount;
          town.growthCounter += amount * 0.04;
        } else if (cargoType === 'MAIL') {
          town.deliveredMailThisMonth =
            (town.deliveredMailThisMonth ?? 0) + amount;
          town.growthCounter += amount * 0.05;
        } else if (cargoType === 'GOODS' || cargoType === 'FOOD') {
          town.deliveredGoodsOrFoodThisMonth =
            (town.deliveredGoodsOrFoodThisMonth ?? 0) + amount;
          town.growthCounter += amount * 0.07;
        }

        const immediatePop = Math.floor(town.growthCounter);
        if (immediatePop > 0) {
          town.population += immediatePop;
          town.growthCounter -= immediatePop;
          town.monthlyPassengers = Math.max(
            14,
            Math.round(town.population * 0.06)
          );
          town.monthlyMail = Math.max(6, Math.round(town.population * 0.025));
          if (
            expandTownBuildings(this.state.tiles, this.state.mapSize, town)
          ) {
            this.state.networkRevision =
              (this.state.networkRevision ?? 0) + 1;
          }
        }
      }
    }

    return payout;
  }

  private handleVehicleAtStation(vehicle: Vehicle, station: Station): void {
    const isRail = vehicle.network === 'RAIL';
    const wagons = isRail ? this.ensureTrainWagons(vehicle) : [];
    const requiredTiles = isRail
      ? getTrainRequiredPlatformTiles(wagons.length)
      : 1;
    const platformLen = isRail
      ? getEffectiveStationPlatformLength(station)
      : 1;
    const overhangTiles = isRail
      ? Math.max(0, requiredTiles - platformLen)
      : 0;
    vehicle.platformOverhangTiles = overhangTiles;
    const initialDwellSubticks =
      overhangTiles > 0 ? 5 + overhangTiles * 7 : 5;

    if (this.syncedPeerIds.has(vehicle.ownerId)) {
      if (vehicle.state !== 'LOADING') {
        vehicle.state = 'LOADING';
        vehicle.speedKmh = 0;
        vehicle.progress = 0;
        vehicle.accelTicks = 0;
        vehicle.nextX = vehicle.x;
        vehicle.nextY = vehicle.y;
        vehicle.loadingTicksRemaining = initialDwellSubticks;
      } else {
        vehicle.loadingTicksRemaining = Math.max(
          0,
          (vehicle.loadingTicksRemaining ?? 1) - 1
        );
        if ((vehicle.loadingTicksRemaining ?? 0) <= 0) {
          vehicle.currentOrderIndex =
            (vehicle.currentOrderIndex + 1) % Math.max(1, vehicle.orders.length);
          vehicle.state = 'MOVING';
          vehicle.accelTicks = 0;
          vehicle.platformOverhangTiles = 0;
          vehicle.path = [];
        }
      }
      return;
    }

    if (vehicle.state !== 'LOADING') {
      vehicle.state = 'LOADING';
      vehicle.speedKmh = 0;
      vehicle.progress = 0;
      vehicle.accelTicks = 0;
      vehicle.fullLoadWaitTicks = 0;
      vehicle.nextX = vehicle.x;
      vehicle.nextY = vehicle.y;
      vehicle.loadingTicksRemaining = initialDwellSubticks;

      // 1. Unload & Deliver accepted cargo from a DIFFERENT station (per wagon on RAIL, single hold on ROAD)
      let totalStationPayout = 0;

      if (isRail) {
        // Group unloading wagons by (cargoType, originStationId, loadedDay) so uniform consists match exact rounded kr payout
        const batches = new Map<
          string,
          {
            cargoType: CargoType;
            originStationId: string;
            loadedDay: number;
            amount: number;
            wagons: TrainWagon[];
          }
        >();

        for (const w of wagons) {
          if (
            w.cargoAmount > 0 &&
            w.cargoOriginStationId &&
            w.cargoOriginStationId !== station.id &&
            doesStationAcceptCargo(this.state, station, w.cargoType).accepts
          ) {
            const key = `${w.cargoType}|${w.cargoOriginStationId}|${w.cargoLoadedDay}`;
            let batch = batches.get(key);
            if (!batch) {
              batch = {
                cargoType: w.cargoType,
                originStationId: w.cargoOriginStationId,
                loadedDay: w.cargoLoadedDay,
                amount: 0,
                wagons: [],
              };
              batches.set(key, batch);
            }
            batch.amount += w.cargoAmount;
            batch.wagons.push(w);
          }
        }

        for (const batch of batches.values()) {
          const payout = this.deliverCargoBatchAtStation(
            station,
            batch.cargoType,
            batch.amount,
            batch.originStationId,
            batch.loadedDay
          );
          totalStationPayout += payout;
          for (const w of batch.wagons) {
            w.cargoAmount = 0;
            w.cargoOriginStationId = null;
          }
        }

        vehicle.cargoAmount = wagons.reduce((sum, w) => sum + w.cargoAmount, 0);
        if (vehicle.cargoAmount === 0) {
          vehicle.cargoOriginStationId = null;
        } else {
          const rem = wagons.find(
            (w) => w.cargoAmount > 0 && Boolean(w.cargoOriginStationId)
          );
          if (rem) {
            vehicle.cargoOriginStationId = rem.cargoOriginStationId;
            vehicle.cargoLoadedDay = rem.cargoLoadedDay;
          }
        }
      } else if (
        vehicle.cargoAmount > 0 &&
        vehicle.cargoOriginStationId &&
        vehicle.cargoOriginStationId !== station.id &&
        doesStationAcceptCargo(this.state, station, vehicle.cargoType).accepts
      ) {
        totalStationPayout = this.deliverCargoBatchAtStation(
          station,
          vehicle.cargoType,
          vehicle.cargoAmount,
          vehicle.cargoOriginStationId,
          vehicle.cargoLoadedDay
        );
        vehicle.cargoAmount = 0;
        vehicle.cargoOriginStationId = null;
      }

      if (totalStationPayout > 0) {
        vehicle.profitThisYear += totalStationPayout;
        if (vehicle.ownerId === 'player') {
          this.state.corporate.cash += totalStationPayout;
          this.state.corporate.currentYearPnL.freightRevenue +=
            totalStationPayout;
          this.pushFloatingPopup(
            station.x,
            station.y,
            `+kr ${formatNorwegianNumber(totalStationPayout)}`,
            'green'
          );
          recomputeValuationsAndWarnings(this.state);
        } else {
          const ai = this.state.aiCompanies.find(
            (a) => a.id === vehicle.ownerId
          );
          if (ai) {
            ai.cash += totalStationPayout;
          }
        }
      }
    }

    // 2. Gradual Loading of Waiting Cargo (`7..10` units per subtick, min 5 subticks dwell)
    station.daysSincePickup = 0;
    station.lastVehicleMaxSpeedKmh = vehicle.maxSpeedKmh;

    if (isRail) {
      const railLoadBudget =
        overhangTiles > 0
          ? Math.max(2, Math.round(10 / (1 + overhangTiles * 0.8)))
          : 12;
      const perCargoBudget = new Map<CargoType, number>();
      for (const w of wagons) {
        const available = station.waitingCargo[w.cargoType] ?? 0;
        const freeSpace = w.capacity - w.cargoAmount;
        if (available <= 0 || freeSpace <= 0) continue;

        const remainingBudget =
          perCargoBudget.get(w.cargoType) ?? railLoadBudget;
        if (remainingBudget <= 0) continue;

        const toLoad = Math.min(available, freeSpace, remainingBudget);
        if (toLoad > 0) {
          station.waitingCargo[w.cargoType] -= toLoad;
          if (w.cargoAmount === 0) {
            w.cargoOriginStationId = station.id;
            w.cargoLoadedDay = this.state.date.totalDays;
          }
          w.cargoAmount += toLoad;
          perCargoBudget.set(w.cargoType, remainingBudget - toLoad);
        }
      }

      vehicle.cargoAmount = wagons.reduce((sum, w) => sum + w.cargoAmount, 0);
      const firstLoaded = wagons.find(
        (w) => w.cargoAmount > 0 && Boolean(w.cargoOriginStationId)
      );
      if (firstLoaded) {
        vehicle.cargoOriginStationId = firstLoaded.cargoOriginStationId;
        vehicle.cargoLoadedDay = firstLoaded.cargoLoadedDay;
      } else {
        vehicle.cargoOriginStationId = null;
      }
    } else {
      const available = station.waitingCargo[vehicle.cargoType] ?? 0;
      const freeSpace = vehicle.capacity - vehicle.cargoAmount;
      const loadRatePerSubtick = 7;

      if (available > 0 && freeSpace > 0) {
        const toLoad = Math.min(available, freeSpace, loadRatePerSubtick);
        station.waitingCargo[vehicle.cargoType] -= toLoad;
        if (vehicle.cargoAmount === 0) {
          vehicle.cargoOriginStationId = station.id;
          vehicle.cargoLoadedDay = this.state.date.totalDays;
        }
        vehicle.cargoAmount += toLoad;
      }
    }

    vehicle.loadingTicksRemaining = Math.max(
      0,
      (vehicle.loadingTicksRemaining ?? 1) - 1
    );
    vehicle.fullLoadWaitTicks = (vehicle.fullLoadWaitTicks ?? 0) + 1;

    const activelyBoardingAvailable = isRail
      ? wagons.some(
          (w) =>
            (station.waitingCargo[w.cargoType] ?? 0) > 0 &&
            w.cargoAmount < w.capacity
        )
      : (station.waitingCargo[vehicle.cargoType] ?? 0) > 0 &&
        vehicle.cargoAmount < vehicle.capacity;

    const waitingForFullLoad =
      Boolean(vehicle.waitForFullLoad) &&
      (vehicle.fullLoadWaitTicks ?? 0) < FULL_LOAD_MAX_WAIT_SUBTICKS &&
      (isRail
        ? wagons.some(
            (w) =>
              w.cargoAmount < w.capacity &&
              doesStationCatchmentProduceCargo(this.state, station, w.cargoType)
          )
        : vehicle.cargoAmount < vehicle.capacity &&
          doesStationCatchmentProduceCargo(
            this.state,
            station,
            vehicle.cargoType
          ));

    if (
      (vehicle.loadingTicksRemaining ?? 0) <= 0 &&
      !activelyBoardingAvailable &&
      !waitingForFullLoad
    ) {
      vehicle.currentOrderIndex =
        (vehicle.currentOrderIndex + 1) % Math.max(1, vehicle.orders.length);
      vehicle.state = 'MOVING';
      vehicle.accelTicks = 0;
      vehicle.fullLoadWaitTicks = 0;
      vehicle.platformOverhangTiles = 0;
      vehicle.path = [];
    }
  }

  private pushFloatingPopup(
    x: number,
    y: number,
    text: string,
    color: FloatingPopup['color']
  ): void {
    const popup: FloatingPopup = {
      id: `pop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x,
      y,
      text,
      color,
      createdAtMs: Date.now(),
    };
    this.state.popups.push(popup);
    if (this.state.popups.length > 35) {
      this.state.popups.shift();
    }
  }

  private pruneExpiredPopups(): void {
    const now = Date.now();
    if (this.state.popups.some((p) => now - p.createdAtMs > POPUP_LIFETIME_MS)) {
      this.state.popups = this.state.popups.filter(
        (p) => now - p.createdAtMs <= POPUP_LIFETIME_MS
      );
    }
  }

  // ============================================================================
  // Interactive Construction Tools
  // ============================================================================

  public applyTool(
    x: number,
    y: number,
    tool: ToolType,
    options?: ApplyToolOptions
  ): ActionResult {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (!inBounds(rx, ry, this.state.mapSize)) {
      return { ok: false, message: 'Utenfor kartet.' };
    }

    if (tool === 'SELECT') {
      return { ok: true };
    }

    if (tool === 'PLACE_HQ') {
      const res = placeHQAtTile(this.state, rx, ry);
      if (res.ok && res.cost) {
        this.pushFloatingPopup(
          rx,
          ry,
          `-kr ${formatNorwegianNumber(res.cost)} (Privat)`,
          'amber'
        );
        this.emit();
      }
      return res;
    }

    const tile = this.state.tiles[tileIndex(rx, ry, this.state.mapSize)];

    if (tool === 'ROAD' || tool === 'RAIL') {
      const res = this.buildSingleTrackOrRoadTile(rx, ry, tool, true);
      if (res.ok) {
        this.emit();
      }
      return res;
    }

    if (tool === 'ROAD_BRIDGE' || tool === 'RAIL_BRIDGE') {
      // Allow single-clicking a 1-tile narrow water channel if dry land is on opposite sides
      const chosenBridgeType = options?.bridgeType ?? 'STEEL';
      if (tile.terrain === 'WATER') {
        const horizLand =
          inBounds(rx - 1, ry, this.state.mapSize) &&
          inBounds(rx + 1, ry, this.state.mapSize) &&
          this.state.tiles[tileIndex(rx - 1, ry, this.state.mapSize)].terrain !== 'WATER' &&
          this.state.tiles[tileIndex(rx + 1, ry, this.state.mapSize)].terrain !== 'WATER';
        if (horizLand) {
          return this.applyDragTrackOrRoad(rx - 1, ry, rx + 1, ry, tool, chosenBridgeType);
        }
        const vertLand =
          inBounds(rx, ry - 1, this.state.mapSize) &&
          inBounds(rx, ry + 1, this.state.mapSize) &&
          this.state.tiles[tileIndex(rx, ry - 1, this.state.mapSize)].terrain !== 'WATER' &&
          this.state.tiles[tileIndex(rx, ry + 1, this.state.mapSize)].terrain !== 'WATER';
        if (vertLand) {
          return this.applyDragTrackOrRoad(rx, ry - 1, rx, ry + 1, tool, chosenBridgeType);
        }
      }
      return {
        ok: false,
        message: 'Dra broen i rett linje fra kyst til kyst over vannet (1–24 ruter).',
      };
    }

    if (tool === 'SIGNAL') {
      if (
        !tile.rail ||
        tile.road ||
        tile.bridge ||
        tile.terrain === 'WATER' ||
        tile.stationId ||
        tile.depot
      ) {
        return {
          ok: false,
          message: 'Blokksignal må plasseres på et eksisterende jernbanespor på land uten planovergang/stasjon/depot.',
        };
      }
      if (tile.signal) {
        return { ok: false, message: 'Det er allerede et signal her.' };
      }
      const cost = BUILD_COSTS.SIGNAL;
      if (this.state.corporate.cash < cost) {
        return { ok: false, message: 'Ikke nok selskapskontanter til signal.' };
      }
      this.spendCorporateConstruction(cost, rx, ry);
      tile.signal = true;
      tile.signalBlocked = false;
      this.state.networkRevision = (this.state.networkRevision ?? 0) + 1;
      this.emit();
      return { ok: true, cost, message: 'Plasserte jernbanesignal.' };
    }

    if (tool === 'ROAD_DEPOT' || tool === 'RAIL_DEPOT') {
      if (
        tile.terrain === 'WATER' ||
        tile.industryId ||
        tile.hqOwnerId ||
        tile.stationId ||
        tile.depot ||
        (tile.buildingTier ?? 0) > 0
      ) {
        return { ok: false, message: 'Kan ikke bygge depot på denne ruten.' };
      }
      const cost = BUILD_COSTS[tool];
      if (this.state.corporate.cash < cost) {
        return { ok: false, message: 'Ikke nok selskapskontanter til depot.' };
      }
      this.spendCorporateConstruction(cost, rx, ry);
      tile.terrain = 'GRASS';
      tile.ownerId = 'player';
      if (tool === 'ROAD_DEPOT') {
        tile.depot = 'ROAD';
        tile.road = true;
        tile.rail = false;
      } else {
        tile.depot = 'RAIL';
        tile.rail = true;
        tile.road = false;
      }
      this.state.networkRevision = (this.state.networkRevision ?? 0) + 1;
      this.emit();
      return {
        ok: true,
        cost,
        message: tool === 'ROAD_DEPOT' ? 'Bygget buss-/lastebildepot.' : 'Bygget togdepot.',
      };
    }

    if (
      tool === 'TRAIN_STATION' ||
      tool === 'BUS_STOP' ||
      tool === 'TRUCK_BAY'
    ) {
      const isRailStation = tool === 'TRAIN_STATION';
      const tracks = isRailStation
        ? Math.max(
            1,
            Math.min(MAX_STATION_TRACKS, Math.round(options?.stationTracks ?? 1))
          )
        : 1;
      const stationLength = isRailStation
        ? Math.max(
            1,
            Math.min(MAX_STATION_LENGTH, Math.round(options?.stationLength ?? 1))
          )
        : 1;

      let orientation: 'X' | 'Y' =
        options?.orientation === 'Y' ? 'Y' : 'X';
      if (
        isRailStation &&
        options?.orientation === undefined &&
        tracks === 1 &&
        stationLength === 1
      ) {
        const hasRailX =
          (inBounds(rx - 1, ry, this.state.mapSize) &&
            this.state.tiles[tileIndex(rx - 1, ry, this.state.mapSize)].rail) ||
          (inBounds(rx + 1, ry, this.state.mapSize) &&
            this.state.tiles[tileIndex(rx + 1, ry, this.state.mapSize)].rail);
        const hasRailY =
          (inBounds(rx, ry - 1, this.state.mapSize) &&
            this.state.tiles[tileIndex(rx, ry - 1, this.state.mapSize)].rail) ||
          (inBounds(rx, ry + 1, this.state.mapSize) &&
            this.state.tiles[tileIndex(rx, ry + 1, this.state.mapSize)].rail);
        if (hasRailY && !hasRailX) {
          orientation = 'Y';
        }
      }

      const preview = this.previewStationPlacement(rx, ry, tool, {
        orientation,
        stationTracks: tracks,
        stationLength,
      });
      if (!preview.ok) {
        return {
          ok: false,
          message:
            preview.reason ??
            'Kan ikke plassere stasjon her — ruten er opptatt eller ulendt.',
        };
      }

      const targetTiles: GridPoint[] = preview.footprintTiles.map((ft) => ({
        x: ft.x,
        y: ft.y,
      }));
      const cost = preview.cost;

      this.spendCorporateConstruction(cost, rx, ry);

      // Legacy 1x1 auto-merge ONLY when no explicit orientation/stationTracks/multi-length options were supplied
      const allowLegacyAutoMerge =
        options?.orientation === undefined &&
        options?.stationTracks === undefined &&
        (options?.stationLength ?? 1) === 1;
      let mergedStation: Station | undefined;
      if (allowLegacyAutoMerge && tracks === 1 && stationLength === 1) {
        mergedStation = this.state.stations.find(
          (s) =>
            s.ownerId === 'player' &&
            s.kind === tool &&
            s.tiles.length < 3 &&
            s.tiles.some(
              (st) => Math.abs(st.x - rx) + Math.abs(st.y - ry) === 1
            )
        );
      }

      if (mergedStation) {
        const tt = this.state.tiles[tileIndex(rx, ry, this.state.mapSize)];
        tt.terrain = 'GRASS';
        tt.stationId = mergedStation.id;
        tt.ownerId = 'player';
        tt.signal = false;
        tt.signalBlocked = false;

        mergedStation.tiles.push({ x: rx, y: ry });
        if (isRailStation) {
          tt.rail = true;
          const anchor0 = mergedStation.tiles[0];
          const mergeAxis: 'X' | 'Y' =
            Math.abs(rx - anchor0.x) >= Math.abs(ry - anchor0.y) ? 'X' : 'Y';
          mergedStation.orientation = mergeAxis;
          for (const pt of mergedStation.tiles) {
            this.state.tiles[
              tileIndex(pt.x, pt.y, this.state.mapSize)
            ].stationAxis = mergeAxis;
          }
          mergedStation.platformLength = getEffectiveStationPlatformLength({
            ...mergedStation,
            orientation: mergeAxis,
            platformLength: undefined,
          });
          mergedStation.tracks = getEffectiveStationTracks({
            ...mergedStation,
            orientation: mergeAxis,
            tracks: undefined,
          });
        } else {
          tt.road = true;
          tt.stationAxis = undefined;
        }

        mergedStation.x = Math.min(...mergedStation.tiles.map((p) => p.x));
        mergedStation.y = Math.min(...mergedStation.tiles.map((p) => p.y));
        refreshStationCatchment(this.state, mergedStation);
        seedInitialStationCargo(this.state, mergedStation);
        this.state.networkRevision = (this.state.networkRevision ?? 0) + 1;
        this.emit();
        return {
          ok: true,
          cost,
          stationId: mergedStation.id,
          message: `Utvidet ${mergedStation.name} (${mergedStation.tiles.length} ruter).`,
        };
      }

      const idPrefix =
        this.localIdentity && this.localIdentity.clientId !== 'player'
          ? `${this.localIdentity.clientId}-`
          : '';
      const id = `st-${idPrefix}${this.state.stations.length + 1}-${Math.random()
        .toString(36)
        .slice(2, 5)}`;

      for (const pt of targetTiles) {
        const tt = this.state.tiles[tileIndex(pt.x, pt.y, this.state.mapSize)];
        tt.terrain = 'GRASS';
        tt.stationId = id;
        tt.ownerId = 'player';
        tt.signal = false;
        tt.signalBlocked = false;
        if (isRailStation) {
          tt.rail = true;
          tt.stationAxis = orientation;
        } else {
          tt.road = true;
          tt.stationAxis = undefined;
        }
      }

      const nearestTown = this.state.towns.reduce((best, t) =>
        Math.hypot(t.x - rx, t.y - ry) < Math.hypot(best.x - rx, best.y - ry)
          ? t
          : best
      );
      const kindSuffix =
        tool === 'TRAIN_STATION'
          ? 'Stasjon'
          : tool === 'BUS_STOP'
            ? 'Holdeplass'
            : 'Godsterminal';
      const baseName = `${nearestTown.name} ${kindSuffix}`;
      const sameCount = this.state.stations.filter((s) =>
        s.name.startsWith(baseName)
      ).length;
      const stationName =
        sameCount === 0 ? baseName : `${baseName} ${sameCount + 1}`;

      const station: Station = {
        id,
        name: stationName,
        ownerId: 'player',
        kind: tool as StationKind,
        x: rx,
        y: ry,
        tiles: targetTiles,
        ...(isRailStation
          ? {
              orientation,
              tracks,
              platformLength: stationLength,
            }
          : {}),
        townId: null,
        nearbyIndustryIds: [],
        waitingCargo: createEmptyCargoRecord(),
        ratings: createInitialRatingsRecord(),
        daysSincePickup: 0,
        lastVehicleMaxSpeedKmh: isRailStation ? 90 : 75,
      };

      refreshStationCatchment(this.state, station);
      this.state.stations.push(station);
      seedInitialStationCargo(this.state, station);
      this.state.networkRevision = (this.state.networkRevision ?? 0) + 1;
      this.emit();

      return {
        ok: true,
        cost,
        stationId: station.id,
        message: isRailStation
          ? `Bygget ${station.name} (${tracks} spor × ${stationLength} lengde).`
          : `Bygget ${station.name}.`,
      };
    }

    if (tool === 'BULLDOZE') {
      if (tile.industryId || tile.hqOwnerId) {
        return {
          ok: false,
          message: 'Kan ikke rive industrier eller hovedkontor.',
        };
      }
      if (tile.terrain === 'WATER' && !tile.bridge) {
        return {
          ok: false,
          message: 'Kan ikke rive åpent vann.',
        };
      }
      if (tile.ownerId && tile.ownerId !== 'player') {
        return { ok: false, message: 'Kan ikke rive konkurrentens infrastruktur!' };
      }
      if ((tile.buildingTier ?? 0) > 0) {
        return { ok: false, message: 'Bykommunen nekter riving av bygårder.' };
      }
      if (tile.depot) {
        const hasVehInDepot = this.state.vehicles.some(
          (v) => v.state === 'IN_DEPOT' && v.x === rx && v.y === ry
        );
        const hasStoredWagons = (this.state.depotWagons ?? []).some(
          (w) => w.depotX === rx && w.depotY === ry
        );
        if (hasVehInDepot || hasStoredWagons) {
          return {
            ok: false,
            message:
              'Tøm eller selg kjøretøy og vogner i depoet før du river det!',
          };
        }
      }

      const wasBridge = Boolean(tile.bridge);
      const hasAnything =
        wasBridge ||
        tile.road ||
        tile.rail ||
        tile.signal ||
        tile.depot ||
        tile.stationId ||
        tile.terrain === 'FOREST_TREES';
      if (!hasAnything) {
        return { ok: false, message: 'Ingenting å rydde på denne ruten.' };
      }

      const cost = BUILD_COSTS.BULLDOZE;
      if (this.state.corporate.cash < cost) {
        return { ok: false, message: 'Ikke nok kontanter til riving.' };
      }

      if (tile.stationId) {
        const stId = tile.stationId;
        const st = this.state.stations.find((s) => s.id === stId);
        if (st) {
          st.tiles = st.tiles.filter((pt) => pt.x !== rx || pt.y !== ry);
          if (st.tiles.length === 0) {
            this.state.stations = this.state.stations.filter((s) => s.id !== stId);
            for (const v of this.state.vehicles) {
              v.orders = v.orders.filter((oid) => oid !== stId);
            }
          } else {
            st.x = Math.min(...st.tiles.map((p) => p.x));
            st.y = Math.min(...st.tiles.map((p) => p.y));
            if (st.kind === 'TRAIN_STATION') {
              st.platformLength = getEffectiveStationPlatformLength({
                ...st,
                platformLength: undefined,
              });
              st.tracks = getEffectiveStationTracks({
                ...st,
                tracks: undefined,
              });
            }
            refreshStationCatchment(this.state, st);
          }
        }
      }

      tile.road = false;
      tile.rail = false;
      tile.signal = false;
      tile.signalBlocked = false;
      tile.bridge = null;
      tile.bridgeAxis = undefined;
      tile.bridgeType = null;
      tile.bridgeElevation = undefined;
      tile.depot = null;
      tile.stationId = null;
      tile.stationAxis = undefined;
      tile.ownerId = null;
      if (wasBridge) {
        tile.terrain = 'WATER';
        tile.elevation = 0;
      } else if (tile.terrain === 'FOREST_TREES') {
        tile.terrain = 'GRASS';
      }

      // Clear cached paths passing through the bulldozed tile so vehicles reroute immediately
      for (const v of this.state.vehicles) {
        if (v.path.some((p) => p.x === rx && p.y === ry)) {
          v.path = [];
        }
      }

      this.spendCorporateConstruction(cost, rx, ry);
      this.state.networkRevision = (this.state.networkRevision ?? 0) + 1;
      this.emit();
      return {
        ok: true,
        cost,
        message: wasBridge ? 'Rev broen.' : 'Ryddet rute.',
      };
    }

    return { ok: false, message: 'Ukjent verktøy.' };
  }

  private canLandTileAnchorOrBuild(
    tile: Tile,
    mode: 'RAIL' | 'ROAD'
  ): { ok: boolean; buildCost: number } {
    if (tile.terrain === 'WATER' || tile.bridge) {
      return { ok: false, buildCost: 0 };
    }
    if (mode === 'ROAD' && (tile.road || tile.depot === 'ROAD')) {
      return { ok: true, buildCost: 0 };
    }
    if (mode === 'RAIL' && (tile.rail || tile.depot === 'RAIL')) {
      return { ok: true, buildCost: 0 };
    }
    if (
      tile.industryId ||
      tile.hqOwnerId ||
      tile.depot ||
      tile.stationId ||
      (tile.buildingTier ?? 0) > 0 ||
      (mode === 'ROAD' && tile.signal)
    ) {
      return { ok: false, buildCost: 0 };
    }
    return { ok: true, buildCost: BUILD_COSTS[mode] };
  }

  private planDragTrackOrBridge(
    rawPoints: GridPoint[],
    tool: DragTrackTool,
    bridgeType: BridgeType = 'STEEL'
  ): Array<{
    x: number;
    y: number;
    isBridge: boolean;
    axis?: 'X' | 'Y';
    bridgeElevation?: number;
    needsApply?: boolean;
    cost: number;
  }> {
    const baseMode: 'RAIL' | 'ROAD' =
      tool === 'RAIL' || tool === 'RAIL_BRIDGE' ? 'RAIL' : 'ROAD';
    const isExplicitBridge =
      tool === 'RAIL_BRIDGE' || tool === 'ROAD_BRIDGE';

    const points = rawPoints.filter((p) =>
      inBounds(p.x, p.y, this.state.mapSize)
    );
    if (points.length === 0) return [];

    const allSameX =
      points.length >= 2 && points.every((p) => p.x === points[0].x);
    const allSameY =
      points.length >= 2 && points.every((p) => p.y === points[0].y);
    const isStraight = (allSameX || allSameY) && !(allSameX && allSameY);
    const axis: 'X' | 'Y' | null = isStraight
      ? allSameY
        ? 'X'
        : 'Y'
      : null;

    const workingPts = [...points];

    // Convenience: when dragging explicit bridge tool starting/ending on coastal water right next to dry shore, auto-attach the 1-tile shore approach
    if (isExplicitBridge && isStraight && workingPts.length >= 1) {
      const first = workingPts[0];
      const last = workingPts[workingPts.length - 1];
      const stepX = Math.sign(last.x - first.x);
      const stepY = Math.sign(last.y - first.y);
      if (stepX !== 0 || stepY !== 0) {
        const firstTile =
          this.state.tiles[tileIndex(first.x, first.y, this.state.mapSize)];
        if (firstTile.terrain === 'WATER') {
          const prevX = first.x - stepX;
          const prevY = first.y - stepY;
          if (inBounds(prevX, prevY, this.state.mapSize)) {
            const prevTile =
              this.state.tiles[tileIndex(prevX, prevY, this.state.mapSize)];
            if (prevTile.terrain !== 'WATER') {
              workingPts.unshift({ x: prevX, y: prevY });
            }
          }
        }
        const lastAfter = workingPts[workingPts.length - 1];
        const lastTile =
          this.state.tiles[
            tileIndex(lastAfter.x, lastAfter.y, this.state.mapSize)
          ];
        if (lastTile.terrain === 'WATER') {
          const nextX = lastAfter.x + stepX;
          const nextY = lastAfter.y + stepY;
          if (inBounds(nextX, nextY, this.state.mapSize)) {
            const nextTile =
              this.state.tiles[tileIndex(nextX, nextY, this.state.mapSize)];
            if (nextTile.terrain !== 'WATER') {
              workingPts.push({ x: nextX, y: nextY });
            }
          }
        }
      }
    }

    const validBridgeWaterIndices = new Set<number>();
    const bridgeShoreIndices = new Set<number>();
    const spanElevationByIndex = new Map<number, number>();

    if (axis !== null && workingPts.length >= 3) {
      let i = 0;
      while (i < workingPts.length) {
        const t =
          this.state.tiles[
            tileIndex(workingPts[i].x, workingPts[i].y, this.state.mapSize)
          ];
        if (t.terrain !== 'WATER') {
          i++;
          continue;
        }
        const wStart = i;
        while (
          i < workingPts.length &&
          this.state.tiles[
            tileIndex(workingPts[i].x, workingPts[i].y, this.state.mapSize)
          ].terrain === 'WATER'
        ) {
          i++;
        }
        const wEnd = i - 1;
        const waterLen = wEnd - wStart + 1;

        if (
          waterLen >= 1 &&
          waterLen <= 24 &&
          wStart >= 1 &&
          wEnd <= workingPts.length - 2
        ) {
          const leftShore =
            this.state.tiles[
              tileIndex(
                workingPts[wStart - 1].x,
                workingPts[wStart - 1].y,
                this.state.mapSize
              )
            ];
          const rightShore =
            this.state.tiles[
              tileIndex(
                workingPts[wEnd + 1].x,
                workingPts[wEnd + 1].y,
                this.state.mapSize
              )
            ];
          const leftCheck = this.canLandTileAnchorOrBuild(leftShore, baseMode);
          const rightCheck = this.canLandTileAnchorOrBuild(rightShore, baseMode);

          let waterSpanClear = leftCheck.ok && rightCheck.ok;
          for (let k = wStart; k <= wEnd && waterSpanClear; k++) {
            const wt =
              this.state.tiles[
                tileIndex(workingPts[k].x, workingPts[k].y, this.state.mapSize)
              ];
            if (
              wt.industryId ||
              wt.hqOwnerId ||
              wt.stationId ||
              wt.depot ||
              (wt.bridge && (wt.bridge !== baseMode || wt.bridgeAxis !== axis))
            ) {
              waterSpanClear = false;
            }
          }

          if (waterSpanClear) {
            const spanBridgeElevation = Math.max(
              1,
              leftShore.elevation,
              rightShore.elevation
            );
            bridgeShoreIndices.add(wStart - 1);
            bridgeShoreIndices.add(wEnd + 1);
            for (let k = wStart; k <= wEnd; k++) {
              validBridgeWaterIndices.add(k);
              spanElevationByIndex.set(k, spanBridgeElevation);
            }
          }
        }
      }
    }

    const planned: Array<{
      x: number;
      y: number;
      isBridge: boolean;
      axis?: 'X' | 'Y';
      bridgeElevation?: number;
      needsApply?: boolean;
      cost: number;
    }> = [];

    const selectedSpec = BRIDGE_CATALOG[bridgeType] ?? BRIDGE_CATALOG.STEEL;
    const bridgeUnitCost =
      baseMode === 'RAIL'
        ? selectedSpec.railCostPerTile
        : selectedSpec.roadCostPerTile;

    for (let idx = 0; idx < workingPts.length; idx++) {
      const pt = workingPts[idx];
      const tile =
        this.state.tiles[tileIndex(pt.x, pt.y, this.state.mapSize)];

      if (tile.terrain === 'WATER') {
        if (!validBridgeWaterIndices.has(idx) || !axis) continue;
        const spanElev = spanElevationByIndex.get(idx) ?? 1;
        const alreadySameBridge =
          tile.bridge === baseMode && tile.bridgeAxis === axis;

        let tileCost = bridgeUnitCost;
        let needsApply = true;

        if (alreadySameBridge) {
          const existingType: BridgeType = tile.bridgeType ?? 'STEEL';
          const existingSpec =
            BRIDGE_CATALOG[existingType] ?? BRIDGE_CATALOG.STEEL;
          const existingUnitCost =
            baseMode === 'RAIL'
              ? existingSpec.railCostPerTile
              : existingSpec.roadCostPerTile;

          if (existingType !== bridgeType && bridgeUnitCost > existingUnitCost) {
            tileCost = bridgeUnitCost - existingUnitCost;
            needsApply = true;
          } else {
            tileCost = 0;
            needsApply = false;
          }
        }

        planned.push({
          x: pt.x,
          y: pt.y,
          isBridge: true,
          axis,
          bridgeElevation: spanElev,
          needsApply,
          cost: tileCost,
        });
      } else {
        if (isExplicitBridge && !bridgeShoreIndices.has(idx)) {
          continue;
        }
        const landCheck = this.canLandTileAnchorOrBuild(tile, baseMode);
        if (!landCheck.ok) continue;
        planned.push({
          x: pt.x,
          y: pt.y,
          isBridge: false,
          cost: landCheck.buildCost,
        });
      }
    }

    return planned;
  }

  public previewDragPath(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    tool: DragTrackTool,
    bridgeType: BridgeType = 'STEEL'
  ): DragPreviewResult {
    const normalizedBridgeType: BridgeType =
      bridgeType === 'WOOD' || bridgeType === 'STEEL' || bridgeType === 'MODERN'
        ? bridgeType
        : 'STEEL';
    const line = computeDragLineTiles(fromX, fromY, toX, toY, this.state.mapSize);
    const planned = this.planDragTrackOrBridge(line, tool, normalizedBridgeType);
    const isExplicitBridge =
      tool === 'RAIL_BRIDGE' || tool === 'ROAD_BRIDGE';
    const bridgeTileCount = planned.filter((p) => p.isBridge).length;

    if (isExplicitBridge && bridgeTileCount === 0) {
      return {
        ok: false,
        tiles: [],
        cost: 0,
        bridgeTileCount: 0,
        reason: 'Dra broen i rett linje fra kyst til kyst over vannet (1–24 ruter).',
      };
    }

    let cost = 0;
    const validTiles: Array<{ x: number; y: number }> = [];
    for (const item of planned) {
      validTiles.push({ x: item.x, y: item.y });
      cost += item.cost;
    }

    if (validTiles.length === 0) {
      return {
        ok: false,
        tiles: [],
        cost: 0,
        bridgeTileCount: 0,
        reason: 'Kan ikke bygge på denne traséen.',
      };
    }

    return {
      ok: true,
      tiles: validTiles,
      cost,
      bridgeTileCount,
    };
  }

  /**
   * Supports both:
   * - `applyDragTrackOrRoad(fromX, fromY, toX, toY, tool, bridgeType = 'STEEL')`
   * - `applyDragTrackOrRoad(tilesArray, tool, bridgeType = 'STEEL')`
   */
  public applyDragTrackOrRoad(
    arg1: number | Array<{ x: number; y: number }>,
    arg2: number | DragTrackTool,
    arg3?: number | BridgeType,
    toY?: number,
    toolArg?: DragTrackTool,
    bridgeTypeArg?: BridgeType
  ): ActionResult {
    let points: GridPoint[];
    let tool: DragTrackTool;
    let bridgeType: BridgeType = 'STEEL';

    if (Array.isArray(arg1)) {
      points = arg1;
      tool = typeof arg2 === 'string' ? arg2 : 'ROAD';
      if (arg3 === 'WOOD' || arg3 === 'STEEL' || arg3 === 'MODERN') {
        bridgeType = arg3;
      }
    } else {
      const fx = arg1;
      const fy = typeof arg2 === 'number' ? arg2 : 0;
      const tx = typeof arg3 === 'number' ? arg3 : fx;
      const ty = toY ?? fy;
      tool = toolArg ?? 'ROAD';
      if (
        bridgeTypeArg === 'WOOD' ||
        bridgeTypeArg === 'STEEL' ||
        bridgeTypeArg === 'MODERN'
      ) {
        bridgeType = bridgeTypeArg;
      }
      points = computeDragLineTiles(fx, fy, tx, ty, this.state.mapSize);
    }

    const baseMode: 'RAIL' | 'ROAD' =
      tool === 'RAIL' || tool === 'RAIL_BRIDGE' ? 'RAIL' : 'ROAD';
    const isExplicitBridge =
      tool === 'RAIL_BRIDGE' || tool === 'ROAD_BRIDGE';

    const planned = this.planDragTrackOrBridge(points, tool, bridgeType);
    const hasBridgeSpan = planned.some((p) => p.isBridge);

    if (isExplicitBridge && !hasBridgeSpan) {
      return {
        ok: false,
        cost: 0,
        message: 'Dra broen i rett linje fra kyst til kyst over vannet (1–24 ruter).',
      };
    }

    const plannedTotalCost = planned.reduce((sum, p) => sum + p.cost, 0);
    if (hasBridgeSpan && this.state.corporate.cash < plannedTotalCost) {
      return {
        ok: false,
        cost: 0,
        message: `Ikke nok selskapskontanter til å bygge broen (${formatKr(plannedTotalCost)} kreves).`,
      };
    }

    let builtCount = 0;
    let bridgeBuiltCount = 0;
    let totalCost = 0;
    let lastPt: GridPoint | null = null;

    for (const item of planned) {
      if (item.isBridge) {
        const tile =
          this.state.tiles[tileIndex(item.x, item.y, this.state.mapSize)];
        if (item.needsApply && item.cost > 0) {
          if (this.state.corporate.cash < item.cost) break;
          this.state.corporate.cash -= item.cost;
          this.state.corporate.currentYearPnL.constructionCost += item.cost;
          tile.terrain = 'WATER';
          tile.elevation = 0;
          tile.bridge = baseMode;
          tile.bridgeAxis = item.axis;
          tile.bridgeType = bridgeType;
          tile.bridgeElevation = item.bridgeElevation ?? 1;
          tile.road = baseMode === 'ROAD';
          tile.rail = baseMode === 'RAIL';
          tile.signal = false;
          tile.signalBlocked = false;
          if (!tile.ownerId) {
            tile.ownerId = 'player';
          }
          builtCount++;
          bridgeBuiltCount++;
          totalCost += item.cost;
          lastPt = { x: item.x, y: item.y };
        }
      } else {
        const res = this.buildSingleTrackOrRoadTile(
          item.x,
          item.y,
          baseMode,
          false
        );
        if (res.ok && (res.cost ?? 0) > 0) {
          builtCount++;
          totalCost += res.cost ?? 0;
          lastPt = { x: item.x, y: item.y };
        }
      }
    }

    if (builtCount > 0 && lastPt) {
      this.pushFloatingPopup(
        lastPt.x,
        lastPt.y,
        `-kr ${formatNorwegianNumber(totalCost)}`,
        'red'
      );
      this.state.networkRevision = (this.state.networkRevision ?? 0) + 1;
      recomputeValuationsAndWarnings(this.state);
      this.emit();
      const bSpec = BRIDGE_CATALOG[bridgeType] ?? BRIDGE_CATALOG.STEEL;
      const label =
        bridgeBuiltCount > 0
          ? `${bSpec.nameNo.toLowerCase()} (${bridgeBuiltCount} vannruter)`
          : baseMode === 'RAIL'
            ? 'jernbane'
            : 'vei';
      return {
        ok: true,
        cost: totalCost,
        message: `Bygget ${builtCount} ruter ${label} (${formatKr(totalCost)}).`,
      };
    }

    return {
      ok: planned.length > 0 && plannedTotalCost === 0,
      cost: 0,
      message: 'Ingen nye ruter ble bygget.',
    };
  }

  private buildSingleTrackOrRoadTile(
    x: number,
    y: number,
    tool: 'RAIL' | 'ROAD',
    emitPopup: boolean
  ): ActionResult {
    const tile = this.state.tiles[tileIndex(x, y, this.state.mapSize)];
    if (
      tile.terrain === 'WATER' ||
      tile.bridge ||
      tile.industryId ||
      tile.hqOwnerId ||
      tile.depot ||
      tile.stationId ||
      (tile.buildingTier ?? 0) > 0 ||
      (tool === 'ROAD' && tile.signal)
    ) {
      return { ok: false, message: 'Kan ikke bygge på denne ruten.' };
    }

    if (tool === 'ROAD' && tile.road) {
      return { ok: true, cost: 0 };
    }
    if (tool === 'RAIL' && tile.rail) {
      return { ok: true, cost: 0 };
    }

    const cost = BUILD_COSTS[tool];
    if (this.state.corporate.cash < cost) {
      return { ok: false, message: 'Ikke nok selskapskontanter!' };
    }

    this.state.corporate.cash -= cost;
    this.state.corporate.currentYearPnL.constructionCost += cost;

    tile.terrain = 'GRASS';
    if (!tile.ownerId) {
      tile.ownerId = 'player';
    }
    if (tool === 'ROAD') {
      tile.road = true;
    } else {
      tile.rail = true;
    }

    if (emitPopup) {
      this.pushFloatingPopup(x, y, `-kr ${formatNorwegianNumber(cost)}`, 'red');
      this.state.networkRevision = (this.state.networkRevision ?? 0) + 1;
      recomputeValuationsAndWarnings(this.state);
    }

    return { ok: true, cost };
  }

  private spendCorporateConstruction(cost: number, x: number, y: number): void {
    this.state.corporate.cash -= cost;
    this.state.corporate.currentYearPnL.constructionCost += cost;
    this.pushFloatingPopup(x, y, `-kr ${formatNorwegianNumber(cost)}`, 'red');
    recomputeValuationsAndWarnings(this.state);
  }

  // ============================================================================
  // Fleet & Orders Management
  // ============================================================================

  /**
   * Flexible `buyVehicle` supporting either `BuyVehicleParams` object OR positional arguments:
   * `buyVehicle({ depotX, depotY, modelId, cargoType, wagonCount, orders })`
   * OR `buyVehicle(modelId, cargoType?, wagonCount?, depotTile?)`
   */
  public buyVehicle(
    paramsOrModel: BuyVehicleParams | VehicleModelId,
    cargoTypeArg?: CargoType,
    wagonCountArg?: number,
    depotTileArg?: { x: number; y: number }
  ): ActionResult {
    let modelId: VehicleModelId;
    let cargoType: CargoType | undefined;
    let wagonCount: number;
    let depotX: number | undefined;
    let depotY: number | undefined;
    let orders: string[] = [];

    let waitForFullLoad = false;

    if (typeof paramsOrModel === 'string') {
      modelId = paramsOrModel;
      cargoType = cargoTypeArg;
      wagonCount = wagonCountArg ?? 3;
      depotX = depotTileArg?.x;
      depotY = depotTileArg?.y;
    } else {
      modelId = paramsOrModel.modelId;
      cargoType = paramsOrModel.cargoType;
      wagonCount = paramsOrModel.wagonCount ?? 3;
      depotX = paramsOrModel.depotX;
      depotY = paramsOrModel.depotY;
      orders = paramsOrModel.orders ?? [];
      waitForFullLoad = Boolean(paramsOrModel.waitForFullLoad);
    }

    const spec = VEHICLE_CATALOG[modelId];
    if (!spec) {
      return { ok: false, message: 'Ukjent kjøretøymodell.' };
    }

    // Locate depot tile
    let depotTile =
      depotX !== undefined &&
      depotY !== undefined &&
      inBounds(depotX, depotY, this.state.mapSize)
        ? this.state.tiles[tileIndex(depotX, depotY, this.state.mapSize)]
        : undefined;

    if (!depotTile || depotTile.depot !== spec.network) {
      depotTile = this.state.tiles.find(
        (t) => t.depot === spec.network && (!t.ownerId || t.ownerId === 'player')
      );
    }

    if (!depotTile) {
      return {
        ok: false,
        message:
          spec.network === 'RAIL'
            ? 'Bygg et togdepot før du kjøper lokomotiv!'
            : 'Bygg et veidepot før du kjøper buss eller lastebil!',
      };
    }

    const roundedWagons = Math.round(wagonCount);
    const clampedWagons =
      spec.network === 'RAIL'
        ? roundedWagons <= 0
          ? 0
          : Math.max(1, Math.min(6, roundedWagons))
        : 0;
    const selectedCargo =
      cargoType && spec.supportedCargos.includes(cargoType)
        ? cargoType
        : spec.defaultCargo;

    const totalCost = calculateVehiclePurchaseCost(modelId, clampedWagons);
    if (this.state.corporate.cash < totalCost) {
      return {
        ok: false,
        message: `Ikke nok selskapskontanter (${formatKr(totalCost)} kreves).`,
      };
    }

    this.state.corporate.cash -= totalCost;
    this.state.corporate.currentYearPnL.vehiclePurchaseCost += totalCost;

    const capacity = calculateVehicleCapacity(modelId, clampedWagons);
    const annualRunCost = calculateVehicleBaseAnnualCost(modelId, clampedWagons);
    const playerFleetCount =
      this.state.vehicles.filter(
        (v) => v.ownerId === 'player' && v.network === spec.network
      ).length + 1;

    const labelPrefix =
      spec.network === 'RAIL'
        ? 'Tog'
        : modelId === 'BUS_CITY'
          ? 'Buss'
          : 'Lastebil';

    const validOrders = orders.filter((id) =>
      this.state.stations.some((s) => s.id === id)
    );

    const vehPrefix =
      this.localIdentity && this.localIdentity.clientId !== 'player'
        ? `${this.localIdentity.clientId}-`
        : '';
    const vehId = `veh-${vehPrefix}${this.state.vehicles.length + 1}-${Math.random()
      .toString(36)
      .slice(2, 5)}`;

    const builtWagons: TrainWagon[] | undefined =
      spec.network === 'RAIL'
        ? Array.from({ length: clampedWagons }, (_, idx) => ({
            id: `${vehId}-w-${idx + 1}`,
            cargoType: selectedCargo,
            capacity: spec.capacityPerWagon,
            cargoAmount: 0,
            cargoOriginStationId: null,
            cargoLoadedDay: this.state.date.totalDays,
            purchaseValue: spec.wagonPrice,
            annualRunningCost: spec.runningCostPerWagon,
          }))
        : undefined;

    const cargoLabel =
      spec.network === 'RAIL' && clampedWagons === 0
        ? 'Uten vogner'
        : CARGO_LABELS_NO[selectedCargo];

    const canDispatchImmediately =
      validOrders.length > 0 &&
      !(spec.network === 'RAIL' && clampedWagons === 0);

    const vehicle: Vehicle = {
      id: vehId,
      name: `${labelPrefix} #${playerFleetCount} (${cargoLabel})`,
      ownerId: 'player',
      network: spec.network,
      modelId,
      cargoType: selectedCargo,
      capacity,
      cargoAmount: 0,
      cargoOriginStationId: null,
      cargoLoadedDay: this.state.date.totalDays,
      x: depotTile.x,
      y: depotTile.y,
      nextX: depotTile.x,
      nextY: depotTile.y,
      progress: 0,
      direction: 0,
      speedKmh: 0,
      maxSpeedKmh: spec.maxSpeedKmh,
      state: canDispatchImmediately ? 'MOVING' : 'IN_DEPOT',
      orders: validOrders,
      currentOrderIndex: 0,
      path: [],
      profitThisYear: 0,
      runningCostPerMonth: Math.round(annualRunCost / 12),
      baseAnnualRunningCost: annualRunCost,
      purchaseValue: totalCost,
      ageMonths: 0,
      wagonCount: clampedWagons,
      wagons: builtWagons,
      wt: builtWagons ? builtWagons.map((w) => w.cargoType) : undefined,
      goingToDepot: null,
      trail: [{ x: depotTile.x, y: depotTile.y }],
      depotX: depotTile.x,
      depotY: depotTile.y,
      loadingTicksRemaining: 0,
      waitForFullLoad,
      accelTicks: 0,
      fullLoadWaitTicks: 0,
    };

    this.state.vehicles.push(vehicle);
    this.pushFloatingPopup(
      depotTile.x,
      depotTile.y,
      `-kr ${formatNorwegianNumber(totalCost)}`,
      'red'
    );
    recomputeValuationsAndWarnings(this.state);
    this.emit();

    return {
      ok: true,
      cost: totalCost,
      vehicleId: vehicle.id,
      message: `Kjøpte ${vehicle.name} for ${formatKr(totalCost)}.`,
    };
  }

  private resolvePlayerDepotTile(
    depotX: number | undefined,
    depotY: number | undefined,
    network: 'ROAD' | 'RAIL'
  ): Tile | undefined {
    if (
      depotX !== undefined &&
      depotY !== undefined &&
      inBounds(depotX, depotY, this.state.mapSize)
    ) {
      const t = this.state.tiles[tileIndex(depotX, depotY, this.state.mapSize)];
      if (t.depot === network && (!t.ownerId || t.ownerId === 'player')) {
        return t;
      }
    }
    return this.state.tiles.find(
      (t) => t.depot === network && (!t.ownerId || t.ownerId === 'player')
    );
  }

  /**
   * OpenTTD Separate Locomotive Purchase (`0` wagons, parked `IN_DEPOT` at `(depotX, depotY)`).
   */
  public buyLocomotive(
    depotX: number,
    depotY: number,
    modelId: 'LOCO_STEAM' | 'LOCO_DIESEL' | 'LOCO_ELECTRIC'
  ): ActionResult {
    const spec = VEHICLE_CATALOG[modelId];
    if (!spec || spec.network !== 'RAIL') {
      return { ok: false, message: 'Ugyldig lokomotivmodell.' };
    }

    const depotTile = this.resolvePlayerDepotTile(depotX, depotY, 'RAIL');
    if (!depotTile) {
      return {
        ok: false,
        message: 'Bygg et togdepot før du kjøper lokomotiv!',
      };
    }

    const price = spec.price;
    if (this.state.corporate.cash < price) {
      return {
        ok: false,
        message: `Ikke nok selskapskontanter (${formatKr(price)} kreves).`,
      };
    }

    this.state.corporate.cash -= price;
    this.state.corporate.currentYearPnL.vehiclePurchaseCost += price;

    const playerTrainCount =
      this.state.vehicles.filter(
        (v) => v.ownerId === 'player' && v.network === 'RAIL'
      ).length + 1;

    const vehPrefix =
      this.localIdentity && this.localIdentity.clientId !== 'player'
        ? `${this.localIdentity.clientId}-`
        : '';
    const vehId = `veh-${vehPrefix}${this.state.vehicles.length + 1}-${Math.random()
      .toString(36)
      .slice(2, 5)}`;

    const vehicle: Vehicle = {
      id: vehId,
      name: `Tog #${playerTrainCount} (Uten vogner)`,
      ownerId: 'player',
      network: 'RAIL',
      modelId,
      cargoType: spec.defaultCargo,
      capacity: 0,
      cargoAmount: 0,
      cargoOriginStationId: null,
      cargoLoadedDay: this.state.date.totalDays,
      x: depotTile.x,
      y: depotTile.y,
      nextX: depotTile.x,
      nextY: depotTile.y,
      progress: 0,
      direction: 0,
      speedKmh: 0,
      maxSpeedKmh: spec.maxSpeedKmh,
      state: 'IN_DEPOT',
      orders: [],
      currentOrderIndex: 0,
      path: [],
      profitThisYear: 0,
      runningCostPerMonth: Math.round(spec.annualRunningCost / 12),
      baseAnnualRunningCost: spec.annualRunningCost,
      purchaseValue: price,
      ageMonths: 0,
      wagonCount: 0,
      wagons: [],
      wt: [],
      goingToDepot: null,
      trail: [{ x: depotTile.x, y: depotTile.y }],
      depotX: depotTile.x,
      depotY: depotTile.y,
      loadingTicksRemaining: 0,
      waitForFullLoad: false,
      accelTicks: 0,
      fullLoadWaitTicks: 0,
    };

    this.state.vehicles.push(vehicle);
    this.pushFloatingPopup(
      depotTile.x,
      depotTile.y,
      `-kr ${formatNorwegianNumber(price)}`,
      'red'
    );
    recomputeValuationsAndWarnings(this.state);
    this.emit();

    return {
      ok: true,
      cost: price,
      vehicleId: vehicle.id,
      message: `Kjøpte ${spec.nameNo} uten vogner (${formatKr(price)}). Velg og koble på vogner i depoet!`,
    };
  }

  /**
   * OpenTTD Specialized Road Vehicle Shop (`ROAD_VEHICLE_SHOP_LIST`, parked `IN_DEPOT` at `(depotX, depotY)`).
   */
  public buyRoadVehicle(
    depotX: number,
    depotY: number,
    shopIdOrCargo: string
  ): ActionResult {
    const key = (shopIdOrCargo || '').trim().toUpperCase();
    const shopSpec = ROAD_VEHICLE_SHOP_LIST.find(
      (item) =>
        item.shopId.toUpperCase() === key ||
        item.cargoType.toUpperCase() === key ||
        (key === 'BUS_CITY' && item.modelId === 'BUS_CITY')
    );
    if (!shopSpec) {
      return { ok: false, message: 'Ukjent veikjøretøy i katalogen.' };
    }

    const depotTile = this.resolvePlayerDepotTile(depotX, depotY, 'ROAD');
    if (!depotTile) {
      return {
        ok: false,
        message: 'Bygg et veidepot før du kjøper buss eller lastebil!',
      };
    }

    const price = shopSpec.price;
    if (this.state.corporate.cash < price) {
      return {
        ok: false,
        message: `Ikke nok selskapskontanter (${formatKr(price)} kreves).`,
      };
    }

    this.state.corporate.cash -= price;
    this.state.corporate.currentYearPnL.vehiclePurchaseCost += price;

    const playerRoadCount =
      this.state.vehicles.filter(
        (v) => v.ownerId === 'player' && v.network === 'ROAD'
      ).length + 1;
    const labelPrefix = shopSpec.modelId === 'BUS_CITY' ? 'Buss' : 'Lastebil';

    const vehPrefix =
      this.localIdentity && this.localIdentity.clientId !== 'player'
        ? `${this.localIdentity.clientId}-`
        : '';
    const vehId = `veh-${vehPrefix}${this.state.vehicles.length + 1}-${Math.random()
      .toString(36)
      .slice(2, 5)}`;

    const vehicle: Vehicle = {
      id: vehId,
      name: `${labelPrefix} #${playerRoadCount} (${CARGO_LABELS_NO[shopSpec.cargoType]})`,
      ownerId: 'player',
      network: 'ROAD',
      modelId: shopSpec.modelId,
      cargoType: shopSpec.cargoType,
      capacity: shopSpec.capacity,
      cargoAmount: 0,
      cargoOriginStationId: null,
      cargoLoadedDay: this.state.date.totalDays,
      x: depotTile.x,
      y: depotTile.y,
      nextX: depotTile.x,
      nextY: depotTile.y,
      progress: 0,
      direction: 0,
      speedKmh: 0,
      maxSpeedKmh: shopSpec.maxSpeedKmh,
      state: 'IN_DEPOT',
      orders: [],
      currentOrderIndex: 0,
      path: [],
      profitThisYear: 0,
      runningCostPerMonth: Math.round(shopSpec.annualRunningCost / 12),
      baseAnnualRunningCost: shopSpec.annualRunningCost,
      purchaseValue: price,
      ageMonths: 0,
      wagonCount: 0,
      goingToDepot: null,
      trail: [{ x: depotTile.x, y: depotTile.y }],
      depotX: depotTile.x,
      depotY: depotTile.y,
      loadingTicksRemaining: 0,
      waitForFullLoad: false,
      accelTicks: 0,
      fullLoadWaitTicks: 0,
    };

    this.state.vehicles.push(vehicle);
    this.pushFloatingPopup(
      depotTile.x,
      depotTile.y,
      `-kr ${formatNorwegianNumber(price)}`,
      'red'
    );
    recomputeValuationsAndWarnings(this.state);
    this.emit();

    return {
      ok: true,
      cost: price,
      vehicleId: vehicle.id,
      message: `Kjøpte ${shopSpec.nameNo} for ${formatKr(price)}.`,
    };
  }

  /**
   * OpenTTD Separate Rail Wagon Purchase — either coupled directly onto a train `IN_DEPOT`
   * at `(depotX, depotY)` or placed onto the depot's spare siding (`state.depotWagons`).
   */
  public buyRailWagon(
    depotX: number,
    depotY: number,
    cargoType: CargoType,
    attachToVehicleId?: string | null
  ): ActionResult & { wagonId?: string } {
    const wSpec = RAIL_WAGON_CATALOG[cargoType];
    if (!wSpec) {
      return { ok: false, message: 'Ugyldig vogntype.' };
    }

    const depotTile = this.resolvePlayerDepotTile(depotX, depotY, 'RAIL');
    if (!depotTile) {
      return {
        ok: false,
        message: 'Fant ikke et gyldig togdepot på denne ruten.',
      };
    }

    let targetTrain: Vehicle | undefined;
    if (attachToVehicleId) {
      targetTrain = this.state.vehicles.find(
        (v) =>
          v.id === attachToVehicleId &&
          v.ownerId === 'player' &&
          v.network === 'RAIL'
      );
      if (
        !targetTrain ||
        targetTrain.state !== 'IN_DEPOT' ||
        targetTrain.x !== depotTile.x ||
        targetTrain.y !== depotTile.y
      ) {
        return {
          ok: false,
          message:
            'Valgt tog må stå inne i dette togdepoet for å koble på vogner.',
        };
      }
      const existingWagons = this.ensureTrainWagons(targetTrain);
      if (existingWagons.length >= MAX_TRAIN_WAGONS) {
        return {
          ok: false,
          message: `Toget har allerede maks antall vogner (${MAX_TRAIN_WAGONS} vogner)!`,
        };
      }
    }

    if (this.state.corporate.cash < wSpec.price) {
      return {
        ok: false,
        message: `Ikke nok selskapskontanter (${formatKr(wSpec.price)} kreves).`,
      };
    }

    this.state.corporate.cash -= wSpec.price;
    this.state.corporate.currentYearPnL.vehiclePurchaseCost += wSpec.price;

    const wagonId = `wag-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;

    if (targetTrain) {
      const wagons = this.ensureTrainWagons(targetTrain);
      wagons.push({
        id: wagonId,
        cargoType,
        capacity: wSpec.capacity,
        cargoAmount: 0,
        cargoOriginStationId: null,
        cargoLoadedDay: this.state.date.totalDays,
        purchaseValue: wSpec.price,
        annualRunningCost: wSpec.annualRunningCost,
      });
      this.recomputeTrainConsistStats(targetTrain);
      this.pushFloatingPopup(
        depotTile.x,
        depotTile.y,
        `-kr ${formatNorwegianNumber(wSpec.price)}`,
        'red'
      );
      recomputeValuationsAndWarnings(this.state);
      this.emit();
      return {
        ok: true,
        cost: wSpec.price,
        vehicleId: targetTrain.id,
        wagonId,
        message: `Kjøpte ${wSpec.nameNo} og koblet på ${targetTrain.name}.`,
      };
    }

    if (!this.state.depotWagons) {
      this.state.depotWagons = [];
    }
    const stored: DepotStoredWagon = {
      id: wagonId,
      depotX: depotTile.x,
      depotY: depotTile.y,
      cargoType,
      capacity: wSpec.capacity,
      purchaseValue: wSpec.price,
      annualRunningCost: wSpec.annualRunningCost,
    };
    this.state.depotWagons.push(stored);

    this.pushFloatingPopup(
      depotTile.x,
      depotTile.y,
      `-kr ${formatNorwegianNumber(wSpec.price)}`,
      'red'
    );
    recomputeValuationsAndWarnings(this.state);
    this.emit();

    return {
      ok: true,
      cost: wSpec.price,
      wagonId,
      message: `Kjøpte ${wSpec.nameNo} til sidespor i depoet.`,
    };
  }

  public attachDepotWagonToTrain(
    wagonId: string,
    vehicleId: string,
    insertIndex?: number
  ): ActionResult {
    if (!this.state.depotWagons) {
      this.state.depotWagons = [];
    }
    const storedIdx = this.state.depotWagons.findIndex((w) => w.id === wagonId);
    if (storedIdx === -1) {
      return { ok: false, message: 'Fant ikke den ledige vognen i depoet.' };
    }
    const stored = this.state.depotWagons[storedIdx];

    const train = this.state.vehicles.find(
      (v) =>
        v.id === vehicleId && v.ownerId === 'player' && v.network === 'RAIL'
    );
    if (
      !train ||
      train.state !== 'IN_DEPOT' ||
      train.x !== stored.depotX ||
      train.y !== stored.depotY
    ) {
      return {
        ok: false,
        message: 'Toget må stå inne i samme togdepot som vognen!',
      };
    }

    const wagons = this.ensureTrainWagons(train);
    if (wagons.length >= MAX_TRAIN_WAGONS) {
      return {
        ok: false,
        message: `Toget har allerede maks antall vogner (${MAX_TRAIN_WAGONS} vogner)!`,
      };
    }

    this.state.depotWagons.splice(storedIdx, 1);
    const coupled: TrainWagon = {
      id: stored.id,
      cargoType: stored.cargoType,
      capacity: stored.capacity,
      cargoAmount: 0,
      cargoOriginStationId: null,
      cargoLoadedDay: this.state.date.totalDays,
      purchaseValue: stored.purchaseValue,
      annualRunningCost: stored.annualRunningCost,
    };
    const clampedIdx =
      insertIndex === undefined
        ? wagons.length
        : Math.max(0, Math.min(wagons.length, Math.round(insertIndex)));
    wagons.splice(clampedIdx, 0, coupled);

    this.recomputeTrainConsistStats(train);
    recomputeValuationsAndWarnings(this.state);
    this.emit();

    return {
      ok: true,
      vehicleId: train.id,
      message: `Koblet ${RAIL_WAGON_CATALOG[stored.cargoType].shortNameNo} på ${train.name}.`,
    };
  }

  public detachTrainWagonToDepot(
    vehicleId: string,
    wagonId: string
  ): ActionResult {
    const train = this.state.vehicles.find(
      (v) =>
        v.id === vehicleId && v.ownerId === 'player' && v.network === 'RAIL'
    );
    if (!train || train.state !== 'IN_DEPOT') {
      return {
        ok: false,
        message: 'Toget må stå inne i et togdepot for å koble fra vogner!',
      };
    }

    const wagons = this.ensureTrainWagons(train);
    const idx = wagons.findIndex((w) => w.id === wagonId);
    if (idx === -1) {
      return { ok: false, message: 'Fant ikke vognen på toget.' };
    }

    const [removed] = wagons.splice(idx, 1);
    if (!this.state.depotWagons) {
      this.state.depotWagons = [];
    }
    this.state.depotWagons.push({
      id: removed.id,
      depotX: train.x,
      depotY: train.y,
      cargoType: removed.cargoType,
      capacity: removed.capacity,
      purchaseValue: removed.purchaseValue,
      annualRunningCost: removed.annualRunningCost,
    });

    this.recomputeTrainConsistStats(train);
    recomputeValuationsAndWarnings(this.state);
    this.emit();

    return {
      ok: true,
      vehicleId: train.id,
      message: `Koblet fra ${RAIL_WAGON_CATALOG[removed.cargoType].shortNameNo} til sidesporet i depoet.`,
    };
  }

  public moveTrainWagon(
    fromVehicleId: string,
    wagonId: string,
    toVehicleId: string,
    insertIndex?: number
  ): ActionResult {
    const fromTrain = this.state.vehicles.find(
      (v) =>
        v.id === fromVehicleId &&
        v.ownerId === 'player' &&
        v.network === 'RAIL'
    );
    const toTrain = this.state.vehicles.find(
      (v) =>
        v.id === toVehicleId && v.ownerId === 'player' && v.network === 'RAIL'
    );
    if (
      !fromTrain ||
      !toTrain ||
      fromTrain.state !== 'IN_DEPOT' ||
      toTrain.state !== 'IN_DEPOT' ||
      fromTrain.x !== toTrain.x ||
      fromTrain.y !== toTrain.y
    ) {
      return {
        ok: false,
        message: 'Begge tog må stå inne i samme togdepot for å flytte vogner.',
      };
    }

    const fromWagons = this.ensureTrainWagons(fromTrain);
    const srcIdx = fromWagons.findIndex((w) => w.id === wagonId);
    if (srcIdx === -1) {
      return { ok: false, message: 'Fant ikke vognen på toget.' };
    }

    if (fromVehicleId === toVehicleId) {
      const [wag] = fromWagons.splice(srcIdx, 1);
      const targetIdx =
        insertIndex === undefined
          ? fromWagons.length
          : Math.max(0, Math.min(fromWagons.length, Math.round(insertIndex)));
      fromWagons.splice(targetIdx, 0, wag);
      this.recomputeTrainConsistStats(fromTrain);
      this.emit();
      return {
        ok: true,
        vehicleId: fromTrain.id,
        message: 'Endret vognrekkefølgen på toget.',
      };
    }

    const toWagons = this.ensureTrainWagons(toTrain);
    if (toWagons.length >= MAX_TRAIN_WAGONS) {
      return {
        ok: false,
        message: `Måltoget har allerede maks antall vogner (${MAX_TRAIN_WAGONS} vogner)!`,
      };
    }

    const [wag] = fromWagons.splice(srcIdx, 1);
    const targetIdx =
      insertIndex === undefined
        ? toWagons.length
        : Math.max(0, Math.min(toWagons.length, Math.round(insertIndex)));
    toWagons.splice(targetIdx, 0, wag);

    this.recomputeTrainConsistStats(fromTrain);
    this.recomputeTrainConsistStats(toTrain);
    recomputeValuationsAndWarnings(this.state);
    this.emit();

    return {
      ok: true,
      vehicleId: toTrain.id,
      message: `Flyttet ${RAIL_WAGON_CATALOG[wag.cargoType].shortNameNo} til ${toTrain.name}.`,
    };
  }

  public sellTrainWagon(vehicleId: string, wagonId: string): ActionResult {
    const train = this.state.vehicles.find(
      (v) =>
        v.id === vehicleId && v.ownerId === 'player' && v.network === 'RAIL'
    );
    if (!train || train.state !== 'IN_DEPOT') {
      return {
        ok: false,
        message: 'Toget må stå inne i depoet for å selge enkeltvogner!',
      };
    }

    const wagons = this.ensureTrainWagons(train);
    const idx = wagons.findIndex((w) => w.id === wagonId);
    if (idx === -1) {
      return { ok: false, message: 'Fant ikke vognen på toget.' };
    }

    const [wag] = wagons.splice(idx, 1);
    const refund = Math.round(wag.purchaseValue * 0.85);
    this.state.corporate.cash += refund;

    this.recomputeTrainConsistStats(train);
    this.pushFloatingPopup(
      train.x,
      train.y,
      `+kr ${formatNorwegianNumber(refund)}`,
      'green'
    );
    recomputeValuationsAndWarnings(this.state);
    this.emit();

    return {
      ok: true,
      cost: -refund,
      vehicleId: train.id,
      message: `Solgte ${RAIL_WAGON_CATALOG[wag.cargoType].shortNameNo} for ${formatKr(refund)} (85 %).`,
    };
  }

  public sellDepotWagon(wagonId: string): ActionResult {
    if (!this.state.depotWagons) {
      this.state.depotWagons = [];
    }
    const idx = this.state.depotWagons.findIndex((w) => w.id === wagonId);
    if (idx === -1) {
      return { ok: false, message: 'Fant ikke vognen på sidesporet.' };
    }

    const [wag] = this.state.depotWagons.splice(idx, 1);
    const refund = Math.round(wag.purchaseValue * 0.85);
    this.state.corporate.cash += refund;

    this.pushFloatingPopup(
      wag.depotX,
      wag.depotY,
      `+kr ${formatNorwegianNumber(refund)}`,
      'green'
    );
    recomputeValuationsAndWarnings(this.state);
    this.emit();

    return {
      ok: true,
      cost: -refund,
      message: `Solgte ${RAIL_WAGON_CATALOG[wag.cargoType].shortNameNo} fra depoet for ${formatKr(refund)} (85 %).`,
    };
  }

  public refitRoadVehicleInDepot(
    vehicleId: string,
    newCargoType: CargoType
  ): ActionResult {
    const vehicle = this.state.vehicles.find(
      (v) =>
        v.id === vehicleId && v.ownerId === 'player' && v.network === 'ROAD'
    );
    if (!vehicle) {
      return { ok: false, message: 'Fant ikke kjøretøyet.' };
    }
    if (vehicle.modelId !== 'TRUCK_CARGO') {
      return {
        ok: false,
        message: 'Kun godslastebiler kan bygges om til ny lasttype.',
      };
    }
    if (vehicle.state !== 'IN_DEPOT') {
      return {
        ok: false,
        message: 'Lastebilen må stå inne i et veidepot for ombygging!',
      };
    }
    if (newCargoType === 'PASSENGERS') {
      return {
        ok: false,
        message: 'Lastebil kan ikke bygges om til passasjerbuss.',
      };
    }
    if (vehicle.cargoType === newCargoType) {
      return {
        ok: true,
        cost: 0,
        vehicleId: vehicle.id,
        message: 'Lastebilen er allerede rigget for denne lasttypen.',
      };
    }
    if (this.state.corporate.cash < ROAD_REFIT_COST_KR) {
      return {
        ok: false,
        message: `Ikke nok selskapskontanter (${formatKr(ROAD_REFIT_COST_KR)} kreves for ombygging).`,
      };
    }

    this.state.corporate.cash -= ROAD_REFIT_COST_KR;
    this.state.corporate.currentYearPnL.vehicleRunningCost +=
      ROAD_REFIT_COST_KR;

    const targetShop = ROAD_VEHICLE_SHOP_LIST.find(
      (item) =>
        item.modelId === 'TRUCK_CARGO' && item.cargoType === newCargoType
    );

    vehicle.cargoType = newCargoType;
    vehicle.cargoAmount = 0;
    vehicle.cargoOriginStationId = null;
    if (targetShop) {
      vehicle.capacity = targetShop.capacity;
      vehicle.maxSpeedKmh = targetShop.maxSpeedKmh;
      vehicle.baseAnnualRunningCost = targetShop.annualRunningCost;
      vehicle.runningCostPerMonth = Math.round(
        targetShop.annualRunningCost / 12
      );
    }

    const basePart = vehicle.name.split(' (')[0];
    vehicle.name = `${basePart} (${CARGO_LABELS_NO[newCargoType]})`;

    this.pushFloatingPopup(
      vehicle.x,
      vehicle.y,
      `-kr ${formatNorwegianNumber(ROAD_REFIT_COST_KR)}`,
      'red'
    );
    recomputeValuationsAndWarnings(this.state);
    this.emit();

    return {
      ok: true,
      cost: ROAD_REFIT_COST_KR,
      vehicleId: vehicle.id,
      message: `Bygde om ${vehicle.name} for ${formatKr(ROAD_REFIT_COST_KR)}.`,
    };
  }

  public sendVehicleToDepot(
    vehicleId: string,
    targetDepot?: { x: number; y: number },
    forceImmediate = false
  ): ActionResult {
    const vehicle = this.state.vehicles.find(
      (v) => v.id === vehicleId && v.ownerId === 'player'
    );
    if (!vehicle) {
      return { ok: false, message: 'Fant ikke kjøretøyet.' };
    }

    const playerDepots = this.state.tiles.filter(
      (t) => t.depot === vehicle.network && (!t.ownerId || t.ownerId === 'player')
    );
    if (playerDepots.length === 0) {
      return {
        ok: false,
        message:
          vehicle.network === 'RAIL'
            ? 'Du har ingen togdepot! Bygg et togdepot på sporet først.'
            : 'Du har ingen veidepot! Bygg et veidepot først.',
      };
    }

    let chosenDepot: Tile | undefined;
    if (
      targetDepot &&
      inBounds(targetDepot.x, targetDepot.y, this.state.mapSize)
    ) {
      const cand =
        this.state.tiles[
          tileIndex(targetDepot.x, targetDepot.y, this.state.mapSize)
        ];
      if (
        cand.depot === vehicle.network &&
        (!cand.ownerId || cand.ownerId === 'player')
      ) {
        chosenDepot = cand;
      }
    }

    if (!chosenDepot) {
      const sorted = [...playerDepots].sort(
        (a, b) =>
          Math.abs(a.x - vehicle.x) +
          Math.abs(a.y - vehicle.y) -
          (Math.abs(b.x - vehicle.x) + Math.abs(b.y - vehicle.y))
      );
      for (const dep of sorted) {
        if (dep.x === vehicle.x && dep.y === vehicle.y) {
          chosenDepot = dep;
          break;
        }
        const p = findNetworkPath(
          this.state.tiles,
          this.state.mapSize,
          vehicle.x,
          vehicle.y,
          [{ x: dep.x, y: dep.y }],
          vehicle.network
        );
        if (p.length > 0) {
          chosenDepot = dep;
          break;
        }
      }
      if (!chosenDepot) {
        chosenDepot = sorted[0];
      }
    }

    if (
      vehicle.state === 'IN_DEPOT' &&
      vehicle.x === chosenDepot.x &&
      vehicle.y === chosenDepot.y
    ) {
      vehicle.goingToDepot = null;
      vehicle.depotX = chosenDepot.x;
      vehicle.depotY = chosenDepot.y;
      this.emit();
      return {
        ok: true,
        vehicleId: vehicle.id,
        message: `${vehicle.name} står allerede i dette depoet.`,
      };
    }

    const wasAlreadyGoingToDepot = Boolean(vehicle.goingToDepot);
    const wasStoppedOrInOtherDepot =
      vehicle.state === 'STOPPED' || vehicle.state === 'IN_DEPOT';

    if (vehicle.x === chosenDepot.x && vehicle.y === chosenDepot.y) {
      this.parkVehicleInDepot(vehicle, chosenDepot.x, chosenDepot.y);
      this.emit();
      return {
        ok: true,
        vehicleId: vehicle.id,
        message: `${vehicle.name} er parkert i depoet.`,
      };
    }

    if (forceImmediate || (vehicle.network === 'RAIL' && vehicle.wagonCount <= 0)) {
      this.parkVehicleInDepot(vehicle, chosenDepot.x, chosenDepot.y);
      this.emit();
      return {
        ok: true,
        vehicleId: vehicle.id,
        message: `${vehicle.name} ble flyttet inn i depoet.`,
      };
    }

    const pathToDepot = findNetworkPath(
      this.state.tiles,
      this.state.mapSize,
      vehicle.x,
      vehicle.y,
      [{ x: chosenDepot.x, y: chosenDepot.y }],
      vehicle.network
    );

    if (
      pathToDepot.length === 0 &&
      (wasAlreadyGoingToDepot || wasStoppedOrInOtherDepot)
    ) {
      this.parkVehicleInDepot(vehicle, chosenDepot.x, chosenDepot.y);
      this.emit();
      return {
        ok: true,
        vehicleId: vehicle.id,
        message: `${vehicle.name} ble hentet rett inn i depoet.`,
      };
    }

    vehicle.goingToDepot = { x: chosenDepot.x, y: chosenDepot.y };
    vehicle.depotX = chosenDepot.x;
    vehicle.depotY = chosenDepot.y;
    vehicle.loadingTicksRemaining = 0;

    if (pathToDepot.length > 0) {
      if (
        vehicle.progress > 0 &&
        (pathToDepot[0].x !== vehicle.nextX ||
          pathToDepot[0].y !== vehicle.nextY)
      ) {
        vehicle.progress = 0;
        vehicle.nextX = pathToDepot[0].x;
        vehicle.nextY = pathToDepot[0].y;
      }
      vehicle.path = pathToDepot;
      vehicle.state = 'MOVING';
      this.emit();
      return {
        ok: true,
        vehicleId: vehicle.id,
        message: `${vehicle.name} kjører til depot (${chosenDepot.x}, ${chosenDepot.y})...`,
      };
    }

    vehicle.path = [];
    vehicle.state = 'STOPPED';
    vehicle.speedKmh = 0;
    this.emit();
    return {
      ok: true,
      vehicleId: vehicle.id,
      message:
        'Ingen direkte spor-/veiforbindelse til depoet — klikk «Flytt rett inn nå» for å hente kjøretøyet inn.',
    };
  }

  public cancelSendToDepot(vehicleId: string): ActionResult {
    const vehicle = this.state.vehicles.find(
      (v) => v.id === vehicleId && v.ownerId === 'player'
    );
    if (!vehicle) {
      return { ok: false, message: 'Fant ikke kjøretøyet.' };
    }

    vehicle.goingToDepot = null;
    vehicle.path = [];
    if (vehicle.state !== 'IN_DEPOT') {
      if (vehicle.orders.length > 0) {
        vehicle.state = 'MOVING';
      } else {
        vehicle.state = 'STOPPED';
        vehicle.speedKmh = 0;
      }
    }

    this.emit();
    return {
      ok: true,
      vehicleId: vehicle.id,
      message: `${vehicle.name} gjenopptar ordinær kjøreordre.`,
    };
  }

  public updateVehicleOrders(
    vehicleId: string,
    orders: string[],
    cargoType?: CargoType
  ): ActionResult {
    const vehicle = this.state.vehicles.find(
      (v) => v.id === vehicleId && v.ownerId === 'player'
    );
    if (!vehicle) {
      return { ok: false, message: 'Fant ikke kjøretøyet.' };
    }

    if (cargoType) {
      const spec = VEHICLE_CATALOG[vehicle.modelId];
      if (spec.supportedCargos.includes(cargoType) && vehicle.cargoType !== cargoType) {
        if (vehicle.network === 'ROAD') {
          vehicle.cargoType = cargoType;
          vehicle.cargoAmount = 0;
          vehicle.cargoOriginStationId = null;
          const basePart = vehicle.name.split(' (')[0];
          vehicle.name = `${basePart} (${CARGO_LABELS_NO[cargoType]})`;
        } else {
          const wagons = this.ensureTrainWagons(vehicle);
          const isUniform =
            wagons.length > 0 &&
            wagons.every((w) => w.cargoType === wagons[0].cargoType);
          if (isUniform) {
            for (const w of wagons) {
              w.cargoType = cargoType;
              w.cargoAmount = 0;
              w.cargoOriginStationId = null;
            }
            this.recomputeTrainConsistStats(vehicle);
          }
        }
      }
    }

    vehicle.orders = orders.filter((sid) =>
      this.state.stations.some((s) => s.id === sid)
    );
    if (vehicle.currentOrderIndex >= vehicle.orders.length) {
      vehicle.currentOrderIndex = 0;
    }
    vehicle.path = [];

    // Automatically dispatch out of depot when given station orders — EXCEPT 0-wagon trains!
    if (vehicle.orders.length > 0 && vehicle.state === 'IN_DEPOT') {
      const canDispatch =
        vehicle.network !== 'RAIL' || this.ensureTrainWagons(vehicle).length > 0;
      if (canDispatch) {
        vehicle.goingToDepot = null;
        vehicle.state = 'MOVING';
      }
    } else if (
      vehicle.orders.length === 0 &&
      vehicle.state === 'MOVING' &&
      !vehicle.goingToDepot
    ) {
      vehicle.state = 'STOPPED';
      vehicle.speedKmh = 0;
    }

    this.emit();
    return {
      ok: true,
      vehicleId: vehicle.id,
      message:
        vehicle.network === 'RAIL' && this.ensureTrainWagons(vehicle).length === 0
          ? 'Kjøreordre lagret! Koble på minst én vogn i depoet før toget kan starte.'
          : 'Kjøreordre oppdatert.',
    };
  }

  public toggleVehicleStopped(vehicleId: string): ActionResult {
    const vehicle = this.state.vehicles.find(
      (v) => v.id === vehicleId && v.ownerId === 'player'
    );
    if (!vehicle) {
      return { ok: false, message: 'Fant ikke kjøretøyet.' };
    }

    if (vehicle.state === 'STOPPED' || vehicle.state === 'IN_DEPOT') {
      if (
        vehicle.network === 'RAIL' &&
        this.ensureTrainWagons(vehicle).length === 0
      ) {
        return {
          ok: false,
          message:
            'Toget har ingen vogner! Kjøp og koble på minst én vogn i depoet før start.',
        };
      }
      if (vehicle.orders.length === 0) {
        return {
          ok: false,
          message: 'Legg til minst én stasjon i kjøreordren før start!',
        };
      }
      vehicle.goingToDepot = null;
      vehicle.state = 'MOVING';
      vehicle.path = [];
    } else {
      vehicle.goingToDepot = null;
      vehicle.state = 'STOPPED';
      vehicle.speedKmh = 0;
    }

    this.emit();
    return {
      ok: true,
      vehicleId: vehicle.id,
      message: vehicle.state === 'STOPPED' ? 'Kjøretøy stoppet.' : 'Kjøretøy startet.',
    };
  }

  public toggleVehicleFullLoad(vehicleId: string): ActionResult {
    const vehicle = this.state.vehicles.find(
      (v) => v.id === vehicleId && v.ownerId === 'player'
    );
    if (!vehicle) {
      return { ok: false, message: 'Fant ikke kjøretøyet.' };
    }

    vehicle.waitForFullLoad = !vehicle.waitForFullLoad;
    vehicle.fullLoadWaitTicks = 0;

    this.emit();
    return {
      ok: true,
      vehicleId: vehicle.id,
      message: vehicle.waitForFullLoad
        ? 'Vent på full last: PÅ.'
        : 'Vent på full last: AV.',
    };
  }

  public inspectTile(x: number, y: number): TileInspectionInfo | null {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (!inBounds(rx, ry, this.state.mapSize)) return null;

    const tile = this.state.tiles[tileIndex(rx, ry, this.state.mapSize)];

    // Check neighbor elevations for slope description
    let minNeighborElev = tile.elevation;
    let maxNeighborElev = tile.elevation;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
    ]) {
      const nx = rx + dx;
      const ny = ry + dy;
      if (!inBounds(nx, ny, this.state.mapSize)) continue;
      const ne = this.state.tiles[tileIndex(nx, ny, this.state.mapSize)].elevation;
      if (ne < minNeighborElev) minNeighborElev = ne;
      if (ne > maxNeighborElev) maxNeighborElev = ne;
    }

    const isSloped =
      tile.terrain !== 'WATER' && maxNeighborElev !== minNeighborElev;
    const slopeLabelNo =
      tile.terrain === 'WATER'
        ? 'Havoverflate (0 m)'
        : isSloped
          ? `Skråning (Høyde ${tile.elevation}, ${tile.elevation * 50} moh.)`
          : `Flatt lende (Høyde ${tile.elevation}, ${tile.elevation * 50} moh.)`;

    const terrainLabels: Record<typeof tile.terrain, string> = {
      WATER: 'Vann / Fjord',
      SAND: 'Sandstrand / Kyst',
      GRASS: 'Gressland',
      FOREST_TREES: 'Skogholt',
    };
    const terrainLabelNo = terrainLabels[tile.terrain];

    const town = tile.townId
      ? this.state.towns.find((t) => t.id === tile.townId) ?? null
      : null;
    const industry = tile.industryId
      ? this.state.industries.find((i) => i.id === tile.industryId) ?? null
      : null;
    const station = tile.stationId
      ? this.state.stations.find((s) => s.id === tile.stationId) ?? null
      : null;

    const remotePeerOwner =
      tile.ownerId || tile.hqOwnerId
        ? (this.state.remotePlayers ?? []).find(
            (p) => p.clientId === tile.ownerId || p.clientId === tile.hqOwnerId
          )
        : undefined;

    let ownerName = 'Kommunal / Ingen eier';
    if (tile.ownerId === 'player' || tile.hqOwnerId === 'player') {
      ownerName = this.state.corporate.companyName;
    } else if (remotePeerOwner) {
      ownerName = remotePeerOwner.companyName;
    } else if (tile.ownerId) {
      const ai = this.state.aiCompanies.find((c) => c.id === tile.ownerId);
      if (ai) ownerName = ai.name;
    } else if (town) {
      ownerName = `${town.name} kommune`;
    } else if (industry) {
      ownerName = industry.name;
    }

    const acceptsSet = new Set<CargoType>();
    const producesSet = new Set<CargoType>();

    if (station) {
      for (const c of ALL_CARGO_TYPES) {
        if (doesStationAcceptCargo(this.state, station, c).accepts) {
          acceptsSet.add(c);
        }
      }
      for (const supplied of getStationSuppliedCargos(this.state, station)) {
        producesSet.add(supplied);
      }
    } else if (industry) {
      for (const acc of industry.accepts) acceptsSet.add(acc);
      if (industry.produces) producesSet.add(industry.produces);
    } else if ((tile.buildingTier ?? 0) > 0 && town) {
      acceptsSet.add('PASSENGERS');
      acceptsSet.add('MAIL');
      if ((tile.buildingTier ?? 0) >= 2 || town.population >= 300) {
        acceptsSet.add('GOODS');
        acceptsSet.add('FOOD');
      }
      producesSet.add('PASSENGERS');
      producesSet.add('MAIL');
    }

    let hqTier: number | null = null;
    if (tile.hqOwnerId === 'player') {
      hqTier = this.state.corporate.hqTier;
    } else if (tile.hqOwnerId && remotePeerOwner) {
      hqTier = tile.hqOwnerTier ?? remotePeerOwner.hqTier ?? 1;
    } else if (tile.hqOwnerTier) {
      hqTier = tile.hqOwnerTier;
    }

    let bridgeType: BridgeType | null = null;
    let bridgeElevation: number | null = null;
    let bridgeMaxSpeedKmh: number | null = null;
    let bridgeQualityNo: string | null = null;

    let descriptionNo = terrainLabelNo;
    if (tile.hqOwnerId === 'player') {
      const hqSpec = getHQTierSpec(this.state.corporate.hqTier);
      descriptionNo = `Hovedkontor: ${hqSpec ? hqSpec.nameNo : 'Nivå 1'}`;
    } else if (tile.hqOwnerId && remotePeerOwner) {
      const hqSpec = getHQTierSpec(hqTier ?? 1);
      descriptionNo = `Hovedkontor (${remotePeerOwner.companyName}): ${hqSpec ? hqSpec.nameNo : 'Nivå 1'}`;
    } else if (tile.bridge === 'RAIL' || tile.bridge === 'ROAD') {
      const bt: BridgeType = tile.bridgeType ?? 'STEEL';
      const bSpec = BRIDGE_CATALOG[bt] ?? BRIDGE_CATALOG.STEEL;
      const netLabel = tile.bridge === 'RAIL' ? 'Jernbane' : 'Vei';
      bridgeType = bt;
      bridgeElevation = tile.bridgeElevation ?? 1;
      bridgeMaxSpeedKmh = bSpec.maxSpeedKmh;
      bridgeQualityNo = bSpec.qualityLabelNo;
      descriptionNo = `${bSpec.nameNo} (${netLabel}) — ${bSpec.qualityLabelNo} • Maks ${bSpec.maxSpeedKmh} km/t`;
    } else if (station) {
      descriptionNo = `Stasjon: ${station.name}`;
    } else if (tile.depot === 'RAIL') {
      descriptionNo = 'Togdepot';
    } else if (tile.depot === 'ROAD') {
      descriptionNo = 'Buss- og lastebildepot';
    } else if (industry) {
      descriptionNo = `Industri: ${industry.name} (${INDUSTRY_LABELS_NO[industry.type]})`;
    } else if ((tile.buildingTier ?? 0) > 0 && town) {
      const tierLabel =
        tile.buildingTier === 3
          ? 'Bygård / Forretningsbygg'
          : tile.buildingTier === 2
            ? 'Rekkehus / Bydel'
            : 'Bolighus';
      descriptionNo = `${town.name} — ${tierLabel}`;
    } else if (tile.rail && tile.road) {
      descriptionNo = 'Planovergang (Jernbane + Vei)';
    } else if (tile.rail && tile.signal) {
      descriptionNo = 'Jernbanespor med blokksignal';
    } else if (tile.rail) {
      descriptionNo = 'Jernbanespor';
    } else if (tile.road) {
      descriptionNo = town ? `Bygate (${town.name})` : 'Landevei';
    }

    return {
      x: rx,
      y: ry,
      terrain: tile.terrain,
      terrainLabelNo,
      elevation: tile.elevation,
      slopeLabelNo,
      isSloped,
      road: tile.road,
      rail: tile.rail,
      signal: tile.signal,
      bridge: tile.bridge ?? null,
      bridgeAxis: tile.bridgeAxis ?? null,
      bridgeType,
      bridgeElevation,
      bridgeMaxSpeedKmh,
      bridgeQualityNo,
      depot: tile.depot ?? null,
      hqTier,
      ownerId: tile.ownerId ?? null,
      ownerName,
      townId: town?.id ?? null,
      townName: town?.name ?? null,
      buildingTier: tile.buildingTier ?? 0,
      industryId: industry?.id ?? null,
      industryName: industry?.name ?? null,
      industryType: industry?.type ?? null,
      stationId: station?.id ?? null,
      stationName: station?.name ?? null,
      stationKind: station?.kind ?? null,
      waitingCargo: station ? { ...station.waitingCargo } : null,
      accepts: Array.from(acceptsSet),
      produces: Array.from(producesSet),
      descriptionNo,
    };
  }

  public getStationDetails(stationId: string): StationDetailsInfo | null {
    const station = this.state.stations.find((s) => s.id === stationId);
    if (!station) return null;

    updateStationRatings(this.state);

    const isPlayerOwned = station.ownerId === 'player';
    const remoteOwner = !isPlayerOwned
      ? (this.state.remotePlayers ?? []).find(
          (p) => p.clientId === station.ownerId
        )
      : undefined;
    const aiOwner =
      !isPlayerOwned && !remoteOwner
        ? this.state.aiCompanies.find((c) => c.id === station.ownerId)
        : undefined;

    const ownerName = isPlayerOwned
      ? this.state.corporate.companyName
      : remoteOwner?.companyName ?? aiOwner?.name ?? 'Konkurrent AS';
    const ownerColor = isPlayerOwned
      ? this.state.corporate.playerColor ?? COMPANY_COLORS.player
      : remoteOwner?.color ??
        aiOwner?.color ??
        COMPANY_COLORS[station.ownerId] ??
        '#dc2626';

    const suppliedCargos = getStationSuppliedCargos(this.state, station);
    const acceptedCargos = getStationAcceptedCargosWithSources(this.state, station);
    const servicingVehicles = this.state.vehicles.filter((v) =>
      v.orders.includes(station.id)
    );
    const hqBonusPct = getStationHQBonusPct(station, this.state.corporate);

    return {
      station,
      ownerId: station.ownerId,
      ownerName,
      ownerColor,
      isPlayerOwned,
      suppliedCargos,
      acceptedCargos,
      servicingVehicles,
      hqBonusPct,
    };
  }

  public previewStationPlacement(
    x: number,
    y: number,
    kind: 'TRAIN_STATION' | 'BUS_STOP' | 'TRUCK_BAY',
    options?: {
      orientation?: 'X' | 'Y';
      stationTracks?: number;
      stationLength?: number;
    }
  ): StationPlacementPreview {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const isRailStation = kind === 'TRAIN_STATION';
    const tracks = isRailStation
      ? Math.max(
          1,
          Math.min(MAX_STATION_TRACKS, Math.round(options?.stationTracks ?? 1))
        )
      : 1;
    const platformLength = isRailStation
      ? Math.max(
          1,
          Math.min(MAX_STATION_LENGTH, Math.round(options?.stationLength ?? 1))
        )
      : 1;
    const orientation: 'X' | 'Y' = options?.orientation === 'Y' ? 'Y' : 'X';
    const catchmentRadius = getStationCatchmentRadius(kind);
    const totalTileCount = tracks * platformLength;
    const cost = BUILD_COSTS[kind] * totalTileCount;

    const rawCoords: GridPoint[] = [];
    for (let t = 0; t < tracks; t++) {
      for (let l = 0; l < platformLength; l++) {
        const tx = orientation === 'X' ? rx + l : rx + t;
        const ty = orientation === 'X' ? ry + t : ry + l;
        rawCoords.push({ x: tx, y: ty });
      }
    }

    let anchorElevation: number | null = null;
    if (inBounds(rx, ry, this.state.mapSize)) {
      const anchorTile =
        this.state.tiles[tileIndex(rx, ry, this.state.mapSize)];
      if (anchorTile.terrain !== 'WATER') {
        anchorElevation = anchorTile.elevation;
      }
    }
    if (anchorElevation === null) {
      for (const pt of rawCoords) {
        if (!inBounds(pt.x, pt.y, this.state.mapSize)) continue;
        const tt = this.state.tiles[tileIndex(pt.x, pt.y, this.state.mapSize)];
        if (tt.terrain !== 'WATER') {
          anchorElevation = tt.elevation;
          break;
        }
      }
    }

    let hasOutOfBounds = false;
    let hasSlopeMismatch = false;
    const footprintTiles: Array<{ x: number; y: number; valid: boolean }> = [];
    const footprintIdxSet = new Set<number>();

    for (const pt of rawCoords) {
      if (!inBounds(pt.x, pt.y, this.state.mapSize)) {
        hasOutOfBounds = true;
        continue;
      }
      const idx = tileIndex(pt.x, pt.y, this.state.mapSize);
      const tt = this.state.tiles[idx];
      footprintIdxSet.add(idx);

      const elevOk =
        anchorElevation === null || tt.elevation === anchorElevation;
      const occupiedOrInvalid =
        tt.terrain === 'WATER' ||
        Boolean(tt.bridge) ||
        Boolean(tt.industryId) ||
        Boolean(tt.hqOwnerId) ||
        Boolean(tt.depot) ||
        Boolean(tt.stationId) ||
        (tt.buildingTier ?? 0) > 0 ||
        (tt.ownerId !== undefined &&
          tt.ownerId !== null &&
          tt.ownerId !== 'player') ||
        (isRailStation && tt.road) ||
        (!isRailStation && tt.rail);

      if (!occupiedOrInvalid && !elevOk) {
        hasSlopeMismatch = true;
      }

      footprintTiles.push({
        x: pt.x,
        y: pt.y,
        valid: !occupiedOrInvalid && elevOk,
      });
    }

    if (hasOutOfBounds) {
      for (const ft of footprintTiles) {
        ft.valid = false;
      }
    }

    const catchmentTiles: Array<{ x: number; y: number }> = [];
    if (footprintTiles.length > 0) {
      let minX = footprintTiles[0].x;
      let maxX = footprintTiles[0].x;
      let minY = footprintTiles[0].y;
      let maxY = footprintTiles[0].y;
      for (const ft of footprintTiles) {
        if (ft.x < minX) minX = ft.x;
        if (ft.x > maxX) maxX = ft.x;
        if (ft.y < minY) minY = ft.y;
        if (ft.y > maxY) maxY = ft.y;
      }

      const startY = Math.max(0, minY - catchmentRadius);
      const endY = Math.min(this.state.mapSize - 1, maxY + catchmentRadius);
      const startX = Math.max(0, minX - catchmentRadius);
      const endX = Math.min(this.state.mapSize - 1, maxX + catchmentRadius);

      for (let cy = startY; cy <= endY; cy++) {
        for (let cx = startX; cx <= endX; cx++) {
          const cIdx = tileIndex(cx, cy, this.state.mapSize);
          if (footprintIdxSet.has(cIdx)) continue;
          const withinRadius = footprintTiles.some(
            (ft) =>
              Math.max(Math.abs(cx - ft.x), Math.abs(cy - ft.y)) <=
              catchmentRadius
          );
          if (withinRadius) {
            catchmentTiles.push({ x: cx, y: cy });
          }
        }
      }
    }

    let suppliedCargos: CargoType[] = [];
    let acceptedCargos: CargoType[] = [];
    let townName: string | null = null;
    let nearbyIndustries: string[] = [];

    if (footprintTiles.length > 0) {
      const virtualStation: Station = {
        id: '__preview__',
        name: 'Preview',
        ownerId: 'player',
        kind,
        x: footprintTiles[0].x,
        y: footprintTiles[0].y,
        tiles: footprintTiles.map((ft) => ({ x: ft.x, y: ft.y })),
        orientation: isRailStation ? orientation : undefined,
        tracks: isRailStation ? tracks : 1,
        platformLength: isRailStation ? platformLength : 1,
        townId: null,
        nearbyIndustryIds: [],
        waitingCargo: createEmptyCargoRecord(),
        ratings: createInitialRatingsRecord(),
        daysSincePickup: 0,
      };
      refreshStationCatchment(this.state, virtualStation);
      suppliedCargos = getStationSuppliedCargos(this.state, virtualStation);
      acceptedCargos = getStationAcceptedCargosWithSources(
        this.state,
        virtualStation
      ).map((item) => item.cargo);
      if (virtualStation.townId) {
        townName =
          this.state.towns.find((t) => t.id === virtualStation.townId)?.name ??
          null;
      }
      nearbyIndustries = virtualStation.nearbyIndustryIds
        .map(
          (indId) => this.state.industries.find((i) => i.id === indId)?.name
        )
        .filter((name): name is string => Boolean(name));
    }

    let ok = true;
    let reason: string | undefined;
    if (
      !inBounds(rx, ry, this.state.mapSize) ||
      hasOutOfBounds ||
      footprintTiles.length !== totalTileCount
    ) {
      ok = false;
      reason = 'Stasjonen går utenfor kartkanten.';
    } else if (footprintTiles.some((ft) => !ft.valid)) {
      ok = false;
      reason = hasSlopeMismatch
        ? 'Terrenget må være flatt under hele stasjonen.'
        : 'Kan ikke plassere stasjon her — ruten er opptatt eller ulendt.';
    } else if (this.state.corporate.cash < cost) {
      ok = false;
      reason = 'Ikke nok selskapskontanter til stasjon.';
    }

    return {
      ok,
      ...(reason ? { reason } : {}),
      cost,
      orientation,
      tracks,
      platformLength,
      catchmentRadius,
      footprintTiles,
      catchmentTiles,
      suppliedCargos,
      acceptedCargos,
      townName,
      nearbyIndustries,
    };
  }

  public getStationCatchmentTiles(
    stationId: string
  ): Array<{ x: number; y: number }> {
    let station: Station | undefined = this.state.stations.find(
      (s) => s.id === stationId
    );
    if (!station && this.state.remotePlayers) {
      for (const peer of this.state.remotePlayers) {
        const found = peer.stations.find((s) => s.id === stationId);
        if (found) {
          station = found;
          break;
        }
      }
    }
    if (!station || !Array.isArray(station.tiles) || station.tiles.length === 0) {
      return [];
    }

    const inBoundsFootprint = station.tiles.filter((pt) =>
      inBounds(pt.x, pt.y, this.state.mapSize)
    );
    if (inBoundsFootprint.length === 0) return [];

    const catchmentRadius = getStationCatchmentRadius(station.kind);
    const footprintIdxSet = new Set<number>();
    let minX = inBoundsFootprint[0].x;
    let maxX = inBoundsFootprint[0].x;
    let minY = inBoundsFootprint[0].y;
    let maxY = inBoundsFootprint[0].y;

    for (const pt of inBoundsFootprint) {
      footprintIdxSet.add(tileIndex(pt.x, pt.y, this.state.mapSize));
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }

    const startY = Math.max(0, minY - catchmentRadius);
    const endY = Math.min(this.state.mapSize - 1, maxY + catchmentRadius);
    const startX = Math.max(0, minX - catchmentRadius);
    const endX = Math.min(this.state.mapSize - 1, maxX + catchmentRadius);

    const catchmentTiles: Array<{ x: number; y: number }> = [];
    for (let cy = startY; cy <= endY; cy++) {
      for (let cx = startX; cx <= endX; cx++) {
        const cIdx = tileIndex(cx, cy, this.state.mapSize);
        if (footprintIdxSet.has(cIdx)) continue;
        const withinRadius = inBoundsFootprint.some(
          (ft) =>
            Math.max(Math.abs(cx - ft.x), Math.abs(cy - ft.y)) <=
            catchmentRadius
        );
        if (withinRadius) {
          catchmentTiles.push({ x: cx, y: cy });
        }
      }
    }

    return catchmentTiles;
  }

  public sellVehicle(
    vehicleId: string,
    options?: { keepWagonsInDepot?: boolean }
  ): ActionResult {
    const idx = this.state.vehicles.findIndex(
      (v) => v.id === vehicleId && v.ownerId === 'player'
    );
    if (idx === -1) {
      return { ok: false, message: 'Fant ikke kjøretøyet.' };
    }

    const v = this.state.vehicles[idx];
    const depFactor = Math.max(0.25, 0.85 - v.ageMonths * 0.008);

    if (options?.keepWagonsInDepot && v.network === 'RAIL') {
      const wagons = this.ensureTrainWagons(v);
      const depX = v.state === 'IN_DEPOT' ? v.x : (v.depotX ?? v.x);
      const depY = v.state === 'IN_DEPOT' ? v.y : (v.depotY ?? v.y);

      if (!this.state.depotWagons) {
        this.state.depotWagons = [];
      }
      for (const w of wagons) {
        this.state.depotWagons.push({
          id: w.id,
          depotX: depX,
          depotY: depY,
          cargoType: w.cargoType,
          capacity: w.capacity,
          purchaseValue: w.purchaseValue,
          annualRunningCost: w.annualRunningCost,
        });
      }

      const locoPrice = (VEHICLE_CATALOG[v.modelId] ?? VEHICLE_CATALOG.LOCO_STEAM).price;
      const locoResale = Math.round(locoPrice * depFactor);
      this.state.vehicles.splice(idx, 1);
      this.state.corporate.cash += locoResale;
      this.pushFloatingPopup(
        v.x,
        v.y,
        `+kr ${formatNorwegianNumber(locoResale)}`,
        'green'
      );
      recomputeValuationsAndWarnings(this.state);
      this.emit();

      return {
        ok: true,
        cost: -locoResale,
        message: `Solgte kun lokomotivet fra ${v.name} for ${formatKr(locoResale)} (${wagons.length} vogner satt på sidespor i depoet).`,
      };
    }

    const resaleValue = Math.round(v.purchaseValue * depFactor);
    this.state.vehicles.splice(idx, 1);
    this.state.corporate.cash += resaleValue;
    this.pushFloatingPopup(
      v.x,
      v.y,
      `+kr ${formatNorwegianNumber(resaleValue)}`,
      'green'
    );
    recomputeValuationsAndWarnings(this.state);
    this.emit();

    return {
      ok: true,
      cost: -resaleValue,
      message: `Solgte ${v.name} for ${formatKr(resaleValue)}.`,
    };
  }

  // ============================================================================
  // Corporate & Personal Dual-Economy Controls
  // ============================================================================

  public adjustLoan(deltaKr: number): ActionResult {
    const res = adjustCorporateLoan(this.state, deltaKr);
    if (res.ok) this.emit();
    return res;
  }

  public setMonthlyGrossSalary(grossKr: number): ActionResult {
    const res = setOwnerGrossSalary(this.state, grossKr);
    if (res.ok) this.emit();
    return res;
  }

  public upgradeHQ(): ActionResult {
    const res = upgradeCorporateHQ(this.state);
    if (res.ok) {
      if (this.state.corporate.hqTile && res.cost) {
        this.pushFloatingPopup(
          this.state.corporate.hqTile.x,
          this.state.corporate.hqTile.y,
          `-kr ${formatNorwegianNumber(res.cost)} (Privat)`,
          'amber'
        );
      }
      this.emit();
    }
    return res;
  }

  public buyAIShares(aiId: string, pctBlock = 10): ActionResult {
    const res = buyAICompanyShares(
      this.state,
      aiId,
      pctBlock,
      this.aiShareCostBasis
    );
    if (res.ok) this.emit();
    return res;
  }

  public sellAIShares(aiId: string, pctBlock = 10): ActionResult {
    const res = sellAICompanyShares(
      this.state,
      aiId,
      pctBlock,
      this.aiShareCostBasis
    );
    if (res.ok) this.emit();
    return res;
  }

  public renameCompanyAndOwner(companyName: string, ownerName: string): void {
    const cleanComp = companyName.trim();
    const cleanOwner = ownerName.trim();
    if (cleanComp) {
      this.state.corporate.companyName = cleanComp;
      if (this.localIdentity) {
        this.localIdentity.companyName = cleanComp;
      }
    }
    if (cleanOwner) {
      this.state.personal.ownerName = cleanOwner;
      if (this.localIdentity) {
        this.localIdentity.ownerName = cleanOwner;
      }
    }
    this.emit();
  }

  // ============================================================================
  // Shared-World Multiplayer Peer Sync
  // ============================================================================

  public setLocalPlayerIdentity(params: LocalPlayerIdentity): void {
    const clientId = params.clientId.trim() || 'player';
    const ownerName =
      params.ownerName.trim() || this.state.personal.ownerName;
    const companyName =
      params.companyName.trim() || this.state.corporate.companyName;
    const playerColor =
      params.playerColor.trim() ||
      this.state.corporate.playerColor ||
      COMPANY_COLORS.player;

    this.localIdentity = {
      clientId,
      ownerName,
      companyName,
      playerColor,
    };

    this.state.personal.ownerName = ownerName;
    this.state.corporate.companyName = companyName;
    this.state.corporate.playerColor = playerColor;
    this.state.networkRevision = (this.state.networkRevision ?? 0) + 1;
    this.emit();
  }

  public exportMultiplayerSlice(): RemotePlayerWorldSlice {
    const clientId = this.localIdentity?.clientId ?? 'player';
    const color =
      this.state.corporate.playerColor ??
      this.localIdentity?.playerColor ??
      COMPANY_COLORS.player;

    const modifiedTiles: ModifiedTileDelta[] = [];
    for (const t of this.state.tiles) {
      const isPlayerModified =
        (t.ownerId === 'player' || t.hqOwnerId === 'player') &&
        Boolean(
          t.road ||
            t.rail ||
            t.signal ||
            t.bridge ||
            t.depot ||
            t.stationId ||
            t.hqOwnerId === 'player'
        );
      if (!isPlayerModified) continue;

      const delta: ModifiedTileDelta = { x: t.x, y: t.y };
      if (t.road) delta.road = true;
      if (t.rail) delta.rail = true;
      if (t.signal) delta.signal = true;
      if (t.bridge) {
        delta.bridge = t.bridge;
        if (t.bridgeAxis) delta.bridgeAxis = t.bridgeAxis;
        delta.bt = t.bridgeType ?? 'STEEL';
        delta.be = t.bridgeElevation ?? 1;
      }
      if (t.depot) delta.depot = t.depot;
      if (t.stationId) {
        delta.stationId = t.stationId;
        if (t.stationAxis) delta.sa = t.stationAxis;
      }
      if (t.hqOwnerId === 'player') {
        delta.hqOwnerId = clientId;
        delta.hqOwnerTier = this.state.corporate.hqTier || 1;
      }
      modifiedTiles.push(delta);
    }

    const stations: RemoteStationSnapshot[] = this.state.stations
      .filter((s) => s.ownerId === 'player')
      .map((s) => {
        const stSnap: RemoteStationSnapshot = {
          id: s.id,
          name: s.name,
          ownerId: clientId,
          kind: s.kind,
          x: s.x,
          y: s.y,
          tiles: s.tiles.map((pt) => ({ x: pt.x, y: pt.y })),
          townId: s.townId,
          nearbyIndustryIds: [...s.nearbyIndustryIds],
          waitingCargo: { ...s.waitingCargo },
          ratings: { ...s.ratings },
          daysSincePickup: s.daysSincePickup,
          lastVehicleMaxSpeedKmh: s.lastVehicleMaxSpeedKmh ?? 88,
        };
        if (s.kind === 'TRAIN_STATION') {
          stSnap.orientation = s.orientation ?? 'X';
          stSnap.tracks = getEffectiveStationTracks(s);
          stSnap.platformLength = getEffectiveStationPlatformLength(s);
        }
        return stSnap;
      });

    const vehicles: RemoteVehicleSnapshot[] = this.state.vehicles
      .filter((v) => v.ownerId === 'player')
      .map((v) => {
        const railWagons =
          v.network === 'RAIL' ? this.ensureTrainWagons(v) : null;
        const snap: RemoteVehicleSnapshot = {
          id: v.id,
          name: v.name,
          ownerId: clientId,
          network: v.network,
          modelId: v.modelId,
          cargoType: v.cargoType,
          capacity: v.capacity,
          cargoAmount: v.cargoAmount,
          cargoOriginStationId: v.cargoOriginStationId ?? null,
          cargoLoadedDay: v.cargoLoadedDay,
          x: v.x,
          y: v.y,
          nextX: v.nextX,
          nextY: v.nextY,
          progress: v.progress,
          direction: v.direction,
          speedKmh: v.speedKmh,
          maxSpeedKmh: v.maxSpeedKmh,
          state: v.state,
          orders: [...v.orders],
          currentOrderIndex: v.currentOrderIndex,
          path: v.path.map((pt) => ({ x: pt.x, y: pt.y })),
          profitThisYear: v.profitThisYear,
          runningCostPerMonth: v.runningCostPerMonth,
          purchaseValue: v.purchaseValue,
          ageMonths: v.ageMonths,
          wagonCount: v.wagonCount,
          goingToDepot: v.goingToDepot
            ? { x: v.goingToDepot.x, y: v.goingToDepot.y }
            : null,
          trail: (v.trail ?? [{ x: v.x, y: v.y }]).map((pt) => ({
            x: pt.x,
            y: pt.y,
          })),
          depotX: v.depotX ?? v.x,
          depotY: v.depotY ?? v.y,
          loadingTicksRemaining: v.loadingTicksRemaining ?? 0,
          platformOverhangTiles: v.platformOverhangTiles ?? 0,
          waitForFullLoad: Boolean(v.waitForFullLoad),
          accelTicks: v.accelTicks ?? 0,
          fullLoadWaitTicks: v.fullLoadWaitTicks ?? 0,
        };
        if (railWagons) {
          snap.wt = railWagons.map((w) => w.cargoType);
          snap.wagons = railWagons.map((w) => ({
            id: w.id,
            cargoType: w.cargoType,
            capacity: w.capacity,
            cargoAmount: w.cargoAmount,
            cargoOriginStationId: w.cargoOriginStationId ?? null,
            cargoLoadedDay: w.cargoLoadedDay,
            purchaseValue: w.purchaseValue,
            annualRunningCost: w.annualRunningCost,
          }));
        }
        return snap;
      });

    const curProfit = calculatePnLOperatingProfit(
      this.state.corporate.currentYearPnL
    );
    const prevProfit = calculatePnLOperatingProfit(
      this.state.corporate.lastYearPnL
    );
    const annualProfit =
      this.state.date.year === 1
        ? curProfit
        : Math.round(curProfit * 0.6 + prevProfit * 0.4);

    return {
      clientId,
      ownerName: this.state.personal.ownerName,
      companyName: this.state.corporate.companyName,
      color,
      cash: this.state.corporate.cash,
      companyValue: this.state.corporate.companyValue,
      annualProfit,
      hqTile: this.state.corporate.hqTile
        ? { ...this.state.corporate.hqTile }
        : null,
      hqTier: this.state.corporate.hqTier,
      modifiedTiles,
      stations,
      vehicles,
      updatedAt: Date.now(),
    };
  }

  public syncMultiplayerPeers(peers: RemotePlayerWorldSlice[]): void {
    const selfId = this.localIdentity?.clientId ?? 'player';
    const validPeers = (Array.isArray(peers) ? peers : []).filter(
      (p) =>
        Boolean(p && typeof p.clientId === 'string' && p.clientId) &&
        p.clientId !== selfId &&
        p.clientId !== 'player'
    );

    const incomingIds = new Set(validPeers.map((p) => p.clientId));
    const allRemoteIds = new Set<string>([
      ...this.syncedPeerIds,
      ...incomingIds,
    ]);

    // 1. Revert any previously applied remote tile modifications (unless local 'player' now owns that tile)
    for (const [idx, backup] of this.remoteTileBackups.entries()) {
      const cur = this.state.tiles[idx];
      if (!cur) continue;
      if (cur.ownerId === 'player' || cur.hqOwnerId === 'player') {
        continue;
      }
      this.state.tiles[idx] = { ...backup };
    }
    this.remoteTileBackups.clear();

    // 2. Remove stale remote stations & vehicles
    if (allRemoteIds.size > 0) {
      this.state.stations = this.state.stations.filter(
        (s) => !allRemoteIds.has(s.ownerId)
      );
      this.state.vehicles = this.state.vehicles.filter(
        (v) => !allRemoteIds.has(v.ownerId)
      );
    }

    this.syncedPeerIds = incomingIds;
    this.state.remotePlayers = validPeers.map((p) => ({
      ...p,
      modifiedTiles: Array.isArray(p.modifiedTiles) ? p.modifiedTiles : [],
      stations: Array.isArray(p.stations) ? p.stations : [],
      vehicles: Array.isArray(p.vehicles) ? p.vehicles : [],
    }));

    const backupTileIfNeeded = (idx: number) => {
      if (!this.remoteTileBackups.has(idx)) {
        this.remoteTileBackups.set(idx, { ...this.state.tiles[idx] });
      }
    };

    // 3. Apply each active peer's tiles, HQ, stations, and vehicles
    for (const peer of this.state.remotePlayers) {
      const peerId = peer.clientId;

      for (const mt of peer.modifiedTiles) {
        if (!mt || !inBounds(mt.x, mt.y, this.state.mapSize)) continue;
        const idx = tileIndex(mt.x, mt.y, this.state.mapSize);
        const tile = this.state.tiles[idx];
        if (tile.ownerId === 'player' || tile.hqOwnerId === 'player') continue;

        backupTileIfNeeded(idx);

        if (mt.bridge) {
          tile.terrain = 'WATER';
          tile.elevation = 0;
          tile.bridge = mt.bridge;
          tile.bridgeAxis = mt.bridgeAxis ?? 'X';
          tile.bridgeType = mt.bt ?? 'STEEL';
          tile.bridgeElevation = mt.be ?? 1;
          tile.road = mt.bridge === 'ROAD';
          tile.rail = mt.bridge === 'RAIL';
          tile.ownerId = peerId;
        } else {
          if (tile.terrain !== 'WATER') {
            tile.terrain = 'GRASS';
          }
          if (mt.road) tile.road = true;
          if (mt.rail) tile.rail = true;
          if (mt.signal && tile.rail && !tile.road) tile.signal = true;
          if (mt.depot) tile.depot = mt.depot;
          if (mt.stationId) tile.stationId = mt.stationId;
          if (mt.sa === 'X' || mt.sa === 'Y') {
            tile.stationAxis = mt.sa;
          }
          if (mt.hqOwnerId) {
            tile.hqOwnerId = peerId;
            tile.hqOwnerTier = mt.hqOwnerTier ?? (peer.hqTier || 1);
          }
          if (!tile.ownerId) {
            tile.ownerId = peerId;
          }
        }
      }

      if (
        peer.hqTile &&
        inBounds(peer.hqTile.x, peer.hqTile.y, this.state.mapSize)
      ) {
        const hqIdx = tileIndex(peer.hqTile.x, peer.hqTile.y, this.state.mapSize);
        const hqT = this.state.tiles[hqIdx];
        if (hqT.ownerId !== 'player' && hqT.hqOwnerId !== 'player') {
          backupTileIfNeeded(hqIdx);
          if (hqT.terrain !== 'WATER') hqT.terrain = 'GRASS';
          hqT.hqOwnerId = peerId;
          hqT.hqOwnerTier = peer.hqTier || 1;
          if (!hqT.ownerId) hqT.ownerId = peerId;
        }
      }

      for (const rawSt of peer.stations) {
        if (!rawSt || !rawSt.id || !inBounds(rawSt.x, rawSt.y, this.state.mapSize)) {
          continue;
        }
        if (this.state.stations.some((s) => s.id === rawSt.id)) continue;
        const stTiles =
          Array.isArray(rawSt.tiles) && rawSt.tiles.length > 0
            ? rawSt.tiles
            : [{ x: rawSt.x, y: rawSt.y }];
        const stKind: StationKind = rawSt.kind || 'BUS_STOP';
        const stOrient: 'X' | 'Y' | undefined =
          stKind === 'TRAIN_STATION'
            ? rawSt.orientation === 'Y'
              ? 'Y'
              : 'X'
            : undefined;
        const normalizedStation: Station = {
          id: rawSt.id,
          name: rawSt.name || `${peer.companyName} Stasjon`,
          ownerId: peerId,
          kind: stKind,
          x: rawSt.x,
          y: rawSt.y,
          tiles: stTiles,
          ...(stKind === 'TRAIN_STATION'
            ? {
                orientation: stOrient,
                tracks: getEffectiveStationTracks({
                  kind: stKind,
                  tiles: stTiles,
                  orientation: stOrient,
                  tracks: rawSt.tracks,
                }),
                platformLength: getEffectiveStationPlatformLength({
                  kind: stKind,
                  tiles: stTiles,
                  orientation: stOrient,
                  platformLength: rawSt.platformLength,
                }),
              }
            : {}),
          townId: rawSt.townId ?? null,
          nearbyIndustryIds: Array.isArray(rawSt.nearbyIndustryIds)
            ? rawSt.nearbyIndustryIds
            : [],
          waitingCargo: {
            ...createEmptyCargoRecord(),
            ...(rawSt.waitingCargo ?? {}),
          },
          ratings: {
            ...createInitialRatingsRecord(),
            ...(rawSt.ratings ?? {}),
          },
          daysSincePickup: rawSt.daysSincePickup ?? 0,
          lastVehicleMaxSpeedKmh: rawSt.lastVehicleMaxSpeedKmh ?? 88,
        };
        if (stKind === 'TRAIN_STATION' && stOrient) {
          for (const pt of stTiles) {
            if (!inBounds(pt.x, pt.y, this.state.mapSize)) continue;
            const stTile =
              this.state.tiles[tileIndex(pt.x, pt.y, this.state.mapSize)];
            if (stTile.stationId === rawSt.id && !stTile.stationAxis) {
              stTile.stationAxis = stOrient;
            }
          }
        }
        this.state.stations.push(normalizedStation);
      }

      for (const rawVeh of peer.vehicles) {
        if (
          !rawVeh ||
          !rawVeh.id ||
          !inBounds(Math.round(rawVeh.x), Math.round(rawVeh.y), this.state.mapSize)
        ) {
          continue;
        }
        if (this.state.vehicles.some((v) => v.id === rawVeh.id)) continue;
        let syncedWagons: TrainWagon[] | undefined;
        if (rawVeh.network === 'RAIL') {
          if (Array.isArray(rawVeh.wagons)) {
            syncedWagons = rawVeh.wagons;
          } else if (Array.isArray(rawVeh.wt)) {
            syncedWagons = rawVeh.wt.map((ct, idx) => {
              const ws = RAIL_WAGON_CATALOG[ct] ?? RAIL_WAGON_CATALOG.COAL;
              return {
                id: `${rawVeh.id}-w-${idx + 1}`,
                cargoType: ct,
                capacity: ws.capacity,
                cargoAmount: 0,
                cargoOriginStationId: null,
                cargoLoadedDay: this.state.date.totalDays,
                purchaseValue: ws.price,
                annualRunningCost: ws.annualRunningCost,
              };
            });
          }
        }
        const normalizedVehicle: Vehicle = {
          ...rawVeh,
          ownerId: peerId,
          wagons: syncedWagons,
          wt:
            rawVeh.network === 'RAIL'
              ? Array.isArray(rawVeh.wt)
                ? rawVeh.wt
                : syncedWagons?.map((w) => w.cargoType)
              : undefined,
          orders: Array.isArray(rawVeh.orders) ? rawVeh.orders : [],
          path: Array.isArray(rawVeh.path) ? rawVeh.path : [],
          trail:
            Array.isArray(rawVeh.trail) && rawVeh.trail.length > 0
              ? rawVeh.trail
              : [{ x: rawVeh.x, y: rawVeh.y }],
        };
        if (normalizedVehicle.network === 'RAIL' && !normalizedVehicle.wagons) {
          this.ensureTrainWagons(normalizedVehicle);
        }
        this.state.vehicles.push(normalizedVehicle);
      }
    }

    this.state.networkRevision = (this.state.networkRevision ?? 0) + 1;
    this.emit();
  }

  // ============================================================================
  // Teacher / Developer Quick-Test Helpers & Save/Load
  // ============================================================================

  public spawnDemoRoute(type: DemoRouteType): ActionResult {
    const idPrefix =
      this.localIdentity && this.localIdentity.clientId !== 'player'
        ? this.localIdentity.clientId
        : '';
    const built = buildConnectedRoute(
      this.state,
      'player',
      type,
      true,
      idPrefix
    );
    if (!built.ok) {
      return { ok: false, message: built.description };
    }

    pushNews(
      this.state,
      `Ny rute åpnet: ${built.description} (${built.vehicleIds.length} kjøretøy i drift)!`,
      'INFO'
    );
    recomputeValuationsAndWarnings(this.state);
    this.emit();

    return {
      ok: true,
      cost: built.totalBuildCost + built.totalVehicleCost,
      stationId: built.stationIds[0],
      vehicleId: built.vehicleIds[0],
      message: `Bygget demorute: ${built.description}!`,
    };
  }

  public grantDevFunds(target: 'corporate' | 'personal', amountKr: number): void {
    const delta = Math.round(amountKr);
    if (target === 'corporate') {
      this.state.corporate.cash += delta;
    } else {
      this.state.personal.cash += delta;
    }
    recomputeValuationsAndWarnings(this.state);
    this.emit();
  }

  public exportSaveJson(): string {
    return serializeGameState(this.state);
  }

  public importSaveJson(json: string): ActionResult {
    const res = deserializeGameState(json);
    if (!res.ok || !res.state) {
      return { ok: false, message: res.error ?? 'Ugyldig lagringsfil.' };
    }
    this.state = res.state;
    if (!Array.isArray(this.state.depotWagons)) {
      this.state.depotWagons = [];
    }
    for (const v of this.state.vehicles) {
      if (v.network === 'RAIL') {
        this.ensureTrainWagons(v);
      }
    }
    this.subTickCounter = 0;
    updateStationRatings(this.state);
    recomputeValuationsAndWarnings(this.state);
    this.emit();
    return { ok: true, message: 'Lagret spill ble lastet inn!' };
  }

  public saveToLocalStorage(): boolean {
    const ok = saveStateToLocalStorage(this.state);
    if (ok) {
      this.emit();
    }
    return ok;
  }

  public loadFromLocalStorage(): boolean {
    const loaded = loadStateFromLocalStorage();
    if (!loaded) return false;
    this.state = loaded;
    if (!Array.isArray(this.state.depotWagons)) {
      this.state.depotWagons = [];
    }
    for (const v of this.state.vehicles) {
      if (v.network === 'RAIL') {
        this.ensureTrainWagons(v);
      }
    }
    this.subTickCounter = 0;
    updateStationRatings(this.state);
    recomputeValuationsAndWarnings(this.state);
    this.emit();
    return true;
  }

  public hasSavedGame(): boolean {
    return hasSavedStateInLocalStorage();
  }

  public clearSavedGame(): void {
    clearSavedStateInLocalStorage();
  }

  public resetNewGame(
    setupOrScenario: ScenarioType | Partial<WorldSetupConfig> = 'standard',
    mapSize?: number
  ): void {
    if (typeof setupOrScenario === 'object' && setupOrScenario !== null) {
      const hasExplicitSeed = typeof setupOrScenario.seed === 'number';
      if (!hasExplicitSeed) {
        this.seed = (this.seed + 7919) >>> 0;
      } else {
        this.seed = setupOrScenario.seed!;
      }
      this.worldSetup = resolveWorldSetup(
        setupOrScenario,
        setupOrScenario.scenario,
        setupOrScenario.mapSize ?? mapSize,
        this.seed
      );
      this.state = this.buildFreshState(
        this.worldSetup,
        setupOrScenario.mapSize ?? mapSize
      );
    } else {
      this.seed = (this.seed + 7919) >>> 0;
      const targetSize = mapSize ?? 64;
      this.worldSetup = resolveWorldSetup(
        {
          scenario: setupOrScenario,
          mapSize: normalizeMapSizeOption(targetSize),
          seed: this.seed,
        },
        setupOrScenario,
        targetSize,
        this.seed
      );
      this.state = this.buildFreshState(this.worldSetup, targetSize);
    }
    this.emit();
  }

  public getFormattedDate(): string {
    return formatGameDate(
      this.state.date.day,
      this.state.date.month,
      this.state.date.year,
      this.state.date.calendarYear
    );
  }
}

export function createGameEngine(options?: GameEngineOptions): GameEngine {
  return new GameEngine(options);
}
