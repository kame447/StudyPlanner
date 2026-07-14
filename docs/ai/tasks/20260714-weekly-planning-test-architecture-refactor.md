# weeklyPlanningテスト体系の監査・再編

Status: ready
Priority: high
Scope: `src/features/weeklyPlanning/` 配下のテスト体系
Dependencies: DA0a完了、`main`反映済み
Production behavior change: prohibited

## 1. 目的

`src/features/weeklyPlanning/`では、過去の不具合ごとに追加された個別回帰テストが蓄積し、テスト総数が増加している。

一方で、現在のテスト群が次の問題を抱えている可能性がある。

同じ仕様をunit、pipeline、dialogue、integrationの複数層で重複して固定している。

個別の発話文や特定の入力例に依存しており、少し異なる入力や状態の組合せを網羅できていない。

production実装の内部構造に強く依存し、仕様を維持したリファクタリングでも大量に壊れる。

多数の例示テストが存在する一方で、順序不変性、冪等性、無関係な状態からの独立性、invalid isolationなどの一般的性質が保証されていない。

本タスクでは、既存production挙動を変更せず、weeklyPlanningのテストを契約テスト、property-based test、代表シナリオテストへ再編する。

単純なテスト件数削減を目的にしない。少ない具体例で広い状態空間と重要な不変条件を保証できる構成へ変更することを目的とする。

## 2. 絶対条件

本mdに書かれた範囲を超えないこと。

`src/features/weeklyPlanning/`のproductionコードの挙動を変更しないこと。

新しい対話仕様、readiness gate、missing resolution policy、DA0、DA1、DA1bの機能を先行実装しないこと。

既存テストが示しているproduction bugを、テスト削除によって隠さないこと。

テストを削除する前に、そのテストが保証していた仕様を別の契約テスト、property-based test、または代表シナリオテストが保証していることを確認すること。

snapshotや文言完全一致を増やさないこと。

テスト数を減らすためだけの巨大なparameterized testへ機械的にまとめないこと。失敗時に、どの性質が破れたのか判別できる粒度を維持すること。

Git add、commit、push、mergeを実行しないこと。

## 3. 対象範囲

主対象は次のディレクトリである。

```text
src/features/weeklyPlanning/**/*.test.ts
src/features/weeklyPlanning/**/__tests__/**/*.test.ts
```

weeklyPlanningのテストから直接利用されているtest helper、fixture、factoryも対象に含む。

property-based testing用ライブラリが既に導入されている場合は、そのライブラリを利用する。

導入されていない場合は、まず`package.json`とlock fileを確認する。`fast-check`の追加がrepository方針と矛盾しない場合に限りdevDependencyとして追加してよい。追加する場合は`package.json`と対応するlock file以外の依存関係を変更しないこと。

依存追加が禁止されている場合は、有限集合を用いたbounded exhaustive generationで同等の不変条件を検証する。ただし、独自の疑似property frameworkを大規模に実装しないこと。

## 4. 実施順序

### 4.1 テストインベントリの作成

最初にweeklyPlanning配下の全テストファイルを調査し、各テストを次の観点で分類する。

以下の4分類は同一レベルのテスト責務として扱う。

* 契約テスト
* property-based testへ置換可能な組合せテスト
* ユーザー導線を確認する代表シナリオテスト
* 個別回帰として残す必要があるテスト

各テストについて、少なくとも次を内部的に整理すること。

```text
テスト対象のproduction関数または境界
保証している仕様
入力が具体例に固定されている理由
同じ仕様を確認している他テスト
propertyへ一般化できるか
上位integrationでのみ確認すべき内容か
下位unitでのみ確認すべき内容か
```

調査だけで停止せず、その結果に基づいて本タスク内で再編まで実施すること。

### 4.2 重複の特定

同一のproduction責務を複数層で重複確認している箇所を特定する。

特に次を重点的に確認すること。

```text
同じ発話をparserとpipelineとdialogueで繰り返している
同じmissing状態を複数のintegration testで固定している
同じcandidate validationを異なるfixtureで繰り返している
同じfallback挙動を複数ファイルで確認している
同じplanning range解決をunitとintegrationで過剰に重複している
同じproposal validationを例だけ変えて繰り返している
文言の一部だけ異なるテストが大量に存在する
```

下位層の契約で十分に保証できる内容は下位層へ集約する。

上位層では、下位層の細部を再検証せず、境界間の接続だけを確認する。

## 5. 再編後のテスト責務

### 5.1 契約テスト

契約テストでは、有限なschema、validator、state transition、adapter、revision、fallback境界を厳密に確認する。

契約テストで主に保証する対象は次である。

```text
入力schemaとunknown field拒否
型境界とcanonicalization
slot、unit、value、reasonCodeの互換性
state transition
revisionの更新条件
stale、cross-user、cross-conversationの拒否
provider成功経路とprovider failure fallbackの分離
AI candidateとassumption proposal draftの分離
pending recordとlifecycle metadataの分離
```

一つの契約を複数のintegration testで繰り返さないこと。

### 5.2 Property-based test

既存productionコードに既に存在する不変条件だけをproperty化する。

将来実装予定のreadiness gateやDA0以降の仕様を、このタスクでproductionコードへ追加しないこと。

以下の性質を、該当するproduction関数ごとに検討する。

以下の各項目は、特定の入力例ではなく一般的な不変条件として概念上並列である。

* 決定性
  同じcanonical inputとcontextからは、毎回同じ結果、同じID、同じdiagnosticが得られる。

* 順序不変性
  順序が仕様上意味を持たない入力集合では、入力順を変更してもcanonical resultが変化しない。

* 冪等性
  同じproposal、command、fact、constraintを繰り返し与えても、重複recordや重複dependencyを生成しない。

* invalid isolation
  一件の無効なcandidate、draft、task、constraintが、別の有効な入力を消失させない。

* 無関係情報からの独立性
  判定対象と関係のないstate fieldやrecordを追加しても、対象結果が変化しない。

* mutation禁止
  validator、canonicalizer、selector、readiness相当のpure functionが入力objectや配列を変更しない。

* scope isolation
  別user、別conversation、別revision、private sourceを混在させても、現在scopeのcanonical stateへ昇格しない。

* duplicate stability
  同一入力を複数回含めても、結果集合が不必要に増加しない。

* normalization stability
  NFKC、前後空白、重複refの正規化後に、再度正規化しても結果が変わらない。

* conflict determinism
  同じtargetとslotに競合するpending proposalがある場合、入力順に依存せず定義された拒否結果になる。

* fallback preservation
  provider failureが発生しても、既存のsession-local stateが失われない。

property-based testは、単一の巨大なpropertyへまとめないこと。失敗時に性質を特定できる単位へ分ける。

generatorはproduction typeと実際のvalidator制約を反映すること。無効値だけを大量生成して、ほぼ全caseが即rejectされる無意味なpropertyにしないこと。

有効値generatorと無効値generatorを分離すること。

実行回数は通常のfull testで過剰な時間を消費しない値にする。失敗時にseedとshrunk counterexampleを再現できる構成にする。

### 5.3 代表シナリオテスト

ユーザー導線のintegration testは、主要経路だけを残す。

代表シナリオは、次のような機能上異なる経路を確認する。

```text
明示情報だけで通常previewへ進む経路
情報不足でclarificationへ進む経路
provider成功時にsingle AI interpreterを使う経路
provider failure時にrules fallbackへ移る経路
exam intakeの主要経路
non-exam intakeの主要経路
pending assumption stateを保持するDA0a経路
複数commandを同一turnで適用する経路
```

同じ経路の言い換えだけを多数残さないこと。

scenario testでは、ユーザー向け文言の完全一致を原則として確認しない。次を優先して検証する。

```text
decision kind
action kind
accepted commands
rejected commands
state
missing status
proposal status
revision
references
preview eligibility
responsePartsの構造
```

文言そのものが仕様である場合だけ、限定的な部分一致またはregistry keyを確認する。

### 5.4 個別回帰テスト

過去の具体的な不具合を示すテストは、次のいずれかに該当する場合だけ個別回帰として残す。

```text
一般propertyでは不具合の意味が読み取りにくい
境界条件が極めて具体的で、再発時の診断価値が高い
外部仕様または実ユーザー報告との対応を残す必要がある
複数層の相互作用によってのみ発生する
```

個別回帰として残す場合は、テスト名から何が壊れていたのか分かるようにする。

単なる言い換え、数値違い、曜日違い、配列順違いは、原則としてpropertyまたはparameterized contractへ統合する。

## 6. 削除・統合時の規則

既存テストを削除するときは、削除対象が保証していた仕様の移転先を確認すること。

一つの巨大なintegration testへ集約しないこと。

production内部のprivate helperをexportしてテストするためだけの変更を行わないこと。

テストの都合でproduction APIを変更しないこと。

fixtureの重複はfactoryへまとめてよい。ただし、factoryが大量の暗黙defaultを持ち、テスト入力が読めなくなる構造は避けること。

factoryのdefaultは、そのテストで重要でない値に限定する。重要な条件は各テスト内で明示する。

既存のskip、todo、real-model testは勝手に有効化または削除しない。内容を確認し、重複や陳腐化が明白な場合は最終報告へ記載する。

## 7. テスト名と配置

テスト名は、具体的な入力文ではなく保証する性質を表すようにする。

望ましい例:

```text
rejects source facts from a different state revision
preserves valid candidates when one candidate is invalid
canonicalization is independent of sourceFactRefs order
reapplying the same proposal does not create another record
provider failure preserves previous proposal state
```

避ける例:

```text
handles English study input
works with 30 minutes
test regression 4
returns expected result
```

property testは、対象production責務に最も近いtest fileへ配置する。

複数domainを横断するpropertyだけを専用の`*.property.test.ts`へ分離してよい。

property test専用ファイルを無制限に増やさないこと。

## 8. 完了条件

次の条件をすべて満たしたとき完了とする。

weeklyPlanning配下の全テストを調査している。

同じ仕様を重複して確認していたテストが整理されている。

具体例の列挙でしか保証していなかった重要な不変条件がproperty-based testへ移されている。

代表シナリオテストが主要経路ごとに少数へ整理されている。

個別回帰として残るテストに、残す合理的理由がある。

productionコードの挙動を変更していない。

削除したテストの保証内容が失われていない。

property testの失敗がseedまたはcounterexampleから再現できる。

full testとbuildが成功する。

`git diff --check`が成功する。

変更後のテスト総数、削除数、追加数、property数、scenario数を最終報告できる。

テスト総数の減少自体は必須の数値目標としない。ただし、明白な重複を残したまま「安全のため」として終了しないこと。

## 9. 検証

repositoryの既存scriptを確認したうえで、少なくとも次を実行する。

```bash
npm test -- --run src/features/weeklyPlanning
npm test -- --run
npm run build
git diff --check
git status -sb
```

lint scriptが存在し、現在のrepository運用で実行されている場合は追加で実行する。

property-based testを追加した場合は、対象property test単体も実行する。

テスト実行時間が再編前より極端に増加していないことを確認する。

## 10. 最終報告

最終報告には次を含める。

以下の項目は、実施結果を示す並列の報告項目である。

* 変更したテストファイル
* 新規作成したtest helperまたはproperty generator
* 削除または統合したテスト数
* 追加したpropertyと、それぞれが保証する不変条件
* 残した個別回帰テストと、残した理由
* 変更前後のweeklyPlanningテスト件数
* targeted test結果
* weeklyPlanning全体test結果
* full test結果
* build結果
* `git diff --check`結果
* productionコードを変更していないこと
* scope外として発見したテスト不足またはproduction設計上の問題

最終報告で「すべて網羅した」と断定しないこと。

何を一般化して保証できるようになったか、何が代表シナリオまたは個別回帰として残っているかを明確に区別すること。
