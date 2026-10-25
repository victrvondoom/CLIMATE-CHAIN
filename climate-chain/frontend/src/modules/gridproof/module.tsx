import type { ClimateModule } from '../../core/module';
import Page from './Page';
import './module.css';

const climateModule: ClimateModule = {
  id: 'gridproof',
  name: 'WattCert',
  tagline: 'Demo: clean energy certificates per device-hour, minted only when the meter output passes a weather check.',
  stages: ['verify', 'finance', 'prove'],
  tone: 'energy',
  mode: 'DEMO',
  features: [
    'Hourly meter readings for four solar and wind devices over 48 hours (synthetic DEMO series)',
    'Plausibility check against weather and rated capacity: night output, over-reporting and replayed peaks, quarantine at 70 percent',
    'One certificate per device-hour: the token id is the device and the hour, and a second mint is refused',
    'Retirement by hour: certificates match only the hour they were issued for, capped at 100 percent',
  ],
  source: {
    folder: 'gridproof-main',
    files: [
      'oracle/gridproof/physics.py',
      'oracle/gridproof/integrity.py',
      'oracle/gridproof/simulator.py',
      'oracle/gridproof/pipeline.py',
      'contracts/contracts/GranularCertificate.sol',
    ],
  },
  Page,
};

export default climateModule;
