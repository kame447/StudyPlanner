import type {
  SimpleWeeklyTask,
  StudyTaskProfile,
  StudyTaskProfileInput,
  StudyTaskProfileScore,
} from '../weeklyPlanningTypes';
import { normalizeWeeklyPlanningText } from '../parsing/weeklyPlanningText';

export const DEFAULT_STUDY_TASK_PROFILE: StudyTaskProfile = {
  cognitiveLoad: 3,
  contextRetentionCost: 3,
  chunkability: 3,
  feedbackGranularity: 3,
  fatigueRisk: 3,
  switchingCost: 3,
  repetitionBenefit: 3,
  deadlinePressure: 3,
};

export function clampProfileScore(score: number): StudyTaskProfileScore {
  return Math.min(5, Math.max(1, Math.round(score))) as StudyTaskProfileScore;
}

export function normalizeTaskProfileText(text: string): string {
  return normalizeWeeklyPlanningText(text)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveStudyTaskProfileText(input: StudyTaskProfileInput): string {
  if (typeof input === 'string') {
    return normalizeTaskProfileText(input);
  }

  return normalizeTaskProfileText(
    [input.title, input.sourceText].filter(Boolean).join(' '),
  );
}

function applyStudyTaskProfilePatch(
  profile: StudyTaskProfile,
  patch: Partial<Record<keyof StudyTaskProfile, number>>,
): StudyTaskProfile {
  return Object.entries(patch).reduce<StudyTaskProfile>(
    (nextProfile, [key, value]) => ({
      ...nextProfile,
      [key]: clampProfileScore(value),
    }),
    profile,
  );
}

export function inferStudyTaskProfile(
  input: StudyTaskProfileInput,
): StudyTaskProfile {
  const text = resolveStudyTaskProfileText(input);
  const hasDeadline =
    (typeof input !== 'string' && Boolean(input.deadlineDate)) ||
    /締切|期限|まで|迄/.test(text);
  let profile = { ...DEFAULT_STUDY_TASK_PROFILE };

  if (/英単語|単語|語彙|ボキャブラリ|暗記|用語|定義暗記/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 2,
      contextRetentionCost: 2,
      chunkability: 5,
      feedbackGranularity: 5,
      fatigueRisk: 2,
      switchingCost: 2,
      repetitionBenefit: 5,
    });
  }

  if (/英語.*長文|長文.*英語|英文読解|長文読解|読解/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 3,
      contextRetentionCost: 3,
      chunkability: 3,
      feedbackGranularity: 3,
      fatigueRisk: 3,
      repetitionBenefit: 3,
    });
  }

  if (/java|javascript|typescript|プログラミング/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 3,
      contextRetentionCost: 3,
      switchingCost: 3,
    });
  }

  if (/(java|javascript|typescript).*(文法|復習)|(文法|復習).*(java|javascript|typescript)/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 2,
      contextRetentionCost: 2,
      chunkability: 4,
      feedbackGranularity: 4,
      fatigueRisk: 2,
      switchingCost: 2,
      repetitionBenefit: 4,
    });
  }

  if (/(java|javascript|typescript).*(実装|開発|制作)|(実装|開発|制作).*(java|javascript|typescript)/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 4,
      contextRetentionCost: 5,
      chunkability: 2,
      feedbackGranularity: 3,
      fatigueRisk: 3,
      switchingCost: 5,
      repetitionBenefit: 2,
    });
  }

  if (/計算理論|証明|証明問題|数学|線形代数|確率統計/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 5,
      contextRetentionCost: 4,
      chunkability: 2,
      feedbackGranularity: 3,
      fatigueRisk: 4,
      switchingCost: 3,
      repetitionBenefit: 2,
    });
  }

  if (/卒研|研究/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 4,
      contextRetentionCost: 4,
      fatigueRisk: 3,
      switchingCost: 4,
    });
  }

  if (/(卒研|研究).*(文献|論文|読み)|(文献|論文).*(卒研|研究)/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 4,
      contextRetentionCost: 3,
      chunkability: 3,
      feedbackGranularity: 2,
      fatigueRisk: 4,
      switchingCost: 3,
      repetitionBenefit: 2,
    });
  }

  if (/(卒研|研究).*(アノテーション| annotation|ラベル付け)|(アノテーション|annotation|ラベル付け).*(卒研|研究)/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 2,
      contextRetentionCost: 2,
      chunkability: 5,
      feedbackGranularity: 5,
      fatigueRisk: 2,
      switchingCost: 2,
      repetitionBenefit: 4,
    });
  }

  if (/(卒研|研究).*(文章|執筆|論文作成|書く)|(文章|執筆|論文作成|書く).*(卒研|研究)/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 4,
      contextRetentionCost: 4,
      chunkability: 3,
      feedbackGranularity: 3,
      fatigueRisk: 3,
      switchingCost: 4,
      repetitionBenefit: 2,
    });
  }

  if (/レポート|文章作成|執筆/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: Math.max(profile.cognitiveLoad, 4),
      contextRetentionCost: Math.max(profile.contextRetentionCost, 4),
      switchingCost: Math.max(profile.switchingCost, 4),
    });
  }

  if (/obsidian|整理|転記|まとめ/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 2,
      contextRetentionCost: 2,
      chunkability: 4,
      feedbackGranularity: 4,
      fatigueRisk: 2,
      switchingCost: 2,
      repetitionBenefit: 3,
    });
  }

  if (hasDeadline) {
    profile = applyStudyTaskProfilePatch(profile, {
      deadlinePressure: 4,
    });
  }

  return profile;
}



export function isHeavyStudyTask(task: Pick<SimpleWeeklyTask, 'title' | 'sourceText'>): boolean {
  const normalizedText = normalizeWeeklyPlanningText(`${task.title} ${task.sourceText}`);

  return /\u5352\u7814|\u5b9f\u88c5|\u30ec\u30dd\u30fc\u30c8|\u8a08\u7b97\u7406\u8ad6|\u6587\u732e|\u7814\u7a76|\u8ad6\u6587|\u6df1\u3044|\u9577\u6587/.test(
    normalizedText,
  );
}



export function allowsTinySessionForTask(task: Pick<SimpleWeeklyTask, 'title' | 'sourceText'>): boolean {
  const normalizedText = normalizeWeeklyPlanningText(
    `${task.title} ${task.sourceText}`,
  );

  return /\u6697\u8a18|\u5358\u8a9e|\u5c0f\u30c6\u30b9\u30c8|\u30c1\u30a7\u30c3\u30af|\u78ba\u8a8d|\u5fa9\u7fd2|\u30b9\u30ad\u30de|\u9699\u9593|\u8efd\u304f|30\s*\u5206\s*\u3060\u3051/.test(
    normalizedText,
  );
}



export function resolveMinimumUsefulSessionMinutes(params: {
  task: Pick<SimpleWeeklyTask, 'title' | 'sourceText'>;
  allowTinySession: boolean;
  policyMinSessionMinutes?: number;
}): number {
  if (params.allowTinySession) {
    return Math.max(30, params.policyMinSessionMinutes ?? 30);
  }

  if (isHeavyStudyTask(params.task)) {
    return Math.max(60, params.policyMinSessionMinutes ?? 60);
  }

  return Math.max(45, params.policyMinSessionMinutes ?? 45);
}
