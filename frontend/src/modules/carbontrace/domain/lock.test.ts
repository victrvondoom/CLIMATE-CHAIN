import { describe, expect, it } from 'vitest';
import scenarioDoc from '../fixtures/scenarios-demo.json';
import { RegistryLock, cellId } from './lock';

// Vectors come from contracts-pkg/test/CarbonTraceRegistry.test.js: CellAlreadyClaimed(cell, existingProject), CellsNotSorted, BadCells.

const wayanad = scenarioDoc.scenarios.find((s) => s.id === 'legit-wayanad')!.geometry.cells;
const oregon = scenarioDoc.scenarios.find((s) => s.id === 'legit-oregon')!.geometry.cells;

describe('registry cell lock (contracts-pkg CarbonTraceRegistry.sol mintVerified / findConflict)', () => {
  it('a second claim over the same polygon in the same vintage reverts and names the first cell and project', () => {
    const lock = new RegistryLock();
    expect(lock.claim(2025, [1, 2, 3, 4], 1)).toEqual({ ok: true, projectId: 1 });
    expect(lock.claim(2025, [1, 2, 3, 4], 2)).toEqual({ ok: false, reason: 'CellAlreadyClaimed', cell: 1, existing: 1 });
    expect(lock.projectCount).toBe(1);
  });

  it('a partial overlap reverts at the first shared cell', () => {
    const lock = new RegistryLock();
    lock.claim(2025, [10, 11, 12], 1);
    expect(lock.claim(2025, [12, 13, 14], 2)).toEqual({ ok: false, reason: 'CellAlreadyClaimed', cell: 12, existing: 1 });
  });

  it('the same land can be claimed in a different vintage year', () => {
    const lock = new RegistryLock();
    expect(lock.claim(2024, [1, 2], 1).ok).toBe(true);
    expect(lock.claim(2025, [1, 2], 2).ok).toBe(true);
    expect(lock.projectCount).toBe(2);
  });

  it('adjacent, non-overlapping land is accepted', () => {
    const lock = new RegistryLock();
    expect(lock.claim(2025, [1, 2], 1).ok).toBe(true);
    expect(lock.claim(2025, [3, 4], 2).ok).toBe(true);
  });

  it('rejects unsorted or duplicate cells with CellsNotSorted', () => {
    const lock = new RegistryLock();
    expect(lock.claim(2025, [2, 1], 1)).toEqual({ ok: false, reason: 'CellsNotSorted' });
    expect(lock.claim(2025, [1, 1], 1)).toEqual({ ok: false, reason: 'CellsNotSorted' });
  });

  it('rejects an empty or oversized cell set with BadCells, and accepts exactly 256 cells', () => {
    const lock = new RegistryLock();
    expect(lock.claim(2025, [], 1)).toEqual({ ok: false, reason: 'BadCells' });
    const tooMany = Array.from({ length: 257 }, (_, i) => i + 1);
    expect(lock.claim(2025, tooMany, 1)).toEqual({ ok: false, reason: 'BadCells' });
    const max = Array.from({ length: 256 }, (_, i) => i + 1);
    expect(lock.claim(2025, max, 1).ok).toBe(true);
  });

  it('a failed claim changes nothing: it is all or nothing, like a revert', () => {
    const lock = new RegistryLock();
    lock.claim(2025, [5], 1);
    expect(lock.claim(2025, [3, 4, 5], 2).ok).toBe(false);
    expect(lock.claim(2025, [3, 4], 3).ok).toBe(true); // 3 and 4 were not left behind by the failed claim
  });

  it('findConflict reports overlaps before any claim is sent', () => {
    const lock = new RegistryLock();
    lock.claim(2025, [10, 11, 12], 1);
    expect(lock.findConflict(2025, [13, 12, 14])).toEqual({ conflict: true, cell: 12, existing: 1 });
    expect(lock.findConflict(2025, [13, 14])).toEqual({ conflict: false });
  });

  it('a revoked project releases its cells for a new claim', () => {
    const lock = new RegistryLock();
    lock.claim(2025, [1, 2], 1);
    lock.revoke(1);
    expect(lock.claim(2025, [1, 2], 2).ok).toBe(true);
  });

  it('blocks the real double count: the same Wayanad polygon claimed twice, and disjoint Oregon land is fine', () => {
    const lock = new RegistryLock();
    expect(lock.claim(2025, wayanad, 1).ok).toBe(true);
    expect(lock.claim(2025, wayanad, 2)).toEqual({ ok: false, reason: 'CellAlreadyClaimed', cell: wayanad[0], existing: 1 });
    expect(lock.claim(2025, oregon, 3).ok).toBe(true);
  });

  it('cellId packs the lat and lon indices without 32-bit overflow', () => {
    // Same arithmetic as backend/app/geo.py: (latIdx << 32) | lonIdx, with lat and lon in 0.002 degree cells.
    const id = cellId(11.652, 76.105);
    expect(Number.isSafeInteger(id)).toBe(true);
    expect(id).toBe(Math.floor((11.652 + 90) / 0.002) * 4294967296 + Math.floor((76.105 + 180) / 0.002));
  });
});
