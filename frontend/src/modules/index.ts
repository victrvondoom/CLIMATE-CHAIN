import type { ClimateModule } from '../core/module';
import junksnap from './junksnap/module';
import clearsky from './clearsky/module';
import teesri from './teesri/module';
import vayu from './vayu/module';
import aquaquest from './aquaquest/module';
import climateproof from './climateproof/module';
import carbonlens from './carbonlens/module';
import carbonshield from './carbonshield/module';
import carbontwin from './carbontwin/module';
import hourmatch from './hourmatch/module';
import plotlock from './plotlock/module';
import rantai from './rantai/module';

// The native module list the shell renders, in mission-stage order.
// Only the integrator edits this file: one import per module, then one entry here.
export const CLIMATE_MODULES: ClimateModule[] = [
  junksnap,
  clearsky,
  teesri,
  vayu,
  aquaquest,
  climateproof,
  carbonlens,
  carbonshield,
  carbontwin,
  hourmatch,
  plotlock,
  rantai,
];
