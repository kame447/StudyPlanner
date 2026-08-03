import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_CREATION_AUTHORIZATION_CONTRACT_V5 =
  'weekly-planning-creation-authorization-v5' as const;

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[、，。.!！?？]/g, '');
}

function isPureCreationAuthorization(userText: string): boolean {
  const text = normalizeText(userText);
  const subject = '(?:これ|それ|この条件|その条件|この内容|その内容|この設定|その設定)';
  const object = '(?:(?:仮)?(?:予定|計画|スケジュール))?';
  const action = '(?:を)?(?:作って|作成して|組んで|生成して|作ってほしい|作成してほしい|組んでほしい)';
  const polite = '(?:ください|お願いします)?';
  return new RegExp(`^${subject}(?:で|のまま)${object}${action}${polite}$`).test(text)
    || new RegExp(`^${subject}(?:で|のまま)(?:予定作成|計画作成|スケジュール作成)(?:を)?お願いします$`).test(text);
}

export function createGroundedCreationAuthorizationDocumentV5(
  userText: string,
): WeeklyPlanningSemanticDocumentV5 | null {
  if (!isPureCreationAuthorization(userText)) return null;
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}
