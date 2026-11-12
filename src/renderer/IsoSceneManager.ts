import * as THREE from 'three';
import type { AICompany, GameState, Tile, ToolType, Vehicle } from '../types/game';

export const ELEV_STEP = 0.28;
export const WATER_SURFACE_Y = 0.08;
export const TERRAIN_BASE_Y = -0.52;

// Classic Transport Tycoon isometric pitch: -atan(1 / sqrt(2)) ≈ -35.2643897 deg
export const ISO_PITCH_RAD = -Math.atan(1 / Math.sqrt(2));
const CAMERA_DISTANCE = 140;
const BASE_FRUSTUM_HEIGHT = 24;
const MIN_ZOOM = 0.42;
const MAX_ZOOM = 3.5;

export interface TileCornerHeights {
  cNW: number;
  cNE: number;
  cSE: number;
  cSW: number;
  minY: number;
  maxY: number;
  centerY: number;
  isSloped: boolean;
  splitNWSE: boolean;
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

/**
 * Computes the continuous TTD corner vertex height at grid corner `(cx, cy)` in `[0..mapSize, 0..mapSize]`,
 * located at world coordinates `(cx - 0.5, cornerY, cy - 0.5)`.
 * Averages the elevations of the up to 4 adjacent tiles; if ANY adjacent tile is WATER (`elevation <= 0`),
 * clamps `cornerY = WATER_SURFACE_Y` so coastlines slope smoothly down to water level.
 */
export function getCornerHeight(
  state: Pick<GameState, 'mapSize' | 'tiles'>,
  cx: number,
  cy: number
): number {
  const { mapSize } = state;
  const clampedCx = Math.max(0, Math.min(mapSize, Math.round(cx)));
  const clampedCy = Math.max(0, Math.min(mapSize, Math.round(cy)));

  let elevSum = 0;
  let count = 0;

  for (let dy = -1; dy <= 0; dy++) {
    const ty = clampedCy + dy;
    if (ty < 0 || ty >= mapSize) continue;
    for (let dx = -1; dx <= 0; dx++) {
      const tx = clampedCx + dx;
      if (tx < 0 || tx >= mapSize) continue;
      const t = getTileAt(state, tx, ty);
      if (!t) continue;
      if (t.terrain === 'WATER' || t.elevation <= 0) {
        return WATER_SURFACE_Y;
      }
      elevSum += t.elevation;
      count++;
    }
  }

  if (count === 0) return WATER_SURFACE_Y;
  const avgElev = elevSum / count;
  return Math.max(WATER_SURFACE_Y, avgElev * ELEV_STEP);
}

/**
 * Returns the 4 corner heights `(cNW, cNE, cSE, cSW)` of tile `(x, y)` plus min/max/center metadata
 * and the deterministic triangulation diagonal choice (`splitNWSE`).
 */
export function getTileCornerHeights(
  state: Pick<GameState, 'mapSize' | 'tiles'>,
  x: number,
  y: number
): TileCornerHeights {
  const gx = Math.max(0, Math.min(state.mapSize - 1, Math.round(x)));
  const gy = Math.max(0, Math.min(state.mapSize - 1, Math.round(y)));

  const tile = getTileAt(state, gx, gy);
  if (tile && (tile.terrain === 'WATER' || tile.elevation <= 0)) {
    return {
      cNW: WATER_SURFACE_Y,
      cNE: WATER_SURFACE_Y,
      cSE: WATER_SURFACE_Y,
      cSW: WATER_SURFACE_Y,
      minY: WATER_SURFACE_Y,
      maxY: WATER_SURFACE_Y,
      centerY: WATER_SURFACE_Y,
      isSloped: false,
      splitNWSE: true,
    };
  }

  const cNW = getCornerHeight(state, gx, gy);
  const cNE = getCornerHeight(state, gx + 1, gy);
  const cSE = getCornerHeight(state, gx + 1, gy + 1);
  const cSW = getCornerHeight(state, gx, gy + 1);

  const minY = Math.min(cNW, cNE, cSE, cSW);
  const maxY = Math.max(cNW, cNE, cSE, cSW);
  const splitNWSE = Math.abs(cNW - cSE) <= Math.abs(cNE - cSW);
  const centerY = splitNWSE ? 0.5 * (cNW + cSE) : 0.5 * (cNE + cSW);
  const isSloped = maxY - minY > 0.002;

  return {
    cNW,
    cNE,
    cSE,
    cSW,
    minY,
    maxY,
    centerY,
    isSloped,
    splitNWSE,
  };
}

/**
 * Exact continuous surface height at arbitrary world `(worldX, worldZ)` matching the 2 triangles
 * of tile `(Math.round(worldX), Math.round(worldZ))` to machine precision.
 */
export function getSurfaceHeightAt(
  state: Pick<GameState, 'mapSize' | 'tiles'>,
  worldX: number,
  worldZ: number
): number {
  const { mapSize } = state;
  if (mapSize <= 0 || state.tiles.length === 0) return ELEV_STEP;

  const clampedX = Math.max(-0.5, Math.min(mapSize - 0.50001, worldX));
  const clampedZ = Math.max(-0.5, Math.min(mapSize - 0.50001, worldZ));

  const rx = Math.max(0, Math.min(mapSize - 1, Math.floor(clampedX + 0.5)));
  const rz = Math.max(0, Math.min(mapSize - 1, Math.floor(clampedZ + 0.5)));

  const corners = getTileCornerHeights(state, rx, rz);
  if (!corners.isSloped) {
    return corners.cNW;
  }

  const u = Math.max(0, Math.min(1, clampedX - (rx - 0.5)));
  const v = Math.max(0, Math.min(1, clampedZ - (rz - 0.5)));
  const { cNW, cNE, cSE, cSW, splitNWSE } = corners;

  if (splitNWSE) {
    // Split along NW(0,0) -> SE(1,1)
    if (u >= v) {
      // Triangle NW - SE - NE
      return cNW + u * (cNE - cNW) + v * (cSE - cNE);
    }
    // Triangle NW - SW - SE
    return cNW + v * (cSW - cNW) + u * (cSE - cSW);
  } else {
    // Split along NE(1,0) -> SW(0,1)
    if (u + v <= 1) {
      // Triangle NW - SW - NE
      return cNW + u * (cNE - cNW) + v * (cSW - cNW);
    }
    // Triangle NE - SW - SE
    return cSE + (1 - u) * (cSW - cSE) + (1 - v) * (cNE - cSE);
  }
}

export function getTileSurfaceY(
  tile: Pick<Tile, 'x' | 'y' | 'terrain' | 'elevation'> | undefined | null,
  state?: Pick<GameState, 'mapSize' | 'tiles'>
): number {
  if (!tile) return ELEV_STEP;
  if (tile.terrain === 'WATER' && tile.elevation <= 0) {
    return WATER_SURFACE_Y;
  }
  if (state) {
    return getSurfaceHeightAt(state, tile.x, tile.y);
  }
  return Math.max(WATER_SURFACE_Y, tile.elevation * ELEV_STEP);
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
  if (ownerId === 'ai-3') return '#7c3aed';
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

  // Directional sun light whose shadow camera tracks panTarget cleanly every frame
  private sunLight!: THREE.DirectionalLight;
  private readonly sunOffsetDir = new THREE.Vector3(-0.62, 0.78, 0.44).normalize();
  private readonly shadowRight = new THREE.Vector3();
  private readonly shadowUp = new THREE.Vector3();

  // Keyboard pan state
  private pressedKeys = new Set<string>();

  // Sloped Hover & Drag preview visuals conforming to exact corner heights
  private previewGroup = new THREE.Group();
  private cursorFillGeo: THREE.BufferGeometry;
  private cursorFillPositions: Float32Array;
  private cursorFillMesh: THREE.Mesh;

  private cursorOutlineGeo: THREE.BufferGeometry;
  private cursorOutlinePositions: Float32Array;
  private cursorOutlineLoop: THREE.LineSegments;

  private readonly maxPreviewInstances = 256;
  private dragFillGeo: THREE.BufferGeometry;
  private dragFillPositions: Float32Array;
  private dragFillColors: Float32Array;
  private dragFillMesh: THREE.Mesh;

  private dragOutlineGeo: THREE.BufferGeometry;
  private dragOutlinePositions: Float32Array;
  private dragOutlineColors: Float32Array;
  private dragOutlineLines: THREE.LineSegments;

  // Scratch math objects to avoid GC pressure at 60 FPS
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpNdc = new THREE.Vector2();
  private readonly tmpVec3 = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  constructor(container: HTMLElement) {
    this.container = container;
    this.viewportWidth = Math.max(1, container.clientWidth || window.innerWidth);
    this.viewportHeight = Math.max(1, container.clientHeight || window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c1e2e');

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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const dom = this.renderer.domElement;
    dom.style.width = '100%';
    dom.style.height = '100%';
    dom.style.display = 'block';
    dom.style.touchAction = 'none';
    container.appendChild(dom);

    this.setupLighting();

    // 1. Sloped Single-Tile Cursor Quad (2 triangles = 6 vertices) + Crisp 4-Edge Outline
    this.cursorFillPositions = new Float32Array(6 * 3);
    this.cursorFillGeo = new THREE.BufferGeometry();
    this.cursorFillGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.cursorFillPositions, 3)
    );
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#fef08a',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    this.cursorFillMesh = new THREE.Mesh(this.cursorFillGeo, fillMat);
    this.cursorFillMesh.frustumCulled = false;
    this.cursorFillMesh.renderOrder = 24;
    this.cursorFillMesh.visible = false;

    this.cursorOutlinePositions = new Float32Array(8 * 3);
    this.cursorOutlineGeo = new THREE.BufferGeometry();
    this.cursorOutlineGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.cursorOutlinePositions, 3)
    );
    const outlineMat = new THREE.LineBasicMaterial({
      color: '#fde047',
      transparent: true,
      opacity: 0.98,
      depthTest: false,
    });
    this.cursorOutlineLoop = new THREE.LineSegments(this.cursorOutlineGeo, outlineMat);
    this.cursorOutlineLoop.frustumCulled = false;
    this.cursorOutlineLoop.renderOrder = 26;
    this.cursorOutlineLoop.visible = false;

    // 2. Sloped Multi-Tile Drag-Path Preview Quads + Outlines
    this.dragFillPositions = new Float32Array(this.maxPreviewInstances * 6 * 3);
    this.dragFillColors = new Float32Array(this.maxPreviewInstances * 6 * 3);
    this.dragFillGeo = new THREE.BufferGeometry();
    this.dragFillGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.dragFillPositions, 3)
    );
    this.dragFillGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(this.dragFillColors, 3)
    );
    this.dragFillGeo.setDrawRange(0, 0);
    const dragFillMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.dragFillMesh = new THREE.Mesh(this.dragFillGeo, dragFillMat);
    this.dragFillMesh.frustumCulled = false;
    this.dragFillMesh.renderOrder = 23;

    this.dragOutlinePositions = new Float32Array(this.maxPreviewInstances * 8 * 3);
    this.dragOutlineColors = new Float32Array(this.maxPreviewInstances * 8 * 3);
    this.dragOutlineGeo = new THREE.BufferGeometry();
    this.dragOutlineGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.dragOutlinePositions, 3)
    );
    this.dragOutlineGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(this.dragOutlineColors, 3)
    );
    this.dragOutlineGeo.setDrawRange(0, 0);
    const dragOutlineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    this.dragOutlineLines = new THREE.LineSegments(this.dragOutlineGeo, dragOutlineMat);
    this.dragOutlineLines.frustumCulled = false;
    this.dragOutlineLines.renderOrder = 27;

    this.previewGroup.add(
      this.cursorFillMesh,
      this.cursorOutlineLoop,
      this.dragFillMesh,
      this.dragOutlineLines
    );
    this.scene.add(this.previewGroup);

    this.syncCameraTransform();
  }

  private setupLighting(): void {
    // Authentic OpenTTD / OpenGFX crisp isometric daylight + directional shadow sun
    const hemiLight = new THREE.HemisphereLight('#f8fafc', '#2c5430', 0.92);
    hemiLight.position.set(0, 60, 0);
    this.scene.add(hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff9eb', 1.28);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 125;
    this.sunLight.shadow.bias = -0.00045;
    this.sunLight.shadow.normalBias = 0.018;

    const halfSpan = 22;
    this.sunLight.shadow.camera.left = -halfSpan;
    this.sunLight.shadow.camera.right = halfSpan;
    this.sunLight.shadow.camera.top = halfSpan;
    this.sunLight.shadow.camera.bottom = -halfSpan;
    this.sunLight.shadow.camera.updateProjectionMatrix();

    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Precompute stable orthogonal basis in light space for texel-snapped shadow tracking
    this.shadowRight.crossVectors(new THREE.Vector3(0, 1, 0), this.sunOffsetDir).normalize();
    this.shadowUp.crossVectors(this.sunOffsetDir, this.shadowRight).normalize();

    const fillLight = new THREE.DirectionalLight('#bae6fd', 0.28);
    fillLight.position.set(42, 34, -44);
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

    const sy = getSurfaceHeightAt(state, cx, cy);
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

    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);

    const aspect = this.viewportWidth / this.viewportHeight;
    const worldWBefore = (BASE_FRUSTUM_HEIGHT * aspect) / this.targetZoom;
    const worldHBefore = BASE_FRUSTUM_HEIGHT / this.targetZoom;
    const worldWAfter = (BASE_FRUSTUM_HEIGHT * aspect) / nextZoom;
    const worldHAfter = BASE_FRUSTUM_HEIGHT / nextZoom;

    const shiftRight = ndcX * 0.5 * (worldWBefore - worldWAfter);
    const shiftUp =
      (ndcY * 0.5 * (worldHBefore - worldHAfter)) / Math.sin(-ISO_PITCH_RAD);

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
    const sy = getSurfaceHeightAt(state, x, y);
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
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.currentYaw;
    this.camera.rotation.x = ISO_PITCH_RAD;
    this.camera.rotation.z = 0;

    const cosPitch = Math.cos(ISO_PITCH_RAD);
    const backX = Math.sin(this.currentYaw) * cosPitch;
    const backY = -Math.sin(ISO_PITCH_RAD);
    const backZ = Math.cos(this.currentYaw) * cosPitch;

    this.camera.position.set(
      this.panTarget.x + backX * CAMERA_DISTANCE,
      this.panTarget.y + backY * CAMERA_DISTANCE,
      this.panTarget.z + backZ * CAMERA_DISTANCE
    );
    this.camera.updateMatrixWorld();

    // Update tight orthographic shadow frustum tracking panTarget with light-space texel snapping
    if (this.sunLight) {
      const halfSpan = THREE.MathUtils.clamp(24 / Math.sqrt(this.currentZoom), 14, 34);
      const cam = this.sunLight.shadow.camera;
      if (Math.abs(cam.right - halfSpan) > 0.5) {
        cam.left = -halfSpan;
        cam.right = halfSpan;
        cam.top = halfSpan;
        cam.bottom = -halfSpan;
        cam.updateProjectionMatrix();
      }

      const texelSize = (cam.right - cam.left) / 2048;
      const projR =
        Math.round(this.panTarget.dot(this.shadowRight) / texelSize) * texelSize;
      const projU =
        Math.round(this.panTarget.dot(this.shadowUp) / texelSize) * texelSize;
      const projD = this.panTarget.dot(this.sunOffsetDir);

      const tx =
        this.shadowRight.x * projR +
        this.shadowUp.x * projU +
        this.sunOffsetDir.x * projD;
      const ty =
        this.shadowRight.y * projR +
        this.shadowUp.y * projU +
        this.sunOffsetDir.y * projD;
      const tz =
        this.shadowRight.z * projR +
        this.shadowUp.z * projU +
        this.sunOffsetDir.z * projD;

      const sunDist = 58;
      this.sunLight.target.position.set(tx, ty, tz);
      this.sunLight.target.updateMatrixWorld();
      this.sunLight.position.set(
        tx + this.sunOffsetDir.x * sunDist,
        ty + this.sunOffsetDir.y * sunDist,
        tz + this.sunOffsetDir.z * sunDist
      );
      this.sunLight.updateMatrixWorld();
    }
  }

  /**
   * Continuous heightfield raymarch + binary refinement against `getSurfaceHeightAt(state, wx, wz)`.
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

    const maxY = 2.4;
    const minY = -0.1;
    const tStart = (maxY - origin.y) / dir.y;
    const tEnd = (minY - origin.y) / dir.y;
    const t0 = Math.min(tStart, tEnd);
    const t1 = Math.max(tStart, tEnd);

    const steps = 64;
    const dt = (t1 - t0) / steps;
    let prevT = t0;

    for (let i = 0; i <= steps; i++) {
      const t = t0 + i * dt;
      const wx = origin.x + dir.x * t;
      const wy = origin.y + dir.y * t;
      const wz = origin.z + dir.z * t;

      if (wx >= -0.5 && wz >= -0.5 && wx < state.mapSize - 0.5 && wz < state.mapSize - 0.5) {
        const surfY = getSurfaceHeightAt(state, wx, wz);
        if (wy <= surfY + 0.006) {
          // Refine exact ray intersection across [prevT, t]
          let lo = prevT;
          let hi = t;
          for (let r = 0; r < 5; r++) {
            const mid = 0.5 * (lo + hi);
            const mx = origin.x + dir.x * mid;
            const my = origin.y + dir.y * mid;
            const mz = origin.z + dir.z * mid;
            if (my <= getSurfaceHeightAt(state, mx, mz)) {
              hi = mid;
            } else {
              lo = mid;
            }
          }
          const hitT = 0.5 * (lo + hi);
          const gx = Math.round(origin.x + dir.x * hitT);
          const gy = Math.round(origin.z + dir.z * hitT);
          const tile = getTileAt(state, gx, gy);
          if (tile) {
            return { x: gx, y: gy, tile };
          }
        }
      }
      prevT = t;
    }

    return null;
  }

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
      const wy = getSurfaceHeightAt(state, wx, wz) + 0.16;

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

  private writeSlopedTileQuadAndOutline(
    state: GameState,
    tx: number,
    ty: number,
    inset: number,
    liftY: number,
    triOut: Float32Array,
    triBaseFloat: number,
    lineOut: Float32Array,
    lineBaseFloat: number
  ): void {
    const { cNW, cNE, cSE, cSW, splitNWSE } = getTileCornerHeights(state, tx, ty);
    const half = 0.5 - inset;
    const x0 = tx - half;
    const x1 = tx + half;
    const z0 = ty - half;
    const z1 = ty + half;

    const yNW = cNW + liftY;
    const yNE = cNE + liftY;
    const ySE = cSE + liftY;
    const ySW = cSW + liftY;

    let ti = triBaseFloat;
    if (splitNWSE) {
      // Tri 1: NW -> SW -> SE
      triOut[ti++] = x0; triOut[ti++] = yNW; triOut[ti++] = z0;
      triOut[ti++] = x0; triOut[ti++] = ySW; triOut[ti++] = z1;
      triOut[ti++] = x1; triOut[ti++] = ySE; triOut[ti++] = z1;
      // Tri 2: NW -> SE -> NE
      triOut[ti++] = x0; triOut[ti++] = yNW; triOut[ti++] = z0;
      triOut[ti++] = x1; triOut[ti++] = ySE; triOut[ti++] = z1;
      triOut[ti++] = x1; triOut[ti++] = yNE; triOut[ti++] = z0;
    } else {
      // Tri 1: NW -> SW -> NE
      triOut[ti++] = x0; triOut[ti++] = yNW; triOut[ti++] = z0;
      triOut[ti++] = x0; triOut[ti++] = ySW; triOut[ti++] = z1;
      triOut[ti++] = x1; triOut[ti++] = yNE; triOut[ti++] = z0;
      // Tri 2: NE -> SW -> SE
      triOut[ti++] = x1; triOut[ti++] = yNE; triOut[ti++] = z0;
      triOut[ti++] = x0; triOut[ti++] = ySW; triOut[ti++] = z1;
      triOut[ti++] = x1; triOut[ti++] = ySE; triOut[ti++] = z1;
    }

    let li = lineBaseFloat;
    const olLift = 0.008;
    // NW -> NE
    lineOut[li++] = x0; lineOut[li++] = yNW + olLift; lineOut[li++] = z0;
    lineOut[li++] = x1; lineOut[li++] = yNE + olLift; lineOut[li++] = z0;
    // NE -> SE
    lineOut[li++] = x1; lineOut[li++] = yNE + olLift; lineOut[li++] = z0;
    lineOut[li++] = x1; lineOut[li++] = ySE + olLift; lineOut[li++] = z1;
    // SE -> SW
    lineOut[li++] = x1; lineOut[li++] = ySE + olLift; lineOut[li++] = z1;
    lineOut[li++] = x0; lineOut[li++] = ySW + olLift; lineOut[li++] = z1;
    // SW -> NW
    lineOut[li++] = x0; lineOut[li++] = ySW + olLift; lineOut[li++] = z1;
    lineOut[li++] = x0; lineOut[li++] = yNW + olLift; lineOut[li++] = z0;
  }

  public updateHoverAndDragPreview(
    hoverTile: PickedTileResult | null,
    dragTiles: Array<{ x: number; y: number }> | null,
    activeTool: ToolType,
    isOrderPickerActive: boolean,
    state: GameState,
    timeSec: number
  ): void {
    // 1. Multi-tile sloped drag preview (ROAD / RAIL)
    if (dragTiles && dragTiles.length > 0) {
      this.cursorFillMesh.visible = false;
      this.cursorOutlineLoop.visible = false;

      const count = Math.min(dragTiles.length, this.maxPreviewInstances);
      const pulse = 0.85 + 0.15 * Math.sin(timeSec * 8);

      for (let i = 0; i < count; i++) {
        const pt = dragTiles[i];
        const tile = getTileAt(state, pt.x, pt.y);
        const canBuild = tile ? tile.terrain !== 'WATER' && !tile.industryId : false;

        this.writeSlopedTileQuadAndOutline(
          state,
          pt.x,
          pt.y,
          0.03,
          0.042,
          this.dragFillPositions,
          i * 18,
          this.dragOutlinePositions,
          i * 24
        );

        this.tmpColor.set(canBuild ? '#38bdf8' : '#ef4444').multiplyScalar(pulse);
        for (let v = 0; v < 6; v++) {
          const ci = i * 18 + v * 3;
          this.dragFillColors[ci] = this.tmpColor.r;
          this.dragFillColors[ci + 1] = this.tmpColor.g;
          this.dragFillColors[ci + 2] = this.tmpColor.b;
        }

        this.tmpColor.set(canBuild ? '#fde047' : '#fca5a5');
        for (let v = 0; v < 8; v++) {
          const ci = i * 24 + v * 3;
          this.dragOutlineColors[ci] = this.tmpColor.r;
          this.dragOutlineColors[ci + 1] = this.tmpColor.g;
          this.dragOutlineColors[ci + 2] = this.tmpColor.b;
        }
      }

      this.dragFillGeo.setDrawRange(0, count * 6);
      this.dragFillGeo.attributes.position.needsUpdate = true;
      this.dragFillGeo.attributes.color.needsUpdate = true;

      this.dragOutlineGeo.setDrawRange(0, count * 8);
      this.dragOutlineGeo.attributes.position.needsUpdate = true;
      this.dragOutlineGeo.attributes.color.needsUpdate = true;
      return;
    }

    this.dragFillGeo.setDrawRange(0, 0);
    this.dragOutlineGeo.setDrawRange(0, 0);

    // 2. Single-tile sloped hover cursor
    if (!hoverTile) {
      this.cursorFillMesh.visible = false;
      this.cursorOutlineLoop.visible = false;
      return;
    }

    const { x, y, tile } = hoverTile;
    let ringHex = '#ffffff';
    let fillHex = '#fef08a';

    if (isOrderPickerActive) {
      ringHex = tile.stationId ? '#4ade80' : '#38bdf8';
      fillHex = tile.stationId ? '#22c55e' : '#0ea5e9';
    } else if (activeTool === 'BULLDOZE') {
      ringHex = '#ef4444';
      fillHex = '#f87171';
    } else if (activeTool !== 'SELECT') {
      const blockedByWater = tile.terrain === 'WATER';
      ringHex = blockedByWater ? '#ef4444' : '#fde047';
      fillHex = blockedByWater ? '#f87171' : '#34d399';
    }

    this.writeSlopedTileQuadAndOutline(
      state,
      x,
      y,
      0.02,
      0.036,
      this.cursorFillPositions,
      0,
      this.cursorOutlinePositions,
      0
    );
    this.cursorFillGeo.attributes.position.needsUpdate = true;
    this.cursorOutlineGeo.attributes.position.needsUpdate = true;

    const ringMat = this.cursorOutlineLoop.material as THREE.LineBasicMaterial;
    const fillMat = this.cursorFillMesh.material as THREE.MeshBasicMaterial;
    ringMat.color.set(ringHex);
    fillMat.color.set(fillHex);
    fillMat.opacity = activeTool === 'SELECT' && !isOrderPickerActive ? 0.12 : 0.26;

    this.cursorFillMesh.visible = true;
    this.cursorOutlineLoop.visible = true;
  }

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    this.pressedKeys.clear();
    this.cursorFillGeo.dispose();
    (this.cursorFillMesh.material as THREE.Material).dispose();
    this.cursorOutlineGeo.dispose();
    (this.cursorOutlineLoop.material as THREE.Material).dispose();
    this.dragFillGeo.dispose();
    (this.dragFillMesh.material as THREE.Material).dispose();
    this.dragOutlineGeo.dispose();
    (this.dragOutlineLines.material as THREE.Material).dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
