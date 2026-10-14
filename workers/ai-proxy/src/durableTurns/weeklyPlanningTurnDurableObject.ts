import { DurableObject } from 'cloudflare:workers';
import { DurableTurnJob, DurableTurnConflict, type DurableTurnInput, type DurableTurnIdentity } from './durableTurnJob';
import { createDurableTurnStorage } from './durableTurnStorage';
import { executeIsolatedWeeklyPlanningTurn, type IsolatedWeeklyPlanningTurnInput } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningIsolatedTurn';
import { createDurableTurnProvider } from './durableTurnProvider';
import type { AiProxyWorkerEnv } from '../worker';

/** No external route calls these RPCs before Firebase authentication and owner-bound naming. */
export class WeeklyPlanningTurnDurableObject extends DurableObject<AiProxyWorkerEnv> {
  private readonly job = new DurableTurnJob(createDurableTurnStorage(this.ctx.storage));
  async accept(input: DurableTurnInput) {
    try { return { accepted: true as const, value: await this.job.accept(input) }; }
    catch (error) {
      if (error instanceof DurableTurnConflict) return { accepted: false as const, error: error.code };
      throw error;
    }
  }
  cancel(identity: DurableTurnIdentity) { return this.job.cancel(identity); }
  status(scope: Pick<DurableTurnIdentity, 'ownerId' | 'conversationId' | 'requestId'>) { return this.job.status(scope); }
  async alarm(): Promise<void> {
    await this.job.run(async (payload, dispatch, sourceIp, deadlineAt) => {
      const parsed = JSON.parse(payload) as IsolatedWeeklyPlanningTurnInput;
      const result = await executeIsolatedWeeklyPlanningTurn(parsed,
        createDurableTurnProvider(this.env, parsed.input.userId, dispatch, sourceIp, deadlineAt));
      return JSON.stringify(result);
    });
  }
}
