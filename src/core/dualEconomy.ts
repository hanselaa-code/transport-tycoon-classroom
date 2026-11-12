import {
  calculateCompanyValuation,
  calculateMonthlyRunningCost,
  calculateProgressiveTax,
  calculateStationRating,
  calculateTownGrowthDelta,
} from '../formulas';
import {
  ActionResult,
  AICompany,
  CargoType,
  CorporateFinance,
  GameState,
  NewsItem,
  PersonalFinance,
  PnLStatement,
  ScenarioType,
  Station,
} from '../types/game';
import {
  ALL_CARGO_TYPES,
  BASE_LOAN_INTEREST_RATE,
  calculateVehicleBaseAnnualCost,
  DEFAULT_MAX_LOAN_KR,
  formatGameDate,
  formatKr,
  getHQCumulativeValue,
   getHQTierSpec,
  HQ_BONUS_RADIUS,
  INITIAL_CORPORATE_CASH_KR,
  INITIAL_CORPORATE_LOAN_KR,
  INITIAL_MONTHLY_GROSS_SALARY_KR,
  INITIAL_PERSONAL_CASH_KR,
  LOAN_STEP_KR,
  MAX_PLAYER_AI_SHARE_PCT,
  STATION_CATCHMENT_RADIUS,
  TOTAL_AI_SHARES,
} from './catalog';
import { expandTownBuildings, inBounds, tileIndex } from './mapGenerator';

export function createEmptyPnL(year: number): PnLStatement {
  return {
    year,
    freightRevenue: 0,
    constructionCost: 0,
    vehiclePurchaseCost: 0,
    vehicleRunningCost: 0,
    loanInterestCost: 0,
    ownerSalaryCost: 0,
    employerPayrollTaxCost: 0,
  };
}

export function calculatePnLOperatingProfit(pnl: PnLStatement): number {
  return (
    pnl.freightRevenue -
    pnl.vehicleRunningCost -
    pnl.loanInterestCost -
    pnl.ownerSalaryCost -
    pnl.employerPayrollTaxCost
  );
}

export function createInitialCorporateFinance(
  scenario: ScenarioType = 'standard',
  year = 1
): CorporateFinance {
  const startingCash =
    scenario === 'boom'
      ? 3_000_000
      : scenario === 'challenge'
        ? 1_200_000
        : INITIAL_CORPORATE_CASH_KR;

  const initialValuation = calculateCompanyValuation({
    cash: startingCash,
    loan: INITIAL_CORPORATE_LOAN_KR,
    fleetBookValue: 0,
    infrastructureCount: 0,
    annualProfit: 0,
  });

  return {
    companyName: 'Norsk Transport AS',
    cash: startingCash,
    loan: INITIAL_CORPORATE_LOAN_KR,
    maxLoan: DEFAULT_MAX_LOAN_KR,
    annualInterestRate: BASE_LOAN_INTEREST_RATE,
    hqTier: 0,
    hqTile: null,
    currentYearPnL: createEmptyPnL(year),
    lastYearPnL: createEmptyPnL(year - 1),
    companyValue: initialValuation,
    isBankruptWarning: false,
  };
}

export function createInitialPersonalFinance(): PersonalFinance {
  const initialTax = calculateProgressiveTax(INITIAL_MONTHLY_GROSS_SALARY_KR);
  return {
    ownerName: 'Gründer',
    cash: INITIAL_PERSONAL_CASH_KR,
    monthlyGrossSalary: INITIAL_MONTHLY_GROSS_SALARY_KR,
    nextMonthGrossSalary: INITIAL_MONTHLY_GROSS_SALARY_KR,
    lifetimeTaxPaid: 0,
    lastMonthTaxBreakdown: initialTax,
    portfolio: {},
    dividendsReceivedTotal: 0,
    realizedGainsTotal: 0,
    personalNetWorth: INITIAL_PERSONAL_CASH_KR,
  };
}

export function pushNews(
  state: GameState,
  text: string,
  category: NewsItem['category'] = 'INFO'
): void {
  const dateLabel = formatGameDate(state.date.day, state.date.month, state.date.year);
  const id = `news-${state.date.totalDays}-${state.news.length + 1}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  state.news.unshift({ id, dateLabel, text, category });
  if (state.news.length > 40) {
    state.news.length = 40;
  }
}

export function getStationHQBonusPct(
  station: Station,
  corporate: CorporateFinance
): number {
  if (station.ownerId !== 'player') return 0;
  if (corporate.hqTier <= 0 || !corporate.hqTile) return 0;

  const dist = Math.hypot(
    station.x - corporate.hqTile.x,
    station.y - corporate.hqTile.y
  );
  if (dist <= HQ_BONUS_RADIUS) {
    return corporate.hqTier * 5;
  }
  return 0;
}

export function updateStationRatings(state: GameState): void {
  for (const station of state.stations) {
    const hqBonus = getStationHQBonusPct(station, state.corporate);
    const maxSpeed = station.lastVehicleMaxSpeedKmh ?? 80;
    for (const cargo of ALL_CARGO_TYPES) {
      const waiting = station.waitingCargo[cargo] ?? 0;
      station.ratings[cargo] = calculateStationRating(
        station.daysSincePickup,
        maxSpeed,
        waiting,
        hqBonus
      );
    }
  }
}

export function refreshStationCatchment(state: GameState, station: Station): void {
  let bestTownId: string | null = null;
  let bestTownDist = Infinity;

  for (const town of state.towns) {
    for (const stTile of station.tiles) {
      const dist = Math.max(
        Math.abs(stTile.x - town.x),
        Math.abs(stTile.y - town.y)
      );
      if (dist <= STATION_CATCHMENT_RADIUS + 2 && dist < bestTownDist) {
        bestTownDist = dist;
        bestTownId = town.id;
      }
    }
  }
  station.townId = bestTownId;

  const nearbyIds: string[] = [];
  for (const ind of state.industries) {
    let inCatchment = false;
    for (let dy = 0; dy < ind.height && !inCatchment; dy++) {
      for (let dx = 0; dx < ind.width && !inCatchment; dx++) {
        const ix = ind.x + dx;
        const iy = ind.y + dy;
        for (const stTile of station.tiles) {
          const dist = Math.max(Math.abs(stTile.x - ix), Math.abs(stTile.y - iy));
          if (dist <= STATION_CATCHMENT_RADIUS) {
            inCatchment = true;
            break;
          }
        }
      }
    }
    if (inCatchment) {
      nearbyIds.push(ind.id);
    }
  }
  station.nearbyIndustryIds = nearbyIds;
}

export function doesStationAcceptCargo(
  state: GameState,
  station: Station,
  cargo: CargoType
): { accepts: boolean; targetIndustryId: string | null; targetTownId: string | null } {
  // Check industries in catchment first
  for (const indId of station.nearbyIndustryIds) {
    const ind = state.industries.find((i) => i.id === indId);
    if (ind && ind.accepts.includes(cargo)) {
      return { accepts: true, targetIndustryId: ind.id, targetTownId: null };
    }
  }

  // Check town in catchment
  if (station.townId) {
    const town = state.towns.find((t) => t.id === station.townId);
    if (town) {
      if (
        cargo === 'PASSENGERS' ||
        cargo === 'MAIL' ||
        cargo === 'GOODS' ||
        cargo === 'FOOD'
      ) {
        return { accepts: true, targetIndustryId: null, targetTownId: town.id };
      }
    }
  }

  return { accepts: false, targetIndustryId: null, targetTownId: null };
}

/**
 * Seeds a newly constructed station with an initial small batch from nearby industries/towns
 * so newly built classroom or demo routes begin loading promptly.
 */
export function seedInitialStationCargo(state: GameState, station: Station): void {
  updateStationRatings(state);

  for (const indId of station.nearbyIndustryIds) {
    const ind = state.industries.find((i) => i.id === indId);
    if (!ind || !ind.produces) continue;
    if (station.kind === 'BUS_STOP' && ind.produces !== 'PASSENGERS') continue;

    if (ind.storedOutput > 0) {
      const initialBatch = Math.min(ind.storedOutput, 32);
      ind.storedOutput -= initialBatch;
      station.waitingCargo[ind.produces] =
        (station.waitingCargo[ind.produces] ?? 0) + initialBatch;
    }
  }

  if (station.townId) {
    const town = state.towns.find((t) => t.id === station.townId);
    if (town) {
      if (station.kind === 'BUS_STOP' || station.kind === 'TRAIN_STATION') {
        const initialPax = Math.max(12, Math.round(town.monthlyPassengers * 0.35));
        station.waitingCargo.PASSENGERS =
          (station.waitingCargo.PASSENGERS ?? 0) + initialPax;
      }
      if (station.kind === 'TRUCK_BAY' || station.kind === 'TRAIN_STATION') {
        const initialMail = Math.max(6, Math.round(town.monthlyMail * 0.3));
        station.waitingCargo.MAIL = (station.waitingCargo.MAIL ?? 0) + initialMail;
      }
    }
  }
}

/**
 * Distributes 1/6th of monthly industry & town cargo output every 5 game days
 * across nearby stations weighted by OpenTTD station ratings.
 */
export function distributePeriodicCargoOutput(state: GameState): void {
  updateStationRatings(state);

  // 1. Primary & Secondary Industries
  for (const ind of state.industries) {
    if (!ind.produces) continue;
    const cargo = ind.produces;

    if (ind.monthlyProduction > 0) {
      const producedBatch = Math.max(1, Math.round(ind.monthlyProduction / 6));
      ind.storedOutput = Math.min(400, ind.storedOutput + producedBatch);
    }

    if (ind.storedOutput <= 0) continue;

    const candidateStations = state.stations.filter(
      (s) =>
        s.nearbyIndustryIds.includes(ind.id) &&
        !(s.kind === 'BUS_STOP' && cargo !== 'PASSENGERS')
    );

    if (candidateStations.length === 0) {
      // Cap storedOutput when unserved
      ind.storedOutput = Math.min(160, ind.storedOutput);
      continue;
    }

    const maxRating = Math.max(
      ...candidateStations.map((s) => s.ratings[cargo] ?? 60)
    );
    const totalRatingSum = candidateStations.reduce(
      (acc, s) => acc + Math.max(10, s.ratings[cargo] ?? 60),
      0
    );

    // Secondary industries keep a small visible buffer in storedOutput while transferring bulk to platform
    const transferable =
      ind.monthlyProduction === 0
        ? Math.ceil(ind.storedOutput * 0.75)
        : ind.storedOutput;

    const transportedTotal = Math.max(
      1,
      Math.round(transferable * (Math.max(35, maxRating) / 100))
    );
    const actualMoved = Math.min(ind.storedOutput, transportedTotal);
    ind.storedOutput -= actualMoved;

    for (const st of candidateStations) {
      const share =
        (actualMoved * Math.max(10, st.ratings[cargo] ?? 60)) / totalRatingSum;
      const units = Math.max(1, Math.round(share));
      st.waitingCargo[cargo] = Math.min(
        500,
        (st.waitingCargo[cargo] ?? 0) + units
      );
    }
  }

  // 2. Towns (Passengers & Mail)
  for (const town of state.towns) {
    const townStations = state.stations.filter((s) => s.townId === town.id);
    if (townStations.length === 0) continue;

    // Passengers -> Bus Stops & Train Stations
    const paxStations = townStations.filter(
      (s) => s.kind === 'BUS_STOP' || s.kind === 'TRAIN_STATION'
    );
    if (paxStations.length > 0) {
      const maxPaxRating = Math.max(
        ...paxStations.map((s) => s.ratings.PASSENGERS ?? 65)
      );
      const sumPaxRating = paxStations.reduce(
        (acc, s) => acc + Math.max(10, s.ratings.PASSENGERS ?? 65),
        0
      );
      const paxBatch = Math.max(
        2,
        Math.round((town.monthlyPassengers / 6) * (maxPaxRating / 100))
      );
      for (const st of paxStations) {
        const share =
          (paxBatch * Math.max(10, st.ratings.PASSENGERS ?? 65)) / sumPaxRating;
        st.waitingCargo.PASSENGERS = Math.min(
          450,
          (st.waitingCargo.PASSENGERS ?? 0) + Math.max(1, Math.round(share))
        );
      }
    }

    // Mail -> Truck Bays & Train Stations
    const mailStations = townStations.filter(
      (s) => s.kind === 'TRUCK_BAY' || s.kind === 'TRAIN_STATION'
    );
    if (mailStations.length > 0) {
      const maxMailRating = Math.max(
        ...mailStations.map((s) => s.ratings.MAIL ?? 65)
      );
      const sumMailRating = mailStations.reduce(
        (acc, s) => acc + Math.max(10, s.ratings.MAIL ?? 65),
        0
      );
      const mailBatch = Math.max(
        1,
        Math.round((town.monthlyMail / 6) * (maxMailRating / 100))
      );
      for (const st of mailStations) {
        const share =
          (mailBatch * Math.max(10, st.ratings.MAIL ?? 65)) / sumMailRating;
        st.waitingCargo.MAIL = Math.min(
          300,
          (st.waitingCargo.MAIL ?? 0) + Math.max(1, Math.round(share))
        );
      }
    }
  }
}

export function recomputeValuationsAndWarnings(state: GameState): void {
  const { corporate, personal } = state;

  // Check liquidity / bankruptcy warning
  const wasWarning = corporate.isBankruptWarning;
  corporate.isBankruptWarning = corporate.cash < 0;
  if (corporate.isBankruptWarning && !wasWarning) {
    pushNews(
      state,
      `LIKVIDITETSVARSEL: ${corporate.companyName} har negativ kontantbeholdning (${formatKr(corporate.cash)})!`,
      'WARNING'
    );
  }

  // Corporate valuation
  let fleetBookValue = 0;
  for (const v of state.vehicles) {
    if (v.ownerId === 'player') {
      const depFactor = Math.max(0.25, 1 - v.ageMonths * 0.008);
      fleetBookValue += Math.round(v.purchaseValue * depFactor);
    }
  }

  let infrastructureCount = 0;
  for (const t of state.tiles) {
    if (t.ownerId === 'player' && (t.rail || t.road || t.depot || t.stationId)) {
      infrastructureCount++;
    }
  }

  const curProfit = calculatePnLOperatingProfit(corporate.currentYearPnL);
  const prevProfit = calculatePnLOperatingProfit(corporate.lastYearPnL);
  const annualProfitEstimate =
    state.date.year === 1 ? curProfit : Math.round(curProfit * 0.6 + prevProfit * 0.4);

  corporate.companyValue = calculateCompanyValuation({
    cash: corporate.cash,
    loan: corporate.loan,
    fleetBookValue,
    infrastructureCount,
    annualProfit: annualProfitEstimate,
  });

  // Personal net worth = personal cash + cumulative HQ value + market value of AI share portfolio
  let portfolioValue = 0;
  for (const ai of state.aiCompanies) {
    if (ai.spawned && ai.playerSharesPct > 0) {
      const sharesHeld = Math.round((ai.playerSharesPct / 100) * TOTAL_AI_SHARES);
      portfolioValue += sharesHeld * ai.sharePrice;
    }
  }

  personal.personalNetWorth =
    personal.cash + getHQCumulativeValue(corporate.hqTier) + portfolioValue;
}

export function adjustCorporateLoan(
  state: GameState,
  deltaKr: number
): ActionResult {
  const { corporate } = state;
  const step = Math.round(deltaKr / LOAN_STEP_KR) * LOAN_STEP_KR;
  if (step === 0) {
    return { ok: false, message: 'Låneendring må være i steg på 100 000 kr.' };
  }

  if (step > 0) {
    const availableToBorrow = corporate.maxLoan - corporate.loan;
    if (availableToBorrow <= 0) {
      return {
        ok: false,
        message: `Maksimalt banklån (${formatKr(corporate.maxLoan)}) er allerede nådd.`,
      };
    }
    const borrow = Math.min(step, availableToBorrow);
    corporate.loan += borrow;
    corporate.cash += borrow;
    recomputeValuationsAndWarnings(state);
    return {
      ok: true,
      cost: -borrow,
      message: `Tok opp ${formatKr(borrow)} i banklån.`,
    };
  } else {
    const repayReq = Math.min(Math.abs(step), corporate.loan);
    if (repayReq <= 0) {
      return { ok: false, message: 'Selskapet er allerede gjeldsfritt!' };
    }
    if (corporate.cash < repayReq) {
      return {
        ok: false,
        message: `Ikke nok selskapskontanter til å nedbetale ${formatKr(repayReq)}.`,
      };
    }
    corporate.loan -= repayReq;
    corporate.cash -= repayReq;
    recomputeValuationsAndWarnings(state);
    return {
      ok: true,
      cost: repayReq,
      message: `Nedbetalte ${formatKr(repayReq)} på banklånet.`,
    };
  }
}

export function setOwnerGrossSalary(
  state: GameState,
  grossKr: number
): ActionResult {
  const clamped = Math.max(0, Math.round(grossKr));
  state.personal.nextMonthGrossSalary = clamped;
  // Also refresh preview breakdown if on day 1 before first month tick
  if (state.date.totalMonths === 0) {
    state.personal.monthlyGrossSalary = clamped;
    state.personal.lastMonthTaxBreakdown = calculateProgressiveTax(clamped);
  }
  return {
    ok: true,
    message: `Månedlig bruttolønn satt til ${formatKr(clamped)} (gjelder ved neste månedsskifte).`,
  };
}

export function placeHQAtTile(
  state: GameState,
  x: number,
  y: number
): ActionResult {
  if (!inBounds(x, y, state.mapSize)) {
    return { ok: false, message: 'Ugyldig kartposisjon.' };
  }
  if (state.corporate.hqTile) {
    return {
      ok: false,
      message: 'Hovedkontoret er allerede plassert. Bruk oppgradering for høyere nivå!',
    };
  }

  const tile = state.tiles[tileIndex(x, y, state.mapSize)];
  if (
    tile.terrain === 'WATER' ||
    tile.road ||
    tile.rail ||
    tile.depot ||
    tile.stationId ||
    tile.industryId ||
    tile.hqOwnerId ||
    (tile.buildingTier ?? 0) > 0
  ) {
    return {
      ok: false,
      message: 'Hovedkontoret må plasseres på en ledig landrute uten vei, spor eller bygninger.',
    };
  }

  const tier1 = getHQTierSpec(1)!;
  if (state.personal.cash < tier1.personalCost) {
    return {
      ok: false,
      message: `Du trenger ${formatKr(tier1.personalCost)} i privat kontantbeholdning for å bygge hovedkontor!`,
    };
  }

  // Strictly deduct from Personal Cash
  state.personal.cash -= tier1.personalCost;
  tile.terrain = 'GRASS';
  tile.hqOwnerId = 'player';
  tile.ownerId = 'player';
  state.corporate.hqTile = { x, y };
  state.corporate.hqTier = 1;
  state.corporate.annualInterestRate = Number(
    (BASE_LOAN_INTEREST_RATE - tier1.loanInterestDiscountPct).toFixed(2)
  );
  state.networkRevision = (state.networkRevision ?? 0) + 1;

  updateStationRatings(state);
  recomputeValuationsAndWarnings(state);
  pushNews(
    state,
    `${state.personal.ownerName} bygget nytt hovedkontor (${tier1.nameNo}) for private midler!`,
    'ECONOMY'
  );

  return {
    ok: true,
    cost: tier1.personalCost,
    message: `Bygget ${tier1.nameNo} (Nivå 1) for ${formatKr(tier1.personalCost)} privat!`,
  };
}

export function upgradeCorporateHQ(state: GameState): ActionResult {
  // If HQ hasn't been placed on map yet, auto-place Tier 1 near main town so headless scripts or 1-click work cleanly
  if (state.corporate.hqTier === 0 || !state.corporate.hqTile) {
    const primaryTown = state.towns[0];
    if (primaryTown) {
      for (let r = 2; r <= 8; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const tx = primaryTown.x + dx;
            const ty = primaryTown.y + dy;
            if (!inBounds(tx, ty, state.mapSize)) continue;
            const res = placeHQAtTile(state, tx, ty);
            if (res.ok) return res;
            if (state.personal.cash < getHQTierSpec(1)!.personalCost) {
              return res;
            }
          }
        }
      }
    }
    return { ok: false, message: 'Fant ingen ledig tomt for hovedkontoret.' };
  }

  if (state.corporate.hqTier >= 5) {
    return { ok: false, message: 'Hovedkontoret er allerede på maksimalt nivå (Nivå 5)!' };
  }

  const nextTier = state.corporate.hqTier + 1;
  const spec = getHQTierSpec(nextTier)!;

  if (state.personal.cash < spec.personalCost) {
    return {
      ok: false,
      message: `Krever ${formatKr(spec.personalCost)} i privat kontantbeholdning (du har ${formatKr(state.personal.cash)}).`,
    };
  }

  // Paid strictly from Personal Cash!
  state.personal.cash -= spec.personalCost;
  state.corporate.hqTier = nextTier;
  state.corporate.annualInterestRate = Number(
    (BASE_LOAN_INTEREST_RATE - spec.loanInterestDiscountPct).toFixed(2)
  );
  state.networkRevision = (state.networkRevision ?? 0) + 1;

  updateStationRatings(state);
  recomputeValuationsAndWarnings(state);
  pushNews(
    state,
    `Hovedkontoret oppgradert til Nivå ${nextTier}: ${spec.nameNo}! Lånerente er nå ${state.corporate.annualInterestRate.toFixed(1)} %.`,
    'ECONOMY'
  );

  return {
    ok: true,
    cost: spec.personalCost,
    message: `Oppgraderte hovedkontoret til Nivå ${nextTier} (${spec.nameNo})!`,
  };
}

export function buyAICompanyShares(
  state: GameState,
  aiId: string,
  pctBlock = 10,
  costBasisByAi?: Record<string, number>
): ActionResult {
  const ai = state.aiCompanies.find((c) => c.id === aiId);
  if (!ai || !ai.spawned) {
    return { ok: false, message: 'Dette selskapet er ikke børsnotert ennå.' };
  }

  if (pctBlock <= 0) {
    return { ok: false, message: 'Ugyldig aksjepost.' };
  }

  if (ai.playerSharesPct + pctBlock > MAX_PLAYER_AI_SHARE_PCT) {
    return {
      ok: false,
      message: `Maksimal tillatt eierandel i konkurrent er ${MAX_PLAYER_AI_SHARE_PCT} %.`,
    };
  }

  const sharesCount = Math.round((pctBlock / 100) * TOTAL_AI_SHARES);
  const cost = sharesCount * ai.sharePrice;

  if (state.personal.cash < cost) {
    return {
      ok: false,
      message: `Du trenger ${formatKr(cost)} i privat kontantbeholdning for å kjøpe ${pctBlock} % i ${ai.name}.`,
    };
  }

  state.personal.cash -= cost;
  ai.playerSharesPct += pctBlock;
  state.personal.portfolio[ai.id] = ai.playerSharesPct;

  if (costBasisByAi) {
    costBasisByAi[ai.id] = (costBasisByAi[ai.id] ?? 0) + cost;
  }

  recomputeValuationsAndWarnings(state);
  return {
    ok: true,
    cost,
    message: `Kjøpte ${pctBlock} % aksjer i ${ai.name} for ${formatKr(cost)} privat.`,
  };
}

export function sellAICompanyShares(
  state: GameState,
  aiId: string,
  pctBlock = 10,
  costBasisByAi?: Record<string, number>
): ActionResult {
  const ai = state.aiCompanies.find((c) => c.id === aiId);
  if (!ai || !ai.spawned) {
    return { ok: false, message: 'Selskapet er ikke børsnotert.' };
  }

  const sellPct = Math.min(pctBlock, ai.playerSharesPct);
  if (sellPct <= 0) {
    return { ok: false, message: `Du eier ingen aksjer i ${ai.name}.` };
  }

  const prevPct = ai.playerSharesPct;
  const sharesCount = Math.round((sellPct / 100) * TOTAL_AI_SHARES);
  const proceeds = sharesCount * ai.sharePrice;

  if (costBasisByAi && prevPct > 0) {
    const totalBasis = costBasisByAi[ai.id] ?? proceeds;
    const basisForSold = Math.round(totalBasis * (sellPct / prevPct));
    costBasisByAi[ai.id] = Math.max(0, totalBasis - basisForSold);
    state.personal.realizedGainsTotal += proceeds - basisForSold;
  }

  state.personal.cash += proceeds;
  ai.playerSharesPct -= sellPct;
  if (ai.playerSharesPct <= 0) {
    ai.playerSharesPct = 0;
    delete state.personal.portfolio[ai.id];
  } else {
    state.personal.portfolio[ai.id] = ai.playerSharesPct;
  }

  recomputeValuationsAndWarnings(state);
  return {
    ok: true,
    cost: -proceeds,
    message: `Solgte ${sellPct} % aksjer i ${ai.name} for ${formatKr(proceeds)} til privat konto.`,
  };
}

export function payQuarterlyDividends(state: GameState): void {
  let totalDividendReceived = 0;

  for (const ai of state.aiCompanies) {
    if (!ai.spawned || ai.playerSharesPct <= 0 || ai.dividendPerQuarter <= 0) {
      continue;
    }
    const payout = Math.round(ai.dividendPerQuarter * (ai.playerSharesPct / 100));
    if (payout > 0) {
      state.personal.cash += payout;
      state.personal.dividendsReceivedTotal += payout;
      totalDividendReceived += payout;
    }
  }

  if (totalDividendReceived > 0) {
    pushNews(
      state,
      `Kvartalsutbytte utbetalt: +${formatKr(totalDividendReceived)} direkte til ${state.personal.ownerName}s privatkonto!`,
      'ECONOMY'
    );
    recomputeValuationsAndWarnings(state);
  }
}

/**
 * Executes the Monthly Dual-Economy & Town Growth tick (every 30 game days).
 */
export function runMonthlyEconomyTick(state: GameState): void {
  const { corporate, personal } = state;

  // 1. Player Vehicle Running Costs
  for (const v of state.vehicles) {
    v.ageMonths += 1;
    const baseAnnual = calculateVehicleBaseAnnualCost(v.modelId, v.wagonCount);
    const stateKey =
      v.state === 'MOVING'
        ? 'moving'
        : v.state === 'LOADING' || v.state === 'WAITING_SIGNAL'
          ? 'loading'
          : v.state === 'STOPPED'
            ? 'stopped'
            : 'depot';
    const monthlyRunCost = Math.round(calculateMonthlyRunningCost(baseAnnual, stateKey));
    v.runningCostPerMonth = monthlyRunCost;
    v.profitThisYear -= monthlyRunCost;

    if (v.ownerId === 'player') {
      corporate.cash -= monthlyRunCost;
      corporate.currentYearPnL.vehicleRunningCost += monthlyRunCost;
    } else {
      const ai = state.aiCompanies.find((a) => a.id === v.ownerId);
      if (ai) {
        ai.cash -= monthlyRunCost;
      }
    }
  }

  // 2. Corporate Bank Loan Interest
  corporate.annualInterestRate = Number(
    (BASE_LOAN_INTEREST_RATE - corporate.hqTier * 0.5).toFixed(2)
  );
  const monthlyInterest = Math.round(
    (corporate.loan * (corporate.annualInterestRate / 100)) / 12
  );
  if (monthlyInterest > 0) {
    corporate.cash -= monthlyInterest;
    corporate.currentYearPnL.loanInterestCost += monthlyInterest;
  }

  // 3. Owner Salary + Employer Payroll Tax (14.1%) + Progressive Personal Income Tax
  personal.monthlyGrossSalary = personal.nextMonthGrossSalary;
  const taxBreakdown = calculateProgressiveTax(personal.monthlyGrossSalary);
  personal.lastMonthTaxBreakdown = taxBreakdown;

  if (taxBreakdown.gross > 0) {
    corporate.cash -= taxBreakdown.totalCorporateCost;
    corporate.currentYearPnL.ownerSalaryCost += taxBreakdown.gross;
    corporate.currentYearPnL.employerPayrollTaxCost += taxBreakdown.employerPayrollTax;

    personal.lifetimeTaxPaid += taxBreakdown.totalIncomeTax;
    personal.cash += taxBreakdown.netPersonalPay;
  }

  // 4. Town Growth & Visible Building Expansion
  let buildingsExpanded = false;
  for (const town of state.towns) {
    const activeStations = state.stations.filter(
      (s) => s.townId === town.id && s.daysSincePickup <= 45
    ).length;
    town.servicedStations = activeStations;

    const growthDelta = calculateTownGrowthDelta(
      town.population,
      activeStations,
      town.deliveredPassengersThisMonth ?? 0,
      town.deliveredMailThisMonth ?? 0,
      town.deliveredGoodsOrFoodThisMonth ?? 0
    );

    if (growthDelta > 0) {
      town.growthCounter += growthDelta;
      const wholePopIncrease = Math.floor(town.growthCounter);
      if (wholePopIncrease > 0) {
        town.population += wholePopIncrease;
        town.growthCounter -= wholePopIncrease;
        town.monthlyPassengers = Math.max(25, Math.round(town.population * 0.14));
        town.monthlyMail = Math.max(12, Math.round(town.population * 0.06));
        if (expandTownBuildings(state.tiles, state.mapSize, town)) {
          buildingsExpanded = true;
        }
      }
    }

    town.deliveredPassengersThisMonth = 0;
    town.deliveredMailThisMonth = 0;
    town.deliveredGoodsOrFoodThisMonth = 0;
  }

  if (buildingsExpanded) {
    state.networkRevision = (state.networkRevision ?? 0) + 1;
  }

  updateStationRatings(state);
  recomputeValuationsAndWarnings(state);
}

/**
 * Rolls P&L statements and annual vehicle profits at the end of Month 12 -> Year + 1.
 */
export function runYearlyRolloverTick(state: GameState, newYear: number): void {
  state.corporate.lastYearPnL = { ...state.corporate.currentYearPnL };
  state.corporate.currentYearPnL = createEmptyPnL(newYear);

  for (const v of state.vehicles) {
    v.profitThisYear = 0;
  }
}
