from pathlib import Path
p=Path('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPipelineV5.ts')
s=p.read_text()
anchor="export interface WeeklyPlanningSemanticPipelineResultV5 {\n"
insert="export function shouldApplyWeeklyPlanningExistingEntityBindingsV5(params: { contextualAnswer: boolean; questionCode: string | null }): boolean {\n  return !params.contextualAnswer || params.questionCode === 'semantic_uncertainty';\n}\n\n"
if s.count(anchor)!=1: raise SystemExit('anchor mismatch')
s=s.replace(anchor,insert+anchor,1)
old="      const contextualDocumentNeedsEntityBinding = Boolean(\n        contextualAnswer && pendingQuestion?.questionCode === 'semantic_uncertainty',\n      );\n      const entityBindingApplication = !contextualAnswer || contextualDocumentNeedsEntityBinding\n"
new="      const entityBindingApplication = shouldApplyWeeklyPlanningExistingEntityBindingsV5({\n        contextualAnswer: Boolean(contextualAnswer),\n        questionCode: pendingQuestion?.questionCode ?? null,\n      })\n"
if s.count(old)!=1: raise SystemExit('policy block mismatch')
p.write_text(s.replace(old,new,1))
