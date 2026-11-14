import React from 'react';
import {
  Warehouse,
  Crosshair,
  TrainFront,
  Truck,
  Package,
  CheckCircle2,
  Users,
  Info,
  Grid3x3,
  AlertTriangle,
} from 'lucide-react';
import type { CargoType, GameState, StationKind } from '../../types/game';
import {
  getEffectiveStationPlatformLength,
  getEffectiveStationTracks,
  getTrainRequiredPlatformTiles,
  MAX_TRAIN_WAGONS,
  RAIL_STATION_CATCHMENT_RADIUS,
  ROAD_STATION_CATCHMENT_RADIUS,
  type GameEngine,
} from '../../core';
import {
  CARGO_COLORS,
  CARGO_LABELS_NO,
  CARGO_UNITS_NO,
  formatNumber,
  STATION_KIND_LABELS_NO,
  VEHICLE_STATE_LABELS_NO,
} from '../formatters';
import { resolveTrainWagonsList } from '../VehicleSprites';
import { TTDWindow } from '../TTDWindow';

export interface StationDetailWindowProps {
  engine: GameEngine;
  state: GameState;
  stationId: string;
  showCatchmentGrid: boolean;
  zIndex: number;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onToggleCatchmentGrid: () => void;
  onFocusTile: (x: number, y: number) => void;
  onInspectVehicle: (vehicleId: string) => void;
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

function getRatingTierLabel(pct: number): {
  label: string;
  textColor: string;
  barColor: string;
} {
  if (pct >= 80) {
    return {
      label: 'Utmerket',
      textColor: 'text-emerald-300',
      barColor: '#22c55e',
    };
  }
  if (pct >= 65) {
    return {
      label: 'God',
      textColor: 'text-lime-300',
      barColor: '#84cc16',
    };
  }
  if (pct >= 45) {
    return {
      label: 'Middels',
      textColor: 'text-amber-300',
      barColor: '#eab308',
    };
  }
  if (pct >= 25) {
    return {
      label: 'Lav',
      textColor: 'text-orange-300',
      barColor: '#f97316',
    };
  }
  return {
    label: 'Svært lav',
    textColor: 'text-rose-300',
    barColor: '#ef4444',
  };
}

function formatShareHeadline(
  cargo: CargoType,
  pct: number,
  kind: StationKind
): string {
  const { label } = getRatingTierLabel(pct);
  const stationWord =
    kind === 'BUS_STOP'
      ? 'holdeplassen'
      : kind === 'TRUCK_BAY'
      ? 'terminalen'
      : 'stasjonen';

  if (cargo === 'PASSENGERS') {
    return `${label} — ${pct} % av passasjerene i området bruker denne ${stationWord}`;
  }
  if (cargo === 'MAIL') {
    return `${label} — ${pct} % av posten i området sendes via denne ${stationWord}`;
  }
  return `${label} — ${pct} % av ${CARGO_LABELS_NO[cargo].toLowerCase()} fra området sendes via denne ${stationWord}`;
}

function formatRatingReason(
  waiting: number,
  daysSincePickup: number,
  hqBonusPct: number
): string {
  if (waiting > 60) {
    return 'Lang kø på perrongen trekker ned prosenten — sett inn flere kjøretøy!';
  }
  if (daysSincePickup > 20) {
    return `Lenge siden forrige kjøretøy var innom (${daysSincePickup} dager siden).`;
  }
  return `Jevn trafikk (sist hentet for ${daysSincePickup} ${
    daysSincePickup === 1 ? 'dag' : 'dager'
  } siden)${hqBonusPct > 0 ? ` • HQ-bonus +${hqBonusPct} %` : ''}.`;
}

export const StationDetailWindow: React.FC<StationDetailWindowProps> = ({
  engine,
  state: _state,
  stationId,
  showCatchmentGrid,
  zIndex,
  onFocus,
  onClose,
  onToggleCatchmentGrid,
  onFocusTile,
  onInspectVehicle,
}) => {
  const details = engine.getStationDetails(stationId);

  if (!details) {
    return (
      <TTDWindow
        id="station_detail"
        title="Stasjonsdetaljer"
        icon={<Warehouse className="w-3.5 h-3.5" />}
        theme="slate"
        defaultX={180}
        defaultY={56}
        width={480}
        zIndex={zIndex}
        onFocus={onFocus}
        onClose={onClose}
      >
        <div className="ttd-inset p-4 text-center text-slate-400">
          Denne stasjonen finnes ikke lenger (revet eller slettet).
        </div>
      </TTDWindow>
    );
  }

  const {
    station,
    ownerName,
    ownerColor,
    isPlayerOwned,
    suppliedCargos,
    acceptedCargos,
    servicingVehicles,
    hqBonusPct,
  } = details;

  const isRailStation = station.kind === 'TRAIN_STATION';
  const stationTracks = getEffectiveStationTracks(station);
  const platformLen = getEffectiveStationPlatformLength(station);
  const orientationLabel =
    (station.orientation ?? 'X') === 'Y' ? 'Retning NV–SØ' : 'Retning NØ–SV';
  const maxPenaltyFreeWagons = Math.min(MAX_TRAIN_WAGONS, platformLen * 2 - 1);
  const catchmentRadius = isRailStation
    ? RAIL_STATION_CATCHMENT_RADIUS
    : ROAD_STATION_CATCHMENT_RADIUS;

  // Detect any routed trains that exceed this station's platformLength
  const oversizedTrains = isRailStation
    ? servicingVehicles
        .filter((v) => v.network === 'RAIL')
        .map((v) => {
          const wagonCount = resolveTrainWagonsList(v).length;
          const requiredTiles = getTrainRequiredPlatformTiles(wagonCount);
          return {
            vehicle: v,
            wagonCount,
            requiredTiles,
            overhang: Math.max(0, requiredTiles - platformLen),
          };
        })
        .filter((item) => item.overhang > 0)
    : [];

  // Show ONLY cargos with waiting > 0 or in suppliedCargos (never spam 0 tonn irrelevant cargos!)
  const visibleWaitingCargos = ALL_CARGOS.filter(
    (c) =>
      suppliedCargos.includes(c) || Math.round(station.waitingCargo[c] ?? 0) > 0
  );

  return (
    <TTDWindow
      id="station_detail"
      title={`${station.name} — ${STATION_KIND_LABELS_NO[station.kind]}`}
      subtitle={isPlayerOwned ? ownerName : `${ownerName} (Konkurrent)`}
      icon={<Warehouse className="w-3.5 h-3.5" />}
      theme={isPlayerOwned ? 'teal' : 'purple'}
      defaultX={185}
      defaultY={54}
      width={520}
      zIndex={zIndex}
      onFocus={onFocus}
      onClose={onClose}
    >
      {/* Top Company Owner + Layout Badge + Catchment Grid Toggle */}
      <div className="ttd-panel p-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
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
                {isPlayerOwned ? (
                  <span className="px-1.5 py-0.2 bg-emerald-950/90 border border-emerald-600/70 text-emerald-300 text-[10px] font-bold">
                    Ditt selskap
                  </span>
                ) : (
                  <span className="px-1.5 py-0.2 bg-purple-950/90 border border-purple-500/70 text-purple-200 text-[10px] font-bold">
                    Konkurrent
                  </span>
                )}
              </div>
              <div className="text-[10px] text-slate-300 ttd-num">
                {isRailStation ? (
                  <>
                    <strong className="text-sky-300">
                      {stationTracks} spor × {platformLen}{' '}
                      {platformLen === 1 ? 'rute' : 'ruter'}
                    </strong>{' '}
                    • {orientationLabel} • Maks uten tidsstraff:{' '}
                    <strong className="text-emerald-300">
                      opptil {maxPenaltyFreeWagons}{' '}
                      {maxPenaltyFreeWagons === 1 ? 'vogn' : 'vogner'}
                    </strong>
                  </>
                ) : (
                  <>
                    {STATION_KIND_LABELS_NO[station.kind]} • Posisjon (
                    {station.x}, {station.y}) • Nedslagsfelt {catchmentRadius}{' '}
                    ruter
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onFocusTile(station.x, station.y)}
            className="ttd-btn !px-2.5 !py-1 shrink-0"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Sentrer kamera</span>
          </button>
        </div>

        {/* Prominent OpenTTD Catchment Area Grid Toggle */}
        <button
          type="button"
          onClick={onToggleCatchmentGrid}
          className={`ttd-btn w-full !py-1.5 !justify-between ${
            showCatchmentGrid ? 'ttd-btn-active' : 'ttd-btn-teal'
          }`}
          title="Vis eller skjul det blå nedslagsfelt-gridet rundt stasjonen på 3D-kartet"
        >
          <span className="flex items-center gap-1.5">
            <Grid3x3 className="w-3.5 h-3.5 text-sky-300" />
            <span>
              Nedslagsfelt-grid på kartet ({catchmentRadius} ruter rundt stasjonen):
            </span>
          </span>
          <strong
            className={
              showCatchmentGrid ? 'text-amber-200' : 'text-slate-300'
            }
          >
            {showCatchmentGrid ? 'PÅ (Vises i blått)' : 'AV'}
          </strong>
        </button>
      </div>

      {/* Amber Warning Banner if any routed train exceeds platformLength */}
      {oversizedTrains.length > 0 && (
        <div className="ttd-inset p-2 bg-amber-950/60 border border-amber-500/70 space-y-1">
          {oversizedTrains.map(({ vehicle, requiredTiles }) => (
            <div
              key={vehicle.id}
              onClick={() => onInspectVehicle(vehicle.id)}
              className="flex items-start gap-1.5 text-[11px] text-amber-200 cursor-pointer hover:underline"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span>
                <strong>{vehicle.name}</strong> krever{' '}
                <strong>{requiredTiles} ruter</strong>, men plattformen er{' '}
                <strong>
                  {platformLen} {platformLen === 1 ? 'rute' : 'ruter'}
                </strong>{' '}
                — gir tidsstraff ved av- og pålasting!
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Section 1: Waiting Cargo & Accepted Deliveries */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* Ventende på stasjonen */}
        <div className="ttd-panel p-2 space-y-1.5">
          <div className="font-bold text-amber-200 text-[11px] flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-amber-300" />
            <span>Ventende på stasjonen</span>
          </div>

          <div className="ttd-inset p-2 space-y-1 min-h-[54px] flex flex-col justify-center">
            {visibleWaitingCargos.length === 0 ? (
              <div className="text-[11px] text-slate-400">
                Ingen lokal produksjon her (kun avleveringsstasjon)
              </div>
            ) : (
              visibleWaitingCargos.map((cargo) => {
                const count = Math.round(station.waitingCargo[cargo] ?? 0);
                return (
                  <div
                    key={cargo}
                    className="flex items-center justify-between gap-2 text-[11px] ttd-num"
                  >
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
                      <span
                        className="w-2.5 h-2.5 inline-block shrink-0"
                        style={{ backgroundColor: CARGO_COLORS[cargo] }}
                      />
                      <span>{CARGO_LABELS_NO[cargo]}:</span>
                    </span>
                    <strong className="ttd-gold">
                      {formatNumber(count)} {CARGO_UNITS_NO[cargo]} venter
                    </strong>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Tar imot leveranser */}
        <div className="ttd-panel p-2 space-y-1.5">
          <div className="font-bold text-emerald-300 text-[11px] flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Tar imot leveranser (Betaler her)</span>
          </div>

          <div className="ttd-inset p-2 space-y-1 min-h-[54px] flex flex-col justify-center">
            {acceptedCargos.length === 0 ? (
              <div className="text-[11px] text-slate-400">
                Tar ikke imot leveranser — kun opplasting
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {acceptedCargos.map(({ cargo, sourceName }, idx) => (
                  <span
                    key={`${cargo}-${sourceName}-${idx}`}
                    className="px-1.5 py-0.5 bg-emerald-950/50 border border-emerald-700/60 text-emerald-200 text-[11px] inline-flex items-center gap-1 font-semibold"
                  >
                    <span
                      className="w-2 h-2 inline-block shrink-0"
                      style={{ backgroundColor: CARGO_COLORS[cargo] }}
                    />
                    <span>
                      {CARGO_LABELS_NO[cargo]} ({sourceName})
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Self-Explanatory Customer Share / Service Rating (ONLY for suppliedCargos!) */}
      {suppliedCargos.length > 0 && (
        <div className="ttd-panel p-2 space-y-2">
          <div className="font-bold text-amber-200 text-[11px] flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-sky-300" />
            <span>Kundetilfredshet & Markedsandel</span>
          </div>

          <div className="space-y-2">
            {suppliedCargos.map((cargo) => {
              const pct = Math.round(station.ratings[cargo] ?? 0);
              const waiting = Math.round(station.waitingCargo[cargo] ?? 0);
              const tier = getRatingTierLabel(pct);
              const headline = formatShareHeadline(cargo, pct, station.kind);
              const reason = formatRatingReason(
                waiting,
                station.daysSincePickup,
                isPlayerOwned ? hqBonusPct : 0
              );

              return (
                <div key={cargo} className="ttd-inset p-2 space-y-1 ttd-num">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-amber-100 text-[11px] inline-flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 inline-block shrink-0"
                        style={{ backgroundColor: CARGO_COLORS[cargo] }}
                      />
                      <span>{CARGO_LABELS_NO[cargo]}</span>
                    </span>
                    <span className={`font-bold text-[11px] ${tier.textColor}`}>
                      {headline}
                    </span>
                  </div>

                  {/* Classic TTD Progress Bar */}
                  <div className="h-3 bg-black/60 border border-slate-700 p-0.5 overflow-hidden">
                    <div
                      className="h-full transition-all duration-200"
                      style={{
                        width: `${Math.max(2, Math.min(100, pct))}%`,
                        backgroundColor: tier.barColor,
                      }}
                    />
                  </div>

                  {/* Live Diagnostic Reason */}
                  <div className="text-[10px] text-slate-300">{reason}</div>
                </div>
              );
            })}
          </div>

          <div className="ttd-inset p-1.5 text-[10px] text-slate-300 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
            <span>
              <strong className="text-amber-200">Forklaring:</strong> Prosenten
              viser hvor stor andel av lokal produksjon/passasjerer som velger
              denne stasjonen. Hyppige hentinger og korte køer gir høyere prosent
              og mer last!
            </span>
          </div>
        </div>
      )}

      {/* Section 3: Servicing Vehicles List */}
      <div className="ttd-panel p-2 space-y-1.5">
        <div className="font-bold text-amber-200 text-[11px] flex items-center justify-between">
          <span>Kjøretøy på denne ruten ({servicingVehicles.length})</span>
          {servicingVehicles.length > 0 && (
            <span className="text-[10px] text-slate-300 font-normal">
              Klikk for å inspisere
            </span>
          )}
        </div>

        {servicingVehicles.length === 0 ? (
          <div className="ttd-inset p-2.5 text-center text-slate-400 text-[11px]">
            Ingen kjøretøy har denne stasjonen i kjøreordren sin ennå.
          </div>
        ) : (
          <div className="ttd-inset divide-y divide-slate-800 max-h-36 overflow-y-auto">
            {servicingVehicles.map((v) => {
              const reqTiles =
                v.network === 'RAIL'
                  ? getTrainRequiredPlatformTiles(
                      resolveTrainWagonsList(v).length
                    )
                  : 1;
              const isTooLong = isRailStation && reqTiles > platformLen;

              return (
                <div
                  key={v.id}
                  onClick={() => onInspectVehicle(v.id)}
                  className="px-2 py-1.5 flex items-center justify-between gap-2 hover:bg-slate-800/70 cursor-pointer text-[11px] ttd-num"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {v.network === 'RAIL' ? (
                      <TrainFront className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                    ) : (
                      <Truck className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    )}
                    <span className="font-bold text-amber-100 truncate">
                      {v.name}
                    </span>
                    {isTooLong && (
                      <span
                        title={`Krever ${reqTiles} ruter, plattform er ${platformLen} ruter`}
                        className="px-1 py-0.2 bg-amber-950 border border-amber-500/70 text-amber-300 text-[9px] font-bold shrink-0"
                      >
                        ⚠️ {reqTiles} ruter
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-slate-300">
                      {formatNumber(v.cargoAmount)}/{formatNumber(v.capacity)}{' '}
                      {CARGO_UNITS_NO[v.cargoType]}{' '}
                      {CARGO_LABELS_NO[v.cargoType]}
                    </span>
                    <span className="text-emerald-300 font-semibold">
                      {VEHICLE_STATE_LABELS_NO[v.state]}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </TTDWindow>
  );
};
