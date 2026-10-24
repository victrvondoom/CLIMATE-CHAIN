import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClimateTimeline } from './ClimateTimeline';

describe('ClimateTimeline component', () => {
  it('renders the 200-Year Climate Intelligence title and official dataset badges', () => {
    const html = renderToStaticMarkup(createElement(ClimateTimeline));
    expect(html).toContain('Climate Intelligence Timeline — 200 Years of Environmental Evidence');
    expect(html).toContain('8 AUDITED OFFICIAL DATASETS');
    expect(html).toContain('200-YEAR SPAN (1826–2026)');
    expect(html).toContain('ZERO UNANCHORED INTERPOLATION');
  });

  it('renders all 4 scientific climate indicator buttons', () => {
    const html = renderToStaticMarkup(createElement(ClimateTimeline));
    expect(html).toContain('Global Surface Temperature Anomaly');
    expect(html).toContain('Atmospheric Carbon Dioxide (CO₂)');
    expect(html).toContain('Atmospheric Methane (CH₄)');
    expect(html).toContain('Renewable Electricity Generation Share');
  });

  it('renders the SVG time-series chart container and scrubbing slider', () => {
    const html = renderToStaticMarkup(createElement(ClimateTimeline));
    expect(html).toContain('ctl-svg-chart');
    expect(html).toContain('ctl-slider');
    expect(html).toContain('1826');
    expect(html).toContain('2026');
  });

  it('renders the Official Dataset Registry section and IEEE compliance statement', () => {
    const html = renderToStaticMarkup(createElement(ClimateTimeline));
    expect(html).toContain('Official Dataset Registry (IEEE Integrity Catalog)');
    expect(html).toContain('View Full Catalog');
  });
});
