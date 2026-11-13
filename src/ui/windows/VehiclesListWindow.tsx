import React, { useState } from 'react';
import { TrainFront, Truck, Crosshair, Settings2, Warehouse } from 'lucide-react';
import type { CargoType, GameState, Vehicle } from '../../types/game';
import {
  CARGO_COLORS,
  CARGO_LABELS_NO,
  CARGO_UNITS_NO,
  formatKr,
  formatNumber,
  VEHICLE_STATE_LABELS_NO,
} from '../formatters';
import {
  LocoSprite,
  RailWagonSprite,
  RoadVehicleSprite,
  resolveTrainWagonsList,
} from '../VehicleSprites';
import { TTDWindow } from '../TTDWindow';

export interface VehiclesListWindowProps {
  state: GameState;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onInspectVehicle: (vehicleId: string) => void;
  onFocusTile: (x: number, y: number) => void;
}

export const VehiclesListWindow: React.FC<VehiclesListWindowProps> = ({
  state,
  zIndex,
  onFocus,
  onClose,
  onInspectVehicle,
  onFocusTile,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'RAIL' | 'ROAD'>('ALL');
  const playerColor = state.corporate.playerColor ?? '#2563eb';

  const playerVehicles = state.vehicles.filter(
    (v) => !v.ownerId || v.ownerId === 'player'
  );
  const filtered = playerVehicles.filter((v) =>
    filter === 'ALL' ? true : v.network === filter
  );

  const totalProfitThisYear = filtered.reduce(
    (acc, v) => acc + v.profitThisYear,
    0
  );

  const getDestinationName = (v: Vehicle) => {
    if (v.goingToDepot) {
      return `På vei til depot (${v.goingToDepot.x}, ${v.goingToDepot.y})`;
    }
    if (!v.orders || v.orders.length === 0) return 'Ingen kjøreordre';
    const stId = v.orders[v.currentOrderIndex % v.orders.length];
    const st = state.stations.find((s) => s.id === stId);
    return st ? `Mot ${st.name}` : 'Ukjent stasjon';
  };

  const renderCargoSummary = (v: Vehicle) => {
    if (v.network === 'RAIL') {
      const wagons = resolveTrainWagonsList(v);
      if (wagons.length === 0) {
        return (
          <span className="text-amber-300/90 text-[10px] font-semibold">
            0 vogner (koble på i depot)
          </span>
        );
      }
      const cargoTypes = Array.from(new Set(wagons.map((w) => w.cargoType)));
      if (cargoTypes.length > 1) {
        return (
          <div className="flex flex-wrap items-center gap-1">
            {cargoTypes.map((ct: CargoType) => {
              const sub = wagons.filter((w) => w.cargoType === ct);
              const amt = sub.reduce((a, b) => a + b.cargoAmount, 0);
              const cap = sub.reduce((a, b) => a + b.capacity, 0);
              return (
                <span
                  key={ct}
                  className="inline-flex items-center gap-1 px-1 py-0.2 bg-slate-900/80 border border-slate-700 text-[10px]"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: CARGO_COLORS[ct] }}
                  />
                  {formatNumber(amt)}/{formatNumber(cap)} {CARGO_LABELS_NO[ct]}
                </span>
              );
            })}
          </div>
        );
      }
    }

    return (
      <div className="flex items-center gap-1.5">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: CARGO_COLORS[v.cargoType] }}
        />
        <span>
          {formatNumber(v.cargoAmount)}/{formatNumber(v.capacity)}{' '}
          {CARGO_UNITS_NO[v.cargoType]} {CARGO_LABELS_NO[v.cargoType]}
        </span>
      </div>
    );
  };

  return (
    <TTDWindow
      id="vehicles"
      title={`Kjøretøyoversikt (${playerVehicles.length})`}
      subtitle="Klikk på et kjøretøy for ruter, vogner & ordre"
      icon={<TrainFront className="w-3.5 h-3.5" />}
      theme="teal"
      defaultX={140}
      defaultY={64}
      width={680}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      {/* Filter tabs + summary */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFilter('ALL')}
            className={`ttd-btn !py-1 ${
              filter === 'ALL' ? 'ttd-btn-active' : ''
            }`}
          >
            Alle ({playerVehicles.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('RAIL')}
            className={`ttd-btn !py-1 ${
              filter === 'RAIL' ? 'ttd-btn-active' : ''
            }`}
          >
            <TrainFront className="w-3.5 h-3.5 text-sky-300" />
            <span>
              Tog ({playerVehicles.filter((v) => v.network === 'RAIL').length})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('ROAD')}
            className={`ttd-btn !py-1 ${
              filter === 'ROAD' ? 'ttd-btn-active' : ''
            }`}
          >
            <Truck className="w-3.5 h-3.5 text-amber-300" />
            <span>
              Bil & Buss (
              {playerVehicles.filter((v) => v.network === 'ROAD').length})
            </span>
          </button>
        </div>

        <div className="ttd-inset px-2.5 py-1 text-[11px] ttd-num">
          Samlet resultat i år:{' '}
          <strong
            className={
              totalProfitThisYear >= 0 ? 'text-emerald-300' : 'text-rose-400'
            }
          >
            {formatKr(totalProfitThisYear, true)}
          </strong>
        </div>
      </div>

      {/* Fleet Table with Side-Profile VehicleSprites */}
      {filtered.length === 0 ? (
        <div className="ttd-inset p-5 text-center text-slate-400 space-y-1">
          <p className="font-semibold text-slate-300">
            Ingen kjøretøy i denne kategorien ennå.
          </p>
          <p className="text-[11px]">
            Bygg et <strong>Togdepot</strong> eller <strong>Bildepot</strong> og
            klikk på depotet på kartet for å kjøpe kjøretøy!
          </p>
        </div>
      ) : (
        <div className="ttd-inset overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-700 text-[11px] text-amber-200 bg-slate-900/70">
                <th className="p-1.5">Kjøretøy & Togsett</th>
                <th className="p-1.5">Last</th>
                <th className="p-1.5">Status & Destinasjon</th>
                <th className="p-1.5 text-right">Resultat i år</th>
                <th className="p-1.5 text-right">Handling</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-[11px]">
              {filtered.map((v) => {
                const wagons =
                  v.network === 'RAIL' ? resolveTrainWagonsList(v) : [];
                return (
                  <tr
                    key={v.id}
                    onClick={() => onInspectVehicle(v.id)}
                    className="hover:bg-slate-800/70 cursor-pointer"
                  >
                    <td className="p-1.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-amber-100 leading-tight">
                          {v.name}
                        </span>
                        {v.network === 'RAIL' ? (
                          <div className="flex items-end gap-0.5 overflow-x-auto max-w-[230px]">
                            <LocoSprite
                              modelId={v.modelId}
                              companyColor={playerColor}
                              size="xs"
                            />
                            {wagons.map((w, idx) => (
                              <RailWagonSprite
                                key={w.id || idx}
                                cargoType={w.cargoType}
                                fillRatio={
                                  w.capacity > 0
                                    ? w.cargoAmount / w.capacity
                                    : 0
                                }
                                companyColor={playerColor}
                                size="xs"
                              />
                            ))}
                          </div>
                        ) : (
                          <RoadVehicleSprite
                            modelId={v.modelId}
                            cargoType={v.cargoType}
                            companyColor={playerColor}
                            size="sm"
                            fillRatio={
                              v.capacity > 0 ? v.cargoAmount / v.capacity : 0
                            }
                          />
                        )}
                      </div>
                    </td>
                    <td className="p-1.5 ttd-num">{renderCargoSummary(v)}</td>
                    <td className="p-1.5">
                      <div className="flex flex-col">
                        <span
                          className={`font-semibold inline-flex items-center gap-1 ${
                            v.state === 'STOPPED'
                              ? 'text-rose-400'
                              : v.state === 'IN_DEPOT' || v.goingToDepot
                              ? 'text-amber-300'
                              : v.state === 'WAITING_SIGNAL'
                              ? 'text-amber-200'
                              : 'text-emerald-300'
                          }`}
                        >
                          {(v.state === 'IN_DEPOT' || v.goingToDepot) && (
                            <Warehouse className="w-3 h-3 shrink-0" />
                          )}
                          <span>
                            {v.state === 'LOADING'
                              ? `Laster: ${formatNumber(
                                  v.cargoAmount
                                )} / ${formatNumber(v.capacity)}`
                              : `${VEHICLE_STATE_LABELS_NO[v.state]} (${Math.round(
                                  v.speedKmh
                                )} km/t)`}
                            {v.waitForFullLoad ? ' • [Full last]' : ''}
                          </span>
                        </span>
                        <span className="text-slate-400 text-[10px]">
                          {getDestinationName(v)}
                        </span>
                      </div>
                    </td>
                    <td
                      className={`p-1.5 text-right font-bold ttd-num ${
                        v.profitThisYear >= 0
                          ? 'text-emerald-300'
                          : 'text-rose-400'
                      }`}
                    >
                      {formatKr(v.profitThisYear, true)}
                    </td>
                    <td className="p-1.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          title="Sentrer kamera"
                          onClick={(e) => {
                            e.stopPropagation();
                            onFocusTile(Math.round(v.x), Math.round(v.y));
                          }}
                          className="ttd-btn !px-1.5 !py-0.5"
                        >
                          <Crosshair className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onInspectVehicle(v.id);
                          }}
                          className="ttd-btn ttd-btn-teal !px-2 !py-0.5"
                        >
                          <Settings2 className="w-3 h-3" />
                          <span>Ordre</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </TTDWindow>
  );
};
