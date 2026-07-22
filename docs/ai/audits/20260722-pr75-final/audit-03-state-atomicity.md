# PR #75 七視点監査 3: 状態遷移の原子性

監査対象は provider error、invalid response、空応答、全 candidate rejection、repair failure の各失敗経路である。確認事項は、以前の意味状態を破壊しないこと、質問文脈を維持すること、draft authorization や assumption ledger を暗黙更新しないこと、preview artifact を生成しないことである。

初回監査では、intake で意味解釈を拒否しても behavior pipeline が readiness を再計算し、assistant-suggested intent または draft run を生成できる経路を確認した。これにより「意味状態は変更しない」という表示と実際の状態が食い違う可能性があった。

修正後は `interpretationOutcome` が `failed` または `rejected` の場合、assistant-suggested mutation を実行せず、behavior action を空にし、draft run、draft candidates、assumed draft、diagnostics を抑止する。直前の `lastQuestionContext` と questions は保持され、ユーザー発話の履歴追加以外の意味状態は更新しない。

空応答と全 candidate rejection について、draft-ready かつ user-authorized の状態を入力しても authorization を保持したまま新規 preview を生成しない回帰テストを追加した。provider error と invalid response でも同じ不変条件を確認する。

判定は採用可である。失敗ターンの部分適用または副作用は残っていない。
