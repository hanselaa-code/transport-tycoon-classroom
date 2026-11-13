import React from 'react';
import { HelpCircle, Crosshair } from 'lucide-react';
import type { CargoType, GameState, TileInspectionInfo } from '../../types/game';
import type { GameEngine } from '../../core';
import {
  CARGO_COLORS,
  CARGO_LABELS_NO,
  CARGO_UNITS_NO,
  formatNumber,
  INDUSTRY_LABELS_NO,
  STATION_KIND_LABELS_NO,
} from '../formatters';
import { TTDWindow } from '../TTDWindow';

export interface LandInfoWindowProps {
  engine: GameEngine;
  state: GameState;
  coords: { x: number; y: number };
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onFocusTile: (x: number, y: number) => void;
}

const ALL_CARGOS: CargoType[] = [
  'PASSENGERS',
  'MAIL',
  'COAL',
  'WOOD',
  'GOODS',
  'GRAIN',
  'FOOD',
];

export const LandInfoWindow: React.FC<LandInfoWindowProps> = ({
  engine,
  state: _state,
  coords,
  zIndex,
  onFocus,
  onClose,
  onFocusTile,
}) => {
  const info: TileInspectionInfo | null = engine.inspectTile(coords.x, coords.y);

  if (!info) {
    return null;
  }

  const waitingEntries = info.waitingCargo
    ? ALL_CARGOS.filter((c) => (info.waitingCargo?.[c] ?? 0) > 0)
    : [];

  return (
    <TTDWindow
      id="land_info"
      title={`Landinformasjon (${info.x}, ${info.y})`}
      icon={<HelpCircle className="w-3.5 h-3.5" />}
      theme="slate"
      defaultX={42}
      defaultY={52}
      width={370}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      {/* Classic TTD Centered Subject Banner */}
      <div className="ttd-inset p-2 text-center space-y-0.5">
        <div className="text-xs font-bold ttd-gold">{info.descriptionNo}</div>
        <div className="text-[10px] text-slate-300 ttd-num">
          Koordinater: ({info.x}, {info.y}) • {info.slopeLabelNo}
        </div>
      </div>

      {/* Classic TTD Key-Value Ledger */}
      <div className="ttd-panel p-2 space-y-1 text-[11px] ttd-num">
        <div className="flex justify-between gap-2 border-b border-black/30 pb-1">
          <span className="text-slate-300">Terreng & helning:</span>
          <strong className="text-amber-100 text-right">
            {info.terrainLabelNo} — {info.slopeLabelNo}
          </strong>
        </div>

        <div className="flex justify-between gap-2 border-b border-black/30 pb-1">
          <span className="text-slate-300">Eier:</span>
          <strong className="text-sky-300 text-right">{info.ownerName}</strong>
        </div>

        {info.bridge && (
          <div className="flex justify-between gap-2 border-b border-black/30 pb-1">
            <span className="text-slate-300">Bru-konstruksjon:</span>
            <strong className="text-cyan-300 text-right">
              {info.bridge === 'RAIL' ? 'Jernbanebru over vann' : 'Veibru over vann'}
            </strong>
          </div>
        )}

        {info.townName && (
          <div className="flex justify-between gap-2 border-b border-black/30 pb-1">
            <span className="text-slate-300">Lokal myndighet / By:</span>
            <strong className="text-amber-200 text-right">
              {info.townName}
              {info.buildingTier > 0 ? ` (Bebyggelse nivå ${info.buildingTier})` : ''}
            </strong>
          </div>
        )}

        {info.industryName && (
          <div className="flex justify-between gap-2 border-b border-black/30 pb-1">
            <span className="text-slate-300">Industri:</span>
            <strong className="text-amber-200 text-right">
              {info.industryName}
              {info.industryType ? ` (${INDUSTRY_LABELS_NO[info.industryType]})` : ''}
            </strong>
          </div>
        )}

        {info.stationName && (
          <div className="flex justify-between gap-2 border-b border-black/30 pb-1">
            <span className="text-slate-300">Stasjon:</span>
            <strong className="text-emerald-300 text-right">
              {info.stationName}
              {info.stationKind
                ? ` (${STATION_KIND_LABELS_NO[info.stationKind]})`
                : ''}
            </strong>
          </div>
        )}

        {/* Accepts */}
        <div className="flex justify-between items-start gap-2 border-b border-black/30 pb-1">
          <span className="text-slate-300 shrink-0">Aksepterer:</span>
          <span className="text-right font-semibold text-emerald-300">
            {info.accepts.length > 0
              ? info.accepts.map((c) => CARGO_LABELS_NO[c]).join(', ')
              : 'Ingenting'}
          </span>
        </div>

        {/* Produces */}
        <div className="flex justify-between items-start gap-2">
          <span className="text-slate-300 shrink-0">Produserer:</span>
          <span className="text-right font-semibold text-amber-300">
            {info.produces.length > 0
              ? info.produces.map((c) => CARGO_LABELS_NO[c]).join(', ')
              : 'Ingenting'}
          </span>
        </div>
      </div>

      {/* Station Waiting Cargo if applicable */}
      {info.waitingCargo && (
        <div className="ttd-inset p-2 space-y-1">
          <div className="text-[10px] uppercase font-bold text-amber-200">
            Ventende last på stasjonen:
          </div>
          {waitingEntries.length === 0 ? (
            <div className="text-[11px] text-slate-400">
              Ingen ventende last for øyeblikket (0 enheter)
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {waitingEntries.map((c) => (
                <span
                  key={c}
                  className="px-1.5 py-0.5 bg-black/40 border border-slate-700 inline-flex items-center gap-1 text-[11px] ttd-num"
                >
                  <span
                    className="w-2 h-2 inline-block"
                    style={{ backgroundColor: CARGO_COLORS[c] }}
                  />
                  <span>{CARGO_LABELS_NO[c]}:</span>
                  <strong className="ttd-gold">
                    {formatNumber(info.waitingCargo?.[c] ?? 0)} {CARGO_UNITS_NO[c]}
                  </strong>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onFocusTile(info.x, info.y)}
          className="ttd-btn !py-1 !px-2.5"
        >
          <Crosshair className="w-3 h-3" />
          <span>Sentrer kamera her</span>
        </button>
      </div>
    </TTDWindow>
  );
};
