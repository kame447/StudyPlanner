// The production Worker, unchanged, for the explicit real-API workflow (#926): the same emulators for auth and
// storage as the isolated target, but the model is the real OpenAI API, the only provider host allowed.
import worker, {
  AiQuotaDurableObject,
  WeeklyPlanningTurnDurableObject,
} from '../../../../workers/ai-proxy/src/traceWorker.ts';
import { installEmulatorFetch } from './emulatorFetch.mjs';

export { AiQuotaDurableObject, WeeklyPlanningTurnDurableObject };
installEmulatorFetch('real-openai');

export default worker;
