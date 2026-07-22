# PR #75 七視点監査 4: 対話とユーザー体験

監査対象は、成功、曖昧、全拒否、AI 接続失敗、AI 設定不備、既存の院試状態を持つ会話における返答選択である。

成功時は AI interpreter が確定した typed fact を deterministic dialogue decision と AI dialogue renderer へ渡す。失敗または全拒否時は通常の missing-slot 質問を再利用せず、意味状態を変更していないことを明示する system message を返す。これにより、同じ質問を根拠なく繰り返す元の不具合を遮断する。

初回監査では、既存状態が院試フローの場合に、意味解釈失敗の system message が院試 renderer に上書きされる経路を確認した。修正後は `failed` または `rejected` では exam renderer を呼ばず、system message を優先する。

AI 設定不備または rules provider 選択時は parser へ切り替えず、専用の `WeeklyPlanningSemanticInterpreterError` を返す。provider error は pipeline 内で処理され、ユーザーには内部例外の詳細ではなく再送可能な説明を返す。

判定は採用可である。重複質問、誤った通常対話への復帰、失敗通知の上書きは解消されている。
