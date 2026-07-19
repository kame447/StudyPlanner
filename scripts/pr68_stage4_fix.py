from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f'pattern not found in {path}: {old[:140]!r}')
    target.write_text(text.replace(old, new, 1))


replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts',
    r"/(?:院試(?:の)?過去問|過去問)\s*[:：]?\s*(.+?)(?=(?:を)?(?:進め|やり|解き|勉強し|学習し)|$)/,",
    r"/(?:院試(?:の)?過去問|過去問)\s*[:：]?\s*(?:は|が|を)?\s*(.+?)(?=(?:を)?(?:進め|やり|解き|勉強し|学習し)|$)/,",
)
replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts',
    """      if (examPrepScope.totalYears && !examPrepScope.yearRange) {
        nextMissing = addMissing(nextMissing, ['year_range']);
      }
""",
    """      if (examPrepScope.unitModel === 'year_field_chunk' && !examPrepScope.yearRange) {
        nextMissing = addMissing(nextMissing, ['year_range']);
      }
""",
)

path = Path('src/features/weeklyPlanning/__tests__/weeklyPlanningAdversarialInput.test.ts')
text = path.read_text()
text = text.replace(
    "import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';\n",
    """import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import {
  applyWeeklyPlanningCommands,
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
""",
    1,
)
anchor = """  it('normalizes a closed set of unambiguous domain typos', () => {
    const command = parseSetExamScopeCommand('院試の過去問 ネトワークを進めたい', undefined);
    expect(command?.scope.fields).toEqual(['ネットワーク']);
  });

"""
addition = """  it('removes a particle after 過去問 and keeps year range blocking until supplied', () => {
    const command = parseSetExamScopeCommand('院試の過去問はOSを進めたいです', undefined);
    expect(command?.scope.fields).toEqual(['OS']);
    if (!command) throw new Error('exam scope fixture failed');

    const state = applyWeeklyPlanningCommands(
      createInitialPlanningIntakeState(),
      [command],
    );
    expect(state.missing).toContain('year_range');
  });

"""
if anchor not in text:
    raise RuntimeError('adversarial test insertion point was not found')
path.write_text(text.replace(anchor, anchor + addition, 1))

replace_once(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningControllerApprovalFlow.integration.test.ts',
    """      expect(draft.sourceId).toEqual(expect.objectContaining({ version: 1 }));
""",
    """      expect(typeof draft.sourceId).toBe('string');
      expect(draft.sourceId).toMatch(/^v1:/);
""",
)

replace_once(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningObservedConversation.integration.test.ts',
    """    const fourth = await submit('分野はOSとネットワークだけです');
    expect(fourth.message).toContain('進める順番だけ確認します');
    expect(fourth.message).not.toContain('睡眠時間や');
    expect(fourth.message.match(/？/g) ?? []).toHaveLength(1);
    expect(fourth.state.lastQuestionContext).toEqual(expect.objectContaining({
      kind: 'missing',
    }));
    expect(fourth.state.lastQuestionContext?.targetSlot).toBeTruthy();

    const fifth = await submit('違う！OSとネットワークで一科目です');
    expect(fifth.state.examPrepScope?.fields).toEqual(['OSとネットワーク']);
    expect(fifth.state.examPrepScope?.totalFields).toBe(1);
    expect(fifth.message).toContain('OSとネットワークを1科目');
""",
    """    const fourth = await submit('分野はOSとネットワークだけです');
    expect(fourth.message).toContain('対象年度は何年から何年までですか？');
    expect(fourth.message.match(/？/g) ?? []).toHaveLength(1);
    expect(fourth.state.lastQuestionContext).toEqual(expect.objectContaining({
      kind: 'missing',
      targetSlot: 'year_range',
    }));

    const fifth = await submit('対象年度は2025〜2019です');
    expect(fifth.state.examPrepScope?.yearRange).toEqual(expect.objectContaining({
      startYear: 2025,
      endYear: 2019,
    }));
    expect(fifth.message).toContain('条件が厳しく');
    expect(fifth.message).toContain('必要時間: 42時間');
    expect(fifth.message).toContain('分野の宣言順を仮の優先順として扱います。');

    const sixth = await submit('違う！OSとネットワークで一科目です');
    expect(sixth.state.examPrepScope?.fields).toEqual(['OSとネットワーク']);
    expect(sixth.state.examPrepScope?.totalFields).toBe(1);
    expect(sixth.message).toContain('OSとネットワークを1科目');
""",
)
