import { calculateSlopeSpeedFactor } from '../formulas';
import { Tile, Vehicle } from '../types/game';
import { inBounds, tileIndex } from './mapGenerator';

export interface GridPoint {
  x: number;
  y: number;
}

const DIRS_4: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function isTileTraversableForNetwork(
  tile: Tile,
  network: 'ROAD' | 'RAIL'
): boolean {
  if (network === 'ROAD') {
    return Boolean(tile.road || tile.depot === 'ROAD');
  }
  return Boolean(tile.rail || tile.depot === 'RAIL');
}

/**
 * Fast 4-connected A* pathfinder on the player/shared road or rail network.
 * Returns the ordered array of tiles AFTER (startX, startY) up to the reached goal tile.
 */
export function findNetworkPath(
  tiles: Tile[],
  mapSize: number,
  startX: number,
  startY: number,
  goalTiles: GridPoint[],
  network: 'ROAD' | 'RAIL',
  avoidOccupiedByOtherTrains?: Set<number>
): GridPoint[] {
  if (goalTiles.length === 0) return [];
  if (!inBounds(startX, startY, mapSize)) return [];

  const goalSet = new Set<number>();
  for (const g of goalTiles) {
    if (inBounds(g.x, g.y, mapSize)) {
      goalSet.add(tileIndex(g.x, g.y, mapSize));
    }
  }
  if (goalSet.size === 0) return [];

  const startIdx = tileIndex(startX, startY, mapSize);
  if (goalSet.has(startIdx)) return [];

  const total = mapSize * mapSize;
  const gScore = new Float64Array(total);
  gScore.fill(Infinity);
  const cameFrom = new Int32Array(total);
  cameFrom.fill(-1);
  const closed = new Uint8Array(total);

  const heuristic = (x: number, y: number): number => {
    let best = Infinity;
    for (const g of goalTiles) {
      const d = Math.abs(x - g.x) + Math.abs(y - g.y);
      if (d < best) best = d;
    }
    return best;
  };

  // Simple binary min-heap on node indices + fScore
  const heapNodes: number[] = [];
  const heapF: number[] = [];

  const pushHeap = (node: number, f: number) => {
    heapNodes.push(node);
    heapF.push(f);
    let i = heapNodes.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= heapF[i]) break;
      [heapNodes[p], heapNodes[i]] = [heapNodes[i], heapNodes[p]];
      [heapF[p], heapF[i]] = [heapF[i], heapF[p]];
      i = p;
    }
  };

  const popHeap = (): number => {
    const top = heapNodes[0];
    const lastNode = heapNodes.pop()!;
    const lastF = heapF.pop()!;
    if (heapNodes.length > 0) {
      heapNodes[0] = lastNode;
      heapF[0] = lastF;
      let i = 0;
      const n = heapNodes.length;
      while (true) {
        let smallest = i;
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        if (l < n && heapF[l] < heapF[smallest]) smallest = l;
        if (r < n && heapF[r] < heapF[smallest]) smallest = r;
        if (smallest === i) break;
        [heapNodes[i], heapNodes[smallest]] = [heapNodes[smallest], heapNodes[i]];
        [heapF[i], heapF[smallest]] = [heapF[smallest], heapF[i]];
        i = smallest;
      }
    }
    return top;
  };

  gScore[startIdx] = 0;
  pushHeap(startIdx, heuristic(startX, startY));

  let reachedGoalIdx = -1;

  while (heapNodes.length > 0) {
    const currentIdx = popHeap();
    if (closed[currentIdx]) continue;
    closed[currentIdx] = 1;

    if (goalSet.has(currentIdx)) {
      reachedGoalIdx = currentIdx;
      break;
    }

    const cx = currentIdx % mapSize;
    const cy = (currentIdx - cx) / mapSize;
    const curTile = tiles[currentIdx];

    for (const [dx, dy] of DIRS_4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny, mapSize)) continue;
      const nIdx = tileIndex(nx, ny, mapSize);
      if (closed[nIdx]) continue;

      const nextTile = tiles[nIdx];
      if (!isTileTraversableForNetwork(nextTile, network) && !goalSet.has(nIdx)) {
        continue;
      }

      // Do not route through unrelated depots unless starting or ending there
      if (
        nextTile.depot &&
        !goalSet.has(nIdx) &&
        nIdx !== startIdx
      ) {
        continue;
      }

      const slopeFactor = calculateSlopeSpeedFactor(
        curTile.elevation,
        nextTile.elevation,
        network === 'RAIL' ? 'rail' : 'road'
      );
      let stepCost = 1 / Math.max(0.25, slopeFactor);

      if (
        network === 'RAIL' &&
        avoidOccupiedByOtherTrains &&
        avoidOccupiedByOtherTrains.has(nIdx) &&
        !goalSet.has(nIdx)
      ) {
        // Prefer free parallel siding / loop when another train occupies a single track
        stepCost += 9;
      }

      const tentativeG = gScore[currentIdx] + stepCost;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = currentIdx;
        gScore[nIdx] = tentativeG;
        pushHeap(nIdx, tentativeG + heuristic(nx, ny));
      }
    }
  }

  if (reachedGoalIdx === -1) return [];

  const path: GridPoint[] = [];
  let trace = reachedGoalIdx;
  while (trace !== -1 && trace !== startIdx) {
    const px = trace % mapSize;
    const py = (trace - px) / mapSize;
    path.push({ x: px, y: py });
    trace = cameFrom[trace];
  }
  path.reverse();
  return path;
}

/**
 * Overland corridor A* for AI competitors and Demo Route builders to lay new road/rail.
 * Returns inclusive list of tiles from start to goal.
 */
export function findConstructionCorridor(
  tiles: Tile[],
  mapSize: number,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  mode: 'ROAD' | 'RAIL',
  blockedSet?: Set<number>
): GridPoint[] {
  if (!inBounds(startX, startY, mapSize) || !inBounds(goalX, goalY, mapSize)) {
    return [];
  }

  const startIdx = tileIndex(startX, startY, mapSize);
  const goalIdx = tileIndex(goalX, goalY, mapSize);
  if (startIdx === goalIdx) return [{ x: startX, y: startY }];

  const total = mapSize * mapSize;
  const gScore = new Float64Array(total);
  gScore.fill(Infinity);
  const cameFrom = new Int32Array(total);
  cameFrom.fill(-1);
  const closed = new Uint8Array(total);

  const heapNodes: number[] = [];
  const heapF: number[] = [];

  const pushHeap = (node: number, f: number) => {
    heapNodes.push(node);
    heapF.push(f);
    let i = heapNodes.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= heapF[i]) break;
      [heapNodes[p], heapNodes[i]] = [heapNodes[i], heapNodes[p]];
      [heapF[p], heapF[i]] = [heapF[i], heapF[p]];
      i = p;
    }
  };

  const popHeap = (): number => {
    const top = heapNodes[0];
    const lastNode = heapNodes.pop()!;
    const lastF = heapF.pop()!;
    if (heapNodes.length > 0) {
      heapNodes[0] = lastNode;
      heapF[0] = lastF;
      let i = 0;
      const n = heapNodes.length;
      while (true) {
        let smallest = i;
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        if (l < n && heapF[l] < heapF[smallest]) smallest = l;
        if (r < n && heapF[r] < heapF[smallest]) smallest = r;
        if (smallest === i) break;
        [heapNodes[i], heapNodes[smallest]] = [heapNodes[smallest], heapNodes[i]];
        [heapF[i], heapF[smallest]] = [heapF[smallest], heapF[i]];
        i = smallest;
      }
    }
    return top;
  };

  gScore[startIdx] = 0;
  pushHeap(startIdx, Math.abs(startX - goalX) + Math.abs(startY - goalY));

  let found = false;

  while (heapNodes.length > 0) {
    const cur = popHeap();
    if (closed[cur]) continue;
    closed[cur] = 1;

    if (cur === goalIdx) {
      found = true;
      break;
    }

    const cx = cur % mapSize;
    const cy = (cur - cx) / mapSize;
    const curTile = tiles[cur];

    for (const [dx, dy] of DIRS_4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny, mapSize)) continue;
      const nIdx = tileIndex(nx, ny, mapSize);
      if (closed[nIdx]) continue;
      if (blockedSet && blockedSet.has(nIdx) && nIdx !== goalIdx && nIdx !== startIdx) {
        continue;
      }

      const nt = tiles[nIdx];
      const isEndpoint = nIdx === goalIdx || nIdx === startIdx;

      if (!isEndpoint) {
        if (nt.terrain === 'WATER') continue;
        if (nt.industryId || nt.hqOwnerId || nt.depot || nt.stationId) continue;
        if ((nt.buildingTier ?? 0) > 0) continue;
        if (mode === 'ROAD' && nt.signal) continue;
      }

      let cost = 1.0;
      const elevDiff = Math.abs(nt.elevation - curTile.elevation);
      cost += elevDiff * (mode === 'RAIL' ? 2.5 : 1.3);
      if (nt.terrain === 'FOREST_TREES') cost += 0.4;
      if (mode === 'ROAD' && nt.road && !nt.rail) {
        cost = 0.45; // Encourage reusing town/intercity roads!
      } else if (mode === 'RAIL' && nt.rail && !nt.road && !blockedSet?.has(nIdx)) {
        cost = 0.6;
      } else if ((mode === 'RAIL' && nt.road) || (mode === 'ROAD' && nt.rail)) {
        // Allow plain road/rail level crossings when needed, with modest A* penalty
        cost += 3.5;
      }

      const tentative = gScore[cur] + cost;
      if (tentative < gScore[nIdx]) {
        cameFrom[nIdx] = cur;
        gScore[nIdx] = tentative;
        const h = Math.abs(nx - goalX) + Math.abs(ny - goalY);
        pushHeap(nIdx, tentative + h);
      }
    }
  }

  if (!found) return [];

  const result: GridPoint[] = [];
  let trace = goalIdx;
  while (trace !== -1) {
    const px = trace % mapSize;
    const py = (trace - px) / mapSize;
    result.push({ x: px, y: py });
    if (trace === startIdx) break;
    trace = cameFrom[trace];
  }
  result.reverse();
  return result;
}

/**
 * Computes a crisp 4-connected orthogonal L-path for interactive mouse drag construction.
 */
export function computeDragLineTiles(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  mapSize: number
): GridPoint[] {
  const pts: GridPoint[] = [];
  const sx = Math.max(0, Math.min(mapSize - 1, Math.round(fromX)));
  const sy = Math.max(0, Math.min(mapSize - 1, Math.round(fromY)));
  const ex = Math.max(0, Math.min(mapSize - 1, Math.round(toX)));
  const ey = Math.max(0, Math.min(mapSize - 1, Math.round(toY)));

  let cx = sx;
  let cy = sy;
  pts.push({ x: cx, y: cy });

  const dx = Math.abs(ex - sx);
  const dy = Math.abs(ey - sy);

  if (dx >= dy) {
    const stepX = ex >= sx ? 1 : -1;
    while (cx !== ex) {
      cx += stepX;
      pts.push({ x: cx, y: cy });
    }
    const stepY = ey >= sy ? 1 : -1;
    while (cy !== ey) {
      cy += stepY;
      pts.push({ x: cx, y: cy });
    }
  } else {
    const stepY = ey >= sy ? 1 : -1;
    while (cy !== ey) {
      cy += stepY;
      pts.push({ x: cx, y: cy });
    }
    const stepX = ex >= sx ? 1 : -1;
    while (cx !== ex) {
      cx += stepX;
      pts.push({ x: cx, y: cy });
    }
  }

  return pts;
}

/**
 * Collects the set of tile indices occupied by all active rail trains (optionally excluding one vehicle).
 */
export function getOccupiedRailTileSet(
  vehicles: Vehicle[],
  mapSize: number,
  excludeVehicleId?: string
): Set<number> {
  const occupied = new Set<number>();
  for (const v of vehicles) {
    if (v.network !== 'RAIL' || v.state === 'IN_DEPOT') continue;
    if (excludeVehicleId && v.id === excludeVehicleId) continue;

    if (inBounds(v.x, v.y, mapSize)) {
      occupied.add(tileIndex(v.x, v.y, mapSize));
    }
    if (inBounds(v.nextX, v.nextY, mapSize)) {
      occupied.add(tileIndex(v.nextX, v.nextY, mapSize));
    }
    if (v.trail) {
      const maxTrail = Math.min(v.trail.length, Math.max(1, Math.ceil(v.wagonCount * 0.6)));
      for (let i = 0; i < maxTrail; i++) {
        const tp = v.trail[i];
        if (inBounds(tp.x, tp.y, mapSize)) {
          occupied.add(tileIndex(tp.x, tp.y, mapSize));
        }
      }
    }
  }
  return occupied;
}

/**
 * Checks whether a train can safely advance into `nextStep` respecting Rail Block Signals
 * and occupied tiles ahead. Updates `tile.signalBlocked` for visual red/green signal lamps.
 */
export function canTrainEnterNextTile(
  train: Vehicle,
  nextStep: GridPoint,
  tiles: Tile[],
  mapSize: number,
  allVehicles: Vehicle[]
): { allowed: boolean; blockedSignalTile: Tile | null } {
  const occupiedByOthers = getOccupiedRailTileSet(allVehicles, mapSize, train.id);
  const nextIdx = tileIndex(nextStep.x, nextStep.y, mapSize);
  const curTile = tiles[tileIndex(train.x, train.y, mapSize)];
  const nextTile = tiles[nextIdx];

  // Immediate physical collision prevention: never enter an occupied tile
  if (occupiedByOthers.has(nextIdx)) {
    const sigTile = nextTile.signal ? nextTile : curTile.signal ? curTile : null;
    if (sigTile) sigTile.signalBlocked = true;
    return { allowed: false, blockedSignalTile: sigTile };
  }

  // Block-signal check when standing at or stepping past a signal tile
  const signalTile = nextTile.signal ? nextTile : curTile.signal ? curTile : null;
  if (signalTile) {
    // Scan path ahead up to the next signal (or up to 14 tiles ahead)
    const lookaheadLimit = Math.min(train.path.length, 14);
    for (let i = 0; i < lookaheadLimit; i++) {
      const p = train.path[i];
      const pIdx = tileIndex(p.x, p.y, mapSize);
      if (occupiedByOthers.has(pIdx)) {
        signalTile.signalBlocked = true;
        return { allowed: false, blockedSignalTile: signalTile };
      }
      const pt = tiles[pIdx];
      if (i > 0 && pt.signal) {
        // Reached end of this signal block cleanly!
        break;
      }
    }
    signalTile.signalBlocked = false;
  }

  return { allowed: true, blockedSignalTile: null };
}

/**
 * Refreshes `signalBlocked` lamp indicators across all rail signal tiles on the map:
 * red (`true`) if a train is currently waiting at the signal OR occupying an adjacent block tile,
 * green (`false`) when clear.
 */
export function refreshSignalLampStates(
  tiles: Tile[],
  mapSize: number,
  vehicles: Vehicle[]
): void {
  const occupied = getOccupiedRailTileSet(vehicles, mapSize);

  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (!t.signal) continue;

    let blocked = occupied.has(i);
    if (!blocked) {
      // Check up to 3 tiles in each connected rail direction for an active train in the block
      for (const [dx, dy] of DIRS_4) {
        for (let step = 1; step <= 3; step++) {
          const nx = t.x + dx * step;
          const ny = t.y + dy * step;
          if (!inBounds(nx, ny, mapSize)) break;
          const nIdx = tileIndex(nx, ny, mapSize);
          const nt = tiles[nIdx];
          if (!nt.rail) break;
          if (occupied.has(nIdx)) {
            blocked = true;
            break;
          }
          if (nt.signal) break;
        }
        if (blocked) break;
      }
    }

    t.signalBlocked = blocked;
  }
}
