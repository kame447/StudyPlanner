import { it } from 'vitest';
import { FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES } from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationExpansionCandidates';
import { adaptExpansionReviewCandidates } from '../../workers/ai-proxy/src/decision/evaluation/judge/humanReviewSheet';
import { generateEmptyReviewSheets } from '../../workers/ai-proxy/src/decision/evaluation/judge/humanReviewSheetGeneration';

// No network and no credentials: covers the PR #332 synthetic set plus the unlabeled
// #333 expansion set, and writes blind A/B sheets, the opaque mapping and
// the adjudication sheet under GEMINI_AGENT_JUDGE_OUTPUT_DIR (default: gitignored artifacts/).
it('writes the human review sheets without declaring gold', async () => {
  await generateEmptyReviewSheets(adaptExpansionReviewCandidates(FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES));
});
