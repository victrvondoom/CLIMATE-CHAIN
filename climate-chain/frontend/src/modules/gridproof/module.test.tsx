import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import climateModule from './module';

describe('WattCert module', () => {
  it('declares its id, DEMO mode, and the project folder it was ported from', () => {
    expect(climateModule.id).toBe('gridproof');
    expect(climateModule.mode).toBe('DEMO');
    expect(climateModule.source.folder).toBe('gridproof-main');
    expect(climateModule.features).toHaveLength(4);
  });

  it('renders the DEMO label, the quarantine rule, the mint step and the not-ported list', () => {
    const Page = climateModule.Page;
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain('DEMO');
    expect(html).toContain('Readings and the plausibility check');
    expect(html).toContain('Mint once per device-hour');
    expect(html).toContain('Retire to match load, by hour');
    expect(html).toContain('Not ported');
  });
});
