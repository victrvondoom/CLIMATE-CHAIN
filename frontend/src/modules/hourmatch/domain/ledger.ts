// In-memory port of projects/hourmatch-master/src/ledger.mjs (a mirror of its Solidity registry).
// Same rules and the same integer arithmetic. Senders are plain names here ("operator",
// "issuer-a", "NORTHBAY-FAB"); on chain they are wallets. Nothing is written anywhere.

export const HOUR = 3600;

// Taiwan-time hour index (hours since the Unix epoch). Accepts an ISO string or epoch milliseconds.
export function hourIndexOf(isoOrMs: string | number): bigint {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  return BigInt(Math.floor(ms / 1000 / HOUR));
}

// Taiwan time label, e.g. 2026-10-06T13:00+08:00
export function hourIso(hourIndex: bigint | number): string {
  const d = new Date(Number(hourIndex) * HOUR * 1000 + 8 * HOUR * 1000);
  return d.toISOString().slice(0, 13) + ':00+08:00';
}

// A certificate is one plant and one hour: the plant id in the high 64 bits, the hour below.
export function certificateId(generatorId: number, hourIndex: bigint): bigint {
  return (BigInt(generatorId) << 64n) | hourIndex;
}

export function hourOf(id: bigint): bigint {
  return id & 0xffffffffffffffffn;
}

export function generatorOf(id: bigint): number {
  return Number(id >> 64n);
}

export type LedgerErrorCode =
  | 'NotOperator'
  | 'NotIssuer'
  | 'ConsumerExists'
  | 'GeneratorExists'
  | 'UnknownGenerator'
  | 'NotGeneratorIssuer'
  | 'AlreadyIssued'
  | 'UnknownConsumer'
  | 'ExceedsUnmatchedConsumption'
  | 'OnlyOneTransfer'
  | 'InsufficientBalance'
  | 'NotConsumerWallet'
  | 'HourMismatch';

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, detail?: string) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'LedgerError';
    this.code = code;
  }
}

export interface Generator {
  name: string;
  owner: string;
  issuer: string;
  commissionYear: number;
}

export interface RetiredEvent {
  type: 'Retired';
  id: bigint;
  holder: string;
  consumer: string;
  hour: bigint;
  kwh: bigint;
}

export type LedgerEvent =
  | { type: 'IssuerAdded'; issuer: string }
  | { type: 'ConsumerRegistered'; consumer: string; wallet: string }
  | { type: 'GeneratorRegistered'; generatorId: number; name: string; owner: string; issuer: string; commissionYear: number }
  | { type: 'IssuedBatch'; generatorId: number; firstHour: bigint; hours: number }
  | { type: 'ConsumptionRecorded'; consumer: string; firstHour: bigint; hours: number }
  | { type: 'Transferred'; id: bigint; from: string; to: string; kwh: bigint }
  | RetiredEvent;

const key = (...parts: (string | number | bigint)[]) => parts.map(String).join('|');

export class Ledger {
  readonly operator: string;
  readonly events: LedgerEvent[] = [];

  private readonly issuers = new Set<string>();
  private readonly consumerWallet = new Map<string, string>();
  private readonly generators = new Map<number, Generator>();
  private readonly balance = new Map<string, bigint>(); // id|holder
  private readonly issued = new Map<bigint, bigint>(); // id
  private readonly retired = new Map<bigint, bigint>(); // id
  private readonly consumption = new Map<string, bigint>(); // consumer|hour
  private readonly matched = new Map<string, bigint>(); // consumer|hour

  constructor(operator = 'operator') {
    this.operator = operator;
  }

  // Missing entries read as zero, like the Solidity mappings.
  private read<K extends string | bigint>(map: Map<K, bigint>, k: K): bigint {
    return map.get(k) ?? 0n;
  }

  private onlyOperator(sender: string) {
    if (sender !== this.operator) throw new LedgerError('NotOperator');
  }

  private onlyIssuer(sender: string) {
    if (!this.issuers.has(sender)) throw new LedgerError('NotIssuer');
  }

  addIssuer(sender: string, issuer: string) {
    this.onlyOperator(sender);
    this.issuers.add(issuer);
    this.events.push({ type: 'IssuerAdded', issuer });
  }

  registerConsumer(sender: string, consumer: string, wallet: string) {
    this.onlyOperator(sender);
    if (this.consumerWallet.has(consumer)) throw new LedgerError('ConsumerExists');
    this.consumerWallet.set(consumer, wallet);
    this.events.push({ type: 'ConsumerRegistered', consumer, wallet });
  }

  registerGenerator(sender: string, generatorId: number, name: string, owner: string, commissionYear: number) {
    this.onlyIssuer(sender);
    if (this.generators.has(generatorId)) throw new LedgerError('GeneratorExists');
    this.generators.set(generatorId, { name, owner, issuer: sender, commissionYear });
    this.events.push({ type: 'GeneratorRegistered', generatorId, name, owner, issuer: sender, commissionYear });
  }

  // One batch per plant per day, like one transaction per day on chain.
  issueBatch(sender: string, generatorId: number, firstHour: bigint, kwh: number[]) {
    this.onlyIssuer(sender);
    const g = this.generators.get(generatorId);
    if (!g) throw new LedgerError('UnknownGenerator');
    if (g.issuer !== sender) throw new LedgerError('NotGeneratorIssuer');
    // check every hour first, so a refused batch changes nothing (a reverted transaction changes nothing either)
    const rows = kwh.map((v, i) => [certificateId(generatorId, firstHour + BigInt(i)), BigInt(v)] as const);
    for (const [id, amount] of rows) {
      if (amount !== 0n && this.read(this.issued, id) !== 0n) throw new LedgerError('AlreadyIssued', String(id));
    }
    for (const [id, amount] of rows) {
      if (amount === 0n) continue;
      this.issued.set(id, amount);
      const bk = key(id, g.owner);
      this.balance.set(bk, this.read(this.balance, bk) + amount);
    }
    this.events.push({ type: 'IssuedBatch', generatorId, firstHour, hours: kwh.length });
  }

  recordConsumption(sender: string, consumer: string, firstHour: bigint, kwh: number[]) {
    this.onlyOperator(sender);
    if (!this.consumerWallet.has(consumer)) throw new LedgerError('UnknownConsumer');
    kwh.forEach((v, i) => {
      const k = key(consumer, firstHour + BigInt(i));
      if (BigInt(v) < this.read(this.matched, k)) throw new LedgerError('ExceedsUnmatchedConsumption');
    });
    kwh.forEach((v, i) => this.consumption.set(key(consumer, firstHour + BigInt(i)), BigInt(v)));
    this.events.push({ type: 'ConsumptionRecorded', consumer, firstHour, hours: kwh.length });
  }

  balanceOf(id: bigint, holder: string): bigint {
    return this.read(this.balance, key(id, holder));
  }

  // Only the plant account can transfer. Buyers cannot pass a certificate on (T-REC "transfer once").
  transfer(sender: string, id: bigint, to: string, kwh: number | bigint) {
    const amount = BigInt(kwh);
    const g = this.generators.get(generatorOf(id));
    if (!g || g.owner !== sender) throw new LedgerError('OnlyOneTransfer', String(id));
    const fk = key(id, sender);
    const have = this.read(this.balance, fk);
    if (have < amount) throw new LedgerError('InsufficientBalance', `${id} have ${have} want ${amount}`);
    this.balance.set(fk, have - amount);
    const tk = key(id, to);
    this.balance.set(tk, this.read(this.balance, tk) + amount);
    this.events.push({ type: 'Transferred', id, from: sender, to, kwh: amount });
  }

  // A consumer retires certificates against its own use in the same hour, up to what is still unmatched.
  retire(sender: string, id: bigint, kwh: number | bigint, consumer: string, consumptionHour: bigint) {
    if (this.consumerWallet.get(consumer) !== sender) throw new LedgerError('NotConsumerWallet', consumer);
    const amount = BigInt(kwh);
    const h = hourOf(id);
    if (h !== consumptionHour) throw new LedgerError('HourMismatch', `${h} vs ${consumptionHour}`);
    const bk = key(id, sender);
    const have = this.read(this.balance, bk);
    if (have < amount) throw new LedgerError('InsufficientBalance', `${id} have ${have} want ${amount}`);
    const ck = key(consumer, h);
    const unmatched = this.read(this.consumption, ck) - this.read(this.matched, ck);
    if (amount > unmatched) throw new LedgerError('ExceedsUnmatchedConsumption', `unmatched ${unmatched} want ${amount}`);
    this.balance.set(bk, have - amount);
    this.retired.set(id, this.read(this.retired, id) + amount);
    this.matched.set(ck, this.read(this.matched, ck) + amount);
    this.events.push({ type: 'Retired', id, holder: sender, consumer, hour: h, kwh: amount });
  }

  // Read helpers for the checker: hourly use and matched kWh for one consumer.
  hourly(consumer: string, fromHour: bigint, toHour: bigint): { hour: bigint; consumed: bigint; matched: bigint }[] {
    const rows: { hour: bigint; consumed: bigint; matched: bigint }[] = [];
    for (let h = fromHour; h < toHour; h++) {
      rows.push({
        hour: h,
        consumed: this.read(this.consumption, key(consumer, h)),
        matched: this.read(this.matched, key(consumer, h)),
      });
    }
    return rows;
  }

  retirementsBy(consumer: string): RetiredEvent[] {
    return this.events.filter((e): e is RetiredEvent => e.type === 'Retired' && e.consumer === consumer);
  }
}
