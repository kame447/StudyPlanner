import { UserFacingError } from './userFacingError';

/** A planner mutation whose owner/scope changed while it ran; the write itself may still have committed. */
export class PlannerMutationScopeExpiredError extends UserFacingError {
  constructor() {
    super('操作中にアカウントまたはデータが切り替わりました。現在の画面を確認してください。');
    this.name = 'PlannerMutationScopeExpiredError';
  }
}
