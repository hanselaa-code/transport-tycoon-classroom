import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { BUILD_COSTS, type GameEngine } from '../core';
import type { BridgeType, GameState, Tile, ToolType } from '../types/game';
import { FloatingPopups } from './FloatingPopups';
import {
  IsoSceneManager,
  type PickedTileResult,
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

function isDragBuildTool(tool: ToolType): tool is DragBuildTool {
  return (
    tool === 'ROAD' ||
    tool === 'RAIL' ||
    tool === 'ROAD_BRIDGE' ||
    tool === 'RAIL_BRIDGE'
  );
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

  // Latest props ref so the 60 FPS WebGL loop never re-mounts on React state updates
  const propsRef = useRef({
    engine,
    state,
    activeTool,
    mapRotation,
    selectedBridgeType,
    onRequestBridgeChoice,
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
    selectedStationOrderPicker,
    onTileInteract,
    onDepotClick,
    onStationClick,
    onVehicleClick,
  };

  const sceneMgrRef = useRef<IsoSceneManager | null>(null);
  const lastZoomSeqRef = useRef<number | null>(null);
  const lastFocusSeqRef = useRef<number | null>(null);

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

      let label = '';
      if (cur.selectedStationOrderPicker) {
        if (hoverTile.tile.stationId) {
          const st = cur.state.stations.find((s) => s.id === hoverTile?.tile.stationId);
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

      hud.textContent = label;
      hud.style.display = 'block';
      hud.style.transform = `translate3d(${(relX + 16).toFixed(0)}px, ${(relY + 16).toFixed(
        0
      )}px, 0)`;
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

        // 3. Single-tile build / bulldoze / HQ placement tools
        if (picked) {
          const { x, y } = picked;
          const res = cur.engine.applyTool(x, y, cur.activeTool);
          const freshState = cur.engine.getState();

          if (!res.ok && res.message) {
            floatingPopups.spawnLocalPopup(x, y, res.message, 'red', freshState);
          } else if (res.ok) {
            const freshTile = getTileAt(freshState, x, y);
            if (freshTile) {
              cur.onTileInteract?.(x, y, freshTile);
            }
          }
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

      sceneMgr.updateHoverAndDragPreview(
        hoverTile,
        buildDragPreviewTiles,
        cur.activeTool,
        Boolean(cur.selectedStationOrderPicker),
        latestState,
        timeSec
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
