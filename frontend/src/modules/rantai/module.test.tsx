import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import climateModule from './module';

describe('rantai module', () => {
  it('declares its id, mode and features', () => {
    expect(climateModule.id).toBe('rantai');
    expect(climateModule.mode).toBe('SIMULATED');
    expect(climateModule.features).toHaveLength(4);
  });

  it('renders the analysis, the tally and the simulated flows, with no wallet call', () => {
    const Page = climateModule.Page;
    const html = renderToString(<Page />);
    expect(html).toContain('Carbon analysis');
    expect(html).toContain('1,039.05');
    expect(html).toContain('DAO vote tally');
    expect(html).toContain('Offset marketplace');
    expect(html).toContain('Source bug');
    expect(html).toContain('simulated, no wallet is connected');
  });
});
