const FAQ_ITEMS = [
  {
    question: 'StudyPlannerでは何ができますか',
    answer: '月・週・日の予定作成、学習記録、予定と記録の比較、AI入力による予定追加や編集補助ができます。',
  },
  {
    question: '予定と記録の違いは何ですか',
    answer: '予定はこれから学習する計画、記録は実際に学習した時間や内容です。',
  },
  {
    question: 'AI入力では何ができますか',
    answer: '自然な文章から予定の候補を作成し、確認してから予定に反映できます。',
  },
  {
    question: '画像やPDFから何を読み取れますか',
    answer: '時間割の画像やPDFから、授業名・曜日・時限・時間などの候補を読み取れます。',
  },
  {
    question: 'データはどこに保存されますか',
    answer: 'ログイン中のユーザーに紐づくアプリの保存先に保存されます。',
  },
  {
    question: '通知やリマインダーは使えますか',
    answer: '現在のMVPでは通知やリマインダーは未対応です。',
  },
];

export function FaqView() {
  return (
    <section className="panel faq-view">
      <div className="section-header">
        <div>
          <h2>よくある質問</h2>
        </div>
      </div>

      <div className="faq-list">
        {FAQ_ITEMS.map((item) => (
          <article className="faq-item" key={item.question}>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
