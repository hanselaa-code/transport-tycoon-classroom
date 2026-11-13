import React, { useMemo, useState } from 'react';
import {
  TrainFront,
  Truck,
  Waves,
  Users,
  GraduationCap,
  ShieldCheck,
  LogIn,
  LogOut,
  Play,
  Presentation,
  Trophy,
  ArrowUpDown,
  Wifi,
  Globe,
  Eye,
  RotateCcw,
} from 'lucide-react';
import type { WorldSetupConfig } from '../types/game';
import type { TeacherUser } from '../firebase/auth';
import {
  DEFAULT_WORLD_SETUP,
  isFirebaseConfigured,
  type ClassroomSession,
  type StudentTelemetry,
  type WorldAssignment,
} from '../firebase/classroom';
import {
  DENSITY_LABELS_NO,
  formatKr,
  TERRAIN_TYPE_LABELS_NO,
  WATER_LEVEL_LABELS_NO,
} from './formatters';
import type { LeaderboardSortKey } from './windows/ClassroomWindow';

export interface StartLobbyScreenProps {
  teacherUser: TeacherUser | null;
  authReady: boolean;
  activeTeacherSession: ClassroomSession | null;
  sessionStudents: StudentTelemetry[];
  remainingSec: number | null;
  initialPin?: string;
  initialPlayerName?: string;
  initialCompanyName?: string;
  onJoinWithPin: (
    pin: string,
    playerName: string,
    companyName: string
  ) => Promise<{ ok: boolean; message: string }>;
  onSignInTeacher: () => Promise<{ ok: boolean; error?: string }>;
  onSignOutTeacher: () => Promise<void>;
  onCreateClassroomPinSession: (
    durationMinutes: number,
    worldSetup: WorldSetupConfig
  ) => Promise<{ ok: boolean; message: string }>;
  onStartTeacherSoloGame: (worldSetup: WorldSetupConfig) => void;
  onEnterTeacherSessionWorld: (worldIndex: number) => void;
  onCloseTeacherSession: () => void;
}

function formatProjectorTimer(
  sec: number | null,
  durationMinutes: number
): string {
  if (durationMinutes === 0) return '∞ Ubegrenset';
  if (sec === null || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const StartLobbyScreen: React.FC<StartLobbyScreenProps> = ({
  teacherUser,
  authReady,
  activeTeacherSession,
  sessionStudents,
  remainingSec,
  initialPin = '',
  initialPlayerName = '',
  initialCompanyName = '',
  onJoinWithPin,
  onSignInTeacher,
  onSignOutTeacher,
  onCreateClassroomPinSession,
  onStartTeacherSoloGame,
  onEnterTeacherSessionWorld,
  onCloseTeacherSession,
}) => {
  // Student PIN form state
  const [pin, setPin] = useState<string>(initialPin);
  const [playerName, setPlayerName] = useState<string>(initialPlayerName);
  const [companyName, setCompanyName] = useState<string>(initialCompanyName);
  const [companyManuallyEdited, setCompanyManuallyEdited] = useState<boolean>(
    Boolean(
      initialCompanyName &&
        initialPlayerName &&
        initialCompanyName !== `${initialPlayerName} AS`
    )
  );
  const [pinBusy, setPinBusy] = useState<boolean>(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Teacher Auth & OpenTTD World Setup state
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState<boolean>(false);

  const [mapSize, setMapSize] = useState<64 | 96 | 128 | 160>(
    DEFAULT_WORLD_SETUP.mapSize
  );
  const [gameMode, setGameMode] = useState<'singleplayer' | 'multiplayer'>(
    'multiplayer'
  );
  const [playersPerWorld, setPlayersPerWorld] = useState<number>(3);
  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [maxAiCount, setMaxAiCount] = useState<0 | 1 | 2 | 3>(3);
  const [terrainType, setTerrainType] = useState<
    'flat' | 'hilly' | 'mountainous'
  >('hilly');
  const [waterLevel, setWaterLevel] = useState<
    'very_low' | 'low' | 'medium' | 'high'
  >('medium');
  const [townDensity, setTownDensity] = useState<'low' | 'normal' | 'high'>(
    'normal'
  );
  const [industryDensity, setIndustryDensity] = useState<
    'low' | 'normal' | 'high'
  >('normal');
  const [startYear, setStartYear] = useState<number>(1950);
  const [scenario, setScenario] = useState<'standard' | 'boom' | 'challenge'>(
    'standard'
  );
  const [durationMinutes, setDurationMinutes] = useState<number>(45);

  // Projector Leaderboard state
  const [worldFilter, setWorldFilter] = useState<number | 'all'>('all');
  const [sortKey, setSortKey] = useState<LeaderboardSortKey>('companyValue');

  const firebaseLive = isFirebaseConfigured();

  const handlePlayerNameChange = (val: string) => {
    setPlayerName(val);
    if (!companyManuallyEdited) {
      const trimmed = val.trim();
      setCompanyName(trimmed ? `${trimmed} AS` : '');
    }
  };

  const handleCompanyNameChange = (val: string) => {
    setCompanyName(val);
    setCompanyManuallyEdited(val.trim().length > 0);
  };

  const buildWorldSetup = (): WorldSetupConfig => {
    const seed = Math.floor(100_000 + Math.random() * 899_999);
    const effectiveMaxAi: 0 | 1 | 2 | 3 = aiEnabled
      ? maxAiCount === 0
        ? 1
        : maxAiCount
      : 0;
    return {
      mapSize,
      gameMode,
      playersPerWorld: gameMode === 'singleplayer' ? 1 : playersPerWorld,
      aiEnabled: aiEnabled && effectiveMaxAi > 0,
      maxAiCount: effectiveMaxAi,
      terrainType,
      waterLevel,
      townDensity,
      industryDensity,
      startYear,
      scenario,
      seed,
    };
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    const cleanPin = pin.trim();
    const cleanPlayer = playerName.trim();
    const cleanCompany = companyName.trim() || `${cleanPlayer} AS`;

    if (cleanPin.length !== 4) {
      setPinError('Skriv inn en gyldig 4-sifret PIN-kode fra tavla.');
      return;
    }
    if (!cleanPlayer) {
      setPinError('Skriv inn ditt spillnavn / gruppenavn.');
      return;
    }

    setPinBusy(true);
    try {
      const res = await onJoinWithPin(cleanPin, cleanPlayer, cleanCompany);
      if (!res.ok) {
        setPinError(res.message);
      }
    } finally {
      setPinBusy(false);
    }
  };

  const handleTeacherGoogleLogin = async () => {
    setAuthError(null);
    setAuthBusy(true);
    try {
      const res = await onSignInTeacher();
      if (!res.ok && res.error) {
        setAuthError(res.error);
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCreateClassroomClick = async () => {
    setAuthError(null);
    setCreateBusy(true);
    try {
      const setup = buildWorldSetup();
      const res = await onCreateClassroomPinSession(durationMinutes, setup);
      if (!res.ok) {
        setAuthError(res.message);
      }
    } catch (err: unknown) {
      const msg =
        (err as { message?: string })?.message ??
        'Kunne ikke opprette klasseroms-økt.';
      setAuthError(msg);
    } finally {
      setCreateBusy(false);
    }
  };

  const handleStartSoloTeacherClick = () => {
    const setup = buildWorldSetup();
    onStartTeacherSoloGame(setup);
  };

  // Compute live world buckets for Teacher Projector View
  const worldBuckets = useMemo(() => {
    if (!activeTeacherSession) return [];
    const perWorld =
      activeTeacherSession.worldSetup.gameMode === 'singleplayer'
        ? 1
        : Math.max(1, activeTeacherSession.worldSetup.playersPerWorld);

    const assignmentsList: WorldAssignment[] = Object.values(
      activeTeacherSession.assignments ?? {}
    );

    const map = new Map<
      number,
      Array<{
        studentId: string;
        playerName: string;
        companyName: string;
        playerColor: string;
        slotInWorld: number;
      }>
    >();

    for (const a of assignmentsList) {
      const wIdx = a.worldIndex || 1;
      const list = map.get(wIdx) ?? [];
      list.push({
        studentId: a.studentId,
        playerName: a.playerName,
        companyName: a.companyName,
        playerColor: a.playerColor,
        slotInWorld: a.slotInWorld,
      });
      map.set(wIdx, list);
    }

    // Also include any student telemetry not yet reflected in assignments
    for (const st of sessionStudents) {
      const wIdx = st.worldIndex || 1;
      const list = map.get(wIdx) ?? [];
      if (!list.some((p) => p.studentId === st.studentId)) {
        list.push({
          studentId: st.studentId,
          playerName: st.studentName,
          companyName: st.companyName,
          playerColor: st.playerColor || '#2563eb',
          slotInWorld: st.slotInWorld || list.length + 1,
        });
        map.set(wIdx, list);
      }
    }

    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([worldIndex, members]) => ({
        worldIndex,
        capacity: perWorld,
        members: members.sort((a, b) => a.slotInWorld - b.slotInWorld),
      }));
  }, [activeTeacherSession, sessionStudents]);

  const filteredSortedStudents = useMemo(() => {
    const base =
      worldFilter === 'all'
        ? sessionStudents
        : sessionStudents.filter((s) => (s.worldIndex || 1) === worldFilter);
    return [...base].sort((a, b) => {
      const diff = (b[sortKey] ?? 0) - (a[sortKey] ?? 0);
      if (diff !== 0) return diff;
      return b.companyValue - a.companyValue;
    });
  }, [sessionStudents, worldFilter, sortKey]);

  return (
    <div className="fixed inset-0 z-[1000] overflow-y-auto bg-[#0b191e] text-slate-100 select-none">
      {/* Subtle Classic TTD Isometric Grid Backdrop */}
      <div
        className="pointer-events-none fixed inset-0 opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(30deg, #1e4b46 1px, transparent 1px), linear-gradient(150deg, #1e4b46 1px, transparent 1px)',
          backgroundSize: '44px 26px',
        }}
      />

      <div className="relative z-10 max-w-6xl mx-auto px-3 py-4 md:py-6 space-y-4">
        {/* Classic OpenTTD Title Banner */}
        <div className="ttd-window">
          <div className="ttd-titlebar ttd-titlebar-brass !h-8 !px-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrainFront className="w-4 h-4 text-amber-200" />
              <Waves className="w-4 h-4 text-cyan-200" />
              <Truck className="w-4 h-4 text-amber-200" />
              <span className="tracking-wider text-sm font-black">
                TRANSPORT TYCOON: CLASSROOM EDITION
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-semibold">
              <Wifi className="w-3.5 h-3.5 text-emerald-300" />
              <span className="text-emerald-200">
                {firebaseLive ? 'Firebase Sky-synk Aktiv' : 'Lokal Modus'}
              </span>
            </div>
          </div>

          <div className="p-2.5 px-3 flex flex-wrap items-center justify-between gap-2 text-xs bg-[#18262f]">
            <div className="text-slate-200">
              Bygg jernbane, veier og bruer over norske fjorder • Styr{' '}
              <strong className="text-sky-300">Selskap AS</strong>,{' '}
              <strong className="text-amber-300">Lønn & Skatt</strong> og{' '}
              <strong className="text-emerald-300">Oslo Børs</strong>!
            </div>
            <div className="text-[11px] text-amber-200 font-semibold">
              Velg inngang: 4-sifret PIN for elever • Google-innlogging for lærer
            </div>
          </div>
        </div>

        {/* MODE B: TEACHER LIVE PROJECTOR VIEW */}
        {activeTeacherSession && teacherUser ? (
          <div className="ttd-window">
            <div className="ttd-titlebar ttd-titlebar-teal !h-7 !px-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Presentation className="w-4 h-4 text-amber-300" />
                <span>
                  LÆRER STORSKJERM — AKTIV KLASSEROMS-ØKT (PIN{' '}
                  {activeTeacherSession.pin})
                </span>
              </div>
              <span className="text-[11px] text-emerald-200">
                Innlogget: {teacherUser.email}
              </span>
            </div>

            <div className="ttd-body !p-3 space-y-3">
              {/* Giant PIN + Setup Summary + Action Buttons */}
              <div className="ttd-panel p-3 flex flex-wrap items-center justify-between gap-4 bg-slate-900/80">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="ttd-inset px-5 py-2.5 text-center border-2 border-amber-400">
                    <div className="text-[10px] text-amber-200 uppercase font-bold tracking-wider">
                      OPPGI PIN PÅ TAVLA
                    </div>
                    <div className="text-4xl font-black text-amber-300 tracking-[0.22em] ttd-num">
                      {activeTeacherSession.pin}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-sm font-bold text-amber-100">
                      Elevene taster PIN{' '}
                      <span className="text-amber-300 ttd-num">
                        {activeTeacherSession.pin}
                      </span>{' '}
                      + Spillnavn for å bli tildelt verden automatisk!
                    </div>
                    <div className="text-xs text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-0.5 ttd-num">
                      <span>
                        Kart:{' '}
                        <strong className="text-sky-300">
                          {activeTeacherSession.worldSetup.mapSize}×
                          {activeTeacherSession.worldSetup.mapSize}
                        </strong>
                      </span>
                      <span>•</span>
                      <span>
                        Modus:{' '}
                        <strong className="text-emerald-300">
                          {activeTeacherSession.worldSetup.gameMode ===
                          'multiplayer'
                            ? `Flerspiller (${activeTeacherSession.worldSetup.playersPerWorld} per verden)`
                            : 'Enkeltspiller (Egen verden per elev)'}
                        </strong>
                      </span>
                      <span>•</span>
                      <span>
                        AI:{' '}
                        <strong className="text-purple-300">
                          {activeTeacherSession.worldSetup.aiEnabled
                            ? `${activeTeacherSession.worldSetup.maxAiCount} AI-selskap`
                            : 'Av'}
                        </strong>
                      </span>
                      <span>•</span>
                      <span>
                        Terreng:{' '}
                        <strong>
                          {
                            TERRAIN_TYPE_LABELS_NO[
                              activeTeacherSession.worldSetup.terrainType
                            ]
                          }
                        </strong>{' '}
                        (
                        {
                          WATER_LEVEL_LABELS_NO[
                            activeTeacherSession.worldSetup.waterLevel
                          ]
                        }
                        )
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="ttd-inset px-4 py-2 text-center ttd-num">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">
                      TIDSRekke / KLOKKE
                    </div>
                    <div
                      className={`text-2xl font-black ${
                        activeTeacherSession.durationMinutes > 0 &&
                        remainingSec !== null &&
                        remainingSec <= 180
                          ? 'text-rose-400 animate-pulse'
                          : 'text-emerald-300'
                      }`}
                    >
                      {formatProjectorTimer(
                        remainingSec,
                        activeTeacherSession.durationMinutes
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        onEnterTeacherSessionWorld(
                          worldFilter === 'all' ? 1 : worldFilter
                        )
                      }
                      className="ttd-btn ttd-btn-green !px-3.5 !py-2 !text-xs"
                    >
                      <Eye className="w-4 h-4" />
                      <span>
                        Spill / Inspiser Verden #
                        {worldFilter === 'all' ? 1 : worldFilter} i 3D
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={onCloseTeacherSession}
                      className="ttd-btn ttd-btn-brass !px-3 !py-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Sett opp ny økt</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Live World Assignment Buckets (Verden 1, Verden 2, ...) */}
              <div className="ttd-panel p-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-amber-200 text-xs flex items-center gap-1.5">
                    <Globe className="w-4 h-4 text-sky-300" />
                    <span>
                      Aktive Verdener ({worldBuckets.length}{' '}
                      {worldBuckets.length === 1 ? 'verden' : 'verdener'} •{' '}
                      {activeTeacherSession.assignedCount ??
                        sessionStudents.length}{' '}
                      påmeldte spillere)
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-300">
                    Klikk på en verden for å filtrere ledertavlen eller inspisere
                    kartet i 3D
                  </div>
                </div>

                {worldBuckets.length === 0 ? (
                  <div className="ttd-inset p-3 text-center text-slate-400 text-xs">
                    Ingen elever har koblet til ennå — så snart første elev taster
                    PIN <strong className="text-amber-300">{activeTeacherSession.pin}</strong>, opprettes{' '}
                    <strong className="text-sky-300">Verden 1</strong> automatisk!
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {worldBuckets.map((b) => {
                      const selected = worldFilter === b.worldIndex;
                      return (
                        <div
                          key={b.worldIndex}
                          onClick={() =>
                            setWorldFilter(
                              selected ? 'all' : b.worldIndex
                            )
                          }
                          className={`ttd-inset p-2 cursor-pointer transition space-y-1.5 ${
                            selected
                              ? 'ring-2 ring-amber-400 bg-slate-800/90'
                              : 'hover:bg-slate-800/60'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-amber-200 text-xs ttd-num">
                              Verden {b.worldIndex} ({b.members.length}/
                              {b.capacity})
                            </span>
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onEnterTeacherSessionWorld(b.worldIndex);
                              }}
                              className="ttd-btn ttd-btn-teal !px-2 !py-0.5 !text-[10px]"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Åpne 3D</span>
                            </button>
                          </div>

                          <div className="space-y-1">
                            {b.members.map((m) => (
                              <div
                                key={m.studentId}
                                className="flex items-center gap-1.5 text-[11px]"
                              >
                                <span
                                  className="w-2.5 h-2.5 shrink-0 border border-black/60"
                                  style={{ backgroundColor: m.playerColor }}
                                />
                                <span className="font-semibold text-slate-100 truncate">
                                  {m.playerName}
                                </span>
                                <span className="text-[10px] text-slate-400 truncate">
                                  ({m.companyName})
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Filterable Real-Time Leaderboard */}
              <div className="ttd-panel p-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-amber-200 text-xs flex items-center gap-1.5">
                      <Trophy className="w-4 h-4 text-amber-300" />
                      <span>
                        Sanntids Ledertavle ({filteredSortedStudents.length}{' '}
                        spillere)
                      </span>
                    </span>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setWorldFilter('all')}
                        className={`ttd-btn !px-2 !py-0.5 !text-[10px] ${
                          worldFilter === 'all' ? 'ttd-btn-active' : ''
                        }`}
                      >
                        Alle verdener
                      </button>
                      {worldBuckets.map((b) => (
                        <button
                          key={b.worldIndex}
                          type="button"
                          onClick={() => setWorldFilter(b.worldIndex)}
                          className={`ttd-btn !px-2 !py-0.5 !text-[10px] ttd-num ${
                            worldFilter === b.worldIndex ? 'ttd-btn-active' : ''
                          }`}
                        >
                          Verden {b.worldIndex}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="text-slate-400 mr-1">Sorter:</span>
                    {(
                      [
                        ['companyValue', 'Selskapsverdi'],
                        ['personalNetWorth', 'Privat Formue'],
                        ['totalTaxPaid', 'Betalt Skatt'],
                        ['annualProfit', 'Årsresultat'],
                        ['hqTier', 'HQ Nivå'],
                      ] as Array<[LeaderboardSortKey, string]>
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSortKey(key)}
                        className={`ttd-btn !px-2 !py-0.5 ${
                          sortKey === key ? 'ttd-btn-active' : ''
                        }`}
                      >
                        <ArrowUpDown className="w-2.5 h-2.5" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ttd-inset overflow-x-auto">
                  <table className="w-full text-left border-collapse ttd-num">
                    <thead>
                      <tr className="border-b border-slate-700 text-[11px] text-amber-200 bg-slate-900/80">
                        <th className="p-2 w-10 text-center">#</th>
                        <th className="p-2 w-24">Verden</th>
                        <th className="p-2">Spiller & Selskap AS</th>
                        <th className="p-2 text-right">Selskapsverdi</th>
                        <th className="p-2 text-right">Privat Formue</th>
                        <th className="p-2 text-center">HQ Nivå</th>
                        <th className="p-2 text-right">Betalt Skatt</th>
                        <th className="p-2 text-right">Årsresultat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 text-xs">
                      {filteredSortedStudents.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="p-6 text-center text-slate-400"
                          >
                            Venter på nøkkeltall fra spillere med PIN{' '}
                            <strong className="text-amber-300">
                              {activeTeacherSession.pin}
                            </strong>
                            ...
                          </td>
                        </tr>
                      ) : (
                        filteredSortedStudents.map((st, idx) => (
                          <tr
                            key={st.studentId}
                            className="hover:bg-slate-800/60"
                          >
                            <td className="p-2 text-center font-extrabold">
                              {idx === 0 ? (
                                <span className="text-amber-300">🥇 1</span>
                              ) : idx === 1 ? (
                                <span className="text-slate-200">🥈 2</span>
                              ) : idx === 2 ? (
                                <span className="text-amber-600">🥉 3</span>
                              ) : (
                                <span className="text-slate-400">{idx + 1}</span>
                              )}
                            </td>
                            <td className="p-2">
                              <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-600 text-sky-200 text-[10px] font-bold">
                                Verden #{st.worldIndex || 1}
                              </span>
                            </td>
                            <td className="p-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-3 h-3 shrink-0 border border-black/60"
                                  style={{
                                    backgroundColor:
                                      st.playerColor || '#2563eb',
                                  }}
                                />
                                <div>
                                  <div className="font-bold text-amber-100">
                                    {st.studentName}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {st.companyName}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="p-2 text-right font-bold text-sky-300">
                              {formatKr(st.companyValue)}
                            </td>
                            <td className="p-2 text-right font-bold text-amber-300">
                              {formatKr(st.personalNetWorth)}
                            </td>
                            <td className="p-2 text-center">
                              <span className="px-1.5 py-0.5 bg-slate-800 text-amber-200 font-bold text-[11px]">
                                {st.hqTier > 0 ? `Nivå ${st.hqTier}` : 'Ingen'}
                              </span>
                            </td>
                            <td className="p-2 text-right font-semibold text-emerald-300">
                              {formatKr(st.totalTaxPaid)}
                            </td>
                            <td
                              className={`p-2 text-right font-semibold ${
                                st.annualProfit >= 0
                                  ? 'text-emerald-300'
                                  : 'text-rose-400'
                              }`}
                            >
                              {formatKr(st.annualProfit, true)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* MODE A: TWO-COLUMN ENTRY GATE (STUDENT PIN vs TEACHER GOOGLE ADMIN) */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* LEFT CARD (5 cols): ELEV / SPILLER — JOIN WITH 4-DIGIT PIN */}
            <div className="lg:col-span-5 ttd-window">
              <div className="ttd-titlebar ttd-titlebar-teal !h-7 !px-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-sky-200" />
                  <span>ELEV / SPILLER — BLI MED MED PIN-KODE</span>
                </div>
              </div>

              <form onSubmit={handleJoinSubmit} className="ttd-body !p-3.5 space-y-3">
                <div className="ttd-panel p-2.5 text-xs text-slate-200 leading-relaxed">
                  Skriv inn den <strong className="text-amber-300">4-sifrede PIN-koden</strong>{' '}
                  fra lærerens storskjerm og velg ditt spillnavn for å starte!
                </div>

                {pinError && (
                  <div className="ttd-inset p-2.5 border border-rose-500/80 text-rose-300 text-xs font-semibold">
                    {pinError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-amber-200 mb-1">
                    4-sifret PIN-kode:
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="0000"
                    value={pin}
                    onChange={(e) =>
                      setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))
                    }
                    className="ttd-inset w-full px-3 py-2.5 text-2xl font-black tracking-[0.35em] text-center text-amber-300 ttd-num"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-amber-200 mb-1">
                    Spillnavn / Navn (Påkrevd):
                  </label>
                  <input
                    type="text"
                    maxLength={40}
                    placeholder="f.eks. Ingrid eller Gruppe 2"
                    value={playerName}
                    onChange={(e) => handlePlayerNameChange(e.target.value)}
                    className="ttd-inset w-full px-3 py-2 text-xs text-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-amber-200 mb-1">
                    Selskapsnavn (AS):
                  </label>
                  <input
                    type="text"
                    maxLength={45}
                    placeholder="f.eks. Ingrid AS"
                    value={companyName}
                    onChange={(e) => handleCompanyNameChange(e.target.value)}
                    className="ttd-inset w-full px-3 py-2 text-xs text-slate-100"
                    required
                  />
                  <span className="block text-[10px] text-slate-400 mt-1">
                    Foreslås automatisk som «Spillnavn AS», men du kan fritt velge eget firmanavn.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={pinBusy || pin.trim().length !== 4 || !playerName.trim()}
                  className="ttd-btn ttd-btn-green w-full !py-2.5 !text-sm"
                >
                  <Play className="w-4 h-4" />
                  <span>
                    {pinBusy ? 'Kobler til verden...' : 'Start spill med PIN-kode'}
                  </span>
                </button>

                <div className="ttd-inset p-2.5 text-[11px] text-slate-300 space-y-1">
                  <div className="font-bold text-amber-200">
                    Slik fungerer verdener i klasserommet:
                  </div>
                  <p>
                    • I <strong>Enkeltspiller</strong> bygger hver elev i sin egen identiske verden.
                  </p>
                  <p>
                    • I <strong>Flerspiller</strong> plasseres dere sekvensielt i delte verdener (
                    <span className="text-sky-300 font-semibold">Verden 1</span>,{' '}
                    <span className="text-sky-300 font-semibold">Verden 2</span>, osv.) og ser hverandres jernbaner, bruer og tog i sanntid!
                  </p>
                </div>
              </form>
            </div>

            {/* RIGHT CARD (7 cols): LÆRER / ADMINISTRATOR — GOOGLE LOGIN & OPENTTD WORLD SETUP */}
            <div className="lg:col-span-7 ttd-window">
              <div className="ttd-titlebar ttd-titlebar-brass !h-7 !px-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-amber-200" />
                  <span>
                    LÆRER / ADMINISTRATOR — SETT OPP NYTT SPILL (OPENTTD)
                  </span>
                </div>
                {teacherUser && (
                  <span className="text-[11px] text-emerald-200 font-bold">
                    {teacherUser.email}
                  </span>
                )}
              </div>

              <div className="ttd-body !p-3.5 space-y-3">
                {authError && (
                  <div className="ttd-inset p-2.5 border border-rose-500/80 text-rose-300 text-xs font-semibold">
                    {authError}
                  </div>
                )}

                {!teacherUser ? (
                  <div className="ttd-panel p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="w-6 h-6 text-amber-300 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <div className="font-bold text-amber-100 text-sm">
                          Lærertilgang med Google-innlogging
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          For å opprette klasseroms-PIN, velge kartstørrelse (opptil{' '}
                          <strong>160×160</strong>), skru AI-selskaper av/på eller spille uten PIN må du være innlogget som administrator (
                          <strong className="text-amber-200">hanselaa@gmail.com</strong>).
                        </p>
                      </div>
                    </div>

                    <div className="pt-1 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-[11px] text-slate-400">
                        {!authReady
                          ? 'Sjekker innloggingsstatus...'
                          : 'Kun autorisert lærerkonto slipper inn.'}
                      </span>

                      <button
                        type="button"
                        disabled={authBusy}
                        onClick={handleTeacherGoogleLogin}
                        className="ttd-btn ttd-btn-brass !px-4 !py-2.5 !text-xs"
                      >
                        <LogIn className="w-4 h-4" />
                        <span>
                          {authBusy
                            ? 'Åpner Google-innlogging...'
                            : 'Logg inn med Google (hanselaa@gmail.com)'}
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* FULL OPENTTD WORLD GENERATION & CLASSROOM SETUP PANEL */
                  <div className="space-y-3">
                    {/* Logged-in Teacher Bar */}
                    <div className="ttd-panel p-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>
                          Innlogget som lærer:{' '}
                          <strong className="text-amber-200">
                            {teacherUser.displayName
                              ? `${teacherUser.displayName} (${teacherUser.email})`
                              : teacherUser.email}
                          </strong>
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onSignOutTeacher()}
                        className="ttd-btn ttd-btn-red !px-2.5 !py-1 !text-[11px]"
                      >
                        <LogOut className="w-3 h-3" />
                        <span>Logg ut</span>
                      </button>
                    </div>

                    {/* OpenTTD World Settings Grid */}
                    <div className="ttd-panel p-2.5 space-y-2.5">
                      <div className="font-bold text-amber-200 text-xs border-b border-slate-700/80 pb-1">
                        Sett opp nytt spill / Generer Verden (OpenTTD-innstillinger)
                      </div>

                      {/* 1. Map Size & 2. Game Mode */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-semibold text-amber-200 mb-1">
                            Kartstørrelse:
                          </label>
                          <select
                            value={mapSize}
                            onChange={(e) =>
                              setMapSize(
                                Number(e.target.value) as 64 | 96 | 128 | 160
                              )
                            }
                            className="ttd-inset w-full px-2 py-1.5 text-xs text-slate-100"
                          >
                            <option value={64}>64×64 (Lite)</option>
                            <option value={96}>96×96 (Middels)</option>
                            <option value={128}>128×128 (Stort)</option>
                            <option value={160}>160×160 (Svært stort)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-amber-200 mb-1">
                            Spillmodus:
                          </label>
                          <select
                            value={gameMode}
                            onChange={(e) =>
                              setGameMode(
                                e.target.value as 'singleplayer' | 'multiplayer'
                              )
                            }
                            className="ttd-inset w-full px-2 py-1.5 text-xs text-slate-100"
                          >
                            <option value="singleplayer">
                              Enkeltspiller (Hver elev i egen verden)
                            </option>
                            <option value="multiplayer">
                              Flerspiller (Delt verden)
                            </option>
                          </select>
                        </div>
                      </div>

                      {/* 3. Players Per World (when Multiplayer) */}
                      {gameMode === 'multiplayer' && (
                        <div className="ttd-inset p-2 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-sky-300">
                              Antall spillere per verden:
                            </span>
                            <div className="flex items-center gap-1">
                              {[2, 3, 4, 5, 6, 8].map((cnt) => (
                                <button
                                  key={cnt}
                                  type="button"
                                  onClick={() => setPlayersPerWorld(cnt)}
                                  className={`ttd-btn !px-2.5 !py-0.5 ttd-num ${
                                    playersPerWorld === cnt
                                      ? 'ttd-btn-active'
                                      : ''
                                  }`}
                                >
                                  {cnt}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="text-[10px] text-slate-300">
                            De første <strong>{playersPerWorld}</strong> elevene plasseres sammen i{' '}
                            <strong className="text-amber-200">Verden 1</strong>, de neste{' '}
                            <strong>{playersPerWorld}</strong> i{' '}
                            <strong className="text-amber-200">Verden 2</strong>, osv.
                          </div>
                        </div>
                      )}

                      {/* 4. AI Companies Toggle & Count */}
                      <div className="ttd-inset p-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-bold text-amber-200">
                            AI-selskaper (Børs-konkurrenter):
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Velg om datastyrte transportselskaper skal bygge ruter og noteres på Oslo Børs
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          {(
                            [
                              [0, 'Ingen AI (Av)'],
                              [1, '1 AI'],
                              [2, '2 AI'],
                              [3, '3 AI'],
                            ] as Array<[0 | 1 | 2 | 3, string]>
                          ).map(([cnt, label]) => {
                            const selected =
                              (!aiEnabled && cnt === 0) ||
                              (aiEnabled && maxAiCount === cnt);
                            return (
                              <button
                                key={cnt}
                                type="button"
                                onClick={() => {
                                  if (cnt === 0) {
                                    setAiEnabled(false);
                                    setMaxAiCount(0);
                                  } else {
                                    setAiEnabled(true);
                                    setMaxAiCount(cnt);
                                  }
                                }}
                                className={`ttd-btn !px-2 !py-1 !text-[11px] ${
                                  selected ? 'ttd-btn-active' : ''
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 5. Terrain Type & 6. Water Level */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-semibold text-amber-200 mb-1">
                            Terrengtype:
                          </label>
                          <select
                            value={terrainType}
                            onChange={(e) =>
                              setTerrainType(
                                e.target.value as
                                  | 'flat'
                                  | 'hilly'
                                  | 'mountainous'
                              )
                            }
                            className="ttd-inset w-full px-2 py-1.5 text-xs text-slate-100"
                          >
                            <option value="flat">Flatt lavland</option>
                            <option value="hilly">Bølgende åser</option>
                            <option value="mountainous">
                              Norsk fjellterreng
                            </option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-amber-200 mb-1">
                            Vannmengde / Fjorder:
                          </label>
                          <select
                            value={waterLevel}
                            onChange={(e) =>
                              setWaterLevel(
                                e.target.value as
                                  | 'very_low'
                                  | 'low'
                                  | 'medium'
                                  | 'high'
                              )
                            }
                            className="ttd-inset w-full px-2 py-1.5 text-xs text-slate-100"
                          >
                            <option value="very_low">Svært lite</option>
                            <option value="low">Lite</option>
                            <option value="medium">Middels</option>
                            <option value="high">
                              Mye vann & øyer (Mange bruer)
                            </option>
                          </select>
                        </div>
                      </div>

                      {/* 7. Town Density, 8. Industry Density, 9. Start Year */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-semibold text-amber-200 mb-1">
                            Antall byer:
                          </label>
                          <select
                            value={townDensity}
                            onChange={(e) =>
                              setTownDensity(
                                e.target.value as 'low' | 'normal' | 'high'
                              )
                            }
                            className="ttd-inset w-full px-2 py-1.5 text-xs text-slate-100"
                          >
                            {(['low', 'normal', 'high'] as const).map((d) => (
                              <option key={d} value={d}>
                                {DENSITY_LABELS_NO[d]}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-amber-200 mb-1">
                            Antall industrier:
                          </label>
                          <select
                            value={industryDensity}
                            onChange={(e) =>
                              setIndustryDensity(
                                e.target.value as 'low' | 'normal' | 'high'
                              )
                            }
                            className="ttd-inset w-full px-2 py-1.5 text-xs text-slate-100"
                          >
                            {(['low', 'normal', 'high'] as const).map((d) => (
                              <option key={d} value={d}>
                                {DENSITY_LABELS_NO[d]}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-amber-200 mb-1">
                            Startår:
                          </label>
                          <select
                            value={startYear}
                            onChange={(e) =>
                              setStartYear(Number(e.target.value))
                            }
                            className="ttd-inset w-full px-2 py-1.5 text-xs text-slate-100 ttd-num"
                          >
                            {[1950, 1965, 1980, 2000].map((yr) => (
                              <option key={yr} value={yr}>
                                {yr}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* 10. Economy / Starting Capital & 11. Time Limit */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-semibold text-amber-200 mb-1">
                            Økonomi / Startkapital:
                          </label>
                          <select
                            value={scenario}
                            onChange={(e) =>
                              setScenario(
                                e.target.value as
                                  | 'standard'
                                  | 'boom'
                                  | 'challenge'
                              )
                            }
                            className="ttd-inset w-full px-2 py-1.5 text-xs text-slate-100"
                          >
                            <option value="standard">
                              Standard (2 mill. kr)
                            </option>
                            <option value="boom">
                              Høykonjunktur (3 mill. kr)
                            </option>
                            <option value="challenge">
                              Utfordring (1,2 mill. kr)
                            </option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-amber-200 mb-1">
                            Tidsgrense (Klasserom):
                          </label>
                          <div className="flex items-center gap-1">
                            {(
                              [
                                [30, '30 min'],
                                [45, '45 min'],
                                [60, '60 min'],
                                [0, 'Ubegrenset'],
                              ] as Array<[number, string]>
                            ).map(([mins, label]) => (
                              <button
                                key={mins}
                                type="button"
                                onClick={() => setDurationMinutes(mins)}
                                className={`ttd-btn flex-1 !py-1.5 !px-1.5 !text-[11px] ttd-num ${
                                  durationMinutes === mins
                                    ? 'ttd-btn-active'
                                    : ''
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* TWO TEACHER LAUNCH ACTIONS */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={createBusy}
                        onClick={handleCreateClassroomClick}
                        className="ttd-btn ttd-btn-green !py-2.5 !px-3 !text-xs"
                      >
                        <Presentation className="w-4 h-4" />
                        <span>
                          {createBusy
                            ? 'Oppretter PIN-økt...'
                            : 'Opprett Klasseroms-spill & Få PIN'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={handleStartSoloTeacherClick}
                        className="ttd-btn ttd-btn-brass !py-2.5 !px-3 !text-xs"
                      >
                        <Play className="w-4 h-4" />
                        <span>Spill alene nå (Lærer-modus)</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
