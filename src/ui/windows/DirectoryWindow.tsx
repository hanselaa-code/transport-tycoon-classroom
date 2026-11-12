import React, { useEffect, useState } from 'react';
import { MapPin, Building2, Factory, Warehouse, Crosshair } from 'lucide-react';
import type { CargoType, GameState } from '../../types/game';
import {
  CARGO_COLORS,
  CARGO_LABELS_NO,
  CARGO_UNITS_NO,
  formatNumber,
  INDUSTRY_LABELS_NO,
  STATION_KIND_LABELS_NO,
} from '../formatters';
import { TTDWindow } from '../TTDWindow';

export interface DirectoryWindowProps {
  state: GameState;
  initialTab?: 'towns' | 'industries' | 'stations';
  highlightedStationId?: string | null;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onFocusTile: (x: number, y: number) => void;
}

const ALL_CARGOS: CargoType[] = [
  'PASSENGERS',
  'MAIL',
  'COAL',
  'WOOD',
  'GOODS',
  'GRAIN',
  'FOOD',
];

export const DirectoryWindow: React.FC<DirectoryWindowProps> = ({
  state,
  initialTab = 'towns',
  highlightedStationId,
  zIndex,
  onFocus,
  onClose,
  onFocusTile,
}) => {
  const [tab, setTab] = useState<'towns' | 'industries' | 'stations'>(initialTab);

  useEffect(() => {
    if (highlightedStationId) {
      setTab('stations');
    }
  }, [highlightedStationId]);

  const playerStations = state.stations.filter(
    (s) => !s.ownerId || s.ownerId === 'player'
  );

  return (
    <TTDWindow
      id="directory"
      title="Kartoversikt – Byer, Industrier & Stasjoner"
      subtitle="Klikk for å sentrere kamera"
      icon={<MapPin className="w-3.5 h-3.5" />}
      theme="slate"
      defaultX={140}
      defaultY={58}
      width={600}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      {/* Tabs */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setTab('towns')}
          className={`ttd-btn flex-1 !py-1.5 ${tab === 'towns' ? 'ttd-btn-active' : ''}`}
        >
          <Building2 className="w-3.5 h-3.5 text-sky-300" />
          <span>Byer ({state.towns.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('industries')}
          className={`ttd-btn flex-1 !py-1.5 ${tab === 'industries' ? 'ttd-btn-active' : ''}`}
        >
          <Factory className="w-3.5 h-3.5 text-amber-300" />
          <span>Industrier ({state.industries.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('stations')}
          className={`ttd-btn flex-1 !py-1.5 ${tab === 'stations' ? 'ttd-btn-active' : ''}`}
        >
          <Warehouse className="w-3.5 h-3.5 text-emerald-300" />
          <span>Mine stasjoner ({playerStations.length})</span>
        </button>
      </div>

      {/* Towns Tab */}
      {tab === 'towns' && (
        <div className="space-y-1.5">
          <div className="ttd-inset overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-700 text-[11px] text-amber-200 bg-slate-900/70">
                  <th className="p-1.5">By</th>
                  <th className="p-1.5 text-right">Innbyggere</th>
                  <th className="p-1.5 text-right">Tilbud/mnd</th>
                  <th className="p-1.5">Etterspørsel (Tar imot)</th>
                  <th className="p-1.5 text-center">Stasjoner</th>
                  <th className="p-1.5 text-right">Kamera</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-[11px]">
                {[...state.towns]
                  .sort((a, b) => b.population - a.population)
                  .map((town) => (
                    <tr
                      key={town.id}
                      onClick={() => onFocusTile(town.x, town.y)}
                      className="hover:bg-slate-800/70 cursor-pointer"
                    >
                      <td className="p-1.5 font-bold text-amber-100">{town.name}</td>
                      <td className="p-1.5 text-right font-semibold text-emerald-300 ttd-num">
                        {formatNumber(town.population)}
                      </td>
                      <td className="p-1.5 text-right text-slate-300 ttd-num">
                        {formatNumber(town.monthlyPassengers)} pass. / {formatNumber(town.monthlyMail)} post
                      </td>
                      <td className="p-1.5 text-slate-300">
                        Passasjerer, Post
                        {town.population >= 300 ? ', Varer, Matvarer' : ' (Varer/Mat ved 300+)'}
                      </td>
                      <td className="p-1.5 text-center ttd-num">
                        <span
                          className={`px-1.5 py-0.5 rounded font-semibold ${
                            town.servicedStations > 0
                              ? 'bg-emerald-900/70 text-emerald-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {town.servicedStations}
                        </span>
                      </td>
                      <td className="p-1.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onFocusTile(town.x, town.y);
                          }}
                          className="ttd-btn !px-2 !py-0.5"
                        >
                          <Crosshair className="w-3 h-3" />
                          <span>Vis</span>
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-300 px-1">
            Byer vokser raskere når du betjener dem med passasjerer, post, varer og matvarer!
          </p>
        </div>
      )}

      {/* Industries Tab */}
      {tab === 'industries' && (
        <div className="space-y-1.5">
          <div className="ttd-inset overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-700 text-[11px] text-amber-200 bg-slate-900/70">
                  <th className="p-1.5">Industri</th>
                  <th className="p-1.5">Type</th>
                  <th className="p-1.5">Tilbud (Produserer)</th>
                  <th className="p-1.5">Etterspørsel (Tar imot)</th>
                  <th className="p-1.5 text-right">Kamera</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-[11px]">
                {state.industries.map((ind) => (
                  <tr
                    key={ind.id}
                    onClick={() => onFocusTile(ind.x, ind.y)}
                    className="hover:bg-slate-800/70 cursor-pointer"
                  >
                    <td className="p-1.5 font-bold text-amber-100">{ind.name}</td>
                    <td className="p-1.5 text-slate-300">{INDUSTRY_LABELS_NO[ind.type]}</td>
                    <td className="p-1.5">
                      {ind.produces ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-sm inline-block"
                            style={{ backgroundColor: CARGO_COLORS[ind.produces] }}
                          />
                          <span className="font-semibold text-emerald-300">
                            {CARGO_LABELS_NO[ind.produces]}
                          </span>
                          <span className="text-slate-400 ttd-num">
                            ({formatNumber(ind.monthlyProduction)}/mnd)
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-500">Sluttmottaker</span>
                      )}
                    </td>
                    <td className="p-1.5">
                      {ind.accepts.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {ind.accepts.map((c) => (
                            <span
                              key={c}
                              className="px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-700/50 text-amber-200 font-semibold"
                            >
                              {CARGO_LABELS_NO[c]}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500">Råvareprodusent</span>
                      )}
                    </td>
                    <td className="p-1.5 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFocusTile(ind.x, ind.y);
                        }}
                        className="ttd-btn !px-2 !py-0.5"
                      >
                        <Crosshair className="w-3 h-3" />
                        <span>Vis</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ttd-panel p-2 text-[11px] text-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <strong className="text-amber-300">Kullkjede:</strong> Kullgruve &rarr; Kraftverk
            </div>
            <div>
              <strong className="text-amber-300">Tømmerkjede:</strong> Skog &rarr; Sagbruk &rarr; Varer til By
            </div>
            <div>
              <strong className="text-amber-300">Matkjede:</strong> Gård &rarr; Matfabrikk &rarr; Mat til By
            </div>
          </div>
        </div>
      )}

      {/* Stations Tab */}
      {tab === 'stations' && (
        <div className="space-y-1.5">
          {playerStations.length === 0 ? (
            <div className="ttd-inset p-4 text-center text-slate-400">
              Du har ikke bygget noen stasjoner ennå. Bruk <strong>Jernbane</strong> eller{' '}
              <strong>Vei</strong> i verktøylinjen!
            </div>
          ) : (
            <div className="space-y-1.5">
              {playerStations.map((st) => {
                const isHighlighted = highlightedStationId === st.id;
                const activeCargos = ALL_CARGOS.filter(
                  (c) => (st.waitingCargo[c] ?? 0) > 0 || (st.ratings[c] ?? 0) > 0
                );

                return (
                  <div
                    key={st.id}
                    onClick={() => onFocusTile(st.x, st.y)}
                    className={`ttd-inset p-2 cursor-pointer hover:bg-slate-800/60 transition ${
                      isHighlighted ? 'ring-2 ring-amber-400 bg-amber-950/20' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-bold text-amber-100">{st.name}</span>
                        <span className="ml-2 text-[11px] text-slate-400">
                          ({STATION_KIND_LABELS_NO[st.kind]} • {st.tiles.length}{' '}
                          {st.tiles.length === 1 ? 'rute' : 'ruter'})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFocusTile(st.x, st.y);
                        }}
                        className="ttd-btn !px-2 !py-0.5"
                      >
                        <Crosshair className="w-3 h-3" />
                        <span>Sentrer</span>
                      </button>
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {activeCargos.length === 0 ? (
                        <span className="text-[11px] text-slate-400">
                          Ingen ventende last ennå (venter på produksjon eller henting)
                        </span>
                      ) : (
                        activeCargos.map((cargo) => {
                          const waiting = Math.round(st.waitingCargo[cargo] ?? 0);
                          const rating = Math.round(st.ratings[cargo] ?? 60);
                          return (
                            <span
                              key={cargo}
                              className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] inline-flex items-center gap-1.5 ttd-num"
                            >
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: CARGO_COLORS[cargo] }}
                              />
                              <span className="text-slate-200 font-medium">
                                {CARGO_LABELS_NO[cargo]}:
                              </span>
                              <span className="font-bold text-amber-200">
                                {formatNumber(waiting)} {CARGO_UNITS_NO[cargo]}
                              </span>
                              <span
                                className={`${
                                  rating >= 70
                                    ? 'text-emerald-400'
                                    : rating >= 45
                                    ? 'text-amber-300'
                                    : 'text-rose-400'
                                }`}
                              >
                                ({rating}% vurdering)
                              </span>
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </TTDWindow>
  );
};
