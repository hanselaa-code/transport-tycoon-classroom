import * as THREE from 'three';
import type { GameState, Station, Tile } from '../types/game';
import {
  BRIDGE_DECK_Y,
  TERRAIN_BASE_Y,
  WATER_SURFACE_Y,
  getCornerHeight,
  getSurfaceHeightAt,
  getTileAt,
  getTileCornerHeights,
} from './IsoSceneManager';
import {
  type TerrainTextureSet,
  createTerrainTextureSet,
  disposeTerrainTextureSet,
} from './TerrainTextures';

const MAX_MAP_DIM = 160;
const MAX_TILES = MAX_MAP_DIM * MAX_MAP_DIM; // 25,600
const MAX_TERRAIN_VERTS = (MAX_TILES * 2 + MAX_MAP_DIM * 8) * 3;
const MAX_TREES = 30000;
const MAX_FOAM_EDGES = 24000;

const MAX_ROAD_SEGMENTS = 40000;
const MAX_ROAD_DASHES = 45000;
const MAX_CROSSINGS = 2048;

const MAX_RAIL_BALLAST = 40000;
const MAX_RAIL_SLEEPERS = 70000;
const MAX_RAIL_RAILS = 70000;
const MAX_RAIL_CLIPS = 90000;
const MAX_BUFFERS = 4096;

const MAX_BRIDGE_PIERS = 8192;
const MAX_BRIDGE_DECKS = 12288;
const MAX_BRIDGE_TRUSS = 32768;

const SUN_DIR = new THREE.Vector3(-0.62, 0.78, 0.44).normalize();

type AtlasQuad = 'GRASS' | 'SAND' | 'ROCK' | 'FOREST';

const ATLAS_UV_BOUNDS: Record<AtlasQuad, [number, number, number, number]> = {
  // [u0, u1, v0, v1] with 2.5% inner margin so NearestFilter never bleeds across quadrants
  GRASS: [0.025, 0.475, 0.525, 0.975],
  SAND: [0.525, 0.975, 0.525, 0.975],
  ROCK: [0.025, 0.475, 0.025, 0.475],
  FOREST: [0.525, 0.975, 0.025, 0.475],
};

function hash2D(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class TerrainInstancer {
  public readonly group = new THREE.Group();

  private textures: TerrainTextureSet;

  // Continuous watertight OpenGFX-textured terrain mesh + earth cross-section skirt walls
  private terrainGeo: THREE.BufferGeometry;
  private terrainPositions: Float32Array;
  private terrainNormals: Float32Array;
  private terrainColors: Float32Array;
  private terrainUVs: Float32Array;
  private terrainMesh: THREE.Mesh;

  private waterSparkleLayer: THREE.InstancedMesh;
  private shoreFoamLayer: THREE.InstancedMesh;
  private gridLines: THREE.LineSegments;
  private gridGeometry: THREE.BufferGeometry;

  // Multi-species OpenGFX temperate trees + ground contact shadow discs
  private treeShadowDiscs: THREE.InstancedMesh;
  private pineTrunks: THREE.InstancedMesh;
  private pineCrownsLower: THREE.InstancedMesh;
  private pineCrownsMid: THREE.InstancedMesh;
  private pineCrownsUpper: THREE.InstancedMesh;

  private decidTrunks: THREE.InstancedMesh;
  private decidCanopyMain: THREE.InstancedMesh;
  private decidCanopyAccent: THREE.InstancedMesh;

  // Road network + OpenTTD Road-Rail Level Crossings
  private roadRuralEmbankment: THREE.InstancedMesh;
  private roadUrbanSidewalk: THREE.InstancedMesh;
  private roadAsphalt: THREE.InstancedMesh;
  private roadDashes: THREE.InstancedMesh;

  private crossingPlanks: THREE.InstancedMesh;
  private crossingPosts: THREE.InstancedMesh;
  private crossingLamps: THREE.InstancedMesh;
  private crossingLampMat: THREE.MeshBasicMaterial;

  // Rail network: speckled ballast + closely-spaced sleepers + rail clips + twin steel rails + A-frame buffers
  private railBallast: THREE.InstancedMesh;
  private railSleepers: THREE.InstancedMesh;
  private railClips: THREE.InstancedMesh;
  private railSteel: THREE.InstancedMesh;
  private railWarningBeams: THREE.InstancedMesh;

  // 3D Road & Rail Bridges + Stone Shore Abutment Ramps
  private bridgePiers: THREE.InstancedMesh;
  private bridgeConcrete: THREE.InstancedMesh;
  private bridgeTruss: THREE.InstancedMesh;

  private waterMaterial: THREE.MeshLambertMaterial;
  private gridPositions: Float32Array;

  private lastSignature = '';

  // Scratch math objects
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
    this.textures = createTerrainTextureSet();

    // 1. Continuous Watertight OpenGFX Terrain Heightfield Mesh (receives crisp directional shadows!)
    this.terrainPositions = new Float32Array(MAX_TERRAIN_VERTS * 3);
    this.terrainNormals = new Float32Array(MAX_TERRAIN_VERTS * 3);
    this.terrainColors = new Float32Array(MAX_TERRAIN_VERTS * 3);
    this.terrainUVs = new Float32Array(MAX_TERRAIN_VERTS * 2);

    this.terrainGeo = new THREE.BufferGeometry();
    this.terrainGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.terrainPositions, 3)
    );
    this.terrainGeo.setAttribute(
      'normal',
      new THREE.BufferAttribute(this.terrainNormals, 3)
    );
    this.terrainGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(this.terrainColors, 3)
    );
    this.terrainGeo.setAttribute(
      'uv',
      new THREE.BufferAttribute(this.terrainUVs, 2)
    );

    const terrainMat = new THREE.MeshLambertMaterial({
      map: this.textures.terrainAtlas,
      vertexColors: true,
    });
    this.terrainMesh = new THREE.Mesh(this.terrainGeo, terrainMat);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.frustumCulled = false;

    // 2. Scrolling Pixel-Dithered OpenTTD Water Surface
    const waterGeo = new THREE.PlaneGeometry(1.005, 1.005);
    waterGeo.rotateX(-Math.PI / 2);
    this.waterMaterial = new THREE.MeshLambertMaterial({
      map: this.textures.waterRipple,
      color: this.textures.waterRipple ? '#ffffff' : '#1e7fb8',
      emissive: '#093454',
      emissiveIntensity: 0.26,
    });
    this.waterSparkleLayer = new THREE.InstancedMesh(waterGeo, this.waterMaterial, MAX_TILES);
    this.waterSparkleLayer.receiveShadow = true;
    this.waterSparkleLayer.frustumCulled = false;

    // 3. Coastal Surf Foam Strips
    const foamGeo = new THREE.PlaneGeometry(1.0, 0.13);
    foamGeo.rotateX(-Math.PI / 2);
    const foamMat = new THREE.MeshBasicMaterial({
      color: '#dbeafe',
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    this.shoreFoamLayer = new THREE.InstancedMesh(foamGeo, foamMat, MAX_FOAM_EDGES);
    this.shoreFoamLayer.frustumCulled = false;

    // 4. Crisp TTD Sloped Tile Grid Lines
    this.gridPositions = new Float32Array(MAX_TILES * 8 * 3);
    this.gridGeometry = new THREE.BufferGeometry();
    this.gridGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.gridPositions, 3)
    );
    const gridMat = new THREE.LineBasicMaterial({
      color: '#0d2610',
      transparent: true,
      opacity: 0.26,
    });
    this.gridLines = new THREE.LineSegments(this.gridGeometry, gridMat);
    this.gridLines.frustumCulled = false;

    // 5. Multi-Species OpenGFX Temperate Trees + Contact Shadow Discs
    const discGeo = new THREE.CircleGeometry(0.21, 8);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({
      color: '#091f0d',
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.treeShadowDiscs = new THREE.InstancedMesh(discGeo, discMat, MAX_TREES);
    this.treeShadowDiscs.frustumCulled = false;

    // 5a. Conifer Spruce / Pine (3-tiered foliage cones)
    const pineTrunkGeo = new THREE.CylinderGeometry(0.028, 0.046, 0.22, 5);
    pineTrunkGeo.translate(0, 0.11, 0);
    const pineTrunkMat = new THREE.MeshLambertMaterial({ color: '#4d2f18' });
    this.pineTrunks = new THREE.InstancedMesh(pineTrunkGeo, pineTrunkMat, MAX_TREES);
    this.pineTrunks.castShadow = true;
    this.pineTrunks.frustumCulled = false;

    const pineLowGeo = new THREE.ConeGeometry(0.19, 0.26, 6);
    pineLowGeo.translate(0, 0.27, 0);
    const whiteLambert = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.pineCrownsLower = new THREE.InstancedMesh(pineLowGeo, whiteLambert, MAX_TREES);
    this.pineCrownsLower.castShadow = true;
    this.pineCrownsLower.receiveShadow = true;
    this.pineCrownsLower.frustumCulled = false;

    const pineMidGeo = new THREE.ConeGeometry(0.15, 0.24, 6);
    pineMidGeo.translate(0, 0.41, 0);
    this.pineCrownsMid = new THREE.InstancedMesh(
      pineMidGeo,
      whiteLambert.clone(),
      MAX_TREES
    );
    this.pineCrownsMid.castShadow = true;
    this.pineCrownsMid.receiveShadow = true;
    this.pineCrownsMid.frustumCulled = false;

    const pineTopGeo = new THREE.ConeGeometry(0.105, 0.22, 6);
    pineTopGeo.translate(0, 0.55, 0);
    this.pineCrownsUpper = new THREE.InstancedMesh(
      pineTopGeo,
      whiteLambert.clone(),
      MAX_TREES
    );
    this.pineCrownsUpper.castShadow = true;
    this.pineCrownsUpper.receiveShadow = true;
    this.pineCrownsUpper.frustumCulled = false;

    // 5b. Deciduous Oak / Silver Birch (pale/brown trunk + rounded multi-lobe crown)
    const decidTrunkGeo = new THREE.CylinderGeometry(0.026, 0.042, 0.25, 5);
    decidTrunkGeo.translate(0, 0.125, 0);
    this.decidTrunks = new THREE.InstancedMesh(
      decidTrunkGeo,
      whiteLambert.clone(),
      MAX_TREES
    );
    this.decidTrunks.castShadow = true;
    this.decidTrunks.frustumCulled = false;

    const decidMainGeo = new THREE.IcosahedronGeometry(0.17, 0);
    decidMainGeo.translate(0, 0.36, 0);
    this.decidCanopyMain = new THREE.InstancedMesh(
      decidMainGeo,
      whiteLambert.clone(),
      MAX_TREES
    );
    this.decidCanopyMain.castShadow = true;
    this.decidCanopyMain.receiveShadow = true;
    this.decidCanopyMain.frustumCulled = false;

    const decidSideGeo = new THREE.IcosahedronGeometry(0.125, 0);
    decidSideGeo.translate(0.065, 0.44, 0.04);
    this.decidCanopyAccent = new THREE.InstancedMesh(
      decidSideGeo,
      whiteLambert.clone(),
      MAX_TREES
    );
    this.decidCanopyAccent.castShadow = true;
    this.decidCanopyAccent.receiveShadow = true;
    this.decidCanopyAccent.frustumCulled = false;

    // 6. Conforming Road Network (Rural Gravel Embankment, Urban Stone Sidewalk, Textured Asphalt, Level Crossings)
    const unitBox = new THREE.BoxGeometry(1, 1, 1);

    const ruralEmbankMat = new THREE.MeshLambertMaterial({
      map: this.textures.gravelRoadbed,
      color: this.textures.gravelRoadbed ? '#d6d3d1' : '#78716c',
    });
    this.roadRuralEmbankment = new THREE.InstancedMesh(
      unitBox,
      ruralEmbankMat,
      MAX_ROAD_SEGMENTS
    );
    this.roadRuralEmbankment.receiveShadow = true;
    this.roadRuralEmbankment.frustumCulled = false;

    const urbanSidewalkMat = new THREE.MeshLambertMaterial({
      map: this.textures.urbanSidewalk,
      color: this.textures.urbanSidewalk ? '#ffffff' : '#94a3b8',
    });
    this.roadUrbanSidewalk = new THREE.InstancedMesh(
      unitBox,
      urbanSidewalkMat,
      MAX_ROAD_SEGMENTS
    );
    this.roadUrbanSidewalk.receiveShadow = true;
    this.roadUrbanSidewalk.frustumCulled = false;

    const roadMat = new THREE.MeshLambertMaterial({
      map: this.textures.asphalt,
      color: this.textures.asphalt ? '#ffffff' : '#2b3038',
    });
    this.roadAsphalt = new THREE.InstancedMesh(unitBox, roadMat, MAX_ROAD_SEGMENTS);
    this.roadAsphalt.receiveShadow = true;
    this.roadAsphalt.frustumCulled = false;

    const dashMat = new THREE.MeshBasicMaterial({ color: '#f8fafc' });
    this.roadDashes = new THREE.InstancedMesh(unitBox, dashMat, MAX_ROAD_DASHES);
    this.roadDashes.frustumCulled = false;

    const plankMat = new THREE.MeshLambertMaterial({
      map: this.textures.timberSleeper,
      color: '#b48256',
    });
    this.crossingPlanks = new THREE.InstancedMesh(unitBox, plankMat, MAX_CROSSINGS * 4);
    this.crossingPlanks.receiveShadow = true;
    this.crossingPlanks.frustumCulled = false;

    const postMat = new THREE.MeshLambertMaterial({
      map: this.textures.warningStripes,
      color: '#ffffff',
    });
    this.crossingPosts = new THREE.InstancedMesh(unitBox, postMat, MAX_CROSSINGS * 4);
    this.crossingPosts.castShadow = true;
    this.crossingPosts.frustumCulled = false;

    this.crossingLampMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });
    const lampSphereGeo = new THREE.SphereGeometry(0.5, 6, 6);
    this.crossingLamps = new THREE.InstancedMesh(
      lampSphereGeo,
      this.crossingLampMat,
      MAX_CROSSINGS * 4
    );
    this.crossingLamps.frustumCulled = false;

    // 7. Conforming Rail Network (Speckled Ballast + Timber Sleepers + Iron Clips + Steel Rails + A-Frame Buffers)
    const ballastMat = new THREE.MeshLambertMaterial({
      map: this.textures.ballast,
      color: this.textures.ballast ? '#d6d3d1' : '#6b655e',
    });
    this.railBallast = new THREE.InstancedMesh(unitBox, ballastMat, MAX_RAIL_BALLAST);
    this.railBallast.receiveShadow = true;
    this.railBallast.frustumCulled = false;

    const sleeperMat = new THREE.MeshLambertMaterial({
      map: this.textures.timberSleeper,
      color: this.textures.timberSleeper ? '#d6c7b8' : '#422819',
    });
    this.railSleepers = new THREE.InstancedMesh(unitBox, sleeperMat, MAX_RAIL_SLEEPERS);
    this.railSleepers.receiveShadow = true;
    this.railSleepers.frustumCulled = false;

    const clipMat = new THREE.MeshLambertMaterial({ color: '#334155' });
    this.railClips = new THREE.InstancedMesh(unitBox, clipMat, MAX_RAIL_CLIPS);
    this.railClips.castShadow = true;
    this.railClips.frustumCulled = false;

    const steelMat = new THREE.MeshLambertMaterial({
      color: '#e2e8f0',
      emissive: '#334155',
      emissiveIntensity: 0.24,
    });
    this.railSteel = new THREE.InstancedMesh(unitBox, steelMat, MAX_RAIL_RAILS);
    this.railSteel.receiveShadow = true;
    this.railSteel.frustumCulled = false;

    const beamMat = new THREE.MeshLambertMaterial({
      map: this.textures.warningStripes,
      color: this.textures.warningStripes ? '#ffffff' : '#dc2626',
    });
    this.railWarningBeams = new THREE.InstancedMesh(unitBox, beamMat, MAX_BUFFERS);
    this.railWarningBeams.castShadow = true;
    this.railWarningBeams.frustumCulled = false;

    // 8. 3D OpenTTD Road & Rail Bridges (Submerged Piers, Concrete Decks/Ramps, Red-Oxide Steel Trusses & Parapets)
    const pierGeo = new THREE.CylinderGeometry(0.068, 0.085, 1.0, 8);
    const pierMat = new THREE.MeshLambertMaterial({
      map: this.textures.urbanSidewalk,
      color: '#cbd5e1',
    });
    this.bridgePiers = new THREE.InstancedMesh(pierGeo, pierMat, MAX_BRIDGE_PIERS);
    this.bridgePiers.castShadow = true;
    this.bridgePiers.receiveShadow = true;
    this.bridgePiers.frustumCulled = false;

    const bridgeConcMat = new THREE.MeshLambertMaterial({
      map: this.textures.urbanSidewalk,
      color: '#d6d3d1',
    });
    this.bridgeConcrete = new THREE.InstancedMesh(unitBox, bridgeConcMat, MAX_BRIDGE_DECKS);
    this.bridgeConcrete.castShadow = true;
    this.bridgeConcrete.receiveShadow = true;
    this.bridgeConcrete.frustumCulled = false;

    const bridgeTrussMat = new THREE.MeshLambertMaterial({
      color: '#ffffff',
    });
    this.bridgeTruss = new THREE.InstancedMesh(unitBox, bridgeTrussMat, MAX_BRIDGE_TRUSS);
    this.bridgeTruss.castShadow = true;
    this.bridgeTruss.receiveShadow = true;
    this.bridgeTruss.frustumCulled = false;

    this.group.add(
      this.terrainMesh,
      this.waterSparkleLayer,
      this.shoreFoamLayer,
      this.gridLines,
      this.bridgePiers,
      this.bridgeConcrete,
      this.bridgeTruss,
      this.roadRuralEmbankment,
      this.roadUrbanSidewalk,
      this.roadAsphalt,
      this.roadDashes,
      this.railBallast,
      this.railSleepers,
      this.railClips,
      this.railSteel,
      this.crossingPlanks,
      this.crossingPosts,
      this.crossingLamps,
      this.railWarningBeams,
      this.treeShadowDiscs,
      this.pineTrunks,
      this.pineCrownsLower,
      this.pineCrownsMid,
      this.pineCrownsUpper,
      this.decidTrunks,
      this.decidCanopyMain,
      this.decidCanopyAccent
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
      if (t.bridge === 'ROAD') code |= 1 << 16;
      else if (t.bridge === 'RAIL') code |= 1 << 17;
      if (t.bridgeAxis === 'Y') code |= 1 << 18;

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
    // Scroll OpenTTD pixel-dithered water ripple texture + animate coastal surf & crossing lamps
    if (this.textures.waterRipple) {
      this.textures.waterRipple.offset.set(
        (timeSec * 0.038) % 1,
        (timeSec * 0.024) % 1
      );
    }
    const wave = 0.5 + 0.5 * Math.sin(timeSec * 1.9);
    this.waterMaterial.emissiveIntensity = 0.18 + wave * 0.12;

    const foamMat = this.shoreFoamLayer.material as THREE.MeshBasicMaterial;
    foamMat.opacity = 0.42 + 0.2 * Math.sin(timeSec * 2.3 + 0.8);

    // Classic pulsing red warning glow on level crossing lamps
    const flash = Math.sin(timeSec * 6.2) > 0 ? '#ff3b30' : '#991b1b';
    this.crossingLampMat.color.set(flash);
  }

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

    this.vUp.crossVectors(this.vFwd, this.vRight).normalize();
    if (this.vUp.y < 0) {
      this.vUp.negate();
    }
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

  private pushTexturedFacetedTriangle(
    ax: number,
    ay: number,
    az: number,
    au: number,
    av: number,
    bx: number,
    by: number,
    bz: number,
    bu: number,
    bv: number,
    cx: number,
    cy: number,
    cz: number,
    cu: number,
    cv: number,
    baseHex: string,
    quad: AtlasQuad,
    isLandSurface: boolean,
    allowRockySlope: boolean,
    vertCursor: number
  ): number {
    this.e1.set(bx - ax, by - ay, bz - az);
    this.e2.set(cx - ax, cy - ay, cz - az);
    this.triNorm.crossVectors(this.e1, this.e2).normalize();
    if (isLandSurface && this.triNorm.y < 0) {
      this.triNorm.negate();
    }

    let chosenQuad = quad;
    this.color.set(baseHex);

    if (isLandSurface) {
      // Blend steep slopes onto the OpenGFX rocky cliff quadrant
      if (allowRockySlope && this.triNorm.y < 0.915) {
        chosenQuad = 'ROCK';
        const rockBlend = THREE.MathUtils.clamp((0.92 - this.triNorm.y) * 6.5, 0.35, 0.88);
        this.color.lerp(new THREE.Color('#84887a'), rockBlend);
      }

      // Subtle Chris Sawyer TTD facet contrast boost alongside real-time directional sun + shadowMap
      const dot = this.triNorm.dot(SUN_DIR);
      const facetBoost = THREE.MathUtils.clamp(1.0 + (dot - SUN_DIR.y) * 0.28, 0.84, 1.16);
      this.color.multiplyScalar(facetBoost);
    }

    const [u0, u1, v0, v1] = ATLAS_UV_BOUNDS[chosenQuad];
    const mapU = (uLocal: number) => u0 + uLocal * (u1 - u0);
    const mapV = (vLocal: number) => v0 + vLocal * (v1 - v0);

    const writeVert = (
      vx: number,
      vy: number,
      vz: number,
      uLoc: number,
      vLoc: number,
      idx: number
    ) => {
      const pi = idx * 3;
      this.terrainPositions[pi] = vx;
      this.terrainPositions[pi + 1] = vy;
      this.terrainPositions[pi + 2] = vz;

      this.terrainNormals[pi] = this.triNorm.x;
      this.terrainNormals[pi + 1] = this.triNorm.y;
      this.terrainNormals[pi + 2] = this.triNorm.z;

      this.terrainColors[pi] = this.color.r;
      this.terrainColors[pi + 1] = this.color.g;
      this.terrainColors[pi + 2] = this.color.b;

      const ui = idx * 2;
      this.terrainUVs[ui] = mapU(uLoc);
      this.terrainUVs[ui + 1] = mapV(vLoc);
    };

    writeVert(ax, ay, az, au, av, vertCursor);
    writeVert(bx, by, bz, bu, bv, vertCursor + 1);
    writeVert(cx, cy, cz, cu, cv, vertCursor + 2);

    return vertCursor + 3;
  }

  private rebuildAllGeometry(state: GameState): void {
    const { mapSize, tiles, stations } = state;

    const stationKindById = new Map<string, Station['kind']>();
    for (let i = 0; i < stations.length; i++) {
      stationKindById.set(stations[i].id, stations[i].kind);
    }

    const getBridgeAxis = (t: Tile): 'X' | 'Y' => {
      if (t.bridgeAxis === 'X' || t.bridgeAxis === 'Y') return t.bridgeAxis;
      const e = getTileAt(state, t.x + 1, t.y);
      const w = getTileAt(state, t.x - 1, t.y);
      if (
        (e && (e.road || e.rail || e.bridge)) ||
        (w && (w.road || w.rail || w.bridge))
      ) {
        return 'X';
      }
      return 'Y';
    };

    const isRoadConnected = (t: Tile | undefined): boolean => {
      if (!t) return false;
      if (t.road || t.depot === 'ROAD' || t.bridge === 'ROAD') return true;
      if (t.stationId) {
        const kind = stationKindById.get(t.stationId);
        return kind === 'BUS_STOP' || kind === 'TRUCK_BAY';
      }
      return false;
    };

    const isRailConnected = (t: Tile | undefined): boolean => {
      if (!t) return false;
      if (t.rail || t.depot === 'RAIL' || t.bridge === 'RAIL') return true;
      if (t.stationId) {
        const kind = stationKindById.get(t.stationId);
        return kind === 'TRAIN_STATION';
      }
      return false;
    };

    const isRoadConnectedDir = (
      fromTile: Tile,
      toTile: Tile | undefined,
      dx: number
    ): boolean => {
      if (!toTile) return false;
      const dirAxis: 'X' | 'Y' = dx !== 0 ? 'X' : 'Y';
      if (fromTile.bridge) {
        if (fromTile.bridge !== 'ROAD') return false;
        if (getBridgeAxis(fromTile) !== dirAxis) return false;
      }
      if (toTile.bridge) {
        if (toTile.bridge !== 'ROAD') return false;
        return getBridgeAxis(toTile) === dirAxis;
      }
      return isRoadConnected(toTile);
    };

    const isRailConnectedDir = (
      fromTile: Tile,
      toTile: Tile | undefined,
      dx: number
    ): boolean => {
      if (!toTile) return false;
      const dirAxis: 'X' | 'Y' = dx !== 0 ? 'X' : 'Y';
      if (fromTile.bridge) {
        if (fromTile.bridge !== 'RAIL') return false;
        if (getBridgeAxis(fromTile) !== dirAxis) return false;
      }
      if (toTile.bridge) {
        if (toTile.bridge !== 'RAIL') return false;
        return getBridgeAxis(toTile) === dirAxis;
      }
      return isRailConnected(toTile);
    };

    let terrainVertIdx = 0;
    let waterIdx = 0;
    let foamIdx = 0;
    let gridFloats = 0;

    let discIdx = 0;
    let pineIdx = 0;
    let decidIdx = 0;

    let ruralEmbankIdx = 0;
    let urbanSidewalkIdx = 0;
    let roadSegIdx = 0;
    let roadDashIdx = 0;

    let crossingPlankIdx = 0;
    let crossingPostIdx = 0;
    let crossingLampIdx = 0;

    let ballastIdx = 0;
    let sleeperIdx = 0;
    let clipIdx = 0;
    let railSteelIdx = 0;
    let warningBeamIdx = 0;

    let bridgePierIdx = 0;
    let bridgeConcIdx = 0;
    let bridgeTrussIdx = 0;

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

      // 1. Watertight Textured OpenGFX Terrain Heightfield Triangles
      let baseHex: string;
      let quad: AtlasQuad = 'GRASS';
      if (isWater) {
        baseHex = checker ? '#0d3f63' : '#0a3656';
        quad = 'SAND';
      } else if (tile.terrain === 'SAND') {
        baseHex = checker ? '#e5ca87' : '#dbc07a';
        quad = 'SAND';
      } else if (tile.terrain === 'FOREST_TREES') {
        baseHex = checker ? '#317a30' : '#2b6f2a';
        quad = 'FOREST';
      } else if (tile.townId) {
        baseHex = checker ? '#4a9e3f' : '#439339';
        quad = 'GRASS';
      } else if (tile.elevation >= 3) {
        baseHex = checker ? '#4da33e' : '#459837';
        quad = 'GRASS';
      } else {
        baseHex = checker ? '#429835' : '#3b8d2f';
        quad = 'GRASS';
      }

      const allowRocky =
        !isWater &&
        tile.terrain !== 'SAND' &&
        !tile.road &&
        !tile.rail &&
        !tile.townId &&
        !tile.stationId;

      const yNW = isWater ? WATER_SURFACE_Y - 0.12 : cNW;
      const yNE = isWater ? WATER_SURFACE_Y - 0.12 : cNE;
      const ySE = isWater ? WATER_SURFACE_Y - 0.12 : cSE;
      const ySW = isWater ? WATER_SURFACE_Y - 0.12 : cSW;

      if (terrainVertIdx + 6 <= MAX_TERRAIN_VERTS) {
        if (splitNWSE) {
          terrainVertIdx = this.pushTexturedFacetedTriangle(
            x0, yNW, z0, 0, 1,
            x0, ySW, z1, 0, 0,
            x1, ySE, z1, 1, 0,
            baseHex, quad, !isWater, allowRocky, terrainVertIdx
          );
          terrainVertIdx = this.pushTexturedFacetedTriangle(
            x0, yNW, z0, 0, 1,
            x1, ySE, z1, 1, 0,
            x1, yNE, z0, 1, 1,
            baseHex, quad, !isWater, allowRocky, terrainVertIdx
          );
        } else {
          terrainVertIdx = this.pushTexturedFacetedTriangle(
            x0, yNW, z0, 0, 1,
            x0, ySW, z1, 0, 0,
            x1, yNE, z0, 1, 1,
            baseHex, quad, !isWater, allowRocky, terrainVertIdx
          );
          terrainVertIdx = this.pushTexturedFacetedTriangle(
            x1, yNE, z0, 1, 1,
            x0, ySW, z1, 0, 0,
            x1, ySE, z1, 1, 0,
            baseHex, quad, !isWater, allowRocky, terrainVertIdx
          );
        }
      }

      // 2. Scrolling Water Layer + Shoreline Surf Foam
      if (isWater && waterIdx < MAX_TILES) {
        this.pos.set(x, WATER_SURFACE_Y, y);
        this.quat.identity();
        this.scale.set(1, 1, 1);
        this.mat4.compose(this.pos, this.quat, this.scale);
        this.waterSparkleLayer.setMatrixAt(waterIdx, this.mat4);
        this.color.set(checker ? '#ffffff' : '#f0f9ff');
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

      // 3. Crisp TTD Sloped Grid Lines
      const gLift = 0.003;
      const gNW = (isWater ? WATER_SURFACE_Y : cNW) + gLift;
      const gNE = (isWater ? WATER_SURFACE_Y : cNE) + gLift;
      const gSE = (isWater ? WATER_SURFACE_Y : cSE) + gLift;
      const gSW = (isWater ? WATER_SURFACE_Y : cSW) + gLift;

      if (gridFloats + 24 <= this.gridPositions.length) {
        this.gridPositions[gridFloats++] = x0;
        this.gridPositions[gridFloats++] = gNW;
        this.gridPositions[gridFloats++] = z0;
        this.gridPositions[gridFloats++] = x1;
        this.gridPositions[gridFloats++] = gNE;
        this.gridPositions[gridFloats++] = z0;

        this.gridPositions[gridFloats++] = x1;
        this.gridPositions[gridFloats++] = gNE;
        this.gridPositions[gridFloats++] = z0;
        this.gridPositions[gridFloats++] = x1;
        this.gridPositions[gridFloats++] = gSE;
        this.gridPositions[gridFloats++] = z1;

        this.gridPositions[gridFloats++] = x1;
        this.gridPositions[gridFloats++] = gSE;
        this.gridPositions[gridFloats++] = z1;
        this.gridPositions[gridFloats++] = x0;
        this.gridPositions[gridFloats++] = gSW;
        this.gridPositions[gridFloats++] = z1;

        this.gridPositions[gridFloats++] = x0;
        this.gridPositions[gridFloats++] = gSW;
        this.gridPositions[gridFloats++] = z1;
        this.gridPositions[gridFloats++] = x0;
        this.gridPositions[gridFloats++] = gNW;
        this.gridPositions[gridFloats++] = z0;
      }

      // 4. Multi-Species OpenGFX Temperate Trees + Contact Shadow Discs
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
          treeCount = 3 + (hash2D(x, y, 1) > 0.5 ? 1 : 0);
        } else if (
          tile.terrain === 'GRASS' &&
          !tile.townId &&
          hash2D(x, y, 2) < 0.085
        ) {
          treeCount = 1;
        }

        for (let tIdx = 0; tIdx < treeCount && discIdx < MAX_TREES; tIdx++) {
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
          const s = 0.78 + hash2D(x, y, 40 + tIdx) * 0.46;
          const rotY = hash2D(x, y, 50 + tIdx) * Math.PI * 2;

          const tx = x + rx;
          const tz = y + rz;
          const surfTreeY = getSurfaceHeightAt(state, tx, tz);

          // Ground contact shadow disc aligned slightly above slope
          this.pos.set(tx, surfTreeY + 0.008, tz);
          this.quat.identity();
          this.scale.set(s, 1, s);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.treeShadowDiscs.setMatrixAt(discIdx++, this.mat4);

          // Choose species: ~62% Nordic Spruce/Pine in forests, ~38% Deciduous Oak/Birch
          const speciesRoll = hash2D(x, y, 70 + tIdx);
          const isConifer =
            tile.terrain === 'FOREST_TREES' ? speciesRoll < 0.65 : speciesRoll < 0.42;

          this.pos.set(tx, surfTreeY - 0.018, tz);
          this.euler.set(0, rotY, 0);
          this.quat.setFromEuler(this.euler);
          this.scale.set(s, s * (0.92 + hash2D(x, y, 60 + tIdx) * 0.28), s);
          this.mat4.compose(this.pos, this.quat, this.scale);

          if (isConifer && pineIdx < MAX_TREES) {
            this.pineTrunks.setMatrixAt(pineIdx, this.mat4);
            this.pineCrownsLower.setMatrixAt(pineIdx, this.mat4);
            this.pineCrownsMid.setMatrixAt(pineIdx, this.mat4);
            this.pineCrownsUpper.setMatrixAt(pineIdx, this.mat4);

            const shade = hash2D(x, y, 80 + tIdx);
            this.color.set(shade < 0.5 ? '#185423' : '#21682b');
            this.pineCrownsLower.setColorAt(pineIdx, this.color);
            this.color.offsetHSL(0.008, 0.02, 0.045);
            this.pineCrownsMid.setColorAt(pineIdx, this.color);
            this.color.offsetHSL(0.008, 0.02, 0.045);
            this.pineCrownsUpper.setColorAt(pineIdx, this.color);
            pineIdx++;
          } else if (decidIdx < MAX_TREES) {
            this.decidTrunks.setMatrixAt(decidIdx, this.mat4);
            this.decidCanopyMain.setMatrixAt(decidIdx, this.mat4);
            this.decidCanopyAccent.setMatrixAt(decidIdx, this.mat4);

            const vRoll = hash2D(x, y, 90 + tIdx);
            // Silver birch pale bark vs dark oak bark
            this.color.set(vRoll > 0.62 ? '#d6d3d1' : '#5c3a21');
            this.decidTrunks.setColorAt(decidIdx, this.color);

            if (vRoll > 0.88) {
              this.color.set('#b48a1e'); // Warm golden birch accent
            } else if (vRoll > 0.5) {
              this.color.set('#4c942b'); // Temperate lime-oak green
            } else {
              this.color.set('#377d28'); // Deep leafy green
            }
            this.decidCanopyMain.setColorAt(decidIdx, this.color);
            this.color.offsetHSL(0.012, 0.03, 0.06);
            this.decidCanopyAccent.setColorAt(decidIdx, this.color);
            decidIdx++;
          }
        }
      }

      const hCenter = corners.centerY;
      const hN = 0.5 * (cNW + cNE);
      const hS = 0.5 * (cSW + cSE);
      const hE = 0.5 * (cNE + cSE);
      const hW = 0.5 * (cNW + cSW);

      const pushBridgeTrussInstance = (mat: THREE.Matrix4, hex: string): void => {
        if (bridgeTrussIdx >= MAX_BRIDGE_TRUSS) return;
        this.bridgeTruss.setMatrixAt(bridgeTrussIdx, mat);
        this.color.set(hex);
        this.bridgeTruss.setColorAt(bridgeTrussIdx, this.color);
        bridgeTrussIdx++;
      };

      // 5A. 3D OpenTTD Elevated Water Bridges (`tile.bridge === 'ROAD' | 'RAIL'`)
      if (tile.bridge === 'ROAD' || tile.bridge === 'RAIL') {
        const axis = getBridgeAxis(tile);
        const isX = axis === 'X';
        const fwdX = isX ? 1 : 0;
        const fwdZ = isX ? 0 : 1;
        const rgtX = isX ? 0 : 1;
        const rgtZ = isX ? 1 : 0;

        // Lateral unit direction across the bridge width
        const latX = isX ? 0 : 1;
        const latZ = isX ? 1 : 0;

        // 1) Twin Submerged Concrete Water Piers + Pier Cap Beam + Waterline Foam Collar
        const pierBotY = TERRAIN_BASE_Y * 0.45;
        const pierTopY = BRIDGE_DECK_Y - 0.046;
        const pierH = pierTopY - pierBotY;
        const pierMidY = 0.5 * (pierBotY + pierTopY);

        for (const latOff of [-0.205, 0.205]) {
          if (bridgePierIdx >= MAX_BRIDGE_PIERS) break;
          this.quat.identity();
          this.pos.set(x + latX * latOff, pierMidY, y + latZ * latOff);
          this.scale.set(1, pierH, 1);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.bridgePiers.setMatrixAt(bridgePierIdx++, this.mat4);
        }

        if (bridgeConcIdx < MAX_BRIDGE_DECKS) {
          this.bridgeConcrete.setMatrixAt(
            bridgeConcIdx++,
            this.composeSurfaceAlignedBox(
              x, BRIDGE_DECK_Y, y,
              fwdX, 0, fwdZ,
              rgtX, 0, rgtZ,
              0.62, 0.052, 0.17, -0.042
            )
          );
        }

        if (isWater && foamIdx < MAX_FOAM_EDGES) {
          this.pos.set(x, WATER_SURFACE_Y + 0.005, y);
          this.euler.set(0, isX ? Math.PI / 2 : 0, 0);
          this.quat.setFromEuler(this.euler);
          this.scale.set(0.68, 1, 1.35);
          this.mat4.compose(this.pos, this.quat, this.scale);
          this.shoreFoamLayer.setMatrixAt(foamIdx++, this.mat4);
        }

        if (tile.bridge === 'ROAD') {
          // 2) Pre-stressed Concrete Box-Girder Deck + Raised Side Curbs
          if (bridgeConcIdx < MAX_BRIDGE_DECKS) {
            this.bridgeConcrete.setMatrixAt(
              bridgeConcIdx++,
              this.composeSurfaceAlignedBox(
                x, BRIDGE_DECK_Y, y,
                fwdX, 0, fwdZ,
                rgtX, 0, rgtZ,
                0.62, 0.072, 1.025, 0.022
              )
            );
          }

          for (const curbOff of [-0.275, 0.275]) {
            if (bridgeConcIdx >= MAX_BRIDGE_DECKS) break;
            this.bridgeConcrete.setMatrixAt(
              bridgeConcIdx++,
              this.composeSurfaceAlignedBox(
                x + latX * curbOff, BRIDGE_DECK_Y, y + latZ * curbOff,
                fwdX, 0, fwdZ,
                rgtX, 0, rgtZ,
                0.068, 0.046, 1.025, 0.054
              )
            );
          }

          // 3) Textured Dark Asphalt Deck + White Highway Dashes
          if (roadSegIdx < MAX_ROAD_SEGMENTS) {
            this.roadAsphalt.setMatrixAt(
              roadSegIdx++,
              this.composeSurfaceAlignedBox(
                x, BRIDGE_DECK_Y, y,
                fwdX, 0, fwdZ,
                rgtX, 0, rgtZ,
                0.46, 0.032, 1.025, 0.029
              )
            );
          }

          for (const sDash of [-0.33, 0.0, 0.33]) {
            if (roadDashIdx >= MAX_ROAD_DASHES) break;
            this.roadDashes.setMatrixAt(
              roadDashIdx++,
              this.composeSurfaceAlignedBox(
                x + fwdX * sDash, BRIDGE_DECK_Y, y + fwdZ * sDash,
                fwdX, 0, fwdZ,
                rgtX, 0, rgtZ,
                0.034, 0.008, 0.125, 0.035
              )
            );
          }

          // 4) Twin Painted Steel Safety Guardrails / Parapets
          for (const sideOff of [-0.285, 0.285]) {
            const gx = x + latX * sideOff;
            const gz = y + latZ * sideOff;

            // Crimson top rail + galvanized silver mid rail
            pushBridgeTrussInstance(
              this.composeSurfaceAlignedBox(
                gx, BRIDGE_DECK_Y, gz,
                fwdX, 0, fwdZ,
                rgtX, 0, rgtZ,
                0.028, 0.024, 1.025, 0.132
              ),
              '#dc2626'
            );
            pushBridgeTrussInstance(
              this.composeSurfaceAlignedBox(
                gx, BRIDGE_DECK_Y, gz,
                fwdX, 0, fwdZ,
                rgtX, 0, rgtZ,
                0.022, 0.018, 1.025, 0.092
              ),
              '#e2e8f0'
            );

            // Stanchion posts
            for (const postS of [-0.38, -0.13, 0.13, 0.38]) {
              this.quat.identity();
              this.pos.set(gx + fwdX * postS, BRIDGE_DECK_Y + 0.088, gz + fwdZ * postS);
              this.scale.set(0.026, 0.085, 0.026);
              this.mat4.compose(this.pos, this.quat, this.scale);
              pushBridgeTrussInstance(this.mat4, '#cbd5e1');
            }
          }
        } else {
          // RAIL BRIDGE: Iconic OpenTTD Red-Oxide Warren Steel Lattice Through-Truss Bridge!
          const gauge = 0.145;

          // 1) Heavy Dark-Slate Under-Deck Plate Girder
          pushBridgeTrussInstance(
            this.composeSurfaceAlignedBox(
              x, BRIDGE_DECK_Y, y,
              fwdX, 0, fwdZ,
              rgtX, 0, rgtZ,
              0.64, 0.068, 1.025, 0.024
            ),
            '#334155'
          );

          // 2) Closely-Spaced Open-Deck Timber Bridge Ties + Iron Clips + Twin Steel Rails
          for (let sIdx = 0; sIdx < 8; sIdx++) {
            const sPos = -0.4375 + sIdx * 0.125;
            const sx = x + fwdX * sPos;
            const sz = y + fwdZ * sPos;

            if (sleeperIdx < MAX_RAIL_SLEEPERS) {
              this.railSleepers.setMatrixAt(
                sleeperIdx++,
                this.composeSurfaceAlignedBox(
                  sx, BRIDGE_DECK_Y, sz,
                  fwdX, 0, fwdZ,
                  rgtX, 0, rgtZ,
                  0.50, 0.024, 0.068, 0.041
                )
              );
            }

            for (const side of [-gauge, gauge]) {
              if (clipIdx >= MAX_RAIL_CLIPS) break;
              this.railClips.setMatrixAt(
                clipIdx++,
                this.composeSurfaceAlignedBox(
                  sx + latX * side, BRIDGE_DECK_Y, sz + latZ * side,
                  fwdX, 0, fwdZ,
                  rgtX, 0, rgtZ,
                  0.068, 0.012, 0.068, 0.046
                )
              );
            }
          }

          for (const side of [-gauge, gauge]) {
            if (railSteelIdx >= MAX_RAIL_RAILS) break;
            this.railSteel.setMatrixAt(
              railSteelIdx++,
              this.composeSurfaceAlignedBox(
                x + latX * side, BRIDGE_DECK_Y, y + latZ * side,
                fwdX, 0, fwdZ,
                rgtX, 0, rgtZ,
                0.038, 0.026, 1.03, 0.058
              )
            );
          }

          // 3) Twin Red-Oxide Steel Lattice Side Trusses (Bottom/Top Chords + Verticals + 45° Warren Diagonals)
          const trussH = 0.32;
          const diagLen = Math.hypot(0.5, trussH);
          const nextAlong = getTileAt(state, x + fwdX, y + fwdZ);
          const isSpanEnd = !nextAlong || nextAlong.bridge !== 'RAIL';

          for (const sideOff of [-0.295, 0.295]) {
            const tx = x + latX * sideOff;
            const tz = y + latZ * sideOff;

            // Bottom chord
            pushBridgeTrussInstance(
              this.composeSurfaceAlignedBox(
                tx, BRIDGE_DECK_Y, tz,
                fwdX, 0, fwdZ,
                rgtX, 0, rgtZ,
                0.038, 0.036, 1.025, 0.046
              ),
              '#9a3412'
            );

            // Elevated top chord
            pushBridgeTrussInstance(
              this.composeSurfaceAlignedBox(
                tx, BRIDGE_DECK_Y, tz,
                fwdX, 0, fwdZ,
                rgtX, 0, rgtZ,
                0.042, 0.040, 1.025, 0.046 + trussH
              ),
              '#b9381e'
            );

            // Vertical H-beam posts at -0.5, 0.0 (and +0.5 at span end)
            const vPosts = isSpanEnd ? [-0.5, 0.0, 0.5] : [-0.5, 0.0];
            for (const vp of vPosts) {
              this.quat.identity();
              this.pos.set(
                tx + fwdX * vp,
                BRIDGE_DECK_Y + 0.035 + trussH * 0.5,
                tz + fwdZ * vp
              );
              this.scale.set(0.034, trussH, 0.034);
              this.mat4.compose(this.pos, this.quat, this.scale);
              pushBridgeTrussInstance(this.mat4, '#a8321e');
            }

            // Rising Warren diagonal (-0.5 -> 0.0) & descending Warren diagonal (0.0 -> +0.5)
            pushBridgeTrussInstance(
              this.composeSurfaceAlignedBox(
                tx - fwdX * 0.25,
                BRIDGE_DECK_Y + 0.035 + trussH * 0.5,
                tz - fwdZ * 0.25,
                fwdX * 0.5, trussH, fwdZ * 0.5,
                rgtX, 0, rgtZ,
                0.028, 0.028, diagLen, 0.014
              ),
              '#c2410c'
            );
            pushBridgeTrussInstance(
              this.composeSurfaceAlignedBox(
                tx + fwdX * 0.25,
                BRIDGE_DECK_Y + 0.035 + trussH * 0.5,
                tz + fwdZ * 0.25,
                fwdX * 0.5, -trussH, fwdZ * 0.5,
                rgtX, 0, rgtZ,
                0.028, 0.028, diagLen, 0.014
              ),
              '#c2410c'
            );
          }

          // Overhead portal cross-strut tying left & right top chords together
          pushBridgeTrussInstance(
            this.composeSurfaceAlignedBox(
              x, BRIDGE_DECK_Y, y,
              fwdX, 0, fwdZ,
              rgtX, 0, rgtZ,
              0.63, 0.032, 0.048, 0.052 + trussH
            ),
            '#9a3412'
          );
        }

        continue;
      }

      // 5B. Textured Land Roads + Urban Stone Sidewalks + Shore Bridge Abutment Ramps + Level Crossings
      if (tile.road) {
        const nN = getTileAt(state, x, y - 1);
        const nS = getTileAt(state, x, y + 1);
        const nE = getTileAt(state, x + 1, y);
        const nW = getTileAt(state, x - 1, y);

        const connN = isRoadConnectedDir(tile, nN, 0);
        const connS = isRoadConnectedDir(tile, nS, 0);
        const connE = isRoadConnectedDir(tile, nE, 1);
        const connW = isRoadConnectedDir(tile, nW, -1);
        const anyConn = connN || connS || connE || connW;

        const rampN = Boolean(connN && nN?.bridge === 'ROAD');
        const rampS = Boolean(connS && nS?.bridge === 'ROAD');
        const rampE = Boolean(connE && nE?.bridge === 'ROAD');
        const rampW = Boolean(connW && nW?.bridge === 'ROAD');

        const effN = rampN ? BRIDGE_DECK_Y : hN;
        const effS = rampS ? BRIDGE_DECK_Y : hS;
        const effE = rampE ? BRIDGE_DECK_Y : hE;
        const effW = rampW ? BRIDGE_DECK_Y : hW;

        const hubY = Math.max(hCenter, 0.5 * (hN + hS), 0.5 * (hE + hW));
        const isUrban = Boolean(tile.townId);
        const hubWidth = isUrban ? 0.66 : 0.54;

        if (isUrban) {
          if (urbanSidewalkIdx < MAX_ROAD_SEGMENTS) {
            this.roadUrbanSidewalk.setMatrixAt(
              urbanSidewalkIdx++,
              this.composeSurfaceAlignedBox(
                x, hubY, y,
                0, hS - hN, 1,
                1, hE - hW, 0,
                hubWidth, 0.088, hubWidth, 0.025
              )
            );
          }
        } else if (ruralEmbankIdx < MAX_ROAD_SEGMENTS) {
          this.roadRuralEmbankment.setMatrixAt(
            ruralEmbankIdx++,
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
              0.46, 0.045, 0.46, 0.029
            )
          );
        }

        const addRoadArm = (
          dx: number,
          dz: number,
          hEdge: number,
          isBridgeRamp = false
        ): void => {
          if (roadSegIdx >= MAX_ROAD_SEGMENTS) return;

          const midX = x + dx * 0.25;
          const midZ = y + dz * 0.25;
          const midY = 0.5 * (hCenter + hEdge);
          const dLong = hEdge - hCenter;
          const armSpatialLen = Math.hypot(0.5, dLong) + 0.045;

          let fwdX = 0, fwdY = 0, fwdZ = 1;
          let rgtX = 1, rgtY = 0, rgtZ = 0;

          if (dz === -1) {
            fwdX = 0; fwdY = hCenter - hEdge; fwdZ = 0.5;
            rgtX = 1; rgtY = isBridgeRamp ? 0 : cNE - cNW; rgtZ = 0;
          } else if (dz === 1) {
            fwdX = 0; fwdY = hEdge - hCenter; fwdZ = 0.5;
            rgtX = 1; rgtY = isBridgeRamp ? 0 : cSE - cSW; rgtZ = 0;
          } else if (dx === 1) {
            fwdX = 0.5; fwdY = hEdge - hCenter; fwdZ = 0;
            rgtX = 0; rgtY = isBridgeRamp ? 0 : cNE - cSE; rgtZ = -1;
          } else {
            fwdX = 0.5; fwdY = hCenter - hEdge; fwdZ = 0;
            rgtX = 0; rgtY = isBridgeRamp ? 0 : cNW - cSW; rgtZ = -1;
          }

          if (isBridgeRamp) {
            // Solid cut-stone / concrete bridge abutment ramp wall down to water bed + twin approach parapets
            if (bridgeConcIdx < MAX_BRIDGE_DECKS) {
              const abutThick = Math.max(0.18, midY - (WATER_SURFACE_Y - 0.08) + 0.024);
              this.bridgeConcrete.setMatrixAt(
                bridgeConcIdx++,
                this.composeSurfaceAlignedBox(
                  midX, midY, midZ,
                  fwdX, fwdY, fwdZ,
                  rgtX, rgtY, rgtZ,
                  0.62, abutThick, armSpatialLen + 0.03, 0.024
                )
              );
            }
            const latX = dx !== 0 ? 0 : 1;
            const latZ = dx !== 0 ? 1 : 0;
            for (const sideOff of [-0.285, 0.285]) {
              pushBridgeTrussInstance(
                this.composeSurfaceAlignedBox(
                  midX + latX * sideOff, midY, midZ + latZ * sideOff,
                  fwdX, fwdY, fwdZ,
                  rgtX, rgtY, rgtZ,
                  0.032, 0.028, armSpatialLen + 0.02, 0.115
                ),
                '#dc2626'
              );
            }
          } else if (isUrban) {
            if (urbanSidewalkIdx < MAX_ROAD_SEGMENTS) {
              this.roadUrbanSidewalk.setMatrixAt(
                urbanSidewalkIdx++,
                this.composeSurfaceAlignedBox(
                  midX, midY, midZ,
                  fwdX, fwdY, fwdZ,
                  rgtX, rgtY, rgtZ,
                  hubWidth, 0.088, armSpatialLen + 0.02, 0.025
                )
              );
            }
          } else if (ruralEmbankIdx < MAX_ROAD_SEGMENTS) {
            this.roadRuralEmbankment.setMatrixAt(
              ruralEmbankIdx++,
              this.composeSurfaceAlignedBox(
                midX, midY, midZ,
                fwdX, fwdY, fwdZ,
                rgtX, rgtY, rgtZ,
                hubWidth, 0.085, armSpatialLen + 0.02, 0.022
              )
            );
          }

          this.roadAsphalt.setMatrixAt(
            roadSegIdx++,
            this.composeSurfaceAlignedBox(
              midX, midY, midZ,
              fwdX, fwdY, fwdZ,
              rgtX, rgtY, rgtZ,
              0.45, 0.045, armSpatialLen, 0.029
            )
          );

          // Skip center road dashes right inside level crossings so timber crossing planks read cleanly
          if (!tile.rail && roadDashIdx + 1 < MAX_ROAD_DASHES) {
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
                  0.034, 0.008, 0.105, 0.035
                )
              );
            }
          }
        };

        if (connN) addRoadArm(0, -1, effN, rampN);
        if (connS) addRoadArm(0, 1, effS, rampS);
        if (connE) addRoadArm(1, 0, effE, rampE);
        if (connW) addRoadArm(-1, 0, effW, rampW);

        if (!anyConn) {
          addRoadArm(1, 0, hE, false);
          addRoadArm(-1, 0, hW, false);
        }
      }

      // 6. OpenGFX Railways (Pure 90° L-Turn Arcs, Shore Bridge Abutment Ramps, Sleepers + Clips, Steel Rails, Buffers, Crossings)
      if (tile.rail) {
        const nN = getTileAt(state, x, y - 1);
        const nS = getTileAt(state, x, y + 1);
        const nE = getTileAt(state, x + 1, y);
        const nW = getTileAt(state, x - 1, y);

        const connN = isRailConnectedDir(tile, nN, 0);
        const connS = isRailConnectedDir(tile, nS, 0);
        const connE = isRailConnectedDir(tile, nE, 1);
        const connW = isRailConnectedDir(tile, nW, -1);
        const connCount =
          (connN ? 1 : 0) + (connS ? 1 : 0) + (connE ? 1 : 0) + (connW ? 1 : 0);

        const rampN = Boolean(connN && nN?.bridge === 'RAIL');
        const rampS = Boolean(connS && nS?.bridge === 'RAIL');
        const rampE = Boolean(connE && nE?.bridge === 'RAIL');
        const rampW = Boolean(connW && nW?.bridge === 'RAIL');
        const hasBridgeRamp = rampN || rampS || rampE || rampW;

        const effN = rampN ? BRIDGE_DECK_Y : hN;
        const effS = rampS ? BRIDGE_DECK_Y : hS;
        const effE = rampE ? BRIDGE_DECK_Y : hE;
        const effW = rampW ? BRIDGE_DECK_Y : hW;

        const hubY = Math.max(hCenter, 0.5 * (hN + hS), 0.5 * (hE + hW));
        const gauge = 0.145;

        // Draw curved 90-degree corner arc ONLY on a true 2-connection 90° L-turn (NEVER on 3-way/4-way parallel tracks!)
        const isPureCurve =
          !hasBridgeRamp &&
          !tile.road &&
          !tile.stationId &&
          !tile.depot &&
          connCount === 2 &&
          connN !== connS &&
          connE !== connW;

        const addCurvedRailArc = (dirX: number, dirZ: number, includeBallast: boolean): void => {
          // Quarter-circle arc centered at inside tile corner `(x + dirX*0.5, y + dirZ*0.5)`
          const arcCx = x + dirX * 0.5;
          const arcCz = y + dirZ * 0.5;
          const segs = 5;

          for (let s = 0; s < segs; s++) {
            const a0 = (s / segs) * (Math.PI * 0.5);
            const a1 = ((s + 1) / segs) * (Math.PI * 0.5);
            const aMid = 0.5 * (a0 + a1);

            const mx = arcCx - dirX * 0.5 * Math.cos(aMid);
            const mz = arcCz - dirZ * 0.5 * Math.sin(aMid);
            const my = getSurfaceHeightAt(state, mx, mz);

            const p0x = arcCx - dirX * 0.5 * Math.cos(a0);
            const p0z = arcCz - dirZ * 0.5 * Math.sin(a0);
            const p1x = arcCx - dirX * 0.5 * Math.cos(a1);
            const p1z = arcCz - dirZ * 0.5 * Math.sin(a1);
            const y0 = getSurfaceHeightAt(state, p0x, p0z);
            const y1 = getSurfaceHeightAt(state, p1x, p1z);

            const fwdX = p1x - p0x;
            const fwdY = y1 - y0;
            const fwdZ = p1z - p0z;

            // Ensure right-handed basis `(fwd × right).y > 0`
            let radX = -dirX * Math.cos(aMid);
            let radZ = -dirZ * Math.sin(aMid);
            if (fwdZ * radX - fwdX * radZ < 0) {
              radX = -radX;
              radZ = -radZ;
            }
            const rY =
              getSurfaceHeightAt(state, mx + radX * 0.2, mz + radZ * 0.2) -
              getSurfaceHeightAt(state, mx - radX * 0.2, mz - radZ * 0.2);

            const chordLen = Math.hypot(fwdX, fwdY, fwdZ);

            if (includeBallast && ballastIdx < MAX_RAIL_BALLAST) {
              this.railBallast.setMatrixAt(
                ballastIdx++,
                this.composeSurfaceAlignedBox(
                  mx, my, mz,
                  fwdX, fwdY, fwdZ,
                  radX * 0.4, rY, radZ * 0.4,
                  0.56, 0.092, chordLen + 0.08, 0.028
                )
              );
            }

            // Inner & outer curved steel rails at exact R = 0.5 ± gauge
            for (const rRail of [0.5 - gauge, 0.5 + gauge]) {
              if (railSteelIdx >= MAX_RAIL_RAILS) break;
              const rx0 = arcCx - dirX * rRail * Math.cos(a0);
              const rz0 = arcCz - dirZ * rRail * Math.sin(a0);
              const rx1 = arcCx - dirX * rRail * Math.cos(a1);
              const rz1 = arcCz - dirZ * rRail * Math.sin(a1);
              const rmx = 0.5 * (rx0 + rx1);
              const rmz = 0.5 * (rz0 + rz1);
              const ry0 = getSurfaceHeightAt(state, rx0, rz0);
              const ry1 = getSurfaceHeightAt(state, rx1, rz1);
              const rmy = Math.max(getSurfaceHeightAt(state, rmx, rmz), 0.5 * (ry0 + ry1));
              const rLen = Math.hypot(rx1 - rx0, ry1 - ry0, rz1 - rz0);

              this.railSteel.setMatrixAt(
                railSteelIdx++,
                this.composeSurfaceAlignedBox(
                  rmx, rmy, rmz,
                  rx1 - rx0, ry1 - ry0, rz1 - rz0,
                  radX * 0.4, rY, radZ * 0.4,
                  0.038, 0.026, rLen + 0.022, 0.058
                )
              );
            }
          }

          // 6 radially fanned timber sleepers + iron rail clips along the 90° curve
          const sleeperSteps = 6;
          for (let k = 0; k < sleeperSteps; k++) {
            if (sleeperIdx >= MAX_RAIL_SLEEPERS) break;
            const ang = ((k + 0.5) / sleeperSteps) * (Math.PI * 0.5);
            const sx = arcCx - dirX * 0.5 * Math.cos(ang);
            const sz = arcCz - dirZ * 0.5 * Math.sin(ang);
            const sy = getSurfaceHeightAt(state, sx, sz);

            const tngX = dirX * Math.sin(ang);
            const tngZ = -dirZ * Math.cos(ang);
            let radX = -dirX * Math.cos(ang);
            let radZ = -dirZ * Math.sin(ang);
            if (tngZ * radX - tngX * radZ < 0) {
              radX = -radX;
              radZ = -radZ;
            }
            const tngY =
              getSurfaceHeightAt(state, sx + tngX * 0.12, sz + tngZ * 0.12) -
              getSurfaceHeightAt(state, sx - tngX * 0.12, sz - tngZ * 0.12);
            const radY =
              getSurfaceHeightAt(state, sx + radX * 0.18, sz + radZ * 0.18) -
              getSurfaceHeightAt(state, sx - radX * 0.18, sz - radZ * 0.18);

            this.railSleepers.setMatrixAt(
              sleeperIdx++,
              this.composeSurfaceAlignedBox(
                sx, sy, sz,
                tngX * 0.24, tngY, tngZ * 0.24,
                radX * 0.36, radY, radZ * 0.36,
                0.46, 0.022, 0.064, 0.041
              )
            );

            // Iron rail fastener clips
            for (const side of [-gauge, gauge]) {
              if (clipIdx >= MAX_RAIL_CLIPS) break;
              const cxClip = sx + radX * side;
              const czClip = sz + radZ * side;
              const cyClip = getSurfaceHeightAt(state, cxClip, czClip);
              this.railClips.setMatrixAt(
                clipIdx++,
                this.composeSurfaceAlignedBox(
                  cxClip, cyClip, czClip,
                  tngX * 0.24, tngY, tngZ * 0.24,
                  radX * 0.36, radY, radZ * 0.36,
                  0.068, 0.012, 0.068, 0.046
                )
              );
            }
          }
        };

        if (isPureCurve) {
          const dirX = connE ? 1 : -1;
          const dirZ = connS ? 1 : -1;
          addCurvedRailArc(dirX, dirZ, true);
        } else {
          // Straight / Switch / Terminal / Level-Crossing Rail Geometry
          if (ballastIdx < MAX_RAIL_BALLAST) {
            this.railBallast.setMatrixAt(
              ballastIdx++,
              this.composeSurfaceAlignedBox(
                x, hubY, y,
                0, hS - hN, 1,
                1, hE - hW, 0,
                0.56, 0.092, 0.56, 0.028
              )
            );
          }

          const addStraightRailArm = (
            dx: number,
            dz: number,
            hEdgeFull: number,
            armFraction = 1.0,
            isBridgeRamp = false
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
              fwdX = 0; fwdY = hCenter - hEdgeFull; fwdZ = 0.5;
              rgtX = 1; rgtY = isBridgeRamp ? 0 : cNE - cNW; rgtZ = 0;
            } else if (dz === 1) {
              fwdX = 0; fwdY = hEdgeFull - hCenter; fwdZ = 0.5;
              rgtX = 1; rgtY = isBridgeRamp ? 0 : cSE - cSW; rgtZ = 0;
            } else if (dx === 1) {
              fwdX = 0.5; fwdY = hEdgeFull - hCenter; fwdZ = 0;
              rgtX = 0; rgtY = isBridgeRamp ? 0 : cNE - cSE; rgtZ = -1;
            } else {
              fwdX = 0.5; fwdY = hCenter - hEdgeFull; fwdZ = 0;
              rgtX = 0; rgtY = isBridgeRamp ? 0 : cNW - cSW; rgtZ = -1;
            }

            if (isBridgeRamp && bridgeConcIdx < MAX_BRIDGE_DECKS) {
              const abutThick = Math.max(0.18, midY - (WATER_SURFACE_Y - 0.08) + 0.026);
              this.bridgeConcrete.setMatrixAt(
                bridgeConcIdx++,
                this.composeSurfaceAlignedBox(
                  midX, midY, midZ,
                  fwdX, fwdY, fwdZ,
                  rgtX, rgtY, rgtZ,
                  0.64, abutThick, segLen + 0.03, 0.026
                )
              );
              const latX = dx !== 0 ? 0 : 1;
              const latZ = dx !== 0 ? 1 : 0;
              for (const sideOff of [-0.295, 0.295]) {
                pushBridgeTrussInstance(
                  this.composeSurfaceAlignedBox(
                    midX + latX * sideOff, midY, midZ + latZ * sideOff,
                    fwdX, fwdY, fwdZ,
                    rgtX, rgtY, rgtZ,
                    0.036, 0.032, segLen + 0.02, 0.095
                  ),
                  '#9a3412'
                );
              }
            }

            if (ballastIdx < MAX_RAIL_BALLAST) {
              this.railBallast.setMatrixAt(
                ballastIdx++,
                this.composeSurfaceAlignedBox(
                  midX, midY, midZ,
                  fwdX, fwdY, fwdZ,
                  rgtX, rgtY, rgtZ,
                  0.55, 0.092, segLen, 0.028
                )
              );
            }

            const rNormLen = Math.hypot(rgtX, rgtY, rgtZ) || 1;
            const rxUnit = rgtX / rNormLen;
            const ryUnit = rgtY / rNormLen;
            const rzUnit = rgtZ / rNormLen;

            // Closely-spaced dark timber sleepers + iron rail clips
            for (const sOff of [0.09, 0.21, 0.33, 0.44]) {
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
                  0.46, 0.022, 0.062, 0.041
                )
              );

              for (const side of [-gauge, gauge]) {
                if (clipIdx >= MAX_RAIL_CLIPS) break;
                this.railClips.setMatrixAt(
                  clipIdx++,
                  this.composeSurfaceAlignedBox(
                    sx + rxUnit * side,
                    sy + ryUnit * side,
                    sz + rzUnit * side,
                    fwdX, fwdY, fwdZ,
                    rgtX, rgtY, rgtZ,
                    0.068, 0.012, 0.066, 0.046
                  )
                );
              }
            }

            // Twin parallel steel rails
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
                  0.038, 0.026, segLen + 0.025, 0.058
                )
              );
            }
          };

          if (connN) addStraightRailArm(0, -1, effN, 1.0, rampN);
          if (connS) addStraightRailArm(0, 1, effS, 1.0, rampS);
          if (connE) addStraightRailArm(1, 0, effE, 1.0, rampE);
          if (connW) addStraightRailArm(-1, 0, effW, 1.0, rampW);

          if (connCount === 0) {
            addStraightRailArm(1, 0, hE, 1.0, false);
            addStraightRailArm(-1, 0, hW, 1.0, false);
          } else if (connCount === 1 && !tile.stationId && !tile.depot) {
            // Terminal Track End: Detailed Steel A-Frame Buffer Stop + Red/White Warning Beam!
            const oppDx = connE ? -1 : connW ? 1 : 0;
            const oppDz = connS ? -1 : connN ? 1 : 0;
            const oppEdgeH = oppDx === 1 ? hE : oppDx === -1 ? hW : oppDz === 1 ? hS : hN;
            addStraightRailArm(oppDx, oppDz, oppEdgeH, 0.66);

            const bx = x + oppDx * 0.28;
            const bz = y + oppDz * 0.28;
            const by = getSurfaceHeightAt(state, bx, bz);

            // Twin angled steel A-frame struts over both rails
            for (const side of [-gauge, gauge]) {
              if (clipIdx + 1 >= MAX_RAIL_CLIPS) break;
              const sx = bx + (oppDz !== 0 ? side : 0);
              const sz = bz + (oppDx !== 0 ? side : 0);

              // Upright steel post
              this.quat.identity();
              this.pos.set(sx, by + 0.095, sz);
              this.scale.set(0.036, 0.11, 0.036);
              this.mat4.compose(this.pos, this.quat, this.scale);
              this.railClips.setMatrixAt(clipIdx++, this.mat4);

              // Angled back-brace strut
              this.euler.set(
                oppDz * 0.55,
                0,
                -oppDx * 0.55
              );
              this.quat.setFromEuler(this.euler);
              this.pos.set(sx - oppDx * 0.055, by + 0.085, sz - oppDz * 0.055);
              this.scale.set(0.03, 0.13, 0.03);
              this.mat4.compose(this.pos, this.quat, this.scale);
              this.railClips.setMatrixAt(clipIdx++, this.mat4);
            }

            // Red-and-white warning buffer crossbeam
            if (warningBeamIdx < MAX_BUFFERS) {
              this.quat.identity();
              this.pos.set(bx - oppDx * 0.02, by + 0.125, bz - oppDz * 0.02);
              this.scale.set(
                oppDx !== 0 ? 0.048 : 0.42,
                0.055,
                oppDz !== 0 ? 0.048 : 0.42
              );
              this.mat4.compose(this.pos, this.quat, this.scale);
              this.railWarningBeams.setMatrixAt(warningBeamIdx++, this.mat4);
            }
          }

          // Center sleeper tie
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
                0.46, 0.022, 0.064, 0.041
              )
            );
          }
        }

        // 7. Authentic OpenTTD Road-Rail Level Crossing (`tile.road && tile.rail`)
        if (tile.road) {
          const ewRail = (connE || connW) && !(connN || connS);
          const fwdX = ewRail ? 1 : 0;
          const fwdY = ewRail ? hE - hW : hS - hN;
          const fwdZ = ewRail ? 0 : 1;
          const rgtX = ewRail ? 0 : 1;
          const rgtY = ewRail ? hN - hS : hE - hW;
          const rgtZ = ewRail ? -1 : 0;

          // Center wooden crossing plank deck between the steel rails + twin outer approach planks
          if (crossingPlankIdx + 2 < MAX_CROSSINGS * 4) {
            this.crossingPlanks.setMatrixAt(
              crossingPlankIdx++,
              this.composeSurfaceAlignedBox(
                x, hubY, y,
                fwdX, fwdY, fwdZ,
                rgtX, rgtY, rgtZ,
                0.23, 0.032, 0.52, 0.056
              )
            );

            const rNorm = Math.hypot(rgtX, rgtY, rgtZ) || 1;
            for (const outerSide of [-0.225, 0.225]) {
              this.crossingPlanks.setMatrixAt(
                crossingPlankIdx++,
                this.composeSurfaceAlignedBox(
                  x + (rgtX / rNorm) * outerSide,
                  hubY + (rgtY / rNorm) * outerSide,
                  y + (rgtZ / rNorm) * outerSide,
                  fwdX, fwdY, fwdZ,
                  rgtX, rgtY, rgtZ,
                  0.09, 0.032, 0.52, 0.055
                )
              );
            }
          }

          // Twin red-and-white striped warning posts + glowing red lamps at opposite corners
          for (const [cxOff, czOff] of [
            [-0.34, -0.34],
            [0.34, 0.34],
          ]) {
            if (crossingPostIdx >= MAX_CROSSINGS * 4 || crossingLampIdx >= MAX_CROSSINGS * 4) {
              break;
            }
            const px = x + cxOff;
            const pz = y + czOff;
            const py = getSurfaceHeightAt(state, px, pz);

            this.quat.identity();
            this.pos.set(px, py + 0.11, pz);
            this.scale.set(0.038, 0.26, 0.038);
            this.mat4.compose(this.pos, this.quat, this.scale);
            this.crossingPosts.setMatrixAt(crossingPostIdx++, this.mat4);

            this.pos.set(px, py + 0.255, pz);
            this.scale.set(0.085, 0.085, 0.085);
            this.mat4.compose(this.pos, this.quat, this.scale);
            this.crossingLamps.setMatrixAt(crossingLampIdx++, this.mat4);
          }
        }
      }
    }

    // 8. Classic TTD Stratified Earth/Rock Cross-Section Skirt Walls along all 4 outer map borders
    const minCoord = -0.5;
    const maxCoord = mapSize - 0.5;
    const sunEarthHex = '#754d2b';
    const shadeEarthHex = '#51341b';

    for (let s = 0; s < mapSize; s++) {
      if (terrainVertIdx + 24 > MAX_TERRAIN_VERTS) break;

      const sx0 = s - 0.5;
      const sx1 = s + 0.5;
      const ez0 = s - 0.5;
      const ez1 = s + 0.5;

      // South border
      const sH0 = getCornerHeight(state, s, mapSize);
      const sH1 = getCornerHeight(state, s + 1, mapSize);
      terrainVertIdx = this.pushTexturedFacetedTriangle(
        sx0, sH0, maxCoord, 0, 1,
        sx0, TERRAIN_BASE_Y, maxCoord, 0, 0,
        sx1, TERRAIN_BASE_Y, maxCoord, 1, 0,
        sunEarthHex, 'ROCK', false, false, terrainVertIdx
      );
      terrainVertIdx = this.pushTexturedFacetedTriangle(
        sx0, sH0, maxCoord, 0, 1,
        sx1, TERRAIN_BASE_Y, maxCoord, 1, 0,
        sx1, sH1, maxCoord, 1, 1,
        sunEarthHex, 'ROCK', false, false, terrainVertIdx
      );

      // East border
      const eH0 = getCornerHeight(state, mapSize, s);
      const eH1 = getCornerHeight(state, mapSize, s + 1);
      terrainVertIdx = this.pushTexturedFacetedTriangle(
        maxCoord, eH0, ez0, 0, 1,
        maxCoord, eH1, ez1, 1, 1,
        maxCoord, TERRAIN_BASE_Y, ez1, 1, 0,
        shadeEarthHex, 'ROCK', false, false, terrainVertIdx
      );
      terrainVertIdx = this.pushTexturedFacetedTriangle(
        maxCoord, eH0, ez0, 0, 1,
        maxCoord, TERRAIN_BASE_Y, ez1, 1, 0,
        maxCoord, TERRAIN_BASE_Y, ez0, 0, 0,
        shadeEarthHex, 'ROCK', false, false, terrainVertIdx
      );

      // North border
      const nH0 = getCornerHeight(state, s, 0);
      const nH1 = getCornerHeight(state, s + 1, 0);
      terrainVertIdx = this.pushTexturedFacetedTriangle(
        sx1, nH1, minCoord, 1, 1,
        sx1, TERRAIN_BASE_Y, minCoord, 1, 0,
        sx0, TERRAIN_BASE_Y, minCoord, 0, 0,
        shadeEarthHex, 'ROCK', false, false, terrainVertIdx
      );
      terrainVertIdx = this.pushTexturedFacetedTriangle(
        sx1, nH1, minCoord, 1, 1,
        sx0, TERRAIN_BASE_Y, minCoord, 0, 0,
        sx0, nH0, minCoord, 0, 1,
        shadeEarthHex, 'ROCK', false, false, terrainVertIdx
      );

      // West border
      const wH0 = getCornerHeight(state, 0, s);
      const wH1 = getCornerHeight(state, 0, s + 1);
      terrainVertIdx = this.pushTexturedFacetedTriangle(
        minCoord, wH1, ez1, 1, 1,
        minCoord, wH0, ez0, 0, 1,
        minCoord, TERRAIN_BASE_Y, ez0, 0, 0,
        sunEarthHex, 'ROCK', false, false, terrainVertIdx
      );
      terrainVertIdx = this.pushTexturedFacetedTriangle(
        minCoord, wH1, ez1, 1, 1,
        minCoord, TERRAIN_BASE_Y, ez0, 0, 0,
        minCoord, TERRAIN_BASE_Y, ez1, 1, 0,
        sunEarthHex, 'ROCK', false, false, terrainVertIdx
      );
    }

    // Commit buffers
    this.terrainGeo.setDrawRange(0, terrainVertIdx);
    this.terrainGeo.attributes.position.needsUpdate = true;
    this.terrainGeo.attributes.normal.needsUpdate = true;
    this.terrainGeo.attributes.color.needsUpdate = true;
    this.terrainGeo.attributes.uv.needsUpdate = true;

    this.commitInstanced(this.waterSparkleLayer, waterIdx, true);
    this.commitInstanced(this.shoreFoamLayer, foamIdx, false);

    this.gridGeometry.setDrawRange(0, gridFloats / 3);
    this.gridGeometry.attributes.position.needsUpdate = true;

    this.commitInstanced(this.treeShadowDiscs, discIdx, false);
    this.commitInstanced(this.pineTrunks, pineIdx, false);
    this.commitInstanced(this.pineCrownsLower, pineIdx, true);
    this.commitInstanced(this.pineCrownsMid, pineIdx, true);
    this.commitInstanced(this.pineCrownsUpper, pineIdx, true);

    this.commitInstanced(this.decidTrunks, decidIdx, true);
    this.commitInstanced(this.decidCanopyMain, decidIdx, true);
    this.commitInstanced(this.decidCanopyAccent, decidIdx, true);

    this.commitInstanced(this.roadRuralEmbankment, ruralEmbankIdx, false);
    this.commitInstanced(this.roadUrbanSidewalk, urbanSidewalkIdx, false);
    this.commitInstanced(this.roadAsphalt, roadSegIdx, false);
    this.commitInstanced(this.roadDashes, roadDashIdx, false);

    this.commitInstanced(this.crossingPlanks, crossingPlankIdx, false);
    this.commitInstanced(this.crossingPosts, crossingPostIdx, false);
    this.commitInstanced(this.crossingLamps, crossingLampIdx, false);

    this.commitInstanced(this.railBallast, ballastIdx, false);
    this.commitInstanced(this.railSleepers, sleeperIdx, false);
    this.commitInstanced(this.railClips, clipIdx, false);
    this.commitInstanced(this.railSteel, railSteelIdx, false);
    this.commitInstanced(this.railWarningBeams, warningBeamIdx, false);

    this.commitInstanced(this.bridgePiers, bridgePierIdx, false);
    this.commitInstanced(this.bridgeConcrete, bridgeConcIdx, false);
    this.commitInstanced(this.bridgeTruss, bridgeTrussIdx, true);
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
      this.treeShadowDiscs,
      this.pineTrunks,
      this.pineCrownsLower,
      this.pineCrownsMid,
      this.pineCrownsUpper,
      this.decidTrunks,
      this.decidCanopyMain,
      this.decidCanopyAccent,
      this.roadRuralEmbankment,
      this.roadUrbanSidewalk,
      this.roadAsphalt,
      this.roadDashes,
      this.crossingPlanks,
      this.crossingPosts,
      this.crossingLamps,
      this.railBallast,
      this.railSleepers,
      this.railClips,
      this.railSteel,
      this.railWarningBeams,
      this.bridgePiers,
      this.bridgeConcrete,
      this.bridgeTruss,
    ];
    for (const m of meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.gridGeometry.dispose();
    (this.gridLines.material as THREE.Material).dispose();
    disposeTerrainTextureSet(this.textures);
  }
}
