import * as THREE from 'three';
import type {
  CargoType,
  GameState,
  Industry,
  IndustryType,
  Station,
  Tile,
} from '../types/game';
import {
  IsoSceneManager,
  formatNorwegianInt,
  getSurfaceHeightAt,
  getTileAt,
  getTileCornerHeights,
  resolveOwnerColor,
} from './IsoSceneManager';

const INDUSTRY_TYPE_NO: Record<IndustryType, string> = {
  FOREST: 'Tømmerskog',
  SAWMILL: 'Sagbruk',
  COAL_MINE: 'Kullgruve',
  POWER_PLANT: 'Kraftverk',
  FARM: 'Korngård',
  FOOD_PLANT: 'Matfabrikk',
};

function detHash(x: number, y: number, salt: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function sumWaitingCargo(waiting: Record<CargoType, number> | undefined): number {
  if (!waiting) return 0;
  let total = 0;
  for (const key in waiting) {
    total += waiting[key as CargoType] || 0;
  }
  return Math.round(total);
}

interface SignalLampRecord {
  x: number;
  y: number;
  lampMesh: THREE.Mesh;
  lastBlocked: boolean;
}

interface LabelRecord {
  id: string;
  kind: 'town' | 'industry' | 'station' | 'hq';
  wx: number;
  wy: number;
  wz: number;
  el: HTMLDivElement;
  stationId?: string;
}

export class StructuresRenderer {
  public readonly group = new THREE.Group();

  private buildingsGroup = new THREE.Group();
  private signalsGroup = new THREE.Group();

  private labelLayer: HTMLDivElement;
  private labels = new Map<string, LabelRecord>();
  private onStationBadgeClick?: (stationId: string) => void;

  // Cached geometries & materials (never leaked, disposed once on unmount)
  private readonly boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  private readonly coneGeo = new THREE.ConeGeometry(0.5, 1, 8);
  private readonly roofGeo: THREE.ConeGeometry;
  private readonly sphereGeo = new THREE.SphereGeometry(0.5, 8, 8);

  private readonly matCache = new Map<string, THREE.MeshLambertMaterial>();
  private readonly signalGreenMat: THREE.MeshBasicMaterial;
  private readonly signalRedMat: THREE.MeshBasicMaterial;

  private signalRecords: SignalLampRecord[] = [];
  private lastStructuresSig = '';
  private lastSignalsLayoutSig = '';

  constructor(overlayParent: HTMLElement, onStationBadgeClick?: (stationId: string) => void) {
    this.onStationBadgeClick = onStationBadgeClick;

    this.roofGeo = new THREE.ConeGeometry(0.72, 1, 4);
    this.roofGeo.rotateY(Math.PI / 4);

    this.signalGreenMat = new THREE.MeshBasicMaterial({ color: '#22c55e' });
    this.signalRedMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });

    this.group.add(this.buildingsGroup, this.signalsGroup);

    this.labelLayer = document.createElement('div');
    this.labelLayer.style.position = 'absolute';
    this.labelLayer.style.inset = '0';
    this.labelLayer.style.overflow = 'hidden';
    this.labelLayer.style.pointerEvents = 'none';
    this.labelLayer.style.zIndex = '5';
    overlayParent.appendChild(this.labelLayer);
  }

  private getMat(
    hex: string,
    emissiveHex?: string,
    emissiveIntensity = 0
  ): THREE.MeshLambertMaterial {
    const key = `${hex}|${emissiveHex ?? ''}|${emissiveIntensity}`;
    let mat = this.matCache.get(key);
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({
        color: hex,
        emissive: emissiveHex ? new THREE.Color(emissiveHex) : undefined,
        emissiveIntensity,
      });
      this.matCache.set(key, mat);
    }
    return mat;
  }

  private addBox(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    yBottom: number,
    z: number,
    hex: string,
    emissiveHex?: string,
    emissiveIntensity = 0
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.boxGeo, this.getMat(hex, emissiveHex, emissiveIntensity));
    m.scale.set(w, h, d);
    m.position.set(x, yBottom + h * 0.5, z);
    parent.add(m);
    return m;
  }

  private addCyl(
    parent: THREE.Object3D,
    radius: number,
    h: number,
    x: number,
    yBottom: number,
    z: number,
    hex: string
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.cylGeo, this.getMat(hex));
    m.scale.set(radius * 2, h, radius * 2);
    m.position.set(x, yBottom + h * 0.5, z);
    parent.add(m);
    return m;
  }

  private addPitchedRoof(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    yBottom: number,
    z: number,
    hex: string
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.roofGeo, this.getMat(hex));
    m.scale.set(w, h, d);
    m.position.set(x, yBottom + h * 0.5, z);
    parent.add(m);
    return m;
  }

  /**
   * Classic TTD grey stone/brick retaining wall foundation block under structures built on slopes.
   * `parent` is positioned at `y = maxCornerY`, so local `0` is `maxCornerY` and foundation extends
   * downward to `minCornerY - 0.045`.
   */
  private addRetainingFoundation(
    parent: THREE.Object3D,
    width: number,
    depth: number,
    minCornerY: number,
    maxCornerY: number,
    offsetX = 0,
    offsetZ = 0
  ): void {
    const drop = maxCornerY - (minCornerY - 0.045);
    if (drop <= 0.05) {
      // Subtle shallow footing even on flat land so no edge ever shimmers
      this.addBox(parent, width, 0.04, depth, offsetX, -0.04, offsetZ, '#64748b');
      return;
    }

    // Main TTD stone masonry retaining wall + top stone coping rim
    this.addBox(parent, width, drop, depth, offsetX, -drop, offsetZ, '#5b6675');
    this.addBox(
      parent,
      width + 0.025,
      0.032,
      depth + 0.025,
      offsetX,
      -0.032,
      offsetZ,
      '#94a3b8'
    );
  }

  private computeStructuresSig(state: GameState): string {
    let tileHash = 2166136261 >>> 0;
    const tiles = state.tiles;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      let code = t.elevation & 15;
      if (t.buildingTier) code |= (t.buildingTier & 7) << 4;
      if (t.depot === 'ROAD') code |= 128;
      else if (t.depot === 'RAIL') code |= 256;
      if (t.stationId) code |= 512;
      if (t.hqOwnerId) code |= 1024;
      if (t.road) code |= 2048;
      if (t.rail) code |= 4096;
      tileHash ^= (i * 31 + code) >>> 0;
      tileHash = Math.imul(tileHash, 16777619) >>> 0;
    }

    let stationCargoSums = 0;
    for (let i = 0; i < state.stations.length; i++) {
      const st = state.stations[i];
      const waiting = sumWaitingCargo(st.waitingCargo);
      stationCargoSums = (stationCargoSums * 17 + waiting + st.tiles.length) | 0;
    }

    let townPopSig = 0;
    for (let i = 0; i < state.towns.length; i++) {
      townPopSig = (townPopSig * 17 + Math.round(state.towns[i].population)) | 0;
    }

    const hqKey = state.corporate.hqTile
      ? `${state.corporate.hqTile.x},${state.corporate.hqTile.y}:${state.corporate.hqTier}`
      : 'none';

    return `${state.mapSize}:${state.networkRevision ?? 0}:${tileHash}:${state.stations.length}:${stationCargoSums}:${state.industries.length}:${townPopSig}:${hqKey}:${state.aiCompanies.length}`;
  }

  private computeSignalsLayoutSig(state: GameState): string {
    let h = 2166136261 >>> 0;
    let count = 0;
    for (let i = 0; i < state.tiles.length; i++) {
      const t = state.tiles[i];
      if (t.signal) {
        count++;
        h ^= ((t.x << 8) ^ t.y ^ (t.elevation << 16)) >>> 0;
        h = Math.imul(h, 16777619) >>> 0;
      }
    }
    return `${count}:${h}`;
  }

  public sync(state: GameState): void {
    const structSig = this.computeStructuresSig(state);
    if (structSig !== this.lastStructuresSig) {
      this.lastStructuresSig = structSig;
      this.rebuildStructures(state);
      this.syncLabelContent(state);
    }

    const sigLayout = this.computeSignalsLayoutSig(state);
    if (sigLayout !== this.lastSignalsLayoutSig) {
      this.lastSignalsLayoutSig = sigLayout;
      this.rebuildSignalMeshes(state);
    }

    for (let i = 0; i < this.signalRecords.length; i++) {
      const rec = this.signalRecords[i];
      const tile = getTileAt(state, rec.x, rec.y);
      const blocked = Boolean(tile?.signalBlocked);
      if (blocked !== rec.lastBlocked) {
        rec.lastBlocked = blocked;
        rec.lampMesh.material = blocked ? this.signalRedMat : this.signalGreenMat;
      }
    }
  }

  private rebuildStructures(state: GameState): void {
    this.buildingsGroup.clear();

    // 1. Town Buildings & Depots
    for (let i = 0; i < state.tiles.length; i++) {
      const tile = state.tiles[i];
      if (
        tile.buildingTier &&
        tile.buildingTier > 0 &&
        !tile.road &&
        !tile.rail &&
        !tile.depot &&
        !tile.stationId &&
        !tile.industryId &&
        !tile.hqOwnerId &&
        tile.terrain !== 'WATER'
      ) {
        this.buildTownHouse(tile, state);
      }

      if (tile.depot === 'ROAD' || tile.depot === 'RAIL') {
        const ownerColor = resolveOwnerColor(tile.ownerId, state.aiCompanies);
        this.buildDepot(tile, tile.depot, ownerColor, state);
      }
    }

    // 2. Industries (6 distinct multi-tile silhouettes with retaining walls)
    for (let i = 0; i < state.industries.length; i++) {
      this.buildIndustry(state.industries[i], state);
    }

    // 3. Stations
    for (let i = 0; i < state.stations.length; i++) {
      const st = state.stations[i];
      const ownerColor = resolveOwnerColor(st.ownerId, state.aiCompanies);
      this.buildStation(st, ownerColor, state);
    }

    // 4. Player HQ (5 Distinct Visual Tiers with sloped stone retaining wall)
    if (state.corporate.hqTile && state.corporate.hqTier > 0) {
      const hx = state.corporate.hqTile.x;
      const hy = state.corporate.hqTile.y;
      const corners = getTileCornerHeights(state, hx, hy);
      this.buildHQ(hx, hy, corners.minY, corners.maxY, state.corporate.hqTier, '#2563eb');
    }
  }

  private buildTownHouse(tile: Tile, state: GameState): void {
    const { x, y } = tile;
    const corners = getTileCornerHeights(state, x, y);
    const tier = tile.buildingTier ?? 1;
    const h1 = detHash(x, y, 1);
    const h2 = detHash(x, y, 2);

    const g = new THREE.Group();
    g.position.set(x, corners.maxY, y);

    // Classic TTD stone retaining terrace on hillside town plots
    this.addRetainingFoundation(g, 0.9, 0.9, corners.minY, corners.maxY);

    const buildingSub = new THREE.Group();
    buildingSub.rotation.y = Math.floor(h1 * 4) * (Math.PI / 2);
    g.add(buildingSub);

    if (tier === 1) {
      const wallColors = ['#b93829', '#d99b26', '#f1ece1', '#c2410c', '#4b7a52'];
      const wallHex = wallColors[Math.floor(h2 * wallColors.length) % wallColors.length];
      const w = 0.52 + h1 * 0.1;
      const d = 0.46 + h2 * 0.1;
      const wallH = 0.24;

      this.addBox(buildingSub, w + 0.04, 0.035, d + 0.04, 0, 0, 0, '#64748b');
      this.addBox(buildingSub, w, wallH, d, 0, 0.035, 0, wallHex);
      this.addBox(
        buildingSub,
        w * 0.72,
        0.07,
        d + 0.02,
        0,
        0.115,
        0,
        '#fef9c3',
        '#fde047',
        0.2
      );
      this.addPitchedRoof(buildingSub, w + 0.1, 0.19, d + 0.1, 0, 0.035 + wallH, 0, '#293241');
      this.addBox(buildingSub, 0.07, 0.18, 0.07, w * 0.22, 0.035 + wallH + 0.04, 0.08, '#7f1d1d');
    } else if (tier === 2) {
      const brickPalette = ['#9a3412', '#b45309', '#be123c', '#cbd5e1', '#d6c7b2'];
      const wallHex = brickPalette[Math.floor(h2 * brickPalette.length) % brickPalette.length];
      const h = 0.48 + h1 * 0.14;
      const w = 0.68;
      const d = 0.62;

      this.addBox(buildingSub, 0.86, 0.025, 0.86, 0, 0, 0, '#94a3b8');
      this.addBox(buildingSub, w, h, d, 0, 0.025, 0, wallHex);
      this.addBox(buildingSub, w + 0.015, 0.07, d * 0.78, 0, 0.14, 0, '#fef08a', '#facc15', 0.25);
      this.addBox(buildingSub, w + 0.015, 0.07, d * 0.78, 0, 0.31, 0, '#fef08a', '#facc15', 0.25);
      this.addPitchedRoof(buildingSub, w + 0.08, 0.2, d + 0.08, 0, 0.025 + h, 0, '#334155');
    } else {
      const towerPalette = ['#475569', '#64748b', '#334155', '#78716c'];
      const baseHex = towerPalette[Math.floor(h2 * towerPalette.length) % towerPalette.length];
      const h = 0.86 + h1 * 0.42;

      this.addBox(buildingSub, 0.88, 0.03, 0.88, 0, 0, 0, '#94a3b8');
      this.addBox(buildingSub, 0.74, h, 0.74, 0, 0.03, 0, baseHex);

      const floors = Math.max(3, Math.floor(h / 0.18));
      for (let f = 0; f < floors; f++) {
        this.addBox(
          buildingSub,
          0.755,
          0.065,
          0.66,
          0,
          0.11 + f * 0.17,
          0,
          '#bae6fd',
          '#38bdf8',
          0.28
        );
        this.addBox(
          buildingSub,
          0.66,
          0.065,
          0.755,
          0,
          0.11 + f * 0.17,
          0,
          '#bae6fd',
          '#38bdf8',
          0.28
        );
      }

      this.addBox(buildingSub, 0.78, 0.04, 0.78, 0, 0.03 + h, 0, '#cbd5e1');
      this.addBox(buildingSub, 0.28, 0.11, 0.28, 0.1, 0.07 + h, -0.08, '#94a3b8');
    }

    this.buildingsGroup.add(g);
  }

  private buildIndustry(ind: Industry, state: GameState): void {
    const w = Math.max(1, ind.width || 2);
    const h = Math.max(1, ind.height || 2);
    const centerX = ind.x + (w - 1) * 0.5;
    const centerZ = ind.y + (h - 1) * 0.5;

    let minCornerY = Infinity;
    let maxCornerY = -Infinity;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const c = getTileCornerHeights(state, ind.x + dx, ind.y + dy);
        minCornerY = Math.min(minCornerY, c.minY);
        maxCornerY = Math.max(maxCornerY, c.maxY);
      }
    }
    if (!Number.isFinite(minCornerY)) minCornerY = 0.28;
    if (!Number.isFinite(maxCornerY)) maxCornerY = 0.28;

    const g = new THREE.Group();
    g.position.set(centerX, maxCornerY, centerZ);

    const padW = w - 0.12;
    const padD = h - 0.12;

    // Classic TTD stone retaining foundation across the entire multi-tile industry footprint
    this.addRetainingFoundation(g, padW + 0.06, padD + 0.06, minCornerY, maxCornerY);

    switch (ind.type) {
      case 'FOREST': {
        this.addBox(g, padW, 0.03, padD, 0, 0, 0, '#4c6434');
        const treeOffsets = [
          [-0.55, -0.55],
          [-0.2, -0.62],
          [0.35, -0.52],
          [-0.6, 0.1],
          [-0.25, -0.1],
          [-0.52, 0.55],
        ];
        for (let i = 0; i < treeOffsets.length; i++) {
          const tx = treeOffsets[i][0] * (w * 0.5);
          const tz = treeOffsets[i][1] * (h * 0.5);
          this.addCyl(g, 0.05, 0.28, tx, 0.03, tz, '#5c3a21');
          const c1 = new THREE.Mesh(this.coneGeo, this.getMat('#1b5e20'));
          c1.scale.set(0.42, 0.48, 0.42);
          c1.position.set(tx, 0.42, tz);
          g.add(c1);
          const c2 = new THREE.Mesh(this.coneGeo, this.getMat('#2e7d32'));
          c2.scale.set(0.32, 0.4, 0.32);
          c2.position.set(tx, 0.66, tz);
          g.add(c2);
        }
        for (let row = 0; row < 3; row++) {
          for (let k = 0; k < 3 - row; k++) {
            const log = new THREE.Mesh(this.cylGeo, this.getMat('#854d0e'));
            log.rotation.z = Math.PI / 2;
            log.scale.set(0.11, 0.58, 0.11);
            log.position.set(
              0.34,
              0.09 + row * 0.095,
              0.18 + (k - (2 - row) * 0.5) * 0.12
            );
            g.add(log);
          }
        }
        this.addBox(g, 0.38, 0.22, 0.34, 0.35, 0.03, -0.35, '#eab308');
        this.addPitchedRoof(g, 0.44, 0.14, 0.4, 0.35, 0.25, -0.35, '#475569');
        break;
      }

      case 'SAWMILL': {
        this.addBox(g, padW, 0.04, padD, 0, 0, 0, '#78716c');
        this.addBox(g, padW * 0.62, 0.38, padD * 0.54, -0.22, 0.04, -0.12, '#9a5b32');
        for (let b = -1; b <= 1; b++) {
          const tooth = new THREE.Mesh(this.boxGeo, this.getMat('#334155'));
          tooth.scale.set(padW * 0.2, 0.16, padD * 0.56);
          tooth.rotation.z = 0.35;
          tooth.position.set(-0.22 + b * (padW * 0.19), 0.45, -0.12);
          g.add(tooth);
        }
        this.addCyl(g, 0.11, 0.95, 0.45, 0.04, -0.38, '#991b1b');
        this.addCyl(g, 0.13, 0.08, 0.45, 0.96, -0.38, '#1e293b');
        this.addBox(g, 0.44, 0.16, 0.26, 0.36, 0.04, 0.32, '#facc15');
        this.addBox(g, 0.4, 0.13, 0.24, -0.18, 0.04, 0.44, '#fde047');
        break;
      }

      case 'COAL_MINE': {
        this.addBox(g, padW, 0.04, padD, 0, 0, 0, '#3f3f46');
        this.addBox(g, 0.62, 0.4, 0.52, -0.26, 0.04, -0.2, '#52525b');
        this.addBox(g, 0.34, 0.92, 0.34, -0.26, 0.04, 0.26, '#27272a');
        this.addBox(g, 0.42, 0.18, 0.42, -0.26, 0.96, 0.26, '#dc2626');
        const wheel = new THREE.Mesh(this.cylGeo, this.getMat('#e4e4e7'));
        wheel.rotation.z = Math.PI / 2;
        wheel.scale.set(0.28, 0.05, 0.28);
        wheel.position.set(-0.26, 1.2, 0.26);
        g.add(wheel);

        const heapPositions = [
          [0.36, 0.28, 0.46, 0.36],
          [0.42, -0.24, 0.38, 0.28],
          [0.12, 0.44, 0.32, 0.22],
        ];
        for (const [hx, hz, rad, hh] of heapPositions) {
          const heap = new THREE.Mesh(this.coneGeo, this.getMat('#18181b'));
          heap.scale.set(rad * 2, hh, rad * 2);
          heap.position.set(hx, 0.04 + hh * 0.5, hz);
          g.add(heap);
        }
        break;
      }

      case 'POWER_PLANT': {
        this.addBox(g, padW, 0.04, padD, 0, 0, 0, '#64748b');
        const bands = [
          { r: 0.4, h: 0.24, y: 0.04, hex: '#cbd5e1' },
          { r: 0.35, h: 0.22, y: 0.28, hex: '#dc2626' },
          { r: 0.31, h: 0.22, y: 0.5, hex: '#f8fafc' },
          { r: 0.33, h: 0.2, y: 0.72, hex: '#dc2626' },
          { r: 0.36, h: 0.14, y: 0.92, hex: '#f8fafc' },
        ];
        for (const b of bands) {
          this.addCyl(g, b.r, b.h, -0.32, b.y, 0.24, b.hex);
        }
        this.addCyl(g, 0.28, 0.04, -0.32, 1.05, 0.24, '#1e293b');
        this.addBox(g, 0.72, 0.48, 0.58, 0.32, 0.04, -0.22, '#9a3412');
        this.addBox(g, 0.74, 0.08, 0.6, 0.32, 0.52, -0.22, '#475569');
        this.addCyl(g, 0.09, 1.18, 0.52, 0.04, 0.38, '#cbd5e1');
        this.addCyl(g, 0.095, 0.16, 0.52, 1.06, 0.38, '#dc2626');
        break;
      }

      case 'FARM': {
        this.addBox(g, padW, 0.03, padD, 0, 0, 0, '#654321');
        this.addBox(g, 0.66, 0.36, 0.48, -0.32, 0.03, -0.28, '#b91c1c');
        this.addBox(g, 0.68, 0.05, 0.5, -0.32, 0.36, -0.28, '#f8fafc');
        this.addPitchedRoof(g, 0.74, 0.26, 0.56, -0.32, 0.41, -0.28, '#334155');
        this.addCyl(g, 0.16, 0.76, 0.16, 0.03, -0.32, '#e2e8f0');
        const dome = new THREE.Mesh(this.sphereGeo, this.getMat('#94a3b8'));
        dome.scale.set(0.33, 0.24, 0.33);
        dome.position.set(0.16, 0.79, -0.32);
        g.add(dome);
        for (let r = 0; r < 5; r++) {
          this.addBox(
            g,
            padW * 0.86,
            0.09,
            0.1,
            0,
            0.03,
            0.12 + r * 0.15,
            r % 2 === 0 ? '#eab308' : '#ca8a04'
          );
        }
        break;
      }

      case 'FOOD_PLANT': {
        this.addBox(g, padW, 0.04, padD, 0, 0, 0, '#94a3b8');
        this.addBox(g, 0.82, 0.44, 0.62, -0.18, 0.04, -0.18, '#f8fafc');
        this.addBox(g, 0.84, 0.08, 0.64, -0.18, 0.38, -0.18, '#0284c7');
        this.addBox(g, 0.52, 0.3, 0.46, 0.36, 0.04, 0.28, '#f1f5f9');
        for (let k = 0; k < 3; k++) {
          this.addCyl(g, 0.14, 0.56, 0.42, 0.04, -0.36 + k * 0.28, '#cbd5e1');
          this.addCyl(g, 0.15, 0.04, 0.42, 0.6, -0.36 + k * 0.28, '#38bdf8');
        }
        break;
      }
    }

    this.buildingsGroup.add(g);
  }

  private buildDepot(
    tile: Tile,
    depotType: 'ROAD' | 'RAIL',
    ownerColor: string,
    state: GameState
  ): void {
    const { x, y } = tile;
    const corners = getTileCornerHeights(state, x, y);

    const nN = getTileAt(state, x, y - 1);
    const nS = getTileAt(state, x, y + 1);
    const nE = getTileAt(state, x + 1, y);
    const nW = getTileAt(state, x - 1, y);

    let rotY = 0;
    if (depotType === 'RAIL') {
      if (nE?.rail) rotY = Math.PI / 2;
      else if (nN?.rail) rotY = Math.PI;
      else if (nW?.rail) rotY = -Math.PI / 2;
      else if (nS?.rail) rotY = 0;
    } else {
      if (nE?.road) rotY = Math.PI / 2;
      else if (nN?.road) rotY = Math.PI;
      else if (nW?.road) rotY = -Math.PI / 2;
      else if (nS?.road) rotY = 0;
    }

    const g = new THREE.Group();
    g.position.set(x, corners.maxY, y);

    // Classic TTD stone retaining wall on sloped depot sites
    this.addRetainingFoundation(g, 0.88, 0.88, corners.minY, corners.maxY);

    const sub = new THREE.Group();
    sub.rotation.y = rotY;
    g.add(sub);

    if (depotType === 'RAIL') {
      this.addBox(sub, 0.84, 0.03, 0.88, 0, 0, 0, '#6b6661');
      this.addBox(sub, 0.72, 0.38, 0.78, 0, 0.03, -0.03, '#9a3412');
      this.addPitchedRoof(sub, 0.78, 0.18, 0.84, 0, 0.41, -0.03, '#334155');
      this.addBox(sub, 0.74, 0.07, 0.8, 0, 0.35, -0.03, ownerColor);
      this.addBox(sub, 0.42, 0.28, 0.06, 0, 0.03, 0.35, '#0f172a');
      const arch = new THREE.Mesh(this.cylGeo, this.getMat('#0f172a'));
      arch.rotation.x = Math.PI / 2;
      arch.scale.set(0.42, 0.06, 0.22);
      arch.position.set(0, 0.29, 0.35);
      sub.add(arch);
    } else {
      this.addBox(sub, 0.86, 0.03, 0.86, 0, 0, 0, '#475569');
      this.addBox(sub, 0.74, 0.34, 0.72, 0, 0.03, -0.04, '#cbd5e1');
      this.addBox(sub, 0.78, 0.06, 0.76, 0, 0.37, -0.04, ownerColor);
      this.addBox(sub, 0.48, 0.25, 0.06, 0, 0.03, 0.31, '#1e293b');
      const arch = new THREE.Mesh(this.cylGeo, this.getMat('#1e293b'));
      arch.rotation.x = Math.PI / 2;
      arch.scale.set(0.48, 0.06, 0.18);
      arch.position.set(0, 0.26, 0.31);
      sub.add(arch);
    }

    this.buildingsGroup.add(g);
  }

  private buildStation(station: Station, ownerColor: string, state: GameState): void {
    const tiles =
      station.tiles && station.tiles.length > 0
        ? station.tiles
        : [{ x: station.x, y: station.y }];
    const waitingTotal = sumWaitingCargo(station.waitingCargo);
    const crateCount = waitingTotal > 0 ? Math.min(4, Math.ceil(waitingTotal / 20)) : 0;

    if (station.kind === 'TRAIN_STATION') {
      let alongEW = true;
      if (tiles.length >= 2) {
        alongEW = Math.abs(tiles[1].x - tiles[0].x) >= Math.abs(tiles[1].y - tiles[0].y);
      } else {
        const t0 = tiles[0];
        const nN = getTileAt(state, t0.x, t0.y - 1);
        const nS = getTileAt(state, t0.x, t0.y + 1);
        if (nN?.rail || nS?.rail) alongEW = false;
      }

      for (let i = 0; i < tiles.length; i++) {
        const tx = tiles[i].x;
        const ty = tiles[i].y;
        const corners = getTileCornerHeights(state, tx, ty);
        const drop = corners.maxY - (corners.minY - 0.05);

        const g = new THREE.Group();
        g.position.set(tx, corners.maxY, ty);
        if (!alongEW) {
          g.rotation.y = Math.PI / 2;
        }

        // Flanking platforms with deep stone retaining bases down to minCornerY so tracks in center stay clear!
        this.addBox(g, 0.96, drop + 0.09, 0.22, 0, -drop, -0.36, '#64748b');
        this.addBox(g, 0.96, drop + 0.09, 0.22, 0, -drop, 0.36, '#64748b');
        this.addBox(g, 0.96, 0.03, 0.23, 0, 0.065, -0.36, '#94a3b8');
        this.addBox(g, 0.96, 0.03, 0.23, 0, 0.065, 0.36, '#94a3b8');

        // Yellow platform safety edges
        this.addBox(g, 0.96, 0.015, 0.03, 0, 0.096, -0.26, '#facc15');
        this.addBox(g, 0.96, 0.015, 0.03, 0, 0.096, 0.26, '#facc15');

        for (const px of [-0.34, 0.34]) {
          this.addBox(g, 0.045, 0.34, 0.045, px, 0.09, -0.37, '#334155');
          this.addBox(g, 0.045, 0.34, 0.045, px, 0.09, 0.37, '#334155');
        }
        this.addBox(g, 0.98, 0.055, 0.92, 0, 0.42, 0, ownerColor);
        this.addBox(g, 0.94, 0.04, 0.42, 0, 0.47, 0, '#e2e8f0');

        if (i === 0 && crateCount > 0) {
          for (let c = 0; c < crateCount; c++) {
            this.addBox(
              g,
              0.1,
              0.09,
              0.1,
              -0.3 + c * 0.18,
              0.1,
              -0.36,
              c % 2 === 0 ? '#d97706' : '#38bdf8'
            );
          }
        }

        this.buildingsGroup.add(g);
      }
    } else if (station.kind === 'BUS_STOP') {
      const t0 = tiles[0];
      const corners = getTileCornerHeights(state, t0.x, t0.y);
      const drop = corners.maxY - (corners.minY - 0.05);

      const g = new THREE.Group();
      g.position.set(t0.x, corners.maxY, t0.y);

      // Retaining foundation strictly under roadside shelter side so center roadway stays flush
      this.addBox(g, 0.62, drop + 0.025, 0.3, 0, -drop, -0.28, '#64748b');
      this.addBox(g, 0.48, 0.24, 0.04, 0, 0.025, -0.34, '#bae6fd', '#38bdf8', 0.2);
      this.addBox(g, 0.54, 0.045, 0.26, 0, 0.265, -0.26, ownerColor);
      this.addBox(g, 0.34, 0.05, 0.08, 0, 0.065, -0.28, '#78350f');
      this.addCyl(g, 0.02, 0.32, 0.32, 0.025, -0.28, '#cbd5e1');
      this.addBox(g, 0.09, 0.09, 0.03, 0.32, 0.315, -0.28, '#facc15');

      this.buildingsGroup.add(g);
    } else {
      // TRUCK_BAY
      const t0 = tiles[0];
      const corners = getTileCornerHeights(state, t0.x, t0.y);
      const drop = corners.maxY - (corners.minY - 0.05);

      const g = new THREE.Group();
      g.position.set(t0.x, corners.maxY, t0.y);

      // Retaining dock foundation under freight warehouse side
      this.addBox(g, 0.8, drop + 0.03, 0.34, 0, -drop, -0.26, '#64748b');
      this.addBox(g, 0.72, 0.28, 0.28, 0, 0.03, -0.26, '#e2e8f0');
      this.addBox(g, 0.76, 0.06, 0.38, 0, 0.31, -0.22, ownerColor);

      if (crateCount > 0) {
        for (let c = 0; c < crateCount; c++) {
          this.addBox(
            g,
            0.11,
            0.1,
            0.11,
            -0.24 + c * 0.16,
            0.03,
            -0.08,
            c % 2 === 0 ? '#b45309' : '#0284c7'
          );
        }
      }

      this.buildingsGroup.add(g);
    }
  }

  private buildHQ(
    x: number,
    z: number,
    minCornerY: number,
    maxCornerY: number,
    tier: number,
    ownerColor: string
  ): void {
    const g = new THREE.Group();
    g.position.set(x, maxCornerY, z);

    this.addRetainingFoundation(g, 0.94, 0.94, minCornerY, maxCornerY);

    if (tier <= 1) {
      this.addBox(g, 0.82, 0.03, 0.82, 0, 0, 0, '#57534e');
      this.addBox(g, 0.52, 0.25, 0.44, 0, 0.03, -0.04, '#78350f');
      this.addPitchedRoof(g, 0.6, 0.16, 0.52, 0, 0.28, -0.04, '#475569');
      this.addBox(g, 0.34, 0.03, 0.16, 0, 0.03, 0.24, '#92400e');
      this.addBox(g, 0.26, 0.07, 0.03, 0, 0.23, 0.19, ownerColor);
    } else if (tier === 2) {
      this.addBox(g, 0.9, 0.035, 0.9, 0, 0, 0, '#94a3b8');
      this.addBox(g, 0.68, 0.52, 0.62, 0, 0.035, 0, '#991b1b');
      this.addBox(g, 0.7, 0.08, 0.5, 0, 0.18, 0, '#fef08a', '#facc15', 0.25);
      this.addBox(g, 0.7, 0.08, 0.5, 0, 0.37, 0, '#fef08a', '#facc15', 0.25);
      this.addPitchedRoof(g, 0.76, 0.24, 0.7, 0, 0.555, 0, '#1e293b');
      this.addCyl(g, 0.015, 0.42, 0.36, 0.035, 0.36, '#e2e8f0');
      this.addBox(g, 0.14, 0.08, 0.02, 0.42, 0.38, 0.36, ownerColor);
    } else if (tier === 3) {
      this.addBox(g, 0.94, 0.04, 0.94, 0, 0, 0, '#cbd5e1');
      this.addBox(g, 0.74, 0.95, 0.74, 0, 0.04, 0, '#0ea5e9', '#0284c7', 0.28);
      for (let f = 0; f < 5; f++) {
        this.addBox(g, 0.77, 0.04, 0.77, 0, 0.16 + f * 0.17, 0, '#e2e8f0');
      }
      this.addBox(g, 0.42, 0.05, 0.22, 0, 0.22, 0.4, ownerColor);
      this.addBox(g, 0.78, 0.06, 0.78, 0, 0.99, 0, ownerColor);
    } else if (tier === 4) {
      this.addBox(g, 0.96, 0.05, 0.96, 0, 0, 0, '#e2e8f0');
      this.addBox(g, 0.78, 0.55, 0.78, 0, 0.05, 0, '#1e3a8a');
      this.addBox(g, 0.62, 1.05, 0.62, 0, 0.6, 0, '#38bdf8', '#0284c7', 0.32);
      for (let f = 0; f < 7; f++) {
        this.addBox(g, 0.65, 0.035, 0.65, 0, 0.68 + f * 0.14, 0, '#f8fafc');
      }
      this.addCyl(g, 0.25, 0.04, 0, 1.65, 0, '#334155');
      this.addBox(g, 0.04, 0.015, 0.22, -0.07, 1.69, 0, '#facc15');
      this.addBox(g, 0.04, 0.015, 0.22, 0.07, 1.69, 0, '#facc15');
      this.addBox(g, 0.16, 0.015, 0.04, 0, 1.69, 0, '#facc15');
    } else {
      this.addBox(g, 0.98, 0.06, 0.98, 0, 0, 0, '#fef3c7');
      this.addBox(g, 0.82, 0.65, 0.82, 0, 0.06, 0, '#1e3a8a');
      this.addBox(g, 0.66, 0.85, 0.66, 0, 0.71, 0, '#0284c7', '#0369a1', 0.35);
      this.addBox(g, 0.48, 0.68, 0.48, 0, 1.56, 0, '#38bdf8', '#0ea5e9', 0.4);
      this.addBox(g, 0.85, 0.05, 0.85, 0, 0.69, 0, '#f59e0b', '#fbbf24', 0.45);
      this.addBox(g, 0.69, 0.05, 0.69, 0, 1.54, 0, '#f59e0b', '#fbbf24', 0.45);
      this.addPitchedRoof(g, 0.54, 0.36, 0.54, 0, 2.24, 0, '#fbbf24');
      this.addCyl(g, 0.025, 0.46, 0, 2.58, 0, '#fde047');
    }

    this.buildingsGroup.add(g);
  }

  private rebuildSignalMeshes(state: GameState): void {
    this.signalsGroup.clear();
    this.signalRecords = [];

    for (let i = 0; i < state.tiles.length; i++) {
      const tile = state.tiles[i];
      if (!tile.signal) continue;

      const { x, y } = tile;
      const nE = getTileAt(state, x + 1, y);
      const nW = getTileAt(state, x - 1, y);
      const ewTrack = Boolean(nE?.rail || nW?.rail);

      const sx = x + (ewTrack ? 0.16 : 0.32);
      const sz = y + (ewTrack ? -0.32 : 0.16);
      const sy = getSurfaceHeightAt(state, sx, sz);

      const g = new THREE.Group();
      g.position.set(sx, sy, sz);

      // Concrete base anchored into hillside + black steel mast + signal head
      this.addBox(g, 0.1, 0.07, 0.1, 0, -0.05, 0, '#64748b');
      this.addCyl(g, 0.024, 0.34, 0, 0.02, 0, '#1e293b');
      this.addBox(g, 0.09, 0.16, 0.09, 0, 0.28, 0, '#0f172a');

      const blocked = Boolean(tile.signalBlocked);
      const lamp = new THREE.Mesh(
        this.sphereGeo,
        blocked ? this.signalRedMat : this.signalGreenMat
      );
      lamp.scale.set(0.11, 0.11, 0.11);
      lamp.position.set(0, 0.37, 0);
      g.add(lamp);

      this.signalsGroup.add(g);
      this.signalRecords.push({
        x,
        y,
        lampMesh: lamp,
        lastBlocked: blocked,
      });
    }
  }

  private applyClassicTTDSignStyle(
    el: HTMLDivElement,
    bgHex: string,
    lightBevel: string,
    darkBevel: string
  ): void {
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.borderRadius = '0px';
    el.style.background = bgHex;
    el.style.borderTop = `1px solid ${lightBevel}`;
    el.style.borderLeft = `1px solid ${lightBevel}`;
    el.style.borderRight = `1px solid ${darkBevel}`;
    el.style.borderBottom = `1px solid ${darkBevel}`;
    el.style.fontFamily = 'Tahoma, Verdana, ui-sans-serif, system-ui, sans-serif';
    el.style.whiteSpace = 'nowrap';
    el.style.textShadow = '1px 1px 0px #000000';
    el.style.boxShadow = '1px 2px 3px rgba(0, 0, 0, 0.55)';
    el.style.willChange = 'transform';
  }

  private syncLabelContent(state: GameState): void {
    const activeIds = new Set<string>();

    // 1. Classic TTD Town Nameplates: "Bergen (1 240)"
    for (const town of state.towns) {
      const id = `town:${town.id}`;
      activeIds.add(id);
      const wy = getSurfaceHeightAt(state, town.x, town.y) + 0.96;

      let rec = this.labels.get(id);
      if (!rec) {
        const el = document.createElement('div');
        this.applyClassicTTDSignStyle(
          el,
          'rgba(32, 62, 36, 0.92)',
          '#86efac',
          '#0a1f0e'
        );
        el.style.padding = '1px 6px';
        el.style.color = '#ffffff';
        el.style.fontSize = '11px';
        el.style.fontWeight = '700';
        el.style.pointerEvents = 'none';
        this.labelLayer.appendChild(el);
        rec = { id, kind: 'town', wx: town.x, wy, wz: town.y, el };
        this.labels.set(id, rec);
      }
      rec.wx = town.x;
      rec.wy = wy;
      rec.wz = town.y;
      rec.el.textContent = `${town.name} (${formatNorwegianInt(town.population)})`;
    }

    // 2. Classic TTD Subtle Industry Signs
    for (const ind of state.industries) {
      const id = `ind:${ind.id}`;
      activeIds.add(id);
      const cx = ind.x + (Math.max(1, ind.width) - 1) * 0.5;
      const cz = ind.y + (Math.max(1, ind.height) - 1) * 0.5;
      const wy = getSurfaceHeightAt(state, cx, cz) + 1.18;

      let rec = this.labels.get(id);
      if (!rec) {
        const el = document.createElement('div');
        this.applyClassicTTDSignStyle(
          el,
          'rgba(58, 46, 34, 0.88)',
          '#d6c7b2',
          '#1c140d'
        );
        el.style.padding = '1px 5px';
        el.style.color = '#fde68a';
        el.style.fontSize = '10px';
        el.style.fontWeight = '700';
        el.style.pointerEvents = 'none';
        this.labelLayer.appendChild(el);
        rec = { id, kind: 'industry', wx: cx, wy, wz: cz, el };
        this.labels.set(id, rec);
      }
      rec.wx = cx;
      rec.wy = wy;
      rec.wz = cz;
      rec.el.textContent = ind.name || INDUSTRY_TYPE_NO[ind.type];
    }

    // 3. Classic TTD Company-Colored Station Signs
    for (const st of state.stations) {
      const id = `st:${st.id}`;
      activeIds.add(id);
      const wy = getSurfaceHeightAt(state, st.x, st.y) + 0.74;
      const ownerColor = resolveOwnerColor(st.ownerId, state.aiCompanies);
      const waiting = sumWaitingCargo(st.waitingCargo);

      let rec = this.labels.get(id);
      if (!rec) {
        const el = document.createElement('div');
        this.applyClassicTTDSignStyle(el, ownerColor, '#e2e8f0', '#0f172a');
        el.style.padding = '1px 6px';
        el.style.color = '#ffffff';
        el.style.fontSize = '10px';
        el.style.fontWeight = '700';
        el.style.cursor = 'pointer';
        el.style.pointerEvents = 'auto';
        const stId = st.id;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.onStationBadgeClick?.(stId);
        });
        this.labelLayer.appendChild(el);
        rec = { id, kind: 'station', wx: st.x, wy, wz: st.y, el, stationId: st.id };
        this.labels.set(id, rec);
      }
      rec.wx = st.x;
      rec.wy = wy;
      rec.wz = st.y;
      rec.el.style.background = ownerColor;
      rec.el.textContent = waiting > 0 ? `${st.name} [${waiting}]` : st.name;
    }

    // 4. Player HQ Sign
    if (state.corporate.hqTile && state.corporate.hqTier > 0) {
      const id = 'hq:player';
      activeIds.add(id);
      const hqPos = state.corporate.hqTile;
      const corners = getTileCornerHeights(state, hqPos.x, hqPos.y);
      const hqHeight = 0.6 + state.corporate.hqTier * 0.42;
      const wy = corners.maxY + hqHeight;

      let rec = this.labels.get(id);
      if (!rec) {
        const el = document.createElement('div');
        this.applyClassicTTDSignStyle(
          el,
          'rgba(30, 58, 138, 0.94)',
          '#fde047',
          '#0f172a'
        );
        el.style.padding = '1px 6px';
        el.style.color = '#fde68a';
        el.style.fontSize = '10px';
        el.style.fontWeight = '700';
        el.style.pointerEvents = 'none';
        this.labelLayer.appendChild(el);
        rec = { id, kind: 'hq', wx: hqPos.x, wy, wz: hqPos.y, el };
        this.labels.set(id, rec);
      }
      rec.wx = hqPos.x;
      rec.wy = wy;
      rec.wz = hqPos.y;
      rec.el.textContent = `★ ${state.corporate.companyName} HQ (Trinn ${state.corporate.hqTier})`;
    }

    for (const [key, rec] of this.labels.entries()) {
      if (!activeIds.has(key)) {
        rec.el.remove();
        this.labels.delete(key);
      }
    }
  }

  public updateLabelProjections(sceneMgr: IsoSceneManager): void {
    const zoom = sceneMgr.camera.zoom;
    const showIndustries = zoom >= 0.62;
    const showStations = zoom >= 0.56;

    for (const rec of this.labels.values()) {
      if (rec.kind === 'industry' && !showIndustries) {
        rec.el.style.display = 'none';
        continue;
      }
      if (rec.kind === 'station' && !showStations) {
        rec.el.style.display = 'none';
        continue;
      }

      const proj = sceneMgr.projectWorldToScreen(rec.wx, rec.wy, rec.wz);
      if (!proj.visible) {
        rec.el.style.display = 'none';
        continue;
      }

      rec.el.style.display = 'block';
      rec.el.style.transform = `translate3d(${proj.x.toFixed(1)}px, ${proj.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }

  public dispose(): void {
    this.buildingsGroup.clear();
    this.signalsGroup.clear();
    this.boxGeo.dispose();
    this.cylGeo.dispose();
    this.coneGeo.dispose();
    this.roofGeo.dispose();
    this.sphereGeo.dispose();

    for (const mat of this.matCache.values()) {
      mat.dispose();
    }
    this.matCache.clear();
    this.signalGreenMat.dispose();
    this.signalRedMat.dispose();

    this.labels.clear();
    this.labelLayer.remove();
  }
}
