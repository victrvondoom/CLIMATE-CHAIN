// Port of the hourly dispatch in packages/sim/src/index.ts simulateScenario (synthetic-profile path).
// Each 15-minute step: hospital load first (solar, grid, battery down to the physical floor, then tiered shed),
// then residential and EV load (solar, grid, battery down to the reserve), then surplus solar charges the
// battery and the rest is curtailed. All energies are kWh per step; kW values are divided by DT.
//
// Not ported: the generator, measured site-data profiles and their paired-day sampling, the renewable
// provenance accounting, the failure cause text, and the Monte Carlo, optimizer and surrogate layers.

import { DT, PRESETS, STEPS, type DispatchConfig, type Intervention, type LocationDef, type PresetId } from './params';
import { clamp, gaussian, mulberry32 } from './random';

export type RiskBucket = 'critical' | 'high' | 'moderate' | 'safe';

export interface Battery {
  energyKWh: number;
  capacityKWh: number;
  floorKWh: number; // physical minimum: batteryMinSocPct of capacity
  reserveKWh: number; // reserve held back from flexible load only
  chargeEff: number;
  dischargeEff: number;
  maxChargeKW: number;
  maxDischargeKW: number;
}

export interface StepFlows {
  solarKWh: number; // solar energy available this step
  hospitalKWh: number;
  flexibleKWh: number; // residential plus EV
  gridCapKWh: number; // zero while the grid is out
  dt: number;
  tier0Share: number;
  tier1Share: number;
  tier2Share: number;
  tier3Share: number;
}

export interface StepOutcome {
  energyKWh: number; // battery energy after the step
  gridKWh: number; // grid import used
  batteryDeliveredKWh: number; // energy delivered to load from the battery
  batteryChargedKWh: number; // solar energy put into the battery, before losses
  curtailedKWh: number; // surplus solar that could not be used or stored
  hospitalUnservedKWh: number;
  flexibleUnservedKWh: number;
  shedKWh: number; // hospital energy shed from tier 2 and tier 3
  criticalUnservedKWh: number; // hospital energy lost from tier 0 and tier 1
  tiers: { tier0: number; tier1: number; tier2: number; tier3: number };
  stepFailed: boolean;
  batteryThroughputKWh: number;
  energyBalanceErrorKWh: number;
}

// One 15-minute step of the dispatch. Pure: the caller carries the battery state forward.
export function dispatchStep(bat: Battery, f: StepFlows): StepOutcome {
  const Emax = bat.capacityKWh;
  const floor = bat.floorKWh;
  let E = bat.energyKWh;
  let solarE = f.solarKWh;
  let gridE = f.gridCapKWh;
  let dischargeRemaining = bat.maxDischargeKW * f.dt;
  let throughput = 0;

  // Hospital: solar, then grid, then battery (may dip into the reserve, not into the physical floor).
  let hospNeed = f.hospitalKWh;
  const hFromSolar = Math.min(hospNeed, solarE);
  solarE -= hFromSolar;
  hospNeed -= hFromSolar;
  const hFromGrid = Math.min(hospNeed, gridE);
  gridE -= hFromGrid;
  hospNeed -= hFromGrid;
  const hFromBattery = Math.min(hospNeed, Math.max(0, E - floor) * bat.dischargeEff, dischargeRemaining);
  const hWithdrawal = hFromBattery / bat.dischargeEff;
  E -= hWithdrawal;
  throughput += hWithdrawal;
  dischargeRemaining -= hFromBattery;
  hospNeed -= hFromBattery;

  // Unserved hospital energy is shed from tier 3 upward; tier 0 and tier 1 are the critical loss.
  let clinicalLoss = Math.max(0, hospNeed);
  const tier3 = Math.min(clinicalLoss, f.hospitalKWh * f.tier3Share);
  clinicalLoss -= tier3;
  const tier2 = Math.min(clinicalLoss, f.hospitalKWh * f.tier2Share);
  clinicalLoss -= tier2;
  const tier1 = Math.min(clinicalLoss, f.hospitalKWh * f.tier1Share);
  clinicalLoss -= tier1;
  const tier0 = Math.min(clinicalLoss, f.hospitalKWh * f.tier0Share);

  // Flexible load: solar, then grid, then battery down to the larger of floor and reserve.
  let ncNeed = f.flexibleKWh;
  const ncFromSolar = Math.min(ncNeed, solarE);
  solarE -= ncFromSolar;
  ncNeed -= ncFromSolar;
  const ncFromGrid = Math.min(ncNeed, gridE);
  ncNeed -= ncFromGrid;
  const flexibleFloor = Math.max(floor, bat.reserveKWh);
  const ncFromBattery = Math.min(ncNeed, Math.max(0, E - flexibleFloor) * bat.dischargeEff, dischargeRemaining);
  const ncWithdrawal = ncFromBattery / bat.dischargeEff;
  E -= ncWithdrawal;
  throughput += ncWithdrawal;
  ncNeed -= ncFromBattery;

  // Surplus solar charges the battery up to its power limit and its headroom; the rest is curtailed.
  let charged = 0;
  if (solarE > 0) {
    charged = Math.min(solarE, bat.maxChargeKW * f.dt, Math.max(0, Emax - E) / bat.chargeEff);
    const stored = charged * bat.chargeEff;
    E += stored;
    throughput += stored;
    solarE -= charged;
  }
  E = clamp(E, 0, Emax);

  const gridUsed = hFromGrid + ncFromGrid;
  const batteryDelivered = hFromBattery + ncFromBattery;
  const hospitalServed = f.hospitalKWh - Math.max(0, hospNeed);
  const flexibleServed = f.flexibleKWh - Math.max(0, ncNeed);
  const curtailed = Math.max(0, solarE);
  const balance = Math.abs(f.solarKWh + gridUsed + batteryDelivered - hospitalServed - flexibleServed - charged - curtailed);
  const criticalUnserved = tier0 + tier1;

  return {
    energyKWh: E,
    gridKWh: gridUsed,
    batteryDeliveredKWh: batteryDelivered,
    batteryChargedKWh: charged,
    curtailedKWh: curtailed,
    hospitalUnservedKWh: Math.max(0, hospNeed),
    flexibleUnservedKWh: Math.max(0, ncNeed),
    shedKWh: tier2 + tier3,
    criticalUnservedKWh: criticalUnserved,
    tiers: { tier0, tier1, tier2, tier3 },
    stepFailed: criticalUnserved > 1e-6,
    batteryThroughputKWh: throughput,
    energyBalanceErrorKWh: balance,
  };
}

export function bucketFor(failed: boolean, minSocPct: number): RiskBucket {
  return failed ? 'critical' : minSocPct <= 15 ? 'high' : minSocPct <= 40 ? 'moderate' : 'safe';
}

export interface DispatchStep {
  hour: number;
  temp: number;
  cloud: number;
  solarKW: number;
  gridOnline: boolean;
  resKW: number;
  evKW: number;
  hospKW: number;
  socPct: number;
  shedKW: number;
  criticalShedKW: number;
  gridUsedKW: number;
  batteryDischargeKW: number;
  batteryChargeKW: number;
  curtailedSolarKW: number;
  energyBalanceErrorKWh: number;
  failed: boolean;
}

export interface DispatchSummary {
  seed: number;
  failed: boolean;
  failStep: number;
  minSocPct: number;
  bucket: RiskBucket;
  shedEnergyKWh: number;
  criticalEnergyUnservedKWh: number;
  batteryThroughputKWh: number;
  gridEnergyKWh: number;
  solarEnergyKWh: number;
  solarCurtailedKWh: number;
  operationalCost: number;
  carbonKg: number;
  energyBalanceMaxErrorKWh: number;
  energyBalanceErrorPct: number;
  criticalLossDurationHours: number;
  maxCriticalLossStreakHours: number;
  lossOfLoadEvents: number;
  peakCriticalShortfallKW: number;
  tier0UnservedKWh: number;
  tier1UnservedKWh: number;
  tier2UnservedKWh: number;
  tier3UnservedKWh: number;
  outageStartHour: number | null;
  outageDurationHours: number;
  cloudEventStartHour: number | null;
  cloudEventDurationHours: number;
  hazardSeverity: number;
}

export interface DispatchRun {
  summary: DispatchSummary;
  steps: DispatchStep[];
}

// One simulated 72-hour future on the synthetic-profile path. The random draws happen in the same order as the source.
export function simulateDispatch(
  seed: number,
  location: LocationDef,
  presetId: PresetId,
  config: DispatchConfig,
  intervention: Intervention,
): DispatchRun {
  const P = PRESETS[presetId];
  const rng = mulberry32(seed);
  const Emax = config.batteryCapacityKWh;
  let E = Emax * (config.batteryStartPct / 100);
  const physicalFloor = Emax * (config.batteryMinSocPct / 100);
  const reserveEnergy = Emax * (intervention.reservePct / 100);
  const evCount = config.evCount + P.evAdd;
  const roundTrip = config.batteryRoundTripEfficiencyPct / 100;
  const chargeEff = Math.sqrt(roundTrip);
  const dischargeEff = Math.sqrt(roundTrip);

  // Draws 1-3: severity. Draws 4-7: cloud base, cloud event, event start and duration.
  const severity = (rng() + rng() + rng()) / 3;
  const cloudBase = clamp(location.cloudBase + (rng() - 0.5) * 0.1, 0, 0.9);
  const cloudEvent = rng() < P.cloudEventProb;
  const cloudEventStart = 8 + rng() * 48;
  const cloudEventDur = 5 + rng() * 16;

  // Draw 8: outage. Draw 9: outage start. Draw 10: restoration. (No measured reliability on this path.)
  const conditionalOutageMultiplier = 0.55 + severity * 0.7
    + (P.stormSolarFactor < 1 ? 0.24 : 0) + (P.tempAdd >= 5 ? 0.1 : 0);
  const conditionedOutageProbability = clamp(P.outageProbBase * conditionalOutageMultiplier, 0, 0.97);
  const outageOccurs = rng() < conditionedOutageProbability;
  const outageStart = P.stormSolarFactor < 1 && cloudEvent ? cloudEventStart + rng() * 3 : 10 + rng() * 48;
  const restorationU = rng();
  const baseRestorationHours = -Math.log(Math.max(1e-6, 1 - restorationU)) * config.gridRestorationMeanHours;
  const restorationStressMultiplier = (0.7 + severity * 1.4) * (P.stormSolarFactor < 1 ? 1.45 : 1);
  const outageDur = outageOccurs ? clamp(baseRestorationHours * restorationStressMultiplier, 0.5, 36) : 0;

  const tempBase = location.baseTemp + P.tempAdd;
  const evPeakHour = 18.5 + intervention.evDelayMin / 60;
  const tier0Share = config.clinicalTier0Pct / 100;
  const tier1Share = config.clinicalTier1Pct / 100;
  const tier2Share = config.clinicalTier2Pct / 100;
  const tier3Share = Math.max(0, 1 - tier0Share - tier1Share - tier2Share);

  let minSocPct = 100;
  let failed = false;
  let failStep = -1;
  let shedEnergy = 0;
  let criticalUnserved = 0;
  let batteryThroughput = 0;
  let gridEnergy = 0;
  let solarEnergy = 0;
  let solarCurtailed = 0;
  let maxBalanceError = 0;
  let totalDemand = 0;
  let criticalLossDuration = 0;
  let streak = 0;
  let maxStreak = 0;
  let lossEvents = 0;
  let peakShortfall = 0;
  let previousFailed = false;
  const tierTotals = { tier0: 0, tier1: 0, tier2: 0, tier3: 0 };
  const steps: DispatchStep[] = [];

  for (let t = 0; t < STEPS; t++) {
    const hour = t * DT;
    const dayHour = hour % 24;
    const dayIndex = Math.floor(hour / 24);
    const temp = tempBase - 4 + 9 * gaussian(dayHour, 15, 4.5) + severity * 2 + dayIndex * P.tempAdd * 0.04;

    // Draw 11 + 3t: cloud noise for this step.
    let cloud = cloudBase + (rng() - 0.5) * 0.04;
    if (cloudEvent) cloud += (0.92 - cloudBase) * gaussian(hour, cloudEventStart + cloudEventDur / 2, cloudEventDur / 3);
    cloud = clamp(cloud, 0, 0.97);

    const irr = dayHour < 5.5 || dayHour > 19.5 ? 0 : gaussian(dayHour, 12.5, 3.2) * location.irradianceScale;
    const estimatedCellTemp = temp + 20 * Math.min(1, irr);
    const tempEff = Math.max(0.65, 1 - Math.max(0, estimatedCellTemp - 25) * 0.0042) * P.panelDerate;
    const solarKW = config.solarCapacityKW * Math.max(0, irr * (1 - cloud)) * P.stormSolarFactor * tempEff;
    solarEnergy += solarKW * DT;

    const gridOnline = !(outageOccurs && hour >= outageStart && hour <= outageStart + outageDur);
    const gridCapE = (gridOnline ? config.gridMaxImportKW : 0) * DT;

    const resFactor = 0.55 + 0.25 * gaussian(dayHour, 8, 1.4) + 0.35 * gaussian(dayHour, 19.5, 2.0);
    const acFactor = (1 + Math.max(0, temp - 24) * 0.025) * P.acBoost;
    let resKW = config.homesCount * config.avgHomeKW * resFactor * acFactor;
    if (intervention.precoolHour != null) {
      if (dayHour >= intervention.precoolHour && dayHour < intervention.precoolHour + 1.5) resKW *= 1.18;
      if (dayHour >= 15 && dayHour <= 18.5) resKW *= 0.85;
    }
    // Draw 12 + 3t: residential noise. Draw 13 + 3t: hospital load (below).
    const residentialNoise = 0.95 + rng() * 0.1;
    resKW *= residentialNoise;
    resKW *= 1 - config.demandControlPct / 100;

    const evFactor = 0.05 + 0.55 * gaussian(dayHour, evPeakHour, 1.6);
    const evKW = evCount * config.evChargerKW * evFactor * (1 - config.demandControlPct / 200);
    const hospKW = config.hospitalKW * (0.97 + rng() * 0.06);

    const hospitalDemandE = hospKW * DT;
    const flexibleDemandE = (resKW + evKW) * DT;
    totalDemand += hospitalDemandE + flexibleDemandE;

    const out = dispatchStep(
      {
        energyKWh: E,
        capacityKWh: Emax,
        floorKWh: physicalFloor,
        reserveKWh: reserveEnergy,
        chargeEff,
        dischargeEff,
        maxChargeKW: config.batteryMaxChargeKW,
        maxDischargeKW: config.batteryMaxDischargeKW,
      },
      {
        solarKWh: solarKW * DT,
        hospitalKWh: hospitalDemandE,
        flexibleKWh: flexibleDemandE,
        gridCapKWh: gridCapE,
        dt: DT,
        tier0Share,
        tier1Share,
        tier2Share,
        tier3Share,
      },
    );
    E = out.energyKWh;
    gridEnergy += out.gridKWh;
    batteryThroughput += out.batteryThroughputKWh;
    shedEnergy += out.shedKWh + out.flexibleUnservedKWh;
    tierTotals.tier0 += out.tiers.tier0;
    tierTotals.tier1 += out.tiers.tier1;
    tierTotals.tier2 += out.tiers.tier2;
    tierTotals.tier3 += out.tiers.tier3;
    solarCurtailed += out.curtailedKWh;
    maxBalanceError = Math.max(maxBalanceError, out.energyBalanceErrorKWh);

    if (out.stepFailed) {
      criticalUnserved += out.criticalUnservedKWh;
      criticalLossDuration += DT;
      streak += DT;
      maxStreak = Math.max(maxStreak, streak);
      peakShortfall = Math.max(peakShortfall, out.criticalUnservedKWh / DT);
      if (!previousFailed) lossEvents++;
      if (!failed) {
        failed = true;
        failStep = t;
      }
    } else {
      streak = 0;
    }
    previousFailed = out.stepFailed;

    const socPct = Emax > 0 ? (E / Emax) * 100 : 0;
    if (socPct < minSocPct) minSocPct = socPct;

    steps.push({
      hour,
      temp,
      cloud,
      solarKW,
      gridOnline,
      resKW,
      evKW,
      hospKW,
      socPct,
      shedKW: out.flexibleUnservedKWh / DT,
      criticalShedKW: out.hospitalUnservedKWh / DT,
      gridUsedKW: out.gridKWh / DT,
      batteryDischargeKW: out.batteryDeliveredKWh / DT,
      batteryChargeKW: out.batteryChargedKWh / DT,
      curtailedSolarKW: out.curtailedKWh / DT,
      energyBalanceErrorKWh: out.energyBalanceErrorKWh,
      failed: out.stepFailed,
    });
  }

  const summary: DispatchSummary = {
    seed,
    failed,
    failStep,
    minSocPct,
    bucket: bucketFor(failed, minSocPct),
    shedEnergyKWh: shedEnergy,
    criticalEnergyUnservedKWh: criticalUnserved,
    batteryThroughputKWh: batteryThroughput,
    gridEnergyKWh: gridEnergy,
    solarEnergyKWh: solarEnergy,
    solarCurtailedKWh: solarCurtailed,
    operationalCost: gridEnergy * config.gridEnergyCostPerKWh + batteryThroughput * config.batteryDegradationCostPerKWh,
    carbonKg: gridEnergy * config.gridCarbonKgPerKWh,
    energyBalanceMaxErrorKWh: maxBalanceError,
    energyBalanceErrorPct: totalDemand > 0 ? (maxBalanceError / totalDemand) * 100 : 0,
    criticalLossDurationHours: criticalLossDuration,
    maxCriticalLossStreakHours: maxStreak,
    lossOfLoadEvents: lossEvents,
    peakCriticalShortfallKW: peakShortfall,
    tier0UnservedKWh: tierTotals.tier0,
    tier1UnservedKWh: tierTotals.tier1,
    tier2UnservedKWh: tierTotals.tier2,
    tier3UnservedKWh: tierTotals.tier3,
    outageStartHour: outageOccurs ? outageStart : null,
    outageDurationHours: outageDur,
    cloudEventStartHour: cloudEvent ? cloudEventStart : null,
    cloudEventDurationHours: cloudEvent ? cloudEventDur : 0,
    hazardSeverity: severity,
  };
  return { summary, steps };
}
