import * as THREE from 'three';

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) || 0;
    const g = parseInt(clean[1] + clean[1], 16) || 0;
    const b = parseInt(clean[2] + clean[2], 16) || 0;
    return [r, g, b];
  }
  const num = parseInt(clean.slice(0, 6), 16);
  if (Number.isNaN(num)) return [128, 128, 128];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function shadeHex(hex: string, factor: number): string {
  const [r, g, b] = parseHexRgb(hex);
  const nr = clampByte(r * factor);
  const ng = clampByte(g * factor);
  const nb = clampByte(b * factor);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb
    .toString(16)
    .padStart(2, '0')}`;
}

export function tintHex(hex: string, targetHex: string, mix: number): string {
  const [r1, g1, b1] = parseHexRgb(hex);
  const [r2, g2, b2] = parseHexRgb(targetHex);
  const nr = clampByte(r1 + (r2 - r1) * mix);
  const ng = clampByte(g1 + (g2 - g1) * mix);
  const nb = clampByte(b1 + (b2 - b1) * mix);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb
    .toString(16)
    .padStart(2, '0')}`;
}

function createPixelCanvas(
  width: number,
  height: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
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
  return { canvas, ctx };
}

function finalizePixelTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function mirrorCanvasHorizontal(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const pair = createPixelCanvas(src.width, src.height);
  if (!pair) return null;
  const { canvas, ctx } = pair;
  ctx.save();
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  return canvas;
}

function drawPixelWindow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  warmInterior: boolean
): void {
  // Outer dark gasket frame
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(x, y, w, h);

  // Inner glass pane
  if (warmInterior) {
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    // Upper sky reflection band + warm lower cabin glow
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(x + 1, y + 1, w - 2, Math.max(2, Math.floor((h - 2) * 0.38)));
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(x + 1, y + h - 3, w - 2, 2);
    // Seat headrest silhouette pixel
    if (w >= 6 && h >= 7) {
      ctx.fillStyle = '#334155';
      ctx.fillRect(x + 2, y + h - 3, 2, 2);
      if (w >= 9) {
        ctx.fillRect(x + w - 4, y + h - 3, 2, 2);
      }
    }
  } else {
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(x + 1, y + 1, Math.max(2, w - 3), 2);
  }

  // Crisp OpenGFX diagonal white specular pixel glint
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(x + 2, y + 2, 2, 1);
  if (h >= 6) {
    ctx.fillRect(x + 1, y + 3, 1, 1);
  }
}

function drawPostalHorn(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.fillStyle = '#fde047';
  // Loop of the horn
  ctx.fillRect(cx - 3, cy - 2, 6, 5);
  ctx.fillStyle = '#b91c1c';
  ctx.fillRect(cx - 1, cy - 1, 2, 3);
  // Bell & mouthpiece
  ctx.fillStyle = '#fde047';
  ctx.fillRect(cx - 6, cy - 3, 3, 2);
  ctx.fillRect(cx + 3, cy - 3, 3, 3);
  ctx.fillRect(cx - 2, cy + 3, 4, 1);
}

export interface AsymmetricSideTextures {
  right: THREE.CanvasTexture | null;
  left: THREE.CanvasTexture | null;
}

/**
 * Procedural OpenGFX pixel-art `CanvasTexture` generator & cache for all locomotives,
 * passenger/mail/reefer/container wagons, city buses, and European cab-over trucks.
 * Guarded for headless Node (`tsx`) execution where `document` is undefined.
 */
export class VehicleTexturesManager {
  private readonly cache = new Map<string, THREE.CanvasTexture>();

  private getOrCreate(
    key: string,
    builder: () => HTMLCanvasElement | null
  ): THREE.CanvasTexture | null {
    const existing = this.cache.get(key);
    if (existing) return existing;
    const canvas = builder();
    if (!canvas) return null;
    const tex = finalizePixelTexture(canvas);
    this.cache.set(key, tex);
    return tex;
  }

  /**
   * NSB Di 3 Nohab Bulldog Diesel side livery:
   * Company color body, classic cream/amber cheatlines, hazard corner chevrons,
   * 4 iconic round engine-room porthole windows, 3 recessed cooling louvre grilles,
   * and cab side doors with chrome handrails.
   */
  public getDieselSideTexture(ownerColor: string): THREE.CanvasTexture | null {
    return this.getOrCreate(`diesel-side:${ownerColor}`, () => {
      const pair = createPixelCanvas(96, 32);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      const base = ownerColor;
      const hi = shadeHex(ownerColor, 1.2);
      const midDark = shadeHex(ownerColor, 0.82);
      const deep = shadeHex(ownerColor, 0.62);

      // Main body coat with OpenGFX horizontal bevel shading
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 96, 32);
      ctx.fillStyle = hi;
      ctx.fillRect(0, 0, 96, 3);
      ctx.fillStyle = midDark;
      ctx.fillRect(0, 23, 96, 5);

      // Dark riveted underframe solebar skirt + yellow/black warning chevrons at ends
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 28, 96, 4);
      for (const startX of [0, 84]) {
        for (let i = 0; i < 12; i += 4) {
          ctx.fillStyle = '#facc15';
          ctx.fillRect(startX + i, 28, 2, 4);
          ctx.fillStyle = '#09090b';
          ctx.fillRect(startX + i + 2, 28, 2, 4);
        }
      }

      // Classic Nohab cream & amber winged cheatline
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(0, 17, 96, 5);
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(0, 18, 96, 3);
      // Upper thin gold pin-stripe
      ctx.fillStyle = '#fde68a';
      ctx.fillRect(0, 4, 96, 1);

      // Vertical panel seams & rivets
      ctx.fillStyle = deep;
      for (const sx of [16, 34, 48, 62, 80]) {
        ctx.fillRect(sx, 3, 1, 25);
      }

      // Cab doors near both ends (symmetric double-cab)
      for (const doorX of [5, 83]) {
        ctx.fillStyle = deep;
        ctx.fillRect(doorX, 5, 8, 21);
        ctx.fillStyle = base;
        ctx.fillRect(doorX + 1, 6, 6, 19);
        // Re-apply stripe across door
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(doorX + 1, 18, 6, 3);
        // Cab door window
        drawPixelWindow(ctx, doorX + 1, 7, 6, 7, false);
        // Chrome vertical grab handrails on both sides of cab door
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(doorX - 1, 8, 1, 17);
        ctx.fillRect(doorX + 8, 8, 1, 17);
        // Footstep recess
        ctx.fillStyle = '#09090b';
        ctx.fillRect(doorX + 2, 28, 4, 3);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(doorX + 2, 30, 4, 1);
      }

      // 3 Recessed engine cooling louvre grilles
      for (const gx of [19, 43, 67]) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(gx, 6, 10, 9);
        ctx.fillStyle = '#475569';
        for (let ly = 7; ly <= 13; ly += 2) {
          ctx.fillRect(gx + 1, ly, 8, 1);
        }
      }

      // 4 Iconic round Nohab engine-room porthole windows!
      for (const px of [31, 55, 36, 60]) {
        // Wait: space 4 portholes evenly between grilles/doors at x = 15, 33, 57, 79 -> let's place at 32, 40? Even cleaner:
        void px;
      }
      for (const cx of [33, 40, 56, 63]) {
        // Aluminium outer porthole ring
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(cx - 2, 8, 5, 5);
        ctx.fillRect(cx - 3, 9, 7, 3);
        // Dark rubber seal + deep glass
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(cx - 2, 9, 5, 3);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(cx - 1, 9, 3, 2);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(cx - 1, 9, 1, 1);
      }

      // Center NSB / Company number plaque
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(44, 23, 8, 4);
      ctx.fillStyle = '#fde047';
      ctx.fillRect(45, 24, 6, 2);

      return canvas;
    });
  }

  /**
   * NSB El 18 Express Electric side livery:
   * Sleek silver/anthracite/ownerColor diagonal express livery, flush cab windows,
   * fluted stainless/slate cooling louvres, cab doors with handrails & HV warning badge.
   */
  public getElectricSideTexture(ownerColor: string): THREE.CanvasTexture | null {
    return this.getOrCreate(`electric-side:${ownerColor}`, () => {
      const pair = createPixelCanvas(96, 32);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      const base = ownerColor;
      const hi = shadeHex(ownerColor, 1.22);
      const dark = shadeHex(ownerColor, 0.72);

      // Upper silver-white band + main company livery + dark anthracite lower skirt
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, 0, 96, 6);
      ctx.fillStyle = base;
      ctx.fillRect(0, 6, 96, 19);
      ctx.fillStyle = hi;
      ctx.fillRect(0, 6, 96, 2);
      ctx.fillStyle = dark;
      ctx.fillRect(0, 22, 96, 3);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 25, 96, 7);

      // Crisp silver & anthracite speed cheatlines
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(0, 19, 96, 2);
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, 21, 96, 1);

      // Diagonal aerodynamic speed-slashes near both ends
      ctx.fillStyle = '#f8fafc';
      for (let s = 0; s < 6; s++) {
        ctx.fillRect(14 + s, 18 - s * 2, 3, 2);
        ctx.fillRect(79 - s, 18 - s * 2, 3, 2);
      }

      // Fluted metallic side corrugation ribs in center equipment zone
      for (let y = 8; y <= 16; y += 2) {
        ctx.fillStyle = shadeHex(ownerColor, 0.86);
        ctx.fillRect(24, y, 48, 1);
      }

      // 3 High-tech cooling louvre vents along upper equipment bay
      for (const gx of [26, 43, 60]) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(gx, 3, 10, 6);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(gx + 1, 4, 8, 1);
        ctx.fillRect(gx + 1, 6, 8, 1);
        ctx.fillRect(gx + 1, 8, 8, 1);
      }

      // Flush cab side windows + cab access doors at both ends
      for (const isLeftEnd of [true, false]) {
        const winX = isLeftEnd ? 2 : 85;
        const doorX = isLeftEnd ? 12 : 77;
        drawPixelWindow(ctx, winX, 5, 9, 8, false);

        ctx.fillStyle = dark;
        ctx.fillRect(doorX, 6, 6, 19);
        ctx.fillStyle = base;
        ctx.fillRect(doorX + 1, 7, 4, 17);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(doorX + 1, 19, 4, 2);
        drawPixelWindow(ctx, doorX + 1, 8, 4, 5, false);
        // Stainless grab rails
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(doorX, 10, 1, 13);
        ctx.fillRect(doorX + 5, 10, 1, 13);
      }

      // High-voltage yellow warning badge & silver bogie step plates
      ctx.fillStyle = '#facc15';
      ctx.fillRect(46, 12, 4, 4);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(47, 13, 2, 2);

      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(13, 28, 4, 2);
      ctx.fillRect(78, 28, 4, 2);

      return canvas;
    });
  }

  /**
   * InterCity Passenger Coach side texture:
   * 7 dark-framed passenger windows with warm interior lighting, cream window band,
   * company-colored lower skirt & upper cantrail, and recessed end vestibule doors.
   */
  public getPassengerCoachSideTexture(ownerColor: string): THREE.CanvasTexture | null {
    return this.getOrCreate(`pax-coach:${ownerColor}`, () => {
      const pair = createPixelCanvas(96, 32);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      const base = ownerColor;
      const dark = shadeHex(ownerColor, 0.72);

      // Header strip (ownerColor), cream window band, lower ownerColor skirt, anthracite solebar
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 96, 5);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 5, 96, 12);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(0, 16, 96, 1);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(0, 17, 96, 2);
      ctx.fillStyle = base;
      ctx.fillRect(0, 19, 96, 9);
      ctx.fillStyle = dark;
      ctx.fillRect(0, 26, 96, 2);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 28, 96, 4);

      // End vestibule boarding doors (left & right ends)
      for (const dx of [3, 86]) {
        ctx.fillStyle = '#334155';
        ctx.fillRect(dx, 5, 7, 23);
        ctx.fillStyle = shadeHex(ownerColor, 0.9);
        ctx.fillRect(dx + 1, 6, 5, 21);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(dx + 1, 17, 5, 2);
        drawPixelWindow(ctx, dx + 1, 7, 5, 8, true);
        // Step plate & handrail
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(dx + 1, 29, 5, 2);
      }

      // 7 panoramic dark-framed passenger windows with warm cabin light
      for (let i = 0; i < 7; i++) {
        const wx = 13 + i * 10;
        drawPixelWindow(ctx, wx, 6, 8, 9, true);
      }

      // Class number "1 / 2" badge near doors
      ctx.fillStyle = '#fde047';
      ctx.fillRect(11, 19, 2, 3);
      ctx.fillRect(83, 19, 2, 3);

      return canvas;
    });
  }

  /**
   * Express Mail Van (Posten crimson red with golden-yellow stripe, postal horn emblem,
   * high clerestory security windows, and twin recessed sliding mail doors).
   */
  public getMailVanSideTexture(): THREE.CanvasTexture | null {
    return this.getOrCreate('mail-van-side', () => {
      const pair = createPixelCanvas(88, 32);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      // Posten crimson red body
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(0, 0, 88, 28);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(0, 0, 88, 3);
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(0, 25, 88, 3);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 28, 88, 4);

      // Classic Posten golden-yellow stripe
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(0, 17, 88, 4);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(0, 18, 88, 1);

      // Vertical body panel seams
      ctx.fillStyle = '#7f1d1d';
      for (const sx of [10, 34, 54, 78]) {
        ctx.fillRect(sx, 3, 1, 24);
      }

      // 2 Wide sliding mail-bay doors
      for (const mx of [15, 57]) {
        // Sliding rail track header & threshold
        ctx.fillStyle = '#475569';
        ctx.fillRect(mx - 1, 4, 16, 2);
        ctx.fillRect(mx - 1, 25, 16, 2);
        // Recessed door frame
        ctx.fillStyle = '#7f1d1d';
        ctx.fillRect(mx, 6, 14, 19);
        ctx.fillStyle = '#991b1b';
        ctx.fillRect(mx + 1, 7, 12, 17);
        // Stripe continues across door
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(mx + 1, 17, 12, 4);
        // Small barred mail security window
        drawPixelWindow(ctx, mx + 4, 8, 6, 6, false);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(mx + 6, 9, 1, 4);
        // Steel door latch handle
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(mx + 11, 14, 2, 3);
      }

      // High clerestory security windows near ends
      drawPixelWindow(ctx, 3, 7, 5, 5, false);
      drawPixelWindow(ctx, 80, 7, 5, 5, false);

      // Center Golden Postal Horn Emblem!
      drawPostalHorn(ctx, 44, 11);

      return canvas;
    });
  }

  /**
   * Corrugated 20ft ISO shipping container side texture (vertical ribs, corner twist-lock castings,
   * logistics stencil codes & hazard diamond).
   */
  public getContainerSideTexture(baseHex: string): THREE.CanvasTexture | null {
    return this.getOrCreate(`iso-side:${baseHex}`, () => {
      const pair = createPixelCanvas(64, 32);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      const hi = shadeHex(baseHex, 1.18);
      const lo = shadeHex(baseHex, 0.76);
      const frame = shadeHex(baseHex, 0.88);

      ctx.fillStyle = baseHex;
      ctx.fillRect(0, 0, 64, 32);

      // Corrugated vertical steel ribs across container body
      for (let x = 4; x < 60; x += 3) {
        ctx.fillStyle = hi;
        ctx.fillRect(x, 3, 1, 26);
        ctx.fillStyle = baseHex;
        ctx.fillRect(x + 1, 3, 1, 26);
        ctx.fillStyle = lo;
        ctx.fillRect(x + 2, 3, 1, 26);
      }

      // Top & bottom longitudinal structural rails + end posts
      ctx.fillStyle = frame;
      ctx.fillRect(0, 0, 64, 3);
      ctx.fillRect(0, 29, 64, 3);
      ctx.fillRect(0, 0, 4, 32);
      ctx.fillRect(60, 0, 4, 32);

      // 4 Grey steel ISO corner twist-lock castings with keyhole slots
      for (const [cx, cy] of [
        [0, 0],
        [60, 0],
        [0, 28],
        [60, 28],
      ]) {
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(cx, cy, 4, 4);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(cx + 1, cy + 1, 2, 2);
      }

      // Crisp white OpenTTD freight logo block & container serial stencil
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(9, 8, 18, 5);
      ctx.fillStyle = lo;
      ctx.fillRect(10, 9, 3, 3);
      ctx.fillRect(15, 9, 4, 3);
      ctx.fillRect(21, 9, 5, 3);

      // Data plate & yellow/white markings on right upper quadrant
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(44, 7, 10, 2);
      ctx.fillRect(44, 10, 7, 1);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(45, 13, 4, 4);

      return canvas;
    });
  }

  /**
   * ISO shipping container end-door texture with rubber gaskets & 4 vertical galvanized locking rods.
   */
  public getContainerEndTexture(baseHex: string): THREE.CanvasTexture | null {
    return this.getOrCreate(`iso-end:${baseHex}`, () => {
      const pair = createPixelCanvas(32, 32);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      const dark = shadeHex(baseHex, 0.72);
      ctx.fillStyle = dark;
      ctx.fillRect(0, 0, 32, 32);

      // Left & right recessed double door leaves with black rubber gaskets
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(2, 2, 28, 28);
      ctx.fillStyle = baseHex;
      ctx.fillRect(3, 3, 12, 26);
      ctx.fillRect(17, 3, 12, 26);

      // 4 Vertical galvanized steel locking bars + cam handles
      ctx.fillStyle = '#e2e8f0';
      for (const rx of [6, 11, 20, 25]) {
        ctx.fillRect(rx, 2, 1, 28);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(rx - 1, 18, 3, 2);
        ctx.fillStyle = '#e2e8f0';
      }

      // ISO corner castings
      for (const [cx, cy] of [
        [0, 0],
        [29, 0],
        [0, 29],
        [29, 29],
      ]) {
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(cx, cy, 3, 3);
      }

      return canvas;
    });
  }

  /**
   * Insulated Refrigerated Reefer side texture (Arctic white panels, dual ice-blue hygiene stripes,
   * central latched plug door with locking rods, and cold-chain snowflake emblem).
   */
  public getReeferSideTexture(): THREE.CanvasTexture | null {
    return this.getOrCreate('reefer-side', () => {
      const pair = createPixelCanvas(88, 32);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      // Crisp Arctic white insulated body
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, 88, 29);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 88, 3);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(0, 26, 88, 3);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 29, 88, 3);

      // Vertical insulated sandwich-panel seams
      ctx.fillStyle = '#e2e8f0';
      for (let x = 11; x < 84; x += 11) {
        ctx.fillRect(x, 3, 1, 23);
      }

      // Dual Ice-Blue & Deep Navy hygiene stripe
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(0, 17, 88, 4);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(0, 17, 88, 1);
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(0, 21, 88, 2);

      // Central insulated plug door (x = 36..52)
      ctx.fillStyle = '#334155';
      ctx.fillRect(36, 4, 16, 23);
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(37, 5, 14, 21);
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(37, 17, 14, 4);
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(37, 21, 14, 2);
      // Plug door vertical galvanized locking bars & latch lever
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(40, 5, 1, 21);
      ctx.fillRect(47, 5, 1, 21);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(43, 14, 3, 2);

      // Pixel-art blue cold-chain snowflake emblem on left panel
      const sx = 18;
      const sy = 10;
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(sx - 4, sy, 9, 1);
      ctx.fillRect(sx, sy - 4, 1, 9);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(sx - 2, sy - 2, 5, 5);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(sx - 1, sy - 1, 3, 3);
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(sx, sy, 1, 1);

      // Digital temperature display panel near cooling unit end
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(6, 7, 5, 6);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(7, 8, 3, 2);

      return canvas;
    });
  }

  /**
   * City Bus asymmetric side textures (`x=0` corresponds to `+Z` front on `+X` right curbside;
   * left side has driver window + continuous passenger windows & rear radiator louvre).
   */
  public getBusSideTextures(ownerColor: string): AsymmetricSideTextures {
    const right = this.getOrCreate(`bus-side-R:${ownerColor}`, () => {
      const pair = createPixelCanvas(88, 32);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      const base = ownerColor;
      const dark = shadeHex(ownerColor, 0.74);

      // Roof cantrail (ownerColor) + cream window band + lower ownerColor skirt + dark sill
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 88, 4);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 4, 88, 13);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(0, 17, 88, 2);
      ctx.fillStyle = base;
      ctx.fillRect(0, 19, 88, 10);
      ctx.fillStyle = dark;
      ctx.fillRect(0, 27, 88, 2);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 29, 88, 3);

      // Front twin-leaf folding boarding door (near front x = 4..13)
      for (const doorX of [4, 42]) {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(doorX, 5, 9, 24);
        // Twin folding door leaves
        drawPixelWindow(ctx, doorX + 1, 6, 3, 12, true);
        drawPixelWindow(ctx, doorX + 5, 6, 3, 12, true);
        ctx.fillStyle = '#334155';
        ctx.fillRect(doorX + 1, 19, 3, 8);
        ctx.fillStyle = '#475569';
        ctx.fillRect(doorX + 5, 19, 3, 8);
        // Lower glass kick-windows
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(doorX + 2, 20, 1, 5);
        ctx.fillRect(doorX + 6, 20, 1, 5);
      }

      // Individual dark-framed passenger windows between & behind doors
      for (const wx of [15, 24, 33, 53, 62, 71, 79]) {
        const w = wx === 79 ? 7 : 8;
        drawPixelWindow(ctx, wx, 5, w, 10, true);
      }

      // Underfloor luggage bay seams & amber side marker reflectors
      ctx.fillStyle = dark;
      for (const lx of [22, 32, 62, 74]) {
        ctx.fillRect(lx, 20, 1, 8);
      }
      ctx.fillStyle = '#f59e0b';
      for (const mx of [16, 38, 60, 82]) {
        ctx.fillRect(mx, 26, 2, 1);
      }

      return canvas;
    });

    const left = this.getOrCreate(`bus-side-L:${ownerColor}`, () => {
      // Note: On BoxGeometry `-X` face, `u=0` is REAR (`-Z`) and `u=1` is FRONT (`+Z`)!
      // So we draw with `x = 88` at FRONT (`+Z`) by mirroring a front-at-0 driver-side canvas!
      const pair = createPixelCanvas(88, 32);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      const base = ownerColor;
      const dark = shadeHex(ownerColor, 0.74);

      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 88, 4);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 4, 88, 13);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(0, 17, 88, 2);
      ctx.fillStyle = base;
      ctx.fillRect(0, 19, 88, 10);
      ctx.fillStyle = dark;
      ctx.fillRect(0, 27, 88, 2);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 29, 88, 3);

      // Driver sliding cab window at front (`x = 3..12`) + 7 continuous panoramic windows
      drawPixelWindow(ctx, 3, 5, 9, 10, false);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(7, 5, 1, 10); // sliding divider

      for (let i = 0; i < 7; i++) {
        drawPixelWindow(ctx, 14 + i * 10, 5, 9, 10, true);
      }

      // Rear engine radiator intake grille (`x = 74..84`)
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(74, 20, 10, 7);
      ctx.fillStyle = '#475569';
      for (let gy = 21; gy <= 25; gy += 2) {
        ctx.fillRect(75, gy, 8, 1);
      }

      // Luggage seams & amber markers
      ctx.fillStyle = dark;
      for (const lx of [22, 36, 50, 64]) {
        ctx.fillRect(lx, 20, 1, 8);
      }
      ctx.fillStyle = '#f59e0b';
      for (const mx of [14, 38, 62, 84]) {
        ctx.fillRect(mx, 26, 2, 1);
      }

      return mirrorCanvasHorizontal(canvas);
    });

    return { right, left };
  }

  /**
   * City Bus front face (`+Z`):
   * Illuminated `RUTE` destination blind, wide wraparound windshield with wipers,
   * silver radiator grille, and company color nose panel.
   */
  public getBusFrontTexture(ownerColor: string): THREE.CanvasTexture | null {
    return this.getOrCreate(`bus-front:${ownerColor}`, () => {
      const pair = createPixelCanvas(40, 36);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      const base = ownerColor;
      const dark = shadeHex(ownerColor, 0.74);

      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 40, 36);

      // Top illuminated destination blind housing (`RUTE`)
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(3, 2, 34, 6);
      ctx.fillStyle = '#fde047';
      // Pixel letters for "RUTE 1"
      // R
      ctx.fillRect(7, 3, 3, 4);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(8, 4, 1, 1);
      ctx.fillRect(8, 6, 1, 1);
      // U
      ctx.fillStyle = '#fde047';
      ctx.fillRect(12, 3, 1, 4);
      ctx.fillRect(14, 3, 1, 4);
      ctx.fillRect(12, 6, 3, 1);
      // T
      ctx.fillRect(17, 3, 3, 1);
      ctx.fillRect(18, 3, 1, 4);
      // E
      ctx.fillRect(22, 3, 3, 1);
      ctx.fillRect(22, 5, 2, 1);
      ctx.fillRect(22, 6, 3, 1);
      ctx.fillRect(22, 3, 1, 4);
      // Route number "12"
      ctx.fillStyle = '#fb923c';
      ctx.fillRect(28, 3, 1, 4);
      ctx.fillRect(31, 3, 3, 1);
      ctx.fillRect(31, 5, 3, 2);

      // Wraparound panoramic windshield
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(2, 9, 36, 13);
      ctx.fillStyle = '#1e3a5f';
      ctx.fillRect(3, 10, 34, 11);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(3, 10, 34, 4);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(5, 11, 6, 1);
      ctx.fillRect(4, 12, 4, 1);
      // Twin windshield wipers
      ctx.fillStyle = '#09090b';
      ctx.fillRect(8, 19, 9, 1);
      ctx.fillRect(22, 19, 9, 1);

      // Cream trim band + chrome radiator grille
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 22, 40, 2);
      ctx.fillStyle = dark;
      ctx.fillRect(0, 31, 40, 5);

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(11, 25, 18, 6);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(12, 26, 16, 1);
      ctx.fillRect(12, 28, 16, 1);
      ctx.fillRect(12, 30, 16, 1);

      // White/yellow license plate
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(16, 33, 8, 2);

      return canvas;
    });
  }

  /**
   * European Cab-Over-Engine Truck cab front (`+Z`) and side (`+X` / `-X`) textures.
   */
  public getTruckCabFrontTexture(ownerColor: string): THREE.CanvasTexture | null {
    return this.getOrCreate(`truck-front:${ownerColor}`, () => {
      const pair = createPixelCanvas(40, 40);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      const base = ownerColor;
      const hi = shadeHex(ownerColor, 1.18);
      const dark = shadeHex(ownerColor, 0.72);

      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 40, 40);
      ctx.fillStyle = hi;
      ctx.fillRect(0, 0, 40, 4);

      // Dark tinted wraparound windshield
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(3, 6, 34, 13);
      ctx.fillStyle = '#1e3a5f';
      ctx.fillRect(4, 7, 32, 11);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(4, 7, 32, 3);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(6, 8, 5, 1);
      // Wipers & grab bar below glass
      ctx.fillStyle = '#09090b';
      ctx.fillRect(7, 17, 10, 1);
      ctx.fillRect(22, 17, 10, 1);
      ctx.fillStyle = '#334155';
      ctx.fillRect(6, 20, 28, 1);

      // Iconic Scania/Volvo wide black slotted radiator grille
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(7, 22, 26, 14);
      ctx.fillStyle = '#94a3b8';
      for (let gy = 23; gy <= 34; gy += 3) {
        ctx.fillRect(9, gy, 22, 1);
      }
      // Silver diagonal truck badge slash across grille
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(18, 25, 4, 3);

      // Lower dark bumper fascia
      ctx.fillStyle = dark;
      ctx.fillRect(0, 36, 40, 4);

      return canvas;
    });
  }

  public getTruckCabSideTextures(ownerColor: string): AsymmetricSideTextures {
    const right = this.getOrCreate(`truck-cab-R:${ownerColor}`, () => {
      const pair = createPixelCanvas(36, 36);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      const base = ownerColor;
      const hi = shadeHex(ownerColor, 1.18);
      const dark = shadeHex(ownerColor, 0.72);

      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 36, 36);
      ctx.fillStyle = hi;
      ctx.fillRect(0, 0, 36, 3);
      ctx.fillStyle = dark;
      ctx.fillRect(0, 30, 36, 6);

      // Recessed cab door seam (`x=0` is `+Z` front!)
      ctx.fillStyle = dark;
      ctx.fillRect(5, 5, 22, 25);
      ctx.fillStyle = base;
      ctx.fillRect(6, 6, 20, 23);

      // Sloped Euro-cab side window (deeper drop at front `x=6..15`)
      drawPixelWindow(ctx, 6, 6, 19, 11, false);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(6, 17, 9, 2);
      ctx.fillStyle = '#1e3a5f';
      ctx.fillRect(7, 17, 7, 1);

      // Cream/silver speed stripe + chrome door handle + twin entry steps
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(0, 21, 36, 2);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(21, 24, 4, 2);

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(8, 30, 10, 5);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(9, 31, 8, 1);
      ctx.fillRect(9, 34, 8, 1);

      return canvas;
    });

    const left = this.getOrCreate(`truck-cab-L:${ownerColor}`, () => {
      const rTex = this.getTruckCabSideTextures_rawCanvas(ownerColor);
      if (!rTex) return null;
      return mirrorCanvasHorizontal(rTex);
    });

    return { right, left };
  }

  private getTruckCabSideTextures_rawCanvas(ownerColor: string): HTMLCanvasElement | null {
    const tex = this.cache.get(`truck-cab-R:${ownerColor}`);
    if (tex && tex.image instanceof HTMLCanvasElement) {
      return tex.image;
    }
    return null;
  }

  /**
   * Truck Freight Curtainsider / Box Van side (`GOODS`) with company livery band,
   * vertical tension straps & buckles, and reflective safety strip.
   */
  public getTruckGoodsVanSideTexture(ownerColor: string): THREE.CanvasTexture | null {
    return this.getOrCreate(`truck-goods:${ownerColor}`, () => {
      const pair = createPixelCanvas(64, 32);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      const accent = tintHex(ownerColor, '#ea580c', 0.35);
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, 0, 64, 29);

      // Bold freight company band across middle
      ctx.fillStyle = ownerColor;
      ctx.fillRect(0, 8, 64, 9);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(0, 17, 64, 2);

      // Subtle vertical curtain/panel ribs + tension straps along bottom
      for (let x = 6; x < 60; x += 8) {
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(x, 2, 1, 6);
        ctx.fillRect(x, 19, 1, 7);
        // Tension buckle at bottom rail
        ctx.fillStyle = '#334155';
        ctx.fillRect(x - 1, 25, 3, 3);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(x, 26, 1, 1);
      }

      // Aluminium perimeter frame + yellow reflective conspicuity tape along bottom
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(0, 0, 64, 2);
      ctx.fillRect(0, 0, 2, 32);
      ctx.fillRect(62, 0, 2, 32);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 29, 64, 3);
      for (let rx = 3; rx < 61; rx += 6) {
        ctx.fillStyle = accent;
        ctx.fillRect(rx, 30, 4, 1);
      }

      return canvas;
    });
  }

  /**
   * Roll-up / double-door rear van texture (`GOODS`, `MAIL`, `FOOD`).
   */
  public getVanRearDoorTexture(
    kind: 'GOODS' | 'MAIL' | 'FOOD'
  ): THREE.CanvasTexture | null {
    return this.getOrCreate(`van-rear:${kind}`, () => {
      const pair = createPixelCanvas(32, 32);
      if (!pair) return null;
      const { canvas, ctx } = pair;

      const bodyHex =
        kind === 'MAIL' ? '#b91c1c' : kind === 'FOOD' ? '#f8fafc' : '#e2e8f0';

      ctx.fillStyle = '#334155';
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = bodyHex;
      ctx.fillRect(2, 2, 13, 27);
      ctx.fillRect(17, 2, 13, 27);

      if (kind === 'GOODS') {
        // Horizontal roll-up shutter slats
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(2, 2, 28, 27);
        ctx.fillStyle = '#94a3b8';
        for (let y = 4; y < 28; y += 3) {
          ctx.fillRect(2, y, 28, 1);
        }
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(12, 24, 8, 2);
      } else {
        if (kind === 'MAIL') {
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(2, 16, 13, 3);
          ctx.fillRect(17, 16, 13, 3);
        } else {
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(2, 16, 13, 3);
          ctx.fillRect(17, 16, 13, 3);
        }
        // Twin vertical stainless locking rods
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(11, 2, 1, 27);
        ctx.fillRect(20, 2, 1, 27);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(10, 19, 3, 2);
        ctx.fillRect(19, 19, 3, 2);
      }

      // Red/white reflective chevron markers on lower corners
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(3, 26, 4, 2);
      ctx.fillRect(25, 26, 4, 2);

      return canvas;
    });
  }

  public dispose(): void {
    for (const tex of this.cache.values()) {
      tex.dispose();
    }
    this.cache.clear();
  }
}
