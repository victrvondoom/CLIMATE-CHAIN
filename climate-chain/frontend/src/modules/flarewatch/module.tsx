import type { ClimateModule } from '../../core/module';
import Page from './Page';
import './module.css';

const climateModule: ClimateModule = {
  id: 'flarewatch',
  name: 'Flarewatch',
  tagline: 'Research: gas flares seen each night by NASA VIIRS, with every night’s file checked against its anchored SHA-256.',
  stages: ['sense', 'verify', 'prove'],
  tone: 'methane',
  mode: 'RESEARCH',
  features: [
    'Six nights of NASA FIRMS VIIRS night detections, 15 to 20 Oct 2026 (measured, from the project day files)',
    'Write-once SHA-256 of each night, re-checked in the browser against its anchored digest',
    'Site clustering at 1.0 km and the persistent-flare rule: 3 or more nights within 7 days',
    'Verification records written to the evidence ledger in this browser',
  ],
  source: {
    folder: 'flarewatch-main',
    files: [
      'METHOD.md',
      'pipeline/derive.mjs',
      'pipeline/common.mjs',
      'pipeline/anchor.mjs',
      'web/app.js',
      'web/data/index.json',
      'web/data/days/2026-10-15.json',
      'web/data/days/2026-10-16.json',
      'web/data/days/2026-10-17.json',
      'web/data/days/2026-10-18.json',
      'web/data/days/2026-10-19.json',
      'web/data/days/2026-10-20.json',
    ],
  },
  Page,
};

export default climateModule;
