import React from 'react';
import type { CargoType, TrainWagon, VehicleModelId } from '../types/game';
import { CARGO_COLORS } from './formatters';

export type SpriteScale = 'xs' | 'sm' | 'md' | 'lg';

const LOCO_DIMS: Record<SpriteScale, { w: number; h: number }> = {
  xs: { w: 40, h: 18 },
  sm: { w: 54, h: 24 },
  md: { w: 72, h: 32 },
  lg: { w: 92, h: 40 },
};

const WAGON_DIMS: Record<SpriteScale, { w: number; h: number }> = {
  xs: { w: 30, h: 18 },
  sm: { w: 42, h: 24 },
  md: { w: 56, h: 32 },
  lg: { w: 70, h: 38 },
};

const ROAD_DIMS: Record<SpriteScale, { w: number; h: number }> = {
  xs: { w: 36, h: 18 },
  sm: { w: 48, h: 24 },
  md: { w: 64, h: 32 },
  lg: { w: 80, h: 38 },
};

export interface LocoSpriteProps {
  modelId: VehicleModelId;
  companyColor?: string;
  size?: SpriteScale;
  className?: string;
}

/**
 * Crisp OpenTTD Side-Profile Locomotive SVG Sprite (facing left like classic TTD depot!)
 */
export const LocoSprite: React.FC<LocoSpriteProps> = ({
  modelId,
  companyColor = '#2563eb',
  size = 'md',
  className = '',
}) => {
  const { w, h } = LOCO_DIMS[size];

  if (modelId === 'LOCO_STEAM') {
    return (
      <svg
        width={w}
        height={h}
        viewBox="0 0 84 36"
        className={`shrink-0 select-none ${className}`}
        aria-label="Damplokomotiv"
      >
        {/* Rail shadow */}
        <line x1="2" y1="34" x2="82" y2="34" stroke="#475569" strokeWidth="1.5" />

        {/* Subtle steam puffs */}
        <circle cx="17" cy="5" r="2.8" fill="#cbd5e1" fillOpacity="0.65" />
        <circle cx="23" cy="4" r="3.4" fill="#e2e8f0" fillOpacity="0.5" />
        <circle cx="30" cy="4.5" r="2.6" fill="#cbd5e1" fillOpacity="0.35" />

        {/* Cowcatcher (left front) */}
        <polygon points="3,31 10,25 10,31" fill="#dc2626" />

        {/* Cylindrical black boiler + smokebox */}
        <rect x="9" y="13" width="37" height="13" rx="2" fill="#1e293b" stroke="#0f172a" strokeWidth="0.8" />
        <rect x="9" y="13" width="8" height="13" rx="1" fill="#0f172a" />
        {/* Brass boiler bands & steam dome */}
        <line x1="23" y1="13" x2="23" y2="26" stroke="#eab308" strokeWidth="1.2" />
        <line x1="35" y1="13" x2="35" y2="26" stroke="#eab308" strokeWidth="1.2" />
        <path d="M27,13 Q30,8 33,13 Z" fill="#ca8a04" />
        {/* Smokestack */}
        <rect x="13" y="7" width="4.5" height="6.5" fill="#0f172a" />
        <rect x="12" y="6.5" width="6.5" height="1.8" fill="#334155" />
        {/* Warm headlight */}
        <circle cx="9" cy="17" r="1.8" fill="#fef08a" />

        {/* Cab (company color) */}
        <rect x="44" y="9" width="14" height="17" fill={companyColor} stroke="#0f172a" strokeWidth="0.8" />
        <rect x="42" y="8" width="17" height="2.2" fill="#334155" />
        <rect x="47" y="12" width="7" height="5.5" fill="#bae6fd" />

        {/* Coupled Coal Tender */}
        <rect x="60" y="14" width="20" height="12" fill={companyColor} stroke="#0f172a" strokeWidth="0.8" />
        <polygon points="61,14 65,10 78,10 79,14" fill="#0f172a" />
        <rect x="58" y="22" width="3" height="2" fill="#475569" />

        {/* Red running board */}
        <rect x="8" y="25.5" width="73" height="2.2" fill="#dc2626" />

        {/* Spoked driving wheels + silver connecting rod */}
        {[18, 29, 40].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="30.2" r="3.8" fill="#7f1d1d" stroke="#cbd5e1" strokeWidth="1.1" />
            <circle cx={cx} cy="30.2" r="1.2" fill="#e2e8f0" />
          </g>
        ))}
        <line x1="16" y1="30.5" x2="42" y2="30.5" stroke="#e2e8f0" strokeWidth="1.5" />

        {/* Tender bogie wheels */}
        {[65, 74].map((cx) => (
          <circle key={cx} cx={cx} cy="30.8" r="2.8" fill="#334155" stroke="#94a3b8" strokeWidth="1" />
        ))}
      </svg>
    );
  }

  if (modelId === 'LOCO_DIESEL') {
    return (
      <svg
        width={w}
        height={h}
        viewBox="0 0 84 36"
        className={`shrink-0 select-none ${className}`}
        aria-label="Diesellokomotiv"
      >
        <line x1="2" y1="34" x2="82" y2="34" stroke="#475569" strokeWidth="1.5" />

        {/* Heavy dark underframe & fuel tank */}
        <rect x="8" y="25" width="68" height="4" fill="#1e293b" />
        <rect x="33" y="26.5" width="18" height="4" rx="1" fill="#0f172a" />

        {/* Classic NSB Di 3 Nohab rounded-nose body */}
        <path
          d="M6,25 L6,18 Q6,10 15,10 L69,10 Q78,10 78,18 L78,25 Z"
          fill={companyColor}
          stroke="#0f172a"
          strokeWidth="0.9"
        />
        {/* Metallic roof */}
        <path d="M13,10 Q42,7.5 71,10 Z" fill="#94a3b8" />
        {/* Roof exhaust ports */}
        <rect x="35" y="7.5" width="4" height="2" fill="#1e293b" />
        <rect x="45" y="7.5" width="4" height="2" fill="#1e293b" />

        {/* Classic TTD / NSB cream-gold winged side stripe */}
        <rect x="6.5" y="19" width="71" height="2.6" fill="#fde68a" />
        <polygon points="6,21.5 14,19 14,23.5" fill="#f59e0b" />

        {/* Cab windshields (front & rear) */}
        <polygon points="9,16.5 14,12 19,12 19,16.5" fill="#bae6fd" stroke="#0f172a" strokeWidth="0.6" />
        <polygon points="75,16.5 70,12 65,12 65,16.5" fill="#bae6fd" stroke="#0f172a" strokeWidth="0.6" />

        {/* Side engine room porthole grilles */}
        {[26, 36, 48, 58].map((gx) => (
          <rect key={gx} x={gx - 2.5} y="13" width="5" height="4" rx="1" fill="#1e293b" stroke="#cbd5e1" strokeWidth="0.5" />
        ))}

        {/* Nose headlight */}
        <circle cx="7" cy="21" r="1.6" fill="#fef08a" />
        {/* Rear coupler */}
        <rect x="78" y="25.5" width="4" height="2" fill="#64748b" />

        {/* Twin 3-axle Co-Co bogies */}
        {[14, 21, 28, 56, 63, 70].map((cx) => (
          <circle key={cx} cx={cx} cy="30.8" r="2.8" fill="#334155" stroke="#cbd5e1" strokeWidth="0.9" />
        ))}
      </svg>
    );
  }

  // LOCO_ELECTRIC: Modern sleek NSB El 18 / EuroSprinter with rooftop pantograph
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 84 36"
      className={`shrink-0 select-none ${className}`}
      aria-label="Elektrisk lokomotiv"
    >
      <line x1="2" y1="34" x2="82" y2="34" stroke="#475569" strokeWidth="1.5" />

      {/* Overhead diamond pantograph */}
      <line x1="52" y1="10" x2="58" y2="4.5" stroke="#ef4444" strokeWidth="1.3" />
      <line x1="58" y1="4.5" x2="50" y2="2.5" stroke="#e2e8f0" strokeWidth="1.2" />
      <line x1="46" y1="2.5" x2="55" y2="2.5" stroke="#cbd5e1" strokeWidth="1.5" />
      {/* Front folded pantograph */}
      <line x1="22" y1="9" x2="31" y2="9" stroke="#ef4444" strokeWidth="1.3" />

      {/* Underframe & transformer */}
      <rect x="10" y="25.5" width="64" height="3.8" fill="#1e293b" />
      <rect x="34" y="26.5" width="16" height="3.8" fill="#334155" />

      {/* Aerodynamic angled body */}
      <polygon
        points="5,25.5 12,10.5 72,10.5 79,25.5"
        fill={companyColor}
        stroke="#0f172a"
        strokeWidth="0.9"
      />
      {/* Crisp white/silver express cheatline */}
      <polygon points="7,21.5 9,18.5 75,18.5 77,21.5" fill="#f8fafc" />
      <line x1="8" y1="22.2" x2="76" y2="22.2" stroke="#38bdf8" strokeWidth="1.1" />

      {/* Tinted express cab windshields */}
      <polygon points="8.5,18 12.5,12 18.5,12 18.5,18" fill="#38bdf8" stroke="#0f172a" strokeWidth="0.6" />
      <polygon points="75.5,18 71.5,12 65.5,12 65.5,18" fill="#38bdf8" stroke="#0f172a" strokeWidth="0.6" />

      {/* Side louvres */}
      {[26, 38, 50].map((lx) => (
        <rect key={lx} x={lx} y="13" width="8" height="3.8" fill="#1e293b" opacity="0.75" />
      ))}

      {/* LED Headlight & rear coupler */}
      <circle cx="7" cy="23.5" r="1.5" fill="#e0f2fe" />
      <rect x="78" y="25.5" width="4" height="2" fill="#64748b" />

      {/* High-speed Bo-Bo bogies */}
      {[17, 26, 58, 67].map((cx) => (
        <circle key={cx} cx={cx} cy="30.8" r="2.9" fill="#1e293b" stroke="#cbd5e1" strokeWidth="1" />
      ))}
    </svg>
  );
};

export interface RailWagonSpriteProps {
  cargoType: CargoType;
  fillRatio?: number;
  companyColor?: string;
  size?: SpriteScale;
  previewLoaded?: boolean;
  className?: string;
}

/**
 * Crisp OpenTTD Side-Profile Rail Wagon SVG Sprite (7 specialized wagon types!)
 */
export const RailWagonSprite: React.FC<RailWagonSpriteProps> = ({
  cargoType,
  fillRatio = 0,
  companyColor = '#2563eb',
  size = 'md',
  previewLoaded = false,
  className = '',
}) => {
  const { w, h } = WAGON_DIMS[size];
  const load = previewLoaded ? 0.85 : Math.max(0, Math.min(1, fillRatio));

  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 64 36"
      className={`shrink-0 select-none ${className}`}
      aria-label={`Jernbanevogn ${cargoType}`}
    >
      {/* Rail line & couplers */}
      <line x1="0" y1="34" x2="64" y2="34" stroke="#475569" strokeWidth="1.5" />
      <rect x="0" y="25.5" width="4" height="2" fill="#64748b" />
      <rect x="60" y="25.5" width="4" height="2" fill="#64748b" />
      {/* Chassis frame */}
      <rect x="3" y="25" width="58" height="2.8" fill="#1e293b" />

      {/* Bogie wheels */}
      {[11, 18, 46, 53].map((cx) => (
        <circle key={cx} cx={cx} cy="30.8" r="2.6" fill="#334155" stroke="#94a3b8" strokeWidth="0.9" />
      ))}

      {cargoType === 'PASSENGERS' && (
        <g>
          <rect x="4" y="10.5" width="56" height="14.5" rx="1.5" fill={companyColor} stroke="#0f172a" strokeWidth="0.8" />
          <path d="M4,11.5 Q32,8.5 60,11.5 Z" fill="#cbd5e1" />
          <rect x="4.5" y="19.5" width="55" height="2" fill="#f8fafc" />
          {/* Warm illuminated passenger windows */}
          {[11, 19, 27, 35, 43, 51].map((wx) => (
            <rect
              key={wx}
              x={wx - 2.6}
              y="13"
              width="5.2"
              height="5"
              rx="0.6"
              fill={load > 0.05 ? '#fef08a' : '#7dd3fc'}
              stroke="#0f172a"
              strokeWidth="0.5"
            />
          ))}
        </g>
      )}

      {cargoType === 'MAIL' && (
        <g>
          <rect x="4" y="11" width="56" height="14" rx="1" fill="#b91c1c" stroke="#450a0a" strokeWidth="0.8" />
          <rect x="4" y="10" width="56" height="2.2" fill="#94a3b8" />
          {/* Posten gold band & sliding sorting doors */}
          <rect x="4.5" y="18" width="55" height="2.8" fill="#fbbf24" />
          <rect x="17" y="13" width="11" height="11" fill="#991b1b" stroke="#fde68a" strokeWidth="0.6" />
          <rect x="36" y="13" width="11" height="11" fill="#991b1b" stroke="#fde68a" strokeWidth="0.6" />
          <circle cx="32" cy="15.5" r="2" fill="#fde047" />
        </g>
      )}

      {cargoType === 'COAL' && (
        <g>
          {/* Coal heap above rim when loaded */}
          {load > 0.05 && (
            <polygon
              points={`7,14 16,${14 - load * 5.5} 32,${13 - load * 6} 48,${14 - load * 5.5} 57,14`}
              fill="#0f172a"
              stroke="#475569"
              strokeWidth="0.6"
            />
          )}
          {/* Open steel mineral hopper body */}
          <polygon points="5,13 59,13 56,25 8,25" fill="#334155" stroke="#0f172a" strokeWidth="0.8" />
          {[14, 23, 32, 41, 50].map((rx) => (
            <line key={rx} x1={rx} y1="13" x2={rx} y2="25" stroke="#64748b" strokeWidth="1.2" />
          ))}
          <rect x="5" y="12.5" width="54" height="1.6" fill="#94a3b8" />
        </g>
      )}

      {cargoType === 'WOOD' && (
        <g>
          {/* Flatbed deck */}
          <rect x="4" y="23" width="56" height="2.5" fill="#78350f" />
          {/* Stacked timber logs */}
          {load > 0.05 && (
            <g>
              <rect x="8" y="19" width="48" height="3.8" rx="1.5" fill="#92400e" stroke="#451a03" strokeWidth="0.6" />
              {load > 0.35 && (
                <rect x="9" y="15.2" width="46" height="3.8" rx="1.5" fill="#b45309" stroke="#451a03" strokeWidth="0.6" />
              )}
              {load > 0.65 && (
                <rect x="11" y="11.6" width="42" height="3.6" rx="1.5" fill="#d97706" stroke="#451a03" strokeWidth="0.6" />
              )}
            </g>
          )}
          {/* Vertical steel bolster stakes */}
          {[8, 20, 32, 44, 56].map((sx) => (
            <rect key={sx} x={sx - 1} y="10" width="2" height="15" fill="#cbd5e1" stroke="#1e293b" strokeWidth="0.4" />
          ))}
        </g>
      )}

      {cargoType === 'GOODS' && (
        <g>
          {/* Spine flatcar */}
          <rect x="4" y="23" width="56" height="2.4" fill={companyColor} />
          {/* ISO intermodal containers */}
          {load > 0.02 ? (
            <g>
              <rect x="6" y="11.5" width="25" height="11.5" fill="#0284c7" stroke="#0f172a" strokeWidth="0.7" />
              {[10, 14, 18, 22, 26].map((cx) => (
                <line key={cx} x1={cx} y1="12" x2={cx} y2="22.5" stroke="#38bdf8" strokeWidth="0.7" />
              ))}
              {load > 0.4 && (
                <>
                  <rect x="33" y="11.5" width="25" height="11.5" fill="#ea580c" stroke="#0f172a" strokeWidth="0.7" />
                  {[37, 41, 45, 49, 53].map((cx) => (
                    <line key={cx} x1={cx} y1="12" x2={cx} y2="22.5" stroke="#fdba74" strokeWidth="0.7" />
                  ))}
                </>
              )}
            </g>
          ) : (
            <rect x="6" y="21.5" width="52" height="1.8" fill="#475569" />
          )}
        </g>
      )}

      {cargoType === 'GRAIN' && (
        <g>
          {/* Covered ochre grain silo hopper */}
          <polygon points="8,11.5 56,11.5 59,21 54,25 10,25 5,21" fill="#ca8a04" stroke="#422006" strokeWidth="0.8" />
          <rect x="11" y="9.5" width="42" height="2" fill="#fde047" />
          {[18, 28, 36, 46].map((hx) => (
            <line key={hx} x1={hx} y1="11.5" x2={hx} y2="24.5" stroke="#854d0e" strokeWidth="1" />
          ))}
        </g>
      )}

      {cargoType === 'FOOD' && (
        <g>
          {/* White Thermo Reefer Van */}
          <rect x="4" y="10.5" width="56" height="14.5" rx="1" fill="#f8fafc" stroke="#334155" strokeWidth="0.8" />
          {/* Refrigeration unit on left end */}
          <rect x="4" y="11" width="5" height="13.5" fill="#cbd5e1" />
          {/* Cool blue Thermo stripe */}
          <rect x="9" y="16.5" width="50.5" height="3" fill="#0ea5e9" />
          {/* Double insulated doors */}
          <rect x="27" y="12" width="12" height="12" fill="none" stroke="#64748b" strokeWidth="0.8" />
          <line x1="33" y1="12" x2="33" y2="24" stroke="#64748b" strokeWidth="0.8" />
        </g>
      )}
    </svg>
  );
};

export interface RoadVehicleSpriteProps {
  modelId: 'BUS_CITY' | 'TRUCK_CARGO' | VehicleModelId;
  cargoType: CargoType;
  companyColor?: string;
  size?: SpriteScale;
  fillRatio?: number;
  previewLoaded?: boolean;
  className?: string;
}

/**
 * Crisp OpenTTD Side-Profile Bus & Specialized Cargo Truck SVG Sprite
 */
export const RoadVehicleSprite: React.FC<RoadVehicleSpriteProps> = ({
  modelId,
  cargoType,
  companyColor = '#2563eb',
  size = 'md',
  fillRatio = 0,
  previewLoaded = false,
  className = '',
}) => {
  const { w, h } = ROAD_DIMS[size];
  const load = previewLoaded ? 0.85 : Math.max(0, Math.min(1, fillRatio));

  if (modelId === 'BUS_CITY' || cargoType === 'PASSENGERS') {
    return (
      <svg
        width={w}
        height={h}
        viewBox="0 0 72 36"
        className={`shrink-0 select-none ${className}`}
        aria-label="Rutebuss"
      >
        <line x1="2" y1="34" x2="70" y2="34" stroke="#475569" strokeWidth="1.5" />
        {/* Bus body */}
        <rect x="5" y="10" width="62" height="19" rx="3" fill={companyColor} stroke="#0f172a" strokeWidth="0.9" />
        {/* White roof & upper band */}
        <rect x="6" y="10" width="60" height="4" rx="2" fill="#f8fafc" />
        {/* Destination display */}
        <rect x="6" y="11" width="9" height="2.6" fill="#0f172a" />
        <line x1="7" y1="12.3" x2="14" y2="12.3" stroke="#fbbf24" strokeWidth="1.2" />
        {/* Panoramic windows */}
        <polygon points="6,14.5 13,14.5 13,22 6,22" fill="#7dd3fc" />
        {[16, 26, 36, 46, 56].map((wx) => (
          <rect
            key={wx}
            x={wx}
            y="14.5"
            width="8"
            height="6.8"
            rx="0.8"
            fill={load > 0.05 ? '#fef08a' : '#bae6fd'}
            stroke="#0f172a"
            strokeWidth="0.5"
          />
        ))}
        {/* Trim stripe & headlights */}
        <rect x="5.5" y="23" width="61" height="2" fill="#fde68a" />
        <circle cx="6.2" cy="26" r="1.4" fill="#fef08a" />
        {/* Rubber tires */}
        <circle cx="19" cy="30" r="3.6" fill="#0f172a" stroke="#94a3b8" strokeWidth="1.2" />
        <circle cx="53" cy="30" r="3.6" fill="#0f172a" stroke="#94a3b8" strokeWidth="1.2" />
      </svg>
    );
  }

  // Specialized Cargo Trucks (facing left: cab on left, specialized cargo bed on right!)
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 72 36"
      className={`shrink-0 select-none ${className}`}
      aria-label={`Lastebil ${cargoType}`}
    >
      <line x1="2" y1="34" x2="70" y2="34" stroke="#475569" strokeWidth="1.5" />

      {/* Chassis */}
      <rect x="7" y="25.5" width="59" height="3" fill="#1e293b" />

      {/* Cab-over truck cab (left) */}
      <path
        d="M5,26 L5,15 Q5,11 10,11 L21,11 L21,26 Z"
        fill={cargoType === 'MAIL' ? '#dc2626' : companyColor}
        stroke="#0f172a"
        strokeWidth="0.9"
      />
      <polygon points="6.5,18.5 9,13 16,13 16,18.5" fill="#bae6fd" stroke="#0f172a" strokeWidth="0.5" />
      <rect x="5.5" y="21" width="15" height="1.8" fill="#fde68a" />
      <circle cx="6.2" cy="24" r="1.3" fill="#fef08a" />

      {/* Specialized Rear Bed by CargoType */}
      {cargoType === 'COAL' && (
        <g>
          {load > 0.05 && (
            <polygon points={`25,14 36,${14 - load * 4.5} 54,${14 - load * 4.5} 64,14`} fill="#0f172a" />
          )}
          <polygon points="23,13.5 66,13.5 64,25.5 23,25.5" fill="#475569" stroke="#0f172a" strokeWidth="0.8" />
          {[31, 40, 49, 58].map((rx) => (
            <line key={rx} x1={rx} y1="14" x2={rx} y2="25" stroke="#94a3b8" strokeWidth="1.1" />
          ))}
        </g>
      )}

      {cargoType === 'WOOD' && (
        <g>
          <rect x="23" y="23.5" width="43" height="2.2" fill="#78350f" />
          {load > 0.05 && (
            <>
              <rect x="25" y="19.5" width="39" height="3.8" rx="1.4" fill="#92400e" />
              {load > 0.4 && (
                <rect x="26" y="15.5" width="37" height="3.8" rx="1.4" fill="#b45309" />
              )}
            </>
          )}
          {[25, 37, 50, 63].map((sx) => (
            <rect key={sx} x={sx - 1} y="11" width="2" height="14.5" fill="#cbd5e1" />
          ))}
        </g>
      )}

      {cargoType === 'MAIL' && (
        <g>
          <rect x="22.5" y="10.5" width="44" height="15" rx="1" fill="#b91c1c" stroke="#450a0a" strokeWidth="0.8" />
          <rect x="23" y="18" width="43" height="2.8" fill="#fbbf24" />
        </g>
      )}

      {cargoType === 'GOODS' && (
        <g>
          <rect x="22.5" y="10.5" width="44" height="15" rx="1" fill="#0284c7" stroke="#0f172a" strokeWidth="0.8" />
          <rect x="23" y="19.5" width="43" height="2.5" fill="#f8fafc" />
        </g>
      )}

      {cargoType === 'GRAIN' && (
        <g>
          <rect x="23" y="12.5" width="43" height="13" rx="1" fill="#ca8a04" stroke="#422006" strokeWidth="0.8" />
          <path d="M23,12.5 Q44.5,9.5 66,12.5 Z" fill="#fef08a" />
        </g>
      )}

      {cargoType === 'FOOD' && (
        <g>
          <rect x="21.5" y="11.5" width="3.5" height="9" fill="#94a3b8" />
          <rect x="24.5" y="10.5" width="42" height="15" rx="1" fill="#f8fafc" stroke="#334155" strokeWidth="0.8" />
          <rect x="25" y="17" width="41" height="2.8" fill="#0ea5e9" />
        </g>
      )}

      {/* Truck axles */}
      {[14, 48, 59].map((cx) => (
        <circle key={cx} cx={cx} cy="30" r="3.4" fill="#0f172a" stroke="#94a3b8" strokeWidth="1.1" />
      ))}
    </svg>
  );
};

/**
 * Helper to derive effective TrainWagon list even for legacy saved trains
 */
export function resolveTrainWagonsList(vehicle: {
  wagons?: TrainWagon[];
  wt?: CargoType[];
  wagonCount: number;
  cargoType: CargoType;
  capacity: number;
  cargoAmount: number;
}): Array<{
  id: string;
  cargoType: CargoType;
  capacity: number;
  cargoAmount: number;
}> {
  if (vehicle.wagons && vehicle.wagons.length > 0) {
    return vehicle.wagons.map((w) => ({
      id: w.id,
      cargoType: w.cargoType,
      capacity: w.capacity,
      cargoAmount: w.cargoAmount,
    }));
  }
  const wtList = vehicle.wt;
  const cnt = Math.max(0, wtList?.length ?? vehicle.wagonCount ?? 0);
  if (cnt === 0) return [];
  const capPer = Math.max(1, Math.round(vehicle.capacity / cnt));
  let rem = vehicle.cargoAmount;
  const fallback: Array<{
    id: string;
    cargoType: CargoType;
    capacity: number;
    cargoAmount: number;
  }> = [];
  for (let i = 0; i < cnt; i++) {
    const amt = Math.min(capPer, Math.max(0, rem));
    rem -= amt;
    fallback.push({
      id: `legacy-w-${i}`,
      cargoType: wtList?.[i] ?? vehicle.cargoType,
      capacity: capPer,
      cargoAmount: amt,
    });
  }
  return fallback;
}

export function getCargoBadgeDotColor(cargo: CargoType): string {
  return CARGO_COLORS[cargo] ?? '#94a3b8';
}
