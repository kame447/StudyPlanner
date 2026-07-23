/**
 * Node版Vitest向けの最小stub。
 * 本番WorkerではWranglerがcloudflare:workersを解決するため、このfileは使用されない。
 */
export class DurableObject<Env = unknown> {
  protected readonly ctx: any;
  protected readonly env: Env;

  constructor(ctx: any, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
