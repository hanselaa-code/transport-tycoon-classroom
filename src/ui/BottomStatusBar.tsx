import React from 'react';
import { Calendar, Building2, Wallet, Newspaper, AlertTriangle, Crosshair } from 'lucide-react';
import type { GameDate, NewsItem, ToolType } from '../types/game';
import { formatGameDate, formatKr, TOOL_LABELS_NO } from './formatters';

export interface BottomStatusBarProps {
  date: GameDate;
  companyName: string;
  companyCash: number;
  personalCash: number;
  news: NewsItem[];
  activeTool: ToolType;
  isPickingStationOrder: boolean;
  onOpenCompanyFinances: () => void;
  onOpenPersonalFinances: () => void;
  onCancelTool: () => void;
}

const NEWS_BADGE_COLOR: Record<NewsItem['category'], string> = {
  INFO: 'text-sky-300',
  ECONOMY: 'text-emerald-300',
  COMPETITOR: 'text-amber-300',
  WARNING: 'text-rose-300 font-bold',
};

export const BottomStatusBar: React.FC<BottomStatusBarProps> = ({
  date,
  companyName,
  companyCash,
  personalCash,
  news,
  activeTool,
  isPickingStationOrder,
  onOpenCompanyFinances,
  onOpenPersonalFinances,
  onCancelTool,
}) => {
  const recentNews =
    news.length > 0
      ? news.slice(0, 8)
      : [
          {
            id: 'welcome',
            dateLabel: formatGameDate(date),
            text: `Velkommen til ${companyName}! Bygg vei eller jernbane mellom ressurser og byer for å tjene dine første kroner.`,
            category: 'INFO' as const,
          },
        ];

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-[900] h-9 ttd-bar-bottom px-2 flex items-center justify-between gap-2 text-xs">
      {/* Left: Date */}
      <div className="ttd-inset px-2.5 py-1 flex items-center gap-1.5 shrink-0 font-semibold text-amber-200 ttd-num">
        <Calendar className="w-3.5 h-3.5 text-amber-400" />
        <span>{formatGameDate(date)}</span>
      </div>

      {/* Center: Live Scrolling News Ticker (or active tool prompt banner) */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {(isPickingStationOrder || activeTool !== 'SELECT') && (
          <div className="ttd-inset px-2 py-0.5 flex items-center gap-1.5 bg-amber-950/70 border-amber-500/60 shrink-0">
            <Crosshair className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
            <span className="text-amber-200 font-semibold text-[11px]">
              {isPickingStationOrder
                ? 'Klikk på en stasjon på kartet for å legge til i ruten!'
                : TOOL_LABELS_NO[activeTool]}
            </span>
            <button
              type="button"
              onClick={onCancelTool}
              className="ttd-btn !px-1.5 !py-0 !text-[10px] ml-1"
            >
              Avbryt
            </button>
          </div>
        )}

        <div className="ttd-inset flex-1 min-w-0 h-6 flex items-center overflow-hidden px-2 relative">
          <Newspaper className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0 z-10" />
          <div className="overflow-hidden flex-1">
            <div className="ttd-ticker-track items-center gap-8">
              {[...recentNews, ...recentNews].map((item, idx) => (
                <span key={`${item.id}-${idx}`} className="inline-flex items-center gap-1.5 mr-8">
                  <span className="text-[10px] text-slate-400">[{item.dateLabel}]</span>
                  <span className={NEWS_BADGE_COLOR[item.category]}>{item.text}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right: Dual Cash Counters (Corporate AS & Personal Owner) */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onOpenCompanyFinances}
          title="Klikk for å åpne Selskapsøkonomi AS"
          className={`ttd-inset px-2.5 py-1 flex items-center gap-1.5 font-bold ttd-num cursor-pointer hover:brightness-110 ${
            companyCash < 0 ? 'ttd-cash-negative' : 'text-emerald-300'
          }`}
        >
          {companyCash < 0 ? (
            <AlertTriangle className="w-3.5 h-3.5 text-white shrink-0" />
          ) : (
            <Building2 className="w-3.5 h-3.5 text-sky-300 shrink-0" />
          )}
          <span className="whitespace-nowrap">Selskap: {formatKr(companyCash)}</span>
        </button>

        <button
          type="button"
          onClick={onOpenPersonalFinances}
          title="Klikk for å åpne Personlig økonomi & skatt"
          className="ttd-inset px-2.5 py-1 flex items-center gap-1.5 font-bold text-amber-300 ttd-num cursor-pointer hover:brightness-110"
        >
          <Wallet className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="whitespace-nowrap">Privat: {formatKr(personalCash)}</span>
        </button>
      </div>
    </footer>
  );
};
