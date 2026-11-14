import * as THREE from 'three';
import type { CargoType, GameState, Vehicle, VehicleModelId } from '../types/game';
import {
  getSurfaceHeightAt,
  getTileAt,
  getTravelSurfaceHeightAt,
  resolveOwnerColor,
} from './IsoSceneManager';
import { VehicleTexturesManager, shadeHex } from './VehicleTextures';

const TRAIN_STATION_STOP_OFFSET = 0.2;

function sampleVehicleTravelHeight(
  state: GameState,
  worldX: number,
  worldZ: number
): number {
  return typeof getTravelSurfaceHeightAt === 'function'
    ? getTravelSurfaceHeightAt(state, worldX, worldZ)
    : getSurfaceHeightAt(state, worldX, worldZ);
}

function isTrainStationTile(state: GameState, gx: number, gy: number): boolean {
  const tile = getTileAt(state, Math.round(gx), Math.round(gy));
  if (!tile || !tile.stationId) return false;
  if (Array.isArray(state.stations)) {
    const localSt = state.stations.find((s) => s.id === tile.stationId);
    if (localSt) return localSt.kind === 'TRAIN_STATION';
  }
  if (Array.isArray(state.remotePlayers)) {
    for (const rp of state.remotePlayers) {
      const remSt = rp.stations.find((s) => s.id === tile.stationId);
      if (remSt) return remSt.kind === 'TRAIN_STATION';
    }
  }
  return Boolean(tile.rail);
}

interface Breadcrumb {
  x: number;
  z: number;
}

interface PlumePuff {
  mesh: THREE.Mesh;
  age: number;
  driftSign: number;
  spawned: boolean;
}

interface CargoTierItem {
  obj: THREE.Object3D;
  threshold: number;
}

interface TrainWagonLike {
  cargoType: CargoType;
  capacity: number;
  cargoAmount: number;
}

type VehicleConsistCompat = Vehicle & {
  wagons?: TrainWagonLike[];
  wt?: CargoType[];
};

type CargoVisualSlot =
  | {
      kind: 'HEAP';
      group: THREE.Group;
      wagonIndex?: number;
    }
  | {
      kind: 'TIERED';
      items: CargoTierItem[];
      wagonIndex?: number;
    };

interface SteamRunningGear {
  leftRod: THREE.Mesh;
  rightRod: THREE.Mesh;
  leftPiston: THREE.Mesh;
  rightPiston: THREE.Mesh;
  rodBaseY: number;
  rodBaseZ: number;
  pistonBaseZ: number;
}

interface VehicleVisualInstance {
  id: string;
  modelId: VehicleModelId;
  cargoType: CargoType;
  wagonCount: number;
  wagonSignature: string;
  ownerColor: string;

  rootGroup: THREE.Group;
  headMeshGroup: THREE.Group;
  wagonGroups: THREE.Group[];
  cargoSlots: CargoVisualSlot[];
  statusBeacon: THREE.Mesh;
  steamPuffs: PlumePuff[];
  dieselPuffs: PlumePuff[];
  steamGear: SteamRunningGear | null;
  wheelPhase: number;

  // Sub-tick 60 FPS interpolation state
  rawX: number;
  rawY: number;
  rawNextX: number;
  rawNextY: number;
  rawProgress: number;
  visualProgress: number;
  estProgressPerSec: number;
  lastRawUpdateMs: number;
  currentYaw: number;
  currentPitch: number;
  currentRoll: number;
  stopOffsetX: number;
  stopOffsetZ: number;

  breadcrumbs: Breadcrumb[];
}

const ISO_CONTAINER_PALETTE = ['#ea580c', '#0284c7', '#15803d', '#b45309', '#be123c'];

function shortestAngleLerp(current: number, target: number, alpha: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * alpha;
}

interface BoxFaceMaterials {
  right: THREE.Material;
  left: THREE.Material;
  top: THREE.Material;
  bottom: THREE.Material;
  front: THREE.Material;
  rear: THREE.Material;
}

export class VehicleRenderer {
  public readonly group = new THREE.Group();

  private instances = new Map<string, VehicleVisualInstance>();
  private readonly textures = new VehicleTexturesManager();

  // Shared unit geometries (zero per-vehicle geometry allocation)
  private readonly boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
  private readonly sphereGeo = new THREE.SphereGeometry(0.5, 10, 10);

  // Material caches cleanly disposed in dispose()
  private readonly matCache = new Map<string, THREE.MeshLambertMaterial>();
  private readonly texMatCache = new Map<string, THREE.MeshLambertMaterial>();
  private readonly steamPuffMats: THREE.MeshBasicMaterial[] = [];
  private readonly dieselPuffMats: THREE.MeshBasicMaterial[] = [];
  private readonly amberBeaconMat: THREE.MeshBasicMaterial;
  private readonly redBeaconMat: THREE.MeshBasicMaterial;
  private readonly cyanBeaconMat: THREE.MeshBasicMaterial;

  // Scratch vectors/matrices for 3D surface tangent orientation
  private readonly vFwd = new THREE.Vector3();
  private readonly vRight = new THREE.Vector3();
  private readonly vUp = new THREE.Vector3();
  private readonly rotMat = new THREE.Matrix4();

  constructor() {
    const steamColors = ['#ffffff', '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#cbd5e1'];
    const steamOpacities = [0.84, 0.72, 0.58, 0.42, 0.26, 0.12];
    for (let i = 0; i < steamColors.length; i++) {
      this.steamPuffMats.push(
        new THREE.MeshBasicMaterial({
          color: steamColors[i],
          transparent: true,
          opacity: steamOpacities[i],
          depthWrite: false,
        })
      );
    }

    const dieselColors = ['#475569', '#64748b', '#94a3b8', '#cbd5e1'];
    const dieselOpacities = [0.42, 0.3, 0.19, 0.09];
    for (let i = 0; i < dieselColors.length; i++) {
      this.dieselPuffMats.push(
        new THREE.MeshBasicMaterial({
          color: dieselColors[i],
          transparent: true,
          opacity: dieselOpacities[i],
          depthWrite: false,
        })
      );
    }

    this.amberBeaconMat = new THREE.MeshBasicMaterial({ color: '#fbbf24' });
    this.redBeaconMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });
    this.cyanBeaconMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });
  }

  private getMat(
    hex: string,
    emissiveHex?: string,
    emissiveIntensity = 0
  ): THREE.MeshLambertMaterial {
    const key = `${hex}|${emissiveHex ?? ''}|${emissiveIntensity}`;
    let m = this.matCache.get(key);
    if (!m) {
      const params: THREE.MeshLambertMaterialParameters = { color: hex };
      if (emissiveHex) {
        params.emissive = new THREE.Color(emissiveHex);
        params.emissiveIntensity = emissiveIntensity;
      }
      m = new THREE.MeshLambertMaterial(params);
      this.matCache.set(key, m);
    }
    return m;
  }

  private getTexMat(
    key: string,
    tex: THREE.CanvasTexture | null,
    fallbackHex: string,
    emissiveHex?: string,
    emissiveIntensity = 0
  ): THREE.MeshLambertMaterial {
    if (!tex) {
      return this.getMat(fallbackHex, emissiveHex, emissiveIntensity);
    }
    let m = this.texMatCache.get(key);
    if (!m) {
      const params: THREE.MeshLambertMaterialParameters = {
        color: '#ffffff',
        map: tex,
      };
      if (emissiveHex) {
        params.emissive = new THREE.Color(emissiveHex);
        params.emissiveIntensity = emissiveIntensity;
      }
      m = new THREE.MeshLambertMaterial(params);
      this.texMatCache.set(key, m);
    }
    return m;
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
    const mesh = new THREE.Mesh(
      this.boxGeo,
      this.getMat(hex, emissiveHex, emissiveIntensity)
    );
    mesh.scale.set(w, h, d);
    mesh.position.set(x, yBottom + h * 0.5, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private addTexturedBox(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    yBottom: number,
    z: number,
    faces: BoxFaceMaterials
  ): THREE.Mesh {
    // BoxGeometry material order: +X (right), -X (left), +Y (top), -Y (bottom), +Z (front), -Z (rear)
    const mats: THREE.Material[] = [
      faces.right,
      faces.left,
      faces.top,
      faces.bottom,
      faces.front,
      faces.rear,
    ];
    const mesh = new THREE.Mesh(this.boxGeo, mats);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, yBottom + h * 0.5, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private addCyl(
    parent: THREE.Object3D,
    radiusX: number,
    radiusZ: number,
    length: number,
    x: number,
    yCenter: number,
    z: number,
    axis: 'X' | 'Y' | 'Z',
    matOrMats: THREE.Material | THREE.Material[]
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.cylGeo, matOrMats);
    if (axis === 'X') {
      mesh.rotation.z = Math.PI * 0.5;
      mesh.scale.set(radiusX * 2, length, radiusZ * 2);
    } else if (axis === 'Z') {
      mesh.rotation.x = Math.PI * 0.5;
      mesh.scale.set(radiusX * 2, length, radiusZ * 2);
    } else {
      mesh.scale.set(radiusX * 2, length, radiusZ * 2);
    }
    mesh.position.set(x, yCenter, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private addSphere(
    parent: THREE.Object3D,
    rx: number,
    ry: number,
    rz: number,
    x: number,
    yCenter: number,
    z: number,
    hex: string,
    emissiveHex?: string,
    emissiveIntensity = 0
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.sphereGeo,
      this.getMat(hex, emissiveHex, emissiveIntensity)
    );
    mesh.scale.set(rx * 2, ry * 2, rz * 2);
    mesh.position.set(x, yCenter, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /**
   * Builds a detailed multi-axle rail bogie with sideframes, axleboxes, transverse steel axles,
   * and flanged steel-rimmed wheels resting directly on `y = 0` (the rail head!).
   */
  private addRailBogie(
    parent: THREE.Object3D,
    zCenter: number,
    axleOffsetsZ: readonly number[],
    wheelRadius = 0.026,
    frameHex = '#1e293b',
    wheelFaceHex = '#334155'
  ): void {
    const minOff = axleOffsetsZ[0];
    const maxOff = axleOffsetsZ[axleOffsetsZ.length - 1];
    const frameLen = maxOff - minOff + wheelRadius * 2.2;

    // Central bogie bolster transom
    this.addBox(
      parent,
      0.24,
      0.024,
      Math.max(0.05, frameLen * 0.45),
      0,
      wheelRadius * 0.85,
      zCenter,
      frameHex
    );

    // Left & right cast-steel bogie sideframes with spring pockets
    for (const side of [-1, 1]) {
      this.addBox(
        parent,
        0.018,
        0.026,
        frameLen,
        side * 0.134,
        wheelRadius * 0.65,
        zCenter,
        frameHex
      );
    }

    const wheelMats = [
      this.getMat('#cbd5e1'), // Gleaming steel tread
      this.getMat(wheelFaceHex),
      this.getMat(wheelFaceHex),
    ];

    for (let i = 0; i < axleOffsetsZ.length; i++) {
      const az = zCenter + axleOffsetsZ[i];
      // Transverse steel axle
      this.addCyl(
        parent,
        0.008,
        0.008,
        0.256,
        0,
        wheelRadius,
        az,
        'X',
        this.getMat('#475569')
      );
      for (const side of [-1, 1]) {
        // Flanged rail wheel sitting at y = wheelRadius (bottom touches y = 0 steel rail!)
        this.addCyl(
          parent,
          wheelRadius,
          wheelRadius,
          0.02,
          side * 0.122,
          wheelRadius,
          az,
          'X',
          wheelMats
        );
        // Outer axlebox bearing cap
        this.addBox(
          parent,
          0.014,
          0.018,
          0.02,
          side * 0.141,
          wheelRadius - 0.009,
          az,
          '#475569'
        );
      }
    }
  }

  /**
   * Builds a classic European buffer beam with twin steel buffers & central drawbar hook.
   */
  private addBufferBeam(
    parent: THREE.Object3D,
    zBeam: number,
    dirSign: 1 | -1,
    width = 0.25,
    yBottom = 0.036,
    beamHex = '#dc2626'
  ): void {
    this.addBox(parent, width, 0.032, 0.018, 0, yBottom, zBeam, beamHex);
    // Central drawbar coupler hook
    this.addBox(
      parent,
      0.026,
      0.016,
      0.026,
      0,
      yBottom + 0.008,
      zBeam + dirSign * 0.014,
      '#0f172a'
    );
    // Twin round steel buffers
    for (const bx of [-0.082, 0.082]) {
      this.addCyl(
        parent,
        0.008,
        0.008,
        0.022,
        bx,
        yBottom + 0.016,
        zBeam + dirSign * 0.012,
        'Z',
        this.getMat('#64748b')
      );
      this.addCyl(
        parent,
        0.016,
        0.016,
        0.007,
        bx,
        yBottom + 0.016,
        zBeam + dirSign * 0.024,
        'Z',
        this.getMat('#1e293b')
      );
    }
  }

  /**
   * Builds a road rubber tire with recessed silver hubcap & wheel arch backing.
   */
  private addRoadWheelPair(
    parent: THREE.Object3D,
    zAxle: number,
    halfTrack = 0.098,
    radius = 0.032,
    tireWidth = 0.026
  ): void {
    const tireMats = [
      this.getMat('#0f172a'),
      this.getMat('#1e293b'),
      this.getMat('#1e293b'),
    ];
    // Steel axle bar
    this.addCyl(
      parent,
      0.009,
      0.009,
      halfTrack * 2,
      0,
      radius,
      zAxle,
      'X',
      this.getMat('#334155')
    );

    for (const side of [-1, 1]) {
      const wx = side * halfTrack;
      this.addCyl(parent, radius, radius, tireWidth, wx, radius, zAxle, 'X', tireMats);
      // Gleaming silver hubcap with lug-nut ring
      this.addCyl(
        parent,
        radius * 0.56,
        radius * 0.56,
        0.006,
        wx + side * (tireWidth * 0.5 + 0.002),
        radius,
        zAxle,
        'X',
        this.getMat('#e2e8f0')
      );
    }
  }

  /**
   * Builds an individual cylindrical barked timber log (`CylinderGeometry`) with pale wood-ring cut ends!
   */
  private createTimberLogMesh(
    radius: number,
    length: number,
    x: number,
    yCenter: number,
    z: number,
    barkHex: string,
    endCapHex = '#fde68a'
  ): THREE.Mesh {
    const mats = [
      this.getMat(barkHex), // Cylindrical bark side
      this.getMat(endCapHex), // +Z cut wood end
      this.getMat(endCapHex), // -Z cut wood end
    ];
    const log = new THREE.Mesh(this.cylGeo, mats);
    log.rotation.x = Math.PI * 0.5;
    log.scale.set(radius * 2, length, radius * 2);
    log.position.set(x, yCenter, z);
    log.castShadow = true;
    log.receiveShadow = true;
    return log;
  }

  /**
   * Aligns an object flush with the continuous 3D heightfield surface at `(wx, wz)` facing `yaw`.
   */
  private apply3DSurfacePose(
    obj: THREE.Object3D,
    state: GameState,
    wx: number,
    wz: number,
    yaw: number,
    baseLift: number
  ): number {
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const sampleFwd = 0.21;
    const sampleLat = 0.12;

    const yCenter = sampleVehicleTravelHeight(state, wx, wz);
    const yFront = sampleVehicleTravelHeight(state, wx + sinY * sampleFwd, wz + cosY * sampleFwd);
    const yBack = sampleVehicleTravelHeight(state, wx - sinY * sampleFwd, wz - cosY * sampleFwd);
    const yRight = sampleVehicleTravelHeight(state, wx + cosY * sampleLat, wz - sinY * sampleLat);
    const yLeft = sampleVehicleTravelHeight(state, wx - cosY * sampleLat, wz + sinY * sampleLat);

    // Avoid dipping through sharp hill crests: support on max of center and wheel axle average
    const axleSupportY = Math.max(yCenter, 0.5 * (yFront + yBack));

    this.vFwd.set(sinY * (sampleFwd * 2), yFront - yBack, cosY * (sampleFwd * 2)).normalize();
    this.vRight
      .set(cosY * (sampleLat * 2), yRight - yLeft, -sinY * (sampleLat * 2))
      .normalize();

    this.vUp.crossVectors(this.vFwd, this.vRight).normalize();
    if (this.vUp.y < 0) this.vUp.negate();
    this.vRight.crossVectors(this.vUp, this.vFwd).normalize();

    this.rotMat.makeBasis(this.vRight, this.vUp, this.vFwd);
    obj.quaternion.setFromRotationMatrix(this.rotMat);
    obj.position.set(
      wx + this.vUp.x * baseLift,
      axleSupportY + this.vUp.y * baseLift,
      wz + this.vUp.z * baseLift
    );

    return axleSupportY + baseLift;
  }

  public update(state: GameState, dtSec: number, nowPerfMs: number): void {
    const dt = Math.min(0.08, Math.max(0.001, dtSec));
    const seenIds = new Set<string>();

    for (let i = 0; i < state.vehicles.length; i++) {
      const v = state.vehicles[i];
      const vc = v as VehicleConsistCompat;
      seenIds.add(v.id);

      const ownerColor = resolveOwnerColor(v.ownerId, state.aiCompanies, state);
      const hasWagonObjs = Boolean(vc.wagons && vc.wagons.length > 0);
      const hasWagonTypes = Boolean(!hasWagonObjs && vc.wt && vc.wt.length > 0);
      const rawCount = hasWagonObjs
        ? vc.wagons!.length
        : hasWagonTypes
          ? vc.wt!.length
          : v.wagonCount || 0;
      const wagonCount = v.network === 'RAIL' ? Math.max(0, Math.min(8, rawCount)) : 0;

      const wagonSignature =
        v.network === 'RAIL'
          ? hasWagonObjs
            ? vc.wagons!
                .slice(0, wagonCount)
                .map((w) => w.cargoType)
                .join(',')
            : hasWagonTypes
              ? vc.wt!.slice(0, wagonCount).join(',')
              : `${v.cargoType}x${wagonCount}`
          : v.cargoType;

      let inst = this.instances.get(v.id);
      if (
        !inst ||
        inst.modelId !== v.modelId ||
        inst.cargoType !== v.cargoType ||
        inst.wagonCount !== wagonCount ||
        inst.wagonSignature !== wagonSignature ||
        inst.ownerColor !== ownerColor
      ) {
        if (inst) {
          this.group.remove(inst.rootGroup);
        }
        inst = this.createVehicleInstance(
          vc,
          ownerColor,
          wagonCount,
          wagonSignature,
          nowPerfMs
        );
        this.instances.set(v.id, inst);
        this.group.add(inst.rootGroup);
      }

      if (v.state === 'IN_DEPOT') {
        inst.rootGroup.visible = false;
        continue;
      }
      inst.rootGroup.visible = true;

      // Dynamic OpenTTD empty-vs-loaded cargo fill visualization (per-wagon on trains!)
      const defaultFillRatio = Math.max(
        0,
        Math.min(1, v.cargoAmount / Math.max(1, v.capacity))
      );
      this.applyCargoFillState(inst, vc, defaultFillRatio);

      // Status beacon above loading, signal-waiting, or stopped vehicles
      if (v.state === 'WAITING_SIGNAL') {
        inst.statusBeacon.visible = true;
        inst.statusBeacon.material = this.amberBeaconMat;
      } else if (v.state === 'STOPPED') {
        inst.statusBeacon.visible = true;
        inst.statusBeacon.material = this.redBeaconMat;
      } else if (v.state === 'LOADING') {
        inst.statusBeacon.visible = true;
        inst.statusBeacon.material = this.cyanBeaconMat;
      } else {
        inst.statusBeacon.visible = false;
      }

      // Sub-tick velocity tracking calibrated for realistic TTD speeds
      const tileChanged =
        v.x !== inst.rawX ||
        v.y !== inst.rawY ||
        v.nextX !== inst.rawNextX ||
        v.nextY !== inst.rawNextY;
      const progChanged = Math.abs(v.progress - inst.rawProgress) > 1e-4;

      if (tileChanged || progChanged) {
        const elapsedSec = Math.max(0.016, (nowPerfMs - inst.lastRawUpdateMs) / 1000);
        let deltaProg = v.progress - inst.rawProgress;
        if (tileChanged && deltaProg < 0) {
          deltaProg += 1.0;
        }
        if (deltaProg > 0 && deltaProg < 1.2 && elapsedSec < 1.2) {
          const measuredRate = deltaProg / elapsedSec;
          inst.estProgressPerSec = THREE.MathUtils.lerp(
            inst.estProgressPerSec,
            THREE.MathUtils.clamp(measuredRate, 0.08, 14),
            0.45
          );
        }

        if (tileChanged) {
          if (inst.visualProgress > 0.6 && v.progress < 0.45) {
            inst.visualProgress = Math.max(0, v.progress);
          } else {
            inst.visualProgress = v.progress;
          }
        }

        inst.rawX = v.x;
        inst.rawY = v.y;
        inst.rawNextX = v.nextX;
        inst.rawNextY = v.nextY;
        inst.rawProgress = v.progress;
        inst.lastRawUpdateMs = nowPerfMs;
      }

      const isMoving =
        v.state === 'MOVING' && state.speed > 0 && (v.nextX !== v.x || v.nextY !== v.y);

      if (isMoving) {
        const fallbackRate = ((v.speedKmh || v.maxSpeedKmh || 56) / 62) * state.speed;
        const rate = inst.estProgressPerSec > 0.04 ? inst.estProgressPerSec : fallbackRate;
        const maxLead = Math.min(0.992, inst.rawProgress + 0.2);
        inst.visualProgress = Math.min(maxLead, inst.visualProgress + rate * dt);
        if (inst.visualProgress < inst.rawProgress) {
          inst.visualProgress = THREE.MathUtils.lerp(
            inst.visualProgress,
            inst.rawProgress,
            1 - Math.exp(-18 * dt)
          );
        }
      } else {
        inst.visualProgress = THREE.MathUtils.lerp(
          inst.visualProgress,
          THREE.MathUtils.clamp(v.progress, 0, 1),
          1 - Math.exp(-16 * dt)
        );
      }

      const t = THREE.MathUtils.clamp(inst.visualProgress, 0, 1);
      const baseLift = v.network === 'RAIL' ? 0.056 : 0.03;

      let wx = v.x + (v.nextX - v.x) * t;
      let wz = v.y + (v.nextY - v.y) * t;

      const dx = v.nextX - v.x;
      const dz = v.nextY - v.y;
      if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
        const targetYaw = Math.atan2(dx, dz);
        inst.currentYaw = shortestAngleLerp(
          inst.currentYaw,
          targetYaw,
          1 - Math.exp(-16 * dt)
        );
      }

      // Subtle right-hand lane offset on roads, and OpenTTD front-buffer pull-in at train stations
      if (v.network === 'ROAD') {
        const rightX = Math.cos(inst.currentYaw);
        const rightZ = -Math.sin(inst.currentYaw);
        wx += rightX * 0.1;
        wz += rightZ * 0.1;
      } else if (v.network === 'RAIL') {
        let targetPullMag = 0;
        if (v.state === 'LOADING') {
          targetPullMag = TRAIN_STATION_STOP_OFFSET;
        } else if (v.state === 'MOVING' && !v.goingToDepot) {
          if (v.nextX === v.x && v.nextY === v.y && isTrainStationTile(state, v.x, v.y)) {
            targetPullMag = TRAIN_STATION_STOP_OFFSET;
          } else if (
            (v.nextX !== v.x || v.nextY !== v.y) &&
            (!v.path || v.path.length <= 1) &&
            isTrainStationTile(state, v.nextX, v.nextY)
          ) {
            targetPullMag =
              THREE.MathUtils.clamp((t - 0.35) / 0.65, 0, 1) *
              (TRAIN_STATION_STOP_OFFSET * 0.8);
          }
        }
        const targetOffX = Math.sin(inst.currentYaw) * targetPullMag;
        const targetOffZ = Math.cos(inst.currentYaw) * targetPullMag;
        const pullLerp = 1 - Math.exp((targetPullMag > 0 ? -10 : -6) * dt);
        inst.stopOffsetX = THREE.MathUtils.lerp(inst.stopOffsetX, targetOffX, pullLerp);
        inst.stopOffsetZ = THREE.MathUtils.lerp(inst.stopOffsetZ, targetOffZ, pullLerp);
        wx += inst.stopOffsetX;
        wz += inst.stopOffsetZ;
      }

      const wy = this.apply3DSurfacePose(
        inst.headMeshGroup,
        state,
        wx,
        wz,
        inst.currentYaw,
        baseLift
      );

      inst.statusBeacon.position.set(wx, wy + 0.36 + 0.03 * Math.sin(nowPerfMs * 0.008), wz);

      // Update locomotive breadcrumbs & orient trailing rail wagons flush along 3D slopes
      if (v.network === 'RAIL') {
        this.recordBreadcrumb(inst, wx, wz);
        this.updateTrailingWagons(inst, state, baseLift);
      }

      // Animate steam locomotive side connecting rods & 6 billowing steam puffs
      if (v.modelId === 'LOCO_STEAM') {
        if (inst.steamGear) {
          this.updateSteamRunningGear(inst, isMoving, state.speed, dt);
        }
        if (inst.steamPuffs.length > 0) {
          this.updateSteamPlume(
            inst,
            wx,
            wy,
            wz,
            isMoving,
            state.speed > 0 && v.state !== 'STOPPED',
            dt
          );
        }
      } else if (v.modelId === 'LOCO_DIESEL' && inst.dieselPuffs.length > 0) {
        this.updateDieselExhaust(inst, wx, wy, wz, isMoving, dt);
      }
    }

    for (const [id, inst] of this.instances.entries()) {
      if (!seenIds.has(id)) {
        this.group.remove(inst.rootGroup);
        this.instances.delete(id);
      }
    }
  }

  private applyCargoFillState(
    inst: VehicleVisualInstance,
    vc: VehicleConsistCompat,
    defaultFillRatio: number
  ): void {
    for (let s = 0; s < inst.cargoSlots.length; s++) {
      const slot = inst.cargoSlots[s];
      let fillRatio = defaultFillRatio;
      if (slot.wagonIndex !== undefined) {
        const wagon = vc.wagons?.[slot.wagonIndex];
        if (wagon) {
          fillRatio = Math.max(
            0,
            Math.min(1, wagon.cargoAmount / Math.max(1, wagon.capacity))
          );
        }
      }

      if (slot.kind === 'HEAP') {
        if (fillRatio <= 0.015) {
          slot.group.visible = false;
        } else {
          slot.group.visible = true;
          slot.group.scale.set(
            0.9 + 0.1 * fillRatio,
            0.14 + 0.86 * fillRatio,
            0.92 + 0.08 * fillRatio
          );
        }
      } else {
        for (let idx = 0; idx < slot.items.length; idx++) {
          const item = slot.items[idx];
          item.obj.visible = fillRatio >= item.threshold;
        }
      }
    }
  }

  private createVehicleInstance(
    v: VehicleConsistCompat,
    ownerColor: string,
    wagonCount: number,
    wagonSignature: string,
    nowPerfMs: number
  ): VehicleVisualInstance {
    const rootGroup = new THREE.Group();
    const headMeshGroup = new THREE.Group();
    rootGroup.add(headMeshGroup);

    const cargoSlots: CargoVisualSlot[] = [];
    const steamPuffs: PlumePuff[] = [];
    const dieselPuffs: PlumePuff[] = [];
    let steamGear: SteamRunningGear | null = null;

    if (v.modelId === 'LOCO_STEAM') {
      steamGear = this.buildSteamLocoAndTender(headMeshGroup, ownerColor);
      for (let p = 0; p < 6; p++) {
        const pm = new THREE.Mesh(this.sphereGeo, this.steamPuffMats[0]);
        pm.visible = false;
        rootGroup.add(pm);
        steamPuffs.push({
          mesh: pm,
          age: p / 6,
          driftSign: p % 2 === 0 ? 1 : -1,
          spawned: false,
        });
      }
    } else if (v.modelId === 'LOCO_DIESEL') {
      this.buildDieselNohabLoco(headMeshGroup, ownerColor);
      for (let p = 0; p < 4; p++) {
        const dm = new THREE.Mesh(this.sphereGeo, this.dieselPuffMats[0]);
        dm.visible = false;
        rootGroup.add(dm);
        dieselPuffs.push({
          mesh: dm,
          age: p * 0.25,
          driftSign: p % 2 === 0 ? 1 : -1,
          spawned: false,
        });
      }
    } else if (v.modelId === 'LOCO_ELECTRIC') {
      this.buildElectricExpressLoco(headMeshGroup, ownerColor);
    } else if (v.modelId === 'BUS_CITY') {
      this.buildCityBus(headMeshGroup, ownerColor);
    } else {
      this.buildCargoTruck(headMeshGroup, v.cargoType, ownerColor, cargoSlots);
    }

    const wagonGroups: THREE.Group[] = [];
    for (let w = 0; w < wagonCount; w++) {
      const wg = new THREE.Group();
      const wCargo = v.wagons?.[w]?.cargoType ?? v.wt?.[w] ?? v.cargoType;
      wg.userData = { wagonIndex: w, cargoType: wCargo };
      this.buildWagonMesh(wg, wCargo, ownerColor, w, cargoSlots);
      rootGroup.add(wg);
      wagonGroups.push(wg);
    }

    const statusBeacon = new THREE.Mesh(this.sphereGeo, this.amberBeaconMat);
    statusBeacon.scale.set(0.085, 0.085, 0.085);
    statusBeacon.visible = false;
    rootGroup.add(statusBeacon);

    let initYaw = 0;
    if (v.nextX !== v.x || v.nextY !== v.y) {
      initYaw = Math.atan2(v.nextX - v.x, v.nextY - v.y);
    } else if (
      v.trail &&
      v.trail.length > 0 &&
      (v.trail[0].x !== v.x || v.trail[0].y !== v.y)
    ) {
      initYaw = Math.atan2(v.x - v.trail[0].x, v.y - v.trail[0].y);
    } else if (typeof v.direction === 'number') {
      initYaw = Math.atan2(Math.cos(v.direction), Math.sin(v.direction));
    }

    const initPullMag =
      v.network === 'RAIL' && v.state === 'LOADING' ? TRAIN_STATION_STOP_OFFSET : 0;
    const initStopOffsetX = Math.sin(initYaw) * initPullMag;
    const initStopOffsetZ = Math.cos(initYaw) * initPullMag;

    const breadcrumbs: Breadcrumb[] = [
      { x: v.x + initStopOffsetX, z: v.y + initStopOffsetZ },
    ];
    if (v.trail && v.trail.length > 0) {
      for (let tIdx = 0; tIdx < v.trail.length; tIdx++) {
        breadcrumbs.push({ x: v.trail[tIdx].x, z: v.trail[tIdx].y });
      }
    }
    const backX = -Math.sin(initYaw);
    const backZ = -Math.cos(initYaw);
    const tail = breadcrumbs[breadcrumbs.length - 1];
    for (let step = 1; step <= 20; step++) {
      breadcrumbs.push({
        x: tail.x + backX * step * 0.26,
        z: tail.z + backZ * step * 0.26,
      });
    }

    return {
      id: v.id,
      modelId: v.modelId,
      cargoType: v.cargoType,
      wagonCount,
      wagonSignature,
      ownerColor,
      rootGroup,
      headMeshGroup,
      wagonGroups,
      cargoSlots,
      statusBeacon,
      steamPuffs,
      dieselPuffs,
      steamGear,
      wheelPhase: 0,
      rawX: v.x,
      rawY: v.y,
      rawNextX: v.nextX,
      rawNextY: v.nextY,
      rawProgress: v.progress,
      visualProgress: v.progress,
      estProgressPerSec: 0,
      lastRawUpdateMs: nowPerfMs,
      currentYaw: initYaw,
      currentPitch: 0,
      currentRoll: 0,
      stopOffsetX: initStopOffsetX,
      stopOffsetZ: initStopOffsetZ,
      breadcrumbs,
    };
  }

  // ============================================================================
  // 1. LOCO_STEAM: NSB Type 26 Damplok + Closely Coupled Coal Tender
  // ============================================================================
  private buildSteamLocoAndTender(
    parent: THREE.Group,
    ownerColor: string
  ): SteamRunningGear {
    // --- A. Locomotive Main Frame, Cowcatcher & Buffer Beam (z = -0.06 .. +0.30) ---
    this.addBox(parent, 0.21, 0.036, 0.35, 0, 0.032, 0.115, '#b91c1c');
    // Side running boards with crisp red valance trim
    for (const side of [-1, 1]) {
      this.addBox(parent, 0.034, 0.016, 0.34, side * 0.122, 0.082, 0.11, '#dc2626');
      this.addBox(parent, 0.036, 0.008, 0.34, side * 0.122, 0.098, 0.11, '#27272a');
    }

    // Front red buffer beam + twin steel buffers
    this.addBufferBeam(parent, 0.292, 1, 0.26, 0.038, '#dc2626');

    // Angled steel cowcatcher / pilot bars beneath front buffer beam
    const pilotGroup = new THREE.Group();
    pilotGroup.position.set(0, 0.022, 0.305);
    pilotGroup.rotation.x = 0.45;
    this.addBox(pilotGroup, 0.22, 0.028, 0.022, 0, 0, 0, '#991b1b');
    for (const px of [-0.08, -0.04, 0, 0.04, 0.08]) {
      this.addBox(pilotGroup, 0.012, 0.036, 0.026, px, -0.004, 0.008, '#cbd5e1');
    }
    parent.add(pilotGroup);

    // Front pilot wheels (pony truck at z = +0.262)
    const pilotWheelMats = [
      this.getMat('#e2e8f0'),
      this.getMat('#dc2626'),
      this.getMat('#dc2626'),
    ];
    this.addCyl(parent, 0.008, 0.008, 0.25, 0, 0.022, 0.262, 'X', this.getMat('#475569'));
    for (const side of [-1, 1]) {
      this.addCyl(
        parent,
        0.022,
        0.022,
        0.018,
        side * 0.122,
        0.022,
        0.262,
        'X',
        pilotWheelMats
      );
    }

    // 3 Pairs of Iconic Red Driving Wheels (z = +0.025, +0.105, +0.185)
    const driveWheelR = 0.04;
    const driveWheelMats = [
      this.getMat('#e2e8f0'), // Steel rim
      this.getMat('#dc2626'), // Classic TTD red wheel spokes/center
      this.getMat('#dc2626'),
    ];
    for (const wz of [0.025, 0.105, 0.185]) {
      this.addCyl(
        parent,
        0.01,
        0.01,
        0.254,
        0,
        driveWheelR,
        wz,
        'X',
        this.getMat('#334155')
      );
      for (const side of [-1, 1]) {
        this.addCyl(
          parent,
          driveWheelR,
          driveWheelR,
          0.022,
          side * 0.124,
          driveWheelR,
          wz,
          'X',
          driveWheelMats
        );
        // Steel crankpin / counterweight boss
        this.addCyl(
          parent,
          0.013,
          0.013,
          0.006,
          side * 0.137,
          driveWheelR,
          wz,
          'X',
          this.getMat('#cbd5e1')
        );
      }
    }

    // Twin External Steam Cylinders & Valve Chests ahead of driving wheels
    for (const side of [-1, 1]) {
      this.addCyl(
        parent,
        0.026,
        0.026,
        0.068,
        side * 0.136,
        0.044,
        0.238,
        'Z',
        this.getMat('#18181b')
      );
      this.addCyl(
        parent,
        0.028,
        0.028,
        0.008,
        side * 0.136,
        0.044,
        0.272,
        'Z',
        this.getMat('#eab308')
      );
    }

    // Animated Steel Side Connecting Rods & Reciprocating Piston Rods!
    const rodBaseY = driveWheelR;
    const rodBaseZ = 0.105;
    const pistonBaseZ = 0.195;
    const leftRod = this.addBox(
      parent,
      0.009,
      0.013,
      0.19,
      -0.144,
      rodBaseY - 0.0065,
      rodBaseZ,
      '#e2e8f0'
    );
    const rightRod = this.addBox(
      parent,
      0.009,
      0.013,
      0.19,
      0.144,
      rodBaseY - 0.0065,
      rodBaseZ,
      '#e2e8f0'
    );
    const leftPiston = this.addBox(
      parent,
      0.011,
      0.016,
      0.075,
      -0.142,
      0.036,
      pistonBaseZ,
      '#cbd5e1'
    );
    const rightPiston = this.addBox(
      parent,
      0.011,
      0.016,
      0.075,
      0.142,
      0.036,
      pistonBaseZ,
      '#cbd5e1'
    );

    // --- B. Cylindrical Black Steel Boiler, Brass Bands, Smokebox, Domes & Cab ---
    // Firebox saddle
    this.addBox(parent, 0.18, 0.09, 0.12, 0, 0.09, 0.04, '#18181b');
    // Main black steel boiler barrel
    this.addCyl(
      parent,
      0.092,
      0.092,
      0.24,
      0,
      0.168,
      0.115,
      'Z',
      this.getMat('#18181b')
    );
    // 3 Gleaming Brass Boiler Bands!
    for (const bz of [0.025, 0.1, 0.175]) {
      this.addCyl(
        parent,
        0.095,
        0.095,
        0.009,
        0,
        0.168,
        bz,
        'Z',
        this.getMat('#eab308')
      );
    }

    // Graphite/Silver Smokebox at front (z = +0.21 .. +0.275) + dished silver smokebox door
    this.addCyl(
      parent,
      0.095,
      0.095,
      0.068,
      0,
      0.168,
      0.242,
      'Z',
      this.getMat('#334155')
    );
    this.addSphere(parent, 0.076, 0.076, 0.018, 0, 0.168, 0.276, '#94a3b8');

    // Glowing Brass-Rimmed Center Headlamp + twin lower marker lamps
    this.addCyl(
      parent,
      0.024,
      0.024,
      0.024,
      0,
      0.172,
      0.288,
      'Z',
      this.getMat('#eab308')
    );
    this.addSphere(
      parent,
      0.018,
      0.018,
      0.01,
      0,
      0.172,
      0.299,
      '#fef08a',
      '#fde047',
      0.95
    );
    for (const side of [-1, 1]) {
      this.addBox(
        parent,
        0.02,
        0.02,
        0.014,
        side * 0.088,
        0.075,
        0.292,
        '#fef08a',
        '#fde047',
        0.7
      );
    }

    // Flared Cast-Iron Smokestack / Chimney with brass crown lip (z = +0.235)
    this.addCyl(
      parent,
      0.028,
      0.028,
      0.085,
      0,
      0.272,
      0.235,
      'Y',
      this.getMat('#09090b')
    );
    this.addCyl(
      parent,
      0.038,
      0.038,
      0.016,
      0,
      0.312,
      0.235,
      'Y',
      this.getMat('#ca8a04')
    );

    // Polished Brass Steam Dome (z = +0.135) + Sand Dome (z = +0.055) + Brass Safety Whistle
    this.addCyl(
      parent,
      0.038,
      0.038,
      0.042,
      0,
      0.258,
      0.135,
      'Y',
      this.getMat('#eab308')
    );
    this.addSphere(parent, 0.038, 0.028, 0.038, 0, 0.278, 0.135, '#eab308');

    this.addCyl(
      parent,
      0.033,
      0.033,
      0.036,
      0,
      0.255,
      0.055,
      'Y',
      this.getMat('#27272a')
    );
    this.addSphere(parent, 0.033, 0.022, 0.033, 0, 0.272, 0.055, '#ca8a04');
    // Brass safety valves before cab
    this.addCyl(
      parent,
      0.012,
      0.012,
      0.03,
      0,
      0.262,
      0.005,
      'Y',
      this.getMat('#facc15')
    );

    // Engineer's Cab (z = -0.075 .. +0.005) with framed windows & company-colored roof/trim
    this.addBox(parent, 0.26, 0.175, 0.09, 0, 0.082, -0.035, '#18181b');
    // Company-colored cab waist panel & brass numberplate
    this.addBox(parent, 0.266, 0.055, 0.082, 0, 0.092, -0.035, ownerColor);
    this.addBox(parent, 0.27, 0.02, 0.038, 0, 0.11, -0.035, '#eab308');
    // Framed cab side windows + front spectacle windows
    this.addBox(
      parent,
      0.268,
      0.052,
      0.052,
      0,
      0.176,
      -0.035,
      '#bae6fd',
      '#38bdf8',
      0.35
    );
    for (const side of [-1, 1]) {
      this.addBox(
        parent,
        0.044,
        0.044,
        0.012,
        side * 0.078,
        0.182,
        0.011,
        '#bae6fd',
        '#38bdf8',
        0.3
      );
    }
    // Arched company-colored cab roof + raised ventilator hatch
    this.addBox(parent, 0.276, 0.022, 0.11, 0, 0.256, -0.036, ownerColor);
    this.addBox(
      parent,
      0.16,
      0.014,
      0.095,
      0,
      0.276,
      -0.036,
      shadeHex(ownerColor, 1.18)
    );

    // --- C. Closely-Coupled Coal Tender (z = -0.295 .. -0.095) ---
    // Footplate & drawbar coupling between loco cab and tender
    this.addBox(parent, 0.14, 0.024, 0.05, 0, 0.055, -0.085, '#1e293b');
    // 2-Axle Tender Bogie / Running Gear
    this.addRailBogie(parent, -0.195, [-0.055, 0.055], 0.028, '#1e293b', '#dc2626');
    // Rear tender buffer beam + twin steel buffers + red tail lamp
    this.addBufferBeam(parent, -0.295, -1, 0.25, 0.038, '#dc2626');
    this.addBox(parent, 0.024, 0.022, 0.012, 0, 0.082, -0.302, '#ef4444', '#dc2626', 0.85);

    // Tender water tank body with company-colored livery panel & brass trim
    this.addBox(parent, 0.25, 0.135, 0.19, 0, 0.07, -0.195, '#18181b');
    this.addBox(parent, 0.256, 0.068, 0.174, 0, 0.095, -0.195, ownerColor);
    this.addBox(parent, 0.258, 0.01, 0.178, 0, 0.165, -0.195, '#eab308');
    // Flared top coal bunker coaming walls
    this.addBox(parent, 0.24, 0.028, 0.18, 0, 0.205, -0.195, '#27272a');

    // Real 3D Heaped Black Anthracite Coal Load piled inside the tender!
    this.addBox(parent, 0.21, 0.032, 0.16, 0, 0.215, -0.195, '#09090b');
    this.addSphere(parent, 0.095, 0.042, 0.075, 0, 0.242, -0.185, '#18181b');
    this.addSphere(parent, 0.075, 0.036, 0.055, -0.02, 0.248, -0.22, '#09090b');
    this.addSphere(parent, 0.068, 0.034, 0.05, 0.025, 0.245, -0.155, '#27272a');

    return {
      leftRod,
      rightRod,
      leftPiston,
      rightPiston,
      rodBaseY,
      rodBaseZ,
      pistonBaseZ,
    };
  }

  // ============================================================================
  // 2. LOCO_DIESEL: NSB Di 3 Nohab Bulldog Diesel
  // ============================================================================
  private buildDieselNohabLoco(parent: THREE.Group, ownerColor: string): void {
    // Twin 3-Axle Co-Co Heavy Bogies (6 dark-steel wheelsets total!)
    this.addRailBogie(parent, 0.15, [-0.056, 0, 0.056], 0.026, '#1e293b', '#334155');
    this.addRailBogie(parent, -0.15, [-0.056, 0, 0.056], 0.026, '#1e293b', '#334155');

    // Heavy underframe fuel & battery tank slung between the twin 3-axle bogies
    this.addBox(parent, 0.23, 0.044, 0.125, 0, 0.022, 0, '#0f172a');
    this.addCyl(parent, 0.02, 0.02, 0.11, 0.112, 0.045, 0, 'Z', this.getMat('#334155'));
    this.addCyl(parent, 0.02, 0.02, 0.11, -0.112, 0.045, 0, 'Z', this.getMat('#334155'));

    // Front & rear red buffer beams + snowplow skirts
    this.addBufferBeam(parent, 0.272, 1, 0.26, 0.036, '#dc2626');
    this.addBufferBeam(parent, -0.272, -1, 0.26, 0.036, '#dc2626');
    this.addBox(parent, 0.24, 0.024, 0.02, 0, 0.018, 0.268, '#334155');
    this.addBox(parent, 0.24, 0.024, 0.02, 0, 0.018, -0.268, '#334155');

    // Main Textured Carbody (round porthole engine windows, louvre grilles, cheatlines & cab doors)
    const sideTex = this.textures.getDieselSideTexture(ownerColor);
    const sideMat = this.getTexMat(`diesel-side:${ownerColor}`, sideTex, ownerColor);
    const roofBaseMat = this.getMat(shadeHex(ownerColor, 0.85));
    const underMat = this.getMat('#0f172a');
    const bodyEndMat = this.getMat(ownerColor);

    this.addTexturedBox(parent, 0.274, 0.165, 0.37, 0, 0.066, 0, {
      right: sideMat,
      left: sideMat,
      top: roofBaseMat,
      bottom: underMat,
      front: bodyEndMat,
      rear: bodyEndMat,
    });

    // Iconic Sculpted Rounded Nohab Bulldog Noses at Front (+Z) & Rear (-Z)!
    for (const dir of [1, -1] as const) {
      // Lower rounded Bulldog nose bonnet
      this.addBox(
        parent,
        0.258,
        0.095,
        0.068,
        0,
        0.066,
        dir * 0.212,
        ownerColor
      );
      this.addSphere(
        parent,
        0.128,
        0.052,
        0.052,
        0,
        0.116,
        dir * 0.238,
        ownerColor
      );
      // Classic Nohab cream/amber winged V-band wrapping around the Bulldog nose!
      this.addSphere(
        parent,
        0.131,
        0.02,
        0.054,
        0,
        0.106,
        dir * 0.24,
        '#fef3c7'
      );
      this.addSphere(
        parent,
        0.132,
        0.009,
        0.055,
        0,
        0.095,
        dir * 0.241,
        '#f59e0b'
      );

      // Stepped cab forehead & angled twin Nohab windshields with center divider post
      this.addBox(
        parent,
        0.254,
        0.068,
        0.042,
        0,
        0.16,
        dir * 0.194,
        ownerColor
      );
      const glassGroup = new THREE.Group();
      glassGroup.position.set(0, 0.192, dir * 0.214);
      glassGroup.rotation.x = dir * -0.3;
      for (const side of [-1, 1]) {
        this.addBox(
          glassGroup,
          0.092,
          0.044,
          0.014,
          side * 0.058,
          -0.022,
          0,
          '#bae6fd',
          '#38bdf8',
          0.35
        );
      }
      // Center windshield mullion
      this.addBox(glassGroup, 0.018, 0.048, 0.018, 0, -0.024, 0, ownerColor);
      parent.add(glassGroup);

      // Sculpted rounded cab roof brow + upper center Nohab nose headlamp!
      this.addSphere(
        parent,
        0.118,
        0.028,
        0.05,
        0,
        0.232,
        dir * 0.188,
        shadeHex(ownerColor, 1.08)
      );

      if (dir === 1) {
        // Triple Nose Headlights: 1 upper center + 2 lower nose headlamps!
        this.addCyl(
          parent,
          0.019,
          0.019,
          0.024,
          0,
          0.228,
          0.222,
          'Z',
          this.getMat('#334155')
        );
        this.addSphere(
          parent,
          0.015,
          0.015,
          0.008,
          0,
          0.228,
          0.234,
          '#fef08a',
          '#fde047',
          0.95
        );
        for (const side of [-1, 1]) {
          this.addSphere(
            parent,
            0.016,
            0.016,
            0.01,
            side * 0.068,
            0.114,
            0.278,
            '#fef08a',
            '#fde047',
            0.9
          );
        }
      } else {
        // Rear upper housing + twin red tail marker lamps
        this.addCyl(
          parent,
          0.017,
          0.017,
          0.02,
          0,
          0.228,
          -0.22,
          'Z',
          this.getMat('#334155')
        );
        for (const side of [-1, 1]) {
          this.addSphere(
            parent,
            0.014,
            0.014,
            0.009,
            side * 0.068,
            0.114,
            -0.278,
            '#ef4444',
            '#dc2626',
            0.85
          );
        }
      }
    }

    // Arched Rooftop Spine + 2 Circular Radiator Cooling Fan Grilles + Exhaust Stack + Horns
    this.addBox(
      parent,
      0.22,
      0.022,
      0.35,
      0,
      0.231,
      0,
      shadeHex(ownerColor, 1.08)
    );
    for (const fz of [-0.085, 0.095]) {
      this.addCyl(
        parent,
        0.048,
        0.048,
        0.012,
        0,
        0.256,
        fz,
        'Y',
        this.getMat('#334155')
      );
      this.addCyl(
        parent,
        0.038,
        0.038,
        0.015,
        0,
        0.257,
        fz,
        'Y',
        this.getMat('#0f172a')
      );
      this.addBox(parent, 0.068, 0.006, 0.01, 0, 0.262, fz, '#64748b');
      this.addBox(parent, 0.01, 0.006, 0.068, 0, 0.262, fz, '#64748b');
    }
    // Central diesel exhaust stack & brass air horns
    this.addBox(parent, 0.055, 0.024, 0.042, 0, 0.252, 0.01, '#1e293b');
    this.addCyl(parent, 0.016, 0.016, 0.02, 0, 0.272, 0.01, 'Y', this.getMat('#09090b'));
    for (const hx of [-0.045, 0.045]) {
      this.addCyl(parent, 0.007, 0.007, 0.028, hx, 0.258, 0.155, 'Z', this.getMat('#eab308'));
    }
  }

  // ============================================================================
  // 3. LOCO_ELECTRIC: NSB El 18 Express Electric
  // ============================================================================
  private buildElectricExpressLoco(parent: THREE.Group, ownerColor: string): void {
    // Twin Detailed 2-Axle High-Speed Bogies + Underframe Main Transformer
    this.addRailBogie(parent, 0.152, [-0.045, 0.045], 0.027, '#1e293b', '#475569');
    this.addRailBogie(parent, -0.152, [-0.045, 0.045], 0.027, '#1e293b', '#475569');
    this.addBox(parent, 0.22, 0.042, 0.13, 0, 0.024, 0, '#334155');

    // Aerodynamic Dark-Grey Rail Snowplows + Buffers at Both Ends
    this.addBufferBeam(parent, 0.272, 1, 0.255, 0.038, '#1e293b');
    this.addBufferBeam(parent, -0.272, -1, 0.255, 0.038, '#1e293b');
    for (const dir of [1, -1] as const) {
      const plow = new THREE.Group();
      plow.position.set(0, 0.024, dir * 0.27);
      plow.rotation.x = dir * 0.38;
      this.addBox(plow, 0.245, 0.03, 0.022, 0, -0.012, 0, '#334155');
      parent.add(plow);
    }

    // Main Streamlined Carbody with Textured El 18 Express Livery
    const sideTex = this.textures.getElectricSideTexture(ownerColor);
    const sideMat = this.getTexMat(`elec-side:${ownerColor}`, sideTex, ownerColor);
    const roofRimMat = this.getMat('#f1f5f9');
    const underMat = this.getMat('#0f172a');
    const noseCapMat = this.getMat(ownerColor);

    this.addTexturedBox(parent, 0.274, 0.16, 0.39, 0, 0.064, 0, {
      right: sideMat,
      left: sideMat,
      top: roofRimMat,
      bottom: underMat,
      front: noseCapMat,
      rear: noseCapMat,
    });

    // Aerodynamic Raked Cab Noses & Flush Panoramic Windshields at Both Ends
    for (const dir of [1, -1] as const) {
      // Lower nose wedge
      this.addBox(parent, 0.266, 0.078, 0.068, 0, 0.064, dir * 0.224, ownerColor);
      this.addBox(parent, 0.268, 0.018, 0.07, 0, 0.092, dir * 0.225, '#f1f5f9');

      // Sloped upper aerodynamic wedge + flush dark-tinted cab windshield
      const rakeGroup = new THREE.Group();
      rakeGroup.position.set(0, 0.142, dir * 0.254);
      rakeGroup.rotation.x = dir * -0.52;
      this.addBox(rakeGroup, 0.258, 0.095, 0.052, 0, 0, dir * -0.024, '#f1f5f9');
      this.addBox(
        rakeGroup,
        0.226,
        0.062,
        0.016,
        0,
        0.018,
        dir * 0.003,
        '#0f172a',
        '#0ea5e9',
        0.35
      );
      // Windshield glass highlight strip
      this.addBox(
        rakeGroup,
        0.205,
        0.018,
        0.018,
        0,
        0.048,
        dir * 0.004,
        '#7dd3fc',
        '#38bdf8',
        0.45
      );
      parent.add(rakeGroup);

      if (dir === 1) {
        // Twin Bright Halogen/LED Headlights + Top High-Beam
        for (const side of [-1, 1]) {
          this.addBox(
            parent,
            0.042,
            0.022,
            0.014,
            side * 0.082,
            0.098,
            0.258,
            '#e0f2fe',
            '#38bdf8',
            0.95
          );
        }
        this.addBox(
          parent,
          0.036,
          0.016,
          0.014,
          0,
          0.208,
          0.205,
          '#fef08a',
          '#fde047',
          0.9
        );
      } else {
        // Twin Glowing Red Rear Tail-Lamps
        for (const side of [-1, 1]) {
          this.addBox(
            parent,
            0.04,
            0.02,
            0.014,
            side * 0.082,
            0.098,
            -0.258,
            '#ef4444',
            '#dc2626',
            0.9
          );
        }
      }
    }

    // Recessed Dark-Grey Roof Equipment Bay with Orange HV Busbars & Ceramic Insulators
    this.addBox(parent, 0.21, 0.016, 0.34, 0, 0.224, 0, '#1e293b');
    // Side silver roof shrouds
    for (const side of [-1, 1]) {
      this.addBox(parent, 0.028, 0.022, 0.36, side * 0.12, 0.224, 0, '#e2e8f0');
    }

    // Ceramic brown/white insulators + bright orange high-voltage busbars!
    for (const iz of [-0.15, -0.05, 0.05, 0.15]) {
      for (const ix of [-0.048, 0.048]) {
        this.addCyl(
          parent,
          0.01,
          0.01,
          0.022,
          ix,
          0.246,
          iz,
          'Y',
          this.getMat('#9a3412')
        );
      }
    }
    // Orange HV busbar conduits connecting equipment bay
    this.addBox(parent, 0.012, 0.01, 0.3, 0.048, 0.256, 0, '#f97316', '#ea580c', 0.3);
    this.addBox(parent, 0.096, 0.01, 0.012, 0, 0.256, 0, '#f97316', '#ea580c', 0.3);
    // Vacuum circuit breaker pod
    this.addCyl(parent, 0.022, 0.022, 0.045, -0.03, 0.255, 0.01, 'Y', this.getMat('#64748b'));

    // --- Twin Articulated Metallic Pantographs ---
    // 1. Rear Pantograph (z = -0.125) RAISED into catenary operating posture!
    this.addBox(parent, 0.12, 0.01, 0.06, 0, 0.252, -0.125, '#475569');
    const lowerArm = new THREE.Group();
    lowerArm.position.set(0, 0.26, -0.135);
    lowerArm.rotation.x = -0.58; // Tilts forward & upward toward knee
    this.addBox(lowerArm, 0.014, 0.068, 0.012, 0, 0, 0, '#cbd5e1');
    parent.add(lowerArm);

    const upperArm = new THREE.Group();
    upperArm.position.set(0, 0.296, -0.094);
    upperArm.rotation.x = 0.62; // Tilts backward & upward from knee to collector head
    for (const px of [-0.024, 0.024]) {
      this.addBox(upperArm, 0.009, 0.068, 0.009, px, 0, 0, '#e2e8f0');
    }
    parent.add(upperArm);

    // Wide Carbon/Silver Collector Bow with Down-Curved Horn Tips at y = 0.348!
    this.addBox(parent, 0.21, 0.01, 0.022, 0, 0.346, -0.132, '#e2e8f0');
    this.addBox(parent, 0.16, 0.008, 0.012, 0, 0.354, -0.132, '#1e293b'); // Carbon contact strip
    for (const side of [-1, 1]) {
      const horn = new THREE.Group();
      horn.position.set(side * 0.108, 0.346, -0.132);
      horn.rotation.z = side * -0.45;
      this.addBox(horn, 0.026, 0.008, 0.016, side * 0.01, -0.004, 0, '#cbd5e1');
      parent.add(horn);
    }

    // 2. Front Pantograph (z = +0.125) NEATLY FOLDED flat!
    this.addBox(parent, 0.12, 0.01, 0.06, 0, 0.252, 0.125, '#475569');
    this.addBox(parent, 0.075, 0.01, 0.072, 0, 0.262, 0.125, '#94a3b8');
    this.addBox(parent, 0.195, 0.009, 0.02, 0, 0.271, 0.145, '#cbd5e1');
  }

  // ============================================================================
  // 4. SEVEN SPECIALIZED OPENTTD CARGO WAGONS (Twin Bogies, Buffers & Dynamic Cargo)
  // ============================================================================
  private buildWagonMesh(
    wg: THREE.Group,
    cargo: CargoType,
    ownerColor: string,
    wagonIdx: number,
    cargoSlots: CargoVisualSlot[]
  ): void {
    // Every wagon sits on twin 2-axle bogies with steel-rimmed wheels + front & rear buffers
    this.addRailBogie(wg, 0.122, [-0.034, 0.034], 0.024, '#1e293b', '#334155');
    this.addRailBogie(wg, -0.122, [-0.034, 0.034], 0.024, '#1e293b', '#334155');
    this.addBufferBeam(wg, 0.198, 1, 0.23, 0.034, '#1e293b');
    this.addBufferBeam(wg, -0.198, -1, 0.23, 0.034, '#1e293b');

    switch (cargo) {
      case 'COAL': {
        // Open Mineral Hopper Wagon: 4 thin steel walls + sloped dark interior floor so empty = hollow!
        this.addBox(wg, 0.22, 0.024, 0.39, 0, 0.04, 0, '#1e293b');
        // Sloped bottom discharge hopper chutes between bogies
        this.addBox(wg, 0.18, 0.028, 0.12, 0, 0.018, 0, '#27272a');
        // Dark hollow interior floor at y = 0.064
        this.addBox(wg, 0.214, 0.012, 0.354, 0, 0.062, 0, '#09090b');

        const wallHex = '#3f3f46';
        const ribHex = '#52525b';
        const rimHex = '#71717a';
        // Left & right thin side walls (0.018 thick -> genuine open top!)
        for (const side of [-1, 1]) {
          this.addBox(wg, 0.018, 0.118, 0.376, side * 0.112, 0.064, 0, wallHex);
          this.addBox(wg, 0.024, 0.012, 0.382, side * 0.113, 0.18, 0, rimHex);
          // 5 External vertical steel side ribs/stiffeners per wall
          for (const rz of [-0.145, -0.072, 0, 0.072, 0.145]) {
            this.addBox(wg, 0.012, 0.114, 0.014, side * 0.124, 0.065, rz, ribHex);
          }
        }
        // Front & rear thin end walls + company badge stripe
        for (const dir of [-1, 1]) {
          this.addBox(wg, 0.242, 0.118, 0.018, 0, 0.064, dir * 0.18, wallHex);
          this.addBox(wg, 0.246, 0.012, 0.022, 0, 0.18, dir * 0.18, rimHex);
        }
        this.addBox(wg, 0.254, 0.022, 0.07, 0, 0.11, 0.108, ownerColor);

        // Multi-peaked 3D black coal heap anchored at hopper floor (y = 0.074)
        const coalHeap = new THREE.Group();
        coalHeap.position.set(0, 0.074, 0);
        this.addBox(coalHeap, 0.192, 0.095, 0.338, 0, 0, 0, '#09090b');
        this.addSphere(coalHeap, 0.092, 0.052, 0.088, 0, 0.095, -0.09, '#18181b');
        this.addSphere(coalHeap, 0.095, 0.058, 0.092, 0, 0.098, 0.01, '#09090b');
        this.addSphere(coalHeap, 0.09, 0.05, 0.085, 0, 0.094, 0.1, '#27272a');
        wg.add(coalHeap);
        cargoSlots.push({ kind: 'HEAP', group: coalHeap, wagonIndex: wagonIdx });
        break;
      }

      case 'GRAIN': {
        // Bulk Grain Hopper Wagon: Tapered ochre/amber ribbed body, bottom chutes, top catwalk & golden grain trough!
        this.addBox(wg, 0.22, 0.022, 0.39, 0, 0.042, 0, '#451a03');
        // Bottom V-discharge chutes between bogies
        for (const cz of [-0.042, 0.042]) {
          this.addBox(wg, 0.15, 0.032, 0.065, 0, 0.016, cz, '#92400e');
        }
        // Lower tapered hopper belly
        this.addBox(wg, 0.19, 0.028, 0.34, 0, 0.06, 0, '#b45309');
        // Hollow interior floor for loading trough
        this.addBox(wg, 0.205, 0.014, 0.34, 0, 0.084, 0, '#292524');

        // 4 Thin ochre/amber hopper walls so open central loading bay reveals empty vs golden grain!
        const ochre = '#d97706';
        const rib = '#f59e0b';
        for (const side of [-1, 1]) {
          this.addBox(wg, 0.02, 0.11, 0.374, side * 0.112, 0.082, 0, ochre);
          // Partial top angled roof shoulders leaving central loading trough open
          this.addBox(wg, 0.052, 0.014, 0.376, side * 0.096, 0.19, 0, '#b45309');
          // 6 Vertical external ribs per side
          for (const rz of [-0.15, -0.09, -0.03, 0.03, 0.09, 0.15]) {
            this.addBox(wg, 0.012, 0.108, 0.013, side * 0.125, 0.083, rz, rib);
          }
        }
        for (const dir of [-1, 1]) {
          this.addBox(wg, 0.244, 0.115, 0.02, 0, 0.082, dir * 0.178, ochre);
        }
        // Galvanized top loading walkway catwalk along right shoulder + company placard
        this.addBox(wg, 0.036, 0.008, 0.38, 0.094, 0.205, 0, '#e2e8f0');
        this.addBox(wg, 0.254, 0.024, 0.08, 0, 0.122, 0, ownerColor);

        // Golden grain heap rising inside the hopper & crowning through the central loading trough!
        const grainHeap = new THREE.Group();
        grainHeap.position.set(0, 0.095, 0);
        this.addBox(grainHeap, 0.18, 0.092, 0.33, 0, 0, 0, '#eab308');
        this.addSphere(grainHeap, 0.075, 0.04, 0.09, 0, 0.092, -0.085, '#facc15');
        this.addSphere(grainHeap, 0.078, 0.044, 0.095, 0, 0.095, 0.0, '#fde047');
        this.addSphere(grainHeap, 0.075, 0.04, 0.09, 0, 0.092, 0.085, '#facc15');
        wg.add(grainHeap);
        cargoSlots.push({ kind: 'HEAP', group: grainHeap, wagonIndex: wagonIdx });
        break;
      }

      case 'WOOD': {
        // Timber Stake Flatcar: Steel side sills + timber-planked deck + 4 pairs of steel stakes + 9 barked logs!
        this.addBox(wg, 0.24, 0.024, 0.394, 0, 0.042, 0, '#334155');
        this.addBox(wg, 0.248, 0.016, 0.14, 0, 0.032, 0, ownerColor);
        // Timber-planked flatcar deck (visibly flat & empty when fillRatio === 0!)
        this.addBox(wg, 0.232, 0.014, 0.384, 0, 0.066, 0, '#78350f');
        for (const bz of [-0.145, -0.05, 0.05, 0.145]) {
          // Bolster bunk crossbeams + 4 pairs of tall steel stanchions with yellow safety tips
          this.addBox(wg, 0.244, 0.01, 0.022, 0, 0.078, bz, '#1e293b');
          for (const side of [-1, 1]) {
            this.addBox(wg, 0.016, 0.122, 0.016, side * 0.118, 0.068, bz, '#334155');
            this.addBox(wg, 0.018, 0.016, 0.018, side * 0.118, 0.188, bz, '#facc15');
          }
        }

        // 9 Individual Cylindrical Barked Timber Logs (4 + 3 + 2 tiers) with pale wood-ring cut ends!
        const barkShades = ['#5c3a21', '#713f12', '#451a03', '#653719'];
        const items: CargoTierItem[] = [];
        const logLen = 0.355;
        const logR = 0.024;

        // Tier 1 (bottom 4 logs resting on bolster bunks)
        const t1X = [-0.075, -0.025, 0.025, 0.075];
        for (let i = 0; i < t1X.length; i++) {
          const log = this.createTimberLogMesh(
            logR,
            logLen,
            t1X[i],
            0.088 + logR,
            0,
            barkShades[i % barkShades.length],
            '#fde68a'
          );
          wg.add(log);
          items.push({ obj: log, threshold: 0.04 + i * 0.08 });
        }
        // Tier 2 (middle 3 logs nested cleanly)
        const t2X = [-0.05, 0, 0.05];
        for (let i = 0; i < t2X.length; i++) {
          const log = this.createTimberLogMesh(
            logR,
            logLen - 0.008,
            t2X[i],
            0.088 + logR * 2.75,
            0,
            barkShades[(i + 1) % barkShades.length],
            '#fcd34d'
          );
          wg.add(log);
          items.push({ obj: log, threshold: 0.4 + i * 0.1 });
        }
        // Tier 3 (top 2 logs + orange/steel lashing straps)
        const t3X = [-0.025, 0.025];
        for (let i = 0; i < t3X.length; i++) {
          const log = this.createTimberLogMesh(
            logR * 0.94,
            logLen - 0.016,
            t3X[i],
            0.088 + logR * 4.45,
            0,
            barkShades[(i + 2) % barkShades.length],
            '#fef08a'
          );
          wg.add(log);
          items.push({ obj: log, threshold: 0.74 + i * 0.14 });
        }

        cargoSlots.push({ kind: 'TIERED', items, wagonIndex: wagonIdx });
        break;
      }

      case 'GOODS': {
        // Skeletal Intermodal Container Spine Flatcar + Twin Ribbed 20ft ISO Containers!
        // Central steel spine beam (open skeletal gaps on left/right when empty!)
        this.addBox(wg, 0.075, 0.026, 0.396, 0, 0.042, 0, ownerColor);
        // 4 Transverse twist-lock outrigger bolsters with yellow corner twist-lock pins
        for (const bz of [-0.182, -0.012, 0.012, 0.182]) {
          this.addBox(wg, 0.244, 0.018, 0.022, 0, 0.05, bz, '#334155');
          for (const side of [-1, 1]) {
            this.addBox(wg, 0.018, 0.01, 0.018, side * 0.11, 0.068, bz, '#facc15');
          }
        }

        // Twin 20ft Corrugated ISO Containers (front & rear bolsters)
        const cHexA = ISO_CONTAINER_PALETTE[wagonIdx % ISO_CONTAINER_PALETTE.length];
        const cHexB = ISO_CONTAINER_PALETTE[(wagonIdx + 1) % ISO_CONTAINER_PALETTE.length];
        const items: CargoTierItem[] = [];

        const containerSpecs: Array<{ z: number; hex: string; threshold: number }> = [
          { z: 0.096, hex: cHexA, threshold: 0.05 },
          { z: -0.096, hex: cHexB, threshold: 0.52 },
        ];

        for (let c = 0; c < containerSpecs.length; c++) {
          const spec = containerSpecs[c];
          const sideTex = this.textures.getContainerSideTexture(spec.hex);
          const endTex = this.textures.getContainerEndTexture(spec.hex);
          const sideMat = this.getTexMat(`iso-s:${spec.hex}`, sideTex, spec.hex);
          const endMat = this.getTexMat(`iso-e:${spec.hex}`, endTex, shadeHex(spec.hex, 0.85));
          const topMat = this.getMat(shadeHex(spec.hex, 1.08));
          const botMat = this.getMat('#1e293b');

          const cGroup = new THREE.Group();
          this.addTexturedBox(cGroup, 0.232, 0.142, 0.176, 0, 0.068, spec.z, {
            right: sideMat,
            left: sideMat,
            top: topMat,
            bottom: botMat,
            front: endMat,
            rear: endMat,
          });
          wg.add(cGroup);
          items.push({ obj: cGroup, threshold: spec.threshold });
        }

        cargoSlots.push({ kind: 'TIERED', items, wagonIndex: wagonIdx });
        break;
      }

      case 'PASSENGERS': {
        // Streamlined InterCity Passenger Coach: Illuminated window strip, curved roof, AC pods & gangway bellows!
        this.addBox(wg, 0.22, 0.022, 0.39, 0, 0.042, 0, '#0f172a');
        // Underframe HVAC / battery equipment box
        this.addBox(wg, 0.17, 0.022, 0.09, 0, 0.022, 0, '#334155');

        const paxTex = this.textures.getPassengerCoachSideTexture(ownerColor);
        const sideMat = this.getTexMat(`pax:${ownerColor}`, paxTex, ownerColor);
        const roofMat = this.getMat('#cbd5e1');
        const endMat = this.getMat(shadeHex(ownerColor, 0.8));

        this.addTexturedBox(wg, 0.252, 0.148, 0.386, 0, 0.058, 0, {
          right: sideMat,
          left: sideMat,
          top: roofMat,
          bottom: this.getMat('#0f172a'),
          front: endMat,
          rear: endMat,
        });

        // Curved stepped silver-grey roof crown + 2 low-profile rooftop AC pods
        this.addBox(wg, 0.214, 0.018, 0.382, 0, 0.206, 0, '#e2e8f0');
        for (const az of [-0.11, 0.11]) {
          this.addBox(wg, 0.12, 0.012, 0.065, 0, 0.224, az, '#94a3b8');
        }

        // Flexible black rubber end gangway bellows / diaphragms at both ends
        for (const dir of [-1, 1]) {
          this.addBox(wg, 0.145, 0.132, 0.018, 0, 0.066, dir * 0.2, '#1e293b');
        }
        break;
      }

      case 'MAIL': {
        // Express Posten Mail Van: Crimson & gold livery, sliding mail doors, clerestory monitor & roof vents!
        this.addBox(wg, 0.22, 0.022, 0.388, 0, 0.042, 0, '#0f172a');

        const mailTex = this.textures.getMailVanSideTexture();
        const sideMat = this.getTexMat('mail-van-side', mailTex, '#b91c1c');
        const endDoorTex = this.textures.getVanRearDoorTexture('MAIL');
        const endMat = this.getTexMat('mail-van-end', endDoorTex, '#991b1b');

        this.addTexturedBox(wg, 0.25, 0.148, 0.382, 0, 0.058, 0, {
          right: sideMat,
          left: sideMat,
          top: this.getMat('#475569'),
          bottom: this.getMat('#0f172a'),
          front: endMat,
          rear: endMat,
        });

        // Raised clerestory roof monitor strip + 4 round rooftop torpedo vents + gangway bellows
        this.addBox(wg, 0.17, 0.022, 0.35, 0, 0.206, 0, '#334155');
        for (const vz of [-0.12, -0.04, 0.04, 0.12]) {
          this.addCyl(wg, 0.015, 0.015, 0.014, 0, 0.232, vz, 'Y', this.getMat('#94a3b8'));
        }
        for (const dir of [-1, 1]) {
          this.addBox(wg, 0.135, 0.126, 0.016, 0, 0.066, dir * 0.197, '#1e293b');
        }
        break;
      }

      case 'FOOD': {
        // Insulated Reefer Boxcar: Arctic white + blue hygiene stripe, plug door, Thermo-King unit & roof hatches!
        this.addBox(wg, 0.22, 0.022, 0.388, 0, 0.042, 0, '#1e293b');
        // Underframe diesel generator fuel tank for refrigeration unit
        this.addBox(wg, 0.15, 0.022, 0.075, 0, 0.022, 0.03, '#0284c7');

        const reeferTex = this.textures.getReeferSideTexture();
        const sideMat = this.getTexMat('reefer-side', reeferTex, '#f8fafc');
        const endTex = this.textures.getVanRearDoorTexture('FOOD');
        const endMat = this.getTexMat('reefer-end', endTex, '#e2e8f0');

        this.addTexturedBox(wg, 0.252, 0.152, 0.374, 0, 0.058, -0.005, {
          right: sideMat,
          left: sideMat,
          top: this.getMat('#f8fafc'),
          bottom: this.getMat('#1e293b'),
          front: this.getMat('#e2e8f0'),
          rear: endMat,
        });

        // Nose-mounted Thermo-King diesel-electric refrigeration unit on front bulkhead!
        this.addBox(wg, 0.165, 0.105, 0.026, 0, 0.092, 0.193, '#334155');
        this.addCyl(wg, 0.032, 0.032, 0.008, 0, 0.152, 0.207, 'Z', this.getMat('#0f172a'));
        this.addBox(wg, 0.02, 0.014, 0.008, 0.06, 0.175, 0.206, '#22c55e', '#22c55e', 0.8);

        // Rooftop non-slip walkway + twin insulated ice/ventilation hatches at ends
        this.addBox(wg, 0.065, 0.008, 0.365, 0, 0.21, -0.005, '#cbd5e1');
        for (const hz of [-0.145, 0.135]) {
          for (const side of [-1, 1]) {
            this.addBox(wg, 0.052, 0.012, 0.052, side * 0.072, 0.21, hz, '#94a3b8');
          }
        }
        break;
      }
    }
  }

  // ============================================================================
  // 5. BUS_CITY: Classic Two-Tone OpenTTD City / Intercity Bus
  // ============================================================================
  private buildCityBus(parent: THREE.Group, ownerColor: string): void {
    // 4 Round Black Rubber Wheels with Silver Hubcaps in Dark Recessed Wheel Arches
    this.addRoadWheelPair(parent, 0.132, 0.096, 0.031, 0.025);
    this.addRoadWheelPair(parent, -0.125, 0.096, 0.031, 0.025);
    for (const wz of [0.132, -0.125]) {
      this.addBox(parent, 0.216, 0.038, 0.074, 0, 0.014, wz, '#09090b');
    }

    // Chassis undertray + front & rear chrome/anthracite bumpers
    this.addBox(parent, 0.2, 0.024, 0.43, 0, 0.022, 0, '#0f172a');
    this.addBox(parent, 0.228, 0.024, 0.018, 0, 0.024, 0.222, '#cbd5e1');
    this.addBox(parent, 0.226, 0.024, 0.016, 0, 0.024, -0.222, '#334155');

    // Main Multi-Material Two-Tone Bus Body (illuminated windows, folding doors & RUTE blind)
    const sideTexs = this.textures.getBusSideTextures(ownerColor);
    const frontTex = this.textures.getBusFrontTexture(ownerColor);

    const rightMat = this.getTexMat(`bus-R:${ownerColor}`, sideTexs.right, ownerColor);
    const leftMat = this.getTexMat(`bus-L:${ownerColor}`, sideTexs.left, ownerColor);
    const frontMat = this.getTexMat(`bus-F:${ownerColor}`, frontTex, ownerColor);
    const rearMat = this.getMat(ownerColor);

    this.addTexturedBox(parent, 0.224, 0.158, 0.44, 0, 0.036, 0, {
      right: rightMat,
      left: leftMat,
      top: this.getMat('#f8fafc'),
      bottom: this.getMat('#0f172a'),
      front: frontMat,
      rear: rearMat,
    });

    // Rear window + rear engine cooling grille + glowing red taillights
    this.addBox(parent, 0.175, 0.052, 0.008, 0, 0.122, -0.222, '#1e3a5f', '#38bdf8', 0.25);
    this.addBox(parent, 0.14, 0.036, 0.008, 0, 0.058, -0.222, '#1e293b');
    for (const side of [-1, 1]) {
      // Twin front glowing headlights + amber turn signals
      this.addBox(
        parent,
        0.038,
        0.02,
        0.01,
        side * 0.076,
        0.052,
        0.222,
        '#fef08a',
        '#fde047',
        0.9
      );
      this.addBox(parent, 0.016, 0.016, 0.01, side * 0.102, 0.054, 0.221, '#f97316');
      // Rear glowing red taillights
      this.addBox(
        parent,
        0.032,
        0.028,
        0.01,
        side * 0.084,
        0.056,
        -0.222,
        '#ef4444',
        '#dc2626',
        0.85
      );
      // Exterior wing mirrors on front A-pillars
      this.addBox(parent, 0.022, 0.006, 0.016, side * 0.122, 0.148, 0.212, '#1e293b');
      this.addBox(parent, 0.01, 0.034, 0.014, side * 0.132, 0.124, 0.218, '#0f172a');
    }

    // Illuminated 3D `RUTE` destination sign brow + curved white roof + rooftop HVAC pod!
    this.addBox(
      parent,
      0.16,
      0.022,
      0.012,
      0,
      0.168,
      0.218,
      '#fde047',
      '#f59e0b',
      0.65
    );
    this.addBox(parent, 0.196, 0.014, 0.41, 0, 0.194, -0.005, '#f8fafc');
    this.addBox(parent, 0.135, 0.02, 0.13, 0, 0.208, -0.02, '#e2e8f0');
    this.addBox(parent, 0.065, 0.008, 0.055, 0, 0.208, 0.12, '#cbd5e1');
  }

  // ============================================================================
  // 6. TRUCK_CARGO: European Cab-Over-Engine Truck + Cargo-Specific Rear Bodies
  // ============================================================================
  private buildCargoTruck(
    parent: THREE.Group,
    cargo: CargoType,
    ownerColor: string,
    cargoSlots: CargoVisualSlot[]
  ): void {
    // 6 Rubber Tires with Silver Hubcaps (1 front steer axle + twin rear drive axles!)
    this.addRoadWheelPair(parent, 0.15, 0.096, 0.031, 0.025);
    this.addRoadWheelPair(parent, -0.092, 0.098, 0.031, 0.028);
    this.addRoadWheelPair(parent, -0.165, 0.098, 0.031, 0.028);

    // Heavy steel ladder-frame chassis + side aluminium fuel tank + rear underrun safety bumper
    this.addBox(parent, 0.15, 0.028, 0.44, 0, 0.026, -0.005, '#1e293b');
    this.addBox(parent, 0.21, 0.028, 0.07, 0, 0.028, 0.03, '#94a3b8'); // Fuel & air tanks
    // Rear mudguards over twin drive axles + underrun bar + red taillights
    this.addBox(parent, 0.222, 0.014, 0.16, 0, 0.058, -0.128, '#0f172a');
    this.addBox(parent, 0.214, 0.02, 0.016, 0, 0.024, -0.226, '#cbd5e1');
    for (const side of [-1, 1]) {
      this.addBox(
        parent,
        0.034,
        0.018,
        0.01,
        side * 0.08,
        0.032,
        -0.228,
        '#ef4444',
        '#dc2626',
        0.85
      );
    }

    // --- Sculpted European Cab-Over-Engine (z = +0.088 .. +0.222) ---
    const cabSides = this.textures.getTruckCabSideTextures(ownerColor);
    const cabFront = this.textures.getTruckCabFrontTexture(ownerColor);
    const cabRMat = this.getTexMat(`tcab-R:${ownerColor}`, cabSides.right, ownerColor);
    const cabLMat = this.getTexMat(`tcab-L:${ownerColor}`, cabSides.left, ownerColor);
    const cabFMat = this.getTexMat(`tcab-F:${ownerColor}`, cabFront, ownerColor);
    const cabBackMat = this.getMat(shadeHex(ownerColor, 0.78));

    this.addTexturedBox(parent, 0.218, 0.162, 0.132, 0, 0.04, 0.154, {
      right: cabRMat,
      left: cabLMat,
      top: this.getMat(shadeHex(ownerColor, 1.12)),
      bottom: this.getMat('#0f172a'),
      front: cabFMat,
      rear: cabBackMat,
    });

    // Chrome front bumper + twin bright halogen headlights + sun visor + roof wind deflector
    this.addBox(parent, 0.224, 0.024, 0.018, 0, 0.026, 0.222, '#e2e8f0');
    this.addBox(parent, 0.214, 0.012, 0.018, 0, 0.184, 0.222, '#0f172a'); // Sun visor brow
    for (const side of [-1, 1]) {
      this.addBox(
        parent,
        0.038,
        0.02,
        0.01,
        side * 0.076,
        0.048,
        0.224,
        '#fef08a',
        '#fde047',
        0.92
      );
      // Side wing mirrors on brackets
      this.addBox(parent, 0.02, 0.006, 0.014, side * 0.118, 0.165, 0.205, '#1e293b');
      this.addBox(parent, 0.01, 0.038, 0.014, side * 0.127, 0.136, 0.208, '#0f172a');
    }

    // Vertical Gleaming Chrome Exhaust Stack right behind the cab!
    this.addCyl(
      parent,
      0.012,
      0.012,
      0.175,
      -0.096,
      0.138,
      0.076,
      'Y',
      this.getMat('#e2e8f0')
    );
    this.addCyl(
      parent,
      0.015,
      0.015,
      0.018,
      -0.096,
      0.228,
      0.076,
      'Y',
      this.getMat('#94a3b8')
    );

    // --- Cargo-Specific Rear Body (z = -0.222 .. +0.064) ---
    if (cargo === 'COAL' || cargo === 'GRAIN') {
      // Open-Top Ribbed Steel Tipper Dump Bed (4 thin walls -> visibly hollow when empty!)
      const isCoal = cargo === 'COAL';
      const bedHex = isCoal ? '#64748b' : '#d97706';
      const ribHex = isCoal ? '#94a3b8' : '#f59e0b';

      // Front telescopic hydraulic lift ram cylinder behind cab
      this.addCyl(
        parent,
        0.014,
        0.014,
        0.11,
        0,
        0.11,
        0.068,
        'Y',
        this.getMat('#cbd5e1')
      );

      // Dump bed subframe & recessed dark interior floor (y = 0.064)
      this.addBox(parent, 0.214, 0.014, 0.28, 0, 0.056, -0.08, '#0f172a');

      // 2 Thin ribbed side walls + front headboard with cab-shield visor + hinged tailgate
      for (const side of [-1, 1]) {
        this.addBox(parent, 0.016, 0.098, 0.282, side * 0.104, 0.064, -0.08, bedHex);
        for (const rz of [-0.19, -0.115, -0.04, 0.035]) {
          this.addBox(parent, 0.01, 0.094, 0.013, side * 0.115, 0.066, rz, ribHex);
        }
      }
      // Front headboard + cab protector visor
      this.addBox(parent, 0.224, 0.112, 0.016, 0, 0.064, 0.056, bedHex);
      this.addBox(parent, 0.224, 0.012, 0.042, 0, 0.172, 0.072, bedHex);
      // Rear tailgate
      this.addBox(parent, 0.224, 0.098, 0.016, 0, 0.064, -0.216, shadeHex(bedHex, 0.85));

      // Dynamic 3D Coal or Golden Grain Mound anchored at dump floor (y = 0.07)
      const dumpHeap = new THREE.Group();
      dumpHeap.position.set(0, 0.07, -0.08);
      if (isCoal) {
        this.addBox(dumpHeap, 0.184, 0.078, 0.252, 0, 0, 0, '#09090b');
        this.addSphere(dumpHeap, 0.085, 0.045, 0.075, 0, 0.078, -0.055, '#18181b');
        this.addSphere(dumpHeap, 0.088, 0.048, 0.08, 0, 0.08, 0.045, '#09090b');
      } else {
        this.addBox(dumpHeap, 0.184, 0.078, 0.252, 0, 0, 0, '#eab308');
        this.addSphere(dumpHeap, 0.085, 0.044, 0.078, 0, 0.078, -0.055, '#facc15');
        this.addSphere(dumpHeap, 0.088, 0.048, 0.082, 0, 0.08, 0.045, '#fde047');
      }
      parent.add(dumpHeap);
      cargoSlots.push({ kind: 'HEAP', group: dumpHeap });
    } else if (cargo === 'WOOD') {
      // Logging Bolster Trailer Bed with 4 Pairs of Steel Stakes & Stacked Cylindrical Barked Logs!
      this.addBox(parent, 0.216, 0.016, 0.288, 0, 0.056, -0.08, '#78350f');
      // Steel protective cab headache rack
      this.addBox(parent, 0.216, 0.125, 0.014, 0, 0.068, 0.058, '#334155');
      for (const sz of [-0.195, -0.115, -0.035, 0.04]) {
        this.addBox(parent, 0.224, 0.012, 0.02, 0, 0.07, sz, '#1e293b');
        for (const side of [-1, 1]) {
          this.addBox(parent, 0.015, 0.115, 0.015, side * 0.106, 0.068, sz, '#334155');
          this.addBox(parent, 0.017, 0.015, 0.017, side * 0.106, 0.182, sz, '#facc15');
        }
      }

      // 6 Individual Cylindrical Barked Logs (3 + 2 + 1 stack) with pale wood-ring cut ends!
      const items: CargoTierItem[] = [];
      const barkColors = ['#5c3a21', '#713f12', '#451a03'];
      const logLen = 0.268;
      const logR = 0.026;

      const row1 = [-0.058, 0, 0.058];
      for (let i = 0; i < row1.length; i++) {
        const l = this.createTimberLogMesh(
          logR,
          logLen,
          row1[i],
          0.082 + logR,
          -0.082,
          barkColors[i % 3],
          '#fde68a'
        );
        parent.add(l);
        items.push({ obj: l, threshold: 0.05 + i * 0.13 });
      }
      const row2 = [-0.03, 0.03];
      for (let i = 0; i < row2.length; i++) {
        const l = this.createTimberLogMesh(
          logR,
          logLen - 0.008,
          row2[i],
          0.082 + logR * 2.72,
          -0.082,
          barkColors[(i + 1) % 3],
          '#fcd34d'
        );
        parent.add(l);
        items.push({ obj: l, threshold: 0.48 + i * 0.18 });
      }
      const topLog = this.createTimberLogMesh(
        logR * 0.94,
        logLen - 0.016,
        0,
        0.082 + logR * 4.4,
        -0.082,
        '#5c3a21',
        '#fef08a'
      );
      parent.add(topLog);
      items.push({ obj: topLog, threshold: 0.82 });

      cargoSlots.push({ kind: 'TIERED', items });
    } else if (cargo === 'FOOD') {
      // White Refrigerated Box Van with Over-Cab Thermo-King Cooling Unit & Rear Locking Doors!
      // Aerodynamic cab roof deflector leading to box
      this.addBox(parent, 0.19, 0.024, 0.075, 0, 0.202, 0.14, ownerColor);

      const reeferTex = this.textures.getReeferSideTexture();
      const rearTex = this.textures.getVanRearDoorTexture('FOOD');
      const sideMat = this.getTexMat('reefer-side', reeferTex, '#f8fafc');
      const rearMat = this.getTexMat('van-rear:FOOD', rearTex, '#f1f5f9');

      this.addTexturedBox(parent, 0.228, 0.178, 0.288, 0, 0.056, -0.08, {
        right: sideMat,
        left: sideMat,
        top: this.getMat('#ffffff'),
        bottom: this.getMat('#1e293b'),
        front: this.getMat('#e2e8f0'),
        rear: rearMat,
      });

      // Over-Cab Thermo-King Refrigeration Cooling Unit mounted high on front of box van!
      this.addBox(parent, 0.175, 0.052, 0.036, 0, 0.178, 0.08, '#334155');
      this.addCyl(parent, 0.018, 0.018, 0.008, -0.038, 0.204, 0.1, 'Z', this.getMat('#0f172a'));
      this.addCyl(parent, 0.018, 0.018, 0.008, 0.038, 0.204, 0.1, 'Z', this.getMat('#0f172a'));
    } else {
      // GOODS / MAIL: Corrugated Box Van / Curtainsider with Cab Roof Spoiler & Rear Shutter/Doors!
      const isMail = cargo === 'MAIL';
      this.addBox(parent, 0.195, 0.026, 0.08, 0, 0.202, 0.142, ownerColor);

      const sideTex = isMail
        ? this.textures.getMailVanSideTexture()
        : this.textures.getTruckGoodsVanSideTexture(ownerColor);
      const rearTex = this.textures.getVanRearDoorTexture(isMail ? 'MAIL' : 'GOODS');

      const sideKey = isMail ? 'mail-van-side' : `truck-goods:${ownerColor}`;
      const rearKey = isMail ? 'van-rear:MAIL' : 'van-rear:GOODS';
      const fallbackHex = isMail ? '#b91c1c' : '#ea580c';

      const sideMat = this.getTexMat(sideKey, sideTex, fallbackHex);
      const rearMat = this.getTexMat(rearKey, rearTex, '#cbd5e1');

      this.addTexturedBox(parent, 0.228, 0.176, 0.288, 0, 0.056, -0.08, {
        right: sideMat,
        left: sideMat,
        top: this.getMat(isMail ? '#991b1b' : '#e2e8f0'),
        bottom: this.getMat('#1e293b'),
        front: this.getMat(isMail ? '#7f1d1d' : '#cbd5e1'),
        rear: rearMat,
      });
    }
  }

  // ============================================================================
  // Breadcrumbs, Trailing Wagons & Running Gear / Plume Animations
  // ============================================================================
  private recordBreadcrumb(inst: VehicleVisualInstance, wx: number, wz: number): void {
    const head = inst.breadcrumbs[0];
    if (!head) {
      inst.breadcrumbs.unshift({ x: wx, z: wz });
      return;
    }

    const dist = Math.hypot(wx - head.x, wz - head.z);
    if (dist > 2.4) {
      inst.breadcrumbs = [{ x: wx, z: wz }];
      const backX = -Math.sin(inst.currentYaw);
      const backZ = -Math.cos(inst.currentYaw);
      for (let s = 1; s <= 20; s++) {
        inst.breadcrumbs.push({
          x: wx + backX * s * 0.26,
          z: wz + backZ * s * 0.26,
        });
      }
      return;
    }

    if (dist >= 0.04) {
      inst.breadcrumbs.unshift({ x: wx, z: wz });
      if (inst.breadcrumbs.length > 160) {
        inst.breadcrumbs.length = 160;
      }
    } else {
      head.x = wx;
      head.z = wz;
    }
  }

  private sampleBreadcrumbAtDistance(
    crumbs: Breadcrumb[],
    targetDist: number
  ): { x: number; z: number; yaw: number } {
    let accum = 0;
    for (let i = 0; i < crumbs.length - 1; i++) {
      const a = crumbs[i];
      const b = crumbs[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 1e-5) continue;

      if (accum + segLen >= targetDist) {
        const frac = (targetDist - accum) / segLen;
        const x = a.x + (b.x - a.x) * frac;
        const z = a.z + (b.z - a.z) * frac;
        const yaw = Math.atan2(a.x - b.x, a.z - b.z);
        return { x, z, yaw };
      }
      accum += segLen;
    }

    const last = crumbs[crumbs.length - 1];
    const prev = crumbs.length >= 2 ? crumbs[crumbs.length - 2] : last;
    const yaw = Math.atan2(prev.x - last.x, prev.z - last.z);
    return { x: last.x, z: last.z, yaw };
  }

  private updateTrailingWagons(
    inst: VehicleVisualInstance,
    state: GameState,
    baseLift: number
  ): void {
    // Steam loco includes closely-coupled coal tender, so first wagon sits behind tender rear buffers
    const firstOffset = inst.modelId === 'LOCO_STEAM' ? 0.525 : 0.495;
    const wagonSpacing = 0.435;
    for (let w = 0; w < inst.wagonGroups.length; w++) {
      const dist = firstOffset + w * wagonSpacing;
      const sample = this.sampleBreadcrumbAtDistance(inst.breadcrumbs, dist);
      this.apply3DSurfacePose(
        inst.wagonGroups[w],
        state,
        sample.x,
        sample.z,
        sample.yaw,
        baseLift
      );
    }
  }

  private updateSteamRunningGear(
    inst: VehicleVisualInstance,
    isMoving: boolean,
    gameSpeed: number,
    dt: number
  ): void {
    const gear = inst.steamGear;
    if (!gear || !isMoving) return;

    inst.wheelPhase =
      (inst.wheelPhase + dt * 12.5 * Math.max(0.65, Math.min(2.5, gameSpeed))) %
      (Math.PI * 2);

    const pL = inst.wheelPhase;
    const pR = inst.wheelPhase + Math.PI * 0.5; // Quartered 90 degrees like real steam locomotives!

    const crankY = 0.011;
    const crankZ = 0.016;

    gear.leftRod.position.y = gear.rodBaseY + Math.sin(pL) * crankY;
    gear.leftRod.position.z = gear.rodBaseZ + Math.cos(pL) * crankZ;
    gear.leftPiston.position.z = gear.pistonBaseZ + Math.cos(pL) * crankZ;

    gear.rightRod.position.y = gear.rodBaseY + Math.sin(pR) * crankY;
    gear.rightRod.position.z = gear.rodBaseZ + Math.cos(pR) * crankZ;
    gear.rightPiston.position.z = gear.pistonBaseZ + Math.cos(pR) * crankZ;
  }

  private updateSteamPlume(
    inst: VehicleVisualInstance,
    wx: number,
    wy: number,
    wz: number,
    isMoving: boolean,
    isSimmering: boolean,
    dt: number
  ): void {
    const sinY = Math.sin(inst.currentYaw);
    const cosY = Math.cos(inst.currentYaw);
    const rightX = cosY;
    const rightZ = -sinY;

    // Flared smokestack crown sits at z = +0.235, y = +0.32 in loco frame
    const stackX = wx + sinY * 0.235;
    const stackZ = wz + cosY * 0.235;
    const stackY = wy + 0.32;

    for (let i = 0; i < inst.steamPuffs.length; i++) {
      const puff = inst.steamPuffs[i];
      if (!isMoving && !isSimmering) {
        puff.mesh.visible = false;
        puff.spawned = false;
        continue;
      }

      const ageRate = isMoving ? 1.32 : 0.52;
      puff.age += dt * ageRate;

      if (puff.age >= 1.0) {
        puff.age %= 1.0;
        puff.mesh.position.set(stackX, stackY, stackZ);
        puff.spawned = true;
      } else if (!puff.spawned) {
        puff.mesh.visible = false;
        continue;
      } else {
        const riseRate = isMoving ? 0.44 : 0.22;
        const backDrift = isMoving ? 0.16 : 0.04;
        const curl = puff.driftSign * 0.035 * Math.sin(puff.age * Math.PI * 2);
        puff.mesh.position.y += dt * riseRate;
        puff.mesh.position.x += (-sinY * backDrift + rightX * curl) * dt;
        puff.mesh.position.z += (-cosY * backDrift + rightZ * curl) * dt;
      }

      const maxExpand = isMoving ? 0.145 : 0.075;
      const s = 0.046 + puff.age * maxExpand;
      puff.mesh.scale.set(s, s * 0.88, s);

      const stageIdx = Math.min(
        this.steamPuffMats.length - 1,
        Math.floor(puff.age * this.steamPuffMats.length)
      );
      puff.mesh.material = this.steamPuffMats[stageIdx];
      puff.mesh.visible = puff.age < 0.96;
    }
  }

  private updateDieselExhaust(
    inst: VehicleVisualInstance,
    wx: number,
    wy: number,
    wz: number,
    isMoving: boolean,
    dt: number
  ): void {
    const sinY = Math.sin(inst.currentYaw);
    const cosY = Math.cos(inst.currentYaw);
    const portX = wx + sinY * 0.01;
    const portZ = wz + cosY * 0.01;
    const portY = wy + 0.285;

    for (let i = 0; i < inst.dieselPuffs.length; i++) {
      const puff = inst.dieselPuffs[i];
      if (!isMoving) {
        puff.mesh.visible = false;
        puff.spawned = false;
        continue;
      }

      puff.age += dt * 1.45;
      if (puff.age >= 1.0) {
        puff.age %= 1.0;
        puff.mesh.position.set(portX, portY, portZ);
        puff.spawned = true;
      } else if (!puff.spawned) {
        puff.mesh.visible = false;
        continue;
      } else {
        puff.mesh.position.y += dt * 0.34;
        puff.mesh.position.x -= sinY * 0.14 * dt;
        puff.mesh.position.z -= cosY * 0.14 * dt;
      }

      const s = 0.032 + puff.age * 0.075;
      puff.mesh.scale.set(s, s * 0.82, s);

      const stageIdx = Math.min(
        this.dieselPuffMats.length - 1,
        Math.floor(puff.age * this.dieselPuffMats.length)
      );
      puff.mesh.material = this.dieselPuffMats[stageIdx];
      puff.mesh.visible = puff.age < 0.94;
    }
  }

  public dispose(): void {
    this.group.clear();
    this.instances.clear();

    this.boxGeo.dispose();
    this.cylGeo.dispose();
    this.sphereGeo.dispose();

    for (const mat of this.matCache.values()) {
      mat.dispose();
    }
    this.matCache.clear();

    for (const mat of this.texMatCache.values()) {
      mat.dispose();
    }
    this.texMatCache.clear();

    for (const mat of this.steamPuffMats) {
      mat.dispose();
    }
    this.steamPuffMats.length = 0;

    for (const mat of this.dieselPuffMats) {
      mat.dispose();
    }
    this.dieselPuffMats.length = 0;

    this.amberBeaconMat.dispose();
    this.redBeaconMat.dispose();
    this.cyanBeaconMat.dispose();

    this.textures.dispose();
  }
}
