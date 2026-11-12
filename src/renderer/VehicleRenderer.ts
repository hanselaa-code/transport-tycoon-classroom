import * as THREE from 'three';
import type { CargoType, GameState, Vehicle, VehicleModelId } from '../types/game';
import { getTileAt, getTileSurfaceY, resolveOwnerColor } from './IsoSceneManager';

interface Breadcrumb {
  x: number;
  y: number;
  z: number;
}

interface SteamPuff {
  mesh: THREE.Mesh;
  age: number;
}

interface VehicleVisualInstance {
  id: string;
  modelId: VehicleModelId;
  cargoType: CargoType;
  wagonCount: number;
  ownerColor: string;

  rootGroup: THREE.Group;
  headMeshGroup: THREE.Group;
  wagonGroups: THREE.Group[];
  cargoFillMeshes: THREE.Object3D[];
  statusBeacon: THREE.Mesh;
  steamPuffs: SteamPuff[];

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

  breadcrumbs: Breadcrumb[];
}

const CARGO_CONTAINER_COLORS: Record<CargoType, string> = {
  PASSENGERS: '#2563eb',
  MAIL: '#dc2626',
  COAL: '#27272a',
  WOOD: '#854d0e',
  GOODS: '#ea580c',
  GRAIN: '#d97706',
  FOOD: '#f8fafc',
};

function shortestAngleLerp(current: number, target: number, alpha: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * alpha;
}

export class VehicleRenderer {
  public readonly group = new THREE.Group();

  private instances = new Map<string, VehicleVisualInstance>();

  // Shared geometries & cached materials
  private readonly boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  private readonly sphereGeo = new THREE.SphereGeometry(0.5, 8, 8);
  private readonly matCache = new Map<string, THREE.MeshLambertMaterial>();
  private readonly puffMat: THREE.MeshBasicMaterial;
  private readonly amberBeaconMat: THREE.MeshBasicMaterial;
  private readonly redBeaconMat: THREE.MeshBasicMaterial;

  constructor() {
    this.puffMat = new THREE.MeshBasicMaterial({
      color: '#f8fafc',
      transparent: true,
      opacity: 0.72,
    });
    this.amberBeaconMat = new THREE.MeshBasicMaterial({ color: '#fbbf24' });
    this.redBeaconMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });
  }

  private getMat(
    hex: string,
    emissiveHex?: string,
    emissiveIntensity = 0
  ): THREE.MeshLambertMaterial {
    const key = `${hex}|${emissiveHex ?? ''}|${emissiveIntensity}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({
        color: hex,
        emissive: emissiveHex ? new THREE.Color(emissiveHex) : undefined,
        emissiveIntensity,
      });
      this.matCache.set(key, m);
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
    parent.add(mesh);
    return mesh;
  }

  /**
   * Syncs active vehicles and smoothly animates positions, wagons, and steam puffs at 60 FPS.
   */
  public update(state: GameState, dtSec: number, nowPerfMs: number): void {
    const dt = Math.min(0.08, Math.max(0.001, dtSec));
    const seenIds = new Set<string>();

    for (let i = 0; i < state.vehicles.length; i++) {
      const v = state.vehicles[i];
      seenIds.add(v.id);

      const ownerColor = resolveOwnerColor(v.ownerId, state.aiCompanies);
      const wagonCount = v.network === 'RAIL' ? Math.max(0, Math.min(8, v.wagonCount || 0)) : 0;

      let inst = this.instances.get(v.id);
      if (
        !inst ||
        inst.modelId !== v.modelId ||
        inst.cargoType !== v.cargoType ||
        inst.wagonCount !== wagonCount ||
        inst.ownerColor !== ownerColor
      ) {
        if (inst) {
          this.group.remove(inst.rootGroup);
        }
        inst = this.createVehicleInstance(v, ownerColor, wagonCount, state, nowPerfMs);
        this.instances.set(v.id, inst);
        this.group.add(inst.rootGroup);
      }

      if (v.state === 'IN_DEPOT') {
        inst.rootGroup.visible = false;
        continue;
      }
      inst.rootGroup.visible = true;

      // Update load fill visibility/height on cargo wagons or truck beds
      const fillRatio =
        v.capacity > 0 ? THREE.MathUtils.clamp(v.cargoAmount / v.capacity, 0, 1) : 0;
      for (let c = 0; c < inst.cargoFillMeshes.length; c++) {
        const cargoObj = inst.cargoFillMeshes[c];
        cargoObj.visible = fillRatio > 0.04;
        cargoObj.scale.y = 0.35 + fillRatio * 0.65;
      }

      // Status beacon above stopped or signal-waiting vehicles
      if (v.state === 'WAITING_SIGNAL') {
        inst.statusBeacon.visible = true;
        inst.statusBeacon.material = this.amberBeaconMat;
      } else if (v.state === 'STOPPED') {
        inst.statusBeacon.visible = true;
        inst.statusBeacon.material = this.redBeaconMat;
      } else {
        inst.statusBeacon.visible = false;
      }

      // Detect simulation tick updates for smooth sub-tick velocity tracking
      const tileChanged = v.x !== inst.rawX || v.y !== inst.rawY || v.nextX !== inst.rawNextX || v.nextY !== inst.rawNextY;
      const progChanged = Math.abs(v.progress - inst.rawProgress) > 1e-4;

      if (tileChanged || progChanged) {
        const elapsedSec = Math.max(0.016, (nowPerfMs - inst.lastRawUpdateMs) / 1000);
        let deltaProg = v.progress - inst.rawProgress;
        if (tileChanged && deltaProg < 0) {
          deltaProg += 1.0;
        }
        if (deltaProg > 0 && deltaProg < 1.2 && elapsedSec < 1.0) {
          const measuredRate = deltaProg / elapsedSec;
          inst.estProgressPerSec = THREE.MathUtils.lerp(
            inst.estProgressPerSec,
            THREE.MathUtils.clamp(measuredRate, 0.2, 16),
            0.45
          );
        }

        if (tileChanged) {
          // Wrap visualProgress across tile transition seamlessly
          if (inst.visualProgress > 0.65 && v.progress < 0.45) {
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

      // Sub-tick 60 FPS smooth progression
      if (v.state === 'MOVING' && state.speed > 0 && (v.nextX !== v.x || v.nextY !== v.y)) {
        const fallbackRate = ((v.speedKmh || v.maxSpeedKmh || 60) / 85) * state.speed;
        const rate = inst.estProgressPerSec > 0.05 ? inst.estProgressPerSec : fallbackRate;
        const maxLead = Math.min(0.992, inst.rawProgress + 0.36);
        inst.visualProgress = Math.min(maxLead, inst.visualProgress + rate * dt);
        // Gently pull toward rawProgress if lagging behind
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
      const curTile = getTileAt(state, Math.round(v.x), Math.round(v.y));
      const nxtTile = getTileAt(state, Math.round(v.nextX), Math.round(v.nextY));
      const yA = getTileSurfaceY(curTile);
      const yB = getTileSurfaceY(nxtTile);

      const baseLift = v.network === 'RAIL' ? 0.055 : 0.032;
      let wx = v.x + (v.nextX - v.x) * t;
      let wz = v.y + (v.nextY - v.y) * t;
      const wy = THREE.MathUtils.lerp(yA, yB, t) + baseLift;

      // Heading angle (vehicle local +Z faces forward)
      const dx = v.nextX - v.x;
      const dz = v.nextY - v.y;
      if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
        const targetYaw = Math.atan2(dx, dz);
        inst.currentYaw = shortestAngleLerp(
          inst.currentYaw,
          targetYaw,
          1 - Math.exp(-18 * dt)
        );
      }

      // Subtle right-hand lane offset on two-way roads so opposing buses/trucks pass cleanly
      if (v.network === 'ROAD') {
        const rightX = -Math.cos(inst.currentYaw);
        const rightZ = Math.sin(inst.currentYaw);
        wx += rightX * 0.11;
        wz += rightZ * 0.11;
      }

      const horizDist = Math.hypot(dx, dz) || 1;
      const slopePitch = -Math.atan2(yB - yA, horizDist);

      inst.headMeshGroup.position.set(wx, wy, wz);
      inst.headMeshGroup.rotation.set(slopePitch, inst.currentYaw, 0, 'YXZ');
      inst.statusBeacon.position.set(wx, wy + 0.36 + 0.03 * Math.sin(nowPerfMs * 0.008), wz);

      // Update locomotive breadcrumb history & position trailing wagons along track path
      if (v.network === 'RAIL') {
        this.recordBreadcrumb(inst, wx, wy, wz);
        this.updateTrailingWagons(inst);
      }

      // Animate steam puffs for LOCO_STEAM
      if (v.modelId === 'LOCO_STEAM' && inst.steamPuffs.length > 0) {
        this.updateSteamPuffs(inst, wx, wy, wz, v.state === 'MOVING' && state.speed > 0, dt);
      }
    }

    // Remove sold/deleted vehicles
    for (const [id, inst] of this.instances.entries()) {
      if (!seenIds.has(id)) {
        this.group.remove(inst.rootGroup);
        this.instances.delete(id);
      }
    }
  }

  private createVehicleInstance(
    v: Vehicle,
    ownerColor: string,
    wagonCount: number,
    state: GameState,
    nowPerfMs: number
  ): VehicleVisualInstance {
    const rootGroup = new THREE.Group();
    const headMeshGroup = new THREE.Group();
    rootGroup.add(headMeshGroup);

    const cargoFillMeshes: THREE.Object3D[] = [];
    const steamPuffs: SteamPuff[] = [];

    // Build head vehicle model (+Z is forward)
    if (v.modelId === 'LOCO_STEAM') {
      // Classic Black & Red Steam Locomotive
      this.addBox(headMeshGroup, 0.24, 0.05, 0.48, 0, 0.02, 0, '#dc2626'); // Red chassis/wheels
      this.addBox(headMeshGroup, 0.25, 0.17, 0.16, 0, 0.07, -0.14, '#1e293b'); // Cab
      this.addBox(headMeshGroup, 0.26, 0.025, 0.18, 0, 0.24, -0.14, ownerColor); // Owner cab roof
      // Cylindrical black boiler
      const boiler = new THREE.Mesh(this.cylGeo, this.getMat('#18181b'));
      boiler.rotation.x = Math.PI / 2;
      boiler.scale.set(0.19, 0.31, 0.19);
      boiler.position.set(0, 0.145, 0.07);
      headMeshGroup.add(boiler);
      // Brass steam dome + tall front smokestack + headlamp
      const dome = new THREE.Mesh(this.sphereGeo, this.getMat('#eab308'));
      dome.scale.set(0.09, 0.08, 0.09);
      dome.position.set(0, 0.24, 0.04);
      headMeshGroup.add(dome);
      const stack = new THREE.Mesh(this.cylGeo, this.getMat('#09090b'));
      stack.scale.set(0.065, 0.11, 0.065);
      stack.position.set(0, 0.26, 0.17);
      headMeshGroup.add(stack);
      this.addBox(headMeshGroup, 0.06, 0.05, 0.02, 0, 0.14, 0.23, '#fef08a', '#fde047', 0.8);

      // 3 pooled steam puffs in world space inside rootGroup
      for (let p = 0; p < 3; p++) {
        const pm = new THREE.Mesh(this.sphereGeo, this.puffMat);
        pm.visible = false;
        rootGroup.add(pm);
        steamPuffs.push({ mesh: pm, age: p * 0.33 });
      }
    } else if (v.modelId === 'LOCO_DIESEL') {
      // Heavy Industrial Amber & Navy Diesel Locomotive
      this.addBox(headMeshGroup, 0.25, 0.05, 0.5, 0, 0.02, 0, '#1e293b');
      this.addBox(headMeshGroup, 0.26, 0.16, 0.48, 0, 0.07, 0, '#f59e0b');
      this.addBox(headMeshGroup, 0.27, 0.05, 0.49, 0, 0.11, 0, '#1e3a8a'); // Navy livery band
      this.addBox(headMeshGroup, 0.22, 0.03, 0.28, 0, 0.23, 0, ownerColor); // Roof accent
      // Front & rear windshields + headlights
      this.addBox(headMeshGroup, 0.21, 0.05, 0.02, 0, 0.165, 0.235, '#bae6fd', '#38bdf8', 0.35);
      this.addBox(headMeshGroup, 0.14, 0.03, 0.02, 0, 0.08, 0.245, '#fef08a', '#fde08a', 0.8);
    } else if (v.modelId === 'LOCO_ELECTRIC') {
      // Sleek Silver & Electric-Blue High-Speed Locomotive + Rooftop Pantograph
      this.addBox(headMeshGroup, 0.24, 0.045, 0.52, 0, 0.02, 0, '#334155');
      this.addBox(headMeshGroup, 0.26, 0.15, 0.48, 0, 0.065, 0, '#f1f5f9');
      this.addBox(headMeshGroup, 0.268, 0.045, 0.49, 0, 0.105, 0, ownerColor);
      // Aerodynamic nose + raked cyan cab glass
      this.addBox(headMeshGroup, 0.23, 0.08, 0.06, 0, 0.065, 0.25, '#e2e8f0');
      this.addBox(headMeshGroup, 0.21, 0.055, 0.05, 0, 0.145, 0.22, '#38bdf8', '#0ea5e9', 0.45);
      // Delicate silver rooftop pantograph diamond frame
      this.addBox(headMeshGroup, 0.03, 0.07, 0.14, 0, 0.215, -0.06, '#94a3b8');
      this.addBox(headMeshGroup, 0.18, 0.015, 0.02, 0, 0.285, -0.06, '#cbd5e1');
    } else if (v.modelId === 'BUS_CITY') {
      // Owner-Tinted City Passenger Coach
      this.addBox(headMeshGroup, 0.21, 0.035, 0.42, 0, 0.015, 0, '#1e293b');
      this.addBox(headMeshGroup, 0.22, 0.14, 0.42, 0, 0.045, 0, ownerColor);
      this.addBox(headMeshGroup, 0.226, 0.055, 0.36, 0, 0.11, 0, '#bae6fd', '#38bdf8', 0.3);
      this.addBox(headMeshGroup, 0.21, 0.02, 0.4, 0, 0.185, 0, '#f8fafc');
      this.addBox(headMeshGroup, 0.16, 0.025, 0.015, 0, 0.06, 0.212, '#fef08a', '#fde047', 0.7);
    } else {
      // TRUCK_CARGO: Owner-Colored Cab + Cargo-Specific Rear Bed
      this.addBox(headMeshGroup, 0.2, 0.035, 0.42, 0, 0.015, 0, '#1e293b');
      // Front cab
      this.addBox(headMeshGroup, 0.21, 0.15, 0.13, 0, 0.045, 0.14, ownerColor);
      this.addBox(headMeshGroup, 0.19, 0.05, 0.02, 0, 0.125, 0.2, '#bae6fd', '#38bdf8', 0.3);

      // Cargo trailer/bed behind cab
      if (v.cargoType === 'COAL' || v.cargoType === 'GRAIN') {
        this.addBox(headMeshGroup, 0.21, 0.09, 0.26, 0, 0.05, -0.07, '#64748b');
        const mound = this.addBox(
          headMeshGroup,
          0.18,
          0.07,
          0.22,
          0,
          0.12,
          -0.07,
          v.cargoType === 'COAL' ? '#18181b' : '#eab308'
        );
        cargoFillMeshes.push(mound);
      } else if (v.cargoType === 'WOOD') {
        this.addBox(headMeshGroup, 0.21, 0.025, 0.27, 0, 0.05, -0.07, '#475569');
        const logs = new THREE.Group();
        this.addBox(logs, 0.17, 0.09, 0.24, 0, 0.075, -0.07, '#854d0e');
        headMeshGroup.add(logs);
        cargoFillMeshes.push(logs);
      } else {
        // Enclosed box van (GOODS, FOOD, MAIL, PASSENGERS)
        const boxHex = CARGO_CONTAINER_COLORS[v.cargoType] || '#f8fafc';
        this.addBox(headMeshGroup, 0.22, 0.16, 0.27, 0, 0.05, -0.07, boxHex);
      }
    }

    // Build Trailing Wagons for Rail Trains
    const wagonGroups: THREE.Group[] = [];
    for (let w = 0; w < wagonCount; w++) {
      const wg = new THREE.Group();
      this.buildWagonMesh(wg, v.cargoType, ownerColor, cargoFillMeshes);
      rootGroup.add(wg);
      wagonGroups.push(wg);
    }

    // Status Beacon
    const statusBeacon = new THREE.Mesh(this.sphereGeo, this.amberBeaconMat);
    statusBeacon.scale.set(0.09, 0.09, 0.09);
    statusBeacon.visible = false;
    rootGroup.add(statusBeacon);

    const initTile = getTileAt(state, Math.round(v.x), Math.round(v.y));
    const initY = getTileSurfaceY(initTile) + (v.network === 'RAIL' ? 0.055 : 0.032);
    const initYaw =
      v.nextX !== v.x || v.nextY !== v.y
        ? Math.atan2(v.nextX - v.x, v.nextY - v.y)
        : (v.direction || 0) * (Math.PI / 2);

    // Seed breadcrumbs so trailing wagons immediately align cleanly along the track
    const breadcrumbs: Breadcrumb[] = [{ x: v.x, y: initY, z: v.y }];
    if (v.trail && v.trail.length > 0) {
      for (let tIdx = v.trail.length - 1; tIdx >= 0; tIdx--) {
        const pt = v.trail[tIdx];
        const tt = getTileAt(state, Math.round(pt.x), Math.round(pt.y));
        breadcrumbs.push({
          x: pt.x,
          y: getTileSurfaceY(tt) + 0.055,
          z: pt.y,
        });
      }
    }
    // Pad backward along opposite heading so even freshly bought trains have smooth wagon spacing
    const backX = -Math.sin(initYaw);
    const backZ = -Math.cos(initYaw);
    const tail = breadcrumbs[breadcrumbs.length - 1];
    for (let step = 1; step <= 16; step++) {
      const bx = tail.x + backX * step * 0.28;
      const bz = tail.z + backZ * step * 0.28;
      const bt = getTileAt(state, Math.round(bx), Math.round(bz));
      breadcrumbs.push({
        x: bx,
        y: bt ? getTileSurfaceY(bt) + 0.055 : tail.y,
        z: bz,
      });
    }

    return {
      id: v.id,
      modelId: v.modelId,
      cargoType: v.cargoType,
      wagonCount,
      ownerColor,
      rootGroup,
      headMeshGroup,
      wagonGroups,
      cargoFillMeshes,
      statusBeacon,
      steamPuffs,
      rawX: v.x,
      rawY: v.y,
      rawNextX: v.nextX,
      rawNextY: v.nextY,
      rawProgress: v.progress,
      visualProgress: v.progress,
      estProgressPerSec: 0,
      lastRawUpdateMs: nowPerfMs,
      currentYaw: initYaw,
      breadcrumbs,
    };
  }

  private buildWagonMesh(
    wg: THREE.Group,
    cargo: CargoType,
    ownerColor: string,
    cargoFillMeshes: THREE.Object3D[]
  ): void {
    // Shared bogies/chassis
    this.addBox(wg, 0.21, 0.04, 0.38, 0, 0.015, 0, '#1e293b');

    switch (cargo) {
      case 'PASSENGERS': {
        this.addBox(wg, 0.23, 0.14, 0.38, 0, 0.055, 0, ownerColor);
        this.addBox(wg, 0.236, 0.05, 0.33, 0, 0.11, 0, '#fef08a', '#facc15', 0.35);
        this.addBox(wg, 0.22, 0.025, 0.37, 0, 0.195, 0, '#cbd5e1');
        break;
      }
      case 'MAIL': {
        this.addBox(wg, 0.23, 0.145, 0.37, 0, 0.055, 0, '#b91c1c');
        this.addBox(wg, 0.236, 0.03, 0.37, 0, 0.11, 0, '#fbbf24');
        this.addBox(wg, 0.22, 0.02, 0.36, 0, 0.2, 0, '#475569');
        break;
      }
      case 'COAL': {
        // Dark steel open hopper + dynamic black coal load mound
        this.addBox(wg, 0.23, 0.11, 0.36, 0, 0.055, 0, '#3f3f46');
        const coalLoad = this.addBox(wg, 0.19, 0.08, 0.32, 0, 0.13, 0, '#09090b');
        cargoFillMeshes.push(coalLoad);
        break;
      }
      case 'WOOD': {
        // Flatbed stake car + stacked timber logs when loaded
        this.addBox(wg, 0.23, 0.025, 0.38, 0, 0.055, 0, '#78350f');
        for (const sx of [-0.1, 0.1]) {
          for (const sz of [-0.14, 0.14]) {
            this.addBox(wg, 0.02, 0.11, 0.02, sx, 0.08, sz, '#334155');
          }
        }
        const logStack = new THREE.Group();
        this.addBox(logStack, 0.17, 0.09, 0.33, 0, 0.08, 0, '#92400e');
        wg.add(logStack);
        cargoFillMeshes.push(logStack);
        break;
      }
      case 'GRAIN': {
        // Golden-wheat covered hopper car
        this.addBox(wg, 0.23, 0.135, 0.36, 0, 0.055, 0, '#d97706');
        this.addBox(wg, 0.18, 0.025, 0.34, 0, 0.19, 0, '#fef3c7');
        break;
      }
      case 'GOODS': {
        // Intermodal container flatbed
        this.addBox(wg, 0.23, 0.02, 0.38, 0, 0.055, 0, '#475569');
        const cont = this.addBox(wg, 0.22, 0.135, 0.35, 0, 0.075, 0, '#ea580c');
        cargoFillMeshes.push(cont);
        break;
      }
      case 'FOOD': {
        // Crisp white refrigerated reefer car with sky-blue stripe
        this.addBox(wg, 0.23, 0.145, 0.37, 0, 0.055, 0, '#f8fafc');
        this.addBox(wg, 0.236, 0.035, 0.37, 0, 0.115, 0, '#0284c7');
        break;
      }
    }
  }

  private recordBreadcrumb(
    inst: VehicleVisualInstance,
    wx: number,
    wy: number,
    wz: number
  ): void {
    const head = inst.breadcrumbs[0];
    if (!head) {
      inst.breadcrumbs.unshift({ x: wx, y: wy, z: wz });
      return;
    }

    const dist = Math.hypot(wx - head.x, wz - head.z);
    if (dist > 2.4) {
      // Teleported or newly spawned demo route: reset breadcrumbs cleanly
      inst.breadcrumbs = [{ x: wx, y: wy, z: wz }];
      const backX = -Math.sin(inst.currentYaw);
      const backZ = -Math.cos(inst.currentYaw);
      for (let s = 1; s <= 16; s++) {
        inst.breadcrumbs.push({
          x: wx + backX * s * 0.28,
          y: wy,
          z: wz + backZ * s * 0.28,
        });
      }
      return;
    }

    if (dist >= 0.045) {
      inst.breadcrumbs.unshift({ x: wx, y: wy, z: wz });
      if (inst.breadcrumbs.length > 110) {
        inst.breadcrumbs.length = 110;
      }
    } else {
      head.x = wx;
      head.y = wy;
      head.z = wz;
    }
  }

  private sampleBreadcrumbAtDistance(
    crumbs: Breadcrumb[],
    targetDist: number
  ): { x: number; y: number; z: number; yaw: number; pitch: number } {
    let accum = 0;
    for (let i = 0; i < crumbs.length - 1; i++) {
      const a = crumbs[i];
      const b = crumbs[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 1e-5) continue;

      if (accum + segLen >= targetDist) {
        const frac = (targetDist - accum) / segLen;
        const x = a.x + (b.x - a.x) * frac;
        const y = a.y + (b.y - a.y) * frac;
        const z = a.z + (b.z - a.z) * frac;
        // Forward tangent points from older crumb `b` toward newer crumb `a`
        const yaw = Math.atan2(a.x - b.x, a.z - b.z);
        const pitch = -Math.atan2(a.y - b.y, segLen);
        return { x, y, z, yaw, pitch };
      }
      accum += segLen;
    }

    const last = crumbs[crumbs.length - 1];
    const prev = crumbs.length >= 2 ? crumbs[crumbs.length - 2] : last;
    const yaw = Math.atan2(prev.x - last.x, prev.z - last.z);
    return { x: last.x, y: last.y, z: last.z, yaw, pitch: 0 };
  }

  private updateTrailingWagons(inst: VehicleVisualInstance): void {
    const spacing = 0.45;
    for (let w = 0; w < inst.wagonGroups.length; w++) {
      const sample = this.sampleBreadcrumbAtDistance(
        inst.breadcrumbs,
        (w + 1) * spacing
      );
      const wg = inst.wagonGroups[w];
      wg.position.set(sample.x, sample.y, sample.z);
      wg.rotation.set(sample.pitch, sample.yaw, 0, 'YXZ');
    }
  }

  private updateSteamPuffs(
    inst: VehicleVisualInstance,
    wx: number,
    wy: number,
    wz: number,
    isMoving: boolean,
    dt: number
  ): void {
    const stackFwdX = Math.sin(inst.currentYaw) * 0.16;
    const stackFwdZ = Math.cos(inst.currentYaw) * 0.16;

    for (let i = 0; i < inst.steamPuffs.length; i++) {
      const puff = inst.steamPuffs[i];
      if (!isMoving) {
        puff.mesh.visible = false;
        continue;
      }
      puff.age += dt * 1.15;
      if (puff.age >= 1.0) {
        puff.age %= 1.0;
        puff.mesh.position.set(wx + stackFwdX, wy + 0.3, wz + stackFwdZ);
      } else {
        puff.mesh.position.y += dt * 0.38;
      }
      const s = 0.06 + puff.age * 0.12;
      puff.mesh.scale.set(s, s, s);
      puff.mesh.visible = puff.age < 0.92;
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
    this.puffMat.dispose();
    this.amberBeaconMat.dispose();
    this.redBeaconMat.dispose();
  }
}
