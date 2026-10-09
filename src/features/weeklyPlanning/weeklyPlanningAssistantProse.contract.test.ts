import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { weeklyPlanningInternalProcessTermsIn } from './dialogue/weeklyPlanningStableV5DialogueValidation';

/*
 * Issue #488 natural conversation repair: source-level guard for fixed assistant prose.
 *
 * In the interaction architecture every assistant reply is written by the dialogue renderer
 * from a typed communication context; the only fixed conversational Japanese it may show is the
 * emergency wording used when the renderer cannot run or fails. This test makes every
 * production string literal that contains Japanese text visible and classified, so a new fixed
 * reply cannot slip into the conversation path unnoticed:
 *
 * 1. Every production file under weeklyPlanning that contains a Japanese string literal is
 *    registered below under a category with a reason. An unregistered file fails.
 * 2. Texts the interaction architecture can show (its emergency module, the application-typed
 *    question texts reused as the emergency question, the date note, the correction
 *    acknowledgement and the application's omitted-work statement) contain no internal
 *    system/process vocabulary.
 * 3. The interaction decision modules (typed acts, outcome, recovery, communication context)
 *    contain no Japanese literal at all: they decide WHAT, never the words.
 * 4. Pre-Stable-V5 modules with fixed prose are not reachable from the application entry
 *    through value imports (they are not part of any production conversation path).
 *
 * Only string literals are inspected (TypeScript AST); comments are ignored.
 */

const WEEKLY_PLANNING_ROOT = fileURLToPath(new URL('./', import.meta.url));
const SOURCE_ROOT = resolve(WEEKLY_PLANNING_ROOT, '../..');
const APP_ENTRY = resolve(SOURCE_ROOT, 'main.tsx');
const JAPANESE = /[぀-ヿ一-鿿]/u;
const INTERNAL_PROCESS_WORDING = /予定条件|安全に|反映していません|確認中の質問|保留|構造化|正規化|検証|処理|システム|validation|pending|provider|retry|\bstate\b|graph|revision|authoritative|JSON/iu;

type ProseCategory =
  /** The single interaction emergency module (renderer unavailable / rejected). */
  | 'interaction_emergency'
  /**
   * An application-owned statement shown next to a rendered interaction reply because it is
   * scheduling truth the model may not word (work left out of a preview).
   */
  | 'interaction_authoritative_disclosure'
  /** Application-typed texts the interaction architecture reuses only as its emergency text. */
  | 'interaction_emergency_shared'
  /** Shown only by the legacy (pre-#488) comparison architecture; interaction replaces them. */
  | 'legacy_compatibility'
  /** Instructions to the renderer model, never shown to the user. */
  | 'renderer_instruction'
  /** Vocabulary the renderer-output validator checks for; never shown. */
  | 'output_validation'
  /** Context marker sent to the semantic model; never shown. */
  | 'model_context_marker'
  /** Non-conversational UI copy: buttons, banners, errors, labels, starter prompts, admin. */
  | 'ui_copy'
  /** Authoritative save/approval outcome: deterministic by design, never written by a model. */
  | 'authoritative_status'
  /** Date/unit/title formatting of data values. */
  | 'data_formatting'
  /** Pre-Stable-V5 module that no production entry reaches through value imports. */
  | 'not_wired_pre_v5';

const PROSE_REGISTRY: Readonly<Record<string, ProseCategory>> = {
  'dialogue/weeklyPlanningInteractionFallbackText.ts': 'interaction_emergency',
  'dialogue/weeklyPlanningPreviewOmissionDisclosure.ts': 'interaction_authoritative_disclosure',
  'dialogue/weeklyPlanningCapacityShortfallDisclosure.ts': 'interaction_authoritative_disclosure',
  'dialogue/weeklyPlanningUncertaintyReleaseDisclosure.ts': 'interaction_authoritative_disclosure',
  'application/weeklyPlanningStableV5RuntimeQuestions.ts': 'interaction_emergency_shared',
  'dialogue/weeklyPlanningStableV5TurnDialogue.ts': 'interaction_emergency_shared',
  'application/weeklyPlanningStableV5GroundingFlow.ts': 'interaction_emergency_shared',
  'semantic/weeklyPlanningSelfRepairV5.ts': 'interaction_emergency_shared',
  'application/weeklyPlanningLegacyFailurePresentation.ts': 'legacy_compatibility',
  'application/weeklyPlanningStableV5ResponseRouting.ts': 'legacy_compatibility',
  'application/weeklyPlanningStableV5ProvisionalCapacityPreview.ts': 'legacy_compatibility',
  'application/weeklyPlanningStableV5TurnIdempotency.ts': 'legacy_compatibility',
  'weeklyPlanningTurnController.ts': 'legacy_compatibility',
  'dialogue/weeklyPlanningStableV5DialoguePrompt.ts': 'renderer_instruction',
  'dialogue/weeklyPlanningStableV5AiDialogueRenderer.ts': 'renderer_instruction',
  'dialogue/weeklyPlanningStableV5DialogueValidation.ts': 'output_validation',
  // Interaction semantic meaning rule quotes collective user words (どっちも/両方/全部) as examples.
  'semantic/weeklyPlanningSemanticMeaningPolicyV5.ts': 'model_context_marker',
  'application/weeklyPlanningApprovalApplication.ts': 'authoritative_status',
  'application/useWeeklyPlanningApplication.ts': 'ui_copy',
  'application/weeklyPlanningApprovalAvailability.ts': 'ui_copy',
  'application/weeklyPlanningApprovalFirestoreRepository.ts': 'ui_copy',
  'application/weeklyPlanningApprovalMemoryRepository.ts': 'ui_copy',
  'application/weeklyPlanningApprovalPersistencePolicy.ts': 'ui_copy',
  'application/weeklyPlanningRuntimeModule.ts': 'ui_copy',
  'application/weeklyPlanningStableV5SemanticTurn.ts': 'ui_copy',
  'chat/aiPlanningChatStore.ts': 'ui_copy',
  'personalization/useWeeklyPlanningPersonalizationProfile.ts': 'ui_copy',
  'personalization/weeklyPlanningPersonalizationRepository.ts': 'ui_copy',
  'trace/useWeeklyPlanningTracePolicy.ts': 'ui_copy',
  'trace/weeklyPlanningTracePaginatedAdminRepository.ts': 'ui_copy',
  'trace/weeklyPlanningTracePrivacyClient.ts': 'ui_copy',
  'trace/WeeklyPlanningTraceDebugPage.tsx': 'ui_copy',
  'trace/weeklyPlanningTraceAdminEntryPageClient.ts': 'ui_copy',
  'ui/aiPlanningImageTurn.ts': 'ui_copy',
  'ui/aiPlanningStarterPrompts.ts': 'ui_copy',
  'weeklyPlanningConversationArchitecture.ts': 'ui_copy',
  'security/weeklyPlanningIssue152AdversarialCorpus.ts': 'ui_copy',
  'application/weeklyPlanningDraftConversion.ts': 'data_formatting',
  'application/weeklyPlanningStableV5ProvisionalTimebox.ts': 'data_formatting',
  'dialogue/weeklyPlanningDialogueDateGrounding.ts': 'data_formatting',
  'dialogue/weeklyPlanningStableV5DialogueContext.ts': 'data_formatting',
  'semantic/weeklyPlanningCalendarResolver.ts': 'data_formatting',
  'semantic/weeklyPlanningMemoryCalibrationSchedulerInputV5.ts': 'data_formatting',
  'semantic/weeklyPlanningSchedulerWorkDistributionV5.ts': 'data_formatting',
  'semantic/weeklyPlanningWorkloadQuantityLabelV5.ts': 'data_formatting',
  'semantic/weeklyPlanningStableV5PlacementCandidates.ts': 'data_formatting',
  'semantic/weeklyPlanningStatedTimeBudgetProjectionV5.ts': 'data_formatting',
  'config/weeklyPendingConfigUpdater.ts': 'not_wired_pre_v5',
  'dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.ts': 'not_wired_pre_v5',
  'dialogue/weeklyPlanningDialogueManager.ts': 'not_wired_pre_v5',
  'dialogue/weeklyPlanningDialogueRepairPolicy.ts': 'not_wired_pre_v5',
  'dialogue/weeklyPlanningKnownFixedEvents.ts': 'not_wired_pre_v5',
  'intake/weeklyPlanningDraftRequestAdapter.ts': 'not_wired_pre_v5',
  'intake/weeklyPlanningIntakeReducer.ts': 'not_wired_pre_v5',
  'intake/weeklyPlanningQuestionSlots.ts': 'not_wired_pre_v5',
  'intake/weeklyPlanningRangeScope.ts': 'not_wired_pre_v5',
  'parsing/weeklyConditionParser.ts': 'not_wired_pre_v5',
  'parsing/weeklyPlanningText.ts': 'not_wired_pre_v5',
  'parsing/weeklyQualityPreferenceParser.ts': 'not_wired_pre_v5',
  'parsing/weeklyTaskExtraction.ts': 'not_wired_pre_v5',
  'parsing/weeklyTitleCleanup.ts': 'not_wired_pre_v5',
  'pipeline/weeklyPlanningBehaviorAwareIntakePipeline.ts': 'not_wired_pre_v5',
  'pipeline/weeklyPlanningIntakePipeline.ts': 'not_wired_pre_v5',
  'pipeline/weeklyPlanningSemanticInterpreterError.ts': 'not_wired_pre_v5',
  'planning/weeklyPlanningBehaviorPlanner.ts': 'not_wired_pre_v5',
  'planning/weeklyPlanningFeasibility.ts': 'not_wired_pre_v5',
  'scheduling/weeklyDraftCandidateGenerator.ts': 'not_wired_pre_v5',
  'semantic/weeklyPlanningSemanticDocument.ts': 'not_wired_pre_v5',
  'semantic/weeklyPlanningSemanticDocumentV2.ts': 'not_wired_pre_v5',
  'weeklyPlanningTransforms.ts': 'not_wired_pre_v5',
};

/** Interaction decision modules: they decide WHAT is communicated and hold no prose. */
const PROSE_FREE_INTERACTION_MODULES = [
  'application/weeklyPlanningConversationRecovery.ts',
  'application/weeklyPlanningInteractionDecision.ts',
  'application/weeklyPlanningInteractionOutcome.ts',
  'application/weeklyPlanningStableV5RuntimeExecutor.ts',
  'application/weeklyPlanningStableV5TurnResultProjection.ts',
  'dialogue/weeklyPlanningStableV5CommunicationContext.ts',
  'dialogue/weeklyPlanningStableV5DialogueContracts.ts',
  'semantic/weeklyPlanningConversationActsV5.ts',
  'semantic/weeklyPlanningSemanticConversationOnlyTurnV5.ts',
];

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (['.ts', '.tsx'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

function isProductionSource(relativePath: string): boolean {
  return !/\.(test|spec)\.tsx?$/.test(relativePath)
    && !/(^|\/)(__tests__|__scratch|testUtils|testFixtures|evals)\//.test(relativePath)
    && !/\.testUtils\.tsx?$/.test(relativePath);
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function japaneseLiterals(path: string): string[] {
  const literals: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node))
      && JAPANESE.test(node.text)) literals.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(parse(path));
  return literals;
}

function normalizedRelative(path: string): string {
  return relative(WEEKLY_PLANNING_ROOT, path).split(sep).join('/');
}

/** Files reachable from the app entry through value imports (type-only imports excluded). */
function valueReachableFiles(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  const resolveSpecifier = (from: string, specifier: string): string | null => {
    if (!specifier.startsWith('.')) return null;
    const base = resolve(dirname(from), specifier);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        // try the next candidate
      }
    }
    return null;
  };
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const specifiers: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        const typeOnly = Boolean(clause && (clause.isTypeOnly || (!clause.name && clause.namedBindings
          && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0
          && clause.namedBindings.elements.every((element) => element.isTypeOnly))));
        if (!typeOnly && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const typeOnly = node.isTypeOnly || Boolean(node.exportClause && ts.isNamedExports(node.exportClause)
          && node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly));
        if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        specifiers.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
    for (const specifier of specifiers) {
      const target = resolveSpecifier(file, specifier);
      if (target && !seen.has(target)) stack.push(target);
    }
  }
  return seen;
}

const productionFiles = sourceFiles(WEEKLY_PLANNING_ROOT)
  .filter((path) => isProductionSource(normalizedRelative(path)));
const filesWithJapanese = new Map(productionFiles
  .map((path) => [normalizedRelative(path), japaneseLiterals(path)] as const)
  .filter(([, literals]) => literals.length > 0));

describe('fixed assistant prose in weekly planning (Issue #488)', () => {
  it('registers every production file that holds Japanese string literals under a category', () => {
    expect([...filesWithJapanese.keys()].sort()).toEqual(Object.keys(PROSE_REGISTRY).sort());
  });

  it('keeps internal system/process vocabulary out of every text the interaction architecture can show', () => {
    const violations = Object.entries(PROSE_REGISTRY)
      .filter(([, category]) => category === 'interaction_emergency'
        || category === 'interaction_emergency_shared'
        || category === 'interaction_authoritative_disclosure')
      .flatMap(([file]) => (filesWithJapanese.get(file) ?? [])
        // This file's stricter list (fixed text has no grounding exception) plus the renderer
        // output validator's list, so fixed and rendered wording can never drift apart.
        .filter((literal) => INTERNAL_PROCESS_WORDING.test(literal)
          || weeklyPlanningInternalProcessTermsIn(literal).length > 0)
        .map((literal) => `${file}: ${literal}`));
    expect(violations).toEqual([]);
  });

  it('keeps the interaction decision modules free of prose: they decide WHAT, the renderer the words', () => {
    for (const file of PROSE_FREE_INTERACTION_MODULES) {
      expect({ file, literals: japaneseLiterals(join(WEEKLY_PLANNING_ROOT, file)) }).toEqual({ file, literals: [] });
    }
  });

  it('keeps pre-Stable-V5 prose modules unreachable from the application entry', () => {
    const reachable = new Set([...valueReachableFiles(APP_ENTRY)].map((path) => normalizedRelative(path)));
    const wired = Object.entries(PROSE_REGISTRY)
      .filter(([file, category]) => category === 'not_wired_pre_v5' && reachable.has(file))
      .map(([file]) => file);
    expect(wired).toEqual([]);
    // Sanity: the scan does reach the interaction emergency module through the real app graph.
    expect(reachable.has('dialogue/weeklyPlanningInteractionFallbackText.ts')).toBe(true);
  }, 60_000);
});
