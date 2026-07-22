# PR #75 七視点監査 7: テスト、変更範囲、マージ衛生

監査対象は回帰テストの妥当性、production と legacy test-support の分離、CI、build、diff check、一時ファイル、review thread、PR 状態である。

legacy parser の既存単体テストは `.testSupport.ts` を明示 import する形で残し、本番契約テストと分離した。production boundary test は executor からの再帰 import graph を検査し、単なる文字列検索だけでなく indirect dependency も禁止する。空応答、repair 空応答、provider error、全拒否、既存院試 renderer、draft-ready failure、trace body 非永続化について回帰テストを追加した。

最終検証 workflow は `npm ci`、全 test suite、TypeScript と production build、`git diff --check` を実行する。変更適用前の一時的な patch 搬送 workflow と artifact は最終 tree から削除する。PR の unresolved review thread が 0 件であることも確認する。

実 API を必要とする real-eval は環境変数がない通常 CI では skip されるため、mocked contract、integration、production dependency graph をマージ判定の必須検証とする。real-eval の未実行は既存運用上の残余リスクであり、本 PR の blocker ではない。

判定は、最終 head の通常 CI 成功、workflow 削除、draft 解除、mergeable=true の確認を条件として採用可である。
