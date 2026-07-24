# PR #83 branch consolidation archive manifest

Status: archived / non-executable / branch deletion gate
Updated: 2026-07-24
Canonical work PR: #83
Canonical branch: `agent/stable-v5-trace-conversation-continuity`
Comparison baseline before archive: `34333f6ef58c8fe1a78927d8660bcbf7b715a7e8`
Main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

## 目的

PR #82、#84、#85を削除する前に、それぞれにしか存在しなかった監査・workflow・診断scriptをPR #83の履歴へ保存する。archive配下のscriptは`.txt`として保存し、package script、Cloudflare Pages、GitHub Actionsから実行されない。

## 保存元

### PR #82

```text
branch: fix/weekly-planning-trace-conversation-continuity
head: 0883b921b5c1e242f85150ee87bba7e899f10fd1
commits: 15
changed files: 11
```

保存物:

```text
source: .github/workflows/pr82-weekly-planning-trace-continuity.yml
blob: b7e45d23e5655feba06323616f59e5ac7c2edeed
archive: archive/pr82/workflow-pr82-weekly-planning-trace-continuity.yml.txt

source: docs/ai/audits/20260724-trace-conversation-continuity/seven-view-audit.md
blob: 32d61d83304f68b473d12ef7b9765ae76e31b468
archive: archive/pr82/seven-view-audit.md
```

PR #82のruntime実装はPR #83でworking copyをappend成功後だけcommitする方式へ更新されている。旧監査に記録されたappend前counter保存とat-most-once判断はcurrent contractではないが、設計判断の履歴として保存する。

### PR #84

```text
branch: agent/pr83-verification-complete-2
head: 9a550ce2c8487d3e693f17c4919ecffd420c173a
commits: 98
changed files: 35
```

35ファイルをPR #83の固定headとblob SHAで照合した。30ファイルは完全一致し、production code、tests、七視点監査、canonical documentsの欠落はない。異なっていたのは`package.json`と一時検証4ファイルだけである。

保存物:

```text
source: scripts/cloudflare-diagnostic-range.mjs
blob: d884cd4a2e8b144651f7dfff1a2460179e176b3a
archive: archive/pr84/cloudflare-diagnostic-range.mjs.txt

source: scripts/cloudflare-typecheck-isolate.mjs
blob: da4a87eb7d938440c745e0a555fdb2bbca14ba4e
archive: archive/pr84/cloudflare-typecheck-isolate.mjs.txt

source: scripts/cloudflare-verify-focused.mjs
blob: e3127f4db0e3122f64f993d70190bd5e3c5d54d5
archive: archive/pr84/cloudflare-verify-focused.mjs.txt

source: scripts/.verification-trigger
blob: 66bae206a7605dc91768f4a98375aa4821752dd4
archive: archive/pr84/verification-trigger.txt
```

### PR #85

```text
branch: agent/stable-v5-trace-diagnostics
head: 14aff049fdb8de80a51974babc4e6ccf3bd64b64
commits: 1
changed files: 1
```

保存物:

```text
source: scripts/cloudflare-verify-focused.mjs
blob: 0c83dc717a7219d08c462b1c435feddcb5cf94d1
archive: archive/pr85/cloudflare-verify-focused.mjs.txt
```

### PR #83から除去した一時検証物

```text
source head: 34333f6ef58c8fe1a78927d8660bcbf7b715a7e8
source: scripts/cloudflare-verify-full.mjs
blob: 88821755731d551bb7f80ba6ee43413948ba2369
archive: archive/pr83/cloudflare-verify-full.mjs.txt
```

`package.json`の`build`は`vite build --config vite.config.mjs`へ復元し、blob `596e56ad871a88cd1977e3204486f85b10b763f6`となった。rootの`cloudflare-verify-full.mjs`は削除した。

## 退避照合結果

PR #83 head `9c923c4733079252a4bcfc04012a5a945f8040bb`で退避内容を再読込し、次のblob SHAが退避元と完全一致することを確認した。

```text
PR82 workflow: b7e45d23e5655feba06323616f59e5ac7c2edeed
PR82 audit: 32d61d83304f68b473d12ef7b9765ae76e31b468
PR84 diagnostic range: d884cd4a2e8b144651f7dfff1a2460179e176b3a
PR84 typecheck isolate: da4a87eb7d938440c745e0a555fdb2bbca14ba4e
PR84 focused verification: e3127f4db0e3122f64f993d70190bd5e3c5d54d5
PR84 trigger: 66bae206a7605dc91768f4a98375aa4821752dd4
PR85 controller diagnostic: 0c83dc717a7219d08c462b1c435feddcb5cf94d1
PR83 temporary verification: 88821755731d551bb7f80ba6ee43413948ba2369
```

同headの`package.json`はmainと同じblob `596e56ad871a88cd1977e3204486f85b10b763f6`である。`scripts/cloudflare-verify-full.mjs`は存在しないことを確認した。

整理開始head `34333f6ef58c8fe1a78927d8660bcbf7b715a7e8`から上記headまでの変更は、archive追加、監査文書同期、`package.json`正常化、一時scriptのarchive移動だけである。production TypeScriptおよびtest sourceは整理作業では変更していない。

## branch削除gate

次をすべて満たした後だけ旧branchを削除する。

```text
archive pathの存在確認
archive内容のblobまたは本文照合
PR #83のproduction codeとtestsに旧branch固有の未移植差分がない
package.jsonが通常Vite buildを使用
root scriptsに一時Cloudflare検証scriptが残っていない
PR本文と七視点監査がcurrent implementationへ同期
PR #83のheadを再固定して旧branch headと最終比較
ローカルfocused tests、full Vitest、typecheck、Vite build、git diff --checkが成功
```

GitHub Actionsの利用枠が使用できないため、自動workflowの成功を削除条件にしない。ローカル検証結果を正本として記録する。検証未実施または失敗中はPR #83をDraft・merge不可とし、旧branchも削除しない。
