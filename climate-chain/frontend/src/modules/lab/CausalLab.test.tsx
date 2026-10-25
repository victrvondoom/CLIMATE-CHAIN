import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CausalLab } from './CausalLab';

describe('CausalLab component', () => {
  const html = renderToStaticMarkup(createElement(CausalLab, { onNavigate: () => undefined }));

  it('renders every section with labelled, accessible controls', () => {
    for (const title of ['Scenario builder', 'Two-way causal map', 'Molecules behind the warming', 'Sun–Earth distance', 'El Niño and the warming trend', 'What is happening now', 'Transparency ledger in 3D']) {
      expect(html).toContain(title);
    }
    expect(html).toContain('Speak to the platform');
    expect(html).toContain('type="range"');
  });

  it('shows both causal directions and labels scenario output as simulated', () => {
    expect(html).toContain('What people do to the climate');
    expect(html).toContain('What the climate does to daily life');
    expect(html).toContain('SIMULATED');
  });

  it('does not claim live data before any source has answered', () => {
    expect(html).not.toContain('>LIVE<');
    expect(html).toMatch(/LOADING|UNAVAILABLE/);
  });
});
