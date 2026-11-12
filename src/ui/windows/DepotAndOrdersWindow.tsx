import React, { useEffect, useMemo, useState } from 'react';
import {
  Warehouse,
  TrainFront,
  Truck,
  Play,
  Square,
  Trash2,
  Plus,
  Crosshair,
  ArrowUp,
  ArrowDown,
  ShoppingCart,
} from 'lucide-react';
import type {
  CargoType,
  GameState,
  VehicleCatalogItem,
  VehicleModelId,
} from '../../types/game';
import { GameEngine, VEHICLE_CATALOG_LIST } from '../../core';
import {
  CARGO_COLORS,
  CARGO_LABELS_NO,
  CARGO_UNITS_NO,
  formatKr,
  formatNumber,
  STATION_KIND_LABELS_NO,
  VEHICLE_STATE_LABELS_NO,
} from '../formatters';
import { TTDWindow } from '../TTDWindow';

export interface DepotSelection {
  x: number;
  y: number;
  depotType: 'ROAD' | 'RAIL';
}

export interface DepotAndOrdersWindowProps {
  engine: GameEngine;
  state: GameState;
  selectedDepot: DepotSelection | null;
  selectedVehicleId: string | null;
  isPickingStationOrder: boolean;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onSelectVehicle: (vehicleId: string | null) => void;
  onSelectDepot: (depot: DepotSelection) => void;
  onToggleStationPicker: (vehicleId: string | null) => void;
  onFocusTile: (x: number, y: number) => void;
}

export const DepotAndOrdersWindow: React.FC<DepotAndOrdersWindowProps> = ({
  engine,
  state,
  selectedDepot,
  selectedVehicleId,
  isPickingStationOrder,
  zIndex,
  onFocus,
  onClose,
  onSelectVehicle,
  onSelectDepot,
  onToggleStationPicker,
  onFocusTile,
}) => {
  const playerDepots = useMemo(() => {
    return state.tiles
      .filter(
        (t) =>
          (t.depot === 'ROAD' || t.depot === 'RAIL') &&
          (!t.ownerId || t.ownerId === 'player')
      )
      .map((t) => ({
        x: t.x,
        y: t.y,
        depotType: t.depot as 'ROAD' | 'RAIL',
      }));
  }, [state.tiles]);

  const playerVehicles = useMemo(
    () => state.vehicles.filter((v) => !v.ownerId || v.ownerId === 'player'),
    [state.vehicles]
  );

  const activeVehicle =
    playerVehicles.find((v) => v.id === selectedVehicleId) ?? null;

  const [tab, setTab] = useState<'buy' | 'orders'>(
    selectedVehicleId ? 'orders' : 'buy'
  );

  useEffect(() => {
    if (selectedVehicleId) {
      setTab('orders');
    } else if (selectedDepot) {
      setTab('buy');
    }
  }, [selectedVehicleId, selectedDepot]);

  const effectiveDepot: DepotSelection | null =
    selectedDepot ?? (playerDepots.length > 0 ? playerDepots[0] : null);

  const catalogForDepot = useMemo(() => {
    const net = effectiveDepot?.depotType ?? 'ROAD';
    return VEHICLE_CATALOG_LIST.filter((item) => item.network === net);
  }, [effectiveDepot?.depotType]);

  const [selectedModelId, setSelectedModelId] = useState<VehicleModelId>('BUS_CITY');
  const [selectedCargo, setSelectedCargo] = useState<CargoType>('PASSENGERS');
  const [wagonCount, setWagonCount] = useState<number>(3);
  const [dropdownStationId, setDropdownStationId] = useState<string>('');
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Keep selectedModelId synchronized with depot network
  useEffect(() => {
    if (catalogForDepot.length > 0) {
      const stillValid = catalogForDepot.some((c) => c.id === selectedModelId);
      if (!stillValid) {
        const first = catalogForDepot[0];
        setSelectedModelId(first.id);
        setSelectedCargo(first.defaultCargo);
      }
    }
  }, [catalogForDepot, selectedModelId]);

  const selectedCatalogItem: VehicleCatalogItem | undefined =
    catalogForDepot.find((c) => c.id === selectedModelId) ?? catalogForDepot[0];

  useEffect(() => {
    if (
      selectedCatalogItem &&
      !selectedCatalogItem.supportedCargos.includes(selectedCargo)
    ) {
      setSelectedCargo(selectedCatalogItem.defaultCargo);
    }
  }, [selectedCatalogItem, selectedCargo]);

  const handleBuyVehicle = () => {
    if (!effectiveDepot || !selectedCatalogItem) return;
    const res = engine.buyVehicle({
      depotX: effectiveDepot.x,
      depotY: effectiveDepot.y,
      modelId: selectedCatalogItem.id,
      cargoType: selectedCargo,
      wagonCount: selectedCatalogItem.network === 'RAIL' ? wagonCount : 0,
    });
    if (res.ok && res.vehicleId) {
      setFeedback({
        ok: true,
        msg: `Kjøpte ${selectedCatalogItem.nameNo}! Legg til minst 2 stasjoner og trykk Start.`,
      });
      onSelectVehicle(res.vehicleId);
      setTab('orders');
    } else {
      setFeedback({
        ok: false,
        msg: res.message ?? 'Kunne ikke kjøpe kjøretøy (sjekk selskapets saldo).',
      });
    }
  };

  // Compatible player stations for activeVehicle
  const compatibleStations = useMemo(() => {
    if (!activeVehicle) return [];
    return state.stations.filter((st) => {
      if (st.ownerId && st.ownerId !== 'player') return false;
      if (activeVehicle.network === 'RAIL') return st.kind === 'TRAIN_STATION';
      return st.kind === 'BUS_STOP' || st.kind === 'TRUCK_BAY';
    });
  }, [state.stations, activeVehicle]);

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

  const handleAddOrderFromDropdown = () => {
    if (!activeVehicle || !dropdownStationId) return;
    const nextOrders = [...activeVehicle.orders, dropdownStationId];
    const res = engine.updateVehicleOrders(activeVehicle.id, nextOrders);
    if (!res.ok && res.message) {
      setFeedback({ ok: false, msg: res.message });
    } else {
      setFeedback(null);
    }
  };

  const handleRemoveOrder = (idx: number) => {
    if (!activeVehicle) return;
    const nextOrders = activeVehicle.orders.filter((_, i) => i !== idx);
    engine.updateVehicleOrders(activeVehicle.id, nextOrders);
  };

  const handleMoveOrder = (idx: number, dir: -1 | 1) => {
    if (!activeVehicle) return;
    const target = idx + dir;
    if (target < 0 || target >= activeVehicle.orders.length) return;
    const nextOrders = [...activeVehicle.orders];
    const tmp = nextOrders[idx];
    nextOrders[idx] = nextOrders[target];
    nextOrders[target] = tmp;
    engine.updateVehicleOrders(activeVehicle.id, nextOrders);
  };

  const handleChangeVehicleCargo = (newCargo: CargoType) => {
    if (!activeVehicle) return;
    const res = engine.updateVehicleOrders(
      activeVehicle.id,
      activeVehicle.orders,
      newCargo
    );
    if (res.ok) {
      setFeedback({
        ok: true,
        msg: `Byttet lastetype til ${CARGO_LABELS_NO[newCargo]}.`,
      });
    }
  };

  const handleToggleRun = () => {
    if (!activeVehicle) return;
    const res = engine.toggleVehicleStopped(activeVehicle.id);
    if (!res.ok && res.message) {
      setFeedback({ ok: false, msg: res.message });
    } else {
      setFeedback(null);
    }
  };

  const handleSellVehicle = () => {
    if (!activeVehicle) return;
    onToggleStationPicker(null);
    const res = engine.sellVehicle(activeVehicle.id);
    if (res.ok) {
      setFeedback({
        ok: true,
        msg: res.message ?? 'Solgte kjøretøy.',
      });
      onSelectVehicle(null);
      setTab('buy');
    } else if (res.message) {
      setFeedback({ ok: false, msg: res.message });
    }
  };

  const activeVehicleSpec = activeVehicle
    ? VEHICLE_CATALOG_LIST.find((c) => c.id === activeVehicle.modelId)
    : undefined;

  const totalPurchaseCost = selectedCatalogItem
    ? selectedCatalogItem.price +
      (selectedCatalogItem.network === 'RAIL'
        ? wagonCount * selectedCatalogItem.wagonPrice
        : 0)
    : 0;

  const totalPurchaseCapacity = selectedCatalogItem
    ? selectedCatalogItem.baseCapacity +
      (selectedCatalogItem.network === 'RAIL'
        ? wagonCount * selectedCatalogItem.capacityPerWagon
        : 0)
    : 0;

  const estMonthlyRunning = selectedCatalogItem
    ? Math.round(
        (selectedCatalogItem.annualRunningCost +
          (selectedCatalogItem.network === 'RAIL'
            ? wagonCount * selectedCatalogItem.runningCostPerWagon
            : 0)) /
          12
      )
    : 0;

  return (
    <TTDWindow
      id="depot"
      title={
        tab === 'orders' && activeVehicle
          ? `Kjøretøy & Ordre – ${activeVehicle.name}`
          : effectiveDepot
          ? `${effectiveDepot.depotType === 'RAIL' ? 'Togdepot' : 'Bildepot'} (${effectiveDepot.x}, ${effectiveDepot.y})`
          : 'Depot & Kjøreordre'
      }
      icon={<Warehouse className="w-3.5 h-3.5" />}
      theme="teal"
      defaultX={220}
      defaultY={62}
      width={560}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={(id) => {
        onToggleStationPicker(null);
        onClose(id);
      }}
    >
      {/* Mode switcher */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            onToggleStationPicker(null);
            setTab('buy');
          }}
          className={`ttd-btn flex-1 !py-1.5 ${tab === 'buy' ? 'ttd-btn-active' : ''}`}
        >
          <ShoppingCart className="w-3.5 h-3.5 text-amber-300" />
          <span>Kjøp i Depot</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('orders')}
          className={`ttd-btn flex-1 !py-1.5 ${tab === 'orders' ? 'ttd-btn-active' : ''}`}
        >
          <TrainFront className="w-3.5 h-3.5 text-emerald-300" />
          <span>Kjøreordre & Status ({playerVehicles.length})</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`ttd-inset p-2 text-[11px] font-semibold ${
            feedback.ok ? 'text-emerald-300 border-emerald-600' : 'text-rose-300 border-rose-600'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* TAB 1: BUY IN DEPOT */}
      {tab === 'buy' && (
        <div className="space-y-2.5">
          {playerDepots.length === 0 ? (
            <div className="ttd-inset p-4 text-center text-slate-300 space-y-1.5">
              <p className="font-bold text-amber-200">Ingen depoter bygget ennå!</p>
              <p className="text-[11px] text-slate-400">
                Åpne <strong>Jernbane</strong> eller <strong>Vei</strong> i verktøylinjen og plasser et{' '}
                <strong>Togdepot</strong> eller <strong>Bildepot</strong> inntil sporet/veien.
              </p>
            </div>
          ) : (
            <>
              {/* Depot Selector */}
              <div className="flex items-center justify-between gap-2 ttd-panel p-1.5">
                <label className="text-[11px] font-semibold text-amber-200">
                  Valgt depot:
                </label>
                <div className="flex items-center gap-1.5 flex-1 max-w-xs">
                  <select
                    value={
                      effectiveDepot
                        ? `${effectiveDepot.depotType}:${effectiveDepot.x},${effectiveDepot.y}`
                        : ''
                    }
                    onChange={(e) => {
                      const [type, coords] = e.target.value.split(':');
                      const [xStr, yStr] = coords.split(',');
                      onSelectDepot({
                        depotType: type as 'ROAD' | 'RAIL',
                        x: Number(xStr),
                        y: Number(yStr),
                      });
                    }}
                    className="ttd-inset px-2 py-1 text-xs flex-1 text-slate-100"
                  >
                    {playerDepots.map((d, idx) => (
                      <option
                        key={`${d.depotType}-${d.x}-${d.y}`}
                        value={`${d.depotType}:${d.x},${d.y}`}
                      >
                        #{idx + 1} {d.depotType === 'RAIL' ? 'Togdepot' : 'Bildepot'} ({d.x},{' '}
                        {d.y})
                      </option>
                    ))}
                  </select>
                  {effectiveDepot && (
                    <button
                      type="button"
                      title="Sentrer på depot"
                      onClick={() => onFocusTile(effectiveDepot.x, effectiveDepot.y)}
                      className="ttd-btn !px-2 !py-1"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Vehicle Catalog Cards */}
              <div className="space-y-1.5">
                <div className="text-[11px] text-slate-300 font-semibold">
                  Velg kjøretøymodell ({effectiveDepot?.depotType === 'RAIL' ? 'Lokomotiver' : 'Vei'}):
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {catalogForDepot.map((item) => {
                    const active = selectedCatalogItem?.id === item.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedModelId(item.id)}
                        className={`ttd-inset p-2 cursor-pointer transition flex items-center justify-between gap-2 ${
                          active
                            ? 'ring-2 ring-amber-400 bg-slate-800/90'
                            : 'hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="font-bold text-amber-100 flex items-center gap-1.5">
                            {item.network === 'RAIL' ? (
                              <TrainFront className="w-3.5 h-3.5 text-sky-300" />
                            ) : (
                              <Truck className="w-3.5 h-3.5 text-amber-300" />
                            )}
                            <span>{item.nameNo}</span>
                          </div>
                          <div className="text-[11px] text-slate-400">{item.description}</div>
                        </div>

                        <div className="text-right shrink-0 ttd-num">
                          <div className="font-bold text-emerald-300">{formatKr(item.price)}</div>
                          <div className="text-[10px] text-slate-300">
                            {item.maxSpeedKmh} km/t
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Cargo & Wagon Configuration */}
              {selectedCatalogItem && (
                <div className="ttd-panel p-2.5 space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-amber-200 font-semibold mb-1">
                        Lastetype:
                      </label>
                      <select
                        value={selectedCargo}
                        onChange={(e) => setSelectedCargo(e.target.value as CargoType)}
                        className="ttd-inset w-full px-2 py-1.5 text-xs text-slate-100"
                      >
                        {selectedCatalogItem.supportedCargos.map((c) => (
                          <option key={c} value={c}>
                            {CARGO_LABELS_NO[c]} ({CARGO_UNITS_NO[c]})
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedCatalogItem.network === 'RAIL' && (
                      <div>
                        <label className="block text-[11px] text-amber-200 font-semibold mb-1">
                          Antall vogner ({wagonCount} stk — 1 til 6):
                        </label>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5, 6].map((cnt) => (
                            <button
                              key={cnt}
                              type="button"
                              onClick={() => setWagonCount(cnt)}
                              className={`ttd-btn flex-1 !py-1 ttd-num ${
                                wagonCount === cnt ? 'ttd-btn-active' : ''
                              }`}
                            >
                              {cnt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Specs summary + Buy Button */}
                  <div className="ttd-inset p-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5 text-[11px] ttd-num">
                      <div>
                        Kapasitet:{' '}
                        <strong className="text-sky-300">
                          {formatNumber(totalPurchaseCapacity)} {CARGO_UNITS_NO[selectedCargo]}
                        </strong>{' '}
                        • Maksfart: <strong>{selectedCatalogItem.maxSpeedKmh} km/t</strong>
                      </div>
                      <div className="text-slate-400">
                        Driftskostnad: ca. {formatKr(estMonthlyRunning)}/mnd (betales av AS)
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleBuyVehicle}
                      className="ttd-btn ttd-btn-green !px-3.5 !py-2 !text-xs"
                    >
                      <ShoppingCart className="w-4 h-4" />
                      <span>Kjøp for {formatKr(totalPurchaseCost)}</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: VEHICLE ORDERS & LIVE INSPECTOR */}
      {tab === 'orders' && (
        <div className="space-y-2.5">
          {playerVehicles.length === 0 ? (
            <div className="ttd-inset p-4 text-center text-slate-400">
              Du eier ingen kjøretøy ennå. Velg fanen <strong>Kjøp i Depot</strong> for å kjøpe ditt første kjøretøy!
            </div>
          ) : (
            <>
              {/* Vehicle Picker */}
              <div className="flex items-center gap-1.5 ttd-panel p-1.5">
                <span className="text-[11px] font-semibold text-amber-200 shrink-0">
                  Kjøretøy:
                </span>
                <select
                  value={activeVehicle?.id ?? ''}
                  onChange={(e) => {
                    onToggleStationPicker(null);
                    onSelectVehicle(e.target.value || null);
                  }}
                  className="ttd-inset px-2 py-1 text-xs flex-1 text-slate-100"
                >
                  {playerVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} — {CARGO_LABELS_NO[v.cargoType]} (
                      {VEHICLE_STATE_LABELS_NO[v.state]})
                    </option>
                  ))}
                </select>
                {activeVehicle && (
                  <button
                    type="button"
                    title="Sentrer kamera på kjøretøy"
                    onClick={() =>
                      onFocusTile(Math.round(activeVehicle.x), Math.round(activeVehicle.y))
                    }
                    className="ttd-btn !px-2 !py-1"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {activeVehicle && (
                <>
                  {/* Status, Cargo Load Bar & Profit This Year */}
                  <div className="ttd-panel p-2 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] ttd-num">
                      <div>
                        Status:{' '}
                        <strong
                          className={
                            activeVehicle.state === 'STOPPED' ||
                            activeVehicle.state === 'IN_DEPOT'
                              ? 'text-amber-300'
                              : 'text-emerald-300'
                          }
                        >
                          {VEHICLE_STATE_LABELS_NO[activeVehicle.state]}
                        </strong>{' '}
                        ({Math.round(activeVehicle.speedKmh)} / {activeVehicle.maxSpeedKmh} km/t)
                      </div>
                      <div>
                        Resultat i år:{' '}
                        <strong
                          className={
                            activeVehicle.profitThisYear >= 0
                              ? 'text-emerald-300'
                              : 'text-rose-400'
                          }
                        >
                          {formatKr(activeVehicle.profitThisYear, true)}
                        </strong>
                      </div>
                    </div>

                    {/* Cargo Load Bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] ttd-num">
                        <span>
                          Last om bord:{' '}
                          <strong className="text-amber-200">
                            {CARGO_LABELS_NO[activeVehicle.cargoType]}
                          </strong>
                        </span>
                        <span>
                          {formatNumber(activeVehicle.cargoAmount)} /{' '}
                          {formatNumber(activeVehicle.capacity)}{' '}
                          {CARGO_UNITS_NO[activeVehicle.cargoType]}
                        </span>
                      </div>
                      <div className="ttd-inset h-3.5 w-full overflow-hidden p-0.5">
                        <div
                          className="h-full transition-all duration-200"
                          style={{
                            width: `${Math.min(
                              100,
                              activeVehicle.capacity > 0
                                ? (activeVehicle.cargoAmount / activeVehicle.capacity) * 100
                                : 0
                            )}%`,
                            backgroundColor: CARGO_COLORS[activeVehicle.cargoType],
                          }}
                        />
                      </div>
                    </div>

                    {/* Optional cargo refit if supported */}
                    {activeVehicleSpec &&
                      activeVehicleSpec.supportedCargos.length > 1 && (
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-700/60 text-[11px]">
                          <span className="text-slate-300">Bytt lastetype (ombygging):</span>
                          <select
                            value={activeVehicle.cargoType}
                            onChange={(e) =>
                              handleChangeVehicleCargo(e.target.value as CargoType)
                            }
                            className="ttd-inset px-2 py-0.5 text-[11px]"
                          >
                            {activeVehicleSpec.supportedCargos.map((c) => (
                              <option key={c} value={c}>
                                {CARGO_LABELS_NO[c]}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                  </div>

                  {/* Orders List */}
                  <div className="ttd-panel p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-200 text-xs">
                        Kjøreordre ({activeVehicle.orders.length} stopp)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onToggleStationPicker(
                            isPickingStationOrder ? null : activeVehicle.id
                          )
                        }
                        className={`ttd-btn ttd-btn-brass !py-1 ${
                          isPickingStationOrder ? 'ttd-btn-active' : ''
                        }`}
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        <span>
                          {isPickingStationOrder
                            ? 'Klikk stasjon på kartet... (Avslutt)'
                            : 'Legg til stasjon (klikk på kart)'}
                        </span>
                      </button>
                    </div>

                    {/* Ordered Stops */}
                    <div className="ttd-inset divide-y divide-slate-800 max-h-40 overflow-y-auto">
                      {activeVehicle.orders.length === 0 ? (
                        <div className="p-3 text-center text-slate-400 text-[11px]">
                          Ingen stasjoner i ruten ennå. Klikk{' '}
                          <strong className="text-amber-200">Legg til stasjon</strong> eller velg fra listen under!
                        </div>
                      ) : (
                        activeVehicle.orders.map((stId, idx) => {
                          const st = state.stations.find((s) => s.id === stId);
                          const isCurrent =
                            activeVehicle.orders.length > 0 &&
                            idx ===
                              activeVehicle.currentOrderIndex %
                                activeVehicle.orders.length;

                          return (
                            <div
                              key={`${stId}-${idx}`}
                              className={`px-2 py-1.5 flex items-center justify-between gap-2 text-[11px] ${
                                isCurrent ? 'bg-emerald-950/45 text-emerald-200' : ''
                              }`}
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
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => handleMoveOrder(idx, -1)}
                                  className="ttd-btn !px-1 !py-0.5"
                                  title="Flytt opp"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === activeVehicle.orders.length - 1}
                                  onClick={() => handleMoveOrder(idx, 1)}
                                  className="ttd-btn !px-1 !py-0.5"
                                  title="Flytt ned"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveOrder(idx)}
                                  className="ttd-btn ttd-btn-red !px-1.5 !py-0.5"
                                  title="Fjern stopp"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Dropdown quick-add */}
                    <div className="flex items-center gap-1.5">
                      <select
                        value={dropdownStationId}
                        onChange={(e) => setDropdownStationId(e.target.value)}
                        className="ttd-inset px-2 py-1 text-xs flex-1 text-slate-100"
                      >
                        {compatibleStations.length === 0 ? (
                          <option value="">
                            Ingen kompatible stasjoner bygget ennå
                          </option>
                        ) : (
                          compatibleStations.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.name} ({STATION_KIND_LABELS_NO[st.kind]})
                            </option>
                          ))
                        )}
                      </select>
                      <button
                        type="button"
                        disabled={!dropdownStationId}
                        onClick={handleAddOrderFromDropdown}
                        className="ttd-btn ttd-btn-teal !py-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Legg til i rute</span>
                      </button>
                    </div>
                  </div>

                  {/* Start / Stop & Sell Controls */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleToggleRun}
                      className={`ttd-btn flex-1 !py-2 !text-xs ${
                        activeVehicle.state === 'STOPPED' ||
                        activeVehicle.state === 'IN_DEPOT'
                          ? 'ttd-btn-green'
                          : 'ttd-btn-brass'
                      }`}
                    >
                      {activeVehicle.state === 'STOPPED' ||
                      activeVehicle.state === 'IN_DEPOT' ? (
                        <>
                          <Play className="w-4 h-4" />
                          <span>Start kjøretøy (Kjør rute!)</span>
                        </>
                      ) : (
                        <>
                          <Square className="w-3.5 h-3.5" />
                          <span>Stopp kjøretøy</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleSellVehicle}
                      className="ttd-btn ttd-btn-red !py-2 !px-3"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Selg kjøretøy</span>
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </TTDWindow>
  );
};
