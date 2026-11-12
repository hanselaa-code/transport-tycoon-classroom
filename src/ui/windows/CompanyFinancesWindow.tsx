import React, { useMemo } from 'react';
import { Building2, AlertTriangle, Plus, Minus, Landmark } from 'lucide-react';
import type { GameState, PnLStatement } from '../../types/game';
import { GameEngine } from '../../core';
import { formatKr } from '../formatters';
import { TTDWindow } from '../TTDWindow';

export interface CompanyFinancesWindowProps {
  engine: GameEngine;
  state: GameState;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
}

function calcNetPnL(pnl: PnLStatement): number {
  return (
    pnl.freightRevenue -
    (pnl.constructionCost +
      pnl.vehiclePurchaseCost +
      pnl.vehicleRunningCost +
      pnl.loanInterestCost +
      pnl.ownerSalaryCost +
      pnl.employerPayrollTaxCost)
  );
}

export const CompanyFinancesWindow: React.FC<CompanyFinancesWindowProps> = ({
  engine,
  state,
  zIndex,
  onFocus,
  onClose,
}) => {
  const { corporate } = state;
  const cur = corporate.currentYearPnL;
  const prev = corporate.lastYearPnL;

  const curNet = calcNetPnL(cur);
  const prevNet = calcNetPnL(prev);

  const fleetValue = useMemo(() => {
    return state.vehicles
      .filter((v) => !v.ownerId || v.ownerId === 'player')
      .reduce((sum, v) => {
        const depFactor = Math.max(0.25, 1 - v.ageMonths * 0.008);
        return sum + Math.round(v.purchaseValue * depFactor);
      }, 0);
  }, [state.vehicles]);

  const monthlyLoanInterest = Math.round(
    (corporate.loan * (corporate.annualInterestRate / 100)) / 12
  );
  const hqDiscountPct = corporate.hqTier * 0.5;

  const rows: Array<{
    label: string;
    curVal: number;
    prevVal: number;
    isRevenue?: boolean;
    highlight?: boolean;
  }> = [
    {
      label: 'Frakt- og billettinntekter',
      curVal: cur.freightRevenue,
      prevVal: prev.freightRevenue,
      isRevenue: true,
    },
    {
      label: 'Infrastruktur & utbygging',
      curVal: -cur.constructionCost,
      prevVal: -prev.constructionCost,
    },
    {
      label: 'Kjøp av kjøretøy (Investering)',
      curVal: -cur.vehiclePurchaseCost,
      prevVal: -prev.vehiclePurchaseCost,
    },
    {
      label: 'Driftskostnader kjøretøy',
      curVal: -cur.vehicleRunningCost,
      prevVal: -prev.vehicleRunningCost,
    },
    {
      label: 'Renter på banklån',
      curVal: -cur.loanInterestCost,
      prevVal: -prev.loanInterestCost,
    },
    {
      label: 'Eierens bruttolønn',
      curVal: -cur.ownerSalaryCost,
      prevVal: -prev.ownerSalaryCost,
    },
    {
      label: 'Arbeidsgiveravgift (14,1 %)',
      curVal: -cur.employerPayrollTaxCost,
      prevVal: -prev.employerPayrollTaxCost,
      highlight: true,
    },
  ];

  return (
    <TTDWindow
      id="company_finances"
      title={`Selskapsøkonomi – ${corporate.companyName}`}
      subtitle="Aksjeselskap (AS) • Egen juridisk økonomi"
      icon={<Building2 className="w-3.5 h-3.5" />}
      theme={corporate.cash < 0 || corporate.isBankruptWarning ? 'crimson' : 'teal'}
      defaultX={110}
      defaultY={56}
      width={580}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      {/* Liquidity / Bankruptcy Warning Banner */}
      {(corporate.cash < 0 || corporate.isBankruptWarning) && (
        <div className="ttd-cash-negative border-2 p-2.5 flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-bold text-xs uppercase tracking-wide">
              Likviditetsvarsel / Konkursfare! Selskapskassen er negativ ({formatKr(corporate.cash)})
            </div>
            <div className="text-[11px]">
              Aksjeselskapet mangler kontanter til løpende drift. Ta opp mer banklån under, reduser eierlønn, eller selg ulønnsomme kjøretøy!
            </div>
          </div>
        </div>
      )}

      {/* Resultatregnskap (P&L) */}
      <div className="ttd-panel p-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="font-bold text-amber-200 text-xs">
            Resultatregnskap (P&L)
          </span>
          <span className="text-[11px] text-slate-300">
            Inntekter minus kostnader i aksjeselskapet
          </span>
        </div>

        <div className="ttd-inset overflow-x-auto">
          <table className="w-full text-left border-collapse ttd-num">
            <thead>
              <tr className="border-b border-slate-700 text-[11px] text-amber-200 bg-slate-900/70">
                <th className="p-1.5">Regnskapspost</th>
                <th className="p-1.5 text-right">
                  I fjor {prev.year > 0 ? `(År ${prev.year})` : ''}
                </th>
                <th className="p-1.5 text-right">I år (År {cur.year})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-[11px]">
              {rows.map((r) => (
                <tr
                  key={r.label}
                  className={r.highlight ? 'bg-amber-950/20' : undefined}
                >
                  <td className="p-1.5 text-slate-200 font-medium">{r.label}</td>
                  <td
                    className={`p-1.5 text-right ${
                      r.prevVal > 0
                        ? 'text-emerald-300'
                        : r.prevVal < 0
                        ? 'text-rose-300'
                        : 'text-slate-400'
                    }`}
                  >
                    {formatKr(r.prevVal, r.isRevenue)}
                  </td>
                  <td
                    className={`p-1.5 text-right font-semibold ${
                      r.curVal > 0
                        ? 'text-emerald-300'
                        : r.curVal < 0
                        ? 'text-rose-300'
                        : 'text-slate-400'
                    }`}
                  >
                    {formatKr(r.curVal, r.isRevenue)}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-900/90 border-t-2 border-slate-600 font-bold text-xs">
                <td className="p-2 text-amber-100">Netto Driftsresultat</td>
                <td
                  className={`p-2 text-right ${
                    prevNet >= 0 ? 'text-emerald-300' : 'text-rose-400'
                  }`}
                >
                  {formatKr(prevNet, true)}
                </td>
                <td
                  className={`p-2 text-right ${
                    curNet >= 0 ? 'text-emerald-300' : 'text-rose-400'
                  }`}
                >
                  {formatKr(curNet, true)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Balanse & Selskapsverdi + Banklån side-by-side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* Balanse */}
        <div className="ttd-panel p-2 space-y-1.5 flex flex-col justify-between">
          <div className="font-bold text-amber-200 text-xs">
            Balanse & Selskapsverdi
          </div>
          <div className="ttd-inset p-2 space-y-1 text-[11px] ttd-num">
            <div className="flex justify-between">
              <span className="text-slate-300">Kontanter (Bankinnskudd):</span>
              <span
                className={`font-bold ${
                  corporate.cash >= 0 ? 'text-emerald-300' : 'text-rose-400'
                }`}
              >
                {formatKr(corporate.cash)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">Kjøretøyflåte (Bokført):</span>
              <span className="text-sky-300 font-semibold">
                {formatKr(fleetValue)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">Langsiktig gjeld (Banklån):</span>
              <span className="text-rose-300 font-semibold">
                {corporate.loan > 0 ? `-${formatKr(corporate.loan)}` : '0 kr'}
              </span>
            </div>
            <div className="border-t border-slate-700 pt-1.5 mt-1 flex justify-between text-xs font-bold">
              <span className="text-amber-200">Selskapsverdi:</span>
              <span className="text-amber-300">
                {formatKr(corporate.companyValue)}
              </span>
            </div>
          </div>
        </div>

        {/* Bank Loan Controls */}
        <div className="ttd-panel p-2 space-y-1.5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-bold text-amber-200 text-xs flex items-center gap-1">
              <Landmark className="w-3.5 h-3.5 text-amber-300" />
              <span>Banklån (Næringsbank)</span>
            </span>
            <span className="text-[11px] text-emerald-300 font-semibold ttd-num">
              Rente: {corporate.annualInterestRate.toFixed(1)}% / år
            </span>
          </div>

          <div className="ttd-inset p-2 space-y-1 text-[11px] ttd-num">
            <div className="flex justify-between">
              <span className="text-slate-300">Nåværende lån:</span>
              <span className="font-bold text-amber-100">
                {formatKr(corporate.loan)} / {formatKr(corporate.maxLoan)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">Månedlig rentekostnad:</span>
              <span className="text-rose-300">-{formatKr(monthlyLoanInterest)}/mnd</span>
            </div>
            <div className="text-[10px] text-sky-300 pt-0.5">
              {hqDiscountPct > 0
                ? `HQ Nivå ${corporate.hqTier} gir -${hqDiscountPct.toFixed(1)}% renterabatt!`
                : 'Tips: Oppgrader Hovedkontor (HQ) for opptil -2,5% lavere lånerente!'}
            </div>
          </div>

          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              disabled={corporate.loan >= corporate.maxLoan}
              onClick={() => engine.adjustLoan(100_000)}
              className="ttd-btn ttd-btn-green flex-1 !py-1.5 ttd-num"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Lån +100 000 kr</span>
            </button>
            <button
              type="button"
              disabled={corporate.loan <= 0 || corporate.cash < 100_000}
              onClick={() => engine.adjustLoan(-100_000)}
              className="ttd-btn ttd-btn-brass flex-1 !py-1.5 ttd-num"
            >
              <Minus className="w-3.5 h-3.5" />
              <span>Nedbetal -100 000 kr</span>
            </button>
          </div>
        </div>
      </div>
    </TTDWindow>
  );
};
