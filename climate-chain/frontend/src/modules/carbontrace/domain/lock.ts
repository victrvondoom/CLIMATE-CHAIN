// Port of the cell lock in contracts-pkg/contracts/CarbonTraceRegistry.sol (mintVerified and findConflict).
// Each vintage year has a map from grid cell to the project that holds it. A claim reverts, and changes nothing,
// if any of its cells is already held by an active (not revoked) project for that year.
// Not ported: the attestation signature and cellsHash checks, the on-chain mint and retirement.

export const MAX_CELLS = 256;
const CELL_SIZE_MICRODEG = 2000; // must match CELL_SIZE_MICRODEG in the contract and backend/app/geo.py
const CELL_DEG = CELL_SIZE_MICRODEG / 1_000_000;
const LON_SPAN = 4294967296; // 2^32: the lat index is shifted past the 32-bit lon index

// Same cell id as geo.py cell_id: (latIdx << 32) | lonIdx. Written as arithmetic so ids stay exact numbers above 2^31.
export function cellId(lat: number, lon: number): number {
  const latIdx = Math.floor((lat + 90) / CELL_DEG);
  const lonIdx = Math.floor((lon + 180) / CELL_DEG);
  return latIdx * LON_SPAN + lonIdx;
}

export type ClaimResult =
  | { ok: true; projectId: number }
  | { ok: false; reason: 'BadCells' | 'CellsNotSorted' }
  | { ok: false; reason: 'CellAlreadyClaimed'; cell: number; existing: number };

export type ConflictResult = { conflict: false } | { conflict: true; cell: number; existing: number };

export class RegistryLock {
  private readonly owner = new Map<string, number>(); // `${vintage}:${cell}` -> projectId (0 or missing = free)
  private readonly revoked = new Set<number>();
  private minted = 0;

  get projectCount(): number {
    return this.minted;
  }

  private holder(vintage: number, cell: number): number {
    const existing = this.owner.get(`${vintage}:${cell}`) ?? 0;
    return existing !== 0 && !this.revoked.has(existing) ? existing : 0;
  }

  // Same as findConflict in the contract: the first cell, in the order given, that an active project holds.
  findConflict(vintage: number, cells: number[]): ConflictResult {
    for (const cell of cells) {
      const existing = this.holder(vintage, cell);
      if (existing !== 0) return { conflict: true, cell, existing };
    }
    return { conflict: false };
  }

  // Same order of checks as mintVerified: cell count, then for each cell its sort order and then its claim.
  claim(vintage: number, cells: number[], projectId: number): ClaimResult {
    if (cells.length === 0 || cells.length > MAX_CELLS) return { ok: false, reason: 'BadCells' };
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (i > 0 && cell <= cells[i - 1]) return { ok: false, reason: 'CellsNotSorted' };
      const existing = this.holder(vintage, cell);
      if (existing !== 0) return { ok: false, reason: 'CellAlreadyClaimed', cell, existing };
    }
    for (const cell of cells) this.owner.set(`${vintage}:${cell}`, projectId);
    this.minted += 1;
    return { ok: true, projectId };
  }

  // A revoked project freezes and releases its cells, as in revokeProject.
  revoke(projectId: number): void {
    this.revoked.add(projectId);
  }
}
