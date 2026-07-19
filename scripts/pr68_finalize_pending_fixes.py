from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f'pattern not found in {path}: {old[:160]!r}')
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
    expect(sixth.message).toContain('必要時間: 21時間');
""",
)

replace_once(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts',
    "    expect(state.missing).toEqual(['unit_duration_estimate']);\n",
    "    expect(state.missing).toEqual(['year_range', 'unit_duration_estimate']);\n",
)

replace_once(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningObservedConversationRegression.test.ts',
    r"""    const third = runTurn(second.state, '3時間ぐらいです\n予定は特にないです');
    const fourth = runTurn(third.state, '分野はOSとネットワークだけです');
""",
    """    const withYearRange = runTurn(second.state, '対象年度は2025〜2019です');
    const fourth = runTurn(withYearRange.state, '分野はOSとネットワークだけです');
""",
)
replace_once(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningObservedConversationRegression.test.ts',
    "      previousState: third.state,\n",
    "      previousState: withYearRange.state,\n",
)
replace_once(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningObservedConversationRegression.test.ts',
    "    expect(message).toContain('進める順番だけ確認します');\n",
    "    expect(message).toContain('目安時間だけ確認します');\n",
)

replace_once(
    'docs/ai/tasks/20260719-weekly-planning-rules-end-to-end-integration-test.md',
    '3. 候補の日付・時間・タイトル・field・metadata が preview 変換後も保持される。\n',
    '3. 候補の日付・時間・タイトル・field が昇格後 block へ保持され、保存時に provenance が付与される。\n',
)
