import { describe, expect, it } from 'vitest';
import { parseBenchmark } from './import';
import { missingByProject } from './missingness';

describe('benchmark intake', () => {
  it('normalizes numbers and counts absent columns as missing without imputing them', () => {
    const rows = parseBenchmark({ rows: [{ project_id: 1, country: 'India' }, { project_id: '2', stock: 15 }] });
    expect(rows).toEqual([{ project_id: '1', country: 'India', stock: null }, { project_id: '2', country: null, stock: '15' }]);
    expect(missingByProject(rows)).toEqual([{ project_id: '1', missing: ['stock'] }, { project_id: '2', missing: ['country'] }]);
  });
  it('refuses duplicate identifiers, nested cells and empty or oversized sets', () => {
    expect(() => parseBenchmark([{ project_id: 'a' }, { project_id: ' a ' }])).toThrow('unique project_id');
    expect(() => parseBenchmark([{ project_id: 'a', nested: {} }])).toThrow('use text');
    expect(() => parseBenchmark([])).toThrow('between 1');
    expect(() => parseBenchmark(Array(5001).fill({ project_id: 'a' }))).toThrow('5,000');
  });
});
