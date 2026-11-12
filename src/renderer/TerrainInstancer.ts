import * as THREE from 'three';
import type { GameState, Station, Tile } from '../types/game';
import {
  TERRAIN_BASE_Y,
  WATER_SURFACE_Y,
  getCornerHeight,
  getSurfaceHeightAt,
  getTileAt,
  getTileCornerHeights,
} from './IsoSceneManager';

const MAX_MAP_DIM = 96;
const MAX_TILES = MAX_MAP_DIM * MAX_MAP_DIM; // 9,216
// 2 triangles per tile + 4*96*2 skirt wall triangles = 19,200 triangles * 3 verts = 57,600 verts
const MAX_TERRAIN_VERTS = (MAX_TILES * 2 + MAX_MAP_DIM * 8) * 3;
const MAX_TREES = 12000;
const MAX_FOAM_EDGES = 10000;
const MAX_ROAD_SEGMENTS = 20000;
const MAX_ROAD_DASHES = 22000;
const MAX_RAIL_BALLAST = 20000;
const MAX_RAIL_SLEEPERS = 36000;
const MAX_RAIL_RAILS = 36000;

// Classic TTD sun vector (bright SW/W slopes, crisp shaded NE/E back-slopes)
const SUN_DIR = new THREE.Vector3(-0.62, 0.65, 0.44).normalize();

function hash2D(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class TerrainInstancer {
  public readonly group = new THREE.Group();

  // Continuous watertight TTD faceted terrain mesh + earth cross-section skirt walls
  private terrainGeo: THREE.BufferGeometry;
  private terrainPositions: Float32Array;
  private terrainColors: Float32Array;
  private terrainMesh: THREE.Mesh;

  private waterSparkleLayer: THREE.InstancedMesh;
  private shoreFoamLayer: THREE.InstancedMesh;
  private gridLines: THREE.LineSegments;
  private gridGeometry: THREE.BufferGeometry;

  private treeTrunks: THREE.InstancedMesh;
  private treeCrownsLower: THREE.InstancedMesh;
  private treeCrownsUpper: THREE.InstancedMesh;

  // Road network: solid 3D gravel roadbed embankment + dark asphalt surface + dashes
  private roadEmbankment: THREE.InstancedMesh;
  private roadAsphalt: THREE.InstancedMesh;
  private roadDashes: THREE.InstancedMesh;

  // Rail network: solid 3D ballast embankment + wooden sleepers + twin steel rails + buffers
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
  private readonly rotMat = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();

  private readonly vFwd = new THREE.Vector3();
  private readonly vRight = new THREE.Vector3();
  private readonly vUp = new THREE.Vector3();
  private readonly e1 = new THREE.Vector3();
  private readonly e2 = new THREE.Vector3();
  private readonly triNorm = new THREE.Vector3();

  constructor() {
    // 1. Continuous Watertight Faceted Terrain Mesh (Chris Sawyer TTD vertex-shaded facets)
    this.terrainPositions = new Float32Array(MAX_TERRAIN_VERTS * 3);
    this.terrainColors = new Float32Array(MAX_TERRAIN_VERTS * 3);
    this.terrainGeo = new THREE.BufferGeometry();
    this.terrainGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.terrainPositions, 3)
    );
    this.terrainGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(this.terrainColors, 3)
    );
    const terrainMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
    });
    this.terrainMesh = new THREE.Mesh(this.terrainGeo, terrainMat);
    this.terrainMesh.frustumCulled = false;

    // 2. Sparkling Water Surface Caps
    const waterGeo = new THREE.PlaneGeometry(1.004, 1.004);
    waterGeo.rotateX(-Math.PI / 2);
    this.waterMaterial = new THREE.MeshLambertMaterial({
      color: '#1e7fb8',
      emissive: '#0a3a5e',
      emissiveIntensity: 0.35,
    });
    this.waterSparkleLayer = new THREE.InstancedMesh(waterGeo, this.waterMaterial, MAX_TILES);
    this.waterSparkleLayer.frustumCulled = false;

    // 3. Coastal Foam Strips
    const foamGeo = new THREE.PlaneGeometry(1.0, 0.12);
    foamGeo.rotateX(-Math.PI / 2);
    const foamMat = new THREE.MeshBasicMaterial({
      color: '#bae6fd',
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.shoreFoamLayer = new THREE.InstancedMesh(foamGeo, foamMat, MAX_FOAM_EDGES);
    this.shoreFoamLayer.frustumCulled = false;

    // 4. Crisp TTD Isometric Sloped Tile Grid Lines
    this.gridPositions = new Float32Array(MAX_TILES * 8 * 3);
    this.gridGeometry = new THREE.BufferGeometry();
    this.gridGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.gridPositions, 3)
    );
    const gridMat = new THREE.LineBasicMaterial({
      color: '#133215',
      transparent: true,
      opacity: 0.28,
    });
    this.gridLines = new THREE.LineSegments(this.gridGeometry, gridMat);
    this.gridLines.frustumCulled = false;

    // 5. Procedural Low-Poly Trees
    const trunkGeo = new THREE.CylinderGeometry(0.032, 0.05, 0.24, 5);
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

    // 6. Conforming Road Network with Solid 3D Gravel/Stone Embankment Skirt
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const embankMat = new THREE.MeshLambertMaterial({ color: '#78716c' });
    this.roadEmbankment = new THREE.InstancedMesh(unitBox, embankMat, MAX_ROAD_SEGMENTS);
    this.roadEmbankment.frustumCulled = false;

    const roadMat = new THREE.MeshLambertMaterial({ color: '#2b3038' });
    this.roadAsphalt = new THREE.InstancedMesh(unitBox, roadMat, MAX_ROAD_SEGMENTS);
    this.roadAsphalt.frustumCulled = false;

    const dashMat = new THREE.MeshBasicMaterial({ color: '#f1f5f9' });
    this.roadDashes = new THREE.InstancedMesh(unitBox, dashMat, MAX_ROAD_DASHES);
    this.roadDashes.frustumCulled = false;

    // 7. Conforming Rail Network with Solid 3D Crushed-Stone Ballast Embankment Skirt
    const ballastMat = new THREE.MeshLambertMaterial({ color: '#6b655e' });
    this.railBallast = new THREE.InstancedMesh(unitBox, ballastMat, MAX_RAIL_BALLAST);
    this.railBallast.frustumCulled = false;

    const sleeperMat = new THREE.MeshLambertMaterial({ color: '#422819' });
    this.railSleepers = new THREE.InstancedMesh(unitBox, sleeperMat, MAX_RAIL_SLEEPERS);
    this.railSleepers.frustumCulled = false;

    const steelMat = new THREE.MeshLambertMaterial({
      color: '#dbe4ee',
      emissive: '#334155',
      emissiveIntensity: 0.22,
    });
    this.railSteel = new THREE.InstancedMesh(unitBox, steelMat, MAX_RAIL_RAILS);
    this.railSteel.frustumCulled = false;

    const bufferMat = new THREE.MeshLambertMaterial({ color: '#dc2626' });
    this.railBuffers = new THREE.InstancedMesh(unitBox, bufferMat, 2048);
    this.railBuffers.frustumCulled = false;

    this.group.add(
      this.terrainMesh,
      this.waterSparkleLayer,
      this.shoreFoamLayer,
      this.gridLines,
      this.roadEmbankment,
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
    this.rebuildAllGeometry(state);
  }

  public updateWaterAnimation(timeSec: number): void {
    const wave = 0.5 + 0.5 * Math.sin(timeSec * 1.9);
    this.waterMaterial.emissiveIntensity = 0.24 + wave * 0.16;
    const foamMat = this.shoreFoamLayer.material as THREE.MeshBasicMaterial;
    foamMat.opacity = 0.4 + 0.18 * Math.sin(timeSec * 2.3 + 0.8);
  }

  /**
   * Composes a 3D box matrix aligned to both longitudinal tangent `fwd` (+Z local)
   * and lateral cross-slope tangent `right` (+X local), with its top face at `topLift`
   * above `(cx, cySurf, cz)` and bottom skirt extending `thickness - topLift` below terrain!
   */
  private composeSurfaceAlignedBox(
    cx: number,
    cySurf: number,
    cz: number,
    fwdX: number,
    fwdY: number,
    fwdZ: number,
    rightX: number,
    rightY: number,
    rightZ: number,
    width: number,
    thickness: number,
    length: number,
    topLift: number
  ): THREE.Matrix4 {
    this.vFwd.set(fwdX, fwdY, fwdZ).normalize();
    this.vRight.set(rightX, rightY, rightZ).normalize();

    // Upward normal: vFwd × vRight = (0,0,1) × (1,0,0) = (0,+1,0)
    this.vUp.crossVectors(this.vFwd, this.vRight).normalize();
    if (this.vUp.y < 0) {
      this.vUp.negate();
    }
    // Re-orthogonalize vRight = vUp × vFwd
    this.vRight.crossVectors(this.vUp, this.vFwd).normalize();

    this.rotMat.makeBasis(this.vRight, this.vUp, this.vFwd);
    this.quat.setFromRotationMatrix(this.rotMat);

    const centerOffsetAlongUp = topLift - thickness * 0.5;
    this.pos.set(
      cx + this.vUp.x * centerOffsetAlongUp,
      cySurf + this.vUp.y * centerOffsetAlongUp,
      cz + this.vUp.z * centerOffsetAlongUp
    );
    this.scale.set(width, thickness, length);
    return this.mat4.compose(this.pos, this.quat, this.scale);
  }

  private pushFacetedTriangle(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    baseHex: string,
    applySlopeSunShade: boolean,
    vertCursor: number
  ): number {
    this.color.set(baseHex);

    if (applySlopeSunShade) {
      this.e1.set(bx - ax, by - ay, bz - az);
      this.e2.set(cx - ax, cy - ay, cz - az);
      this.triNorm.crossVectors(this.e1, this.e2).normalize();
      if (this.triNorm.y < 0) this.triNorm.negate();

      // Flat horizontal normal has dot = SUN_DIR.y (~0.65).
      // Brighten sun-facing SW slopes and deepen shaded NE back-slopes like Chris Sawyer's TTD!
      const dot = this.triNorm.dot(SUN_DIR);
      const shadeFactor = THREE.MathUtils.clamp(1.0 + (dot - SUN_DIR.y) * 0.62, 0.66, 1.26);
      this.color.multiplyScalar(shadeFactor);
    }

    let pi = vertCursor * 3;
    this.terrainPositions[pi] = ax;
    this.terrainPositions[pi + 1] = ay;
    this.terrainPositions[pi + 2] = az;
    this.terrainColors[pi] = this.color.r;
    this.terrainColors[pi + 1] = this.color.g;
    this.terrainColors[pi + 2] = this.color.b;

    pi += 3;
    this.terrainPositions[pi] = bx;
    this.terrainPositions[pi + 1] = by;
    this.terrainPositions[pi + 2] = bz;
    this.terrainColors[pi] = this.color.r;
    this.terrainColors[pi + 1] = this.color.g;
    this.terrainColors[pi + 2] = this.color.b;

    pi += 3;
    this.terrainPositions[pi] = cx;
    this.terrainPositions[pi + 1] = cy;
    this.terrainPositions[pi + 2] = cz;
    this.terrainColors[pi] = this.color.r;
    this.terrainColors[pi + 1] = this.color.g;
    this.terrainColors[pi + 2] = this.color.b;

    return vertCursor + 3;
  }

  private rebuildAllGeometry(state: GameState): void {
    const { mapSize, tiles, stations } = state;

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

    let terrainVertIdx = 0;
    let waterIdx = 0;
    let foamIdx = 0;
    let gridFloats = 0;
    let treeIdx = 0;

    let roadEmbankIdx = 0;
    let roadSegIdx = 0;
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
      const checker = (x + y) & 1;

      const corners = getTileCornerHeights(state, x, y);
      const { cNW, cNE, cSE, cSW, splitNWSE } = corners;

      const x0 = x - 0.5;
      const x1 = x + 0.5;
      const z0 = y - 0.5;
      const z1 = y + 0.5;

      // 1. Watertight Continuous Faceted Terrain Triangles
      let baseHex: string;
      if (isWater) {
        baseHex = checker ? '#0e4266' : '#0b3959'; // Seabed beneath sparkling water plane
      } else if (tile.terrain === 'SAND') {
        baseHex = checker ? '#dfc27d' : '#d5b66f';
      } else if (tile.terrain === 'FOREST_TREES') {
        baseHex = checker ? '#2d702c' : '#286527';
      } else if (tile.townId) {
        baseHex = checker ? '#46973c' : '#3f8c35';
      } else {
        // Authentic Chris Sawyer TTD emerald grass checkerboard + gentle altitude tint
        if (tile.elevation >= 3) {
          baseHex = checker ? '#499d3b' : '#429235';
        } else {
          baseHex = checker ? '#3e9132' : '#37862c';
        }
      }

      const yNW = isWater ? WATER_SURFACE_Y - 0.12 : cNW;
      const yNE = isWater ? WATER_SURFACE_Y - 0.12 : cNE;
      const ySE = isWater ? WATER_SURFACE_Y - 0.12 : cSE;
      const ySW = isWater ? WATER_SURFACE_Y - 0.12 : cSW;

      if (terrainVertIdx + 6 <= MAX_TERRAIN_VERTS) {
        if (splitNWSE) {
          terrainVertIdx = this.pushFacetedTriangle(
            x0, yNW, z0,
            x0, ySW, z1,
            x1, ySE, z1,
            baseHex,
            !isWater,
            terrainVertIdx
          );
          terrainVertIdx = this.pushFacetedTriangle(
            x0, yNW, z0,
            x1, ySE, z1,
            x1, yNE, z0,
            baseHex,
            !isWater,
            terrainVertIdx
          );
        } else {
          terrainVertIdx = this.pushFacetedTriangle(
            x0, yNW, z0,
            x0, ySW, z1,
            x1, yNE, z0,
            baseHex,
            !isWater,
            terrainVertIdx
          );
          terrainVertIdx = this.pushFacetedTriangle(
            x1, yNE, z0,
            x0, ySW, z1,
            x1, ySE, z1,
            baseHex,
            !isWater,
            terrainVertIdx
          );
        }
      }

      // 2. Water Sparkle Cap + Coastal Foam Borders
      if (isWater && waterIdx < MAX_TILES) {
        this.pos.set(x, WATER_SURFACE_Y, y);
        this.quat.identity();
        this.scale.set(1, 1, 1);
        this.mat4.compose(this.pos, this.quat, this.scale);
        this.waterSparkleLayer.setMatrixAt(waterIdx, this.mat4);
        this.color.set(checker ? '#1d7db8' : '#1872aa');
        this.waterSparkleLayer.setColorAt(waterIdx, this.color);
        waterIdx++;

        const nN = getTileAt(state, x, y - 1);
        const nS = getTileAt(state, x, y + 1);
        const nE = getTileAt(state, x + 1, y);
        const nW = getTileAt(state, x - 1, y);

        if (nN && !(nN.terrain === 'WATER' && nN.elevation <= 0) && foamIdx < MAX_FOAM_EDGES) {
          this.pos.set(x, WATER_SURFACE_Y + 0.004, y - 0.44);
          this.quat.identity();
          this.scale.set(1, 1, 1);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.shoreFoamLayer.setMatrixAt(foamIdx++, this.mat4);
        }
        if (nS && !(nS.terrain === 'WATER' && nS.elevation <= 0) && foamIdx < MAX_FOAM_EDGES) {
          this.pos.set(x, WATER_SURFACE_Y + 0.004, y + 0.44);
          this.quat.identity();
          this.scale.set(1, 1, 1);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.shoreFoamLayer.setMatrixAt(foamIdx++, this.mat4);
        }
        if (nE && !(nE.terrain === 'WATER' && nE.elevation <= 0) && foamIdx < MAX_FOAM_EDGES) {
          this.pos.set(x + 0.44, WATER_SURFACE_Y + 0.004, y);
          this.euler.set(0, Math.PI / 2, 0);
          this.quat.setFromEuler(this.euler);
          this.scale.set(1, 1, 1);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.shoreFoamLayer.setMatrixAt(foamIdx++, this.mat4);
        }
        if (nW && !(nW.terrain === 'WATER' && nW.elevation <= 0) && foamIdx < MAX_FOAM_EDGES) {
          this.pos.set(x - 0.44, WATER_SURFACE_Y + 0.004, y);
          this.euler.set(0, Math.PI / 2, 0);
          this.quat.setFromEuler(this.euler);
          this.scale.set(1, 1, 1);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.shoreFoamLayer.setMatrixAt(foamIdx++, this.mat4);
        }
      }

      // 3. Crisp TTD Sloped Grid Lines directly along the 4 exact corner heights
      const gLift = 0.003;
      const gNW = (isWater ? WATER_SURFACE_Y : cNW) + gLift;
      const gNE = (isWater ? WATER_SURFACE_Y : cNE) + gLift;
      const gSE = (isWater ? WATER_SURFACE_Y : cSE) + gLift;
      const gSW = (isWater ? WATER_SURFACE_Y : cSW) + gLift;

      if (gridFloats + 24 <= this.gridPositions.length) {
        // North edge: NW -> NE
        this.gridPositions[gridFloats++] = x0;
        this.gridPositions[gridFloats++] = gNW;
        this.gridPositions[gridFloats++] = z0;
        this.gridPositions[gridFloats++] = x1;
        this.gridPositions[gridFloats++] = gNE;
        this.gridPositions[gridFloats++] = z0;
        // East edge: NE -> SE
        this.gridPositions[gridFloats++] = x1;
        this.gridPositions[gridFloats++] = gNE;
        this.gridPositions[gridFloats++] = z0;
        this.gridPositions[gridFloats++] = x1;
        this.gridPositions[gridFloats++] = gSE;
        this.gridPositions[gridFloats++] = z1;
        // South edge: SE -> SW
        this.gridPositions[gridFloats++] = x1;
        this.gridPositions[gridFloats++] = gSE;
        this.gridPositions[gridFloats++] = z1;
        this.gridPositions[gridFloats++] = x0;
        this.gridPositions[gridFloats++] = gSW;
        this.gridPositions[gridFloats++] = z1;
        // West edge: SW -> NW
        this.gridPositions[gridFloats++] = x0;
        this.gridPositions[gridFloats++] = gSW;
        this.gridPositions[gridFloats++] = z1;
        this.gridPositions[gridFloats++] = x0;
        this.gridPositions[gridFloats++] = gNW;
        this.gridPositions[gridFloats++] = z0;
      }

      // 4. Procedural Trees planted flush at exact `getSurfaceHeightAt`
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
              : (tIdx % 2 === 0 ? -0.22 : 0.22) +
                (hash2D(x, y, 20 + tIdx) - 0.5) * 0.18;
          const rz =
            treeCount === 1
              ? (hash2D(x, y, 11) - 0.5) * 0.44
              : (tIdx < 2 ? -0.22 : 0.22) +
                (hash2D(x, y, 30 + tIdx) - 0.5) * 0.18;
          const s = 0.78 + hash2D(x, y, 40 + tIdx) * 0.48;
          const rotY = hash2D(x, y, 50 + tIdx) * Math.PI * 2;

          const tx = x + rx;
          const tz = y + rz;
          const treeY = getSurfaceHeightAt(state, tx, tz) - 0.018;

          this.pos.set(tx, treeY, tz);
          this.euler.set(0, rotY, 0);
          this.quat.setFromEuler(this.euler);
          this.scale.set(s, s * (0.9 + hash2D(x, y, 60 + tIdx) * 0.3), s);
          this.mat4.compose(this.pos, this.quat, this.scale);

          this.treeTrunks.setMatrixAt(treeIdx, this.mat4);
          this.treeCrownsLower.setMatrixAt(treeIdx, this.mat4);
          this.treeCrownsUpper.setMatrixAt(treeIdx, this.mat4);

          const shade = hash2D(x, y, 70 + tIdx);
          if (shade < 0.45) {
            this.color.set('#1f632b');
          } else if (shade < 0.85) {
            this.color.set('#2c7a32');
          } else {
            this.color.set('#4d8c2b');
          }
          this.treeCrownsLower.setColorAt(treeIdx, this.color);
          this.color.offsetHSL(0.01, 0.02, 0.05);
          this.treeCrownsUpper.setColorAt(treeIdx, this.color);

          treeIdx++;
        }
      }

      // Shared edge midpoints & center height on exact terrain triangles
      const hCenter = corners.centerY;
      const hN = 0.5 * (cNW + cNE);
      const hS = 0.5 * (cSW + cSE);
      const hE = 0.5 * (cNE + cSE);
      const hW = 0.5 * (cNW + cSW);

      // 5. Seamless Surface-Conforming Road Network + Solid 3D Gravel Embankments
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

        // Tilt center junction hub to tile slope plane & lift over convex crests
        const hubY = Math.max(hCenter, 0.5 * (hN + hS), 0.5 * (hE + hW));
        const hubWidth = tile.townId ? 0.62 : 0.54;

        if (roadEmbankIdx < MAX_ROAD_SEGMENTS) {
          this.roadEmbankment.setMatrixAt(
            roadEmbankIdx++,
            this.composeSurfaceAlignedBox(
              x, hubY, y,
              0, hS - hN, 1,
              1, hE - hW, 0,
              hubWidth, 0.085, hubWidth, 0.022
            )
          );
        }
        if (roadSegIdx < MAX_ROAD_SEGMENTS) {
          this.roadAsphalt.setMatrixAt(
            roadSegIdx++,
            this.composeSurfaceAlignedBox(
              x, hubY, y,
              0, hS - hN, 1,
              1, hE - hW, 0,
              0.46, 0.045, 0.46, 0.028
            )
          );
        }

        const addRoadArm = (dx: number, dz: number, hEdge: number): void => {
          if (roadSegIdx >= MAX_ROAD_SEGMENTS || roadEmbankIdx >= MAX_ROAD_SEGMENTS) return;

          const midX = x + dx * 0.25;
          const midZ = y + dz * 0.25;
          const midY = 0.5 * (hCenter + hEdge);
          const dLong = hEdge - hCenter; // Exact height delta over 0.5 horizontal run
          const armSpatialLen = Math.hypot(0.5, dLong) + 0.045;

          // Exact constant cross-slope of the single underlying triangle!
          let fwdX = 0, fwdY = 0, fwdZ = 1;
          let rgtX = 1, rgtY = 0, rgtZ = 0;

          if (dz === -1) {
            // North arm: forward = +Z (edge -> center), right = +X (NW -> NE)
            fwdX = 0; fwdY = hCenter - hN; fwdZ = 0.5;
            rgtX = 1; rgtY = cNE - cNW; rgtZ = 0;
          } else if (dz === 1) {
            // South arm: forward = +Z (center -> edge), right = +X (SW -> SE)
            fwdX = 0; fwdY = hS - hCenter; fwdZ = 0.5;
            rgtX = 1; rgtY = cSE - cSW; rgtZ = 0;
          } else if (dx === 1) {
            // East arm: forward along +X, lateral along -Z so we keep +Z/+X right-handedness
            // Map local +Z = East (+X world), local +X = North (-Z world): (+X_w) × (-Z_w) = (0,+1,0)!
            fwdX = 0.5; fwdY = hE - hCenter; fwdZ = 0;
            rgtX = 0; rgtY = cNE - cSE; rgtZ = -1;
          } else {
            // West arm: local +Z = East (+X world, edge -> center), local +X = North (-Z world)
            fwdX = 0.5; fwdY = hCenter - hW; fwdZ = 0;
            rgtX = 0; rgtY = cNW - cSW; rgtZ = -1;
          }

          // Solid 3D gravel/curb embankment skirt (thickness 0.085, extending 0.063 below terrain!)
          this.roadEmbankment.setMatrixAt(
            roadEmbankIdx++,
            this.composeSurfaceAlignedBox(
              midX, midY, midZ,
              fwdX, fwdY, fwdZ,
              rgtX, rgtY, rgtZ,
              hubWidth, 0.085, armSpatialLen + 0.02, 0.022
            )
          );

          // Dark TTD asphalt surface
          this.roadAsphalt.setMatrixAt(
            roadSegIdx++,
            this.composeSurfaceAlignedBox(
              midX, midY, midZ,
              fwdX, fwdY, fwdZ,
              rgtX, rgtY, rgtZ,
              0.45, 0.045, armSpatialLen, 0.028
            )
          );

          // Crisp center white dashed markings following exact 3D slope
          if (roadDashIdx + 1 < MAX_ROAD_DASHES) {
            for (const frac of [0.32, 0.76]) {
              const px = x + dx * (0.5 * frac);
              const pz = y + dz * (0.5 * frac);
              const py = hCenter + (hEdge - hCenter) * frac;
              this.roadDashes.setMatrixAt(
                roadDashIdx++,
                this.composeSurfaceAlignedBox(
                  px, py, pz,
                  fwdX, fwdY, fwdZ,
                  rgtX, rgtY, rgtZ,
                  0.034, 0.008, 0.105, 0.034
                )
              );
            }
          }
        };

        if (connN) addRoadArm(0, -1, hN);
        if (connS) addRoadArm(0, 1, hS);
        if (connE) addRoadArm(1, 0, hE);
        if (connW) addRoadArm(-1, 0, hW);

        if (!anyConn) {
          addRoadArm(1, 0, hE);
          addRoadArm(-1, 0, hW);
        }
      }

      // 6. Seamless Surface-Conforming Rail Network + Solid 3D Crushed-Stone Ballast Embankments
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

        const hubY = Math.max(hCenter, 0.5 * (hN + hS), 0.5 * (hE + hW));

        // Center ballast embankment hub (thickness 0.09, extending ~0.06 below surface)
        if (ballastIdx < MAX_RAIL_BALLAST) {
          this.railBallast.setMatrixAt(
            ballastIdx++,
            this.composeSurfaceAlignedBox(
              x, hubY, y,
              0, hS - hN, 1,
              1, hE - hW, 0,
              0.56, 0.09, 0.56, 0.028
            )
          );
        }

        const addRailArm = (
          dx: number,
          dz: number,
          hEdgeFull: number,
          armFraction = 1.0
        ): void => {
          const armHoriz = 0.5 * armFraction;
          const hTarget = hCenter + (hEdgeFull - hCenter) * armFraction;
          const midX = x + dx * (armHoriz * 0.5);
          const midZ = y + dz * (armHoriz * 0.5);
          const midY = 0.5 * (hCenter + hTarget);
          const dLong = hTarget - hCenter;
          const segLen = Math.hypot(armHoriz, dLong) + 0.055;

          let fwdX = 0, fwdY = 0, fwdZ = 1;
          let rgtX = 1, rgtY = 0, rgtZ = 0;

          if (dz === -1) {
            fwdX = 0; fwdY = hCenter - hN; fwdZ = 0.5;
            rgtX = 1; rgtY = cNE - cNW; rgtZ = 0;
          } else if (dz === 1) {
            fwdX = 0; fwdY = hS - hCenter; fwdZ = 0.5;
            rgtX = 1; rgtY = cSE - cSW; rgtZ = 0;
          } else if (dx === 1) {
            fwdX = 0.5; fwdY = hE - hCenter; fwdZ = 0;
            rgtX = 0; rgtY = cNE - cSE; rgtZ = -1;
          } else {
            fwdX = 0.5; fwdY = hCenter - hW; fwdZ = 0;
            rgtX = 0; rgtY = cNW - cSW; rgtZ = -1;
          }

          // Solid 3D ballast embankment skirt (thickness 0.09, zero holes on hill crests/valleys)
          if (ballastIdx < MAX_RAIL_BALLAST) {
            this.railBallast.setMatrixAt(
              ballastIdx++,
              this.composeSurfaceAlignedBox(
                midX, midY, midZ,
                fwdX, fwdY, fwdZ,
                rgtX, rgtY, rgtZ,
                0.55, 0.09, segLen, 0.028
              )
            );
          }

          // Wooden sleepers conforming to exact 3D slope & cross-slope
          for (const sOff of [0.11, 0.26, 0.42]) {
            if (sOff > armHoriz + 0.02 || sleeperIdx >= MAX_RAIL_SLEEPERS) continue;
            const frac = sOff / 0.5;
            const sx = x + dx * sOff;
            const sz = y + dz * sOff;
            const sy = hCenter + (hEdgeFull - hCenter) * frac;
            this.railSleepers.setMatrixAt(
              sleeperIdx++,
              this.composeSurfaceAlignedBox(
                sx, sy, sz,
                fwdX, fwdY, fwdZ,
                rgtX, rgtY, rgtZ,
                0.46, 0.022, 0.066, 0.04
              )
            );
          }

          // Twin parallel steel rails offset along exact normalized lateral axis
          const gauge = 0.145;
          const rNormLen = Math.hypot(rgtX, rgtY, rgtZ) || 1;
          const rxUnit = rgtX / rNormLen;
          const ryUnit = rgtY / rNormLen;
          const rzUnit = rgtZ / rNormLen;

          for (const side of [-gauge, gauge]) {
            if (railSteelIdx >= MAX_RAIL_RAILS) break;
            this.railSteel.setMatrixAt(
              railSteelIdx++,
              this.composeSurfaceAlignedBox(
                midX + rxUnit * side,
                midY + ryUnit * side,
                midZ + rzUnit * side,
                fwdX, fwdY, fwdZ,
                rgtX, rgtY, rgtZ,
                0.038, 0.026, segLen + 0.025, 0.056
              )
            );
          }
        };

        if (connN) addRailArm(0, -1, hN);
        if (connS) addRailArm(0, 1, hS);
        if (connE) addRailArm(1, 0, hE);
        if (connW) addRailArm(-1, 0, hW);

        if (connCount === 0) {
          addRailArm(1, 0, hE);
          addRailArm(-1, 0, hW);
        } else if (connCount === 1 && !tile.stationId && !tile.depot) {
          const oppDx = connE ? -1 : connW ? 1 : 0;
          const oppDz = connS ? -1 : connN ? 1 : 0;
          const oppEdgeH = oppDx === 1 ? hE : oppDx === -1 ? hW : oppDz === 1 ? hS : hN;
          addRailArm(oppDx, oppDz, oppEdgeH, 0.64);

          if (bufferIdx < 2048) {
            const bx = x + oppDx * 0.3;
            const bz = y + oppDz * 0.3;
            const by = getSurfaceHeightAt(state, bx, bz);
            this.quat.identity();
            this.pos.set(bx, by + 0.085, bz);
            this.scale.set(
              oppDx !== 0 ? 0.06 : 0.38,
              0.095,
              oppDz !== 0 ? 0.06 : 0.38
            );
            this.mat4.compose(this.pos, this.quat, this.scale);
            this.railBuffers.setMatrixAt(bufferIdx++, this.mat4);
          }
        }

        // Center sleeper tie aligned to slope plane
        if (sleeperIdx < MAX_RAIL_SLEEPERS) {
          const ewDominant = (connE || connW) && !(connN || connS);
          this.railSleepers.setMatrixAt(
            sleeperIdx++,
            this.composeSurfaceAlignedBox(
              x, hubY, y,
              ewDominant ? 1 : 0,
              ewDominant ? hE - hW : hS - hN,
              ewDominant ? 0 : 1,
              ewDominant ? 0 : 1,
              ewDominant ? hN - hS : hE - hW,
              ewDominant ? -1 : 0,
              0.45, 0.022, 0.068, 0.04
            )
          );
        }
      }
    }

    // 7. Classic TTD Earth-Brown Cross-Section Skirt Walls along all 4 outer map borders
    const minCoord = -0.5;
    const maxCoord = mapSize - 0.5;
    const sunEarthHex = '#6e4726';
    const shadeEarthHex = '#4b2f17';

    for (let s = 0; s < mapSize; s++) {
      if (terrainVertIdx + 24 > MAX_TERRAIN_VERTS) break;

      // South border (z = maxCoord, x: s -> s+1) - sunlit in default iso view
      const sH0 = getCornerHeight(state, s, mapSize);
      const sH1 = getCornerHeight(state, s + 1, mapSize);
      const sx0 = s - 0.5;
      const sx1 = s + 0.5;
      terrainVertIdx = this.pushFacetedTriangle(
        sx0, sH0, maxCoord,
        sx0, TERRAIN_BASE_Y, maxCoord,
        sx1, TERRAIN_BASE_Y, maxCoord,
        sunEarthHex, false, terrainVertIdx
      );
      terrainVertIdx = this.pushFacetedTriangle(
        sx0, sH0, maxCoord,
        sx1, TERRAIN_BASE_Y, maxCoord,
        sx1, sH1, maxCoord,
        sunEarthHex, false, terrainVertIdx
      );

      // East border (x = maxCoord, z: s -> s+1) - shaded cross-section
      const eH0 = getCornerHeight(state, mapSize, s);
      const eH1 = getCornerHeight(state, mapSize, s + 1);
      const ez0 = s - 0.5;
      const ez1 = s + 0.5;
      terrainVertIdx = this.pushFacetedTriangle(
        maxCoord, eH0, ez0,
        maxCoord, eH1, ez1,
        maxCoord, TERRAIN_BASE_Y, ez1,
        shadeEarthHex, false, terrainVertIdx
      );
      terrainVertIdx = this.pushFacetedTriangle(
        maxCoord, eH0, ez0,
        maxCoord, TERRAIN_BASE_Y, ez1,
        maxCoord, TERRAIN_BASE_Y, ez0,
        shadeEarthHex, false, terrainVertIdx
      );

      // North border (z = minCoord, x: s -> s+1) - visible when map rotated
      const nH0 = getCornerHeight(state, s, 0);
      const nH1 = getCornerHeight(state, s + 1, 0);
      terrainVertIdx = this.pushFacetedTriangle(
        sx1, nH1, minCoord,
        sx1, TERRAIN_BASE_Y, minCoord,
        sx0, TERRAIN_BASE_Y, minCoord,
        shadeEarthHex, false, terrainVertIdx
      );
      terrainVertIdx = this.pushFacetedTriangle(
        sx1, nH1, minCoord,
        sx0, TERRAIN_BASE_Y, minCoord,
        sx0, nH0, minCoord,
        shadeEarthHex, false, terrainVertIdx
      );

      // West border (x = minCoord, z: s -> s+1) - visible when map rotated
      const wH0 = getCornerHeight(state, 0, s);
      const wH1 = getCornerHeight(state, 0, s + 1);
      terrainVertIdx = this.pushFacetedTriangle(
        minCoord, wH1, ez1,
        minCoord, wH0, ez0,
        minCoord, TERRAIN_BASE_Y, ez0,
        sunEarthHex, false, terrainVertIdx
      );
      terrainVertIdx = this.pushFacetedTriangle(
        minCoord, wH1, ez1,
        minCoord, TERRAIN_BASE_Y, ez0,
        minCoord, TERRAIN_BASE_Y, ez1,
        sunEarthHex, false, terrainVertIdx
      );
    }

    // Commit continuous terrain mesh + grid + instanced networks
    this.terrainGeo.setDrawRange(0, terrainVertIdx);
    this.terrainGeo.attributes.position.needsUpdate = true;
    this.terrainGeo.attributes.color.needsUpdate = true;

    this.commitInstanced(this.waterSparkleLayer, waterIdx, true);
    this.commitInstanced(this.shoreFoamLayer, foamIdx, false);

    this.gridGeometry.setDrawRange(0, gridFloats / 3);
    this.gridGeometry.attributes.position.needsUpdate = true;

    this.commitInstanced(this.treeTrunks, treeIdx, false);
    this.commitInstanced(this.treeCrownsLower, treeIdx, true);
    this.commitInstanced(this.treeCrownsUpper, treeIdx, true);

    this.commitInstanced(this.roadEmbankment, roadEmbankIdx, false);
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
    this.terrainGeo.dispose();
    (this.terrainMesh.material as THREE.Material).dispose();

    const meshes: THREE.InstancedMesh[] = [
      this.waterSparkleLayer,
      this.shoreFoamLayer,
      this.treeTrunks,
      this.treeCrownsLower,
      this.treeCrownsUpper,
      this.roadEmbankment,
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
