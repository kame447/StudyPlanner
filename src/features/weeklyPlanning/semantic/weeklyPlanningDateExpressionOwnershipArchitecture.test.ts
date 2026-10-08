import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function callsTo(root: ts.Node, name: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return calls;
}

function inputReferences(call: ts.CallExpression): Record<string, string> {
  const input = call.arguments[0];
  if (!input || !ts.isObjectLiteralExpression(input)) return {};
  const references: Record<string, string> = {};
  for (const property of input.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      references[property.name.text] = property.name.text;
    } else if (ts.isPropertyAssignment(property)
      && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      references[property.name.text] = ts.isIdentifier(property.initializer)
        ? property.initializer.text : '<non-reference>';
    } else {
      // Spreads/computed keys can override an earlier reference. Do not silently
      // treat a source shape this local wiring check cannot resolve as safe.
      return {};
    }
  }
  return references;
}

describe('weekly planning scheduler date-expression ownership', () => {
  it('keeps raw canonical date resolution out of scheduler fact consumers', () => {
    const central = source('./weeklyPlanningResolvedDateExpressionsV5.ts');
    const consumers = [
      './weeklyPlanningResolvedTemporalConstraintsV5.ts',
      './weeklyPlanningTaskDateRuleResolver.ts',
      './weeklyPlanningTaskCommitmentResolver.ts',
      './weeklyPlanningAvailabilityResolver.ts',
      './weeklyPlanningGenericSchedulerInput.ts',
    ].map(source);

    expect(central).toContain('resolveCanonicalDateExpression');
    for (const consumer of consumers) {
      expect(consumer).not.toContain('resolveCanonicalDateExpression');
    }
  });

  it('does not expose a single-expression reinterpretation escape hatch to leaf resolvers', () => {
    const central = source('./weeklyPlanningResolvedDateExpressionsV5.ts');
    const leafResolvers = [
      './weeklyPlanningTaskDateRuleResolver.ts',
      './weeklyPlanningTaskCommitmentResolver.ts',
      './weeklyPlanningAvailabilityResolver.ts',
    ].map(source);

    expect(central).not.toContain('resolveWeeklyPlanningSingleDateExpressionV5');
    for (const resolver of leafResolvers) {
      expect(resolver).not.toContain('resolveWeeklyPlanningSingleDateExpressionV5');
      expect(resolver).toContain(
        'resolvedDateExpressions: WeeklyPlanningResolvedDateExpressionsV5;',
      );
    }
  });

  it('creates one active-graph snapshot and reuses it for baseline and calibration compilation', () => {
    const planningEvaluation = ts.createSourceFile(
      'weeklyPlanningStableV5PlanningEvaluation.ts',
      source('../application/weeklyPlanningStableV5PlanningEvaluation.ts'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const resolutions = callsTo(planningEvaluation, 'resolveWeeklyPlanningDateExpressionsV5');
    expect(resolutions).toHaveLength(1);
    expect(inputReferences(resolutions[0])).toMatchObject({ graph: 'activeGraph' });
    const declaration = resolutions[0].parent;
    expect(ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)
      ? declaration.name.text : null).toBe('resolvedDateExpressions');

    const temporalResolutions = callsTo(planningEvaluation, 'resolveWeeklyPlanningTemporalConstraintsV5');
    expect(temporalResolutions).toHaveLength(1);
    expect(inputReferences(temporalResolutions[0])).toMatchObject({
      graph: 'activeGraph', resolvedDateExpressions: 'resolvedDateExpressions',
    });

    const suspendedCompilations = callsTo(planningEvaluation, 'compileWithWeeklyPlanningWindowQuestionSuspension');
    expect(suspendedCompilations).toHaveLength(1);
    const suspension = suspendedCompilations[0];
    expect(inputReferences(suspension)).toMatchObject({ graph: 'activeGraph' });
    const baselineDeclaration = suspension.parent;
    expect(ts.isVariableDeclaration(baselineDeclaration) && ts.isIdentifier(baselineDeclaration.name)
      ? baselineDeclaration.name.text : null).toBe('rawBaselineCompilation');
    const input = suspension.arguments[0];
    if (!input || !ts.isObjectLiteralExpression(input)) throw new Error('baseline suspension needs an explicit input');
    const compileProperty = input.properties.find((property) => ts.isPropertyAssignment(property)
      && ts.isIdentifier(property.name) && property.name.text === 'compile');
    if (!compileProperty || !ts.isPropertyAssignment(compileProperty)
      || !ts.isArrowFunction(compileProperty.initializer)) throw new Error('baseline compilation must be the suspension callback');
    const callback = compileProperty.initializer;
    expect(callback.parameters).toHaveLength(1);
    const parameter = callback.parameters[0].name;
    if (!ts.isIdentifier(parameter)) throw new Error('projected graph must be an explicit callback parameter');
    expect(ts.isCallExpression(callback.body) && ts.isIdentifier(callback.body.expression)
      ? callback.body.expression.text : null).toBe('compileGenericSchedulerInput');
    const baselineCalls = callsTo(callback, 'compileGenericSchedulerInput');
    expect(baselineCalls).toHaveLength(1);
    expect(inputReferences(baselineCalls[0])).toMatchObject({
      graph: parameter.text,
      resolvedDateExpressions: 'resolvedDateExpressions',
      resolvedTemporalConstraints: 'resolvedTemporalConstraints',
    });

    for (const [callee, expectedGraphs] of [
      ['compileGenericSchedulerInput', [parameter.text, 'provisionalSchedulerGraph']],
      ['compileWeeklyPlanningMemoryCalibrationSchedulerInputV5', ['activeGraph']],
    ] as const) {
      const inputs = callsTo(planningEvaluation, callee).map(inputReferences);
      expect(inputs.map((input) => input.graph), callee).toEqual(expectedGraphs);
      for (const input of inputs) {
        expect(input, callee).toMatchObject({
          resolvedDateExpressions: 'resolvedDateExpressions',
          resolvedTemporalConstraints: 'resolvedTemporalConstraints',
        });
      }
    }
  });

  it('keeps planning-window horizon grounding as an explicit separate responsibility', () => {
    const temporalContext = source('../application/weeklyPlanningTemporalContext.ts');

    expect(temporalContext).toContain('resolveCanonicalDateExpression');
    expect(temporalContext).toContain('expression: window.value.trim()');
  });
});
