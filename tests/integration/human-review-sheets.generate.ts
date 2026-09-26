import { it } from 'vitest';
import { generateEmptyReviewSheets } from '../../workers/ai-proxy/src/decision/evaluation/judge/humanReviewSheetGeneration';

// No network and no credentials: writes blind A/B sheets, the opaque mapping and
// the adjudication sheet under GEMINI_JUDGE_OUTPUT_DIR (default: gitignored artifacts/).
it('writes the human review sheets without declaring gold', async () => {
  await generateEmptyReviewSheets();
});
