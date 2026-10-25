import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import climateModule from './module';

describe('TorchSight module', () => {
  it('declares its id, measured-data mode, and the project folder it was ported from', () => {
    expect(climateModule.id).toBe('flarewatch');
    expect(climateModule.mode).toBe('RESEARCH');
    expect(climateModule.source.folder).toBe('flarewatch-main');
    expect(climateModule.features).toHaveLength(4);
  });

  it('renders the week with the RESEARCH label, the persistent flare count and the ledger check', () => {
    const Page = climateModule.Page;
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain('RESEARCH');
    expect(html).toContain('Nightly detections');
    expect(html).toContain('Persistent flares');
    expect(html).toContain('Verify all nights');
    expect(html).toContain('Not ported');
  });
});
