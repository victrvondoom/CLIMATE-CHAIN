import type { ClimateModule } from '../../core/module';
import Page from './Page';
import './module.css';

const climateModule: ClimateModule = {
  id: 'plume',
  name: 'PLUME',
  tagline: 'Methane detections grouped into candidate sources, ranked for field investigation, then a simulated repair workflow.',
  stages: ['sense', 'verify', 'act', 'finance', 'prove'],
  tone: 'methane',
  mode: 'RESEARCH',
  features: [
    'DBSCAN grouping of Carbon Mapper methane detections (haversine, per sector, adjustable radius)',
    'Explainable priority-v1 ranking with each factor and its evidence',
    'Simulated repair workflow: lifecycle rule by role (no escrow contract, no EIP-712 signature)',
    'Public receipt for each simulated step, re-checkable by SHA-256',
  ],
  source: {
    folder: 'PLUME-main',
    files: [
      'backend/app/investigation/clustering.py',
      'backend/app/investigation/scoring.py',
      'backend/app/ingestion/pipeline.py',
      'backend/app/providers/carbonmapper.py',
      'backend/app/repair/state_machine.py',
      'backend/tests/fixtures/carbonmapper_sample.json',
    ],
  },
  Page,
};

export default climateModule;
