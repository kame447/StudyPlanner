import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES } from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationExpansionCandidates';
import { FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES } from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationSyntheticCandidates';
import {
  buildGeminiAgentJudgePacket,
  serializeGeminiAgentJudgeMapping,
  serializeGeminiAgentJudgePacket,
} from '../../workers/ai-proxy/src/decision/evaluation/judge/geminiAgentJudgePacket';
import {
  GEMINI_JUDGE_MAX_REPETITIONS,
  validateGeminiJudgeRepetitions,
} from '../../workers/ai-proxy/src/decision/evaluation/judge/geminiJudgeAggregation';
import {
  adaptExpansionReviewCandidates,
  adaptSyntheticReviewCandidates,
  combineReviewInputs,
} from '../../workers/ai-proxy/src/decision/evaluation/judge/humanReviewSheet';

const DEFAULT_OUTPUT_DIRECTORY = 'artifacts/issue333-gemini-agent';
const PACKET_SEED = 'issue333-gemini-agent-packet-v1';

function requestedRuns(): number {
  const raw = process.env.GEMINI_AGENT_JUDGE_RUNS?.trim();
  const runs = raw ? Number(raw) : GEMINI_JUDGE_MAX_REPETITIONS;
  validateGeminiJudgeRepetitions(runs);
  return runs;
}

it('writes blind Gemini agent packets and parent-only mappings without network access', async () => {
  const runs = requestedRuns();
  const outputDirectory = process.env.GEMINI_AGENT_JUDGE_OUTPUT_DIR?.trim()
    || DEFAULT_OUTPUT_DIRECTORY;
  const inputs = combineReviewInputs(
    adaptSyntheticReviewCandidates(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES),
    adaptExpansionReviewCandidates(FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES),
  );
  expect(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES).toHaveLength(51);
  expect(FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES).toHaveLength(80);
  expect(inputs).toHaveLength(131);

  await mkdir(path.join(outputDirectory, 'mappings'), { recursive: true });
  const packetIds = new Set<string>();
  for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
    const { packet, mapping } = await buildGeminiAgentJudgePacket(inputs, {
      runIndex,
      seed: PACKET_SEED,
    });
    packetIds.add(packet.packetId);
    const runDirectory = path.join(outputDirectory, `run-${runIndex}`);
    await mkdir(runDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(runDirectory, 'packet.json'),
        serializeGeminiAgentJudgePacket(packet),
        'utf8',
      ),
      writeFile(
        path.join(outputDirectory, 'mappings', `run-${runIndex}.json`),
        serializeGeminiAgentJudgeMapping(mapping),
        'utf8',
      ),
    ]);
  }
  expect(packetIds.size).toBe(runs);
  console.log(JSON.stringify({
    event: 'gemini_agent_judge_packets_written',
    outputDirectory,
    runs,
    caseCount: inputs.length,
    warning: 'Mappings are parent-only and must never be placed in an agent run directory.',
  }));
});
