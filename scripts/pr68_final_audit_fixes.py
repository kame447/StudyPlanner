from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f'pattern not found in {path}: {old[:180]!r}')
    target.write_text(text.replace(old, new, 1))


replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts',
    "  if (/今日/.test(sourceText) || state.range?.calendarDayCount === 1) return '今日';\n",
    "  if (/今日/.test(sourceText)) return '今日';\n",
)

question_test = Path('src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.test.ts')
text = question_test.read_text()
anchor = """  it('uses controlled vocabulary for target years and exam unit-rate questions', () => {
"""
addition = """  it('does not label an explicit future one-day range as today', () => {
    const state: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      range: {
        startDateTime: '2026-07-25T00:00:00',
        endDateTime: '2026-07-25T24:00:00',
        sourceText: '7月25日',
        calendarDayCount: 1,
        confidence: 'explicit',
      },
      missing: ['priority_policy'],
    };

    expect(deterministicQuestionsForState(state)).toEqual([
      'この期間で優先する分野や進める順番を教えてください。',
    ]);
  });

"""
if anchor not in text:
    raise RuntimeError('question slot test insertion point was not found')
question_test.write_text(text.replace(anchor, addition + anchor, 1))

replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
    "const MODEL_INSTRUCTION_PATTERN = /(?:system\\s*prompt|developer\\s*message|ignore\\s+(?:all|previous)|システムプロンプト|開発者メッセージ|前の指示|これまでの指示|指示を無視|命令を無視|candidates?|command|json).{0,100}(?:出力|返して|生成|emit|return)|(?:candidates?|command|json).{0,100}(?:出力|返して|生成)/i;\n",
    "const MODEL_INSTRUCTION_PATTERN = /(?:system\\s*prompt|developer\\s*message|ignore\\s+(?:all|previous)(?:\\s+instructions?)?|システムプロンプト|開発者メッセージ|前の指示|これまでの指示|指示を無視|命令を無視).{0,160}(?:出力|返して|生成|emit|return)/i;\n",
)

replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
    """    case 'set_exam_scope': {
      const hasField = command.scope.fields.some((field) =>
        normalizedEvidence(normalized).includes(normalizedEvidence(field))
        || approximatelyContains(normalized, field));
      return hasField || /院試|過去問|20\\d{2}/.test(normalized)
        ? null : 'ungrounded-exam-scope';
    }
""",
    """    case 'set_exam_scope': {
      const normalizedUser = normalizedEvidence(normalized);
      const knownFields = new Set(summary.knownFields.map(normalizedEvidence));
      const fieldsGrounded = command.scope.fields.every((field) => {
        const normalizedField = normalizedEvidence(field);
        return knownFields.has(normalizedField)
          || normalizedUser.includes(normalizedField)
          || approximatelyContains(normalized, field);
      });
      const range = command.scope.yearRange;
      const yearRangeGrounded = !range
        || (normalizedUser.includes(String(range.startYear))
          && normalizedUser.includes(String(range.endYear)));
      return fieldsGrounded && yearRangeGrounded
        ? null : 'ungrounded-exam-scope';
    }
""",
)

adversarial_test = Path('src/features/weeklyPlanning/__tests__/weeklyPlanningAdversarialInput.test.ts')
text = adversarial_test.read_text()
anchor = """  it('rejects renderer text that preserves the slot key but changes the meaning', () => {
"""
addition = """  it('allows ordinary study goals about generating JSON', () => {
    const userText = 'JSONを生成する課題を勉強したいです';
    const result = validateInterpretedCandidates([{
      command: {
        type: 'set_study_goal',
        goal: { title: 'JSONを生成する課題' },
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
      expect.objectContaining({ type: 'set_study_goal' }),
    ]);
    expect(result.rejected).toEqual([]);
  });

  it('rejects an exam field invented from a generic entrance-exam request', () => {
    const userText = '院試の勉強計画を立てたいです';
    const result = validateInterpretedCandidates([{
      command: {
        type: 'set_exam_scope',
        scope: {
          examType: '院試',
          fields: ['OS'],
          unitModel: 'year_field_chunk',
          rawText: [userText],
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

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'ungrounded-exam-scope' }),
    ]);
  });

"""
if anchor not in text:
    raise RuntimeError('adversarial test insertion point was not found')
adversarial_test.write_text(text.replace(anchor, addition + anchor, 1))
