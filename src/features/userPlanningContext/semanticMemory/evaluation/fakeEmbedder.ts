import type { SemanticMemoryEmbedder, SemanticMemoryModelDescriptor } from '../semanticMemoryContract';

/**
 * Deterministic hashing fake for wiring/math tests only. Its rankings and
 * measurements are NOT retrieval-quality evidence for any embedding model.
 */
export class DeterministicFakeEmbedder implements SemanticMemoryEmbedder {
  readonly backend = 'wasm' as const;
  readonly model: SemanticMemoryModelDescriptor = {
    modelId: 'evaluation-only/deterministic-hash-fake',
    revision: 'synthetic-fixture-v1',
    dimensions: 256,
    queryPrefix: '',
    passagePrefix: '',
    maxWeightBytes: 0,
  };

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const normalized = Array.from(text.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s/g, ''));
      const vector = new Float32Array(this.model.dimensions);
      if (normalized.length === 1) addFeature(vector, normalized[0]);
      for (let index = 0; index < normalized.length - 1; index += 1) {
        addFeature(vector, `${normalized[index]}${normalized[index + 1]}`);
      }
      return vector;
    });
  }

  async dispose(): Promise<void> {
    // No runtime resources are allocated by this synthetic fake.
  }
}

function addFeature(vector: Float32Array, feature: string): void {
  let hash = 2166136261;
  for (const character of feature) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  vector[(hash >>> 0) % vector.length] += 1;
}
