import { describe, expect, it } from 'vitest';
import {
  composeUniqueDialogueMessage,
  stripGenericAcknowledgementPrefix,
} from './weeklyPlanningDialogueText';

describe('weeklyPlanningDialogueText', () => {
  it('removes a generic acknowledgement while preserving the substantive text', () => {
    expect(stripGenericAcknowledgementPrefix(
      '了解です。具体的に何をどこまで進めたいか教えてください。',
    )).toBe('具体的に何をどこまで進めたいか教えてください。');
  });

  it('removes acknowledgement-only lines', () => {
    expect(composeUniqueDialogueMessage([
      '了解です。',
      '具体的に何をどこまで進めたいか教えてください。',
    ])).toBe('具体的に何をどこまで進めたいか教えてください。');
  });

  it('keeps the first occurrence of an identical visible line', () => {
    expect(composeUniqueDialogueMessage([
      '対象分野を教えてください。',
      '対象分野を教えてください。',
    ])).toBe('対象分野を教えてください。');
  });
});
