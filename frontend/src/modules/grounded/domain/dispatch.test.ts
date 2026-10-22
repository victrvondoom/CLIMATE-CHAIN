import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_INTERVENTION, LOCATIONS, STEPS, DT } from './params';
import { bucketFor, dispatchStep, simulateDispatch, type Battery } from './dispatch';
import { mulberry32, seedFor } from './random';

// Golden values come from the source: packages/sim/src/index.ts simulateScenario, run unchanged under Node 24.
// The runs use the synthetic-profile path (no measured site data, no generator), which is what this port models.

const near = (actual: number, expected: number, rel = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(expected)));

const ONE_STEP = DT; // hours per step

function battery(over: Partial<Battery> = {}): Battery {
  return {
    energyKWh: 50,
    capacityKWh: 100,
    floorKWh: 5,
    reserveKWh: 0,
    chargeEff: 1,
    dischargeEff: 1,
    maxChargeKW: 1000,
    maxDischargeKW: 1000,
    ...over,
  };
}

const flows = (over: Partial<Parameters<typeof dispatchStep>[1]> = {}) => ({
  solarKWh: 0,
  hospitalKWh: 0,
  flexibleKWh: 0,
  gridCapKWh: 0,
  dt: ONE_STEP,
  tier0Share: 0.3,
  tier1Share: 0.4,
  tier2Share: 0.2,
  tier3Share: 0.1,
  ...over,
});

describe('dispatchStep: battery state, grid import and curtailment', () => {
  it('stores surplus solar up to capacity and curtails only what does not fit', () => {
    const a = dispatchStep(battery({ energyKWh: 50 }), flows({ solarKWh: 40 }));
    near(a.energyKWh, 90);
    near(a.curtailedKWh, 0);
    near(a.batteryChargedKWh, 40);

    const b = dispatchStep(battery({ energyKWh: 50 }), flows({ solarKWh: 80 }));
    near(b.energyKWh, 100);
    near(b.batteryChargedKWh, 50); // limited by the 50 kWh of headroom
    near(b.curtailedKWh, 30);
  });

  it('limits charging to the charge power for one step', () => {
    const r = dispatchStep(battery({ energyKWh: 0, maxChargeKW: 100 }), flows({ solarKWh: 80 }));
    near(r.batteryChargedKWh, 100 * ONE_STEP); // 25 kWh per 15-minute step
    near(r.curtailedKWh, 55);
  });

  it('serves the hospital first from solar, then grid, then battery', () => {
    const r = dispatchStep(battery({ energyKWh: 50 }), flows({ solarKWh: 10, hospitalKWh: 60, flexibleKWh: 0, gridCapKWh: 100 }));
    near(r.gridKWh, 50); // 60 kWh hospital minus 10 kWh solar
    near(r.batteryDeliveredKWh, 0);
    near(r.hospitalUnservedKWh, 0);
    near(r.energyKWh, 50);
  });

  it('draws grid import up to the cap and then on the battery for flexible load', () => {
    const r = dispatchStep(battery({ energyKWh: 50 }), flows({ hospitalKWh: 60, flexibleKWh: 60, gridCapKWh: 100 }));
    near(r.gridKWh, 100); // all import used by the hospital and part of the flexible load
    near(r.batteryDeliveredKWh, 20);
    near(r.flexibleUnservedKWh, 0);
    near(r.energyKWh, 30);
  });

  it('keeps grid import at zero when the grid is out (cap of 0)', () => {
    const r = dispatchStep(battery({ energyKWh: 20 }), flows({ hospitalKWh: 10, gridCapKWh: 0 }));
    near(r.gridKWh, 0);
    near(r.batteryDeliveredKWh, 10);
  });

  it('keeps the reserve for flexible load, but lets the hospital draw into it', () => {
    const flex = dispatchStep(battery({ energyKWh: 30, reserveKWh: 20 }), flows({ flexibleKWh: 40 }));
    near(flex.batteryDeliveredKWh, 10); // only 30 - 20 kWh above the reserve floor
    near(flex.flexibleUnservedKWh, 30);
    near(flex.energyKWh, 20);

    const hosp = dispatchStep(battery({ energyKWh: 30, reserveKWh: 20 }), flows({ hospitalKWh: 20 }));
    near(hosp.batteryDeliveredKWh, 20);
    near(hosp.energyKWh, 10);
  });

  it('caps discharge power, so a hospital load can go unserved even with energy stored', () => {
    const r = dispatchStep(battery({ energyKWh: 100, maxDischargeKW: 100 }), flows({ hospitalKWh: 60 }));
    near(r.batteryDeliveredKWh, 25); // 100 kW for one 15-minute step
    near(r.hospitalUnservedKWh, 35);
  });

  it('applies round-trip efficiency on both charge and discharge', () => {
    const eff = Math.sqrt(0.9);
    const charged = dispatchStep(battery({ energyKWh: 0, chargeEff: eff, dischargeEff: eff }), flows({ solarKWh: 10 }));
    near(charged.energyKWh, 10 * eff);

    // Delivering 10 kWh to the load takes 10 / eff kWh out of the store.
    const drained = dispatchStep(battery({ energyKWh: 20, floorKWh: 0, dischargeEff: eff }), flows({ hospitalKWh: 10 }));
    near(drained.batteryDeliveredKWh, 10);
    near(drained.energyKWh, 20 - 10 / eff);
  });

  it('sheds tiers 3 and 2 before tier 1 and 0, so critical loss is only tier 0 and 1', () => {
    // Battery empty, no grid, 10 kWh hospital demand: 10% tier 3, 20% tier 2, 40% tier 1, 30% tier 0.
    const r = dispatchStep(battery({ energyKWh: 5, floorKWh: 5 }), flows({ hospitalKWh: 10 }));
    near(r.hospitalUnservedKWh, 10);
    near(r.shedKWh, 3); // tier 3 (1) + tier 2 (2)
    near(r.criticalUnservedKWh, 7); // tier 1 (4) + tier 0 (3)
  });

  it('balances energy in every case', () => {
    const rnd = mulberry32(42);
    for (let i = 0; i < 500; i++) {
      const r = dispatchStep(
        battery({ energyKWh: rnd() * 100, reserveKWh: rnd() * 20, chargeEff: 0.95, dischargeEff: 0.95 }),
        flows({ solarKWh: rnd() * 40, hospitalKWh: rnd() * 30, flexibleKWh: rnd() * 60, gridCapKWh: rnd() * 40 }),
      );
      expect(r.energyBalanceErrorKWh).toBeLessThan(1e-9);
      expect(r.energyKWh).toBeGreaterThanOrEqual(0);
      expect(r.energyKWh).toBeLessThanOrEqual(100 + 1e-9);
    }
  });
});

describe('simulateDispatch: the 72-hour run, checked against the source', () => {
  it('runs 288 fifteen-minute steps over 72 hours', () => {
    const run = simulateDispatch(seedFor(7), LOCATIONS.jaipur, 'normal', DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    expect(run.steps).toHaveLength(STEPS);
    expect(run.steps.at(-1)!.hour).toBe(71.75);
  });

  it('matches the source for normal conditions with the default plant', () => {
    const s = simulateDispatch(seedFor(0), LOCATIONS.jaipur, 'normal', DEFAULT_CONFIG, DEFAULT_INTERVENTION).summary;
    expect(s.failed).toBe(false);
    expect(s.failStep).toBe(-1);
    near(s.minSocPct, 90);
    expect(s.bucket).toBe('safe');
    near(s.gridEnergyKWh, 29058.138766166154, 1e-9);
    near(s.solarCurtailedKWh, 11131.218174421081, 1e-9);
    near(s.solarEnergyKWh, 36138.16330320433, 1e-9);
    near(s.batteryThroughputKWh, 1200.0000000000025, 1e-9);
    near(s.operationalCost, 3238.395264278277, 1e-9);
    near(s.carbonKg, 20631.27852397797, 1e-9);
    expect(s.energyBalanceMaxErrorKWh).toBeLessThan(1e-8);
  });

  it('matches the source for an oversized plant: no failure, no curtailment for a small battery', () => {
    const generous = { ...DEFAULT_CONFIG, solarCapacityKW: 5000, batteryCapacityKWh: 100000, gridMaxImportKW: 5000, batteryStartPct: 100, batteryMaxChargeKW: 5000, batteryMaxDischargeKW: 5000, batteryMinSocPct: 0 };
    const s = simulateDispatch(seedFor(5), LOCATIONS.jaipur, 'normal', generous, DEFAULT_INTERVENTION).summary;
    expect(s.failed).toBe(false);
    near(s.minSocPct, 100);
    near(s.gridEnergyKWh, 22070.02396094004, 1e-9);
    near(s.solarCurtailedKWh, 73965.47672234627, 1e-9);
    near(s.solarEnergyKWh, 104743.45216755476, 1e-9);
    expect(s.bucket).toBe('safe');
  });

  it('matches the source for an underpowered plant that fails in the extreme event', () => {
    const under = { ...DEFAULT_CONFIG, solarCapacityKW: 300, batteryCapacityKWh: 3000, batteryStartPct: 60 };
    const s = simulateDispatch(seedFor(1), LOCATIONS.jaipur, 'extreme', under, DEFAULT_INTERVENTION).summary;
    expect(s.failed).toBe(true);
    expect(s.failStep).toBe(106);
    near(s.minSocPct, 5);
    expect(s.bucket).toBe('critical');
    near(s.criticalEnergyUnservedKWh, 526.6337841351742, 1e-9);
    near(s.shedEnergyKWh, 6831.076521600798, 1e-9);
    near(s.tier0UnservedKWh, 224.31906273182867, 1e-9);
    near(s.tier3UnservedKWh, 75.5786803508363, 1e-9);
    near(s.criticalLossDurationHours, 4.25, 1e-9);
    expect(s.lossOfLoadEvents).toBe(1);
    near(s.peakCriticalShortfallKW, 128.09811351109295, 1e-9);
    near(s.outageStartHour as number, 26.304092194885015, 1e-9);
    near(s.outageDurationHours, 4.375067590172534, 1e-9);
  });

  it('matches the source at individual steps (SOC, grid import, curtailment, critical shed)', () => {
    const under = { ...DEFAULT_CONFIG, solarCapacityKW: 300, batteryCapacityKWh: 3000, batteryStartPct: 60 };
    const { steps } = simulateDispatch(seedFor(1), LOCATIONS.jaipur, 'extreme', under, DEFAULT_INTERVENTION);
    const at = (i: number) => steps[i];
    near(at(0).socPct, 60);
    near(at(0).gridUsedKW, 785.1063761585617);
    near(at(52).gridUsedKW, 761.7588310982613);
    near(at(106).socPct, 5);
    near(at(106).criticalShedKW, 176.5642806326039);
    expect(at(106).failed).toBe(true);
    near(at(107).criticalShedKW, 174.7371261421591);
    near(at(200).gridUsedKW, 793.2383540059311);
    near(at(287).gridUsedKW, 855.2877391604438);

    const normal = simulateDispatch(seedFor(0), LOCATIONS.jaipur, 'normal', DEFAULT_CONFIG, DEFAULT_INTERVENTION).steps;
    near(normal[0].gridUsedKW, 580.5190780415294);
    near(normal[50].curtailedSolarKW, 870.868114149416);
    expect(normal[50].gridUsedKW).toBe(0);
    near(normal[287].gridUsedKW, 624.6823378866793);
  });

  it('keeps SOC inside 0-100 and never below the physical floor, and respects the power caps', () => {
    const under = { ...DEFAULT_CONFIG, solarCapacityKW: 300, batteryCapacityKWh: 3000, batteryStartPct: 60 };
    const { steps } = simulateDispatch(seedFor(1), LOCATIONS.jaipur, 'extreme', under, DEFAULT_INTERVENTION);
    for (const st of steps) {
      expect(st.socPct).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(st.socPct).toBeLessThanOrEqual(100);
      expect(st.gridUsedKW).toBeLessThanOrEqual(DEFAULT_CONFIG.gridMaxImportKW + 1e-9);
      expect(st.batteryDischargeKW).toBeLessThanOrEqual(under.batteryMaxDischargeKW + 1e-9);
      expect(st.batteryChargeKW).toBeLessThanOrEqual(under.batteryMaxChargeKW + 1e-9);
      expect(st.energyBalanceErrorKWh).toBeLessThan(1e-8);
    }
  });

  it('is deterministic for a seed and different for another seed', () => {
    const a = simulateDispatch(seedFor(4), LOCATIONS.phoenix, 'heatwave', DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    const b = simulateDispatch(seedFor(4), LOCATIONS.phoenix, 'heatwave', DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    const c = simulateDispatch(seedFor(5), LOCATIONS.phoenix, 'heatwave', DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    expect(a.steps).toEqual(b.steps);
    expect(a.steps.map((s) => s.solarKW)).not.toEqual(c.steps.map((s) => s.solarKW));
  });

  it('labels the risk bucket the same way as the source', () => {
    expect(bucketFor(true, 80)).toBe('critical');
    expect(bucketFor(false, 15)).toBe('high');
    expect(bucketFor(false, 40)).toBe('moderate');
    expect(bucketFor(false, 41)).toBe('safe');
  });
});
