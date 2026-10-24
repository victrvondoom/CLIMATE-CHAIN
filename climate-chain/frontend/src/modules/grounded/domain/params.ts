// Parameters copied from packages/sim/src/index.ts (PRESETS, LOCATIONS, DEFAULT_CONFIG, DEFAULT_INTERVENTION).
// Only the fields the synthetic-profile dispatch uses are here. Generator, fuel and site-data fields are not ported.

export const DT = 0.25; // hours per simulated step (15 minutes)
export const STEPS = 288; // 72 hours

export type PresetId = 'normal' | 'heatwave' | 'storm' | 'evsurge' | 'extreme';
export const PRESET_ORDER: PresetId[] = ['normal', 'heatwave', 'storm', 'evsurge', 'extreme'];

export interface PresetDef {
  id: PresetId;
  label: string;
  tempAdd: number;
  acBoost: number;
  panelDerate: number;
  stormSolarFactor: number;
  outageProbBase: number;
  evAdd: number;
  cloudEventProb: number;
  blurb: string;
}

export const PRESETS: Record<PresetId, PresetDef> = {
  normal: {
    id: 'normal', label: 'Normal Conditions', tempAdd: 0, acBoost: 1, panelDerate: 1,
    stormSolarFactor: 1, outageProbBase: 0.03, evAdd: 0, cloudEventProb: 0.18,
    blurb: 'Typical daily weather. Baseline resilience check.',
  },
  heatwave: {
    id: 'heatwave', label: 'Extreme Heatwave', tempAdd: 8, acBoost: 1.2, panelDerate: 0.98,
    stormSolarFactor: 1, outageProbBase: 0.1, evAdd: 0, cloudEventProb: 0.35,
    blurb: '+8°C · sustained AC demand · PV temperature loss',
  },
  storm: {
    id: 'storm', label: 'Severe Storm', tempAdd: 0, acBoost: 1, panelDerate: 1,
    stormSolarFactor: 0.25, outageProbBase: 0.4, evAdd: 0, cloudEventProb: 0.88,
    blurb: '-75% solar generation · high outage probability',
  },
  evsurge: {
    id: 'evsurge', label: 'EV Surge', tempAdd: 0, acBoost: 1, panelDerate: 1,
    stormSolarFactor: 1, outageProbBase: 0.05, evAdd: 80, cloudEventProb: 0.18,
    blurb: '+80 EVs · sharp 18:00 charging peak',
  },
  extreme: {
    id: 'extreme', label: 'Extreme Combined Event', tempAdd: 8, acBoost: 1.25, panelDerate: 0.96,
    stormSolarFactor: 0.4, outageProbBase: 0.5, evAdd: 60, cloudEventProb: 0.82,
    blurb: 'Heatwave + low generation + outage, at once',
  },
};

export type LocationId = 'jaipur' | 'phoenix' | 'miami' | 'seattle';

export interface LocationDef {
  id: LocationId;
  label: string;
  baseTemp: number;
  cloudBase: number;
  irradianceScale: number;
}

export const LOCATIONS: Record<LocationId, LocationDef> = {
  jaipur: { id: 'jaipur', label: 'Jaipur, IN', baseTemp: 34, cloudBase: 0.1, irradianceScale: 1.08 },
  phoenix: { id: 'phoenix', label: 'Phoenix, US', baseTemp: 37, cloudBase: 0.07, irradianceScale: 1.12 },
  miami: { id: 'miami', label: 'Miami, US', baseTemp: 30, cloudBase: 0.34, irradianceScale: 0.88 },
  seattle: { id: 'seattle', label: 'Seattle, US', baseTemp: 20, cloudBase: 0.52, irradianceScale: 0.64 },
};

export interface DispatchConfig {
  solarCapacityKW: number;
  batteryCapacityKWh: number;
  batteryStartPct: number;
  hospitalKW: number;
  homesCount: number;
  avgHomeKW: number;
  evCount: number;
  evChargerKW: number;
  gridMaxImportKW: number;
  batteryMaxChargeKW: number;
  batteryMaxDischargeKW: number;
  batteryRoundTripEfficiencyPct: number;
  batteryMinSocPct: number;
  batteryDegradationCostPerKWh: number;
  gridRestorationMeanHours: number;
  gridEnergyCostPerKWh: number;
  gridCarbonKgPerKWh: number;
  clinicalTier0Pct: number;
  clinicalTier1Pct: number;
  clinicalTier2Pct: number;
  demandControlPct: number;
}

export const DEFAULT_CONFIG: DispatchConfig = {
  solarCapacityKW: 1800,
  batteryCapacityKWh: 12000,
  batteryStartPct: 90,
  hospitalKW: 180,
  homesCount: 420,
  avgHomeKW: 1.4,
  evCount: 60,
  evChargerKW: 7,
  gridMaxImportKW: 1100,
  batteryMaxChargeKW: 1200,
  batteryMaxDischargeKW: 1200,
  batteryRoundTripEfficiencyPct: 90,
  batteryMinSocPct: 5,
  batteryDegradationCostPerKWh: 0.035,
  gridRestorationMeanHours: 4,
  gridEnergyCostPerKWh: 0.11,
  gridCarbonKgPerKWh: 0.71,
  clinicalTier0Pct: 30,
  clinicalTier1Pct: 40,
  clinicalTier2Pct: 20,
  demandControlPct: 0,
};

export interface Intervention {
  reservePct: number;
  evDelayMin: number;
  precoolHour: number | null;
}

export const DEFAULT_INTERVENTION: Intervention = { reservePct: 0, evDelayMin: 0, precoolHour: null };
