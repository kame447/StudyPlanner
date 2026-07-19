from pathlib import Path


validator = Path('src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts')
text = validator.read_text()
old = """  return new RegExp(`${hour}\\s*時(?:\\s*${minute}\\s*分)?`).test(normalized)
    || new RegExp(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`).test(normalized);
"""
new = """  return new RegExp(`${hour}\\\\s*時(?:\\\\s*${minute}\\\\s*分)?`).test(normalized)
    || new RegExp(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`).test(normalized);
"""
if old not in text:
    raise RuntimeError('Japanese time grounding regexp target not found')
validator.write_text(text.replace(old, new, 1))


test = Path('src/features/weeklyPlanning/__tests__/weeklyPlanningAdversarialInput.test.ts')
text = test.read_text()
anchor = """  it.each([
"""
addition = """  it('accepts Japanese hour notation when it matches the structured life constraint', () => {
    const userText = '23時から7時まで寝ます';
    const result = validateInterpretedCandidates([{
      command: {
        type: 'update_life_constraint',
        kind: 'sleep',
        constraint: {
          start: '23:00',
          end: '07:00',
          hardness: 'hard',
        },
        sourceText: userText,
        confidence: 'high',
      },
      origin: 'ai_interpreter',
      needsConfirmation: false,
      sourceUserText: userText,
    }], {
      knownFields: [],
      confirmedSlots: [],
    });

    expect(result.accepted).toEqual([
      expect.objectContaining({ type: 'update_life_constraint', kind: 'sleep' }),
    ]);
    expect(result.rejected).toEqual([]);
  });

  it.each([
"""
if anchor not in text:
    raise RuntimeError('adversarial test insertion target not found')
test.write_text(text.replace(anchor, addition, 1))
