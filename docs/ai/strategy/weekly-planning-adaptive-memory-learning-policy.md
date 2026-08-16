# 週間計画 Adaptive Memory Learning Policy

Status: canonical / active design policy
Updated: 2026-08-15
Branch: `agent/weekly-conversation-quality-luna-audit`
Applies to: 暗記・想起を主要目的とする学習の提案、復習配置、personalization、長期記憶、会話grounding

## 1. 目的

StudyPlanner は、英単語だけを特別扱いする固定heuristicではなく、暗記・想起を主要目的とする学習全般に対して、分散学習と想起練習の一般原則を参考にした提案を行う。

対象例:

- 英単語・古文単語
- 漢字
- 歴史・地理・生物等の用語
- 化学式・反応式
- 数学・物理の公式
- 資格学習の用語・定義
- その他、理解後に記憶から取り出せることが主要な学習成果となる内容

このpolicyは「暗記系なら必ずこの時間・この回数・この間隔で実行する」という固定規則ではない。一般知見は cold start の提案候補に使い、ユーザーの了承、現在の量・期限・空き時間、本人の過去実績に応じて適応する。

## 2. 最上位原則: heuristic は共有済み前提ではない

application 内部で一般的な学習heuristicを知っていても、それはユーザーとの共通基盤に入った事実ではない。

禁止例:

- まだ短時間学習を提案していないのに「短めに分けるだけだと終わらないので」と話す。
- まだ復習分散を説明していないのに「いつもの分散復習で」と話す。
- 内部heuristicをユーザーも当然知っている前提で省略する。

必要な場合は、提案内容と理由を会話上に一度提示し、ユーザーの応答を受けて初めて shared policy として扱う。

```text
internal heuristic
≠ shared understanding

proposal presented
→ user accepts / modifies / rejects
→ accepted scope becomes shared ground
```

その週だけの了承と、今後も使う恒常的な好みへの了承は区別する。

## 3. 暗記系学習で使う一般原則

研究知見から利用する抽象原則は次の範囲に留める。

- 一度にまとめて反復するだけより、時間を空けて再接触する機会を作る方が長期保持に有利になりやすい。
- 単なる読み直しだけでなく、思い出す・答える等の想起を含む方が長期保持に有利になりやすい。
- 最適なsession長、復習回数、復習間隔は全ユーザー・全教材で一意ではない。
- 「1日後・3日後・7日後」「必ず3周」「必ず15〜30分」のような固定系列を科学的正解として扱わない。

したがって、忘却曲線は固定日程を決める規則ではなく、初回の復習候補を作る prior として使う。本人の観測データが増えたら一般priorより本人データを優先する。

## 4. 初回のsession長は提案であり決定ではない

暗記系で本人の実績・明示希望がない場合、短めのsessionは cold-start proposal として提示してよい。

例として15〜30分程度は提案候補にできるが、これは「15〜30分が普遍的な最適値」という意味ではない。

会話では次の意味を伝える。

- 長時間にまとめること自体を禁止しない。
- 分散して再度思い出す機会を作ることに学習上の利点がある。
- session長はユーザーと相談して決める。

ユーザーが10分、40分、60分等を希望した場合は、hard safetyや現実的配置を破らない限り本人の明示希望を一般heuristicより優先する。

## 5. 新規学習と復習を分離する

暗記量が多い場合、すべての学習を短時間sessionだけに強制しない。

新規範囲を進める acquisition と、記憶を安定させる review / retrieval を別責務として扱う。

```text
new acquisition
→ 必要なら比較的まとまった時間を提案できる

review / retrieval
→ 短め・分散した再接触を提案できる
```

量、期限、availability、本人の実績から短いsessionだけでは期間内に必要範囲へ到達しにくいとapplicationが判断できる場合、次のような混合型を提案する。

- 新規学習は少しまとまった時間を確保する。
- 復習は短く分け、時間を空けて再接触する。

ただしapplicationが自動採用してはならない。proposalを会話上に提示し、了承後にschedule policyへ昇格させる。

## 6. 期限内に現実的に終わらない場合

本人の過去実績、残量、期限、利用可能時間から、必要範囲を十分に定着させることが現実的でないと判断できる場合、無理な長時間予定を自動で詰め込まない。

applicationは方針候補を作り、ユーザーに選択を求める。

代表的な選択肢:

- 全範囲へ一度触れることを優先する。
- 重要範囲へ絞って定着を優先する。
- 新規学習時間を長めにし、復習を短く分散する。
- 期限・目標量自体を変更する。

どの選択肢を出すかは現在のtyped stateからapplicationが決める。rendererは選択肢を自然に説明するが、勝手に方針を決めない。

## 7. 復習回数は固定しない

「同じ範囲を3周」は cold-start の参考案にはできるが、必須終了条件にはしない。

内部的には回数より、現在の記憶状態・想起成績・経過時間を重視する。

```text
initial exposure
→ retrieval opportunity
→ observed recall
→ next interval adjustment
```

よく思い出せている場合は次回間隔を延ばす、思い出せていない場合は間隔を短くする等の適応を行えるようにする。

復習回数そのものを達成目標にせず、「必要な保持水準へ到達しているか」をより重要な状態として扱う。

## 8. placement は自動の朝・昼・夜 heuristic にしない

「暗記なら朝と夜」「3sessionなら朝・昼・夜」のような時間帯固定heuristicを標準規則にしない。

分散学習で重要なのは再接触の間隔であり、特定の時間帯そのものを普遍的な最適値としない。

配置優先順位:

1. 今回ユーザーが明示した時間・曜日・session長
2. durable な本人 preference
3. availability / fixed schedule / existing plan / safety constraints
4. 同種学習の本人実績
5. accepted spaced-review proposal
6. cold-start general heuristic

1日に複数回へ分散することも proposal とする。ユーザーの了承がない状態で「暗記だから」という理由だけで自動的に朝・昼・夜へ複数配置しない。

## 9. word count と時間を混同しない

単語数は進捗・対象範囲として保持する。

禁止:

- 100語を境界にsession数を切り替える。
- 220語だから3session等、語数だけからsession数を決める。
- 1語あたり時間を初期状態で要求する。
- 220語全体に必要な総時間をユーザーが正確に予測できる前提で必須質問にする。

初回はsession duration proposal、本人希望、availability等から時間sessionを作り、各sessionで何語進むかは未確定でもよい。

本人が「毎日20語」等の明示量を与えた場合はそのtargetを保持する。

## 10. 実績から学ぶ

予定実行後は、可能な範囲で生の観測を保存する。

例:

- 実際の学習時間
- 新規学習で進んだ量
- 復習で確認した量
- 正しく想起できた量・割合
- 前回学習からの経過時間
- 対象教材 / component / learning mode
- 本人の主観的な難しさ・覚え具合（取得できる場合）

単一の「倍率」だけをsource of truthとして保存せず、観測データを残し、そこから derived estimate を計算する。

本人データが少ない間は一般priorの影響を残し、観測が増えるほど本人データを強くする。

## 11. 短期記憶と長期記憶

### 11.1 週・conversation側

今回だけ採用した方針は、その週間計画 / conversation のaccepted stateとして保持する。

例:

- 今週は1回20分程度で進める。
- 今回は復習を分散して入れる。
- 今週だけ新規学習を60分まとめて行う。

一回の「今回はそうして」という了承だけで、恒常的なユーザー特性へ自動昇格させない。

### 11.2 durable user preference

ユーザーが恒常的な好みとして明示した場合、または週内方針を今後も使うことについて明示的に了承した場合は、owner-scoped durable contextへ保存できる。

例:

- 暗記系は20分前後を基本にしたい。
- 復習は分散する方がよい。
- 新規暗記は長めでも問題ない。
- 夜の暗記を好む。

会話上のscopeを越えて保存しない。

`今回は20分で` と `今後も20分を基本にして` は別の意味である。

### 11.3 observed learning profile

本人が明示した preference と、アプリが観測した learning profile は別の情報として保持する。

Preference:

- 本人がどうしたいか。

Observed profile:

- 20分で何項目程度進むか。
- 1日後・3日後等でどの程度想起できるか。
- 新規学習と復習で処理速度がどう違うか。

観測値が preference を勝手に書き換えない。両者が衝突する場合は、期限等への影響を説明して別案を提案する。

## 12. memory architecture

既存の memory 責務を拡張して利用する。

- Fact Graph / weekly episodic memory: 今回のconversationと週間計画で成立した事実・方針・根拠
- owner-scoped user planning context: 会話・週をまたぐdurable preference
- observed learning profile: 実行記録から導出するowner-scoped learning evidence / estimate

既存`userPlanningContext`は現時点で`goal_event` / `concern`中心であり、learning preference / observed profileの型は追加設計が必要である。

新しい独立memory siloを無計画に増やさず、既存owner-scoped context / persistence責務との整合を優先する。

## 13. AI / application 責務

AI semantic layer:

- 「これは暗記・想起中心の学習である」の意味構造化
- proposalへのaccept / reject / modificationの意味理解
- 「今回は」「いつも」「今後も」等のscope理解
- 自然言語で表現された覚え具合・難しさの構造化

Deterministic application:

- proposalが必要か
- proposal候補の生成・優先順位
- acceptance lifecycle
- current-week policy と durable preference の保存先
- observed evidenceからpace / retention estimateを計算
- deadline feasibility
- review interval proposal
- scheduler placement
- preview / approval / save

AI dialogue renderer:

- applicationが選んだ提案・確認・結果を現在の共通基盤に合わせて自然に表現する
- 内部heuristicを共有済み前提として話さない
- applicationが決めていない学習方針を発明しない

## 14. implementation gates

このpolicyへ移行する際は、一度に大きなbehavior rewriteをしない。

順序:

1. 旧vocabulary total-duration / 100-word / automatic daypart heuristicの残存箇所を棚卸しする。
2. 「暗記系」classificationとproposal stateを既存typed contractへ追加する設計を行う。
3. proposal → accept / reject / modify をdeterministic lifecycleで保持する。
4. current-week accepted policyからschedulerへ接続する。
5. durable preferenceへの明示的promotionをowner-scoped contextへ追加する。
6. observed learning evidenceの保存・derived estimateを追加する。
7. adaptive review intervalを追加する。
8. real Luna conversationで、internal heuristicを未共有前提として話していないことをturn-by-turn確認する。
9. full CI / Browser Regression / previewまで確認する。

各段階で対象回帰→full CI→必要なreal API再観測を行い、greenになるまで次の段階へ進まない。
