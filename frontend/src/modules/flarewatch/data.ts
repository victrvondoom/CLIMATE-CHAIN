// Fixture loading for the flarewatch module. Day files are imported as raw text, so the
// SHA-256 is taken over the exact bytes that were anchored, not over a re-serialised copy.
import day2026_10_15 from './fixtures/day-2026-10-15.json?raw';
import day2026_10_16 from './fixtures/day-2026-10-16.json?raw';
import day2026_10_17 from './fixtures/day-2026-10-17.json?raw';
import day2026_10_18 from './fixtures/day-2026-10-18.json?raw';
import day2026_10_19 from './fixtures/day-2026-10-19.json?raw';
import day2026_10_20 from './fixtures/day-2026-10-20.json?raw';
import indexJson from './fixtures/index.json';

export const DAY_FILES: { day: string; raw: string }[] = [
  { day: '2026-10-15', raw: day2026_10_15 },
  { day: '2026-10-16', raw: day2026_10_16 },
  { day: '2026-10-17', raw: day2026_10_17 },
  { day: '2026-10-18', raw: day2026_10_18 },
  { day: '2026-10-19', raw: day2026_10_19 },
  { day: '2026-10-20', raw: day2026_10_20 },
];

export const INDEX = indexJson;
