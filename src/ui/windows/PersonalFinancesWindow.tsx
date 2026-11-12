import React, { useMemo } from 'react';
import { Wallet, HeartHandshake, Building2, Landmark, TrendingUp } from 'lucide-react';
import type { GameState } from '../../types/game';
import { GameEngine, HQ_TIERS } from '../../core';
import { formatKr, previewProgressiveTax } from '../formatters';
import { TTDWindow } from '../TTDWindow';

export interface PersonalFinancesWindowProps {
  engine: GameEngine;
  state: GameState;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
}

export const PersonalFinancesWindow: React.FC<PersonalFinancesWindowProps> = ({
  engine,
  state,
  zIndex,
  onFocus,
  onClose,
}) => {
  const { personal, corporate, aiCompanies } = state;
  const sliderGross = personal.nextMonthGrossSalary;
  const tax = useMemo(() => previewProgressiveTax(sliderGross), [sliderGross]);

  const b1Taxable = Math.min(sliderGross, 25_000);
  const b2Taxable = Math.max(0, Math.min(sliderGross, 50_000) - 25_000);
  const b3Taxable = Math.max(0, sliderGross - 50_000);

  const hqInvestedValue = useMemo(() => {
    return HQ_TIERS.filter((t) => t.tier <= corporate.hqTier).reduce(
      (sum, t) => sum + t.personalCost,
      0
    );
  }, [corporate.hqTier]);

  const stockPortfolioValue = useMemo(() => {
    return aiCompanies.reduce((sum, ai) => {
      if (!ai.spawned || ai.playerSharesPct <= 0) return sum;
      const sharesHeld = Math.round((ai.playerSharesPct / 100) * 10_000);
      return sum + sharesHeld * ai.sharePrice;
    }, 0);
  }, [aiCompanies]);

  const effectiveTaxRatePct =
    sliderGross > 0 ? ((tax.totalIncomeTax / sliderGross) * 100).toFixed(1) : '0.0';

  return (
    <TTDWindow
      id="personal_finances"
      title={`Personlig Økonomi & Skatt – ${personal.ownerName}`}
      subtitle="Privatkonto • Lønn, Trinnskatt & Formue"
      icon={<Wallet className="w-3.5 h-3.5" />}
      theme="brass"
      defaultX={190}
      defaultY={54}
      width={610}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      {/* Top Lifetime Tax & Personal Cash Highlight */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="ttd-panel p-2.5 flex items-center justify-between gap-2 bg-amber-950/25">
          <div>
            <div className="text-[11px] text-amber-200/90 font-semibold">
              Privat bankkonto (Disponibelt)
            </div>
            <div className="text-base font-extrabold text-amber-300 ttd-num">
              {formatKr(personal.cash)}
            </div>
            <div className="text-[10px] text-slate-300">
              Brukes til Hovedkontor (HQ) & aksjekjøp!
            </div>
          </div>
          <Wallet className="w-7 h-7 text-amber-400/80 shrink-0" />
        </div>

        <div className="ttd-panel p-2.5 flex items-center justify-between gap-2 bg-emerald-950/25">
          <div>
            <div className="text-[11px] text-emerald-200 font-semibold">
              Total Betalt Skatt til Fellesskapet (Livstid)
            </div>
            <div className="text-base font-extrabold text-emerald-300 ttd-num">
              {formatKr(personal.lifetimeTaxPaid)}
            </div>
            <div className="text-[10px] text-slate-300">
              Bidrar til skole, helse og offentlig infrastruktur
            </div>
          </div>
          <HeartHandshake className="w-7 h-7 text-emerald-400/80 shrink-0" />
        </div>
      </div>

      {/* Interactive Monthly Gross Salary Slider */}
      <div className="ttd-panel p-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-bold text-amber-200 text-xs">
              Fastsett månedlig bruttolønn fra AS (gjelder fra neste måned):
            </span>
            {personal.monthlyGrossSalary !== personal.nextMonthGrossSalary && (
              <span className="ml-2 text-[11px] text-sky-300 ttd-num">
                (Denne mnd: {formatKr(personal.monthlyGrossSalary)})
              </span>
            )}
          </div>
          <span className="ttd-inset px-2.5 py-0.5 font-extrabold text-sm text-amber-300 ttd-num">
            {formatKr(sliderGross)} / mnd
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={150_000}
          step={5_000}
          value={sliderGross}
          onChange={(e) => engine.setMonthlyGrossSalary(Number(e.target.value))}
          className="w-full ttd-slider"
        />

        {/* Preset pills */}
        <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
          {[0, 25_000, 35_000, 50_000, 75_000, 100_000, 150_000].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => engine.setMonthlyGrossSalary(preset)}
              className={`ttd-btn !px-2 !py-0.5 ttd-num ${
                sliderGross === preset ? 'ttd-btn-active' : ''
              }`}
            >
              {formatKr(preset)}
            </button>
          ))}
        </div>
      </div>

      {/* Visual Progressive Tax Breakdown (Trinn 1, 2, 3) */}
      <div className="ttd-panel p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-bold text-amber-200 text-xs">
            Slik beregnes din progressive inntektsskatt (Trinnskatt-modell)
          </span>
          <span className="text-[11px] text-slate-300 ttd-num">
            Gjennomsnittsskatt: <strong className="text-amber-300">{effectiveTaxRatePct}%</strong>
          </span>
        </div>

        <div className="space-y-2 ttd-inset p-2 ttd-num">
          {/* Trinn 1 */}
          <div className="space-y-0.5">
            <div className="flex justify-between text-[11px]">
              <span>
                <strong className="text-sky-300">Trinn 1 (0 – 25 000 kr):</strong> 20% skatt av{' '}
                {formatKr(b1Taxable)}
              </span>
              <span className="font-bold text-sky-300">
                {formatKr(tax.bracket1Tax)} skatt
              </span>
            </div>
            <div className="h-2.5 bg-slate-900 rounded-xs overflow-hidden border border-slate-700">
              <div
                className="h-full bg-sky-500 transition-all duration-150"
                style={{ width: `${(b1Taxable / 25_000) * 100}%` }}
              />
            </div>
          </div>

          {/* Trinn 2 */}
          <div className="space-y-0.5">
            <div className="flex justify-between text-[11px]">
              <span>
                <strong className="text-amber-300">Trinn 2 (25 001 – 50 000 kr):</strong> 30% skatt av{' '}
                {formatKr(b2Taxable)}
              </span>
              <span className="font-bold text-amber-300">
                {formatKr(tax.bracket2Tax)} skatt
              </span>
            </div>
            <div className="h-2.5 bg-slate-900 rounded-xs overflow-hidden border border-slate-700">
              <div
                className="h-full bg-amber-500 transition-all duration-150"
                style={{ width: `${(b2Taxable / 25_000) * 100}%` }}
              />
            </div>
          </div>

          {/* Trinn 3 */}
          <div className="space-y-0.5">
            <div className="flex justify-between text-[11px]">
              <span>
                <strong className="text-rose-300">Trinn 3 (Over 50 000 kr):</strong> 42% skatt av{' '}
                {formatKr(b3Taxable)}
              </span>
              <span className="font-bold text-rose-300">
                {formatKr(tax.bracket3Tax)} skatt
              </span>
            </div>
            <div className="h-2.5 bg-slate-900 rounded-xs overflow-hidden border border-slate-700">
              <div
                className="h-full bg-rose-500 transition-all duration-150"
                style={{ width: `${Math.min(100, (b3Taxable / 100_000) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Side-by-Side 3-Way Comparison */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-0.5 ttd-num">
          <div className="ttd-inset p-2 border-l-4 border-l-sky-400">
            <div className="text-[10px] text-slate-300 uppercase font-semibold">
              1. Kostnad for ditt AS
            </div>
            <div className="text-sm font-extrabold text-sky-300 mt-0.5">
              -{formatKr(tax.totalCorporateCost)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Bruttolønn {formatKr(tax.gross)} + 14,1% arb.giveravgift ({formatKr(tax.employerPayrollTax)})
            </div>
          </div>

          <div className="ttd-inset p-2 border-l-4 border-l-rose-400">
            <div className="text-[10px] text-slate-300 uppercase font-semibold">
              2. Inntektsskatt (Fellesskapet)
            </div>
            <div className="text-sm font-extrabold text-rose-300 mt-0.5">
              {formatKr(tax.totalIncomeTax)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              + {formatKr(tax.employerPayrollTax)} arb.giveravgift fra AS ={' '}
              {formatKr(tax.totalIncomeTax + tax.employerPayrollTax)} totalt
            </div>
          </div>

          <div className="ttd-inset p-2 border-l-4 border-l-emerald-400">
            <div className="text-[10px] text-slate-300 uppercase font-semibold">
              3. Utbetalt Nettolønn Privat
            </div>
            <div className="text-sm font-extrabold text-emerald-300 mt-0.5">
              +{formatKr(tax.netPersonalPay)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Går rett inn på din personlige bankkonto hver måned!
            </div>
          </div>
        </div>
      </div>

      {/* Personal Net Worth Breakdown */}
      <div className="ttd-panel p-2.5 space-y-1.5 ttd-num">
        <div className="flex items-center justify-between">
          <span className="font-bold text-amber-200 text-xs">
            Personlig Formuesoppstilling (Privat Nettoformue)
          </span>
          <span className="font-extrabold text-amber-300 text-sm">
            {formatKr(personal.personalNetWorth)}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
          <div className="ttd-inset p-2 flex items-center justify-between">
            <span className="flex items-center gap-1 text-slate-300">
              <Wallet className="w-3.5 h-3.5 text-amber-300" />
              <span>Privat kontant:</span>
            </span>
            <strong className="text-amber-200">{formatKr(personal.cash)}</strong>
          </div>

          <div className="ttd-inset p-2 flex items-center justify-between">
            <span className="flex items-center gap-1 text-slate-300">
              <Landmark className="w-3.5 h-3.5 text-sky-300" />
              <span>HQ-eiendom:</span>
            </span>
            <strong className="text-sky-300">{formatKr(hqInvestedValue)}</strong>
          </div>

          <div className="ttd-inset p-2 flex items-center justify-between">
            <span className="flex items-center gap-1 text-slate-300">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-300" />
              <span>Aksjeportefølje:</span>
            </span>
            <strong className="text-emerald-300">{formatKr(stockPortfolioValue)}</strong>
          </div>
        </div>

        <div className="text-[10px] text-slate-400 flex items-center justify-between px-0.5">
          <span>
            Mottatt aksjeutbytte totalt: <strong className="text-emerald-300">{formatKr(personal.dividendsReceivedTotal)}</strong>
          </span>
          <span className="flex items-center gap-1">
            <Building2 className="w-3 h-3 text-slate-400" />
            <span>Merk: Selskapets penger tilhører AS-et, ikke deg personlig før lønnsutbetaling!</span>
          </span>
        </div>
      </div>
    </TTDWindow>
  );
};
