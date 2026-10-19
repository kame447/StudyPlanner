import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import type { StepExecutor } from 'e2e';

const execFileAsync = promisify(execFile);
const decisionSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['type', 'tap', 'complete'] },
    id: { type: 'string' },
    value: { type: 'string' },
    status: { type: 'string', enum: ['passed', 'failed'] },
    summary: { type: 'string' },
  },
  required: ['action', 'id', 'value', 'status', 'summary'],
  additionalProperties: false,
} as const;

type Decision = {
  action: 'type' | 'tap' | 'complete';
  id: string;
  value: string;
  status: 'passed' | 'failed';
  summary: string;
};

async function decide(
  goal: string,
  screen: string,
  history: readonly string[],
  signal: AbortSignal,
  remainingMs: number,
): Promise<Decision> {
  const prompt = [
    'You operate a synthetic Japanese planning UI for a browser test.',
    'Choose ONE next action using only the current screen node ids.',
    'The test harness, not you, performs the chosen action and independently checks the result.',
    'Use type for an editable field and tap for a button. Never submit or approve twice.',
    'Do not mark complete merely because text was entered; ensure the requested outcome is visible.',
    'Never approve or save a plan unless the goal explicitly requests it.',
    'When the goal is achieved, choose complete with status passed; if impossible, status failed.',
    `GOAL:\n${goal}`,
    `PREVIOUS ACTIONS:\n${history.join('\n') || '(none)'}`,
    `CURRENT SCREEN:\n${screen.slice(0, 12000)}`,
  ].join('\n\n');

  const { stdout } = await execFileAsync(
    'claude',
    [
      '--print', prompt, '--model',
      process.env.LAPLANCE_AGENT_E2E_CLAUDE_MODEL?.trim() || 'haiku',
      '--tools', '', '--max-turns', '1', '--no-session-persistence',
      '--output-format', 'json', '--json-schema', JSON.stringify(decisionSchema),
    ],
    { cwd: tmpdir(), signal, timeout: Math.min(30000, remainingMs), maxBuffer: 512 * 1024 },
  );
  const envelope = JSON.parse(stdout);
  if (envelope.is_error || !envelope.structured_output) {
    throw new Error('Claude CLI returned no structured decision');
  }
  return envelope.structured_output as Decision;
}

export const claudeCliExecutor: StepExecutor = {
  name: 'claude-cli-local-browser',
  version: '1',
  cache: 'off',
  async runStep(ctx) {
    if (ctx.step.kind !== 'act') {
      return {
        status: 'blocked',
        errorCode: 'AUTOMATION_UNSUPPORTED',
        summary: 'Claude CLI executor is reserved for agent.act; use deterministic expect for checks.',
      };
    }

    const history: string[] = [];
    for (let n = 0; n < Math.min(8, ctx.budgets.maxModelCalls); n += 1) {
      const screen = (await ctx.observe()).text;
      let choice: Decision;
      const startedAt = Date.now();
      try {
        choice = await decide(ctx.step.instruction, screen, history, ctx.signal, ctx.budgets.remainingMs());
      } catch {
        return {
          status: 'blocked',
          errorCode: 'ENVIRONMENT_UNAVAILABLE',
          summary: 'Local Claude CLI decision failed. Check the authenticated CLI session and model availability.',
        };
      }
      ctx.budgets.recordModelCall({
        provider: 'claude-cli',
        modelId: process.env.LAPLANCE_AGENT_E2E_CLAUDE_MODEL?.trim() || 'haiku',
        durationMs: Date.now() - startedAt,
      });

      if (choice.action === 'complete') {
        const currentScreen = (await ctx.observe()).text;
        if (currentScreen !== screen) {
          history.push('Screen changed while the model was deciding; re-evaluate before concluding.');
          continue;
        }
        return { status: choice.status, summary: choice.summary || 'Model concluded browser operation' };
      }
      const id = choice.id.replace(/^#/, '');
      if (!/^n\d+$/.test(id) || !screen.includes(`#${id} `)) {
        history.push(`invalid node id: ${id}`);
        continue;
      }
      try {
        if (choice.action === 'type') await ctx.actions.type({ id }, choice.value);
        else if (choice.action === 'tap') await ctx.actions.tap({ id });
        else throw new Error('Unsupported action');
      } catch {
        history.push(`action ${choice.action} on #${id} failed; choose another visible node`);
        continue;
      }
      history.push(`${choice.action} #${id}: ${choice.summary}`);
    }
    return {
      status: 'blocked',
      errorCode: 'AUTOMATION_UNSUPPORTED',
      summary: 'Local Claude CLI exhausted its bounded action cycle without a verified completion.',
    };
  },
};
