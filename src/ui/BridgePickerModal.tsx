import React, { useEffect } from 'react';
import { Waves, Gauge, Wallet, Check, X, Sparkles } from 'lucide-react';
import type { BridgeType, GameState } from '../types/game';
import { BRIDGE_CATALOG, BRIDGE_TYPES_ORDER, type GameEngine } from '../core';
import { formatKr } from './formatters';

export interface PendingBridgeDragRequest {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  tool: 'ROAD' | 'RAIL' | 'ROAD_BRIDGE' | 'RAIL_BRIDGE';
  network: 'ROAD' | 'RAIL';
  bridgeTileCount: number;
}

export interface BridgePickerModalProps {
  engine: GameEngine;
  state: GameState;
  request: PendingBridgeDragRequest;
  selectedBridgeType: BridgeType;
  onSelectAndBuild: (bridgeType: BridgeType) => void;
  onCancel: () => void;
}

const BridgeIllustrationSvg: React.FC<{
  bridgeType: BridgeType;
  network: 'ROAD' | 'RAIL';
}> = ({ bridgeType, network }) => {
  if (bridgeType === 'WOOD') {
    return (
      <svg
        viewBox="0 0 168 62"
        className="w-[164px] h-[60px] shrink-0 ttd-inset bg-[#0c2233]"
        aria-hidden="true"
      >
        {/* Sky & Fjord Water */}
        <rect x="0" y="0" width="168" height="42" fill="#132f44" />
        <rect x="0" y="42" width="168" height="20" fill="#0d4f73" />
        <line x1="16" y1="44" x2="152" y2="44" stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.45" />

        {/* Seamless Level Shore Abutments */}
        <polygon points="0,30 18,30 22,62 0,62" fill="#57534e" />
        <rect x="0" y="28" width="19" height="4" fill="#4d7c0f" />
        <polygon points="150,30 168,30 168,62 146,62" fill="#57534e" />
        <rect x="149" y="28" width="19" height="4" fill="#4d7c0f" />

        {/* Timber Trestle Pilings & X-Bracing */}
        {[38, 68, 100, 130].map((px) => (
          <g key={px}>
            <rect x={px - 5} y="31" width="2.6" height="29" fill="#5c3a21" />
            <rect x={px + 2.4} y="31" width="2.6" height="29" fill="#5c3a21" />
            <line
              x1={px - 4.5}
              y1="33"
              x2={px + 4.5}
              y2="52"
              stroke="#8c5832"
              strokeWidth="1.3"
            />
            <line
              x1={px + 4.5}
              y1="33"
              x2={px - 4.5}
              y2="52"
              stroke="#8c5832"
              strokeWidth="1.3"
            />
            <rect x={px - 7} y="30" width="14" height="2.5" fill="#78472a" />
          </g>
        ))}

        {/* Wooden Plank Deck (Zero-Dumpel Flush at y=28) */}
        <rect x="16" y="28" width="136" height="3.5" fill="#a1683a" />
        <line
          x1="16"
          y1="27.5"
          x2="152"
          y2="27.5"
          stroke={network === 'RAIL' ? '#cbd5e1' : '#fde68a'}
          strokeWidth="1"
          strokeDasharray={network === 'RAIL' ? '3 2' : '5 4'}
        />

        {/* Rustic Post & Rail Wooden Guardrail */}
        <line x1="18" y1="23" x2="150" y2="23" stroke="#b47642" strokeWidth="1.4" />
        <line x1="18" y1="25.5" x2="150" y2="25.5" stroke="#8c5832" strokeWidth="1" />
        {[22, 38, 54, 70, 86, 102, 118, 134, 148].map((rx) => (
          <rect key={rx} x={rx - 0.8} y="22" width="1.6" height="6" fill="#7c4a24" />
        ))}
      </svg>
    );
  }

  if (bridgeType === 'STEEL') {
    return (
      <svg
        viewBox="0 0 168 62"
        className="w-[164px] h-[60px] shrink-0 ttd-inset bg-[#0c2233]"
        aria-hidden="true"
      >
        {/* Sky & Fjord Water */}
        <rect x="0" y="0" width="168" height="43" fill="#132f44" />
        <rect x="0" y="43" width="168" height="19" fill="#0d4f73" />
        <line x1="16" y1="45" x2="152" y2="45" stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.45" />

        {/* Cut-Stone Shore Abutments */}
        <polygon points="0,32 18,32 22,62 0,62" fill="#64748b" />
        <rect x="0" y="30" width="19" height="3.5" fill="#4d7c0f" />
        <polygon points="150,32 168,32 168,62 146,62" fill="#64748b" />
        <rect x="149" y="30" width="19" height="3.5" fill="#4d7c0f" />

        {/* Concrete Water Piers */}
        {[52, 84, 116].map((px) => (
          <g key={px}>
            <rect x={px - 4.5} y="34" width="9" height="26" fill="#94a3b8" />
            <rect x={px - 6} y="32.5" width="12" height="2.5" fill="#cbd5e1" />
          </g>
        ))}

        {/* Red-Oxide Warren Steel Lattice Truss */}
        <line x1="24" y1="15" x2="144" y2="15" stroke="#dc2626" strokeWidth="2.2" />
        <line x1="18" y1="30" x2="24" y2="15" stroke="#b9381e" strokeWidth="2.2" />
        <line x1="150" y1="30" x2="144" y2="15" stroke="#b9381e" strokeWidth="2.2" />
        {[24, 44, 64, 84, 104, 124].map((tx, idx) => (
          <g key={tx}>
            <line x1={tx} y1="15" x2={tx} y2="30" stroke="#991b1b" strokeWidth="1.4" />
            <line
              x1={tx}
              y1={idx % 2 === 0 ? 15 : 30}
              x2={tx + 20}
              y2={idx % 2 === 0 ? 30 : 15}
              stroke="#ef4444"
              strokeWidth="1.6"
            />
          </g>
        ))}
        <line x1="144" y1="15" x2="144" y2="30" stroke="#991b1b" strokeWidth="1.4" />

        {/* Reinforced Steel Box Deck */}
        <rect x="16" y="30" width="136" height="4" fill="#334155" />
        <line
          x1="16"
          y1="29.6"
          x2="152"
          y2="29.6"
          stroke={network === 'RAIL' ? '#e2e8f0' : '#f8fafc'}
          strokeWidth="1"
          strokeDasharray={network === 'RAIL' ? '3 2' : '6 4'}
        />
      </svg>
    );
  }

  // MODERN: Sleek White Cable-Stayed Pylon Bridge
  return (
    <svg
      viewBox="0 0 168 62"
      className="w-[164px] h-[60px] shrink-0 ttd-inset bg-[#0c2233]"
      aria-hidden="true"
    >
      {/* Crisp Sky & Fjord Water */}
      <rect x="0" y="0" width="168" height="45" fill="#102a3f" />
      <rect x="0" y="45" width="168" height="17" fill="#0e5a82" />
      <line x1="16" y1="47" x2="152" y2="47" stroke="#7dd3fc" strokeWidth="0.9" strokeOpacity="0.55" />

      {/* White Architectural Shore Terraces */}
      <polygon points="0,35 18,35 21,62 0,62" fill="#cbd5e1" />
      <rect x="0" y="33" width="19" height="3" fill="#4d7c0f" />
      <polygon points="150,35 168,35 168,62 147,62" fill="#cbd5e1" />
      <rect x="149" y="33" width="19" height="3" fill="#4d7c0f" />

      {/* Diagonal Silver-White Fan Stay Cables from Twin Pylons (x=54 & x=114) */}
      {[24, 34, 44].map((ax) => (
        <line
          key={`l1-${ax}`}
          x1="54"
          y1="9"
          x2={ax}
          y2="33"
          stroke="#e2e8f0"
          strokeWidth="0.95"
          strokeOpacity="0.92"
        />
      ))}
      {[64, 74, 82].map((ax) => (
        <line
          key={`r1-${ax}`}
          x1="54"
          y1="9"
          x2={ax}
          y2="33"
          stroke="#e2e8f0"
          strokeWidth="0.95"
          strokeOpacity="0.92"
        />
      ))}
      {[86, 94, 104].map((ax) => (
        <line
          key={`l2-${ax}`}
          x1="114"
          y1="9"
          x2={ax}
          y2="33"
          stroke="#e2e8f0"
          strokeWidth="0.95"
          strokeOpacity="0.92"
        />
      ))}
      {[124, 134, 144].map((ax) => (
        <line
          key={`r2-${ax}`}
          x1="114"
          y1="9"
          x2={ax}
          y2="33"
          stroke="#e2e8f0"
          strokeWidth="0.95"
          strokeOpacity="0.92"
        />
      ))}

      {/* Sculpted White Piers & Tall Pylon Towers */}
      {[54, 114].map((px) => (
        <g key={px}>
          <polygon
            points={`${px - 4.5},36 ${px + 4.5},36 ${px + 6},60 ${px - 6},60`}
            fill="#e2e8f0"
          />
          <rect x={px - 2.2} y="6" width="4.4" height="30" fill="#ffffff" />
          <polygon points={`${px - 1.2},2 ${px + 1.2},2 ${px + 2.2},6 ${px - 2.2},6`} fill="#38bdf8" />
        </g>
      ))}

      {/* Aerodynamic Pearl-White Box-Girder Deck + Cyan Trim */}
      <rect x="16" y="33" width="136" height="3.2" fill="#f8fafc" />
      <rect x="16" y="35.6" width="136" height="1.1" fill="#38bdf8" />
    </svg>
  );
};

const TIER_BADGE_STYLE: Record<BridgeType, string> = {
  WOOD: 'bg-amber-950/90 text-amber-200 border-amber-600/70',
  STEEL: 'bg-sky-950/90 text-sky-200 border-sky-600/70',
  MODERN: 'bg-cyan-950/90 text-cyan-200 border-cyan-400/80',
};

export const BridgePickerModal: React.FC<BridgePickerModalProps> = ({
  engine,
  state,
  request,
  selectedBridgeType,
  onSelectAndBuild,
  onCancel,
}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const companyCash = state.corporate.cash;
  const isRail = request.network === 'RAIL';

  return (
    <div
      className="fixed inset-0 z-[960] bg-black/60 flex items-center justify-center p-3 select-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="ttd-window w-full max-w-[630px] shadow-2xl">
        {/* Classic TTD Title Bar */}
        <div className="ttd-titlebar ttd-titlebar-teal !h-7 flex items-center justify-between pr-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={onCancel}
              title="Lukk / Avbryt brubygging"
              className="ttd-win-box ttd-win-close mr-1"
            >
              ×
            </button>
            <Waves className="w-3.5 h-3.5 text-cyan-200 shrink-0" />
            <span className="truncate font-bold">
              Velg brutype — {isRail ? 'Jernbanebru' : 'Veibru'} (
              {request.bridgeTileCount}{' '}
              {request.bridgeTileCount === 1 ? 'vannrute' : 'vannruter'})
            </span>
          </div>
          <span className="text-[10px] text-amber-200 ttd-num shrink-0">
            ({request.fromX},{request.fromY}) → ({request.toX},{request.toY})
          </span>
        </div>

        <div className="ttd-body !p-3 space-y-2.5">
          {/* Top Corporate Cash & Span Summary */}
          <div className="ttd-panel p-2 flex flex-wrap items-center justify-between gap-2 text-xs ttd-num">
            <div className="text-slate-200">
              Velg kvalitet og fartsgrense for brua over vannet:
            </div>
            <div className="flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-emerald-300" />
              <span className="text-slate-300">Selskap AS saldo:</span>
              <strong
                className={
                  companyCash >= 0 ? 'text-emerald-300' : 'text-rose-400'
                }
              >
                {formatKr(companyCash)}
              </strong>
            </div>
          </div>

          {/* 3 Bridge Quality Cards */}
          <div className="space-y-2">
            {BRIDGE_TYPES_ORDER.map((bType, idx) => {
              const spec = BRIDGE_CATALOG[bType];
              const preview = engine.previewDragPath(
                request.fromX,
                request.fromY,
                request.toX,
                request.toY,
                request.tool,
                bType
              );
              const totalCost = preview.cost;
              const perWaterTileCost = isRail
                ? spec.railCostPerTile
                : spec.roadCostPerTile;
              const canAfford = preview.ok && companyCash >= totalCost;
              const isSelectedDefault = selectedBridgeType === bType;

              return (
                <div
                  key={bType}
                  onClick={() => {
                    if (canAfford) {
                      onSelectAndBuild(bType);
                    }
                  }}
                  className={`ttd-panel p-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 transition ${
                    canAfford
                      ? 'cursor-pointer hover:brightness-110'
                      : 'opacity-65 cursor-not-allowed'
                  } ${
                    isSelectedDefault
                      ? 'ring-2 ring-amber-400 bg-slate-800/80'
                      : ''
                  }`}
                >
                  {/* Left: Crisp Inline SVG Bridge Profile + Specs */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <BridgeIllustrationSvg
                      bridgeType={bType}
                      network={request.network}
                    />

                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-extrabold text-amber-100 text-xs">
                          {idx + 1}. {spec.nameNo}
                        </span>
                        <span
                          className={`px-1.5 py-0.2 border text-[10px] font-bold ${TIER_BADGE_STYLE[bType]}`}
                        >
                          {bType === 'MODERN' && (
                            <Sparkles className="w-2.5 h-2.5 inline mr-0.5 -mt-0.5" />
                          )}
                          {spec.qualityLabelNo}
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-300 leading-snug">
                        {spec.descriptionNo}
                      </p>

                      <div className="flex flex-wrap items-center gap-3 text-[11px] ttd-num pt-0.5">
                        <span className="inline-flex items-center gap-1 font-bold">
                          <Gauge className="w-3.5 h-3.5 text-sky-300" />
                          <span className="text-slate-300">Maks fart:</span>
                          <strong
                            className={
                              bType === 'MODERN'
                                ? 'text-cyan-300'
                                : bType === 'STEEL'
                                ? 'text-sky-300'
                                : 'text-amber-300'
                            }
                          >
                            {spec.maxSpeedKmh} km/t
                          </strong>
                        </span>

                        <span className="text-slate-400">
                          ({formatKr(perWaterTileCost)}/vannrute)
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Exact Total Build Cost & 1-Click Build Button */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-1.5 shrink-0 ttd-num border-t sm:border-t-0 border-slate-700/60 pt-1.5 sm:pt-0">
                    <div className="text-left sm:text-right">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">
                        Totalkostnad
                      </div>
                      <div
                        className={`text-sm font-black ${
                          canAfford ? 'text-amber-200' : 'text-rose-400'
                        }`}
                      >
                        {formatKr(totalCost)}
                      </div>
                    </div>

                    {canAfford ? (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onSelectAndBuild(bType);
                        }}
                        className={`ttd-btn ${
                          bType === 'MODERN'
                            ? 'ttd-btn-teal'
                            : bType === 'STEEL'
                            ? 'ttd-btn-green'
                            : 'ttd-btn-brass'
                        } !px-3 !py-1.5 !text-xs`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Bygg bru</span>
                      </button>
                    ) : (
                      <span className="px-2 py-1 bg-rose-950/80 border border-rose-700/70 text-rose-300 text-[10px] font-bold">
                        Ikke nok kapital
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer Tip & Cancel */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <span className="text-[11px] text-slate-300">
              <strong className="text-amber-200">Tips:</strong> Raske lokomotiver
              (Diesel 120 km/t, El-lok 160 km/t) bremses ned på Trebru, men holder
              full toppfart på Moderne skråstagbru!
            </span>

            <button
              type="button"
              onClick={onCancel}
              className="ttd-btn !px-3 !py-1 ml-auto"
            >
              <X className="w-3.5 h-3.5" />
              <span>Avbryt</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
