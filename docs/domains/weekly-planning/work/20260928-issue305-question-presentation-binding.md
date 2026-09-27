# Issue #305 第三段階 — 提示済み質問の binding 基盤

Status: 実装済み（PR で検証中）/ runtime の意味解釈は変更しない
Updated: 2026-09-28
Tracking: Issue #305（C9 / C5 の前提条件 (a)。正本の契約は `../architecture/current-contract-v5.md` の「Pending question presentation binding」）

## 目的

#347 の第二段階の棚卸しでは、C9（提示済み proposal への純粋な reject）と C5（閉じた選択肢を持つ pending question）を保留とした。どちらも、「ユーザーが返答している質問は、どの message で、どの revision に提示されたものか」を機械的に証明できないことが共通の blocker だった。この unit は、その binding だけを StudyPlanner 全体の state 契約として実装する。Jev の配線、Luna の prompt、UI は変更しない。

## 反証の確認（実装前、origin/main `94a9a5f1`）

| 仮説 | 根拠 | 判定 |
| --- | --- | --- |
| 既存の state で足りる（`commit_turn` は原子的だから） | `fail_turn`、`complete_approval`、`append_message`、`set_last_assistant_message` は、`lastQuestionContext` を残したまま assistant message を追加する。`pendingQuestionFromState` の `graphRevision` は現在値である | 棄却 |
| proposal の提示 message には proposal だけが載る | renderer は、同じ message に current-turn grounding（受理した事実の確認）と self-repair notice を並べうる。「いいえ」がそれらを否定している可能性がある | 棄却。同居した通知を binding に記録する |
| 新しい field は保存互換を壊す | Stable V5 の codec（`weeklyPlanningStableV5SessionCodec.ts`）は `intakeState` を `isRecord` で扱う。legacy の互換経路（`weeklyPlanningStorage.ts::isQuestionContext`）は5キーに制限しているが、Stable V5 の state はすでに `groundingRecords` などで legacy の validator を通らない | 条件付きで棄却。executor が明示的に要求したときだけ印を付け、codec の往復をテストで固定する |

## 設計

- **書き手**：turn controller が、`commit_turn` の直前に `lastQuestionContext.presentation` を付ける。内容は `{version: 1, turnId, assistantMessageId, planningStateRevision, graphRevision, content}` である。
  - `planningStateRevision` は「開始時の revision + 2」とする。これは `canCommitTurn` の既存の不変条件による。
  - `content` は Stable V5 の dialogue 段が返す `questionPresentationContent` から作る。中身は `responseSource`、`currentTurnGrounding`、`selfRepairNotice` である。
  - content や graph がない場合、以前の binding は取り除く。
- **読み手**：`resolveWeeklyPlanningQuestionPresentationFreshness` が次のいずれかを返す。
  - `fresh`
  - `no_question`
  - `unbound`（旧 session）
  - `malformed`（厳密な decoder）
  - `stale`（`input_revision_unknown` / `state_revision_mismatch` / `latest_message_mismatch` / `graph_revision_mismatch`）
- **turn 開始時の revision**：gateway が `pending.baseRevision` を `inputStateRevision` として executor へ、executor が Stable V5 runtime へ渡す。
- **supersession**：binding は毎回の commit で置き換えられるか、取り除かれる。古い binding が次の質問へ持ち越されることはない。
- **意味解釈から除外する**：semantic model の public state summary にも renderer input にも含めない（テストで固定した）。承認・保存・scheduler・lifecycle の権限は持たない。

## Trace persistence gate（`src/features/weeklyPlanning/AGENTS.md`）

binding は、intake state の field として session storage に保存される。trace には意図的に含めない。

- **理由**：binding は、runtime の後に controller が付ける application 側の証拠である。durable な turn diagnostic は、提示済み質問の状態を記録する stage を持たない。
- **privacy**：binding は ID と revision だけで、raw text を含まない。trace に追加しないことで、保存対象の面が増えない。
- **代替の診断情報**：保存された session の `lastQuestionContext.presentation` そのもの。
- **除外契約のテスト**：semantic の public state summary は、binding の有無で変わらない。

消費者（C9）が route の判断に freshness を使う場合は、その unit で durable な診断の field と gate のテストを追加する。

## 検証

- 単体テスト（`intake/weeklyPlanningQuestionPresentation.test.ts`）：bind、厳密な decoder、freshness の全分岐。
- controller・reducer・codec の統合テスト（`weeklyPlanningQuestionPresentationBinding.integration.test.ts`）：
  - 印を付ける。
  - 次の turn で `fresh` になる。
  - content がなければ `unbound` になる。
  - 外部の message 追加、または失敗した turn の後は `stale` になる。
  - 再提示では置き換わる。
  - checkpoint の往復と、load 後も `fresh` のままであること。
- executor の dialogue 段（`weeklyPlanningTurnExecutor.questionPresentation.test.ts`）：
  - 単独の質問、grounding と self-repair の同居、質問なし、system message の各場合。
  - `inputStateRevision` の転送。
- gateway の転送、意味解釈からの除外。
- 既存の trace projection のテストは、新しい field の正確な値で期待値を更新した（契約の変更による）。

## 次の作業

C9 の評価設計に進む。対象は `spaced_memory_practice` の単一 kind とし、eligibility は次をすべて満たす場合に限る。

- freshness が `fresh` である。
- `content` に grounding も self-repair notice もない。
- pending の proposal がちょうど1件あり、それが bound な `actionId` と一致する。

corpus は封印し、paired の Luna baseline と比較する。C5 は、#347 に記録した固有の blocker（選択を適用する scope と期間、global な supersession）が残るので、binding だけでは再開しない。
