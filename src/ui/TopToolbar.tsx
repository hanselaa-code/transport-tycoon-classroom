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
  HelpCircle,
  Hammer,
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
  | 'quick_test'
  | 'land_info';

export interface TopToolbarProps {
  speed: GameSpeed;
  activeTool: ToolType;
  isQueryLandActive: boolean;
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
  onToggleQueryLand: () => void;
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
  isQueryLandActive,
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
  onToggleQueryLand,
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
    <header className="fixed top-0 left-0 right-0 z-[900] h-[36px] ttd-bar-top px-1 flex items-center justify-between gap-1 flex-nowrap overflow-x-auto no-scrollbar">
      {/* Left Cluster: Speed • Save & [?] Query • Zoom/Rotate */}
      <div className="flex items-center gap-1 shrink-0">
        {/* [Pause | 1x | 2x | 4x] */}
        <div className="flex items-center gap-0.5" title="Spillhastighet">
          <button
            type="button"
            onClick={() => onSetSpeed(0)}
            title="Pause (0x)"
            className={`ttd-btn !px-1.5 !h-[26px] ${
              speed === 0 ? 'ttd-btn-active' : ''
            }`}
          >
            <Pause className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onSetSpeed(1)}
            title="Normal hastighet (1x TTD-tempo)"
            className={`ttd-btn !px-1.5 !h-[26px] ttd-num ${
              speed === 1 ? 'ttd-btn-active' : ''
            }`}
          >
            <Play className="w-3 h-3" />
            <span>1x</span>
          </button>
          <button
            type="button"
            onClick={() => onSetSpeed(2)}
            title="Dobbel hastighet (2x)"
            className={`ttd-btn !px-1.5 !h-[26px] ttd-num ${
              speed === 2 ? 'ttd-btn-active' : ''
            }`}
          >
            <span>2x</span>
          </button>
          <button
            type="button"
            onClick={() => onSetSpeed(4)}
            title="Hurtigspoling (4x)"
            className={`ttd-btn !px-1.5 !h-[26px] ttd-num ${
              speed === 4 ? 'ttd-btn-active' : ''
            }`}
          >
            <FastForward className="w-3 h-3" />
            <span>4x</span>
          </button>
        </div>

        <div className="ttd-divider" />

        {/* [Lagre] [? Undersøk] */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onToggleWindow('save_load')}
            title="Lagre / Last inn / Nytt spill"
            className={`ttd-btn !px-1.5 !h-[26px] ${
              openWindows.has('save_load') ? 'ttd-btn-active' : ''
            }`}
          >
            <Save className="w-3.5 h-3.5 text-amber-200" />
            <span className="hidden xl:inline">Lagre</span>
          </button>
          <button
            type="button"
            onClick={onToggleQueryLand}
            title="Undersøk landrute [?] – vis terreng, eier, tilbud og etterspørsel"
            className={`ttd-btn !px-1.5 !h-[26px] ${
              isQueryLandActive || openWindows.has('land_info')
                ? 'ttd-btn-active'
                : ''
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-300" />
            <span>?</span>
          </button>
        </div>

        <div className="ttd-divider" />

        {/* [Zoom + | Zoom - | Roter] */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onZoomIn}
            title="Zoom inn"
            className="ttd-btn !px-1.5 !h-[26px]"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onZoomOut}
            title="Zoom ut"
            className="ttd-btn !px-1.5 !h-[26px]"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRotateMap}
            title="Roter kart 90°"
            className="ttd-btn !px-1.5 !h-[26px]"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Center Cluster: Finances/Assets • Directory/Fleet • Construction */}
      <div className="flex items-center gap-1 shrink-0">
        {/* [Selskap AS] [Privat & Skatt] [HQ] [Børs] */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onToggleWindow('company_finances')}
            title="Selskap AS – Resultatregnskap, Balanse og Banklån"
            className={`ttd-btn !px-2 !h-[26px] ${
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
            className={`ttd-btn ttd-btn-brass !px-2 !h-[26px] ${
              openWindows.has('personal_finances') ? 'ttd-btn-active' : ''
            }`}
          >
            <Wallet className="w-3.5 h-3.5 text-amber-200" />
            <span>Privat & Skatt</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleWindow('hq')}
            title="Hovedkontor (Nivå 1–5 betalt privat)"
            className={`ttd-btn !px-1.5 !h-[26px] ttd-num ${
              openWindows.has('hq') || activeTool === 'PLACE_HQ'
                ? 'ttd-btn-active'
                : ''
            }`}
          >
            <Landmark className="w-3.5 h-3.5 text-amber-300" />
            <span>HQ{hqTier > 0 ? ` ${hqTier}` : ''}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleWindow('stock_market')}
            title="Oslo Børs – Aksjemarked & AI-konkurrenter"
            className={`ttd-btn !px-1.5 !h-[26px] ${
              openWindows.has('stock_market') ? 'ttd-btn-active' : ''
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-300" />
            <span>Børs</span>
          </button>
        </div>

        <div className="ttd-divider" />

        {/* [Byer & Industrier] [Tog & Biler] */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onToggleWindow('directory')}
            title="Byer, industrier og stasjonsoversikt"
            className={`ttd-btn !px-1.5 !h-[26px] ${
              openWindows.has('directory') ? 'ttd-btn-active' : ''
            }`}
          >
            <MapPin className="w-3.5 h-3.5 text-emerald-300" />
            <span className="hidden 2xl:inline">Byer & Industrier</span>
            <span className="2xl:hidden">Byer & Kart</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleWindow('vehicles')}
            title="Alle dine tog, busser og lastebiler"
            className={`ttd-btn !px-1.5 !h-[26px] ttd-num ${
              openWindows.has('vehicles') ? 'ttd-btn-active' : ''
            }`}
          >
            <TrainFront className="w-3.5 h-3.5 text-sky-300" />
            <span>Flåte ({playerVehicleCount})</span>
          </button>
        </div>

        <div className="ttd-divider" />

        {/* [Jernbane] [Vei] [Rive] */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onToggleWindow('rail_palette')}
            title="Bygg jernbane, togstasjoner, signaler og togdepot"
            className={`ttd-btn ttd-btn-green !px-2 !h-[26px] ${
              openWindows.has('rail_palette') || isRailTool
                ? 'ttd-btn-active'
                : ''
            }`}
          >
            <TrainFront className="w-3.5 h-3.5" />
            <span>Jernbane</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleWindow('road_palette')}
            title="Bygg vei, bussholdeplass, lasteterminal og bildepot"
            className={`ttd-btn ttd-btn-green !px-2 !h-[26px] ${
              openWindows.has('road_palette') || isRoadTool
                ? 'ttd-btn-active'
                : ''
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Vei</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onSelectTool(activeTool === 'BULLDOZE' ? 'SELECT' : 'BULLDOZE')
            }
            title="Rive / Bulldoser felt"
            className={`ttd-btn ttd-btn-red !px-1.5 !h-[26px] ${
              activeTool === 'BULLDOZE' ? 'ttd-btn-active' : ''
            }`}
          >
            <Hammer className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Rive</span>
          </button>
        </div>
      </div>

      {/* Right Cluster: [PIN Klasserom] [Test] */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={() => onToggleWindow('classroom')}
          title="Lærer / Klasserom – Live PIN-økt og ledertavle"
          className={`ttd-btn ${
            connectedPin ? 'ttd-btn-green' : 'ttd-btn-teal'
          } !px-2 !h-[26px] ${
            openWindows.has('classroom') ? 'ttd-btn-active' : ''
          }`}
        >
          <GraduationCap className="w-3.5 h-3.5 text-amber-200" />
          {connectedPin ? (
            <span className="flex items-center gap-1 ttd-num">
              <span className="w-1.5 h-1.5 bg-amber-300 animate-pulse" />
              <span>PIN {connectedPin}</span>
              {classroomRemainingSec !== null && (
                <span className="bg-black/45 px-1 text-[10px] text-amber-200">
                  {formatCountdown(classroomRemainingSec)}
                </span>
              )}
            </span>
          ) : (
            <span>Klasserom</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onToggleWindow('quick_test')}
          title="Hurtigtest & 4-stegs oppstartsguide"
          className={`ttd-btn !px-1.5 !h-[26px] ${
            openWindows.has('quick_test') ? 'ttd-btn-active' : ''
          }`}
        >
          <Wrench className="w-3.5 h-3.5 text-amber-300" />
          <span>Test</span>
        </button>
      </div>
    </header>
  );
};
