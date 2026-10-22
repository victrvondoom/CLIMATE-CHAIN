// Missing-data counts from docs/MISSING_DATA_REPORT.md. The policy is no imputation:
// a blank cell is counted and listed, and it is never filled.

export type Row = Record<string, string | null>;

export interface FieldMissing {
  field: string;
  missing: number;
  total: number;
  pct: number;
}

export interface ProjectMissing {
  project_id: string;
  missing: string[];
}

const isBlank = (value: string | null | undefined) => value === null || value === undefined || value.trim() === '';

export function missingByField(rows: readonly Row[]): FieldMissing[] {
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return fields.map((field) => {
    const missing = rows.filter((row) => isBlank(row[field])).length;
    return { field, missing, total: rows.length, pct: rows.length ? missing / rows.length : 0 };
  });
}

export function missingByProject(rows: readonly Row[], idField = 'project_id'): ProjectMissing[] {
  return rows.flatMap((row) => {
    const missing = Object.keys(row).filter((field) => field !== idField && isBlank(row[field]));
    return missing.length ? [{ project_id: String(row[idField]), missing }] : [];
  });
}
