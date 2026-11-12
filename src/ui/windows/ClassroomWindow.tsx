import React, { useState } from 'react';
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
} from 'lucide-react';
import type { ScenarioType } from '../../types/game';
import {
  isFirebaseConfigured,
  type ClassroomSession,
  type StudentTelemetry,
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
  session: ClassroomSession | null;
  students: StudentTelemetry[];
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
    durationMinutes: 30 | 45,
    scenario: ScenarioType
  ) => Promise<{ ok: boolean; message: string }>;
  onPushNow: () => Promise<void>;
  onDisconnect: () => void;
}

function formatTimerBig(sec: number | null): string {
  if (sec === null || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const ClassroomWindow: React.FC<ClassroomWindowProps> = ({
  role,
  session,
  students,
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
}) => {
  const [tab, setTab] = useState<'student' | 'teacher'>(
    role === 'teacher' ? 'teacher' : 'student'
  );
  const [pinInput, setPinInput] = useState(session?.pin ?? '');
  const [studentName, setStudentName] = useState(defaultStudentName);
  const [companyName, setCompanyName] = useState(defaultCompanyName);
  const [duration, setDuration] = useState<30 | 45>(45);
  const [scenario, setScenario] = useState<ScenarioType>('standard');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [sortKey, setSortKey] = useState<LeaderboardSortKey>('companyValue');

  const sortedStudents = [...students].sort((a, b) => {
    const diff = (b[sortKey] ?? 0) - (a[sortKey] ?? 0);
    if (diff !== 0) return diff;
    return b.companyValue - a.companyValue;
  });

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
    } finally {
      setBusy(false);
    }
  };

  const firebaseLive = isFirebaseConfigured();

  return (
    <TTDWindow
      id="classroom"
      title="Lærer & Klasserom – Sanntids Økonomi-økt"
      subtitle={
        firebaseLive ? 'Tilkoblet Sky (Firestore Live)' : 'Lokal synkronisering'
      }
      icon={<GraduationCap className="w-3.5 h-3.5" />}
      theme="teal"
      defaultX={160}
      defaultY={52}
      width={720}
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
            <span>Elev / Gruppe (Bli med med PIN)</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('teacher')}
            className={`ttd-btn flex-1 !py-1.5 ${
              tab === 'teacher' ? 'ttd-btn-active' : ''
            }`}
          >
            <Presentation className="w-3.5 h-3.5 text-amber-300" />
            <span>Lærer / Storskjerm (Ledertavle)</span>
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
                    <div className="text-[10px] text-slate-400 uppercase">Aktiv PIN</div>
                    <div className="text-xl font-extrabold text-emerald-300 tracking-widest ttd-num">
                      {session.pin}
                    </div>
                  </div>
                  <div>
                    <div className="font-bold text-amber-100 text-sm flex items-center gap-1.5">
                      <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                      <span>Tilkoblet klasseroms-økt!</span>
                    </div>
                    <div className="text-[11px] text-slate-300">
                      Nøkkeltall sendes automatisk hvert 30. sekund til lærerens storskjerm.
                    </div>
                    {lastTelemetrySentAt && (
                      <div className="text-[10px] text-slate-400 ttd-num">
                        Sist synkronisert:{' '}
                        {new Date(lastTelemetrySentAt).toLocaleTimeString('no-NO')}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="ttd-inset px-3 py-1.5 text-center ttd-num">
                    <div className="text-[10px] text-slate-400 uppercase">Tid igjen</div>
                    <div className="text-lg font-extrabold text-amber-300">
                      {formatTimerBig(remainingSec)}
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
                      <span>Forlat økt</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleJoinSubmit} className="ttd-panel p-3 space-y-2.5">
              <div className="text-xs font-bold text-amber-200">
                Koble til lærerens klasseroms-økt (ingen innlogging nødvendig)
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
                      setPinInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))
                    }
                    className="ttd-inset w-full px-2.5 py-1.5 text-sm font-extrabold tracking-widest text-amber-200"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">
                    Elev- / Gruppenavn:
                  </label>
                  <input
                    type="text"
                    maxLength={40}
                    placeholder="f.eks. Gruppe 3 (Ida & Leo)"
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

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-400">
                  Sender kun nøkkeltall (Selskapsverdi, Privat formue, HQ, Skatt og Årsresultat).
                </span>
                <button
                  type="submit"
                  disabled={busy || pinInput.length !== 4}
                  className="ttd-btn ttd-btn-green !px-4 !py-2 !text-xs"
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
            <div className="ttd-panel p-3 space-y-2.5">
              <div className="font-bold text-amber-200 text-xs">
                Start ny Klasseroms-økt på storskjerm / projektor
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">
                    Varighet på skoletimen:
                  </label>
                  <div className="flex items-center gap-1.5">
                    {([30, 45] as const).map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setDuration(mins)}
                        className={`ttd-btn flex-1 !py-1.5 ttd-num ${
                          duration === mins ? 'ttd-btn-active' : ''
                        }`}
                      >
                        {mins} minutter
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
                    onChange={(e) => setScenario(e.target.value as ScenarioType)}
                    className="ttd-inset w-full px-2 py-1.5 text-xs text-slate-100"
                  >
                    {(['standard', 'boom', 'challenge'] as ScenarioType[]).map((sc) => (
                      <option key={sc} value={sc}>
                        {SCENARIO_LABELS_NO[sc].title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-300">
                  {SCENARIO_LABELS_NO[scenario].subtitle}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleCreateSession}
                  className="ttd-btn ttd-btn-brass !px-4 !py-2 !text-xs"
                >
                  <Presentation className="w-4 h-4" />
                  <span>{busy ? 'Oppretter...' : 'Opprett Klasseroms-økt'}</span>
                </button>
              </div>
            </div>
          ) : (
            /* Giant Projector-Friendly PIN Banner & Countdown */
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
                    Elevene velger «Lærer / Klasserom» øverst og taster PIN {session.pin}
                  </div>
                  <div className="text-xs text-slate-300">
                    Scenario:{' '}
                    <strong className="text-sky-300">
                      {SCENARIO_LABELS_NO[session.scenario]?.title ?? session.scenario}
                    </strong>{' '}
                    • Tilkoblede grupper:{' '}
                    <strong className="text-emerald-300">{students.length}</strong>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="ttd-inset px-4 py-2 text-center ttd-num">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">
                    GJENSTÅENDE TID
                  </div>
                  <div
                    className={`text-2xl font-black ${
                      remainingSec !== null && remainingSec <= 180
                        ? 'text-rose-400 animate-pulse'
                        : 'text-emerald-300'
                    }`}
                  >
                    {formatTimerBig(remainingSec)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onDisconnect}
                  className="ttd-btn ttd-btn-red !py-2 !px-2.5"
                  title="Avslutt visning av økt"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* REAL-TIME SORTABLE LEADERBOARD (Shown whenever connected to a session!) */}
      {session && (
        <div className="ttd-panel p-2 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-amber-200 text-xs flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-amber-300" />
              <span>Sanntids Ledertavle ({sortedStudents.length} deltakere)</span>
            </span>

            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-slate-400 mr-1">Sorter etter:</span>
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
                  <th className="p-1.5 w-10 text-center">#</th>
                  <th className="p-1.5">Elev / Gruppe & Selskap</th>
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
                    <td colSpan={7} className="p-5 text-center text-slate-400">
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
                        <div className="font-bold text-amber-100">{st.studentName}</div>
                        <div className="text-[10px] text-slate-400">{st.companyName}</div>
                      </td>
                      <td className="p-1.5 text-right font-bold text-sky-300">
                        {formatKr(st.companyValue)}
                      </td>
                      <td className="p-1.5 text-right font-bold text-amber-300">
                        {formatKr(st.personalNetWorth)}
                      </td>
                      <td className="p-1.5 text-center">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-200 font-bold text-[11px]">
                          {st.hqTier > 0 ? `Nivå ${st.hqTier}` : 'Ingen'}
                        </span>
                      </td>
                      <td className="p-1.5 text-right font-semibold text-emerald-300">
                        {formatKr(st.totalTaxPaid)}
                      </td>
                      <td
                        className={`p-1.5 text-right font-semibold ${
                          st.annualProfit >= 0 ? 'text-emerald-300' : 'text-rose-400'
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
