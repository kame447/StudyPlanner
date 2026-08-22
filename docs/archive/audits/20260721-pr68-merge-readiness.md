# PR #68 マージ前最終確認

## 対象

- ブランチ: `agent/fix-weekly-planning-trace-and-dialogue-final`
- コード確認HEAD: `ff56e972f9204fa45ab52fb3cf1c823444c7c40e`
- 元監査対象HEAD: `23d7676370b3efebc8d1465dfd01abc32c6462ca`
- 対象外: M-8（fallback structural IDのprivacy境界。別途方針を議論する）

## 結論

M-8を除く元監査のMAJORおよびMINORについて、production境界の修正、隣接正常系・負方向の回帰追加、全suite、TypeScript、production build、PR diff checkを確認した。M-8を除く範囲ではマージ可能と判定する。

不要な診断ログ `focused-regressions.log`、`full-tests.log`、`full-build.log`、`full-diff.log` と、一時適用script・診断workflowは最終ツリーから削除した。CI workflowは通常構成へ戻した。

## 元監査指摘の解決

### M-1: life constraint時刻grounding

- hour-only入力は`:00`にのみ対応する。
- 明示minuteはminuteまで一致させる。
- start/endの役割を時刻範囲と照合する。
- kindに対応する同一節から時刻根拠を取る。
- `23時00分`は正常な`:00`表現として受理する。
- endpoint swap、非提示minute、明示minute切捨て、別節の時刻流用を拒否する。

### M-2: meal/bath質問への短答

- `19時です`のようにkindを決められない回答を無言で破棄しない。
- 食事か入浴かを限定的に聞き返す。
- 質問表示を一ターン一問へ統一し、保存するquestion contextと一致させる。

### M-3: 単位なしunit rate

- `3`だけでは3分・180分のいずれにも確定しない。
- 単位確認へ戻し、曖昧値でreadinessを解消しない。

### M-4: priority grounding

- 既知分野の完全被覆、重複なし、明示順序を検証する。
- partial orderとtail permutationをconfirmedとして受理しない。
- `OSよりネットワークを先に`のような比較表現は、文字列の出現順ではなく明示された相対関係として扱う。

### M-5: 一般的な「1科目」のexam誤分類

- `来週は数学を1科目勉強する`だけでは院試scopeを作らない。
- 明示的な院試・過去問文脈、または既存exam scopeがある場合のみexam field countとして扱う。

### M-6: accepted factの表示

- canonical minutesと矛盾する`rawText`を表示根拠から除外する。
- stateへ保存した値とユーザーへ表示する受理内容を一致させる。

### M-7: trace retry

- server生成の`expireAt`をimmutable payload同値比較から除外する。
- 同一payloadの再送は収束できる。
- contentなど本体差分がある再送は従来どおりconflictにする。

### M-9: legacy trace取得

- 現行ID validatorを緩めず、旧実装が生成した`weekly-trace-[UUID]`だけを限定的なlegacy handleとして認識する。
- legacy分岐へ到達し、sequenceからentry IDを再構成してadmin取得できる。

### 元監査MINOR: trace discriminated schema

- server write境界でsession status、timestamp、count、boolean、schema versionを検証する。
- entry baseのtimestamp、sequence関連値、schema versionを検証する。
- `turn`、`internal_event`、`state_snapshot`ごとにfinite enumと必須fieldを検証する。
- `role:'admin'`、数値content、未知event type、stateなしsnapshotを保存前に拒否する。

## P1〜P7確認

### P1 新人ユーザー

- 空入力はUIでエラー表示し、controllerでもtrim後に拒否する。
- 処理中は送信ボタンを無効化する。
- 連打されてもpending turnが存在する二件目をcontrollerで拒否する。
- cancel/reset後に遅れて返ったasync resultはcommitしない。

判定: 合格。

### P2 ベテラン現場担当

- 4,000文字上限をtextareaとcontrollerの双方で適用する。
- Ctrl+Enter / Meta+Enterだけを送信とし、通常Enterは改行にする。
- IME変換中またはkeyCode 229のEnterは送信しない。
- Tabはsubmit判定に入らず、preventDefaultされないため通常のフォーカス遷移を維持する。

判定: 合格。

### P3 悪意ある操作者

- 不正時刻、0以下unit rate、未知field、prompt injection形式、payload意味逸脱を拒否する。
- trace APIはbody sizeを制限し、policy同意を要求する。
- admin endpointはreader権限を要求する。
- session/entry ID、sequence、entryCount、conversation ownership、discriminated schemaをwrite境界で検証する。
- 二重送信とstale async resultをrequest/revision identityで排除する。

判定: M-8を除き合格。

### P4 データ整合性監査役

- entry IDはsession IDとsequenceから決定的に生成する。
- Firestore document pathのIDを読取時の正本として扱う。
- immutable entryの同一retryは成功扱いとし、本体差分はconflictにする。
- session ownership、conversation、entryCount巻き戻しを拒否する。
- entryCount更新はmaximum transformを使用する。
- approval完了後はpending approvalと承認済みdraftを残さない。

判定: 合格。

### P5 移行担当者

- localStorageのlegacy envelopeを現行stateへ移行する。
- 未知version・欠損・異常nested dataは初期stateへ安全に戻す。
- session-local proposalとpending turn/approvalは復元しない。
- 旧trace handle `weekly-trace-[UUID]`を限定的に読み取れる。
- legacy entryCountはadmin limit内へ丸め、欠損entryを除外する。

判定: 合格。

### P6 回帰デグレ番人

- full suite、TypeScript、production build、PR diff checkが成功した。
- preview、承認、保存、reload、legacy fallback、trace、storage validationの既存テストを含む。
- F5後は未完了request/approvalを復元せず、保存済み会話・intake・previewだけをschema検証後に復元する。
- 実時計依存だったcontroller approval integrationは固定時刻経路で安定化されている。

判定: 合格。

### P7 仕様懐疑者

- `docs/ai/tasks/20260719-weekly-planning-ai-responsibility-boundary.md`の責任分界と照合した。
- AIは意味解釈を担当し、deterministic境界は明示的な値・関係のgroundingと構造的不変条件を検証する。
- priority比較表現の検証は自然言語全体の再解釈ではなく、AI候補が明示された相対関係へ反していないかの確認に限定した。
- trace server schemaはクライアント側`weeklyPlanningTraceTypes.ts`のfinite unionと整合する。
- M-8は未解決事項として分離し、解決済みと記載しない。

判定: 合格。

## 最終検証

コード確認HEAD `ff56e972f9204fa45ab52fb3cf1c823444c7c40e` の標準CIで以下を確認した。

- full test suite: success
- TypeScript and production build: success
- `git diff --check origin/main...HEAD`: success
- PR status: open / mergeable

本書追加後の最終HEADでも同じ標準CIを再実行し、成功をマージ条件とする。

## 残件

M-8のみ。fallback structural IDへ電話番号形の数字列を埋め込めるprivacy境界については、本PRの今回ゲートから明示的に除外し、別途方針を決定する。
