import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  BUILD_COSTS,
  CARGO_LABELS_NO,
  RAIL_STATION_CATCHMENT_RADIUS,
  ROAD_STATION_CATCHMENT_RADIUS,
  type ApplyToolOptions,
  type GameEngine,
} from '../core';
import type { BridgeType, CargoType, GameState, Station, Tile, ToolType } from '../types/game';
import { FloatingPopups } from './FloatingPopups';
import {
  IsoSceneManager,
  type PickedTileResult,
  type StationOverlayData,
  formatNorwegianInt,
  getTileAt,
  setOwnerColorStateContext,
} from './IsoSceneManager';
import { StructuresRenderer } from './StructuresRenderer';
import { TerrainInstancer } from './TerrainInstancer';
import { VehicleRenderer } from './VehicleRenderer';

export interface IsometricViewportProps {
  engine: GameEngine;
  state: GameState;
  activeTool: ToolType;
  mapRotation: number; // 0 | 1 | 2 | 3 (90-degree steps)
  selectedBridgeType?: BridgeType;
  onRequestBridgeChoice?: (req: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    tool: 'ROAD' | 'RAIL' | 'ROAD_BRIDGE' | 'RAIL_BRIDGE';
    network: 'ROAD' | 'RAIL';
    bridgeTileCount: number;
  }) => void;
  stationBuildConfig?: {
    orientation: 'X' | 'Y';
    tracks: number;
    length: number;
  };
  onRotateStationOrientation?: () => void;
  inspectedStationId?: string | null;
  zoomCommand?: { type: 'IN' | 'OUT'; seq: number } | null;
  focusTile?: { x: number; y: number; seq: number } | null;
  selectedStationOrderPicker?: ((stationId: string) => void) | null;
  onTileInteract?: (x: number, y: number, tile: Tile) => void;
  onDepotClick?: (x: number, y: number, depotType: 'ROAD' | 'RAIL') => void;
  onStationClick?: (stationId: string) => void;
  onVehicleClick?: (vehicleId: string) => void;
}

const TOOL_LABELS_NO: Record<ToolType, string> = {
  SELECT: 'Inspeksjon',
  ROAD: 'Bilvei',
  RAIL: 'Jernbane',
  ROAD_BRIDGE: 'Veibru',
  RAIL_BRIDGE: 'Jernbanebru',
  ROAD_DEPOT: 'Bildepo / Garasje',
  RAIL_DEPOT: 'Togstall / Depo',
  BUS_STOP: 'Bussholdeplass',
  TRUCK_BAY: 'Lastebilterminal',
  TRAIN_STATION: 'Togstasjon',
  SIGNAL: 'Blokksignal',
  BULLDOZE: 'Riving',
  PLACE_HQ: 'Bygg Hovedkontor (Privat)',
};

type DragBuildTool = 'ROAD' | 'RAIL' | 'ROAD_BRIDGE' | 'RAIL_BRIDGE';
type StationBuildTool = 'TRAIN_STATION' | 'BUS_STOP' | 'TRUCK_BAY';

interface StationPreviewSummary {
  ok: boolean;
  reason?: string;
  cost: number;
  orientation: 'X' | 'Y';
  tracks: number;
  platformLength: number;
  catchmentRadius: number;
  footprintTiles: Array<{ x: number; y: number; valid: boolean }>;
  catchmentTiles: Array<{ x: number; y: number }>;
  suppliedCargos: CargoType[];
  acceptedCargos: CargoType[];
  townName?: string | null;
  nearbyIndustries?: string[];
}

function isDragBuildTool(tool: ToolType): tool is DragBuildTool {
  return (
    tool === 'ROAD' ||
    tool === 'RAIL' ||
    tool === 'ROAD_BRIDGE' ||
    tool === 'RAIL_BRIDGE'
  );
}

function isStationBuildTool(tool: ToolType): tool is StationBuildTool {
  return tool === 'TRAIN_STATION' || tool === 'BUS_STOP' || tool === 'TRUCK_BAY';
}

function computeStationPreviewWithFallback(
  engine: GameEngine,
  state: GameState,
  hx: number,
  hy: number,
  tool: StationBuildTool,
  cfg?: { orientation: 'X' | 'Y'; tracks: number; length: number }
): StationPreviewSummary {
  const orientation: 'X' | 'Y' =
    tool === 'TRAIN_STATION' ? (cfg?.orientation === 'Y' ? 'Y' : 'X') : 'X';
  const tracks =
    tool === 'TRAIN_STATION'
      ? Math.max(1, Math.min(4, Math.round(cfg?.tracks ?? 1)))
      : 1;
  const platformLength =
    tool === 'TRAIN_STATION'
      ? Math.max(1, Math.min(6, Math.round(cfg?.length ?? 3)))
      : 1;

  const engineWithPreview = engine as unknown as {
    previewStationPlacement?: (
      x: number,
      y: number,
      kind: StationBuildTool,
      options?: {
        orientation?: 'X' | 'Y';
        stationTracks?: number;
        stationLength?: number;
      }
    ) => StationPreviewSummary;
  };

  if (typeof engineWithPreview.previewStationPlacement === 'function') {
    return engineWithPreview.previewStationPlacement(
      hx,
      hy,
      tool,
      tool === 'TRAIN_STATION'
        ? {
            orientation,
            stationTracks: tracks,
            stationLength: platformLength,
          }
        : undefined
    );
  }

  // Fallback preview calculation matching engine rules
  const spanX = orientation === 'X' ? platformLength : tracks;
  const spanY = orientation === 'X' ? tracks : platformLength;
  const catchmentRadius =
    tool === 'TRAIN_STATION'
      ? RAIL_STATION_CATCHMENT_RADIUS ?? 4
      : ROAD_STATION_CATCHMENT_RADIUS ?? 3;

  const footprintTiles: Array<{ x: number; y: number; valid: boolean }> = [];
  const fpSet = new Set<number>();
  const baseTile = getTileAt(state, hx, hy);
  const refElev = baseTile?.elevation ?? 1;
  let allValid = true;
  let invalidReason: string | undefined;

  for (let dy = 0; dy < spanY; dy++) {
    for (let dx = 0; dx < spanX; dx++) {
      const tx = hx + dx;
      const ty = hy + dy;
      const t = getTileAt(state, tx, ty);
      let valid = true;
      if (!t) {
        valid = false;
        invalidReason = invalidReason ?? 'Utenfor kartet.';
      } else if (
        t.terrain === 'WATER' ||
        t.industryId ||
        t.hqOwnerId ||
        t.depot ||
        t.stationId ||
        (t.buildingTier ?? 0) > 0 ||
        (tool === 'TRAIN_STATION' && t.road) ||
        (tool !== 'TRAIN_STATION' && t.rail) ||
        t.elevation !== refElev
      ) {
        valid = false;
        invalidReason =
          invalidReason ??
          (t.elevation !== refElev
            ? 'Alle ruter for stasjonen må ha lik høyde.'
            : 'Ruten er opptatt eller ulendt.');
      }
      if (!valid) allValid = false;
      footprintTiles.push({ x: tx, y: ty, valid });
      if (tx >= 0 && ty >= 0 && tx < state.mapSize && ty < state.mapSize) {
        fpSet.add(ty * state.mapSize + tx);
      }
    }
  }

  const minX = hx - catchmentRadius;
  const maxX = hx + spanX - 1 + catchmentRadius;
  const minY = hy - catchmentRadius;
  const maxY = hy + spanY - 1 + catchmentRadius;

  const catchmentTiles: Array<{ x: number; y: number }> = [];
  const suppliedSet = new Set<CargoType>();
  const acceptedSet = new Set<CargoType>();

  for (let cy = Math.max(0, minY); cy <= Math.min(state.mapSize - 1, maxY); cy++) {
    for (let cx = Math.max(0, minX); cx <= Math.min(state.mapSize - 1, maxX); cx++) {
      const idx = cy * state.mapSize + cx;
      const qt = state.tiles[idx];
      if (!fpSet.has(idx)) {
        catchmentTiles.push({ x: cx, y: cy });
      }
      if (qt) {
        if ((qt.buildingTier ?? 0) >= 1) {
          suppliedSet.add('PASSENGERS');
          suppliedSet.add('MAIL');
          acceptedSet.add('PASSENGERS');
          acceptedSet.add('MAIL');
          if ((qt.buildingTier ?? 0) >= 2) {
            acceptedSet.add('GOODS');
            acceptedSet.add('FOOD');
          }
        }
        if (qt.industryId) {
          const ind = state.industries.find((item) => item.id === qt.industryId);
          if (ind) {
            if (ind.produces) suppliedSet.add(ind.produces);
            for (const acc of ind.accepts) acceptedSet.add(acc);
          }
        }
      }
    }
  }

  const unitCost = BUILD_COSTS?.[tool] ?? 45000;
  return {
    ok: allValid,
    reason: allValid ? undefined : invalidReason,
    cost: unitCost * tracks * platformLength,
    orientation,
    tracks,
    platformLength,
    catchmentRadius,
    footprintTiles,
    catchmentTiles,
    suppliedCargos: Array.from(suppliedSet),
    acceptedCargos: Array.from(acceptedSet),
  };
}

function findAnyStationById(state: GameState, stationId: string): Station | undefined {
  const local = state.stations.find((s) => s.id === stationId);
  if (local) return local;
  if (state.remotePlayers) {
    for (let i = 0; i < state.remotePlayers.length; i++) {
      const found = state.remotePlayers[i].stations.find((s) => s.id === stationId);
      if (found) return found;
    }
  }
  return undefined;
}

function computeFallbackDragTiles(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = [];
  const dx = Math.abs(toX - fromX);
  const dy = Math.abs(toY - fromY);

  let cx = fromX;
  let cy = fromY;
  result.push({ x: cx, y: cy });

  if (dx >= dy) {
    const stepX = toX >= fromX ? 1 : -1;
    while (cx !== toX) {
      cx += stepX;
      result.push({ x: cx, y: cy });
    }
    const stepY = toY >= fromY ? 1 : -1;
    while (cy !== toY) {
      cy += stepY;
      result.push({ x: cx, y: cy });
    }
  } else {
    const stepY = toY >= fromY ? 1 : -1;
    while (cy !== toY) {
      cy += stepY;
      result.push({ x: cx, y: cy });
    }
    const stepX = toX >= fromX ? 1 : -1;
    while (cx !== toX) {
      cx += stepX;
      result.push({ x: cx, y: cy });
    }
  }
  return result;
}

export const IsometricViewport: React.FC<IsometricViewportProps> = ({
  engine,
  state,
  activeTool,
  mapRotation,
  selectedBridgeType,
  onRequestBridgeChoice,
  stationBuildConfig,
  onRotateStationOrientation,
  inspectedStationId,
  zoomCommand,
  focusTile,
  selectedStationOrderPicker,
  onTileInteract,
  onDepotClick,
  onStationClick,
  onVehicleClick,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const cursorHudRef = useRef<HTMLDivElement | null>(null);
  const refreshHudFnRef = useRef<(() => void) | null>(null);

  // Latest props ref so the 60 FPS WebGL loop never re-mounts on React state updates
  const propsRef = useRef({
    engine,
    state,
    activeTool,
    mapRotation,
    selectedBridgeType,
    onRequestBridgeChoice,
    stationBuildConfig,
    onRotateStationOrientation,
    inspectedStationId,
    selectedStationOrderPicker,
    onTileInteract,
    onDepotClick,
    onStationClick,
    onVehicleClick,
  });
  propsRef.current = {
    engine,
    state,
    activeTool,
    mapRotation,
    selectedBridgeType,
    onRequestBridgeChoice,
    stationBuildConfig,
    onRotateStationOrientation,
    inspectedStationId,
    selectedStationOrderPicker,
    onTileInteract,
    onDepotClick,
    onStationClick,
    onVehicleClick,
  };

  const sceneMgrRef = useRef<IsoSceneManager | null>(null);
  const lastZoomSeqRef = useRef<number | null>(null);
  const lastFocusSeqRef = useRef<number | null>(null);

  // Refresh station build tooltip immediately when orientation/tracks/length or activeTool changes
  useEffect(() => {
    refreshHudFnRef.current?.();
  }, [
    activeTool,
    stationBuildConfig?.orientation,
    stationBuildConfig?.tracks,
    stationBuildConfig?.length,
  ]);

  // Sync mapRotation prop changes
  useEffect(() => {
    sceneMgrRef.current?.setMapRotationStep(mapRotation);
  }, [mapRotation]);

  // Sync external zoomCommand
  useEffect(() => {
    if (!zoomCommand) return;
    if (lastZoomSeqRef.current === zoomCommand.seq) return;
    lastZoomSeqRef.current = zoomCommand.seq;
    sceneMgrRef.current?.applyZoomCommand(zoomCommand.type);
  }, [zoomCommand]);

  // Sync external focusTile command
  useEffect(() => {
    if (!focusTile) return;
    if (lastFocusSeqRef.current === focusTile.seq) return;
    lastFocusSeqRef.current = focusTile.seq;
    sceneMgrRef.current?.focusOnTile(focusTile.x, focusTile.y, propsRef.current.state);
  }, [focusTile]);

  // Main WebGL lifecycle + 60 FPS animation & input loop
  useEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;

    const sceneMgr = new IsoSceneManager(container);
    sceneMgrRef.current = sceneMgr;
    sceneMgr.setMapRotationStep(propsRef.current.mapRotation);
    sceneMgr.ensureInitialCenter(propsRef.current.state);

    const terrainInstancer = new TerrainInstancer();
    const structuresRenderer = new StructuresRenderer(overlay, (stationId) => {
      const cur = propsRef.current;
      if (cur.selectedStationOrderPicker) {
        cur.selectedStationOrderPicker(stationId);
      } else {
        cur.onStationClick?.(stationId);
      }
    });
    const vehicleRenderer = new VehicleRenderer();
    const floatingPopups = new FloatingPopups(overlay);

    sceneMgr.scene.add(
      terrainInstancer.group,
      structuresRenderer.group,
      vehicleRenderer.group
    );

    // ResizeObserver for crisp responsive viewport resizing
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          sceneMgr.resize(width, height);
        }
      }
    });
    resizeObserver.observe(container);

    // Interactive pointer & drag state (zero React state churn during movement)
    let hoverTile: PickedTileResult | null = null;
    let isPanningDrag = false;
    let leftSelectCandidate = false;
    let panMovedPx = 0;
    let lastClientX = 0;
    let lastClientY = 0;

    let buildDragStart: { x: number; y: number } | null = null;
    let buildDragPreviewTiles: Array<{ x: number; y: number }> | null = null;
    let buildDragPreviewCost = 0;
    let buildDragBridgeTiles = 0;

    const setHudLines = (
      lines: Array<{ text: string; color?: string; fontWeight?: number }>
    ): void => {
      const hud = cursorHudRef.current;
      if (!hud) return;
      while (hud.firstChild) {
        hud.removeChild(hud.firstChild);
      }
      for (let i = 0; i < lines.length; i++) {
        const row = document.createElement('div');
        row.textContent = lines[i].text;
        row.style.color = lines[i].color ?? '#fde047';
        row.style.fontWeight = String(lines[i].fontWeight ?? (i === 0 ? 700 : 600));
        row.style.lineHeight = '1.35';
        hud.appendChild(row);
      }
    };

    const positionHudNearCursor = (relX: number, relY: number): void => {
      const hud = cursorHudRef.current;
      if (!hud) return;
      hud.style.display = 'block';
      const w = hud.offsetWidth || 220;
      const h = hud.offsetHeight || 28;
      const vw = container.clientWidth || 800;
      const vh = container.clientHeight || 600;
      const clampedX = Math.max(8, Math.min(relX + 16, vw - w - 10));
      const clampedY = Math.max(8, Math.min(relY + 16, vh - h - 10));
      hud.style.transform = `translate3d(${clampedX.toFixed(0)}px, ${clampedY.toFixed(0)}px, 0)`;
    };

    const updateCursorHud = (clientX: number, clientY: number): void => {
      const hud = cursorHudRef.current;
      if (!hud) return;

      const cur = propsRef.current;
      const rect = container.getBoundingClientRect();
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;

      if (!hoverTile || isPanningDrag) {
        hud.style.display = 'none';
        return;
      }

      if (!cur.selectedStationOrderPicker && isStationBuildTool(cur.activeTool)) {
        const preview = computeStationPreviewWithFallback(
          cur.engine,
          cur.state,
          hoverTile.x,
          hoverTile.y,
          cur.activeTool,
          cur.stationBuildConfig
        );
        const formatCargos = (list: CargoType[]): string =>
          list.length > 0
            ? list.map((c) => CARGO_LABELS_NO?.[c] ?? c).join(', ')
            : 'Ingen';

        const headerText =
          cur.activeTool === 'TRAIN_STATION'
            ? `Togstasjon (${preview.tracks} spor × ${preview.platformLength} ruter • ${
                preview.orientation === 'X' ? 'NØ–SV' : 'NV–SØ'
              }) — ${formatNorwegianInt(preview.cost)} kr`
            : `${TOOL_LABELS_NO[cur.activeTool]} (1×1) — ${formatNorwegianInt(
                preview.cost
              )} kr`;

        const footerText =
          !preview.ok && preview.reason
            ? `⚠️ ${preview.reason}${
                cur.activeTool === 'TRAIN_STATION' ? ' • [R] Roter retning' : ''
              }`
            : cur.activeTool === 'TRAIN_STATION'
            ? `Nedslagsfelt: ${preview.catchmentRadius} ruter (blått grid) • [R] Roter retning`
            : `Nedslagsfelt: ${preview.catchmentRadius} ruter (blått grid)`;

        setHudLines([
          { text: headerText, color: preview.ok ? '#fde047' : '#fca5a5', fontWeight: 700 },
          { text: `Leverer: ${formatCargos(preview.suppliedCargos)}`, color: '#86efac' },
          { text: `Tar imot: ${formatCargos(preview.acceptedCargos)}`, color: '#93c5fd' },
          {
            text: footerText,
            color: !preview.ok && preview.reason ? '#fca5a5' : '#cbd5e1',
          },
        ]);
        positionHudNearCursor(relX, relY);
        return;
      }

      let label = '';
      if (cur.selectedStationOrderPicker) {
        if (hoverTile.tile.stationId) {
          const st = findAnyStationById(cur.state, hoverTile.tile.stationId);
          label = `Legg til i rute: ${st?.name ?? 'Stasjon'}`;
        } else {
          label = 'Klikk på en stasjon på kartet';
        }
      } else if (
        buildDragStart &&
        buildDragPreviewTiles &&
        isDragBuildTool(cur.activeTool)
      ) {
        const toolName = TOOL_LABELS_NO[cur.activeTool];
        const bridgeSuffix =
          buildDragBridgeTiles > 0 ? `, ${buildDragBridgeTiles} bru` : '';
        label = `${toolName} (${buildDragPreviewTiles.length} ruter${bridgeSuffix}) — ${formatNorwegianInt(
          buildDragPreviewCost
        )} kr`;
      } else if (cur.activeTool === 'ROAD_BRIDGE' || cur.activeTool === 'RAIL_BRIDGE') {
        const bType = cur.selectedBridgeType ?? 'STEEL';
        const isRailKind = cur.activeTool === 'RAIL_BRIDGE';
        const costByTier =
          bType === 'WOOD'
            ? isRailKind
              ? 10500
              : 7500
            : bType === 'MODERN'
            ? isRailKind
              ? 32000
              : 24000
            : BUILD_COSTS?.[cur.activeTool] ?? (isRailKind ? 19000 : 13500);
        const toolName = TOOL_LABELS_NO[cur.activeTool];
        label = `${toolName} — ${formatNorwegianInt(costByTier)} kr/vannrute (dra fra bredd til bredd)`;
      } else if (cur.activeTool !== 'SELECT') {
        const cost = BUILD_COSTS?.[cur.activeTool] ?? 0;
        const toolName = TOOL_LABELS_NO[cur.activeTool];
        label = cost > 0 ? `${toolName} — ${formatNorwegianInt(cost)} kr` : toolName;
      }

      if (!label) {
        hud.style.display = 'none';
        return;
      }

      setHudLines([{ text: label, color: '#fde047', fontWeight: 700 }]);
      positionHudNearCursor(relX, relY);
    };

    refreshHudFnRef.current = () => {
      if (hoverTile && (lastClientX !== 0 || lastClientY !== 0)) {
        updateCursorHud(lastClientX, lastClientY);
      }
    };

    const recomputeDragPreview = (): void => {
      const cur = propsRef.current;
      if (
        !buildDragStart ||
        !hoverTile ||
        !isDragBuildTool(cur.activeTool)
      ) {
        buildDragPreviewTiles = null;
        buildDragPreviewCost = 0;
        buildDragBridgeTiles = 0;
        return;
      }

      const chosenBridgeType: BridgeType = cur.selectedBridgeType ?? 'STEEL';
      if (typeof cur.engine.previewDragPath === 'function') {
        const preview = cur.engine.previewDragPath(
          buildDragStart.x,
          buildDragStart.y,
          hoverTile.x,
          hoverTile.y,
          cur.activeTool,
          chosenBridgeType
        );
        buildDragPreviewTiles = preview.tiles;
        buildDragPreviewCost = preview.cost;
        buildDragBridgeTiles = preview.bridgeTileCount ?? 0;
      } else {
        buildDragPreviewTiles = computeFallbackDragTiles(
          buildDragStart.x,
          buildDragStart.y,
          hoverTile.x,
          hoverTile.y
        );
        const isRailKind = cur.activeTool === 'RAIL' || cur.activeTool === 'RAIL_BRIDGE';
        const landCost = isRailKind ? 4500 : 2500;
        const waterCost =
          chosenBridgeType === 'WOOD'
            ? isRailKind
              ? 10500
              : 7500
            : chosenBridgeType === 'MODERN'
            ? isRailKind
              ? 32000
              : 24000
            : isRailKind
            ? 19000
            : 13500;
        let est = 0;
        let bCount = 0;
        for (const pt of buildDragPreviewTiles) {
          const qt = getTileAt(cur.state, pt.x, pt.y);
          if (qt?.terrain === 'WATER') {
            est += waterCost;
            bCount++;
          } else {
            est += landCost;
          }
        }
        buildDragPreviewCost = est;
        buildDragBridgeTiles = bCount;
      }
    };

    const dom = sceneMgr.renderer.domElement;

    const onContextMenu = (ev: MouseEvent): void => {
      ev.preventDefault();
    };

    const onWheel = (ev: WheelEvent): void => {
      ev.preventDefault();
      sceneMgr.zoomAtScreenPoint(ev.deltaY, ev.clientX, ev.clientY);
    };

    const onPointerDown = (ev: PointerEvent): void => {
      dom.setPointerCapture(ev.pointerId);
      lastClientX = ev.clientX;
      lastClientY = ev.clientY;
      panMovedPx = 0;

      const cur = propsRef.current;
      hoverTile = sceneMgr.pickTileAtClientPos(ev.clientX, ev.clientY, cur.state);

      // Right-drag, Middle-drag, or Space + Left-drag -> immediate camera pan
      if (ev.button === 2 || ev.button === 1 || (ev.button === 0 && sceneMgr.isSpaceHeld())) {
        isPanningDrag = true;
        leftSelectCandidate = false;
        buildDragStart = null;
        buildDragPreviewTiles = null;
        dom.style.cursor = 'grabbing';
        updateCursorHud(ev.clientX, ev.clientY);
        return;
      }

      if (ev.button === 0) {
        if (
          !cur.selectedStationOrderPicker &&
          isDragBuildTool(cur.activeTool)
        ) {
          if (hoverTile) {
            buildDragStart = { x: hoverTile.x, y: hoverTile.y };
            recomputeDragPreview();
            updateCursorHud(ev.clientX, ev.clientY);
          }
          return;
        }

        // In SELECT mode (or other single-click tools), allow subtle trackpad drag-to-pan if moved > 7px
        leftSelectCandidate = true;
      }
    };

    const onPointerMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - lastClientX;
      const dy = ev.clientY - lastClientY;
      lastClientX = ev.clientX;
      lastClientY = ev.clientY;

      const cur = propsRef.current;

      if (isPanningDrag) {
        panMovedPx += Math.hypot(dx, dy);
        sceneMgr.panByScreenPixels(dx, dy);
        return;
      }

      if (leftSelectCandidate) {
        panMovedPx += Math.hypot(dx, dy);
        if (panMovedPx > 7 && cur.activeTool === 'SELECT' && !cur.selectedStationOrderPicker) {
          isPanningDrag = true;
          dom.style.cursor = 'grabbing';
          sceneMgr.panByScreenPixels(dx, dy);
          updateCursorHud(ev.clientX, ev.clientY);
          return;
        }
      }

      hoverTile = sceneMgr.pickTileAtClientPos(ev.clientX, ev.clientY, cur.state);
      if (buildDragStart) {
        recomputeDragPreview();
      }
      updateCursorHud(ev.clientX, ev.clientY);
    };

    const onPointerUp = (ev: PointerEvent): void => {
      if (dom.hasPointerCapture(ev.pointerId)) {
        dom.releasePointerCapture(ev.pointerId);
      }
      dom.style.cursor = 'default';

      const cur = propsRef.current;

      if (isPanningDrag) {
        isPanningDrag = false;
        leftSelectCandidate = false;
        updateCursorHud(ev.clientX, ev.clientY);
        return;
      }

      // Finish ROAD / RAIL / ROAD_BRIDGE / RAIL_BRIDGE drag construction
      if (
        ev.button === 0 &&
        buildDragStart &&
        !cur.selectedStationOrderPicker &&
        isDragBuildTool(cur.activeTool)
      ) {
        const endPick =
          sceneMgr.pickTileAtClientPos(ev.clientX, ev.clientY, cur.state) ?? hoverTile;
        const start = buildDragStart;
        buildDragStart = null;
        buildDragPreviewTiles = null;
        buildDragPreviewCost = 0;
        buildDragBridgeTiles = 0;

        if (endPick) {
          const chosenBridgeType: BridgeType = cur.selectedBridgeType ?? 'STEEL';
          const preview =
            typeof cur.engine.previewDragPath === 'function'
              ? cur.engine.previewDragPath(
                  start.x,
                  start.y,
                  endPick.x,
                  endPick.y,
                  cur.activeTool,
                  chosenBridgeType
                )
              : null;

          if (
            preview &&
            preview.ok &&
            preview.bridgeTileCount > 0 &&
            cur.onRequestBridgeChoice
          ) {
            const network: 'ROAD' | 'RAIL' =
              cur.activeTool === 'RAIL' || cur.activeTool === 'RAIL_BRIDGE'
                ? 'RAIL'
                : 'ROAD';
            cur.onRequestBridgeChoice({
              fromX: start.x,
              fromY: start.y,
              toX: endPick.x,
              toY: endPick.y,
              tool: cur.activeTool,
              network,
              bridgeTileCount: preview.bridgeTileCount,
            });
            updateCursorHud(ev.clientX, ev.clientY);
            return;
          }

          const res = cur.engine.applyDragTrackOrRoad(
            start.x,
            start.y,
            endPick.x,
            endPick.y,
            cur.activeTool,
            chosenBridgeType
          );
          const nextState = cur.engine.getState();
          if (!res.ok && res.message) {
            floatingPopups.spawnLocalPopup(
              endPick.x,
              endPick.y,
              res.message,
              'red',
              nextState
            );
          }
        }
        updateCursorHud(ev.clientX, ev.clientY);
        return;
      }

      // Single left-click action
      if (ev.button === 0 && leftSelectCandidate && panMovedPx <= 7) {
        leftSelectCandidate = false;
        const picked = sceneMgr.pickTileAtClientPos(ev.clientX, ev.clientY, cur.state);

        // 1. Station Order Picker mode takes top priority
        if (cur.selectedStationOrderPicker) {
          if (picked?.tile.stationId) {
            cur.selectedStationOrderPicker(picked.tile.stationId);
          } else if (picked) {
            floatingPopups.spawnLocalPopup(
              picked.x,
              picked.y,
              'Velg en stasjon!',
              'amber',
              cur.state
            );
          }
          return;
        }

        // 2. SELECT tool: inspect vehicle -> station -> depot -> tile
        if (cur.activeTool === 'SELECT') {
          const hitVehicle = sceneMgr.pickVehicleAtClientPos(
            ev.clientX,
            ev.clientY,
            cur.state.vehicles,
            cur.state
          );
          if (hitVehicle) {
            cur.onVehicleClick?.(hitVehicle.id);
            return;
          }

          if (picked) {
            const { x, y, tile } = picked;
            if (tile.stationId) {
              cur.onStationClick?.(tile.stationId);
            } else if (tile.depot === 'ROAD' || tile.depot === 'RAIL') {
              cur.onDepotClick?.(x, y, tile.depot);
            }
            cur.onTileInteract?.(x, y, tile);
          }
          return;
        }

        // 3. Single-tile / Multi-tile Station build / bulldoze / HQ placement tools
        if (picked) {
          const { x, y } = picked;
          const stCfg = cur.stationBuildConfig;
          const toolOptions: (ApplyToolOptions & { stationTracks?: number }) | undefined =
            cur.activeTool === 'TRAIN_STATION'
              ? {
                  orientation: stCfg?.orientation === 'Y' ? 'Y' : 'X',
                  stationTracks: Math.max(1, Math.min(4, Math.round(stCfg?.tracks ?? 1))),
                  stationLength: Math.max(1, Math.min(6, Math.round(stCfg?.length ?? 3))),
                }
              : undefined;
          const res = cur.engine.applyTool(x, y, cur.activeTool, toolOptions);
          const freshState = cur.engine.getState();

          if (!res.ok && res.message) {
            floatingPopups.spawnLocalPopup(x, y, res.message, 'red', freshState);
          } else if (res.ok) {
            const freshTile = getTileAt(freshState, x, y);
            if (freshTile) {
              cur.onTileInteract?.(x, y, freshTile);
            }
          }
          updateCursorHud(ev.clientX, ev.clientY);
        }
      }

      leftSelectCandidate = false;
    };

    const onPointerLeave = (): void => {
      hoverTile = null;
      if (cursorHudRef.current) {
        cursorHudRef.current.style.display = 'none';
      }
    };

    const isEditableElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      );
    };

    const onKeyDown = (ev: KeyboardEvent): void => {
      if (isEditableElement(ev.target)) return;
      if (
        !ev.repeat &&
        !ev.ctrlKey &&
        !ev.metaKey &&
        !ev.altKey &&
        (ev.code === 'KeyR' || ev.key === 'r' || ev.key === 'R') &&
        propsRef.current.activeTool === 'TRAIN_STATION'
      ) {
        ev.preventDefault();
        propsRef.current.onRotateStationOrientation?.();
        return;
      }
      sceneMgr.setKeyState(ev.code, true);
      if (ev.code === 'Equal' || ev.code === 'NumpadAdd') {
        sceneMgr.applyZoomCommand('IN');
      } else if (ev.code === 'Minus' || ev.code === 'NumpadSubtract') {
        sceneMgr.applyZoomCommand('OUT');
      }
    };

    const onKeyUp = (ev: KeyboardEvent): void => {
      sceneMgr.setKeyState(ev.code, false);
    };

    const onWindowBlur = (): void => {
      sceneMgr.clearKeys();
      isPanningDrag = false;
      leftSelectCandidate = false;
      buildDragStart = null;
      buildDragPreviewTiles = null;
    };

    dom.addEventListener('contextmenu', onContextMenu);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointercancel', onPointerUp);
    dom.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    const syncGroupShadows = (root: THREE.Group): void => {
      const children = root.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.userData.__shadowChildCount === child.children.length && child.userData.__shadowSynced) {
          continue;
        }
        child.traverse((node) => {
          if (node instanceof THREE.Mesh && !node.userData.__shadowSynced) {
            const mat = Array.isArray(node.material) ? node.material[0] : node.material;
            const isUnlitOrTransparent =
              !mat ||
              mat instanceof THREE.MeshBasicMaterial ||
              mat.transparent === true ||
              mat.opacity < 0.95;
            if (!isUnlitOrTransparent) {
              node.castShadow = true;
              node.receiveShadow = true;
            }
            node.userData.__shadowSynced = true;
          }
        });
        child.userData.__shadowSynced = true;
        child.userData.__shadowChildCount = child.children.length;
      }
    };

    // Cached station placement / inspection overlay so idle frames allocate zero arrays
    let lastOverlayCacheKey = '';
    let cachedStationOverlay: StationOverlayData | null = null;

    const resolveStationOverlay = (curState: GameState): StationOverlayData | null => {
      const cur = propsRef.current;

      // Mode A: Building a station (`TRAIN_STATION` / `BUS_STOP` / `TRUCK_BAY`) while hovering map
      if (hoverTile && !cur.selectedStationOrderPicker && isStationBuildTool(cur.activeTool)) {
        const cfg = cur.stationBuildConfig;
        const key = `build:${hoverTile.x}:${hoverTile.y}:${cur.activeTool}:${
          cfg?.orientation ?? 'X'
        }:${cfg?.tracks ?? 1}:${cfg?.length ?? 3}:${curState.networkRevision ?? 0}:${
          curState.stations.length
        }`;
        if (key !== lastOverlayCacheKey) {
          const preview = computeStationPreviewWithFallback(
            cur.engine,
            curState,
            hoverTile.x,
            hoverTile.y,
            cur.activeTool,
            cfg
          );
          cachedStationOverlay = {
            mode: 'BUILD_PREVIEW',
            footprintTiles: preview.footprintTiles,
            catchmentTiles: preview.catchmentTiles,
          };
          lastOverlayCacheKey = key;
        }
        return cachedStationOverlay;
      }

      // Mode B: Inspecting an existing station (`inspectedStationId` non-null)
      if (cur.inspectedStationId) {
        const st = findAnyStationById(curState, cur.inspectedStationId);
        if (!st || st.tiles.length === 0) {
          lastOverlayCacheKey = '';
          cachedStationOverlay = null;
          return null;
        }
        const key = `inspect:${st.id}:${st.tiles.length}:${curState.networkRevision ?? 0}:${
          curState.mapSize
        }`;
        if (key !== lastOverlayCacheKey) {
          const engineWithCatchment = cur.engine as unknown as {
            getStationCatchmentTiles?: (id: string) => Array<{ x: number; y: number }>;
          };
          let catchmentTiles: Array<{ x: number; y: number }>;
          if (typeof engineWithCatchment.getStationCatchmentTiles === 'function') {
            catchmentTiles = engineWithCatchment.getStationCatchmentTiles(st.id);
          } else {
            const radius =
              st.kind === 'TRAIN_STATION'
                ? RAIL_STATION_CATCHMENT_RADIUS ?? 4
                : ROAD_STATION_CATCHMENT_RADIUS ?? 3;
            let minX = st.tiles[0].x;
            let maxX = st.tiles[0].x;
            let minY = st.tiles[0].y;
            let maxY = st.tiles[0].y;
            const fpSet = new Set<number>();
            for (let i = 0; i < st.tiles.length; i++) {
              const pt = st.tiles[i];
              if (pt.x < minX) minX = pt.x;
              if (pt.x > maxX) maxX = pt.x;
              if (pt.y < minY) minY = pt.y;
              if (pt.y > maxY) maxY = pt.y;
              fpSet.add(pt.y * curState.mapSize + pt.x);
            }
            catchmentTiles = [];
            for (
              let cy = Math.max(0, minY - radius);
              cy <= Math.min(curState.mapSize - 1, maxY + radius);
              cy++
            ) {
              for (
                let cx = Math.max(0, minX - radius);
                cx <= Math.min(curState.mapSize - 1, maxX + radius);
                cx++
              ) {
                if (!fpSet.has(cy * curState.mapSize + cx)) {
                  catchmentTiles.push({ x: cx, y: cy });
                }
              }
            }
          }
          cachedStationOverlay = {
            mode: 'INSPECT_EXISTING',
            footprintTiles: st.tiles.map((pt) => ({ x: pt.x, y: pt.y, valid: true })),
            catchmentTiles,
          };
          lastOverlayCacheKey = key;
        }
        return cachedStationOverlay;
      }

      lastOverlayCacheKey = '';
      cachedStationOverlay = null;
      return null;
    };

    // 60 FPS Render Loop
    let rafId = 0;
    let prevPerfMs = performance.now();

    const animate = (nowPerfMs: number): void => {
      rafId = requestAnimationFrame(animate);

      const dtSec = Math.min(0.1, Math.max(0.001, (nowPerfMs - prevPerfMs) / 1000));
      prevPerfMs = nowPerfMs;
      const timeSec = nowPerfMs * 0.001;

      const cur = propsRef.current;
      const latestState = cur.state;

      sceneMgr.ensureInitialCenter(latestState);
      sceneMgr.updateCamera(dtSec);

      // Sync dirty-checked instanced terrain, networks, and structures
      setOwnerColorStateContext(latestState);
      terrainInstancer.sync(latestState);
      terrainInstancer.updateWaterAnimation(timeSec);

      structuresRenderer.sync(latestState);
      (
        structuresRenderer as unknown as {
          updateAnimation?: (timeSec: number, dtSec: number) => void;
        }
      ).updateAnimation?.(timeSec, dtSec);
      vehicleRenderer.update(latestState, dtSec, nowPerfMs);

      syncGroupShadows(structuresRenderer.group);
      syncGroupShadows(vehicleRenderer.group);

      const stationOverlay = resolveStationOverlay(latestState);
      sceneMgr.updateHoverAndDragPreview(
        hoverTile,
        buildDragPreviewTiles,
        cur.activeTool,
        Boolean(cur.selectedStationOrderPicker),
        latestState,
        timeSec,
        stationOverlay
      );

      sceneMgr.render();

      // Project crisp HTML2D labels & rising +kr popups after camera matrix update
      structuresRenderer.updateLabelProjections(sceneMgr);
      floatingPopups.syncFromState(latestState, nowPerfMs);
      floatingPopups.updateProjections(sceneMgr, nowPerfMs);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      refreshHudFnRef.current = null;

      dom.removeEventListener('contextmenu', onContextMenu);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);

      setOwnerColorStateContext(null);
      terrainInstancer.dispose();
      structuresRenderer.dispose();
      vehicleRenderer.dispose();
      floatingPopups.dispose();
      sceneMgr.dispose();
      sceneMgrRef.current = null;
    };
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        userSelect: 'none',
        background: '#0f2438',
      }}
    >
      {/* Three.js WebGL Canvas Mount */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
        }}
      />

      {/* Crisp HTML2D Labels & Floating Income Popups Layer */}
      <div
        ref={overlayRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      />

      {/* Live Construction & Order-Picker Cursor Tooltip */}
      <div
        ref={cursorHudRef}
        style={{
          display: 'none',
          position: 'absolute',
          left: 0,
          top: 0,
          zIndex: 25,
          pointerEvents: 'none',
          padding: '3px 8px',
          borderRadius: '0px',
          background: 'rgba(34, 42, 36, 0.95)',
          borderTop: '2px solid #cbd5e1',
          borderLeft: '2px solid #cbd5e1',
          borderRight: '2px solid #0f172a',
          borderBottom: '2px solid #0f172a',
          color: '#fde047',
          textShadow: '1px 1px 0px #000000',
          fontSize: '11px',
          fontWeight: 700,
          fontFamily: 'Tahoma, Verdana, ui-sans-serif, system-ui, sans-serif',
          whiteSpace: 'nowrap',
          boxShadow: '2px 3px 6px rgba(0, 0, 0, 0.6)',
        }}
      />
    </div>
  );
};
