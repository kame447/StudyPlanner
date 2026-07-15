# 週間計画会話UIの責務を段階的に分離する

Status: open
Parent: `20260716-weekly-planning-conversation-hardening.md`

## 対象問題

`NaturalLanguageAssistant.tsx`は単発自然言語入力、週間計画の会話session、pipeline実行、preview表示、承認操作までを同一componentで扱っている。変更の影響範囲が広く、送信UIや永続化の修正でもpreviewへ回帰を起こしやすい。

## 方針

全面書換えは行わず、今回変更する会話表示とsession接続から小さく分離する。

- 会話履歴とtyping indicatorを表示するcomponent
- 週間計画sessionをcontrolled stateへ接続する境界
- 既存previewロジックは現状維持

`QuickEntryModal`は調停役としてpropsを渡すだけにし、永続化の実装詳細を持たせない。

## 完了条件

- [ ] 会話履歴表示を独立componentへ分離する
- [ ] typing indicatorを同じ表示componentで扱う
- [ ] `NaturalLanguageAssistant`がstorage実装へ直接依存しない
- [ ] `QuickEntryModal`はsession propsの中継だけを行う
- [ ] preview生成・承認の既存挙動を変更しない
- [ ] componentの回帰テストまたは純粋関数テストを追加する
