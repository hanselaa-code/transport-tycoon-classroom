import React, { useMemo, useState } from 'react';
import {
  GraduationCap,
  Users,
  Presentation,
  Radio,
  Trophy,
  ArrowUpDown,
  RefreshCw,
  LogOut,
  Wifi,
  Globe,
  Home,
  Eye,
  ShieldCheck,
} from 'lucide-react';
import type { ScenarioType } from '../../types/game';
import {
  isFirebaseConfigured,
  type ClassroomSession,
  type StudentTelemetry,
  type WorldAssignment,
} from '../../firebase/classroom';
import { formatKr, SCENARIO_LABELS_NO } from '../formatters';
import { TTDWindow } from '../TTDWindow';

export type LeaderboardSortKey =
  | 'companyValue'
  | 'personalNetWorth'
  | 'totalTaxPaid'
  | 'annualProfit'
  | 'hqTier';

export interface ClassroomWindowProps {
  role: 'student' | 'teacher' | null;
  isTeacherAdmin?: boolean;
  session: ClassroomSession | null;
  students: StudentTelemetry[];
  assignedWorldIndex?: number | null;
  assignedSlotInWorld?: number | null;
  playerColor?: string | null;
  remainingSec: number | null;
  defaultStudentName: string;
  defaultCompanyName: string;
  lastTelemetrySentAt: number | null;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onStudentJoin: (
    pin: string,
    studentName: string,
    companyName: string
  ) => Promise<{ ok: boolean; message: string }>;
  onTeacherCreate: (
    durationMinutes: number,
    scenario: ScenarioType
  ) => Promise<{ ok: boolean; message: string }>;
  onPushNow: () => Promise<void>;
  onDisconnect: () => void;
  onReturnToMainMenu?: () => void;
  onInspectWorld?: (worldIndex: number) => void;
}

function formatTimerBig(sec: number | null, durationMinutes = 45): string {
  if (durationMinutes === 0) return '∞ Ubegrenset';
  if (sec === null || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const ClassroomWindow: React.FC<ClassroomWindowProps> = ({
  role,
  isTeacherAdmin = false,
  session,
  students,
  assignedWorldIndex = null,
  assignedSlotInWorld = null,
  playerColor = null,
  remainingSec,
  defaultStudentName,
  defaultCompanyName,
  lastTelemetrySentAt,
  zIndex,
  onFocus,
  onClose,
  onStudentJoin,
  onTeacherCreate,
  onPushNow,
  onDisconnect,
  onReturnToMainMenu,
  onInspectWorld,
}) => {
  const [tab, setTab] = useState<'student' | 'teacher'>(
    role === 'teacher' || isTeacherAdmin ? 'teacher' : 'student'
  );
  const [pinInput, setPinInput] = useState(session?.pin ?? '');
  const [studentName, setStudentName] = useState(defaultStudentName);
  const [companyName, setCompanyName] = useState(defaultCompanyName);
  const [duration, setDuration] = useState<number>(45);
  const [scenario, setScenario] = useState<ScenarioType>('standard');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [sortKey, setSortKey] = useState<LeaderboardSortKey>('companyValue');
  const [worldFilter, setWorldFilter] = useState<number | 'all'>('all');

  const worldBuckets = useMemo(() => {
    if (!session) return [];
    const perWorld =
      session.worldSetup?.gameMode === 'singleplayer'
        ? 1
        : Math.max(1, session.worldSetup?.playersPerWorld ?? 1);

    const assignmentsList: WorldAssignment[] = Object.values(
      session.assignments ?? {}
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

    for (const st of students) {
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
  }, [session, students]);

  const sortedStudents = useMemo(() => {
    const base =
      worldFilter === 'all'
        ? students
        : students.filter((s) => (s.worldIndex || 1) === worldFilter);
    return [...base].sort((a, b) => {
      const diff = (b[sortKey] ?? 0) - (a[sortKey] ?? 0);
      if (diff !== 0) return diff;
      return b.companyValue - a.companyValue;
    });
  }, [students, worldFilter, sortKey]);

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await onStudentJoin(pinInput.trim(), studentName, companyName);
      setStatusMsg({ ok: res.ok, text: res.message });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateSession = async () => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await onTeacherCreate(duration, scenario);
      setStatusMsg({ ok: res.ok, text: res.message });
    } catch (err: unknown) {
      setStatusMsg({
        ok: false,
        text:
          (err as { message?: string })?.message ??
          'Kunne ikke opprette klasseroms-økt.',
      });
    } finally {
      setBusy(false);
    }
  };

  const firebaseLive = isFirebaseConfigured();

  return (
    <TTDWindow
      id="classroom"
      title="Lærer & Klasserom – Verdener & Sanntids Ledertavle"
      subtitle={
        firebaseLive ? 'Tilkoblet Sky (Firestore Live)' : 'Lokal synkronisering'
      }
      icon={<GraduationCap className="w-3.5 h-3.5" />}
      theme="teal"
      defaultX={145}
      defaultY={50}
      width={750}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      {/* Top Tabs */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 flex-1">
          <button
            type="button"
            onClick={() => setTab('student')}
            className={`ttd-btn flex-1 !py-1.5 ${
              tab === 'student' ? 'ttd-btn-active' : ''
            }`}
          >
            <Users className="w-3.5 h-3.5 text-sky-300" />
            <span>Min Økt & Verden</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('teacher')}
            className={`ttd-btn flex-1 !py-1.5 ${
              tab === 'teacher' ? 'ttd-btn-active' : ''
            }`}
          >
            <Presentation className="w-3.5 h-3.5 text-amber-300" />
            <span>Lærer / Verdensoversikt</span>
          </button>
        </div>

        <div className="ttd-inset px-2 py-1 text-[10px] flex items-center gap-1 text-emerald-300 shrink-0">
          <Wifi className="w-3 h-3" />
          <span>{firebaseLive ? 'Firebase Live' : 'Lokal modus'}</span>
        </div>
      </div>

      {statusMsg && (
        <div
          className={`ttd-inset p-2 text-[11px] font-semibold ${
            statusMsg.ok ? 'text-emerald-300' : 'text-rose-300'
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {/* STUDENT TAB */}
      {tab === 'student' && (
        <div className="space-y-2.5">
          {session && role === 'student' ? (
            <div className="ttd-panel p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="ttd-inset px-3 py-1.5 text-center">
                    <div className="text-[10px] text-slate-400 uppercase">
                      Aktiv PIN
                    </div>
                    <div className="text-xl font-extrabold text-emerald-300 tracking-widest ttd-num">
                      {session.pin}
                    </div>
                  </div>
                  <div>
                    <div className="font-bold text-amber-100 text-sm flex items-center gap-1.5 flex-wrap">
                      <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                      <span>
                        Verden #{assignedWorldIndex ?? 1}
                        {session.worldSetup?.gameMode === 'multiplayer'
                          ? ` (Flerspiller — Plass #${assignedSlotInWorld ?? 1})`
                          : ' (Enkeltspiller)'}
                      </span>
                      {playerColor && (
                        <span
                          className="w-3 h-3 inline-block border border-black/70"
                          style={{ backgroundColor: playerColor }}
                          title="Din selskapsfarge"
                        />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-300">
                      Nøkkeltall sendes hvert 30. sekund til ledertavlen
                      {session.worldSetup?.gameMode === 'multiplayer'
                        ? ' • Jernbaner, bruer og tog synkroniseres direkte med medspillere!'
                        : '.'}
                    </div>
                    {lastTelemetrySentAt && (
                      <div className="text-[10px] text-slate-400 ttd-num">
                        Sist synkronisert:{' '}
                        {new Date(lastTelemetrySentAt).toLocaleTimeString(
                          'no-NO'
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="ttd-inset px-3 py-1.5 text-center ttd-num">
                    <div className="text-[10px] text-slate-400 uppercase">
                      Tid igjen
                    </div>
                    <div className="text-lg font-extrabold text-amber-300">
                      {formatTimerBig(remainingSec, session.durationMinutes)}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => void onPushNow()}
                      className="ttd-btn ttd-btn-teal !py-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Oppdater nå</span>
                    </button>
                    <button
                      type="button"
                      onClick={onDisconnect}
                      className="ttd-btn ttd-btn-red !py-1"
                    >
                      <LogOut className="w-3 h-3" />
                      <span>Forlat økt / Meny</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleJoinSubmit} className="ttd-panel p-3 space-y-2.5">
              <div className="text-xs font-bold text-amber-200">
                Bytt eller koble til en klasseroms-økt med 4-sifret PIN
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">
                    4-sifret PIN-kode:
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="f.eks. 4829"
                    value={pinInput}
                    onChange={(e) =>
                      setPinInput(
                        e.target.value.replace(/[^0-9]/g, '').slice(0, 4)
                      )
                    }
                    className="ttd-inset w-full px-2.5 py-1.5 text-sm font-extrabold tracking-widest text-amber-200"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">
                    Spillnavn / Navn:
                  </label>
                  <input
                    type="text"
                    maxLength={40}
                    placeholder="f.eks. Gruppe 3"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    className="ttd-inset w-full px-2.5 py-1.5 text-xs text-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">
                    Selskapsnavn (AS):
                  </label>
                  <input
                    type="text"
                    maxLength={40}
                    placeholder="f.eks. Fjordfrakt AS"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="ttd-inset w-full px-2.5 py-1.5 text-xs text-slate-100"
                    required
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {onReturnToMainMenu && (
                  <button
                    type="button"
                    onClick={onReturnToMainMenu}
                    className="ttd-btn ttd-btn-brass !py-1.5 !px-3"
                  >
                    <Home className="w-3.5 h-3.5" />
                    <span>Åpne Hovedmeny</span>
                  </button>
                )}
                <button
                  type="submit"
                  disabled={busy || pinInput.length !== 4}
                  className="ttd-btn ttd-btn-green !px-4 !py-2 !text-xs ml-auto"
                >
                  <Users className="w-4 h-4" />
                  <span>{busy ? 'Kobler til...' : 'Bli med i Klasserom'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* TEACHER / PROJECTOR TAB */}
      {tab === 'teacher' && (
        <div className="space-y-2.5">
          {!session ? (
            isTeacherAdmin ? (
              <div className="ttd-panel p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-amber-200 text-xs flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Hurtigopprett Klasseroms-økt (eller bruk Hovedmeny for alle OpenTTD-valg)</span>
                  </div>
                  {onReturnToMainMenu && (
                    <button
                      type="button"
                      onClick={onReturnToMainMenu}
                      className="ttd-btn ttd-btn-teal !px-2.5 !py-1 !text-[11px]"
                    >
                      <Home className="w-3.5 h-3.5" />
                      <span>Fullt Verden-oppsett</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-slate-300 mb-1">
                      Tidsgrense:
                    </label>
                    <div className="flex items-center gap-1">
                      {([30, 45, 60, 0] as const).map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => setDuration(mins)}
                          className={`ttd-btn flex-1 !py-1.5 ttd-num ${
                            duration === mins ? 'ttd-btn-active' : ''
                          }`}
                        >
                          {mins === 0 ? 'Ubegrenset' : `${mins} min`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300 mb-1">
                      Økonomisk scenario:
                    </label>
                    <select
                      value={scenario}
                      onChange={(e) =>
                        setScenario(e.target.value as ScenarioType)
                      }
                      className="ttd-inset w-full px-2 py-1.5 text-xs text-slate-100"
                    >
                      {(['standard', 'boom', 'challenge'] as ScenarioType[]).map(
                        (sc) => (
                          <option key={sc} value={sc}>
                            {SCENARIO_LABELS_NO[sc].title}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-end pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleCreateSession}
                    className="ttd-btn ttd-btn-brass !px-4 !py-2 !text-xs"
                  >
                    <Presentation className="w-4 h-4" />
                    <span>
                      {busy ? 'Oppretter...' : 'Opprett Klasseroms-økt'}
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="ttd-panel p-3 text-xs text-slate-300">
                Kun innlogget lærer (<strong className="text-amber-200">hanselaa@gmail.com</strong>) kan opprette nye klasseroms-økter.
              </div>
            )
          ) : (
            <div className="space-y-2.5">
              {/* Giant PIN Banner & Countdown */}
              <div className="ttd-panel p-3 flex flex-wrap items-center justify-between gap-4 bg-slate-900/75">
                <div className="flex items-center gap-4">
                  <div className="ttd-inset px-4 py-2 text-center border-2 border-amber-400/70">
                    <div className="text-[10px] text-amber-200 uppercase font-bold tracking-wider">
                      KLASSEROMS-PIN
                    </div>
                    <div className="text-3xl font-black text-amber-300 tracking-[0.2em] ttd-num">
                      {session.pin}
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    <div className="text-sm font-bold text-amber-100">
                      {session.worldSetup?.mapSize ?? 64}×
                      {session.worldSetup?.mapSize ?? 64} kart •{' '}
                      {session.worldSetup?.gameMode === 'multiplayer'
                        ? `Flerspiller (${session.worldSetup.playersPerWorld} spillere per verden)`
                        : 'Enkeltspiller'}
                    </div>
                    <div className="text-xs text-slate-300">
                      Påmeldte spillere:{' '}
                      <strong className="text-emerald-300">
                        {session.assignedCount ?? students.length}
                      </strong>{' '}
                      • Aktive verdener:{' '}
                      <strong className="text-sky-300">
                        {Math.max(1, worldBuckets.length)}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="ttd-inset px-3.5 py-1.5 text-center ttd-num">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">
                      TID IGJEN
                    </div>
                    <div
                      className={`text-xl font-black ${
                        session.durationMinutes > 0 &&
                        remainingSec !== null &&
                        remainingSec <= 180
                          ? 'text-rose-400 animate-pulse'
                          : 'text-emerald-300'
                      }`}
                    >
                      {formatTimerBig(remainingSec, session.durationMinutes)}
                    </div>
                  </div>

                  {isTeacherAdmin && onReturnToMainMenu && (
                    <button
                      type="button"
                      onClick={onReturnToMainMenu}
                      className="ttd-btn ttd-btn-brass !py-2 !px-2.5"
                      title="Åpne fullskjerm Storskjerm-visning"
                    >
                      <Presentation className="w-4 h-4" />
                      <span>Storskjerm</span>
                    </button>
                  )}

                  {isTeacherAdmin && (
                    <button
                      type="button"
                      onClick={onDisconnect}
                      className="ttd-btn ttd-btn-red !py-2 !px-2.5"
                      title="Avslutt økt"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* World Buckets Summary */}
              {worldBuckets.length > 0 && (
                <div className="ttd-panel p-2 space-y-1.5">
                  <div className="text-[11px] font-bold text-amber-200 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-sky-300" />
                    <span>Fordeling i verdener:</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {worldBuckets.map((b) => (
                      <div
                        key={b.worldIndex}
                        className="ttd-inset px-2.5 py-1 flex items-center gap-2 text-[11px] ttd-num"
                      >
                        <strong className="text-amber-200">
                          Verden {b.worldIndex} ({b.members.length}/{b.capacity})
                        </strong>
                        <span className="text-slate-300">
                          {b.members.map((m) => m.playerName).join(', ')}
                        </span>
                        {isTeacherAdmin && onInspectWorld && (
                          <button
                            type="button"
                            onClick={() => onInspectWorld(b.worldIndex)}
                            className={`ttd-btn !px-1.5 !py-0.5 !text-[10px] ${
                              assignedWorldIndex === b.worldIndex
                                ? 'ttd-btn-active'
                                : 'ttd-btn-teal'
                            }`}
                          >
                            <Eye className="w-2.5 h-2.5" />
                            <span>Se kart</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* REAL-TIME SORTABLE LEADERBOARD */}
      {session && (
        <div className="ttd-panel p-2 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-amber-200 text-xs flex items-center gap-1.5">
                <Trophy className="w-4 h-4 text-amber-300" />
                <span>Ledertavle ({sortedStudents.length})</span>
              </span>

              {worldBuckets.length > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setWorldFilter('all')}
                    className={`ttd-btn !px-1.5 !py-0.5 !text-[10px] ${
                      worldFilter === 'all' ? 'ttd-btn-active' : ''
                    }`}
                  >
                    Alle
                  </button>
                  {worldBuckets.map((b) => (
                    <button
                      key={b.worldIndex}
                      type="button"
                      onClick={() => setWorldFilter(b.worldIndex)}
                      className={`ttd-btn !px-1.5 !py-0.5 !text-[10px] ttd-num ${
                        worldFilter === b.worldIndex ? 'ttd-btn-active' : ''
                      }`}
                    >
                      V{b.worldIndex}
                    </button>
                  ))}
                </div>
              )}
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

          <div className="ttd-inset overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-left border-collapse ttd-num">
              <thead>
                <tr className="border-b border-slate-700 text-[11px] text-amber-200 bg-slate-900/80">
                  <th className="p-1.5 w-10 text-center">#</th>
                  <th className="p-1.5 w-20">Verden</th>
                  <th className="p-1.5">Spiller & Selskap</th>
                  <th
                    onClick={() => setSortKey('companyValue')}
                    className="p-1.5 text-right cursor-pointer hover:text-amber-300"
                  >
                    Selskapsverdi
                  </th>
                  <th
                    onClick={() => setSortKey('personalNetWorth')}
                    className="p-1.5 text-right cursor-pointer hover:text-amber-300"
                  >
                    Privat Formue
                  </th>
                  <th
                    onClick={() => setSortKey('hqTier')}
                    className="p-1.5 text-center cursor-pointer hover:text-amber-300"
                  >
                    HQ Nivå
                  </th>
                  <th
                    onClick={() => setSortKey('totalTaxPaid')}
                    className="p-1.5 text-right cursor-pointer hover:text-amber-300"
                  >
                    Betalt Skatt
                  </th>
                  <th
                    onClick={() => setSortKey('annualProfit')}
                    className="p-1.5 text-right cursor-pointer hover:text-amber-300"
                  >
                    Årsresultat
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-xs">
                {sortedStudents.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-5 text-center text-slate-400">
                      Venter på at elever kobler til med PIN{' '}
                      <strong className="text-amber-300">{session.pin}</strong>...
                    </td>
                  </tr>
                ) : (
                  sortedStudents.map((st, idx) => (
                    <tr key={st.studentId} className="hover:bg-slate-800/60">
                      <td className="p-1.5 text-center font-extrabold">
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
                      <td className="p-1.5">
                        <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-600 text-sky-200 text-[10px] font-bold">
                          V#{st.worldIndex || 1}
                        </span>
                      </td>
                      <td className="p-1.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 shrink-0 border border-black/60"
                            style={{
                              backgroundColor: st.playerColor || '#2563eb',
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
                      <td className="p-1.5 text-right font-bold text-sky-300">
                        {formatKr(st.companyValue)}
                      </td>
                      <td className="p-1.5 text-right font-bold text-amber-300">
                        {formatKr(st.personalNetWorth)}
                      </td>
                      <td className="p-1.5 text-center">
                        <span className="px-1.5 py-0.5 bg-slate-800 text-amber-200 font-bold text-[11px]">
                          {st.hqTier > 0 ? `Nivå ${st.hqTier}` : 'Ingen'}
                        </span>
                      </td>
                      <td className="p-1.5 text-right font-semibold text-emerald-300">
                        {formatKr(st.totalTaxPaid)}
                      </td>
                      <td
                        className={`p-1.5 text-right font-semibold ${
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
      )}
    </TTDWindow>
  );
};
