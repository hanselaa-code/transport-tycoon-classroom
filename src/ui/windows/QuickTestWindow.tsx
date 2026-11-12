import React, { useState } from 'react';
import {
  Wrench,
  FastForward,
  TrainFront,
  Truck,
  Bus,
  Coins,
  HelpCircle,
} from 'lucide-react';
import type { DemoRouteType } from '../../types/game';
import { GameEngine } from '../../core';
import { TTDWindow } from '../TTDWindow';

export interface QuickTestWindowProps {
  engine: GameEngine;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onFocusTile: (x: number, y: number) => void;
}

export const QuickTestWindow: React.FC<QuickTestWindowProps> = ({
  engine,
  zIndex,
  onFocus,
  onClose,
  onFocusTile,
}) => {
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null
  );

  const handleSpawnDemo = (type: DemoRouteType, label: string) => {
    const res = engine.spawnDemoRoute(type);
    if (res.ok) {
      const nextState = engine.getState();
      if (res.vehicleId) {
        const v = nextState.vehicles.find((veh) => veh.id === res.vehicleId);
        if (v) onFocusTile(Math.round(v.x), Math.round(v.y));
      } else if (res.stationId) {
        const s = nextState.stations.find((st) => st.id === res.stationId);
        if (s) onFocusTile(s.x, s.y);
      }
      setFeedback({
        ok: true,
        msg: res.message ?? `Bygde ferdig demorute (${label})!`,
      });
    } else {
      setFeedback({
        ok: false,
        msg: res.message ?? `Kunne ikke bygge ${label}.`,
      });
    }
  };

  return (
    <TTDWindow
      id="quick_test"
      title="Hurtigtest (Lærer / Utvikler) & 4-stegs Oppstartsguide"
      subtitle="Rask demonstrasjon i klasserommet"
      icon={<Wrench className="w-3.5 h-3.5" />}
      theme="slate"
      defaultX={310}
      defaultY={58}
      width={540}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      {/* Concise 4-Step Quick-Start Help Card for New Students */}
      <div className="ttd-panel p-2.5 space-y-2 bg-emerald-950/20">
        <div className="font-bold text-emerald-300 text-xs flex items-center gap-1.5">
          <HelpCircle className="w-4 h-4 text-emerald-400" />
          <span>Kom i gang på 2 minutter – 4 enkle steg for nye elever:</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
          <div className="ttd-inset p-2">
            <strong className="text-amber-300">1. Finn tilbud & etterspørsel:</strong>{' '}
            Åpne <em>Byer & Kart</em>. Finn f.eks. to nærliggende byer (Passasjerer) eller en Kullgruve &rarr; Kraftverk.
          </div>
          <div className="ttd-inset p-2">
            <strong className="text-amber-300">2. Bygg stasjoner & linje:</strong>{' '}
            Plasser stasjoner innen 4 ruter fra by/industri, dra vei eller jernbanespor mellom dem, og sett et Depot inntil linjen.
          </div>
          <div className="ttd-inset p-2">
            <strong className="text-amber-300">3. Kjøp kjøretøy & gi ordre:</strong>{' '}
            Klikk på Depotet, kjøp buss/lastebil/tog, legg begge stasjonene i kjøreordren og trykk <em>Start kjøretøy</em>!
          </div>
          <div className="ttd-inset p-2">
            <strong className="text-amber-300">4. Styr Selskap AS & Privat:</strong>{' '}
            Ta ut bruttolønn i <em>Privat & Skatt</em> (se trinnskatt!), oppgrader <em>HQ</em> for lavere bankrente og kjøp aksjer på <em>Børsen</em>!
          </div>
        </div>
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

      {/* Demo Routes */}
      <div className="ttd-panel p-2.5 space-y-2">
        <div className="font-bold text-amber-200 text-xs">
          1-klikks Demoruter (bygger linje, stasjoner, depot og kjørende fartøy):
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => handleSpawnDemo('coal_rail', 'Kulltog')}
            className="ttd-btn ttd-btn-teal !py-2"
          >
            <TrainFront className="w-4 h-4 text-sky-200 shrink-0" />
            <span>Bygg demorute: Kulltog (Rail)</span>
          </button>

          <button
            type="button"
            onClick={() => handleSpawnDemo('wood_truck', 'Tømmerbil')}
            className="ttd-btn ttd-btn-teal !py-2"
          >
            <Truck className="w-4 h-4 text-amber-200 shrink-0" />
            <span>Bygg demorute: Tømmerbil (Truck)</span>
          </button>

          <button
            type="button"
            onClick={() => handleSpawnDemo('bus_line', 'Bussrute')}
            className="ttd-btn ttd-btn-teal !py-2"
          >
            <Bus className="w-4 h-4 text-emerald-200 shrink-0" />
            <span>Bygg demorute: Bussrute</span>
          </button>
        </div>
      </div>

      {/* Time Fast-Forward & Dev Funds */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="ttd-panel p-2.5 space-y-1.5">
          <div className="font-bold text-amber-200 text-xs">
            Tidsakselerasjon (Test skatt, utbytte & AI):
          </div>
          <button
            type="button"
            onClick={() => {
              engine.fastForwardMonths(1);
              setFeedback({
                ok: true,
                msg: 'Spolte frem +1 måned (lønn, skatt og renter bokført)!',
              });
            }}
            className="ttd-btn w-full !py-1.5"
          >
            <FastForward className="w-3.5 h-3.5 text-sky-300" />
            <span>Spol frem +1 mnd</span>
          </button>
          <button
            type="button"
            onClick={() => {
              engine.fastForwardMonths(12);
              setFeedback({
                ok: true,
                msg: 'Spolte frem +1 år! Sjekk Aksjemarkedet for nye AI-konkurrenter.',
              });
            }}
            className="ttd-btn ttd-btn-brass w-full !py-1.5"
          >
            <FastForward className="w-3.5 h-3.5 text-amber-200" />
            <span>Spol frem +1 år (Spawn neste AI)</span>
          </button>
        </div>

        <div className="ttd-panel p-2.5 space-y-1.5">
          <div className="font-bold text-amber-200 text-xs">
            Testmidler (Demonstrer AS vs. Privat):
          </div>
          <button
            type="button"
            onClick={() => {
              engine.grantDevFunds('corporate', 500_000);
              setFeedback({
                ok: true,
                msg: 'Tildelte +500 000 kr til Selskap AS!',
              });
            }}
            className="ttd-btn ttd-btn-green w-full !py-1.5 ttd-num"
          >
            <Coins className="w-3.5 h-3.5" />
            <span>+500 000 kr Selskap</span>
          </button>
          <button
            type="button"
            onClick={() => {
              engine.grantDevFunds('personal', 250_000);
              setFeedback({
                ok: true,
                msg: 'Tildelte +250 000 kr til Eiers Privatkonto!',
              });
            }}
            className="ttd-btn ttd-btn-brass w-full !py-1.5 ttd-num"
          >
            <Coins className="w-3.5 h-3.5" />
            <span>+250 000 kr Privat</span>
          </button>
        </div>
      </div>
    </TTDWindow>
  );
};
