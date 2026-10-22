import type { ClimateModule } from '../core/module';
import junksnap from './junksnap/module';
import clearsky from './clearsky/module';
import teesri from './teesri/module';

// The native module list the shell renders, in mission-stage order.
// Only the integrator edits this file: one import per module, then one entry here.
export const CLIMATE_MODULES: ClimateModule[] = [junksnap, clearsky, teesri];
