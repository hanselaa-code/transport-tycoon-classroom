import React, { useEffect, useMemo, useState } from 'react';
import {
  TrainFront,
  Truck,
  Play,
  Square,
  Warehouse,
  Wrench,
  PackageCheck,
  Crosshair,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Zap,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import type { CargoType, GameState } from '../../types/game';
import {
  COMPANY_COLORS,
  GameEngine,
  getEffectiveStationPlatformLength,
  getTrainRequiredPlatformTiles,
  VEHICLE_CATALOG_LIST,
} from '../../core';
import {
  CARGO_COLORS,
  CARGO_LABELS_NO,
  CARGO_UNITS_NO,
  formatKr,
  formatNumber,
  STATION_KIND_LABELS_NO,
  VEHICLE_STATE_LABELS_NO,
} from '../formatters';
import {
  LocoSprite,
  RailWagonSprite,
  RoadVehicleSprite,
  resolveTrainWagonsList,
} from '../VehicleSprites';
import { TTDWindow } from '../TTDWindow';

export interface VehicleDetailWindowProps {
  engine: GameEngine;
  state: GameState;
  vehicleId: string | null;
  pickingOrdersForVehicleId: string | null;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onSelectVehicle: (vehicleId: string) => void;
  onToggleStationPicker: (vehicleId: string | null) => void;
  onFocusTile: (x: number, y: number) => void;
  onOpenStation: (stationId: string) => void;
  onOpenDepotAt: (
    x: number,
    y: number,
    depotType: 'ROAD' | 'RAIL',
    selectVehicleId: string
  ) => void;
}

const COMPACT_UNIT_NO: Record<CargoType, string> = {
  PASSENGERS: 'p',
  MAIL: 's',
  COAL: 't',
  WOOD: 't',
  GOODS: 'k',
  GRAIN: 't',
  FOOD: 't',
};

export const VehicleDetailWindow: React.FC<VehicleDetailWindowProps> = ({
  engine,
  state,
  vehicleId,
  pickingOrdersForVehicleId,
  zIndex,
  onFocus,
  onClose,
  onSelectVehicle,
  onToggleStationPicker,
  onFocusTile,
  onOpenStation,
  onOpenDepotAt,
}) => {
  const playerVehicles = useMemo(
    () => state.vehicles.filter((v) => !v.ownerId || v.ownerId === 'player'),
    [state.vehicles]
  );

  const vehicle = useMemo(() => {
    if (vehicleId) {
      const exact = state.vehicles.find((v) => v.id === vehicleId);
      if (exact) return exact;
    }
    return playerVehicles[0] ?? null;
  }, [state.vehicles, vehicleId, playerVehicles]);

  const isRival = Boolean(
    vehicle && vehicle.ownerId && vehicle.ownerId !== 'player'
  );
  const playerColor = state.corporate.playerColor ?? '#2563eb';

  const [dropdownStationId, setDropdownStationId] = useState<string>('');
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null
  );

  // Clear stale feedback when switching vehicle
  useEffect(() => {
    setFeedback(null);
  }, [vehicle?.id]);

  const compatibleStations = useMemo(() => {
    if (!vehicle || isRival) return [];
    return state.stations.filter((st) => {
      if (st.ownerId && st.ownerId !== 'player') return false;
      if (vehicle.network === 'RAIL') return st.kind === 'TRAIN_STATION';
      return st.kind === 'BUS_STOP' || st.kind === 'TRUCK_BAY';
    });
  }, [state.stations, vehicle, isRival]);

  useEffect(() => {
    if (compatibleStations.length > 0 && !dropdownStationId) {
      setDropdownStationId(compatibleStations[0].id);
    } else if (
      dropdownStationId &&
      !compatibleStations.some((s) => s.id === dropdownStationId)
    ) {
      setDropdownStationId(compatibleStations[0]?.id ?? '');
    }
  }, [compatibleStations, dropdownStationId]);

  if (!vehicle) {
    return (
      <TTDWindow
        id="vehicle_detail"
        title="Kjøretøy & Kjøreordre"
        icon={<TrainFront className="w-3.5 h-3.5" />}
        theme="slate"
        defaultX={592}
        defaultY={58}
        width={480}
        zIndex={zIndex}
        onFocus={onFocus}
        onClose={(id) => {
          onToggleStationPicker(null);
          onClose(id);
        }}
      >
        <div className="ttd-inset p-4 text-center text-slate-300 space-y-1.5">
          <p className="font-bold text-amber-200">Ingen kjøretøy valgt</p>
          <p className="text-[11px] text-slate-400">
            Klikk på et tog eller en bil på kartet, i Flåte-listen eller inne i et depot for å åpne kjøreordre.
          </p>
        </div>
      </TTDWindow>
    );
  }

  const catalogSpec = VEHICLE_CATALOG_LIST.find((c) => c.id === vehicle.modelId);
  const trainWagons =
    vehicle.network === 'RAIL' ? resolveTrainWagonsList(vehicle) : [];
  const requiredPlatformTiles =
    vehicle.network === 'RAIL'
      ? getTrainRequiredPlatformTiles(trainWagons.length)
      : 1;

  // Aggregate per-cargo breakdown for mixed-consist trains
  const cargoTotals = (() => {
    if (vehicle.network !== 'RAIL' || trainWagons.length === 0) return [];
    const map = new Map<
      CargoType,
      { amount: number; capacity: number; count: number }
    >();
    for (const w of trainWagons) {
      const prev = map.get(w.cargoType) ?? { amount: 0, capacity: 0, count: 0 };
      prev.amount += w.cargoAmount;
      prev.capacity += w.capacity;
      prev.count += 1;
      map.set(w.cargoType, prev);
    }
    return Array.from(map.entries()).map(([cargoType, stats]) => ({
      cargoType,
      ...stats,
    }));
  })();

  const currentDestLabel = (() => {
    if (vehicle.goingToDepot) {
      return `På vei til depot (${vehicle.goingToDepot.x}, ${vehicle.goingToDepot.y})`;
    }
    if (!vehicle.orders || vehicle.orders.length === 0) {
      return 'Ingen kjøreordre satt';
    }
    const stId =
      vehicle.orders[vehicle.currentOrderIndex % vehicle.orders.length];
    const st = state.stations.find((s) => s.id === stId);
    return st ? `Neste stopp: ${st.name}` : 'Ukjent stasjon';
  })();

  // RIVAL / MULTIPLAYER PEER READ-ONLY INSPECTOR
  if (isRival) {
    const peerOwner = state.remotePlayers?.find(
      (p) => p.clientId === vehicle.ownerId
    );
    const aiOwner = state.aiCompanies.find((a) => a.id === vehicle.ownerId);
    const ownerName =
      peerOwner?.companyName ?? aiOwner?.name ?? 'Konkurrent AS';
    const ownerColor =
      peerOwner?.color ??
      aiOwner?.color ??
      COMPANY_COLORS[vehicle.ownerId ?? 'ai-1'] ??
      '#a855f7';

    return (
      <TTDWindow
        id="vehicle_detail"
        title={`Konkurrent – ${vehicle.name}`}
        subtitle={`${ownerName} (Kun visning)`}
        icon={
          vehicle.network === 'RAIL' ? (
            <TrainFront className="w-3.5 h-3.5" />
          ) : (
            <Truck className="w-3.5 h-3.5" />
          )
        }
        theme="purple"
        defaultX={592}
        defaultY={58}
        width={488}
        zIndex={zIndex}
        onFocus={onFocus}
        onClose={onClose}
      >
        <div className="ttd-panel p-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-3.5 h-7 shrink-0 border border-black/60"
              style={{ backgroundColor: ownerColor }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-amber-100 text-xs truncate">
                  {ownerName}
                </span>
                <span className="px-1.5 py-0.2 bg-purple-950/90 border border-purple-500/70 text-purple-200 text-[10px] font-bold">
                  Konkurrent
                </span>
              </div>
              <div className="text-[10px] text-slate-300 ttd-num">
                {catalogSpec?.nameNo ?? vehicle.modelId}
                {vehicle.network === 'RAIL'
                  ? ` • Lengde: ${requiredPlatformTiles} ${
                      requiredPlatformTiles === 1 ? 'rute' : 'ruter'
                    } (Lok + ${trainWagons.length} vogner)`
                  : ''}{' '}
                • Maksfart {vehicle.maxSpeedKmh} km/t
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onFocusTile(Math.round(vehicle.x), Math.round(vehicle.y))
            }
            className="ttd-btn !px-2 !py-1"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Sentrer</span>
          </button>
        </div>

        {/* Visual Side-Profile Consist */}
        <div className="ttd-inset p-2 overflow-x-auto">
          {vehicle.network === 'RAIL' ? (
            <div className="flex items-end gap-0.5 min-w-max pb-0.5">
              <LocoSprite
                modelId={vehicle.modelId}
                companyColor={ownerColor}
                size="md"
              />
              {trainWagons.map((w) => (
                <React.Fragment key={w.id}>
                  <span className="text-slate-500 font-bold text-[10px] pb-2 select-none">
                    ═
                  </span>
                  <div className="flex flex-col items-center">
                    <RailWagonSprite
                      cargoType={w.cargoType}
                      fillRatio={
                        w.capacity > 0 ? w.cargoAmount / w.capacity : 0
                      }
                      companyColor={ownerColor}
                      size="sm"
                    />
                    <span className="text-[9px] text-slate-300 ttd-num">
                      {Math.round(w.cargoAmount)}/{w.capacity}
                      {COMPACT_UNIT_NO[w.cargoType]}
                    </span>
                  </div>
                </React.Fragment>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <RoadVehicleSprite
                modelId={vehicle.modelId}
                cargoType={vehicle.cargoType}
                companyColor={ownerColor}
                size="lg"
                fillRatio={
                  vehicle.capacity > 0
                    ? vehicle.cargoAmount / vehicle.capacity
                    : 0
                }
              />
              <div className="flex-1 space-y-1 ttd-num">
                <div className="flex justify-between text-[11px]">
                  <span className="text-amber-200 font-semibold">
                    {CARGO_LABELS_NO[vehicle.cargoType]}
                  </span>
                  <span>
                    {formatNumber(vehicle.cargoAmount)} /{' '}
                    {formatNumber(vehicle.capacity)}{' '}
                    {CARGO_UNITS_NO[vehicle.cargoType]}
                  </span>
                </div>
                <div className="ttd-inset h-3 w-full overflow-hidden p-0.5">
                  <div
                    className="h-full transition-all duration-150"
                    style={{
                      width: `${Math.min(
                        100,
                        vehicle.capacity > 0
                          ? (vehicle.cargoAmount / vehicle.capacity) * 100
                          : 0
                      )}%`,
                      backgroundColor: CARGO_COLORS[vehicle.cargoType],
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Status & Profit */}
        <div className="ttd-panel p-2 flex flex-wrap items-center justify-between gap-2 text-[11px] ttd-num">
          <div>
            Status:{' '}
            <strong className="text-emerald-300">
              {VEHICLE_STATE_LABELS_NO[vehicle.state]}
            </strong>{' '}
            ({Math.round(vehicle.speedKmh)} / {vehicle.maxSpeedKmh} km/t)
          </div>
          <div>
            Resultat i år:{' '}
            <strong
              className={
                vehicle.profitThisYear >= 0
                  ? 'text-emerald-300'
                  : 'text-rose-400'
              }
            >
              {formatKr(vehicle.profitThisYear, true)}
            </strong>
          </div>
        </div>

        {/* Read-Only Route Orders */}
        <div className="ttd-panel p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-amber-200 text-xs">
              Kjøreordre ({vehicle.orders.length} stopp — kun visning)
            </span>
            <span className="text-[10px] text-slate-400">
              Klikk stasjon for detaljer
            </span>
          </div>
          <div className="ttd-inset divide-y divide-slate-800 max-h-36 overflow-y-auto">
            {vehicle.orders.length === 0 ? (
              <div className="p-2.5 text-center text-slate-400 text-[11px]">
                Ingen stasjoner i ruten.
              </div>
            ) : (
              vehicle.orders.map((stId, idx) => {
                const st = state.stations.find((s) => s.id === stId);
                const isCurrent =
                  vehicle.orders.length > 0 &&
                  idx === vehicle.currentOrderIndex % vehicle.orders.length;
                return (
                  <div
                    key={`${stId}-${idx}`}
                    onClick={() => {
                      if (st) onOpenStation(st.id);
                    }}
                    className={`px-2 py-1.5 flex items-center justify-between gap-2 text-[11px] ${
                      st ? 'cursor-pointer hover:bg-slate-800/70' : ''
                    } ${isCurrent ? 'bg-emerald-950/45 text-emerald-200' : ''}`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-bold text-amber-300 w-5 ttd-num">
                        {isCurrent ? '▶' : `${idx + 1}.`}
                      </span>
                      <span className="font-semibold truncate">
                        {st ? st.name : `Slettet stasjon (${stId})`}
                      </span>
                      {st && (
                        <span className="text-[10px] text-slate-400">
                          ({STATION_KIND_LABELS_NO[st.kind]})
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </TTDWindow>
    );
  }

  // PLAYER VEHICLE HANDLERS
  const isPickingThis = pickingOrdersForVehicleId === vehicle.id;

  const handleToggleRun = () => {
    const res = engine.toggleVehicleStopped(vehicle.id);
    if (!res.ok && res.message) {
      setFeedback({ ok: false, msg: res.message });
    } else {
      setFeedback(res.message ? { ok: true, msg: res.message } : null);
    }
  };

  const handleSendToDepot = (forceImmediate = false) => {
    onToggleStationPicker(null);
    const res = engine.sendVehicleToDepot(
      vehicle.id,
      vehicle.goingToDepot ?? undefined,
      forceImmediate
    );
    if (res.message) {
      setFeedback({ ok: res.ok, msg: res.message });
    } else if (res.ok) {
      setFeedback({
        ok: true,
        msg: forceImmediate
          ? 'Kjøretøyet er parkert i depoet!'
          : 'Kjøretøyet kjører nå til nærmeste depot.',
      });
    }
  };

  const handleCancelSendToDepot = () => {
    const res = engine.cancelSendToDepot(vehicle.id);
    if (res.message) {
      setFeedback({ ok: res.ok, msg: res.message });
    } else {
      setFeedback(null);
    }
  };

  const handleToggleFullLoad = () => {
    const res = engine.toggleVehicleFullLoad(vehicle.id);
    if (res.message) {
      setFeedback({ ok: res.ok, msg: res.message });
    } else {
      setFeedback(null);
    }
  };

  const handleAddOrderFromDropdown = () => {
    if (!dropdownStationId) return;
    const nextOrders = [...vehicle.orders, dropdownStationId];
    const res = engine.updateVehicleOrders(vehicle.id, nextOrders);
    if (!res.ok && res.message) {
      setFeedback({ ok: false, msg: res.message });
    } else {
      setFeedback(null);
    }
  };

  const handleRemoveOrder = (idx: number) => {
    const nextOrders = vehicle.orders.filter((_, i) => i !== idx);
    const res = engine.updateVehicleOrders(vehicle.id, nextOrders);
    if (!res.ok && res.message) {
      setFeedback({ ok: false, msg: res.message });
    }
  };

  const handleMoveOrder = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= vehicle.orders.length) return;
    const nextOrders = [...vehicle.orders];
    const tmp = nextOrders[idx];
    nextOrders[idx] = nextOrders[target];
    nextOrders[target] = tmp;
    engine.updateVehicleOrders(vehicle.id, nextOrders);
  };

  const handleSellVehicle = () => {
    onToggleStationPicker(null);
    const res = engine.sellVehicle(vehicle.id);
    if (res.ok) {
      onClose('vehicle_detail');
    } else if (res.message) {
      setFeedback({ ok: false, msg: res.message });
    }
  };

  const activeOverhangTiles =
    vehicle.network === 'RAIL' && vehicle.state === 'LOADING'
      ? vehicle.platformOverhangTiles ?? 0
      : 0;

  return (
    <TTDWindow
      id="vehicle_detail"
      title={`${vehicle.name}`}
      subtitle={
        vehicle.state === 'IN_DEPOT'
          ? 'Parkert i depot'
          : catalogSpec?.nameNo ?? vehicle.modelId
      }
      icon={
        vehicle.network === 'RAIL' ? (
          <TrainFront className="w-3.5 h-3.5" />
        ) : (
          <Truck className="w-3.5 h-3.5" />
        )
      }
      theme="slate"
      defaultX={592}
      defaultY={58}
      width={496}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={(id) => {
        if (isPickingThis) onToggleStationPicker(null);
        onClose(id);
      }}
    >
      {/* Top Quick Vehicle Switcher + Center Camera */}
      <div className="ttd-panel p-1.5 flex items-center justify-between gap-1.5">
        <select
          value={vehicle.id}
          onChange={(e) => {
            onToggleStationPicker(null);
            onSelectVehicle(e.target.value);
          }}
          className="ttd-inset px-2 py-1 text-xs flex-1 text-slate-100 min-w-0"
        >
          {playerVehicles.map((pv) => (
            <option key={pv.id} value={pv.id}>
              {pv.name} — {VEHICLE_STATE_LABELS_NO[pv.state]}
            </option>
          ))}
        </select>

        <button
          type="button"
          title="Sentrer kamera på kjøretøyet"
          onClick={() =>
            onFocusTile(Math.round(vehicle.x), Math.round(vehicle.y))
          }
          className="ttd-btn !px-2 !py-1 shrink-0"
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>Sentrer</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`ttd-inset p-2 text-[11px] font-semibold ${
            feedback.ok
              ? 'text-emerald-300 border-emerald-600'
              : 'text-rose-300 border-rose-600'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* Going-to-depot active banner */}
      {vehicle.goingToDepot && vehicle.state !== 'IN_DEPOT' && (
        <div className="ttd-inset p-2 bg-amber-950/60 border border-amber-500/70 flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
          <div className="flex items-center gap-1.5 text-amber-200 font-semibold">
            <Warehouse className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span>
              På vei til depot ({vehicle.goingToDepot.x},{' '}
              {vehicle.goingToDepot.y})
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleSendToDepot(true)}
              title="Flytt kjøretøyet direkte inn i depoet med én gang"
              className="ttd-btn ttd-btn-brass !px-2 !py-0.5 !text-[10px]"
            >
              <Zap className="w-3 h-3" />
              <span>Flytt rett inn nå</span>
            </button>
            <button
              type="button"
              onClick={handleCancelSendToDepot}
              className="ttd-btn !px-2 !py-0.5 !text-[10px]"
            >
              <XCircle className="w-3 h-3 text-rose-300" />
              <span>Avbryt</span>
            </button>
          </div>
        </div>
      )}

      {/* Live Overhang Alert while LOADING on a too-short station */}
      {activeOverhangTiles > 0 && (
        <div className="ttd-inset p-2 bg-amber-950/70 border border-amber-500/80 flex items-start gap-1.5 text-[11px] text-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>
            <strong>For kort plattform!</strong> Toget stikker{' '}
            <strong>
              {activeOverhangTiles}{' '}
              {activeOverhangTiles === 1 ? 'rute' : 'ruter'}
            </strong>{' '}
            utenfor stasjonsplattformen — tidsstraff gir tregere av- og
            pålasting!
          </span>
        </div>
      )}

      {/* LIVE VISUAL CONSIST STRIP */}
      <div className="ttd-panel p-2 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-300 ttd-num">
          <span className="font-bold text-amber-200">
            {vehicle.network === 'RAIL'
              ? `Lengde: ${requiredPlatformTiles} ${
                  requiredPlatformTiles === 1 ? 'rute' : 'ruter'
                } (Lok + ${trainWagons.length} ${
                  trainWagons.length === 1 ? 'vogn' : 'vogner'
                })`
              : 'Kjøretøy & Lasteplan'}
          </span>
          <span>
            Maksfart <strong>{vehicle.maxSpeedKmh} km/t</strong> • Drift{' '}
            <strong>{formatKr(vehicle.runningCostPerMonth)}/mnd</strong>
          </span>
        </div>

        <div className="ttd-inset p-2 overflow-x-auto bg-slate-950/80">
          {vehicle.network === 'RAIL' ? (
            <div className="space-y-1.5">
              <div className="flex items-end gap-0.5 min-w-max pb-0.5">
                <div className="flex flex-col items-center">
                  <LocoSprite
                    modelId={vehicle.modelId}
                    companyColor={playerColor}
                    size="md"
                  />
                  <span className="text-[9px] text-amber-200/90 font-semibold">
                    {catalogSpec?.nameNo.split(' ')[0] ?? 'Lok'}
                  </span>
                </div>

                {trainWagons.length === 0 ? (
                  <div className="ml-2 px-2.5 py-1.5 border border-dashed border-amber-500/60 bg-amber-950/30 text-amber-200 text-[10px] flex items-center gap-2">
                    <span>
                      Ingen vogner koblet på! Åpne depoet for å kjøpe og koble på vogner.
                    </span>
                  </div>
                ) : (
                  trainWagons.map((w, idx) => (
                    <React.Fragment key={w.id || idx}>
                      <span className="text-slate-400 font-black text-[10px] pb-3.5 select-none">
                        ═
                      </span>
                      <div
                        className="flex flex-col items-center px-0.5"
                        title={`${CARGO_LABELS_NO[w.cargoType]}: ${Math.round(
                          w.cargoAmount
                        )} / ${w.capacity} ${CARGO_UNITS_NO[w.cargoType]}`}
                      >
                        <RailWagonSprite
                          cargoType={w.cargoType}
                          fillRatio={
                            w.capacity > 0 ? w.cargoAmount / w.capacity : 0
                          }
                          companyColor={playerColor}
                          size="sm"
                        />
                        <span className="inline-flex items-center gap-1 text-[9px] text-slate-200 ttd-num">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{
                              backgroundColor: CARGO_COLORS[w.cargoType],
                            }}
                          />
                          {Math.round(w.cargoAmount)}/{w.capacity}
                          {COMPACT_UNIT_NO[w.cargoType]}
                        </span>
                      </div>
                    </React.Fragment>
                  ))
                )}
              </div>

              {/* Per-cargo summary badges for uniform or mixed consists */}
              {cargoTotals.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800/90 text-[10px] ttd-num">
                  {cargoTotals.map((ct) => (
                    <span
                      key={ct.cargoType}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-900 border border-slate-700"
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: CARGO_COLORS[ct.cargoType] }}
                      />
                      <strong className="text-amber-100">
                        {ct.count}× {CARGO_LABELS_NO[ct.cargoType]}:
                      </strong>
                      <span className="text-sky-200">
                        {formatNumber(ct.amount)}/{formatNumber(ct.capacity)}{' '}
                        {CARGO_UNITS_NO[ct.cargoType]}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <RoadVehicleSprite
                modelId={vehicle.modelId}
                cargoType={vehicle.cargoType}
                companyColor={playerColor}
                size="lg"
                fillRatio={
                  vehicle.capacity > 0
                    ? vehicle.cargoAmount / vehicle.capacity
                    : 0
                }
              />
              <div className="flex-1 space-y-1 ttd-num">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: CARGO_COLORS[vehicle.cargoType],
                      }}
                    />
                    <strong className="text-amber-200">
                      {CARGO_LABELS_NO[vehicle.cargoType]}
                    </strong>
                  </span>
                  <span className="ttd-gold font-bold">
                    {formatNumber(vehicle.cargoAmount)} /{' '}
                    {formatNumber(vehicle.capacity)}{' '}
                    {CARGO_UNITS_NO[vehicle.cargoType]}
                  </span>
                </div>
                <div className="ttd-inset h-3.5 w-full overflow-hidden p-0.5">
                  <div
                    className="h-full transition-all duration-150"
                    style={{
                      width: `${Math.min(
                        100,
                        vehicle.capacity > 0
                          ? (vehicle.cargoAmount / vehicle.capacity) * 100
                          : 0
                      )}%`,
                      backgroundColor: CARGO_COLORS[vehicle.cargoType],
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* STATUS BAR + OPENTTD ACTION BUTTONS */}
      <div className="ttd-panel p-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] ttd-num">
          <div>
            Status:{' '}
            <strong
              className={
                vehicle.state === 'STOPPED'
                  ? 'text-rose-400'
                  : vehicle.state === 'IN_DEPOT'
                  ? 'text-amber-300'
                  : 'text-emerald-300'
              }
            >
              {VEHICLE_STATE_LABELS_NO[vehicle.state]}
            </strong>{' '}
            ({Math.round(vehicle.speedKmh)} km/t) •{' '}
            <span className="text-slate-300">{currentDestLabel}</span>
          </div>
          <div>
            Resultat i år:{' '}
            <strong
              className={
                vehicle.profitThisYear >= 0
                  ? 'text-emerald-300'
                  : 'text-rose-400'
              }
            >
              {formatKr(vehicle.profitThisYear, true)}
            </strong>
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 1. Start / Stopp */}
          <button
            type="button"
            onClick={handleToggleRun}
            className={`ttd-btn flex-1 !py-1.5 ${
              vehicle.state === 'STOPPED' || vehicle.state === 'IN_DEPOT'
                ? 'ttd-btn-green'
                : 'ttd-btn-red'
            }`}
          >
            {vehicle.state === 'STOPPED' || vehicle.state === 'IN_DEPOT' ? (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>
                  {vehicle.state === 'IN_DEPOT'
                    ? 'Kjør ut (Start)'
                    : 'Start kjøretøy'}
                </span>
              </>
            ) : (
              <>
                <Square className="w-3.5 h-3.5" />
                <span>Stopp</span>
              </>
            )}
          </button>

          {/* 2. Open Depot (when IN_DEPOT) OR Send to Depot (when running) */}
          {vehicle.state === 'IN_DEPOT' ? (
            <button
              type="button"
              onClick={() =>
                onOpenDepotAt(
                  Math.round(vehicle.x),
                  Math.round(vehicle.y),
                  vehicle.network,
                  vehicle.id
                )
              }
              className="ttd-btn ttd-btn-brass flex-1 !py-1.5"
              title="Åpne depoet ved siden av for å kjøpe, bytte eller koble fra vogner"
            >
              <Wrench className="w-3.5 h-3.5 text-amber-200" />
              <span>
                {vehicle.network === 'RAIL'
                  ? 'Åpne depot — Bytt / kjøp vogner'
                  : 'Åpne depot — Ombygg / kjøp'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleSendToDepot(Boolean(vehicle.goingToDepot))}
              className={`ttd-btn flex-1 !py-1.5 ${
                vehicle.goingToDepot ? 'ttd-btn-active' : 'ttd-btn-teal'
              }`}
              title="Send kjøretøyet tilbake til depot for å bytte vogner eller lastetype"
            >
              <Warehouse className="w-3.5 h-3.5 text-amber-200" />
              <span>
                {vehicle.goingToDepot
                  ? 'Flytt rett inn i depot nå'
                  : 'Send til depot'}
              </span>
            </button>
          )}
        </div>

        {/* Full Load Toggle */}
        <button
          type="button"
          onClick={handleToggleFullLoad}
          className={`ttd-btn w-full !py-1 ${
            vehicle.waitForFullLoad ? 'ttd-btn-active' : ''
          }`}
          title="Vent på stasjonen til vognene fylles opp før avgang"
        >
          <PackageCheck className="w-3.5 h-3.5 text-amber-200" />
          <span>
            Vent på full last: {vehicle.waitForFullLoad ? 'PÅ' : 'AV'}
          </span>
        </button>
      </div>

      {/* TTD NUMBERED STATION ORDERS */}
      <div className="ttd-panel p-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="font-bold text-amber-200 text-xs">
            Kjøreordre ({vehicle.orders.length} stopp)
          </span>

          <button
            type="button"
            onClick={() =>
              onToggleStationPicker(isPickingThis ? null : vehicle.id)
            }
            className={`ttd-btn !py-1 !px-2 ${
              isPickingThis ? 'ttd-btn-active' : 'ttd-btn-teal'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>
              {isPickingThis
                ? 'Klikk stasjoner på kartet... (Ferdig)'
                : 'Klikk stasjon på kart'}
            </span>
          </button>
        </div>

        {/* Station Dropdown Quick-Add */}
        <div className="flex items-center gap-1.5">
          {compatibleStations.length === 0 ? (
            <div className="text-[11px] text-amber-300/90">
              Ingen{' '}
              {vehicle.network === 'RAIL'
                ? 'togstasjoner'
                : 'holdeplasser/terminaler'}{' '}
              bygget ennå.
            </div>
          ) : (
            <>
              <select
                value={dropdownStationId}
                onChange={(e) => setDropdownStationId(e.target.value)}
                className="ttd-inset px-2 py-1 text-xs flex-1 text-slate-100 min-w-0"
              >
                {compatibleStations.map((st) => {
                  const stLen =
                    st.kind === 'TRAIN_STATION'
                      ? getEffectiveStationPlatformLength(st)
                      : 1;
                  return (
                    <option key={st.id} value={st.id}>
                      {st.name} (
                      {st.kind === 'TRAIN_STATION'
                        ? `${stLen} ${stLen === 1 ? 'rute' : 'ruter'}`
                        : STATION_KIND_LABELS_NO[st.kind]}
                      )
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={handleAddOrderFromDropdown}
                className="ttd-btn !py-1 !px-2.5 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Legg til</span>
              </button>
            </>
          )}
        </div>

        {/* Orders List with Platform Length Warning Badge */}
        <div className="ttd-inset divide-y divide-slate-800 max-h-44 overflow-y-auto">
          {vehicle.orders.length === 0 ? (
            <div className="p-2.5 text-center text-slate-400 text-[11px]">
              Ingen stopp i ruten ennå. Legg til minst{' '}
              <strong>2 stasjoner</strong> og trykk Start!
            </div>
          ) : (
            vehicle.orders.map((stId, idx) => {
              const st = state.stations.find((s) => s.id === stId);
              const isCurrent =
                vehicle.orders.length > 0 &&
                idx === vehicle.currentOrderIndex % vehicle.orders.length;
              const stPlatformLen =
                st && st.kind === 'TRAIN_STATION'
                  ? getEffectiveStationPlatformLength(st)
                  : null;
              const isShortPlatform =
                vehicle.network === 'RAIL' &&
                stPlatformLen !== null &&
                stPlatformLen < requiredPlatformTiles;

              return (
                <div
                  key={`${stId}-${idx}`}
                  className={`px-2 py-1.5 flex items-center justify-between gap-2 text-[11px] ${
                    isCurrent ? 'bg-emerald-950/45 text-emerald-200' : ''
                  }`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div
                      onClick={() => {
                        if (st) onOpenStation(st.id);
                      }}
                      className={`flex items-center gap-1.5 min-w-0 ${
                        st ? 'cursor-pointer hover:underline' : ''
                      }`}
                    >
                      <span className="font-bold text-amber-300 w-5 ttd-num shrink-0">
                        {isCurrent ? '▶' : `${idx + 1}.`}
                      </span>
                      <span className="font-semibold truncate">
                        {st ? st.name : `Slettet stasjon (${stId})`}
                      </span>
                      {st && (
                        <span className="text-[10px] text-slate-400 shrink-0 ttd-num">
                          (
                          {stPlatformLen !== null
                            ? `${stPlatformLen} ${
                                stPlatformLen === 1 ? 'rute' : 'ruter'
                              }`
                            : STATION_KIND_LABELS_NO[st.kind]}
                          )
                        </span>
                      )}
                    </div>

                    {isShortPlatform && (
                      <div className="pl-5 text-[10px] text-amber-300 font-semibold flex items-center gap-1 ttd-num">
                        <span>
                          ⚠️ Plattform kun {stPlatformLen}{' '}
                          {stPlatformLen === 1 ? 'rute' : 'ruter'} (toget krever{' '}
                          {requiredPlatformTiles}) — treg av-/pålasting
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      title="Flytt opp"
                      onClick={() => handleMoveOrder(idx, -1)}
                      className="ttd-btn !px-1 !py-0.5"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      title="Flytt ned"
                      onClick={() => handleMoveOrder(idx, 1)}
                      className="ttd-btn !px-1 !py-0.5"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      title="Fjern stopp"
                      onClick={() => handleRemoveOrder(idx)}
                      className="ttd-btn ttd-btn-red !px-1 !py-0.5"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer: Age & Sell Vehicle */}
      <div className="flex items-center justify-between pt-0.5 text-[10px] text-slate-400 ttd-num">
        <span>
          Alder: {Math.floor(vehicle.ageMonths / 12)} år {vehicle.ageMonths % 12}{' '}
          mnd
        </span>
        <button
          type="button"
          onClick={handleSellVehicle}
          className="ttd-btn ttd-btn-red !py-1 !px-2.5"
          title={
            vehicle.network === 'RAIL'
              ? 'Selger hele toget (åpne depoet hvis du vil selge kun enkeltvogner eller beholde vognene på sidespor)'
              : 'Selg kjøretøyet (85% innbytteverdi)'
          }
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>
            {vehicle.network === 'RAIL'
              ? 'Selg hele toget'
              : 'Selg kjøretøy'}
          </span>
        </button>
      </div>
    </TTDWindow>
  );
};
