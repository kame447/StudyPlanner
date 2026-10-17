# Japanese synthetic retrieval evaluation

This directory is an evaluation harness for Issue #294. Its fixture contains 37 synthetic `UserPlanningContextRecordV1`-shaped records for two synthetic owners and 36 Japanese queries. It contains no real user data. The vector path uses the shared `SemanticMemoryEmbedder` contract; deterministic fake results test wiring only and are **not quality evidence**.

## Query labels

| Label | Count | Human-review rationale |
| --- | ---: | --- |
| `exact_keyword_hit` | 8 | Record names, subject terms, and targets appear directly in the query. Checks the established lexical path. |
| `paraphrase` | 8 | The query expresses the same study goal, concern, preference, or event using different wording; includes “英語の試験で目指すスコア” → TOEIC goal. |
| `abbreviation_kana_kanji_variant` | 6 | Covers acronym pronunciation, kana/kanji conversion, number notation, and short forms. |
| `negative_unrelated` | 6 | Unrelated everyday requests have no expected record; retrievals count as false positives. |
| `trap_lifecycle_or_other_owner` | 8 | Similar revoked, superseded, archived, historical, or other-owner records are named as traps and must never be returned. Some cases also expect the current active record. |

Each query carries expected record IDs, trap IDs, and a short rationale in `fixtures/japaneseSyntheticCorpus.v1.json`. Review labels and relevance judgments before treating metric changes as quality improvements.

## Compared retrieval paths

- `lexical-baseline`: first restricts records to the requested owner and `active` status, then calls the existing `selectUserPlanningContextPromptRecordsV2`. Exact scope-key containment supplies its existing scope hint, and an evaluation-only character-bigram Dice score ranks the bounded selector output. This is not a production parser or a new semantic authority.
- `vector`: embeds active records for the requested owner and the query through `SemanticMemoryEmbedder`, then ranks by cosine similarity. It is a comparison candidate and does not replace lexical retrieval when unavailable.
- `hybrid-rrf`: evaluation-only reciprocal-rank fusion of the lexical and vector lists.

Metrics include macro recall@k and precision@k over positive queries, false-positive counts on negative queries, trap violations, average and maximum selected-record UTF-8 JSON bytes, indexing latency, and average/p50/p95 query latency. Latency is a local harness measurement, not a device performance claim.

The normal unit suite uses `DeterministicFakeEmbedder`. Its hash-bigram vectors are deliberately deterministic, but their scores and rankings are **not model-quality evidence**. The real-model comparison is skipped unless explicitly enabled and requires an adapter module exporting `createSemanticMemoryEvaluationEmbedder(): Promise<SemanticMemoryEmbedder>`:

```sh
SEMANTIC_MEMORY_EVAL_REAL_MODEL=1 \
SEMANTIC_MEMORY_EVAL_EMBEDDER_MODULE=/absolute/path/to/local-evaluation-adapter.ts \
node ./node_modules/vitest/vitest.mjs --config vite.config.mjs run src/features/userPlanningContext/semanticMemory/evaluation/realModel.optIn.test.ts
```

The adapter must use the local browser/device runtime and public model weights only. Never pass real user records, use a hosted embedding API, or treat a Vitest run as iPhone Safari evidence. Device/browser evidence must be recorded separately.
