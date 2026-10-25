import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import climateModule from './module';

describe('MethaneMend module', () => {
  it('declares its id, default mode, and the project folder it was ported from', () => {
    expect(climateModule.id).toBe('plume');
    expect(climateModule.mode).toBe('RESEARCH');
    expect(climateModule.source.folder).toBe('PLUME-main');
    expect(climateModule.features).toHaveLength(4);
  });

  it('renders the detections as RESEARCH and the repair demo as SIMULATED, with the fixture incidents', () => {
    const Page = climateModule.Page;
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain('Candidate sources');
    expect(html).toContain('RESEARCH');
    expect(html).toContain('Repair and funds (demo)');
    expect(html).toContain('SIMULATED');
    expect(html).toContain('CH4_1B2_250m_-101.77227_31.84496');
    expect(html).toContain('Not ported');
  });
});
