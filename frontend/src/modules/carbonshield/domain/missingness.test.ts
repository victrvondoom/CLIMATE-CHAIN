import { describe, expect, it } from 'vitest';
import data from '../fixtures/benchmark_projects.json';
import { missingByField, missingByProject } from './missingness';

const rows = data.rows;

describe('missingness rules over the benchmark table', () => {
  it('counts the rows in the benchmark (44 eligible projects)', () => {
    expect(rows).toHaveLength(44);
  });

  it('counts blank cells per field, matching a csv-module count of the source', () => {
    const counts = Object.fromEntries(
      missingByField(rows)
        .filter((f) => f.missing > 0)
        .map((f) => [f.field, f.missing]),
    );
    expect(counts).toEqual({
      certified_baseline_deforestation_ha: 4,
      certified_project_deforestation_ha: 4,
      certified_deforestation_emissions_tco2e: 3,
    });
  });

  it('reports the percentage of records missing for each field', () => {
    const emissions = missingByField(rows).find((f) => f.field === 'certified_deforestation_emissions_tco2e');
    expect(emissions?.total).toBe(44);
    expect(emissions?.pct).toBeCloseTo(3 / 44, 10);
  });

  it('lists the missing fields for each project that has one, without filling them', () => {
    const projects = missingByProject(rows);
    expect(projects).toHaveLength(7);
    expect(projects).toContainEqual({
      project_id: '934',
      missing: ['certified_baseline_deforestation_ha', 'certified_project_deforestation_ha'],
    });
    expect(projects).toContainEqual({ project_id: '856', missing: ['certified_deforestation_emissions_tco2e'] });
    // The source table still holds null where the CSV was blank: nothing is imputed.
    expect(rows.find((r) => r.project_id === '856')?.certified_deforestation_emissions_tco2e).toBeNull();
  });

  it('treats a whitespace-only cell as missing', () => {
    const fields = missingByField([{ a: '  ', b: '1' }, { a: 'x', b: null }]);
    expect(fields.find((f) => f.field === 'a')?.missing).toBe(1);
    expect(fields.find((f) => f.field === 'b')?.missing).toBe(1);
  });
});
