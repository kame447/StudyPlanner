const QUESTION_TARGET_PATTERNS: Partial<Record<string, RegExp>> = {
  quantity_role_unresolved: /^(.+?)の量は、/,
  missing_effort_estimate: /^(.+?)を指定した量だけ進めるのに、/,
  ambiguous_effort_estimate: /^(.+?)の所要時間が複数あります。/,
  missing_commitment_date_scope: /^(.+?)は何日の固定予定ですか/,
  invalid_commitment_interval: /^(.+?)の開始時刻と終了時刻を/,
  conflicting_task_date_rule: /^(.+?)を同じ日に「行う」と「行わない」/,
};

function normalizeLabel(value: string): string | null {
  const label = value.trim().replace(/^「|」$/g, '').trim();
  if (!label || label.length > 100 || /[\r\n]/.test(label)) return null;
  return label;
}

function quotedLabels(value: string): string[] {
  return [...value.matchAll(/「([^」]{1,100})」/g)]
    .map((match) => normalizeLabel(match[1]))
    .filter((label): label is string => Boolean(label));
}

export function isStableV5QuestionLikeText(text: string): boolean {
  return /[？?]/.test(text)
    || /(?:教えてください|確認してください|どちらを採用しますか|どれを使うか)/.test(text);
}

export function requiredLabelsForStableV5Dialogue(params: {
  questionCode: string | null;
  fallbackText: string;
}): string[] {
  const labels = new Set(quotedLabels(params.fallbackText));
  const pattern = params.questionCode
    ? QUESTION_TARGET_PATTERNS[params.questionCode]
    : undefined;
  const target = pattern?.exec(params.fallbackText)?.[1];
  const normalizedTarget = target ? normalizeLabel(target) : null;
  if (normalizedTarget) labels.add(normalizedTarget);
  return [...labels];
}
