import * as THREE from 'three';

export type BuildingTextureKey =
  | 'ashlarStone'
  | 'brickRedPlain'
  | 'brickRedWindow'
  | 'brickRedWindowLit'
  | 'brickOchreWindow'
  | 'stuccoCreamWindow'
  | 'timberRorosRed'
  | 'timberBergenOchre'
  | 'timberCoastalWhite'
  | 'timberSageGreen'
  | 'timberBarnRed'
  | 'shopfrontGround'
  | 'awningStripedRed'
  | 'awningStripedBlue'
  | 'awningStripedGreen'
  | 'officeConcreteGrid'
  | 'curtainWallBlue'
  | 'curtainWallGold'
  | 'apartmentModern'
  | 'factoryBrickArched'
  | 'corrugatedSteel'
  | 'siloGalvanized'
  | 'roofTerracotta'
  | 'roofSlate'
  | 'roofCorrugatedDark'
  | 'platformPaving'
  | 'coalHeap';

export interface BuildingTextureSet {
  textures: Record<BuildingTextureKey, THREE.CanvasTexture | null>;
  dispose(): void;
}

function pxHash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makeCanvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.imageSmoothingEnabled = false;
  draw(ctx, width, height);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function drawFlemishBrickBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mortarHex: string,
  stretcherPalette: string[],
  headerHex: string,
  seed: number
): void {
  ctx.fillStyle = mortarHex;
  ctx.fillRect(0, 0, w, h);

  const rowH = 4;
  for (let row = 0; row < Math.ceil(h / rowH); row++) {
    const py = row * rowH;
    const brickH = rowH - 1;
    // Flemish bond: alternating stretcher (7px) + header (3px) + 1px mortar joints = 12px cycle
    const offset = (row % 2) * 6;
    let cursorX = -offset;
    let idx = 0;
    while (cursorX < w) {
      const isHeader = idx % 2 === 1;
      const bw = isHeader ? 3 : 7;
      const r = pxHash(idx, row, seed);
      if (isHeader) {
        ctx.fillStyle = headerHex;
      } else {
        ctx.fillStyle = stretcherPalette[Math.floor(r * stretcherPalette.length) % stretcherPalette.length];
      }
      const x0 = Math.max(0, cursorX);
      const x1 = Math.min(w, cursorX + bw);
      if (x1 > x0) {
        ctx.fillRect(x0, py, x1 - x0, brickH);
        // Subtle 1px highlight on upper-left of some stretchers for crisp pixel depth
        if (!isHeader && r > 0.55 && x1 - x0 >= 3) {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(x0, py, x1 - x0 - 1, 1);
        }
      }
      cursorX += bw + 1;
      idx++;
    }
  }
}

function drawClapboardBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  baseHex: string,
  highlightHex: string,
  shadowHex: string,
  seed: number
): void {
  const plankH = 4;
  for (let row = 0; row < Math.ceil(h / plankH); row++) {
    const py = row * plankH;
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, py, w, plankH);

    // Top sunlight highlight edge & bottom lap shadow
    ctx.fillStyle = highlightHex;
    ctx.fillRect(0, py, w, 1);
    ctx.fillStyle = shadowHex;
    ctx.fillRect(0, py + plankH - 1, w, 1);

    // Subtle pixel grain dither along plank
    for (let x = 0; x < w; x += 2) {
      const r = pxHash(x, row, seed);
      if (r < 0.22) {
        ctx.fillStyle = shadowHex;
        ctx.fillRect(x, py + 1, 1, 1);
      } else if (r > 0.82) {
        ctx.fillStyle = highlightHex;
        ctx.fillRect(x, py + 2, 1, 1);
      }
    }
  }
}

function drawMultiPaneWindow(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  ww: number,
  wh: number,
  opts: {
    frameHex: string;
    mullionHex: string;
    sillHex: string;
    lintelHex?: string;
    warmLit: boolean;
    shuttersHex?: string;
    flowerbox?: boolean;
    cols?: number;
    rows?: number;
  }
): void {
  // Optional classical lintel above window
  if (opts.lintelHex) {
    ctx.fillStyle = opts.lintelHex;
    ctx.fillRect(wx - 1, wy - 2, ww + 2, 2);
    // Keystone accent
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(wx + Math.floor(ww / 2) - 1, wy - 3, 2, 3);
  }

  // Optional side shutters
  if (opts.shuttersHex) {
    ctx.fillStyle = opts.shuttersHex;
    ctx.fillRect(wx - 3, wy, 3, wh);
    ctx.fillRect(wx + ww, wy, 3, wh);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (let sy = wy + 1; sy < wy + wh - 1; sy += 2) {
      ctx.fillRect(wx - 2, sy, 1, 1);
      ctx.fillRect(wx + ww + 1, sy, 1, 1);
    }
  }

  // Recessed dark outer frame
  ctx.fillStyle = opts.frameHex;
  ctx.fillRect(wx, wy, ww, wh);

  // Glass interior
  const gx = wx + 1;
  const gy = wy + 1;
  const gw = ww - 2;
  const gh = wh - 2;

  if (opts.warmLit) {
    ctx.fillStyle = '#d97706';
    ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = '#fde047';
    ctx.fillRect(gx + 1, gy + 1, Math.max(1, gw - 2), Math.max(1, gh - 3));
    ctx.fillStyle = '#fef9c3';
    ctx.fillRect(gx + 1, gy + 1, Math.max(1, Math.floor(gw * 0.5)), Math.max(1, Math.floor(gh * 0.45)));
  } else {
    ctx.fillStyle = '#0c4a6e';
    ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(gx, gy, Math.max(1, gw - 1), Math.max(1, gh - 1));
    // Crisp diagonal sky reflection pixels
    ctx.fillStyle = '#7dd3fc';
    for (let i = 0; i < Math.min(gw, gh); i++) {
      ctx.fillRect(gx + i, gy + (gh - 1 - i), 1, 1);
      if (i + 1 < gw) {
        ctx.fillRect(gx + i + 1, gy + (gh - 1 - i), 1, 1);
      }
    }
  }

  // Crisp mullions
  const cols = opts.cols ?? 2;
  const rows = opts.rows ?? 3;
  ctx.fillStyle = opts.mullionHex;
  for (let c = 1; c < cols; c++) {
    const mx = gx + Math.round((gw * c) / cols) - 1;
    ctx.fillRect(mx, gy, 1, gh);
  }
  for (let r = 1; r < rows; r++) {
    const my = gy + Math.round((gh * r) / rows) - 1;
    ctx.fillRect(gx, my, gw, 1);
  }

  // Projecting sill + dark underside shadow
  ctx.fillStyle = opts.sillHex;
  ctx.fillRect(wx - 1, wy + wh, ww + 2, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(wx - 1, wy + wh + 2, ww + 2, 1);

  // Optional cottage flowerbox on sill
  if (opts.flowerbox) {
    ctx.fillStyle = '#5c3a21';
    ctx.fillRect(wx, wy + wh, ww, 2);
    ctx.fillStyle = '#15803d';
    ctx.fillRect(wx, wy + wh - 1, ww, 2);
    for (let fx = wx + 1; fx < wx + ww - 1; fx += 3) {
      ctx.fillStyle = fx % 2 === 0 ? '#ef4444' : '#facc15';
      ctx.fillRect(fx, wy + wh - 2, 1, 1);
    }
  }
}

export function createBuildingTextureSet(): BuildingTextureSet {
  const textures: Record<BuildingTextureKey, THREE.CanvasTexture | null> = {
    ashlarStone: makeCanvasTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#2b333e';
      ctx.fillRect(0, 0, w, h);
      const stoneShades = ['#5b6778', '#677487', '#515c6b', '#748296', '#616d7e'];
      const rowH = 8;
      for (let row = 0; row < h / rowH; row++) {
        const py = row * rowH;
        let x = -((row % 3) * 5);
        let col = 0;
        while (x < w) {
          const bw = 11 + Math.floor(pxHash(col, row, 101) * 7);
          const shade = stoneShades[Math.floor(pxHash(col, row, 102) * stoneShades.length)];
          const x0 = Math.max(0, x);
          const x1 = Math.min(w, x + bw - 1);
          if (x1 > x0) {
            ctx.fillStyle = shade;
            ctx.fillRect(x0, py, x1 - x0, rowH - 1);
            // Dressed stone top/left bevel highlight & bottom shadow
            ctx.fillStyle = '#8fa0b5';
            ctx.fillRect(x0, py, x1 - x0, 1);
            ctx.fillRect(x0, py, 1, rowH - 2);
            ctx.fillStyle = '#3e4754';
            ctx.fillRect(x0, py + rowH - 2, x1 - x0, 1);
            // Chisel texture speckles
            for (let sx = x0 + 2; sx < x1 - 1; sx += 3) {
              if (pxHash(sx, py, 103) > 0.58) {
                ctx.fillStyle = '#495463';
                ctx.fillRect(sx, py + 3 + (sx % 3), 1, 1);
              }
            }
          }
          x += bw;
          col++;
        }
      }
    }),

    brickRedPlain: makeCanvasTexture(32, 32, (ctx, w, h) => {
      drawFlemishBrickBackground(
        ctx,
        w,
        h,
        '#c4b9a9',
        ['#9a3424', '#8b2a1c', '#ad3d2b', '#922e20'],
        '#571b13',
        201
      );
    }),

    brickRedWindow: makeCanvasTexture(32, 32, (ctx, w, h) => {
      drawFlemishBrickBackground(
        ctx,
        w,
        h,
        '#c7bcac',
        ['#9e3525', '#8c2b1d', '#b0412f', '#943022'],
        '#5c1d15',
        202
      );
      drawMultiPaneWindow(ctx, 9, 7, 14, 18, {
        frameHex: '#1e293b',
        mullionHex: '#f1f5f9',
        sillHex: '#e5dec9',
        lintelHex: '#dfd7c2',
        warmLit: false,
        cols: 2,
        rows: 3,
      });
    }),

    brickRedWindowLit: makeCanvasTexture(32, 32, (ctx, w, h) => {
      drawFlemishBrickBackground(
        ctx,
        w,
        h,
        '#c7bcac',
        ['#9a3122', '#87271a', '#ab3c2a', '#912d1f'],
        '#571a12',
        203
      );
      drawMultiPaneWindow(ctx, 9, 7, 14, 18, {
        frameHex: '#1e293b',
        mullionHex: '#f8fafc',
        sillHex: '#e5dec9',
        lintelHex: '#dfd7c2',
        warmLit: true,
        cols: 2,
        rows: 3,
      });
    }),

    brickOchreWindow: makeCanvasTexture(32, 32, (ctx, w, h) => {
      drawFlemishBrickBackground(
        ctx,
        w,
        h,
        '#dfd5c3',
        ['#bd782d', '#ad6a23', '#cc8639', '#b47027'],
        '#7c4815',
        204
      );
      drawMultiPaneWindow(ctx, 9, 7, 14, 18, {
        frameHex: '#1f2937',
        mullionHex: '#f8fafc',
        sillHex: '#f1ece1',
        lintelHex: '#ebe4d5',
        warmLit: false,
        cols: 2,
        rows: 3,
      });
    }),

    stuccoCreamWindow: makeCanvasTexture(32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#e5dccb';
      ctx.fillRect(0, 0, w, h);
      // Subtle plaster pixel grain + classical horizontal rustication line
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const r = pxHash(x, y, 205);
          if (r < 0.16) {
            ctx.fillStyle = '#d8ceba';
            ctx.fillRect(x, y, 1, 1);
          } else if (r > 0.86) {
            ctx.fillStyle = '#efe7d8';
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
      ctx.fillStyle = '#c8bda8';
      ctx.fillRect(0, 30, w, 1);
      ctx.fillStyle = '#f5efe2';
      ctx.fillRect(0, 31, w, 1);

      drawMultiPaneWindow(ctx, 10, 7, 12, 18, {
        frameHex: '#27303f',
        mullionHex: '#ffffff',
        sillHex: '#f8f4ec',
        lintelHex: '#cfc4af',
        warmLit: false,
        shuttersHex: '#2a593b',
        cols: 2,
        rows: 3,
      });
    }),

    timberRorosRed: makeCanvasTexture(32, 32, (ctx, w, h) => {
      drawClapboardBackground(ctx, w, h, '#9e2820', '#b5352c', '#731913', 301);
      // Crisp white Nordic outer trim casing
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(8, 7, 16, 17);
      drawMultiPaneWindow(ctx, 10, 9, 12, 13, {
        frameHex: '#334155',
        mullionHex: '#ffffff',
        sillHex: '#ffffff',
        warmLit: true,
        flowerbox: true,
        cols: 2,
        rows: 2,
      });
    }),

    timberBergenOchre: makeCanvasTexture(32, 32, (ctx, w, h) => {
      drawClapboardBackground(ctx, w, h, '#cf8b1d', '#e39e2e', '#9c6510', 302);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(8, 7, 16, 17);
      drawMultiPaneWindow(ctx, 10, 9, 12, 13, {
        frameHex: '#1e293b',
        mullionHex: '#ffffff',
        sillHex: '#ffffff',
        warmLit: false,
        flowerbox: true,
        cols: 2,
        rows: 2,
      });
    }),

    timberCoastalWhite: makeCanvasTexture(32, 32, (ctx, w, h) => {
      drawClapboardBackground(ctx, w, h, '#eef2f6', '#ffffff', '#cbd5e1', 303);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(8, 7, 16, 17);
      drawMultiPaneWindow(ctx, 10, 9, 12, 13, {
        frameHex: '#1e293b',
        mullionHex: '#f8fafc',
        sillHex: '#cbd5e1',
        warmLit: false,
        flowerbox: true,
        cols: 2,
        rows: 2,
      });
    }),

    timberSageGreen: makeCanvasTexture(32, 32, (ctx, w, h) => {
      drawClapboardBackground(ctx, w, h, '#527858', '#658e6b', '#39573e', 304);
      ctx.fillStyle = '#f8f5eb';
      ctx.fillRect(8, 7, 16, 17);
      drawMultiPaneWindow(ctx, 10, 9, 12, 13, {
        frameHex: '#1f2937',
        mullionHex: '#f8f5eb',
        sillHex: '#f8f5eb',
        warmLit: true,
        cols: 2,
        rows: 2,
      });
    }),

    timberBarnRed: makeCanvasTexture(32, 32, (ctx, w, h) => {
      // Vertical board-and-batten classic red farm barn siding
      ctx.fillStyle = '#a82020';
      ctx.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 4) {
        ctx.fillStyle = '#bd2a2a';
        ctx.fillRect(x, 0, 1, h);
        ctx.fillStyle = '#7c1414';
        ctx.fillRect(x + 3, 0, 1, h);
      }
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          if (pxHash(x, y, 305) > 0.78) {
            ctx.fillStyle = '#8f1919';
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
    }),

    shopfrontGround: makeCanvasTexture(64, 32, (ctx, w, h) => {
      // Dressed stone commercial base & pilasters
      ctx.fillStyle = '#475569';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(2, 2, w - 4, h - 4);
      // Dark sign fascia band along top
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(2, 2, w - 4, 5);
      ctx.fillStyle = '#fbbf24';
      for (let sx = 8; sx < w - 10; sx += 4) {
        ctx.fillRect(sx, 4, 2, 2);
      }

      // Left & middle wide display windows with warm lit merchandise
      for (const wx of [5, 25]) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(wx, 9, 16, 17);
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(wx + 1, 10, 14, 15);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(wx + 1, 10, 6, 8);
        // Colorful shop display items on shelf
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(wx + 3, 20, 3, 4);
        ctx.fillStyle = '#16a34a';
        ctx.fillRect(wx + 8, 19, 3, 5);
        ctx.fillStyle = '#2563eb';
        ctx.fillRect(wx + 12, 21, 2, 3);
      }

      // Paneled shop entrance door on right
      ctx.fillStyle = '#451a03';
      ctx.fillRect(46, 9, 12, 21);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(47, 10, 10, 19);
      ctx.fillStyle = '#bae6fd';
      ctx.fillRect(49, 12, 6, 8);
      // Brass doorknob
      ctx.fillStyle = '#facc15';
      ctx.fillRect(55, 21, 1, 2);
    }),

    awningStripedRed: makeCanvasTexture(32, 32, (ctx, w, h) => {
      for (let x = 0; x < w; x += 4) {
        ctx.fillStyle = (x / 4) % 2 === 0 ? '#dc2626' : '#f8fafc';
        ctx.fillRect(x, 0, 4, h);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, h - 4, w, 4);
    }),

    awningStripedBlue: makeCanvasTexture(32, 32, (ctx, w, h) => {
      for (let x = 0; x < w; x += 4) {
        ctx.fillStyle = (x / 4) % 2 === 0 ? '#1d4ed8' : '#f8fafc';
        ctx.fillRect(x, 0, 4, h);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, h - 4, w, 4);
    }),

    awningStripedGreen: makeCanvasTexture(32, 32, (ctx, w, h) => {
      for (let x = 0; x < w; x += 4) {
        ctx.fillStyle = (x / 4) % 2 === 0 ? '#15803d' : '#fef9c3';
        ctx.fillRect(x, 0, 4, h);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, h - 4, w, 4);
    }),

    officeConcreteGrid: makeCanvasTexture(32, 32, (ctx, w, h) => {
      // Precast concrete spandrel & vertical fins (classic 1970s OpenTTD office block)
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(0, 0, w, 6);
      ctx.fillRect(0, 27, w, 5);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(0, 6, w, 1);
      ctx.fillRect(0, 0, 2, h);
      ctx.fillRect(w - 2, 0, 2, h);
      ctx.fillRect(15, 6, 2, 21);

      // Left & right office windows
      for (const [wx, lit] of [
        [4, false],
        [18, true],
      ] as Array<[number, boolean]>) {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(wx, 8, 10, 17);
        if (lit) {
          ctx.fillStyle = '#fde68a';
          ctx.fillRect(wx + 1, 9, 8, 15);
          // Venetian blind slats
          ctx.fillStyle = '#d97706';
          for (let by = 10; by < 17; by += 2) {
            ctx.fillRect(wx + 1, by, 8, 1);
          }
        } else {
          ctx.fillStyle = '#0369a1';
          ctx.fillRect(wx + 1, 9, 8, 15);
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(wx + 2, 10, 4, 6);
          ctx.fillStyle = '#7dd3fc';
          ctx.fillRect(wx + 2, 10, 2, 3);
        }
        // Horizontal transom bar
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(wx + 1, 14, 8, 1);
      }
    }),

    curtainWallBlue: makeCanvasTexture(32, 32, (ctx, w, h) => {
      // Sleek aluminum-and-cyan reflective skyscraper glass grid
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);
      // Dark blue glass spandrel band
      ctx.fillStyle = '#0c4a6e';
      ctx.fillRect(1, 1, w - 2, 6);

      for (const gx of [2, 17]) {
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(gx, 8, 13, 22);
        // Diagonal sky reflection band
        ctx.fillStyle = '#38bdf8';
        for (let d = 0; d < 12; d++) {
          ctx.fillRect(gx + d, 9 + d, 2, 4);
        }
        ctx.fillStyle = '#bae6fd';
        for (let d = 0; d < 8; d++) {
          ctx.fillRect(gx + 1 + d, 10 + d, 1, 2);
        }
      }

      // Crisp silver aluminum mullions & transoms
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(0, 0, 1, h);
      ctx.fillRect(15, 0, 2, h);
      ctx.fillRect(31, 0, 1, h);
      ctx.fillRect(0, 7, w, 1);
      ctx.fillRect(0, 30, w, 2);
    }),

    curtainWallGold: makeCanvasTexture(32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#291505';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(1, 1, w - 2, 6);

      for (const gx of [2, 17]) {
        ctx.fillStyle = '#b45309';
        ctx.fillRect(gx, 8, 13, 22);
        ctx.fillStyle = '#f59e0b';
        for (let d = 0; d < 11; d++) {
          ctx.fillRect(gx + d, 9 + d, 2, 4);
        }
        ctx.fillStyle = '#fef08a';
        for (let d = 0; d < 7; d++) {
          ctx.fillRect(gx + 1 + d, 10 + d, 1, 2);
        }
      }

      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(0, 0, 1, h);
      ctx.fillRect(15, 0, 2, h);
      ctx.fillRect(31, 0, 1, h);
      ctx.fillRect(0, 7, w, 1);
      ctx.fillRect(0, 30, w, 2);
    }),

    apartmentModern: makeCanvasTexture(32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(0, 0, w, h);
      // Warm brick/terracotta accent band
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(0, 26, w, 6);
      // Sliding glass balcony door + side window
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(4, 5, 13, 21);
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(5, 6, 5, 19);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(11, 6, 5, 19);

      drawMultiPaneWindow(ctx, 20, 6, 8, 11, {
        frameHex: '#1e293b',
        mullionHex: '#f8fafc',
        sillHex: '#cbd5e1',
        warmLit: true,
        cols: 1,
        rows: 2,
      });
    }),

    factoryBrickArched: makeCanvasTexture(32, 32, (ctx, w, h) => {
      drawFlemishBrickBackground(
        ctx,
        w,
        h,
        '#8c7e70',
        ['#7c2d12', '#6b240e', '#8c3518', '#5c1f0c'],
        '#3b1307',
        401
      );
      // Tall arched cast-iron multi-pane factory window
      ctx.fillStyle = '#44403c';
      ctx.fillRect(7, 6, 18, 22);
      ctx.fillStyle = '#18181b';
      ctx.fillRect(8, 7, 16, 20);
      // Segmental brick arch header
      ctx.fillStyle = '#a8a29e';
      ctx.fillRect(8, 5, 16, 2);
      ctx.fillRect(10, 4, 12, 1);

      // Industrial glow + dusty blue factory panes
      ctx.fillStyle = '#0369a1';
      ctx.fillRect(9, 8, 14, 18);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(9, 17, 14, 9);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(10, 9, 5, 6);

      // Cast-iron 3x3 grid muntins
      ctx.fillStyle = '#18181b';
      ctx.fillRect(13, 8, 1, 18);
      ctx.fillRect(18, 8, 1, 18);
      ctx.fillRect(9, 13, 14, 1);
      ctx.fillRect(9, 19, 14, 1);

      // Heavy stone sill
      ctx.fillStyle = '#a8a29e';
      ctx.fillRect(6, 27, 20, 2);
    }),

    corrugatedSteel: makeCanvasTexture(32, 32, (ctx, w, h) => {
      for (let x = 0; x < w; x += 4) {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(x, 0, 1, h);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(x + 1, 0, 1, h);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(x + 2, 0, 1, h);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(x + 3, 0, 1, h);
      }
      // Horizontal sheet overlap seam + rivets
      ctx.fillStyle = '#475569';
      ctx.fillRect(0, 15, w, 1);
      ctx.fillStyle = '#f8fafc';
      for (let x = 1; x < w; x += 4) {
        ctx.fillRect(x, 14, 1, 1);
        ctx.fillRect(x, 30, 1, 1);
      }
    }),

    siloGalvanized: makeCanvasTexture(32, 32, (ctx, w, h) => {
      for (let y = 0; y < h; y += 4) {
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(0, y, w, 1);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(0, y + 1, w, 1);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(0, y + 2, w, 1);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(0, y + 3, w, 1);
      }
      // Vertical bolted stiffener ribs
      for (const rx of [7, 23]) {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(rx, 0, 2, h);
        ctx.fillStyle = '#475569';
        for (let y = 1; y < h; y += 4) {
          ctx.fillRect(rx, y, 1, 1);
        }
      }
    }),

    roofTerracotta: makeCanvasTexture(32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#7c2d12';
      ctx.fillRect(0, 0, w, h);
      const rowH = 4;
      for (let row = 0; row < h / rowH; row++) {
        const py = row * rowH;
        const shift = (row % 2) * 2;
        for (let x = -shift; x < w; x += 4) {
          const r = pxHash(x, row, 501);
          ctx.fillStyle = r > 0.5 ? '#c2410c' : '#b43b0a';
          ctx.fillRect(Math.max(0, x), py, 3, 3);
          ctx.fillStyle = '#ea580c';
          ctx.fillRect(Math.max(0, x + 1), py, 1, 2);
          ctx.fillStyle = '#5c1d0c';
          ctx.fillRect(Math.max(0, x), py + 3, 4, 1);
        }
      }
    }),

    roofSlate: makeCanvasTexture(32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);
      const rowH = 4;
      for (let row = 0; row < h / rowH; row++) {
        const py = row * rowH;
        const shift = (row % 2) * 3;
        for (let x = -shift; x < w; x += 6) {
          const r = pxHash(x, row, 502);
          ctx.fillStyle = r > 0.6 ? '#334155' : r > 0.25 ? '#283548' : '#1e293b';
          const x0 = Math.max(0, x);
          const x1 = Math.min(w, x + 5);
          if (x1 > x0) {
            ctx.fillRect(x0, py, x1 - x0, 3);
            ctx.fillStyle = '#475569';
            ctx.fillRect(x0, py, x1 - x0, 1);
          }
        }
      }
    }),

    roofCorrugatedDark: makeCanvasTexture(32, 32, (ctx, w, h) => {
      for (let x = 0; x < w; x += 4) {
        ctx.fillStyle = '#475569';
        ctx.fillRect(x, 0, 1, h);
        ctx.fillStyle = '#334155';
        ctx.fillRect(x + 1, 0, 2, h);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x + 3, 0, 1, h);
      }
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 15, w, 1);
    }),

    platformPaving: makeCanvasTexture(32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) {
        ctx.fillStyle = '#64748b';
        ctx.fillRect(0, y, w, 1);
        for (let x = (y % 16 === 0 ? 0 : 4); x < w; x += 8) {
          ctx.fillStyle = '#64748b';
          ctx.fillRect(x, y, 1, 8);
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect((x + 1) % w, y + 1, 6, 1);
        }
      }
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          if (pxHash(x, y, 601) > 0.72) {
            ctx.fillStyle = '#7c8b9e';
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
    }),

    coalHeap: makeCanvasTexture(32, 32, (ctx, w, h) => {
      const shades = ['#09090b', '#18181b', '#27272a', '#121316', '#3f3f46'];
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const r = pxHash(x, y, 701);
          ctx.fillStyle = shades[Math.floor(r * shades.length) % shades.length];
          ctx.fillRect(x, y, 2, 2);
          if (r > 0.86) {
            // Anthracite specular facet glint
            ctx.fillStyle = '#52525b';
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
    }),
  };

  return {
    textures,
    dispose(): void {
      for (const key of Object.keys(textures) as BuildingTextureKey[]) {
        textures[key]?.dispose();
        textures[key] = null;
      }
    },
  };
}
