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
} from 'lucide-react';
import type { BridgeType, ToolType } from '../types/game';
import { BRIDGE_CATALOG, BRIDGE_TYPES_ORDER, BUILD_COSTS } from '../core';
import { formatKr } from './formatters';
import { TTDWindow } from './TTDWindow';

export interface ConstructionPaletteProps {
  mode: 'RAIL' | 'ROAD';
  activeTool: ToolType;
  stationLength: number;
  selectedBridgeType: BridgeType;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onSelectTool: (tool: ToolType) => void;
  onSetStationLength: (len: number) => void;
  onSelectBridgeType: (bridgeType: BridgeType) => void;
}

const SHORT_BRIDGE_LABELS_NO: Record<BridgeType, string> = {
  WOOD: '1. Trebru',
  STEEL: '2. Stålbru',
  MODERN: '3. Moderne skråstagbru',
};

export const ConstructionPalette: React.FC<ConstructionPaletteProps> = ({
  mode,
  activeTool,
  stationLength,
  selectedBridgeType,
  zIndex,
  onFocus,
  onClose,
  onSelectTool,
  onSetStationLength,
  onSelectBridgeType,
}) => {
  const windowId = mode === 'RAIL' ? 'rail_palette' : 'road_palette';
  const currentBridgeSpec = BRIDGE_CATALOG[selectedBridgeType];

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
        width={350}
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
              <div className="text-[10px] text-slate-300 px-0.5 leading-tight">
                Dra rett over vann fra bredd til bredd — du får velge og bekrefte blant alle 3 brukvaliteter!
              </div>
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
              <span>Togdepot (Kjøp tog her)</span>
            </span>
            <span className="text-amber-200 ttd-num">
              {formatKr(BUILD_COSTS.RAIL_DEPOT)}
            </span>
          </button>

          <div className="ttd-panel p-1.5 space-y-1.5">
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
                  Togstasjon ({stationLength}{' '}
                  {stationLength === 1 ? 'rute' : 'ruter'})
                </span>
              </span>
              <span className="text-amber-200 ttd-num">
                {formatKr(BUILD_COSTS.TRAIN_STATION * stationLength)}
              </span>
            </button>

            <div className="flex items-center justify-between gap-1 text-[11px] px-0.5">
              <span className="text-slate-300">Plattformlengde (1–3 ruter):</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3].map((len) => (
                  <button
                    key={len}
                    type="button"
                    onClick={() => {
                      onSetStationLength(len);
                      onSelectTool('TRAIN_STATION');
                    }}
                    className={`ttd-btn !px-2 !py-0.5 ttd-num ${
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

        <div className="ttd-inset p-2 text-[11px] text-slate-300 leading-snug">
          <strong className="text-amber-300">Tips:</strong> Legg togstasjoner
          innenfor <span className="text-emerald-300 font-semibold">4 ruter</span>{' '}
          fra by eller industri for å fange opp passasjerer og varer!
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
      width={350}
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
            <div className="text-[10px] text-slate-300 px-0.5 leading-tight">
              Dra rett over vann fra bredd til bredd — du får velge og bekrefte blant alle 3 brukvaliteter!
            </div>
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
