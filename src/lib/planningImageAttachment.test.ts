import { describe, expect, it } from 'vitest';
import {
  buildPlanningImageAttachmentEndpoint,
  MAX_PLANNING_IMAGE_CONTEXT_LENGTH,
  normalizePlanningImageAttachmentResult,
} from './planningImageAttachment';

describe('planning image attachment helpers', () => {
  it('builds the planning attachment endpoint from supported proxy URLs', () => {
    expect(
      buildPlanningImageAttachmentEndpoint('https://example.test/chat/completions'),
    ).toBe('https://example.test/planning-attachment');
    expect(
      buildPlanningImageAttachmentEndpoint('https://example.test/timetable-ocr'),
    ).toBe('https://example.test/planning-attachment');
    expect(
      buildPlanningImageAttachmentEndpoint('https://example.test/planning-attachment'),
    ).toBe('https://example.test/planning-attachment');
  });

  it('trims and caps extracted context', () => {
    const normalized = normalizePlanningImageAttachmentResult({
      text: `  ${'a'.repeat(MAX_PLANNING_IMAGE_CONTEXT_LENGTH + 50)}  `,
    });

    expect(normalized.text).toHaveLength(MAX_PLANNING_IMAGE_CONTEXT_LENGTH);
  });

  it('returns empty text for an invalid worker result', () => {
    expect(normalizePlanningImageAttachmentResult({ result: 'invalid' })).toEqual({
      text: '',
    });
  });
});
