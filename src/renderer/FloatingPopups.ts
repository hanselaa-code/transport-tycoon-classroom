import type { FloatingPopup, GameState } from '../types/game';
import { IsoSceneManager, getSurfaceHeightAt } from './IsoSceneManager';

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
  { text: string; bg: string; lightBevel: string; darkBevel: string }
> = {
  green: {
    text: '#86efac',
    bg: 'rgba(20, 64, 32, 0.92)',
    lightBevel: '#4ade80',
    darkBevel: '#052e16',
  },
  red: {
    text: '#fca5a5',
    bg: 'rgba(105, 24, 24, 0.92)',
    lightBevel: '#f87171',
    darkBevel: '#450a0a',
  },
  amber: {
    text: '#fde047',
    bg: 'rgba(92, 54, 14, 0.92)',
    lightBevel: '#fbbf24',
    darkBevel: '#451a03',
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

      const ageWallMs = nowWallMs - (p.createdAtMs || nowWallMs);
      if (ageWallMs > POPUP_DURATION_MS + 600) {
        continue;
      }

      const initialElapsed = Math.max(0, Math.min(450, ageWallMs));
      const wy = getSurfaceHeightAt(state, p.x, p.y) + 0.58;

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
    const wy = getSurfaceHeightAt(state, x, y) + 0.58;
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
    el.style.padding = '2px 7px';
    el.style.borderRadius = '0px';
    el.style.background = palette.bg;
    el.style.borderTop = `1px solid ${palette.lightBevel}`;
    el.style.borderLeft = `1px solid ${palette.lightBevel}`;
    el.style.borderRight = `1px solid ${palette.darkBevel}`;
    el.style.borderBottom = `1px solid ${palette.darkBevel}`;
    el.style.color = palette.text;
    el.style.textShadow = '1px 1px 0px #000000';
    el.style.fontFamily = 'Tahoma, Verdana, ui-monospace, monospace';
    el.style.fontSize = '11px';
    el.style.fontWeight = '700';
    el.style.whiteSpace = 'nowrap';
    el.style.willChange = 'transform, opacity';
    el.style.boxShadow = '2px 2px 4px rgba(0, 0, 0, 0.55)';

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
