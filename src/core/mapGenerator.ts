import {
  Industry,
  IndustryType,
  ScenarioType,
  TerrainType,
  Tile,
  Town,
  CargoType,
} from '../types/game';

export const NORWEGIAN_TOWN_NAMES = [
  'Oslo',
  'Bergen',
  'Trondheim',
  'Stavanger',
  'Tromsø',
  'Kristiansand',
  'Ålesund',
  'Bodø',
];

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise2D(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const hash = (ix: number, iy: number): number => {
    let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  const smooth = (t: number) => t * t * (3 - 2 * t);
  const u = smooth(xf);
  const v = smooth(yf);

  const n00 = hash(xi, yi);
  const n10 = hash(xi + 1, yi);
  const n01 = hash(xi, yi + 1);
  const n11 = hash(xi + 1, yi + 1);

  const nx0 = n00 * (1 - u) + n10 * u;
  const nx1 = n01 * (1 - u) + n11 * u;
  return nx0 * (1 - v) + nx1 * v;
}

function fbm2D(x: number, y: number, seed: number): number {
  let value = 0;
  let amp = 0.55;
  let freq = 1;
  for (let i = 0; i < 3; i++) {
    value += amp * valueNoise2D(x * freq, y * freq, seed + i * 97);
    freq *= 2.05;
    amp *= 0.45;
  }
  return value;
}

export function tileIndex(x: number, y: number, mapSize: number): number {
  return y * mapSize + x;
}

export function inBounds(x: number, y: number, mapSize: number): boolean {
  return x >= 0 && y >= 0 && x < mapSize && y < mapSize;
}

export interface GeneratedWorld {
  mapSize: number;
  tiles: Tile[];
  towns: Town[];
  industries: Industry[];
}

export function generateWorld(
  mapSize = 64,
  scenario: ScenarioType = 'standard',
  seed = 20261112
): GeneratedWorld {
  const rng = createSeededRng(seed + (scenario === 'boom' ? 101 : scenario === 'challenge' ? 202 : 0));
  const tiles: Tile[] = new Array(mapSize * mapSize);

  const prodMultiplier =
    scenario === 'boom' ? 1.35 : scenario === 'challenge' ? 0.85 : 1.0;

  // 1. Cohesive continent heightmap with coastal fjords/bays along outer rim and gentle hills inland
  const half = mapSize / 2;
  for (let y = 0; y < mapSize; y++) {
    for (let x = 0; x < mapSize; x++) {
      const nx = (x - half) / half; // -1..1
      const ny = (y - half) / half; // -1..1
      const edgeDist = Math.max(Math.abs(nx), Math.abs(ny));
      const radialDist = Math.hypot(nx * 0.92, ny * 0.92);

      const baseNoise = fbm2D(x / 13, y / 13, seed);
      const detailNoise = valueNoise2D(x / 6, y / 6, seed + 555);
      const forestNoise = fbm2D(x / 9, y / 9, seed + 999);

      // Keep core 82% of map connected mainland; create scenic coastal bays near borders
      let heightVal = baseNoise * 0.78 + detailNoise * 0.22;
      if (edgeDist > 0.82) {
        heightVal -= (edgeDist - 0.82) * 3.1;
      } else if (radialDist > 0.88) {
        heightVal -= (radialDist - 0.88) * 2.4;
      }

      // Add one small scenic fjord bay on west edge and one small lake in NE quadrant that don't bisect mainland
      const fjordDist = Math.hypot((x - 4) / 7, (y - mapSize * 0.48) / 5.5);
      if (fjordDist < 1.0) {
        heightVal -= (1.0 - fjordDist) * 0.85;
      }

      let elevation = 1;
      if (heightVal < 0.24) {
        elevation = 0;
      } else if (heightVal < 0.56) {
        elevation = 1;
      } else if (heightVal < 0.73) {
        elevation = 2;
      } else if (heightVal < 0.86) {
        elevation = 3;
      } else {
        elevation = scenario === 'challenge' ? 4 : 3;
      }

      let terrain: TerrainType = 'GRASS';
      if (elevation === 0) {
        terrain = 'WATER';
      } else if (forestNoise > 0.62 && elevation >= 1 && elevation <= 3) {
        terrain = 'FOREST_TREES';
      }

      tiles[tileIndex(x, y, mapSize)] = {
        x,
        y,
        elevation,
        terrain,
        road: false,
        rail: false,
        signal: false,
        signalBlocked: false,
        depot: null,
        stationId: null,
        townId: null,
        industryId: null,
        hqOwnerId: null,
        ownerId: null,
        buildingTier: 0,
      };
    }
  }

  // Mark SAND beaches adjacent to WATER
  for (let y = 0; y < mapSize; y++) {
    for (let x = 0; x < mapSize; x++) {
      const tile = tiles[tileIndex(x, y, mapSize)];
      if (tile.elevation === 1) {
        let nearWater = false;
        for (let dy = -1; dy <= 1 && !nearWater; dy++) {
          for (let dx = -1; dx <= 1 && !nearWater; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (inBounds(nx, ny, mapSize)) {
              if (tiles[tileIndex(nx, ny, mapSize)].terrain === 'WATER') {
                nearWater = true;
              }
            }
          }
        }
        if (nearWater) {
          tile.terrain = 'SAND';
        }
      }
    }
  }

  // Helper to flatten a rectangular patch to elevation 1 or 2 (above water)
  const flattenPatch = (cx: number, cy: number, radius: number, targetElev = 1) => {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (!inBounds(tx, ty, mapSize)) continue;
        const t = tiles[tileIndex(tx, ty, mapSize)];
        if (t.terrain === 'WATER') {
          t.terrain = 'GRASS';
        }
        t.elevation = targetElev;
        if (Math.abs(dx) <= radius - 1 && Math.abs(dy) <= radius - 1 && t.terrain === 'SAND') {
          t.terrain = 'GRASS';
        }
      }
    }
  };

  // 2. Place 8 well-spaced Norwegian Towns in a ring/grid across mainland
  const anchorRatios: Array<[number, number]> = [
    [0.50, 0.52], // Oslo (central hub)
    [0.20, 0.56], // Bergen (west)
    [0.48, 0.22], // Trondheim (north-central)
    [0.24, 0.80], // Stavanger (southwest)
    [0.78, 0.18], // Tromsø (northeast)
    [0.52, 0.82], // Kristiansand (south)
    [0.22, 0.26], // Ålesund (northwest)
    [0.78, 0.58], // Bodø (east)
  ];

  const towns: Town[] = [];
  const minTownSpacing = Math.floor(mapSize * 0.19);

  for (let i = 0; i < NORWEGIAN_TOWN_NAMES.length; i++) {
    const [rx, ry] = anchorRatios[i];
    let bestX = Math.round(rx * mapSize);
    let bestY = Math.round(ry * mapSize);

    // Jitter slightly to find natural flat land away from other towns
    for (let attempt = 0; attempt < 40; attempt++) {
      const candX = Math.max(7, Math.min(mapSize - 8, Math.round(rx * mapSize + (rng() - 0.5) * 8)));
      const candY = Math.max(7, Math.min(mapSize - 8, Math.round(ry * mapSize + (rng() - 0.5) * 8)));
      const candTile = tiles[tileIndex(candX, candY, mapSize)];
      const farEnough = towns.every(
        (t) => Math.hypot(t.x - candX, t.y - candY) >= minTownSpacing
      );
      if (farEnough && candTile.terrain !== 'WATER' && candTile.elevation <= 2) {
        bestX = candX;
        bestY = candY;
        break;
      }
    }

    const baseElev = Math.max(1, Math.min(2, tiles[tileIndex(bestX, bestY, mapSize)].elevation || 1));
    flattenPatch(bestX, bestY, 4, baseElev);

    const initialPop = i === 0
      ? Math.round((680 + rng() * 180) * prodMultiplier)
      : Math.round((360 + rng() * 260) * prodMultiplier);

    const townId = `town-${i + 1}`;
    const town: Town = {
      id: townId,
      name: NORWEGIAN_TOWN_NAMES[i],
      x: bestX,
      y: bestY,
      population: initialPop,
      growthCounter: 0,
      monthlyPassengers: Math.max(14, Math.round(initialPop * 0.06)),
      monthlyMail: Math.max(6, Math.round(initialPop * 0.025)),
      servicedStations: 0,
      deliveredPassengersThisMonth: 0,
      deliveredMailThisMonth: 0,
      deliveredGoodsOrFoodThisMonth: 0,
    };
    towns.push(town);

    // Stamp town cross-roads + initial residential/commercial buildings
    stampInitialTownCluster(tiles, mapSize, town);
  }

  // 3. Place Primary & Secondary Industries logically across mainland
  interface IndustryBlueprint {
    type: IndustryType;
    suffixNo: string;
    produces: CargoType | null;
    accepts: CargoType[];
    baseMonthlyProd: number;
    preferNearTown: boolean;
  }

  const blueprints: IndustryBlueprint[] = [
    // Chain 1: Coal Mine -> Power Plant (2 pairs)
    { type: 'COAL_MINE', suffixNo: 'Kullgruve', produces: 'COAL', accepts: [], baseMonthlyProd: 120, preferNearTown: false },
    { type: 'POWER_PLANT', suffixNo: 'Kraftverk', produces: null, accepts: ['COAL'], baseMonthlyProd: 0, preferNearTown: true },
    { type: 'COAL_MINE', suffixNo: 'Kullgruve', produces: 'COAL', accepts: [], baseMonthlyProd: 110, preferNearTown: false },
    { type: 'POWER_PLANT', suffixNo: 'Kraftverk', produces: null, accepts: ['COAL'], baseMonthlyProd: 0, preferNearTown: true },

    // Chain 2: Forest -> Sawmill -> Goods to Towns (3 Forests, 2 Sawmills)
    { type: 'FOREST', suffixNo: 'Skogbruk', produces: 'WOOD', accepts: [], baseMonthlyProd: 115, preferNearTown: false },
    { type: 'SAWMILL', suffixNo: 'Sagbruk', produces: 'GOODS', accepts: ['WOOD'], baseMonthlyProd: 0, preferNearTown: true },
    { type: 'FOREST', suffixNo: 'Skogbruk', produces: 'WOOD', accepts: [], baseMonthlyProd: 105, preferNearTown: false },
    { type: 'SAWMILL', suffixNo: 'Sagbruk', produces: 'GOODS', accepts: ['WOOD'], baseMonthlyProd: 0, preferNearTown: true },
    { type: 'FOREST', suffixNo: 'Skogbruk', produces: 'WOOD', accepts: [], baseMonthlyProd: 100, preferNearTown: false },

    // Chain 3: Farm -> Food Plant -> Food to Towns (3 Farms, 2 Food Plants)
    { type: 'FARM', suffixNo: 'Gård', produces: 'GRAIN', accepts: [], baseMonthlyProd: 110, preferNearTown: false },
    { type: 'FOOD_PLANT', suffixNo: 'Matfabrikk', produces: 'FOOD', accepts: ['GRAIN'], baseMonthlyProd: 0, preferNearTown: true },
    { type: 'FARM', suffixNo: 'Gård', produces: 'GRAIN', accepts: [], baseMonthlyProd: 100, preferNearTown: false },
    { type: 'FOOD_PLANT', suffixNo: 'Matfabrikk', produces: 'FOOD', accepts: ['GRAIN'], baseMonthlyProd: 0, preferNearTown: true },
    { type: 'FARM', suffixNo: 'Gård', produces: 'GRAIN', accepts: [], baseMonthlyProd: 95, preferNearTown: false },
  ];

  const industries: Industry[] = [];

  for (let idx = 0; idx < blueprints.length; idx++) {
    const bp = blueprints[idx];
    let placedX = -1;
    let placedY = -1;

    for (let attempt = 0; attempt < 250; attempt++) {
      const cx = 6 + Math.floor(rng() * (mapSize - 13));
      const cy = 6 + Math.floor(rng() * (mapSize - 13));

      // Check 6x6 clearance (2x2 industry + 2-tile buildable ring around it)
      let clear = true;
      for (let dy = -2; dy <= 3 && clear; dy++) {
        for (let dx = -2; dx <= 3 && clear; dx++) {
          const tx = cx + dx;
          const ty = cy + dy;
          if (!inBounds(tx, ty, mapSize)) {
            clear = false;
            break;
          }
          const t = tiles[tileIndex(tx, ty, mapSize)];
          if (t.terrain === 'WATER' || t.townId || t.industryId || t.road || t.rail) {
            clear = false;
          }
        }
      }
      if (!clear) continue;

      // Check spacing from towns and other industries
      const nearestTownDist = Math.min(
        ...towns.map((t) => Math.hypot(t.x - cx, t.y - cy))
      );
      if (nearestTownDist < 6.5) continue;
      if (bp.preferNearTown && nearestTownDist > mapSize * 0.28 && attempt < 160) continue;
      if (!bp.preferNearTown && nearestTownDist < 8.5 && attempt < 140) continue;

      const tooCloseIndustry = industries.some(
        (ind) => Math.hypot(ind.x - cx, ind.y - cy) < 8.5
      );
      if (tooCloseIndustry && attempt < 200) continue;

      // Ensure paired industry isn't right next door (keep nice profitable haul distance 12..34 tiles)
      if (bp.type === 'POWER_PLANT') {
        const coalMine = industries.find((i) => i.type === 'COAL_MINE');
        if (coalMine) {
          const d = Math.hypot(coalMine.x - cx, coalMine.y - cy);
          if ((d < 12 || d > 34) && attempt < 160) continue;
        }
      } else if (bp.type === 'SAWMILL') {
        const forest = industries.find((i) => i.type === 'FOREST');
        if (forest) {
          const d = Math.hypot(forest.x - cx, forest.y - cy);
          if ((d < 11 || d > 32) && attempt < 160) continue;
        }
      } else if (bp.type === 'FOOD_PLANT') {
        const farm = industries.find((i) => i.type === 'FARM');
        if (farm) {
          const d = Math.hypot(farm.x - cx, farm.y - cy);
          if ((d < 11 || d > 32) && attempt < 160) continue;
        }
      }

      placedX = cx;
      placedY = cy;
      break;
    }

    if (placedX === -1) {
      // Deterministic fallback scan
      outer: for (let cy = 8; cy < mapSize - 10; cy += 2) {
        for (let cx = 8; cx < mapSize - 10; cx += 2) {
          const ok = [0, 1].every((dy) =>
            [0, 1].every((dx) => {
              const t = tiles[tileIndex(cx + dx, cy + dy, mapSize)];
              return t.terrain !== 'WATER' && !t.townId && !t.industryId && !t.road;
            })
          );
          const indDistOk = industries.every((ind) => Math.hypot(ind.x - cx, ind.y - cy) >= 6);
          if (ok && indDistOk) {
            placedX = cx;
            placedY = cy;
            break outer;
          }
        }
      }
    }

    if (placedX === -1) continue;

    const baseElev = Math.max(
      1,
      Math.min(2, tiles[tileIndex(placedX, placedY, mapSize)].elevation || 1)
    );
    flattenPatch(placedX, placedY, 3, baseElev);

    // Nearest town gives the industry its regional Norwegian name
    const nearestTown = towns.reduce((best, t) =>
      Math.hypot(t.x - placedX, t.y - placedY) <
      Math.hypot(best.x - placedX, best.y - placedY)
        ? t
        : best
    );

    const indId = `ind-${industries.length + 1}`;
    const sameNameCount = industries.filter((i) =>
      i.name.startsWith(`${nearestTown.name} ${bp.suffixNo}`)
    ).length;
    const indName =
      sameNameCount === 0
        ? `${nearestTown.name} ${bp.suffixNo}`
        : `${nearestTown.name} ${bp.suffixNo} ${sameNameCount + 1}`;

    const monthlyProd =
      bp.baseMonthlyProd > 0
        ? Math.round(bp.baseMonthlyProd * prodMultiplier)
        : 0;

    const industry: Industry = {
      id: indId,
      name: indName,
      type: bp.type,
      x: placedX,
      y: placedY,
      width: 2,
      height: 2,
      produces: bp.produces,
      accepts: [...bp.accepts],
      monthlyProduction: monthlyProd,
      storedOutput: 0,
    };
    industries.push(industry);

    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const t = tiles[tileIndex(placedX + dx, placedY + dy, mapSize)];
        t.industryId = indId;
        t.terrain = 'GRASS';
        t.buildingTier = 0;
      }
    }

    // Surround FOREST industry with lush pine groves on outer border
    if (bp.type === 'FOREST') {
      for (let dy = -2; dy <= 3; dy++) {
        for (let dx = -2; dx <= 3; dx++) {
          if (dx >= -1 && dx <= 2 && dy >= -1 && dy <= 2) continue;
          const tx = placedX + dx;
          const ty = placedY + dy;
          if (!inBounds(tx, ty, mapSize)) continue;
          const t = tiles[tileIndex(tx, ty, mapSize)];
          if (!t.industryId && !t.townId && !t.road && t.terrain === 'GRASS') {
            t.terrain = 'FOREST_TREES';
          }
        }
      }
    }
  }

  return {
    mapSize,
    tiles,
    towns,
    industries,
  };
}

function stampInitialTownCluster(tiles: Tile[], mapSize: number, town: Town): void {
  const cx = town.x;
  const cy = town.y;

  // Crossroad through center (-2..+2)
  for (let d = -2; d <= 2; d++) {
    if (inBounds(cx + d, cy, mapSize)) {
      const t = tiles[tileIndex(cx + d, cy, mapSize)];
      t.road = true;
      t.terrain = 'GRASS';
      t.townId = town.id;
    }
    if (inBounds(cx, cy + d, mapSize)) {
      const t = tiles[tileIndex(cx, cy + d, mapSize)];
      t.road = true;
      t.terrain = 'GRASS';
      t.townId = town.id;
    }
  }

  // Place buildings in the 4 quadrants around the crossroad
  const buildingOffsets: Array<[number, number, number]> = [
    [-1, -1, 2],
    [1, -1, 2],
    [-1, 1, 2],
    [1, 1, 1],
    [-2, -1, 1],
    [2, -1, 1],
    [-1, -2, 1],
    [1, 2, 1],
  ];

  if (town.population >= 550) {
    buildingOffsets[0][2] = 3;
    buildingOffsets.push([2, 1, 1], [-2, 1, 1]);
  }

  for (const [dx, dy, tier] of buildingOffsets) {
    const tx = cx + dx;
    const ty = cy + dy;
    if (!inBounds(tx, ty, mapSize)) continue;
    const t = tiles[tileIndex(tx, ty, mapSize)];
    if (t.terrain !== 'WATER' && !t.road && !t.rail && !t.industryId) {
      t.terrain = 'GRASS';
      t.townId = town.id;
      t.buildingTier = tier;
    }
  }
}

export function expandTownBuildings(
  tiles: Tile[],
  mapSize: number,
  town: Town
): boolean {
  let changed = false;

  // Target total building tiles scales with population
  const desiredBuildings = Math.min(28, Math.max(8, Math.floor(town.population / 75)));
  const townTiles: Tile[] = [];
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      const tx = town.x + dx;
      const ty = town.y + dy;
      if (!inBounds(tx, ty, mapSize)) continue;
      const t = tiles[tileIndex(tx, ty, mapSize)];
      if (t.townId === town.id && (t.buildingTier ?? 0) > 0) {
        townTiles.push(t);
      }
    }
  }

  // Upgrade central houses to Tier 2 / Tier 3 as population crosses milestones
  for (const bt of townTiles) {
    const dist = Math.hypot(bt.x - town.x, bt.y - town.y);
    if (town.population >= 900 && dist <= 1.8 && (bt.buildingTier ?? 1) < 3) {
      bt.buildingTier = 3;
      changed = true;
    } else if (town.population >= 550 && dist <= 2.6 && (bt.buildingTier ?? 1) < 2) {
      bt.buildingTier = 2;
      changed = true;
    }
  }

  if (townTiles.length >= desiredBuildings) {
    return changed;
  }

  // Spiral outward from center to add a new town road/house
  const candidates: Array<{ x: number; y: number; dist: number }> = [];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const tx = town.x + dx;
      const ty = town.y + dy;
      if (!inBounds(tx, ty, mapSize)) continue;
      const t = tiles[tileIndex(tx, ty, mapSize)];
      if (
        t.terrain !== 'WATER' &&
        !t.road &&
        !t.rail &&
        !t.stationId &&
        !t.depot &&
        !t.industryId &&
        !t.hqOwnerId &&
        (t.buildingTier ?? 0) === 0
      ) {
        candidates.push({ x: tx, y: ty, dist: Math.hypot(dx, dy) });
      }
    }
  }

  candidates.sort((a, b) => a.dist - b.dist);
  const toAdd = Math.min(2, desiredBuildings - townTiles.length, candidates.length);
  for (let i = 0; i < toAdd; i++) {
    const c = candidates[i];
    const t = tiles[tileIndex(c.x, c.y, mapSize)];
    t.terrain = 'GRASS';
    t.townId = town.id;
    t.buildingTier = c.dist <= 2.2 && town.population >= 650 ? 2 : 1;
    changed = true;
  }

  return changed;
}
