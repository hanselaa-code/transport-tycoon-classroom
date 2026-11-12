import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, X, Sparkles } from 'lucide-react';
import type { GameSpeed, GameState, ScenarioType, Tile, ToolType } from './types/game';
import { GameEngine } from './core';
import { IsometricViewport } from './renderer';
import {
  createClassroomSession,
  joinClassroomSession,
  pushStudentTelemetry,
  subscribeToClassroom,
  type ClassroomSession,
  type StudentTelemetry,
} from './firebase/classroom';
import { TopToolbar, type WindowId } from './ui/TopToolbar';
import { BottomStatusBar } from './ui/BottomStatusBar';
import { ConstructionPalette } from './ui/ConstructionPalette';
import { DirectoryWindow } from './ui/windows/DirectoryWindow';
import { VehiclesListWindow } from './ui/windows/VehiclesListWindow';
import {
  DepotAndOrdersWindow,
  type DepotSelection,
} from './ui/windows/DepotAndOrdersWindow';
import { CompanyFinancesWindow } from './ui/windows/CompanyFinancesWindow';
import { PersonalFinancesWindow } from './ui/windows/PersonalFinancesWindow';
import { HQWindow } from './ui/windows/HQWindow';
import { StockMarketWindow } from './ui/windows/StockMarketWindow';
import { ClassroomWindow } from './ui/windows/ClassroomWindow';
import { SaveLoadWindow } from './ui/windows/SaveLoadWindow';
import { QuickTestWindow } from './ui/windows/QuickTestWindow';
import { formatGameDate } from './ui/formatters';

const STUDENT_ID_KEY = 'tt_classroom_student_id_v1';

function getOrCreateStudentId(): string {
  try {
    const existing = window.localStorage.getItem(STUDENT_ID_KEY);
    if (existing && existing.length >= 4) return existing;
    const created = `elev-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(STUDENT_ID_KEY, created);
    return created;
  } catch {
    return `elev-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function computeOperatingAnnualProfit(s: GameState): number {
  const pnl = s.corporate.currentYearPnL;
  return (
    pnl.freightRevenue -
    (pnl.vehicleRunningCost +
      pnl.loanInterestCost +
      pnl.ownerSalaryCost +
      pnl.employerPayrollTaxCost)
  );
}

export const App: React.FC = () => {
  // Initialize GameEngine once and auto-load saved game if present
  const initBundle = useMemo(() => {
    const eng = new GameEngine();
    let loadedSave = false;
    try {
      if (eng.hasSavedGame()) {
        loadedSave = eng.loadFromLocalStorage();
      }
    } catch {
      loadedSave = false;
    }
    return { engine: eng, loadedSave, initialState: eng.getState() };
  }, []);

  const engine = initBundle.engine;
  const [state, setState] = useState<GameState>(initBundle.initialState);
  const [showResumeBanner, setShowResumeBanner] = useState<boolean>(
    initBundle.loadedSave
  );

  // Viewport & Tool state
  const [activeTool, setActiveTool] = useState<ToolType>('SELECT');
  const [stationLength, setStationLength] = useState<number>(2);
  const [mapRotation, setMapRotation] = useState<number>(0);
  const [zoomCommand, setZoomCommand] = useState<{
    type: 'IN' | 'OUT';
    seq: number;
  } | null>(null);
  const [focusTile, setFocusTile] = useState<{
    x: number;
    y: number;
    seq: number;
  } | null>(null);

  // Window manager state (open windows + zIndex stacking order)
  const [openWindows, setOpenWindows] = useState<Set<WindowId>>(
    () => new Set<WindowId>(initBundle.loadedSave ? [] : ['quick_test'])
  );
  const [windowOrder, setWindowOrder] = useState<WindowId[]>(
    () => (initBundle.loadedSave ? [] : ['quick_test'])
  );

  // Depot / Vehicle / Station selection state
  const [selectedDepot, setSelectedDepot] = useState<DepotSelection | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [highlightedStationId, setHighlightedStationId] = useState<string | null>(
    null
  );
  const [pickingOrdersForVehicleId, setPickingOrdersForVehicleId] = useState<
    string | null
  >(null);

  // Classroom Live Session & Telemetry state
  const studentIdRef = useRef<string>(getOrCreateStudentId());
  const [classroomRole, setClassroomRole] = useState<'student' | 'teacher' | null>(
    null
  );
  const [classroomSession, setClassroomSession] =
    useState<ClassroomSession | null>(null);
  const [classroomStudents, setClassroomStudents] = useState<StudentTelemetry[]>(
    []
  );
  const [classroomRemainingSec, setClassroomRemainingSec] = useState<
    number | null
  >(null);
  const [lastTelemetrySentAt, setLastTelemetrySentAt] = useState<number | null>(
    null
  );

  // Engine subscription & game loop lifecycle
  useEffect(() => {
    const unsub = engine.subscribe((next) => {
      setState({ ...next });
    });
    engine.startLoop();

    const handleBeforeUnload = () => {
      try {
        engine.saveToLocalStorage();
      } catch {
        // ignore
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      engine.stopLoop();
      unsub();
    };
  }, [engine]);

  // Auto-exit PLACE_HQ tool once HQ is placed
  useEffect(() => {
    if (activeTool === 'PLACE_HQ' && state.corporate.hqTile) {
      setActiveTool('SELECT');
    }
  }, [activeTool, state.corporate.hqTile]);

  // Window helpers
  const bringToFront = useCallback((id: string) => {
    const wid = id as WindowId;
    setWindowOrder((prev) => [...prev.filter((w) => w !== wid), wid]);
  }, []);

  const openWindow = useCallback((id: WindowId) => {
    setOpenWindows((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setWindowOrder((prev) => [...prev.filter((w) => w !== id), id]);
  }, []);

  const closeWindow = useCallback((id: string) => {
    const wid = id as WindowId;
    setOpenWindows((prev) => {
      const next = new Set(prev);
      next.delete(wid);
      return next;
    });
    if (wid === 'rail_palette') {
      setActiveTool((cur) =>
        cur === 'RAIL' ||
        cur === 'RAIL_DEPOT' ||
        cur === 'TRAIN_STATION' ||
        cur === 'SIGNAL'
          ? 'SELECT'
          : cur
      );
    }
    if (wid === 'road_palette') {
      setActiveTool((cur) =>
        cur === 'ROAD' ||
        cur === 'ROAD_DEPOT' ||
        cur === 'BUS_STOP' ||
        cur === 'TRUCK_BAY'
          ? 'SELECT'
          : cur
      );
    }
  }, []);

  const toggleWindow = useCallback(
    (id: WindowId) => {
      setOpenWindows((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
          setWindowOrder((ord) => [...ord.filter((w) => w !== id), id]);
        }
        return next;
      });
    },
    []
  );

  const getZIndex = (id: WindowId): number => {
    const idx = windowOrder.indexOf(id);
    return 200 + (idx >= 0 ? idx * 5 : 0);
  };

  // Camera & Tool callbacks
  const handleZoomIn = useCallback(() => {
    setZoomCommand((prev) => ({ type: 'IN', seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomCommand((prev) => ({ type: 'OUT', seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const handleRotateMap = useCallback(() => {
    setMapRotation((prev) => (prev + 1) % 4);
  }, []);

  const handleFocusTile = useCallback((x: number, y: number) => {
    setFocusTile((prev) => ({ x, y, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const handleSetSpeed = useCallback(
    (spd: GameSpeed) => {
      engine.setSpeed(spd);
    },
    [engine]
  );

  const handleSelectTool = useCallback((tool: ToolType) => {
    if (tool !== 'SELECT') {
      setPickingOrdersForVehicleId(null);
    }
    setActiveTool(tool);
  }, []);

  // Multi-tile train station & newly placed depot helper
  const handleTileInteract = useCallback(
    (x: number, y: number, tile: Tile) => {
      if (
        (activeTool === 'ROAD_DEPOT' || activeTool === 'RAIL_DEPOT') &&
        (tile.depot === 'ROAD' || tile.depot === 'RAIL')
      ) {
        setActiveTool('SELECT');
        setSelectedDepot({ x, y, depotType: tile.depot });
        setSelectedVehicleId(null);
        openWindow('depot');
        return;
      }

      if (activeTool === 'TRAIN_STATION' && stationLength > 1) {
        const curState = engine.getState();
        const placed = curState.stations.find((st) =>
          st.tiles.some((t) => t.x === x && t.y === y)
        );
        if (placed && placed.tiles.length < stationLength) {
          // Prefer expanding along adjacent rail axis if present, else +X
          const hasRailY =
            curState.tiles.some(
              (t) => t.x === x && (t.y === y - 1 || t.y === y + 1) && t.rail
            ) &&
            !curState.tiles.some(
              (t) => t.y === y && (t.x === x - 1 || t.x === x + 1) && t.rail
            );
          for (let step = 1; step < stationLength; step++) {
            const nx = hasRailY ? x : x + step;
            const ny = hasRailY ? y + step : y;
            engine.applyTool(nx, ny, 'TRAIN_STATION');
          }
        }
      }
    },
    [activeTool, stationLength, engine, openWindow]
  );

  // Map entity click handlers
  const handleDepotClick = useCallback(
    (x: number, y: number, depotType: 'ROAD' | 'RAIL') => {
      setSelectedDepot({ x, y, depotType });
      setSelectedVehicleId(null);
      openWindow('depot');
    },
    [openWindow]
  );

  const handleVehicleClick = useCallback(
    (vehicleId: string) => {
      const veh = engine.getState().vehicles.find((v) => v.id === vehicleId);
      if (veh && veh.ownerId && veh.ownerId !== 'player') return;
      setSelectedVehicleId(vehicleId);
      openWindow('depot');
    },
    [engine, openWindow]
  );

  const handleStationClick = useCallback(
    (stationId: string) => {
      setHighlightedStationId(stationId);
      openWindow('directory');
    },
    [openWindow]
  );

  // Station Order Picker callback passed into IsometricViewport
  const selectedStationOrderPicker = useMemo(() => {
    if (!pickingOrdersForVehicleId) return null;
    return (stationId: string) => {
      const cur = engine.getState();
      const veh = cur.vehicles.find((v) => v.id === pickingOrdersForVehicleId);
      const st = cur.stations.find((s) => s.id === stationId);
      if (!veh || !st) return;
      if (st.ownerId && st.ownerId !== 'player') return;
      if (veh.network === 'RAIL' && st.kind !== 'TRAIN_STATION') return;
      if (veh.network === 'ROAD' && st.kind === 'TRAIN_STATION') return;

      engine.updateVehicleOrders(veh.id, [...veh.orders, stationId]);
    };
  }, [pickingOrdersForVehicleId, engine]);

  // Classroom subscription & countdown timer
  useEffect(() => {
    const pin = classroomSession?.pin;
    if (!pin) {
      setClassroomStudents([]);
      setClassroomRemainingSec(null);
      return;
    }

    const unsub = subscribeToClassroom(pin, (sess, studs) => {
      if (sess) setClassroomSession(sess);
      setClassroomStudents(studs);
    });

    return () => unsub();
  }, [classroomSession?.pin]);

  useEffect(() => {
    if (!classroomSession) {
      setClassroomRemainingSec(null);
      return;
    }
    const tickTimer = () => {
      const rem = Math.max(
        0,
        Math.floor((classroomSession.endsAt - Date.now()) / 1000)
      );
      setClassroomRemainingSec(rem);
    };
    tickTimer();
    const id = window.setInterval(tickTimer, 1000);
    return () => window.clearInterval(id);
  }, [classroomSession]);

  // Push student telemetry helper
  const pushCurrentTelemetry = useCallback(
    async (pin: string, studentNameOverride?: string, companyNameOverride?: string) => {
      const snap = engine.getState();
      const payload: StudentTelemetry = {
        studentId: studentIdRef.current,
        studentName: studentNameOverride ?? snap.personal.ownerName,
        companyName: companyNameOverride ?? snap.corporate.companyName,
        companyValue: snap.corporate.companyValue,
        personalNetWorth: snap.personal.personalNetWorth,
        hqTier: snap.corporate.hqTier,
        totalTaxPaid: snap.personal.lifetimeTaxPaid,
        annualProfit: computeOperatingAnnualProfit(snap),
        updatedAt: Date.now(),
      };
      await pushStudentTelemetry(pin, payload);
      setLastTelemetrySentAt(Date.now());
    },
    [engine]
  );

  // Every 30 seconds push summary telemetry when joined as student
  useEffect(() => {
    const pin = classroomSession?.pin;
    if (classroomRole !== 'student' || !pin) return;

    const intervalId = window.setInterval(() => {
      void pushCurrentTelemetry(pin);
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, [classroomRole, classroomSession?.pin, pushCurrentTelemetry]);

  const handleStudentJoin = useCallback(
    async (pin: string, studentName: string, companyName: string) => {
      const found = await joinClassroomSession(pin);
      if (!found) {
        return {
          ok: false,
          message: `Fant ingen aktiv klasseroms-økt med PIN ${pin}. Sjekk koden på tavla!`,
        };
      }
      engine.renameCompanyAndOwner(companyName, studentName);
      setClassroomRole('student');
      setClassroomSession(found);
      await pushCurrentTelemetry(found.pin, studentName, companyName);
      return {
        ok: true,
        message: `Tilkoblet klasserom PIN ${found.pin}! Dine nøkkeltall er nå synlige på ledertavlen.`,
      };
    },
    [engine, pushCurrentTelemetry]
  );

  const handleTeacherCreate = useCallback(
    async (durationMinutes: 30 | 45, scenario: ScenarioType) => {
      const created = await createClassroomSession(durationMinutes, scenario);
      setClassroomRole('teacher');
      setClassroomSession(created);
      return {
        ok: true,
        message: `Opprettet klasseroms-økt med PIN ${created.pin} (${durationMinutes} min)!`,
      };
    },
    []
  );

  const handleClassroomDisconnect = useCallback(() => {
    setClassroomRole(null);
    setClassroomSession(null);
    setClassroomStudents([]);
    setClassroomRemainingSec(null);
  }, []);

  const playerVehicleCount = useMemo(
    () =>
      state.vehicles.filter((v) => !v.ownerId || v.ownerId === 'player').length,
    [state.vehicles]
  );

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0e171d] select-none">
      {/* 3D Isometric Game World */}
      <div className="absolute inset-0 top-9 bottom-9">
        <IsometricViewport
          engine={engine}
          state={state}
          activeTool={activeTool}
          mapRotation={mapRotation}
          zoomCommand={zoomCommand}
          focusTile={focusTile}
          selectedStationOrderPicker={selectedStationOrderPicker}
          onTileInteract={handleTileInteract}
          onDepotClick={handleDepotClick}
          onStationClick={handleStationClick}
          onVehicleClick={handleVehicleClick}
        />
      </div>

      {/* Top Transport Tycoon Toolbar */}
      <TopToolbar
        speed={state.speed}
        activeTool={activeTool}
        openWindows={openWindows}
        playerVehicleCount={playerVehicleCount}
        hqTier={state.corporate.hqTier}
        connectedPin={classroomSession?.pin ?? null}
        classroomRemainingSec={classroomRemainingSec}
        isBankruptWarning={
          state.corporate.cash < 0 || state.corporate.isBankruptWarning
        }
        onSetSpeed={handleSetSpeed}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onRotateMap={handleRotateMap}
        onSelectTool={handleSelectTool}
        onToggleWindow={toggleWindow}
      />

      {/* Auto-load Resume Banner with "Start Fresh" button */}
      {showResumeBanner && (
        <div className="fixed top-22 2xl:top-12 left-1/2 -translate-x-1/2 z-[850] ttd-window px-3 py-1.5 flex items-center gap-3 text-xs">
          <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
          <span>
            Lastet automatisk lagret spill (<strong>{state.corporate.companyName}</strong>,{' '}
            {formatGameDate(state.date)}).
          </span>
          <button
            type="button"
            onClick={() => {
              engine.resetNewGame('standard', 64);
              engine.saveToLocalStorage();
              setShowResumeBanner(false);
              openWindow('quick_test');
            }}
            className="ttd-btn ttd-btn-brass !py-1 !px-2.5"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Start helt på nytt</span>
          </button>
          <button
            type="button"
            onClick={() => setShowResumeBanner(false)}
            className="ttd-btn !px-1.5 !py-1"
            title="Lukk melding"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Draggable TTD Windows */}
      {openWindows.has('rail_palette') && (
        <ConstructionPalette
          mode="RAIL"
          activeTool={activeTool}
          stationLength={stationLength}
          zIndex={getZIndex('rail_palette')}
          onFocus={bringToFront}
          onClose={closeWindow}
          onSelectTool={handleSelectTool}
          onSetStationLength={setStationLength}
        />
      )}

      {openWindows.has('road_palette') && (
        <ConstructionPalette
          mode="ROAD"
          activeTool={activeTool}
          stationLength={stationLength}
          zIndex={getZIndex('road_palette')}
          onFocus={bringToFront}
          onClose={closeWindow}
          onSelectTool={handleSelectTool}
          onSetStationLength={setStationLength}
        />
      )}

      {openWindows.has('directory') && (
        <DirectoryWindow
          state={state}
          highlightedStationId={highlightedStationId}
          zIndex={getZIndex('directory')}
          onFocus={bringToFront}
          onClose={(id) => {
            setHighlightedStationId(null);
            closeWindow(id);
          }}
          onFocusTile={handleFocusTile}
        />
      )}

      {openWindows.has('vehicles') && (
        <VehiclesListWindow
          state={state}
          zIndex={getZIndex('vehicles')}
          onFocus={bringToFront}
          onClose={closeWindow}
          onInspectVehicle={(vid) => {
            setSelectedVehicleId(vid);
            openWindow('depot');
          }}
          onFocusTile={handleFocusTile}
        />
      )}

      {openWindows.has('depot') && (
        <DepotAndOrdersWindow
          engine={engine}
          state={state}
          selectedDepot={selectedDepot}
          selectedVehicleId={selectedVehicleId}
          isPickingStationOrder={Boolean(pickingOrdersForVehicleId)}
          zIndex={getZIndex('depot')}
          onFocus={bringToFront}
          onClose={closeWindow}
          onSelectVehicle={setSelectedVehicleId}
          onSelectDepot={setSelectedDepot}
          onToggleStationPicker={(vid) => {
            if (vid) setActiveTool('SELECT');
            setPickingOrdersForVehicleId(vid);
          }}
          onFocusTile={handleFocusTile}
        />
      )}

      {openWindows.has('company_finances') && (
        <CompanyFinancesWindow
          engine={engine}
          state={state}
          zIndex={getZIndex('company_finances')}
          onFocus={bringToFront}
          onClose={closeWindow}
        />
      )}

      {openWindows.has('personal_finances') && (
        <PersonalFinancesWindow
          engine={engine}
          state={state}
          zIndex={getZIndex('personal_finances')}
          onFocus={bringToFront}
          onClose={closeWindow}
        />
      )}

      {openWindows.has('hq') && (
        <HQWindow
          engine={engine}
          state={state}
          activeTool={activeTool}
          zIndex={getZIndex('hq')}
          onFocus={bringToFront}
          onClose={closeWindow}
          onSelectTool={handleSelectTool}
          onFocusTile={handleFocusTile}
        />
      )}

      {openWindows.has('stock_market') && (
        <StockMarketWindow
          engine={engine}
          state={state}
          zIndex={getZIndex('stock_market')}
          onFocus={bringToFront}
          onClose={closeWindow}
        />
      )}

      {openWindows.has('classroom') && (
        <ClassroomWindow
          role={classroomRole}
          session={classroomSession}
          students={classroomStudents}
          remainingSec={classroomRemainingSec}
          defaultStudentName={state.personal.ownerName}
          defaultCompanyName={state.corporate.companyName}
          lastTelemetrySentAt={lastTelemetrySentAt}
          zIndex={getZIndex('classroom')}
          onFocus={bringToFront}
          onClose={closeWindow}
          onStudentJoin={handleStudentJoin}
          onTeacherCreate={handleTeacherCreate}
          onPushNow={async () => {
            if (classroomSession?.pin) {
              await pushCurrentTelemetry(classroomSession.pin);
            }
          }}
          onDisconnect={handleClassroomDisconnect}
        />
      )}

      {openWindows.has('save_load') && (
        <SaveLoadWindow
          engine={engine}
          state={state}
          zIndex={getZIndex('save_load')}
          onFocus={bringToFront}
          onClose={closeWindow}
        />
      )}

      {openWindows.has('quick_test') && (
        <QuickTestWindow
          engine={engine}
          zIndex={getZIndex('quick_test')}
          onFocus={bringToFront}
          onClose={closeWindow}
          onFocusTile={handleFocusTile}
        />
      )}

      {/* Bottom TTD Status Bar */}
      <BottomStatusBar
        date={state.date}
        companyName={state.corporate.companyName}
        companyCash={state.corporate.cash}
        personalCash={state.personal.cash}
        news={state.news}
        activeTool={activeTool}
        isPickingStationOrder={Boolean(pickingOrdersForVehicleId)}
        onOpenCompanyFinances={() => openWindow('company_finances')}
        onOpenPersonalFinances={() => openWindow('personal_finances')}
        onCancelTool={() => {
          setPickingOrdersForVehicleId(null);
          setActiveTool('SELECT');
        }}
      />
    </div>
  );
};

export default App;
