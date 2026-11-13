import {
  calculateCargoPayment,
  calculateSecondaryIndustryOutput,
  calculateSlopeSpeedFactor,
} from '../formulas';
import {
  ActionResult,
  BuyVehicleParams,
  CargoType,
  DemoRouteType,
  FloatingPopup,
  GameSpeed,
  GameState,
  LocalPlayerIdentity,
  MapSizeOption,
  ModifiedTileDelta,
  RemotePlayerWorldSlice,
  ScenarioType,
  Station,
  StationDetailsInfo,
  StationKind,
  Tile,
  TileInspectionInfo,
  ToolType,
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
  getHQTierSpec,
  INDUSTRY_LABELS_NO,
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

export interface ApplyToolOptions {
  stationLength?: number;
  orientation?: 'X' | 'Y';
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

  private stepVehicleSubTick(vehicle: Vehicle): void {
    if (
      vehicle.state === 'STOPPED' ||
      vehicle.state === 'IN_DEPOT' ||
      vehicle.orders.length === 0
    ) {
      vehicle.speedKmh = 0;
      return;
    }

    if (vehicle.currentOrderIndex >= vehicle.orders.length || vehicle.currentOrderIndex < 0) {
      vehicle.currentOrderIndex = 0;
    }

    const targetStationId = vehicle.orders[vehicle.currentOrderIndex];
    const targetStation = this.state.stations.find((s) => s.id === targetStationId);

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
      this.handleVehicleAtStation(vehicle, targetStation);
      return;
    }

    // Ensure valid path to targetStation (and verify next step wasn't bulldozed)
    const firstPathPt = vehicle.path[0];
    const lastPathPt = vehicle.path[vehicle.path.length - 1];
    const firstStepTile =
      firstPathPt && inBounds(firstPathPt.x, firstPathPt.y, this.state.mapSize)
        ? this.state.tiles[tileIndex(firstPathPt.x, firstPathPt.y, this.state.mapSize)]
        : null;
    const firstStepTraversable = Boolean(
      firstStepTile &&
        (isTileTraversableForNetwork(firstStepTile, vehicle.network) ||
          targetStation.tiles.some(
            (t) => t.x === firstPathPt.x && t.y === firstPathPt.y
          ))
    );
    const pathValid =
      vehicle.path.length > 0 &&
      firstStepTraversable &&
      Boolean(lastPathPt) &&
      targetStation.tiles.some(
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
        targetStation.tiles,
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
          targetStation.tiles,
          vehicle.network
        );
      }
      if (vehicle.path.length === 0) {
        vehicle.speedKmh = 0;
        return;
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
          targetStation.tiles,
          'RAIL',
          occupied
        );
        if (
          altPath.length > 0 &&
          (altPath[0].x !== nextStep.x || altPath[0].y !== nextStep.y)
        ) {
          const altCheck = canTrainEnterNextTile(
            { ...vehicle, path: altPath },
            altPath[0],
            this.state.tiles,
            this.state.mapSize,
            this.state.vehicles
          );
          if (altCheck.allowed) {
            vehicle.path = altPath;
            nextStep = altPath[0];
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

    const effectiveSpeedKmh = Math.max(
      10,
      Math.round(vehicle.maxSpeedKmh * slopeFactor * accelFactor * cornerFactor)
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

      if (vehicle.path.length > 0) {
        vehicle.nextX = vehicle.path[0].x;
        vehicle.nextY = vehicle.path[0].y;
      } else {
        vehicle.nextX = vehicle.x;
        vehicle.nextY = vehicle.y;
      }
    }
  }

  private handleVehicleAtStation(vehicle: Vehicle, station: Station): void {
    if (this.syncedPeerIds.has(vehicle.ownerId)) {
      if (vehicle.state !== 'LOADING') {
        vehicle.state = 'LOADING';
        vehicle.speedKmh = 0;
        vehicle.progress = 0;
        vehicle.accelTicks = 0;
        vehicle.nextX = vehicle.x;
        vehicle.nextY = vehicle.y;
        vehicle.loadingTicksRemaining = 5;
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
      vehicle.loadingTicksRemaining = 5;

      // 1. Unload & Deliver if carrying accepted cargo from a DIFFERENT station
      if (
        vehicle.cargoAmount > 0 &&
        vehicle.cargoOriginStationId &&
        vehicle.cargoOriginStationId !== station.id
      ) {
        const acceptance = doesStationAcceptCargo(
          this.state,
          station,
          vehicle.cargoType
        );
        if (acceptance.accepts) {
          const originStation = this.state.stations.find(
            (s) => s.id === vehicle.cargoOriginStationId
          );
          const manhattanDist = originStation
            ? Math.max(
                1,
                Math.abs(station.x - originStation.x) +
                  Math.abs(station.y - originStation.y)
              )
            : 12;
          const transitDays = Math.max(
            0,
            this.state.date.totalDays - vehicle.cargoLoadedDay
          );

          const payout = calculateCargoPayment(
            vehicle.cargoType,
            vehicle.cargoAmount,
            manhattanDist,
            transitDays
          );

          if (payout > 0) {
            vehicle.profitThisYear += payout;
            if (vehicle.ownerId === 'player') {
              this.state.corporate.cash += payout;
              this.state.corporate.currentYearPnL.freightRevenue += payout;
              this.pushFloatingPopup(
                station.x,
                station.y,
                `+kr ${formatNorwegianNumber(payout)}`,
                'green'
              );
              recomputeValuationsAndWarnings(this.state);
            } else {
              const ai = this.state.aiCompanies.find(
                (a) => a.id === vehicle.ownerId
              );
              if (ai) {
                ai.cash += payout;
              }
            }
          }

          // Secondary Industry Production (WOOD -> GOODS, GRAIN -> FOOD)
          if (acceptance.targetIndustryId) {
            const targetInd = this.state.industries.find(
              (i) => i.id === acceptance.targetIndustryId
            );
            if (targetInd) {
              const conv = calculateSecondaryIndustryOutput(
                vehicle.cargoType,
                vehicle.cargoAmount
              );
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
              if (vehicle.cargoType === 'PASSENGERS') {
                town.deliveredPassengersThisMonth =
                  (town.deliveredPassengersThisMonth ?? 0) + vehicle.cargoAmount;
                town.growthCounter += vehicle.cargoAmount * 0.04;
              } else if (vehicle.cargoType === 'MAIL') {
                town.deliveredMailThisMonth =
                  (town.deliveredMailThisMonth ?? 0) + vehicle.cargoAmount;
                town.growthCounter += vehicle.cargoAmount * 0.05;
              } else if (
                vehicle.cargoType === 'GOODS' ||
                vehicle.cargoType === 'FOOD'
              ) {
                town.deliveredGoodsOrFoodThisMonth =
                  (town.deliveredGoodsOrFoodThisMonth ?? 0) + vehicle.cargoAmount;
                town.growthCounter += vehicle.cargoAmount * 0.07;
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

          vehicle.cargoAmount = 0;
          vehicle.cargoOriginStationId = null;
        }
      }
    }

    // 2. Gradual Loading of Waiting Cargo (`6..10` units per subtick, min 5 subticks dwell)
    station.daysSincePickup = 0;
    station.lastVehicleMaxSpeedKmh = vehicle.maxSpeedKmh;

    const available = station.waitingCargo[vehicle.cargoType] ?? 0;
    const freeSpace = vehicle.capacity - vehicle.cargoAmount;
    const loadRatePerSubtick = vehicle.network === 'RAIL' ? 10 : 7;

    if (available > 0 && freeSpace > 0) {
      const toLoad = Math.min(available, freeSpace, loadRatePerSubtick);
      station.waitingCargo[vehicle.cargoType] -= toLoad;
      if (vehicle.cargoAmount === 0) {
        vehicle.cargoOriginStationId = station.id;
        vehicle.cargoLoadedDay = this.state.date.totalDays;
      }
      vehicle.cargoAmount += toLoad;
    }

    vehicle.loadingTicksRemaining = Math.max(
      0,
      (vehicle.loadingTicksRemaining ?? 1) - 1
    );
    vehicle.fullLoadWaitTicks = (vehicle.fullLoadWaitTicks ?? 0) + 1;

    const remainingAtPlatform = station.waitingCargo[vehicle.cargoType] ?? 0;
    const activelyBoardingAvailable =
      remainingAtPlatform > 0 && vehicle.cargoAmount < vehicle.capacity;

    const waitingForFullLoad =
      Boolean(vehicle.waitForFullLoad) &&
      vehicle.cargoAmount < vehicle.capacity &&
      doesStationCatchmentProduceCargo(this.state, station, vehicle.cargoType) &&
      (vehicle.fullLoadWaitTicks ?? 0) < FULL_LOAD_MAX_WAIT_SUBTICKS;

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
      if (tile.terrain === 'WATER') {
        const horizLand =
          inBounds(rx - 1, ry, this.state.mapSize) &&
          inBounds(rx + 1, ry, this.state.mapSize) &&
          this.state.tiles[tileIndex(rx - 1, ry, this.state.mapSize)].terrain !== 'WATER' &&
          this.state.tiles[tileIndex(rx + 1, ry, this.state.mapSize)].terrain !== 'WATER';
        if (horizLand) {
          return this.applyDragTrackOrRoad(rx - 1, ry, rx + 1, ry, tool);
        }
        const vertLand =
          inBounds(rx, ry - 1, this.state.mapSize) &&
          inBounds(rx, ry + 1, this.state.mapSize) &&
          this.state.tiles[tileIndex(rx, ry - 1, this.state.mapSize)].terrain !== 'WATER' &&
          this.state.tiles[tileIndex(rx, ry + 1, this.state.mapSize)].terrain !== 'WATER';
        if (vertLand) {
          return this.applyDragTrackOrRoad(rx, ry - 1, rx, ry + 1, tool);
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
      const stationLength =
        tool === 'TRAIN_STATION'
          ? Math.max(1, Math.min(3, Math.round(options?.stationLength ?? 1)))
          : 1;
      const orientation = options?.orientation ?? 'X';
      const targetTiles: GridPoint[] = [];

      for (let i = 0; i < stationLength; i++) {
        const tx = orientation === 'X' ? rx + i : rx;
        const ty = orientation === 'Y' ? ry + i : ry;
        if (!inBounds(tx, ty, this.state.mapSize)) {
          return { ok: false, message: 'Stasjonen går utenfor kartkanten.' };
        }
        const tt = this.state.tiles[tileIndex(tx, ty, this.state.mapSize)];
        if (
          tt.terrain === 'WATER' ||
          tt.industryId ||
          tt.hqOwnerId ||
          tt.depot ||
          tt.stationId ||
          (tt.buildingTier ?? 0) > 0 ||
          (tool === 'TRAIN_STATION' && tt.road) ||
          (tool !== 'TRAIN_STATION' && tt.rail)
        ) {
          return {
            ok: false,
            message: 'Kan ikke plassere stasjon her — ruten er opptatt eller ulendt.',
          };
        }
        targetTiles.push({ x: tx, y: ty });
      }

      const cost = BUILD_COSTS[tool] * targetTiles.length;
      if (this.state.corporate.cash < cost) {
        return { ok: false, message: 'Ikke nok selskapskontanter til stasjon.' };
      }

      this.spendCorporateConstruction(cost, rx, ry);

      // Check if adjacent to an existing player station of the same kind (<= 3 tiles total) to extend platform cleanly
      let mergedStation: Station | undefined;
      if (stationLength === 1) {
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
        if (tool === 'TRAIN_STATION') tt.rail = true;
        else tt.road = true;

        mergedStation.tiles.push({ x: rx, y: ry });
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
        if (tool === 'TRAIN_STATION') tt.rail = true;
        else tt.road = true;
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
        townId: null,
        nearbyIndustryIds: [],
        waitingCargo: createEmptyCargoRecord(),
        ratings: createInitialRatingsRecord(),
        daysSincePickup: 0,
        lastVehicleMaxSpeedKmh: tool === 'TRAIN_STATION' ? 90 : 75,
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
        message: `Bygget ${station.name}.`,
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
            st.x = st.tiles[0].x;
            st.y = st.tiles[0].y;
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
      tile.depot = null;
      tile.stationId = null;
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
    tool: DragTrackTool
  ): Array<{
    x: number;
    y: number;
    isBridge: boolean;
    axis?: 'X' | 'Y';
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
            bridgeShoreIndices.add(wStart - 1);
            bridgeShoreIndices.add(wEnd + 1);
            for (let k = wStart; k <= wEnd; k++) {
              validBridgeWaterIndices.add(k);
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
      cost: number;
    }> = [];

    const bridgeUnitCost =
      baseMode === 'RAIL' ? BUILD_COSTS.RAIL_BRIDGE : BUILD_COSTS.ROAD_BRIDGE;

    for (let idx = 0; idx < workingPts.length; idx++) {
      const pt = workingPts[idx];
      const tile =
        this.state.tiles[tileIndex(pt.x, pt.y, this.state.mapSize)];

      if (tile.terrain === 'WATER') {
        if (!validBridgeWaterIndices.has(idx) || !axis) continue;
        const alreadySameBridge =
          tile.bridge === baseMode && tile.bridgeAxis === axis;
        planned.push({
          x: pt.x,
          y: pt.y,
          isBridge: true,
          axis,
          cost: alreadySameBridge ? 0 : bridgeUnitCost,
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
    tool: DragTrackTool
  ): { tiles: Array<{ x: number; y: number }>; cost: number } {
    const line = computeDragLineTiles(fromX, fromY, toX, toY, this.state.mapSize);
    const planned = this.planDragTrackOrBridge(line, tool);
    const isExplicitBridge =
      tool === 'RAIL_BRIDGE' || tool === 'ROAD_BRIDGE';
    if (isExplicitBridge && !planned.some((p) => p.isBridge)) {
      return { tiles: [], cost: 0 };
    }
    let cost = 0;
    const validTiles: Array<{ x: number; y: number }> = [];
    for (const item of planned) {
      validTiles.push({ x: item.x, y: item.y });
      cost += item.cost;
    }
    return { tiles: validTiles, cost };
  }

  /**
   * Supports both:
   * - `applyDragTrackOrRoad(fromX, fromY, toX, toY, 'RAIL' | 'ROAD' | 'RAIL_BRIDGE' | 'ROAD_BRIDGE')`
   * - `applyDragTrackOrRoad(tilesArray, 'RAIL' | 'ROAD' | 'RAIL_BRIDGE' | 'ROAD_BRIDGE')`
   */
  public applyDragTrackOrRoad(
    arg1: number | Array<{ x: number; y: number }>,
    arg2: number | DragTrackTool,
    toX?: number,
    toY?: number,
    toolArg?: DragTrackTool
  ): ActionResult {
    let points: GridPoint[];
    let tool: DragTrackTool;

    if (Array.isArray(arg1)) {
      points = arg1;
      tool = typeof arg2 === 'string' ? arg2 : 'ROAD';
    } else {
      const fx = arg1;
      const fy = typeof arg2 === 'number' ? arg2 : 0;
      const tx = toX ?? fx;
      const ty = toY ?? fy;
      tool = toolArg ?? 'ROAD';
      points = computeDragLineTiles(fx, fy, tx, ty, this.state.mapSize);
    }

    const baseMode: 'RAIL' | 'ROAD' =
      tool === 'RAIL' || tool === 'RAIL_BRIDGE' ? 'RAIL' : 'ROAD';
    const isExplicitBridge =
      tool === 'RAIL_BRIDGE' || tool === 'ROAD_BRIDGE';

    const planned = this.planDragTrackOrBridge(points, tool);
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
        if (item.cost > 0) {
          if (this.state.corporate.cash < item.cost) break;
          this.state.corporate.cash -= item.cost;
          this.state.corporate.currentYearPnL.constructionCost += item.cost;
          tile.terrain = 'WATER';
          tile.elevation = 0;
          tile.bridge = baseMode;
          tile.bridgeAxis = item.axis;
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
      const label =
        bridgeBuiltCount > 0
          ? baseMode === 'RAIL'
            ? `jernbanebro (${bridgeBuiltCount} vannruter)`
            : `veibro (${bridgeBuiltCount} vannruter)`
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

    const clampedWagons =
      spec.network === 'RAIL' ? Math.max(1, Math.min(6, Math.round(wagonCount))) : 0;
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
    const vehicle: Vehicle = {
      id: `veh-${vehPrefix}${this.state.vehicles.length + 1}-${Math.random()
        .toString(36)
        .slice(2, 5)}`,
      name: `${labelPrefix} #${playerFleetCount} (${CARGO_LABELS_NO[selectedCargo]})`,
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
      state: validOrders.length > 0 ? 'MOVING' : 'IN_DEPOT',
      orders: validOrders,
      currentOrderIndex: 0,
      path: [],
      profitThisYear: 0,
      runningCostPerMonth: Math.round(annualRunCost / 12),
      purchaseValue: totalCost,
      ageMonths: 0,
      wagonCount: clampedWagons,
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
        vehicle.cargoType = cargoType;
        vehicle.cargoAmount = 0;
        vehicle.cargoOriginStationId = null;
        const basePart = vehicle.name.split(' (')[0];
        vehicle.name = `${basePart} (${CARGO_LABELS_NO[cargoType]})`;
      }
    }

    vehicle.orders = orders.filter((sid) =>
      this.state.stations.some((s) => s.id === sid)
    );
    if (vehicle.currentOrderIndex >= vehicle.orders.length) {
      vehicle.currentOrderIndex = 0;
    }
    vehicle.path = [];

    // Automatically dispatch out of depot when given station orders
    if (vehicle.orders.length > 0 && vehicle.state === 'IN_DEPOT') {
      vehicle.state = 'MOVING';
    } else if (vehicle.orders.length === 0 && vehicle.state === 'MOVING') {
      vehicle.state = 'STOPPED';
      vehicle.speedKmh = 0;
    }

    this.emit();
    return { ok: true, vehicleId: vehicle.id, message: 'Kjøreordre oppdatert.' };
  }

  public toggleVehicleStopped(vehicleId: string): ActionResult {
    const vehicle = this.state.vehicles.find(
      (v) => v.id === vehicleId && v.ownerId === 'player'
    );
    if (!vehicle) {
      return { ok: false, message: 'Fant ikke kjøretøyet.' };
    }

    if (vehicle.state === 'STOPPED' || vehicle.state === 'IN_DEPOT') {
      if (vehicle.orders.length === 0) {
        return {
          ok: false,
          message: 'Legg til minst én stasjon i kjøreordren før start!',
        };
      }
      vehicle.state = 'MOVING';
      vehicle.path = [];
    } else {
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

    let descriptionNo = terrainLabelNo;
    if (tile.hqOwnerId === 'player') {
      const hqSpec = getHQTierSpec(this.state.corporate.hqTier);
      descriptionNo = `Hovedkontor: ${hqSpec ? hqSpec.nameNo : 'Nivå 1'}`;
    } else if (tile.hqOwnerId && remotePeerOwner) {
      const hqSpec = getHQTierSpec(hqTier ?? 1);
      descriptionNo = `Hovedkontor (${remotePeerOwner.companyName}): ${hqSpec ? hqSpec.nameNo : 'Nivå 1'}`;
    } else if (tile.bridge === 'RAIL') {
      descriptionNo = 'Jernbanebro over vann';
    } else if (tile.bridge === 'ROAD') {
      descriptionNo = 'Veibro over vann';
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

  public sellVehicle(vehicleId: string): ActionResult {
    const idx = this.state.vehicles.findIndex(
      (v) => v.id === vehicleId && v.ownerId === 'player'
    );
    if (idx === -1) {
      return { ok: false, message: 'Fant ikke kjøretøyet.' };
    }

    const v = this.state.vehicles[idx];
    const resaleValue = Math.round(
      v.purchaseValue * Math.max(0.25, 0.85 - v.ageMonths * 0.008)
    );
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
      }
      if (t.depot) delta.depot = t.depot;
      if (t.stationId) delta.stationId = t.stationId;
      if (t.hqOwnerId === 'player') {
        delta.hqOwnerId = clientId;
        delta.hqOwnerTier = this.state.corporate.hqTier || 1;
      }
      modifiedTiles.push(delta);
    }

    const stations: Station[] = this.state.stations
      .filter((s) => s.ownerId === 'player')
      .map((s) => ({
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
      }));

    const vehicles: Vehicle[] = this.state.vehicles
      .filter((v) => v.ownerId === 'player')
      .map((v) => ({
        id: v.id,
        name: v.name,
        ownerId: clientId,
        network: v.network,
        modelId: v.modelId,
        cargoType: v.cargoType,
        capacity: v.capacity,
        cargoAmount: v.cargoAmount,
        cargoOriginStationId: v.cargoOriginStationId,
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
        trail: (v.trail ?? [{ x: v.x, y: v.y }]).map((pt) => ({
          x: pt.x,
          y: pt.y,
        })),
        depotX: v.depotX ?? v.x,
        depotY: v.depotY ?? v.y,
        loadingTicksRemaining: v.loadingTicksRemaining ?? 0,
        waitForFullLoad: Boolean(v.waitForFullLoad),
        accelTicks: v.accelTicks ?? 0,
        fullLoadWaitTicks: v.fullLoadWaitTicks ?? 0,
      }));

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
        const normalizedStation: Station = {
          id: rawSt.id,
          name: rawSt.name || `${peer.companyName} Stasjon`,
          ownerId: peerId,
          kind: rawSt.kind || 'BUS_STOP',
          x: rawSt.x,
          y: rawSt.y,
          tiles: stTiles,
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
        const normalizedVehicle: Vehicle = {
          ...rawVeh,
          ownerId: peerId,
          orders: Array.isArray(rawVeh.orders) ? rawVeh.orders : [],
          path: Array.isArray(rawVeh.path) ? rawVeh.path : [],
          trail:
            Array.isArray(rawVeh.trail) && rawVeh.trail.length > 0
              ? rawVeh.trail
              : [{ x: rawVeh.x, y: rawVeh.y }],
        };
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
