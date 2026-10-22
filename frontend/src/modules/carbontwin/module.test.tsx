import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import climateModule from './module';

describe('carbontwin module', () => {
  it('declares RESEARCH mode and shows that label and the Merkle section on its Page', () => {
    expect(climateModule.id).toBe('carbontwin');
    expect(climateModule.mode).toBe('RESEARCH');
    const html = renderToStaticMarkup(createElement(climateModule.Page));
    expect(html).toContain('RESEARCH');
    expect(html).toContain('Merkle-anchored findings');
    expect(html).toContain('matches');
  });
});
