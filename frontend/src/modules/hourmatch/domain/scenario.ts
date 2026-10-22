// Port of projects/hourmatch-master/src/scenario.mjs: builds the demo week on the ledger.
// REAL: hourly solar, wind and hydro generation shapes come from Taiwan Power Company open data.
// FICTIONAL: every company, power plant and contract below is made up for the demo.
import { Ledger, LedgerError, certificateId, hourIndexOf } from './ledger';

export type Fuel = 'solar' | 'wind' | 'hydro';

export interface TaipowerHour {
  hour: string; // e.g. 2026-10-06T13:00+08:00
  mwh: Partial<Record<Fuel, number>>;
}

export interface TaipowerWeek {
  hours: TaipowerHour[];
}

export interface Consumer {
  id: string;
  name: string;
  profile: string;
}

export interface Plant {
  id: number;
  key: Fuel;
  name: string;
  owner: string;
  issuer: string;
  commissionYear: number;
  peakKw: number;
}

export interface Contract {
  generatorId: number;
  buyer: string;
  share: number;
}

export interface DoubleSaleLog {
  type: 'double-sale-accepted' | 'double-sale-rejected';
  hour: string;
  kwh: number;
  error?: string;
}

export const OPERATOR = 'operator';
export const ISSUERS = [
  { id: 'issuer-a', name: 'Issuer A (fictional certificate body)' },
  { id: 'issuer-b', name: 'Issuer B (fictional wheeling-contract registrar)' },
];

export const GENERATORS: Plant[] = [
  { id: 1, key: 'solar', name: 'Sunfield Solar (fictional)', owner: 'sunfield', issuer: 'issuer-a', commissionYear: 2021, peakKw: 30000 },
  { id: 2, key: 'wind', name: 'Strait Wind (fictional)', owner: 'straitwind', issuer: 'issuer-b', commissionYear: 2024, peakKw: 40000 },
  { id: 3, key: 'hydro', name: 'Old Creek Hydro (fictional)', owner: 'oldcreek', issuer: 'issuer-a', commissionYear: 1998, peakKw: 3000 },
];

export const CONSUMERS: Consumer[] = [
  { id: 'NORTHBAY-FAB', name: 'Northbay Fab (fictional)', profile: '24-hour chip plant, flat load' },
  { id: 'HARBOR-OFFICE', name: 'Harbor Office (fictional)', profile: 'office, weekdays 08:00-19:00' },
  { id: 'CLOUDLINE-DC', name: 'Cloudline Data Center (fictional)', profile: 'data center, flat load' },
];

// Certificate volume bought / metered use, chosen for the demo (see step 3 in buildScenario)
export const VOLUME_RATIO: Record<string, number> = { 'NORTHBAY-FAB': 1.03, 'HARBOR-OFFICE': 1.05, 'CLOUDLINE-DC': 1.04 };

// Who receives what share of each plant's certificates (bilateral contracts, fictional)
export const CONTRACTS: Contract[] = [
  { generatorId: 1, buyer: 'NORTHBAY-FAB', share: 0.85 },
  { generatorId: 1, buyer: 'HARBOR-OFFICE', share: 0.15 },
  { generatorId: 2, buyer: 'NORTHBAY-FAB', share: 0.5 },
  { generatorId: 2, buyer: 'CLOUDLINE-DC', share: 0.5 },
  { generatorId: 3, buyer: 'HARBOR-OFFICE', share: 1.0 },
];

export interface Scenario {
  ledger: Ledger;
  firstHour: bigint;
  n: number;
  hours: TaipowerHour[];
  generation: Record<number, number[]>; // plant id -> kWh per hour
  bought: Record<string, Record<number, number[]>>; // buyer -> plant id -> kWh per hour
  consumption: Record<string, number[]>; // consumer -> kWh per hour
  log: DoubleSaleLog[];
  totalBought: (buyer: string) => number;
  generators: Plant[];
  consumers: Consumer[];
}

function shape(hours: TaipowerHour[], key: Fuel): number[] {
  const vals = hours.map((h) => Math.max(0, h.mwh[key] ?? 0));
  const max = Math.max(...vals) || 1;
  return vals.map((v) => v / max);
}

// Taiwan time is UTC+8. The office profile uses weekday and hour in that zone.
function weekdayAndHour(hourIso: string): { dow: number; hour: number } {
  const d = new Date(hourIso);
  const local = new Date(d.getTime() + 8 * 3600 * 1000);
  return { dow: local.getUTCDay(), hour: local.getUTCHours() };
}

export function buildScenario(taipower: TaipowerWeek): Scenario {
  const hours = taipower.hours;
  const firstHour = hourIndexOf(hours[0].hour);
  const n = hours.length;
  const ledger = new Ledger(OPERATOR);
  const log: DoubleSaleLog[] = [];

  // 0) governance: two authorized issuers, each company bound to its own wallet
  for (const is of ISSUERS) ledger.addIssuer(OPERATOR, is.id);
  for (const c of CONSUMERS) ledger.registerConsumer(OPERATOR, c.id, c.id);

  // 1) plants and hourly certificates (one batch per plant per day).
  //    Each plant is registered and issued by its own issuer; all of them share one retirement state.
  const generation: Record<number, number[]> = {};
  for (const g of GENERATORS) {
    ledger.registerGenerator(g.issuer, g.id, g.name, g.owner, g.commissionYear);
    const s = shape(hours, g.key);
    generation[g.id] = s.map((x) => Math.round(x * g.peakKw));
    for (let d = 0; d < n; d += 24) {
      ledger.issueBatch(g.issuer, g.id, firstHour + BigInt(d), generation[g.id].slice(d, d + 24));
    }
  }

  // 2) contracts: transfer each buyer's share hour by hour
  const bought: Record<string, Record<number, number[]>> = {};
  for (const c of CONTRACTS) {
    const g = GENERATORS.find((x) => x.id === c.generatorId);
    if (!g) throw new Error(`unknown plant ${c.generatorId}`);
    const arr = generation[c.generatorId].map((v) => Math.floor(v * c.share));
    (bought[c.buyer] ??= {})[c.generatorId] = arr;
    arr.forEach((v, i) => {
      if (v <= 0) return;
      ledger.transfer(g.owner, certificateId(g.id, firstHour + BigInt(i)), c.buyer, v);
    });
  }

  // 3) metered consumption (fictional profiles). DESIGNED FOR THE DEMO: loads are sized so that each
  //    buyer's certificate VOLUME is a bit more than 100% of its use (VOLUME_RATIO), so a "100% renewable"
  //    claim holds on paper. The hour-by-hour share is whatever the real curves then produce; it is not tuned.
  const totalBought = (buyer: string) =>
    Object.values(bought[buyer] ?? {}).reduce((s, arr) => s + arr.reduce((a, b) => a + b, 0), 0);
  const fabFlat = Math.floor(totalBought('NORTHBAY-FAB') / n / VOLUME_RATIO['NORTHBAY-FAB']);
  const officeShape = hours.map((h) => {
    const { dow, hour } = weekdayAndHour(h.hour);
    const weekday = dow >= 1 && dow <= 5;
    return weekday && hour >= 8 && hour < 19 ? 1 : 0.2;
  });
  const officeUnit = totalBought('HARBOR-OFFICE') / VOLUME_RATIO['HARBOR-OFFICE'] / officeShape.reduce((a, b) => a + b, 0);
  const dcVar = hours.map((_, i) => 1 + (((i * 37) % 5) - 2) * 0.02);
  const dcUnit = totalBought('CLOUDLINE-DC') / VOLUME_RATIO['CLOUDLINE-DC'] / dcVar.reduce((a, b) => a + b, 0);
  const consumption: Record<string, number[]> = {
    'NORTHBAY-FAB': hours.map(() => fabFlat),
    'HARBOR-OFFICE': officeShape.map((x) => Math.round(x * officeUnit)),
    'CLOUDLINE-DC': dcVar.map((x) => Math.round(x * dcUnit)),
  };
  for (const c of CONSUMERS) {
    for (let d = 0; d < n; d += 24) {
      ledger.recordConsumption(OPERATOR, c.id, firstHour + BigInt(d), consumption[c.id].slice(d, d + 24));
    }
  }

  // 4) a double sale: Strait Wind tries to sell day-3 midday certificates, already sold to Northbay
  //    and Cloudline, to Harbor Office as well. The ledger must refuse.
  const day3 = 2 * 24;
  for (let hh = 11; hh < 15; hh++) {
    const i = day3 + hh;
    const id = certificateId(2, firstHour + BigInt(i));
    const want = Math.max(1, Math.floor(generation[2][i] * 0.5));
    try {
      ledger.transfer('straitwind', id, 'HARBOR-OFFICE', want);
      log.push({ type: 'double-sale-accepted', hour: hours[i].hour, kwh: want });
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e;
      log.push({ type: 'double-sale-rejected', hour: hours[i].hour, kwh: want, error: e.code });
    }
  }

  // 5) each buyer retires same-hour certificates against that hour's use (greedy, plant id order)
  for (const c of CONSUMERS) {
    for (let i = 0; i < n; i++) {
      let need = consumption[c.id][i];
      for (const g of GENERATORS) {
        if (need <= 0) break;
        const id = certificateId(g.id, firstHour + BigInt(i));
        const have = Number(ledger.balanceOf(id, c.id));
        const use = Math.min(have, need);
        if (use > 0) {
          ledger.retire(c.id, id, use, c.id, firstHour + BigInt(i));
          need -= use;
        }
      }
    }
  }

  return { ledger, firstHour, n, hours, generation, bought, consumption, log, totalBought, generators: GENERATORS, consumers: CONSUMERS };
}
