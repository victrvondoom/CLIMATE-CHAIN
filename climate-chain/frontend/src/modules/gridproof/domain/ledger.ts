// Certificates, mint-once and retirement by hour, ported from WattCert
// contracts/contracts/GranularCertificate.sol and oracle/gridproof/pipeline.py (allocation).
// Device signatures and the chain are not modelled: this is the rule for what may be minted,
// retired and matched, and the state a page can show.

export const ANOMALY_THRESHOLD_BPS = 7000;

export type CertStatus = 'none' | 'issued' | 'quarantined';

export interface Reading {
  deviceId: number;
  hour: number; // unix hour (seconds / 3600)
  wh: number;
  anomalyBps: number; // 0 to 10000, from the plausibility check
}

export interface DeviceInfo {
  capacityW: number;
}

// A refused call. The name is the contract's error name, so the page can show why.
export class ContractError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'ContractError';
    this.code = code;
  }
}

// tokenId = deviceId << 32 | hour. BigInt keeps the 64-bit layout exact.
export function tokenIdFor(deviceId: number, hour: number): bigint {
  return (BigInt(deviceId) << 32n) | BigInt(hour);
}

export function decodeTokenId(tokenId: bigint): { deviceId: number; hour: number } {
  return { deviceId: Number(tokenId >> 32n), hour: Number(tokenId & 0xffff_ffffn) };
}

interface Cert {
  status: Exclude<CertStatus, 'none'>;
  wh: number;
  retiredWh: number;
}

export class CertificateBook {
  private readonly certs = new Map<bigint, Cert>();
  private readonly loads = new Map<string, number>();
  private readonly matchedWh = new Map<string, number>();
  private readonly thresholdBps: number;

  constructor(thresholdBps: number = ANOMALY_THRESHOLD_BPS) {
    this.thresholdBps = thresholdBps;
  }

  status(tokenId: bigint): CertStatus {
    return this.certs.get(tokenId)?.status ?? 'none';
  }

  balance(tokenId: bigint): number {
    const c = this.certs.get(tokenId);
    return c && c.status === 'issued' ? c.wh - c.retiredWh : 0;
  }

  // One certificate per device-hour: the check that a device-hour has not been minted before, that
  // the hour has finished, and that the reading is within the device's rating. At or above the
  // threshold the certificate is quarantined and carries no balance.
  mint(reading: Reading, device: DeviceInfo, nowHour: number): 'issued' | 'quarantined' {
    if (reading.wh === 0) throw new ContractError('ZeroAmount', 'a reading must be above zero');
    if (reading.hour + 1 > nowHour) throw new ContractError('FutureHour', `hour ${reading.hour} has not finished`);
    if (reading.wh > device.capacityW) {
      throw new ContractError('ExceedsCapacity', `${reading.wh} Wh is above the ${device.capacityW} Wh rating`);
    }
    const id = tokenIdFor(reading.deviceId, reading.hour);
    if (this.status(id) !== 'none') throw new ContractError('AlreadyRecorded', `token ${id} is already recorded`);
    const quarantined = reading.anomalyBps >= this.thresholdBps;
    this.certs.set(id, { status: quarantined ? 'quarantined' : 'issued', wh: reading.wh, retiredWh: 0 });
    return quarantined ? 'quarantined' : 'issued';
  }

  // Sends a batch. A device-hour already on the book is skipped, so a batch can be sent again.
  submitBatch(
    readings: readonly Reading[],
    deviceFor: (deviceId: number) => DeviceInfo,
    nowHour: number,
  ): { issued: number; quarantined: number; skipped: number } {
    const out = { issued: 0, quarantined: 0, skipped: 0 };
    for (const r of readings) {
      if (this.status(tokenIdFor(r.deviceId, r.hour)) !== 'none') {
        out.skipped++;
        continue;
      }
      if (this.mint(r, deviceFor(r.deviceId), nowHour) === 'issued') out.issued++;
      else out.quarantined++;
    }
    return out;
  }

  // Burns certificate balance for a beneficiary. The match counts for the hour the certificate was issued for.
  retire(tokenId: bigint, wh: number, beneficiary: string): void {
    if (wh === 0) throw new ContractError('ZeroAmount', 'retire at least one Wh');
    const c = this.certs.get(tokenId);
    if (!c || c.status !== 'issued') throw new ContractError('NotIssued', `token ${tokenId} is not issued`);
    const left = c.wh - c.retiredWh;
    if (wh > left) throw new ContractError('InsufficientBalance', `insufficient balance: ${left} Wh left`);
    c.retiredWh += wh;
    const { hour } = decodeTokenId(tokenId);
    const key = `${beneficiary}|${hour}`;
    this.matchedWh.set(key, (this.matchedWh.get(key) ?? 0) + wh);
  }

  reportLoad(consumer: string, hour: number, wh: number): void {
    this.loads.set(`${consumer}|${hour}`, wh);
  }

  matched(consumer: string, hour: number): { load: number; matched: number } {
    return {
      load: this.loads.get(`${consumer}|${hour}`) ?? 0,
      matched: this.matchedWh.get(`${consumer}|${hour}`) ?? 0,
    };
  }

  // Share of the hour's load covered by retired certificates, in basis points, capped at 10000.
  hourlyMatchBps(consumer: string, hour: number): number {
    const { load, matched } = this.matched(consumer, hour);
    if (load === 0) return 0;
    return matched >= load ? 10000 : Math.floor((matched * 10000) / load);
  }

  // Total load, and the matched energy capped at each hour's own load.
  periodMatch(consumer: string, fromHour: number, toHour: number): { totalLoadWh: number; matchedCappedWh: number } {
    let totalLoadWh = 0;
    let matchedCappedWh = 0;
    for (let h = fromHour; h < toHour; h++) {
      const { load, matched } = this.matched(consumer, h);
      totalLoadWh += load;
      matchedCappedWh += Math.min(matched, load);
    }
    return { totalLoadWh, matchedCappedWh };
  }
}

// Shares one hour's supply between buyers, as oracle/gridproof/pipeline.py does: each certificate is
// split in proportion to load, never more than a buyer needs, and never more than the certificate holds.
export function allocateHour(
  supply: readonly { tokenId: bigint; wh: number }[],
  demand: Readonly<Record<string, number>>,
): { tokenId: bigint; buyer: string; wh: number }[] {
  const total = Object.values(demand).reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const need: Record<string, number> = { ...demand };
  const out: { tokenId: bigint; buyer: string; wh: number }[] = [];
  for (const cert of supply) {
    let remaining = cert.wh;
    for (const buyer of Object.keys(need)) {
      const share = Math.min(need[buyer], Math.floor((cert.wh * need[buyer]) / total), remaining);
      if (share <= 0) continue;
      out.push({ tokenId: cert.tokenId, buyer, wh: share });
      need[buyer] -= share;
      remaining -= share;
    }
  }
  return out;
}
