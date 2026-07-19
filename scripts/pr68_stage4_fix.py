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
