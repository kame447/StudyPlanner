// The production Worker, unchanged, for the isolated E2E target (#947). Only its outbound requests are
// redirected (see emulatorFetch.mjs): Firebase Auth and Firestore to the local emulators, Google's OAuth
// token exchange to the emulator's admin token, and AI providers to the local synthetic provider.
import worker, {
  AiQuotaDurableObject,
  WeeklyPlanningTurnDurableObject,
} from '../../../../workers/ai-proxy/src/traceWorker.ts';
import { installEmulatorFetch } from './emulatorFetch.mjs';

export { AiQuotaDurableObject, WeeklyPlanningTurnDurableObject };
installEmulatorFetch('synthetic');

export default worker;
