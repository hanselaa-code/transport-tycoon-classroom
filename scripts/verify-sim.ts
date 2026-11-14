import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CARGO_SPECS,
  OPENTTD_MAX_TIME_FACTOR,
  OPENTTD_MIN_TIME_FACTOR,
  calculateCargoPayment,
  calculateCargoTimeFactor,
  calculateCompanyValuation,
  calculateMonthlyRunningCost,
  calculateProgressiveTax,
  calculateSlopeSpeedFactor,
  calculateStationRating,
  calculateTownGrowthDelta,
} from '../src/formulas';
import {
  ALL_CARGO_TYPES,
  BRIDGE_CATALOG,
  BRIDGE_TYPES_ORDER,
  BUILD_COSTS,
  type BridgeType,
  GameEngine,
  HQ_TIERS,
  INITIAL_CORPORATE_CASH_KR,
  INITIAL_CORPORATE_LOAN_KR,
  LOAN_STEP_KR,
  MAX_STATION_LENGTH,
  MAX_STATION_TRACKS,
  MAX_TRAIN_WAGONS,
  NORWEGIAN_TOWN_NAMES,
  RAIL_STATION_CATCHMENT_RADIUS,
  RAIL_WAGON_CATALOG,
  RAIL_WAGON_CATALOG_LIST,
  ROAD_REFIT_COST_KR,
  ROAD_STATION_CATCHMENT_RADIUS,
  ROAD_VEHICLE_SHOP_LIST,
  TOTAL_AI_SHARES,
  VEHICLE_CATALOG,
  createGameEngine,
  findNetworkPath,
  getEffectiveStationPlatformLength,
  getEffectiveStationTracks,
  getStationHQBonusPct,
  getStationSuppliedCargos,
  getTrainRequiredPlatformTiles,
  isCargoCompatibleWithStationKind,
  isTileTraversableForNetwork,
  tileIndex,
} from '../src/core';
import {
  BRIDGE_DECK_Y,
  ELEV_STEP,
  WATER_SURFACE_Y,
  getBridgeDeckY,
  getCornerHeight,
  getSurfaceHeightAt,
  getTileCornerHeights,
  getTravelSurfaceHeightAt,
  resolveOwnerColor,
} from '../src/renderer/IsoSceneManager';
import { TerrainInstancer } from '../src/renderer/TerrainInstancer';
import { StructuresRenderer } from '../src/renderer/StructuresRenderer';
import { VehicleRenderer } from '../src/renderer/VehicleRenderer';
import { firebaseConfig, hasValidFirebaseConfig } from '../src/firebase/config';
import {
  ADMIN_TEACHER_EMAIL,
  getCurrentTeacherUser,
  signInTeacherWithGoogle,
  signOutTeacher,
  subscribeToTeacherAuth,
} from '../src/firebase/auth';
import {
  DEFAULT_WORLD_SETUP,
  PLAYER_WORLD_COLORS,
  computeWorldBucketAssignment,
  createClassroomSession,
  isFirebaseConfigured,
  joinClassroomSession,
  joinClassroomWithWorldAssignment,
  normalizeWorldSetup,
  pushStudentTelemetry,
  subscribeToClassroom,
} from '../src/firebase/classroom';
import {
  publishPlayerWorldSlice,
  subscribeToWorldPeers,
} from '../src/firebase/multiplayer';

let passedAssertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error(`\n[FAIL] ${message}`);
    process.exit(1);
  }
  passedAssertions++;
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    console.error(
      `\n[FAIL] ${message}\n  Expected: ${String(expected)}\n  Actual:   ${String(actual)}`
    );
    process.exit(1);
  }
  passedAssertions++;
}

function assertNear(
  actual: number,
  expected: number,
  tolerance: number,
  message: string
): void {
  if (Math.abs(actual - expected) > tolerance) {
    console.error(
      `\n[FAIL] ${message}\n  Expected: ${expected} (±${tolerance})\n  Actual:   ${actual}`
    );
    process.exit(1);
  }
  passedAssertions++;
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  console.log('Starting Transport Tycoon: Classroom Edition Headless Verification (Round 5 Multiplayer & Bridges Edition)...');

  // =========================================================================
  // 1. OpenTTD Cargo Payment, Recalibrated Commodity Rates & Mechanics Formulas
  // =========================================================================
  section('1. OpenTTD Cargo Payment, Recalibrated TTD Rates & Mechanics Formulas');

  // Verify authentic TTD relative commodity rates (Round 2 spec)
  assertEq(CARGO_SPECS.PASSENGERS.baseRateKr, 3.2, 'PASSENGERS baseRateKr = 3.2 kr');
  assertEq(CARGO_SPECS.MAIL.baseRateKr, 5.2, 'MAIL baseRateKr = 5.2 kr');
  assertEq(CARGO_SPECS.GRAIN.baseRateKr, 9.8, 'GRAIN baseRateKr = 9.8 kr');
  assertEq(CARGO_SPECS.WOOD.baseRateKr, 10.2, 'WOOD baseRateKr = 10.2 kr');
  assertEq(CARGO_SPECS.COAL.baseRateKr, 11.5, 'COAL baseRateKr = 11.5 kr');
  assertEq(CARGO_SPECS.FOOD.baseRateKr, 12.2, 'FOOD baseRateKr = 12.2 kr');
  assertEq(CARGO_SPECS.GOODS.baseRateKr, 13.5, 'GOODS baseRateKr = 13.5 kr');

  // Distance monotonicity: higher distance -> strictly higher revenue
  const coalNear = calculateCargoPayment('COAL', 100, 10, 12);
  const coalMid = calculateCargoPayment('COAL', 100, 25, 12);
  const coalFar = calculateCargoPayment('COAL', 100, 50, 12);
  assert(
    coalNear > 0 && coalMid > coalNear && coalFar > coalMid,
    `Cargo payment must increase with Manhattan distance (got ${coalNear} -> ${coalMid} -> ${coalFar})`
  );

  // Industrial bulk train delivery out-earns a short-hop bus delivery
  const shortBusPayout = calculateCargoPayment('PASSENGERS', 32, 16, 8);
  const longCoalTrainPayout = calculateCargoPayment('COAL', 96, 32, 14);
  assert(
    longCoalTrainPayout > shortBusPayout * 4,
    `Long-haul coal train (${longCoalTrainPayout} kr) must strongly out-earn a single bus (${shortBusPayout} kr)`
  );

  // Transit time decay thresholds (days1 -> -1/day, days2 -> -2/day, floor 31/255)
  const paxSpec = CARGO_SPECS.PASSENGERS;
  assertEq(
    calculateCargoTimeFactor('PASSENGERS', paxSpec.days1),
    OPENTTD_MAX_TIME_FACTOR,
    'Time factor at days1 must equal 255'
  );
  assertEq(
    calculateCargoTimeFactor('PASSENGERS', paxSpec.days1 + 5),
    OPENTTD_MAX_TIME_FACTOR - 5,
    'Time factor between days1 and days2 must decay by -1/day'
  );
  const afterDays2 = paxSpec.days2 + 4;
  const expectedAfterDays2 =
    OPENTTD_MAX_TIME_FACTOR - (afterDays2 - paxSpec.days1) - (afterDays2 - paxSpec.days2);
  assertEq(
    calculateCargoTimeFactor('PASSENGERS', afterDays2),
    expectedAfterDays2,
    'Time factor past days2 must decay by -2/day total'
  );
  assertEq(
    calculateCargoTimeFactor('PASSENGERS', 1000),
    OPENTTD_MIN_TIME_FACTOR,
    'Time factor at extreme transit days must clamp at OpenTTD floor 31'
  );

  const paxFastPay = calculateCargoPayment('PASSENGERS', 80, 30, paxSpec.days1);
  const paxMidPay = calculateCargoPayment('PASSENGERS', 80, 30, paxSpec.days2);
  const paxLatePay = calculateCargoPayment('PASSENGERS', 80, 30, paxSpec.days2 + 20);
  const paxFloorPay = calculateCargoPayment('PASSENGERS', 80, 30, 999);
  const expectedFloorPay = Math.round(
    (30 * 80 * paxSpec.baseRateKr * OPENTTD_MIN_TIME_FACTOR) / OPENTTD_MAX_TIME_FACTOR
  );
  assert(
    paxFastPay > paxMidPay && paxMidPay > paxLatePay && paxLatePay >= paxFloorPay,
    `Cargo payout must decay smoothly past days1/days2 down to floor (${paxFastPay} > ${paxMidPay} > ${paxLatePay} >= ${paxFloorPay})`
  );
  assertEq(paxFloorPay, expectedFloorPay, 'Minimum floor cargo payout matches 31/255 formula');

  // Running cost multipliers & slope speed factors
  assertEq(calculateMonthlyRunningCost(120_000, 'moving'), 10_000, 'Moving monthly cost = 100%');
  assertEq(calculateMonthlyRunningCost(120_000, 'loading'), 6_000, 'Loading monthly cost = 60%');
  assertEq(calculateMonthlyRunningCost(120_000, 'stopped'), 2_500, 'Stopped monthly cost = 25%');
  assertEq(calculateMonthlyRunningCost(120_000, 'depot'), 1_000, 'Depot monthly cost = 10%');

  const railUphill = calculateSlopeSpeedFactor(1, 2, 'rail');
  const roadUphill = calculateSlopeSpeedFactor(1, 2, 'road');
  assert(
    railUphill < roadUphill && roadUphill < 1.0,
    `Rail uphill penalty (${railUphill}) must be steeper than road (${roadUphill})`
  );
  assertEq(calculateSlopeSpeedFactor(3, 1, 'rail'), 1.0, 'Downhill speed capped at 1.0');

  // Station rating & town growth
  const baseRating = calculateStationRating(2, 120, 40, 0);
  const hqBoostedRating = calculateStationRating(2, 120, 40, 15);
  assertEq(
    hqBoostedRating - baseRating,
    15,
    'HQ proximity bonus adds exact percentage points to station rating'
  );
  assertEq(calculateTownGrowthDelta(800, 0, 0, 0, 0), 0, 'Unserviced town has 0 growth');
  assert(
    calculateTownGrowthDelta(800, 3, 120, 40, 60) >
      calculateTownGrowthDelta(800, 1, 20, 0, 0),
    'More serviced stations & cargo deliveries accelerate town growth'
  );
  assert(
    calculateCompanyValuation({
      cash: 100_000,
      loan: 5_000_000,
      fleetBookValue: 0,
      infrastructureCount: 0,
      annualProfit: -50_000,
    }) === 1,
    'Company valuation floors at 1 kr when underwater'
  );

  console.log('  [OK] Recalibrated TTD commodity rates, decay floor (31/255), slopes, ratings & town growth verified.');

  // =========================================================================
  // 2. Authentic TTD Catalog, Zero-Start Stations, Gradual Loading, Full Load & Land Info
  // =========================================================================
  section('2. TTD Vehicle Speeds, Zero-Start Stations, Gradual Loading, Full Load & Land Info');

  assertEq(VEHICLE_CATALOG.BUS_CITY.maxSpeedKmh, 56, 'BUS_CITY realistic TTD speed = 56 km/h');
  assertEq(VEHICLE_CATALOG.BUS_CITY.baseCapacity, 32, 'BUS_CITY capacity = 32 passengers');
  assertEq(VEHICLE_CATALOG.BUS_CITY.price, 65_000, 'BUS_CITY price = 65 000 kr');
  assertEq(VEHICLE_CATALOG.BUS_CITY.annualRunningCost, 13_200, 'BUS_CITY annual running cost = 13 200 kr');

  assertEq(VEHICLE_CATALOG.TRUCK_CARGO.maxSpeedKmh, 54, 'TRUCK_CARGO speed = 54 km/h');
  assertEq(VEHICLE_CATALOG.TRUCK_CARGO.baseCapacity, 25, 'TRUCK_CARGO capacity = 25 units');
  assertEq(VEHICLE_CATALOG.LOCO_STEAM.maxSpeedKmh, 88, 'LOCO_STEAM speed = 88 km/h');
  assertEq(VEHICLE_CATALOG.LOCO_DIESEL.maxSpeedKmh, 128, 'LOCO_DIESEL speed = 128 km/h');
  assertEq(VEHICLE_CATALOG.LOCO_ELECTRIC.maxSpeedKmh, 175, 'LOCO_ELECTRIC speed = 175 km/h');

  assertEq(ROAD_STATION_CATCHMENT_RADIUS, 3, 'Road station catchment radius = 3 tiles');
  assertEq(RAIL_STATION_CATCHMENT_RADIUS, 4, 'Rail station catchment radius = 4 tiles');

  const ttdEngine = createGameEngine({ scenario: 'standard', mapSize: 64, seed: 20261112 });
  const ttdInit = ttdEngine.getState();
  const testTown = ttdInit.towns[0];

  // Place a fresh BUS_STOP adjacent to town[0] and verify STRICTLY 0 initial waiting cargo
  let testStopPos: { x: number; y: number } | null = null;
  let testDepotPos: { x: number; y: number } | null = null;
  for (let dy = -3; dy <= 3 && !testStopPos; dy++) {
    for (let dx = -3; dx <= 3 && !testStopPos; dx++) {
      const tx = testTown.x + dx;
      const ty = testTown.y + dy;
      const t = ttdInit.tiles[tileIndex(tx, ty, ttdInit.mapSize)];
      if (
        t.terrain !== 'WATER' &&
        !t.stationId &&
        !t.depot &&
        !t.industryId &&
        (t.buildingTier ?? 0) === 0
      ) {
        const res = ttdEngine.applyTool(tx, ty, 'BUS_STOP');
        if (res.ok) {
          testStopPos = { x: tx, y: ty };
        }
      }
    }
  }
  assert(testStopPos !== null, 'Built fresh town BUS_STOP');

  const builtStop = ttdEngine.getState().stations[0];
  for (const cargo of ALL_CARGO_TYPES) {
    assertEq(
      builtStop.waitingCargo[cargo],
      0,
      `Newly built station must start with 0 waiting ${cargo} (got ${builtStop.waitingCargo[cargo]})`
    );
  }

  // Advance 5 game days and confirm passengers trickle in gradually (modest trickle, never instant flood)
  ttdEngine.advanceDays(5);
  const paxAfter5Days = ttdEngine.getState().stations[0].waitingCargo.PASSENGERS;
  assert(
    paxAfter5Days > 0 && paxAfter5Days <= 18,
    `Town bus stop should accumulate a modest trickle after 5 days (got ${paxAfter5Days})`
  );

  // Verify Land Area Info (`inspectTile`)
  const townInspect = ttdEngine.inspectTile(testTown.x, testTown.y);
  assert(townInspect !== null, 'inspectTile returns non-null info for town center');
  assert(
    Boolean(townInspect.townName && townInspect.descriptionNo.length > 0),
    'inspectTile includes townName and Norwegian description'
  );
  const stopInspect = ttdEngine.inspectTile(testStopPos.x, testStopPos.y);
  assert(
    Boolean(stopInspect?.stationName && stopInspect.accepts.includes('PASSENGERS')),
    'inspectTile on bus stop reports stationName and PASSENGERS acceptance'
  );

  // Verify `toggleVehicleFullLoad` and gradual multi-tick loading
  const curTiles = ttdEngine.getState().tiles;
  for (const [ox, oy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const nx = testStopPos.x + ox;
    const ny = testStopPos.y + oy;
    const nt = curTiles[tileIndex(nx, ny, 64)];
    if (
      nt &&
      nt.terrain !== 'WATER' &&
      !nt.stationId &&
      !nt.depot &&
      !nt.industryId &&
      (nt.buildingTier ?? 0) === 0
    ) {
      const dr = ttdEngine.applyTool(nx, ny, 'ROAD_DEPOT');
      if (dr.ok) {
        testDepotPos = { x: nx, y: ny };
        break;
      }
    }
  }
  assert(testDepotPos !== null, 'Built ROAD_DEPOT adjacent to BUS_STOP');

  // Place a second stop a couple tiles away so the bus has 2 orders
  let secondStopId: string | null = null;
  for (let r = 2; r <= 5 && !secondStopId; r++) {
    const sx = testStopPos.x + r;
    const sy = testStopPos.y;
    ttdEngine.applyDragTrackOrRoad(testStopPos.x, testStopPos.y, sx, sy, 'ROAD');
    const sr = ttdEngine.applyTool(sx, sy, 'BUS_STOP');
    if (sr.ok && sr.stationId && sr.stationId !== builtStop.id) {
      secondStopId = sr.stationId;
    }
  }
  assert(secondStopId !== null, 'Built second BUS_STOP for full-load test');

  const busBuy = ttdEngine.buyVehicle({
    depotX: testDepotPos.x,
    depotY: testDepotPos.y,
    modelId: 'BUS_CITY',
    orders: [builtStop.id, secondStopId],
  });
  assert(busBuy.ok && Boolean(busBuy.vehicleId), 'Bought BUS_CITY in depot');

  const fullLoadOn = ttdEngine.toggleVehicleFullLoad(busBuy.vehicleId!);
  assert(fullLoadOn.ok, 'toggleVehicleFullLoad enables Full Load');
  assertEq(
    ttdEngine.getState().vehicles.find((v) => v.id === busBuy.vehicleId)!.waitForFullLoad,
    true,
    'vehicle.waitForFullLoad is true after toggle'
  );
  const fullLoadOff = ttdEngine.toggleVehicleFullLoad(busBuy.vehicleId!);
  assert(fullLoadOff.ok, 'toggleVehicleFullLoad toggles Full Load off');
  assertEq(
    ttdEngine.getState().vehicles.find((v) => v.id === busBuy.vehicleId)!.waitForFullLoad,
    false,
    'vehicle.waitForFullLoad is false after second toggle'
  );
  // Re-enable Full Load and seed 20 passengers (< 32 capacity) on builtStop to test gradual loading + full-load hold
  ttdEngine.toggleVehicleFullLoad(busBuy.vehicleId!);
  ttdEngine.getState().stations.find((s) => s.id === builtStop.id)!.waitingCargo.PASSENGERS = 20;

  let sawGradualPartialLoad = false;
  let heldAtStationPastMinDwell = false;
  let loadingTicksObserved = 0;

  for (let t = 0; t < 40; t++) {
    ttdEngine.tick(1);
    const bus = ttdEngine.getState().vehicles.find((v) => v.id === busBuy.vehicleId)!;
    if (bus.state === 'LOADING') {
      loadingTicksObserved++;
      if (bus.cargoAmount > 0 && bus.cargoAmount < 20) {
        sawGradualPartialLoad = true;
      }
      if (loadingTicksObserved > 7 && bus.cargoAmount < bus.capacity) {
        heldAtStationPastMinDwell = true;
      }
    }
  }
  assert(sawGradualPartialLoad, 'Vehicle loads cargo gradually across multiple subticks (not instant 1-tick)');
  assert(heldAtStationPastMinDwell, 'Vehicle with waitForFullLoad waits at producing station when partially loaded');

  console.log('  [OK] TTD vehicle speeds, 0-start stations, catchment trickle, gradual loading, Full Load & inspectTile verified.');

  // =========================================================================
  // 3. Dual Economy Separation, Loan, Liquidity Warning, Tax & HQ Tiers 1-5
  // =========================================================================
  section('3. Dual Economy Separation, Progressive Tax & HQ Tiers 1-5');

  // Verify exact 60 000 kr progressive tax example from spec
  const tax60k = calculateProgressiveTax(60_000);
  assertEq(tax60k.bracket1Tax, 5_000, '60k gross -> Bracket 1 tax = 5 000 kr (20% of 25 000)');
  assertEq(tax60k.bracket2Tax, 7_500, '60k gross -> Bracket 2 tax = 7 500 kr (30% of 25 000)');
  assertEq(tax60k.bracket3Tax, 4_200, '60k gross -> Bracket 3 tax = 4 200 kr (42% of 10 000)');
  assertEq(tax60k.totalIncomeTax, 16_700, '60k gross -> Total income tax = 16 700 kr');
  assertEq(tax60k.netPersonalPay, 43_300, '60k gross -> Net personal pay = 43 300 kr');
  assertEq(tax60k.employerPayrollTax, 8_460, '60k gross -> Arbeidsgiveravgift (14.1%) = 8 460 kr');
  assertEq(tax60k.totalCorporateCost, 68_460, '60k gross -> Total corporate cost = 68 460 kr');

  const econEngine = createGameEngine({ scenario: 'standard', mapSize: 64, seed: 424242 });
  let st = econEngine.getState();

  assertEq(st.corporate.cash, INITIAL_CORPORATE_CASH_KR, 'Corporate starts with 2 000 000 kr cash');
  assertEq(st.corporate.loan, INITIAL_CORPORATE_LOAN_KR, 'Corporate starts with 2 000 000 kr loan');
  assertEq(st.corporate.annualInterestRate, 7.0, 'Base corporate loan interest rate = 7.0%');
  assertEq(st.corporate.isBankruptWarning, false, 'No liquidity warning at positive cash');

  // Loan adjustments in 100 000 kr steps
  const borrowRes = econEngine.adjustLoan(LOAN_STEP_KR);
  assert(borrowRes.ok, 'Borrowing +100 000 kr succeeds');
  st = econEngine.getState();
  assertEq(st.corporate.loan, 2_100_000, 'Loan increased to 2 100 000 kr');
  assertEq(st.corporate.cash, 2_100_000, 'Cash increased to 2 100 000 kr');

  // Repay entire 2 100 000 kr loan so monthly tick isolates exact salary + arbeidsgiveravgift
  for (let i = 0; i < 21; i++) {
    const r = econEngine.adjustLoan(-LOAN_STEP_KR);
    assert(r.ok, `Repaying 100 000 kr step #${i + 1} succeeds`);
  }
  st = econEngine.getState();
  assertEq(st.corporate.loan, 0, 'Corporate loan fully repaid to 0 kr');
  assertEq(st.corporate.cash, 0, 'Corporate cash is 0 kr after repaying initial loan');

  // Grant 100 000 kr corporate cash, set gross salary = 60 000 kr, advance 1 month (30 days)
  econEngine.grantDevFunds('corporate', 100_000);
  const personalBeforeSalary = econEngine.getState().personal.cash;
  const corpBeforeSalary = econEngine.getState().corporate.cash;
  econEngine.setMonthlyGrossSalary(60_000);
  econEngine.advanceDays(30);

  st = econEngine.getState();
  assertEq(
    corpBeforeSalary - st.corporate.cash,
    68_460,
    'Monthly salary deducts exact 68 460 kr (60 000 + 8 460 arbeidsgiveravgift) from Corporate Cash'
  );
  assertEq(
    st.corporate.currentYearPnL.ownerSalaryCost,
    60_000,
    'PnL records 60 000 kr ownerSalaryCost'
  );
  assertEq(
    st.corporate.currentYearPnL.employerPayrollTaxCost,
    8_460,
    'PnL records 8 460 kr employerPayrollTaxCost'
  );
  assertEq(
    st.personal.cash - personalBeforeSalary,
    43_300,
    'Monthly salary credits exact 43 300 kr net pay to Personal Cash'
  );
  assertEq(
    st.personal.lifetimeTaxPaid,
    16_700,
    'lifetimeTaxPaid incremented by exact 16 700 kr'
  );

  // Trigger liquidity warning when corporate.cash < 0
  econEngine.advanceDays(30);
  st = econEngine.getState();
  assert(st.corporate.cash < 0, `Corporate cash should be negative (got ${st.corporate.cash})`);
  assertEq(
    st.corporate.isBankruptWarning,
    true,
    'Liquidity warning triggers when corporate.cash < 0'
  );
  assert(
    st.news.some((n) => n.category === 'WARNING'),
    'Negative corporate cash emits a WARNING news item'
  );

  // Restore corporate cash and build a nearby station so we can verify HQ station rating bonus + interest discount
  econEngine.grantDevFunds('corporate', 1_000_000);
  const town0 = st.towns[0];
  let placedStationTile: { x: number; y: number } | null = null;
  for (let dy = -3; dy <= 3 && !placedStationTile; dy++) {
    for (let dx = -3; dx <= 3 && !placedStationTile; dx++) {
      const tx = town0.x + dx;
      const ty = town0.y + dy;
      const t = st.tiles[tileIndex(tx, ty, st.mapSize)];
      if (
        t.terrain !== 'WATER' &&
        !t.stationId &&
        !t.depot &&
        !t.industryId &&
        (t.buildingTier ?? 0) === 0
      ) {
        const res = econEngine.applyTool(tx, ty, 'BUS_STOP');
        if (res.ok) {
          placedStationTile = { x: tx, y: ty };
        }
      }
    }
  }
  assert(placedStationTile !== null, 'Placed player bus stop near town0 for HQ bonus check');

  econEngine.grantDevFunds('personal', 3_500_000);
  const baseStationRating = econEngine.getState().stations[0].ratings.PASSENGERS;

  let hqPlaced = false;
  st = econEngine.getState();
  for (let r = 2; r <= 8 && !hqPlaced; r++) {
    for (let dy = -r; dy <= r && !hqPlaced; dy++) {
      for (let dx = -r; dx <= r && !hqPlaced; dx++) {
        const tx = town0.x + dx;
        const ty = town0.y + dy;
        if (tx < 0 || ty < 0 || tx >= st.mapSize || ty >= st.mapSize) continue;
        const corpBefore = econEngine.getState().corporate.cash;
        const persBefore = econEngine.getState().personal.cash;
        const res = econEngine.applyTool(tx, ty, 'PLACE_HQ');
        if (res.ok) {
          hqPlaced = true;
          const after = econEngine.getState();
          assertEq(
            after.corporate.cash,
            corpBefore,
            'HQ Tier 1 placement must NOT touch Corporate Cash'
          );
          assertEq(
            persBefore - after.personal.cash,
            HQ_TIERS[0].personalCost,
            'HQ Tier 1 deducts 25 000 kr strictly from Personal Cash'
          );
          assertEq(after.corporate.hqTier, 1, 'HQ tier is 1');
          assertEq(after.corporate.annualInterestRate, 6.5, 'HQ Tier 1 reduces interest to 6.5%');
          assertEq(
            getStationHQBonusPct(after.stations[0], after.corporate),
            5,
            'HQ Tier 1 grants +5% nearby station rating bonus'
          );
          assert(
            after.stations[0].ratings.PASSENGERS > baseStationRating,
            'Nearby station rating increased after HQ Tier 1 placement'
          );
        }
      }
    }
  }
  assert(hqPlaced, 'HQ Tier 1 placed on valid grass tile near town0');

  for (let targetTier = 2; targetTier <= 5; targetTier++) {
    const spec = HQ_TIERS[targetTier - 1];
    const corpBefore = econEngine.getState().corporate.cash;
    const persBefore = econEngine.getState().personal.cash;
    const upRes = econEngine.upgradeHQ();
    assert(upRes.ok, `HQ upgrade to Tier ${targetTier} succeeds`);
    const after = econEngine.getState();
    assertEq(
      after.corporate.cash,
      corpBefore,
      `HQ Tier ${targetTier} upgrade must NOT touch Corporate Cash`
    );
    assertEq(
      persBefore - after.personal.cash,
      spec.personalCost,
      `HQ Tier ${targetTier} deducts ${spec.personalCost} kr strictly from Personal Cash`
    );
    assertEq(after.corporate.hqTier, targetTier, `HQ tier is ${targetTier}`);
    assertEq(
      after.corporate.annualInterestRate,
      Number((7.0 - targetTier * 0.5).toFixed(2)),
      `HQ Tier ${targetTier} reduces loan interest by ${targetTier * 0.5}%`
    );
    assertEq(
      getStationHQBonusPct(after.stations[0], after.corporate),
      targetTier * 5,
      `HQ Tier ${targetTier} grants +${targetTier * 5}% nearby station rating bonus`
    );
  }

  console.log(
    '  [OK] Dual Economy separation, 60k salary tax brackets, negative-cash warning & HQ Tiers 1-5 verified.'
  );

  // =========================================================================
  // 4. Transport, Demo Routes, Rail Block Signals, Popups, Town & Secondary Industry
  // =========================================================================
  section('4. Transport Networks, Demo Routes, Block Signals, Popups & Industry Chains');

  const transportEngine = createGameEngine({ scenario: 'boom', mapSize: 64, seed: 20261112 });
  transportEngine.grantDevFunds('corporate', 3_000_000);

  const initialTownPops = new Map<string, number>(
    transportEngine.getState().towns.map((t) => [t.id, t.population])
  );

  const rCoal = transportEngine.spawnDemoRoute('coal_rail');
  assert(rCoal.ok, `spawnDemoRoute('coal_rail') succeeded: ${rCoal.message}`);

  const rWood = transportEngine.spawnDemoRoute('wood_truck');
  assert(rWood.ok, `spawnDemoRoute('wood_truck') succeeded: ${rWood.message}`);

  const rBus = transportEngine.spawnDemoRoute('bus_line');
  assert(rBus.ok, `spawnDemoRoute('bus_line') succeeded: ${rBus.message}`);

  // Confirm demo route stations ALSO start at 0 waiting cargo before ticks run!
  for (const stItem of transportEngine.getState().stations) {
    for (const c of ALL_CARGO_TYPES) {
      assertEq(
        stItem.waitingCargo[c],
        0,
        `Demo station ${stItem.name} must start with 0 waiting ${c}`
      );
    }
  }

  const signalTilesCount = transportEngine.getState().tiles.filter((t) => t.signal).length;
  assert(signalTilesCount > 0, `coal_rail built rail block signals (count=${signalTilesCount})`);

  let sawPopup = false;
  let sawSecondaryGoods = false;
  let totalMovedSteps = 0;

  const prevPositions = new Map<string, string>();
  for (const v of transportEngine.getState().vehicles) {
    prevPositions.set(v.id, `${v.x},${v.y}`);
  }

  // Step 150 game days (150 * 14 = 2100 sub-ticks at TTD pace)
  for (let step = 0; step < 150 * 14; step++) {
    transportEngine.tick(1);
    const cur = transportEngine.getState();

    const activeRailHeadPositions = new Map<string, string>();
    for (const v of cur.vehicles) {
      const tile = cur.tiles[tileIndex(v.x, v.y, cur.mapSize)];
      assert(
        isTileTraversableForNetwork(tile, v.network),
        `Vehicle ${v.name} at (${v.x},${v.y}) must stay on valid ${v.network} tile`
      );

      const posKey = `${v.x},${v.y}`;
      if (prevPositions.get(v.id) !== posKey) {
        totalMovedSteps++;
        prevPositions.set(v.id, posKey);
      }

      if (v.network === 'RAIL' && v.state !== 'IN_DEPOT' && !tile.depot) {
        const otherId = activeRailHeadPositions.get(posKey);
        assert(
          !otherId,
          `Rail collision detected at (${posKey}) between ${otherId} and ${v.id}!`
        );
        activeRailHeadPositions.set(posKey, v.id);
      }
    }

    if (cur.popups.some((p) => p.color === 'green' && p.text.startsWith('+kr '))) {
      sawPopup = true;
    }

    const sawmills = cur.industries.filter((i) => i.type === 'SAWMILL');
    const goodsInStations = cur.stations.some((s) => (s.waitingCargo.GOODS ?? 0) > 0);
    if (sawmills.some((m) => m.storedOutput > 0) || goodsInStations) {
      sawSecondaryGoods = true;
    }
  }

  const afterTransport = transportEngine.getState();
  assert(
    totalMovedSteps > 50,
    `Vehicles moved along road/rail networks (${totalMovedSteps} tile transitions)`
  );
  assert(
    afterTransport.corporate.currentYearPnL.freightRevenue > 0,
    `Cargo delivered and generated corporate freight revenue (${afterTransport.corporate.currentYearPnL.freightRevenue} kr)`
  );
  assert(sawPopup, 'Cargo deliveries generated rising green "+kr ..." FloatingPopups');
  assert(
    sawSecondaryGoods,
    'Delivering WOOD via wood_truck triggered SAWMILL secondary GOODS production'
  );

  const grownTowns = afterTransport.towns.filter(
    (t) => t.population > (initialTownPops.get(t.id) ?? t.population)
  );
  assert(
    grownTowns.length > 0,
    'Passenger deliveries on bus_line triggered town population growth'
  );

  // Explicit deterministic Rail Block-Signal wait verification on a straight single-track block
  const sigTestEngine = createGameEngine({ scenario: 'boom', mapSize: 64, seed: 777 });
  sigTestEngine.grantDevFunds('corporate', 5_000_000);
  const sigState = sigTestEngine.getState();

  let stripY = -1;
  let stripX = -1;
  for (let y = 6; y < sigState.mapSize - 6 && stripY === -1; y++) {
    for (let x = 6; x < sigState.mapSize - 18 && stripY === -1; x++) {
      let clear = true;
      for (let k = 0; k <= 10; k++) {
        const t = sigState.tiles[tileIndex(x + k, y, sigState.mapSize)];
        const tDepot = sigState.tiles[tileIndex(x + k, y + 1, sigState.mapSize)];
        if (
          t.terrain === 'WATER' ||
          t.road ||
          t.rail ||
          t.industryId ||
          t.stationId ||
          (t.buildingTier ?? 0) > 0 ||
          tDepot.terrain === 'WATER' ||
          tDepot.road ||
          tDepot.rail ||
          tDepot.industryId ||
          (tDepot.buildingTier ?? 0) > 0
        ) {
          clear = false;
          break;
        }
      }
      if (clear) {
        stripX = x;
        stripY = y;
      }
    }
  }
  assert(stripX !== -1, 'Found clear 11-tile strip for deterministic block-signal test');

  assert(
    sigTestEngine.applyDragTrackOrRoad(stripX, stripY, stripX + 10, stripY, 'RAIL').ok,
    'Laid 11-tile rail test track'
  );
  const stWest = sigTestEngine.applyTool(stripX, stripY, 'TRAIN_STATION');
  const stEast = sigTestEngine.applyTool(stripX + 10, stripY, 'TRAIN_STATION');
  assert(Boolean(stWest.ok && stEast.ok), 'Placed West & East rail stations');
  assert(
    sigTestEngine.applyTool(stripX + 1, stripY + 1, 'RAIL_DEPOT').ok,
    'Placed Rail Depot adjacent to track'
  );
  assert(
    sigTestEngine.applyTool(stripX + 4, stripY, 'SIGNAL').ok,
    'Placed Rail Block Signal at x+4'
  );

  const buyT1 = sigTestEngine.buyVehicle({
    depotX: stripX + 1,
    depotY: stripY + 1,
    modelId: 'LOCO_STEAM',
    orders: [stEast.stationId!, stWest.stationId!],
  });
  assert(buyT1.ok, 'Bought lead train T1');
  for (let i = 0; i < 160; i++) {
    sigTestEngine.tick(1);
    const t1 = sigTestEngine.getState().vehicles.find((v) => v.id === buyT1.vehicleId)!;
    if (t1.x >= stripX + 6 && t1.x <= stripX + 9) {
      sigTestEngine.toggleVehicleStopped(t1.id);
      break;
    }
  }
  const t1Stopped = sigTestEngine.getState().vehicles.find((v) => v.id === buyT1.vehicleId)!;
  assertEq(t1Stopped.state, 'STOPPED', 'Lead train T1 stopped inside block ahead of signal');

  const buyT2 = sigTestEngine.buyVehicle({
    depotX: stripX + 1,
    depotY: stripY + 1,
    modelId: 'LOCO_STEAM',
    orders: [stEast.stationId!, stWest.stationId!],
  });
  assert(buyT2.ok, 'Bought trailing train T2');

  let observedWaitingSignal = false;
  let observedRedSignalLamp = false;
  for (let i = 0; i < 160; i++) {
    sigTestEngine.tick(1);
    const s = sigTestEngine.getState();
    const t2 = s.vehicles.find((v) => v.id === buyT2.vehicleId)!;
    const sigTile = s.tiles[tileIndex(stripX + 4, stripY, s.mapSize)];
    if (t2.state === 'WAITING_SIGNAL') {
      observedWaitingSignal = true;
    }
    if (sigTile.signalBlocked) {
      observedRedSignalLamp = true;
    }
    assert(
      t2.x < t1Stopped.x,
      `Trailing train T2 (x=${t2.x}) must never pass or collide with stopped T1 (x=${t1Stopped.x})`
    );
  }
  assert(observedWaitingSignal, 'Trailing train entered WAITING_SIGNAL state before occupied block');
  assert(observedRedSignalLamp, 'Signal tile set signalBlocked = true while block occupied');

  console.log(
    '  [OK] Demo routes, 0-start platforms, rail block signals, popups, town growth & secondary industry verified.'
  );

  // =========================================================================
  // 5. Continuous TTD Heightfield Seam Continuity (Zero Hill "Hull")
  // =========================================================================
  section('5. Continuous Corner-Vertex Heightfield Seam & Slope Verification');

  const meshState = transportEngine.getState();
  let slopedTilesFound = 0;
  let waterClampedCorners = 0;

  for (let y = 0; y < meshState.mapSize; y++) {
    for (let x = 0; x < meshState.mapSize; x++) {
      const tile = meshState.tiles[tileIndex(x, y, meshState.mapSize)];
      const corners = getTileCornerHeights(meshState, x, y);
      if (corners.isSloped) slopedTilesFound++;

      if (tile.terrain === 'WATER' || tile.elevation <= 0) {
        assertEq(
          getCornerHeight(meshState, x, y),
          WATER_SURFACE_Y,
          `Water corner (${x},${y}) clamps to WATER_SURFACE_Y`
        );
        waterClampedCorners++;
      }

      // Check shared East edge seam between (x, y) and (x + 1, y)
      if (x + 1 < meshState.mapSize) {
        for (const offsetZ of [-0.35, 0.0, 0.35]) {
          const hLeft = getSurfaceHeightAt(meshState, x + 0.4999, y + offsetZ);
          const hRight = getSurfaceHeightAt(meshState, x + 0.5001, y + offsetZ);
          assert(
            Math.abs(hLeft - hRight) < 0.001,
            `Heightfield seam gap at East edge (${x}+0.5, ${y + offsetZ}): ${hLeft} vs ${hRight}`
          );
        }
      }

      // Check shared South edge seam between (x, y) and (x, y + 1)
      if (y + 1 < meshState.mapSize) {
        for (const offsetX of [-0.35, 0.0, 0.35]) {
          const hNorth = getSurfaceHeightAt(meshState, x + offsetX, y + 0.4999);
          const hSouth = getSurfaceHeightAt(meshState, x + offsetX, y + 0.5001);
          assert(
            Math.abs(hNorth - hSouth) < 0.001,
            `Heightfield seam gap at South edge (${x + offsetX}, ${y}+0.5): ${hNorth} vs ${hSouth}`
          );
        }
      }
    }
  }
  assert(slopedTilesFound > 100, `Map contains sloped hill tiles (${slopedTilesFound})`);
  assert(waterClampedCorners > 50, `Water coastline corners clamped cleanly (${waterClampedCorners})`);

  console.log(
    `  [OK] Watertight continuous heightfield verified across ${slopedTilesFound} sloped tiles with 0 seam gaps.`
  );

  // =========================================================================
  // 6. Staggered AI Competitors & Stock Market (Months 12, 24, 36)
  // =========================================================================
  section('6. Staggered AI Competitors (Months 12, 24, 36) & Stock Exchange');

  const aiEngine = createGameEngine({ scenario: 'standard', mapSize: 64, seed: 20261112 });

  aiEngine.fastForwardMonths(11);
  let aiState = aiEngine.getState();
  assertEq(aiState.date.totalMonths, 11, 'Advanced to Month 11 (Year 1)');
  assert(
    aiState.aiCompanies.every((a) => !a.spawned),
    'Zero AI competitors may spawn during Year 1 (Months 0..11)'
  );

  aiEngine.fastForwardMonths(1);
  aiState = aiEngine.getState();
  assertEq(aiState.date.totalMonths, 12, 'Reached Month 12 (Start of Year 2)');
  const ai1 = aiState.aiCompanies.find((a) => a.id === 'ai-1')!;
  const ai2At12 = aiState.aiCompanies.find((a) => a.id === 'ai-2')!;
  const ai3At12 = aiState.aiCompanies.find((a) => a.id === 'ai-3')!;
  assertEq(ai1.name, 'Nordic Rail & Cargo', 'ai-1 is Nordic Rail & Cargo');
  assert(ai1.spawned, 'Nordic Rail & Cargo spawned at Month 12');
  assert(ai1.fleetCount > 0 && ai1.sharePrice > 0, 'Nordic Rail & Cargo built routes and listed shares');
  assert(!ai2At12.spawned && !ai3At12.spawned, 'ai-2 and ai-3 remain unspawned at Month 12');

  aiEngine.fastForwardMonths(12);
  aiState = aiEngine.getState();
  assertEq(aiState.date.totalMonths, 24, 'Reached Month 24 (Start of Year 3)');
  const ai2 = aiState.aiCompanies.find((a) => a.id === 'ai-2')!;
  const ai3At24 = aiState.aiCompanies.find((a) => a.id === 'ai-3')!;
  assertEq(ai2.name, 'FjordExpress AS', 'ai-2 is FjordExpress AS');
  assert(ai2.spawned && ai2.fleetCount > 0 && ai2.sharePrice > 0, 'FjordExpress AS spawned & built routes at Month 24');
  assert(!ai3At24.spawned, 'ai-3 remains unspawned at Month 24');

  aiEngine.fastForwardMonths(12);
  aiState = aiEngine.getState();
  assertEq(aiState.date.totalMonths, 36, 'Reached Month 36 (Start of Year 4)');
  const ai3 = aiState.aiCompanies.find((a) => a.id === 'ai-3')!;
  assertEq(ai3.name, 'Sørlandet Transport', 'ai-3 is Sørlandet Transport');
  assert(ai3.spawned && ai3.fleetCount > 0 && ai3.sharePrice > 0, 'Sørlandet Transport spawned & built routes at Month 36');

  aiEngine.setMonthlyGrossSalary(0);
  aiEngine.grantDevFunds('personal', 25_000_000);

  const corpCashBeforeStocks = aiEngine.getState().corporate.cash;
  const persCashBeforeBuy = aiEngine.getState().personal.cash;
  const sharePrice1 = aiEngine.getState().aiCompanies.find((a) => a.id === 'ai-1')!.sharePrice;
  const expectedBlockCost = Math.round(0.1 * TOTAL_AI_SHARES) * sharePrice1;

  const firstBuy = aiEngine.buyAIShares('ai-1', 10);
  assert(firstBuy.ok, 'Bought first 10% share block in Nordic Rail & Cargo');
  assertEq(
    aiEngine.getState().corporate.cash,
    corpCashBeforeStocks,
    'Buying AI shares must NOT touch Corporate Cash'
  );
  assertEq(
    persCashBeforeBuy - aiEngine.getState().personal.cash,
    expectedBlockCost,
    'Buying 10% AI shares deducts exact share block cost from Personal Cash'
  );

  for (let b = 2; b <= 7; b++) {
    const r = aiEngine.buyAIShares('ai-1', 10);
    assert(r.ok, `Buying 10% block #${b} (to ${b * 10}%) succeeds`);
  }
  assertEq(
    aiEngine.getState().aiCompanies.find((a) => a.id === 'ai-1')!.playerSharesPct,
    70,
    'Player holds 70% of ai-1 after 7 blocks'
  );

  const overCapBuy = aiEngine.buyAIShares('ai-1', 10);
  assert(!overCapBuy.ok, 'Buying 10% beyond 75% max stake (to 80%) is rejected');

  const exactCapBuy = aiEngine.buyAIShares('ai-1', 5);
  assert(exactCapBuy.ok, 'Buying up to exact 75% cap succeeds');
  assertEq(
    aiEngine.getState().aiCompanies.find((a) => a.id === 'ai-1')!.playerSharesPct,
    75,
    'Player stake capped at 75%'
  );
  assert(!aiEngine.buyAIShares('ai-1', 5).ok, 'Cannot buy above 75% cap');

  const persBeforeSell = aiEngine.getState().personal.cash;
  const sellRes = aiEngine.sellAIShares('ai-1', 10);
  assert(sellRes.ok, 'Selling 10% share block succeeds');
  assert(
    aiEngine.getState().personal.cash > persBeforeSell,
    'Selling AI shares credits proceeds to Personal Cash'
  );
  assertEq(
    aiEngine.getState().corporate.cash,
    corpCashBeforeStocks,
    'Selling AI shares must NOT touch Corporate Cash'
  );

  aiEngine.buyAIShares('ai-2', 50);
  aiEngine.buyAIShares('ai-3', 50);
  const persBeforeQuarter = aiEngine.getState().personal.cash;
  const divsBeforeQuarter = aiEngine.getState().personal.dividendsReceivedTotal;

  aiEngine.fastForwardMonths(3);
  const afterQuarter = aiEngine.getState();
  const divsEarned = afterQuarter.personal.dividendsReceivedTotal - divsBeforeQuarter;
  assert(divsEarned > 0, `Quarterly AI dividends paid (${divsEarned} kr)`);
  assertEq(
    afterQuarter.personal.cash - persBeforeQuarter,
    divsEarned,
    'Quarterly dividends credited 100% to Personal Cash'
  );

  console.log(
    '  [OK] Staggered AI spawns (Months 12/24/36), 75% stock ownership cap & quarterly personal dividends verified.'
  );

  // =========================================================================
  // 7. Firebase Config, Firestore Rules & Classroom Telemetry Contract
  // =========================================================================
  section('7. Firebase Config, Firestore Rules & Classroom Module');

  const rootDir = path.resolve(process.cwd());
  const rulesPath = path.join(rootDir, 'firestore.rules');
  const firebaseJsonPath = path.join(rootDir, 'firebase.json');

  assert(fs.existsSync(rulesPath), 'firestore.rules exists on disk');
  assert(fs.existsSync(firebaseJsonPath), 'firebase.json exists on disk');

  const rulesText = fs.readFileSync(rulesPath, 'utf8');
  assert(
    rulesText.includes('match /classrooms/{pin}') &&
      rulesText.includes('match /students/{studentId}') &&
      rulesText.includes('allow read, write: if false;'),
    'firestore.rules validates /classrooms/{pin} + /students/{studentId} and locks down arbitrary collections'
  );

  assert(hasValidFirebaseConfig, 'Firebase SDK config has valid non-placeholder keys');
  assert(Boolean(firebaseConfig.projectId), `Firebase projectId configured (${firebaseConfig.projectId})`);
  assert(isFirebaseConfigured(), 'isFirebaseConfigured() returns true');
  assert(typeof createClassroomSession === 'function', 'createClassroomSession exported');
  assert(typeof joinClassroomSession === 'function', 'joinClassroomSession exported');
  assert(typeof pushStudentTelemetry === 'function', 'pushStudentTelemetry exported');
  assert(typeof subscribeToClassroom === 'function', 'subscribeToClassroom exported');

  const exportedJson = aiEngine.exportSaveJson();
  const roundtripEngine = new GameEngine();
  const importRes = roundtripEngine.importSaveJson(exportedJson);
  assert(importRes.ok, 'Save JSON export/import roundtrip succeeded');
  assertEq(
    roundtripEngine.getState().date.totalMonths,
    aiEngine.getState().date.totalMonths,
    'Imported save preserves game calendar state'
  );

  console.log('  [OK] Firebase configuration, firestore.rules, Classroom exports & Save JSON roundtrip verified.');

  // =========================================================================
  // 8. Round 3 OpenGFX 3D Renderers Headless Integration & Disposal
  // =========================================================================
  section('8. Round 3 OpenGFX 3D Renderers (Terrain, Buildings & Vehicles) Headless QA');

  // Upgrade HQ on transportEngine across Tiers 1..5 and exercise all 3 OpenGFX renderers headlessly
  transportEngine.grantDevFunds('personal', 5_000_000);
  const terrainInstancer = new TerrainInstancer();
  const structuresRenderer = new StructuresRenderer(null as unknown as HTMLElement);
  const vehicleRenderer = new VehicleRenderer();

  for (let hqStep = 1; hqStep <= 5; hqStep++) {
    transportEngine.upgradeHQ();
    const gfxState = transportEngine.getState();
    terrainInstancer.sync(gfxState);
    terrainInstancer.updateWaterAnimation(hqStep * 0.5);
    structuresRenderer.sync(gfxState);
    structuresRenderer.updateAnimation(hqStep * 0.5, 0.016);
    vehicleRenderer.update(gfxState, 0.016, hqStep * 500);
  }

  assert(
    terrainInstancer.group.children.length > 0,
    'TerrainInstancer populated 3D terrain, trees, roads, level crossings & rails'
  );
  assert(
    structuresRenderer.group.children.length > 0,
    'StructuresRenderer populated OpenGFX buildings, industries, stations, signals & HQ'
  );
  assert(
    vehicleRenderer.group.children.length > 0,
    'VehicleRenderer populated OpenGFX locomotives, cargo wagons, buses & trucks'
  );

  terrainInstancer.dispose();
  structuresRenderer.dispose();
  vehicleRenderer.dispose();

  console.log('  [OK] TerrainInstancer, StructuresRenderer & VehicleRenderer synced, animated & disposed cleanly.');

  // =========================================================================
  // 9. Round 4 Station Supplied Cargos, Clean Zero Ratings & Rival AI Inspection
  // =========================================================================
  section('9. Round 4 Station Supplied Cargos, Clean Zero Ratings & Rival AI getStationDetails QA');

  // 9a. StationKind <-> CargoType compatibility rules
  assert(
    isCargoCompatibleWithStationKind('BUS_STOP', 'PASSENGERS'),
    'BUS_STOP is compatible with PASSENGERS'
  );
  for (const freightCargo of ['MAIL', 'COAL', 'WOOD', 'GRAIN', 'GOODS', 'FOOD'] as const) {
    assert(
      !isCargoCompatibleWithStationKind('BUS_STOP', freightCargo),
      `BUS_STOP excludes irrelevant cargo ${freightCargo}`
    );
    assert(
      isCargoCompatibleWithStationKind('TRUCK_BAY', freightCargo),
      `TRUCK_BAY is compatible with freight cargo ${freightCargo}`
    );
  }
  assert(
    !isCargoCompatibleWithStationKind('TRUCK_BAY', 'PASSENGERS'),
    'TRUCK_BAY excludes PASSENGERS'
  );
  for (const anyCargo of ALL_CARGO_TYPES) {
    assert(
      isCargoCompatibleWithStationKind('TRAIN_STATION', anyCargo),
      `TRAIN_STATION is compatible with ${anyCargo}`
    );
  }

  // 9b. Player BUS_STOP & TRUCK_BAY station details + clean zero ratings on un-supplied cargos
  assertEq(
    transportEngine.getStationDetails('non-existent-station-id'),
    null,
    'getStationDetails returns null for unknown stationId'
  );

  const r4TransportState = transportEngine.getState();
  const playerBusStop = r4TransportState.stations.find(
    (st) => st.ownerId === 'player' && st.kind === 'BUS_STOP' && st.townId !== null
  );
  assert(Boolean(playerBusStop), 'Found player town BUS_STOP on transportEngine');

  const busSupplied = getStationSuppliedCargos(r4TransportState, playerBusStop!);
  assertEq(busSupplied.length, 1, 'Town BUS_STOP supplies exactly 1 cargo type');
  assertEq(busSupplied[0], 'PASSENGERS', 'Town BUS_STOP supplied cargo is PASSENGERS');

  const playerBusDetails = transportEngine.getStationDetails(playerBusStop!.id);
  assert(playerBusDetails !== null, 'getStationDetails returned details for player BUS_STOP');
  assertEq(playerBusDetails.isPlayerOwned, true, 'Player BUS_STOP isPlayerOwned === true');
  assertEq(playerBusDetails.ownerId, 'player', 'Player BUS_STOP ownerId === player');
  assertEq(
    playerBusDetails.ownerName,
    r4TransportState.corporate.companyName,
    'Player BUS_STOP ownerName matches corporate.companyName'
  );
  assertEq(playerBusDetails.suppliedCargos.length, 1, 'Player BUS_STOP details suppliedCargos length === 1');
  assertEq(playerBusDetails.suppliedCargos[0], 'PASSENGERS', 'Player BUS_STOP details suppliedCargos[0] === PASSENGERS');
  assert(
    playerBusDetails.acceptedCargos.some((a) => a.cargo === 'PASSENGERS' && a.sourceName.length > 0),
    'Player BUS_STOP acceptedCargos lists PASSENGERS with town sourceName'
  );
  assert(
    playerBusDetails.servicingVehicles.length > 0,
    'Player BUS_STOP lists servicing bus vehicles'
  );
  assert(
    playerBusDetails.station.ratings.PASSENGERS > 0,
    `Player BUS_STOP has positive PASSENGERS rating (${playerBusDetails.station.ratings.PASSENGERS}%)`
  );
  for (const nonBusCargo of ['COAL', 'WOOD', 'GRAIN', 'GOODS', 'FOOD', 'MAIL'] as const) {
    assertEq(
      playerBusDetails.station.ratings[nonBusCargo],
      0,
      `Player BUS_STOP has clean 0 rating on un-supplied cargo ${nonBusCargo}`
    );
  }

  const playerWoodTruckBay = r4TransportState.stations.find(
    (st) =>
      st.ownerId === 'player' &&
      st.kind === 'TRUCK_BAY' &&
      getStationSuppliedCargos(r4TransportState, st).includes('WOOD')
  );
  assert(Boolean(playerWoodTruckBay), 'Found player forest WOOD TRUCK_BAY on transportEngine');
  const playerTruckDetails = transportEngine.getStationDetails(playerWoodTruckBay!.id);
  assert(playerTruckDetails !== null, 'getStationDetails returned details for player WOOD TRUCK_BAY');
  assert(
    !playerTruckDetails.suppliedCargos.includes('PASSENGERS'),
    'Player TRUCK_BAY suppliedCargos excludes PASSENGERS'
  );
  assertEq(
    playerTruckDetails.station.ratings.PASSENGERS,
    0,
    'Player TRUCK_BAY has 0 PASSENGERS rating'
  );
  for (const cargo of ALL_CARGO_TYPES) {
    if (playerTruckDetails.suppliedCargos.includes(cargo)) {
      assert(
        playerTruckDetails.station.ratings[cargo] > 0,
        `Player TRUCK_BAY supplied cargo ${cargo} has positive rating`
      );
    } else {
      assertEq(
        playerTruckDetails.station.ratings[cargo],
        0,
        `Player TRUCK_BAY un-supplied cargo ${cargo} has 0 rating`
      );
    }
  }

  // 9c. Rival AI Competitor stations inspection via getStationDetails
  const r4AiState = aiEngine.getState();
  const aiStations = r4AiState.stations.filter((st) => st.ownerId !== 'player');
  assert(
    aiStations.length >= 2,
    `Rival AI companies built inspectable stations (found ${aiStations.length})`
  );

  let aiStationsWithVehicles = 0;
  for (const aiSt of aiStations) {
    const aiDetails = aiEngine.getStationDetails(aiSt.id);
    assert(aiDetails !== null, `getStationDetails returned details for rival station ${aiSt.id}`);
    assertEq(aiDetails.isPlayerOwned, false, `Rival station ${aiSt.name} has isPlayerOwned === false`);
    assertEq(aiDetails.ownerId, aiSt.ownerId, `Rival station ${aiSt.name} preserves AI ownerId`);
    const matchingAiCompany = r4AiState.aiCompanies.find((c) => c.id === aiSt.ownerId);
    assert(Boolean(matchingAiCompany), `Rival station ${aiSt.name} owner exists in aiCompanies`);
    assertEq(
      aiDetails.ownerName,
      matchingAiCompany!.name,
      `Rival station ${aiSt.name} ownerName matches AI company name (${matchingAiCompany!.name})`
    );
    assert(
      aiDetails.ownerColor.startsWith('#'),
      `Rival station ${aiSt.name} has valid hex ownerColor (${aiDetails.ownerColor})`
    );
    assertEq(
      aiDetails.hqBonusPct,
      0,
      `Rival station ${aiSt.name} does not receive player HQ bonus`
    );

    if (aiDetails.servicingVehicles.length > 0) {
      aiStationsWithVehicles++;
      for (const rv of aiDetails.servicingVehicles) {
        assertEq(
          rv.ownerId,
          aiSt.ownerId,
          `Servicing vehicle ${rv.name} at rival station belongs to ${aiSt.ownerId}`
        );
      }
    }

    for (const cargo of ALL_CARGO_TYPES) {
      if (aiDetails.suppliedCargos.includes(cargo)) {
        assert(
          aiDetails.station.ratings[cargo] > 0,
          `Rival station ${aiSt.name} supplied cargo ${cargo} has positive rating`
        );
      } else {
        assertEq(
          aiDetails.station.ratings[cargo],
          0,
          `Rival station ${aiSt.name} un-supplied cargo ${cargo} has 0 rating`
        );
      }
    }
  }
  assert(
    aiStationsWithVehicles > 0,
    `At least one rival AI station has active servicing vehicles (${aiStationsWithVehicles}/${aiStations.length})`
  );

  console.log(
    `  [OK] Verified getStationSuppliedCargos, 0-rating cleanup & getStationDetails across player + ${aiStations.length} rival AI stations.`
  );

  // =========================================================================
  // 10. Round 5 Bridges, Large Maps (128/160), WorldSetup, Multiplayer & Auth QA
  // =========================================================================
  section('10. Round 5 Bridges, Large Maps (128/160), WorldSetup, Multiplayer & Auth QA');

  // 10a. Bridge build costs, ROAD_BRIDGE, RAIL_BRIDGE, auto-bridge on straight drag,
  //      getTravelSurfaceHeightAt, bulldoze revert, and cargo delivery across a water bridge
  assertEq(BUILD_COSTS.ROAD_BRIDGE, 13_500, 'BUILD_COSTS.ROAD_BRIDGE === 13 500 kr (STEEL default)');
  assertEq(BUILD_COSTS.RAIL_BRIDGE, 19_000, 'BUILD_COSTS.RAIL_BRIDGE === 19 000 kr (STEEL default)');
  assert(
    BUILD_COSTS.ROAD_BRIDGE > BUILD_COSTS.ROAD,
    'ROAD_BRIDGE is more expensive than normal ROAD'
  );
  assert(
    BUILD_COSTS.RAIL_BRIDGE > BUILD_COSTS.RAIL,
    'RAIL_BRIDGE is more expensive than normal RAIL'
  );

  const bridgeEngine = new GameEngine({
    worldSetup: {
      mapSize: 64,
      terrainType: 'flat',
      waterLevel: 'low',
      aiEnabled: false,
      maxAiCount: 0,
      seed: 20260501,
    },
  });
  bridgeEngine.grantDevFunds('corporate', 5_000_000);
  const brState = bridgeEngine.getState();

  // Carve a deterministic clear corridor in rows y=20..24, x=18..34 with a 3-tile water channel at x=25..27
  for (let cy = 19; cy <= 25; cy++) {
    for (let cx = 16; cx <= 36; cx++) {
      const t = brState.tiles[tileIndex(cx, cy, brState.mapSize)];
      t.industryId = undefined;
      t.townId = undefined;
      t.buildingTier = undefined;
      t.stationId = undefined;
      t.depot = null;
      t.hqOwnerId = null;
      t.ownerId = null;
      t.road = false;
      t.rail = false;
      t.signal = false;
      t.bridge = null;
      t.bridgeAxis = undefined;
      t.bridgeType = null;
      t.bridgeElevation = undefined;
      if (cx >= 25 && cx <= 27) {
        t.terrain = 'WATER';
        t.elevation = 0;
      } else {
        t.terrain = 'GRASS';
        t.elevation = 1;
      }
    }
  }

  // Test explicit ROAD_BRIDGE drag from shore x=24 to shore x=28 at y=20 (3 water tiles + 2 shore tiles)
  const roadBridgePreview = bridgeEngine.previewDragPath(24, 20, 28, 20, 'ROAD_BRIDGE');
  assertEq(
    roadBridgePreview.tiles.length,
    5,
    'ROAD_BRIDGE preview spans 3 water tiles + 2 shore approach tiles'
  );
  assertEq(
    roadBridgePreview.bridgeTileCount,
    3,
    'ROAD_BRIDGE preview bridgeTileCount === 3'
  );
  assertEq(
    roadBridgePreview.cost,
    3 * BUILD_COSTS.ROAD_BRIDGE + 2 * BUILD_COSTS.ROAD,
    'ROAD_BRIDGE preview cost equals 3 * 13 500 + 2 * 2 500 = 45 500 kr'
  );

  const cashBeforeRoadBridge = bridgeEngine.getState().corporate.cash;
  const buildRoadBridgeRes = bridgeEngine.applyDragTrackOrRoad(24, 20, 28, 20, 'ROAD_BRIDGE');
  assert(buildRoadBridgeRes.ok, `Explicit ROAD_BRIDGE succeeded: ${buildRoadBridgeRes.message}`);
  assertEq(
    cashBeforeRoadBridge - bridgeEngine.getState().corporate.cash,
    45_500,
    'Explicit ROAD_BRIDGE deducted exact 45 500 kr from corporate cash'
  );

  for (const wx of [25, 26, 27]) {
    const wt = bridgeEngine.getState().tiles[tileIndex(wx, 20, 64)];
    assertEq(wt.terrain, 'WATER', `Road bridge tile (${wx},20) stays WATER underneath`);
    assertEq(wt.bridge, 'ROAD', `Road bridge tile (${wx},20) sets bridge === 'ROAD'`);
    assertEq(wt.bridgeAxis, 'X', `Road bridge tile (${wx},20) sets bridgeAxis === 'X'`);
    assert(wt.road === true && !wt.rail, `Road bridge tile (${wx},20) enables road only`);
    assertNear(
      getTravelSurfaceHeightAt(bridgeEngine.getState(), wx, 20),
      BRIDGE_DECK_Y,
      1e-5,
      `getTravelSurfaceHeightAt on road bridge tile (${wx},20) equals BRIDGE_DECK_Y`
    );
  }
  assert(
    BRIDGE_DECK_Y > WATER_SURFACE_Y + 0.15,
    `BRIDGE_DECK_Y (${BRIDGE_DECK_Y.toFixed(3)}) is elevated well above WATER_SURFACE_Y (${WATER_SURFACE_Y})`
  );

  // Verify level-1 shore approach stays seamlessly flat at BRIDGE_DECK_Y === ELEV_STEP (zero dip/hump)
  const shoreCenterY = getTravelSurfaceHeightAt(bridgeEngine.getState(), 24, 20);
  const shoreMidRampY = getTravelSurfaceHeightAt(bridgeEngine.getState(), 24.25, 20);
  const shoreEdgeY = getTravelSurfaceHeightAt(bridgeEngine.getState(), 24.49, 20);
  assertNear(shoreCenterY, BRIDGE_DECK_Y, 1e-4, 'Level-1 shore center matches BRIDGE_DECK_Y');
  assertNear(shoreMidRampY, BRIDGE_DECK_Y, 1e-4, 'Level-1 shore mid-tile matches BRIDGE_DECK_Y');
  assertNear(shoreEdgeY, BRIDGE_DECK_Y, 1e-4, 'Level-1 shore water edge matches BRIDGE_DECK_Y');

  // Verify bulldozing water bridge tiles cleanly reverts to plain WATER
  for (const wx of [25, 26, 27]) {
    const bullRes = bridgeEngine.applyTool(wx, 20, 'BULLDOZE');
    assert(bullRes.ok, `BULLDOZE removed road bridge tile (${wx},20)`);
    const reverted = bridgeEngine.getState().tiles[tileIndex(wx, 20, 64)];
    assertEq(reverted.terrain, 'WATER', `Bulldozed bridge tile (${wx},20) reverted to WATER`);
    assert(!reverted.bridge, `Bulldozed bridge tile (${wx},20) cleared tile.bridge`);
    assert(!reverted.bridgeType, `Bulldozed bridge tile (${wx},20) cleared tile.bridgeType`);
    assert(!reverted.road && !reverted.rail, `Bulldozed bridge tile (${wx},20) cleared road/rail`);
  }

  // Test explicit RAIL_BRIDGE on row y=21 AND auto-bridge via straight RAIL drag on row y=22!
  const explicitRailBridgeRes = bridgeEngine.applyDragTrackOrRoad(24, 21, 28, 21, 'RAIL_BRIDGE');
  assert(explicitRailBridgeRes.ok, `Explicit RAIL_BRIDGE succeeded: ${explicitRailBridgeRes.message}`);
  assertEq(
    explicitRailBridgeRes.cost,
    3 * BUILD_COSTS.RAIL_BRIDGE + 2 * BUILD_COSTS.RAIL,
    'Explicit RAIL_BRIDGE cost === 3 * 19 000 + 2 * 4 500 = 66 000 kr'
  );

  // Auto-bridge: dragging plain 'RAIL' straight from (20,22) on west bank to (32,22) on east bank across water x=25..27!
  const autoRailBridgeRes = bridgeEngine.applyDragTrackOrRoad(20, 22, 32, 22, 'RAIL');
  assert(autoRailBridgeRes.ok, `Auto-bridge straight RAIL drag succeeded: ${autoRailBridgeRes.message}`);
  for (const wx of [25, 26, 27]) {
    const rbt = bridgeEngine.getState().tiles[tileIndex(wx, 22, 64)];
    assertEq(rbt.bridge, 'RAIL', `Auto-bridge tile (${wx},22) set bridge === 'RAIL'`);
    assertEq(rbt.bridgeAxis, 'X', `Auto-bridge tile (${wx},22) set bridgeAxis === 'X'`);
    assert(rbt.rail === true && !rbt.road, `Auto-bridge tile (${wx},22) has rail === true`);
  }

  // Verify signals and stations are forbidden on water bridge tiles, and 90-degree turns mid-water are blocked
  const sigOnBridgeRes = bridgeEngine.applyTool(26, 22, 'SIGNAL');
  assert(!sigOnBridgeRes.ok, 'Placing SIGNAL on a water bridge tile is properly rejected');
  const stOnBridgeRes = bridgeEngine.applyTool(26, 22, 'TRAIN_STATION');
  assert(!stOnBridgeRes.ok, 'Placing TRAIN_STATION on a water bridge tile is properly rejected');
  // Mid-bridge 90-degree jump from row 21 bridge (26,21) directly to row 22 bridge (26,22) must NOT occur:
  // Any route from (26,21) to (26,22) must exit to dry shore first (length >= 5), never a 1-step Y jump!
  const midBridgeDetour = findNetworkPath(
    bridgeEngine.getState().tiles,
    64,
    26,
    21,
    [{ x: 26, y: 22 }],
    'RAIL'
  );
  assert(
    midBridgeDetour.length >= 5 && !(midBridgeDetour[0].x === 26 && midBridgeDetour[0].y === 22),
    'Pathfinder forbids 90-degree turns between adjacent parallel bridges in mid-water'
  );

  // End-to-end train pathfinding & cargo delivery across the water rail bridge at y=22!
  // Place synthetic town/industry anchors on west shore (x=19,y=21) and east shore (x=33,y=21)
  const westTown = bridgeEngine.getState().towns[0];
  const eastTown = bridgeEngine.getState().towns[1];
  assert(Boolean(westTown && eastTown), 'Bridge test engine has at least 2 towns');
  bridgeEngine.getState().tiles[tileIndex(19, 21, 64)].townId = westTown.id;
  bridgeEngine.getState().tiles[tileIndex(19, 21, 64)].buildingTier = 2;
  bridgeEngine.getState().tiles[tileIndex(33, 21, 64)].townId = eastTown.id;
  bridgeEngine.getState().tiles[tileIndex(33, 21, 64)].buildingTier = 2;

  const westStRes = bridgeEngine.applyTool(19, 22, 'TRAIN_STATION', {
    stationLength: 1,
    orientation: 'X',
  });
  const eastStRes = bridgeEngine.applyTool(33, 22, 'TRAIN_STATION', {
    stationLength: 1,
    orientation: 'X',
  });
  const bridgeDepotRes = bridgeEngine.applyTool(20, 23, 'RAIL_DEPOT');
  assert(
    westStRes.ok && eastStRes.ok && bridgeDepotRes.ok,
    'Built west & east train stations + rail depot linked only by the water bridge'
  );

  const bridgePathCheck = findNetworkPath(
    bridgeEngine.getState().tiles,
    64,
    19,
    22,
    [{ x: 33, y: 22 }],
    'RAIL'
  );
  assert(
    bridgePathCheck.length > 0 && bridgePathCheck.some((pt) => pt.x === 26 && pt.y === 22),
    'A* rail pathfinder routes across water bridge tile (26,22)'
  );

  // Seed waiting passengers at west station so train loads and delivers across the fjord bridge
  const westStationObj = bridgeEngine
    .getState()
    .stations.find((s) => s.id === westStRes.stationId)!;
  westStationObj.waitingCargo.PASSENGERS = 60;

  const buyBridgeTrain = bridgeEngine.buyVehicle({
    depotX: 20,
    depotY: 23,
    modelId: 'LOCO_DIESEL',
    cargoType: 'PASSENGERS',
    wagonCount: 2,
    orders: [westStRes.stationId!, eastStRes.stationId!],
  });
  assert(buyBridgeTrain.ok && Boolean(buyBridgeTrain.vehicleId), 'Purchased train for bridge crossing test');

  const bridgeVehRenderer = new VehicleRenderer();
  let trainCrossedWaterBridge = false;
  let maxBridgeVehicleMeshY = 0;

  for (let sub = 0; sub < 60 * 14; sub++) {
    bridgeEngine.tick(1);
    const curState = bridgeEngine.getState();
    const tr = curState.vehicles.find((v) => v.id === buyBridgeTrain.vehicleId)!;
    const curTileX = Math.round(tr.x + (tr.nextX - tr.x) * tr.progress);
    const curTileY = Math.round(tr.y + (tr.nextY - tr.y) * tr.progress);
    if (curTileX >= 25 && curTileX <= 27 && curTileY === 22) {
      trainCrossedWaterBridge = true;
      bridgeVehRenderer.update(curState, 0.016, sub * 50);
      for (const vehRoot of bridgeVehRenderer.group.children) {
        for (const subPart of vehRoot.children) {
          if (subPart.position.x >= 24.5 && subPart.position.x <= 27.5 && subPart.position.y > maxBridgeVehicleMeshY) {
            maxBridgeVehicleMeshY = subPart.position.y;
          }
        }
      }
    }
  }
  bridgeVehRenderer.dispose();

  assert(trainCrossedWaterBridge, 'Train physically traversed water bridge tiles (25..27, 22)');
  assert(
    maxBridgeVehicleMeshY >= BRIDGE_DECK_Y,
    `VehicleRenderer posed train elevated on bridge deck (y=${maxBridgeVehicleMeshY.toFixed(3)} >= BRIDGE_DECK_Y=${BRIDGE_DECK_Y.toFixed(3)})`
  );
  assert(
    bridgeEngine.getState().corporate.currentYearPnL.freightRevenue > 0,
    `Train delivered passengers across water bridge and earned freight revenue (${bridgeEngine.getState().corporate.currentYearPnL.freightRevenue} kr)`
  );

  // 10b. Large maps (128x128 & 160x160), terrainType, waterLevel, aiEnabled: false, and Multiplayer sync
  assert(
    NORWEGIAN_TOWN_NAMES.length >= 24,
    `NORWEGIAN_TOWN_NAMES expanded to >= 24 cities (${NORWEGIAN_TOWN_NAMES.length})`
  );

  const map128Engine = new GameEngine({
    worldSetup: {
      mapSize: 128,
      terrainType: 'flat',
      waterLevel: 'very_low',
      townDensity: 'normal',
      industryDensity: 'normal',
      startYear: 1980,
      aiEnabled: false,
      maxAiCount: 0,
      seed: 20261280,
    },
  });
  const s128 = map128Engine.getState();
  assertEq(s128.mapSize, 128, '128x128 world has mapSize === 128');
  assertEq(s128.tiles.length, 128 * 128, '128x128 world has 16,384 tiles');
  assertEq(s128.date.calendarYear, 1980, 'startYear 1980 sets date.calendarYear === 1980');

  const map160Engine = new GameEngine({
    worldSetup: {
      mapSize: 160,
      terrainType: 'mountainous',
      waterLevel: 'high',
      townDensity: 'high',
      industryDensity: 'high',
      startYear: 2000,
      aiEnabled: true,
      maxAiCount: 2,
      seed: 20261600,
    },
  });
  const s160 = map160Engine.getState();
  assertEq(s160.mapSize, 160, '160x160 world has mapSize === 160');
  assertEq(s160.tiles.length, 160 * 160, '160x160 world has 25,600 tiles');
  assert(
    s160.towns.length > s128.towns.length && s160.towns.length >= 16,
    `160x160 high-density world scales up towns (${s160.towns.length} towns)`
  );
  assert(
    s160.industries.length >= 18,
    `160x160 high-density world scales up industries (${s160.industries.length} industries)`
  );

  const maxElevFlat = s128.tiles.reduce((m, t) => Math.max(m, t.elevation), 0);
  const maxElevMountainous = s160.tiles.reduce((m, t) => Math.max(m, t.elevation), 0);
  assert(
    maxElevMountainous > maxElevFlat,
    `Mountainous terrain max elevation (${maxElevMountainous}) > flat terrain max elevation (${maxElevFlat})`
  );

  const waterPctVeryLow =
    s128.tiles.filter((t) => t.terrain === 'WATER').length / s128.tiles.length;
  const waterPctHigh =
    s160.tiles.filter((t) => t.terrain === 'WATER').length / s160.tiles.length;
  assert(
    waterPctHigh > waterPctVeryLow,
    `High waterLevel ratio (${(waterPctHigh * 100).toFixed(1)}%) > very_low ratio (${(waterPctVeryLow * 100).toFixed(1)}%)`
  );

  // Verify TerrainInstancer handles 160x160 map without buffer overflow
  const largeTerrainInstancer = new TerrainInstancer();
  largeTerrainInstancer.sync(s160);
  assert(
    largeTerrainInstancer.group.children.length > 0,
    'TerrainInstancer synced 160x160 map (25,600 tiles) cleanly'
  );
  largeTerrainInstancer.dispose();

  // Verify aiEnabled: false spawns ZERO AI competitors even after 38 months!
  const noAiEngine = new GameEngine({
    worldSetup: {
      mapSize: 64,
      aiEnabled: false,
      maxAiCount: 0,
      seed: 20269999,
    },
  });
  noAiEngine.fastForwardMonths(38);
  assertEq(
    noAiEngine.getState().aiCompanies.length,
    0,
    'aiEnabled: false keeps 0 AI companies even after 38 game months'
  );

  // Verify maxAiCount: 1 caps AI spawns at 1 company even past Month 36
  const oneAiEngine = new GameEngine({
    worldSetup: {
      mapSize: 64,
      aiEnabled: true,
      maxAiCount: 1,
      seed: 20269998,
    },
  });
  oneAiEngine.fastForwardMonths(37);
  assertEq(
    oneAiEngine.getState().aiCompanies.length,
    1,
    'maxAiCount: 1 spawns exactly 1 AI company after 37 months'
  );

  // Verify Multiplayer Shared-World Peer Sync (setLocalPlayerIdentity, exportMultiplayerSlice, syncMultiplayerPeers)
  const sharedMpSetup = {
    mapSize: 64 as const,
    gameMode: 'multiplayer' as const,
    playersPerWorld: 3,
    aiEnabled: false,
    maxAiCount: 0 as const,
    seed: 20267777,
  };
  const peerA = new GameEngine({ worldSetup: sharedMpSetup });
  const peerB = new GameEngine({ worldSetup: sharedMpSetup });

  peerA.setLocalPlayerIdentity({
    clientId: 'stu-alpha',
    ownerName: 'Nora',
    companyName: 'Nordlys Bane AS',
    playerColor: '#16a34a',
  });
  peerB.setLocalPlayerIdentity({
    clientId: 'stu-beta',
    ownerName: 'Henrik',
    companyName: 'Vestkyst Frakt AS',
    playerColor: '#ea580c',
  });

  peerA.grantDevFunds('personal', 500_000);
  peerA.upgradeHQ();
  const peerARoute = peerA.spawnDemoRoute('bus_line');
  assert(peerARoute.ok, 'Peer A built bus_line demo route in shared world');

  const sliceA = peerA.exportMultiplayerSlice();
  assertEq(sliceA.clientId, 'stu-alpha', 'Exported slice carries Peer A clientId');
  assertEq(sliceA.companyName, 'Nordlys Bane AS', 'Exported slice carries Peer A companyName');
  assertEq(sliceA.color, '#16a34a', 'Exported slice carries Peer A color');
  assert(
    sliceA.stations.length >= 2 &&
      sliceA.stations.every((s) => s.id.includes('stu-alpha')),
    'Peer A stations use collision-free client-scoped IDs'
  );
  assert(
    sliceA.vehicles.length >= 1 &&
      sliceA.vehicles.every((v) => v.id.includes('stu-alpha')),
    'Peer A vehicles use collision-free client-scoped IDs'
  );
  assert(sliceA.modifiedTiles.length > 0, 'Exported slice includes Peer A modified road/HQ tiles');

  peerB.syncMultiplayerPeers([sliceA]);
  const peerBStateAfterSync = peerB.getState();
  assert(
    peerBStateAfterSync.stations.some((s) => s.id === sliceA.stations[0].id && s.ownerId === 'stu-alpha'),
    'Peer B state contains synced Peer A station with ownerId === stu-alpha'
  );
  assert(
    peerBStateAfterSync.vehicles.some((v) => v.id === sliceA.vehicles[0].id && v.ownerId === 'stu-alpha'),
    'Peer B state contains synced Peer A vehicle with ownerId === stu-alpha'
  );
  const syncedStationDetails = peerB.getStationDetails(sliceA.stations[0].id);
  assert(syncedStationDetails !== null, 'Peer B can inspect Peer A station via getStationDetails');
  assertEq(syncedStationDetails.isPlayerOwned, false, 'Synced Peer A station isPlayerOwned === false on Peer B');
  assertEq(
    syncedStationDetails.ownerName,
    'Nordlys Bane AS',
    'Peer B resolves Peer A companyName on synced station'
  );
  assertEq(
    syncedStationDetails.ownerColor,
    '#16a34a',
    'Peer B resolves Peer A color on synced station'
  );
  assertEq(
    resolveOwnerColor('stu-alpha', peerBStateAfterSync.aiCompanies, peerBStateAfterSync),
    '#16a34a',
    'Renderer resolveOwnerColor resolves multiplayer peer color #16a34a'
  );

  // Syncing empty peers list cleanly removes Peer A stations/vehicles/tiles on Peer B
  peerB.syncMultiplayerPeers([]);
  assert(
    !peerB.getState().stations.some((s) => s.ownerId === 'stu-alpha') &&
      !peerB.getState().vehicles.some((v) => v.ownerId === 'stu-alpha'),
    'syncMultiplayerPeers([]) cleanly removes stale remote peer stations & vehicles'
  );

  // 10c. World Bucket Math (playersPerWorld = 3) & Firebase Auth / Classroom / Multiplayer Exports
  const mpBucketSetup = { gameMode: 'multiplayer' as const, playersPerWorld: 3 };
  const expectedBuckets = [
    { slot: 0, worldIndex: 1, slotInWorld: 1, color: PLAYER_WORLD_COLORS[0] },
    { slot: 1, worldIndex: 1, slotInWorld: 2, color: PLAYER_WORLD_COLORS[1] },
    { slot: 2, worldIndex: 1, slotInWorld: 3, color: PLAYER_WORLD_COLORS[2] },
    { slot: 3, worldIndex: 2, slotInWorld: 1, color: PLAYER_WORLD_COLORS[0] },
    { slot: 4, worldIndex: 2, slotInWorld: 2, color: PLAYER_WORLD_COLORS[1] },
    { slot: 5, worldIndex: 2, slotInWorld: 3, color: PLAYER_WORLD_COLORS[2] },
    { slot: 6, worldIndex: 3, slotInWorld: 1, color: PLAYER_WORLD_COLORS[0] },
  ];
  for (const exp of expectedBuckets) {
    const bucket = computeWorldBucketAssignment(exp.slot, mpBucketSetup);
    assertEq(
      bucket.worldIndex,
      exp.worldIndex,
      `Slot ${exp.slot} (playersPerWorld=3) -> World ${exp.worldIndex}`
    );
    assertEq(
      bucket.slotInWorld,
      exp.slotInWorld,
      `Slot ${exp.slot} (playersPerWorld=3) -> slotInWorld ${exp.slotInWorld}`
    );
    assertEq(
      bucket.playerColor,
      exp.color,
      `Slot ${exp.slot} (playersPerWorld=3) -> playerColor ${exp.color}`
    );
  }

  const spBucket0 = computeWorldBucketAssignment(0, { gameMode: 'singleplayer', playersPerWorld: 1 });
  const spBucket1 = computeWorldBucketAssignment(1, { gameMode: 'singleplayer', playersPerWorld: 1 });
  const spBucket2 = computeWorldBucketAssignment(2, { gameMode: 'singleplayer', playersPerWorld: 1 });
  assert(
    spBucket0.worldIndex === 1 && spBucket1.worldIndex === 2 && spBucket2.worldIndex === 3,
    'Singleplayer bucket math puts each student in their own world (1, 2, 3)'
  );

  const normSetup = normalizeWorldSetup({
    mapSize: 160,
    gameMode: 'multiplayer',
    playersPerWorld: 4,
    aiEnabled: false,
    maxAiCount: 3,
  });
  assert(
    normSetup.mapSize === 160 && !normSetup.aiEnabled && normSetup.maxAiCount === 0,
    'normalizeWorldSetup forces maxAiCount=0 when aiEnabled=false'
  );
  assert(Boolean(DEFAULT_WORLD_SETUP.seed), 'DEFAULT_WORLD_SETUP exported with valid seed');

  assertEq(
    ADMIN_TEACHER_EMAIL,
    'hanselaa@gmail.com',
    'ADMIN_TEACHER_EMAIL strictly locked to hanselaa@gmail.com'
  );
  assert(typeof signInTeacherWithGoogle === 'function', 'signInTeacherWithGoogle exported');
  assert(typeof signOutTeacher === 'function', 'signOutTeacher exported');
  assert(typeof subscribeToTeacherAuth === 'function', 'subscribeToTeacherAuth exported');
  assert(typeof getCurrentTeacherUser === 'function', 'getCurrentTeacherUser exported');
  assert(
    typeof joinClassroomWithWorldAssignment === 'function',
    'joinClassroomWithWorldAssignment exported'
  );
  assert(typeof publishPlayerWorldSlice === 'function', 'publishPlayerWorldSlice exported');
  assert(typeof subscribeToWorldPeers === 'function', 'subscribeToWorldPeers exported');

  assert(
    rulesText.includes("request.auth.token.email == 'hanselaa@gmail.com'") &&
      rulesText.includes('match /worlds/{worldId}') &&
      rulesText.includes('match /players/{playerId}'),
    'firestore.rules enforces hanselaa@gmail.com teacher auth and /worlds/{worldId}/players/{playerId} sync rules'
  );

  console.log(
    '  [OK] Road/Rail bridges, cargo delivery across bridge, 128/160 maps, AI toggle, multiplayer sync & world bucket/auth rules verified.'
  );

  // =========================================================================
  // 11. Round 6 Bridges: Zero-"Dumpel" Seamless Profile & 3 Bridge Tiers
  // =========================================================================
  section('11. Round 6 Bridges: Zero-"Dumpel" Seamless Profile & 3 Bridge Tiers (WOOD, STEEL, MODERN)');

  // 11a. Mathematical Zero-"Dumpel" Verification (Level-1 Shores & Uneven Elev 1 -> Elev 2 Shores)
  assertEq(BRIDGE_DECK_Y, ELEV_STEP, 'BRIDGE_DECK_Y === ELEV_STEP (0.28) for seamless level-1 approaches');
  assertEq(
    BRIDGE_TYPES_ORDER.join(','),
    'WOOD,STEEL,MODERN',
    'BRIDGE_TYPES_ORDER === [WOOD, STEEL, MODERN]'
  );
  assertEq(BRIDGE_CATALOG.WOOD.roadCostPerTile, 7_500, 'WOOD roadCostPerTile === 7 500 kr');
  assertEq(BRIDGE_CATALOG.WOOD.railCostPerTile, 10_500, 'WOOD railCostPerTile === 10 500 kr');
  assertEq(BRIDGE_CATALOG.WOOD.maxSpeedKmh, 55, 'WOOD maxSpeedKmh === 55 km/t');
  assertEq(BRIDGE_CATALOG.STEEL.roadCostPerTile, 13_500, 'STEEL roadCostPerTile === 13 500 kr');
  assertEq(BRIDGE_CATALOG.STEEL.railCostPerTile, 19_000, 'STEEL railCostPerTile === 19 000 kr');
  assertEq(BRIDGE_CATALOG.STEEL.maxSpeedKmh, 110, 'STEEL maxSpeedKmh === 110 km/t');
  assertEq(BRIDGE_CATALOG.MODERN.roadCostPerTile, 24_000, 'MODERN roadCostPerTile === 24 000 kr');
  assertEq(BRIDGE_CATALOG.MODERN.railCostPerTile, 32_000, 'MODERN railCostPerTile === 32 000 kr');
  assertEq(BRIDGE_CATALOG.MODERN.maxSpeedKmh, 240, 'MODERN maxSpeedKmh === 240 km/t');

  const r6Engine = new GameEngine({
    worldSetup: {
      mapSize: 64,
      terrainType: 'flat',
      waterLevel: 'low',
      aiEnabled: false,
      maxAiCount: 0,
      seed: 20260601,
    },
  });
  r6Engine.grantDevFunds('corporate', 20_000_000);
  const r6State = r6Engine.getState();

  // Prepare clean test arena in rows y=10..42, cols x=10..52
  for (let cy = 8; cy <= 44; cy++) {
    for (let cx = 8; cx <= 54; cx++) {
      const t = r6State.tiles[tileIndex(cx, cy, 64)];
      t.industryId = undefined;
      t.townId = undefined;
      t.buildingTier = undefined;
      t.stationId = undefined;
      t.depot = null;
      t.hqOwnerId = null;
      t.ownerId = null;
      t.road = false;
      t.rail = false;
      t.signal = false;
      t.bridge = null;
      t.bridgeAxis = undefined;
      t.bridgeType = null;
      t.bridgeElevation = undefined;
      t.terrain = 'GRASS';
      t.elevation = 1;
    }
  }

  // Carve a 3-tile water channel at x=25..27 across rows y=12..22 with coastal SAND shores at x=24 & x=28 (elev=1)
  for (let cy = 12; cy <= 22; cy++) {
    r6State.tiles[tileIndex(24, cy, 64)].terrain = 'SAND';
    r6State.tiles[tileIndex(24, cy, 64)].elevation = 1;
    r6State.tiles[tileIndex(28, cy, 64)].terrain = 'SAND';
    r6State.tiles[tileIndex(28, cy, 64)].elevation = 1;
    for (let wx = 25; wx <= 27; wx++) {
      const wt = r6State.tiles[tileIndex(wx, cy, 64)];
      wt.terrain = 'WATER';
      wt.elevation = 0;
    }
  }

  // Build bridge on row y=14 from inland (22,14) -> shore (24,14) -> water (25..27,14) -> shore (28,14) -> inland (30,14)
  const flatProfileRes = r6Engine.applyDragTrackOrRoad(22, 14, 30, 14, 'ROAD', 'MODERN');
  assert(flatProfileRes.ok, `Built level-1 shore-to-shore MODERN road bridge: ${flatProfileRes.message}`);

  // Sample every 0.1 tiles across [inland x=23.0 -> shore x=24 -> water bridge x=25..27 -> shore x=28 -> inland x=29.0]
  for (let step = 0; step <= 60; step++) {
    const sampleX = 23.0 + step * 0.1;
    const yVal = getTravelSurfaceHeightAt(r6Engine.getState(), sampleX, 14);
    assert(
      Math.abs(yVal - ELEV_STEP) < 0.0001,
      `Zero-"dumpel" flat profile at x=${sampleX.toFixed(1)}, z=14: expected ${ELEV_STEP}, got ${yVal.toFixed(6)}`
    );
  }

  // Also verify zero-"dumpel" even when ONLY shore-to-shore (24..28) is built before inland road exists (row y=16)!
  const shoreOnlyRes = r6Engine.applyDragTrackOrRoad(24, 16, 28, 16, 'ROAD_BRIDGE', 'WOOD');
  assert(shoreOnlyRes.ok, 'Built shore-only WOOD road bridge at y=16');
  for (let step = 0; step <= 48; step++) {
    const sampleX = 23.6 + step * 0.1;
    const yVal = getTravelSurfaceHeightAt(r6Engine.getState(), sampleX, 16);
    assert(
      Math.abs(yVal - ELEV_STEP) < 0.0001,
      `Zero-"dumpel" shore-only profile at x=${sampleX.toFixed(1)}, z=16: expected ${ELEV_STEP}, got ${yVal.toFixed(6)}`
    );
  }

  // Uneven shores test (row y=30): west shore elevation = 1 (x=20..24), water (x=25..27), east plateau elevation = 2 (x=28..34)
  for (let cy = 28; cy <= 32; cy++) {
    for (let wx = 25; wx <= 27; wx++) {
      r6State.tiles[tileIndex(wx, cy, 64)].terrain = 'WATER';
      r6State.tiles[tileIndex(wx, cy, 64)].elevation = 0;
    }
    for (let ex = 28; ex <= 34; ex++) {
      r6State.tiles[tileIndex(ex, cy, 64)].terrain = 'GRASS';
      r6State.tiles[tileIndex(ex, cy, 64)].elevation = 2;
    }
  }
  const unevenBridgeRes = r6Engine.applyDragTrackOrRoad(22, 30, 32, 30, 'RAIL', 'STEEL');
  assert(unevenBridgeRes.ok, 'Built uneven-shore (elev 1 -> elev 2) STEEL rail bridge at y=30');

  for (const wx of [25, 26, 27]) {
    const bt = r6Engine.getState().tiles[tileIndex(wx, 30, 64)];
    assertEq(bt.bridgeElevation, 2, `Uneven bridge tile (${wx},30) stores bridgeElevation === 2`);
    assertNear(
      getBridgeDeckY(r6Engine.getState(), bt),
      2 * ELEV_STEP,
      1e-5,
      `getBridgeDeckY on (${wx},30) equals 2 * ELEV_STEP (${2 * ELEV_STEP})`
    );
  }

  let prevUnevenY = getTravelSurfaceHeightAt(r6Engine.getState(), 23.0, 30);
  assertNear(prevUnevenY, ELEV_STEP, 1e-4, 'Uneven profile starts at 1 * ELEV_STEP on west inland');
  for (let step = 1; step <= 80; step++) {
    const sampleX = 23.0 + step * 0.1;
    const curY = getTravelSurfaceHeightAt(r6Engine.getState(), sampleX, 30);
    assert(
      curY >= prevUnevenY - 1e-6,
      `Uneven shore-to-bridge profile is strictly monotonic non-decreasing at x=${sampleX.toFixed(1)} (${prevUnevenY.toFixed(5)} -> ${curY.toFixed(5)})`
    );
    prevUnevenY = curY;
  }
  assertNear(prevUnevenY, 2 * ELEV_STEP, 1e-4, 'Uneven profile finishes at 2 * ELEV_STEP on east plateau');

  // 11b. All 3 Bridge Tiers (WOOD, STEEL, MODERN) across ROAD & RAIL + Short (2-tile) & Long (6-tile) Spans
  // Carve a 2-tile water channel (x=38..39, y=12..18) and a 6-tile fjord (x=43..48, y=12..24)
  for (let cy = 12; cy <= 24; cy++) {
    for (const wx of [38, 39]) {
      r6State.tiles[tileIndex(wx, cy, 64)].terrain = 'WATER';
      r6State.tiles[tileIndex(wx, cy, 64)].elevation = 0;
    }
    for (let wx = 43; wx <= 48; wx++) {
      r6State.tiles[tileIndex(wx, cy, 64)].terrain = 'WATER';
      r6State.tiles[tileIndex(wx, cy, 64)].elevation = 0;
    }
  }

  const tierTestRows: Array<{
    y: number;
    fromX: number;
    toX: number;
    waterSpan: number;
    network: 'ROAD' | 'RAIL';
    tool: 'ROAD_BRIDGE' | 'RAIL_BRIDGE';
    bridgeType: BridgeType;
  }> = [
    { y: 12, fromX: 42, toX: 49, waterSpan: 6, network: 'ROAD', tool: 'ROAD_BRIDGE', bridgeType: 'WOOD' },
    { y: 14, fromX: 42, toX: 49, waterSpan: 6, network: 'ROAD', tool: 'ROAD_BRIDGE', bridgeType: 'STEEL' },
    { y: 16, fromX: 37, toX: 40, waterSpan: 2, network: 'ROAD', tool: 'ROAD_BRIDGE', bridgeType: 'MODERN' },
    { y: 18, fromX: 42, toX: 49, waterSpan: 6, network: 'RAIL', tool: 'RAIL_BRIDGE', bridgeType: 'WOOD' },
    { y: 20, fromX: 42, toX: 49, waterSpan: 6, network: 'RAIL', tool: 'RAIL_BRIDGE', bridgeType: 'STEEL' },
    { y: 22, fromX: 42, toX: 49, waterSpan: 6, network: 'RAIL', tool: 'RAIL_BRIDGE', bridgeType: 'MODERN' },
  ];

  for (const tc of tierTestRows) {
    const spec = BRIDGE_CATALOG[tc.bridgeType];
    const perWaterTile = tc.network === 'ROAD' ? spec.roadCostPerTile : spec.railCostPerTile;
    const perLandTile = tc.network === 'ROAD' ? BUILD_COSTS.ROAD : BUILD_COSTS.RAIL;
    const expectedCost = tc.waterSpan * perWaterTile + 2 * perLandTile;

    const prev = r6Engine.previewDragPath(tc.fromX, tc.y, tc.toX, tc.y, tc.tool, tc.bridgeType);
    assert(prev.ok, `Preview ok for ${tc.bridgeType} ${tc.network} (${tc.waterSpan} water tiles)`);
    assertEq(prev.bridgeTileCount, tc.waterSpan, `Preview bridgeTileCount === ${tc.waterSpan}`);
    assertEq(prev.cost, expectedCost, `Preview cost for ${tc.bridgeType} ${tc.network} === ${expectedCost}`);

    const beforeCash = r6Engine.getState().corporate.cash;
    const res = r6Engine.applyDragTrackOrRoad(tc.fromX, tc.y, tc.toX, tc.y, tc.tool, tc.bridgeType);
    assert(res.ok, `Built ${tc.bridgeType} ${tc.network} bridge: ${res.message}`);
    assertEq(
      beforeCash - r6Engine.getState().corporate.cash,
      expectedCost,
      `Exact cost deducted for ${tc.bridgeType} ${tc.network}`
    );

    const sampleWaterX = tc.fromX + 1;
    const wt = r6Engine.getState().tiles[tileIndex(sampleWaterX, tc.y, 64)];
    assertEq(wt.bridgeType, tc.bridgeType, `Water tile stores bridgeType === ${tc.bridgeType}`);
    assertEq(wt.bridgeElevation, 1, 'Water tile stores bridgeElevation === 1');

    const info = r6Engine.inspectTile(sampleWaterX, tc.y);
    assert(
      info.descriptionNo.includes(spec.nameNo) && info.descriptionNo.includes(`${spec.maxSpeedKmh}`),
      `inspectTile shows ${spec.nameNo} and ${spec.maxSpeedKmh} km/t (${info.descriptionNo})`
    );
  }

  // Test in-place bridge upgrade: upgrade row y=12 (6-tile WOOD road bridge) to MODERN road bridge!
  const upgradeDiffCost =
    6 * (BRIDGE_CATALOG.MODERN.roadCostPerTile - BRIDGE_CATALOG.WOOD.roadCostPerTile);
  const upgPrev = r6Engine.previewDragPath(42, 12, 49, 12, 'ROAD_BRIDGE', 'MODERN');
  assert(upgPrev.ok && upgPrev.bridgeTileCount === 6, 'In-place WOOD -> MODERN upgrade preview valid');
  assertEq(upgPrev.cost, upgradeDiffCost, `In-place upgrade preview charges exact delta (${upgradeDiffCost} kr)`);
  const upgRes = r6Engine.applyDragTrackOrRoad(42, 12, 49, 12, 'ROAD_BRIDGE', 'MODERN');
  assert(upgRes.ok, 'Upgraded WOOD road bridge to MODERN in place');
  assertEq(
    r6Engine.getState().tiles[tileIndex(44, 12, 64)].bridgeType,
    'MODERN',
    'Upgraded bridge tile now has bridgeType === MODERN'
  );

  // Sync TerrainInstancer across all 3 bridge architectures (WOOD, STEEL, short & long MODERN cable-stayed)
  const r6TerrainInstancer = new TerrainInstancer();
  r6TerrainInstancer.sync(r6Engine.getState());
  assert(
    r6TerrainInstancer.group.children.length > 0,
    'TerrainInstancer synced WOOD, STEEL & short/long MODERN cable-stayed bridges cleanly'
  );
  r6TerrainInstancer.dispose();

  // Verify Multiplayer Delta Sync preserves bridgeType (bt) & bridgeElevation (be) with zero undefineds
  r6Engine.setLocalPlayerIdentity({
    clientId: 'stu-bridge-mp',
    ownerName: 'Ingrid',
    companyName: 'Fjordbru AS',
    playerColor: '#9333ea',
  });
  const r6Slice = r6Engine.exportMultiplayerSlice();
  const rawSliceJson = JSON.stringify(r6Slice);
  assert(!rawSliceJson.includes('undefined'), 'Multiplayer bridge slice serializes cleanly with no undefined');

  const r6PeerReceiver = new GameEngine({
    worldSetup: {
      mapSize: 64,
      terrainType: 'flat',
      waterLevel: 'low',
      aiEnabled: false,
      maxAiCount: 0,
      seed: 20260601,
    },
  });
  r6PeerReceiver.syncMultiplayerPeers([r6Slice]);
  const syncedModernRailTile = r6PeerReceiver.getState().tiles[tileIndex(45, 22, 64)];
  assertEq(syncedModernRailTile.bridge, 'RAIL', 'Multiplayer peer synced bridge === RAIL');
  assertEq(syncedModernRailTile.bridgeType, 'MODERN', 'Multiplayer peer synced bridgeType === MODERN');
  assertEq(syncedModernRailTile.bridgeElevation, 1, 'Multiplayer peer synced bridgeElevation === 1');
  const syncedUnevenBridgeTile = r6PeerReceiver.getState().tiles[tileIndex(26, 30, 64)];
  assertEq(syncedUnevenBridgeTile.bridgeType, 'STEEL', 'Multiplayer peer synced STEEL bridgeType');
  assertEq(syncedUnevenBridgeTile.bridgeElevation, 2, 'Multiplayer peer synced bridgeElevation === 2');

  // 11c. Vehicle Speed Clamping on WOOD (<= 55 km/t), STEEL (<= 110 km/t) & MODERN (> 130 km/t)
  const speedEngine = new GameEngine({
    worldSetup: {
      mapSize: 64,
      terrainType: 'flat',
      waterLevel: 'very_low',
      aiEnabled: false,
      maxAiCount: 0,
      seed: 20260602,
    },
  });
  speedEngine.grantDevFunds('corporate', 25_000_000);
  const spState = speedEngine.getState();

  for (let cy = 8; cy <= 26; cy++) {
    for (let cx = 6; cx <= 58; cx++) {
      const t = spState.tiles[tileIndex(cx, cy, 64)];
      t.industryId = undefined;
      t.townId = undefined;
      t.buildingTier = undefined;
      t.stationId = undefined;
      t.depot = null;
      t.hqOwnerId = null;
      t.ownerId = null;
      t.road = false;
      t.rail = false;
      t.signal = false;
      t.bridge = null;
      t.bridgeAxis = undefined;
      t.bridgeType = null;
      t.bridgeElevation = undefined;
      if (cx >= 26 && cx <= 35) {
        t.terrain = 'WATER';
        t.elevation = 0;
      } else {
        t.terrain = 'GRASS';
        t.elevation = 1;
      }
    }
  }

  const speedLanes: Array<{ row: number; bridgeType: BridgeType; trainId?: string }> = [
    { row: 12, bridgeType: 'WOOD' },
    { row: 17, bridgeType: 'STEEL' },
    { row: 22, bridgeType: 'MODERN' },
  ];

  for (const lane of speedLanes) {
    const trackRes = speedEngine.applyDragTrackOrRoad(8, lane.row, 54, lane.row, 'RAIL', lane.bridgeType);
    assert(trackRes.ok, `Built speed test corridor for ${lane.bridgeType} rail bridge`);
    const stARes = speedEngine.applyTool(8, lane.row, 'TRAIN_STATION', {
      stationLength: 1,
      orientation: 'X',
    });
    const stBRes = speedEngine.applyTool(54, lane.row, 'TRAIN_STATION', {
      stationLength: 1,
      orientation: 'X',
    });
    const depRes = speedEngine.applyTool(10, lane.row + 1, 'RAIL_DEPOT');
    assert(stARes.ok && stBRes.ok && depRes.ok, `Built stations & depot for ${lane.bridgeType} lane`);

    const buyRes = speedEngine.buyVehicle({
      depotX: 10,
      depotY: lane.row + 1,
      modelId: 'LOCO_ELECTRIC', // 175 km/h max speed
      cargoType: 'PASSENGERS',
      wagonCount: 1,
      orders: [stARes.stationId!, stBRes.stationId!],
    });
    assert(buyRes.ok && Boolean(buyRes.vehicleId), `Spawned LOCO_ELECTRIC on ${lane.bridgeType} lane`);
    lane.trainId = buyRes.vehicleId;
  }

  const maxBridgeSpeedObserved: Record<BridgeType, number> = {
    WOOD: 0,
    STEEL: 0,
    MODERN: 0,
  };

  for (let tick = 0; tick < 500; tick++) {
    speedEngine.tick(1);
    const curS = speedEngine.getState();
    for (const lane of speedLanes) {
      const tr = curS.vehicles.find((v) => v.id === lane.trainId)!;
      // Interior water bridge tiles x=27..34 guarantee both curTile and nextTile are on the bridge
      if (tr.x >= 27 && tr.x <= 34 && tr.nextX >= 27 && tr.nextX <= 34 && tr.y === lane.row) {
        if (tr.speedKmh > maxBridgeSpeedObserved[lane.bridgeType]) {
          maxBridgeSpeedObserved[lane.bridgeType] = tr.speedKmh;
        }
      }
    }
  }

  assert(
    maxBridgeSpeedObserved.WOOD > 0 && maxBridgeSpeedObserved.WOOD <= 55,
    `WOOD bridge clamps LOCO_ELECTRIC speed <= 55 km/t (observed ${maxBridgeSpeedObserved.WOOD} km/t)`
  );
  assert(
    maxBridgeSpeedObserved.STEEL > 55 && maxBridgeSpeedObserved.STEEL <= 110,
    `STEEL bridge clamps LOCO_ELECTRIC speed <= 110 km/t and > WOOD (observed ${maxBridgeSpeedObserved.STEEL} km/t)`
  );
  assert(
    maxBridgeSpeedObserved.MODERN > 130 && maxBridgeSpeedObserved.MODERN <= 175,
    `MODERN bridge allows full LOCO_ELECTRIC speed > 130 km/t (observed ${maxBridgeSpeedObserved.MODERN} km/t)`
  );

  console.log(
    `  [OK] Zero-"dumpel" seamless profile (0.0000 dip/hump), WOOD/STEEL/MODERN 3D spans, MP sync & speed caps (${maxBridgeSpeedObserved.WOOD}/${maxBridgeSpeedObserved.STEEL}/${maxBridgeSpeedObserved.MODERN} km/t) verified.`
  );

  // =========================================================================
  // 12. Round 7 OpenTTD Depots, Separate Locomotives & Wagons, Mixed Consists & Send-to-Depot
  // =========================================================================
  section(
    '12. Round 7 OpenTTD Depots, Separate Locomotives & Wagons, Mixed Consists, Wagon Swapping & Send-to-Depot'
  );

  assertEq(MAX_TRAIN_WAGONS, 8, 'MAX_TRAIN_WAGONS === 8');
  assertEq(ROAD_REFIT_COST_KR, 5_000, 'ROAD_REFIT_COST_KR === 5 000 kr');
  assertEq(
    RAIL_WAGON_CATALOG_LIST.length,
    7,
    'RAIL_WAGON_CATALOG_LIST contains all 7 specialized rail wagons'
  );
  assertEq(
    ROAD_VEHICLE_SHOP_LIST.length,
    7,
    'ROAD_VEHICLE_SHOP_LIST contains all 7 specialized road vehicles (1 bus + 6 cargo trucks)'
  );

  const r7Engine = new GameEngine({
    worldSetup: {
      mapSize: 64,
      terrainType: 'flat',
      waterLevel: 'very_low',
      aiEnabled: false,
      maxAiCount: 0,
      seed: 20260701,
    },
  });
  r7Engine.grantDevFunds('corporate', 25_000_000);
  const r7State = r7Engine.getState();

  // Clear deterministic flat railway & road testbed in rows y=10..30, cols x=8..54
  for (let cy = 10; cy <= 30; cy++) {
    for (let cx = 8; cx <= 54; cx++) {
      const t = r7State.tiles[tileIndex(cx, cy, 64)];
      t.industryId = undefined;
      t.townId = undefined;
      t.buildingTier = undefined;
      t.stationId = undefined;
      t.depot = null;
      t.hqOwnerId = null;
      t.ownerId = null;
      t.road = false;
      t.rail = false;
      t.signal = false;
      t.bridge = null;
      t.bridgeAxis = undefined;
      t.bridgeType = null;
      t.bridgeElevation = undefined;
      t.terrain = 'GRASS';
      t.elevation = 1;
    }
  }

  // Place synthetic Power Plant anchor near (46, 13) so stCoalB at (46, 15) accepts COAL,
  // and synthetic Town buildings near (14, 21) & (46, 21) so stTownA & stTownB accept PASSENGERS + MAIL!
  const powerPlant = r7State.industries.find((ind) => ind.accepts.includes('COAL'));
  const coalMine = r7State.industries.find((ind) => ind.produces === 'COAL');
  assert(Boolean(powerPlant && coalMine), 'World contains COAL_MINE and POWER_PLANT');
  coalMine!.x = 13;
  coalMine!.y = 12;
  coalMine!.width = 2;
  coalMine!.height = 2;
  powerPlant!.x = 45;
  powerPlant!.y = 12;
  powerPlant!.width = 2;
  powerPlant!.height = 2;

  const r7TownA = r7State.towns[0];
  const r7TownB = r7State.towns[1];
  r7TownA.x = 14;
  r7TownA.y = 21;
  r7TownB.x = 46;
  r7TownB.y = 21;
  r7State.tiles[tileIndex(14, 21, 64)].townId = r7TownA.id;
  r7State.tiles[tileIndex(14, 21, 64)].buildingTier = 3;
  r7State.tiles[tileIndex(46, 21, 64)].townId = r7TownB.id;
  r7State.tiles[tileIndex(46, 21, 64)].buildingTier = 3;

  // Build connected rail network: coal line (y=15), town express line (y=20), connector x=28 (y=15..20), rail depot at (28, 17)
  assert(r7Engine.applyDragTrackOrRoad(14, 15, 46, 15, 'RAIL').ok, 'Built coal rail line y=15');
  assert(r7Engine.applyDragTrackOrRoad(14, 20, 46, 20, 'RAIL').ok, 'Built town rail line y=20');
  assert(r7Engine.applyDragTrackOrRoad(28, 15, 28, 20, 'RAIL').ok, 'Built north-south depot spur x=28');
  const r7DepotX = 29;
  const r7DepotY = 17;
  assert(r7Engine.applyDragTrackOrRoad(28, 17, r7DepotX, r7DepotY, 'RAIL').ok, 'Built depot lead');
  const railDepRes = r7Engine.applyTool(r7DepotX, r7DepotY, 'RAIL_DEPOT');
  assert(railDepRes.ok, 'Built RAIL_DEPOT at (29, 17)');

  const stCoalARes = r7Engine.applyTool(14, 15, 'TRAIN_STATION', { stationLength: 1, orientation: 'X' });
  const stCoalBRes = r7Engine.applyTool(46, 15, 'TRAIN_STATION', { stationLength: 1, orientation: 'X' });
  const stTownARes = r7Engine.applyTool(14, 20, 'TRAIN_STATION', { stationLength: 1, orientation: 'X' });
  const stTownBRes = r7Engine.applyTool(46, 20, 'TRAIN_STATION', { stationLength: 1, orientation: 'X' });
  assert(
    stCoalARes.ok && stCoalBRes.ok && stTownARes.ok && stTownBRes.ok,
    'Built coal & town train stations'
  );

  // 12a. Bare Locomotive Purchase (0 wagons) & 0-Wagon Dispatch Guard
  const cashBeforeLoco1 = r7Engine.getState().corporate.cash;
  const buyLoco1 = r7Engine.buyLocomotive(r7DepotX, r7DepotY, 'LOCO_DIESEL');
  assert(buyLoco1.ok && Boolean(buyLoco1.vehicleId), `buyLocomotive succeeded: ${buyLoco1.message}`);
  const loco1Id = buyLoco1.vehicleId!;
  assertEq(
    cashBeforeLoco1 - r7Engine.getState().corporate.cash,
    VEHICLE_CATALOG.LOCO_DIESEL.price,
    'buyLocomotive charged exact bare LOCO_DIESEL price without bundled wagons'
  );

  const loco1Initial = r7Engine.getState().vehicles.find((v) => v.id === loco1Id)!;
  assertEq(loco1Initial.state, 'IN_DEPOT', 'Bare locomotive starts IN_DEPOT');
  assertEq(loco1Initial.wagonCount, 0, 'Bare locomotive has wagonCount === 0');
  assertEq(loco1Initial.wagons?.length ?? 0, 0, 'Bare locomotive has empty wagons array');
  assertEq(loco1Initial.capacity, 0, 'Bare locomotive has 0 cargo capacity');
  assert(loco1Initial.name.includes('Uten vogner'), `Bare locomotive name notes no wagons (${loco1Initial.name})`);

  // Assigning orders to a 0-wagon train saves orders cleanly while keeping it IN_DEPOT
  const saveOrders0Wag = r7Engine.updateVehicleOrders(loco1Id, [stCoalARes.stationId!, stCoalBRes.stationId!]);
  assert(saveOrders0Wag.ok, 'updateVehicleOrders saves orders on 0-wagon locomotive');
  assertEq(
    r7Engine.getState().vehicles.find((v) => v.id === loco1Id)!.state,
    'IN_DEPOT',
    '0-wagon locomotive stays IN_DEPOT when orders are assigned'
  );
  const start0Wag = r7Engine.toggleVehicleStopped(loco1Id);
  assert(!start0Wag.ok, 'toggleVehicleStopped refuses to dispatch 0-wagon locomotive');

  // Verify VehicleRenderer handles 0-wagon locomotive cleanly
  const r7VehRenderer = new VehicleRenderer();
  r7VehRenderer.update(r7Engine.getState(), 0.016, 100);
  assert(r7VehRenderer.group.children.length === 1, 'VehicleRenderer renders 0-wagon locomotive');

  // 12b. Separate Wagon Buying, MAX_TRAIN_WAGONS=8 Cap, Spare Siding, Move/Detach/Sell & keepWagonsInDepot
  const buyLoco2 = r7Engine.buyLocomotive(r7DepotX, r7DepotY, 'LOCO_STEAM');
  assert(buyLoco2.ok && Boolean(buyLoco2.vehicleId), 'Bought second locomotive (LOCO_STEAM)');
  const loco2Id = buyLoco2.vehicleId!;

  const eightCargoSequence = [
    'PASSENGERS',
    'MAIL',
    'COAL',
    'WOOD',
    'GOODS',
    'GRAIN',
    'FOOD',
    'COAL',
  ] as const;
  for (let i = 0; i < eightCargoSequence.length; i++) {
    const wCargo = eightCargoSequence[i];
    const wRes = r7Engine.buyRailWagon(r7DepotX, r7DepotY, wCargo, loco2Id);
    assert(wRes.ok && Boolean(wRes.wagonId), `Coupled wagon #${i + 1} (${wCargo}) onto loco2`);
  }
  const loco2Full = r7Engine.getState().vehicles.find((v) => v.id === loco2Id)!;
  assertEq(loco2Full.wagonCount, 8, 'loco2 reached MAX_TRAIN_WAGONS (8)');
  const ninthWagonRes = r7Engine.buyRailWagon(r7DepotX, r7DepotY, 'COAL', loco2Id);
  assert(!ninthWagonRes.ok, '9th wagon rejected when train is at MAX_TRAIN_WAGONS (8)');

  // Reorder within loco2 (move index 2 COAL wagon to front index 0)
  const coalWagToMove = loco2Full.wagons![2].id;
  assert(
    r7Engine.moveTrainWagon(loco2Id, coalWagToMove, loco2Id, 0).ok,
    'Reordered wagon within same train via moveTrainWagon'
  );
  assertEq(
    r7Engine.getState().vehicles.find((v) => v.id === loco2Id)!.wagons![0].id,
    coalWagToMove,
    'Moved COAL wagon is now first on loco2'
  );

  // Transfer that COAL wagon directly from loco2 to loco1 via moveTrainWagon!
  assert(
    r7Engine.moveTrainWagon(loco2Id, coalWagToMove, loco1Id).ok,
    'Transferred COAL wagon from loco2 to loco1 in depot'
  );
  assertEq(
    r7Engine.getState().vehicles.find((v) => v.id === loco1Id)!.wagonCount,
    1,
    'loco1 now has 1 COAL wagon'
  );

  // Buy a standalone COAL wagon to depot spare siding (attachToVehicleId = null), then attach to loco1, plus 1 direct COAL wagon -> 3x COAL on loco1
  const spareBuyRes = r7Engine.buyRailWagon(r7DepotX, r7DepotY, 'COAL', null);
  assert(spareBuyRes.ok && Boolean(spareBuyRes.wagonId), 'Bought standalone COAL wagon onto depot spare siding');
  assert(
    (r7Engine.getState().depotWagons ?? []).some((w) => w.id === spareBuyRes.wagonId),
    'Spare wagon stored in state.depotWagons'
  );
  assert(
    r7Engine.attachDepotWagonToTrain(spareBuyRes.wagonId!, loco1Id).ok,
    'Attached spare siding COAL wagon onto loco1'
  );
  assert(
    r7Engine.buyRailWagon(r7DepotX, r7DepotY, 'COAL', loco1Id).ok,
    'Bought 3rd COAL wagon directly onto loco1'
  );
  assertEq(
    r7Engine.getState().vehicles.find((v) => v.id === loco1Id)!.capacity,
    3 * RAIL_WAGON_CATALOG.COAL.capacity,
    'loco1 capacity === 3 * 35 = 105t COAL'
  );

  // Sell one wagon directly off loco2 (85% refund), then sell loco2 with keepWagonsInDepot: true, then sell one spare depot wagon!
  const wagToSellOnTrain = r7Engine.getState().vehicles.find((v) => v.id === loco2Id)!.wagons![0];
  const cashBeforeWagSale = r7Engine.getState().corporate.cash;
  assert(
    r7Engine.sellTrainWagon(loco2Id, wagToSellOnTrain.id).ok,
    'Sold single coupled wagon off loco2'
  );
  assertEq(
    r7Engine.getState().corporate.cash - cashBeforeWagSale,
    Math.round(wagToSellOnTrain.purchaseValue * 0.85),
    'sellTrainWagon refunded exact 85% of wagon value'
  );

  const depotWagonsBeforeLocoSale = (r7Engine.getState().depotWagons ?? []).length;
  assert(
    r7Engine.sellVehicle(loco2Id, { keepWagonsInDepot: true }).ok,
    'Sold loco2 with keepWagonsInDepot: true'
  );
  assert(
    !r7Engine.getState().vehicles.some((v) => v.id === loco2Id),
    'loco2 removed from active vehicles'
  );
  assertEq(
    (r7Engine.getState().depotWagons ?? []).length,
    depotWagonsBeforeLocoSale + 6,
    'All 6 remaining wagons from loco2 preserved on state.depotWagons spare siding'
  );

  const spareToSell = r7Engine.getState().depotWagons![0];
  const cashBeforeSpareSale = r7Engine.getState().corporate.cash;
  assert(r7Engine.sellDepotWagon(spareToSell.id).ok, 'Sold spare siding wagon via sellDepotWagon');
  assertEq(
    r7Engine.getState().corporate.cash - cashBeforeSpareSale,
    Math.round(spareToSell.purchaseValue * 0.85),
    'sellDepotWagon refunded exact 85% of spare wagon value'
  );

  // 12c. Full Train Reconfiguration Lifecycle:
  //      Haul COAL -> sendVehicleToDepot -> Drive into depot -> Swap to Mixed 2x PASSENGERS + 1x MAIL -> Multi-Cargo Delivery!
  const stCoalAObj = r7Engine.getState().stations.find((s) => s.id === stCoalARes.stationId)!;
  stCoalAObj.waitingCargo.COAL = 180;

  // Dispatch loco1 (currently 3x COAL wagons, IN_DEPOT with orders [stCoalA, stCoalB])
  assert(r7Engine.toggleVehicleStopped(loco1Id).ok, 'Dispatched loco1 out of depot with 3x COAL wagons');
  assertEq(
    r7Engine.getState().vehicles.find((v) => v.id === loco1Id)!.state,
    'MOVING',
    'loco1 left depot in MOVING state'
  );

  for (let t = 0; t < 80 * 14; t++) {
    r7Engine.tick(1);
    if (r7Engine.getState().corporate.currentYearPnL.freightRevenue > 0) {
      break;
    }
  }
  const coalRevenueEarned = r7Engine.getState().corporate.currentYearPnL.freightRevenue;
  assert(
    coalRevenueEarned > 0,
    `loco1 delivered COAL and earned initial freight revenue (${coalRevenueEarned} kr)`
  );

  // Test sendVehicleToDepot + cancelSendToDepot + sendVehicleToDepot driving physically into (29, 17)!
  const sendRes1 = r7Engine.sendVehicleToDepot(loco1Id, { x: r7DepotX, y: r7DepotY });
  assert(sendRes1.ok, `sendVehicleToDepot initiated: ${sendRes1.message}`);
  const cancelRes = r7Engine.cancelSendToDepot(loco1Id);
  assert(cancelRes.ok, 'cancelSendToDepot resumed normal operation');
  assertEq(
    r7Engine.getState().vehicles.find((v) => v.id === loco1Id)!.goingToDepot,
    null,
    'cancelSendToDepot cleared goingToDepot'
  );

  const sendRes2 = r7Engine.sendVehicleToDepot(loco1Id, { x: r7DepotX, y: r7DepotY });
  assert(sendRes2.ok, 'Re-sent loco1 to rail depot (29, 17)');

  for (let t = 0; t < 60 * 14; t++) {
    if (r7Engine.getState().vehicles.find((v) => v.id === loco1Id)!.state === 'IN_DEPOT') {
      break;
    }
    r7Engine.tick(1);
  }
  const loco1Parked = r7Engine.getState().vehicles.find((v) => v.id === loco1Id)!;
  assertEq(loco1Parked.state, 'IN_DEPOT', 'loco1 drove along tracks and parked IN_DEPOT');
  assertEq(loco1Parked.x, r7DepotX, 'loco1 parked at depot X');
  assertEq(loco1Parked.y, r7DepotY, 'loco1 parked at depot Y');
  assertEq(loco1Parked.goingToDepot, null, 'goingToDepot cleared upon entering depot');

  r7VehRenderer.update(r7Engine.getState(), 0.016, 500);

  // Detach 1 COAL wagon to spare siding and sell the other 2 COAL wagons -> loco1 back to 0 wagons
  const oldCoalWagons = [...(loco1Parked.wagons ?? [])];
  assertEq(oldCoalWagons.length, 3, 'loco1 arrived in depot with its 3 COAL wagons');
  assert(
    r7Engine.detachTrainWagonToDepot(loco1Id, oldCoalWagons[0].id).ok,
    'Detached 1st COAL wagon to depot spare siding'
  );
  assert(r7Engine.sellTrainWagon(loco1Id, oldCoalWagons[1].id).ok, 'Sold 2nd COAL wagon');
  assert(r7Engine.sellTrainWagon(loco1Id, oldCoalWagons[2].id).ok, 'Sold 3rd COAL wagon');
  assertEq(
    r7Engine.getState().vehicles.find((v) => v.id === loco1Id)!.wagonCount,
    0,
    'loco1 stripped back to 0 wagons inside depot'
  );

  // Reconfigure the SAME locomotive with a mixed consist: 2x PASSENGERS + 1x MAIL!
  assert(r7Engine.buyRailWagon(r7DepotX, r7DepotY, 'PASSENGERS', loco1Id).ok, 'Coupled PASSENGERS wagon #1');
  assert(r7Engine.buyRailWagon(r7DepotX, r7DepotY, 'PASSENGERS', loco1Id).ok, 'Coupled PASSENGERS wagon #2');
  assert(r7Engine.buyRailWagon(r7DepotX, r7DepotY, 'MAIL', loco1Id).ok, 'Coupled MAIL wagon #3');

  const loco1Reconfigured = r7Engine.getState().vehicles.find((v) => v.id === loco1Id)!;
  assertEq(loco1Reconfigured.wagonCount, 3, 'Reconfigured loco1 has 3 wagons');
  assertEq(
    loco1Reconfigured.capacity,
    2 * RAIL_WAGON_CATALOG.PASSENGERS.capacity + RAIL_WAGON_CATALOG.MAIL.capacity,
    'Mixed consist capacity === 2*40 + 30 = 110'
  );
  assertEq(
    loco1Reconfigured.wagons!.map((w) => w.cargoType).join(','),
    'PASSENGERS,PASSENGERS,MAIL',
    'Mixed consist wagon order === PASSENGERS,PASSENGERS,MAIL'
  );

  // Verify VehicleRenderer dynamically rebuilds the 3D wagon meshes for the new mixed consist!
  r7VehRenderer.update(r7Engine.getState(), 0.016, 1000);
  const rebuiltCargoTypes: string[] = [];
  for (const rootObj of r7VehRenderer.group.children) {
    for (const childObj of rootObj.children) {
      if (childObj.userData && typeof childObj.userData.cargoType === 'string') {
        rebuiltCargoTypes.push(childObj.userData.cargoType);
      }
    }
  }
  assertEq(
    rebuiltCargoTypes.join(','),
    'PASSENGERS,PASSENGERS,MAIL',
    'VehicleRenderer rebuilt mixed 3D wagon meshes (PASSENGERS,PASSENGERS,MAIL)'
  );
  r7VehRenderer.dispose();

  // Verify Multiplayer Slice exports `wt` per-wagon cargo array cleanly
  const r7MpSlice = r7Engine.exportMultiplayerSlice();
  assert(!JSON.stringify(r7MpSlice).includes('undefined'), 'Round 7 MP slice has zero undefined fields');
  const mpTrainSnap = r7MpSlice.vehicles.find((v) => v.id === loco1Id);
  assertEq(
    mpTrainSnap?.wt?.join(','),
    'PASSENGERS,PASSENGERS,MAIL',
    'Multiplayer slice exports mixed-consist wt === PASSENGERS,PASSENGERS,MAIL'
  );

  // Seed BOTH waiting PASSENGERS and waiting MAIL at stTownA, update orders to [stTownA, stTownB], and verify simultaneous multi-cargo haul!
  const stTownAObj = r7Engine.getState().stations.find((s) => s.id === stTownARes.stationId)!;
  stTownAObj.waitingCargo.PASSENGERS = 120;
  stTownAObj.waitingCargo.MAIL = 60;

  const revBeforeMixedRun = r7Engine.getState().corporate.currentYearPnL.freightRevenue;
  const dispatchMixedRes = r7Engine.updateVehicleOrders(loco1Id, [
    stTownARes.stationId!,
    stTownBRes.stationId!,
  ]);
  assert(dispatchMixedRes.ok, 'Updated orders to [stTownA, stTownB] and dispatched mixed train');
  assertEq(
    r7Engine.getState().vehicles.find((v) => v.id === loco1Id)!.state,
    'MOVING',
    'Reconfigured mixed train automatically dispatched from depot'
  );

  let observedSimultaneousPaxAndMailOnboard = false;
  for (let t = 0; t < 90 * 14; t++) {
    r7Engine.tick(1);
    const curTrain = r7Engine.getState().vehicles.find((v) => v.id === loco1Id)!;
    const wags = curTrain.wagons ?? [];
    const paxLoaded = wags
      .filter((w) => w.cargoType === 'PASSENGERS')
      .reduce((s, w) => s + w.cargoAmount, 0);
    const mailLoaded = wags
      .filter((w) => w.cargoType === 'MAIL')
      .reduce((s, w) => s + w.cargoAmount, 0);
    if (paxLoaded > 0 && mailLoaded > 0) {
      observedSimultaneousPaxAndMailOnboard = true;
    }
    if (
      observedSimultaneousPaxAndMailOnboard &&
      r7Engine.getState().corporate.currentYearPnL.freightRevenue > revBeforeMixedRun &&
      paxLoaded === 0 &&
      mailLoaded === 0
    ) {
      break;
    }
  }

  assert(
    observedSimultaneousPaxAndMailOnboard,
    'Mixed train loaded BOTH PASSENGERS and MAIL simultaneously in its separate wagons'
  );
  const revAfterMixedRun = r7Engine.getState().corporate.currentYearPnL.freightRevenue;
  assert(
    revAfterMixedRun > revBeforeMixedRun,
    `Mixed train delivered PASSENGERS + MAIL to stTownB and earned revenue (+${revAfterMixedRun - revBeforeMixedRun} kr)`
  );

  // 12d. All 7 Specialized Road Vehicles (ROAD_VEHICLE_SHOP_LIST) & In-Depot Cargo Refit
  const roadDepX = 20;
  const roadDepY = 25;
  assert(r7Engine.applyTool(roadDepX, roadDepY, 'ROAD_DEPOT').ok, 'Built ROAD_DEPOT at (20, 25)');

  const boughtRoadIds: Array<{ id: string; modelId: string; cargoType: string }> = [];
  for (const roadSpec of ROAD_VEHICLE_SHOP_LIST) {
    const beforeRoadCash = r7Engine.getState().corporate.cash;
    const bRes = r7Engine.buyRoadVehicle(roadDepX, roadDepY, roadSpec.shopId);
    assert(bRes.ok && Boolean(bRes.vehicleId), `Bought road shop item ${roadSpec.shopId} (${roadSpec.nameNo})`);
    assertEq(
      beforeRoadCash - r7Engine.getState().corporate.cash,
      roadSpec.price,
      `Exact price charged for ${roadSpec.shopId} (${roadSpec.price} kr)`
    );
    const rv = r7Engine.getState().vehicles.find((v) => v.id === bRes.vehicleId)!;
    assertEq(rv.state, 'IN_DEPOT', `${roadSpec.shopId} spawns IN_DEPOT`);
    assertEq(rv.cargoType, roadSpec.cargoType, `${roadSpec.shopId} cargoType === ${roadSpec.cargoType}`);
    assertEq(rv.capacity, roadSpec.capacity, `${roadSpec.shopId} capacity === ${roadSpec.capacity}`);
    boughtRoadIds.push({ id: rv.id, modelId: rv.modelId, cargoType: rv.cargoType });
  }

  const busEntry = boughtRoadIds.find((b) => b.modelId === 'BUS_CITY')!;
  const coalTruckEntry = boughtRoadIds.find(
    (b) => b.modelId === 'TRUCK_CARGO' && b.cargoType === 'COAL'
  )!;
  assert(
    !r7Engine.refitRoadVehicleInDepot(busEntry.id, 'GOODS').ok,
    'refitRoadVehicleInDepot rejects refitting a passenger bus'
  );
  assert(
    !r7Engine.refitRoadVehicleInDepot(coalTruckEntry.id, 'PASSENGERS').ok,
    'refitRoadVehicleInDepot rejects refitting a cargo truck to PASSENGERS'
  );

  const cashBeforeRefit = r7Engine.getState().corporate.cash;
  const refitRes = r7Engine.refitRoadVehicleInDepot(coalTruckEntry.id, 'FOOD');
  assert(refitRes.ok, `Refitted COAL truck to FOOD reefer truck in depot: ${refitRes.message}`);
  assertEq(
    cashBeforeRefit - r7Engine.getState().corporate.cash,
    ROAD_REFIT_COST_KR,
    'refitRoadVehicleInDepot charged exact 5 000 kr'
  );
  const refittedTruck = r7Engine.getState().vehicles.find((v) => v.id === coalTruckEntry.id)!;
  assertEq(refittedTruck.cargoType, 'FOOD', 'Refitted truck cargoType === FOOD');
  const foodTruckShopSpec = ROAD_VEHICLE_SHOP_LIST.find((s) => s.cargoType === 'FOOD')!;
  assertEq(
    refittedTruck.capacity,
    foodTruckShopSpec.capacity,
    `Refitted FOOD truck capacity updated to ${foodTruckShopSpec.capacity}`
  );

  console.log(
    '  [OK] Bare locomotives, 0-wagon guard, separate 7 rail wagons, spare siding, COAL->PASSENGERS+MAIL depot swap, 3D mixed consist rebuild & 7 road vehicles + refit verified.'
  );

  // =========================================================================
  // 13. Round 8 Catchment Grid, Multi-Track (1-4) x Multi-Length (1-6) Stations, Pull-In & Overhang Penalty
  // =========================================================================
  section(
    '13. Round 8 Catchment Grid, Multi-Track (1-4) x Multi-Length (1-6) Oriented Stations, Pull-In & Overhang Penalty'
  );

  assertEq(MAX_STATION_TRACKS, 4, 'MAX_STATION_TRACKS === 4');
  assertEq(MAX_STATION_LENGTH, 6, 'MAX_STATION_LENGTH === 6');
  assertEq(getTrainRequiredPlatformTiles(0), 1, '0 wagons requires 1 platform tile');
  assertEq(getTrainRequiredPlatformTiles(1), 1, '1 wagon requires 1 platform tile');
  assertEq(getTrainRequiredPlatformTiles(3), 2, '3 wagons requires 2 platform tiles');
  assertEq(getTrainRequiredPlatformTiles(5), 3, '5 wagons requires 3 platform tiles');
  assertEq(getTrainRequiredPlatformTiles(7), 4, '7 wagons requires 4 platform tiles');
  assertEq(getTrainRequiredPlatformTiles(8), 5, '8 wagons requires 5 platform tiles');

  const r8Engine = new GameEngine({
    worldSetup: {
      mapSize: 64,
      terrainType: 'flat',
      waterLevel: 'very_low',
      aiEnabled: false,
      maxAiCount: 0,
      seed: 20260801,
    },
  });
  r8Engine.grantDevFunds('corporate', 40_000_000);
  const r8State = r8Engine.getState();

  // Clear flat arena x=6..58, y=6..58 at elevation 1
  for (let cy = 6; cy <= 58; cy++) {
    for (let cx = 6; cx <= 58; cx++) {
      const t = r8State.tiles[tileIndex(cx, cy, 64)];
      t.industryId = undefined;
      t.townId = undefined;
      t.buildingTier = undefined;
      t.stationId = undefined;
      t.stationAxis = undefined;
      t.depot = null;
      t.hqOwnerId = null;
      t.ownerId = null;
      t.road = false;
      t.rail = false;
      t.signal = false;
      t.bridge = null;
      t.bridgeAxis = undefined;
      t.bridgeType = null;
      t.bridgeElevation = undefined;
      t.terrain = 'GRASS';
      t.elevation = 1;
    }
  }

  // Place a town building at (16, 8) — exactly 4 tiles north of a 2x4 station at (15..18, 12..13) —
  // and a COAL_MINE at (12, 12) within radius 4 so previewStationPlacement detects supplied & accepted cargos!
  const r8TownA = r8State.towns[0];
  const r8TownB = r8State.towns[1];
  r8TownA.x = 16;
  r8TownA.y = 8;
  r8State.tiles[tileIndex(16, 8, 64)].townId = r8TownA.id;
  r8State.tiles[tileIndex(16, 8, 64)].buildingTier = 3;

  const r8CoalMine = r8State.industries.find((ind) => ind.produces === 'COAL')!;
  r8CoalMine.x = 11;
  r8CoalMine.y = 12;
  r8CoalMine.width = 2;
  r8CoalMine.height = 2;

  // 13a. previewStationPlacement & getStationCatchmentTiles (4-tile Chebyshev rail, 3-tile road)
  const prev2x4 = r8Engine.previewStationPlacement(15, 12, 'TRAIN_STATION', {
    orientation: 'X',
    stationTracks: 2,
    stationLength: 4,
  });
  assert(prev2x4.ok, 'previewStationPlacement ok for 2x4 X-oriented TRAIN_STATION');
  assertEq(prev2x4.tracks, 2, 'Preview tracks === 2');
  assertEq(prev2x4.platformLength, 4, 'Preview platformLength === 4');
  assertEq(prev2x4.orientation, 'X', 'Preview orientation === X');
  assertEq(prev2x4.catchmentRadius, RAIL_STATION_CATCHMENT_RADIUS, 'Rail catchmentRadius === 4');
  assertEq(prev2x4.footprintTiles.length, 8, '2x4 station has 8 footprintTiles');
  assert(prev2x4.footprintTiles.every((ft) => ft.valid), 'All 8 footprintTiles are valid');
  assertEq(prev2x4.cost, 8 * BUILD_COSTS.TRAIN_STATION, '2x4 station cost === 8 * 45 000 = 360 000 kr');
  // Bounding box around [15..18]x[12..13] with Chebyshev radius 4 is [11..22]x[8..17] = 12*10 = 120, minus 8 footprint = 112!
  assertEq(
    prev2x4.catchmentTiles.length,
    12 * 10 - 8,
    '2x4 rail station catchment grid has exact 112 surrounding tiles (Chebyshev r=4)'
  );
  assert(
    prev2x4.suppliedCargos.includes('COAL') && prev2x4.suppliedCargos.includes('PASSENGERS'),
    'previewStationPlacement detects COAL & PASSENGERS supplied inside 4-tile catchment'
  );
  assert(
    prev2x4.acceptedCargos.includes('PASSENGERS') && prev2x4.acceptedCargos.includes('GOODS'),
    'previewStationPlacement detects PASSENGERS & GOODS accepted inside 4-tile catchment'
  );

  const prevBus = r8Engine.previewStationPlacement(22, 22, 'BUS_STOP');
  assert(prevBus.ok, 'previewStationPlacement ok for 1x1 BUS_STOP');
  assertEq(prevBus.catchmentRadius, ROAD_STATION_CATCHMENT_RADIUS, 'Road catchmentRadius === 3');
  assertEq(prevBus.footprintTiles.length, 1, 'BUS_STOP has 1 footprint tile');
  assertEq(
    prevBus.catchmentTiles.length,
    7 * 7 - 1,
    '1x1 BUS_STOP catchment grid has exact 48 surrounding tiles (Chebyshev r=3)'
  );

  // Slope mismatch check: raising one tile inside a 4x6 Y-oriented preview marks preview invalid
  r8State.tiles[tileIndex(44, 15, 64)].elevation = 2;
  const slopedPrev = r8Engine.previewStationPlacement(42, 12, 'TRAIN_STATION', {
    orientation: 'Y',
    stationTracks: 4,
    stationLength: 6,
  });
  assert(!slopedPrev.ok, 'previewStationPlacement rejects uneven elevation across 4x6 footprint');
  r8State.tiles[tileIndex(44, 15, 64)].elevation = 1;

  // 13b. Multi-Track (1..4) x Multi-Length (1..6) x ('X' | 'Y') Construction, Bulldoze & Parallel-Track Isolation
  const build2x4Res = r8Engine.applyTool(15, 12, 'TRAIN_STATION', {
    orientation: 'X',
    stationTracks: 2,
    stationLength: 4,
  });
  assert(build2x4Res.ok && Boolean(build2x4Res.stationId), 'Built 2x4 X-oriented TRAIN_STATION');
  const st2x4 = r8Engine.getState().stations.find((s) => s.id === build2x4Res.stationId)!;
  assertEq(st2x4.orientation, 'X', 'st2x4.orientation === X');
  assertEq(getEffectiveStationTracks(st2x4), 2, 'getEffectiveStationTracks(st2x4) === 2');
  assertEq(getEffectiveStationPlatformLength(st2x4), 4, 'getEffectiveStationPlatformLength(st2x4) === 4');
  assertEq(
    r8Engine.getStationCatchmentTiles(st2x4.id).length,
    112,
    'getStationCatchmentTiles(st2x4) returns all 112 catchment tiles'
  );
  for (let ty = 12; ty <= 13; ty++) {
    for (let tx = 15; tx <= 18; tx++) {
      const ft = r8Engine.getState().tiles[tileIndex(tx, ty, 64)];
      assertEq(ft.stationId, st2x4.id, `Tile (${tx},${ty}) belongs to st2x4`);
      assertEq(ft.stationAxis, 'X', `Tile (${tx},${ty}) sets stationAxis === X`);
      assert(ft.rail === true, `Tile (${tx},${ty}) sets rail === true`);
    }
  }

  // Build maximum 4-track x 6-length Y-oriented station at (48..51, 10..15), verify structures & terrain renderers, then bulldoze cleanly!
  const build4x6YRes = r8Engine.applyTool(48, 10, 'TRAIN_STATION', {
    orientation: 'Y',
    stationTracks: 4,
    stationLength: 6,
  });
  assert(build4x6YRes.ok && Boolean(build4x6YRes.stationId), 'Built max 4x6 Y-oriented TRAIN_STATION');
  const st4x6Y = r8Engine.getState().stations.find((s) => s.id === build4x6YRes.stationId)!;
  assertEq(st4x6Y.tiles.length, 24, '4x6 Y-oriented station covers 24 tiles');
  assertEq(st4x6Y.orientation, 'Y', '4x6 station orientation === Y');
  assertEq(
    r8Engine.getState().tiles[tileIndex(51, 15, 64)].stationAxis,
    'Y',
    'Far corner (51,15) of 4x6 Y station has stationAxis === Y'
  );

  // Exercise TerrainInstancer & StructuresRenderer across both 2x4 X and 4x6 Y multi-track stations!
  const r8Terrain = new TerrainInstancer();
  const r8Structures = new StructuresRenderer(null as unknown as HTMLElement);
  r8Terrain.sync(r8Engine.getState());
  r8Structures.sync(r8Engine.getState());
  assert(r8Structures.group.children.length > 0, 'StructuresRenderer built 2x4 X and 4x6 Y stations cleanly');
  r8Terrain.dispose();
  r8Structures.dispose();

  // Bulldoze a tile of st4x6Y and confirm stationAxis never leaks onto bulldozed tiles
  for (let ty = 10; ty <= 15; ty++) {
    for (let tx = 48; tx <= 51; tx++) {
      const bRes = r8Engine.applyTool(tx, ty, 'BULLDOZE');
      assert(bRes.ok, `Bulldozed 4x6 station tile (${tx},${ty})`);
      const cleared = r8Engine.getState().tiles[tileIndex(tx, ty, 64)];
      assertEq(cleared.stationAxis, undefined, `Bulldozed tile (${tx},${ty}) cleared stationAxis`);
      assert(!cleared.stationId && !cleared.rail, `Bulldozed tile (${tx},${ty}) cleared stationId & rail`);
    }
  }
  assert(
    !r8Engine.getState().stations.some((s) => s.id === st4x6Y.id),
    'Fully bulldozed 4x6 station removed from state.stations'
  );

  // Verify parallel-track isolation inside st2x4 (x=15..18, y=12..13):
  // Without throat switches outside the station, Track 1 (y=12) CANNOT step sideways to Track 2 (y=13)!
  const crossPlatformAttempt = findNetworkPath(
    r8Engine.getState().tiles,
    64,
    16,
    12,
    [{ x: 16, y: 13 }],
    'RAIL'
  );
  assertEq(
    crossPlatformAttempt.length,
    0,
    'Pathfinder strictly forbids sideways cross-platform jumps between Track 1 (y=12) and Track 2 (y=13)'
  );

  // Now connect two separate parallel approach tracks into Track 1 (y=12) and Track 2 (y=13) of st2x4,
  // with an east throat switch at x=19..24 and 2 trains entering & loading simultaneously on Track 1 & Track 2!
  r8TownB.x = 34;
  r8TownB.y = 11;
  r8State.tiles[tileIndex(34, 11, 64)].townId = r8TownB.id;
  r8State.tiles[tileIndex(34, 11, 64)].buildingTier = 3;

  assert(r8Engine.applyDragTrackOrRoad(19, 12, 34, 12, 'RAIL').ok, 'Built east upper track y=12');
  assert(r8Engine.applyDragTrackOrRoad(19, 13, 34, 13, 'RAIL').ok, 'Built east lower track y=13');
  assert(r8Engine.applyDragTrackOrRoad(22, 12, 22, 13, 'RAIL').ok, 'Built throat crossover outside station at x=22');
  const buildEast2x2 = r8Engine.applyTool(33, 12, 'TRAIN_STATION', {
    orientation: 'X',
    stationTracks: 2,
    stationLength: 2,
  });
  assert(buildEast2x2.ok && Boolean(buildEast2x2.stationId), 'Built east 2x2 destination station');
  const depTrack1 = r8Engine.applyTool(25, 11, 'RAIL_DEPOT');
  assert(r8Engine.applyDragTrackOrRoad(25, 11, 25, 12, 'RAIL').ok, 'Connected depot 1');
  const depTrack2 = r8Engine.applyTool(25, 14, 'RAIL_DEPOT');
  assert(r8Engine.applyDragTrackOrRoad(25, 14, 25, 13, 'RAIL').ok, 'Connected depot 2');
  assert(depTrack1.ok && depTrack2.ok, 'Built twin rail depots feeding Track 1 and Track 2');

  // Seed lots of waiting passengers at st2x4 so both trains stay LOADING simultaneously on Track 1 & Track 2!
  r8Engine.getState().stations.find((s) => s.id === st2x4.id)!.waitingCargo.PASSENGERS = 400;

  const pTrain1 = r8Engine.buyVehicle({
    depotX: 25,
    depotY: 11,
    modelId: 'LOCO_ELECTRIC',
    cargoType: 'PASSENGERS',
    wagonCount: 3,
    orders: [st2x4.id, buildEast2x2.stationId!],
    waitForFullLoad: true,
  });
  const pTrain2 = r8Engine.buyVehicle({
    depotX: 25,
    depotY: 14,
    modelId: 'LOCO_ELECTRIC',
    cargoType: 'PASSENGERS',
    wagonCount: 3,
    orders: [st2x4.id, buildEast2x2.stationId!],
    waitForFullLoad: true,
  });
  assert(pTrain1.ok && pTrain2.ok, 'Spawned 2 express trains targeting 2x4 multi-track station');

  let bothLoadingOnSeparateTracks = false;
  for (let sub = 0; sub < 300; sub++) {
    r8Engine.tick(1);
    const v1 = r8Engine.getState().vehicles.find((v) => v.id === pTrain1.vehicleId)!;
    const v2 = r8Engine.getState().vehicles.find((v) => v.id === pTrain2.vehicleId)!;
    if (v1.state === 'LOADING' && v2.state === 'LOADING' && v1.y !== v2.y) {
      if ((v1.y === 12 && v2.y === 13) || (v1.y === 13 && v2.y === 12)) {
        bothLoadingOnSeparateTracks = true;
        break;
      }
    }
  }
  assert(
    bothLoadingOnSeparateTracks,
    '2 trains simultaneously entered and loaded side-by-side on Track 1 (y=12) and Track 2 (y=13) of 2x4 station!'
  );

  // 13c. Full-Train Pull-In Verification:
  //      A train entering a 1x5 station at x=20 (spanning x=20..24, y=28) from the west MUST pull all the way to (24, 28) before LOADING!
  const pullInStRes = r8Engine.applyTool(20, 28, 'TRAIN_STATION', {
    orientation: 'X',
    stationTracks: 1,
    stationLength: 5,
  });
  const pullDestRes = r8Engine.applyTool(8, 28, 'TRAIN_STATION', {
    orientation: 'X',
    stationTracks: 1,
    stationLength: 2,
  });
  assert(r8Engine.applyDragTrackOrRoad(10, 28, 19, 28, 'RAIL').ok, 'Built west approach into 1x5 station (20..24, 28)');
  assert(r8Engine.applyTool(12, 27, 'RAIL_DEPOT').ok, 'Built pull-in test depot');
  assert(r8Engine.applyDragTrackOrRoad(12, 27, 12, 28, 'RAIL').ok, 'Connected pull-in depot');
  assert(pullInStRes.ok && pullDestRes.ok, 'Built 1x5 pull-in station at (20..24, 28)');

  const pullTrainRes = r8Engine.buyVehicle({
    depotX: 12,
    depotY: 27,
    modelId: 'LOCO_DIESEL',
    cargoType: 'PASSENGERS',
    wagonCount: 4,
    orders: [pullInStRes.stationId!, pullDestRes.stationId!],
  });
  assert(pullTrainRes.ok && Boolean(pullTrainRes.vehicleId), 'Spawned train for 1x5 full pull-in test');

  let firstLoadingTileX = -1;
  let loadedPrematurelyBeforeFarEnd = false;
  for (let sub = 0; sub < 400; sub++) {
    r8Engine.tick(1);
    const pv = r8Engine.getState().vehicles.find((v) => v.id === pullTrainRes.vehicleId)!;
    if (pv.state === 'LOADING' && pv.y === 28 && pv.x >= 20 && pv.x <= 24) {
      if (pv.x < 24) {
        loadedPrematurelyBeforeFarEnd = true;
      }
      firstLoadingTileX = pv.x;
      break;
    }
  }
  assert(!loadedPrematurelyBeforeFarEnd, 'Train did NOT stop prematurely on entry tiles 20..23 of 1x5 station');
  assertEq(
    firstLoadingTileX,
    24,
    'Train pulled all the way to far-end tile (24, 28) of 1x5 station before switching to LOADING'
  );

  // Also verify VehicleRenderer applies forward buffer pull-in (+0.20) while LOADING on (24, 28)
  const r8VehRenderer = new VehicleRenderer();
  for (let frame = 0; frame < 20; frame++) {
    r8VehRenderer.update(r8Engine.getState(), 0.05, frame * 50);
  }
  r8VehRenderer.dispose();

  // 13d. OpenTTD Overhang Loading/Unloading Time Penalty Verification:
  //      Compare an identical 8-wagon (5-tile required) train unloading + loading 280t COAL at:
  //      - Lane A (y=36): 1x1 short station (platformOverhangTiles === 4)
  //      - Lane B (y=42): 1x5 full-length station (platformOverhangTiles === 0)
  function measureEightWagonStationTurnaroundSubticks(rowY: number, platformLen: number): {
    loadingSubticks: number;
    observedOverhangTiles: number;
  } {
    // Place coal-accepting power plant & coal mine anchor near destination station at x=22..26
    const destAnchorX = 22;
    assert(r8Engine.applyDragTrackOrRoad(10, rowY, 28, rowY, 'RAIL').ok, `Built overhang test track y=${rowY}`);
    const originSt = r8Engine.applyTool(10, rowY, 'TRAIN_STATION', {
      orientation: 'X',
      stationTracks: 1,
      stationLength: 5,
    });
    const testSt = r8Engine.applyTool(destAnchorX, rowY, 'TRAIN_STATION', {
      orientation: 'X',
      stationTracks: 1,
      stationLength: platformLen,
    });
    const dep = r8Engine.applyTool(16, rowY - 1, 'RAIL_DEPOT');
    assert(r8Engine.applyDragTrackOrRoad(16, rowY - 1, 16, rowY, 'RAIL').ok, 'Connected overhang depot');
    assert(originSt.ok && testSt.ok && dep.ok, `Built stations for platformLen=${platformLen}`);

    const loco = r8Engine.buyLocomotive(16, rowY - 1, 'LOCO_ELECTRIC');
    assert(loco.ok && Boolean(loco.vehicleId), 'Bought 8-wagon test locomotive');
    const vId = loco.vehicleId!;
    for (let w = 0; w < 8; w++) {
      assert(r8Engine.buyRailWagon(16, rowY - 1, 'COAL', vId).ok, `Attached COAL wagon #${w + 1}`);
    }

    // Pre-load all 8 wagons with COAL from originSt AND stock 280t waiting COAL at testSt so it unloads + reloads full 8 wagons!
    const testStationObj = r8Engine.getState().stations.find((s) => s.id === testSt.stationId)!;
    // Ensure testStationObj accepts COAL via nearbyIndustryIds and has 280t waiting COAL to load
    const pp = r8Engine.getState().industries.find((ind) => ind.accepts.includes('COAL'))!;
    if (!testStationObj.nearbyIndustryIds.includes(pp.id)) {
      testStationObj.nearbyIndustryIds.push(pp.id);
    }
    testStationObj.waitingCargo.COAL = 280;

    const veh = r8Engine.getState().vehicles.find((v) => v.id === vId)!;
    for (const wag of veh.wagons!) {
      wag.cargoAmount = wag.capacity;
      wag.cargoOriginStationId = originSt.stationId!;
      wag.cargoLoadedDay = r8Engine.getState().date.totalDays;
    }
    veh.cargoAmount = 8 * RAIL_WAGON_CATALOG.COAL.capacity;
    veh.cargoOriginStationId = originSt.stationId!;

    // Dispatch directly to testSt -> originSt
    assert(r8Engine.updateVehicleOrders(vId, [testSt.stationId!, originSt.stationId!]).ok, 'Dispatched 8-wagon train');

    let enteredLoading = false;
    let loadingSubticks = 0;
    let observedOverhangTiles = -1;

    for (let sub = 0; sub < 800; sub++) {
      r8Engine.tick(1);
      const curV = r8Engine.getState().vehicles.find((v) => v.id === vId)!;
      if (curV.state === 'LOADING') {
        enteredLoading = true;
        loadingSubticks++;
        if ((curV.platformOverhangTiles ?? 0) > observedOverhangTiles) {
          observedOverhangTiles = curV.platformOverhangTiles ?? 0;
        }
      } else if (enteredLoading && curV.state === 'MOVING') {
        break;
      }
    }

    return { loadingSubticks, observedOverhangTiles };
  }

  const short1TileResult = measureEightWagonStationTurnaroundSubticks(36, 1);
  const full5TileResult = measureEightWagonStationTurnaroundSubticks(44, 5);

  assertEq(
    short1TileResult.observedOverhangTiles,
    4,
    '8-wagon (5-tile) train at 1-tile station reports platformOverhangTiles === 4'
  );
  assertEq(
    full5TileResult.observedOverhangTiles,
    0,
    '8-wagon (5-tile) train at 5-tile station reports platformOverhangTiles === 0'
  );
  assert(
    short1TileResult.loadingSubticks >= full5TileResult.loadingSubticks * 3,
    `Overhang time penalty verified: 8-wagon train took ${short1TileResult.loadingSubticks} subticks on 1-tile station vs ${full5TileResult.loadingSubticks} subticks on 5-tile station`
  );

  // Verify Multiplayer Slice syncs station orientation, tracks, platformLength & sa cleanly
  const r8MpSlice = r8Engine.exportMultiplayerSlice();
  assert(!JSON.stringify(r8MpSlice).includes('undefined'), 'Round 8 MP slice has zero undefined fields');
  const syncedSt2x4 = r8MpSlice.stations.find((s) => s.id === st2x4.id);
  assertEq(syncedSt2x4?.tracks, 2, 'MP slice preserves station tracks === 2');
  assertEq(syncedSt2x4?.platformLength, 4, 'MP slice preserves station platformLength === 4');
  assertEq(syncedSt2x4?.orientation, 'X', 'MP slice preserves station orientation === X');

  console.log(
    `  [OK] Catchment grids (112 rail / 48 road), 1-4 tracks x 1-6 length X/Y stations, parallel dual-train loading, full pull-in & overhang penalty (${short1TileResult.loadingSubticks} vs ${full5TileResult.loadingSubticks} subticks) verified.`
  );
  console.log(`\nALL ${passedAssertions} HEADLESS VERIFICATION ASSERTIONS PASSED 100%!`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n[FATAL ERROR in verify-sim.ts]:', err);
    process.exit(1);
  });
