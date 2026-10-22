import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import climateModule from './module';

describe('carbonshield module', () => {
  it('declares RESEARCH mode and shows that label on its Page', () => {
    expect(climateModule.id).toBe('carbonshield');
    expect(climateModule.mode).toBe('RESEARCH');
    const html = renderToStaticMarkup(createElement(climateModule.Page));
    expect(html).toContain('RESEARCH');
    expect(html).toContain('Leakage audit');
    expect(html).toContain('Missing values per field');
  });
});
