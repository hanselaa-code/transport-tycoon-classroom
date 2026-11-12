import * as THREE from 'three';

export interface TerrainTextureSet {
  terrainAtlas: THREE.CanvasTexture | null;
  waterRipple: THREE.CanvasTexture | null;
  asphalt: THREE.CanvasTexture | null;
  urbanSidewalk: THREE.CanvasTexture | null;
  gravelRoadbed: THREE.CanvasTexture | null;
  ballast: THREE.CanvasTexture | null;
  timberSleeper: THREE.CanvasTexture | null;
  warningStripes: THREE.CanvasTexture | null;
}

// Deterministic fast PRNG for crisp reproducible OpenGFX pixel dithering
function createPixelRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { canvas, ctx };
}

function configurePixelTexture(
  canvas: HTMLCanvasElement,
  repeat = false
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  } else {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds a 128x128 2x2 OpenGFX-inspired pixel-art terrain atlas (4 quadrants of 64x64):
 * - Top-Left (0,0): Temperate Grass blades & subtle clover grain (neutral luminance modulated by vertex color)
 * - Top-Right (1,0): Coastal Sand ripples & pebbles
 * - Bottom-Left (0,1): Stratified Rocky Cliff / Steep Slope stone facets
 * - Bottom-Right (1,1): Forest Moss & pine needle litter
 */
function createTerrainAtlasTexture(): THREE.CanvasTexture | null {
  const surface = makeCanvas(128, 128);
  if (!surface) return null;
  const { canvas, ctx } = surface;
  const img = ctx.createImageData(128, 128);
  const data = img.data;
  const rng = createPixelRng(19950406);

  const setPx = (x: number, y: number, r: number, g: number, b: number) => {
    const idx = (y * 128 + x) * 4;
    data[idx] = Math.max(0, Math.min(255, Math.round(r)));
    data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
    data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
    data[idx + 3] = 255;
  };

  // Quadrant (0,0): Temperate OpenGFX Grass (white-balanced luminance ~235 so vertex colors stay vibrant)
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const bayer = ((x & 1) ^ (y & 1)) * 7;
      const n = rng();
      let lum = 232 + bayer + (n - 0.5) * 24;
      let gBoost = 4;
      let rBoost = 0;

      // Crisp 2px vertical grass blade tufts
      if (n > 0.87 && y > 1) {
        lum -= 22;
        gBoost += 6;
      } else if (n < 0.09) {
        lum += 18;
        rBoost += 5;
      }
      // Occasional tiny clover/meadow highlight pixel
      if (n > 0.985) {
        lum = 252;
        rBoost = 10;
        gBoost = 8;
      }
      setPx(x, y, lum + rBoost, lum + gBoost, lum - 8);
    }
  }

  // Quadrant (1,0): Coastal Sand pebbles & wind ripples (x: 64..127, y: 0..63)
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const ripple = Math.sin((x + y * 0.6) * 0.45) * 8;
      const n = rng();
      let lum = 236 + ripple + (n - 0.5) * 22;
      if (n > 0.94) lum -= 30; // Small dark beach pebble
      else if (n < 0.05) lum += 18; // Shell glint
      setPx(64 + x, y, lum + 6, lum + 2, lum - 10);
    }
  }

  // Quadrant (0,1): Stratified Rocky Slope / Cliff Stone (x: 0..63, y: 64..127)
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const strata = Math.sin(y * 0.65 + Math.sin(x * 0.28) * 1.6) * 22;
      const crack = ((x * 7 + y * 13) % 19 === 0) ? -28 : 0;
      const n = rng();
      const lum = 205 + strata + crack + (n - 0.5) * 28;
      setPx(x, 64 + y, lum + 4, lum, lum - 4);
    }
  }

  // Quadrant (1,1): Forest Floor Moss & Needle Litter (x: 64..127, y: 64..127)
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const n = rng();
      let r = 220 + (n - 0.5) * 32;
      let g = 232 + (n - 0.5) * 28;
      let b = 208 + (n - 0.5) * 24;
      if (n > 0.88) {
        // Pine needle / twig fleck
        r += 16;
        g -= 12;
        b -= 18;
      } else if (n < 0.14) {
        // Deep moss patch
        r -= 22;
        g -= 8;
        b -= 20;
      }
      setPx(64 + x, 64 + y, r, g, b);
    }
  }

  ctx.putImageData(img, 0, 0);
  return configurePixelTexture(canvas, false);
}

/**
 * Classic OpenTTD pixel-dithered sparkling ocean water ripple texture (scrollable via UV offset).
 */
function createWaterRippleTexture(): THREE.CanvasTexture | null {
  const surface = makeCanvas(64, 64);
  if (!surface) return null;
  const { canvas, ctx } = surface;
  const img = ctx.createImageData(64, 64);
  const data = img.data;
  const rng = createPixelRng(90210);

  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const waveA = Math.sin(((x + y) / 64) * Math.PI * 6);
      const waveB = Math.cos(((x - y * 1.5) / 64) * Math.PI * 4);
      const val = waveA * 0.55 + waveB * 0.45 + (rng() - 0.5) * 0.35;

      let r = 26;
      let g = 118;
      let b = 178;

      if (val > 0.68) {
        // Crisp OpenTTD light-cyan wave crest pixel
        r = 98;
        g = 188;
        b = 235;
      } else if (val > 0.32) {
        r = 42;
        g = 142;
        b = 204;
      } else if (val < -0.45) {
        r = 17;
        g = 92;
        b = 148;
      }

      const idx = (y * 64 + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = configurePixelTexture(canvas, true);
  tex.repeat.set(1, 1);
  return tex;
}

function createAsphaltTexture(): THREE.CanvasTexture | null {
  const surface = makeCanvas(64, 64);
  if (!surface) return null;
  const { canvas, ctx } = surface;
  const img = ctx.createImageData(64, 64);
  const data = img.data;
  const rng = createPixelRng(441122);

  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      // Subtle wheel-track wear lanes + crisp asphalt aggregate speckle + light curb line at outer edges
      const edge = x < 4 || x >= 60;
      const laneWear =
        (x >= 14 && x <= 23) || (x >= 40 && x <= 49) ? -5 : 0;
      const speckle = (rng() - 0.5) * 22;
      const base = edge ? 118 + speckle * 0.5 : 54 + laneWear + speckle;

      const idx = (y * 64 + x) * 4;
      data[idx] = Math.max(24, Math.min(200, base));
      data[idx + 1] = Math.max(26, Math.min(204, base + 2));
      data[idx + 2] = Math.max(30, Math.min(212, base + 7));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return configurePixelTexture(canvas, true);
}

function createUrbanSidewalkTexture(): THREE.CanvasTexture | null {
  const surface = makeCanvas(64, 64);
  if (!surface) return null;
  const { canvas, ctx } = surface;
  const img = ctx.createImageData(64, 64);
  const data = img.data;
  const rng = createPixelRng(778899);

  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const joint = x % 16 === 0 || y % 16 === 0;
      const highlight = x % 16 === 1 || y % 16 === 1;
      let lum = 166 + (rng() - 0.5) * 14;
      if (joint) lum = 108;
      else if (highlight) lum = 190;

      const idx = (y * 64 + x) * 4;
      data[idx] = lum;
      data[idx + 1] = lum + 2;
      data[idx + 2] = lum + 6;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return configurePixelTexture(canvas, true);
}

function createGravelTexture(
  baseR: number,
  baseG: number,
  baseB: number,
  seed: number
): THREE.CanvasTexture | null {
  const surface = makeCanvas(64, 64);
  if (!surface) return null;
  const { canvas, ctx } = surface;
  const img = ctx.createImageData(64, 64);
  const data = img.data;
  const rng = createPixelRng(seed);

  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const n = rng();
      let delta = (n - 0.5) * 42;
      if (n > 0.9) delta = 28;
      else if (n < 0.12) delta = -28;

      const idx = (y * 64 + x) * 4;
      data[idx] = Math.max(20, Math.min(235, baseR + delta));
      data[idx + 1] = Math.max(20, Math.min(235, baseG + delta));
      data[idx + 2] = Math.max(20, Math.min(235, baseB + delta));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return configurePixelTexture(canvas, true);
}

function createTimberSleeperTexture(): THREE.CanvasTexture | null {
  const surface = makeCanvas(64, 32);
  if (!surface) return null;
  const { canvas, ctx } = surface;
  const img = ctx.createImageData(64, 32);
  const data = img.data;
  const rng = createPixelRng(331155);

  for (let y = 0; y < 32; y++) {
    const plankSeam = y % 8 === 0;
    for (let x = 0; x < 64; x++) {
      const grain = Math.sin(y * 1.4 + x * 0.18) * 8 + (rng() - 0.5) * 14;
      let r = 84 + grain;
      let g = 52 + grain * 0.7;
      let b = 32 + grain * 0.5;
      if (plankSeam) {
        r = 42;
        g = 25;
        b = 15;
      } else if ((x === 16 || x === 48) && y % 8 === 4) {
        // Iron spike / bolt head
        r = 120;
        g = 126;
        b = 135;
      }
      const idx = (y * 64 + x) * 4;
      data[idx] = Math.max(15, Math.min(220, r));
      data[idx + 1] = Math.max(12, Math.min(220, g));
      data[idx + 2] = Math.max(10, Math.min(220, b));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return configurePixelTexture(canvas, true);
}

function createWarningStripesTexture(): THREE.CanvasTexture | null {
  const surface = makeCanvas(64, 16);
  if (!surface) return null;
  const { canvas, ctx } = surface;
  for (let x = 0; x < 64; x++) {
    const isRed = Math.floor(x / 8) % 2 === 0;
    ctx.fillStyle = isRed ? '#dc2626' : '#f8fafc';
    ctx.fillRect(x, 0, 1, 16);
  }
  return configurePixelTexture(canvas, true);
}

export function createTerrainTextureSet(): TerrainTextureSet {
  return {
    terrainAtlas: createTerrainAtlasTexture(),
    waterRipple: createWaterRippleTexture(),
    asphalt: createAsphaltTexture(),
    urbanSidewalk: createUrbanSidewalkTexture(),
    gravelRoadbed: createGravelTexture(124, 117, 108, 551199),
    ballast: createGravelTexture(114, 108, 101, 662288),
    timberSleeper: createTimberSleeperTexture(),
    warningStripes: createWarningStripesTexture(),
  };
}

export function disposeTerrainTextureSet(set: TerrainTextureSet): void {
  set.terrainAtlas?.dispose();
  set.waterRipple?.dispose();
  set.asphalt?.dispose();
  set.urbanSidewalk?.dispose();
  set.gravelRoadbed?.dispose();
  set.ballast?.dispose();
  set.timberSleeper?.dispose();
  set.warningStripes?.dispose();
}
