// Port of the serial rules in contracts/CarbonRegistry.sol (submitVerification):
// issued = min(claimed, verified), and serials are handed out in order from nextSerial.
// A duplicate is a serial range that overlaps an earlier one.

export interface LedgerEntry {
  project_id: string;
  claimed: number;
  verified: number;
  issued: number;
  serial_start: number;
  serial_end: number;
}

export interface SerialEntryAudit {
  project_id: string;
  issues: string[];
}

export interface SerialAudit {
  unique: boolean;
  entries: SerialEntryAudit[];
}

export function auditSerials(entries: readonly LedgerEntry[]): SerialAudit {
  const issued: { project_id: string; start: number; end: number }[] = [];
  let next = 1;
  let unique = true;

  const audited = entries.map((entry): SerialEntryAudit => {
    const issues: string[] = [];
    const cap = Math.min(entry.claimed, entry.verified);
    if (entry.issued !== cap) issues.push(`issued ${entry.issued} is not min(claimed, verified) = ${cap}`);

    if (entry.issued === 0) {
      if (entry.serial_start !== 0 || entry.serial_end !== 0) issues.push('nothing issued but a serial range is recorded');
      return { project_id: entry.project_id, issues };
    }

    const { serial_start: start, serial_end: end } = entry;
    if (end - start + 1 !== entry.issued) {
      issues.push(`serial range ${start}-${end} does not hold ${entry.issued} credits`);
    }
    if (start !== next) issues.push(`range starts at ${start}, expected ${next} from nextSerial`);

    const clash = issued.find((r) => start <= r.end && r.start <= end);
    if (clash) {
      unique = false;
      const from = Math.max(start, clash.start);
      const to = Math.min(end, clash.end);
      issues.push(`serials ${from}-${to} also issued to ${clash.project_id}`);
    }

    issued.push({ project_id: entry.project_id, start, end });
    next = end + 1;
    return { project_id: entry.project_id, issues };
  });

  return { unique, entries: audited };
}
