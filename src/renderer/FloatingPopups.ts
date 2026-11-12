import type { FloatingPopup, GameState } from '../types/game';
import { IsoSceneManager, getTileAt, getTileSurfaceY } from './IsoSceneManager';

const POPUP_DURATION_MS = 2200;

interface ActivePopupEntry {
  id: string;
  x: number;
  y: number;
  wy: number;
  startedAtPerfMs: number;
  el: HTMLDivElement;
}

const COLOR_STYLES: Record<
  FloatingPopup['color'],
  { text: string; glow: string; bg: string; border: string }
> = {
  green: {
    text: '#4ade80',
    glow: '0 1px 4px rgba(0, 0, 0, 0.92)',
    bg: 'rgba(6, 78, 59, 0.82)',
    border: 'rgba(74, 222, 128, 0.6)',
  },
  red: {
    text: '#fca5a5',
    glow: '0 1px 4px rgba(0, 0, 0, 0.92)',
    bg: 'rgba(127, 29, 29, 0.84)',
    border: 'rgba(248, 113, 113, 0.6)',
  },
  amber: {
    text: '#fde047',
    glow: '0 1px 4px rgba(0, 0, 0, 0.92)',
    bg: 'rgba(120, 53, 15, 0.84)',
    border: 'rgba(251, 191, 36, 0.6)',
  },
};

export class FloatingPopups {
  private container: HTMLDivElement;
  private active = new Map<string, ActivePopupEntry>();
  private seenIds = new Set<string>();
  private seenOrder: string[] = [];
  private localSeq = 0;

  constructor(overlayParent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.style.position = 'absolute';
    this.container.style.inset = '0';
    this.container.style.overflow = 'hidden';
    this.container.style.pointerEvents = 'none';
    this.container.style.zIndex = '15';
    overlayParent.appendChild(this.container);
  }

  public syncFromState(state: GameState, nowPerfMs: number): void {
    const popups = state.popups;
    if (!popups || popups.length === 0) return;

    const nowWallMs = Date.now();

    for (let i = 0; i < popups.length; i++) {
      const p = popups[i];
      if (this.seenIds.has(p.id)) continue;

      this.recordSeen(p.id);

      // Skip very old popups when loading a saved game
      const ageWallMs = nowWallMs - (p.createdAtMs || nowWallMs);
      if (ageWallMs > POPUP_DURATION_MS + 600) {
        continue;
      }

      const initialElapsed = Math.max(0, Math.min(450, ageWallMs));
      const tile = getTileAt(state, Math.round(p.x), Math.round(p.y));
      const wy = getTileSurfaceY(tile) + 0.58;

      this.mountPopup(
        p.id,
        p.x,
        p.y,
        wy,
        p.text,
        p.color,
        nowPerfMs - initialElapsed
      );
    }
  }

  public spawnLocalPopup(
    x: number,
    y: number,
    text: string,
    color: FloatingPopup['color'],
    state: GameState
  ): void {
    const id = `local-popup-${++this.localSeq}`;
    const tile = getTileAt(state, Math.round(x), Math.round(y));
    const wy = getTileSurfaceY(tile) + 0.58;
    this.mountPopup(id, x, y, wy, text, color, performance.now());
  }

  private recordSeen(id: string): void {
    this.seenIds.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > 600) {
      const oldest = this.seenOrder.shift();
      if (oldest) {
        this.seenIds.delete(oldest);
      }
    }
  }

  private mountPopup(
    id: string,
    x: number,
    y: number,
    wy: number,
    text: string,
    color: FloatingPopup['color'],
    startedAtPerfMs: number
  ): void {
    const palette = COLOR_STYLES[color] || COLOR_STYLES.green;

    const el = document.createElement('div');
    el.textContent = text;
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.padding = '2px 8px';
    el.style.borderRadius = '9999px';
    el.style.background = palette.bg;
    el.style.border = `1px solid ${palette.border}`;
    el.style.color = palette.text;
    el.style.textShadow = palette.glow;
    el.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    el.style.fontSize = '12px';
    el.style.fontWeight = '800';
    el.style.whiteSpace = 'nowrap';
    el.style.willChange = 'transform, opacity';
    el.style.boxShadow = '0 3px 10px rgba(0,0,0,0.35)';

    this.container.appendChild(el);
    this.active.set(id, {
      id,
      x,
      y,
      wy,
      startedAtPerfMs,
      el,
    });
  }

  public updateProjections(sceneMgr: IsoSceneManager, nowPerfMs: number): void {
    for (const [id, entry] of this.active.entries()) {
      const elapsed = nowPerfMs - entry.startedAtPerfMs;
      if (elapsed >= POPUP_DURATION_MS) {
        entry.el.remove();
        this.active.delete(id);
        continue;
      }

      const t = Math.max(0, elapsed / POPUP_DURATION_MS);
      const proj = sceneMgr.projectWorldToScreen(entry.x, entry.wy, entry.y);
      if (!proj.visible) {
        entry.el.style.display = 'none';
        continue;
      }

      // Smooth ease-out rise over 2.2 seconds + gentle fade out in second half
      const easedRise = 1 - Math.pow(1 - t, 2.1);
      const risePx = easedRise * 52;
      const opacity = t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.45);

      entry.el.style.display = 'block';
      entry.el.style.opacity = opacity.toFixed(3);
      entry.el.style.transform = `translate3d(${proj.x.toFixed(1)}px, ${(proj.y - risePx).toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }

  public dispose(): void {
    for (const entry of this.active.values()) {
      entry.el.remove();
    }
    this.active.clear();
    this.seenIds.clear();
    this.seenOrder = [];
    this.container.remove();
  }
}
