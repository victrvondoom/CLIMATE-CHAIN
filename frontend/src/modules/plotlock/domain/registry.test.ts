import { describe, expect, it } from 'vitest';
import { PlotRegistry } from './registry';
import { evaluate, type EvidenceBundle } from './verdict';
import plot1 from '../fixtures/plot-1-clean.json';
import plot2 from '../fixtures/plot-2-burned.json';
import plot3 from '../fixtures/plot-3-cloudy.json';
import plot4 from '../fixtures/plot-4-duplicate.json';
import webCells from '../fixtures/web_plot1_cells.json';

// Rules ported from projects/plotlock-main/contracts/PlotLock.sol (registerPlot, submitClaim).
// The cell-overlap check uses the plot-1 cell set shown on the source web page.

const SEASON = 2026;

describe('plot-1 cell set in the web page fixture', () => {
  it('matches the cell set of the oracle fixture and its declared count', () => {
    expect(webCells.h3_cells).toHaveLength(webCells.h3_cell_count);
    expect(new Set(webCells.h3_cells)).toEqual(new Set(plot1.plot.h3_cells));
  });

  it('shares exactly the number of cells the source test expects with the redrawn plot 4', () => {
    const plot1Cells = new Set(webCells.h3_cells);
    const shared = plot4.plot.h3_cells.filter((cell) => plot1Cells.has(cell));
    expect(shared).toHaveLength(webCells.duplicate.overlapping_cell_count);
    expect(shared.length).toBeGreaterThan(0);
    for (const cell of webCells.duplicate.overlapping_cells_sample) expect(shared).toContain(cell);
  });
});

describe('H3 cell land registry', () => {
  it('registers plot 1 and reverts the redrawn plot 4 with CellAlreadyTaken', () => {
    const registry = new PlotRegistry();
    expect(registry.registerPlot(SEASON, plot1.plot.h3_cells)).toEqual({ ok: true, plotId: 1 });
    const second = registry.registerPlot(SEASON, plot4.plot.h3_cells);
    expect(second).toMatchObject({ ok: false, error: 'CellAlreadyTaken' });
  });

  it('reverts as a whole: no cell of the refused plot is left registered', () => {
    const registry = new PlotRegistry();
    registry.registerPlot(SEASON, plot1.plot.h3_cells);
    registry.registerPlot(SEASON, plot4.plot.h3_cells);
    const plot1Cells = new Set(plot1.plot.h3_cells);
    const freeCell = plot4.plot.h3_cells.find((cell) => !plot1Cells.has(cell));
    expect(freeCell).toBeDefined();
    expect(registry.isCellTaken(SEASON, freeCell!)).toBe(false);
  });

  it('treats the same land as free in another season', () => {
    const registry = new PlotRegistry();
    registry.registerPlot(SEASON, plot1.plot.h3_cells);
    expect(registry.registerPlot(SEASON + 1, plot4.plot.h3_cells).ok).toBe(true);
  });

  it('refuses an empty cell set', () => {
    expect(new PlotRegistry().registerPlot(SEASON, [])).toMatchObject({ ok: false, error: 'EmptyCellSet' });
  });

  it('registers the three distinct demo plots of the season', () => {
    const registry = new PlotRegistry();
    expect(registry.registerPlot(SEASON, plot1.plot.h3_cells).ok).toBe(true);
    expect(registry.registerPlot(SEASON, plot2.plot.h3_cells).ok).toBe(true);
    expect(registry.registerPlot(SEASON, plot3.plot.h3_cells).ok).toBe(true);
  });
});

describe('one claim per plot and season', () => {
  it('records a NoBurn verdict as a payable attestation, once', () => {
    const registry = new PlotRegistry();
    const { plotId } = registry.registerPlot(SEASON, plot1.plot.h3_cells) as { plotId: number };
    expect(registry.submitClaim(plotId, SEASON, 'NoBurn')).toEqual({ ok: true, status: 'attested', payable: true });
    expect(registry.hasAttestation(plotId, SEASON)).toBe(true);
    expect(registry.submitClaim(plotId, SEASON, 'NoBurn')).toMatchObject({ ok: false, error: 'ClaimAlreadyRecorded' });
  });

  it('records Burned and Uncertain verdicts as rejections, never as payable', () => {
    const registry = new PlotRegistry();
    const burned = registry.registerPlot(SEASON, plot2.plot.h3_cells) as { plotId: number };
    const cloudy = registry.registerPlot(SEASON, plot3.plot.h3_cells) as { plotId: number };
    expect(registry.submitClaim(burned.plotId, SEASON, 'Burned')).toEqual({ ok: true, status: 'rejected', payable: false });
    expect(registry.submitClaim(cloudy.plotId, SEASON, 'Uncertain')).toEqual({ ok: true, status: 'rejected', payable: false });
    expect(registry.hasAttestation(burned.plotId, SEASON)).toBe(false);
  });

  it('refuses a claim for an unknown plot or for the wrong season', () => {
    const registry = new PlotRegistry();
    const { plotId } = registry.registerPlot(SEASON, plot1.plot.h3_cells) as { plotId: number };
    expect(registry.submitClaim(99, SEASON, 'NoBurn')).toMatchObject({ ok: false, error: 'PlotNotFound' });
    expect(registry.submitClaim(plotId, SEASON + 1, 'NoBurn')).toMatchObject({ ok: false, error: 'SeasonMismatch' });
  });
});

describe('season run: oracle verdicts feed the registry', () => {
  it('pays only the clean plot, and the duplicate plot never gets a claim', () => {
    const registry = new PlotRegistry();
    const bundles: [string, EvidenceBundle, typeof plot1.plot.h3_cells][] = [
      ['plot-1-clean', plot1 as EvidenceBundle, plot1.plot.h3_cells],
      ['plot-2-burned', plot2 as EvidenceBundle, plot2.plot.h3_cells],
      ['plot-3-cloudy', plot3 as EvidenceBundle, plot3.plot.h3_cells],
    ];
    const payable: string[] = [];
    for (const [name, bundle, cells] of bundles) {
      const reg = registry.registerPlot(SEASON, cells);
      expect(reg.ok).toBe(true);
      const outcome = registry.submitClaim((reg as { plotId: number }).plotId, SEASON, evaluate(bundle).verdict);
      if (outcome.ok && outcome.payable) payable.push(name);
    }
    expect(payable).toEqual(['plot-1-clean']);
    expect(registry.registerPlot(SEASON, plot4.plot.h3_cells)).toMatchObject({ ok: false, error: 'CellAlreadyTaken' });
  });
});
