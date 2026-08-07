from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, got {count}: {old[:80]}')
    p.write_text(text.replace(old, new, 1))

# 1) Semantic ownership: represent unknown decomposition without task-specific labels.
replace_once(
    'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticDocumentV5.ts',
    "    'Represent subjects, fields, materials, topics, chapters, sections, and skills as components. parentLocalId is only for component-to-component hierarchy inside the same task: top-level components use null, child components use another component localId, and a task localId must never be used as parentLocalId.',\n",
    "    'Represent subjects, fields, materials, topics, chapters, sections, and skills as components. parentLocalId is only for component-to-component hierarchy inside the same task: top-level components use null, child components use another component localId, and a task localId must never be used as parentLocalId.',\n    'When a task is semantically an umbrella or category that naturally contains multiple materially different work items, but the constituent work is not yet stated, emit one uncertainty targeting that task with field work_breakdown. This records unknown task decomposition, not missing quantity. Do not invent constituent work and do not emit it for a task presented as one concrete schedulable unit.',\n",
)

# 2) Recurrence instruction: general semantic invariant, not the observed daily case.
replace_once(
    'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts',
    "  'Explicit daily/weekdays/weekends repetition must be represented by recurrence; do not encode repetition only in workload.periodExpression.',\n",
    "  'Any explicit recurring cadence represented in workload.periodExpression must also be represented by a matching recurrence; periodExpression never substitutes for recurrence.',\n",
)

# 3) Deterministic dialogue fallback: avoid multi-slot form filling.
replace_once(
    'src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.ts',
    "  const question = taskTitles.length === 1\n    ? 'その作業をどれくらい進めたいですか？'\n    : 'それぞれどれくらい進めたいですか？';\n  return {\n    message: `${summary}は把握しました。${question}「2時間」「30ページ」「20問」のように、量を教えてください。`,\n",
    "  const question = taskTitles.length === 1\n    ? 'どこまで進めたいか、量や範囲が決まっていれば教えてください。'\n    : 'まず一つずつ整理したいので、どれから決めるか教えてください。選んだものについて、どこまで進めたいか確認します。';\n  return {\n    message: `${summary}がありますね。${question}`,\n",
)

replace_once(
    'src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.ts',
    "function semanticUncertaintyQuestion(\n  graph: WeeklyPlanningFactGraphV5,\n  question: WeeklyPlanningStableQuestionV5,\n): string {\n  const uncertainty = question.factId\n    ? graph.uncertainties.find((fact) => fact.id === question.factId)\n    : null;\n  const sourceText = uncertainty\n    ? questionSourceExcerpt(uncertainty.source.sourceText)\n    : '';\n",
    "function semanticUncertaintyQuestion(\n  graph: WeeklyPlanningFactGraphV5,\n  question: WeeklyPlanningStableQuestionV5,\n): string {\n  const uncertainty = question.factId\n    ? graph.uncertainties.find((fact) => fact.id === question.factId)\n    : null;\n  if (uncertainty?.field === 'work_breakdown' && uncertainty.targetFactId) {\n    const task = graph.tasks.find((fact) => fact.id === uncertainty.targetFactId);\n    const label = task?.title?.trim() || 'この予定';\n    return `「${label}」は、まず中身を分けて考えましょう。今残っているものをざっくり教えてもらえますか？`;\n  }\n  const sourceText = uncertainty\n    ? questionSourceExcerpt(uncertainty.source.sourceText)\n    : '';\n",
)

# 4) Renderer: conversational principles, no scenario examples.
replace_once(
    'src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRenderer.ts',
    "    '会話とアプリ状態に基づいて、次の自然な日本語を返してください。',\n    '入力にない具体情報は、例としても補わないでください。',\n",
    "    '会話とアプリ状態に基づいて、次の自然な日本語を返してください。',\n    '内部状態や入力フォームを埋めさせるような聞き方ではなく、相談相手として自然に一つずつ確認してください。',\n    '一度に複数の独立した回答を要求せず、現在のユーザーが答えやすい一つの確認を優先してください。',\n    '入力にない具体情報は、例としても補わないでください。',\n",
)
replace_once(
    'src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRenderer.ts',
    "      'decidedFactsは確定情報、undecidedItemsは確認が必要な情報です。referenceResponseは参考であり、繰り返す必要はありません。',\n      '説明要求には説明し、questionでは必要情報だけを尋ね、未実行の作成・保存を完了したとは言わないでください。',\n",
    "      'decidedFactsは確定情報、undecidedItemsは確認が必要な情報です。referenceResponseはアプリが必要としている確認意図の参考であり、文型・列挙順・語句をコピーする必要はありません。',\n      'undecidedItemsにfieldがwork_breakdownの項目がある場合は、量や合計時間より先に、その対象の中身を分けるための一つの質問をしてください。',\n      '説明要求には説明し、questionでは必要情報だけを尋ね、未実行の作成・保存を完了したとは言わないでください。',\n",
)
