# PR #75 七視点監査 5: セキュリティと信頼境界

監査対象は prompt injection、公開参照、confirmed slot、correction target、constraint source、値域、過大入力の境界である。

AI system prompt は `userText` と recent conversation を信頼できない引用データとして扱い、そこに含まれる命令、role change、schema request を実行しないよう明示する。application は AI の自然言語説明を信頼せず、typed command の shape、enum、値域、参照整合性だけを検証する。後段 validator がユーザー文を再解釈して AI の意味判断を上書きする処理は削除されている。

task、constraint、proposal、correction は state summary が公開した exact reference だけを利用できる。存在しない relative anchor、task reference、constraint source は拒否または clarification へ送られる。confirmed slot の上書き、deadline declaration のない deadline payload、不正な期間、負または過大な時間、未知 enum は reducer 到達前に拒否される。

ユーザー入力は controller で 4,000 文字に制限される。repair 回数は 1 回に固定され、provider 出力を無制限に再試行しない。legacy parser を security fallback として利用する経路も存在しない。

AI 自体の誤読リスクは残るが、これは AI を意味解釈主体にする設計上の残余リスクである。構造契約と公開参照境界を迂回する blocker は確認されなかった。

判定は採用可である。
