このプロジェクトでは自然言語予定入力のリファクタを段階的に進める。

最優先事項
- 既存 pass ケースを壊さない
- 一気に全書き換えしない
- facade として naturalLanguageRules.ts と naturalLanguagePlanner.ts は薄く残す
- 責務分割を優先し、意味変更は最小限にする

今回の分割対象
- TimeOnlyClause 周り
- override / recurrence 周り
- validator / dedupe 周り

新規ファイル候補
- nlNormalize.ts
- nlClauseParser.ts
- nlAttachment.ts
- nlRecurrenceCompiler.ts
- nlValidator.ts

制約
- 大規模リネームしない
- 不要な整形をしない
- import/export の変更は最小限
- 通らない場合は設計の綺麗さより互換性を優先する

作業単位
1. TimeOnlyClause の生成・吸着・反映箇所を特定
2. TimeOnlyClause 関連のみ切り出す
3. テスト確認
4. 次に override / recurrence
5. 最後に validator / dedupe