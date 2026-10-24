import { describe, expect, it } from 'vitest';
import { evaluate, isPayable, type EvidenceBundle } from './verdict';
import plot1 from '../fixtures/plot-1-clean.json';
import plot2 from '../fixtures/plot-2-burned.json';
import plot3 from '../fixtures/plot-3-cloudy.json';

// Ported from projects/plotlock-main/oracle/evidence.py and oracle/tests/test_oracle.py.
// Both signals must agree. Only NoBurn is payable. A missing signal or a disagreement is Uncertain.

const clean = plot1 as EvidenceBundle;
const burnedFirms = plot2.firms as EvidenceBundle['firms'];
const burnedScar = plot2.sentinel2 as EvidenceBundle['sentinel2'];
const countingHit = plot2.firms.detections[0];
const cleanFirms: EvidenceBundle['firms'] = { status: 'ok', detections: [] };
const cleanScar: EvidenceBundle['sentinel2'] = { status: 'ok', dnbr_mean: 0.02, burned_pixel_fraction: 0.01 };

describe('fixture verdicts', () => {
  it('gives NoBurn for the clean plot, Burned for the burned plot, Uncertain for the cloudy plot', () => {
    expect(evaluate(clean).verdict).toBe('NoBurn');
    expect(evaluate(plot2 as EvidenceBundle).verdict).toBe('Burned');
    expect(evaluate(plot3 as EvidenceBundle).verdict).toBe('Uncertain');
  });

  it('marks a plot Uncertain when the FIRMS feed is down', () => {
    expect(evaluate({ ...clean, firms: { status: 'unavailable', detections: [] } }).verdict).toBe('Uncertain');
  });

  it('marks a plot Uncertain when the scar check is unavailable, even with a FIRMS hit', () => {
    const bundle = { ...(plot2 as EvidenceBundle), sentinel2: { status: 'unavailable', unavailable_reason: 'cloud' } };
    expect(evaluate(bundle).verdict).toBe('Uncertain');
  });

  it('marks a plot Uncertain when the two signals disagree, in either direction', () => {
    expect(evaluate({ ...clean, firms: burnedFirms }).verdict).toBe('Uncertain');
    expect(evaluate({ ...clean, sentinel2: burnedScar }).verdict).toBe('Uncertain');
  });

  it('does not count low-confidence FIRMS rows', () => {
    const bundle = { ...clean, firms: { status: 'ok', detections: [{ ...countingHit, confidence: 'l' }] } };
    expect(evaluate(bundle).verdict).toBe('NoBurn');
  });

  it('does not count a FIRMS detection outside the plot', () => {
    const bundle = { ...clean, firms: { status: 'ok', detections: [{ ...countingHit, inside_plot: false }] } };
    expect(evaluate(bundle).verdict).toBe('NoBurn');
  });
});

describe('scar thresholds (documented in evidence.py: mean dNBR >= 0.10 or >= 25% burned pixels)', () => {
  const withHit = (scar: EvidenceBundle['sentinel2']) => ({ ...clean, firms: { status: 'ok', detections: [countingHit] }, sentinel2: scar });

  it('reads a mean dNBR of exactly 0.10 as a scar', () => {
    expect(evaluate(withHit({ status: 'ok', dnbr_mean: 0.1, burned_pixel_fraction: 0 })).verdict).toBe('Burned');
  });

  it('reads 25% burned pixels as a scar even when the mean is low', () => {
    expect(evaluate(withHit({ status: 'ok', dnbr_mean: 0, burned_pixel_fraction: 0.25 })).verdict).toBe('Burned');
  });

  it('reads just below both thresholds as no scar, so the signals disagree', () => {
    expect(evaluate(withHit({ status: 'ok', dnbr_mean: 0.0999, burned_pixel_fraction: 0.2499 })).verdict).toBe('Uncertain');
  });

  it('treats a scar check with a missing number as incomplete, not clean', () => {
    const bundle = { ...clean, sentinel2: { status: 'ok', dnbr_mean: null, burned_pixel_fraction: 0.5 } };
    expect(evaluate(bundle).verdict).toBe('Uncertain');
  });
});

describe('payout rule', () => {
  it('pays only a NoBurn verdict', () => {
    expect(isPayable('NoBurn')).toBe(true);
    expect(isPayable('Burned')).toBe(false);
    expect(isPayable('Uncertain')).toBe(false);
  });

  it('keeps the clean signals in the evaluation, so the Page can show them', () => {
    const result = evaluate({ ...clean, firms: cleanFirms, sentinel2: cleanScar });
    expect(result.verdict).toBe('NoBurn');
    expect(result.signals.sentinel2.present).toBe(true);
    expect(result.signals.sentinel2.positive).toBe(false);
  });
});
