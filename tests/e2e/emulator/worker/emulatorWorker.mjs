// Production request handling and quota decisions for the isolated E2E target (#947), with quota
// rejection diagnostics. Outbound requests use the local emulators/synthetic provider (emulatorFetch.mjs).
import worker, {
  AiQuotaDurableObject as ProductionAiQuotaDurableObject,
  WeeklyPlanningTurnDurableObject,
} from '../../../../workers/ai-proxy/src/traceWorker.ts';
import { installEmulatorFetch } from './emulatorFetch.mjs';

export class AiQuotaDurableObject extends ProductionAiQuotaDurableObject {
  async checkAndConsume(request) {
    const result = await super.checkAndConsume(request);
    if (!result.allowed) {
      const rule = request.rules.find(rule => rule.name === result.exceededRule);
      // Local-only metadata correlates a missing provider call; no prompt, token or quota mutation.
      console.warn(`[E2E quota denied] ${JSON.stringify({ observedAt: Date.now(),
        quotaObject: this.ctx.id.name ?? this.ctx.id.toString(), exceededRule: result.exceededRule,
        limit: result.limit, remaining: result.remaining, windowId: rule?.windowId,
        resetAt: rule?.resetAt, retryAfterSeconds: result.retryAfterSeconds })}`);
    }
    return result;
  }
}
export { WeeklyPlanningTurnDurableObject };
installEmulatorFetch('synthetic');

export default worker;
