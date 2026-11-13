import React, { useState } from 'react';
import { TrendingUp, Clock, Plus, Minus, Wallet } from 'lucide-react';
import type { AICompany, GameState } from '../../types/game';
import { GameEngine } from '../../core';
import { formatKr } from '../formatters';
import { TTDWindow } from '../TTDWindow';

export interface StockMarketWindowProps {
  engine: GameEngine;
  state: GameState;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
}

const Sparkline: React.FC<{ history: number[]; color: string }> = ({
  history,
  color,
}) => {
  const pts = history.length >= 2 ? history : [history[0] ?? 100, history[0] ?? 100];
  const min = Math.min(...pts) * 0.95;
  const max = Math.max(...pts) * 1.05 || 1;
  const range = Math.max(1, max - min);
  const w = 130;
  const h = 34;

  const coords = pts
    .map((v, idx) => {
      const x = (idx / (pts.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} className="ttd-inset bg-slate-950/80 shrink-0">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        points={coords}
      />
    </svg>
  );
};

export const StockMarketWindow: React.FC<StockMarketWindowProps> = ({
  engine,
  state,
  zIndex,
  onFocus,
  onClose,
}) => {
  const { aiCompanies, personal, date } = state;
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleBuy = (ai: AICompany) => {
    const pct = Math.min(10, Math.max(0, 75 - ai.playerSharesPct));
    const res = engine.buyAIShares(ai.id, pct > 0 ? pct : 10);
    setFeedback({
      ok: res.ok,
      msg:
        res.message ??
        (res.ok
          ? `Kjøpte aksjepost i ${ai.name}!`
          : 'Kunne ikke kjøpe aksjer (sjekk privat saldo eller 75% maksgrense).'),
    });
  };

  const handleSell = (ai: AICompany) => {
    const pct = ai.playerSharesPct % 10 === 5 ? 5 : 10;
    const res = engine.sellAIShares(ai.id, pct);
    setFeedback({
      ok: res.ok,
      msg:
        res.message ??
        (res.ok ? `Solgte aksjepost i ${ai.name}!` : 'Kunne ikke selge aksjer.'),
    });
  };

  return (
    <TTDWindow
      id="stock_market"
      title="Oslo Børs – Aksjemarked & AI-Konkurrenter"
      subtitle="Invester privat kapital • Motta kvartalsvis utbytte"
      icon={<TrendingUp className="w-3.5 h-3.5" />}
      theme="purple"
      defaultX={210}
      defaultY={56}
      width={620}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      {/* Header Bar */}
      <div className="ttd-panel p-2 flex flex-wrap items-center justify-between gap-2 text-xs ttd-num">
        <div className="flex items-center gap-1.5">
          <Wallet className="w-4 h-4 text-amber-300" />
          <span className="text-slate-200">Privat investeringskapital:</span>
          <strong className="text-amber-300 text-sm">{formatKr(personal.cash)}</strong>
        </div>
        <div className="text-[11px] text-slate-300">
          Mottatt utbytte totalt:{' '}
          <strong className="text-emerald-300">
            {formatKr(personal.dividendsReceivedTotal)}
          </strong>{' '}
          • Maks eierandel per selskap: <strong>75%</strong>
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

      {/* AI Competitors List */}
      {aiCompanies.length === 0 ? (
        <div className="ttd-panel p-4 text-center space-y-1.5">
          <div className="font-bold text-amber-200 text-xs">
            AI-konkurrenter er skrudd av i dette spillet.
          </div>
          <div className="text-[11px] text-slate-300">
            Læreren har satt opp denne verdenen uten datastyrte børs-konkurrenter. I flerspillermodus konkurrerer dere direkte mot de andre elevene i samme verden!
          </div>
        </div>
      ) : (
      <div className="space-y-2">
        {aiCompanies.map((ai) => {
          const monthsUntilIpo = Math.max(0, ai.spawnMonth - date.totalMonths);
          const spawnYear = Math.floor(ai.spawnMonth / 12) + 1;
          const nextBuyBlockPct = Math.min(10, Math.max(0, 75 - ai.playerSharesPct));
          const blockCost10Pct = Math.round(((nextBuyBlockPct || 10) / 100) * 10_000) * ai.sharePrice;
          const myQuarterlyDividend = Math.round(
            ai.dividendPerQuarter * (ai.playerSharesPct / 100)
          );

          if (!ai.spawned) {
            return (
              <div
                key={ai.id}
                className="ttd-inset p-3 flex flex-wrap items-center justify-between gap-3 opacity-85"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-3.5 h-8 rounded-xs shrink-0"
                    style={{ backgroundColor: ai.color }}
                  />
                  <div>
                    <div className="font-bold text-amber-100 text-xs">{ai.name}</div>
                    <div className="text-[11px] text-slate-400">
                      Planlagt oppstart og børsnotering (IPO) ved start av År {spawnYear}
                    </div>
                  </div>
                </div>

                <div className="ttd-panel px-2.5 py-1.5 flex items-center gap-1.5 text-amber-200 text-[11px] font-semibold ttd-num">
                  <Clock className="w-3.5 h-3.5 text-amber-300" />
                  <span>
                    Noteres om {monthsUntilIpo}{' '}
                    {monthsUntilIpo === 1 ? 'måned' : 'måneder'}
                  </span>
                </div>
              </div>
            );
          }

          return (
            <div key={ai.id} className="ttd-panel p-2.5 space-y-2 ttd-num">
              {/* Top Row: Name, Route Summary, Sparkline & Share Price */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-3.5 h-9 rounded-xs shrink-0"
                    style={{ backgroundColor: ai.color }}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-amber-100 text-sm">{ai.name}</span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700/60 text-[10px] font-bold">
                        NOTERT PÅ BØRS
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-300 truncate max-w-xs">
                      {ai.routeSummary || 'Bygger ut transportlinjer...'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <Sparkline
                    history={ai.sharePriceHistory}
                    color={ai.color || '#34d399'}
                  />
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 uppercase">Aksjekurs</div>
                    <div className="text-sm font-extrabold text-emerald-300">
                      {formatKr(ai.sharePrice)}
                    </div>
                    <div className="text-[10px] text-slate-300">
                      Verdi: {formatKr(ai.companyValue)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="ttd-inset p-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-400 block text-[10px]">Kjøretøyflåte</span>
                  <strong className="text-slate-100">{ai.fleetCount} kjøretøy</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Årsresultat</span>
                  <strong
                    className={
                      ai.annualProfit >= 0 ? 'text-emerald-300' : 'text-rose-400'
                    }
                  >
                    {formatKr(ai.annualProfit, true)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Utbytte / kvartal</span>
                  <strong className="text-amber-200">
                    {formatKr(ai.dividendPerQuarter)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Din eierandel</span>
                  <strong className="text-sky-300">
                    {ai.playerSharesPct}%{' '}
                    {myQuarterlyDividend > 0
                      ? `(+${formatKr(myQuarterlyDividend)}/kv)`
                      : ''}
                  </strong>
                </div>
              </div>

              {/* Buy / Sell Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="text-[11px] text-slate-300">
                  {nextBuyBlockPct > 0 ? (
                    <>
                      Pris for {nextBuyBlockPct}% aksjepost:{' '}
                      <strong className="text-amber-200">{formatKr(blockCost10Pct)}</strong>{' '}
                      (betales privat)
                    </>
                  ) : (
                    <span className="text-emerald-300 font-semibold">
                      Maksimal eierandel (75%) er nådd!
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={
                      ai.playerSharesPct >= 75 || personal.cash < blockCost10Pct
                    }
                    onClick={() => handleBuy(ai)}
                    className="ttd-btn ttd-btn-green !py-1 !px-2.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Kjøp {nextBuyBlockPct > 0 ? `${nextBuyBlockPct}%` : '10%'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={ai.playerSharesPct <= 0}
                    onClick={() => handleSell(ai)}
                    className="ttd-btn ttd-btn-brass !py-1 !px-2.5"
                  >
                    <Minus className="w-3.5 h-3.5" />
                    <span>Selg {ai.playerSharesPct % 10 === 5 ? '5%' : '10%'}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </TTDWindow>
  );
};
