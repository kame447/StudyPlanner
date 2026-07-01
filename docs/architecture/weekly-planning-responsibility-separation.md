# Weekly Planning Responsibility Separation

Phase 9.3 の実装に入る前の調査・設計メモです。目的は、自然言語処理、weekly domain、scheduler、UI の責務を分け、今後の「使わない時間帯・日を避ける」や教材タイプ拡張を重複実装にしないことです。

## 1. 現状の責任分離

現在の週間計画まわりは、大きく次の層に分かれています。

- `src/components/NaturalLanguageAssistant.tsx`
  - 通常AI入力と週間計画モードを切り替える。
  - 週間計画では `runWeeklyPlanningIntakePipeline` を呼び、dialogue message と preview / draft 操作を扱う。
- `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`
  - userText を受け取り、intake reducer、draft request adapter、remaining work items、dry-run candidate generator、dialogue decision を順に呼ぶ。
- `src/features/weeklyPlanning/intake/`
  - `PlanningIntakeState` と、その state を更新する reducer / parser helper / adapter を持つ。
- `src/features/weeklyPlanning/scheduling/`
  - 新 intake path の `weeklyDraftCandidateGenerator.ts` と、既存 availability-aware path の `availabilitySlots.ts`, `placementScoring.ts`, `sessionChunking.ts` を持つ。
- `src/features/weeklyPlanning/preview/`
  - `WeeklyDraftCandidate` を preview / `WeeklyPlanDraftBlock` に変換する。
- `src/services/natural-language/`
  - 通常予定向けの staged NLP pipeline。normalize, tokenize, clause parsing, AST, IR lowering, compile, validate の段階を持つ。

既存の通常自然言語パイプラインは「文章 -> schedule IR -> suggestion / PlanDraft」に寄っています。一方、新しい週間計画 intake は「文章 -> 直接 PlanningIntakeState 更新」に近い構造です。

## 2. 問題点

### parsing と state 更新が近い

`weeklyPlanningIntakeReducer.ts` は以下を同じ関数内で行っています。

- 週末 planning range の抽出
- exam scope の merge
- priority policy の parse と state 反映
- progress hint / completed years の parse と state 反映
- unit rate の parse と state 反映
- life constraints / fixed events の parse と state 反映
- missing の追加・削除
- 通常の `assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision` への fallback
- `finalizeState`

そのため、自然言語表現が増えるたびに reducer が太りやすく、domain state の更新ルールと日本語 parser の細部が同じ場所に入りがちです。

### parser helper は state までは更新しないが domain 型に寄っている

`weeklyPlanningCompletionParsing.ts`, `weeklyPlanningConstraintParsing.ts`, `weeklyPlanningPriorityParsing.ts` は `PlanningIntakeState` を直接 mutate していません。この点は良い分離です。

ただし、返り値はすでに `StudyProgress`, `LifeConstraint`, `PriorityPolicy` など weekly domain 型に近いです。これは小さいうちは便利ですが、参考書ページ、単語数、問題番号、レポート工程などが増えると、parser が domain model の具体形を知りすぎる危険があります。

### yearRange が exam prep 専用

現在の `ExamPrepScope.yearRange` と `StudyProgress.completedYears` は過去問年度に強く寄っています。将来扱いたい単位は年度だけではありません。

- 過去問: 年度
- 参考書: ページ範囲
- 単語帳: 単語数、範囲、章
- 問題集: 問題番号、章、セット
- レポート: 調査、構成、執筆、推敲、提出などの工程

このまま `yearRange` を増築すると、各教材タイプごとの特別ケースが `PlanningIntakeState` に散らばります。

### 通常予定と週間計画の分岐が「週間っぽさ」に寄っている

`NaturalLanguageAssistant.handleAnalyze` は `looksLikeWeeklyPlanningRequest(text)` で通常AI入力から週間計画っぽい入力を弾きます。現状は安全ですが、将来的には「単発 / 複数」ではなく「配置が明確か / 最適化が必要か」で分けるべきです。

複数予定でも、日時と配置が明確なら通常予定ルートで扱えます。逆に単一テーマでも、総量配分、進捗管理、生活制約、優先順、最適化が必要なら週間計画ルートが自然です。

## 3. 目指す責任分離

目標は次の流れです。

```text
userText
-> natural language pipeline
-> ParsedWeeklyPlanningCommand[]
-> weekly domain reducer
-> PlanningIntakeState / WeeklyPlanningState
-> draft request / remaining work
-> scheduler
-> candidates / diagnostics
-> UI preview / draft / approval / save
```

責務の境界:

- 自然言語処理パイプラインは、文章から意味を抽出し、weekly domain が理解できる command / parsed intent を作る。
- weekly domain は、課題進捗、生活制約、優先順、残り作業、missing / ambiguity を管理する。
- scheduler は、残り作業と制約を受け取り、候補配置と diagnostics を作る。
- UI は、preview / draft / approval / save の表示と操作を担当する。

自然言語処理は、課題進捗状態や生活状態や配置最適化を直接保持しません。weekly domain は、日本語表現の細かい正規表現を直接抱え込みすぎないようにします。

## 4. 自然言語処理パイプラインの責任

自然言語処理側の責任:

- 入力テキストの正規化
- 文・節・句の分割
- 日付、曜日、時間帯、期間、量、単位の抽出
- 否定、未完了、予定、条件、曖昧表現の polarity / modality 判定
- field / subject / material / task label の候補抽出
- weekly domain に渡せる command への変換
- confidence / source segment / ambiguity reason の付与

自然言語処理側が持たないもの:

- `PlanningIntakeState` 全体
- completed / remaining の最終 truth
- fixed events missing の解消判定
- draft_ready 判定
- 配置候補の生成
- 保存状態

通常自然言語パイプラインの staged 構造は参考になります。`src/services/natural-language/index.ts` には `normalizeText -> tokenize -> parseClauses -> buildAST -> lowerToIR -> compileToSuggestions -> validateAndDedupe` があります。週間計画でも、この pipeline をそのまま流用する必要はありませんが、「文章解釈」と「domain state 更新」を段階で分ける考え方は揃えるべきです。

## 5. weekly domain の責任

weekly domain 側の責任:

- `ParsedWeeklyPlanningCommand[]` を順に適用する。
- `PlanningIntakeState` / 将来の `WeeklyPlanningDomainState` を保持する。
- task scope、progress scope、unit rate、priority policy、constraints を merge する。
- field scope なし completed units を全 task に適用しない。
- missing / ambiguity / shouldCreateDraft / shouldSavePlan を決める。
- draft request を作れる状態か判断する。
- remaining work items を作る。

weekly domain は「数学」「ソフトウェア」などの label や、`year`, `page`, `word`, `problem`, `stage` などの進捗単位を扱ってよいです。ただし、日本語の表現ゆれ、例えば「終わってた」「済んだ」「やる予定」「終わったら」は command 生成側に寄せるのが望ましいです。

## 6. scheduler の責任

scheduler 側の責任:

- remaining work items を session chunks に分割する。
- fixed events / unavailable / life constraints / existing plans / timetable busy intervals を避ける。
- available ranges の中から候補 slot を探す。
- priority order を維持する、または scoring に反映する。
- quality preferences を scoring に反映する。
- unscheduled items と conflict diagnostics を返す。

scheduler が持たないもの:

- 日本語 text parsing
- user conversation state
- missing / clarification の文章
- save / approval side effects

現状は scheduler が二系統あります。

- 既存 availability-aware path:
  - `availabilitySlots.ts`
  - `placementScoring.ts`
  - `weeklyPlanningTransforms.ts`
  - `WeeklyPlanningDefaultConditions.availableStudyRanges / unavailableRanges`
- 新 intake dry-run path:
  - `weeklyDraftCandidateGenerator.ts`
  - `LifeConstraint[]` / `fixedEvents[]` を busy interval に変換

長期的には、new intake path も availability slot model を再利用するか、少なくとも unavailable / existing busy interval の型を合わせる方がよいです。

## 7. UI の責任

UI 側の責任:

- 通常AI入力と週間計画モードの入口を切り替える。
- dialogue decision を日本語 message にして表示する。
- preview blocks / draft blocks を表示する。
- preview から未承認 draft へ昇格する操作を提供する。
- 一括承認、一括破棄、個別削除をユーザー操作として実行する。

UI が持たないもの:

- 日本語 parser の細部
- progress merge ルール
- completed units の field scope 解決
- scheduler の slot search
- 保存するかどうかの自動判断

`NaturalLanguageAssistant.tsx` は現在、会話 state と preview 操作の UI state を持っています。これは UI state として妥当ですが、今後 parser / command / reducer の分岐を component 内に増やしすぎないことが重要です。

## 8. 通常予定ルートと週間計画ルートの分岐基準

方針:

- 通常予定ルートは単発限定ではない。
- 複数予定でも、日時・配置が明確なら通常予定ルートで扱う。
- 週間計画ルートは、総量配分・進捗管理・生活制約・優先順・最適化が必要な場合に使う。

通常予定ルート向き:

- 「明日19時から数学を1時間」
- 「月水金の7時から英単語を30分」
- 「土曜13時から過去問を2時間、日曜10時から復習を1時間」
- 「4月中の平日7時から30分英語」

週間計画ルート向き:

- 「今週末で院試過去問の残りを進めたい」
- 「2019〜2025のうち数学は25〜21まで終わってる」
- 「ソフトウェアを後ろに回して」
- 「風呂や食事、固定予定を避けて残りを配置して」
- 「単語帳を今週で300語進めたい。1日ごとに分けて」

判断軸:

| 軸 | 通常予定 | 週間計画 |
| --- | --- | --- |
| 日時 | 明確 | 未確定・範囲だけ |
| 作業量 | 1予定に落ちる | 総量を分配する |
| 進捗 | 不要 | 必要 |
| 制約 | 既に時刻指定済み | 生活制約や固定予定を考慮 |
| 優先順 | 入力順で十分 | 方針として管理 |
| 出力 | `PlanDraft` suggestion | preview / draft candidates |

## 9. 課題タイプ / 進捗単位の一般化案

現在の `ExamPrepScope.yearRange` は、次のような一般モデルに寄せる余地があります。

```ts
type TaskProgressUnitKind =
  | 'exam_year'
  | 'page'
  | 'word_count'
  | 'problem_number'
  | 'chapter'
  | 'lesson'
  | 'report_stage'
  | 'custom';

interface TaskProgressScope {
  taskId?: string;
  label: string;
  materialType?: 'past_exam' | 'textbook' | 'vocabulary' | 'workbook' | 'report' | 'custom';
  unitKind: TaskProgressUnitKind;
  range?: {
    start: number | string;
    end: number | string;
    order: 'ascending' | 'descending' | 'custom';
    sourceText?: string;
  };
  units?: Array<number | string>;
  fields?: string[];
  rawText?: string[];
}

interface TaskProgressRecord {
  scopeId?: string;
  field?: string;
  completedUnits: Array<number | string>;
  incompleteUnits?: Array<number | string>;
  ambiguity?: 'field_scope' | 'range_direction' | 'unit_scope' | 'none';
  sourceTurnId?: string;
  sourceText?: string;
}
```

対応例:

| 課題タイプ | unitKind | range / units |
| --- | --- | --- |
| 過去問 | `exam_year` | `2019..2025`, descending |
| 参考書 | `page` | `1..120`, ascending |
| 単語帳 | `word_count` | `1..300` or count-based chunks |
| 問題集 | `problem_number` | `1..80`, ascending |
| レポート | `report_stage` | `['調査', '構成', '執筆', '推敲', '提出']` |

ポイント:

- 自然言語 parser は「2020」「p.120」「300語」「1〜20番」「構成まで終わった」を command にする。
- weekly domain は、その command を task scope / progress record に merge する。
- remaining work items は `unitKind` に応じて作る。
- scheduler は `estimatedMinutes` を持った work item を配置するだけにする。

## 10. ParsedWeeklyPlanningCommand の設計案

自然言語処理パイプラインから weekly domain へ渡す command の例です。実装名は仮です。

```ts
type ParsedWeeklyPlanningCommand =
  | {
      type: 'set_task_scope';
      scope: TaskProgressScope;
      confidence: 'high' | 'medium' | 'low';
      sourceText: string;
      sourceSegment?: string;
    }
  | {
      type: 'mark_completed_units';
      target: {
        field?: string;
        taskLabel?: string;
        materialLabel?: string;
      };
      unitKind: TaskProgressUnitKind;
      units: Array<number | string>;
      polarity: 'completed';
      confidence: 'high' | 'medium' | 'low';
      ambiguity?: 'field_scope' | 'unit_range' | 'direction';
      sourceText: string;
    }
  | {
      type: 'set_unit_rate';
      unitKind: TaskProgressUnitKind;
      minutesPerUnit: number;
      unitLabel?: string;
      source: 'user' | 'assumption' | 'default';
      sourceText: string;
    }
  | {
      type: 'add_fixed_event';
      event: {
        date?: string;
        start?: string;
        end?: string;
        durationMinutes?: number;
        label?: string;
        hardness: 'hard' | 'soft';
      };
      sourceText: string;
    }
  | {
      type: 'add_unavailable';
      range: {
        date?: string;
        start?: string;
        end?: string;
        reason: string;
        hardness: 'hard' | 'soft';
      };
      sourceText: string;
    }
  | {
      type: 'set_priority_policy';
      policy: PriorityPolicy;
      sourceText: string;
    }
  | {
      type: 'update_life_constraint';
      constraint: LifeConstraint;
      mergeStrategy: 'replace_same_kind' | 'append';
      sourceText: string;
    }
  | {
      type: 'ask_clarification';
      reason:
        | 'field_scope'
        | 'unit_scope'
        | 'completion_polarity'
        | 'date_resolution'
        | 'duration_missing';
      questionKey: string;
      sourceText: string;
    };
```

補足:

- `ask_clarification` は UI message ではなく domain が理解する clarification intent として扱う。
- `sourceText` / `sourceSegment` / confidence は ML 評価や regression test に使える。
- command は stateless で、現在の state を直接持たない。

## 11. 段階的リファクタ案

### Step 1: command type を追加する

`intake/weeklyPlanningCommandTypes.ts` のようなファイルを作り、`ParsedWeeklyPlanningCommand` の最小型を定義する。最初は既存機能だけでよいです。

- `set_task_scope`
- `mark_completed_units`
- `set_unit_rate`
- `add_fixed_event`
- `add_unavailable`
- `set_priority_policy`
- `update_life_constraint`
- `ask_clarification`

### Step 2: parser helper の返り値を command に寄せる

既存 parser helper を一気に消さず、adapter を挟みます。

- `parseCompletedYearDirection` -> `mark_completed_units`
- `parseCompletedSingleYearRevision` -> `mark_completed_units`
- `parseConstraints` -> `add_fixed_event` / `update_life_constraint` / `add_unavailable`
- `parsePriorityPolicy` -> `set_priority_policy`
- `parseUnitRate` -> `set_unit_rate`

### Step 3: reducer を command reducer に薄くする

`applyWeeklyPlanningUserTurn(previousState, userText, context)` は当面残しますが、内部を次の形に近づけます。

```text
parseWeeklyPlanningCommands(userText, context, previousStateSummary)
-> applyWeeklyPlanningCommands(previousState, commands)
-> finalizeState
```

`applyWeeklyPlanningCommands` は日本語を知らない関数にします。

### Step 4: progress scope を一般化する

`ExamPrepScope.yearRange` をすぐ消さず、次の互換層を作ります。

- `ExamPrepScope.yearRange` を `TaskProgressScope(unitKind: 'exam_year')` へ変換できる helper を追加する。
- remaining work item generator を `year_field_chunk` 固定から `unitKind` ベースへ段階的に広げる。

### Step 5: scheduler input を一般化する

`WeeklyPlanningRemainingWorkItem` は現在 `field`, `year`, `estimatedMinutes` 固定です。これを将来的に以下へ広げます。

```ts
interface WeeklyPlanningWorkItem {
  key: string;
  taskLabel: string;
  field?: string;
  unitKind: TaskProgressUnitKind;
  unitValue: number | string;
  estimatedMinutes: number;
  source: 'weekly_domain';
}
```

Phase 9.3 ではここまで広げず、まず `unavailable` の command 化から始めるのが安全です。

## 12. すぐに実装すべきでないこと

- 通常自然言語 pipeline と weekly intake を一気に統合すること。
- `PlanningIntakeState` を全面置換すること。
- scheduler 本体を大改造すること。
- UI component 内に command 判定や parser 分岐を増やすこと。
- ML / RNN / 強化学習を planning state の直接更新役にすること。
- `yearRange` を消す大規模 migration。
- preview 後に候補を UI 側でフィルタして constraint 適用済みのように見せること。
- `shouldSavePlan` を true にする自動保存導線。

## 13. Phase 9.3 を実装するならどの層に何を追加するべきか

「使わない時間帯・日を避ける」を Phase 9.3 で入れるなら、最小追加は次です。

### 自然言語 / command 層

追加対象:

- `weeklyPlanningConstraintParsing.ts` か、新規 `weeklyPlanningAvailabilityParsing.ts`
- 可能なら command 型 `add_unavailable` の小さな導入

扱う表現:

- 「夕方は使わないで」
- 「午前は使わないで」
- 「夜は使わないで」
- 「14時から16時は使わないで」
- 「日曜は空けて」
- 「7月3日は使わないで」

ここでは文章を `LifeConstraint.kind = 'unavailable'` または `ParsedWeeklyPlanningCommand.type = 'add_unavailable'` に変換するだけにします。

### weekly domain 層

追加対象:

- `applyWeeklyPlanningUserTurn` 内の constraint merge
- 将来なら `applyWeeklyPlanningCommands`

やること:

- hard unavailable を `constraints` に追加する。
- 曖昧な日付・時間帯は確定せず ambiguity / clarification に回す。
- existing life constraints / fixed events と混ぜすぎない。
- `shouldSavePlan: false` を維持する。

### scheduler 層

追加対象:

- `weeklyDraftCandidateGenerator.ts` の既存 `constraintToBusyInterval`
- 必要なら tests only で all-day unavailable を確認

やること:

- `kind: 'unavailable'` で `date + start + end` があるものを busy interval として避ける。
- `date + 00:00-24:00` で日単位 exclusion を表す。
- candidate 生成後に削るのではなく、slot 探索前に避ける。

### UI 層

追加しない。

UI は dialogue message と preview 再生成結果を表示するだけでよいです。WeekView / DayView / DayTimeline / CSS は触らない方針です。

### テスト

追加候補:

- `weeklyPlanningIntakeEdgeCases.test.ts`
  - time-band unavailable parse
  - day unavailable parse
  - ambiguous unavailable wording does not hard-confirm
- `weeklyPlanningIntakePipeline.test.ts`
  - preview 後の「日曜は空けて」で remaining / candidates が再生成される
  - `shouldSavePlan` が false のまま
- `weeklyDraftCandidateGenerator.test.ts`
  - unavailable interval と候補が重ならない
  - all-day unavailable date に候補が出ない

## Summary

Phase 9.3 の最小方針は、「自然言語から unavailable command / constraint を作り、weekly domain state に反映し、scheduler の busy interval として候補生成前に避ける」です。

通常予定ルートは単発限定ではありません。日時・配置が明確な複数予定は通常予定ルートで扱い、総量配分・進捗管理・生活制約・優先順・配置最適化が必要な入力だけ週間計画ルートに送るのが長期的に自然です。

## 14. Phase 9.4b command boundary audit

Phase 9.4a では、unavailable parsing、constraint identity / dedupe、date-less unavailable の scheduler 展開を helper に切り出した。これにより、Phase 9.3 で増えた処理は読みやすくなったが、まだ `ParsedWeeklyPlanningCommand[]` を境界にした完全な責務分離にはなっていない。

### Phase 9.4a 後に改善された責務

- `weeklyPlanningUnavailableParsing.ts` が daypart、日付解決、hard / uncertain unavailable 判定、`unavailable` constraint 作成を受け持つようになった。
- `weeklyPlanningConstraintIdentity.ts` が `LifeConstraint` の identity、dedupe、merge を受け持つようになり、reducer から重複判定の細部を外せた。
- `weeklyPlanningConstraintScheduling.ts` が date-less unavailable を planning days に展開する責務を受け持つようになり、dry-run generator から unavailable 固有の展開 loop を外せた。
- `weeklyDraftCandidateGenerator.ts` は、展開済み constraints を busy interval に変換し、候補生成前に避ける責務に寄った。candidate 生成後の post-filter は使っていない。

### まだ残っている責務混在

#### `weeklyPlanningConstraintParsing.ts`

このファイルは parsing helper としては薄くなったが、返り値はまだ `LifeConstraint` という weekly domain 型である。つまり、自然言語から次の domain state fragment を直接作っている。

- `LifeConstraint.kind = 'unavailable'`
- `LifeConstraint.kind = 'fixed_event'`
- `LifeConstraint.kind = 'meal' | 'bath' | 'sleep' | 'buffer'`

将来的には、ここは `ParsedWeeklyPlanningCommand` の生成へ寄せる余地がある。たとえば `unavailable` は `add_unavailable`、食事・風呂・睡眠は `update_life_constraint`、固定予定は `add_fixed_event` に分けると、parser は domain state の shape を直接知らなくて済む。

ただし、現時点では `LifeConstraint` が command payload とほぼ同じ粒度なので、全面置換するよりも command adapter を1層足す方が安全である。

#### `weeklyPlanningIntakeReducer.ts`

reducer は state merge / missing 更新 / finalize を担当しているが、まだ parser 呼び出しと domain state 更新が同じ関数内に直列で並んでいる。

残っている parser 的責務:

- `parseWeekendRange` が reducer 内にあり、「今日19時」「土日の終わり」などの日本語表現を直接見ている。
- `parseYearRange` / `parseTotalYears` / `parseTotalFields` / `extractExamFields` が reducer 内にあり、exam prep scope parsing と state merge が近い。
- `知らない分野.*時間かかる|細かく見る.*時間かかる` の uncertainty 判定が reducer 内に残っている。
- `looksLikeWeeklyPlanningRequest` / `assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision` fallback が reducer 内にあり、旧 weekly parser と新 intake reducer の境界がまだ混ざっている。

次の段階では、reducer が `ParsedWeeklyPlanningCommand[]` を順に apply する形に寄せ、自然言語 parser 呼び出しは `parseWeeklyPlanningUserTurnToCommands` のような adapter に寄せるのがよい。

#### `weeklyPlanningUnavailableParsing.ts`

この helper は parser 層としておおむね適切に閉じている。scheduler の slot search や busy interval の事情は持っていない。一方で、返り値が `LifeConstraint` なので、weekly domain 型に直接依存している。

短期的には許容できるが、command boundary を入れるなら、このファイルは `ParsedWeeklyPlanningCommand.type = 'add_unavailable'` の payload を返すか、`parseUnavailableConstraint` の結果を command adapter が `add_unavailable` に包む形がよい。

#### `weeklyPlanningConstraintIdentity.ts`

identity / dedupe / merge は domain reducer の補助として妥当である。parser や scheduler には依存していない。ここは command boundary 導入後も、domain reducer 内で command payload を state に反映するときに再利用できる。

注意点として、identity は `rawText` を含めない。これは「夕方は使わないで」と「夕方は除外」のような同じ意味の constraint を重複させないためであり、parser 文言ではなく domain identity に基づく判断として妥当である。

#### `weeklyPlanningConstraintScheduling.ts`

date-less unavailable を planning days に展開する責務は scheduler 側として妥当である。日本語表現は持っておらず、`LifeConstraint.kind === 'unavailable'` と `date` の有無だけを見る。

この層は、将来的に command boundary を入れても変えずに済む可能性が高い。domain state に `unavailable` constraint が保持されていれば、scheduler は同じように planning range 上へ展開できる。

### 通常予定ルートと週間計画ルートの分岐確認

現在、通常入力側では `NaturalLanguageAssistant.handleAnalyze` が `looksLikeWeeklyPlanningRequest(text)` を見て、週間計画っぽい入力を通常 suggestion ルートから弾いている。実装上の判定は、`今週|来週|週間|週` を含み、かつ `N時間` が2回以上ある場合に true になる。

この条件は比較的狭い。少なくとも「明日19時から英語を1時間」のような日時が明確な単発予定は週間計画扱いにならない。また、複数予定であっても `来週、英語を3時間、数学を2時間` のような総量配分型は週間計画に寄る。

今後のリスク:

- 複数予定でも日時・配置が明確な入力を、単に `週` と複数 duration だけで週間計画扱いにすると過剰吸収になる。
- 逆に「テスト対策したい」「今週末で過去問を進めたい」のように duration が明示されない planning intent は、この関数だけでは拾いにくい。

方針は維持する。

- 通常予定ルートは単発限定ではない。
- 複数予定でも日時・配置が明確なら通常予定ルート。
- 週間計画ルートは、総量配分・進捗管理・生活制約・優先順・配置最適化が必要な場合。

Phase 9.4b では挙動変更しない。`looksLikeWeeklyPlanningRequest` の条件変更は、通常予定 route regression test と persona acceptance spec の整理後に行う。

### 最初に切るべき command boundary

全面導入ではなく、まずは constraints / priority / progress のうち、payload が安定していて副作用が小さいものから入れるのがよい。

候補順:

1. `add_unavailable`
   - Phase 9.3 の対象で payload が明確。
   - `date`, `start`, `end`, `hardness`, `sourceText` を持てばよい。
   - reducer は `mergeLifeConstraints` で state に反映するだけにできる。
2. `add_fixed_event`
   - `unavailable` と同じ constraint merge path に乗せやすい。
   - uncertain fixed event を command 上で `confidence` / `hardness` に分けられる。
3. `update_life_constraint`
   - meal / bath / sleep / buffer を fixed events と分離できる。
   - ただし replacing rule が kind ごとにあるため、`add_unavailable` より少し domain 寄り。
4. `set_priority_policy`
   - すでに parser が policy を返すため command 化しやすい。
   - field resolution と unknown field handling の境界を整理できる。
5. `mark_completed_units`
   - 重要だが、yearRange / field scope / future task unit generalization と絡む。
   - 最初の command 化対象にすると設計が大きくなりやすい。

最小導入案:

```ts
type ParsedWeeklyPlanningCommand =
  | {
      type: 'add_unavailable';
      constraint: LifeConstraint;
      sourceText: string;
    }
  | {
      type: 'add_fixed_event';
      constraint: LifeConstraint;
      sourceText: string;
    }
  | {
      type: 'update_life_constraint';
      constraint: LifeConstraint;
      sourceText: string;
    };
```

この段階では `PlanningIntakeState` を置き換えない。`parseConstraints` の後段に adapter を置き、`applyWeeklyPlanningCommands` が既存 reducer と同じ state 更新を行う形にすれば挙動変更を避けやすい。

### 今は導入しない方がよい境界

- `yearRange` / progress scope の一般化。
  - 過去問年度、参考書ページ、単語数、問題番号、レポート工程の設計が必要で、Phase 9.4b の範囲を超える。
- `ParsedWeeklyPlanningCommand` の全面導入。
  - 既存の roleplay / pipeline / preview 後 revision の赤化リスクが高い。
- 通常予定 route split の変更。
  - 通常予定の multi-plan input と週間計画 intent の regression set が先に必要。
- scheduler の availability model 統合。
  - legacy availability-aware path と new dry-run path の整合設計が必要。
- AI / ML adapter。
  - command boundary が固まってから、自然言語から command を作る役割に限定して導入する。

### Phase 9.5 でやるべきこと

Phase 9.5 は、挙動変更なしの小さい command boundary 導入を推奨する。

1. `weeklyPlanningParsedCommands.ts` を追加し、最小 command 型を定義する。
2. `parseConstraints` の結果を `add_unavailable` / `add_fixed_event` / `update_life_constraint` に変換する adapter を作る。
3. reducer 内の constraints 処理を `applyConstraintCommands` に寄せる。
4. 既存の `mergeLifeConstraints`, `hasLifeConstraint`, `hasConfirmedFixedEvent`, `hasExplicitNoFixedEvents` を再利用し、期待値を変えない。
5. command boundary tests を追加する。

Phase 9.5 でやらないこと:

- progress / yearRange / task unit generalization。
- `looksLikeWeeklyPlanningRequest` の挙動変更。
- UI / save / approval 接続変更。
- scheduler scoring / availability slot 大改造。
- command を AI API に直接つなぐこと。

## Phase 9.4b summary

Phase 9.4a 後の構造は、Phase 9.3 の機能を壊さずに読みやすくなっている。一方で、自然言語 parser が `LifeConstraint` や priority / progress domain 型を直接返し、reducer がそれらの parser を直接呼ぶ構造は残っている。

次の安全な一手は、constraints だけを対象にした小さい `ParsedWeeklyPlanningCommand` boundary である。特に `add_unavailable` は payload が安定しており、scheduler / UI / 保存導線に触れずに導入しやすい。