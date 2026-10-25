import { describe, expect, it } from 'vitest';
import { CsvParseError, decodeUtf8, parseCsv } from './csv';

// The reading rules come from pandas.read_csv as used by ClaimGuard app/main.py: header row,
// default NA spellings, blank lines skipped, short rows padded with missing values, long rows refused.

describe('parseCsv', () => {
  it('reads a header and the rows under it', () => {
    expect(parseCsv('a,b\n1,2\n3,4\n')).toEqual({
      header: ['a', 'b'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    });
  });

  it('accepts CRLF line endings and skips blank lines, as pandas does', () => {
    const parsed = parseCsv('a,b\r\n1,2\r\n\r\n3,4\r\n');
    expect(parsed.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps commas and line breaks inside quotes, and reads doubled quotes', () => {
    const parsed = parseCsv('a,b\n"x, y","say ""hi"""\n"two\nlines",z\n');
    expect(parsed.rows).toEqual([
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });

  it('pads a short row with missing values', () => {
    expect(parseCsv('a,b,c\n1,2\n').rows).toEqual([['1', '2', null]]);
  });

  it('refuses a row with more fields than the header', () => {
    expect(() => parseCsv('a,b\n1,2,3\n')).toThrow(CsvParseError);
  });

  it('reads the spellings pandas treats as missing (NA, null, empty) as missing', () => {
    expect(parseCsv('a,b\nNA,null\n,x\n').rows).toEqual([
      [null, null],
      [null, 'x'],
    ]);
  });

  it('keeps a cell of spaces as text; the analysis decides it is blank', () => {
    expect(parseCsv('a,b\n   ,2\n').rows).toEqual([['   ', '2']]);
  });

  it('refuses an empty file with no columns', () => {
    expect(() => parseCsv('')).toThrow(/no readable columns/);
    expect(() => parseCsv('\n\n')).toThrow(/no readable columns/);
  });

  it('refuses a quoted field that never closes', () => {
    expect(() => parseCsv('a\n"open')).toThrow(CsvParseError);
  });
});

describe('decodeUtf8', () => {
  it('decodes UTF-8 text', () => {
    expect(decodeUtf8(new TextEncoder().encode('hi,there'))).toBe('hi,there');
  });

  it('refuses bytes that are not UTF-8, rather than guessing', () => {
    expect(() => decodeUtf8(new Uint8Array([0xff, 0xfe, 0xfa, 0xfb]))).toThrow(CsvParseError);
  });
});
