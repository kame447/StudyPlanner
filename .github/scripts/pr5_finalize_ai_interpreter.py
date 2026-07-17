from pathlib import Path
import re

core_path = Path(
    'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreterCore.ts'
)
public_path = Path(
    'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts'
)

if not core_path.exists():
    raise SystemExit(0)

text = core_path.read_text()

old_import = (
    "import type { OpenAiCompatibleClient } "
    "from '../../../lib/openaiCompatibleClient';"
)
new_import = (
    "import type { JsonSchemaResponseFormat, OpenAiCompatibleClient } "
    "from '../../../lib/openaiCompatibleClient';"
)
if text.count(old_import) != 1:
    raise RuntimeError(f'AI client import count: {text.count(old_import)}')
text = text.replace(old_import, new_import)

response_pattern = re.compile(
    r"export const WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT = \{.*?\n\};\n\nfunction isRecord",
    re.S,
)
response_replacement = """export const WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_interpreted_commands',
    strict: false,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['candidates'],
      properties: {
        candidates: {
          type: 'array',
          items: {
            anyOf: WEEKLY_PLANNING_COMMAND_SCHEMAS,
          },
        },
        assumptionProposalDrafts: {
          type: 'array',
          items: ASSUMPTION_PROPOSAL_DRAFT_SCHEMA,
        },
      },
    },
  },
};

function isRecord"""
text, count = response_pattern.subn(response_replacement, text, count=1)
if count != 1:
    raise RuntimeError(f'AI response format replacement count: {count}')

old_relative = (
    '- Resolve relative dates such as today, tomorrow, the day after tomorrow, '
    'and next week from context.currentDateTime. Emit ISO YYYY-MM-DD or '
    'YYYY-MM-DDTHH:mm:ss values only when the resolution is certain.'
)
new_relative = (
    '- Resolve today, tomorrow, and the day after tomorrow from '
    'context.currentDateTime. Resolve a planning next_week window from '
    'context.selectedDate so deterministic and AI paths use the same selected '
    'week. Emit ISO values only when the resolution is certain.'
)
if text.count(old_relative) != 1:
    raise RuntimeError(f'AI relative prompt count: {text.count(old_relative)}')
text = text.replace(old_relative, new_relative)

promotion_line = (
    "    '- Emit set_planning_range only when both pending.planningStartDate "
    "and pending.durationDays are known and the selected start date satisfies "
    "the pending window. Never persist a fully resolved pending object.',"
)
extra_line = (
    "    '- Never substitute an inferred set_planning_range for an unresolved "
    "pending range.',"
)
if text.count(promotion_line) != 1:
    raise RuntimeError(
        f'AI promotion prompt count: {text.count(promotion_line)}'
    )
text = text.replace(promotion_line, promotion_line + '\n' + extra_line)

public_path.write_text(text)
core_path.unlink()
