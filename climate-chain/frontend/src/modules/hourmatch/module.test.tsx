import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import climateModule from './module';

describe('hourmatch module', () => {
  it('declares its id, mode and features', () => {
    expect(climateModule.id).toBe('hourmatch');
    expect(climateModule.mode).toBe('DEMO');
    expect(climateModule.features).toHaveLength(3);
  });

  it('renders its sections with the mode labels visible', () => {
    const Page = climateModule.Page;
    const html = renderToString(<Page />);
    expect(html).toContain('HourSync');
    expect(html).toContain('Taipower curves');
    expect(html).toContain('RESEARCH');
    expect(html).toContain('Transfer-once rule');
    expect(html).toContain('Claim checker');
    expect(html).toContain('DEMO');
  });
});
