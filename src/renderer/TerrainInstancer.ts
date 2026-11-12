import * as THREE from 'three';
import type { GameState, Station, Tile } from '../types/game';
import {
  ELEV_STEP,
  TERRAIN_BASE_Y,
  WATER_SURFACE_Y,
  getTileAt,
  getTileSurfaceY,
} from './IsoSceneManager';

const MAX_MAP_DIM = 96;
const MAX_TILES = MAX_MAP_DIM * MAX_MAP_DIM; // 9,216
const MAX_TREES = 12000;
const MAX_FOAM_EDGES = 10000;
const MAX_ROAD_SEGMENTS = 18000;
const MAX_ROAD_DASHES = 22000;
const MAX_RAIL_BALLAST = 18000;
const MAX_RAIL_SLEEPERS = 36000;
const MAX_RAIL_RAILS = 36000;

function hash2D(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class TerrainInstancer {
  public readonly group = new THREE.Group();

  // Instanced meshes (minimal draw calls for 60 FPS on Chromebooks)
  private terrainBlocks: THREE.InstancedMesh;
  private waterSparkleLayer: THREE.InstancedMesh;
  private shoreFoamLayer: THREE.InstancedMesh;
  private gridLines: THREE.LineSegments;
  private gridGeometry: THREE.BufferGeometry;

  private treeTrunks: THREE.InstancedMesh;
  private treeCrownsLower: THREE.InstancedMesh;
  private treeCrownsUpper: THREE.InstancedMesh;

  private roadAsphalt: THREE.InstancedMesh;
  private roadCurbs: THREE.InstancedMesh;
  private roadDashes: THREE.InstancedMesh;

  private railBallast: THREE.InstancedMesh;
  private railSleepers: THREE.InstancedMesh;
  private railSteel: THREE.InstancedMesh;
  private railBuffers: THREE.InstancedMesh;

  private waterMaterial: THREE.MeshLambertMaterial;
  private gridPositions: Float32Array;

  // Dirty-state tracking
  private lastSignature = '';

  // Reusable scratch objects (zero per-rebuild GC churn)
  private readonly mat4 = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();

  constructor() {
    // 1. Base Terrain Column Blocks
    const blockGeo = new THREE.BoxGeometry(1, 1, 1);
    const blockMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.terrainBlocks = new THREE.InstancedMesh(blockGeo, blockMat, MAX_TILES);
    this.terrainBlocks.frustumCulled = false;

    // 2. Sparkling Water Surface Caps
    const waterGeo = new THREE.PlaneGeometry(1.002, 1.002);
    waterGeo.rotateX(-Math.PI / 2);
    this.waterMaterial = new THREE.MeshLambertMaterial({
      color: '#2185c5',
      emissive: '#0a3a5e',
      emissiveIntensity: 0.35,
    });
    this.waterSparkleLayer = new THREE.InstancedMesh(waterGeo, this.waterMaterial, MAX_TILES);
    this.waterSparkleLayer.frustumCulled = false;

    // 3. Coastal Foam / Sandy Rim Strips
    const foamGeo = new THREE.PlaneGeometry(1.0, 0.13);
    foamGeo.rotateX(-Math.PI / 2);
    const foamMat = new THREE.MeshBasicMaterial({
      color: '#bae6fd',
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    this.shoreFoamLayer = new THREE.InstancedMesh(foamGeo, foamMat, MAX_FOAM_EDGES);
    this.shoreFoamLayer.frustumCulled = false;

    // 4. Crisp TTD Isometric Tile Grid Lines (4 edges * 2 vertices * 3 floats per tile)
    this.gridPositions = new Float32Array(MAX_TILES * 8 * 3);
    this.gridGeometry = new THREE.BufferGeometry();
    this.gridGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.gridPositions, 3)
    );
    const gridMat = new THREE.LineBasicMaterial({
      color: '#0f2916',
      transparent: true,
      opacity: 0.22,
    });
    this.gridLines = new THREE.LineSegments(this.gridGeometry, gridMat);
    this.gridLines.frustumCulled = false;

    // 5. Procedural Low-Poly Trees (Trunks + Layered Pine/Deciduous Crowns)
    const trunkGeo = new THREE.CylinderGeometry(0.032, 0.048, 0.22, 5);
    trunkGeo.translate(0, 0.11, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: '#5c3a21' });
    this.treeTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_TREES);
    this.treeTrunks.frustumCulled = false;

    const crownLowerGeo = new THREE.ConeGeometry(0.18, 0.32, 6);
    crownLowerGeo.translate(0, 0.31, 0);
    const crownMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.treeCrownsLower = new THREE.InstancedMesh(crownLowerGeo, crownMat, MAX_TREES);
    this.treeCrownsLower.frustumCulled = false;

    const crownUpperGeo = new THREE.ConeGeometry(0.135, 0.28, 6);
    crownUpperGeo.translate(0, 0.48, 0);
    this.treeCrownsUpper = new THREE.InstancedMesh(
      crownUpperGeo,
      crownMat.clone(),
      MAX_TREES
    );
    this.treeCrownsUpper.frustumCulled = false;

    // 6. Auto-Connecting Road Network
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const roadMat = new THREE.MeshLambertMaterial({ color: '#333942' });
    this.roadAsphalt = new THREE.InstancedMesh(unitBox, roadMat, MAX_ROAD_SEGMENTS);
    this.roadAsphalt.frustumCulled = false;

    const curbMat = new THREE.MeshLambertMaterial({ color: '#94a3b8' });
    this.roadCurbs = new THREE.InstancedMesh(unitBox, curbMat, MAX_TILES);
    this.roadCurbs.frustumCulled = false;

    const dashMat = new THREE.MeshBasicMaterial({ color: '#f8fafc' });
    this.roadDashes = new THREE.InstancedMesh(unitBox, dashMat, MAX_ROAD_DASHES);
    this.roadDashes.frustumCulled = false;

    // 7. Auto-Connecting Rail Network (Ballast + Wooden Sleepers + Steel Rails + Buffers)
    const ballastMat = new THREE.MeshLambertMaterial({ color: '#6b6661' });
    this.railBallast = new THREE.InstancedMesh(unitBox, ballastMat, MAX_RAIL_BALLAST);
    this.railBallast.frustumCulled = false;

    const sleeperMat = new THREE.MeshLambertMaterial({ color: '#452c1e' });
    this.railSleepers = new THREE.InstancedMesh(unitBox, sleeperMat, MAX_RAIL_SLEEPERS);
    this.railSleepers.frustumCulled = false;

    const steelMat = new THREE.MeshLambertMaterial({
      color: '#dbe4ee',
      emissive: '#334155',
      emissiveIntensity: 0.2,
    });
    this.railSteel = new THREE.InstancedMesh(unitBox, steelMat, MAX_RAIL_RAILS);
    this.railSteel.frustumCulled = false;

    const bufferMat = new THREE.MeshLambertMaterial({ color: '#dc2626' });
    this.railBuffers = new THREE.InstancedMesh(unitBox, bufferMat, 2048);
    this.railBuffers.frustumCulled = false;

    this.group.add(
      this.terrainBlocks,
      this.waterSparkleLayer,
      this.shoreFoamLayer,
      this.gridLines,
      this.roadCurbs,
      this.roadAsphalt,
      this.roadDashes,
      this.railBallast,
      this.railSleepers,
      this.railSteel,
      this.railBuffers,
      this.treeTrunks,
      this.treeCrownsLower,
      this.treeCrownsUpper
    );
  }

  private computeSignature(state: GameState): string {
    const tiles = state.tiles;
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      let code = t.elevation & 15;
      if (t.terrain === 'SAND') code |= 16;
      else if (t.terrain === 'GRASS') code |= 32;
      else if (t.terrain === 'FOREST_TREES') code |= 48;
      if (t.road) code |= 64;
      if (t.rail) code |= 128;
      if (t.depot === 'ROAD') code |= 256;
      else if (t.depot === 'RAIL') code |= 512;
      if (t.stationId) code |= 1024;
      if (t.industryId) code |= 2048;
      if (t.hqOwnerId) code |= 4096;
      if (t.buildingTier) code |= (t.buildingTier & 7) << 13;

      hash ^= code;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `${state.mapSize}:${state.networkRevision ?? 0}:${state.stations.length}:${hash}`;
  }

  public sync(state: GameState): void {
    const sig = this.computeSignature(state);
    if (sig === this.lastSignature) {
      return;
    }
    this.lastSignature = sig;
    this.rebuildAllInstances(state);
  }

  public updateWaterAnimation(timeSec: number): void {
    const wave = 0.5 + 0.5 * Math.sin(timeSec * 1.9);
    this.waterMaterial.emissiveIntensity = 0.25 + wave * 0.18;
    const foamMat = this.shoreFoamLayer.material as THREE.MeshBasicMaterial;
    foamMat.opacity = 0.45 + 0.22 * Math.sin(timeSec * 2.4 + 0.8);
  }

  private rebuildAllInstances(state: GameState): void {
    const { mapSize, tiles, stations } = state;

    // Fast lookup of station kinds by stationId for road/rail neighbor connectivity
    const stationKindById = new Map<string, Station['kind']>();
    for (let i = 0; i < stations.length; i++) {
      stationKindById.set(stations[i].id, stations[i].kind);
    }

    const isRoadConnected = (t: Tile | undefined): boolean => {
      if (!t) return false;
      if (t.road || t.depot === 'ROAD') return true;
      if (t.stationId) {
        const kind = stationKindById.get(t.stationId);
        return kind === 'BUS_STOP' || kind === 'TRUCK_BAY';
      }
      return false;
    };

    const isRailConnected = (t: Tile | undefined): boolean => {
      if (!t) return false;
      if (t.rail || t.depot === 'RAIL') return true;
      if (t.stationId) {
        const kind = stationKindById.get(t.stationId);
        return kind === 'TRAIN_STATION';
      }
      return false;
    };

    let blockIdx = 0;
    let waterIdx = 0;
    let foamIdx = 0;
    let gridFloats = 0;
    let treeIdx = 0;

    let roadSegIdx = 0;
    let roadCurbIdx = 0;
    let roadDashIdx = 0;

    let ballastIdx = 0;
    let sleeperIdx = 0;
    let railSteelIdx = 0;
    let bufferIdx = 0;

    const totalCount = Math.min(tiles.length, MAX_TILES);

    for (let i = 0; i < totalCount; i++) {
      const tile = tiles[i];
      const { x, y } = tile;
      const isWater = tile.terrain === 'WATER' && tile.elevation <= 0;
      const surfY = getTileSurfaceY(tile);
      const checker = (x + y) & 1;

      // 1. Terrain Block Instance
      const blockTop = isWater ? WATER_SURFACE_Y - 0.04 : surfY;
      const height = Math.max(0.08, blockTop - TERRAIN_BASE_Y);
      this.pos.set(x, TERRAIN_BASE_Y + height * 0.5, y);
      this.quat.identity();
      this.scale.set(1, height, 1);
      this.mat4.compose(this.pos, this.quat, this.scale);
      this.terrainBlocks.setMatrixAt(blockIdx, this.mat4);

      if (isWater) {
        this.color.set(checker ? '#13537d' : '#104b72');
      } else if (tile.terrain === 'SAND') {
        this.color.set(checker ? '#dfc27d' : '#d5b66f');
      } else if (tile.terrain === 'FOREST_TREES') {
        this.color.set(checker ? '#2f7230' : '#29672a');
      } else {
        // Classic TTD emerald grass checkerboard + subtle hill elevation tint
        const elevBoost = Math.min(3, Math.max(0, tile.elevation - 1)) * 0.032;
        if (tile.townId) {
          this.color.set(checker ? '#479640' : '#3f8c39');
        } else {
          this.color.set(checker ? '#3d8f37' : '#358230');
        }
        if (elevBoost > 0) {
          this.color.offsetHSL(0.01, -0.02, elevBoost);
        }
      }
      this.terrainBlocks.setColorAt(blockIdx, this.color);
      blockIdx++;

      // 2. Water Sparkle Cap + Coastal Foam Borders
      if (isWater && waterIdx < MAX_TILES) {
        this.pos.set(x, WATER_SURFACE_Y, y);
        this.quat.identity();
        this.scale.set(1, 1, 1);
        this.mat4.compose(this.pos, this.quat, this.scale);
        this.waterSparkleLayer.setMatrixAt(waterIdx, this.mat4);
        this.color.set(checker ? '#1d7db8' : '#1973ab');
        this.waterSparkleLayer.setColorAt(waterIdx, this.color);
        waterIdx++;

        // Check 4 neighbors for land shoreline foam
        const nN = getTileAt(state, x, y - 1);
        const nS = getTileAt(state, x, y + 1);
        const nE = getTileAt(state, x + 1, y);
        const nW = getTileAt(state, x - 1, y);

        if (nN && !(nN.terrain === 'WATER' && nN.elevation <= 0) && foamIdx < MAX_FOAM_EDGES) {
          this.pos.set(x, WATER_SURFACE_Y + 0.004, y - 0.43);
          this.quat.identity();
          this.scale.set(1, 1, 1);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.shoreFoamLayer.setMatrixAt(foamIdx++, this.mat4);
        }
        if (nS && !(nS.terrain === 'WATER' && nS.elevation <= 0) && foamIdx < MAX_FOAM_EDGES) {
          this.pos.set(x, WATER_SURFACE_Y + 0.004, y + 0.43);
          this.quat.identity();
          this.scale.set(1, 1, 1);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.shoreFoamLayer.setMatrixAt(foamIdx++, this.mat4);
        }
        if (nE && !(nE.terrain === 'WATER' && nE.elevation <= 0) && foamIdx < MAX_FOAM_EDGES) {
          this.pos.set(x + 0.43, WATER_SURFACE_Y + 0.004, y);
          this.euler.set(0, Math.PI / 2, 0);
          this.quat.setFromEuler(this.euler);
          this.scale.set(1, 1, 1);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.shoreFoamLayer.setMatrixAt(foamIdx++, this.mat4);
        }
        if (nW && !(nW.terrain === 'WATER' && nW.elevation <= 0) && foamIdx < MAX_FOAM_EDGES) {
          this.pos.set(x - 0.43, WATER_SURFACE_Y + 0.004, y);
          this.euler.set(0, Math.PI / 2, 0);
          this.quat.setFromEuler(this.euler);
          this.scale.set(1, 1, 1);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.shoreFoamLayer.setMatrixAt(foamIdx++, this.mat4);
        }
      }

      // 3. Crisp TTD Grid Perimeter Lines
      const gy = (isWater ? WATER_SURFACE_Y : surfY) + 0.003;
      const x0 = x - 0.5;
      const x1 = x + 0.5;
      const z0 = y - 0.5;
      const z1 = y + 0.5;
      if (gridFloats + 24 <= this.gridPositions.length) {
        // North edge
        this.gridPositions[gridFloats++] = x0;
        this.gridPositions[gridFloats++] = gy;
        this.gridPositions[gridFloats++] = z0;
        this.gridPositions[gridFloats++] = x1;
        this.gridPositions[gridFloats++] = gy;
        this.gridPositions[gridFloats++] = z0;
        // East edge
        this.gridPositions[gridFloats++] = x1;
        this.gridPositions[gridFloats++] = gy;
        this.gridPositions[gridFloats++] = z0;
        this.gridPositions[gridFloats++] = x1;
        this.gridPositions[gridFloats++] = gy;
        this.gridPositions[gridFloats++] = z1;
        // South edge
        this.gridPositions[gridFloats++] = x1;
        this.gridPositions[gridFloats++] = gy;
        this.gridPositions[gridFloats++] = z1;
        this.gridPositions[gridFloats++] = x0;
        this.gridPositions[gridFloats++] = gy;
        this.gridPositions[gridFloats++] = z1;
        // West edge
        this.gridPositions[gridFloats++] = x0;
        this.gridPositions[gridFloats++] = gy;
        this.gridPositions[gridFloats++] = z1;
        this.gridPositions[gridFloats++] = x0;
        this.gridPositions[gridFloats++] = gy;
        this.gridPositions[gridFloats++] = z0;
      }

      // 4. Procedural Trees (FOREST_TREES + occasional wild lone trees)
      const isOccupied =
        isWater ||
        tile.road ||
        tile.rail ||
        Boolean(tile.depot) ||
        Boolean(tile.stationId) ||
        Boolean(tile.industryId) ||
        Boolean(tile.hqOwnerId) ||
        Boolean(tile.buildingTier && tile.buildingTier > 0);

      if (!isOccupied) {
        let treeCount = 0;
        if (tile.terrain === 'FOREST_TREES') {
          treeCount = 3 + (hash2D(x, y, 1) > 0.55 ? 1 : 0);
        } else if (
          tile.terrain === 'GRASS' &&
          !tile.townId &&
          hash2D(x, y, 2) < 0.08
        ) {
          treeCount = 1;
        }

        for (let tIdx = 0; tIdx < treeCount && treeIdx < MAX_TREES; tIdx++) {
          const rx =
            treeCount === 1
              ? (hash2D(x, y, 10) - 0.5) * 0.44
              : ((tIdx % 2 === 0 ? -0.22 : 0.22) +
                  (hash2D(x, y, 20 + tIdx) - 0.5) * 0.18);
          const rz =
            treeCount === 1
              ? (hash2D(x, y, 11) - 0.5) * 0.44
              : ((tIdx < 2 ? -0.22 : 0.22) +
                  (hash2D(x, y, 30 + tIdx) - 0.5) * 0.18);
          const s = 0.78 + hash2D(x, y, 40 + tIdx) * 0.48;
          const rotY = hash2D(x, y, 50 + tIdx) * Math.PI * 2;

          this.pos.set(x + rx, surfY, y + rz);
          this.euler.set(0, rotY, 0);
          this.quat.setFromEuler(this.euler);
          this.scale.set(s, s * (0.9 + hash2D(x, y, 60 + tIdx) * 0.3), s);
          this.mat4.compose(this.pos, this.quat, this.scale);

          this.treeTrunks.setMatrixAt(treeIdx, this.mat4);
          this.treeCrownsLower.setMatrixAt(treeIdx, this.mat4);
          this.treeCrownsUpper.setMatrixAt(treeIdx, this.mat4);

          const shade = hash2D(x, y, 70 + tIdx);
          if (shade < 0.45) {
            this.color.set('#1f632b'); // Deep Nordic spruce
          } else if (shade < 0.85) {
            this.color.set('#2c7a32'); // Classic pine green
          } else {
            this.color.set('#4d8c2b'); // Deciduous birch green
          }
          this.treeCrownsLower.setColorAt(treeIdx, this.color);
          this.color.offsetHSL(0.01, 0.02, 0.05);
          this.treeCrownsUpper.setColorAt(treeIdx, this.color);

          treeIdx++;
        }
      }

      // 5. Auto-Connecting Road Surfaces & Dashed Markings
      if (tile.road) {
        const nN = getTileAt(state, x, y - 1);
        const nS = getTileAt(state, x, y + 1);
        const nE = getTileAt(state, x + 1, y);
        const nW = getTileAt(state, x - 1, y);

        const connN = isRoadConnected(nN);
        const connS = isRoadConnected(nS);
        const connE = isRoadConnected(nE);
        const connW = isRoadConnected(nW);
        const anyConn = connN || connS || connE || connW;

        // Town concrete sidewalk pad under urban roads
        if (tile.townId && roadCurbIdx < MAX_TILES) {
          this.pos.set(x, surfY + 0.008, y);
          this.quat.identity();
          this.scale.set(0.66, 0.016, 0.66);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.roadCurbs.setMatrixAt(roadCurbIdx++, this.mat4);
        }

        // Center road hub
        if (roadSegIdx < MAX_ROAD_SEGMENTS) {
          this.pos.set(x, surfY + 0.016, y);
          this.quat.identity();
          this.scale.set(0.48, 0.022, 0.48);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.roadAsphalt.setMatrixAt(roadSegIdx++, this.mat4);
        }

        const addRoadArm = (
          dx: number,
          dz: number,
          neighbor: Tile | undefined
        ): void => {
          if (roadSegIdx >= MAX_ROAD_SEGMENTS) return;
          const nSurfY = neighbor ? getTileSurfaceY(neighbor) : surfY;
          const halfDiffY = (nSurfY - surfY) * 0.5;
          const armLen = Math.hypot(0.5, halfDiffY) + 0.03;

          const midX = x + dx * 0.26;
          const midZ = y + dz * 0.26;
          const midY = surfY + 0.016 + halfDiffY * 0.5;

          if (dx !== 0) {
            // East/West arm
            const slopeZ = Math.atan2(halfDiffY * dx, 0.5);
            this.euler.set(0, 0, slopeZ);
            this.quat.setFromEuler(this.euler);
            this.pos.set(midX, midY, midZ);
            this.scale.set(armLen, 0.022, 0.46);
            this.mat4.compose(this.pos, this.quat, this.scale);
            this.roadAsphalt.setMatrixAt(roadSegIdx++, this.mat4);

            // Center white dashes
            if (roadDashIdx + 1 < MAX_ROAD_DASHES) {
              for (const tOff of [0.16, 0.38]) {
                this.pos.set(
                  x + dx * tOff,
                  surfY + 0.029 + halfDiffY * (tOff / 0.5),
                  y
                );
                this.scale.set(0.11, 0.006, 0.034);
                this.mat4.compose(this.pos, this.quat, this.scale);
                this.roadDashes.setMatrixAt(roadDashIdx++, this.mat4);
              }
            }
          } else {
            // North/South arm
            const slopeX = -Math.atan2(halfDiffY * dz, 0.5);
            this.euler.set(slopeX, 0, 0);
            this.quat.setFromEuler(this.euler);
            this.pos.set(midX, midY, midZ);
            this.scale.set(0.46, 0.022, armLen);
            this.mat4.compose(this.pos, this.quat, this.scale);
            this.roadAsphalt.setMatrixAt(roadSegIdx++, this.mat4);

            if (roadDashIdx + 1 < MAX_ROAD_DASHES) {
              for (const tOff of [0.16, 0.38]) {
                this.pos.set(
                  x,
                  surfY + 0.029 + halfDiffY * (tOff / 0.5),
                  y + dz * tOff
                );
                this.scale.set(0.034, 0.006, 0.11);
                this.mat4.compose(this.pos, this.quat, this.scale);
                this.roadDashes.setMatrixAt(roadDashIdx++, this.mat4);
              }
            }
          }
        };

        if (connN) addRoadArm(0, -1, nN);
        if (connS) addRoadArm(0, 1, nS);
        if (connE) addRoadArm(1, 0, nE);
        if (connW) addRoadArm(-1, 0, nW);

        // Isolated single road tile: render crisp E-W starter stub with center dash
        if (!anyConn) {
          addRoadArm(1, 0, undefined);
          addRoadArm(-1, 0, undefined);
        }
      }

      // 6. Auto-Connecting Rail Network (Ballast + Sleepers + Twin Steel Rails + Terminal Buffers)
      if (tile.rail) {
        const nN = getTileAt(state, x, y - 1);
        const nS = getTileAt(state, x, y + 1);
        const nE = getTileAt(state, x + 1, y);
        const nW = getTileAt(state, x - 1, y);

        const connN = isRailConnected(nN);
        const connS = isRailConnected(nS);
        const connE = isRailConnected(nE);
        const connW = isRailConnected(nW);
        const connCount =
          (connN ? 1 : 0) + (connS ? 1 : 0) + (connE ? 1 : 0) + (connW ? 1 : 0);

        // Center ballast hub
        if (ballastIdx < MAX_RAIL_BALLAST) {
          this.pos.set(x, surfY + 0.015, y);
          this.quat.identity();
          this.scale.set(0.56, 0.026, 0.56);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.railBallast.setMatrixAt(ballastIdx++, this.mat4);
        }

        const addRailArm = (
          dx: number,
          dz: number,
          neighbor: Tile | undefined,
          armLenFactor = 0.5
        ): void => {
          const nSurfY = neighbor ? getTileSurfaceY(neighbor) : surfY;
          const halfDiffY = neighbor ? (nSurfY - surfY) * 0.5 : 0;
          const segLen = Math.hypot(armLenFactor, halfDiffY) + 0.06;

          const midX = x + dx * (armLenFactor * 0.5);
          const midZ = y + dz * (armLenFactor * 0.5);
          const midY = surfY + 0.015 + halfDiffY * 0.5;

          const gauge = 0.145;

          if (dx !== 0) {
            // East/West track arm
            const slopeZ = Math.atan2(halfDiffY * dx, armLenFactor);
            this.euler.set(0, 0, slopeZ);
            this.quat.setFromEuler(this.euler);

            if (ballastIdx < MAX_RAIL_BALLAST) {
              this.pos.set(midX, midY, midZ);
              this.scale.set(segLen, 0.026, 0.54);
              this.mat4.compose(this.pos, this.quat, this.scale);
              this.railBallast.setMatrixAt(ballastIdx++, this.mat4);
            }

            // Wooden sleepers
            for (const sOff of [0.11, 0.26, 0.42]) {
              if (sOff > armLenFactor + 0.02 || sleeperIdx >= MAX_RAIL_SLEEPERS) continue;
              const frac = sOff / armLenFactor;
              this.pos.set(x + dx * sOff, surfY + 0.03 + halfDiffY * frac, y);
              this.scale.set(0.065, 0.016, 0.46);
              this.mat4.compose(this.pos, this.quat, this.scale);
              this.railSleepers.setMatrixAt(sleeperIdx++, this.mat4);
            }

            // Twin parallel steel rails
            for (const side of [-gauge, gauge]) {
              if (railSteelIdx >= MAX_RAIL_RAILS) break;
              this.pos.set(midX, midY + 0.024, midZ + side);
              this.scale.set(segLen + 0.04, 0.024, 0.038);
              this.mat4.compose(this.pos, this.quat, this.scale);
              this.railSteel.setMatrixAt(railSteelIdx++, this.mat4);
            }
          } else {
            // North/South track arm
            const slopeX = -Math.atan2(halfDiffY * dz, armLenFactor);
            this.euler.set(slopeX, 0, 0);
            this.quat.setFromEuler(this.euler);

            if (ballastIdx < MAX_RAIL_BALLAST) {
              this.pos.set(midX, midY, midZ);
              this.scale.set(0.54, 0.026, segLen);
              this.mat4.compose(this.pos, this.quat, this.scale);
              this.railBallast.setMatrixAt(ballastIdx++, this.mat4);
            }

            for (const sOff of [0.11, 0.26, 0.42]) {
              if (sOff > armLenFactor + 0.02 || sleeperIdx >= MAX_RAIL_SLEEPERS) continue;
              const frac = sOff / armLenFactor;
              this.pos.set(x, surfY + 0.03 + halfDiffY * frac, y + dz * sOff);
              this.scale.set(0.46, 0.016, 0.065);
              this.mat4.compose(this.pos, this.quat, this.scale);
              this.railSleepers.setMatrixAt(sleeperIdx++, this.mat4);
            }

            for (const side of [-gauge, gauge]) {
              if (railSteelIdx >= MAX_RAIL_RAILS) break;
              this.pos.set(midX + side, midY + 0.024, midZ);
              this.scale.set(0.038, 0.024, segLen + 0.04);
              this.mat4.compose(this.pos, this.quat, this.scale);
              this.railSteel.setMatrixAt(railSteelIdx++, this.mat4);
            }
          }
        };

        if (connN) addRailArm(0, -1, nN);
        if (connS) addRailArm(0, 1, nS);
        if (connE) addRailArm(1, 0, nE);
        if (connW) addRailArm(-1, 0, nW);

        if (connCount === 0) {
          addRailArm(1, 0, undefined);
          addRailArm(-1, 0, undefined);
        } else if (connCount === 1 && !tile.stationId && !tile.depot) {
          // Terminal track end: extend short stub opposite the single neighbor + red buffer stop!
          const oppDx = connE ? -1 : connW ? 1 : 0;
          const oppDz = connS ? -1 : connN ? 1 : 0;
          addRailArm(oppDx, oppDz, undefined, 0.32);

          if (bufferIdx < 2048) {
            this.quat.identity();
            this.pos.set(x + oppDx * 0.3, surfY + 0.075, y + oppDz * 0.3);
            this.scale.set(
              oppDx !== 0 ? 0.06 : 0.38,
              0.09,
              oppDz !== 0 ? 0.06 : 0.38
            );
            this.mat4.compose(this.pos, this.quat, this.scale);
            this.railBuffers.setMatrixAt(bufferIdx++, this.mat4);
          }
        }

        // Center sleeper tie for smooth visual junction continuity
        if (sleeperIdx < MAX_RAIL_SLEEPERS) {
          this.quat.identity();
          this.pos.set(x, surfY + 0.03, y);
          const ewDominant = (connE || connW) && !(connN || connS);
          this.scale.set(ewDominant ? 0.07 : 0.44, 0.016, ewDominant ? 0.44 : 0.07);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.railSleepers.setMatrixAt(sleeperIdx++, this.mat4);
        }
      }
    }

    // Commit instance counts & dirty flags
    this.commitInstanced(this.terrainBlocks, blockIdx, true);
    this.commitInstanced(this.waterSparkleLayer, waterIdx, true);
    this.commitInstanced(this.shoreFoamLayer, foamIdx, false);

    this.gridGeometry.setDrawRange(0, gridFloats / 3);
    this.gridGeometry.attributes.position.needsUpdate = true;

    this.commitInstanced(this.treeTrunks, treeIdx, false);
    this.commitInstanced(this.treeCrownsLower, treeIdx, true);
    this.commitInstanced(this.treeCrownsUpper, treeIdx, true);

    this.commitInstanced(this.roadCurbs, roadCurbIdx, false);
    this.commitInstanced(this.roadAsphalt, roadSegIdx, false);
    this.commitInstanced(this.roadDashes, roadDashIdx, false);

    this.commitInstanced(this.railBallast, ballastIdx, false);
    this.commitInstanced(this.railSleepers, sleeperIdx, false);
    this.commitInstanced(this.railSteel, railSteelIdx, false);
    this.commitInstanced(this.railBuffers, bufferIdx, false);
  }

  private commitInstanced(
    mesh: THREE.InstancedMesh,
    count: number,
    hasColors: boolean
  ): void {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (hasColors && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }

  public dispose(): void {
    const meshes: THREE.InstancedMesh[] = [
      this.terrainBlocks,
      this.waterSparkleLayer,
      this.shoreFoamLayer,
      this.treeTrunks,
      this.treeCrownsLower,
      this.treeCrownsUpper,
      this.roadCurbs,
      this.roadAsphalt,
      this.roadDashes,
      this.railBallast,
      this.railSleepers,
      this.railSteel,
      this.railBuffers,
    ];
    for (const m of meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.gridGeometry.dispose();
    (this.gridLines.material as THREE.Material).dispose();
  }
}
