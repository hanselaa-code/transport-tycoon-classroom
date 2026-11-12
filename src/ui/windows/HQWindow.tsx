import React, { useState } from 'react';
import { Landmark, Crosshair, CheckCircle2, ArrowUpCircle, Lock, Wallet } from 'lucide-react';
import type { GameState, ToolType } from '../../types/game';
import { GameEngine, HQ_TIERS } from '../../core';
import { formatKr } from '../formatters';
import { TTDWindow } from '../TTDWindow';

export interface HQWindowProps {
  engine: GameEngine;
  state: GameState;
  activeTool: ToolType;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onSelectTool: (tool: ToolType) => void;
  onFocusTile: (x: number, y: number) => void;
}

export const HQWindow: React.FC<HQWindowProps> = ({
  engine,
  state,
  activeTool,
  zIndex,
  onFocus,
  onClose,
  onSelectTool,
  onFocusTile,
}) => {
  const { corporate, personal } = state;
  const currentTier = corporate.hqTier;
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleUpgrade = () => {
    const res = engine.upgradeHQ();
    if (res.ok) {
      setFeedback({
        ok: true,
        msg: res.message ?? 'Hovedkontoret ble oppgradert!',
      });
    } else {
      setFeedback({
        ok: false,
        msg: res.message ?? 'Ikke nok privat kapital til oppgradering.',
      });
    }
  };

  return (
    <TTDWindow
      id="hq"
      title="Hovedkontor (HQ) – Prestisje & Selskapsfordeler"
      subtitle="Betales med Eiers Privatkonto"
      icon={<Landmark className="w-3.5 h-3.5" />}
      theme="brass"
      defaultX={260}
      defaultY={60}
      width={540}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      {/* Top Status & Personal Cash */}
      <div className="ttd-panel p-2.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] text-amber-200 font-semibold">
            Din private saldo (brukes til HQ):
          </div>
          <div className="text-sm font-extrabold text-amber-300 ttd-num flex items-center gap-1.5">
            <Wallet className="w-4 h-4 text-amber-400" />
            <span>{formatKr(personal.cash)}</span>
          </div>
        </div>

        {currentTier === 0 || !corporate.hqTile ? (
          <button
            type="button"
            onClick={() =>
              onSelectTool(activeTool === 'PLACE_HQ' ? 'SELECT' : 'PLACE_HQ')
            }
            className={`ttd-btn ttd-btn-brass !px-3 !py-2 !text-xs ${
              activeTool === 'PLACE_HQ' ? 'ttd-btn-active' : ''
            }`}
          >
            <Crosshair className="w-4 h-4" />
            <span>
              {activeTool === 'PLACE_HQ'
                ? 'Klikk på en ledig gressrute på kartet...'
                : `Plasser Hovedkontor Nivå 1 (${formatKr(HQ_TIERS[0]?.personalCost ?? 25_000)})`}
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <div className="text-right text-[11px] ttd-num">
              <div className="font-bold text-emerald-300">
                Aktiv bonus: -{(currentTier * 0.5).toFixed(1)}% lånerente
              </div>
              <div className="text-sky-300">
                +{currentTier * 5}% stasjonsvurdering nær HQ
              </div>
            </div>
            <button
              type="button"
              onClick={() => onFocusTile(corporate.hqTile!.x, corporate.hqTile!.y)}
              className="ttd-btn !px-2.5 !py-1.5"
              title="Sentrer kamera på Hovedkontor"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Vis HQ</span>
            </button>
          </div>
        )}
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

      {/* 5-Tier Upgrade Ladder */}
      <div className="space-y-1.5">
        <div className="text-[11px] text-slate-300 font-semibold px-0.5">
          Oppgraderingsstige (Nivå 1 til 5 — gir lavere bankrente og høyere stasjonsrykte):
        </div>

        <div className="space-y-1.5">
          {HQ_TIERS.map((spec) => {
            const isUnlocked = currentTier >= spec.tier;
            const isCurrent = currentTier === spec.tier;
            const isNext = currentTier > 0 && spec.tier === currentTier + 1;
            const isPlaceStep = currentTier === 0 && spec.tier === 1;
            const canAfford = personal.cash >= spec.personalCost;

            return (
              <div
                key={spec.tier}
                className={`ttd-inset p-2.5 flex flex-wrap items-center justify-between gap-2 ${
                  isCurrent
                    ? 'ring-2 ring-amber-400 bg-amber-950/25'
                    : isUnlocked
                    ? 'bg-emerald-950/15 opacity-90'
                    : ''
                }`}
              >
                <div className="space-y-0.5 flex-1 min-w-[220px]">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-bold text-[10px] ttd-num">
                      NIVÅ {spec.tier}
                    </span>
                    <span className="font-bold text-amber-100 text-xs">
                      {spec.nameNo}
                    </span>
                    <span className="text-[10px] text-slate-400">({spec.name})</span>
                  </div>
                  <div className="text-[11px] text-slate-300">{spec.description}</div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] pt-0.5 ttd-num">
                    <span className="text-emerald-300 font-semibold">
                      • Bankrente: -{spec.loanInterestDiscountPct.toFixed(1)}%
                    </span>
                    <span className="text-sky-300 font-semibold">
                      • Nærliggende stasjoner: +{spec.nearbyStationRatingBonusPct}% vurdering
                    </span>
                  </div>
                </div>

                <div className="shrink-0 text-right ttd-num">
                  {isUnlocked ? (
                    <span className="inline-flex items-center gap-1 text-emerald-300 font-bold text-xs px-2 py-1 rounded bg-emerald-950/60 border border-emerald-700/50">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isCurrent ? 'Nåværende HQ' : 'Oppnådd'}</span>
                    </span>
                  ) : isPlaceStep ? (
                    <button
                      type="button"
                      disabled={!canAfford}
                      onClick={() => onSelectTool('PLACE_HQ')}
                      className="ttd-btn ttd-btn-brass !py-1.5 !px-3"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                      <span>Plasser ({formatKr(spec.personalCost)})</span>
                    </button>
                  ) : isNext ? (
                    <button
                      type="button"
                      disabled={!canAfford}
                      onClick={handleUpgrade}
                      className="ttd-btn ttd-btn-green !py-1.5 !px-3"
                    >
                      <ArrowUpCircle className="w-4 h-4" />
                      <span>Oppgrader ({formatKr(spec.personalCost)})</span>
                    </button>
                  ) : (
                    <div className="text-slate-400 text-[11px] flex items-center gap-1 justify-end">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Pris: {formatKr(spec.personalCost)}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </TTDWindow>
  );
};
