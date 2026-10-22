import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import climateModule from './module';

describe('plotlock module', () => {
  it('declares its id, mode and features', () => {
    expect(climateModule.id).toBe('plotlock');
    expect(climateModule.mode).toBe('SIMULATED');
    expect(climateModule.features).toHaveLength(3);
  });

  it('renders the registry outcome and the one-claim rule', () => {
    const Page = climateModule.Page;
    // React separates adjacent text nodes with <!-- --> markers; drop them to match visible text
    const html = renderToString(<Page />).replace(/<!--.*?-->/g, '');
    expect(html).toContain('H3 cell land registry');
    expect(html).toContain('reverted: CellAlreadyTaken');
    expect(html).toContain('ClaimAlreadyRecorded');
    expect(html).toContain('RESEARCH');
    expect(html).toContain('SIMULATED');
  });
});
