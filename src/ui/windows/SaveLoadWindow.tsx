import React, { useRef, useState } from 'react';
import {
  Save,
  Download,
  Upload,
  RotateCcw,
  CheckCircle2,
  Building2,
  LogOut,
  Home,
} from 'lucide-react';
import type { GameState, ScenarioType } from '../../types/game';
import { GameEngine } from '../../core';
import { SCENARIO_LABELS_NO } from '../formatters';
import { TTDWindow } from '../TTDWindow';

export interface SaveLoadWindowProps {
  engine: GameEngine;
  state: GameState;
  isLockedStudentPinSession?: boolean;
  teacherEmail?: string | null;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onReturnToMainMenu?: () => void;
  onSignOutTeacher?: () => void;
}

export const SaveLoadWindow: React.FC<SaveLoadWindowProps> = ({
  engine,
  state,
  isLockedStudentPinSession = false,
  teacherEmail = null,
  zIndex,
  onFocus,
  onClose,
  onReturnToMainMenu,
  onSignOutTeacher,
}) => {
  const [companyName, setCompanyName] = useState(state.corporate.companyName);
  const [ownerName, setOwnerName] = useState(state.personal.ownerName);
  const [scenario, setScenario] = useState<ScenarioType>(state.scenario);
  const [mapSize, setMapSize] = useState<64 | 96 | 128 | 160>(
    state.mapSize === 160
      ? 160
      : state.mapSize === 128
      ? 128
      : state.mapSize === 96
      ? 96
      : 64
  );
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleManualSave = () => {
    const ok = engine.saveToLocalStorage();
    setFeedback({
      ok,
      msg: ok
        ? 'Spillet ble lagret i nettleseren (localStorage)!'
        : 'Kunne ikke lagre i localStorage.',
    });
  };

  const handleExportJson = () => {
    try {
      const json = engine.exportSaveJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = state.corporate.companyName
        .toLowerCase()
        .replace(/[^a-z0-9æøå]+/gi, '-');
      a.href = url;
      a.download = `tt-klasserom-${safeName || 'spill'}-aar${state.date.year}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setFeedback({
        ok: true,
        msg: 'Eksporterte lagringsfil (.json) til Nedlastinger!',
      });
    } catch {
      setFeedback({ ok: false, msg: 'Feil ved eksport av JSON-fil.' });
    }
  };

  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = engine.importSaveJson(text);
      setFeedback({
        ok: res.ok,
        msg:
          res.message ??
          (res.ok
            ? 'Spillet ble lastet inn fra fil!'
            : 'Ugyldig lagringsfil (.json).'),
      });
    } catch {
      setFeedback({ ok: false, msg: 'Kunne ikke lese valgt fil.' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    engine.renameCompanyAndOwner(companyName, ownerName);
    setFeedback({ ok: true, msg: 'Oppdaterte selskaps- og eiernavn!' });
  };

  const handleNewGame = () => {
    engine.resetNewGame(scenario, mapSize);
    engine.saveToLocalStorage();
    setFeedback({
      ok: true,
      msg: `Startet nytt spill (${SCENARIO_LABELS_NO[scenario].title}, ${mapSize}x${mapSize} kart)!`,
    });
  };

  return (
    <TTDWindow
      id="save_load"
      title="Lagre, Eksporter & Nytt Spill"
      subtitle="Automatisk lagring hver spillmåned"
      icon={<Save className="w-3.5 h-3.5" />}
      theme="slate"
      defaultX={280}
      defaultY={62}
      width={500}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      {/* Auto-save indicator */}
      <div className="ttd-panel p-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <div>
            <div className="font-bold text-emerald-300 text-xs">
              Autolagring er aktiv i nettleseren
            </div>
            <div className="text-[11px] text-slate-300 ttd-num">
              {state.lastSavedAtMs
                ? `Sist lagret kl. ${new Date(state.lastSavedAtMs).toLocaleTimeString('no-NO')}`
                : 'Lagres automatisk ved hvert månedsskifte'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleManualSave}
          className="ttd-btn ttd-btn-green !py-1.5 !px-3"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Lagre nå</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`ttd-inset p-2 text-[11px] font-semibold ${
            feedback.ok ? 'text-emerald-300' : 'text-rose-300'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* Export / Import JSON */}
      <div className="ttd-panel p-2.5 space-y-2">
        <div className="font-bold text-amber-200 text-xs">
          Sikkerhetskopi til fil (.json) – ta med spillet til annen Chromebook/PC
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportJson}
            className="ttd-btn ttd-btn-teal flex-1 !py-2"
          >
            <Download className="w-4 h-4" />
            <span>Eksporter .json-fil</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="ttd-btn flex-1 !py-2"
          >
            <Upload className="w-4 h-4 text-amber-300" />
            <span>Importer .json-fil</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportFileChange}
            className="hidden"
          />
        </div>
      </div>

      {/* Rename Company & Owner */}
      <form onSubmit={handleRename} className="ttd-panel p-2.5 space-y-2">
        <div className="font-bold text-amber-200 text-xs flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5 text-sky-300" />
          <span>Endre navn på Selskap AS & Eier</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            maxLength={40}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Selskapsnavn AS"
            className="ttd-inset px-2 py-1 text-xs text-slate-100"
          />
          <input
            type="text"
            maxLength={40}
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Eiernavn"
            className="ttd-inset px-2 py-1 text-xs text-slate-100"
          />
        </div>
        <div className="flex justify-end">
          <button type="submit" className="ttd-btn !py-1 !px-3">
            Oppdater navn
          </button>
        </div>
      </form>

      {/* New Game / Scenario Selector (Teacher Mode) OR Session Info (Student PIN) */}
      {!isLockedStudentPinSession ? (
        <div className="ttd-panel p-2.5 space-y-2">
          <div className="font-bold text-amber-200 text-xs">
            Hurtigstart nytt kart (Lærer-modus)
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-300 mb-1">
                Scenario:
              </label>
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value as ScenarioType)}
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

            <div>
              <label className="block text-[11px] text-slate-300 mb-1">
                Kartstørrelse:
              </label>
              <select
                value={mapSize}
                onChange={(e) =>
                  setMapSize(Number(e.target.value) as 64 | 96 | 128 | 160)
                }
                className="ttd-inset w-full px-2 py-1.5 text-xs text-slate-100"
              >
                <option value={64}>64 × 64 (Lite)</option>
                <option value={96}>96 × 96 (Middels)</option>
                <option value={128}>128 × 128 (Stort)</option>
                <option value={160}>160 × 160 (Svært stort)</option>
              </select>
            </div>
          </div>

          <div className="text-[11px] text-slate-300">
            {SCENARIO_LABELS_NO[scenario].subtitle}
          </div>

          <button
            type="button"
            onClick={handleNewGame}
            className="ttd-btn ttd-btn-red w-full !py-2"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Generer nytt kart & start på nytt</span>
          </button>
        </div>
      ) : (
        <div className="ttd-panel p-2.5 text-[11px] text-slate-300">
          Du spiller i en aktiv <strong className="text-amber-200">Klasseroms-økt (PIN)</strong>. Kartinnstillinger og verdensfrø styres av læreren slik at alle i klassen konkurrerer på like vilkår!
        </div>
      )}

      {/* Return to Main Menu / Sign Out */}
      {(onReturnToMainMenu || onSignOutTeacher) && (
        <div className="ttd-panel p-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-slate-300">
            {teacherEmail ? (
              <span>
                Innlogget lærer: <strong className="text-amber-200">{teacherEmail}</strong>
              </span>
            ) : (
              <span>Gå tilbake til hovedmeny for å bytte PIN-økt eller oppsett</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {onReturnToMainMenu && (
              <button
                type="button"
                onClick={onReturnToMainMenu}
                className="ttd-btn ttd-btn-brass !py-1.5 !px-3"
              >
                <Home className="w-3.5 h-3.5" />
                <span>Tilbake til hovedmeny</span>
              </button>
            )}
            {teacherEmail && onSignOutTeacher && (
              <button
                type="button"
                onClick={onSignOutTeacher}
                className="ttd-btn ttd-btn-red !py-1.5 !px-3"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logg ut</span>
              </button>
            )}
          </div>
        </div>
      )}
    </TTDWindow>
  );
};
