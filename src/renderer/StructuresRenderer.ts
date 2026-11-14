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
  type BuildingTextureKey,
  type BuildingTextureSet,
  createBuildingTextureSet,
} from './BuildingTextures';
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
  redLens: THREE.Mesh;
  greenLens: THREE.Mesh;
  lastBlocked: boolean;
}

interface SpinningWheelRecord {
  group: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  speedRadPerSec: number;
}

interface SmokePuffRecord {
  mesh: THREE.Mesh;
  originX: number;
  originY: number;
  originZ: number;
  riseHeight: number;
  driftX: number;
  driftZ: number;
  startScale: number;
  endScale: number;
  speed: number;
  phase: number;
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

function pushTri(
  pos: number[],
  uvs: number[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  ua: number,
  va: number,
  ub: number,
  vb: number,
  uc: number,
  vc: number
): void {
  pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  uvs.push(ua, va, ub, vb, uc, vc);
}

function pushQuad(
  pos: number[],
  uvs: number[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dy: number,
  dz: number,
  uMax = 2,
  vMax = 1
): void {
  pushTri(pos, uvs, ax, ay, az, bx, by, bz, cx, cy, cz, 0, 0, uMax, 0, uMax, vMax);
  pushTri(pos, uvs, ax, ay, az, cx, cy, cz, dx, dy, dz, 0, 0, uMax, vMax, 0, vMax);
}

function finalizeCustomGeo(pos: number[], uvs: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Unit triangular prism with ridge along Z (`x=0, y=1`), base `x in [-0.5..0.5], z in [-0.5..0.5], y=0`.
 */
function createGablePrismGeo(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  // Front gable (+Z)
  pushTri(pos, uvs, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0, 0, 2, 0, 1, 1);
  // Back gable (-Z)
  pushTri(pos, uvs, 0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -0.5, 0, 0, 2, 0, 1, 1);
  // Right slope (+X)
  pushQuad(pos, uvs, 0.5, 0, 0.5, 0.5, 0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 2, 1.5);
  // Left slope (-X)
  pushQuad(pos, uvs, -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5, 2, 1.5);
  // Bottom cap
  pushQuad(pos, uvs, -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 1, 1);
  return finalizeCustomGeo(pos, uvs);
}

/**
 * True Hip Roof with horizontal ridge (`z in [-0.22..0.22]` at `x=0, y=1`) — no pyramid cones!
 */
function createHipRoofGeo(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const rZ = 0.22;
  // East slope (+X)
  pushQuad(pos, uvs, 0.5, 0, 0.5, 0.5, 0, -0.5, 0, 1, -rZ, 0, 1, rZ, 3, 2);
  // West slope (-X)
  pushQuad(pos, uvs, -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, rZ, 0, 1, -rZ, 3, 2);
  // South hip end (+Z)
  pushTri(pos, uvs, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, rZ, 0, 0, 3, 0, 1.5, 2);
  // North hip end (-Z)
  pushTri(pos, uvs, 0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -rZ, 0, 0, 3, 0, 1.5, 2);
  // Bottom soffit
  pushQuad(pos, uvs, -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 2, 2);
  return finalizeCustomGeo(pos, uvs);
}

/**
 * European OpenTTD Mansard Roof: steep slate lower pitch (`y=0..0.82`) + flat/curbed upper terrace (`y=0.82..1`).
 */
function createMansardRoofGeo(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const m = 0.34;
  const h1 = 0.82;
  const t = 0.3;
  // Lower steep mansard slopes
  pushQuad(pos, uvs, -0.5, 0, 0.5, 0.5, 0, 0.5, m, h1, m, -m, h1, m, 3, 2);
  pushQuad(pos, uvs, 0.5, 0, -0.5, -0.5, 0, -0.5, -m, h1, -m, m, h1, -m, 3, 2);
  pushQuad(pos, uvs, 0.5, 0, 0.5, 0.5, 0, -0.5, m, h1, -m, m, h1, m, 3, 2);
  pushQuad(pos, uvs, -0.5, 0, -0.5, -0.5, 0, 0.5, -m, h1, m, -m, h1, -m, 3, 2);
  // Upper shallow deck slopes
  pushQuad(pos, uvs, -m, h1, m, m, h1, m, t, 1, t, -t, 1, t, 2, 0.5);
  pushQuad(pos, uvs, m, h1, -m, -m, h1, -m, -t, 1, -t, t, 1, -t, 2, 0.5);
  pushQuad(pos, uvs, m, h1, m, m, h1, -m, t, 1, -t, t, 1, t, 2, 0.5);
  pushQuad(pos, uvs, -m, h1, -m, -m, h1, m, -t, 1, t, -t, 1, -t, 2, 0.5);
  // Flat top cap
  pushQuad(pos, uvs, -t, 1, t, t, 1, t, t, 1, -t, -t, 1, -t, 2, 2);
  return finalizeCustomGeo(pos, uvs);
}

/**
 * Classic Farm Gambrel Barn Roof with two symmetric slope angles along Z ridge.
 */
function createGambrelRoofGeo(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const kx = 0.35;
  const ky = 0.58;
  // Front & back 5-point gambrel gables
  for (const s of [1, -1]) {
    const z = 0.5 * s;
    if (s > 0) {
      pushQuad(pos, uvs, -0.5, 0, z, 0.5, 0, z, kx, ky, z, -kx, ky, z, 2, 1);
      pushTri(pos, uvs, -kx, ky, z, kx, ky, z, 0, 1, z, 0, 0, 2, 0, 1, 1);
    } else {
      pushQuad(pos, uvs, 0.5, 0, z, -0.5, 0, z, -kx, ky, z, kx, ky, z, 2, 1);
      pushTri(pos, uvs, kx, ky, z, -kx, ky, z, 0, 1, z, 0, 0, 2, 0, 1, 1);
    }
  }
  // Steep lower right & left slopes
  pushQuad(pos, uvs, 0.5, 0, 0.5, 0.5, 0, -0.5, kx, ky, -0.5, kx, ky, 0.5, 3, 1.2);
  pushQuad(pos, uvs, -0.5, 0, -0.5, -0.5, 0, 0.5, -kx, ky, 0.5, -kx, ky, -0.5, 3, 1.2);
  // Upper gentler right & left slopes
  pushQuad(pos, uvs, kx, ky, 0.5, kx, ky, -0.5, 0, 1, -0.5, 0, 1, 0.5, 3, 1.2);
  pushQuad(pos, uvs, -kx, ky, -0.5, -kx, ky, 0.5, 0, 1, 0.5, 0, 1, -0.5, 3, 1.2);
  return finalizeCustomGeo(pos, uvs);
}

/**
 * Sculpted Hyperboloid Natural-Draft Concrete Cooling Tower (`y in [0..1]`, base radius 0.5).
 */
function createHyperboloidGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = (t - 0.68) / 0.43;
    const r = 0.315 * Math.sqrt(1 + u * u);
    pts.push(new THREE.Vector2(r, t));
  }
  const geo = new THREE.LatheGeometry(pts, 18);
  return geo;
}

export class StructuresRenderer {
  public readonly group = new THREE.Group();

  private buildingsGroup = new THREE.Group();
  private signalsGroup = new THREE.Group();

  private labelLayer: HTMLDivElement | null = null;
  private labels = new Map<string, LabelRecord>();
  private onStationBadgeClick?: (stationId: string) => void;

  // Cached geometries & procedural OpenGFX textures (disposed cleanly on unmount)
  private readonly boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly tiledBoxCache = new Map<string, THREE.BoxGeometry>();
  private readonly cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  private readonly cylLowGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  private readonly coneGeo = new THREE.ConeGeometry(0.5, 1, 10);
  private readonly sphereGeo = new THREE.SphereGeometry(0.5, 8, 8);
  private readonly gablePrismGeo: THREE.BufferGeometry;
  private readonly hipRoofGeo: THREE.BufferGeometry;
  private readonly mansardRoofGeo: THREE.BufferGeometry;
  private readonly gambrelRoofGeo: THREE.BufferGeometry;
  private readonly hyperboloidGeo: THREE.BufferGeometry;

  private textureSet: BuildingTextureSet | null = null;
  private readonly matCache = new Map<string, THREE.MeshLambertMaterial>();
  private readonly signalGreenMat: THREE.MeshBasicMaterial;
  private readonly signalRedMat: THREE.MeshBasicMaterial;
  private readonly signalOffMat: THREE.MeshLambertMaterial;
  private readonly beaconGlowMat: THREE.MeshBasicMaterial;
  private readonly smokeGreyMat: THREE.MeshLambertMaterial;
  private readonly vaporWhiteMat: THREE.MeshLambertMaterial;

  private signalRecords: SignalLampRecord[] = [];
  private spinningWheels: SpinningWheelRecord[] = [];
  private smokePuffs: SmokePuffRecord[] = [];
  private beaconMeshes: THREE.Mesh[] = [];

  private lastStructuresSig = '';
  private lastSignalsLayoutSig = '';

  constructor(overlayParent: HTMLElement, onStationBadgeClick?: (stationId: string) => void) {
    this.onStationBadgeClick = onStationBadgeClick;

    this.gablePrismGeo = createGablePrismGeo();
    this.hipRoofGeo = createHipRoofGeo();
    this.mansardRoofGeo = createMansardRoofGeo();
    this.gambrelRoofGeo = createGambrelRoofGeo();
    this.hyperboloidGeo = createHyperboloidGeo();

    this.signalGreenMat = new THREE.MeshBasicMaterial({ color: '#22c55e' });
    this.signalRedMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });
    this.signalOffMat = new THREE.MeshLambertMaterial({ color: '#1e293b' });
    this.beaconGlowMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });
    this.smokeGreyMat = new THREE.MeshLambertMaterial({
      color: '#cbd5e1',
      transparent: true,
      opacity: 0.68,
    });
    this.vaporWhiteMat = new THREE.MeshLambertMaterial({
      color: '#f8fafc',
      transparent: true,
      opacity: 0.82,
    });

    this.group.add(this.buildingsGroup, this.signalsGroup);

    if (typeof document !== 'undefined' && overlayParent) {
      const layer = document.createElement('div');
      layer.style.position = 'absolute';
      layer.style.inset = '0';
      layer.style.overflow = 'hidden';
      layer.style.pointerEvents = 'none';
      layer.style.zIndex = '5';
      overlayParent.appendChild(layer);
      this.labelLayer = layer;
    }
  }

  private ensureTextures(): BuildingTextureSet | null {
    if (!this.textureSet && typeof document !== 'undefined') {
      this.textureSet = createBuildingTextureSet();
    }
    return this.textureSet;
  }

  private getMat(
    hex: string,
    emissiveHex?: string,
    emissiveIntensity = 0,
    texKey?: BuildingTextureKey
  ): THREE.MeshLambertMaterial {
    const key = `${texKey ?? ''}|${hex}|${emissiveHex ?? ''}|${emissiveIntensity}`;
    let mat = this.matCache.get(key);
    if (!mat) {
      const tex = texKey ? this.ensureTextures()?.textures[texKey] ?? null : null;
      const params: THREE.MeshLambertMaterialParameters = { color: hex };
      if (tex) {
        params.map = tex;
      }
      if (emissiveHex) {
        params.emissive = new THREE.Color(emissiveHex);
        params.emissiveIntensity = emissiveIntensity;
      }
      mat = new THREE.MeshLambertMaterial(params);
      this.matCache.set(key, mat);
    }
    return mat;
  }

  private getTiledBoxGeo(repX: number, repY: number, repZ: number): THREE.BoxGeometry {
    const rx = Math.max(1, Math.round(repX));
    const ry = Math.max(1, Math.round(repY));
    const rz = Math.max(1, Math.round(repZ));
    if (rx === 1 && ry === 1 && rz === 1) {
      return this.boxGeo;
    }
    const key = `${rx},${ry},${rz}`;
    let geo = this.tiledBoxCache.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(1, 1, 1);
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let face = 0; face < 6; face++) {
        let su = rx;
        let sv = ry;
        if (face === 0 || face === 1) {
          // +X / -X faces span Z horizontally, Y vertically
          su = rz;
          sv = ry;
        } else if (face === 2 || face === 3) {
          // +Y / -Y faces span X, Z
          su = rx;
          sv = rz;
        }
        for (let k = 0; k < 4; k++) {
          const idx = face * 4 + k;
          uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
        }
      }
      uv.needsUpdate = true;
      this.tiledBoxCache.set(key, geo);
    }
    return geo;
  }

  private markShadow(mesh: THREE.Mesh, cast = true, receive = true): THREE.Mesh {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
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
    this.markShadow(m, h >= 0.045, true);
    parent.add(m);
    return m;
  }

  private addTexBox(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    yBottom: number,
    z: number,
    texKey: BuildingTextureKey,
    repX = 1,
    repY = 1,
    repZ = 1,
    tintHex = '#ffffff'
  ): THREE.Mesh {
    const geo = this.getTiledBoxGeo(repX, repY, repZ);
    const m = new THREE.Mesh(geo, this.getMat(tintHex, undefined, 0, texKey));
    m.scale.set(w, h, d);
    m.position.set(x, yBottom + h * 0.5, z);
    this.markShadow(m, h >= 0.045, true);
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
    hex: string,
    texKey?: BuildingTextureKey,
    lowPoly = false
  ): THREE.Mesh {
    const m = new THREE.Mesh(
      lowPoly ? this.cylLowGeo : this.cylGeo,
      this.getMat(hex, undefined, 0, texKey)
    );
    m.scale.set(radius * 2, h, radius * 2);
    m.position.set(x, yBottom + h * 0.5, z);
    this.markShadow(m, h >= 0.05, true);
    parent.add(m);
    return m;
  }

  /**
   * Proper Triangular Prism Gable Roof with gable-end masonry/timber triangle, overhanging shingle slopes,
   * bargeboards, and ridge cap beam.
   */
  private addGableRoof(
    parent: THREE.Object3D,
    w: number,
    roofH: number,
    d: number,
    x: number,
    yBottom: number,
    z: number,
    roofTex: BuildingTextureKey,
    gableWallTex: BuildingTextureKey | null,
    gableHex: string,
    ridgeAlongZ = true,
    overhang = 0.045,
    trimHex = '#f1f5f9'
  ): void {
    const span = ridgeAlongZ ? w : d;
    const len = ridgeAlongZ ? d : w;

    // 1. Gable pediment wall core flush with building walls
    const prism = new THREE.Mesh(
      this.gablePrismGeo,
      gableWallTex ? this.getMat(gableHex, undefined, 0, gableWallTex) : this.getMat(gableHex)
    );
    if (ridgeAlongZ) {
      prism.scale.set(w, roofH, d);
    } else {
      prism.rotation.y = Math.PI / 2;
      prism.scale.set(d, roofH, w);
    }
    prism.position.set(x, yBottom, z);
    this.markShadow(prism, true, true);
    parent.add(prism);

    // 2. Two overhanging pitched roof slope slabs + ridge cap
    const halfSpan = span * 0.5 + overhang;
    const pitchRise = roofH * (halfSpan / Math.max(0.05, span * 0.5));
    const slopeLen = Math.hypot(halfSpan, pitchRise);
    const angle = Math.atan2(pitchRise, halfSpan);
    const slabLen = len + overhang * 2;
    const slabThick = 0.026;
    const roofMat = this.getMat('#ffffff', undefined, 0, roofTex);

    const roofHolder = new THREE.Group();
    roofHolder.position.set(x, yBottom + roofH - pitchRise * 0.5, z);
    if (!ridgeAlongZ) {
      roofHolder.rotation.y = Math.PI / 2;
    }

    const repAlong = Math.max(1, Math.round(slabLen * 3));
    const repSlope = Math.max(1, Math.round(slopeLen * 3));
    const slopeGeo = this.getTiledBoxGeo(repSlope, 1, repAlong);

    for (const side of [-1, 1]) {
      const slope = new THREE.Mesh(slopeGeo, roofMat);
      slope.scale.set(slopeLen, slabThick, slabLen);
      slope.position.set(side * halfSpan * 0.5, 0, 0);
      slope.rotation.z = -side * angle;
      this.markShadow(slope, true, true);
      roofHolder.add(slope);
    }

    // Crisp ridge beam along crest
    const ridge = new THREE.Mesh(this.boxGeo, this.getMat(trimHex));
    ridge.scale.set(0.036, 0.032, slabLen + 0.01);
    ridge.position.set(0, pitchRise * 0.5 + 0.012, 0);
    this.markShadow(ridge, true, false);
    roofHolder.add(ridge);

    parent.add(roofHolder);
  }

  private addHipRoof(
    parent: THREE.Object3D,
    w: number,
    roofH: number,
    d: number,
    x: number,
    yBottom: number,
    z: number,
    roofTex: BuildingTextureKey,
    eaveHex = '#e2e8f0',
    overhang = 0.045
  ): void {
    // Eave fascia cornice plate
    this.addBox(parent, w + overhang * 2, 0.026, d + overhang * 2, x, yBottom, z, eaveHex);
    const hip = new THREE.Mesh(
      this.hipRoofGeo,
      this.getMat('#ffffff', undefined, 0, roofTex)
    );
    const ridgeAlongZ = d >= w;
    if (ridgeAlongZ) {
      hip.scale.set(w + overhang * 1.6, roofH, d + overhang * 1.6);
    } else {
      hip.rotation.y = Math.PI / 2;
      hip.scale.set(d + overhang * 1.6, roofH, w + overhang * 1.6);
    }
    hip.position.set(x, yBottom + 0.024, z);
    this.markShadow(hip, true, true);
    parent.add(hip);

    // Ridge cap bar
    const rw = ridgeAlongZ ? 0.035 : (w + overhang) * 0.44;
    const rd = ridgeAlongZ ? (d + overhang) * 0.44 : 0.035;
    this.addBox(parent, rw, 0.026, rd, x, yBottom + 0.02 + roofH, z, '#334155');
  }

  private addMansardRoof(
    parent: THREE.Object3D,
    w: number,
    roofH: number,
    d: number,
    x: number,
    yBottom: number,
    z: number,
    corniceHex = '#e2d9c8'
  ): void {
    this.addBox(parent, w + 0.05, 0.03, d + 0.05, x, yBottom, z, corniceHex);
    const mansard = new THREE.Mesh(
      this.mansardRoofGeo,
      this.getMat('#ffffff', undefined, 0, 'roofSlate')
    );
    mansard.scale.set(w + 0.03, roofH, d + 0.03);
    mansard.position.set(x, yBottom + 0.028, z);
    this.markShadow(mansard, true, true);
    parent.add(mansard);

    // Zinc upper deck rim
    this.addBox(
      parent,
      (w + 0.03) * 0.62,
      0.022,
      (d + 0.03) * 0.62,
      x,
      yBottom + 0.028 + roofH,
      z,
      '#64748b'
    );
  }

  private addDormer(
    parent: THREE.Object3D,
    x: number,
    yBottom: number,
    z: number,
    rotY = 0,
    wallHex = '#f1ece1'
  ): void {
    const dg = new THREE.Group();
    dg.position.set(x, yBottom, z);
    dg.rotation.y = rotY;
    this.addBox(dg, 0.11, 0.09, 0.12, 0, 0, 0, wallHex);
    this.addBox(dg, 0.065, 0.06, 0.015, 0, 0.018, 0.06, '#fde047', '#f59e0b', 0.35);
    this.addGableRoof(dg, 0.12, 0.055, 0.13, 0, 0.09, 0, 'roofSlate', null, wallHex, true, 0.015);
    parent.add(dg);
  }

  private addChimney(
    parent: THREE.Object3D,
    x: number,
    yBottom: number,
    z: number,
    h = 0.16,
    twoPots = false
  ): void {
    this.addTexBox(parent, 0.075, h, 0.075, x, yBottom, z, 'brickRedPlain', 1, 1, 1);
    this.addBox(parent, 0.09, 0.02, 0.09, x, yBottom + h, z, '#475569');
    if (twoPots) {
      this.addCyl(parent, 0.014, 0.035, x - 0.018, yBottom + h + 0.02, z, '#b45309', undefined, true);
      this.addCyl(parent, 0.014, 0.035, x + 0.018, yBottom + h + 0.02, z, '#b45309', undefined, true);
    } else {
      this.addCyl(parent, 0.016, 0.038, x, yBottom + h + 0.02, z, '#b45309', undefined, true);
    }
  }

  private addGardenTree(
    parent: THREE.Object3D,
    x: number,
    yBottom: number,
    z: number,
    scale = 1,
    conifer = false
  ): void {
    this.addCyl(parent, 0.018 * scale, 0.11 * scale, x, yBottom, z, '#5c3a21', undefined, true);
    if (conifer) {
      const c1 = new THREE.Mesh(this.coneGeo, this.getMat('#1b5e20'));
      c1.scale.set(0.16 * scale, 0.18 * scale, 0.16 * scale);
      c1.position.set(x, yBottom + 0.14 * scale, z);
      this.markShadow(c1, true, true);
      parent.add(c1);
      const c2 = new THREE.Mesh(this.coneGeo, this.getMat('#2e7d32'));
      c2.scale.set(0.11 * scale, 0.15 * scale, 0.11 * scale);
      c2.position.set(x, yBottom + 0.24 * scale, z);
      this.markShadow(c2, true, true);
      parent.add(c2);
    } else {
      const crown = new THREE.Mesh(this.sphereGeo, this.getMat('#2d7a3a'));
      crown.scale.set(0.15 * scale, 0.15 * scale, 0.15 * scale);
      crown.position.set(x, yBottom + 0.15 * scale, z);
      this.markShadow(crown, true, true);
      parent.add(crown);
    }
  }

  private addBeacon(parent: THREE.Object3D, x: number, yBottom: number, z: number, mastH = 0.18): void {
    this.addCyl(parent, 0.009, mastH, x, yBottom, z, '#cbd5e1', undefined, true);
    const bulb = new THREE.Mesh(this.sphereGeo, this.beaconGlowMat);
    bulb.scale.set(0.036, 0.036, 0.036);
    bulb.position.set(x, yBottom + mastH + 0.015, z);
    parent.add(bulb);
    this.beaconMeshes.push(bulb);
  }

  private spawnSmokePlume(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    opts: {
      vapor?: boolean;
      puffCount?: number;
      riseHeight?: number;
      startScale?: number;
      endScale?: number;
      speed?: number;
    } = {}
  ): void {
    const count = opts.puffCount ?? 5;
    const mat = opts.vapor ? this.vaporWhiteMat : this.smokeGreyMat;
    const riseHeight = opts.riseHeight ?? 0.55;
    const startScale = opts.startScale ?? 0.07;
    const endScale = opts.endScale ?? 0.24;
    const speed = opts.speed ?? 0.34;

    for (let i = 0; i < count; i++) {
      const puff = new THREE.Mesh(this.sphereGeo, mat);
      puff.castShadow = false;
      puff.receiveShadow = false;
      const phase = i / count;
      puff.position.set(x, y + phase * riseHeight, z);
      puff.scale.setScalar(startScale);
      parent.add(puff);
      this.smokePuffs.push({
        mesh: puff,
        originX: x,
        originY: y,
        originZ: z,
        riseHeight,
        driftX: 0.22,
        driftZ: -0.14,
        startScale,
        endScale,
        speed,
        phase,
      });
    }
  }

  private createSpokedSheaveWheel(radius: number, rimHex = '#e2e8f0', spokeHex = '#94a3b8'): THREE.Group {
    const wg = new THREE.Group();
    // Outer rim segments (octagon of steel bars)
    const segs = 8;
    const chord = 2 * radius * Math.sin(Math.PI / segs) * 1.08;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const bar = new THREE.Mesh(this.boxGeo, this.getMat(rimHex));
      bar.scale.set(0.022, chord, 0.026);
      bar.position.set(0, Math.sin(a) * radius, Math.cos(a) * radius);
      bar.rotation.x = -a;
      this.markShadow(bar, true, false);
      wg.add(bar);
    }
    // 4 diametric spokes (= 8 radial spokes) so rotation is unmistakably crisp
    for (let s = 0; s < 4; s++) {
      const spoke = new THREE.Mesh(this.boxGeo, this.getMat(spokeHex));
      spoke.scale.set(0.014, radius * 1.95, 0.014);
      spoke.rotation.x = (s / 4) * Math.PI;
      wg.add(spoke);
    }
    // Central axle hub
    const hub = new THREE.Mesh(this.cylLowGeo, this.getMat('#dc2626'));
    hub.rotation.z = Math.PI / 2;
    hub.scale.set(radius * 0.42, 0.042, radius * 0.42);
    wg.add(hub);
    return wg;
  }

  private addBarkLog(
    parent: THREE.Object3D,
    x: number,
    yCenter: number,
    z: number,
    radius: number,
    length: number,
    alongX = true,
    barkHex = '#6b4226'
  ): void {
    const bark = new THREE.Mesh(this.cylLowGeo, this.getMat(barkHex));
    const endA = new THREE.Mesh(this.cylLowGeo, this.getMat('#fde68a'));
    const endB = new THREE.Mesh(this.cylLowGeo, this.getMat('#fde68a'));

    if (alongX) {
      bark.rotation.z = Math.PI / 2;
      endA.rotation.z = Math.PI / 2;
      endB.rotation.z = Math.PI / 2;
      endA.position.set(x - length * 0.5, yCenter, z);
      endB.position.set(x + length * 0.5, yCenter, z);
    } else {
      bark.rotation.x = Math.PI / 2;
      endA.rotation.x = Math.PI / 2;
      endB.rotation.x = Math.PI / 2;
      endA.position.set(x, yCenter, z - length * 0.5);
      endB.position.set(x, yCenter, z + length * 0.5);
    }

    bark.scale.set(radius * 2, length * 0.97, radius * 2);
    bark.position.set(x, yCenter, z);
    endA.scale.set(radius * 1.88, 0.012, radius * 1.88);
    endB.scale.set(radius * 1.88, 0.012, radius * 1.88);
    this.markShadow(bark, true, true);
    parent.add(bark, endA, endB);
  }

  /**
   * Authentic OpenTTD cut-stone ashlar masonry retaining wall + projecting stone parapet coping rim!
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
    const repX = Math.max(1, Math.round(width * 2));
    const repZ = Math.max(1, Math.round(depth * 2));

    if (drop <= 0.055) {
      this.addTexBox(parent, width, 0.042, depth, offsetX, -0.042, offsetZ, 'ashlarStone', repX, 1, repZ);
      this.addBox(parent, width + 0.02, 0.016, depth + 0.02, offsetX, -0.016, offsetZ, '#94a3b8');
      return;
    }

    const repY = Math.max(1, Math.round(drop * 2.5));
    this.addTexBox(
      parent,
      width,
      drop,
      depth,
      offsetX,
      -drop,
      offsetZ,
      'ashlarStone',
      repX,
      repY,
      repZ
    );
    // Projecting dressed granite parapet coping ledge along top of retaining wall
    this.addTexBox(
      parent,
      width + 0.034,
      0.036,
      depth + 0.034,
      offsetX,
      -0.036,
      offsetZ,
      'platformPaving',
      repX,
      1,
      repZ,
      '#cbd5e1'
    );
  }

  // =========================================================================
  // 2. RICH OPENTTD & NORWEGIAN TOWN ARCHITECTURE (15 Archetypes, Zero Cones)
  // =========================================================================

  private buildTownHouse(tile: Tile, state: GameState): void {
    const { x, y } = tile;
    const corners = getTileCornerHeights(state, x, y);
    const tier = tile.buildingTier ?? 1;
    const h1 = detHash(x, y, 1);
    const h2 = detHash(x, y, 2);
    const h3 = detHash(x, y, 3);

    const g = new THREE.Group();
    g.position.set(x, corners.maxY, y);

    this.addRetainingFoundation(g, 0.92, 0.92, corners.minY, corners.maxY);

    const sub = new THREE.Group();
    sub.rotation.y = Math.floor(h1 * 4) * (Math.PI / 2);
    g.add(sub);

    const variant = Math.floor(h2 * 5) % 5;

    if (tier === 1) {
      // Grass garden plot base
      this.addBox(sub, 0.88, 0.018, 0.88, 0, 0, 0, '#3f6a34');

      const timberKeys: BuildingTextureKey[] = [
        'timberRorosRed',
        'timberBergenOchre',
        'timberCoastalWhite',
        'timberSageGreen',
      ];
      const clapTex = timberKeys[Math.floor(h3 * timberKeys.length) % timberKeys.length];
      const roofTex: BuildingTextureKey = h3 > 0.45 ? 'roofTerracotta' : 'roofSlate';

      if (variant === 0) {
        // Archetype 1A: Norwegian Clapboard Gable Cottage with Front Porch & Clipped Garden Hedge
        this.addBox(sub, 0.6, 0.035, 0.5, 0, 0.018, -0.04, '#64748b');
        this.addTexBox(sub, 0.56, 0.25, 0.46, 0, 0.053, -0.04, clapTex, 2, 1, 2);
        this.addGableRoof(sub, 0.56, 0.19, 0.46, 0, 0.303, -0.04, roofTex, clapTex, '#ffffff', false, 0.05);
        this.addChimney(sub, 0.16, 0.32, -0.08, 0.18, false);

        // Front porch + timber posts + door + walkway
        this.addBox(sub, 0.24, 0.03, 0.16, 0, 0.025, 0.25, '#94a3b8');
        this.addBox(sub, 0.08, 0.15, 0.02, 0, 0.055, 0.195, '#78350f');
        this.addBox(sub, 0.025, 0.16, 0.025, -0.09, 0.055, 0.3, '#f8fafc');
        this.addBox(sub, 0.025, 0.16, 0.025, 0.09, 0.055, 0.3, '#f8fafc');
        this.addGableRoof(sub, 0.24, 0.075, 0.17, 0, 0.215, 0.25, roofTex, null, '#f8fafc', true, 0.02);

        // Low front garden hedges + walkway
        this.addBox(sub, 0.12, 0.012, 0.14, 0, 0.018, 0.37, '#cbd5e1');
        this.addBox(sub, 0.28, 0.065, 0.055, -0.25, 0.018, 0.39, '#166534');
        this.addBox(sub, 0.28, 0.065, 0.055, 0.25, 0.018, 0.39, '#166534');
      } else if (variant === 1) {
        // Archetype 1B: L-Shaped Sørlandet Villa with Intersecting Gables & Wooden Deck
        const wingTex: BuildingTextureKey = h1 > 0.5 ? 'timberCoastalWhite' : 'timberSageGreen';
        this.addBox(sub, 0.64, 0.032, 0.42, -0.04, 0.018, -0.14, '#64748b');
        this.addTexBox(sub, 0.62, 0.25, 0.4, -0.04, 0.05, -0.14, wingTex, 2, 1, 1);
        this.addGableRoof(sub, 0.62, 0.18, 0.4, -0.04, 0.3, -0.14, 'roofTerracotta', wingTex, '#ffffff', false, 0.045);

        // Perpendicular projecting front gable wing
        this.addBox(sub, 0.34, 0.032, 0.36, 0.14, 0.018, 0.14, '#64748b');
        this.addTexBox(sub, 0.32, 0.25, 0.34, 0.14, 0.05, 0.14, wingTex, 1, 1, 1);
        this.addGableRoof(sub, 0.32, 0.17, 0.34, 0.14, 0.3, 0.14, 'roofTerracotta', wingTex, '#ffffff', true, 0.045);

        // Sunny wooden patio deck in the L-nook + garden tree + white fence
        this.addBox(sub, 0.28, 0.025, 0.28, -0.18, 0.018, 0.15, '#b45309');
        this.addChimney(sub, 0.02, 0.31, -0.08, 0.19, true);
        this.addGardenTree(sub, -0.26, 0.018, 0.32, 0.9, false);
        this.addBox(sub, 0.82, 0.048, 0.022, 0, 0.018, 0.41, '#f8fafc');
      } else if (variant === 2) {
        // Archetype 1C: Steep Brick/Timber Dormer Chalet with Woodpile & Stoop
        const chaletTex: BuildingTextureKey = h3 > 0.5 ? 'brickRedWindow' : 'timberBergenOchre';
        this.addBox(sub, 0.58, 0.04, 0.52, -0.03, 0.018, 0, '#475569');
        this.addTexBox(sub, 0.54, 0.26, 0.48, -0.03, 0.058, 0, chaletTex, 2, 1, 2);
        this.addGableRoof(sub, 0.54, 0.24, 0.48, -0.03, 0.318, 0, 'roofSlate', chaletTex, '#ffffff', false, 0.055);
        this.addDormer(sub, -0.03, 0.35, 0.16, 0, '#f8fafc');
        this.addChimney(sub, -0.2, 0.34, -0.08, 0.22, true);
        // Stacked firewood logs under side eaves + garden spruce
        for (let k = 0; k < 3; k++) {
          this.addBarkLog(sub, 0.28, 0.04 + k * 0.032, -0.06, 0.018, 0.22, false);
        }
        this.addGardenTree(sub, 0.31, 0.018, 0.26, 1.05, true);
      } else if (variant === 3) {
        // Archetype 1D: Hip-Roof Suburban Brick Bungalow with Side Garage & Driveway
        this.addBox(sub, 0.28, 0.012, 0.44, 0.24, 0.018, 0.2, '#64748b'); // Driveway
        this.addTexBox(sub, 0.5, 0.25, 0.48, -0.12, 0.018, -0.02, 'brickOchreWindow', 2, 1, 2);
        this.addHipRoof(sub, 0.5, 0.17, 0.48, -0.12, 0.268, -0.02, 'roofSlate', '#f1f5f9', 0.045);
        // Attached garage wing + ribbed white garage door
        this.addTexBox(sub, 0.28, 0.2, 0.38, 0.24, 0.018, -0.04, 'brickRedPlain', 1, 1, 1);
        this.addBox(sub, 0.2, 0.15, 0.02, 0.24, 0.02, 0.155, '#e2e8f0');
        this.addHipRoof(sub, 0.28, 0.1, 0.38, 0.24, 0.218, -0.04, 'roofSlate', '#f1f5f9', 0.035);
        this.addChimney(sub, -0.24, 0.28, -0.1, 0.16, false);
        this.addGardenTree(sub, -0.32, 0.018, 0.31, 0.85, false);
      } else {
        // Archetype 1E: Cozy Village Corner Shop / Landhandel with Striped Awning
        this.addBox(sub, 0.84, 0.02, 0.84, 0, 0.018, 0, '#94a3b8');
        this.addTexBox(sub, 0.58, 0.22, 0.52, 0, 0.038, -0.04, 'shopfrontGround', 1, 1, 1);
        this.addTexBox(sub, 0.58, 0.16, 0.52, 0, 0.258, -0.04, clapTex, 2, 1, 2);
        this.addGableRoof(sub, 0.58, 0.19, 0.52, 0, 0.418, -0.04, 'roofTerracotta', clapTex, '#ffffff', true, 0.05);
        // Sloped striped shop awning across front
        const awning = new THREE.Mesh(
          this.getTiledBoxGeo(2, 1, 1),
          this.getMat('#ffffff', undefined, 0, h1 > 0.5 ? 'awningStripedRed' : 'awningStripedGreen')
        );
        awning.scale.set(0.54, 0.025, 0.15);
        awning.position.set(0, 0.21, 0.27);
        awning.rotation.x = 0.38;
        this.markShadow(awning, true, false);
        sub.add(awning);
        this.addBox(sub, 0.09, 0.07, 0.08, -0.2, 0.038, 0.28, '#d97706'); // Outdoor produce crate
        this.addChimney(sub, 0.2, 0.43, -0.14, 0.16, false);
      }
    } else if (tier === 2) {
      // Paved urban sidewalk plot
      this.addTexBox(sub, 0.9, 0.024, 0.9, 0, 0, 0, 'platformPaving', 3, 1, 3);

      if (variant === 0) {
        // Archetype 2A: 3-Story European Mansard Townhouse with Shopfront, Balconies & Dormers
        const upperTex: BuildingTextureKey = h3 > 0.5 ? 'stuccoCreamWindow' : 'brickOchreWindow';
        this.addTexBox(sub, 0.68, 0.2, 0.6, 0, 0.024, -0.02, 'shopfrontGround', 1, 1, 1);
        this.addBox(sub, 0.7, 0.022, 0.62, 0, 0.224, -0.02, '#e2d9c8'); // Stone stringcourse
        this.addTexBox(sub, 0.68, 0.38, 0.6, 0, 0.246, -0.02, upperTex, 3, 2, 2);

        // Striped awning + wrought-iron Juliet balconies
        const awning = new THREE.Mesh(
          this.getTiledBoxGeo(2, 1, 1),
          this.getMat('#ffffff', undefined, 0, 'awningStripedBlue')
        );
        awning.scale.set(0.64, 0.024, 0.13);
        awning.position.set(0, 0.2, 0.32);
        awning.rotation.x = 0.35;
        sub.add(awning);

        for (const bx of [-0.19, 0.19]) {
          this.addBox(sub, 0.16, 0.02, 0.07, bx, 0.41, 0.31, '#cbd5e1');
          this.addBox(sub, 0.16, 0.055, 0.015, bx, 0.43, 0.34, '#1e293b');
        }

        this.addMansardRoof(sub, 0.68, 0.22, 0.6, 0, 0.626, -0.02);
        this.addDormer(sub, -0.17, 0.67, 0.23, 0, '#f1ece1');
        this.addDormer(sub, 0.17, 0.67, 0.23, 0, '#f1ece1');
        this.addChimney(sub, -0.24, 0.78, -0.12, 0.15, true);
        this.addChimney(sub, 0.24, 0.78, -0.12, 0.15, true);
      } else if (variant === 1) {
        // Archetype 2B: Twin Asymmetric 4-Story Flemish Brick Rowhouses + Rear Courtyard Tree
        this.addTexBox(sub, 0.35, 0.64, 0.56, -0.175, 0.024, 0.04, 'brickRedWindow', 2, 3, 2);
        this.addGableRoof(sub, 0.35, 0.18, 0.56, -0.175, 0.664, 0.04, 'roofSlate', 'brickRedPlain', '#ffffff', true, 0.03);
        this.addChimney(sub, -0.3, 0.68, -0.08, 0.16, true);

        this.addTexBox(sub, 0.35, 0.56, 0.54, 0.175, 0.024, 0.04, 'brickOchreWindow', 2, 3, 2);
        this.addGableRoof(sub, 0.35, 0.17, 0.54, 0.175, 0.584, 0.04, 'roofTerracotta', 'brickRedPlain', '#ffffff', true, 0.03);

        // Front stone stoops
        this.addBox(sub, 0.11, 0.045, 0.08, -0.175, 0.024, 0.35, '#cbd5e1');
        this.addBox(sub, 0.11, 0.045, 0.08, 0.175, 0.024, 0.34, '#cbd5e1');
        this.addGardenTree(sub, 0.24, 0.024, -0.32, 1.0, false);
      } else if (variant === 2) {
        // Archetype 2C: L-Shaped Corner Commercial Block with Dual Awnings & Corner Turret
        this.addTexBox(sub, 0.72, 0.2, 0.42, 0, 0.024, 0.14, 'shopfrontGround', 2, 1, 1);
        this.addTexBox(sub, 0.72, 0.38, 0.42, 0, 0.224, 0.14, 'brickRedWindowLit', 3, 2, 2);
        this.addHipRoof(sub, 0.72, 0.16, 0.42, 0, 0.604, 0.14, 'roofSlate', '#e2d9c8', 0.035);

        this.addTexBox(sub, 0.4, 0.56, 0.38, -0.16, 0.024, -0.2, 'brickRedWindow', 2, 3, 2);
        this.addHipRoof(sub, 0.4, 0.15, 0.38, -0.16, 0.584, -0.2, 'roofSlate', '#e2d9c8', 0.035);

        // Corner octagonal turret accent + copper spire
        this.addCyl(sub, 0.13, 0.68, 0.28, 0.024, 0.26, '#9a3424', 'brickRedPlain');
        const spire = new THREE.Mesh(this.coneGeo, this.getMat('#2d6a4f'));
        spire.scale.set(0.28, 0.22, 0.28);
        spire.position.set(0.28, 0.81, 0.26);
        this.markShadow(spire, true, true);
        sub.add(spire);

        const awn = new THREE.Mesh(
          this.getTiledBoxGeo(2, 1, 1),
          this.getMat('#ffffff', undefined, 0, 'awningStripedRed')
        );
        awn.scale.set(0.56, 0.022, 0.12);
        awn.position.set(-0.04, 0.2, 0.39);
        awn.rotation.x = 0.35;
        sub.add(awn);

        this.addGardenTree(sub, 0.22, 0.024, -0.22, 1.05, false);
      } else if (variant === 3) {
        // Archetype 2D: 4-Story Nordic Brick Apartment Block with Stacked Balcony Boxes
        const aptTex: BuildingTextureKey = h1 > 0.5 ? 'brickOchreWindow' : 'brickRedWindow';
        this.addTexBox(sub, 0.7, 0.72, 0.56, 0, 0.024, -0.02, aptTex, 3, 4, 2);
        this.addHipRoof(sub, 0.7, 0.17, 0.56, 0, 0.744, -0.02, 'roofSlate', '#cbd5e1', 0.045);

        for (let fl = 1; fl <= 3; fl++) {
          const by = 0.024 + fl * 0.175;
          for (const bx of [-0.18, 0.18]) {
            this.addBox(sub, 0.2, 0.024, 0.1, bx, by, 0.3, '#e2e8f0');
            this.addBox(sub, 0.2, 0.055, 0.016, bx, by + 0.024, 0.342, '#334155');
            this.addBox(sub, 0.12, 0.025, 0.03, bx, by + 0.06, 0.34, '#15803d');
          }
        }
        this.addChimney(sub, 0.22, 0.78, -0.14, 0.14, true);
      } else {
        // Archetype 2E: Neoclassical Civic Office / Town Bank with 4-Column Stone Portico
        this.addTexBox(sub, 0.72, 0.14, 0.62, 0, 0.024, -0.04, 'ashlarStone', 3, 1, 2);
        this.addTexBox(sub, 0.68, 0.44, 0.58, 0, 0.164, -0.04, 'stuccoCreamWindow', 3, 2, 2);
        this.addHipRoof(sub, 0.68, 0.18, 0.58, 0, 0.604, -0.04, 'roofSlate', '#f1ece1', 0.045);

        // Grand front steps + 4 classical columns + triangular pediment
        this.addBox(sub, 0.42, 0.05, 0.14, 0, 0.024, 0.3, '#cbd5e1');
        for (const cx of [-0.15, -0.05, 0.05, 0.15]) {
          this.addCyl(sub, 0.024, 0.38, cx, 0.074, 0.32, '#f8fafc');
        }
        this.addGableRoof(sub, 0.42, 0.11, 0.14, 0, 0.454, 0.3, 'roofSlate', null, '#f8fafc', true, 0.02);
        this.addGardenTree(sub, -0.32, 0.024, 0.34, 0.85, false);
        this.addGardenTree(sub, 0.32, 0.024, 0.34, 0.85, false);
      }
    } else {
      // TIER 3: City-Center High-Rises & Skyscrapers (6–9 Stories + Rooftop Details)
      this.addTexBox(sub, 0.92, 0.03, 0.92, 0, 0, 0, 'platformPaving', 3, 1, 3);

      if (variant === 0) {
        // Archetype 3A: Classic 1970s OpenTTD Concrete-and-Steel Office Slab (7-8 Stories)
        const towerH = 1.18 + h3 * 0.24;
        const floors = Math.max(6, Math.round(towerH / 0.16));
        this.addTexBox(sub, 0.78, 0.16, 0.66, 0, 0.03, 0, 'shopfrontGround', 2, 1, 2);
        this.addTexBox(sub, 0.74, towerH, 0.58, 0, 0.19, 0, 'officeConcreteGrid', 4, floors, 3);
        // Concrete corner pilasters & cantilevered cornice
        this.addBox(sub, 0.78, 0.045, 0.62, 0, 0.19 + towerH, 0, '#cbd5e1');
        // Rooftop elevator penthouse + twin HVAC chillers + red warning beacon
        const topY = 0.235 + towerH;
        this.addBox(sub, 0.26, 0.15, 0.22, -0.12, topY, -0.04, '#94a3b8');
        this.addBox(sub, 0.16, 0.08, 0.14, 0.16, topY, 0.08, '#cbd5e1');
        this.addCyl(sub, 0.045, 0.02, 0.16, topY + 0.08, 0.08, '#1e293b');
        this.addBeacon(sub, -0.12, topY + 0.15, -0.04, 0.2);
      } else if (variant === 1) {
        // Archetype 3B: Stepped Setback Glass Curtain-Wall Tower + Rooftop Water Tank
        const hLow = 0.72;
        const hMid = 0.58 + h3 * 0.22;
        this.addBox(sub, 0.82, 0.16, 0.82, 0, 0.03, 0, '#1e293b');
        this.addTexBox(sub, 0.76, hLow, 0.76, 0, 0.19, 0, 'curtainWallBlue', 4, 4, 4);
        this.addBox(sub, 0.79, 0.032, 0.79, 0, 0.19 + hLow, 0, '#cbd5e1');

        this.addTexBox(sub, 0.56, hMid, 0.56, 0, 0.222 + hLow, 0, 'curtainWallBlue', 3, 4, 3);
        const topY = 0.222 + hLow + hMid;
        this.addBox(sub, 0.59, 0.036, 0.59, 0, topY, 0, '#e2e8f0');
        // Elevator house + classic OpenTTD wooden rooftop water tank on 4 steel legs
        this.addBox(sub, 0.2, 0.13, 0.2, -0.1, topY + 0.036, -0.08, '#64748b');
        for (const [lx, lz] of [
          [0.09, 0.06],
          [0.19, 0.06],
          [0.09, 0.16],
          [0.19, 0.16],
        ]) {
          this.addBox(sub, 0.018, 0.08, 0.018, lx, topY + 0.036, lz, '#334155');
        }
        this.addCyl(sub, 0.075, 0.12, 0.14, topY + 0.11, 0.11, '#92400e');
        const tankCap = new THREE.Mesh(this.coneGeo, this.getMat('#475569'));
        tankCap.scale.set(0.17, 0.065, 0.17);
        tankCap.position.set(0.14, topY + 0.26, 0.11);
        sub.add(tankCap);
        this.addBeacon(sub, -0.1, topY + 0.166, -0.08, 0.22);
      } else if (variant === 2) {
        // Archetype 3C: Twin-Wing Modern Residential High-Rise with Stacked Balcony Rows
        const wingH = 1.12 + h3 * 0.26;
        const floors = Math.max(6, Math.round(wingH / 0.16));
        // Central glazed elevator core
        this.addTexBox(sub, 0.24, wingH + 0.14, 0.34, 0, 0.03, 0, 'curtainWallBlue', 1, floors, 2);
        // Twin offset residential wings
        this.addTexBox(sub, 0.32, wingH, 0.62, -0.22, 0.03, 0.08, 'apartmentModern', 2, floors, 3);
        this.addTexBox(sub, 0.32, wingH, 0.62, 0.22, 0.03, -0.08, 'apartmentModern', 2, floors, 3);

        for (let f = 1; f < floors; f++) {
          const by = 0.03 + f * (wingH / floors);
          this.addBox(sub, 0.24, 0.02, 0.08, -0.22, by, 0.41, '#f8fafc');
          this.addBox(sub, 0.24, 0.045, 0.014, -0.22, by + 0.02, 0.445, '#0284c7');
          this.addBox(sub, 0.24, 0.02, 0.08, 0.22, by, -0.41, '#f8fafc');
          this.addBox(sub, 0.24, 0.045, 0.014, 0.22, by + 0.02, -0.445, '#0284c7');
        }
        this.addGardenTree(sub, 0.24, 0.03, 0.33, 0.95, false);
        this.addGardenTree(sub, -0.24, 0.03, -0.33, 0.95, false);
        this.addBeacon(sub, 0, 0.17 + wingH, 0, 0.16);
      } else if (variant === 3) {
        // Archetype 3D: Art-Deco Sandstone & Bronze Skyscraper with Illuminated Setbacks
        const h1S = 0.76;
        const h2S = 0.46 + h3 * 0.2;
        const h3S = 0.32;
        this.addTexBox(sub, 0.78, h1S, 0.78, 0, 0.03, 0, 'curtainWallGold', 4, 4, 4);
        // Stone corner piers
        for (const [px, pz] of [
          [-0.36, -0.36],
          [0.36, -0.36],
          [-0.36, 0.36],
          [0.36, 0.36],
        ]) {
          this.addBox(sub, 0.1, h1S + 0.03, 0.1, px, 0.03, pz, '#d6c7b2');
        }
        this.addBox(sub, 0.81, 0.035, 0.81, 0, 0.03 + h1S, 0, '#fbbf24', '#f59e0b', 0.28);

        this.addTexBox(sub, 0.58, h2S, 0.58, 0, 0.065 + h1S, 0, 'curtainWallGold', 3, 3, 3);
        this.addBox(sub, 0.61, 0.03, 0.61, 0, 0.065 + h1S + h2S, 0, '#fbbf24', '#f59e0b', 0.28);

        this.addTexBox(sub, 0.38, h3S, 0.38, 0, 0.095 + h1S + h2S, 0, 'curtainWallGold', 2, 2, 2);
        const topY = 0.095 + h1S + h2S + h3S;
        this.addHipRoof(sub, 0.38, 0.16, 0.38, 0, topY, 0, 'roofSlate', '#fde68a', 0.02);
        this.addBeacon(sub, 0, topY + 0.16, 0, 0.26);
      } else {
        // Archetype 3E: Cruciform Glass Corporate Tower + Plaza Canopy & HVAC Bank
        const crucH = 1.24 + h3 * 0.26;
        const floors = Math.max(7, Math.round(crucH / 0.16));
        this.addTexBox(sub, 0.78, crucH, 0.44, 0, 0.03, 0, 'curtainWallBlue', 4, floors, 2);
        this.addTexBox(sub, 0.44, crucH, 0.78, 0, 0.03, 0, 'curtainWallBlue', 2, floors, 4);
        this.addBox(sub, 0.36, 0.035, 0.18, 0, 0.19, 0.42, '#0284c7');
        const topY = 0.03 + crucH;
        this.addBox(sub, 0.8, 0.035, 0.46, 0, topY, 0, '#e2e8f0');
        this.addBox(sub, 0.46, 0.035, 0.8, 0, topY, 0, '#e2e8f0');
        this.addBox(sub, 0.26, 0.14, 0.26, 0, topY + 0.035, 0, '#475569');
        this.addBeacon(sub, 0, topY + 0.175, 0, 0.22);
      }
    }

    this.buildingsGroup.add(g);
  }

  // =========================================================================
  // 3. SIX ICONIC OPENTTD MULTI-TILE INDUSTRIES + LIVE ANIMATION
  // =========================================================================

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

    const padW = w - 0.1;
    const padD = h - 0.1;
    const sx = w * 0.5;
    const sz = h * 0.5;

    this.addRetainingFoundation(g, padW + 0.06, padD + 0.06, minCornerY, maxCornerY);

    switch (ind.type) {
      case 'COAL_MINE': {
        // Dark coal-dust yard apron
        this.addBox(g, padW, 0.035, padD, 0, 0, 0, '#27272a');

        // 1. Open-frame Steel Lattice Headframe Tower at (-0.40*sx, +0.28*sz)
        const hx = -0.4 * sx;
        const hz = 0.28 * sz;
        // Concrete shaft collar + pitch-black mine shaft opening
        this.addBox(g, 0.44, 0.07, 0.44, hx, 0.035, hz, '#71717a');
        this.addBox(g, 0.26, 0.075, 0.26, hx, 0.038, hz, '#09090b');

        // 4 angled steel corner girders tapering from base (±0.17) to hoist deck (±0.11) at y=1.08
        const baseOff = 0.17;
        const topOff = 0.11;
        const towerBaseY = 0.09;
        const towerTopY = 1.08;
        const towerH = towerTopY - towerBaseY;
        for (const cx of [-1, 1]) {
          for (const cz of [-1, 1]) {
            const leg = new THREE.Mesh(this.boxGeo, this.getMat('#18181b'));
            leg.scale.set(0.034, towerH * 1.02, 0.034);
            leg.position.set(
              hx + cx * ((baseOff + topOff) * 0.5),
              towerBaseY + towerH * 0.5,
              hz + cz * ((baseOff + topOff) * 0.5)
            );
            leg.rotation.z = cx * 0.06;
            leg.rotation.x = -cz * 0.06;
            this.markShadow(leg, true, true);
            g.add(leg);
          }
        }

        // 3 tiers of horizontal steel cross-girders + diagonal X-brace struts on all 4 faces
        const levels = [0.34, 0.62, 0.88];
        for (let lv = 0; lv < levels.length; lv++) {
          const ly = levels[lv];
          const t = (ly - towerBaseY) / towerH;
          const halfSpan = baseOff * (1 - t) + topOff * t;
          const spanW = halfSpan * 2 + 0.02;
          this.addBox(g, spanW, 0.022, 0.022, hx, ly, hz - halfSpan, '#27272a');
          this.addBox(g, spanW, 0.022, 0.022, hx, ly, hz + halfSpan, '#27272a');
          this.addBox(g, 0.022, 0.022, spanW, hx - halfSpan, ly, hz, '#27272a');
          this.addBox(g, 0.022, 0.022, spanW, hx + halfSpan, ly, hz, '#27272a');

          // Diagonal X-braces inside bay below this level
          const prevY = lv === 0 ? towerBaseY + 0.04 : levels[lv - 1];
          const bayMidY = (prevY + ly) * 0.5;
          const bayH = ly - prevY;
          const diagLen = Math.hypot(spanW, bayH);
          const diagAng = Math.atan2(bayH, spanW);
          for (const sideZ of [-halfSpan, halfSpan]) {
            for (const dir of [-1, 1]) {
              const br = new THREE.Mesh(this.boxGeo, this.getMat('#3f3f46'));
              br.scale.set(diagLen, 0.014, 0.014);
              br.position.set(hx, bayMidY, hz + sideZ);
              br.rotation.z = dir * diagAng;
              g.add(br);
            }
          }
        }

        // Angled raker backstay struts bracing down toward winding-engine house (-Z)
        for (const sideX of [-0.09, 0.09]) {
          const raker = new THREE.Mesh(this.boxGeo, this.getMat('#18181b'));
          raker.scale.set(0.032, 1.08, 0.032);
          raker.position.set(hx + sideX, 0.58, hz - 0.25);
          raker.rotation.x = 0.34;
          this.markShadow(raker, true, true);
          g.add(raker);
        }

        // Elevated hoist deck + red warning safety rails + twin spoked spinning sheave wheels!
        this.addBox(g, 0.36, 0.035, 0.38, hx, towerTopY, hz, '#3f3f46');
        this.addBox(g, 0.38, 0.045, 0.39, hx, towerTopY + 0.035, hz, '#b91c1c');
        for (const [wxOff, dir] of [
          [-0.065, 1],
          [0.065, -1],
        ] as Array<[number, number]>) {
          const wheel = this.createSpokedSheaveWheel(0.135, '#f1f5f9', '#cbd5e1');
          wheel.position.set(hx + wxOff, towerTopY + 0.17, hz);
          g.add(wheel);
          this.spinningWheels.push({
            group: wheel,
            axis: 'x',
            speedRadPerSec: 2.3 * dir,
          });
          // Vertical steel hoist cable descending into shaft + angled cable to winding house
          this.addCyl(g, 0.008, towerTopY + 0.06, hx + wxOff, 0.08, hz + 0.04, '#94a3b8', undefined, true);
          const haulCable = new THREE.Mesh(this.cylLowGeo, this.getMat('#cbd5e1'));
          haulCable.scale.set(0.014, 0.96, 0.014);
          haulCable.position.set(hx + wxOff, 0.82, hz - 0.28);
          haulCable.rotation.x = 0.52;
          g.add(haulCable);
        }

        // 2. Textured Brick Winding-Engine House + Tall Smokestack at (-0.40*sx, -0.38*sz)
        const ex = -0.4 * sx;
        const ez = -0.38 * sz;
        this.addTexBox(g, 0.58, 0.42, 0.52, ex, 0.035, ez, 'factoryBrickArched', 2, 1, 2);
        this.addGableRoof(g, 0.58, 0.16, 0.52, ex, 0.455, ez, 'roofSlate', 'brickRedPlain', '#ffffff', true, 0.035);
        this.addCyl(g, 0.075, 0.96, ex - 0.26, 0.035, ez - 0.2, '#ffffff', 'brickRedPlain');
        this.addCyl(g, 0.09, 0.055, ex - 0.26, 0.99, ez - 0.2, '#18181b');
        this.spawnSmokePlume(g, ex - 0.26, 1.06, ez - 0.2, {
          vapor: false,
          riseHeight: 0.52,
          startScale: 0.06,
          endScale: 0.2,
          speed: 0.36,
        });

        // 3. Inclined Covered Conveyor Bridge -> Elevated Coal Screening/Loading Tipple at (+0.38*sx, -0.26*sz)
        const tx = 0.38 * sx;
        const tz = -0.26 * sz;
        const conv = new THREE.Mesh(
          this.getTiledBoxGeo(3, 1, 1),
          this.getMat('#cbd5e1', undefined, 0, 'corrugatedSteel')
        );
        conv.scale.set(0.76, 0.13, 0.16);
        conv.position.set((hx + tx) * 0.5, 0.42, (hz + tz) * 0.5);
        conv.rotation.y = Math.atan2(hz - tz, tx - hx);
        conv.rotation.z = 0.32;
        this.markShadow(conv, true, true);
        g.add(conv);

        // Steel H-beam support legs + elevated corrugated coal tipple + hopper chutes
        for (const lx of [-0.22, 0.22]) {
          for (const lz of [-0.18, 0.18]) {
            this.addBox(g, 0.04, 0.34, 0.04, tx + lx, 0.035, tz + lz, '#334155');
          }
        }
        this.addTexBox(g, 0.58, 0.38, 0.48, tx, 0.37, tz, 'corrugatedSteel', 2, 2, 2, '#64748b');
        this.addGableRoof(g, 0.58, 0.14, 0.48, tx, 0.75, tz, 'roofCorrugatedDark', null, '#475569', false, 0.03);
        // Coal loading chutes underneath tipple
        for (const cxOff of [-0.12, 0.12]) {
          const chute = new THREE.Mesh(this.coneGeo, this.getMat('#18181b'));
          chute.rotation.x = Math.PI;
          chute.scale.set(0.18, 0.14, 0.18);
          chute.position.set(tx + cxOff, 0.3, tz);
          g.add(chute);
        }

        // 4. Textured Anthracite Coal Stockpiles & Narrow-Gauge Yard Mine Carts at (+0.36*sx, +0.38*sz)
        const coalMounds: Array<[number, number, number, number]> = [
          [0.42 * sx, 0.38 * sz, 0.28, 0.32],
          [0.14 * sx, 0.48 * sz, 0.22, 0.24],
          [0.54 * sx, 0.14 * sz, 0.19, 0.2],
        ];
        const coalMat = this.getMat('#ffffff', undefined, 0, 'coalHeap');
        for (const [mx, mz, mr, mh] of coalMounds) {
          const mound = new THREE.Mesh(this.coneGeo, coalMat);
          mound.scale.set(mr * 2, mh, mr * 2);
          mound.position.set(mx, 0.035 + mh * 0.5, mz);
          this.markShadow(mound, true, true);
          g.add(mound);
        }

        // Narrow-gauge mine rail + 3 coal mine tubs
        this.addBox(g, 0.56, 0.012, 0.016, 0.04, 0.036, 0.68 * sz, '#94a3b8');
        this.addBox(g, 0.56, 0.012, 0.016, 0.04, 0.036, 0.74 * sz, '#94a3b8');
        for (let c = 0; c < 3; c++) {
          const cxCart = -0.14 + c * 0.17;
          const czCart = 0.71 * sz;
          this.addBox(g, 0.11, 0.065, 0.08, cxCart, 0.048, czCart, '#52525b');
          this.addBox(g, 0.09, 0.03, 0.065, cxCart, 0.105, czCart, '#09090b');
        }
        break;
      }

      case 'POWER_PLANT': {
        this.addTexBox(g, padW, 0.038, padD, 0, 0, 0, 'platformPaving', 4, 1, 4, '#94a3b8');

        // 1. Twin Sculpted Hyperboloid Concrete Cooling Towers with Base Air-Intake Struts & Rising Vapor!
        const coolingSpecs = [
          { cx: -0.44 * sx, cz: 0.34 * sz, scaleXZ: 0.74, h: 1.06, vaporEnd: 0.34 },
          { cx: -0.52 * sx, cz: -0.34 * sz, scaleXZ: 0.54, h: 0.82, vaporEnd: 0.25 },
        ];
        for (const ct of coolingSpecs) {
          // Dark water basin & diagonal concrete piloti stilts around air intake
          this.addCyl(g, ct.scaleXZ * 0.52, 0.05, ct.cx, 0.038, ct.cz, '#334155');
          for (let s = 0; s < 8; s++) {
            const ang = (s / 8) * Math.PI * 2;
            const r = ct.scaleXZ * 0.47;
            this.addBox(
              g,
              0.025,
              0.11,
              0.025,
              ct.cx + Math.cos(ang) * r,
              0.06,
              ct.cz + Math.sin(ang) * r,
              '#cbd5e1'
            );
          }
          const shell = new THREE.Mesh(this.hyperboloidGeo, this.getMat('#e2e8f0'));
          shell.scale.set(ct.scaleXZ, ct.h - 0.1, ct.scaleXZ);
          shell.position.set(ct.cx, 0.14, ct.cz);
          this.markShadow(shell, true, true);
          g.add(shell);

          // Red/white warning band + dark hollow throat cap
          const topY = 0.14 + (ct.h - 0.1);
          this.addCyl(g, ct.scaleXZ * 0.38, 0.045, ct.cx, topY - 0.05, ct.cz, '#dc2626');
          this.addCyl(g, ct.scaleXZ * 0.35, 0.025, ct.cx, topY - 0.01, ct.cz, '#1e293b');

          this.spawnSmokePlume(g, ct.cx, topY + 0.04, ct.cz, {
            vapor: true,
            puffCount: 5,
            riseHeight: 0.62,
            startScale: ct.scaleXZ * 0.22,
            endScale: ct.vaporEnd,
            speed: 0.28,
          });
        }

        // 2. Multi-Story Red-Brick Boiler & Turbine Hall with Arched Windows & Glazed Clerestory
        const bx = 0.24 * sx;
        const bz = -0.26 * sz;
        this.addTexBox(g, 0.82, 0.58, 0.62, bx, 0.038, bz, 'factoryBrickArched', 3, 2, 2);
        this.addBox(g, 0.85, 0.04, 0.65, bx, 0.618, bz, '#475569');
        // Roof clerestory monitor with glowing skylight strip
        this.addBox(g, 0.56, 0.11, 0.26, bx, 0.658, bz, '#334155');
        this.addBox(g, 0.54, 0.065, 0.275, bx, 0.68, bz, '#bae6fd', '#38bdf8', 0.3);

        // 3. Tall Red-and-White Striped Flue Chimney + Smoke Plume
        const fx = 0.66 * sx;
        const fz = -0.52 * sz;
        const stackSegs = 6;
        const segH = 0.21;
        for (let s = 0; s < stackSegs; s++) {
          const r = 0.095 - s * 0.005;
          const hex = s >= 3 ? (s % 2 === 1 ? '#dc2626' : '#f8fafc') : '#cbd5e1';
          this.addCyl(g, r, segH, fx, 0.038 + s * segH, fz, hex);
        }
        this.spawnSmokePlume(g, fx, 0.038 + stackSegs * segH + 0.03, fz, {
          vapor: false,
          riseHeight: 0.58,
          startScale: 0.06,
          endScale: 0.22,
          speed: 0.4,
        });

        // 4. Outdoor High-Voltage Transformer Substation Yard at (+0.30*sx, +0.42*sz)
        const subX = 0.3 * sx;
        const subZ = 0.42 * sz;
        this.addBox(g, 0.82, 0.02, 0.54, subX, 0.038, subZ, '#64748b');
        // 3 grey high-voltage transformer units + ceramic insulator bushings
        for (let t = -1; t <= 1; t++) {
          const tx = subX + t * 0.24;
          this.addBox(g, 0.15, 0.16, 0.18, tx, 0.058, subZ + 0.04, '#475569');
          this.addCyl(g, 0.016, 0.09, tx - 0.035, 0.218, subZ + 0.04, '#f8fafc', undefined, true);
          this.addCyl(g, 0.016, 0.09, tx + 0.035, 0.218, subZ + 0.04, '#f8fafc', undefined, true);
        }
        // Steel gantry portals + overhead crossarms + busbars
        for (const gxOff of [-0.34, 0.34]) {
          this.addBox(g, 0.028, 0.38, 0.028, subX + gxOff, 0.058, subZ - 0.16, '#94a3b8');
          this.addBox(g, 0.028, 0.38, 0.028, subX + gxOff, 0.058, subZ + 0.2, '#94a3b8');
          this.addBox(g, 0.032, 0.028, 0.42, subX + gxOff, 0.42, subZ + 0.02, '#cbd5e1');
        }
        this.addBox(g, 0.72, 0.012, 0.012, subX, 0.435, subZ - 0.08, '#e2e8f0');
        this.addBox(g, 0.72, 0.012, 0.012, subX, 0.435, subZ + 0.12, '#e2e8f0');

        // 5. Coal Receiving Stockpile
        const coalPile = new THREE.Mesh(this.coneGeo, this.getMat('#ffffff', undefined, 0, 'coalHeap'));
        coalPile.scale.set(0.4, 0.24, 0.4);
        coalPile.position.set(-0.08 * sx, 0.15, -0.58 * sz);
        this.markShadow(coalPile, true, true);
        g.add(coalPile);
        break;
      }

      case 'FOREST': {
        // Lush forest moss base + cleared sawdust logging landing
        this.addBox(g, padW, 0.03, padD, 0, 0, 0, '#3a5a28');
        this.addBox(g, padW * 0.56, 0.014, padD * 0.64, 0.32 * sx, 0.03, 0.16 * sz, '#785a3a');

        // 1. Multi-Species Spruce / Pine Stand (10 varied trees + fresh tree stumps with pale wood rings)
        const trees: Array<[number, number, number, string, string]> = [
          [-0.68, -0.68, 1.18, '#14532d', '#166534'],
          [-0.32, -0.7, 1.02, '#1b5e20', '#2e7d32'],
          [0.08, -0.68, 1.12, '#14532d', '#15803d'],
          [-0.72, -0.26, 0.96, '#1e4620', '#2d6a4f'],
          [-0.36, -0.3, 1.24, '#14532d', '#1b5e20'],
          [-0.7, 0.18, 1.08, '#1b5e20', '#2e7d32'],
          [-0.38, 0.14, 0.92, '#14532d', '#166534'],
          [-0.68, 0.64, 1.15, '#1b5e20', '#15803d'],
          [-0.3, 0.62, 1.0, '#14532d', '#2e7d32'],
          [-0.04, -0.28, 0.88, '#1b5e20', '#2d6a4f'],
        ];
        for (const [txR, tzR, sc, darkG, midG] of trees) {
          const tx = txR * sx;
          const tz = tzR * sz;
          this.addCyl(g, 0.042 * sc, 0.24 * sc, tx, 0.03, tz, '#5c3a21', undefined, true);
          for (let tierIdx = 0; tierIdx < 3; tierIdx++) {
            const cone = new THREE.Mesh(
              this.coneGeo,
              this.getMat(tierIdx === 0 ? darkG : midG)
            );
            const wCone = (0.4 - tierIdx * 0.085) * sc;
            const hCone = (0.36 - tierIdx * 0.04) * sc;
            cone.scale.set(wCone, hCone, wCone);
            cone.position.set(tx, 0.28 * sc + tierIdx * 0.18 * sc, tz);
            this.markShadow(cone, true, true);
            g.add(cone);
          }
        }
        // Fresh cut stumps with pale wood-ring tops
        for (const [sxSt, szSt] of [
          [-0.04 * sx, 0.18 * sz],
          [0.06 * sx, 0.56 * sz],
          [0.18 * sx, -0.18 * sz],
        ]) {
          this.addCyl(g, 0.042, 0.055, sxSt, 0.03, szSt, '#5c3a21', undefined, true);
          this.addCyl(g, 0.038, 0.008, sxSt, 0.085, szSt, '#fde68a', undefined, true);
        }

        // 2. Log-Bunk Racks Holding Dozens of Round Barked Cylindrical Logs with Pale Wood-Ring Ends!
        const bunkZ = 0.42 * sz;
        const bunkX = 0.44 * sx;
        // Steel U-bunk stakes
        for (const zStake of [bunkZ - 0.26, bunkZ + 0.26]) {
          this.addBox(g, 0.03, 0.24, 0.03, bunkX - 0.22, 0.044, zStake, '#dc2626');
          this.addBox(g, 0.03, 0.24, 0.03, bunkX + 0.22, 0.044, zStake, '#dc2626');
        }
        const logR = 0.038;
        for (let row = 0; row < 4; row++) {
          const cols = 5 - row;
          for (let c = 0; c < cols; c++) {
            const lx = bunkX + (c - (cols - 1) * 0.5) * (logR * 2.04);
            const ly = 0.082 + row * (logR * 1.76);
            this.addBarkLog(
              g,
              lx,
              ly,
              bunkZ,
              logR,
              0.62,
              false,
              (row + c) % 2 === 0 ? '#6b4226' : '#56331b'
            );
          }
        }

        // 3. Yellow Hydraulic Log-Loader Crane (Tracked Base + Cab + Articulated Boom + Grapple + Log)
        const cx = 0.16 * sx;
        const cz = 0.08 * sz;
        this.addBox(g, 0.24, 0.055, 0.19, cx, 0.044, cz, '#1e293b'); // Tracks
        this.addBox(g, 0.19, 0.13, 0.16, cx, 0.099, cz, '#eab308'); // Yellow engine/cab body
        this.addBox(g, 0.09, 0.09, 0.08, cx - 0.03, 0.13, cz + 0.03, '#0f172a'); // Glazed cab
        const boom1 = new THREE.Mesh(this.boxGeo, this.getMat('#facc15'));
        boom1.scale.set(0.32, 0.04, 0.04);
        boom1.position.set(cx + 0.11, 0.3, cz + 0.06);
        boom1.rotation.z = 0.68;
        boom1.rotation.y = -0.35;
        this.markShadow(boom1, true, false);
        g.add(boom1);
        const boom2 = new THREE.Mesh(this.boxGeo, this.getMat('#eab308'));
        boom2.scale.set(0.24, 0.034, 0.034);
        boom2.position.set(cx + 0.25, 0.34, cz + 0.16);
        boom2.rotation.z = -0.52;
        boom2.rotation.y = -0.35;
        g.add(boom2);
        // Grapple + suspended barked log
        this.addBox(g, 0.05, 0.07, 0.05, cx + 0.32, 0.22, cz + 0.22, '#334155');
        this.addBarkLog(g, cx + 0.32, 0.19, cz + 0.22, 0.034, 0.44, false, '#6b4226');

        // 4. Timber Forester Cabin with Ashlar Stone Chimney & Covered Lumber Stack
        const cabX = 0.48 * sx;
        const cabZ = -0.46 * sz;
        this.addTexBox(g, 0.48, 0.24, 0.4, cabX, 0.03, cabZ, 'timberRorosRed', 2, 1, 1);
        this.addGableRoof(g, 0.48, 0.16, 0.4, cabX, 0.27, cabZ, 'roofSlate', 'timberRorosRed', '#ffffff', false, 0.045);
        this.addTexBox(g, 0.085, 0.38, 0.085, cabX + 0.2, 0.03, cabZ - 0.1, 'ashlarStone', 1, 2, 1);
        break;
      }

      case 'SAWMILL': {
        this.addTexBox(g, padW, 0.038, padD, 0, 0, 0, 'platformPaving', 4, 1, 4, '#a8a29e');

        // 1. Brick & Timber Mill Hall with 4 Angled Sawtooth Skylight Roof Bays!
        const mx = -0.22 * sx;
        const mz = -0.22 * sz;
        const mw = 1.02 * sx;
        const md = 0.84 * sz;
        this.addTexBox(g, mw, 0.38, md, mx, 0.038, mz, 'factoryBrickArched', 3, 1, 2);

        const bays = 4;
        const bayW = mw / bays;
        for (let b = 0; b < bays; b++) {
          const bx = mx - mw * 0.5 + (b + 0.5) * bayW;
          // Angled slate south roof slope
          const slope = new THREE.Mesh(
            this.getTiledBoxGeo(1, 1, 2),
            this.getMat('#ffffff', undefined, 0, 'roofSlate')
          );
          slope.scale.set(bayW * 1.06, 0.032, md + 0.04);
          slope.position.set(bx - bayW * 0.08, 0.49, mz);
          slope.rotation.z = 0.52;
          this.markShadow(slope, true, true);
          g.add(slope);

          // Glazed north-facing skylight clerestory face!
          this.addBox(
            g,
            0.028,
            0.13,
            md - 0.02,
            bx + bayW * 0.38,
            0.418,
            mz,
            '#bae6fd',
            '#38bdf8',
            0.32
          );
        }

        // 2. Tall Tapered Brick Smokestack with Rising Smoke + Sawdust Cyclone Silo
        const stX = -0.68 * sx;
        const stZ = 0.46 * sz;
        this.addBox(g, 0.18, 0.18, 0.18, stX, 0.038, stZ, '#57534e');
        this.addCyl(g, 0.082, 0.98, stX, 0.218, stZ, '#ffffff', 'brickRedPlain');
        this.addCyl(g, 0.098, 0.05, stX, 1.18, stZ, '#1e293b');
        this.spawnSmokePlume(g, stX, 1.25, stZ, {
          vapor: false,
          riseHeight: 0.55,
          startScale: 0.06,
          endScale: 0.21,
          speed: 0.35,
        });
        // Golden sawdust heap + cyclone collector
        const dust = new THREE.Mesh(this.coneGeo, this.getMat('#fde047'));
        dust.scale.set(0.34, 0.2, 0.34);
        dust.position.set(-0.28 * sx, 0.138, 0.54 * sz);
        g.add(dust);

        // 3. Log-Infeed Ramp & Debarker Trough Feeding Logs into Mill
        const ramp = new THREE.Mesh(this.boxGeo, this.getMat('#475569'));
        ramp.scale.set(0.56, 0.04, 0.2);
        ramp.position.set(0.52 * sx, 0.15, -0.34 * sz);
        ramp.rotation.z = 0.26;
        g.add(ramp);
        for (let k = 0; k < 3; k++) {
          this.addBarkLog(g, (0.38 + k * 0.14) * sx, 0.21 - k * 0.03, -0.34 * sz, 0.035, 0.18, false);
        }

        // 4. Yellow Steel Gantry Crane Straddling Banded Stacks of Golden Sawn Planks!
        const yardX = 0.36 * sx;
        const yardZ = 0.38 * sz;
        // 4 banded plank stacks
        const plankSpecs: Array<[number, number, string]> = [
          [-0.18, -0.14, '#facc15'],
          [0.18, -0.14, '#eab308'],
          [-0.18, 0.14, '#fde047'],
          [0.18, 0.14, '#eab308'],
        ];
        for (const [px, pz, pHex] of plankSpecs) {
          this.addBox(g, 0.28, 0.13, 0.18, yardX + px, 0.038, yardZ + pz, pHex);
          // Dark steel strapping bands around lumber bundle
          this.addBox(g, 0.018, 0.134, 0.186, yardX + px - 0.07, 0.038, yardZ + pz, '#1e293b');
          this.addBox(g, 0.018, 0.134, 0.186, yardX + px + 0.07, 0.038, yardZ + pz, '#1e293b');
        }
        // Overhead yellow portal gantry crane straddling the plank yard
        for (const gxOff of [-0.36, 0.36]) {
          for (const gzOff of [-0.28, 0.28]) {
            this.addBox(g, 0.032, 0.42, 0.032, yardX + gxOff, 0.038, yardZ + gzOff, '#eab308');
          }
          this.addBox(g, 0.036, 0.036, 0.6, yardX + gxOff, 0.44, yardZ, '#eab308');
        }
        this.addBox(g, 0.78, 0.05, 0.06, yardX, 0.46, yardZ + 0.04, '#f59e0b');
        this.addBox(g, 0.1, 0.06, 0.1, yardX + 0.08, 0.41, yardZ + 0.04, '#1e293b'); // Hoist trolley

        // 5. Open-Sided Timber Drying Shed
        const shedX = 0.58 * sx;
        const shedZ = -0.68 * sz;
        this.addBox(g, 0.42, 0.11, 0.22, shedX, 0.038, shedZ, '#fde047');
        this.addGableRoof(g, 0.48, 0.09, 0.28, shedX, 0.22, shedZ, 'roofCorrugatedDark', null, '#64748b', false, 0.02);
        for (const lx of [-0.2, 0.2]) {
          for (const lz of [-0.1, 0.1]) {
            this.addBox(g, 0.024, 0.19, 0.024, shedX + lx, 0.038, shedZ + lz, '#78350f');
          }
        }
        break;
      }

      case 'FARM': {
        // Rich farmstead soil & gravel courtyard
        this.addBox(g, padW, 0.03, padD, 0, 0, 0, '#5c4328');

        // 1. Classic Red Timber Gambrel-Roofed Barn with White X-Braced Hayloft Doors!
        const bx = -0.4 * sx;
        const bz = -0.34 * sz;
        this.addBox(g, 0.68, 0.05, 0.54, bx, 0.03, bz, '#64748b'); // Stone plinth
        this.addTexBox(g, 0.64, 0.34, 0.5, bx, 0.08, bz, 'timberBarnRed', 2, 1, 2);
        const gambrel = new THREE.Mesh(
          this.gambrelRoofGeo,
          this.getMat('#ffffff', undefined, 0, 'roofSlate')
        );
        gambrel.scale.set(0.7, 0.28, 0.56);
        gambrel.position.set(bx, 0.42, bz);
        this.markShadow(gambrel, true, true);
        g.add(gambrel);
        // Rooftop barn cupola + white X-braced ground & hayloft doors!
        this.addBox(g, 0.12, 0.09, 0.12, bx, 0.69, bz, '#f8fafc');
        this.addHipRoof(g, 0.13, 0.06, 0.13, bx, 0.78, bz, 'roofSlate', '#f8fafc', 0.015);

        // Ground double barn doors + white X-braces
        const doorZ = bz + 0.256;
        this.addBox(g, 0.24, 0.22, 0.018, bx, 0.08, doorZ, '#991b1b');
        this.addBox(g, 0.26, 0.018, 0.022, bx, 0.29, doorZ, '#f8fafc');
        for (const dir of [-1, 1]) {
          const xBrace = new THREE.Mesh(this.boxGeo, this.getMat('#f8fafc'));
          xBrace.scale.set(0.28, 0.018, 0.024);
          xBrace.position.set(bx, 0.19, doorZ + 0.004);
          xBrace.rotation.z = dir * 0.72;
          g.add(xBrace);
        }
        // Upper hayloft door + hay hoist beam
        this.addBox(g, 0.14, 0.14, 0.02, bx, 0.45, bz + 0.282, '#7f1d1d');
        this.addBox(g, 0.16, 0.016, 0.024, bx, 0.59, bz + 0.284, '#f8fafc');
        this.addBox(g, 0.024, 0.024, 0.12, bx, 0.63, bz + 0.32, '#f8fafc');

        // 2. Twin Corrugated Galvanized Grain Silos with Bucket-Elevator Tower & Auger Pipe!
        const s1x = 0.14 * sx;
        const s2x = 0.46 * sx;
        const szSilo = -0.46 * sz;
        for (const sxPos of [s1x, s2x]) {
          this.addCyl(g, 0.145, 0.68, sxPos, 0.03, szSilo, '#ffffff', 'siloGalvanized');
          const dome = new THREE.Mesh(this.coneGeo, this.getMat('#cbd5e1'));
          dome.scale.set(0.3, 0.14, 0.3);
          dome.position.set(sxPos, 0.78, szSilo);
          this.markShadow(dome, true, true);
          g.add(dome);
        }
        // Bucket-elevator leg tower + overhead catwalk + truck grain auger pipe
        const midSiloX = (s1x + s2x) * 0.5;
        this.addBox(g, 0.07, 0.92, 0.07, midSiloX, 0.03, szSilo - 0.14, '#94a3b8');
        this.addBox(g, 0.42, 0.035, 0.06, midSiloX, 0.86, szSilo - 0.06, '#cbd5e1');
        const auger = new THREE.Mesh(this.cylLowGeo, this.getMat('#e2e8f0'));
        auger.scale.set(0.032, 0.44, 0.032);
        auger.position.set(s2x + 0.14, 0.52, szSilo + 0.16);
        auger.rotation.z = 0.65;
        auger.rotation.x = 0.4;
        g.add(auger);

        // 3. White Sørlandet/Norwegian Farmhouse
        this.addTexBox(g, 0.38, 0.22, 0.34, 0.56 * sx, 0.03, -0.02 * sz, 'timberCoastalWhite', 2, 1, 1);
        this.addGableRoof(g, 0.38, 0.15, 0.34, 0.56 * sx, 0.25, -0.02 * sz, 'roofTerracotta', 'timberCoastalWhite', '#ffffff', false, 0.035);
        this.addChimney(g, 0.64 * sx, 0.26, -0.08 * sz, 0.14, false);

        // 4. Wooden Post-and-Rail Paddock with Golden Round Hay Bales
        const padX = -0.46 * sx;
        const padZ = 0.34 * sz;
        this.addBox(g, 0.72, 0.015, 0.52, padX, 0.03, padZ, '#4d7c0f');
        this.addBox(g, 0.72, 0.02, 0.02, padX, 0.09, padZ - 0.25, '#a16207');
        this.addBox(g, 0.72, 0.02, 0.02, padX, 0.09, padZ + 0.25, '#a16207');
        this.addBox(g, 0.02, 0.02, 0.52, padX - 0.35, 0.09, padZ, '#a16207');
        this.addBox(g, 0.02, 0.02, 0.52, padX + 0.35, 0.09, padZ, '#a16207');
        for (const [hbx, hbz] of [
          [-0.16, -0.08],
          [0.12, 0.09],
          [-0.12, 0.13],
        ]) {
          const bale = new THREE.Mesh(this.cylLowGeo, this.getMat('#eab308'));
          bale.rotation.z = Math.PI / 2;
          bale.scale.set(0.11, 0.13, 0.11);
          bale.position.set(padX + hbx, 0.095, padZ + hbz);
          this.markShadow(bale, true, true);
          g.add(bale);
        }

        // 5. Red Farm Tractor with Big Rear Wheels + Lush Golden Grain Rows!
        const trX = 0.06 * sx;
        const trZ = 0.1 * sz;
        this.addBox(g, 0.19, 0.075, 0.1, trX, 0.065, trZ, '#dc2626'); // Hood
        this.addBox(g, 0.09, 0.095, 0.1, trX - 0.04, 0.14, trZ, '#bae6fd'); // Cab
        this.addBox(g, 0.1, 0.018, 0.11, trX - 0.04, 0.235, trZ, '#f8fafc'); // Cab roof
        this.addCyl(g, 0.01, 0.08, trX + 0.05, 0.14, trZ - 0.03, '#18181b', undefined, true); // Exhaust
        // Big rear wheels + smaller front wheels
        for (const wzOff of [-0.065, 0.065]) {
          const rw = new THREE.Mesh(this.cylLowGeo, this.getMat('#18181b'));
          rw.rotation.x = Math.PI / 2;
          rw.scale.set(0.12, 0.035, 0.12);
          rw.position.set(trX - 0.05, 0.09, trZ + wzOff);
          g.add(rw);
          const fw = new THREE.Mesh(this.cylLowGeo, this.getMat('#18181b'));
          fw.rotation.x = Math.PI / 2;
          fw.scale.set(0.075, 0.028, 0.075);
          fw.position.set(trX + 0.07, 0.068, trZ + wzOff);
          g.add(fw);
        }

        // Golden grain crop rows
        for (let r = 0; r < 5; r++) {
          this.addBox(
            g,
            0.84 * sx,
            0.095,
            0.085,
            0.42 * sx,
            0.03,
            (0.24 + r * 0.13) * sz,
            r % 2 === 0 ? '#eab308' : '#ca8a04'
          );
        }
        break;
      }

      case 'FOOD_PLANT': {
        this.addTexBox(g, padW, 0.038, padD, 0, 0, 0, 'platformPaving', 4, 1, 4, '#cbd5e1');

        // 1. Four Gleaming Stainless-Steel Silos with Overhead Catwalk & Piping Bridges!
        const siloX = -0.58 * sx;
        for (let k = 0; k < 4; k++) {
          const szK = (-0.54 + k * 0.36) * sz;
          this.addCyl(g, 0.13, 0.64, siloX, 0.038, szK, '#f8fafc', 'siloGalvanized');
          const cap = new THREE.Mesh(this.coneGeo, this.getMat('#e2e8f0'));
          cap.scale.set(0.27, 0.09, 0.27);
          cap.position.set(siloX, 0.72, szK);
          g.add(cap);
          this.addCyl(g, 0.135, 0.025, siloX, 0.67, szK, '#0284c7');
        }
        // Overhead stainless catwalk + twin horizontal process pipes into main hall
        this.addBox(g, 0.08, 0.03, 1.24 * sz, siloX, 0.74, 0, '#94a3b8');
        this.addBox(g, 0.38, 0.026, 0.03, -0.34 * sx, 0.58, -0.22 * sz, '#e2e8f0');
        this.addBox(g, 0.38, 0.026, 0.03, -0.34 * sx, 0.52, 0.18 * sz, '#e2e8f0');

        // 2. Multi-Bay White Hygienic Processing Halls with Blue Fascia Trim & Rooftop Condensers
        this.addTexBox(g, 0.96 * sx, 0.48, 0.78 * sz, 0.18 * sx, 0.038, -0.28 * sz, 'corrugatedSteel', 4, 2, 3, '#f8fafc');
        this.addBox(g, 0.99 * sx, 0.065, 0.81 * sz, 0.18 * sx, 0.47, -0.28 * sz, '#0284c7');
        // Ribbon cleanroom windows
        this.addBox(g, 0.86 * sx, 0.075, 0.8 * sz, 0.18 * sx, 0.28, -0.28 * sz, '#bae6fd', '#38bdf8', 0.22);

        // Adjoining cold-storage wing
        this.addTexBox(g, 0.58 * sx, 0.36, 0.52 * sz, 0.46 * sx, 0.038, 0.34 * sz, 'corrugatedSteel', 2, 1, 2, '#f1f5f9');
        this.addBox(g, 0.6 * sx, 0.05, 0.54 * sz, 0.46 * sx, 0.37, 0.34 * sz, '#0ea5e9');

        // Rooftop condensers + clean white cooking-steam vent plume
        for (let c = 0; c < 3; c++) {
          const cxCond = (-0.06 + c * 0.24) * sx;
          this.addBox(g, 0.16, 0.1, 0.18, cxCond, 0.535, -0.3 * sz, '#cbd5e1');
          this.addCyl(g, 0.055, 0.02, cxCond, 0.635, -0.3 * sz, '#1e293b');
        }
        this.addCyl(g, 0.04, 0.24, 0.52 * sx, 0.535, -0.44 * sz, '#e2e8f0');
        this.spawnSmokePlume(g, 0.52 * sx, 0.79, -0.44 * sz, {
          vapor: true,
          puffCount: 4,
          riseHeight: 0.42,
          startScale: 0.05,
          endScale: 0.16,
          speed: 0.32,
        });

        // 3. Recessed Truck Loading Docks with Rollup Doors & Dock Canopies
        for (let d = 0; d < 3; d++) {
          const dx = (-0.1 + d * 0.22) * sx;
          const dz = 0.115 * sz;
          this.addBox(g, 0.14, 0.21, 0.03, dx, 0.055, dz, '#64748b'); // Rollup shutter
          this.addBox(g, 0.16, 0.028, 0.09, dx, 0.27, dz + 0.03, '#0284c7'); // Canopy
          this.addBox(g, 0.025, 0.06, 0.03, dx - 0.075, 0.04, dz + 0.02, '#0f172a'); // Bumper
          this.addBox(g, 0.025, 0.06, 0.03, dx + 0.075, 0.04, dz + 0.02, '#0f172a');
        }

        // 4. Palletized Food Crates in Logistics Yard
        const crateColors = ['#f59e0b', '#ef4444', '#22c55e', '#38bdf8'];
        for (let p = 0; p < 4; p++) {
          const px = (-0.22 + p * 0.16) * sx;
          const pz = 0.58 * sz;
          this.addBox(g, 0.11, 0.02, 0.11, px, 0.038, pz, '#92400e'); // Wooden Euro-pallet
          this.addBox(g, 0.095, 0.085, 0.095, px, 0.058, pz, crateColors[p % crateColors.length]);
        }
        break;
      }
    }

    this.buildingsGroup.add(g);
  }

  // =========================================================================
  // 4. STATIONS (WITH DYNAMIC WAITING PASSENGERS & CARGO!), DEPOTS, SIGNALS & 5 HQ TIERS
  // =========================================================================

  private addPassengerFigure(
    parent: THREE.Object3D,
    x: number,
    yBottom: number,
    z: number,
    coatHex: string
  ): void {
    // Tiny OpenTTD waiting passenger figure (~0.095m tall in tile units)
    this.addBox(parent, 0.024, 0.036, 0.02, x, yBottom, z, '#1e293b'); // Legs
    this.addBox(parent, 0.03, 0.036, 0.024, x, yBottom + 0.036, z, coatHex); // Jacket
    const head = new THREE.Mesh(this.sphereGeo, this.getMat('#fed7aa'));
    head.scale.set(0.024, 0.024, 0.024);
    head.position.set(x, yBottom + 0.084, z);
    parent.add(head);
  }

  /**
   * Renders authentic OpenTTD dynamic waiting passengers & freight cargo along a platform strip!
   */
  private populateWaitingCargo(
    parent: THREE.Object3D,
    waiting: Record<CargoType, number> | undefined,
    xMin: number,
    xMax: number,
    ySurface: number,
    zCenter: number,
    zHalfSpread: number,
    tileIndex = 0,
    totalTiles = 1
  ): void {
    if (!waiting) return;

    const coatPalette = [
      '#ef4444',
      '#3b82f6',
      '#10b981',
      '#f59e0b',
      '#8b5cf6',
      '#ec4899',
      '#06b6d4',
    ];

    // 1. Waiting Passengers (tiny colorful figures distributed across all platform tiles)
    const paxTotal = Math.max(0, Math.round(waiting.PASSENGERS || 0));
    if (paxTotal > 0) {
      const maxTotalFigures = Math.min(40, Math.max(18, totalTiles * 3));
      const totalFigures = Math.min(maxTotalFigures, Math.max(1, Math.ceil(paxTotal / 7)));
      const myFigures = Math.floor(totalFigures / totalTiles) + (tileIndex < totalFigures % totalTiles ? 1 : 0);
      for (let p = 0; p < myFigures; p++) {
        const seed = p * 7 + tileIndex * 13;
        const t = myFigures === 1 ? 0.5 : p / (myFigures - 1);
        const px = xMin + (xMax - xMin) * (0.08 + 0.84 * t);
        const pz = zCenter + (detHash(seed, tileIndex, 91) - 0.5) * 2 * zHalfSpread;
        const coat = coatPalette[(seed + tileIndex) % coatPalette.length];
        this.addPassengerFigure(parent, px, ySurface, pz, coat);
      }
    }

    // 2. Waiting Freight / Mail Cargo Piles
    const freightTypes: CargoType[] = ['MAIL', 'COAL', 'WOOD', 'GRAIN', 'FOOD', 'GOODS'];
    let slotIdx = 0;
    const maxSlotsPerTile = 5;

    for (const cType of freightTypes) {
      const amt = Math.max(0, Math.round(waiting[cType] || 0));
      if (amt <= 0) continue;
      const maxTotalPiles = Math.min(28, Math.max(8, totalTiles * 2));
      const totalPiles = Math.min(maxTotalPiles, Math.max(1, Math.ceil(amt / 14)));
      const myPiles = Math.floor(totalPiles / totalTiles) + (tileIndex < totalPiles % totalTiles ? 1 : 0);

      for (let k = 0; k < myPiles && slotIdx < maxSlotsPerTile; k++) {
        const frac = (slotIdx + 0.5) / maxSlotsPerTile;
        const cx = xMin + (xMax - xMin) * frac;
        const cz = zCenter;
        slotIdx++;

        if (cType === 'MAIL') {
          // Plump yellow/red Posten mailbags
          const bag1 = new THREE.Mesh(this.sphereGeo, this.getMat('#facc15'));
          bag1.scale.set(0.065, 0.055, 0.055);
          bag1.position.set(cx - 0.02, ySurface + 0.026, cz);
          const bag2 = new THREE.Mesh(this.sphereGeo, this.getMat('#dc2626'));
          bag2.scale.set(0.06, 0.052, 0.052);
          bag2.position.set(cx + 0.022, ySurface + 0.025, cz + 0.012);
          parent.add(bag1, bag2);
        } else if (cType === 'COAL') {
          // Dark tarped coal bin + anthracite mound
          this.addBox(parent, 0.095, 0.05, 0.085, cx, ySurface, cz, '#3f3f46');
          const heap = new THREE.Mesh(this.coneGeo, this.getMat('#ffffff', undefined, 0, 'coalHeap'));
          heap.scale.set(0.085, 0.055, 0.085);
          heap.position.set(cx, ySurface + 0.065, cz);
          parent.add(heap);
        } else if (cType === 'WOOD') {
          // Mini stacked logs with pale cut ends
          this.addBarkLog(parent, cx, ySurface + 0.022, cz - 0.02, 0.02, 0.12, true);
          this.addBarkLog(parent, cx, ySurface + 0.022, cz + 0.02, 0.02, 0.12, true);
          this.addBarkLog(parent, cx, ySurface + 0.056, cz, 0.02, 0.12, true);
        } else if (cType === 'GRAIN') {
          // Pyramid of burlap grain sacks
          this.addBox(parent, 0.09, 0.04, 0.065, cx, ySurface, cz, '#d6b37c');
          this.addBox(parent, 0.075, 0.036, 0.055, cx, ySurface + 0.04, cz, '#c29b61');
        } else if (cType === 'FOOD') {
          // Pallet + white/blue chilled food cartons
          this.addBox(parent, 0.095, 0.015, 0.085, cx, ySurface, cz, '#92400e');
          this.addBox(parent, 0.085, 0.065, 0.075, cx, ySurface + 0.015, cz, '#f8fafc');
          this.addBox(parent, 0.088, 0.018, 0.078, cx, ySurface + 0.045, cz, '#0284c7');
        } else {
          // GOODS: Stacked wooden shipping crates
          this.addBox(parent, 0.09, 0.07, 0.085, cx, ySurface, cz, '#d97706');
          this.addBox(parent, 0.065, 0.055, 0.065, cx + 0.01, ySurface + 0.07, cz, '#b45309');
        }
      }
    }
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

    this.addRetainingFoundation(g, 0.9, 0.9, corners.minY, corners.maxY);

    const sub = new THREE.Group();
    sub.rotation.y = rotY;
    g.add(sub);

    if (depotType === 'RAIL') {
      // Ballast apron + twin gleaming steel rails entering the brick engine shed
      this.addBox(sub, 0.86, 0.028, 0.9, 0, 0, 0, '#57534e');
      this.addBox(sub, 0.022, 0.018, 0.88, -0.11, 0.028, 0.02, '#cbd5e1');
      this.addBox(sub, 0.022, 0.018, 0.88, 0.11, 0.028, 0.02, '#cbd5e1');

      // Classic OpenTTD Brick Engine Shed with Arched Side Windows
      this.addTexBox(sub, 0.74, 0.4, 0.78, 0, 0.028, -0.04, 'factoryBrickArched', 1, 1, 2);
      // Company-colored fascia trim band + gable roof + rooftop louver vents & cast-iron smoke jack!
      this.addBox(sub, 0.76, 0.055, 0.8, 0, 0.375, -0.04, ownerColor);
      this.addGableRoof(
        sub,
        0.74,
        0.19,
        0.78,
        0,
        0.43,
        -0.04,
        'roofCorrugatedDark',
        'brickRedPlain',
        '#ffffff',
        true,
        0.045,
        ownerColor
      );

      // Rooftop ventilation monitor + smoke jack pipe
      this.addBox(sub, 0.16, 0.07, 0.34, 0, 0.59, -0.08, '#334155');
      this.addCyl(sub, 0.036, 0.15, 0, 0.58, 0.18, '#1e293b');
      this.addCyl(sub, 0.05, 0.025, 0, 0.72, 0.18, '#334155');

      // Recessed dark locomotive portal + brick piers + company header sign
      this.addBox(sub, 0.44, 0.31, 0.06, 0, 0.03, 0.33, '#09090b');
      this.addBox(sub, 0.07, 0.35, 0.05, -0.24, 0.028, 0.35, '#cbd5e1');
      this.addBox(sub, 0.07, 0.35, 0.05, 0.24, 0.028, 0.35, '#cbd5e1');
      this.addBox(sub, 0.52, 0.045, 0.055, 0, 0.34, 0.355, ownerColor);
    } else {
      // Asphalt forecourt + yellow bay lane guide markings
      this.addBox(sub, 0.88, 0.028, 0.88, 0, 0, 0, '#334155');
      this.addBox(sub, 0.02, 0.008, 0.24, -0.2, 0.028, 0.31, '#facc15');
      this.addBox(sub, 0.02, 0.008, 0.24, 0.2, 0.028, 0.31, '#facc15');

      // Commercial Vehicle Garage with Multi-Pane Workshop Windows & Corrugated Roof
      this.addTexBox(sub, 0.76, 0.35, 0.68, 0, 0.028, -0.06, 'brickOchreWindow', 2, 1, 2);
      this.addBox(sub, 0.8, 0.065, 0.72, 0, 0.378, -0.06, ownerColor);
      this.addGableRoof(
        sub,
        0.76,
        0.12,
        0.68,
        0,
        0.443,
        -0.06,
        'roofCorrugatedDark',
        null,
        ownerColor,
        true,
        0.04,
        '#e2e8f0'
      );

      // Wide recessed dark garage bay + partially raised corrugated steel roller shutter
      this.addBox(sub, 0.5, 0.28, 0.06, 0, 0.028, 0.26, '#0f172a');
      this.addTexBox(sub, 0.48, 0.07, 0.03, 0, 0.24, 0.28, 'corrugatedSteel', 2, 1, 1, '#cbd5e1');
      // Rooftop HVAC vent + forecourt diesel fuel pump
      this.addBox(sub, 0.16, 0.065, 0.16, -0.16, 0.54, -0.1, '#94a3b8');
      this.addBox(sub, 0.055, 0.11, 0.045, 0.33, 0.028, 0.28, ownerColor);
    }

    this.buildingsGroup.add(g);
  }

  private resolveTrainStationLayout(
    station: Station,
    state: GameState
  ): {
    axis: 'X' | 'Y';
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    platformLength: number;
    tracks: number;
    centerX: number;
    centerZ: number;
    minCornerY: number;
    maxCornerY: number;
  } {
    const tiles =
      station.tiles && station.tiles.length > 0
        ? station.tiles
        : [{ x: station.x, y: station.y }];

    let minX = tiles[0].x;
    let maxX = tiles[0].x;
    let minY = tiles[0].y;
    let maxY = tiles[0].y;
    let tileAxisHint: 'X' | 'Y' | null = null;

    for (let i = 0; i < tiles.length; i++) {
      const tx = tiles[i].x;
      const ty = tiles[i].y;
      if (tx < minX) minX = tx;
      if (tx > maxX) maxX = tx;
      if (ty < minY) minY = ty;
      if (ty > maxY) maxY = ty;
      if (!tileAxisHint) {
        const mapTile = getTileAt(state, tx, ty);
        if (mapTile?.stationAxis === 'X' || mapTile?.stationAxis === 'Y') {
          tileAxisHint = mapTile.stationAxis;
        }
      }
    }

    const rawSpanX = maxX - minX + 1;
    const rawSpanY = maxY - minY + 1;

    let axis: 'X' | 'Y' = 'X';
    if (station.orientation === 'X' || station.orientation === 'Y') {
      axis = station.orientation;
    } else if (tileAxisHint) {
      axis = tileAxisHint;
    } else if (rawSpanX > rawSpanY) {
      axis = 'X';
    } else if (rawSpanY > rawSpanX) {
      axis = 'Y';
    } else {
      const nN = getTileAt(state, minX, minY - 1);
      const nS = getTileAt(state, minX, maxY + 1);
      const nW = getTileAt(state, minX - 1, minY);
      const nE = getTileAt(state, maxX + 1, minY);
      if ((nN?.rail || nS?.rail) && !(nW?.rail || nE?.rail)) {
        axis = 'Y';
      }
    }

    const spanAlong = axis === 'X' ? rawSpanX : rawSpanY;
    const spanAcross = axis === 'X' ? rawSpanY : rawSpanX;

    const platformLength = Math.max(
      1,
      Math.min(6, Math.max(spanAlong, Math.round(station.platformLength ?? spanAlong)))
    );
    const tracks = Math.max(
      1,
      Math.min(4, Math.max(spanAcross, Math.round(station.tracks ?? spanAcross)))
    );

    if (axis === 'X') {
      maxX = Math.max(maxX, minX + platformLength - 1);
      maxY = Math.max(maxY, minY + tracks - 1);
    } else {
      maxX = Math.max(maxX, minX + tracks - 1);
      maxY = Math.max(maxY, minY + platformLength - 1);
    }

    let minCornerY = Infinity;
    let maxCornerY = -Infinity;
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const c = getTileCornerHeights(state, tx, ty);
        if (c.minY < minCornerY) minCornerY = c.minY;
        if (c.maxY > maxCornerY) maxCornerY = c.maxY;
      }
    }
    if (!Number.isFinite(minCornerY) || !Number.isFinite(maxCornerY)) {
      const c0 = getTileCornerHeights(state, minX, minY);
      minCornerY = c0.minY;
      maxCornerY = c0.maxY;
    }

    return {
      axis,
      minX,
      maxX,
      minY,
      maxY,
      platformLength,
      tracks,
      centerX: (minX + maxX) * 0.5,
      centerZ: (minY + maxY) * 0.5,
      minCornerY,
      maxCornerY,
    };
  }

  private addStationNameboard(
    parent: THREE.Object3D,
    lx: number,
    ySurface: number,
    lz: number,
    ownerColor: string,
    width = 0.22
  ): void {
    const postOff = width * 0.36;
    this.addBox(parent, 0.014, 0.085, 0.014, lx - postOff, ySurface, lz, '#cbd5e1');
    this.addBox(parent, 0.014, 0.085, 0.014, lx + postOff, ySurface, lz, '#cbd5e1');
    this.addBox(parent, width, 0.052, 0.024, lx, ySurface + 0.072, lz, ownerColor);
    this.addBox(parent, width - 0.024, 0.028, 0.028, lx, ySurface + 0.084, lz, '#f8fafc');
  }

  private addPlatformLamp(
    parent: THREE.Object3D,
    lx: number,
    ySurface: number,
    lz: number
  ): void {
    this.addCyl(parent, 0.01, 0.19, lx, ySurface, lz, '#1e293b', undefined, true);
    const lampOrb = new THREE.Mesh(
      this.sphereGeo,
      this.getMat('#fef08a', '#facc15', 0.55)
    );
    lampOrb.scale.set(0.042, 0.042, 0.042);
    lampOrb.position.set(lx, ySurface + 0.2, lz);
    parent.add(lampOrb);
  }

  private addStationClockDial(
    parent: THREE.Object3D,
    lx: number,
    ly: number,
    lz: number,
    radius: number,
    faceDirZ: 1 | -1
  ): void {
    const dial = new THREE.Mesh(
      this.cylLowGeo,
      this.getMat('#fefce8', '#fde047', 0.45)
    );
    dial.rotation.x = Math.PI / 2;
    dial.scale.set(radius * 2, 0.018, radius * 2);
    dial.position.set(lx, ly, lz);
    parent.add(dial);

    // Crisp dark minute & hour hands
    const handZ = lz + faceDirZ * 0.011;
    this.addBox(parent, 0.008, radius * 0.78, 0.006, lx, ly + radius * 0.08, handZ, '#0f172a');
    this.addBox(parent, radius * 0.58, 0.008, 0.006, lx + radius * 0.18, ly, handZ, '#0f172a');
  }

  private buildStation(station: Station, ownerColor: string, state: GameState): void {
    const tiles =
      station.tiles && station.tiles.length > 0
        ? station.tiles
        : [{ x: station.x, y: station.y }];

    if (station.kind === 'TRAIN_STATION') {
      const layout = this.resolveTrainStationLayout(station, state);
      const { axis, minX, maxY, minY, platformLength: L, tracks: T, minCornerY, maxCornerY } = layout;
      const drop = Math.max(0.055, maxCornerY - (minCornerY - 0.05));

      // Local station coordinate frame:
      //   lx in [0 .. L-1] runs ALONG the platform length (total span [-0.49 .. (L-1)+0.49])
      //   lz in [0 .. T-1] steps PERPENDICULAR across parallel tracks (track t rail centerline is at lz = t!)
      // For axis === 'X': origin = (minX, maxCornerY, minY), rotY = 0 -> world = (minX + lx, y, minY + lz)
      // For axis === 'Y': origin = (minX, maxCornerY, maxY), rotY = +PI/2 -> world = (minX + lz, y, maxY - lx)
      const root = new THREE.Group();
      if (axis === 'X') {
        root.position.set(minX, maxCornerY, minY);
      } else {
        root.position.set(minX, maxCornerY, maxY);
        root.rotation.y = Math.PI / 2;
      }

      // If built on a hillside edge, anchor a flush cut-stone retaining terrace below rail ballast level (y <= -0.014)
      if (drop > 0.09) {
        const totalSpanZ = T + 0.02;
        this.addTexBox(
          root,
          L - 0.02,
          drop - 0.014,
          totalSpanZ,
          (L - 1) * 0.5,
          -drop,
          (T - 1) * 0.5,
          'ashlarStone',
          Math.max(1, L * 2),
          Math.max(1, Math.round(drop * 2)),
          Math.max(1, T * 2)
        );
      }

      const midX = (L - 1) * 0.5;
      const platLen = L - 0.02;
      const repAlongStone = Math.max(1, L * 2);
      const repAlongPave = Math.max(1, L * 3);
      const ySurf = 0.102;

      const outerAz = -0.375;
      const outerBz = (T - 1) + 0.375;
      const safetyAz = -0.273;
      const safetyBz = (T - 1) + 0.273;

      // =====================================================================
      // 1. OUTER RAISED STONE/CONCRETE PLATFORMS + YELLOW TACTILE SAFETY STRIPS
      //    Leaves every track bed t in [0..T-1] (lz in [t-0.26 .. t+0.26]) 100% clear!
      // =====================================================================
      this.addTexBox(root, platLen, drop + 0.08, 0.225, midX, -drop, outerAz, 'ashlarStone', repAlongStone, 1, 1);
      this.addTexBox(root, platLen, drop + 0.08, 0.225, midX, -drop, outerBz, 'ashlarStone', repAlongStone, 1, 1);
      this.addTexBox(root, platLen + 0.01, 0.026, 0.236, midX, 0.076, outerAz, 'platformPaving', repAlongPave, 1, 1);
      this.addTexBox(root, platLen + 0.01, 0.026, 0.236, midX, 0.076, outerBz, 'platformPaving', repAlongPave, 1, 1);

      // Crisp yellow safety strips along outer platforms facing Track 0 and Track T-1
      this.addBox(root, platLen + 0.01, 0.012, 0.024, midX, ySurf - 0.002, safetyAz, '#facc15');
      this.addBox(root, platLen + 0.01, 0.012, 0.024, midX, ySurf - 0.002, safetyBz, '#facc15');

      // Sloped stone end-curbs on outer platforms
      for (const endX of [-0.485, L - 0.515]) {
        this.addBox(root, 0.028, 0.065, 0.236, endX, 0.02, outerAz, '#94a3b8');
        this.addBox(root, 0.028, 0.065, 0.236, endX, 0.02, outerBz, '#94a3b8');
      }

      // =====================================================================
      // 2. SHARED NARROW ISLAND PLATFORMS BETWEEN PARALLEL TRACKS (T >= 2)
      //    Centered on seam lz = s + 0.5 (width 0.43 -> lz in [s+0.285 .. s+0.715]),
      //    with dual yellow tactile safety strips facing Track s and Track s+1!
      // =====================================================================
      for (let s = 0; s < T - 1; s++) {
        const iz = s + 0.5;
        this.addTexBox(root, platLen, drop + 0.08, 0.415, midX, -drop, iz, 'ashlarStone', repAlongStone, 1, 1);
        this.addTexBox(root, platLen + 0.01, 0.026, 0.432, midX, 0.076, iz, 'platformPaving', repAlongPave, 1, 1);

        // Dual yellow safety strips on BOTH sides of the shared island platform
        this.addBox(root, platLen + 0.01, 0.012, 0.022, midX, ySurf - 0.002, iz - 0.198, '#facc15');
        this.addBox(root, platLen + 0.01, 0.012, 0.022, midX, ySurf - 0.002, iz + 0.198, '#facc15');

        // Stone end-ramps on island platform ends
        for (const endX of [-0.485, L - 0.515]) {
          this.addBox(root, 0.028, 0.065, 0.432, endX, 0.02, iz, '#94a3b8');
        }

        // Pedestrian underpass stairwell hood on longer multi-track island platforms (L >= 3)
        const hasUnderpass = L >= 3;
        if (hasUnderpass) {
          this.addBox(root, 0.3, 0.022, 0.14, midX, ySurf, iz, '#1e293b');
          this.addBox(root, 0.28, 0.11, 0.13, midX, ySurf + 0.022, iz, '#bae6fd', '#38bdf8', 0.2);
          this.addBox(root, 0.32, 0.024, 0.155, midX, ySurf + 0.132, iz, ownerColor);
        }

        // Island platform furniture: benches, warm globe lamps & company station nameboards
        for (let l = 0; l < L; l++) {
          if (hasUnderpass && Math.abs(l - midX) < 0.35) continue;
          if ((l + s) % 2 === 0) {
            this.addStationNameboard(root, l - 0.16, ySurf, iz, ownerColor, 0.22);
            this.addBox(root, 0.18, 0.038, 0.055, l + 0.18, ySurf, iz, '#78350f');
          } else {
            this.addPlatformLamp(root, l, ySurf, iz);
            this.addBox(root, 0.18, 0.038, 0.055, l - 0.2, ySurf, iz, '#78350f');
          }
        }
      }

      // =====================================================================
      // 3. ARCHED STEEL-TRUSS & GLAZED MULTI-SPAN TRAIN-SHED CANOPY (y >= 0.465)
      //    Spans across all tracks (1..4) and full platform length (1..6)
      //    with stanchions strictly on platforms so trains glide unobstructed!
      // =====================================================================
      const colRowsZ: number[] = [-0.395];
      for (let s = 0; s < T - 1; s++) {
        colRowsZ.push(s + 0.5);
      }
      colRowsZ.push((T - 1) + 0.395);

      const shedSpanZ = (T - 1) + 0.84;
      const shedMidZ = (T - 1) * 0.5;

      // Steel stanchion columns & transverse portal truss tie-beams along platform length
      for (let l = 0; l < L; l++) {
        const colOffsets = L === 1 ? [-0.35, 0.35] : l === L - 1 ? [-0.38, 0.38] : [-0.38];
        for (const dx of colOffsets) {
          const cx = l + dx;
          for (let r = 0; r < colRowsZ.length; r++) {
            const cz = colRowsZ[r];
            this.addBox(root, 0.034, 0.368, 0.034, cx, ySurf, cz, '#334155');
            this.addBox(root, 0.052, 0.024, 0.052, cx, ySurf, cz, '#475569');
          }
          // Transverse steel lattice tie-beam high above trains (y = 0.462)
          this.addBox(root, 0.026, 0.026, shedSpanZ, cx, 0.462, shedMidZ, '#475569');
        }
      }

      // Longitudinal steel valley box-girders along each column row
      for (let r = 0; r < colRowsZ.length; r++) {
        this.addBox(root, platLen + 0.01, 0.032, 0.042, midX, 0.458, colRowsZ[r], '#334155');
      }

      // Outer company-colored valence fascias along both sides of the train shed
      this.addBox(root, platLen + 0.02, 0.058, 0.038, midX, 0.452, -0.462, ownerColor);
      this.addBox(root, platLen + 0.02, 0.058, 0.038, midX, 0.452, (T - 1) + 0.462, ownerColor);

      // Arched Steel & Glazed Barrel-Vault Bay over EVERY Track t = 0 .. T-1
      const wingSlopeGeo = this.getTiledBoxGeo(Math.max(1, L * 3), 1, 1);
      const corruMat = this.getMat('#cbd5e1', undefined, 0, 'corrugatedSteel');
      const skylightMat = this.getMat('#bae6fd', '#38bdf8', 0.26);

      for (let t = 0; t < T; t++) {
        // Lower pitched corrugated-steel roof shoulders on both sides of track t
        for (const side of [-1, 1] as const) {
          const shoulder = new THREE.Mesh(wingSlopeGeo, corruMat);
          shoulder.scale.set(platLen + 0.01, 0.024, 0.28);
          shoulder.position.set(midX, 0.502, t + side * 0.315);
          shoulder.rotation.x = side * 0.25;
          this.markShadow(shoulder, true, true);
          root.add(shoulder);

          // Upper angled glazed skylight panel forming the arched crown
          const glass = new THREE.Mesh(this.boxGeo, skylightMat);
          glass.scale.set(platLen + 0.01, 0.026, 0.23);
          glass.position.set(midX, 0.548, t + side * 0.105);
          glass.rotation.x = side * 0.11;
          this.markShadow(glass, true, false);
          root.add(glass);
        }

        // Raised company-colored ridge ventilator strip along crest of track t's vault
        this.addBox(root, platLen + 0.02, 0.024, 0.044, midX, 0.568, t, ownerColor);

        // Transverse steel arch ribs at every tile seam + glazed portal end-screens (y >= 0.48)
        for (let rIdx = 0; rIdx <= L; rIdx++) {
          const rx = rIdx === 0 ? -0.485 : rIdx === L ? L - 0.515 : rIdx - 0.5;
          this.addBox(root, 0.026, 0.024, 0.54, rx, 0.545, t, '#334155');
          if (rIdx === 0 || rIdx === L) {
            // Glazed semi-elliptical portal transom high above the track entrance/exit
            this.addBox(root, 0.018, 0.068, 0.62, rx, 0.482, t, '#93c5fd', '#38bdf8', 0.18);
            this.addBox(root, 0.028, 0.02, 0.88, rx, 0.468, t, ownerColor);
          }
        }
      }

      // =====================================================================
      // 4. AUTHENTIC BRICK & SLATE CLOCK-TOWER STATION HEADHOUSE (L >= 2)
      //    (Plus charming brick ticket lodge when L === 1)
      //    Positioned on Outer Platform A (lz = -0.415) so Track 0 stays 100% clear!
      // =====================================================================
      if (L >= 2) {
        const mainW = Math.min(1.72, 0.84 + (L - 2) * 0.24);
        const mainH = 0.29;
        const hz = -0.415;
        const hd = 0.155;

        // Dressed granite plinth + multi-pane lit Victorian red-brick main concourse hall
        this.addBox(root, mainW + 0.03, 0.03, hd + 0.015, midX, ySurf, hz, '#e2e8f0');
        this.addTexBox(
          root,
          mainW,
          mainH,
          hd,
          midX,
          ySurf + 0.03,
          hz,
          'brickRedWindowLit',
          Math.max(2, Math.round(mainW * 3)),
          2,
          1
        );
        // Stone eaves cornice + steep slate gable roof
        this.addBox(root, mainW + 0.03, 0.02, hd + 0.02, midX, ySurf + 0.03 + mainH, hz, '#f1f5f9');
        this.addGableRoof(
          root,
          mainW,
          0.145,
          hd,
          midX,
          ySurf + 0.05 + mainH,
          hz,
          'roofSlate',
          'brickRedPlain',
          '#ffffff',
          false,
          0.026
        );

        // Brick chimneys & slate dormers on L >= 3 headhouses
        if (L >= 3) {
          const chOff = mainW * 0.38;
          this.addChimney(root, midX - chOff, ySurf + 0.06 + mainH, hz - 0.02, 0.17, true);
          this.addChimney(root, midX + chOff, ySurf + 0.06 + mainH, hz - 0.02, 0.17, true);
          this.addDormer(root, midX - mainW * 0.26, ySurf + 0.07 + mainH, hz + 0.035, 0, '#f8fafc');
          this.addDormer(root, midX + mainW * 0.26, ySurf + 0.07 + mainH, hz + 0.035, 0, '#f8fafc');
        }

        // Symmetrical single-story brick luggage & waiting-room pavilions on longer stations (L >= 4)
        if (L >= 4) {
          const wingW = Math.min(0.62, 0.3 + (L - 4) * 0.15);
          for (const side of [-1, 1] as const) {
            const wx = midX + side * (mainW * 0.5 + wingW * 0.5 - 0.01);
            this.addTexBox(root, wingW, 0.21, 0.14, wx, ySurf + 0.02, hz, 'brickRedWindow', 2, 1, 1);
            this.addGableRoof(
              root,
              wingW,
              0.1,
              0.14,
              wx,
              ySurf + 0.23,
              hz,
              'roofSlate',
              'brickRedPlain',
              '#ffffff',
              false,
              0.022
            );
          }
        }

        // Prominent Central Brick & Slate Clock Tower rising above the Headhouse!
        const towerW = 0.24;
        const towerD = 0.165;
        const towerBaseY = ySurf + 0.03;
        const towerH = 0.56;
        this.addTexBox(root, towerW, towerH, towerD, midX, towerBaseY, hz, 'brickRedPlain', 1, 3, 1);
        // White stone stringcourses & belfry cornice
        this.addBox(root, towerW + 0.024, 0.02, towerD + 0.02, midX, towerBaseY + 0.34, hz, '#f8fafc');
        this.addBox(root, towerW + 0.03, 0.024, towerD + 0.026, midX, towerBaseY + towerH, hz, '#f8fafc');

        // Steep slate hip/belfry spire + golden finial weathervane
        this.addHipRoof(
          root,
          towerW,
          0.21,
          towerD,
          midX,
          towerBaseY + towerH + 0.024,
          hz,
          'roofSlate',
          ownerColor,
          0.028
        );
        this.addCyl(root, 0.01, 0.11, midX, towerBaseY + towerH + 0.24, hz, '#fbbf24', undefined, true);

        // Dual illuminated white & gold station clock dials (facing tracks +Z and town street -Z!)
        const clockY = towerBaseY + 0.455;
        this.addStationClockDial(root, midX, clockY, hz + towerD * 0.5 + 0.004, 0.068, 1);
        this.addStationClockDial(root, midX, clockY, hz - towerD * 0.5 - 0.004, 0.068, -1);

        // Trackside ticket-hall double doors + company-colored entrance portico
        this.addBox(root, 0.14, 0.14, 0.02, midX, ySurf + 0.03, hz + hd * 0.5 + 0.004, '#451a03');
        this.addBox(root, 0.28, 0.032, 0.065, midX, ySurf + 0.185, hz + hd * 0.5 + 0.024, ownerColor);
      } else {
        // L === 1: Compact Brick Station-Master Lodge with Slate Gable & Trackside Clock
        this.addTexBox(root, 0.62, 0.25, 0.15, 0, ySurf, -0.415, 'brickRedWindowLit', 3, 1, 1);
        this.addGableRoof(
          root,
          0.62,
          0.12,
          0.15,
          0,
          ySurf + 0.25,
          -0.415,
          'roofSlate',
          'brickRedPlain',
          '#ffffff',
          false,
          0.024
        );
        this.addBox(root, 0.14, 0.12, 0.12, 0, ySurf + 0.32, -0.41, '#9a3424');
        this.addStationClockDial(root, 0, ySurf + 0.38, -0.345, 0.044, 1);
      }

      // =====================================================================
      // 5. OUTER PLATFORM BENCHES, NAMEBOARDS, LAMPS & DISTRIBUTED WAITING CARGO
      // =====================================================================
      for (let l = 0; l < L; l++) {
        const distFromMid = Math.abs(l - midX);
        const clearOfHeadhouse = L >= 2 ? distFromMid > (L >= 4 ? 1.35 : 0.65) : false;
        if (clearOfHeadhouse) {
          this.addBox(root, 0.18, 0.038, 0.045, l - 0.18, ySurf, -0.415, '#78350f');
          this.addStationNameboard(root, l + 0.18, ySurf, -0.42, ownerColor, 0.2);
        }

        // Outer Platform B lamps, nameboards & benches
        this.addPlatformLamp(root, l, ySurf, outerBz + 0.045);
        if (l % 2 === 0) {
          this.addStationNameboard(root, l - 0.22, ySurf, outerBz + 0.045, ownerColor, 0.2);
        } else {
          this.addBox(root, 0.18, 0.038, 0.045, l + 0.2, ySurf, outerBz + 0.04, '#78350f');
        }
      }

      // Distribute waiting passengers & freight cargo across Outer Platform A, Island Platforms, and Outer Platform B!
      const paxStripsZ: number[] = [-0.31];
      const freightStripsZ: number[] = [outerBz - 0.02];
      for (let s = 0; s < T - 1; s++) {
        paxStripsZ.push(s + 0.5);
        freightStripsZ.push(s + 0.5);
      }

      const paxOnlyCargo: Record<CargoType, number> = {
        ...station.waitingCargo,
        MAIL: 0,
        COAL: 0,
        WOOD: 0,
        GRAIN: 0,
        FOOD: 0,
        GOODS: 0,
      };
      const freightOnlyCargo: Record<CargoType, number> = {
        ...station.waitingCargo,
        PASSENGERS: 0,
      };

      const totalPaxSlots = paxStripsZ.length * L;
      let paxSlot = 0;
      for (let sIdx = 0; sIdx < paxStripsZ.length; sIdx++) {
        const stripZ = paxStripsZ[sIdx];
        const spreadZ = sIdx === 0 ? 0.024 : 0.095;
        for (let l = 0; l < L; l++) {
          this.populateWaitingCargo(
            root,
            paxOnlyCargo,
            l - 0.4,
            l + 0.4,
            ySurf,
            stripZ,
            spreadZ,
            paxSlot,
            totalPaxSlots
          );
          paxSlot++;
        }
      }

      const totalFreightSlots = freightStripsZ.length * L;
      let freightSlot = 0;
      for (let sIdx = 0; sIdx < freightStripsZ.length; sIdx++) {
        const stripZ = freightStripsZ[sIdx];
        const zOff = sIdx === 0 ? stripZ : stripZ + 0.08;
        for (let l = 0; l < L; l++) {
          this.populateWaitingCargo(
            root,
            freightOnlyCargo,
            l - 0.38,
            l + 0.38,
            ySurf,
            zOff,
            0.025,
            freightSlot,
            totalFreightSlots
          );
          freightSlot++;
        }
      }

      this.buildingsGroup.add(root);
    } else if (station.kind === 'BUS_STOP') {
      const t0 = tiles[0];
      const corners = getTileCornerHeights(state, t0.x, t0.y);
      const drop = corners.maxY - (corners.minY - 0.05);

      const nN = getTileAt(state, t0.x, t0.y - 1);
      const nS = getTileAt(state, t0.x, t0.y + 1);
      const nE = getTileAt(state, t0.x + 1, t0.y);
      const nW = getTileAt(state, t0.x - 1, t0.y);
      const roadNS = Boolean((nN?.road || nS?.road) && !(nE?.road || nW?.road));

      const g = new THREE.Group();
      g.position.set(t0.x, corners.maxY, t0.y);
      if (roadNS) {
        g.rotation.y = Math.PI / 2;
      }

      // Roadside curb & paved pull-in apron (leaves road center clear!)
      this.addTexBox(g, 0.78, drop + 0.03, 0.28, 0, -drop, -0.32, 'ashlarStone', 2, 1, 1);
      this.addTexBox(g, 0.78, 0.022, 0.28, 0, 0.025, -0.32, 'platformPaving', 2, 1, 1);
      this.addBox(g, 0.78, 0.012, 0.024, 0, 0.045, -0.19, '#facc15');

      // Glazed 3-sided bus shelter + steel mullions + cantilevered company-colored roof + bench
      this.addBox(g, 0.5, 0.23, 0.022, -0.04, 0.047, -0.41, '#bae6fd', '#38bdf8', 0.22);
      this.addBox(g, 0.022, 0.23, 0.16, -0.28, 0.047, -0.34, '#bae6fd', '#38bdf8', 0.22);
      this.addBox(g, 0.022, 0.23, 0.16, 0.2, 0.047, -0.34, '#bae6fd', '#38bdf8', 0.22);
      for (const sxPost of [-0.28, -0.04, 0.2]) {
        this.addBox(g, 0.02, 0.24, 0.02, sxPost, 0.047, -0.41, '#334155');
      }
      this.addBox(g, 0.58, 0.042, 0.24, -0.04, 0.28, -0.33, ownerColor);
      this.addBox(g, 0.36, 0.042, 0.065, -0.04, 0.08, -0.37, '#78350f'); // Bench

      // Timetable post with yellow/company flag + waste bin
      this.addCyl(g, 0.012, 0.31, 0.31, 0.047, -0.25, '#e2e8f0', undefined, true);
      this.addBox(g, 0.08, 0.08, 0.022, 0.31, 0.31, -0.25, '#facc15');
      this.addBox(g, 0.055, 0.04, 0.024, 0.31, 0.23, -0.25, ownerColor);
      this.addCyl(g, 0.026, 0.075, -0.34, 0.047, -0.26, '#334155', undefined, true);

      // Dynamic waiting passengers & mailbags along the bus stop curb!
      this.populateWaitingCargo(g, station.waitingCargo, -0.24, 0.26, 0.047, -0.26, 0.03, 0, 1);

      this.buildingsGroup.add(g);
    } else {
      // TRUCK_BAY: Covered Brick/Steel Freight Loading Dock with Rollup Doors, Barrels & Dynamic Crates
      const t0 = tiles[0];
      const corners = getTileCornerHeights(state, t0.x, t0.y);
      const drop = corners.maxY - (corners.minY - 0.05);

      const nN = getTileAt(state, t0.x, t0.y - 1);
      const nS = getTileAt(state, t0.x, t0.y + 1);
      const nE = getTileAt(state, t0.x + 1, t0.y);
      const nW = getTileAt(state, t0.x - 1, t0.y);
      const roadNS = Boolean((nN?.road || nS?.road) && !(nE?.road || nW?.road));

      const g = new THREE.Group();
      g.position.set(t0.x, corners.maxY, t0.y);
      if (roadNS) {
        g.rotation.y = Math.PI / 2;
      }

      // Raised concrete loading dock platform along roadside
      this.addTexBox(g, 0.88, drop + 0.055, 0.34, 0, -drop, -0.3, 'ashlarStone', 2, 1, 1);
      this.addTexBox(g, 0.88, 0.024, 0.34, 0, 0.055, -0.3, 'platformPaving', 3, 1, 1);

      // Freight warehouse hall + company-colored fascia canopy + 2 rollup shutter doors
      this.addTexBox(g, 0.78, 0.27, 0.2, 0, 0.079, -0.36, 'corrugatedSteel', 3, 1, 1, '#e2e8f0');
      this.addBox(g, 0.82, 0.055, 0.34, 0, 0.345, -0.3, ownerColor);
      for (const dx of [-0.19, 0.19]) {
        this.addBox(g, 0.17, 0.19, 0.022, dx, 0.079, -0.258, '#475569');
        this.addBox(g, 0.19, 0.018, 0.026, dx, 0.27, -0.255, '#0f172a');
      }

      // Steel freight barrels on dock corner
      this.addCyl(g, 0.032, 0.085, -0.36, 0.079, -0.22, '#0284c7', undefined, true);
      this.addCyl(g, 0.032, 0.085, -0.3, 0.079, -0.2, '#dc2626', undefined, true);

      // Dynamic waiting freight crates/sacks/logs/coal on loading dock apron!
      this.populateWaitingCargo(g, station.waitingCargo, -0.24, 0.36, 0.079, -0.19, 0.02, 0, 1);

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

    this.addRetainingFoundation(g, 0.95, 0.95, minCornerY, maxCornerY);

    if (tier <= 1) {
      // HQ Tier 1: Charming Founder's Timber Office Cabin with Porch, Hedge & Flagpole
      this.addBox(g, 0.9, 0.022, 0.9, 0, 0, 0, '#3f6a34');
      this.addTexBox(g, 0.58, 0.27, 0.46, -0.04, 0.04, -0.06, 'timberRorosRed', 2, 1, 2);
      this.addBox(g, 0.62, 0.03, 0.5, -0.04, 0.02, -0.06, '#64748b');
      this.addGableRoof(
        g,
        0.58,
        0.2,
        0.46,
        -0.04,
        0.31,
        -0.06,
        'roofSlate',
        'timberRorosRed',
        '#ffffff',
        false,
        0.05
      );
      this.addChimney(g, -0.24, 0.33, -0.14, 0.2, false);

      // Covered wooden porch + company signboard + flagpole
      this.addBox(g, 0.34, 0.03, 0.18, -0.04, 0.022, 0.24, '#92400e');
      this.addBox(g, 0.025, 0.18, 0.025, -0.18, 0.052, 0.31, '#f8fafc');
      this.addBox(g, 0.025, 0.18, 0.025, 0.1, 0.052, 0.31, '#f8fafc');
      this.addBox(g, 0.36, 0.045, 0.2, -0.04, 0.23, 0.24, ownerColor);

      this.addCyl(g, 0.012, 0.46, 0.33, 0.022, 0.28, '#f8fafc', undefined, true);
      this.addBox(g, 0.13, 0.075, 0.018, 0.39, 0.39, 0.28, ownerColor);
      this.addGardenTree(g, 0.32, 0.022, -0.26, 0.95, true);
    } else if (tier === 2) {
      // HQ Tier 2: Georgian Red-Brick Manor Office with Classical Stone Portico & Dormers
      this.addTexBox(g, 0.92, 0.03, 0.92, 0, 0, 0, 'platformPaving', 3, 1, 3);
      this.addTexBox(g, 0.72, 0.56, 0.58, 0, 0.03, -0.04, 'brickRedWindowLit', 3, 3, 2);
      // White stone corner quoins & cornice
      this.addBox(g, 0.75, 0.03, 0.61, 0, 0.59, -0.04, '#f8fafc');
      this.addHipRoof(g, 0.72, 0.22, 0.58, 0, 0.62, -0.04, 'roofSlate', '#f8fafc', 0.045);
      this.addDormer(g, -0.17, 0.66, 0.18, 0, '#f8fafc');
      this.addDormer(g, 0.17, 0.66, 0.18, 0, '#f8fafc');
      this.addChimney(g, -0.28, 0.68, -0.08, 0.2, true);
      this.addChimney(g, 0.28, 0.68, -0.08, 0.2, true);

      // Classical stone portico + 2 white columns + pediment + flagpole
      this.addBox(g, 0.3, 0.05, 0.16, 0, 0.03, 0.3, '#e2e8f0');
      this.addCyl(g, 0.026, 0.34, -0.11, 0.08, 0.34, '#f8fafc');
      this.addCyl(g, 0.026, 0.34, 0.11, 0.08, 0.34, '#f8fafc');
      this.addGableRoof(g, 0.32, 0.1, 0.16, 0, 0.42, 0.3, 'roofSlate', null, '#f8fafc', true, 0.02);

      this.addCyl(g, 0.012, 0.48, 0.37, 0.03, 0.35, '#f8fafc', undefined, true);
      this.addBox(g, 0.14, 0.08, 0.018, 0.43, 0.41, 0.35, ownerColor);
    } else if (tier === 3) {
      // HQ Tier 3: Sleek 4-Story Glass Atrium HQ with Glowing Plaza Fountain!
      this.addTexBox(g, 0.94, 0.035, 0.94, 0, 0, 0, 'platformPaving', 3, 1, 3, '#e2e8f0');
      this.addTexBox(g, 0.74, 0.88, 0.58, 0, 0.035, -0.1, 'curtainWallBlue', 4, 4, 3);
      for (let f = 1; f <= 4; f++) {
        this.addBox(g, 0.77, 0.028, 0.61, 0, 0.035 + f * 0.215, -0.1, '#f8fafc');
      }
      this.addBox(g, 0.78, 0.055, 0.62, 0, 0.915, -0.1, ownerColor);
      // Projecting 2-story glazed entrance atrium
      this.addBox(g, 0.38, 0.38, 0.2, 0, 0.035, 0.24, '#38bdf8', '#0284c7', 0.32);
      this.addBox(g, 0.42, 0.04, 0.24, 0, 0.415, 0.24, ownerColor);

      // Circular plaza fountain with glowing cyan water jet!
      this.addCyl(g, 0.13, 0.045, -0.28, 0.035, 0.31, '#cbd5e1');
      this.addCyl(g, 0.105, 0.052, -0.28, 0.038, 0.31, '#38bdf8');
      this.addCyl(g, 0.025, 0.11, -0.28, 0.05, 0.31, '#bae6fd');
      this.addGardenTree(g, 0.32, 0.035, 0.32, 0.9, false);
    } else if (tier === 4) {
      // HQ Tier 4: 8-Story Executive Corporate Tower with Landscaped Forecourt & Helipad!
      this.addTexBox(g, 0.96, 0.045, 0.96, 0, 0, 0, 'platformPaving', 4, 1, 4, '#f1f5f9');
      // 2-story granite/glass podium
      this.addTexBox(g, 0.82, 0.38, 0.76, 0, 0.045, -0.04, 'curtainWallBlue', 4, 2, 4);
      this.addBox(g, 0.85, 0.04, 0.79, 0, 0.425, -0.04, ownerColor);

      // 8-story executive glass tower shaft
      this.addTexBox(g, 0.62, 1.18, 0.58, 0, 0.465, -0.04, 'curtainWallBlue', 3, 6, 3);
      this.addBox(g, 0.66, 0.05, 0.62, 0, 1.645, -0.04, ownerColor);

      // Cantilevered Rooftop Helipad with Yellow 'H' & Deck Rim
      this.addCyl(g, 0.26, 0.04, 0, 1.695, -0.04, '#334155');
      this.addCyl(g, 0.22, 0.044, 0, 1.695, -0.04, '#1e293b');
      this.addBox(g, 0.032, 0.012, 0.18, -0.06, 1.74, -0.04, '#facc15');
      this.addBox(g, 0.032, 0.012, 0.18, 0.06, 1.74, -0.04, '#facc15');
      this.addBox(g, 0.14, 0.012, 0.032, 0, 1.74, -0.04, '#facc15');
      this.addBeacon(g, 0.24, 1.695, -0.24, 0.14);

      // Forecourt trees & twin flagpoles
      this.addGardenTree(g, -0.34, 0.045, 0.38, 0.9, false);
      this.addGardenTree(g, 0.34, 0.045, 0.38, 0.9, false);
      for (const fx of [-0.16, 0.16]) {
        this.addCyl(g, 0.01, 0.38, fx, 0.045, 0.41, '#f8fafc', undefined, true);
        this.addBox(g, 0.1, 0.06, 0.015, fx + 0.05, 0.36, 0.41, ownerColor);
      }
    } else {
      // HQ Tier 5: Monumental OpenTTD Tycoon Skyscraper Complex (Colonnade, Setbacks, Helipad & Golden Spire!)
      this.addTexBox(g, 0.98, 0.055, 0.98, 0, 0, 0, 'platformPaving', 4, 1, 4, '#fef3c7');
      this.addBox(g, 0.99, 0.02, 0.99, 0, 0.04, 0, '#fbbf24');

      // Grand 6-pillar front colonnade along +Z plaza
      for (let c = 0; c < 6; c++) {
        const cx = -0.35 + c * 0.14;
        this.addCyl(g, 0.022, 0.28, cx, 0.055, 0.42, '#fef9c3');
      }
      this.addBox(g, 0.82, 0.04, 0.1, 0, 0.335, 0.41, '#fbbf24');

      // Stage 1: Wide Executive Podium (curtainWallBlue + golden corner piers)
      this.addTexBox(g, 0.82, 0.68, 0.74, 0, 0.055, -0.03, 'curtainWallBlue', 4, 4, 4);
      this.addBox(g, 0.86, 0.045, 0.78, 0, 0.735, -0.03, '#f59e0b', '#fbbf24', 0.42);

      // VIP Helipad perched on East podium terrace
      this.addCyl(g, 0.15, 0.03, 0.26, 0.78, 0.18, '#1e293b');
      this.addBox(g, 0.022, 0.01, 0.11, 0.22, 0.812, 0.18, '#facc15');
      this.addBox(g, 0.022, 0.01, 0.11, 0.3, 0.812, 0.18, '#facc15');
      this.addBox(g, 0.09, 0.01, 0.022, 0.26, 0.812, 0.18, '#facc15');

      // Stage 2: Main Skyscraper Shaft
      this.addTexBox(g, 0.62, 0.88, 0.58, -0.04, 0.78, -0.05, 'curtainWallBlue', 3, 5, 3);
      this.addBox(g, 0.66, 0.045, 0.62, -0.04, 1.66, -0.05, '#f59e0b', '#fbbf24', 0.45);

      // Stage 3: Golden Tycoon Penthouse Crown + Illuminated Spire & Beacon!
      this.addTexBox(g, 0.44, 0.68, 0.44, -0.04, 1.705, -0.05, 'curtainWallGold', 2, 4, 2);
      this.addMansardRoof(g, 0.44, 0.24, 0.44, -0.04, 2.385, -0.05, '#fbbf24');
      this.addCyl(g, 0.035, 0.18, -0.04, 2.64, -0.05, '#fbbf24');
      this.addCyl(g, 0.016, 0.38, -0.04, 2.82, -0.05, '#fef08a');
      this.addBeacon(g, -0.04, 3.18, -0.05, 0.06);
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

      const sx = x + (ewTrack ? 0.16 : 0.33);
      const sz = y + (ewTrack ? -0.33 : 0.16);
      const sy = getSurfaceHeightAt(state, sx, sz);

      const g = new THREE.Group();
      g.position.set(sx, sy, sz);
      if (ewTrack) {
        g.rotation.y = Math.PI / 2;
      }

      // Concrete anchor pad + trackside grey steel relay cabinet
      this.addBox(g, 0.13, 0.065, 0.13, 0, -0.045, 0, '#64748b');
      this.addBox(g, 0.065, 0.11, 0.05, -0.065, 0.02, -0.02, '#cbd5e1');
      this.addBox(g, 0.07, 0.015, 0.055, -0.065, 0.13, -0.02, '#475569');

      // Black-and-white striped tubular signal mast + rear ladder!
      for (let seg = 0; seg < 5; seg++) {
        this.addCyl(
          g,
          0.018,
          0.068,
          0,
          0.02 + seg * 0.068,
          0,
          seg % 2 === 0 ? '#0f172a' : '#f8fafc',
          undefined,
          true
        );
      }
      this.addBox(g, 0.026, 0.34, 0.01, 0, 0.02, -0.026, '#334155'); // Maintenance ladder

      // Matte-black target plate with white border + sun visor hoods + dual Red/Green aspect lenses!
      this.addBox(g, 0.105, 0.195, 0.022, 0, 0.275, 0.014, '#f8fafc');
      this.addBox(g, 0.092, 0.182, 0.028, 0, 0.281, 0.016, '#09090b');
      // Sun visor hoods over upper & lower aspects
      this.addBox(g, 0.055, 0.014, 0.045, 0, 0.435, 0.036, '#09090b');
      this.addBox(g, 0.055, 0.014, 0.045, 0, 0.355, 0.036, '#09090b');

      const blocked = Boolean(tile.signalBlocked);
      const redLens = new THREE.Mesh(
        this.sphereGeo,
        blocked ? this.signalRedMat : this.signalOffMat
      );
      redLens.scale.set(0.058, 0.058, 0.042);
      redLens.position.set(0, 0.405, 0.034);

      const greenLens = new THREE.Mesh(
        this.sphereGeo,
        blocked ? this.signalOffMat : this.signalGreenMat
      );
      greenLens.scale.set(0.058, 0.058, 0.042);
      greenLens.position.set(0, 0.325, 0.034);

      g.add(redLens, greenLens);

      this.signalsGroup.add(g);
      this.signalRecords.push({
        x,
        y,
        redLens,
        greenLens,
        lastBlocked: blocked,
      });
    }
  }

  private collectAllStations(state: GameState): Station[] {
    const extraRemote = (state as GameState & { remoteStations?: Station[] }).remoteStations;
    const hasPeers = Boolean(state.remotePlayers && state.remotePlayers.length > 0);
    const hasExtra = Boolean(extraRemote && extraRemote.length > 0);
    if (!hasPeers && !hasExtra) {
      return state.stations;
    }

    const seen = new Set<string>();
    const combined: Station[] = [];
    for (let i = 0; i < state.stations.length; i++) {
      const st = state.stations[i];
      seen.add(st.id);
      combined.push(st);
    }

    if (extraRemote) {
      for (let i = 0; i < extraRemote.length; i++) {
        const rst = extraRemote[i];
        if (rst && rst.id && !seen.has(rst.id)) {
          seen.add(rst.id);
          combined.push(rst);
        }
      }
    }

    if (state.remotePlayers) {
      for (let p = 0; p < state.remotePlayers.length; p++) {
        const peer = state.remotePlayers[p];
        if (!peer?.stations) continue;
        for (let j = 0; j < peer.stations.length; j++) {
          const rst = peer.stations[j];
          if (rst && rst.id && !seen.has(rst.id)) {
            seen.add(rst.id);
            combined.push({
              ...rst,
              ownerId: rst.ownerId || peer.clientId,
            });
          }
        }
      }
    }

    return combined;
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
      if (t.stationAxis === 'X') code |= 8192;
      else if (t.stationAxis === 'Y') code |= 16384;
      tileHash ^= (i * 31 + code) >>> 0;
      tileHash = Math.imul(tileHash, 16777619) >>> 0;
    }

    const allStations = this.collectAllStations(state);
    let stationCargoHash = 2166136261 >>> 0;
    for (let i = 0; i < allStations.length; i++) {
      const st = allStations[i];
      const stTiles = st.tiles && st.tiles.length > 0 ? st.tiles : [{ x: st.x, y: st.y }];
      const firstTile = stTiles[0];
      const lastTile = stTiles[stTiles.length - 1];
      const orientCode = st.orientation === 'Y' ? 2 : st.orientation === 'X' ? 1 : 0;
      const tracksCode = st.tracks ?? 0;
      const lenCode = st.platformLength ?? 0;

      stationCargoHash ^=
        (stTiles.length ^
          (orientCode << 6) ^
          (tracksCode << 8) ^
          (lenCode << 11) ^
          (firstTile.x << 15) ^
          (firstTile.y << 21) ^
          (lastTile.x << 3) ^
          (lastTile.y << 9)) >>>
        0;
      stationCargoHash = Math.imul(stationCargoHash, 16777619) >>> 0;

      const w = st.waitingCargo;
      if (w) {
        stationCargoHash ^=
          ((Math.round(w.PASSENGERS || 0) * 3) ^
            (Math.round(w.MAIL || 0) * 7) ^
            (Math.round(w.COAL || 0) * 13) ^
            (Math.round(w.WOOD || 0) * 19) ^
            (Math.round(w.GRAIN || 0) * 29) ^
            (Math.round(w.FOOD || 0) * 37) ^
            (Math.round(w.GOODS || 0) * 43)) >>>
          0;
        stationCargoHash = Math.imul(stationCargoHash, 16777619) >>> 0;
      }
    }

    let townPopSig = 0;
    for (let i = 0; i < state.towns.length; i++) {
      townPopSig = (townPopSig * 17 + Math.round(state.towns[i].population)) | 0;
    }

    const hqKey = state.corporate.hqTile
      ? `${state.corporate.hqTile.x},${state.corporate.hqTile.y}:${state.corporate.hqTier}:${state.corporate.companyName}:${state.corporate.playerColor ?? ''}`
      : 'none';

    return `${state.mapSize}:${state.networkRevision ?? 0}:${tileHash}:${allStations.length}:${stationCargoHash}:${state.industries.length}:${townPopSig}:${hqKey}:${state.aiCompanies.length}:${state.remotePlayers?.length ?? 0}`;
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
        rec.redLens.material = blocked ? this.signalRedMat : this.signalOffMat;
        rec.greenLens.material = blocked ? this.signalOffMat : this.signalGreenMat;
      }
    }
  }

  /**
   * Animates live coal-mine hoist sheave wheels, rising industrial smoke & cooling-tower vapor plumes,
   * and skyscraper aircraft warning beacons at 60 FPS with zero allocations!
   */
  public updateAnimation(timeSec: number, dtSec: number): void {
    const dt = Math.min(0.1, Math.max(0, dtSec));

    for (let i = 0; i < this.spinningWheels.length; i++) {
      const w = this.spinningWheels[i];
      w.group.rotation[w.axis] += w.speedRadPerSec * dt;
    }

    for (let i = 0; i < this.smokePuffs.length; i++) {
      const p = this.smokePuffs[i];
      const t = (timeSec * p.speed + p.phase) % 1;
      const sway = Math.sin((timeSec * 1.6 + p.phase * 6.283) * 1.2) * 0.025 * t;
      p.mesh.position.set(
        p.originX + p.driftX * t + sway,
        p.originY + p.riseHeight * t,
        p.originZ + p.driftZ * t - sway * 0.6
      );
      // Smoothly expand from nozzle and taper away near top of plume
      const envelope = t < 0.14 ? t / 0.14 : t > 0.76 ? Math.max(0.001, (1 - t) / 0.24) : 1;
      const s = (p.startScale + (p.endScale - p.startScale) * t) * envelope;
      p.mesh.scale.set(s, s * 0.84, s);
    }

    if (this.beaconMeshes.length > 0) {
      const pulse = 0.72 + 0.36 * Math.sin(timeSec * 4.2);
      for (let i = 0; i < this.beaconMeshes.length; i++) {
        this.beaconMeshes[i].scale.setScalar(0.036 * pulse);
      }
    }
  }

  private rebuildStructures(state: GameState): void {
    this.buildingsGroup.clear();
    this.spinningWheels = [];
    this.smokePuffs = [];
    this.beaconMeshes = [];

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
        const ownerColor = resolveOwnerColor(tile.ownerId, state.aiCompanies, state);
        this.buildDepot(tile, tile.depot, ownerColor, state);
      }
    }

    // 2. Industries (6 iconic multi-tile OpenTTD complexes)
    for (let i = 0; i < state.industries.length; i++) {
      this.buildIndustry(state.industries[i], state);
    }

    // 3. Stations (local + remote multiplayer snapshots)
    const allStations = this.collectAllStations(state);
    for (let i = 0; i < allStations.length; i++) {
      const st = allStations[i];
      const ownerColor = resolveOwnerColor(st.ownerId, state.aiCompanies, state);
      this.buildStation(st, ownerColor, state);
    }

    // 4. Player HQ & Remote Multiplayer HQs (5 Distinct OpenTTD Showpiece Tiers)
    if (state.corporate.hqTile && state.corporate.hqTier > 0) {
      const hx = state.corporate.hqTile.x;
      const hy = state.corporate.hqTile.y;
      const corners = getTileCornerHeights(state, hx, hy);
      const playerColor = resolveOwnerColor('player', state.aiCompanies, state);
      this.buildHQ(hx, hy, corners.minY, corners.maxY, state.corporate.hqTier, playerColor);
    }
    if (state.remotePlayers) {
      for (let p = 0; p < state.remotePlayers.length; p++) {
        const peer = state.remotePlayers[p];
        if (peer?.hqTile && peer.hqTier > 0) {
          const corners = getTileCornerHeights(state, peer.hqTile.x, peer.hqTile.y);
          const peerColor = peer.color || resolveOwnerColor(peer.clientId, state.aiCompanies, state);
          this.buildHQ(peer.hqTile.x, peer.hqTile.y, corners.minY, corners.maxY, peer.hqTier, peerColor);
        }
      }
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
    if (!this.labelLayer || typeof document === 'undefined') return;
    const activeIds = new Set<string>();

    // 1. Classic TTD Town Nameplates: "Bergen (1 240)"
    for (const town of state.towns) {
      const id = `town:${town.id}`;
      activeIds.add(id);
      const wy = getSurfaceHeightAt(state, town.x, town.y) + 1.08;

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
      const wy = getSurfaceHeightAt(state, cx, cz) + 1.32;

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

    // 3. Classic TTD Company-Colored Station Signs (centered over multi-track / multi-length footprint)
    const allStations = this.collectAllStations(state);
    for (const st of allStations) {
      const id = `st:${st.id}`;
      activeIds.add(id);

      let wx = st.x;
      let wz = st.y;
      let wy = getSurfaceHeightAt(state, st.x, st.y) + 0.78;
      if (st.kind === 'TRAIN_STATION') {
        const layout = this.resolveTrainStationLayout(st, state);
        wx = layout.centerX;
        wz = layout.centerZ;
        wy = layout.maxCornerY + (layout.platformLength >= 2 ? 0.96 : 0.78);
      }

      const ownerColor = resolveOwnerColor(st.ownerId, state.aiCompanies, state);
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
        rec = { id, kind: 'station', wx, wy, wz, el, stationId: st.id };
        this.labels.set(id, rec);
      }
      rec.wx = wx;
      rec.wy = wy;
      rec.wz = wz;
      rec.el.style.background = ownerColor;
      rec.el.textContent = waiting > 0 ? `${st.name} [${waiting}]` : st.name;
    }

    // 4. Player HQ Sign
    if (state.corporate.hqTile && state.corporate.hqTier > 0) {
      const id = 'hq:player';
      activeIds.add(id);
      const hqPos = state.corporate.hqTile;
      const corners = getTileCornerHeights(state, hqPos.x, hqPos.y);
      const tierHeights = [0.7, 0.72, 1.06, 1.32, 1.98, 3.35];
      const hqHeight = tierHeights[Math.min(5, Math.max(0, state.corporate.hqTier))] ?? 1.5;
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
    this.spinningWheels = [];
    this.smokePuffs = [];
    this.beaconMeshes = [];

    this.boxGeo.dispose();
    for (const geo of this.tiledBoxCache.values()) {
      geo.dispose();
    }
    this.tiledBoxCache.clear();
    this.cylGeo.dispose();
    this.cylLowGeo.dispose();
    this.coneGeo.dispose();
    this.sphereGeo.dispose();
    this.gablePrismGeo.dispose();
    this.hipRoofGeo.dispose();
    this.mansardRoofGeo.dispose();
    this.gambrelRoofGeo.dispose();
    this.hyperboloidGeo.dispose();

    for (const mat of this.matCache.values()) {
      mat.dispose();
    }
    this.matCache.clear();
    this.signalGreenMat.dispose();
    this.signalRedMat.dispose();
    this.signalOffMat.dispose();
    this.beaconGlowMat.dispose();
    this.smokeGreyMat.dispose();
    this.vaporWhiteMat.dispose();

    this.textureSet?.dispose();
    this.textureSet = null;

    this.labels.clear();
    this.labelLayer?.remove();
    this.labelLayer = null;
  }
}
