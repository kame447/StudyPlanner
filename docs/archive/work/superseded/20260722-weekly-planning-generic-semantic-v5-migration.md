# 汎用semantic V5 migration

Status: superseded / runtime connection completed, adoption work consolidated
Superseded: 2026-07-28
Replacement: `../20260728-weekly-planning-stable-v5-verification-and-cutover.md`

Stable V5 direct schema、validator、canonicalizer、Fact Graph、generic scheduler input、dialogue、preview、owner-bound persistence、feature-flagged runtime接続はPR #77、#79、#83、#86で実装済みである。

旧本文はPR #77をDraft・production未接続としており現状と一致しない。一方、actual AI real-eval、browser roleplay、migration decoder、shadow、rollback、default cutover、legacy deletionは未完了である。

残件をreplacement taskへ統合し、実装済みruntime migrationとadoption gateを分離した。