from pathlib import Path
p=Path('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts')
s=p.read_text()
start=s.index('const AI_OWNERSHIP_INSTRUCTION_V5 = [')
end=s.index('\n\ninterface SemanticValidationAttemptV5', start)
new="""const AI_OWNERSHIP_INSTRUCTION_V5 = [
  'AI alone interprets meaning; publicStateSummary.pendingQuestion is authoritative.',
  'Return a minimal delta grounded in current userText; accepted state/recentConversation are context only, and every sourceText must come from current userText.',
  'For a pending clarification, resolve only its exact target; if unresolved, emit uncertainty. For work_breakdown return only that existingPublicId task with its current structure, not unrelated accepted state or the old uncertainty.',
  'Quantity roles: target=planned amount, remaining=unfinished amount, completed=done amount. A resolved quantity-role answer returns only the needed local task/workload delta.',
  'Use localIds for references inside the response and exact existingPublicId only for accepted cross-turn task/component identity.',
  'Creation authorization uses planningIntent create_plan without replaying accepted facts.',
  'Do not invent or emit application commands, scheduling/readiness/preview/save decisions, or prose.',
].join('\\n');
const TEMPORAL_STRUCTURE_INSTRUCTION_V5 = [
  'Non-consecutive explicit dates use separate allowed_date constraints.',
  'Any explicit recurring cadence in workload.periodExpression needs a matching recurrence; explicit weekdays belong in one weekly recurrence with its stated days.',
  'Task relations use task localIds and require explicit scheduling relation meaning; workload amount/size comparisons alone are not priority/order/dependency.',
  'Clock fields require explicit user clocks. Use either namedTimePeriod or exact clock fields, not both.',
].join('\\n');
"""
p.write_text(s[:start]+new+s[end:])
