import { calculateCompanyValuation } from '../formulas';
import {
  AICompany,
  CargoType,
  DemoRouteType,
  GameState,
  Industry,
  Station,
  StationKind,
  Tile,
  Town,
  Vehicle,
  VehicleModelId,
} from '../types/game';
import {
  BRIDGE_CATALOG,
  calculateVehicleBaseAnnualCost,
  calculateVehicleCapacity,
  calculateVehiclePurchaseCost,
  CARGO_LABELS_NO,
  COMPANY_COLORS,
  createEmptyCargoRecord,
  createInitialRatingsRecord,
  TOTAL_AI_SHARES,
  VEHICLE_CATALOG,
} from './catalog';
import {
  pushNews,
  refreshStationCatchment,
  seedInitialStationCargo,
} from './dualEconomy';
import { inBounds, tileIndex } from './mapGenerator';
import { findConstructionCorridor, findNetworkPath, GridPoint } from './pathfinder';

export function createInitialAICompanies(
  aiEnabled = true,
  maxAiCount: 0 | 1 | 2 | 3 = 3
): AICompany[] {
  if (!aiEnabled || maxAiCount <= 0) {
    return [];
  }
  const all: AICompany[] = [
    {
      id: 'ai-1',
      name: 'Nordic Rail & Cargo',
      color: COMPANY_COLORS['ai-1'],
      spawnMonth: 12, // Start of Year 2
      spawned: false,
      cash: 0,
      loan: 0,
      fleetCount: 0,
      annualProfit: 0,
      companyValue: 0,
      sharePrice: 0,
      sharePriceHistory: [],
      dividendPerQuarter: 0,
      playerSharesPct: 0,
      routeSummary: 'Børsnoteres År 2 (Måned 12)',
    },
    {
      id: 'ai-2',
      name: 'FjordExpress AS',
      color: COMPANY_COLORS['ai-2'],
      spawnMonth: 24, // Start of Year 3
      spawned: false,
      cash: 0,
      loan: 0,
      fleetCount: 0,
      annualProfit: 0,
      companyValue: 0,
      sharePrice: 0,
      sharePriceHistory: [],
      dividendPerQuarter: 0,
      playerSharesPct: 0,
      routeSummary: 'Børsnoteres År 3 (Måned 24)',
    },
    {
      id: 'ai-3',
      name: 'Sørlandet Transport',
      color: COMPANY_COLORS['ai-3'],
      spawnMonth: 36, // Start of Year 4
      spawned: false,
      cash: 0,
      loan: 0,
      fleetCount: 0,
      annualProfit: 0,
      companyValue: 0,
      sharePrice: 0,
      sharePriceHistory: [],
      dividendPerQuarter: 0,
      playerSharesPct: 0,
      routeSummary: 'Børsnoteres År 4 (Måned 36)',
    },
  ];
  return all.slice(0, Math.min(3, Math.max(0, maxAiCount)));
}

function isTileClearForStructure(tile: Tile): boolean {
  return (
    tile.terrain !== 'WATER' &&
    !tile.industryId &&
    !tile.hqOwnerId &&
    !tile.stationId &&
    !tile.depot &&
    !tile.rail &&
    !tile.road &&
    (tile.buildingTier ?? 0) === 0
  );
}

function findClearTileNearIndustry(
  state: GameState,
  ind: Industry
): GridPoint | null {
  const candidates: Array<{ x: number; y: number; dist: number }> = [];
  for (let dy = -3; dy <= ind.height + 2; dy++) {
    for (let dx = -3; dx <= ind.width + 2; dx++) {
      const tx = ind.x + dx;
      const ty = ind.y + dy;
      if (!inBounds(tx, ty, state.mapSize)) continue;
      const t = state.tiles[tileIndex(tx, ty, state.mapSize)];
      if (!isTileClearForStructure(t)) continue;

      // Guarantee within 3-tile Chebyshev catchment of at least one tile of the industry
      let minCheb = Infinity;
      for (let iy = 0; iy < ind.height; iy++) {
        for (let ix = 0; ix < ind.width; ix++) {
          const cheb = Math.max(Math.abs(tx - (ind.x + ix)), Math.abs(ty - (ind.y + iy)));
          if (cheb < minCheb) minCheb = cheb;
        }
      }
      if (minCheb > 3) continue;

      const distToCenter = Math.hypot(
        tx - (ind.x + 0.5),
        ty - (ind.y + 0.5)
      );
      if (distToCenter >= 1.2) {
        candidates.push({ x: tx, y: ty, dist: distToCenter });
      }
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0] ? { x: candidates[0].x, y: candidates[0].y } : null;
}

function findClearTileNearTown(
  state: GameState,
  town: Town,
  preferAdjacentRoad: boolean
): GridPoint | null {
  const candidates: Array<{ x: number; y: number; score: number }> = [];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const tx = town.x + dx;
      const ty = town.y + dy;
      if (!inBounds(tx, ty, state.mapSize)) continue;
      const t = state.tiles[tileIndex(tx, ty, state.mapSize)];
      if (
        t.terrain === 'WATER' ||
        t.industryId ||
        t.hqOwnerId ||
        t.stationId ||
        t.depot ||
        t.rail ||
        (t.buildingTier ?? 0) > 0
      ) {
        continue;
      }
      // Allow placing a BUS_STOP directly on an outer town road tile or clear grass adjacent to town road
      let adjRoad = false;
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (inBounds(tx + ox, ty + oy, state.mapSize)) {
          if (state.tiles[tileIndex(tx + ox, ty + oy, state.mapSize)].road) {
            adjRoad = true;
          }
        }
      }
      if (t.road && Math.abs(dx) + Math.abs(dy) <= 1) {
        // Don't block central town intersection
        continue;
      }
      const dist = Math.hypot(dx, dy);
      const score = dist + (preferAdjacentRoad && adjRoad ? -2.5 : 0) + (t.road ? 0.5 : 0);
      candidates.push({ x: tx, y: ty, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] ? { x: candidates[0].x, y: candidates[0].y } : null;
}

function findDepotTileAdjacentTo(
  state: GameState,
  anchor: GridPoint
): GridPoint | null {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    const nx = anchor.x + dx;
    const ny = anchor.y + dy;
    if (!inBounds(nx, ny, state.mapSize)) continue;
    const t = state.tiles[tileIndex(nx, ny, state.mapSize)];
    if (isTileClearForStructure(t)) {
      return { x: nx, y: ny };
    }
  }
  return null;
}

function placeStationRecord(
  state: GameState,
  ownerId: string,
  kind: StationKind,
  pt: GridPoint,
  baseLabel: string,
  idPrefix = ''
): Station {
  const prefixPart = idPrefix ? `${idPrefix}-` : '';
  const id = `st-${prefixPart}${state.stations.length + 1}-${Math.random().toString(36).slice(2, 5)}`;
  const t = state.tiles[tileIndex(pt.x, pt.y, state.mapSize)];
  t.terrain = 'GRASS';
  t.stationId = id;
  t.ownerId = ownerId;
  if (kind === 'TRAIN_STATION') {
    t.rail = true;
  } else {
    t.road = true;
  }

  const existingSame = state.stations.filter((s) =>
    s.name.startsWith(baseLabel)
  ).length;
  const suffix =
    kind === 'TRAIN_STATION'
      ? 'Stasjon'
      : kind === 'BUS_STOP'
        ? 'Holdeplass'
        : 'Godsterminal';
  const name =
    existingSame === 0
      ? `${baseLabel} ${suffix}`
      : `${baseLabel} ${suffix} ${existingSame + 1}`;

  const station: Station = {
    id,
    name,
    ownerId,
    kind,
    x: pt.x,
    y: pt.y,
    tiles: [{ x: pt.x, y: pt.y }],
    townId: null,
    nearbyIndustryIds: [],
    waitingCargo: createEmptyCargoRecord(),
    ratings: createInitialRatingsRecord(),
    daysSincePickup: 0,
    lastVehicleMaxSpeedKmh: kind === 'TRAIN_STATION' ? 88 : 56,
  };

  refreshStationCatchment(state, station);
  state.stations.push(station);
  seedInitialStationCargo(state, station);
  return station;
}

function createSpawnedVehicle(
  state: GameState,
  ownerId: string,
  modelId: VehicleModelId,
  cargoType: CargoType,
  wagonCount: number,
  startPt: GridPoint,
  depotPt: GridPoint,
  orders: string[],
  startOrderIndex: number,
  initialState: 'MOVING' | 'LOADING',
  idPrefix = ''
): Vehicle {
  const spec = VEHICLE_CATALOG[modelId];
  const purchaseValue = calculateVehiclePurchaseCost(modelId, wagonCount);
  const capacity = calculateVehicleCapacity(modelId, wagonCount);
  const annualCost = calculateVehicleBaseAnnualCost(modelId, wagonCount);
  const numForOwner =
    state.vehicles.filter(
      (v) => v.ownerId === ownerId && v.network === spec.network
    ).length + 1;

  const prefix =
    spec.network === 'RAIL'
      ? 'Tog'
      : modelId === 'BUS_CITY'
        ? 'Buss'
        : 'Lastebil';

  const targetSt = state.stations.find((s) => s.id === orders[startOrderIndex]);
  const initialPath = targetSt
    ? findNetworkPath(
        state.tiles,
        state.mapSize,
        startPt.x,
        startPt.y,
        targetSt.tiles,
        spec.network
      )
    : [];

  const nextStep = initialPath[0] ?? startPt;

  const prefixPart = idPrefix ? `${idPrefix}-` : '';
  const vehId = `veh-${prefixPart}${state.vehicles.length + 1}-${Math.random().toString(36).slice(2, 5)}`;
  const railWagonsCount = spec.network === 'RAIL' ? Math.max(0, Math.round(wagonCount)) : 0;
  const builtWagons =
    spec.network === 'RAIL'
      ? Array.from({ length: railWagonsCount }, (_, idx) => ({
          id: `${vehId}-w-${idx + 1}`,
          cargoType,
          capacity: spec.capacityPerWagon,
          cargoAmount: 0,
          cargoOriginStationId: null,
          cargoLoadedDay: state.date.totalDays,
          purchaseValue: spec.wagonPrice,
          annualRunningCost: spec.runningCostPerWagon,
        }))
      : undefined;

  const vehicle: Vehicle = {
    id: vehId,
    name: `${prefix} #${numForOwner} (${CARGO_LABELS_NO[cargoType]})`,
    ownerId,
    network: spec.network,
    modelId,
    cargoType,
    capacity,
    cargoAmount: 0,
    cargoOriginStationId: null,
    cargoLoadedDay: state.date.totalDays,
    x: startPt.x,
    y: startPt.y,
    nextX: nextStep.x,
    nextY: nextStep.y,
    progress: 0,
    direction: 0,
    speedKmh: initialState === 'MOVING' ? spec.maxSpeedKmh : 0,
    maxSpeedKmh: spec.maxSpeedKmh,
    state: initialState,
    orders: [...orders],
    currentOrderIndex: startOrderIndex,
    path: initialPath,
    profitThisYear: 0,
    runningCostPerMonth: Math.round(annualCost / 12),
    baseAnnualRunningCost: annualCost,
    purchaseValue,
    ageMonths: 0,
    wagonCount: railWagonsCount,
    wagons: builtWagons,
    wt: builtWagons ? builtWagons.map((w) => w.cargoType) : undefined,
    goingToDepot: null,
    trail: [{ x: startPt.x, y: startPt.y }],
    depotX: depotPt.x,
    depotY: depotPt.y,
    loadingTicksRemaining: initialState === 'LOADING' ? 5 : 0,
    waitForFullLoad: false,
    accelTicks: 0,
    fullLoadWaitTicks: 0,
  };

  state.vehicles.push(vehicle);
  return vehicle;
}

export interface BuiltRouteSummary {
  ok: boolean;
  description: string;
  totalBuildCost: number;
  totalVehicleCost: number;
  stationIds: string[];
  vehicleIds: string[];
}

function layCorridorTiles(
  state: GameState,
  pts: GridPoint[],
  mode: 'ROAD' | 'RAIL',
  ownerId: string
): number {
  let cost = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const t = state.tiles[tileIndex(p.x, p.y, state.mapSize)];
    if (t.terrain === 'WATER') {
      const adj = pts[i + 1] ?? pts[i - 1] ?? p;
      const axis: 'X' | 'Y' = Math.abs(adj.x - p.x) > 0 ? 'X' : 'Y';
      if (!t.bridge) {
        let leftElev = 1;
        for (let li = i - 1; li >= 0; li--) {
          const lt = state.tiles[tileIndex(pts[li].x, pts[li].y, state.mapSize)];
          if (lt.terrain !== 'WATER') {
            leftElev = lt.elevation;
            break;
          }
        }
        let rightElev = leftElev;
        for (let ri = i + 1; ri < pts.length; ri++) {
          const rt = state.tiles[tileIndex(pts[ri].x, pts[ri].y, state.mapSize)];
          if (rt.terrain !== 'WATER') {
            rightElev = rt.elevation;
            break;
          }
        }
        t.bridge = mode;
        t.bridgeAxis = axis;
        t.bridgeType = 'STEEL';
        t.bridgeElevation = Math.max(1, leftElev, rightElev);
        t.road = mode === 'ROAD';
        t.rail = mode === 'RAIL';
        if (!t.ownerId) t.ownerId = ownerId;
        cost +=
          mode === 'RAIL'
            ? BRIDGE_CATALOG.STEEL.railCostPerTile
            : BRIDGE_CATALOG.STEEL.roadCostPerTile;
      }
      continue;
    }
    if (mode === 'RAIL' && !t.rail) {
      t.rail = true;
      t.terrain = 'GRASS';
      if (!t.ownerId) t.ownerId = ownerId;
      cost += 4_500;
    } else if (mode === 'ROAD' && !t.road) {
      t.road = true;
      t.terrain = 'GRASS';
      if (!t.ownerId) t.ownerId = ownerId;
      cost += 2_500;
    }
  }
  return cost;
}

/**
 * Shared route builder used by both `spawnDemoRoute` (for player/teacher instant routes)
 * and autonomous AI competitors (`ai-1`, `ai-2`, `ai-3`).
 */
export function buildConnectedRoute(
  state: GameState,
  ownerId: string,
  routeType: DemoRouteType | 'grain_truck' | 'ai_rail_freight',
  deductFromOwnerLedger: boolean,
  idPrefix = ''
): BuiltRouteSummary {
  if (routeType === 'coal_rail' || routeType === 'ai_rail_freight') {
    // Pick best Coal Mine -> Power Plant (or Forest -> Sawmill fallback)
    const primaryTypes =
      routeType === 'coal_rail'
        ? (['COAL_MINE'] as const)
        : (['COAL_MINE', 'FOREST', 'FARM'] as const);

    const candidates: Array<{
      src: Industry;
      dst: Industry;
      cargo: CargoType;
      score: number;
    }> = [];

    for (const pType of primaryTypes) {
      const sources = state.industries.filter((i) => i.type === pType);
      const targetType =
        pType === 'COAL_MINE'
          ? 'POWER_PLANT'
          : pType === 'FOREST'
            ? 'SAWMILL'
            : 'FOOD_PLANT';
      const cargo: CargoType =
        pType === 'COAL_MINE' ? 'COAL' : pType === 'FOREST' ? 'WOOD' : 'GRAIN';
      const targets = state.industries.filter((i) => i.type === targetType);

      for (const src of sources) {
        const srcServed = state.stations.some((s) =>
          s.nearbyIndustryIds.includes(src.id)
        );
        for (const dst of targets) {
          const dist = Math.hypot(src.x - dst.x, src.y - dst.y);
          if (dist < 8) continue;
          const score = (srcServed ? 0 : 100) + Math.min(35, dist);
          candidates.push({ src, dst, cargo, score });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    let chosenRail: {
      src: Industry;
      dst: Industry;
      cargo: CargoType;
      ptA: GridPoint;
      ptB: GridPoint;
      mainCorridor: GridPoint[];
    } | null = null;

    for (const cand of candidates) {
      const candPtA = findClearTileNearIndustry(state, cand.src);
      const candPtB = findClearTileNearIndustry(state, cand.dst);
      if (!candPtA || !candPtB) continue;

      const corridor = findConstructionCorridor(
        state.tiles,
        state.mapSize,
        candPtA.x,
        candPtA.y,
        candPtB.x,
        candPtB.y,
        'RAIL'
      );
      if (corridor.length >= 3) {
        chosenRail = {
          src: cand.src,
          dst: cand.dst,
          cargo: cand.cargo,
          ptA: candPtA,
          ptB: candPtB,
          mainCorridor: corridor,
        };
        break;
      }
    }

    if (!chosenRail) {
      return {
        ok: false,
        description: 'Fant ingen sammenhengende jernbanetrasé.',
        totalBuildCost: 0,
        totalVehicleCost: 0,
        stationIds: [],
        vehicleIds: [],
      };
    }

    const bestPair = chosenRail;
    const { ptA, ptB, mainCorridor } = chosenRail;

    // Build parallel passing/return track avoiding interior tiles of mainCorridor so 2 trains never deadlock
    const interiorBlocked = new Set<number>();
    for (let i = 2; i < mainCorridor.length - 2; i++) {
      interiorBlocked.add(
        tileIndex(mainCorridor[i].x, mainCorridor[i].y, state.mapSize)
      );
    }
    const secondCorridor =
      mainCorridor.length >= 6
        ? findConstructionCorridor(
            state.tiles,
            state.mapSize,
            mainCorridor[1].x,
            mainCorridor[1].y,
            mainCorridor[mainCorridor.length - 2].x,
            mainCorridor[mainCorridor.length - 2].y,
            'RAIL',
            interiorBlocked
          )
        : [];

    let corridorCost = layCorridorTiles(state, mainCorridor, 'RAIL', ownerId);
    if (secondCorridor.length >= 3) {
      corridorCost += layCorridorTiles(state, secondCorridor, 'RAIL', ownerId);
    }

    // Place Stations
    const stA = placeStationRecord(
      state,
      ownerId,
      'TRAIN_STATION',
      ptA,
      bestPair.src.name.split(' ')[0],
      idPrefix
    );
    const stB = placeStationRecord(
      state,
      ownerId,
      'TRAIN_STATION',
      ptB,
      bestPair.dst.name.split(' ')[0],
      idPrefix
    );

    // Place Block Signals along main and second corridors (away from junction endpoints, bridges & road level crossings)
    let signalCount = 0;
    const placeSignalsAlong = (pts: GridPoint[]) => {
      for (let i = 3; i < pts.length - 3; i += 6) {
        const t = state.tiles[tileIndex(pts[i].x, pts[i].y, state.mapSize)];
        if (
          t.rail &&
          !t.road &&
          !t.bridge &&
          t.terrain !== 'WATER' &&
          !t.stationId &&
          !t.depot &&
          !t.signal
        ) {
          t.signal = true;
          t.signalBlocked = false;
          signalCount++;
        }
      }
    };
    placeSignalsAlong(mainCorridor);
    if (secondCorridor.length >= 7) {
      placeSignalsAlong(secondCorridor);
    }

    // Place Rail Depot adjacent to a dry land tile along mainCorridor or stA
    const depotAnchor =
      mainCorridor.find(
        (p, idx) =>
          idx > 0 &&
          state.tiles[tileIndex(p.x, p.y, state.mapSize)].terrain !== 'WATER'
      ) ?? ptA;
    const depotPt =
      findDepotTileAdjacentTo(state, depotAnchor) ??
      findDepotTileAdjacentTo(state, ptA) ??
      depotAnchor;

    if (depotPt.x !== ptA.x || depotPt.y !== ptA.y) {
      const dt = state.tiles[tileIndex(depotPt.x, depotPt.y, state.mapSize)];
      dt.terrain = 'GRASS';
      dt.rail = true;
      dt.depot = 'RAIL';
      dt.ownerId = ownerId;
    }

    const locoModel: VehicleModelId =
      state.date.year >= 3 ? 'LOCO_DIESEL' : 'LOCO_STEAM';
    const orders = [stA.id, stB.id];

    // Train 1 starts at stA loading cargo right away; Train 2 starts at depot / second corridor
    const v1 = createSpawnedVehicle(
      state,
      ownerId,
      locoModel,
      bestPair.cargo,
      3,
      ptA,
      depotPt,
      orders,
      0,
      'LOADING',
      idPrefix
    );

    const v2Ids: string[] = [v1.id];
    if (secondCorridor.length >= 3 || routeType === 'coal_rail') {
      const v2Start = secondCorridor.length >= 3 ? ptB : depotPt;
      const v2 = createSpawnedVehicle(
        state,
        ownerId,
        locoModel,
        bestPair.cargo,
        3,
        v2Start,
        depotPt,
        orders,
        secondCorridor.length >= 3 ? 1 : 1,
        secondCorridor.length >= 3 ? 'LOADING' : 'MOVING',
        idPrefix
      );
      v2Ids.push(v2.id);
    }

    const buildCost = corridorCost + 2 * 45_000 + 55_000 + signalCount * 6_000;
    const vehCost =
      calculateVehiclePurchaseCost(locoModel, 3) * v2Ids.length;

    if (deductFromOwnerLedger) {
      applyBuildAndVehicleLedger(state, ownerId, buildCost, vehCost);
    }

    state.networkRevision = (state.networkRevision ?? 0) + 1;

    return {
      ok: true,
      description: `${bestPair.src.name} ↔ ${bestPair.dst.name} (${CARGO_LABELS_NO[bestPair.cargo]})`,
      totalBuildCost: buildCost,
      totalVehicleCost: vehCost,
      stationIds: [stA.id, stB.id],
      vehicleIds: v2Ids,
    };
  }

  if (routeType === 'wood_truck' || routeType === 'grain_truck') {
    const srcType = routeType === 'wood_truck' ? 'FOREST' : 'FARM';
    const dstType = routeType === 'wood_truck' ? 'SAWMILL' : 'FOOD_PLANT';
    const cargo: CargoType = routeType === 'wood_truck' ? 'WOOD' : 'GRAIN';

    const sources = state.industries.filter((i) => i.type === srcType);
    const targets = state.industries.filter((i) => i.type === dstType);

    const truckCandidates: Array<{
      src: Industry;
      dst: Industry;
      score: number;
    }> = [];

    for (const s of sources) {
      const served = state.stations.some((st) => st.nearbyIndustryIds.includes(s.id));
      for (const d of targets) {
        const dist = Math.hypot(s.x - d.x, s.y - d.y);
        const score = (served ? 0 : 80) - Math.abs(dist - 18);
        truckCandidates.push({ src: s, dst: d, score });
      }
    }

    truckCandidates.sort((a, b) => b.score - a.score);

    let chosenTruck: {
      bestSrc: Industry;
      bestDst: Industry;
      ptA: GridPoint;
      ptB: GridPoint;
      roadCorridor: GridPoint[];
    } | null = null;

    for (const cand of truckCandidates) {
      const candPtA = findClearTileNearIndustry(state, cand.src);
      const candPtB = findClearTileNearIndustry(state, cand.dst);
      if (!candPtA || !candPtB) continue;

      const corridor = findConstructionCorridor(
        state.tiles,
        state.mapSize,
        candPtA.x,
        candPtA.y,
        candPtB.x,
        candPtB.y,
        'ROAD'
      );
      if (corridor.length >= 2) {
        chosenTruck = {
          bestSrc: cand.src,
          bestDst: cand.dst,
          ptA: candPtA,
          ptB: candPtB,
          roadCorridor: corridor,
        };
        break;
      }
    }

    if (!chosenTruck) {
      return {
        ok: false,
        description: 'Fant ingen gyldig veitrasé.',
        totalBuildCost: 0,
        totalVehicleCost: 0,
        stationIds: [],
        vehicleIds: [],
      };
    }

    const { bestSrc, bestDst, ptA, ptB, roadCorridor } = chosenTruck;

    const corridorCost = layCorridorTiles(state, roadCorridor, 'ROAD', ownerId);

    const stA = placeStationRecord(
      state,
      ownerId,
      'TRUCK_BAY',
      ptA,
      bestSrc.name.split(' ')[0],
      idPrefix
    );
    const stB = placeStationRecord(
      state,
      ownerId,
      'TRUCK_BAY',
      ptB,
      bestDst.name.split(' ')[0],
      idPrefix
    );

    const depotAnchor =
      roadCorridor.find(
        (p, idx) =>
          idx > 0 &&
          state.tiles[tileIndex(p.x, p.y, state.mapSize)].terrain !== 'WATER'
      ) ?? ptA;
    const depotPt =
      findDepotTileAdjacentTo(state, depotAnchor) ??
      findDepotTileAdjacentTo(state, ptA) ??
      depotAnchor;

    if (depotPt.x !== ptA.x || depotPt.y !== ptA.y) {
      const dt = state.tiles[tileIndex(depotPt.x, depotPt.y, state.mapSize)];
      dt.terrain = 'GRASS';
      dt.road = true;
      dt.depot = 'ROAD';
      dt.ownerId = ownerId;
    }

    const orders = [stA.id, stB.id];
    const v1 = createSpawnedVehicle(
      state,
      ownerId,
      'TRUCK_CARGO',
      cargo,
      0,
      ptA,
      depotPt,
      orders,
      0,
      'LOADING',
      idPrefix
    );
    const v2 = createSpawnedVehicle(
      state,
      ownerId,
      'TRUCK_CARGO',
      cargo,
      0,
      ptB,
      depotPt,
      orders,
      1,
      'LOADING',
      idPrefix
    );

    const buildCost = corridorCost + 2 * 30_000 + 35_000;
    const vehCost = calculateVehiclePurchaseCost('TRUCK_CARGO', 0) * 2;

    if (deductFromOwnerLedger) {
      applyBuildAndVehicleLedger(state, ownerId, buildCost, vehCost);
    }

    state.networkRevision = (state.networkRevision ?? 0) + 1;

    return {
      ok: true,
      description: `${bestSrc.name} ↔ ${bestDst.name} (${CARGO_LABELS_NO[cargo]})`,
      totalBuildCost: buildCost,
      totalVehicleCost: vehCost,
      stationIds: [stA.id, stB.id],
      vehicleIds: [v1.id, v2.id],
    };
  }

  // Default: 'bus_line' between two Norwegian towns
  const townCandidates: Array<{ a: Town; b: Town; score: number }> = [];

  for (let i = 0; i < state.towns.length; i++) {
    for (let j = i + 1; j < state.towns.length; j++) {
      const a = state.towns[i];
      const b = state.towns[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const aServed = state.stations.some(
        (s) => s.townId === a.id && s.kind === 'BUS_STOP'
      );
      const bServed = state.stations.some(
        (s) => s.townId === b.id && s.kind === 'BUS_STOP'
      );
      const rangePenalty = dist < 10 || dist > 38 ? 60 : 0;
      const score =
        (a.population + b.population) * 0.1 +
        (aServed ? 0 : 40) +
        (bServed ? 0 : 40) -
        Math.abs(dist - 20) -
        rangePenalty;
      townCandidates.push({ a, b, score });
    }
  }

  townCandidates.sort((x, y) => y.score - x.score);

  let chosenBus: {
    townA: Town;
    townB: Town;
    ptA: GridPoint;
    ptB: GridPoint;
    roadCorridor: GridPoint[];
  } | null = null;

  for (const cand of townCandidates) {
    const candPtA = findClearTileNearTown(state, cand.a, true);
    const candPtB = findClearTileNearTown(state, cand.b, true);
    if (!candPtA || !candPtB) continue;

    const corridor = findConstructionCorridor(
      state.tiles,
      state.mapSize,
      candPtA.x,
      candPtA.y,
      candPtB.x,
      candPtB.y,
      'ROAD'
    );
    if (corridor.length >= 2) {
      chosenBus = {
        townA: cand.a,
        townB: cand.b,
        ptA: candPtA,
        ptB: candPtB,
        roadCorridor: corridor,
      };
      break;
    }
  }

  if (!chosenBus) {
    return {
      ok: false,
      description: 'Fant ingen gyldig bussvei mellom byene.',
      totalBuildCost: 0,
      totalVehicleCost: 0,
      stationIds: [],
      vehicleIds: [],
    };
  }

  const { townA, townB, ptA, ptB, roadCorridor } = chosenBus;

  const corridorCost = layCorridorTiles(state, roadCorridor, 'ROAD', ownerId);

  const stA = placeStationRecord(state, ownerId, 'BUS_STOP', ptA, townA.name, idPrefix);
  const stB = placeStationRecord(state, ownerId, 'BUS_STOP', ptB, townB.name, idPrefix);

  const depotAnchor =
    roadCorridor.find(
      (p, idx) =>
        idx > 0 &&
        state.tiles[tileIndex(p.x, p.y, state.mapSize)].terrain !== 'WATER'
    ) ?? ptA;
  const depotPt =
    findDepotTileAdjacentTo(state, depotAnchor) ??
    findDepotTileAdjacentTo(state, ptA) ??
    depotAnchor;

  if (depotPt.x !== ptA.x || depotPt.y !== ptA.y) {
    const dt = state.tiles[tileIndex(depotPt.x, depotPt.y, state.mapSize)];
    dt.terrain = 'GRASS';
    dt.road = true;
    dt.depot = 'ROAD';
    dt.ownerId = ownerId;
  }

  const orders = [stA.id, stB.id];
  const v1 = createSpawnedVehicle(
    state,
    ownerId,
    'BUS_CITY',
    'PASSENGERS',
    0,
    ptA,
    depotPt,
    orders,
    0,
    'LOADING',
    idPrefix
  );
  const v2 = createSpawnedVehicle(
    state,
    ownerId,
    'BUS_CITY',
    'PASSENGERS',
    0,
    ptB,
    depotPt,
    orders,
    1,
    'LOADING',
    idPrefix
  );

  const buildCost = corridorCost + 2 * 25_000 + 35_000;
  const vehCost = calculateVehiclePurchaseCost('BUS_CITY', 0) * 2;

  if (deductFromOwnerLedger) {
    applyBuildAndVehicleLedger(state, ownerId, buildCost, vehCost);
  }

  state.networkRevision = (state.networkRevision ?? 0) + 1;

  return {
    ok: true,
    description: `${townA.name} ↔ ${townB.name} (Ekspressbuss)`,
    totalBuildCost: buildCost,
    totalVehicleCost: vehCost,
    stationIds: [stA.id, stB.id],
    vehicleIds: [v1.id, v2.id],
  };
}

function applyBuildAndVehicleLedger(
  state: GameState,
  ownerId: string,
  buildCost: number,
  vehCost: number
): void {
  if (ownerId === 'player') {
    state.corporate.cash -= buildCost + vehCost;
    state.corporate.currentYearPnL.constructionCost += buildCost;
    state.corporate.currentYearPnL.vehiclePurchaseCost += vehCost;
  } else {
    const ai = state.aiCompanies.find((c) => c.id === ownerId);
    if (ai) {
      ai.cash -= buildCost + vehCost;
    }
  }
}

export function updateAIMarketMetrics(state: GameState, ai: AICompany): void {
  const aiVehicles = state.vehicles.filter((v) => v.ownerId === ai.id);
  ai.fleetCount = aiVehicles.length;

  let fleetBookValue = 0;
  let rollingVehicleProfit = 0;
  for (const v of aiVehicles) {
    const dep = Math.max(0.3, 1 - v.ageMonths * 0.007);
    fleetBookValue += Math.round(v.purchaseValue * dep);
    rollingVehicleProfit += v.profitThisYear;
  }

  let infraCount = 0;
  for (const t of state.tiles) {
    if (t.ownerId === ai.id) infraCount++;
  }

  // Combine real route vehicle earnings with annualized operating baseline so IPO & quarterly dividends are smooth
  const monthsIntoYear = Math.max(1, state.date.month);
  const annualizedFromVehicles = Math.round((rollingVehicleProfit / monthsIntoYear) * 12);
  const baselineContractProfit = ai.fleetCount * 68_000;
  ai.annualProfit = Math.max(
    baselineContractProfit,
    annualizedFromVehicles + Math.round(baselineContractProfit * 0.5)
  );

  ai.companyValue = Math.max(
    650_000,
    calculateCompanyValuation({
      cash: ai.cash,
      loan: ai.loan,
      fleetBookValue,
      infrastructureCount: infraCount,
      annualProfit: ai.annualProfit,
    })
  );

  ai.sharePrice = Math.max(20, Math.round(ai.companyValue / TOTAL_AI_SHARES));
  ai.sharePriceHistory.push(ai.sharePrice);
  if (ai.sharePriceHistory.length > 24) {
    ai.sharePriceHistory.shift();
  }

  // Healthy dividend payout ~35% of quarterly profit when profitable
  const quarterlyProfit = Math.max(0, Math.round(ai.annualProfit / 4));
  ai.dividendPerQuarter =
    ai.cash > 150_000 ? Math.max(15_000, Math.round(quarterlyProfit * 0.38)) : 0;
}

/**
 * Checks staggered AI competitor spawns (Months 12, 24, 36) and updates active AI operations monthly.
 */
export function runMonthlyAICompetitorsTick(state: GameState): void {
  if (
    state.worldSetup &&
    (!state.worldSetup.aiEnabled || state.worldSetup.maxAiCount <= 0)
  ) {
    return;
  }
  const totalMonths = state.date.totalMonths;

  for (const ai of state.aiCompanies) {
    if (!ai.spawned && totalMonths >= ai.spawnMonth) {
      // Spawn AI Competitor & IPO on Stock Exchange!
      ai.spawned = true;
      ai.cash = 2_200_000;
      ai.loan = 1_000_000;

      const preferredRoute: DemoRouteType | 'grain_truck' | 'ai_rail_freight' =
        ai.id === 'ai-1'
          ? 'ai_rail_freight'
          : ai.id === 'ai-2'
            ? 'bus_line'
            : 'grain_truck';

      let built = buildConnectedRoute(state, ai.id, preferredRoute, true);
      if (!built.ok) {
        built = buildConnectedRoute(state, ai.id, 'wood_truck', true);
      }
      if (!built.ok) {
        built = buildConnectedRoute(state, ai.id, 'bus_line', true);
      }

      ai.routeSummary = built.ok ? built.description : 'Regional godstrafikk';
      updateAIMarketMetrics(state, ai);
      // Seed initial 3 points in history so sparkline renders nicely right after IPO
      if (ai.sharePriceHistory.length === 1) {
        const p = ai.sharePriceHistory[0];
        ai.sharePriceHistory = [Math.max(15, Math.round(p * 0.94)), Math.max(18, Math.round(p * 0.97)), p];
      }

      pushNews(
        state,
        `NY KONKURRENT PÅ BØRS: ${ai.name} har åpnet ruten ${ai.routeSummary} (Aksjekurs: ${ai.sharePrice} kr)!`,
        'COMPETITOR'
      );
      continue;
    }

    if (!ai.spawned) continue;

    // Deduct monthly AI loan interest + add modest regional mail/contract stipend
    const monthlyLoanInterest = Math.round((ai.loan * 0.065) / 12);
    ai.cash -= monthlyLoanInterest;
    ai.cash += ai.fleetCount * 4_500;

    // Periodically expand AI network every 8 months if profitable & cash-rich
    const monthsActive = totalMonths - ai.spawnMonth;
    if (monthsActive > 0 && monthsActive % 8 === 0 && ai.cash > 850_000 && ai.fleetCount < 6) {
      const expType =
        ai.id === 'ai-1'
          ? 'wood_truck'
          : ai.id === 'ai-2'
            ? 'grain_truck'
            : 'bus_line';
      const exp = buildConnectedRoute(state, ai.id, expType, true);
      if (exp.ok) {
        ai.routeSummary = `${ai.routeSummary} + ${exp.description}`;
        pushNews(
          state,
          `${ai.name} utvider nettverket med ny linje: ${exp.description}!`,
          'COMPETITOR'
        );
      }
    }

    updateAIMarketMetrics(state, ai);
  }
}
