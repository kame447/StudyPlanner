import { open, rename, writeFile, rm } from 'node:fs/promises';
import { startVNextJevRemote, type ProviderCallUsage } from './vnext-jev-remote';
import type { OpenAiCompatibleClient } from '../src/services/ai/openAiCompatibleClientTypes';
import { createWeeklyPlanningVNextProviderInterpreter } from '../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProvider';
import { createEmptyWeeklyPlanningVNextState } from '../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';

export async function runNamedPeriodReproduction(options: { outputPath: string; codeHead: string }) {
  const claim = await open(options.outputPath, 'wx', 0o600);
  await claim.close();
  const temporary = `${options.outputPath}.${process.pid}.partial`;
  const artifact = { codeHead: options.codeHead, syntheticOnly: true,
    userText: '今週はゼミ発表のスライドを仕上げたいです。全部で20枚で、もう12枚できています。',
    clock: { defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, currentDate: '2026-11-02', weekStartsOn: 'monday' as const, planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' },
    completed: false, physicalCalls: 0, runs: [] as unknown[] };
  const persist = async () => {
    await writeFile(temporary, JSON.stringify(artifact, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, options.outputPath);
  };
  await persist();
  const remote = await startVNextJevRemote({ worker: 'studyplanner-ai-proxy', ttlMs: 900_000 });
  try {
    for (let run = 1; run <= 10; run++) {
      const receipts: { request: unknown; rawResponseText?: string; transportFailure?: boolean; usage: ProviderCallUsage | null }[] = [];
      const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
        if (artifact.physicalCalls >= 20) throw new Error('Synthetic reproduction call budget exhausted.');
        artifact.physicalCalls++;
        const receipt: typeof receipts[number] = { request: structuredClone(request), usage: null };
        receipts.push(receipt);
        try {
          const raw = await remote.lunaClient.createChatCompletion(request);
          receipt.rawResponseText = raw;
          return raw;
        } catch { receipt.transportFailure = true; throw new Error('Synthetic reproduction transport failed.'); }
        finally { receipt.usage = remote.usage().luna.lastCall; }
      } };
      const state = createEmptyWeeklyPlanningVNextState();
      const result = await createWeeklyPlanningVNextProviderInterpreter()({ client, state, projection: projectWeeklyPlanningVNext(state),
        presentedQuestion: null, presentedText: null, userText: artifact.userText, clock: artifact.clock });
      const periods = receipts.map(receipt => {
        try {
          const raw = JSON.parse(receipt.rawResponseText ?? 'null');
          return Array.isArray(raw?.delta?.add) ? raw.delta.add.filter((fact: { kind?: string }) => fact.kind === 'temporal_constraint')
            .map((fact: { localId?: string; namedTimePeriod?: unknown; dateExpression?: unknown }) => ({
              localId: fact.localId, namedTimePeriod: fact.namedTimePeriod, dateExpression: fact.dateExpression,
            })) : [];
        } catch { return null; }
      });
      artifact.runs.push({ run, result, periods, receipts });
      await persist();
      console.info(JSON.stringify({ run, status: result.status, reason: result.status === 'failed' ? result.reason : null,
        errors: result.status === 'failed' ? result.errors : [], metrics: result.metrics, periods }));
    }
    artifact.completed = true;
    await persist();
    console.info(JSON.stringify({ completed: true, runs: artifact.runs.length, physicalCalls: artifact.physicalCalls, usage: remote.usage() }));
  } finally { await remote.stop(); await rm(temporary, { force: true }); }
}
