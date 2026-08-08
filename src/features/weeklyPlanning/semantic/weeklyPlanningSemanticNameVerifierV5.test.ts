import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticNameVerifierV5,
} from './weeklyPlanningSemanticNameVerifierV5';

function documentWithNames(params: {
  title: string;
  contextLabel: string;
  componentLabel: string;
  sourceText: string;
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      existingPublicId: null,
      decompositionStatus: 'atomic',
      category: 'study',
      title: params.title,
      study: {
        purpose: 'practice',
        contextLabel: params.contextLabel,
        components: [{
          localId: 'component-1',
          existingPublicId: null,
          parentLocalId: null,
          role: 'material',
          label: params.componentLabel,
          workloads: [],
          durableContextSignals: [],
          sourceText: params.sourceText,
        }],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: params.sourceText,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function client(response: unknown, calls: Array<Record<string, unknown>> = []): OpenAiCompatibleClient {
  return {
    async createChatCompletion(input) {
      calls.push(input as unknown as Record<string, unknown>);
      return JSON.stringify(response);
    },
  };
}

describe('Stable V5 semantic name verifier', () => {
  it('applies AI-selected spelling correction only to canonical name fields', async () => {
    const sourceText = '来週、数楽ワークを20ページ進めたいです。';
    const document = documentWithNames({
      title: '数楽ワークを進める',
      contextLabel: '数楽ワーク',
      componentLabel: '数楽ワーク',
      sourceText,
    });
    const result = await createWeeklyPlanningSemanticNameVerifierV5(client({
      decisions: [
        {
          candidateId: 'task:task-1:title',
          originalValue: '数楽ワークを進める',
          status: 'corrected',
          canonicalValue: '数学ワークを進める',
        },
        {
          candidateId: 'task:task-1:contextLabel',
          originalValue: '数楽ワーク',
          status: 'corrected',
          canonicalValue: '数学ワーク',
        },
        {
          candidateId: 'component:component-1:label',
          originalValue: '数楽ワーク',
          status: 'corrected',
          canonicalValue: '数学ワーク',
        },
      ],
    })).verify({ userText: sourceText, document });

    expect(result.status).toBe('verified');
    expect(result.correctionCount).toBe(3);
    expect(result.document?.tasks[0]?.title).toBe('数学ワークを進める');
    expect(result.document?.tasks[0]?.study?.contextLabel).toBe('数学ワーク');
    expect(result.document?.tasks[0]?.study?.components[0]?.label).toBe('数学ワーク');
    expect(result.document?.tasks[0]?.sourceText).toBe(sourceText);
    expect(result.document?.tasks[0]?.study?.components[0]?.sourceText).toBe(sourceText);
  });

  it('preserves a clean name exactly', async () => {
    const document = documentWithNames({
      title: '化学のワークシートを進める',
      contextLabel: '化学のワークシート',
      componentLabel: 'ワークシート',
      sourceText: '化学のワークシートを進めたい',
    });
    const result = await createWeeklyPlanningSemanticNameVerifierV5(client({
      decisions: [
        {
          candidateId: 'task:task-1:title',
          originalValue: '化学のワークシートを進める',
          status: 'unchanged',
          canonicalValue: '化学のワークシートを進める',
        },
        {
          candidateId: 'task:task-1:contextLabel',
          originalValue: '化学のワークシート',
          status: 'unchanged',
          canonicalValue: '化学のワークシート',
        },
        {
          candidateId: 'component:component-1:label',
          originalValue: 'ワークシート',
          status: 'unchanged',
          canonicalValue: 'ワークシート',
        },
      ],
    })).verify({ userText: '化学のワークシートを進めたい', document });

    expect(result.status).toBe('verified');
    expect(result.correctionCount).toBe(0);
    expect(result.document).toEqual(document);
  });

  it('rejects an ambiguous name rather than guessing', async () => {
    const document = documentWithNames({
      title: '課題Aを進める',
      contextLabel: '課題A',
      componentLabel: '課題A',
      sourceText: '課題Aを進めたい',
    });
    const result = await createWeeklyPlanningSemanticNameVerifierV5(client({
      decisions: [
        {
          candidateId: 'task:task-1:title',
          originalValue: '課題Aを進める',
          status: 'ambiguous',
          canonicalValue: null,
        },
        {
          candidateId: 'task:task-1:contextLabel',
          originalValue: '課題A',
          status: 'unchanged',
          canonicalValue: '課題A',
        },
        {
          candidateId: 'component:component-1:label',
          originalValue: '課題A',
          status: 'unchanged',
          canonicalValue: '課題A',
        },
      ],
    })).verify({ userText: '課題Aを進めたい', document });

    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
    expect(result.errors).toContain('ambiguous-name:task:task-1:title');
  });

  it('requires exact candidate coverage and uses the existing semantic purpose', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const document = documentWithNames({
      title: '英語レポートを仕上げる',
      contextLabel: '英語レポート',
      componentLabel: 'レポート',
      sourceText: '英語のレポートを仕上げたい',
    });
    const result = await createWeeklyPlanningSemanticNameVerifierV5(client({
      decisions: [],
    }, calls)).verify({ userText: '英語のレポートを仕上げたい', document });

    expect(result.status).toBe('rejected');
    expect(result.errors[0]).toBe('decision-count-mismatch:0:3');
    expect(calls[0]).toMatchObject({
      purpose: 'weekly_planning_semantic_normalizer',
      temperature: 0,
      maxCompletionTokens: 1200,
    });
  });
});
