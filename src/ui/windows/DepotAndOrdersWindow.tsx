import React, { useEffect, useMemo, useState } from 'react';
import {
  Warehouse,
  TrainFront,
  Truck,
  Flag,
  ClipboardList,
  Trash2,
  Plus,
  Crosshair,
  ShoppingCart,
  Wrench,
  Zap,
  ChevronDown,
  ChevronRight,
  ArrowDownToLine,
} from 'lucide-react';
import type {
  CargoType,
  GameState,
  Vehicle,
} from '../../types/game';
import {
  ALL_CARGO_TYPES,
  GameEngine,
  MAX_TRAIN_WAGONS,
  RAIL_WAGON_CATALOG,
  RAIL_WAGON_CATALOG_LIST,
  ROAD_REFIT_COST_KR,
  ROAD_VEHICLE_SHOP_LIST,
  VEHICLE_CATALOG_LIST,
} from '../../core';
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
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onSelectVehicle: (vehicleId: string | null) => void;
  onSelectDepot: (depot: DepotSelection) => void;
  onOpenVehicleDetail: (vehicleId: string) => void;
  onFocusTile: (x: number, y: number) => void;
}

type DepotDragPayload =
  | {
      kind: 'TRAIN_WAGON';
      fromVehicleId: string;
      wagonId: string;
      cargoType: CargoType;
    }
  | {
      kind: 'DEPOT_WAGON';
      wagonId: string;
      cargoType: CargoType;
    }
  | {
      kind: 'SHOP_WAGON';
      cargoType: CargoType;
    }
  | {
      kind: 'LOCO';
      vehicleId: string;
    }
  | {
      kind: 'ROAD_VEHICLE';
      vehicleId: string;
    };

const TRUCK_REFIT_CARGOS: CargoType[] = ALL_CARGO_TYPES.filter(
  (c) => c !== 'PASSENGERS'
);

export const DepotAndOrdersWindow: React.FC<DepotAndOrdersWindowProps> = ({
  engine,
  state,
  selectedDepot,
  selectedVehicleId,
  zIndex,
  onFocus,
  onClose,
  onSelectVehicle,
  onSelectDepot,
  onOpenVehicleDetail,
  onFocusTile,
}) => {
  const playerColor = state.corporate.playerColor ?? '#2563eb';

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

  const effectiveDepot: DepotSelection | null = useMemo(() => {
    if (selectedDepot) {
      const stillExists = playerDepots.some(
        (d) =>
          d.x === selectedDepot.x &&
          d.y === selectedDepot.y &&
          d.depotType === selectedDepot.depotType
      );
      if (stillExists) return selectedDepot;
    }
    return playerDepots[0] ?? null;
  }, [selectedDepot, playerDepots]);

  const playerVehicles = useMemo(
    () => state.vehicles.filter((v) => !v.ownerId || v.ownerId === 'player'),
    [state.vehicles]
  );

  // Vehicles currently parked INSIDE THIS EXACT DEPOT
  const vehiclesInDepot = useMemo(() => {
    if (!effectiveDepot) return [];
    return playerVehicles.filter(
      (v) =>
        v.network === effectiveDepot.depotType &&
        v.state === 'IN_DEPOT' &&
        Math.round(v.x) === effectiveDepot.x &&
        Math.round(v.y) === effectiveDepot.y
    );
  }, [playerVehicles, effectiveDepot]);

  // Vehicles on the same network currently out in traffic (or in another depot)
  const vehiclesOutsideDepot = useMemo(() => {
    if (!effectiveDepot) return [];
    return playerVehicles.filter(
      (v) =>
        v.network === effectiveDepot.depotType &&
        !(
          v.state === 'IN_DEPOT' &&
          Math.round(v.x) === effectiveDepot.x &&
          Math.round(v.y) === effectiveDepot.y
        )
    );
  }, [playerVehicles, effectiveDepot]);

  // Spare uncoupled rail wagons stored on this depot's siding
  const spareWagonsInDepot = useMemo(() => {
    if (!effectiveDepot || effectiveDepot.depotType !== 'RAIL') return [];
    return (state.depotWagons ?? []).filter(
      (w) => w.depotX === effectiveDepot.x && w.depotY === effectiveDepot.y
    );
  }, [state.depotWagons, effectiveDepot]);

  // Active selected train inside this depot (for 1-click wagon coupling)
  const selectedVehicleInDepot: Vehicle | null = useMemo(() => {
    if (selectedVehicleId) {
      const match = vehiclesInDepot.find((v) => v.id === selectedVehicleId);
      if (match) return match;
    }
    return vehiclesInDepot[0] ?? null;
  }, [vehiclesInDepot, selectedVehicleId]);

  const railLocomotivesCatalog = useMemo(
    () => VEHICLE_CATALOG_LIST.filter((c) => c.network === 'RAIL'),
    []
  );

  // Sub-tab inside Rail Shop: strictly separate Locomotives vs Wagons!
  const [railShopTab, setRailShopTab] = useState<'locos' | 'wagons'>('locos');
  const [showRunningSection, setShowRunningSection] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null
  );
  const [dragPayload, setDragPayload] = useState<DepotDragPayload | null>(null);
  const [dragHoverTarget, setDragHoverTarget] = useState<string | null>(null);
  const [refitCargoByVehicle, setRefitCargoByVehicle] = useState<
    Record<string, CargoType>
  >({});

  // Clear feedback on depot switch
  useEffect(() => {
    setFeedback(null);
  }, [effectiveDepot?.x, effectiveDepot?.y, effectiveDepot?.depotType]);

  // Drag-and-Drop Helpers
  const beginDrag = (
    e: React.DragEvent,
    payload: DepotDragPayload
  ) => {
    setDragPayload(payload);
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    } catch {
      // ignore browser restrictions
    }
  };

  const readDragPayload = (e: React.DragEvent): DepotDragPayload | null => {
    if (dragPayload) return dragPayload;
    try {
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw) return null;
      return JSON.parse(raw) as DepotDragPayload;
    } catch {
      return null;
    }
  };

  const endDrag = () => {
    setDragPayload(null);
    setDragHoverTarget(null);
  };

  const handleDropOnTrainTrack = (
    e: React.DragEvent,
    targetTrainId: string,
    insertIndex?: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragHoverTarget(null);
    if (!effectiveDepot) return;

    const payload = readDragPayload(e);
    setDragPayload(null);
    if (!payload) return;

    if (payload.kind === 'SHOP_WAGON') {
      const res = engine.buyRailWagon(
        effectiveDepot.x,
        effectiveDepot.y,
        payload.cargoType,
        targetTrainId
      );
      onSelectVehicle(targetTrainId);
      setFeedback({
        ok: res.ok,
        msg:
          res.message ??
          (res.ok
            ? `Kjøpte og koblet ${RAIL_WAGON_CATALOG[payload.cargoType].shortNameNo} på toget!`
            : 'Kunne ikke kjøpe og koble vogn.'),
      });
      return;
    }

    if (payload.kind === 'DEPOT_WAGON') {
      const res = engine.attachDepotWagonToTrain(
        payload.wagonId,
        targetTrainId,
        insertIndex
      );
      onSelectVehicle(targetTrainId);
      setFeedback({
        ok: res.ok,
        msg:
          res.message ??
          (res.ok ? 'Koblet ledig vogn på toget!' : 'Kunne ikke koble vogn på toget.'),
      });
      return;
    }

    if (payload.kind === 'TRAIN_WAGON') {
      const res = engine.moveTrainWagon(
        payload.fromVehicleId,
        payload.wagonId,
        targetTrainId,
        insertIndex
      );
      onSelectVehicle(targetTrainId);
      if (!res.ok && res.message) {
        setFeedback({ ok: false, msg: res.message });
      } else if (payload.fromVehicleId !== targetTrainId) {
        setFeedback({
          ok: true,
          msg: res.message ?? 'Flyttet vogn over til valgt tog!',
        });
      }
    }
  };

  const handleDropOnSpareSiding = (e: React.DragEvent) => {
    e.preventDefault();
    setDragHoverTarget(null);
    if (!effectiveDepot) return;

    const payload = readDragPayload(e);
    setDragPayload(null);
    if (!payload) return;

    if (payload.kind === 'TRAIN_WAGON') {
      const res = engine.detachTrainWagonToDepot(
        payload.fromVehicleId,
        payload.wagonId
      );
      setFeedback({
        ok: res.ok,
        msg:
          res.message ??
          (res.ok
            ? 'Koblet vogn fra toget og parkerte den på sidesporet i depoet.'
            : 'Kunne ikke koble fra vogn.'),
      });
      return;
    }

    if (payload.kind === 'SHOP_WAGON') {
      const res = engine.buyRailWagon(
        effectiveDepot.x,
        effectiveDepot.y,
        payload.cargoType,
        null
      );
      setFeedback({
        ok: res.ok,
        msg:
          res.message ??
          (res.ok
            ? `Kjøpte ${RAIL_WAGON_CATALOG[payload.cargoType].shortNameNo} til sidesporet i depoet.`
            : 'Kunne ikke kjøpe vogn.'),
      });
    }
  };

  const handleDropOnSellSingleOrLocoOnly = (e: React.DragEvent) => {
    e.preventDefault();
    setDragHoverTarget(null);
    const payload = readDragPayload(e);
    setDragPayload(null);
    if (!payload) return;

    if (payload.kind === 'TRAIN_WAGON') {
      const res = engine.sellTrainWagon(payload.fromVehicleId, payload.wagonId);
      setFeedback({
        ok: res.ok,
        msg: res.message ?? (res.ok ? 'Solgte vogn (85% innbytte).' : 'Kunne ikke selge vogn.'),
      });
      return;
    }

    if (payload.kind === 'DEPOT_WAGON') {
      const res = engine.sellDepotWagon(payload.wagonId);
      setFeedback({
        ok: res.ok,
        msg: res.message ?? (res.ok ? 'Solgte sidespor-vogn (85% innbytte).' : 'Kunne ikke selge vogn.'),
      });
      return;
    }

    if (payload.kind === 'LOCO') {
      const res = engine.sellVehicle(payload.vehicleId, {
        keepWagonsInDepot: true,
      });
      if (res.ok && selectedVehicleId === payload.vehicleId) {
        onSelectVehicle(null);
      }
      setFeedback({
        ok: res.ok,
        msg:
          res.message ??
          (res.ok
            ? 'Solgte kun lokomotivet — vognene står trygt igjen på sidesporet!'
            : 'Kunne ikke selge lokomotiv.'),
      });
      return;
    }

    if (payload.kind === 'ROAD_VEHICLE') {
      const res = engine.sellVehicle(payload.vehicleId);
      if (res.ok && selectedVehicleId === payload.vehicleId) {
        onSelectVehicle(null);
      }
      setFeedback({
        ok: res.ok,
        msg: res.message ?? 'Solgte kjøretøy.',
      });
    }
  };

  const handleDropOnSellWholeTrain = (e: React.DragEvent) => {
    e.preventDefault();
    setDragHoverTarget(null);
    const payload = readDragPayload(e);
    setDragPayload(null);
    if (!payload) return;

    const targetId =
      payload.kind === 'LOCO'
        ? payload.vehicleId
        : payload.kind === 'TRAIN_WAGON'
        ? payload.fromVehicleId
        : payload.kind === 'ROAD_VEHICLE'
        ? payload.vehicleId
        : null;

    if (!targetId) {
      if (payload.kind === 'DEPOT_WAGON') {
        const res = engine.sellDepotWagon(payload.wagonId);
        setFeedback({ ok: res.ok, msg: res.message ?? 'Solgte vogn.' });
      }
      return;
    }

    const res = engine.sellVehicle(targetId, { keepWagonsInDepot: false });
    if (res.ok && selectedVehicleId === targetId) {
      onSelectVehicle(null);
    }
    setFeedback({
      ok: res.ok,
      msg: res.message ?? (res.ok ? 'Solgte hele toget inkludert vogner!' : 'Kunne ikke selge tog.'),
    });
  };

  // Direct Button Actions
  const handleBuyBareLocomotive = (
    modelId: 'LOCO_STEAM' | 'LOCO_DIESEL' | 'LOCO_ELECTRIC'
  ) => {
    if (!effectiveDepot) return;
    const res = engine.buyLocomotive(
      effectiveDepot.x,
      effectiveDepot.y,
      modelId
    );
    if (res.ok && res.vehicleId) {
      onSelectVehicle(res.vehicleId);
      setRailShopTab('wagons');
      setFeedback({
        ok: true,
        msg: 'Lokomotiv kjøpt! Klikk eller dra ønskede vogner under for å koble dem på toget.',
      });
    } else {
      setFeedback({
        ok: false,
        msg: res.message ?? 'Kunne ikke kjøpe lokomotiv (sjekk selskapets saldo).',
      });
    }
  };

  const handleBuyRailWagonClick = (
    cargoType: CargoType,
    attachToTrainId: string | null
  ) => {
    if (!effectiveDepot) return;
    const res = engine.buyRailWagon(
      effectiveDepot.x,
      effectiveDepot.y,
      cargoType,
      attachToTrainId
    );
    if (res.ok) {
      if (attachToTrainId) onSelectVehicle(attachToTrainId);
      setFeedback({
        ok: true,
        msg:
          res.message ??
          (attachToTrainId
            ? `Koblet ny ${RAIL_WAGON_CATALOG[cargoType].shortNameNo} på toget!`
            : `La ny ${RAIL_WAGON_CATALOG[cargoType].shortNameNo} på sidesporet i depoet.`),
      });
    } else {
      setFeedback({
        ok: false,
        msg: res.message ?? 'Kunne ikke kjøpe vogn.',
      });
    }
  };

  const handleBuyRoadShopItem = (shopId: string, nameNo: string) => {
    if (!effectiveDepot) return;
    const res = engine.buyRoadVehicle(
      effectiveDepot.x,
      effectiveDepot.y,
      shopId
    );
    if (res.ok && res.vehicleId) {
      onSelectVehicle(res.vehicleId);
      setFeedback({
        ok: true,
        msg: `Kjøpte ${nameNo}! Klikk «Rute & Ordre» på kjøretøyet over for å sette stoppesteder.`,
      });
    } else {
      setFeedback({
        ok: false,
        msg: res.message ?? 'Kunne ikke kjøpe kjøretøy.',
      });
    }
  };

  const handleToggleStartInDepot = (v: Vehicle) => {
    const res = engine.toggleVehicleStopped(v.id);
    if (!res.ok && res.message) {
      setFeedback({ ok: false, msg: res.message });
      // If missing orders, open the VehicleDetailWindow right away to help the player!
      if (v.orders.length < 2 && (v.network === 'ROAD' || v.wagonCount > 0)) {
        onOpenVehicleDetail(v.id);
      }
    } else if (res.message) {
      setFeedback({ ok: res.ok, msg: res.message });
    } else {
      setFeedback(null);
    }
  };

  const handleRefitRoadTruck = (v: Vehicle) => {
    const nextCargo =
      refitCargoByVehicle[v.id] ??
      TRUCK_REFIT_CARGOS.find((c) => c !== v.cargoType) ??
      'WOOD';
    const res = engine.refitRoadVehicleInDepot(v.id, nextCargo);
    setFeedback({
      ok: res.ok,
      msg:
        res.message ??
        (res.ok
          ? `Bygget om lastebilen til ${CARGO_LABELS_NO[nextCargo]} (${formatKr(
              ROAD_REFIT_COST_KR
            )})!`
          : 'Kunne ikke bygge om lastebil.'),
    });
  };

  const handleRecallToThisDepot = (v: Vehicle, forceImmediate = false) => {
    if (!effectiveDepot) return;
    const res = engine.sendVehicleToDepot(
      v.id,
      { x: effectiveDepot.x, y: effectiveDepot.y },
      forceImmediate
    );
    setFeedback({
      ok: res.ok,
      msg:
        res.message ??
        (res.ok
          ? forceImmediate
            ? `${v.name} er nå flyttet inn i dette depoet!`
            : `${v.name} kjører nå mot dette depoet.`
          : 'Kunne ikke sende kjøretøy til dette depoet.'),
    });
  };

  return (
    <TTDWindow
      id="depot"
      title={
        effectiveDepot
          ? `${
              effectiveDepot.depotType === 'RAIL' ? 'Togdepot' : 'Bildepot'
            } (${effectiveDepot.x}, ${effectiveDepot.y})`
          : 'Depotoversikt'
      }
      subtitle={
        effectiveDepot?.depotType === 'RAIL'
          ? 'Kjøp lokomotiv & vogner separat • Dra for å bytte'
          : 'Garasje, kjøp og ombygging'
      }
      icon={<Warehouse className="w-3.5 h-3.5" />}
      theme="teal"
      defaultX={48}
      defaultY={58}
      width={536}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      {playerDepots.length === 0 || !effectiveDepot ? (
        <div className="ttd-inset p-4 text-center text-slate-300 space-y-1.5">
          <p className="font-bold text-amber-200">Ingen depoter bygget ennå!</p>
          <p className="text-[11px] text-slate-400">
            Åpne <strong>Jernbane</strong> eller <strong>Vei</strong> i
            verktøylinjen og plasser et <strong>Togdepot</strong> eller{' '}
            <strong>Bildepot</strong> inntil sporet/veien.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {/* Top Bar: Depot Selector + Center Camera */}
          <div className="ttd-panel p-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-amber-200 shrink-0">
              Aktivt depot:
            </span>
            <div className="flex items-center gap-1.5 flex-1 justify-end">
              <select
                value={`${effectiveDepot.depotType}:${effectiveDepot.x},${effectiveDepot.y}`}
                onChange={(e) => {
                  const [type, coords] = e.target.value.split(':');
                  const [xStr, yStr] = coords.split(',');
                  onSelectDepot({
                    depotType: type as 'ROAD' | 'RAIL',
                    x: Number(xStr),
                    y: Number(yStr),
                  });
                }}
                className="ttd-inset px-2 py-1 text-xs flex-1 max-w-xs text-slate-100"
              >
                {playerDepots.map((d, idx) => (
                  <option
                    key={`${d.depotType}-${d.x}-${d.y}`}
                    value={`${d.depotType}:${d.x},${d.y}`}
                  >
                    #{idx + 1} {d.depotType === 'RAIL' ? 'Togdepot' : 'Bildepot'}{' '}
                    ({d.x}, {d.y})
                  </option>
                ))}
              </select>
              <button
                type="button"
                title="Sentrer kamera på dette depoet"
                onClick={() =>
                  onFocusTile(effectiveDepot.x, effectiveDepot.y)
                }
                className="ttd-btn !px-2 !py-1 shrink-0"
              >
                <Crosshair className="w-3.5 h-3.5" />
              </button>
            </div>
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

          {/* ================================================================= */}
          {/* SECTION A: VEHICLES CURRENTLY PARKED INSIDE THIS DEPOT            */}
          {/* ================================================================= */}
          {effectiveDepot.depotType === 'RAIL' ? (
            <div className="ttd-panel p-2 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-bold text-amber-200 text-xs flex items-center gap-1.5">
                  <TrainFront className="w-3.5 h-3.5 text-sky-300" />
                  <span>
                    I dette togdepoet nå ({vehiclesInDepot.length} tog)
                  </span>
                </span>
                <span className="text-[10px] text-slate-300">
                  Klikk tog for å velge • Dra vogner mellom tog, sidespor og søppel
                </span>
              </div>

              {/* Horizontal TTD Depot Track Rows */}
              <div className="space-y-1.5">
                {vehiclesInDepot.length === 0 ? (
                  <div className="ttd-inset p-3 text-center text-slate-400 text-[11px]">
                    Ingen tog står inne i dette depoet akkurat nå. Kjøp et{' '}
                    <strong className="text-amber-200">Lokomotiv</strong> under,
                    eller send inn et eksisterende tog for å bytte vogner!
                  </div>
                ) : (
                  vehiclesInDepot.map((train, trackIdx) => {
                    const isSelected = selectedVehicleInDepot?.id === train.id;
                    const wagons = resolveTrainWagonsList(train);
                    const isHoveringTrack =
                      dragHoverTarget === `track:${train.id}`;

                    return (
                      <div
                        key={train.id}
                        onClick={() => onSelectVehicle(train.id)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragHoverTarget(`track:${train.id}`);
                        }}
                        onDragLeave={() => {
                          if (dragHoverTarget === `track:${train.id}`) {
                            setDragHoverTarget(null);
                          }
                        }}
                        onDrop={(e) => handleDropOnTrainTrack(e, train.id)}
                        className={`ttd-inset p-1.5 transition cursor-pointer ${
                          isHoveringTrack
                            ? 'ring-2 ring-emerald-400 bg-emerald-950/40'
                            : isSelected
                            ? 'ring-2 ring-amber-400 bg-slate-900/95'
                            : 'bg-slate-950/75 hover:bg-slate-900/75'
                        }`}
                      >
                        {/* Track header row */}
                        <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="px-1.5 py-0.2 bg-slate-800 border border-slate-600 text-[10px] font-bold text-amber-300 ttd-num">
                              Spor {trackIdx + 1}
                            </span>
                            <span className="font-bold text-amber-100 truncate">
                              {train.name}
                            </span>
                            <span className="text-[10px] text-slate-400 ttd-num">
                              ({wagons.length}/{MAX_TRAIN_WAGONS} vogner)
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleStartInDepot(train);
                              }}
                              title={
                                wagons.length === 0
                                  ? 'Koble på minst 1 vogn før toget kan kjøre ut'
                                  : 'Send toget ut på linjen (Start)'
                              }
                              className={`ttd-btn !px-2 !py-0.5 !text-[10px] ${
                                wagons.length > 0 && train.orders.length >= 2
                                  ? 'ttd-btn-green'
                                  : ''
                              }`}
                            >
                              <Flag className="w-3 h-3 text-emerald-300" />
                              <span>Kjør ut</span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectVehicle(train.id);
                                onOpenVehicleDetail(train.id);
                              }}
                              className="ttd-btn ttd-btn-teal !px-2 !py-0.5 !text-[10px]"
                              title="Åpne eget kjøretøy- og kjøreordrevindu ved siden av depoet"
                            >
                              <ClipboardList className="w-3 h-3 text-amber-200" />
                              <span>
                                Rute & Ordre ({train.orders.length})
                              </span>
                            </button>
                          </div>
                        </div>

                        {/* Coupled Consist Strip: [Locomotive] == [Wagon 1] == [Wagon 2] ... */}
                        <div className="flex items-end gap-0.5 overflow-x-auto pb-1 pt-0.5">
                          {/* Draggable Locomotive */}
                          <div
                            draggable
                            onDragStart={(e) =>
                              beginDrag(e, { kind: 'LOCO', vehicleId: train.id })
                            }
                            onDragEnd={endDrag}
                            title="Dra lokomotivet til søppelbøtten for å selge kun lokomotivet (beholder vognene) eller hele toget"
                            className="flex flex-col items-center px-1 py-0.5 bg-slate-900/70 border border-slate-700/80 cursor-grab active:cursor-grabbing shrink-0"
                          >
                            <LocoSprite
                              modelId={train.modelId}
                              companyColor={playerColor}
                              size="md"
                            />
                            <span className="text-[9px] text-amber-200 font-semibold">
                              Lokomotiv
                            </span>
                          </div>

                          {/* Coupled Wagons */}
                          {wagons.map((w, wIdx) => (
                            <React.Fragment key={w.id}>
                              <span className="text-slate-400 font-black text-[10px] pb-5 select-none">
                                ═
                              </span>
                              <div
                                draggable
                                onDragStart={(e) =>
                                  beginDrag(e, {
                                    kind: 'TRAIN_WAGON',
                                    fromVehicleId: train.id,
                                    wagonId: w.id,
                                    cargoType: w.cargoType,
                                  })
                                }
                                onDragEnd={endDrag}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setDragHoverTarget(
                                    `wagon:${train.id}:${wIdx}`
                                  );
                                }}
                                onDrop={(e) =>
                                  handleDropOnTrainTrack(e, train.id, wIdx)
                                }
                                title={`${RAIL_WAGON_CATALOG[w.cargoType].nameNo} — Dra for å flytte/koble fra, eller bruk knappene under`}
                                className={`flex flex-col items-center px-1 py-0.5 bg-slate-900/80 border cursor-grab active:cursor-grabbing shrink-0 ${
                                  dragHoverTarget ===
                                  `wagon:${train.id}:${wIdx}`
                                    ? 'border-emerald-400 bg-emerald-950/50'
                                    : 'border-slate-700/80 hover:border-amber-400/70'
                                }`}
                              >
                                <RailWagonSprite
                                  cargoType={w.cargoType}
                                  fillRatio={
                                    w.capacity > 0
                                      ? w.cargoAmount / w.capacity
                                      : 0
                                  }
                                  companyColor={playerColor}
                                  size="sm"
                                />
                                <div className="flex items-center gap-1 text-[9px] text-slate-200 leading-none my-0.5">
                                  <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{
                                      backgroundColor:
                                        CARGO_COLORS[w.cargoType],
                                    }}
                                  />
                                  <span>
                                    {RAIL_WAGON_CATALOG[w.cargoType].shortNameNo}
                                  </span>
                                </div>
                                {/* 1-click Touchpad Uncouple / Sell Controls */}
                                <div className="flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    title="Koble fra til sidespor i depoet (behold vognen)"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const res =
                                        engine.detachTrainWagonToDepot(
                                          train.id,
                                          w.id
                                        );
                                      if (!res.ok && res.message) {
                                        setFeedback({
                                          ok: false,
                                          msg: res.message,
                                        });
                                      }
                                    }}
                                    className="ttd-btn !px-1 !py-0 !h-[15px] !text-[9px]"
                                  >
                                    <ArrowDownToLine className="w-2.5 h-2.5 text-amber-200" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Selg denne vognen (85% innbytte)"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const res = engine.sellTrainWagon(
                                        train.id,
                                        w.id
                                      );
                                      setFeedback({
                                        ok: res.ok,
                                        msg:
                                          res.message ??
                                          'Solgte vogn fra toget.',
                                      });
                                    }}
                                    className="ttd-btn ttd-btn-red !px-1 !py-0 !h-[15px] !text-[9px]"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            </React.Fragment>
                          ))}

                          {/* Drop Slot at End of Train */}
                          {wagons.length < MAX_TRAIN_WAGONS && (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectVehicle(train.id);
                                setRailShopTab('wagons');
                              }}
                              className="ml-1 px-2 py-2 border border-dashed border-slate-600 hover:border-amber-400 text-[10px] text-slate-300 shrink-0 flex items-center gap-1"
                              title="Dra en vogn hit eller klikk for å kjøpe vogner til dette toget"
                            >
                              <Plus className="w-3 h-3 text-amber-300" />
                              <span>
                                {wagons.length === 0
                                  ? 'Koble på første vogn her'
                                  : 'Slipp / koble vogn'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Spare Wagons Siding Dropzone (Ledige vogner på sidespor i depoet) */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragHoverTarget('siding');
                }}
                onDragLeave={() => {
                  if (dragHoverTarget === 'siding') setDragHoverTarget(null);
                }}
                onDrop={handleDropOnSpareSiding}
                className={`ttd-inset p-2 transition ${
                  dragHoverTarget === 'siding'
                    ? 'ring-2 ring-amber-300 bg-amber-950/35'
                    : 'bg-slate-950/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[10px] font-bold text-amber-200 uppercase tracking-wider">
                    Ledige vogner på sidespor i depoet ({spareWagonsInDepot.length})
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Slipp vogn her for å koble fra uten å selge
                  </span>
                </div>

                {spareWagonsInDepot.length === 0 ? (
                  <div className="py-1.5 text-center text-[10px] text-slate-500 border border-dashed border-slate-800">
                    Ingen løse vogner på sidesporet — dra en vogn av et tog (eller trykk ⇊) for å lagre den her mens du bytter last!
                  </div>
                ) : (
                  <div className="flex items-end gap-1.5 overflow-x-auto pb-0.5">
                    {spareWagonsInDepot.map((sw) => (
                      <div
                        key={sw.id}
                        draggable
                        onDragStart={(e) =>
                          beginDrag(e, {
                            kind: 'DEPOT_WAGON',
                            wagonId: sw.id,
                            cargoType: sw.cargoType,
                          })
                        }
                        onDragEnd={endDrag}
                        className="flex flex-col items-center px-1.5 py-1 bg-slate-900 border border-slate-700 cursor-grab active:cursor-grabbing shrink-0"
                      >
                        <RailWagonSprite
                          cargoType={sw.cargoType}
                          companyColor={playerColor}
                          size="sm"
                        />
                        <span className="text-[9px] text-amber-100 font-semibold">
                          {RAIL_WAGON_CATALOG[sw.cargoType].shortNameNo}
                        </span>
                        <div className="flex items-center gap-0.5 mt-0.5">
                          <button
                            type="button"
                            disabled={!selectedVehicleInDepot}
                            title={
                              selectedVehicleInDepot
                                ? `Koble på ${selectedVehicleInDepot.name}`
                                : 'Velg eller kjøp et lokomotiv først'
                            }
                            onClick={() => {
                              if (!selectedVehicleInDepot) return;
                              const res = engine.attachDepotWagonToTrain(
                                sw.id,
                                selectedVehicleInDepot.id
                              );
                              setFeedback({
                                ok: res.ok,
                                msg:
                                  res.message ??
                                  `Koblet ${
                                    RAIL_WAGON_CATALOG[sw.cargoType].shortNameNo
                                  } på ${selectedVehicleInDepot.name}!`,
                              });
                            }}
                            className="ttd-btn ttd-btn-green !px-1.5 !py-0 !h-[16px] !text-[9px] disabled:opacity-40"
                          >
                            + Koble på
                          </button>
                          <button
                            type="button"
                            title="Selg sidespor-vogn (85% innbytte)"
                            onClick={() => {
                              const res = engine.sellDepotWagon(sw.id);
                              setFeedback({
                                ok: res.ok,
                                msg: res.message ?? 'Solgte vogn fra sidesporet.',
                              });
                            }}
                            className="ttd-btn ttd-btn-red !px-1 !py-0 !h-[16px] !text-[9px]"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Two Authentic OpenTTD Sell Dropzones */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragHoverTarget('sell_single');
                  }}
                  onDragLeave={() => {
                    if (dragHoverTarget === 'sell_single') {
                      setDragHoverTarget(null);
                    }
                  }}
                  onDrop={handleDropOnSellSingleOrLocoOnly}
                  onClick={() => {
                    if (!selectedVehicleInDepot) return;
                    const res = engine.sellVehicle(selectedVehicleInDepot.id, {
                      keepWagonsInDepot: true,
                    });
                    if (res.ok) onSelectVehicle(null);
                    setFeedback({
                      ok: res.ok,
                      msg:
                        res.message ??
                        'Solgte kun lokomotivet — vognene ble flyttet til sidesporet!',
                    });
                  }}
                  title="Dra en enkeltvogn hit for å selge den, eller dra/klikk for å selge kun lokomotivet og beholde vognene på sidespor!"
                  className={`ttd-inset p-1.5 flex items-center justify-between gap-1.5 cursor-pointer transition ${
                    dragHoverTarget === 'sell_single'
                      ? 'ring-2 ring-rose-400 bg-rose-950/60'
                      : 'bg-slate-900/80 hover:bg-rose-950/30'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Trash2 className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    <div className="leading-tight">
                      <div className="font-bold text-[10px] text-amber-200">
                        Selg vogn / kun lokomotiv
                      </div>
                      <div className="text-[9px] text-slate-400">
                        Dra vogn hit • Beholder vogner ved lok-salg (85%)
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragHoverTarget('sell_all');
                  }}
                  onDragLeave={() => {
                    if (dragHoverTarget === 'sell_all') {
                      setDragHoverTarget(null);
                    }
                  }}
                  onDrop={handleDropOnSellWholeTrain}
                  onClick={() => {
                    if (!selectedVehicleInDepot) return;
                    const res = engine.sellVehicle(selectedVehicleInDepot.id, {
                      keepWagonsInDepot: false,
                    });
                    if (res.ok) onSelectVehicle(null);
                    setFeedback({
                      ok: res.ok,
                      msg: res.message ?? 'Solgte hele toget!',
                    });
                  }}
                  title="Dra et tog hit (eller klikk når et tog er valgt) for å selge både lokomotiv og alle tilkoblede vogner"
                  className={`ttd-inset p-1.5 flex items-center justify-between gap-1.5 cursor-pointer transition ${
                    dragHoverTarget === 'sell_all'
                      ? 'ring-2 ring-rose-500 bg-rose-950/75'
                      : 'bg-slate-900/80 hover:bg-rose-950/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Trash2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <div className="leading-tight">
                      <div className="font-bold text-[10px] text-rose-300">
                        Selg hele toget
                      </div>
                      <div className="text-[9px] text-slate-400">
                        Selger valgt lokomotiv + alle vogner (85%)
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ROAD DEPOT GARAGE BAYS */
            <div className="ttd-panel p-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-200 text-xs flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5 text-amber-300" />
                  <span>
                    I dette bildepoet nå ({vehiclesInDepot.length} kjøretøy)
                  </span>
                </span>
                <span className="text-[10px] text-slate-300">
                  Start, sett kjøreordre eller bygg om lasteplan
                </span>
              </div>

              {vehiclesInDepot.length === 0 ? (
                <div className="ttd-inset p-3 text-center text-slate-400 text-[11px]">
                  Ingen busser eller lastebiler står inne i dette depoet nå. Kjøp et kjøretøy under eller send inn en bil fra trafikken!
                </div>
              ) : (
                <div className="space-y-1.5">
                  {vehiclesInDepot.map((rv) => {
                    const isSelected = selectedVehicleInDepot?.id === rv.id;
                    const refitSelection =
                      refitCargoByVehicle[rv.id] ??
                      TRUCK_REFIT_CARGOS.find((c) => c !== rv.cargoType) ??
                      'WOOD';

                    return (
                      <div
                        key={rv.id}
                        draggable
                        onDragStart={(e) =>
                          beginDrag(e, {
                            kind: 'ROAD_VEHICLE',
                            vehicleId: rv.id,
                          })
                        }
                        onDragEnd={endDrag}
                        onClick={() => onSelectVehicle(rv.id)}
                        className={`ttd-inset p-2 space-y-1.5 cursor-pointer ${
                          isSelected
                            ? 'ring-2 ring-amber-400 bg-slate-900/95'
                            : 'bg-slate-950/75 hover:bg-slate-900/70'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <RoadVehicleSprite
                              modelId={rv.modelId}
                              cargoType={rv.cargoType}
                              companyColor={playerColor}
                              size="md"
                            />
                            <div className="min-w-0">
                              <div className="font-bold text-amber-100 truncate">
                                {rv.name}
                              </div>
                              <div className="text-[10px] text-slate-300 ttd-num flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{
                                    backgroundColor: CARGO_COLORS[rv.cargoType],
                                  }}
                                />
                                <span>
                                  {CARGO_LABELS_NO[rv.cargoType]} ({rv.capacity}{' '}
                                  {CARGO_UNITS_NO[rv.cargoType]}) •{' '}
                                  {rv.maxSpeedKmh} km/t
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleStartInDepot(rv);
                              }}
                              className={`ttd-btn !px-2 !py-1 !text-[10px] ${
                                rv.orders.length >= 2 ? 'ttd-btn-green' : ''
                              }`}
                            >
                              <Flag className="w-3 h-3 text-emerald-300" />
                              <span>Kjør ut</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectVehicle(rv.id);
                                onOpenVehicleDetail(rv.id);
                              }}
                              className="ttd-btn ttd-btn-teal !px-2 !py-1 !text-[10px]"
                            >
                              <ClipboardList className="w-3 h-3 text-amber-200" />
                              <span>Rute & Ordre ({rv.orders.length})</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const res = engine.sellVehicle(rv.id);
                                if (res.ok && selectedVehicleId === rv.id) {
                                  onSelectVehicle(null);
                                }
                                setFeedback({
                                  ok: res.ok,
                                  msg: res.message ?? 'Solgte kjøretøy.',
                                });
                              }}
                              className="ttd-btn ttd-btn-red !px-1.5 !py-1"
                              title="Selg kjøretøy (85% innbytte)"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* In-Depot Cargo Truck Refit */}
                        {rv.modelId === 'TRUCK_CARGO' && (
                          <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-slate-800/90 text-[10px]">
                            <span className="text-amber-200/90 flex items-center gap-1 font-semibold">
                              <Wrench className="w-3 h-3 text-amber-300" />
                              <span>Bygg om lasteplan:</span>
                            </span>
                            <div className="flex items-center gap-1">
                              <select
                                value={refitSelection}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  setRefitCargoByVehicle((prev) => ({
                                    ...prev,
                                    [rv.id]: e.target.value as CargoType,
                                  }))
                                }
                                className="ttd-inset px-1.5 py-0.5 text-[10px] text-slate-100"
                              >
                                {TRUCK_REFIT_CARGOS.filter(
                                  (c) => c !== rv.cargoType
                                ).map((c) => (
                                  <option key={c} value={c}>
                                    {CARGO_LABELS_NO[c]} ({CARGO_UNITS_NO[c]})
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRefitRoadTruck(rv);
                                }}
                                className="ttd-btn ttd-btn-brass !px-2 !py-0.5 !text-[10px] ttd-num"
                              >
                                Bygg om — {formatKr(ROAD_REFIT_COST_KR)}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* SECTION B: VEHICLES OUT IN TRAFFIC (SEND TO THIS DEPOT)           */}
          {/* ================================================================= */}
          {vehiclesOutsideDepot.length > 0 && (
            <div className="ttd-panel p-2 space-y-1.5">
              <button
                type="button"
                onClick={() => setShowRunningSection((s) => !s)}
                className="w-full flex items-center justify-between text-left"
              >
                <span className="font-bold text-amber-200 text-[11px] flex items-center gap-1">
                  {showRunningSection ? (
                    <ChevronDown className="w-3.5 h-3.5 text-amber-300" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-amber-300" />
                  )}
                  <span>
                    Ute i trafikk ({vehiclesOutsideDepot.length}) — Send inn til
                    dette depoet for vognbytte / ombygging
                  </span>
                </span>
              </button>

              {showRunningSection && (
                <div className="ttd-inset divide-y divide-slate-800/80 max-h-32 overflow-y-auto">
                  {vehiclesOutsideDepot.map((v) => {
                    const isHeadingHere =
                      v.goingToDepot &&
                      v.goingToDepot.x === effectiveDepot.x &&
                      v.goingToDepot.y === effectiveDepot.y;

                    return (
                      <div
                        key={v.id}
                        className="px-2 py-1 flex flex-wrap items-center justify-between gap-1.5 text-[10px]"
                      >
                        <div
                          onClick={() => {
                            onSelectVehicle(v.id);
                            onOpenVehicleDetail(v.id);
                          }}
                          className="flex items-center gap-1.5 min-w-0 cursor-pointer hover:underline"
                        >
                          {v.network === 'RAIL' ? (
                            <LocoSprite
                              modelId={v.modelId}
                              companyColor={playerColor}
                              size="xs"
                            />
                          ) : (
                            <RoadVehicleSprite
                              modelId={v.modelId}
                              cargoType={v.cargoType}
                              companyColor={playerColor}
                              size="xs"
                            />
                          )}
                          <span className="font-bold text-amber-100 truncate">
                            {v.name}
                          </span>
                          <span className="text-slate-400">
                            ({VEHICLE_STATE_LABELS_NO[v.state]})
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {!isHeadingHere && (
                            <button
                              type="button"
                              onClick={() => handleRecallToThisDepot(v, false)}
                              className="ttd-btn ttd-btn-teal !px-1.5 !py-0.5 !text-[10px]"
                            >
                              <Warehouse className="w-3 h-3 text-amber-200" />
                              <span>Send til dette depoet</span>
                            </button>
                          )}
                          {(Boolean(v.goingToDepot) ||
                            v.state === 'STOPPED' ||
                            v.state === 'IN_DEPOT') && (
                            <button
                              type="button"
                              onClick={() => handleRecallToThisDepot(v, true)}
                              title="Flytt direkte inn i dette depoet nå"
                              className="ttd-btn ttd-btn-brass !px-1.5 !py-0.5 !text-[10px]"
                            >
                              <Zap className="w-3 h-3" />
                              <span>Flytt rett inn nå</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* SECTION C: BUY IN DEPOT (SEPARATE LOCOMOTIVES VS WAGONS!)         */}
          {/* ================================================================= */}
          {effectiveDepot.depotType === 'RAIL' ? (
            <div className="ttd-panel p-2 space-y-2">
              {/* Two Strictly Separated Rail Shop Sub-Tabs */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setRailShopTab('locos')}
                  className={`ttd-btn flex-1 !py-1.5 ${
                    railShopTab === 'locos' ? 'ttd-btn-active' : ''
                  }`}
                >
                  <TrainFront className="w-3.5 h-3.5 text-sky-300" />
                  <span>1. Kjøp Lokomotiv (Uten vogner)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRailShopTab('wagons')}
                  className={`ttd-btn flex-1 !py-1.5 ${
                    railShopTab === 'wagons' ? 'ttd-btn-active' : ''
                  }`}
                >
                  <ShoppingCart className="w-3.5 h-3.5 text-amber-300" />
                  <span>2. Kjøp Jernbanevogner (7 typer)</span>
                </button>
              </div>

              {railShopTab === 'locos' ? (
                <div className="space-y-1.5">
                  <div className="text-[10px] text-slate-300">
                    Lokomotiver kjøpes <strong>uten vogner</strong> slik at du
                    aldri kjøper feil vogntype — velg deretter akkurat de
                    vognene du trenger i fane 2!
                  </div>
                  <div className="space-y-1.5">
                    {railLocomotivesCatalog.map((loco) => {
                      const monthlyCost = Math.round(
                        loco.annualRunningCost / 12
                      );
                      return (
                        <div
                          key={loco.id}
                          className="ttd-inset p-2 flex flex-wrap items-center justify-between gap-2 bg-slate-950/75 hover:bg-slate-900/80"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="px-1.5 py-1 bg-slate-900 border border-slate-700 shrink-0">
                              <LocoSprite
                                modelId={loco.id}
                                companyColor={playerColor}
                                size="lg"
                              />
                            </div>
                            <div className="min-w-0 space-y-0.5">
                              <div className="font-bold text-amber-100 text-xs">
                                {loco.nameNo}
                              </div>
                              <div className="text-[10px] text-slate-400 leading-snug">
                                {loco.description}
                              </div>
                              <div className="text-[10px] text-sky-300 ttd-num font-semibold">
                                Maksfart {loco.maxSpeedKmh} km/t • Drift ca.{' '}
                                {formatKr(monthlyCost)}/mnd
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              handleBuyBareLocomotive(
                                loco.id as
                                  | 'LOCO_STEAM'
                                  | 'LOCO_DIESEL'
                                  | 'LOCO_ELECTRIC'
                              )
                            }
                            className="ttd-btn ttd-btn-green !px-3 !py-2 shrink-0 ttd-num"
                          >
                            <ShoppingCart className="w-3.5 h-3.5" />
                            <span>Kjøp — {formatKr(loco.price)}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* SUB-TAB 2: 7 SPECIALIZED RAIL WAGONS */
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-300">
                    <span>
                      {selectedVehicleInDepot ? (
                        <>
                          Kobler nye vogner til:{' '}
                          <strong className="text-amber-200">
                            {selectedVehicleInDepot.name}
                          </strong>{' '}
                          (eller dra vognkort rett opp på ønsket spor!)
                        </>
                      ) : (
                        <>
                          Ingen tog i depoet valgt — kjøpte vogner legges på{' '}
                          <strong className="text-amber-200">sidesporet</strong>{' '}
                          klare til påkobling.
                        </>
                      )}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 max-h-64 overflow-y-auto pr-0.5">
                    {RAIL_WAGON_CATALOG_LIST.map((wSpec) => {
                      const monthlyCost = Math.round(
                        wSpec.annualRunningCost / 12
                      );
                      return (
                        <div
                          key={wSpec.cargoType}
                          draggable
                          onDragStart={(e) =>
                            beginDrag(e, {
                              kind: 'SHOP_WAGON',
                              cargoType: wSpec.cargoType,
                            })
                          }
                          onDragEnd={endDrag}
                          className="ttd-inset p-1.5 flex flex-wrap items-center justify-between gap-2 bg-slate-950/75 hover:bg-slate-900/80 cursor-grab active:cursor-grabbing"
                          title="Dra vognkortet opp på et togspor over, eller klikk Kjøp!"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 shrink-0">
                              <RailWagonSprite
                                cargoType={wSpec.cargoType}
                                companyColor={playerColor}
                                size="md"
                                previewLoaded
                              />
                            </div>
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{
                                    backgroundColor:
                                      CARGO_COLORS[wSpec.cargoType],
                                  }}
                                />
                                <span className="font-bold text-amber-100 text-[11px]">
                                  {wSpec.nameNo}
                                </span>
                                <span className="text-[10px] text-sky-300 font-semibold ttd-num">
                                  ({wSpec.capacity}{' '}
                                  {CARGO_UNITS_NO[wSpec.cargoType]})
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-400 leading-tight">
                                {wSpec.descriptionNo} • Drift{' '}
                                {formatKr(monthlyCost)}/mnd
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0 ttd-num">
                            {selectedVehicleInDepot ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleBuyRailWagonClick(
                                      wSpec.cargoType,
                                      selectedVehicleInDepot.id
                                    )
                                  }
                                  className="ttd-btn ttd-btn-green !px-2.5 !py-1.5 !text-[10px]"
                                  title={`Kjøp og koble direkte på ${selectedVehicleInDepot.name}`}
                                >
                                  <Plus className="w-3 h-3" />
                                  <span>
                                    Kjøp & koble ({formatKr(wSpec.price)})
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleBuyRailWagonClick(
                                      wSpec.cargoType,
                                      null
                                    )
                                  }
                                  className="ttd-btn !px-1.5 !py-1.5 !text-[10px]"
                                  title="Kjøp vogn og plasser på sidesporet i depoet"
                                >
                                  + Sidespor
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  handleBuyRailWagonClick(wSpec.cargoType, null)
                                }
                                className="ttd-btn ttd-btn-green !px-2.5 !py-1.5 !text-[10px]"
                              >
                                <Plus className="w-3 h-3" />
                                <span>
                                  Kjøp til sidespor — {formatKr(wSpec.price)}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ROAD VEHICLE SHOP (7 DEDICATED BUS & CARGO TRUCKS) */
            <div className="ttd-panel p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-200 text-xs flex items-center gap-1.5">
                  <ShoppingCart className="w-3.5 h-3.5 text-amber-300" />
                  <span>Kjøp buss eller spesial-lastebil (7 typer)</span>
                </span>
              </div>

              <div className="grid grid-cols-1 gap-1.5 max-h-64 overflow-y-auto pr-0.5">
                {ROAD_VEHICLE_SHOP_LIST.map((spec) => {
                  const monthlyCost = Math.round(spec.annualRunningCost / 12);
                  return (
                    <div
                      key={spec.shopId}
                      className="ttd-inset p-1.5 flex flex-wrap items-center justify-between gap-2 bg-slate-950/75 hover:bg-slate-900/80"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 shrink-0">
                          <RoadVehicleSprite
                            modelId={spec.modelId}
                            cargoType={spec.cargoType}
                            companyColor={playerColor}
                            size="md"
                            previewLoaded
                          />
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{
                                backgroundColor: CARGO_COLORS[spec.cargoType],
                              }}
                            />
                            <span className="font-bold text-amber-100 text-[11px]">
                              {spec.nameNo}
                            </span>
                            <span className="text-[10px] text-sky-300 font-semibold ttd-num">
                              ({formatNumber(spec.capacity)}{' '}
                              {CARGO_UNITS_NO[spec.cargoType]} •{' '}
                              {spec.maxSpeedKmh} km/t)
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 leading-tight">
                            {spec.descriptionNo} • Drift {formatKr(monthlyCost)}
                            /mnd
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          handleBuyRoadShopItem(spec.shopId, spec.nameNo)
                        }
                        className="ttd-btn ttd-btn-green !px-2.5 !py-1.5 !text-[10px] shrink-0 ttd-num"
                      >
                        <ShoppingCart className="w-3 h-3" />
                        <span>Kjøp — {formatKr(spec.price)}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </TTDWindow>
  );
};
