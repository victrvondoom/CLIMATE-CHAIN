// A small CSV reader for the browser, with no dependency. It follows what pandas.read_csv does for
// ClaimGuard (app/main.py): a header row, quoted fields with "" escapes, LF or CRLF line endings,
// blank lines skipped, short rows padded with missing values, rows longer than the header refused,
// and the default pandas spellings for missing values (NA, null, nan, empty, ...).

export const PARSE_ERROR_MESSAGE = 'Could not parse CSV. Check the file format and encoding.';
export const NO_COLUMNS_MESSAGE = 'CSV contains no readable columns.';

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

/** The cell texts pandas reads as missing by default. Matched exactly, with no trimming. */
export const NA_VALUES: ReadonlySet<string> = new Set([
  '',
  '#N/A',
  '#N/A N/A',
  '#NA',
  '-1.#IND',
  '-1.#QNAN',
  '-NaN',
  '-nan',
  '1.#IND',
  '1.#QNAN',
  '<NA>',
  'N/A',
  'NA',
  'NULL',
  'NaN',
  'None',
  'n/a',
  'nan',
  'null',
]);

export interface ParsedCsv {
  readonly header: string[];
  /** One entry per data row, the same width as the header. `null` is a missing value. */
  readonly rows: (string | null)[][];
}

/** Decodes the bytes as UTF-8, and refuses anything else rather than guessing. */
export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CsvParseError(PARSE_ERROR_MESSAGE);
  }
}

/** Splits text into records of raw fields. A line with no characters at all is skipped. */
function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let fieldQuoted = false;
  let inQuotes = false;
  let lineHasText = false;

  const endField = (): void => {
    fields.push(field);
    field = '';
    fieldQuoted = false;
  };
  const endRecord = (): void => {
    endField();
    if (lineHasText) records.push(fields);
    fields = [];
    lineHasText = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '' && !fieldQuoted) {
      inQuotes = true;
      fieldQuoted = true;
      lineHasText = true;
      continue;
    }
    if (ch === ',') {
      lineHasText = true;
      endField();
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
      endRecord();
      continue;
    }
    lineHasText = true;
    field += ch;
  }

  if (inQuotes) throw new CsvParseError(PARSE_ERROR_MESSAGE);
  if (lineHasText) endRecord();
  return records;
}

/** Reads a CSV text. Throws a CsvParseError for an empty file, an unclosed quote or a long row. */
export function parseCsv(text: string): ParsedCsv {
  const records = splitRecords(text);
  if (records.length === 0) throw new CsvParseError(NO_COLUMNS_MESSAGE);
  const [header, ...body] = records;
  const width = header.length;
  const rows = body.map((fields) => {
    if (fields.length > width) throw new CsvParseError(PARSE_ERROR_MESSAGE);
    const padded = [...fields];
    while (padded.length < width) padded.push('');
    return padded.map((cell) => (NA_VALUES.has(cell) ? null : cell));
  });
  return { header, rows };
}
