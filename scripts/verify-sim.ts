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
  GameEngine,
  HQ_TIERS,
  INITIAL_CORPORATE_CASH_KR,
  INITIAL_CORPORATE_LOAN_KR,
  LOAN_STEP_KR,
  RAIL_STATION_CATCHMENT_RADIUS,
  ROAD_STATION_CATCHMENT_RADIUS,
  TOTAL_AI_SHARES,
  VEHICLE_CATALOG,
  createGameEngine,
  getStationHQBonusPct,
  getStationSuppliedCargos,
  isCargoCompatibleWithStationKind,
  isTileTraversableForNetwork,
  tileIndex,
} from '../src/core';
import {
  WATER_SURFACE_Y,
  getCornerHeight,
  getSurfaceHeightAt,
  getTileCornerHeights,
} from '../src/renderer/IsoSceneManager';
import { TerrainInstancer } from '../src/renderer/TerrainInstancer';
import { StructuresRenderer } from '../src/renderer/StructuresRenderer';
import { VehicleRenderer } from '../src/renderer/VehicleRenderer';
import { firebaseConfig, hasValidFirebaseConfig } from '../src/firebase/config';
import {
  createClassroomSession,
  isFirebaseConfigured,
  joinClassroomSession,
  pushStudentTelemetry,
  subscribeToClassroom,
} from '../src/firebase/classroom';

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

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  console.log('Starting Transport Tycoon: Classroom Edition Headless Verification (Round 2 TTD Edition)...');

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
