import React, { useEffect, useRef, useState } from 'react';
import { Minus, Maximize2, Pin, X } from 'lucide-react';

export type TTDTitleTheme = 'teal' | 'brass' | 'slate' | 'purple' | 'crimson';

export interface TTDWindowProps {
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  theme?: TTDTitleTheme;
  defaultX?: number;
  defaultY?: number;
  width?: number;
  maxHeight?: number;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  children: React.ReactNode;
}

const THEME_CLASS: Record<TTDTitleTheme, string> = {
  teal: 'ttd-titlebar-teal',
  brass: 'ttd-titlebar-brass',
  slate: 'ttd-titlebar-slate',
  purple: 'ttd-titlebar-purple',
  crimson: 'ttd-titlebar-crimson',
};

const BOTTOM_BAR_GUARD = 38;

function getTopBarGuard(): number {
  if (typeof document === 'undefined') return 86;
  const headerEl = document.querySelector('header');
  const headerH = headerEl ? headerEl.getBoundingClientRect().height : 80;
  return Math.max(44, Math.ceil(headerH > 0 ? headerH : 80) + 6);
}

export const TTDWindow: React.FC<TTDWindowProps> = ({
  id,
  title,
  subtitle,
  icon,
  theme = 'teal',
  defaultX = 80,
  defaultY = 64,
  width = 520,
  maxHeight,
  zIndex,
  onFocus,
  onClose,
  children,
}) => {
  const clampPosition = (x: number, y: number, w: number) => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1366;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    const topGuard = getTopBarGuard();
    const effectiveW = Math.min(w, vw - 16);
    const maxX = Math.max(8, vw - effectiveW - 8);
    const maxY = Math.max(topGuard, vh - BOTTOM_BAR_GUARD - 36);
    return {
      x: Math.max(8, Math.min(maxX, x)),
      y: Math.max(topGuard, Math.min(maxY, y)),
    };
  };

  const [pos, setPos] = useState(() => clampPosition(defaultX, defaultY, width));
  const [shaded, setShaded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const dragRef = useRef<{
    dragging: boolean;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  }>({
    dragging: false,
    startClientX: 0,
    startClientY: 0,
    origX: 0,
    origY: 0,
  });

  useEffect(() => {
    const handleReclamp = () => {
      setPos((prev) => clampPosition(prev.x, prev.y, width));
    };

    // Re-clamp immediately after mount once <header> layout is committed
    handleReclamp();

    window.addEventListener('resize', handleReclamp);

    let observer: ResizeObserver | null = null;
    const headerEl =
      typeof document !== 'undefined' ? document.querySelector('header') : null;
    if (headerEl && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        handleReclamp();
      });
      observer.observe(headerEl);
    }

    return () => {
      window.removeEventListener('resize', handleReclamp);
      if (observer) {
        observer.disconnect();
      }
    };
  }, [width]);

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    onFocus(id);
    if (pinned) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      dragging: true,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
  };

  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startClientX;
    const dy = e.clientY - dragRef.current.startClientY;
    setPos(clampPosition(dragRef.current.origX + dx, dragRef.current.origY + dy, width));
  };

  const handleHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.dragging) return;
    dragRef.current.dragging = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if already released
    }
  };

  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;
  const availableBodyH = Math.max(
    180,
    Math.min(maxHeight ?? viewportH - 130, viewportH - pos.y - BOTTOM_BAR_GUARD - 42)
  );

  return (
    <div
      onMouseDown={() => onFocus(id)}
      style={{
        left: pos.x,
        top: pos.y,
        width: `min(${width}px, calc(100vw - 16px))`,
        zIndex,
      }}
      className="fixed ttd-window select-none flex flex-col"
    >
      {/* Classic TTD Title Bar */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onDoubleClick={() => setShaded((s) => !s)}
        className={`${THEME_CLASS[theme]} flex items-center justify-between px-2 py-1 ${
          pinned ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
        }`}
      >
        {/* Left close [X] button like classic TTD OR right controls - we put classic [X] on right + icon on left for Chromebook clarity */}
        <div className="flex items-center gap-1.5 min-w-0 pr-2">
          {icon && <span className="text-amber-200 shrink-0">{icon}</span>}
          <span className="font-bold text-xs tracking-wide text-amber-50 truncate drop-shadow">
            {title}
          </span>
          {subtitle && (
            <span className="text-[11px] text-amber-200/85 truncate hidden sm:inline">
              — {subtitle}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title={pinned ? 'Lås opp vindusposisjon' : 'Lås vindusposisjon (Pin)'}
            onClick={() => setPinned((p) => !p)}
            className={`ttd-btn !px-1.5 !py-0.5 !text-[10px] ${
              pinned ? 'ttd-btn-active' : ''
            }`}
          >
            <Pin className="w-3 h-3" />
          </button>
          <button
            type="button"
            title={shaded ? 'Åpne vindu' : 'Rull opp vindu (Skygge)'}
            onClick={() => setShaded((s) => !s)}
            className="ttd-btn !px-1.5 !py-0.5 !text-[10px]"
          >
            {shaded ? <Maximize2 className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          </button>
          <button
            type="button"
            title="Lukk vindu [X]"
            onClick={() => onClose(id)}
            className="ttd-btn ttd-btn-red !px-1.5 !py-0.5 !text-[10px] font-bold"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Window Body */}
      {!shaded && (
        <div
          style={{ maxHeight: availableBodyH }}
          className="overflow-y-auto overflow-x-hidden p-2.5 text-xs text-slate-100 space-y-2.5"
        >
          {children}
        </div>
      )}
    </div>
  );
};
