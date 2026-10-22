// In-memory port of the rules in projects/plotlock-main/contracts/PlotLock.sol:
//   - a plot is registered per season as a set of H3 cell ids; ANY cell already taken in that
//     season reverts the whole registration (the same land cannot be claimed twice);
//   - one claim per (plot, season); a second claim reverts;
//   - only a NoBurn verdict records a payable attestation. Burned and Uncertain are recorded as
//     rejections.
// Not ported: the EIP-191 oracle signature, nonces and deadlines, and the on-chain transactions.
// Cell ids are decimal strings (H3 indexes exceed 2^53, so they must not be parsed as numbers).
import { isPayable, type Verdict } from './verdict';

export type RegisterResult =
  | { ok: true; plotId: number }
  | { ok: false; error: 'EmptyCellSet' | 'CellAlreadyTaken'; cell?: string };

export type ClaimResult =
  | { ok: true; status: 'attested' | 'rejected'; payable: boolean }
  | { ok: false; error: 'PlotNotFound' | 'SeasonMismatch' | 'ClaimAlreadyRecorded' };

export interface RecordedClaim {
  verdict: Verdict;
  payable: boolean;
}

const cellKey = (season: number, cell: string) => `${season}|${cell}`;
const claimKey = (plotId: number, season: number) => `${plotId}|${season}`;

export class PlotRegistry {
  private nextPlotId = 1;
  private readonly plots = new Map<number, { season: number; cells: string[] }>();
  private readonly cellTaken = new Map<string, number>(); // season|cell -> plot id
  private readonly claims = new Map<string, RecordedClaim>(); // plot id|season

  registerPlot(season: number, cells: string[]): RegisterResult {
    if (cells.length === 0) return { ok: false, error: 'EmptyCellSet' };
    // check every cell before marking any, so a refused registration changes nothing
    const seen = new Set<string>();
    for (const cell of cells) {
      if (seen.has(cell) || this.cellTaken.has(cellKey(season, cell))) {
        return { ok: false, error: 'CellAlreadyTaken', cell };
      }
      seen.add(cell);
    }
    const plotId = this.nextPlotId++;
    for (const cell of cells) this.cellTaken.set(cellKey(season, cell), plotId);
    this.plots.set(plotId, { season, cells: [...cells] });
    return { ok: true, plotId };
  }

  isCellTaken(season: number, cell: string): boolean {
    return this.cellTaken.has(cellKey(season, cell));
  }

  submitClaim(plotId: number, season: number, verdict: Verdict): ClaimResult {
    const plot = this.plots.get(plotId);
    if (!plot) return { ok: false, error: 'PlotNotFound' };
    if (plot.season !== season) return { ok: false, error: 'SeasonMismatch' };
    const key = claimKey(plotId, season);
    if (this.claims.has(key)) return { ok: false, error: 'ClaimAlreadyRecorded' };
    const payable = isPayable(verdict);
    this.claims.set(key, { verdict, payable });
    return { ok: true, status: payable ? 'attested' : 'rejected', payable };
  }

  claimOf(plotId: number, season: number): RecordedClaim | undefined {
    return this.claims.get(claimKey(plotId, season));
  }

  hasAttestation(plotId: number, season: number): boolean {
    return this.claimOf(plotId, season)?.payable === true;
  }
}
