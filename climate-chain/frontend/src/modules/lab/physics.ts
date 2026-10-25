// First-order climate physics for the Causal Lab. Every formula is a published
// textbook/IPCC relation; outputs are SIMULATED scenario estimates, never
// observations, and the Trust Firewall must keep treating them that way.

export const AU_KM = 149_597_870.7;
export const SOLAR_CONSTANT_1AU = 1361; // W/m^2 at 1 AU (TSI, Kopp & Lean 2011)
const ECCENTRICITY = 0.0167086;
const SEMI_MAJOR_AU = 1.00000261;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

const distanceAu = (date: Date) => {
  const days = (date.getTime() - J2000_MS) / 86_400_000;
  const m = ((357.5291092 + 0.98560028 * days) % 360 + 360) % 360 * Math.PI / 180;
  let e = m;
  for (let i = 0; i < 12; i++) e -= (e - ECCENTRICITY * Math.sin(e) - m) / (1 - ECCENTRICITY * Math.cos(e));
  return { au: SEMI_MAJOR_AU * (1 - ECCENTRICITY * Math.cos(e)), ecc: e };
};

/** Earth-Sun distance from Keplerian elements (mean anomaly at J2000 = 357.5291 deg). */
export function earthSun(date: Date) {
  const { au, ecc } = distanceAu(date);
  const trueAnomaly = 2 * Math.atan2(Math.sqrt(1 + ECCENTRICITY) * Math.sin(ecc / 2), Math.sqrt(1 - ECCENTRICITY) * Math.cos(ecc / 2));
  const dailyDeltaKm = (distanceAu(new Date(date.getTime() + 43_200_000)).au - distanceAu(new Date(date.getTime() - 43_200_000)).au) * AU_KM;
  return { au, km: au * AU_KM, irradiance: SOLAR_CONSTANT_1AU / (au * au), lightMinutes: au * 8.3167, trueAnomaly, dailyDeltaKm };
}

/** Seasonal orbit swing vs. the human forcing it is routinely confused with. */
export function orbitContext(forcingWm2: number) {
  const perihelion = SOLAR_CONSTANT_1AU / (0.98329 ** 2);
  const aphelion = SOLAR_CONSTANT_1AU / (1.01671 ** 2);
  return { orbitSwingWm2: (perihelion - aphelion) / 4 * 0.7, humanForcingWm2: forcingWm2, note: 'Orbital distance swings insolation by about +/-3.4% through the year, but that averages out annually; it does not explain multi-decade warming.' };
}

export type GasId = 'co2' | 'ch4' | 'n2o';
export const PREINDUSTRIAL = { co2: 278, ch4: 722, n2o: 270 } as const; // ppm, ppb, ppb (IPCC AR6 WG1 Ch.2)
export const PRESENT = { co2: 425, ch4: 1930, n2o: 337 } as const; // approx. NOAA GML global means, 2024-25

/** Radiative forcing in W/m^2 (Myhre et al. 1998 simplified expressions; CH4/N2O band-overlap term omitted). */
export function forcing(g: Record<GasId, number>) {
  const co2 = 5.35 * Math.log(g.co2 / PREINDUSTRIAL.co2);
  const ch4 = 0.036 * (Math.sqrt(g.ch4) - Math.sqrt(PREINDUSTRIAL.ch4));
  const n2o = 0.12 * (Math.sqrt(g.n2o) - Math.sqrt(PREINDUSTRIAL.n2o));
  return { co2, ch4, n2o, total: co2 + ch4 + n2o };
}

export const FORCING_PER_DOUBLING = 5.35 * Math.LN2;
/** Equilibrium warming for a forcing, given climate sensitivity in K per CO2 doubling (AR6 likely 2.5-4.0, best 3.0). */
export const equilibriumWarming = (wm2: number, sensitivity: number) => sensitivity * wm2 / FORCING_PER_DOUBLING;
/** One-box realised fraction of equilibrium after t years (tau ~ 35 y approximates the fast ocean response). */
export const realisedFraction = (years: number, tau = 35) => 1 - Math.exp(-Math.max(0, years) / tau);

export const EMISSIONS_TODAY = { fossilCo2GtPerYear: 37.4, methaneTotalTgPerYear: 580, methaneAnthropogenicTgPerYear: 360 }; // GCP 2024, Global Methane Budget 2020
const GT_CO2_PER_PPM = 7.81;
const AIRBORNE_FRACTION = 0.45;
const METHANE_LIFETIME_YEARS = 11.8;

export interface ScenarioInput {
  fossilCo2ChangePct: number; // -100..+60, vs today's annual fossil CO2
  methaneChangePct: number; // -100..+60, vs today's anthropogenic methane
  horizonYears: number; // 5..80
  sensitivity: number; // K per doubling, 2..5
  elNinoOni: number; // optional ENSO overlay, ONI units (-2.5..3)
}

export const NEUTRAL_SCENARIO: ScenarioInput = { fossilCo2ChangePct: 0, methaneChangePct: 0, horizonYears: 30, sensitivity: 3, elNinoOni: 0 };

export function concentrationsAt(input: ScenarioInput): Record<GasId, number> {
  const t = input.horizonYears;
  const co2 = PRESENT.co2 + AIRBORNE_FRACTION * EMISSIONS_TODAY.fossilCo2GtPerYear * (1 + input.fossilCo2ChangePct / 100) * t / GT_CO2_PER_PPM;
  const e = EMISSIONS_TODAY.methaneTotalTgPerYear + EMISSIONS_TODAY.methaneAnthropogenicTgPerYear * input.methaneChangePct / 100;
  const ch4Eq = PRESENT.ch4 * e / EMISSIONS_TODAY.methaneTotalTgPerYear;
  const ch4 = ch4Eq + (PRESENT.ch4 - ch4Eq) * Math.exp(-t / METHANE_LIFETIME_YEARS);
  return { co2: Math.max(PREINDUSTRIAL.co2, co2), ch4: Math.max(PREINDUSTRIAL.ch4 * 0.5, ch4), n2o: PRESENT.n2o };
}

export const CROP_LOSS_PER_C = { wheat: 6.0, rice: 3.2, maize: 7.4, soybean: 3.1 } as const; // % global yield per +1 C (Zhao et al. 2017, PNAS)
export const EL_NINO_GLOBAL_TEMP_PER_ONI = 0.08; // C per ONI unit, ~3-month lag (approximate empirical regression)

export function runScenario(input: ScenarioInput) {
  const gas = concentrationsAt(input);
  const bau = concentrationsAt({ ...input, fossilCo2ChangePct: 0, methaneChangePct: 0 });
  const now = forcing({ ...PRESENT });
  const f = forcing(gas);
  const fBau = forcing(bau);
  const real = realisedFraction(input.horizonYears);
  const dVsToday = equilibriumWarming(f.total - now.total, input.sensitivity) * real;
  const dVsBau = equilibriumWarming(f.total - fBau.total, input.sensitivity) * real;
  const enso = input.elNinoOni * EL_NINO_GLOBAL_TEMP_PER_ONI;
  const warmingToday = dVsToday + enso;
  const shares = (['co2', 'ch4', 'n2o'] as const).map((id) => ({ id, wm2: f[id], share: f.total > 0 ? f[id] / f.total : 0 }));
  return {
    gas, forcing: f, shares, realisedFraction: real,
    warmingVsTodayC: warmingToday, warmingVsBauC: dVsBau, ensoContributionC: enso,
    cropYieldChangePct: Object.fromEntries(Object.entries(CROP_LOSS_PER_C).map(([k, v]) => [k, -v * Math.max(0, warmingToday)])) as Record<keyof typeof CROP_LOSS_PER_C, number>,
    extremeRainIntensityPct: 7 * warmingToday, // Clausius-Clapeyron, ~7% more water vapour per C
    label: 'SIMULATED' as const,
  };
}

export interface Molecule { id: string; name: string; formula: string; atoms: { el: 'C' | 'O' | 'H' | 'N'; pos: [number, number, number] }[]; bonds: [number, number][]; gwp100: string; lifetime: string; role: string }
const T = 1.09 / Math.sqrt(3);
export const MOLECULES: Molecule[] = [
  { id: 'co2', name: 'Carbon dioxide', formula: 'CO2', atoms: [{ el: 'C', pos: [0, 0, 0] }, { el: 'O', pos: [-1.16, 0, 0] }, { el: 'O', pos: [1.16, 0, 0] }], bonds: [[0, 1], [0, 2]], gwp100: '1 (reference)', lifetime: 'Centuries to millennia (multi-pool decay)', role: 'Largest long-lived driver; produced by burning fossil carbon (C + O2).' },
  { id: 'ch4', name: 'Methane', formula: 'CH4', atoms: [{ el: 'C', pos: [0, 0, 0] }, { el: 'H', pos: [T, T, T] }, { el: 'H', pos: [T, -T, -T] }, { el: 'H', pos: [-T, T, -T] }, { el: 'H', pos: [-T, -T, T] }], bonds: [[0, 1], [0, 2], [0, 3], [0, 4]], gwp100: '27.0 non-fossil / 29.8 fossil (IPCC AR6)', lifetime: '~11.8 years', role: 'Leaks from gas, landfills, livestock and rice; strong but short-lived.' },
  { id: 'n2o', name: 'Nitrous oxide', formula: 'N2O', atoms: [{ el: 'N', pos: [-1.126, 0, 0] }, { el: 'N', pos: [0, 0, 0] }, { el: 'O', pos: [1.185, 0, 0] }], bonds: [[0, 1], [1, 2]], gwp100: '273 (IPCC AR6)', lifetime: '~109 years', role: 'Released by fertiliser use and combustion; also depletes ozone.' },
  { id: 'h2o', name: 'Water vapour', formula: 'H2O', atoms: [{ el: 'O', pos: [0, 0, 0] }, { el: 'H', pos: [-0.757, 0.586, 0] }, { el: 'H', pos: [0.757, 0.586, 0] }], bonds: [[0, 1], [0, 2]], gwp100: 'Not assigned - it is a feedback, not a forcing', lifetime: '~9 days', role: 'Amplifies warming: warmer air holds ~7% more vapour per C.' },
];
const ATOMIC_MASS = { C: 12.011, H: 1.008, N: 14.007, O: 15.999 } as const;
export function massFractions(m: Molecule) {
  const total = m.atoms.reduce((s, a) => s + ATOMIC_MASS[a.el], 0);
  const fractions: Record<string, number> = {};
  for (const a of m.atoms) fractions[a.el] = (fractions[a.el] ?? 0) + ATOMIC_MASS[a.el] / total;
  return { total, fractions };
}

export type CausalDirection = 'human-to-climate' | 'climate-to-human';
export interface CausalLink { id: string; direction: CausalDirection; from: string; to: string; mechanism: string; evidence: string }
export const CAUSAL_LINKS: CausalLink[] = [
  { id: 'fossil-co2', direction: 'human-to-climate', from: 'Burning coal, oil and gas', to: 'CO2 up, forcing up', mechanism: 'Fossil carbon + O2 -> CO2; about 45% stays airborne, the rest enters ocean and land sinks.', evidence: 'Global Carbon Project; IPCC AR6 WG1 Ch.5' },
  { id: 'ag-methane', direction: 'human-to-climate', from: 'Livestock, rice, landfill, gas leaks', to: 'CH4 up', mechanism: 'Anaerobic decay and leakage; methane lasts ~12 years so cuts pay back fast.', evidence: 'Global Methane Budget 2020' },
  { id: 'fertiliser', direction: 'human-to-climate', from: 'Nitrogen fertiliser', to: 'N2O up', mechanism: 'Soil microbes convert surplus nitrogen to N2O (GWP 273).', evidence: 'Global Nitrous Oxide Budget 2020' },
  { id: 'land-use', direction: 'human-to-climate', from: 'Deforestation and stubble burning', to: 'CO2 and black carbon up, sink down', mechanism: 'Burning releases stored carbon and removes the sink that would have absorbed it.', evidence: 'IPCC AR6 WG3 Ch.7' },
  { id: 'heat-crops', direction: 'climate-to-human', from: 'Warming', to: 'Wheat, rice, maize, soy yields down', mechanism: 'Heat shortens grain-fill and raises crop water demand; ~3-7% global yield loss per C.', evidence: 'Zhao et al. 2017, PNAS' },
  { id: 'rain', direction: 'climate-to-human', from: 'Warming', to: 'Heavier downpours and floods', mechanism: 'Clausius-Clapeyron: ~7% more water vapour per C intensifies extreme rain.', evidence: 'IPCC AR6 WG1 Ch.11' },
  { id: 'enso-monsoon', direction: 'climate-to-human', from: 'El Nino', to: 'Weaker Indian monsoon tendency, global heat spike', mechanism: 'A warm eastern Pacific shifts the Walker circulation; India rainfall deficits become more likely (a tendency, not a certainty) and global mean temperature rises ~0.1 C.', evidence: 'NOAA CPC; Kumar et al. 1999' },
  { id: 'heat-power', direction: 'climate-to-human', from: 'Heatwaves', to: 'Cooling demand and grid stress up', mechanism: 'Air-conditioning load peaks with temperature; on a fossil-heavy grid this raises emissions, closing the loop.', evidence: 'IEA, The Future of Cooling' },
  { id: 'feedback-loop', direction: 'human-to-climate', from: 'Climate-driven drought and fire', to: 'More carbon released', mechanism: 'Stressed forests and peat burn or decay faster, adding CO2 beyond what humans directly emit.', evidence: 'IPCC AR6 WG1 Ch.5 (carbon-cycle feedbacks)' },
];
