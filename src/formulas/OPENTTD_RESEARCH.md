# OpenTTD Mechanics & Formula Analysis (`Transport Tycoon: Classroom Edition`)

This document records the exact C++ mechanics, constants, and equations extracted from the official [OpenTTD (`OpenTTD/OpenTTD`, `master`)](https://github.com/OpenTTD/OpenTTD) source code and documents how each mechanic is calibrated into Norwegian Kroner (`kr`) for a 30–45 minute classroom simulation.

---

## 1. Cargo Specifications & Transit-Time Payment Decay

### Official OpenTTD C++ Source
- **Cargo Table:** `src/table/cargo_const.h` (`_default_cargo`, lines 57–100)
- **Payment Formula:** `src/economy.cpp` (`GetTransportedGoodsIncome`, lines 957–1019)

In `src/economy.cpp`:
```cpp
static const int MIN_TIME_FACTOR = 31;
static const int MAX_TIME_FACTOR = 255;

const int periods1 = cs->transit_periods[0];
const int periods2 = cs->transit_periods[1];
const int periods_over_periods1 = std::max(transit_periods - periods1, 0);
const int periods_over_periods2 = std::max(periods_over_periods1 - periods2, 0);
// ...
const int time_factor = std::max(MAX_TIME_FACTOR - periods_over_periods1 - periods_over_periods2, MIN_TIME_FACTOR);
return BigMulS(dist * time_factor * num_pieces, cs->current_payment, 21);
```

### Extracted OpenTTD `_default_cargo` Constants
| Cargo (`FormulaCargoType`) | OpenTTD Label | `initial_payment` | `td1` (`transit_periods[0]`) | `td2` (`transit_periods[1]`) | `TownAcceptanceEffect` | Calibrated `baseRateKr` | Classroom `days1` / `days2` |
| :--- | :--- | :---: | :---: | :---: | :--- | :---: | :---: |
| `PASSENGERS` (*Passasjerer*) | `CT_PASSENGERS` | `3185` | `0` | `24` | `Passengers` | `3.2 kr` | `3` / `24` |
| `MAIL` (*Post*) | `CT_MAIL` | `4550` | `20` | `90` | `Mail` | `5.2 kr` | `15` / `75` |
| `COAL` (*Kull*) | `CT_COAL` | `5916` | `7` | `255` | `None` | `11.5 kr` | `18` / `255` |
| `WOOD` (*Tømmer*) | `CT_WOOD` (Temp.) | `5005` | `15` | `255` | `None` | `10.2 kr` | `35` / `255` |
| `GOODS` (*Varer*) | `CT_GOODS` | `6144` | `5` | `28` | `Goods` | `13.5 kr` | `12` / `45` |
| `GRAIN` (*Korn*) | `CT_GRAIN` | `4778` | `4` | `40` | `None` | `9.8 kr` | `10` / `50` |
| `FOOD` (*Matvarer*) | `CT_FOOD` | `5688` | `0` | `30` | `Food` | `12.2 kr` | `4` / `30` |

### Classroom `kr` Calibration (`calculateCargoPayment`)
- In authentic OpenTTD (`cargo_const.h`), passengers (`weight=1`, `ip=3185`) and mail (`weight=4`, `ip=4550`) are low-unit-value municipal/express flows that primarily stimulate town growth (`TownAcceptanceEffect::Passengers` / `Mail`) rather than printing massive profits from a single cheap `65 000 kr` bus, whereas heavy bulk & processed commodities (`GRAIN`, `WOOD`, `COAL`, `FOOD`, `GOODS`) reward capital-intensive truck fleets and multi-wagon trains:
  $$\text{timeFactor} = \max\bigl(31,\; 255 - \max(0, d - \text{days}_1) - \max(0, d - \text{days}_2)\bigr)$$
  $$\text{Income (kr)} = \text{round}\!\left(\text{manhattanDistance} \times \text{units} \times \text{baseRateKr} \times \frac{\text{timeFactor}}{255}\right)$$
- **Sample Route Yields (TTD-Balanced):**
  - City/Intercity Bus (`32` pax, `20` tiles, fast transit): `2 048 kr` (modest, steady farebox yield)
  - Mail Truck (`25` bags `MAIL`, `24` tiles): `3 120 kr`
  - Timber Truck (`25` tons `WOOD`, `24` tiles): `6 120 kr`
  - Goods Truck (`25` crates `GOODS`, `30` tiles): `10 125 kr`
  - Heavy Coal Train (`96` tons `COAL` [3 wagons], `38` tiles): `41 952 kr`

---

## 2. Primary & Secondary Industry Production Mechanics

### Official OpenTTD C++ Source
- **Periodic Production:** `src/industry_cmd.cpp` (`ProduceIndustryGoods` / `ProduceIndustryGoodsHelper`, lines 1151–1197; `ChangeIndustryProduction`, lines 2880–2965)
- **Delivery & Transformation:** `src/economy.cpp` (`DeliverGoodsToIndustry`, lines 1034–1075; `TriggerIndustryProduction`, lines 1141–1169)

In `TriggerIndustryProduction` (`src/economy.cpp:1158-1164`), secondary industries convert delivered stockpile (`ita->waiting`) into output stockpile (`itp->waiting`):
```cpp
itp->waiting = ClampTo<uint16_t>(
    itp->waiting + (ita->waiting * indspec->input_cargo_multiplier[...][...] / 256)
);
ita->waiting = 0;
```
- **Primary Industries (`FOREST`, `COAL_MINE`, `FARM`):** Generate monthly cargo distributed to catchment stations proportional to station rating (`ChangeIndustryProduction` rewards `> 60%` / `> 80%` transported cargo in `src/industry_cmd.cpp:2937,2956-2962`).
- **Secondary Industries (`SAWMILL`, `FOOD_PLANT`):** Convert `WOOD -> GOODS` and `GRAIN -> FOOD` at OpenTTD's standard `256 / 256` (`1.0`) Temperate conversion multiplier (`calculateSecondaryIndustryOutput`), while `POWER_PLANT` acts as a pure `COAL` sink (`INDUSTRYLIFE_BLACK_HOLE`, `src/industry_cmd.cpp:2927`).

---

## 3. Station Rating (`UpdateStationRating`)

### Official OpenTTD C++ Source
- **Function:** `UpdateStationRating` in `src/station_cmd.cpp` (lines 3967–4072)

OpenTTD computes `rating` on a `0..255` (`MAX_STATION_RATING = 255`, `INITIAL_STATION_RATING = 175`) scale from four additive components:
1. **Last Vehicle Max Speed (`lines 4042-4043`):** `b = ge->last_speed - 85; if (b >= 0) rating += b >> 2;` (up to `+42`).
2. **Time Since Last Pickup (`lines 4045-4050`):** `waittime` in 185-tick (~2.5-day) units:
   - `<= 21` (`~52.5d`): `+25`
   - `<= 12` (`~30d`): `+25` (cumulative `+50`)
   - `<= 6` (`~15d`): `+45` (cumulative `+95`)
   - `<= 3` (`~7.5d`): `+35` (cumulative `+130`)
3. **Waiting Cargo Penalty/Bonus (`lines 4052-4057`):** Starts at `-90`, then adds `+55` (`<= 1500`), `+35` (`<= 1000`), `+10` (`<= 600`), `+20` (`<= 300`), `+10` (`<= 100`), yielding `+40` net for clean platforms and `-90` for neglected stockpiles `> 1500`.
4. **Vehicle Age / Active Service Baseline (`lines 4062-4065`):** `+10..+33` (`+20` baseline in `calculateStationRating` when serviced).

### Classroom Mapping (`calculateStationRating`)
Normalized to `0..100%` (`(clamped255 / 255) * 100`) plus the **Personal HQ Proximity Bonus** (`+5%` per HQ Tier 1–5 for stations near the owner's HQ, replacing OpenTTD's town statue `+26/255` bonus at `line 4060`), clamped to `[0, 100]`.

---

## 4. Vehicle Running Costs & Slope/Hill Drag

### Official OpenTTD C++ Source
- **Running Cost Accumulation:**
  - `src/train_cmd.cpp`: `Train::Tick` (`line 4209`: `if (!Stopped || cur_speed > 0) this->running_ticks++`) and `Train::OnNewEconomyDay` (`line 4296`: `GetRunningCost() * running_ticks / (DAYS_IN_YEAR * DAY_TICKS)`).
  - `src/roadveh_cmd.cpp`: `RoadVehicle::Tick` (`line 1665`) and `RoadVehicle::OnNewEconomyDay` (`line 1739`).
- **Slope / Hill Speed Penalties:**
  - **Trains (`src/train_cmd.cpp`, lines 3146–3170):** `_accel_slowdown` sets `z_up = 256 / 4 = 64` and `AffectSpeedByZChange` applies `cur_speed -= (cur_speed * 64 >> 8)` (**-25% speed per uphill Z step**, `192/256 = 0.75`), while downhill adds `z_down = 2` capped at `cached_max_track_speed` (`1.0`). In Realistic mode (`src/ground_vehicle.cpp:95`, `src/train.h:323`), `cached_slope_resistance = current_weight * train_slope_steepness * 100` penalizes heavy multi-wagon trains steeply on grades.
  - **Road Vehicles (`src/roadveh_cmd.cpp`, lines 867–877):** `RoadZPosAffectSpeed` applies `cur_speed = cur_speed * 232 / 256` (**-9.375% speed per uphill Z step**, `0.90625`), and downhill adds `+2` capped at `cached_max_track_speed` (`1.0`).

### Classroom Mapping (`src/formulas/vehicles.ts`)
- `calculateMonthlyRunningCost(baseAnnualCostKr, state)`: `(baseAnnualCostKr / 12) * factor` with `1.00` (`moving`), `0.60` (`loading`), `0.25` (`stopped`), `0.10` (`depot`).
- `calculateSlopeSpeedFactor(currentElev, nextElev, network)`:
  - Flat or downhill (`nextElev <= currentElev`): `1.0` (capped at max vehicle speed).
  - Uphill (`delta = nextElev - currentElev > 0`): Rail `max(0.25, 0.75^delta)` vs Road `max(0.40, (232/256)^delta)`.

---

## 5. Town Growth Curve

### Official OpenTTD C++ Source
- **Functions:** `CountActiveStations`, `GetNormalGrowthRate`, `UpdateTownGrowth` (`src/town_cmd.cpp`, lines 3874–3966)

```cpp
static const uint16_t _grow_count_values[2][6] = {
    { 120, 120, 120, 100,  80,  60 }, // Fund new buildings activated
    { 320, 420, 300, 220, 160, 100 }  // Normal values (0..5 active stations)
};
```
- `CountActiveStations(t)` counts town stations with `time_since_load <= 20 || time_since_unload <= 20`, capped at `5` (`std::min(n, 5)`).
- Unserviced towns (`n == 0`) hit `!Chance16(1, 12)` in `UpdateTownGrowth` (`line 3963`) and stagnate.
- `GetNormalGrowthRate` scales house expansion by town size (`m / (num_houses / 50 + 1)`, `line 3911`), while `UpdateTownGrowth` (`lines 3942-3954`) evaluates `TownAcceptanceEffect` deliveries (`Passengers`, `Mail`, `Goods`, `Food`).
- `calculateTownGrowthDelta` maps `4200 / _grow_count_values[1][n]` (`10 -> 14 -> 19.1 -> 26.25 -> 42` base monthly pop for `1..5` stations) + cargo delivery boosts (`Passengers`, `Mail`, `Goods`/`Food`) scaled by town population.

---

## 6. Company Valuation & Norwegian Dual-Economy Tax

### Official OpenTTD C++ Source (`src/economy.cpp`, lines 118–195)
- `CalculateCompanyAssetValue`: `station_facilities * StationValue * 25 + sum(vehicle->value * 3 >> 1)`.
- `CalculateCompanyValue`: `std::max<Money>(assetValue - current_loan + money, 1)`.
- `CalculateHostileTakeoverValue`: adds `2 * max(0, four_quarter_profit)` when valuing equity for acquisitions/shares.
- `calculateCompanyValuation` combines `cash - loan + fleetBookValue + infrastructureCount * 15 000 + max(0, annualProfit) * 2`, floored at `1 kr`.

### Classroom Norwegian Progressive Tax (`calculateProgressiveTax`)
Models the tension between **Corporate AS Cash** and **Personal Owner Wealth**:
- **Personal Income Tax (*Trinnskatt / Skatt på alminnelig inntekt*, simplified):**
  - `0 – 25 000 kr/mnd`: `20%`
  - `25 001 – 50 000 kr/mnd`: `30%` marginal
  - `> 50 000 kr/mnd`: `42%` marginal
- **Employer Payroll Tax (*Arbeidsgiveravgift*, Sone 1):** `14.1%` paid by the corporation on top of gross salary (`totalCorporateCost = gross * 1.141`).
