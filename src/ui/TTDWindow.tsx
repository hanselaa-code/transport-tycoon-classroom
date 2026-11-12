import React, { useEffect, useRef, useState } from 'react';
import { Minus, Maximize2, Pin } from 'lucide-react';

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

const BOTTOM_BAR_GUARD = 36;

function getTopBarGuard(): number {
  if (typeof document === 'undefined') return 42;
  const headerEl = document.querySelector('header');
  const headerH = headerEl ? headerEl.getBoundingClientRect().height : 38;
  return Math.max(40, Math.ceil(headerH > 0 ? headerH : 38) + 4);
}

export const TTDWindow: React.FC<TTDWindowProps> = ({
  id,
  title,
  subtitle,
  icon,
  theme = 'teal',
  defaultX = 72,
  defaultY = 46,
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
    const effectiveW = Math.min(w, vw - 12);
    const maxX = Math.max(6, vw - effectiveW - 6);
    const maxY = Math.max(topGuard, vh - BOTTOM_BAR_GUARD - 30);
    return {
      x: Math.max(6, Math.min(maxX, x)),
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

    handleReclamp();
    window.addEventListener('resize', handleReclamp);

    let observer: ResizeObserver | null = null;
    const headerEl =
      typeof document !== 'undefined' ? document.querySelector('header') : null;
    if (headerEl && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => handleReclamp());
      observer.observe(headerEl);
    }

    return () => {
      window.removeEventListener('resize', handleReclamp);
      if (observer) observer.disconnect();
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
    setPos(
      clampPosition(
        dragRef.current.origX + dx,
        dragRef.current.origY + dy,
        width
      )
    );
  };

  const handleHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.dragging) return;
    dragRef.current.dragging = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;
  const availableBodyH = Math.max(
    160,
    Math.min(
      maxHeight ?? viewportH - 104,
      viewportH - pos.y - BOTTOM_BAR_GUARD - 34
    )
  );

  return (
    <div
      onMouseDown={() => onFocus(id)}
      style={{
        left: pos.x,
        top: pos.y,
        width: `min(${width}px, calc(100vw - 12px))`,
        zIndex,
      }}
      className="fixed ttd-window select-none flex flex-col"
    >
      {/* Authentic OpenTTD / 1995 TTD Title Bar: [×] on FAR LEFT, Title center, [Pin][▬] on RIGHT */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onDoubleClick={() => setShaded((s) => !s)}
        className={`${THEME_CLASS[theme]} h-[24px] flex items-center justify-between px-1 gap-1.5 ${
          pinned ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
        }`}
      >
        {/* Far-Left Iconic TTD [×] Close Button Box */}
        <button
          type="button"
          title="Lukk vindu [×]"
          onClick={() => onClose(id)}
          className="ttd-btn !w-[18px] !h-[18px] !p-0 !text-[12px] leading-none font-black shrink-0 text-slate-100 hover:!bg-red-800"
        >
          ×
        </button>

        {/* Centered / Crisp Gold-Shadowed Title */}
        <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-1 text-center">
          {icon && <span className="text-amber-300 shrink-0">{icon}</span>}
          <span
            className="font-bold text-[11px] tracking-tight text-amber-100 truncate"
            style={{ textShadow: '1px 1px 0 #000' }}
          >
            {title}
          </span>
          {subtitle && (
            <span
              className="text-[10px] text-amber-200/85 truncate hidden md:inline"
              style={{ textShadow: '1px 1px 0 #000' }}
            >
              — {subtitle}
            </span>
          )}
        </div>

        {/* Far-Right Shade & Pin Bevel Boxes */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            title={pinned ? 'Lås opp vindu' : 'Fest vindu (Pin)'}
            onClick={() => setPinned((p) => !p)}
            className={`ttd-btn !w-[18px] !h-[18px] !p-0 ${
              pinned ? 'ttd-btn-active' : ''
            }`}
          >
            <Pin className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            title={shaded ? 'Vis vindusinnhold' : 'Rull opp til tittellinje'}
            onClick={() => setShaded((s) => !s)}
            className="ttd-btn !w-[18px] !h-[18px] !p-0"
          >
            {shaded ? (
              <Maximize2 className="w-2.5 h-2.5" />
            ) : (
              <Minus className="w-2.5 h-2.5" />
            )}
          </button>
        </div>
      </div>

      {/* Window Body */}
      {!shaded && (
        <div
          style={{ maxHeight: availableBodyH }}
          className="overflow-y-auto overflow-x-hidden p-2 text-[11px] text-slate-100 space-y-2"
        >
          {children}
        </div>
      )}
    </div>
  );
};
