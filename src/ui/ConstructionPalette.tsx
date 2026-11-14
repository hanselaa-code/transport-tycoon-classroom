import React from 'react';
import {
  TrainFront,
  Truck,
  Warehouse,
  Building,
  TrafficCone,
  Hammer,
  Route,
  Bus,
  Package,
  Waves,
  Grid3x3,
  RotateCw,
} from 'lucide-react';
import type { BridgeType, ToolType } from '../types/game';
import {
  BRIDGE_CATALOG,
  BRIDGE_TYPES_ORDER,
  BUILD_COSTS,
  MAX_STATION_LENGTH,
  MAX_STATION_TRACKS,
  MAX_TRAIN_WAGONS,
  RAIL_STATION_CATCHMENT_RADIUS,
  ROAD_STATION_CATCHMENT_RADIUS,
} from '../core';
import { formatKr } from './formatters';
import { TTDWindow } from './TTDWindow';

export interface ConstructionPaletteProps {
  mode: 'RAIL' | 'ROAD';
  activeTool: ToolType;
  stationOrientation: 'X' | 'Y';
  stationTracks: number;
  stationLength: number;
  selectedBridgeType: BridgeType;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onSelectTool: (tool: ToolType) => void;
  onSetStationOrientation: (dir: 'X' | 'Y') => void;
  onSetStationTracks: (tracks: number) => void;
  onSetStationLength: (len: number) => void;
  onSelectBridgeType: (bridgeType: BridgeType) => void;
}

const SHORT_BRIDGE_LABELS_NO: Record<BridgeType, string> = {
  WOOD: '1. Trebru',
  STEEL: '2. Stålbru',
  MODERN: '3. Moderne skråstagbru',
};

const TRACK_OPTIONS = Array.from(
  { length: MAX_STATION_TRACKS },
  (_, i) => i + 1
);
const LENGTH_OPTIONS = Array.from(
  { length: MAX_STATION_LENGTH },
  (_, i) => i + 1
);

export const ConstructionPalette: React.FC<ConstructionPaletteProps> = ({
  mode,
  activeTool,
  stationOrientation,
  stationTracks,
  stationLength,
  selectedBridgeType,
  zIndex,
  onFocus,
  onClose,
  onSelectTool,
  onSetStationOrientation,
  onSetStationTracks,
  onSetStationLength,
  onSelectBridgeType,
}) => {
  const windowId = mode === 'RAIL' ? 'rail_palette' : 'road_palette';
  const currentBridgeSpec = BRIDGE_CATALOG[selectedBridgeType];

  const totalStationTiles = stationTracks * stationLength;
  const totalStationCost = totalStationTiles * BUILD_COSTS.TRAIN_STATION;
  const maxPenaltyFreeWagons = Math.min(
    MAX_TRAIN_WAGONS,
    stationLength * 2 - 1
  );

  if (mode === 'RAIL') {
    return (
      <TTDWindow
        id={windowId}
        title="Jernbanebygging"
        subtitle="Betales av Selskap AS"
        icon={<TrainFront className="w-3.5 h-3.5" />}
        theme="teal"
        defaultX={14}
        defaultY={52}
        width={376}
        zIndex={zIndex}
        onFocus={onFocus}
        onClose={onClose}
      >
        <div className="grid grid-cols-1 gap-1.5">
          <button
            type="button"
            onClick={() => onSelectTool(activeTool === 'RAIL' ? 'SELECT' : 'RAIL')}
            className={`ttd-btn !justify-between !py-1.5 ${
              activeTool === 'RAIL' ? 'ttd-btn-active' : ''
            }`}
          >
            <span className="flex items-center gap-2">
              <Route className="w-4 h-4 text-sky-300" />
              <span>Jernbanespor (Klikk & dra)</span>
            </span>
            <span className="text-amber-200 ttd-num">
              {formatKr(BUILD_COSTS.RAIL)}/rute
            </span>
          </button>

          {/* 3-Tier Rail Bridge Selector */}
          <div className="ttd-panel p-1.5 space-y-1.5">
            <button
              type="button"
              onClick={() =>
                onSelectTool(
                  activeTool === 'RAIL_BRIDGE' ? 'SELECT' : 'RAIL_BRIDGE'
                )
              }
              className={`ttd-btn w-full !justify-between !py-1.5 ${
                activeTool === 'RAIL_BRIDGE' ? 'ttd-btn-active' : ''
              }`}
              title="Dra rett over vann fra bredd til bredd"
            >
              <span className="flex items-center gap-2">
                <Waves className="w-4 h-4 text-cyan-300" />
                <span className="text-left">
                  <span className="block">
                    Jernbanebru ({currentBridgeSpec.nameNo})
                  </span>
                  <span className="block text-[9px] font-normal text-slate-300">
                    Maks {currentBridgeSpec.maxSpeedKmh} km/t • Dra rett over vann
                  </span>
                </span>
              </span>
              <span className="text-amber-200 ttd-num">
                {formatKr(currentBridgeSpec.railCostPerTile)}/rute
              </span>
            </button>

            <div className="space-y-1">
              {BRIDGE_TYPES_ORDER.map((bType) => {
                const spec = BRIDGE_CATALOG[bType];
                const isSelected = selectedBridgeType === bType;
                return (
                  <button
                    key={bType}
                    type="button"
                    onClick={() => {
                      onSelectBridgeType(bType);
                      onSelectTool('RAIL_BRIDGE');
                    }}
                    className={`ttd-btn w-full !justify-between !py-1 !px-2 !text-[10px] ttd-num ${
                      isSelected && activeTool === 'RAIL_BRIDGE'
                        ? 'ttd-btn-active'
                        : isSelected
                        ? 'ttd-btn-teal'
                        : ''
                    }`}
                  >
                    <span>
                      {SHORT_BRIDGE_LABELS_NO[bType]} ({spec.maxSpeedKmh} km/t)
                    </span>
                    <span className="text-amber-200">
                      {formatKr(spec.railCostPerTile)}/rute
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onSelectTool(activeTool === 'RAIL_DEPOT' ? 'SELECT' : 'RAIL_DEPOT')
            }
            className={`ttd-btn !justify-between !py-1.5 ${
              activeTool === 'RAIL_DEPOT' ? 'ttd-btn-active' : ''
            }`}
          >
            <span className="flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-amber-300" />
              <span>Togdepot (Kjøp lok & vogner)</span>
            </span>
            <span className="text-amber-200 ttd-num">
              {formatKr(BUILD_COSTS.RAIL_DEPOT)}
            </span>
          </button>

          {/* Authentic OpenTTD Train Station Builder (Orientation + 1–4 Tracks + 1–6 Length + Catchment Grid) */}
          <div className="ttd-panel p-2 space-y-2">
            <button
              type="button"
              onClick={() =>
                onSelectTool(
                  activeTool === 'TRAIN_STATION' ? 'SELECT' : 'TRAIN_STATION'
                )
              }
              className={`ttd-btn w-full !justify-between !py-1.5 ${
                activeTool === 'TRAIN_STATION' ? 'ttd-btn-active' : ''
              }`}
            >
              <span className="flex items-center gap-2">
                <Building className="w-4 h-4 text-emerald-300" />
                <span>
                  Bygg Togstasjon ({stationTracks}×{stationLength})
                </span>
              </span>
              <span className="text-amber-200 ttd-num">
                {formatKr(totalStationCost)}
              </span>
            </button>

            {/* 1. Orientation (X vs Y) + [R] Shortcut */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-amber-200">
                  Retning på spor:
                </span>
                <span className="text-slate-300 inline-flex items-center gap-1">
                  <RotateCw className="w-2.5 h-2.5 text-amber-300" />
                  <span>Hurtigtast [R]</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onSetStationOrientation('X');
                    onSelectTool('TRAIN_STATION');
                  }}
                  className={`ttd-btn !py-1 !px-1.5 !text-[10px] ${
                    stationOrientation === 'X' && activeTool === 'TRAIN_STATION'
                      ? 'ttd-btn-active'
                      : stationOrientation === 'X'
                      ? 'ttd-btn-teal'
                      : ''
                  }`}
                >
                  <span className="font-black text-amber-300 text-xs">⟋</span>
                  <span>Nordøst–Sørvest (X)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSetStationOrientation('Y');
                    onSelectTool('TRAIN_STATION');
                  }}
                  className={`ttd-btn !py-1 !px-1.5 !text-[10px] ${
                    stationOrientation === 'Y' && activeTool === 'TRAIN_STATION'
                      ? 'ttd-btn-active'
                      : stationOrientation === 'Y'
                      ? 'ttd-btn-teal'
                      : ''
                  }`}
                >
                  <span className="font-black text-amber-300 text-xs">⟍</span>
                  <span>Nordvest–Sørøst (Y)</span>
                </button>
              </div>
            </div>

            {/* 2. Number of Parallel Tracks (1–4) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-amber-200">
                  Antall spor (1–{MAX_STATION_TRACKS}):
                </span>
                <span className="text-slate-300 ttd-num">
                  {stationTracks} {stationTracks === 1 ? 'spor' : 'parallelle spor'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {TRACK_OPTIONS.map((tr) => (
                  <button
                    key={tr}
                    type="button"
                    onClick={() => {
                      onSetStationTracks(tr);
                      onSelectTool('TRAIN_STATION');
                    }}
                    className={`ttd-btn !py-0.5 ttd-num ${
                      stationTracks === tr && activeTool === 'TRAIN_STATION'
                        ? 'ttd-btn-active'
                        : stationTracks === tr
                        ? 'ttd-btn-teal'
                        : ''
                    }`}
                  >
                    {tr}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Platform Length (1–6) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-amber-200">
                  Plattformlengde (1–{MAX_STATION_LENGTH} ruter):
                </span>
                <span className="text-slate-300 ttd-num">
                  {stationLength} {stationLength === 1 ? 'rute' : 'ruter'} lang
                </span>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {LENGTH_OPTIONS.map((len) => (
                  <button
                    key={len}
                    type="button"
                    onClick={() => {
                      onSetStationLength(len);
                      onSelectTool('TRAIN_STATION');
                    }}
                    className={`ttd-btn !py-0.5 ttd-num ${
                      stationLength === len && activeTool === 'TRAIN_STATION'
                        ? 'ttd-btn-active'
                        : stationLength === len
                        ? 'ttd-btn-teal'
                        : ''
                    }`}
                  >
                    {len}
                  </button>
                ))}
              </div>
            </div>

            {/* Live OpenTTD Station Info Summary */}
            <div className="ttd-inset p-1.5 space-y-1 text-[10px] ttd-num bg-slate-950/80">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Totalpris ({stationTracks}×{stationLength}):</span>
                <strong className="text-amber-200">{formatKr(totalStationCost)}</strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Kapasitet uten tidsstraff:</span>
                <strong className="text-emerald-300">
                  Opptil {maxPenaltyFreeWagons}{' '}
                  {maxPenaltyFreeWagons === 1 ? 'vogn' : 'vogner'}
                  {stationLength >= 5 ? ' (full lengde)' : ''}
                </strong>
              </div>
              <div className="flex items-start gap-1 text-sky-300 pt-0.5 border-t border-slate-800/80 leading-snug">
                <Grid3x3 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-sky-400" />
                <span>
                  <strong>Nedslagsfelt:</strong> {RAIL_STATION_CATCHMENT_RADIUS} ruter rundt hele stasjonen — vises som blått grid på kartet! Lengre tog enn plattformen får tidsstraff ved av-/pålasting.
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onSelectTool(activeTool === 'SIGNAL' ? 'SELECT' : 'SIGNAL')
            }
            className={`ttd-btn !justify-between !py-1.5 ${
              activeTool === 'SIGNAL' ? 'ttd-btn-active' : ''
            }`}
          >
            <span className="flex items-center gap-2">
              <TrafficCone className="w-4 h-4 text-lime-300" />
              <span>Blokksignal (Flere tog på spor)</span>
            </span>
            <span className="text-amber-200 ttd-num">
              {formatKr(BUILD_COSTS.SIGNAL)}
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              onSelectTool(activeTool === 'BULLDOZE' ? 'SELECT' : 'BULLDOZE')
            }
            className={`ttd-btn ttd-btn-red !justify-between !py-1.5 ${
              activeTool === 'BULLDOZE' ? 'ttd-btn-active' : ''
            }`}
          >
            <span className="flex items-center gap-2">
              <Hammer className="w-4 h-4 text-rose-200" />
              <span>Riv / Bulldoser felt</span>
            </span>
            <span className="text-rose-200 ttd-num">
              {formatKr(BUILD_COSTS.BULLDOZE)}
            </span>
          </button>
        </div>
      </TTDWindow>
    );
  }

  return (
    <TTDWindow
      id={windowId}
      title="Veibygging"
      subtitle="Betales av Selskap AS"
      icon={<Truck className="w-3.5 h-3.5" />}
      theme="teal"
      defaultX={14}
      defaultY={52}
      width={360}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      <div className="grid grid-cols-1 gap-1.5">
        <button
          type="button"
          onClick={() => onSelectTool(activeTool === 'ROAD' ? 'SELECT' : 'ROAD')}
          className={`ttd-btn !justify-between !py-1.5 ${
            activeTool === 'ROAD' ? 'ttd-btn-active' : ''
          }`}
        >
          <span className="flex items-center gap-2">
            <Route className="w-4 h-4 text-sky-300" />
            <span>Bilvei (Klikk & dra)</span>
          </span>
          <span className="text-amber-200 ttd-num">
            {formatKr(BUILD_COSTS.ROAD)}/rute
          </span>
        </button>

        {/* 3-Tier Road Bridge Selector */}
        <div className="ttd-panel p-1.5 space-y-1.5">
          <button
            type="button"
            onClick={() =>
              onSelectTool(
                activeTool === 'ROAD_BRIDGE' ? 'SELECT' : 'ROAD_BRIDGE'
              )
            }
            className={`ttd-btn w-full !justify-between !py-1.5 ${
              activeTool === 'ROAD_BRIDGE' ? 'ttd-btn-active' : ''
            }`}
            title="Dra rett over vann fra bredd til bredd"
          >
            <span className="flex items-center gap-2">
              <Waves className="w-4 h-4 text-cyan-300" />
              <span className="text-left">
                <span className="block">
                  Veibru ({currentBridgeSpec.nameNo})
                </span>
                <span className="block text-[9px] font-normal text-slate-300">
                  Maks {currentBridgeSpec.maxSpeedKmh} km/t • Dra rett over vann
                </span>
              </span>
            </span>
            <span className="text-amber-200 ttd-num">
              {formatKr(currentBridgeSpec.roadCostPerTile)}/rute
            </span>
          </button>

          <div className="space-y-1">
            {BRIDGE_TYPES_ORDER.map((bType) => {
              const spec = BRIDGE_CATALOG[bType];
              const isSelected = selectedBridgeType === bType;
              return (
                <button
                  key={bType}
                  type="button"
                  onClick={() => {
                    onSelectBridgeType(bType);
                    onSelectTool('ROAD_BRIDGE');
                  }}
                  className={`ttd-btn w-full !justify-between !py-1 !px-2 !text-[10px] ttd-num ${
                    isSelected && activeTool === 'ROAD_BRIDGE'
                      ? 'ttd-btn-active'
                      : isSelected
                      ? 'ttd-btn-teal'
                      : ''
                  }`}
                >
                  <span>
                    {SHORT_BRIDGE_LABELS_NO[bType]} ({spec.maxSpeedKmh} km/t)
                  </span>
                  <span className="text-amber-200">
                    {formatKr(spec.roadCostPerTile)}/rute
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            onSelectTool(activeTool === 'ROAD_DEPOT' ? 'SELECT' : 'ROAD_DEPOT')
          }
          className={`ttd-btn !justify-between !py-1.5 ${
            activeTool === 'ROAD_DEPOT' ? 'ttd-btn-active' : ''
          }`}
        >
          <span className="flex items-center gap-2">
            <Warehouse className="w-4 h-4 text-amber-300" />
            <span>Bildepot (Kjøp buss/lastebil)</span>
          </span>
          <span className="text-amber-200 ttd-num">
            {formatKr(BUILD_COSTS.ROAD_DEPOT)}
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            onSelectTool(activeTool === 'BUS_STOP' ? 'SELECT' : 'BUS_STOP')
          }
          className={`ttd-btn !justify-between !py-1.5 ${
            activeTool === 'BUS_STOP' ? 'ttd-btn-active' : ''
          }`}
        >
          <span className="flex items-center gap-2">
            <Bus className="w-4 h-4 text-sky-300" />
            <span>Bussholdeplass (Passasjerer)</span>
          </span>
          <span className="text-amber-200 ttd-num">
            {formatKr(BUILD_COSTS.BUS_STOP)}
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            onSelectTool(activeTool === 'TRUCK_BAY' ? 'SELECT' : 'TRUCK_BAY')
          }
          className={`ttd-btn !justify-between !py-1.5 ${
            activeTool === 'TRUCK_BAY' ? 'ttd-btn-active' : ''
          }`}
        >
          <span className="flex items-center gap-2">
            <Package className="w-4 h-4 text-emerald-300" />
            <span>Lasteterminal (Gods & råvarer)</span>
          </span>
          <span className="text-amber-200 ttd-num">
            {formatKr(BUILD_COSTS.TRUCK_BAY)}
          </span>
        </button>

        {(activeTool === 'BUS_STOP' || activeTool === 'TRUCK_BAY') && (
          <div className="ttd-inset p-2 bg-sky-950/40 border border-sky-500/60 text-[10px] text-sky-200 flex items-start gap-1.5 leading-snug">
            <Grid3x3 className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
            <span>
              <strong>{ROAD_STATION_CATCHMENT_RADIUS}-ruters nedslagsfelt-grid</strong>{' '}
              vises live i blått på kartet slik at du ser nøyaktig hvilke hus og
              industrier holdeplassen/terminalen dekker!
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() =>
            onSelectTool(activeTool === 'BULLDOZE' ? 'SELECT' : 'BULLDOZE')
          }
          className={`ttd-btn ttd-btn-red !justify-between !py-1.5 ${
            activeTool === 'BULLDOZE' ? 'ttd-btn-active' : ''
          }`}
        >
          <span className="flex items-center gap-2">
            <Hammer className="w-4 h-4 text-rose-200" />
            <span>Riv / Bulldoser felt</span>
          </span>
          <span className="text-rose-200 ttd-num">
            {formatKr(BUILD_COSTS.BULLDOZE)}
          </span>
        </button>
      </div>

      <div className="ttd-inset p-2 text-[11px] text-slate-300 leading-snug">
        <strong className="text-amber-300">Tips:</strong> Byer har allerede
        gater! Plasser en <span className="text-sky-300">Bussholdeplass</span> i
        to byer, koble veien mellom dem, plasser et{' '}
        <span className="text-amber-200">Bildepot</span> inntil veien og kjøp din
        første buss!
      </div>
    </TTDWindow>
  );
};
