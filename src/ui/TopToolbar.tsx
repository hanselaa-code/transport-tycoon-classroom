import React from 'react';
import {
  Pause,
  Play,
  FastForward,
  ZoomIn,
  ZoomOut,
  RotateCw,
  TrainFront,
  Truck,
  MapPin,
  Building2,
  Wallet,
  Landmark,
  TrendingUp,
  Save,
  GraduationCap,
  Wrench,
  MousePointer,
} from 'lucide-react';
import type { GameSpeed, ToolType } from '../types/game';

export type WindowId =
  | 'rail_palette'
  | 'road_palette'
  | 'directory'
  | 'vehicles'
  | 'depot'
  | 'company_finances'
  | 'personal_finances'
  | 'hq'
  | 'stock_market'
  | 'save_load'
  | 'classroom'
  | 'quick_test';

export interface TopToolbarProps {
  speed: GameSpeed;
  activeTool: ToolType;
  openWindows: Set<WindowId>;
  playerVehicleCount: number;
  hqTier: number;
  connectedPin: string | null;
  classroomRemainingSec: number | null;
  isBankruptWarning: boolean;
  onSetSpeed: (speed: GameSpeed) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotateMap: () => void;
  onSelectTool: (tool: ToolType) => void;
  onToggleWindow: (id: WindowId) => void;
}

function formatCountdown(sec: number | null): string {
  if (sec === null || sec < 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  speed,
  activeTool,
  openWindows,
  playerVehicleCount,
  hqTier,
  connectedPin,
  classroomRemainingSec,
  isBankruptWarning,
  onSetSpeed,
  onZoomIn,
  onZoomOut,
  onRotateMap,
  onSelectTool,
  onToggleWindow,
}) => {
  const isRailTool =
    activeTool === 'RAIL' ||
    activeTool === 'RAIL_DEPOT' ||
    activeTool === 'TRAIN_STATION' ||
    activeTool === 'SIGNAL';

  const isRoadTool =
    activeTool === 'ROAD' ||
    activeTool === 'ROAD_DEPOT' ||
    activeTool === 'BUS_STOP' ||
    activeTool === 'TRUCK_BAY';

  return (
    <header className="fixed top-0 left-0 right-0 z-[900] ttd-bar-top px-1.5 py-1 flex flex-wrap items-center justify-between gap-1">
      {/* Left: Speed & Camera Controls */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* Speed Group */}
        <div className="flex items-center ttd-inset p-0.5 gap-0.5" title="Spillhastighet">
          <button
            type="button"
            onClick={() => onSetSpeed(0)}
            title="Pause (0x)"
            className={`ttd-btn !px-1.5 !py-1 ${speed === 0 ? 'ttd-btn-active !text-amber-300' : ''}`}
          >
            <Pause className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onSetSpeed(1)}
            title="Normal hastighet (1x)"
            className={`ttd-btn !px-1.5 !py-1 ttd-num ${speed === 1 ? 'ttd-btn-active' : ''}`}
          >
            <Play className="w-3 h-3" />
            <span>1x</span>
          </button>
          <button
            type="button"
            onClick={() => onSetSpeed(2)}
            title="Rask hastighet (2x)"
            className={`ttd-btn !px-1.5 !py-1 ttd-num ${speed === 2 ? 'ttd-btn-active' : ''}`}
          >
            <span>2x</span>
          </button>
          <button
            type="button"
            onClick={() => onSetSpeed(4)}
            title="Hurtigspoling (4x)"
            className={`ttd-btn !px-1.5 !py-1 ttd-num ${speed === 4 ? 'ttd-btn-active' : ''}`}
          >
            <FastForward className="w-3 h-3" />
            <span>4x</span>
          </button>
        </div>

        {/* Camera Zoom & Rotate */}
        <div className="flex items-center ttd-inset p-0.5 gap-0.5">
          <button
            type="button"
            onClick={onZoomIn}
            title="Zoom inn"
            className="ttd-btn !px-1.5 !py-1"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onZoomOut}
            title="Zoom ut"
            className="ttd-btn !px-1.5 !py-1"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRotateMap}
            title="Roter kart 90°"
            className="ttd-btn !px-1.5 !py-1"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">90°</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectTool('SELECT')}
            title="Pekeverktøy / Inspiser ruter"
            className={`ttd-btn !px-1.5 !py-1 ${activeTool === 'SELECT' ? 'ttd-btn-active' : ''}`}
          >
            <MousePointer className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Construction & Map Group */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleWindow('rail_palette')}
            title="Bygg jernbane, togstasjoner, signaler og togdepot"
            className={`ttd-btn ttd-btn-teal !py-1 ${
              openWindows.has('rail_palette') || isRailTool ? 'ttd-btn-active' : ''
            }`}
          >
            <TrainFront className="w-3.5 h-3.5" />
            <span>Jernbane</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleWindow('road_palette')}
            title="Bygg vei, bussholdeplass, lasteterminal og bildepot"
            className={`ttd-btn ttd-btn-teal !py-1 ${
              openWindows.has('road_palette') || isRoadTool ? 'ttd-btn-active' : ''
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Vei</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleWindow('directory')}
            title="Byer, industrier og stasjonsoversikt"
            className={`ttd-btn !py-1 ${openWindows.has('directory') ? 'ttd-btn-active' : ''}`}
          >
            <MapPin className="w-3.5 h-3.5 text-emerald-300" />
            <span>Byer & Kart</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleWindow('vehicles')}
            title="Alle dine tog, busser og lastebiler"
            className={`ttd-btn !py-1 ${openWindows.has('vehicles') ? 'ttd-btn-active' : ''}`}
          >
            <TrainFront className="w-3.5 h-3.5 text-sky-300" />
            <span>Kjøretøy ({playerVehicleCount})</span>
          </button>
        </div>
      </div>

      {/* Right: Dual Economy, HQ, Stock Market, Save, Classroom, Dev */}
      <div className="flex items-center gap-1 flex-wrap">
        <button
          type="button"
          onClick={() => onToggleWindow('company_finances')}
          title="Selskapsøkonomi AS – Resultatregnskap, Balanse og Banklån"
          className={`ttd-btn !py-1 ${
            isBankruptWarning
              ? 'ttd-cash-negative'
              : openWindows.has('company_finances')
              ? 'ttd-btn-active'
              : ''
          }`}
        >
          <Building2 className="w-3.5 h-3.5 text-sky-300" />
          <span>Selskap AS</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleWindow('personal_finances')}
          title="Personlig økonomi & progressiv skatt (Eier)"
          className={`ttd-btn ttd-btn-brass !py-1 ${
            openWindows.has('personal_finances') ? 'ttd-btn-active' : ''
          }`}
        >
          <Wallet className="w-3.5 h-3.5 text-amber-200" />
          <span>Privat & Skatt</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleWindow('hq')}
          title="Hovedkontor (Nivå 1–5 betalt med privat kapital)"
          className={`ttd-btn !py-1 ${
            openWindows.has('hq') || activeTool === 'PLACE_HQ' ? 'ttd-btn-active' : ''
          }`}
        >
          <Landmark className="w-3.5 h-3.5 text-amber-300" />
          <span>HQ {hqTier > 0 ? `(Nivå ${hqTier})` : ''}</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleWindow('stock_market')}
          title="Børs / Aksjemarked – invester privat i AI-konkurrenter"
          className={`ttd-btn !py-1 ${openWindows.has('stock_market') ? 'ttd-btn-active' : ''}`}
        >
          <TrendingUp className="w-3.5 h-3.5 text-emerald-300" />
          <span>Aksjemarked</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleWindow('save_load')}
          title="Lagre / Last inn spill / Nytt scenario"
          className={`ttd-btn !py-1 ${openWindows.has('save_load') ? 'ttd-btn-active' : ''}`}
        >
          <Save className="w-3.5 h-3.5 text-slate-200" />
          <span>Lagre</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleWindow('classroom')}
          title="Lærer / Klasserom – Live PIN-økt og ledertavle"
          className={`ttd-btn ${connectedPin ? 'ttd-btn-green' : ''} !py-1 ${
            openWindows.has('classroom') ? 'ttd-btn-active' : ''
          }`}
        >
          <GraduationCap className="w-3.5 h-3.5 text-amber-200" />
          {connectedPin ? (
            <span className="flex items-center gap-1 ttd-num">
              <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
              <span>PIN {connectedPin}</span>
              {classroomRemainingSec !== null && (
                <span className="bg-black/35 px-1 py-0.2 rounded text-[11px] text-amber-200">
                  {formatCountdown(classroomRemainingSec)}
                </span>
              )}
            </span>
          ) : (
            <span>Lærer / Klasserom</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onToggleWindow('quick_test')}
          title="Hurtigtest & Hjelp for lærere og elever"
          className={`ttd-btn !py-1 ${openWindows.has('quick_test') ? 'ttd-btn-active' : ''}`}
        >
          <Wrench className="w-3.5 h-3.5 text-orange-300" />
          <span>Dev / Test</span>
        </button>
      </div>
    </header>
  );
};
