import * as THREE from 'three';
import type { AICompany, GameState, Tile, ToolType, Vehicle } from '../types/game';

export const ELEV_STEP = 0.28;
export const WATER_SURFACE_Y = 0.08;
export const TERRAIN_BASE_Y = -0.38;

// Classic Transport Tycoon isometric pitch: -atan(1 / sqrt(2)) ≈ -35.2643897 deg
export const ISO_PITCH_RAD = -Math.atan(1 / Math.sqrt(2));
const CAMERA_DISTANCE = 140;
const BASE_FRUSTUM_HEIGHT = 24;
const MIN_ZOOM = 0.42;
const MAX_ZOOM = 3.5;

export function getTileSurfaceY(tile: Pick<Tile, 'terrain' | 'elevation'> | undefined | null): number {
  if (!tile) return ELEV_STEP;
  if (tile.terrain === 'WATER' && tile.elevation <= 0) {
    return WATER_SURFACE_Y;
  }
  return Math.max(0.2, tile.elevation * ELEV_STEP);
}

export function getTileAt(
  state: Pick<GameState, 'mapSize' | 'tiles'>,
  x: number,
  y: number
): Tile | undefined {
  const { mapSize, tiles } = state;
  if (x < 0 || y < 0 || x >= mapSize || y >= mapSize || tiles.length === 0) {
    return undefined;
  }
  const rowMajor = tiles[y * mapSize + x];
  if (rowMajor && rowMajor.x === x && rowMajor.y === y) {
    return rowMajor;
  }
  const colMajor = tiles[x * mapSize + y];
  if (colMajor && colMajor.x === x && colMajor.y === y) {
    return colMajor;
  }
  return rowMajor;
}

export function resolveOwnerColor(
  ownerId: string | null | undefined,
  aiCompanies: AICompany[]
): string {
  if (!ownerId || ownerId === 'player' || ownerId === 'PLAYER') {
    return '#2563eb'; // Classic TTD Royal Blue
  }
  for (let i = 0; i < aiCompanies.length; i++) {
    if (aiCompanies[i].id === ownerId) {
      return aiCompanies[i].color || '#dc2626';
    }
  }
  if (ownerId === 'ai-1') return '#dc2626';
  if (ownerId === 'ai-2') return '#d97706';
  if (ownerId === 'ai-3') return '#9333ea';
  return '#0d9488';
}

export function formatNorwegianInt(value: number): string {
  const rounded = Math.round(value);
  const absStr = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return rounded < 0 ? `-${absStr}` : absStr;
}

export interface ScreenProjection {
  x: number;
  y: number;
  visible: boolean;
}

export interface PickedTileResult {
  x: number;
  y: number;
  tile: Tile;
}

export class IsoSceneManager {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.OrthographicCamera;
  public readonly renderer: THREE.WebGLRenderer;

  private container: HTMLElement;
  private viewportWidth = 1;
  private viewportHeight = 1;

  private panTarget = new THREE.Vector3(32, ELEV_STEP, 32);
  private desiredPanTarget = new THREE.Vector3(32, ELEV_STEP, 32);

  private currentYaw = Math.PI / 4;
  private targetYaw = Math.PI / 4;

  private currentZoom = 1.05;
  private targetZoom = 1.05;

  private mapSize = 64;
  private hasInitializedCenter = false;

  // Keyboard pan state
  private pressedKeys = new Set<string>();

  // Hover & Drag preview instanced visuals
  private previewGroup = new THREE.Group();
  private cursorRingMesh: THREE.Mesh;
  private cursorFillMesh: THREE.Mesh;
  private dragInstancedMesh: THREE.InstancedMesh;
  private dragBorderInstancedMesh: THREE.InstancedMesh;
  private readonly maxPreviewInstances = 256;

  // Scratch math objects to avoid GC pressure at 60 FPS
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpNdc = new THREE.Vector2();
  private readonly tmpVec3 = new THREE.Vector3();
  private readonly tmpMat4 = new THREE.Matrix4();
  private readonly tmpColor = new THREE.Color();

  constructor(container: HTMLElement) {
    this.container = container;
    this.viewportWidth = Math.max(1, container.clientWidth || window.innerWidth);
    this.viewportHeight = Math.max(1, container.clientHeight || window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0f2438');

    const aspect = this.viewportWidth / this.viewportHeight;
    const halfH = BASE_FRUSTUM_HEIGHT / 2;
    const halfW = halfH * aspect;

    this.camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, 360);
    this.camera.rotation.order = 'YXZ';
    this.camera.zoom = this.currentZoom;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    // Cap pixel ratio at 1.75 so high-DPI school Chromebooks stay locked at 60 FPS
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(this.viewportWidth, this.viewportHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const dom = this.renderer.domElement;
    dom.style.width = '100%';
    dom.style.height = '100%';
    dom.style.display = 'block';
    dom.style.touchAction = 'none';
    container.appendChild(dom);

    this.setupLighting();

    // Build reusable hover cursor + drag preview meshes
    const ringGeo = new THREE.RingGeometry(0.42, 0.5, 4);
    ringGeo.rotateX(-Math.PI / 2);
    ringGeo.rotateY(Math.PI / 4);
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#fde047',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    this.cursorRingMesh = new THREE.Mesh(ringGeo, ringMat);
    this.cursorRingMesh.renderOrder = 25;
    this.cursorRingMesh.visible = false;

    const fillGeo = new THREE.PlaneGeometry(0.94, 0.94);
    fillGeo.rotateX(-Math.PI / 2);
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#fef08a',
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    this.cursorFillMesh = new THREE.Mesh(fillGeo, fillMat);
    this.cursorFillMesh.renderOrder = 24;
    this.cursorFillMesh.visible = false;

    const dragTileGeo = new THREE.BoxGeometry(0.92, 0.05, 0.92);
    const dragTileMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.dragInstancedMesh = new THREE.InstancedMesh(
      dragTileGeo,
      dragTileMat,
      this.maxPreviewInstances
    );
    this.dragInstancedMesh.count = 0;
    this.dragInstancedMesh.frustumCulled = false;
    this.dragInstancedMesh.renderOrder = 23;

    const dragRimGeo = new THREE.RingGeometry(0.41, 0.48, 4);
    dragRimGeo.rotateX(-Math.PI / 2);
    dragRimGeo.rotateY(Math.PI / 4);
    const dragRimMat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    this.dragBorderInstancedMesh = new THREE.InstancedMesh(
      dragRimGeo,
      dragRimMat,
      this.maxPreviewInstances
    );
    this.dragBorderInstancedMesh.count = 0;
    this.dragBorderInstancedMesh.frustumCulled = false;
    this.dragBorderInstancedMesh.renderOrder = 26;

    this.previewGroup.add(
      this.cursorFillMesh,
      this.cursorRingMesh,
      this.dragInstancedMesh,
      this.dragBorderInstancedMesh
    );
    this.scene.add(this.previewGroup);

    this.syncCameraTransform();
  }

  private setupLighting(): void {
    // Balanced TTD daylight: bright sky/emerald bounce + crisp angled sun for 3D facet contrast
    const hemiLight = new THREE.HemisphereLight('#f8fafc', '#2d5a36', 1.05);
    hemiLight.position.set(0, 60, 0);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight('#fff8e7', 1.15);
    sunLight.position.set(-45, 78, 32);
    this.scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight('#bae6fd', 0.35);
    fillLight.position.set(40, 35, -45);
    this.scene.add(fillLight);
  }

  public ensureInitialCenter(state: GameState): void {
    if (this.hasInitializedCenter && this.mapSize === state.mapSize) {
      return;
    }
    this.mapSize = state.mapSize;
    this.hasInitializedCenter = true;

    let cx = (state.mapSize - 1) * 0.5;
    let cy = (state.mapSize - 1) * 0.5;

    if (state.corporate.hqTile) {
      cx = state.corporate.hqTile.x;
      cy = state.corporate.hqTile.y;
    } else if (state.towns.length > 0) {
      // Pick town closest to map center so student starts over a lively Norwegian town
      let bestDist = Infinity;
      for (const town of state.towns) {
        const dx = town.x - cx;
        const dy = town.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          cx = town.x;
          cy = town.y;
        }
      }
    }

    const centerTile = getTileAt(state, Math.round(cx), Math.round(cy));
    const sy = getTileSurfaceY(centerTile);
    this.panTarget.set(cx, sy, cy);
    this.desiredPanTarget.copy(this.panTarget);
    this.syncCameraTransform();
  }

  public setMapRotationStep(step: number): void {
    const normalized = ((step % 4) + 4) % 4;
    this.targetYaw = Math.PI / 4 + normalized * (Math.PI / 2);
  }

  public applyZoomCommand(type: 'IN' | 'OUT'): void {
    const factor = type === 'IN' ? 1.28 : 1 / 1.28;
    this.targetZoom = THREE.MathUtils.clamp(this.targetZoom * factor, MIN_ZOOM, MAX_ZOOM);
  }

  public zoomAtScreenPoint(deltaY: number, clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const factor = Math.pow(0.9988, deltaY);
    const nextZoom = THREE.MathUtils.clamp(this.targetZoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(nextZoom - this.targetZoom) < 1e-5) return;

    // Subtle zoom-toward-cursor shift so zooming into a station/town feels effortless
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);

    const aspect = this.viewportWidth / this.viewportHeight;
    const worldWBefore = (BASE_FRUSTUM_HEIGHT * aspect) / this.targetZoom;
    const worldHBefore = BASE_FRUSTUM_HEIGHT / this.targetZoom;
    const worldWAfter = (BASE_FRUSTUM_HEIGHT * aspect) / nextZoom;
    const worldHAfter = BASE_FRUSTUM_HEIGHT / nextZoom;

    const shiftRight = (ndcX * 0.5) * (worldWBefore - worldWAfter);
    const shiftUp = (ndcY * 0.5) * (worldHBefore - worldHAfter) / Math.sin(-ISO_PITCH_RAD);

    const rightX = Math.cos(this.currentYaw);
    const rightZ = -Math.sin(this.currentYaw);
    const upX = -Math.sin(this.currentYaw);
    const upZ = -Math.cos(this.currentYaw);

    this.desiredPanTarget.x += rightX * shiftRight + upX * shiftUp;
    this.desiredPanTarget.z += rightZ * shiftRight + upZ * shiftUp;
    this.clampPanTarget();

    this.targetZoom = nextZoom;
  }

  public panByScreenPixels(deltaPxX: number, deltaPxY: number): void {
    if (this.viewportWidth <= 0 || this.viewportHeight <= 0) return;

    const aspect = this.viewportWidth / this.viewportHeight;
    const frustumW = (BASE_FRUSTUM_HEIGHT * aspect) / this.currentZoom;
    const frustumH = BASE_FRUSTUM_HEIGHT / this.currentZoom;

    // Exact 1:1 ground plane locking under mouse drag in orthographic isometric projection
    const worldRightDelta = -(deltaPxX / this.viewportWidth) * frustumW;
    const worldUpDelta =
      ((deltaPxY / this.viewportHeight) * frustumH) / Math.sin(-ISO_PITCH_RAD);

    const rightX = Math.cos(this.currentYaw);
    const rightZ = -Math.sin(this.currentYaw);
    const upX = -Math.sin(this.currentYaw);
    const upZ = -Math.cos(this.currentYaw);

    this.desiredPanTarget.x += rightX * worldRightDelta + upX * worldUpDelta;
    this.desiredPanTarget.z += rightZ * worldRightDelta + upZ * worldUpDelta;
    this.clampPanTarget();
    this.panTarget.copy(this.desiredPanTarget);
  }

  public focusOnTile(x: number, y: number, state: GameState): void {
    const tile = getTileAt(state, Math.round(x), Math.round(y));
    const sy = getTileSurfaceY(tile);
    this.desiredPanTarget.set(x, sy, y);
    this.clampPanTarget();
  }

  public setKeyState(code: string, isDown: boolean): void {
    if (isDown) {
      this.pressedKeys.add(code);
    } else {
      this.pressedKeys.delete(code);
    }
  }

  public clearKeys(): void {
    this.pressedKeys.clear();
  }

  public isSpaceHeld(): boolean {
    return this.pressedKeys.has('Space');
  }

  public resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, Math.floor(width));
    this.viewportHeight = Math.max(1, Math.floor(height));

    const aspect = this.viewportWidth / this.viewportHeight;
    const halfH = BASE_FRUSTUM_HEIGHT / 2;
    const halfW = halfH * aspect;

    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(this.viewportWidth, this.viewportHeight);
  }

  public getViewportSize(): { width: number; height: number } {
    return { width: this.viewportWidth, height: this.viewportHeight };
  }

  private clampPanTarget(): void {
    const margin = 2;
    this.desiredPanTarget.x = THREE.MathUtils.clamp(
      this.desiredPanTarget.x,
      -margin,
      this.mapSize - 1 + margin
    );
    this.desiredPanTarget.z = THREE.MathUtils.clamp(
      this.desiredPanTarget.z,
      -margin,
      this.mapSize - 1 + margin
    );
  }

  public updateCamera(dtSec: number): void {
    const dt = Math.min(0.08, Math.max(0.001, dtSec));

    // Handle WASD / Arrow keys camera panning
    let moveRight = 0;
    let moveUp = 0;
    if (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight')) moveRight += 1;
    if (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft')) moveRight -= 1;
    if (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp')) moveUp += 1;
    if (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown')) moveUp -= 1;

    if (moveRight !== 0 || moveUp !== 0) {
      const len = Math.hypot(moveRight, moveUp);
      moveRight /= len;
      moveUp /= len;

      const panSpeed = (22 / Math.sqrt(this.currentZoom)) * dt;
      const rightX = Math.cos(this.currentYaw);
      const rightZ = -Math.sin(this.currentYaw);
      const upX = -Math.sin(this.currentYaw);
      const upZ = -Math.cos(this.currentYaw);

      this.desiredPanTarget.x += (rightX * moveRight + upX * moveUp) * panSpeed;
      this.desiredPanTarget.z += (rightZ * moveRight + upZ * moveUp) * panSpeed;
      this.clampPanTarget();
    }

    // Smoothly damp zoom, rotation yaw, and pan target
    const smoothFactor = 1 - Math.exp(-16 * dt);

    if (Math.abs(this.targetZoom - this.currentZoom) > 0.0004) {
      this.currentZoom = THREE.MathUtils.lerp(this.currentZoom, this.targetZoom, smoothFactor);
      this.camera.zoom = this.currentZoom;
      this.camera.updateProjectionMatrix();
    } else if (this.currentZoom !== this.targetZoom) {
      this.currentZoom = this.targetZoom;
      this.camera.zoom = this.currentZoom;
      this.camera.updateProjectionMatrix();
    }

    // Shortest angular delta for 90-degree step rotations
    let angleDiff = this.targetYaw - this.currentYaw;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    if (Math.abs(angleDiff) > 0.0005) {
      this.currentYaw += angleDiff * (1 - Math.exp(-15 * dt));
    } else {
      this.currentYaw = this.targetYaw;
    }

    this.panTarget.lerp(this.desiredPanTarget, smoothFactor);
    this.syncCameraTransform();
  }

  private syncCameraTransform(): void {
    // Classic TTD Isometric Camera:
    // rotation.order = 'YXZ', rotation.y = yaw, rotation.x = -atan(1 / sqrt(2))
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.currentYaw;
    this.camera.rotation.x = ISO_PITCH_RAD;
    this.camera.rotation.z = 0;

    // Position camera along its backward (+Z local) ray from panTarget
    const cosPitch = Math.cos(ISO_PITCH_RAD);
    const backX = Math.sin(this.currentYaw) * cosPitch;
    const backY = -Math.sin(ISO_PITCH_RAD); // +1 / sqrt(3)
    const backZ = Math.cos(this.currentYaw) * cosPitch;

    this.camera.position.set(
      this.panTarget.x + backX * CAMERA_DISTANCE,
      this.panTarget.y + backY * CAMERA_DISTANCE,
      this.panTarget.z + backZ * CAMERA_DISTANCE
    );
    this.camera.updateMatrixWorld();
  }

  /**
   * Fast heightfield raymarch picker: picks the exact elevated tile under the cursor in <0.005 ms
   * without traversing thousands of Three.js triangle meshes.
   */
  public pickTileAtClientPos(
    clientX: number,
    clientY: number,
    state: GameState
  ): PickedTileResult | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    this.tmpNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1)
    );
    this.raycaster.setFromCamera(this.tmpNdc, this.camera);

    const origin = this.raycaster.ray.origin;
    const dir = this.raycaster.ray.direction;
    if (Math.abs(dir.y) < 1e-5) return null;

    // Intersect ray from max hill height (y = 2.2) down to base plane (y = -0.05)
    const maxY = 2.2;
    const minY = -0.05;
    const tStart = (maxY - origin.y) / dir.y;
    const tEnd = (minY - origin.y) / dir.y;
    const t0 = Math.min(tStart, tEnd);
    const t1 = Math.max(tStart, tEnd);

    const steps = 56;
    const dt = (t1 - t0) / steps;

    for (let i = 0; i <= steps; i++) {
      const t = t0 + i * dt;
      const wx = origin.x + dir.x * t;
      const wy = origin.y + dir.y * t;
      const wz = origin.z + dir.z * t;

      const gx = Math.round(wx);
      const gy = Math.round(wz);
      const tile = getTileAt(state, gx, gy);
      if (tile) {
        const surfY = getTileSurfaceY(tile);
        if (wy <= surfY + 0.02) {
          return { x: gx, y: gy, tile };
        }
      }
    }

    return null;
  }

  /**
   * Checks if the user clicked directly on an active vehicle in screen space.
   */
  public pickVehicleAtClientPos(
    clientX: number,
    clientY: number,
    vehicles: Vehicle[],
    state: GameState
  ): Vehicle | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const hitRadius = THREE.MathUtils.clamp(18 * Math.sqrt(this.currentZoom), 14, 30);
    const hitRadiusSq = hitRadius * hitRadius;

    let bestVehicle: Vehicle | null = null;
    let bestDistSq = hitRadiusSq;

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (v.state === 'IN_DEPOT') continue;

      const prog = THREE.MathUtils.clamp(v.progress || 0, 0, 1);
      const wx = v.x + (v.nextX - v.x) * prog;
      const wz = v.y + (v.nextY - v.y) * prog;
      const tA = getTileAt(state, Math.round(v.x), Math.round(v.y));
      const tB = getTileAt(state, Math.round(v.nextX), Math.round(v.nextY));
      const wy =
        THREE.MathUtils.lerp(getTileSurfaceY(tA), getTileSurfaceY(tB), prog) + 0.18;

      const proj = this.projectWorldToScreen(wx, wy, wz);
      if (!proj.visible) continue;

      const dx = proj.x - localX;
      const dy = proj.y - localY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestVehicle = v;
      }
    }

    return bestVehicle;
  }

  public projectWorldToScreen(wx: number, wy: number, wz: number): ScreenProjection {
    this.tmpVec3.set(wx, wy, wz);
    this.tmpVec3.project(this.camera);

    const visible =
      this.tmpVec3.z >= -1.05 &&
      this.tmpVec3.z <= 1.05 &&
      this.tmpVec3.x >= -1.25 &&
      this.tmpVec3.x <= 1.25 &&
      this.tmpVec3.y >= -1.25 &&
      this.tmpVec3.y <= 1.25;

    return {
      x: (this.tmpVec3.x * 0.5 + 0.5) * this.viewportWidth,
      y: (-this.tmpVec3.y * 0.5 + 0.5) * this.viewportHeight,
      visible,
    };
  }

  public updateHoverAndDragPreview(
    hoverTile: PickedTileResult | null,
    dragTiles: Array<{ x: number; y: number }> | null,
    activeTool: ToolType,
    isOrderPickerActive: boolean,
    state: GameState,
    timeSec: number
  ): void {
    // 1. Drag line preview (for ROAD / RAIL dragging)
    if (dragTiles && dragTiles.length > 0) {
      this.cursorRingMesh.visible = false;
      this.cursorFillMesh.visible = false;

      const count = Math.min(dragTiles.length, this.maxPreviewInstances);
      this.dragInstancedMesh.count = count;
      this.dragBorderInstancedMesh.count = count;

      const pulse = 0.85 + 0.15 * Math.sin(timeSec * 8);

      for (let i = 0; i < count; i++) {
        const pt = dragTiles[i];
        const tile = getTileAt(state, pt.x, pt.y);
        const surfY = getTileSurfaceY(tile);
        const canBuild = tile ? tile.terrain !== 'WATER' && !tile.industryId : false;

        this.tmpMat4.makeTranslation(pt.x, surfY + 0.035, pt.y);
        this.dragInstancedMesh.setMatrixAt(i, this.tmpMat4);

        this.tmpMat4.makeTranslation(pt.x, surfY + 0.045, pt.y);
        this.dragBorderInstancedMesh.setMatrixAt(i, this.tmpMat4);

        this.tmpColor.set(canBuild ? '#38bdf8' : '#ef4444').multiplyScalar(pulse);
        this.dragInstancedMesh.setColorAt(i, this.tmpColor);
        this.tmpColor.set(canBuild ? '#fde047' : '#fca5a5');
        this.dragBorderInstancedMesh.setColorAt(i, this.tmpColor);
      }

      this.dragInstancedMesh.instanceMatrix.needsUpdate = true;
      this.dragBorderInstancedMesh.instanceMatrix.needsUpdate = true;
      if (this.dragInstancedMesh.instanceColor) {
        this.dragInstancedMesh.instanceColor.needsUpdate = true;
      }
      if (this.dragBorderInstancedMesh.instanceColor) {
        this.dragBorderInstancedMesh.instanceColor.needsUpdate = true;
      }
      return;
    }

    this.dragInstancedMesh.count = 0;
    this.dragBorderInstancedMesh.count = 0;

    // 2. Single-tile hover cursor
    if (!hoverTile) {
      this.cursorRingMesh.visible = false;
      this.cursorFillMesh.visible = false;
      return;
    }

    const { x, y, tile } = hoverTile;
    const surfY = getTileSurfaceY(tile);

    let ringHex = '#fde047';
    let fillHex = '#fef08a';

    if (isOrderPickerActive) {
      if (tile.stationId) {
        ringHex = '#4ade80';
        fillHex = '#22c55e';
      } else {
        ringHex = '#38bdf8';
        fillHex = '#0ea5e9';
      }
    } else if (activeTool === 'BULLDOZE') {
      ringHex = '#ef4444';
      fillHex = '#f87171';
    } else if (activeTool !== 'SELECT') {
      const blockedByWater = tile.terrain === 'WATER';
      ringHex = blockedByWater ? '#ef4444' : '#34d399';
      fillHex = blockedByWater ? '#f87171' : '#10b981';
    }

    const ringMat = this.cursorRingMesh.material as THREE.MeshBasicMaterial;
    const fillMat = this.cursorFillMesh.material as THREE.MeshBasicMaterial;
    ringMat.color.set(ringHex);
    fillMat.color.set(fillHex);
    fillMat.opacity = activeTool === 'SELECT' && !isOrderPickerActive ? 0.14 : 0.28;

    this.cursorFillMesh.position.set(x, surfY + 0.022, y);
    this.cursorRingMesh.position.set(x, surfY + 0.028, y);
    this.cursorFillMesh.visible = true;
    this.cursorRingMesh.visible = true;
  }

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    this.pressedKeys.clear();
    this.cursorRingMesh.geometry.dispose();
    (this.cursorRingMesh.material as THREE.Material).dispose();
    this.cursorFillMesh.geometry.dispose();
    (this.cursorFillMesh.material as THREE.Material).dispose();
    this.dragInstancedMesh.geometry.dispose();
    (this.dragInstancedMesh.material as THREE.Material).dispose();
    this.dragBorderInstancedMesh.geometry.dispose();
    (this.dragBorderInstancedMesh.material as THREE.Material).dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
