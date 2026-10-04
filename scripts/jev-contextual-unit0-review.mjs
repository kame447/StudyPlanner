import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { codePointCompare } from './jev-contextual-unit0-random.mjs';

// Preregistration r2 §8. Label provenance is a closed enum with a required
// identity for each source, so a model label can never be presented as a
// human, Opus or earlier judge label, and nothing here is called gold.
export const R2_LABEL_SOURCE = 'gpt-6.1-sol-independent-review';
export const DRY_RUN_LABEL_SOURCE = 'dry_run_fixture_not_evidence';
export const LABEL_SOURCE_MODELS = Object.freeze({
  [R2_LABEL_SOURCE]: 'gpt-6.1-sol',
  'opus-5.5-limited-judge': 'claude-opus-5-5',
  human_review: null,
  synthetic_unreviewed: null,
  [DRY_RUN_LABEL_SOURCE]: null,
});
export const CRITICAL_ERRORS = ['semantic_false_acceptance', 'target_scope_error', 'mixed_meaning_loss',
  'stale_acceptance', 'authority_violation'];
// Development viewers and the r2 harness author can never be independent reviewers.
export const DEVELOPMENT_VIEWERS = ['PolarWatt', 'CopperHopper', 'BronzeMaxwell', 'IndigoDarwin'];
const REVIEW_ROLES = ['third_reviewer', 'cross_author_adjudication'];
const SLOTS = ['X', 'Y'];
const ARMS = ['jevFirst', 'lunaOnly'];
export const PACKET_SCHEMA = 'jev-unit0-blind-review-packet-v1';
export const REVIEW_SCHEMA = 'jev-unit0-blind-review-v1';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
export const canonicalJson = (value) => JSON.stringify(value, (_key, item) => isRecord(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
export const sha256Text = (value) => createHash('sha256').update(value).digest('hex');

function exactFields(value, required, optional = []) {
  assert.ok(isRecord(value), 'Expected an object.');
  assert.ok(required.every((key) => Object.hasOwn(value, key)), 'Missing field.');
  assert.ok(Object.keys(value).every((key) => required.includes(key) || optional.includes(key)), 'Unknown field.');
}

// Viewed scope is a required record of what the reviewer saw. An r2
// independent label must come from a reviewer who saw neither the
// implementation nor the development corpus nor the arm key.
export function validateLabelProvenance(label, { authors, stratum, dryRun = false }) {
  assert.ok(Object.hasOwn(LABEL_SOURCE_MODELS, label.source), 'Unknown label source.');
  assert.ok(text(label.reviewer), 'Reviewer identity is required.');
  assert.equal(label.model, LABEL_SOURCE_MODELS[label.source], 'Label model disagrees with its declared source.');
  if (dryRun) {
    assert.equal(label.source, DRY_RUN_LABEL_SOURCE, 'Dry-run labels must be marked as fixtures.');
  } else {
    assert.equal(label.source, R2_LABEL_SOURCE, 'Unit 0 r2 gates accept only the registered independent review source.');
  }
  exactFields(label.viewedScope, ['implementation', 'developmentCorpus', 'armKey', 'holdoutSets', 'outputs']);
  const scope = label.viewedScope;
  assert.equal(scope.implementation, false, 'Independent reviewer viewed the implementation.');
  assert.equal(scope.developmentCorpus, false, 'Independent reviewer viewed the development corpus.');
  assert.equal(scope.armKey, false, 'Reviewer saw the arm key; the review is not blind.');
  assert.equal(scope.outputs, 'blinded_packet');
  assert.ok(Array.isArray(scope.holdoutSets) && scope.holdoutSets.every((set) => ['B', 'C'].includes(set))
    && scope.holdoutSets.includes(stratum), 'Viewed sets must include the reviewed set.');
  assert.ok(!DEVELOPMENT_VIEWERS.includes(label.reviewer), 'Development viewers cannot provide independent labels.');
  assert.ok(REVIEW_ROLES.includes(label.role));
  const otherAuthor = authors[stratum === 'B' ? 'C' : 'B'];
  if (label.role === 'third_reviewer') {
    assert.ok(!Object.values(authors).includes(label.reviewer), 'A set author cannot be the fresh third reviewer.');
  } else {
    assert.equal(label.reviewer, otherAuthor, 'Only the other set author may adjudicate.');
  }
}

function validateLabelJudgment(label) {
  assert.ok(label.correct === null || typeof label.correct === 'boolean');
  assert.ok(Array.isArray(label.criticalErrors) && label.criticalErrors.every((item) => CRITICAL_ERRORS.includes(item))
    && new Set(label.criticalErrors).size === label.criticalErrors.length, 'Unknown critical error category.');
  if (label.criticalErrors.length) assert.equal(label.correct, false, 'A critical error cannot be judged correct.');
  if (label.correct === null) assert.equal(label.criticalErrors.length, 0, 'Unknown judgment cannot claim categories.');
  assert.ok(text(label.rationale), 'Joint review needs a rationale.');
  assert.ok(label.armClueDetected === null || typeof label.armClueDetected === 'boolean');
}

// The packet keeps only the semantic result, selected structurally by field:
// arm names, dispatch records, provider status, selected role, timing, usage,
// order and validation-error text (harness-owned metadata) are never copied.
// The semantic document and the case input are preserved in full, including
// any provider name the user quoted; content is never keyword-filtered.
// Residual clues inside the document (for example its shape) cannot be
// removed; they are a declared limitation and reviewers record armClueDetected.
function blindOutput(record) {
  const result = record.semanticResult;
  return { status: result.status, document: result.document, contextualDirective: result.contextualDirective,
    validationErrorCount: result.validationErrors.length };
}
// Harness-origin markers: the per-arm trace request ID the harness itself
// assigns. A marker in an output that is not present in the case input can
// only come from harness metadata, so it is a leak; user-origin text is not.
export const harnessArmMarkers = (caseId) => ARMS.map((arm) => 'ctx-paired-' + caseId + '-' + arm);
function assertNoHarnessMarker(item, outputs) {
  const input = JSON.stringify(caseInput(item));
  const text = JSON.stringify(outputs);
  for (const marker of harnessArmMarkers(item.id)) {
    assert.ok(!text.includes(marker) || input.includes(marker), 'Harness arm metadata leaked into a blinded output.');
  }
}

export function caseInput(item) {
  return { questionCode: item.questionCode, userText: item.userText, taskTitle: item.taskTitle,
    targetAmount: item.targetAmount, unitCode: item.unitCode, unitLabel: item.unitLabel,
    progressBasis: item.progressBasis === true };
}

// With `slots` (an existing key's mapping) the packet is rebuilt exactly, so a
// decision can prove the packet projects the very result being judged.
export function createBlindPacket({ roster, pairs, bindings, randomSlot = () => randomInt(2), slots = null }) {
  const pairIndex = new Map(pairs.map((pair) => [pair.caseId, pair]));
  const cases = [...roster.cases].sort((left, right) => codePointCompare(left.id, right.id));
  const key = {};
  const entries = cases.map((item) => {
    const pair = pairIndex.get(item.id);
    assert.ok(pair && pair.jevFirst?.observationComplete && pair.lunaOnly?.observationComplete,
      'Blind review requires every rostered pair to be completely observed.');
    const assigned = slots ? slots[item.id] : randomSlot() === 1 ? { X: 'lunaOnly', Y: 'jevFirst' } : { X: 'jevFirst', Y: 'lunaOnly' };
    assert.ok(assigned && ARMS.includes(assigned.X) && ARMS.includes(assigned.Y) && assigned.X !== assigned.Y, 'Arm key is missing a rostered case.');
    key[item.id] = { X: assigned.X, Y: assigned.Y };
    const outputs = { X: blindOutput(pair[assigned.X]), Y: blindOutput(pair[assigned.Y]) };
    assertNoHarnessMarker(item, outputs);
    return { caseId: item.id, set: item.stratum, group: item.group, input: caseInput(item), outputs,
      outputsIdentical: canonicalJson(outputs.X) === canonicalJson(outputs.Y) };
  });
  const keyDocument = { schemaVersion: 'jev-unit0-blind-key-v1', ...bindings, slots: key };
  const keySha256 = sha256Text(canonicalJson(keyDocument));
  const packet = { schemaVersion: PACKET_SCHEMA, ...bindings, keySha256, cases: entries,
    residualClues: ['semantic document shape may differ by route; reviewers record armClueDetected per label',
      'all reviewers share the gpt-6.1-sol model family; correlated judgment is a recorded limitation'],
    instructions: 'Judge each output X and Y against the frozen rubric jointly: target, quantity, unit, scope, negation, condition and every independent proposition. Fallback or agreement is not correctness. Unknown stays null.' };
  return { packet, packetSha256: sha256Text(canonicalJson(packet)), key: keyDocument, keySha256 };
}

// Import binds the review to the exact packet, key, corpus, runtime and
// result artifact. Every rostered case/arm needs a final label; missing,
// null and duplicate labels keep the gate unknown rather than being dropped.
export function importBlindReview({ review, packet, key, roster, dryRun = false }) {
  exactFields(review, ['schemaVersion', 'packetSha256', 'bindings', 'labels']);
  assert.equal(review.schemaVersion, REVIEW_SCHEMA);
  assert.equal(review.packetSha256, sha256Text(canonicalJson(packet)), 'Review is not bound to this packet.');
  assert.equal(packet.keySha256, sha256Text(canonicalJson(key)), 'Arm key does not match the packet.');
  for (const field of ['corpusSha256', 'runtimeSha256', 'policySha256', 'resultsSha256']) {
    assert.deepEqual(review.bindings[field], packet[field], 'Review binding differs: ' + field);
    assert.deepEqual(key[field], packet[field], 'Key binding differs: ' + field);
  }
  assert.ok(Array.isArray(review.labels));
  const authors = roster.authors;
  const caseIndex = new Map(roster.cases.map((item) => [item.id, item]));
  const primary = new Map();
  const adjudication = new Map();
  for (const label of review.labels) {
    exactFields(label, ['caseId', 'slot', 'correct', 'criticalErrors', 'source', 'reviewer', 'model',
      'viewedScope', 'role', 'rationale', 'armClueDetected']);
    const item = caseIndex.get(label.caseId);
    assert.ok(item && SLOTS.includes(label.slot), 'Unregistered case or slot.');
    validateLabelProvenance(label, { authors, stratum: item.stratum, dryRun });
    validateLabelJudgment(label);
    const target = label.role === 'third_reviewer' ? primary : adjudication;
    const id = label.caseId + ':' + label.slot;
    assert.ok(!target.has(id), 'Duplicate label.');
    target.set(id, label);
  }
  for (const id of adjudication.keys()) assert.ok(primary.has(id), 'Adjudication without a primary review.');
  const labels = new Map();
  for (const item of roster.cases) {
    for (const slot of SLOTS) {
      const id = item.id + ':' + slot;
      const label = adjudication.get(id) ?? primary.get(id) ?? null;
      const arm = key.slots[item.id]?.[slot];
      assert.ok(ARMS.includes(arm), 'Arm key is missing a rostered case.');
      labels.set(item.id + ':' + arm, label && { correct: label.correct, criticalErrors: label.criticalErrors,
        source: label.source, reviewer: label.reviewer, model: label.model, role: label.role,
        armClueDetected: label.armClueDetected });
    }
  }
  return labels; // caseId:arm → final label or null (unknown)
}
