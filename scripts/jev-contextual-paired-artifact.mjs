import assert from 'node:assert/strict';
import { observedTotal } from './jev-contextual-eval-metrics.mjs';

export const PAIRED_ARTIFACT_SCHEMA = 'jev-contextual-paired-v1';
const ARMS = ['jevFirst', 'lunaOnly'];
const CATALOG = 'focused-contextual-answer-2026-10-04-v3';
const GATE = 'contextual-conservative-v2-calibrated';
const LABEL_SOURCES = ['synthetic_unreviewed', 'opus-5.5-limited-judge', 'human_review'];
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const nullable = (value, predicate) => value === null || predicate(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;

function fields(value, required, optional = []) {
  assert.ok(isRecord(value), 'Expected an artifact object.');
  assert.ok(required.every((key) => Object.hasOwn(value, key)), 'Missing artifact field.');
  assert.ok(Object.keys(value).every((key) => required.includes(key) || optional.includes(key)), 'Unknown artifact field.');
}

function jointLabel(label) {
  fields(label, ['source', 'independent', 'reviewer', 'rationale']);
  assert.ok(LABEL_SOURCES.includes(label.source));
  assert.equal(typeof label.independent, 'boolean');
  assert.ok(text(label.reviewer) && text(label.rationale));
}

function semanticResult(result) {
  fields(result, ['status', 'document', 'contextualDirective', 'validationErrors']);
  assert.ok(['accepted', 'rejected', 'provider_failure'].includes(result.status));
  assert.ok(Array.isArray(result.validationErrors) && result.validationErrors.every(text));
  if (result.contextualDirective !== null) {
    fields(result.contextualDirective, ['kind', 'scope']);
    assert.equal(result.contextualDirective.kind, 'provisional_timebox');
    assert.equal(result.contextualDirective.scope, 'current_missing_effort');
    assert.equal(result.status, 'accepted');
  }
  if (result.document === null) {
    assert.notEqual(result.status, 'accepted', 'Accepted result requires a semantic document.');
    return;
  }
  assert.notEqual(result.status, 'provider_failure');
  const arrays = ['tasks', 'relations', 'availabilityDeclarations', 'constraintSourceRequests',
    'uncertainties', 'corrections', 'decisions'];
  fields(result.document, ['schemaVersion', 'planningIntent', 'planningWindow', ...arrays], ['userContextFacts']);
  assert.equal(result.document.schemaVersion, 'weekly-planning-semantic-v5');
  assert.ok(['create_plan', 'update_plan', 'discuss', 'unknown'].includes(result.document.planningIntent));
  assert.ok(result.document.planningWindow === null || isRecord(result.document.planningWindow));
  for (const key of [...arrays, ...(Object.hasOwn(result.document, 'userContextFacts') ? ['userContextFacts'] : [])]) {
    assert.ok(Array.isArray(result.document[key]) && result.document[key].every(isRecord));
  }
  // This is result framing, not an independent semantic correctness judgment.
  // The full document remains review evidence; joint correctness needs provenance.
}

function validateDispatch(dispatch, complete) {
  fields(dispatch, ['provider', 'phase', 'status', 'inputTokens', 'outputTokens', 'costUsd']);
  assert.ok(['jev', 'luna'].includes(dispatch.provider), 'Unknown dispatch provider.');
  assert.ok(text(dispatch.phase));
  assert.equal(typeof dispatch.status, 'string');
  if (dispatch.provider === 'jev') {
    assert.equal(dispatch.phase, 'focused');
    assert.ok(['evaluated', 'unavailable', ...(!complete ? ['dispatched', 'network_failure'] : [])].includes(dispatch.status));
  } else {
    assert.ok(['success', 'invalid_response', 'failed_after_dispatch', ...(!complete ? ['dispatched'] : [])].includes(dispatch.status)
      || /^http_[1-5][0-9]{2}$/.test(dispatch.status), 'Unknown Luna dispatch status.');
  }
  assert.ok(nullable(dispatch.inputTokens, integer) && nullable(dispatch.outputTokens, integer)
    && nullable(dispatch.costUsd, nonnegative), 'Invalid dispatch usage.');
}

function validateArm(record, item, arm) {
  fields(record, ['caseId', 'group', 'arm', 'questionCode', 'catalogVersion', 'gateVersion',
    'observationComplete', 'dispatches', 'lunaDispatches', 'elapsedMs', 'inputTokens', 'outputTokens',
    'actualCostUsd', 'directRoleAccepted', 'selectedRole', 'jointCorrect', 'semanticResult', 'labelSource',
    'providerStatus'], ['jointLabel']);
  assert.equal(record.caseId, item.id);
  assert.equal(record.group, item.group);
  assert.equal(record.arm, arm);
  assert.equal(record.questionCode, item.questionCode);
  assert.equal(record.catalogVersion, CATALOG);
  assert.equal(record.gateVersion, GATE);
  assert.equal(record.labelSource, item.labelSource);
  assert.equal(typeof record.observationComplete, 'boolean');
  assert.ok(Array.isArray(record.dispatches));
  for (const dispatch of record.dispatches) validateDispatch(dispatch, record.observationComplete);
  assert.ok(integer(record.lunaDispatches));
  assert.equal(record.lunaDispatches, record.dispatches.filter((dispatch) => dispatch.provider === 'luna').length,
    'Luna count differs from validated dispatches.');
  assert.ok(nonnegative(record.elapsedMs));
  for (const [field, dispatchField, predicate] of [['inputTokens', 'inputTokens', integer],
    ['outputTokens', 'outputTokens', integer], ['actualCostUsd', 'costUsd', nonnegative]]) {
    assert.ok(nullable(record[field], predicate), 'Invalid turn usage.');
    assert.equal(record[field], observedTotal(record.dispatches.map((dispatch) => dispatch[dispatchField])),
      'Turn usage differs from validated dispatches; missing usage must remain null.');
  }
  assert.equal(typeof record.directRoleAccepted, 'boolean');
  assert.ok(record.selectedRole === null || ['target', 'remaining', 'completed'].includes(record.selectedRole));
  assert.ok(record.providerStatus === null || ['evaluated', 'unavailable'].includes(record.providerStatus));
  semanticResult(record.semanticResult);
  const jev = record.dispatches.filter((dispatch) => dispatch.provider === 'jev');
  if (arm === 'lunaOnly') {
    assert.equal(jev.length, 0, 'Luna-only arm cannot contain Jev dispatches.');
    assert.equal(record.providerStatus, null);
    assert.equal(record.selectedRole, null);
  } else if (record.observationComplete && jev.length) {
    assert.equal(record.providerStatus, jev.at(-1).status);
  }
  if (record.providerStatus === 'evaluated') assert.ok(jev.some((dispatch) => dispatch.status === 'evaluated'));
  if (record.selectedRole !== null) {
    assert.equal(record.providerStatus, 'evaluated');
    assert.ok(jev.some((dispatch) => dispatch.status === 'evaluated'));
  }
  assert.equal(record.directRoleAccepted, record.selectedRole !== null && record.semanticResult.status === 'accepted',
    'Direct acceptance disagrees with the selected role and semantic result.');
  if (record.directRoleAccepted) {
    assert.equal(arm, 'jevFirst');
    assert.equal(record.questionCode, 'quantity_role_unresolved');
    assert.notEqual(record.selectedRole, null);
    assert.equal(record.semanticResult.status, 'accepted');
  }
  assert.ok(record.jointCorrect === null || typeof record.jointCorrect === 'boolean');
  if (record.jointCorrect !== null) jointLabel(record.jointLabel);
  else assert.ok(!Object.hasOwn(record, 'jointLabel'), 'Unjudged result cannot claim joint label provenance.');
}

// A malformed imported measurement is refused before any summary is printed.
// Complete provenance may refer to a historical checkout; never fill it from HEAD.
export function validatePairedArtifact(artifact, { corpus, corpusHash, split, cases }) {
  fields(artifact, ['corpusVersion', 'corpusHash', 'runtimeSha256', 'policySha256', 'split',
    'attemptedAt', 'status', 'expectedTurns', 'summary', 'pairs'], ['schemaVersion']);
  // The initially published producer had this same framing but no version key.
  // Recognize that exact legacy shape; an explicit unknown version is refused.
  if (Object.hasOwn(artifact, 'schemaVersion')) assert.equal(artifact.schemaVersion, PAIRED_ARTIFACT_SCHEMA);
  assert.equal(artifact.corpusVersion, corpus.version);
  assert.equal(artifact.corpusHash, corpusHash);
  for (const hash of [artifact.corpusHash, artifact.runtimeSha256, artifact.policySha256]) {
    assert.equal(typeof hash, 'string');
    assert.match(hash, /^[a-f0-9]{64}$/, 'Missing or invalid artifact fingerprint.');
  }
  assert.equal(artifact.split, split);
  assert.ok(text(artifact.attemptedAt) && Number.isFinite(Date.parse(artifact.attemptedAt)));
  assert.equal(artifact.expectedTurns, cases.length);
  assert.ok(isRecord(artifact.summary)); // cached summary is untrusted and always recomputed
  assert.ok(Array.isArray(artifact.pairs));
  const index = new Map(cases.map((item) => [item.id, item]));
  const seen = new Set();
  for (const pair of artifact.pairs) {
    fields(pair, ['caseId', 'group', 'labelSource', 'order'], ARMS);
    const item = index.get(pair.caseId);
    assert.ok(item && !seen.has(pair.caseId), 'Unregistered or duplicate pair.');
    seen.add(pair.caseId);
    assert.equal(pair.group, item.group);
    assert.equal(pair.labelSource, item.labelSource);
    assert.ok(Array.isArray(pair.order) && pair.order.length === 2
      && pair.order.every((arm) => ARMS.includes(arm)) && new Set(pair.order).size === 2);
    for (const arm of ARMS) if (Object.hasOwn(pair, arm)) validateArm(pair[arm], item, arm);
  }
  const complete = artifact.pairs.length === cases.length
    && artifact.pairs.every((pair) => ARMS.every((arm) => pair[arm]?.observationComplete === true));
  assert.equal(artifact.status, complete ? 'awaiting_joint_review' : 'incomplete_HOLD', 'Artifact completeness disagrees with records.');
  return artifact.pairs;
}
