# Adaptive Memory Learning implementation checkpoint

Status: closed / historical checkpoint
Completed with: PR #130
Merge commit: `71805eb5c55cd3a76be35c02fa4e21763ee8be18`

この文書は PR #130 時点の implementation checkpoint だった。現在の adaptive-memory 方針は `docs/ai/strategy/weekly-planning-adaptive-memory-learning-policy.md` を正とする。

維持する境界:
- current-week acceptance、durable preference、observed learning profile を分離する。
- proposal は user acceptance 前に scheduler へ適用しない。
- 暗記学習を vocabulary 固有 heuristic や固定 review interval へ縮退させない。

詳細な旧 checkpoint は Git history / PR #130 に残る。
