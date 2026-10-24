import type { Row } from './missingness';

export function parseBenchmark(value: unknown): Row[] {
  const rows = value && typeof value === 'object' && 'rows' in value ? value.rows : value;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 5000) throw new Error('Provide between 1 and 5,000 project rows as a JSON array or an object with rows.');
  const ids = new Set<string>();
  const parsed: Row[] = rows.map((row: unknown, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Row ${index + 1} must be an object.`);
    const result: Row = {};
    for (const [field, cell] of Object.entries(row)) {
      if (cell === null || typeof cell === 'string') result[field] = cell;
      else if (typeof cell === 'number' && Number.isFinite(cell)) result[field] = String(cell);
      else throw new Error(`Row ${index + 1}, ${field}: use text, a finite number, or null.`);
    }
    const id = result.project_id?.trim();
    if (!id || ids.has(id)) throw new Error(`Row ${index + 1} requires a unique project_id.`);
    ids.add(id);
    return { ...result, project_id: id };
  });
  const fields = [...new Set(parsed.flatMap(Object.keys))];
  return parsed.map((row) => Object.fromEntries(fields.map((field) => [field, row[field] ?? null])));
}
