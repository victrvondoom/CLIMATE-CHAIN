import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { CLIMATE_MODULES } from './index';
import { ModuleScreen } from './ModuleScreen';

// React logs "Encountered two children with the same key" when siblings share a key. The module
// frame keys its page boundary and its evidence panel by module so each resets on a module
// change; those two keys must still differ from each other.
describe('ModuleScreen', () => {
  it('gives every keyed child of the module frame a distinct key, for every module', () => {
    for (const climateModule of CLIMATE_MODULES) {
      const frame = ModuleScreen({ climateModule }) as ReactElement<{ children: unknown[] }>;
      const keys = frame.props.children.filter(isValidElement).map((child) => child.key).filter((key) => key !== null);
      expect(keys.length, climateModule.id).toBeGreaterThan(1);
      expect(new Set(keys).size, `${climateModule.id} keys: ${keys.join(', ')}`).toBe(keys.length);
    }
  });
});
