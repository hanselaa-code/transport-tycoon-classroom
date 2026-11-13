import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BridgeType,
  GameSpeed,
  GameState,
  RemotePlayerWorldSlice,
  ScenarioType,
  Tile,
  ToolType,
  WorldSetupConfig,
} from './types/game';
import { GameEngine } from './core';
import { IsometricViewport } from './renderer';
import {
  ADMIN_TEACHER_EMAIL,
  signInTeacherWithGoogle,
  signOutTeacher,
  subscribeToTeacherAuth,
  type TeacherUser,
} from './firebase/auth';
import {
  createClassroomSession,
  joinClassroomWithWorldAssignment,
  pushStudentTelemetry,
  subscribeToClassroom,
  type ClassroomSession,
  type StudentTelemetry,
} from './firebase/classroom';
import {
  publishPlayerWorldSlice,
  subscribeToWorldPeers,
} from './firebase/multiplayer';
import { StartLobbyScreen } from './ui/StartLobbyScreen';
import {
  BridgePickerModal,
  type PendingBridgeDragRequest,
} from './ui/BridgePickerModal';
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
import { LandInfoWindow } from './ui/windows/LandInfoWindow';
import { StationDetailWindow } from './ui/windows/StationDetailWindow';

const STUDENT_ID_KEY = 'tt_classroom_student_id_v1';
const LAST_PIN_FORM_KEY = 'tt_last_pin_form_v1';

type ActivePlayMode = 'student_pin' | 'teacher_pin' | 'teacher_solo' | null;

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

function loadSavedPinForm(): {
  pin: string;
  playerName: string;
  companyName: string;
} {
  try {
    const raw = window.sessionStorage.getItem(LAST_PIN_FORM_KEY);
    if (!raw) return { pin: '', playerName: '', companyName: '' };
    const parsed = JSON.parse(raw) as {
      pin?: string;
      playerName?: string;
      companyName?: string;
    };
    return {
      pin: parsed.pin ?? '',
      playerName: parsed.playerName ?? '',
      companyName: parsed.companyName ?? '',
    };
  } catch {
    return { pin: '', playerName: '', companyName: '' };
  }
}

function savePinForm(pin: string, playerName: string, companyName: string): void {
  try {
    window.sessionStorage.setItem(
      LAST_PIN_FORM_KEY,
      JSON.stringify({ pin, playerName, companyName })
    );
  } catch {
    // ignore storage errors
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
  const initBundle = useMemo(() => {
    const eng = new GameEngine();
    return { engine: eng, initialState: eng.getState(), savedForm: loadSavedPinForm() };
  }, []);

  const engine = initBundle.engine;
  const [state, setState] = useState<GameState>(initBundle.initialState);

  // Auth & Entry Gate State
  const [teacherUser, setTeacherUser] = useState<TeacherUser | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [activePlayMode, setActivePlayMode] = useState<ActivePlayMode>(null);

  // Viewport & Tool state
  const [activeTool, setActiveTool] = useState<ToolType>('SELECT');
  const [isQueryLandActive, setIsQueryLandActive] = useState<boolean>(false);
  const [landInfoCoords, setLandInfoCoords] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [stationLength, setStationLength] = useState<number>(2);
  const [selectedBridgeType, setSelectedBridgeType] =
    useState<BridgeType>('STEEL');
  const [pendingBridgeDrag, setPendingBridgeDrag] =
    useState<PendingBridgeDragRequest | null>(null);
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
    () => new Set<WindowId>(['quick_test'])
  );
  const [windowOrder, setWindowOrder] = useState<WindowId[]>(['quick_test']);

  // Depot / Vehicle / Station selection state
  const [selectedDepot, setSelectedDepot] = useState<DepotSelection | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [highlightedStationId, setHighlightedStationId] = useState<string | null>(
    null
  );
  const [pickingOrdersForVehicleId, setPickingOrdersForVehicleId] = useState<
    string | null
  >(null);

  // Classroom Live Session, World Bucket & Telemetry state
  const studentIdRef = useRef<string>(getOrCreateStudentId());
  const initializedTeacherWorldRef = useRef<string | null>(null);

  const [classroomRole, setClassroomRole] = useState<'student' | 'teacher' | null>(
    null
  );
  const [classroomSession, setClassroomSession] =
    useState<ClassroomSession | null>(null);
  const [classroomStudents, setClassroomStudents] = useState<StudentTelemetry[]>(
    []
  );
  const [assignedWorldIndex, setAssignedWorldIndex] = useState<number | null>(
    null
  );
  const [assignedSlotInWorld, setAssignedSlotInWorld] = useState<number | null>(
    null
  );
  const [assignedPlayerColor, setAssignedPlayerColor] = useState<string | null>(
    null
  );
  const [classroomRemainingSec, setClassroomRemainingSec] = useState<
    number | null
  >(null);
  const [lastTelemetrySentAt, setLastTelemetrySentAt] = useState<number | null>(
    null
  );

  const isTeacherAdmin = Boolean(
    teacherUser && teacherUser.email.toLowerCase() === ADMIN_TEACHER_EMAIL
  );

  // Subscribe to Firebase Teacher Auth
  useEffect(() => {
    const unsub = subscribeToTeacherAuth((user, ready) => {
      setTeacherUser(user);
      setAuthReady(ready);
    });
    return () => unsub();
  }, []);

  // Enforce entry gate if teacher logs out while in teacher play mode
  useEffect(() => {
    if (
      authReady &&
      !isTeacherAdmin &&
      (activePlayMode === 'teacher_solo' || activePlayMode === 'teacher_pin')
    ) {
      setActivePlayMode(null);
    }
  }, [authReady, isTeacherAdmin, activePlayMode]);

  // Engine state subscription
  useEffect(() => {
    const unsub = engine.subscribe((next) => {
      setState({ ...next });
    });
    return () => {
      engine.stopLoop();
      unsub();
    };
  }, [engine]);

  // Run simulation loop ONLY when inside active gameplay
  const isInActiveGameplay =
    (activePlayMode === 'student_pin' && Boolean(classroomSession)) ||
    ((activePlayMode === 'teacher_pin' || activePlayMode === 'teacher_solo') &&
      isTeacherAdmin);

  useEffect(() => {
    if (isInActiveGameplay) {
      engine.startLoop();
    } else {
      engine.stopLoop();
    }
  }, [engine, isInActiveGameplay]);

  // Save on beforeunload when in gameplay
  useEffect(() => {
    if (!isInActiveGameplay) return;
    const handleBeforeUnload = () => {
      try {
        engine.saveToLocalStorage();
      } catch {
        // ignore
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [engine, isInActiveGameplay]);

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
        cur === 'RAIL_BRIDGE' ||
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
        cur === 'ROAD_BRIDGE' ||
        cur === 'ROAD_DEPOT' ||
        cur === 'BUS_STOP' ||
        cur === 'TRUCK_BAY'
          ? 'SELECT'
          : cur
      );
    }
  }, []);

  const toggleWindow = useCallback((id: WindowId) => {
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
  }, []);

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
      setIsQueryLandActive(false);
    }
    setActiveTool(tool);
  }, []);

  const handleToggleQueryLand = useCallback(() => {
    setPickingOrdersForVehicleId(null);
    setActiveTool('SELECT');
    setIsQueryLandActive((prev) => !prev);
  }, []);

  // Multi-tile train station, newly placed depot, and [?] Land Area Info helper
  const handleTileInteract = useCallback(
    (x: number, y: number, tile: Tile) => {
      if (
        (activeTool === 'ROAD_DEPOT' || activeTool === 'RAIL_DEPOT') &&
        (tile.depot === 'ROAD' || tile.depot === 'RAIL') &&
        (!tile.ownerId || tile.ownerId === 'player')
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
        return;
      }

      if (activeTool === 'SELECT') {
        const isStationOrDepot =
          Boolean(tile.stationId) ||
          tile.depot === 'ROAD' ||
          tile.depot === 'RAIL';
        if (isQueryLandActive || !isStationOrDepot) {
          setLandInfoCoords({ x, y });
          openWindow('land_info');
        }
      }
    },
    [activeTool, isQueryLandActive, stationLength, engine, openWindow]
  );

  // Map entity click handlers
  const handleOpenStation = useCallback(
    (stationId: string) => {
      setSelectedStationId(stationId);
      setHighlightedStationId(stationId);
      openWindow('station_detail');
    },
    [openWindow]
  );

  const handleDepotClick = useCallback(
    (x: number, y: number, depotType: 'ROAD' | 'RAIL') => {
      const cur = engine.getState();
      const tile = cur.tiles.find((t) => t.x === x && t.y === y);
      if (tile?.ownerId && tile.ownerId !== 'player') {
        setLandInfoCoords({ x, y });
        openWindow('land_info');
        return;
      }
      setSelectedDepot({ x, y, depotType });
      setSelectedVehicleId(null);
      openWindow('depot');
    },
    [engine, openWindow]
  );

  const handleVehicleClick = useCallback(
    (vehicleId: string) => {
      const veh = engine.getState().vehicles.find((v) => v.id === vehicleId);
      if (!veh) return;
      setSelectedVehicleId(vehicleId);
      openWindow('depot');
    },
    [engine, openWindow]
  );

  const handleStationClick = useCallback(
    (stationId: string) => {
      handleOpenStation(stationId);
    },
    [handleOpenStation]
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
    if (
      !classroomSession ||
      classroomSession.durationMinutes === 0 ||
      classroomSession.endsAt === 0
    ) {
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
    async (
      pin: string,
      worldIdx: number,
      slotIdx: number,
      pColor: string,
      studentNameOverride?: string,
      companyNameOverride?: string
    ) => {
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
        worldIndex: worldIdx,
        slotInWorld: slotIdx,
        playerColor: pColor,
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

    const wIdx = assignedWorldIndex ?? 1;
    const sIdx = assignedSlotInWorld ?? 1;
    const pCol = assignedPlayerColor ?? '#2563eb';

    const intervalId = window.setInterval(() => {
      void pushCurrentTelemetry(pin, wIdx, sIdx, pCol);
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, [
    classroomRole,
    classroomSession?.pin,
    assignedWorldIndex,
    assignedSlotInWorld,
    assignedPlayerColor,
    pushCurrentTelemetry,
  ]);

  // Real-Time Multiplayer Shared-World Sync (Peers in same Verden #N)
  useEffect(() => {
    const pin = classroomSession?.pin;
    const isMultiplayer =
      classroomSession?.worldSetup?.gameMode === 'multiplayer';
    if (!isInActiveGameplay || !pin || !isMultiplayer || !assignedWorldIndex) {
      return;
    }

    const selfClientId =
      classroomRole === 'teacher'
        ? `teacher-${studentIdRef.current}`
        : studentIdRef.current;

    const unsubPeers = subscribeToWorldPeers(
      pin,
      assignedWorldIndex,
      selfClientId,
      (peers) => {
        engine.syncMultiplayerPeers(peers as RemotePlayerWorldSlice[]);
      }
    );

    const publishNow = () => {
      const slice = engine.exportMultiplayerSlice();
      // Teachers observing passively only publish if they actually placed infrastructure/vehicles
      if (
        classroomRole === 'teacher' &&
        slice.modifiedTiles.length === 0 &&
        slice.stations.length === 0 &&
        slice.vehicles.length === 0 &&
        !slice.hqTile
      ) {
        return;
      }
      void publishPlayerWorldSlice(pin, assignedWorldIndex, selfClientId, slice);
    };

    publishNow();
    const intervalId = window.setInterval(publishNow, 2500);

    return () => {
      window.clearInterval(intervalId);
      unsubPeers();
      engine.syncMultiplayerPeers([]);
    };
  }, [
    engine,
    isInActiveGameplay,
    classroomSession?.pin,
    classroomSession?.worldSetup?.gameMode,
    assignedWorldIndex,
    classroomRole,
  ]);

  // Immediate debounced publish when player builds roads/rails/bridges/stations/vehicles in multiplayer
  useEffect(() => {
    const pin = classroomSession?.pin;
    const isMultiplayer =
      classroomSession?.worldSetup?.gameMode === 'multiplayer';
    if (!isInActiveGameplay || !pin || !isMultiplayer || !assignedWorldIndex) {
      return;
    }

    const selfClientId =
      classroomRole === 'teacher'
        ? `teacher-${studentIdRef.current}`
        : studentIdRef.current;

    const timerId = window.setTimeout(() => {
      const slice = engine.exportMultiplayerSlice();
      if (
        classroomRole === 'teacher' &&
        slice.modifiedTiles.length === 0 &&
        slice.stations.length === 0 &&
        slice.vehicles.length === 0 &&
        !slice.hqTile
      ) {
        return;
      }
      void publishPlayerWorldSlice(pin, assignedWorldIndex, selfClientId, slice);
    }, 350);

    return () => window.clearTimeout(timerId);
  }, [
    engine,
    isInActiveGameplay,
    classroomSession?.pin,
    classroomSession?.worldSetup?.gameMode,
    assignedWorldIndex,
    classroomRole,
    state.networkRevision,
    state.stations.length,
    state.vehicles.length,
  ]);

  // Student Join with PIN + World Bucket Assignment
  const handleStudentJoin = useCallback(
    async (pin: string, studentName: string, companyName: string) => {
      const res = await joinClassroomWithWorldAssignment(
        pin,
        studentIdRef.current,
        studentName,
        companyName
      );
      if (!res.ok || !res.session) {
        return {
          ok: false,
          message:
            res.error ??
            `Fant ingen aktiv klasseroms-økt med PIN ${pin}. Sjekk koden på tavla!`,
        };
      }

      const wIdx = res.worldIndex ?? 1;
      const sIdx = res.slotInWorld ?? 1;
      const pCol = res.playerColor ?? '#2563eb';
      const cleanName = studentName.trim();
      const cleanCompany = companyName.trim() || `${cleanName} AS`;

      savePinForm(res.session.pin, cleanName, cleanCompany);

      engine.resetNewGame(res.session.worldSetup);
      engine.setLocalPlayerIdentity({
        clientId: studentIdRef.current,
        ownerName: cleanName,
        companyName: cleanCompany,
        playerColor: pCol,
      });

      setClassroomRole('student');
      setClassroomSession(res.session);
      setAssignedWorldIndex(wIdx);
      setAssignedSlotInWorld(sIdx);
      setAssignedPlayerColor(pCol);
      setSelectedDepot(null);
      setSelectedVehicleId(null);
      setSelectedStationId(null);
      setOpenWindows(new Set<WindowId>(['quick_test']));
      setWindowOrder(['quick_test']);
      setActivePlayMode('student_pin');

      await pushCurrentTelemetry(
        res.session.pin,
        wIdx,
        sIdx,
        pCol,
        cleanName,
        cleanCompany
      );

      return {
        ok: true,
        message: `Tilkoblet PIN ${res.session.pin} • Verden #${wIdx}!`,
      };
    },
    [engine, pushCurrentTelemetry]
  );

  // Teacher Create Classroom PIN Session (from Lobby or in-game ClassroomWindow)
  const handleCreateClassroomPinSession = useCallback(
    async (durationMinutes: number, setupOrScenario: WorldSetupConfig | ScenarioType) => {
      try {
        const created = await createClassroomSession(
          durationMinutes,
          setupOrScenario
        );
        initializedTeacherWorldRef.current = null;
        setClassroomRole('teacher');
        setClassroomSession(created);
        setAssignedWorldIndex(1);
        setAssignedSlotInWorld(1);
        setAssignedPlayerColor('#eab308');
        return {
          ok: true,
          message: `Opprettet klasseroms-økt med PIN ${created.pin}!`,
        };
      } catch (err: unknown) {
        return {
          ok: false,
          message:
            (err as { message?: string })?.message ??
            'Kunne ikke opprette klasseroms-økt.',
        };
      }
    },
    []
  );

  // Teacher Enter 3D World of Active PIN Session (to inspect/play Verden #N)
  const handleEnterTeacherSessionWorld = useCallback(
    (worldIndex: number) => {
      if (!classroomSession || !isTeacherAdmin) return;
      const worldKey = `${classroomSession.pin}:seed-${classroomSession.worldSetup.seed}`;
      if (initializedTeacherWorldRef.current !== worldKey) {
        engine.resetNewGame(classroomSession.worldSetup);
        engine.setLocalPlayerIdentity({
          clientId: `teacher-${studentIdRef.current}`,
          ownerName: teacherUser?.displayName || 'Lærer',
          companyName: 'Lærer Transport AS',
          playerColor: '#eab308',
        });
        initializedTeacherWorldRef.current = worldKey;
      }
      setAssignedWorldIndex(worldIndex);
      setActivePlayMode('teacher_pin');
    },
    [classroomSession, isTeacherAdmin, engine, teacherUser]
  );

  // Teacher Start Solo Game immediately with chosen OpenTTD WorldSetupConfig
  const handleStartTeacherSoloGame = useCallback(
    (worldSetup: WorldSetupConfig) => {
      if (!isTeacherAdmin) return;
      initializedTeacherWorldRef.current = null;
      setClassroomRole(null);
      setClassroomSession(null);
      setClassroomStudents([]);
      setAssignedWorldIndex(null);
      setAssignedSlotInWorld(null);
      setAssignedPlayerColor('#2563eb');

      engine.resetNewGame(worldSetup);
      engine.setLocalPlayerIdentity({
        clientId: 'player',
        ownerName: teacherUser?.displayName || 'Lærer',
        companyName: 'Norsk Transport AS',
        playerColor: '#2563eb',
      });

      setSelectedDepot(null);
      setSelectedVehicleId(null);
      setSelectedStationId(null);
      setOpenWindows(new Set<WindowId>(['quick_test']));
      setWindowOrder(['quick_test']);
      setActivePlayMode('teacher_solo');
    },
    [isTeacherAdmin, engine, teacherUser]
  );

  const handleClassroomDisconnect = useCallback(() => {
    initializedTeacherWorldRef.current = null;
    engine.syncMultiplayerPeers([]);
    setClassroomRole(null);
    setClassroomSession(null);
    setClassroomStudents([]);
    setAssignedWorldIndex(null);
    setAssignedSlotInWorld(null);
    setAssignedPlayerColor(null);
    setClassroomRemainingSec(null);
    setActivePlayMode(null);
  }, [engine]);

  const handleReturnToMainMenu = useCallback(() => {
    setActivePlayMode(null);
  }, []);

  const handleSignOutTeacherAll = useCallback(async () => {
    await signOutTeacher();
    handleClassroomDisconnect();
  }, [handleClassroomDisconnect]);

  const playerVehicleCount = useMemo(
    () =>
      state.vehicles.filter((v) => !v.ownerId || v.ownerId === 'player').length,
    [state.vehicles]
  );

  // MANDATORY CLASSIC OPENTTD START LOBBY GATE
  if (!isInActiveGameplay) {
    return (
      <StartLobbyScreen
        teacherUser={teacherUser}
        authReady={authReady}
        activeTeacherSession={
          classroomRole === 'teacher' ? classroomSession : null
        }
        sessionStudents={classroomStudents}
        remainingSec={classroomRemainingSec}
        initialPin={initBundle.savedForm.pin}
        initialPlayerName={initBundle.savedForm.playerName}
        initialCompanyName={initBundle.savedForm.companyName}
        onJoinWithPin={handleStudentJoin}
        onSignInTeacher={signInTeacherWithGoogle}
        onSignOutTeacher={handleSignOutTeacherAll}
        onCreateClassroomPinSession={(dur, setup) =>
          handleCreateClassroomPinSession(dur, setup)
        }
        onStartTeacherSoloGame={handleStartTeacherSoloGame}
        onEnterTeacherSessionWorld={handleEnterTeacherSessionWorld}
        onCloseTeacherSession={handleClassroomDisconnect}
      />
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0e171d] select-none">
      {/* 3D Isometric Game World */}
      <div className="absolute inset-0 top-[36px] bottom-[32px]">
        <IsometricViewport
          engine={engine}
          state={state}
          activeTool={activeTool}
          selectedBridgeType={selectedBridgeType}
          mapRotation={mapRotation}
          zoomCommand={zoomCommand}
          focusTile={focusTile}
          selectedStationOrderPicker={selectedStationOrderPicker}
          onTileInteract={handleTileInteract}
          onDepotClick={handleDepotClick}
          onStationClick={handleStationClick}
          onVehicleClick={handleVehicleClick}
          onRequestBridgeChoice={(req) => setPendingBridgeDrag(req)}
        />
      </div>

      {/* Classic TTD 3-Bridge Selection Modal on Water Span Drag */}
      {pendingBridgeDrag && (
        <BridgePickerModal
          engine={engine}
          state={state}
          request={pendingBridgeDrag}
          selectedBridgeType={selectedBridgeType}
          onSelectAndBuild={(bType) => {
            setSelectedBridgeType(bType);
            engine.applyDragTrackOrRoad(
              pendingBridgeDrag.fromX,
              pendingBridgeDrag.fromY,
              pendingBridgeDrag.toX,
              pendingBridgeDrag.toY,
              pendingBridgeDrag.tool,
              bType
            );
            setPendingBridgeDrag(null);
          }}
          onCancel={() => setPendingBridgeDrag(null)}
        />
      )}

      {/* Top Transport Tycoon Toolbar */}
      <TopToolbar
        speed={state.speed}
        activeTool={activeTool}
        isQueryLandActive={isQueryLandActive}
        openWindows={openWindows}
        playerVehicleCount={playerVehicleCount}
        hqTier={state.corporate.hqTier}
        connectedPin={classroomSession?.pin ?? null}
        assignedWorldIndex={assignedWorldIndex}
        isTeacherAdmin={isTeacherAdmin}
        classroomRemainingSec={classroomRemainingSec}
        isBankruptWarning={
          state.corporate.cash < 0 || state.corporate.isBankruptWarning
        }
        onSetSpeed={handleSetSpeed}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onRotateMap={handleRotateMap}
        onSelectTool={handleSelectTool}
        onToggleQueryLand={handleToggleQueryLand}
        onToggleWindow={toggleWindow}
      />

      {/* Draggable TTD Windows */}
      {openWindows.has('rail_palette') && (
        <ConstructionPalette
          mode="RAIL"
          activeTool={activeTool}
          stationLength={stationLength}
          selectedBridgeType={selectedBridgeType}
          zIndex={getZIndex('rail_palette')}
          onFocus={bringToFront}
          onClose={closeWindow}
          onSelectTool={handleSelectTool}
          onSetStationLength={setStationLength}
          onSelectBridgeType={setSelectedBridgeType}
        />
      )}

      {openWindows.has('road_palette') && (
        <ConstructionPalette
          mode="ROAD"
          activeTool={activeTool}
          stationLength={stationLength}
          selectedBridgeType={selectedBridgeType}
          zIndex={getZIndex('road_palette')}
          onFocus={bringToFront}
          onClose={closeWindow}
          onSelectTool={handleSelectTool}
          onSetStationLength={setStationLength}
          onSelectBridgeType={setSelectedBridgeType}
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
          onOpenStation={handleOpenStation}
        />
      )}

      {openWindows.has('station_detail') && selectedStationId && (
        <StationDetailWindow
          engine={engine}
          state={state}
          stationId={selectedStationId}
          zIndex={getZIndex('station_detail')}
          onFocus={bringToFront}
          onClose={closeWindow}
          onFocusTile={handleFocusTile}
          onInspectVehicle={(vid) => {
            setSelectedVehicleId(vid);
            openWindow('depot');
          }}
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
          onOpenStation={handleOpenStation}
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
          isTeacherAdmin={isTeacherAdmin}
          session={classroomSession}
          students={classroomStudents}
          assignedWorldIndex={assignedWorldIndex}
          assignedSlotInWorld={assignedSlotInWorld}
          playerColor={assignedPlayerColor}
          remainingSec={classroomRemainingSec}
          defaultStudentName={state.personal.ownerName}
          defaultCompanyName={state.corporate.companyName}
          lastTelemetrySentAt={lastTelemetrySentAt}
          zIndex={getZIndex('classroom')}
          onFocus={bringToFront}
          onClose={closeWindow}
          onStudentJoin={handleStudentJoin}
          onTeacherCreate={(dur, scen) =>
            handleCreateClassroomPinSession(dur, scen)
          }
          onPushNow={async () => {
            if (classroomSession?.pin) {
              await pushCurrentTelemetry(
                classroomSession.pin,
                assignedWorldIndex ?? 1,
                assignedSlotInWorld ?? 1,
                assignedPlayerColor ?? '#2563eb'
              );
            }
          }}
          onDisconnect={handleClassroomDisconnect}
          onReturnToMainMenu={handleReturnToMainMenu}
          onInspectWorld={handleEnterTeacherSessionWorld}
        />
      )}

      {openWindows.has('save_load') && (
        <SaveLoadWindow
          engine={engine}
          state={state}
          isLockedStudentPinSession={activePlayMode === 'student_pin'}
          teacherEmail={isTeacherAdmin ? teacherUser?.email ?? null : null}
          zIndex={getZIndex('save_load')}
          onFocus={bringToFront}
          onClose={closeWindow}
          onReturnToMainMenu={
            activePlayMode === 'student_pin'
              ? handleClassroomDisconnect
              : handleReturnToMainMenu
          }
          onSignOutTeacher={isTeacherAdmin ? handleSignOutTeacherAll : undefined}
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

      {openWindows.has('land_info') && landInfoCoords && (
        <LandInfoWindow
          engine={engine}
          state={state}
          coords={landInfoCoords}
          zIndex={getZIndex('land_info')}
          onFocus={bringToFront}
          onClose={(id) => {
            setIsQueryLandActive(false);
            closeWindow(id);
          }}
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
        isQueryLandActive={isQueryLandActive}
        isPickingStationOrder={Boolean(pickingOrdersForVehicleId)}
        onOpenCompanyFinances={() => openWindow('company_finances')}
        onOpenPersonalFinances={() => openWindow('personal_finances')}
        onCancelTool={() => {
          setPickingOrdersForVehicleId(null);
          setIsQueryLandActive(false);
          setActiveTool('SELECT');
        }}
      />
    </div>
  );
};

export default App;
