type LegalPageKind = 'terms' | 'privacy' | 'contact';

interface LegalSection {
  title: string;
  body: string[];
}

interface LegalPageContent {
  title: string;
  lead: string;
  sections: LegalSection[];
}

const LEGAL_PAGE_CONTENT: Record<LegalPageKind, LegalPageContent> = {
  terms: {
    title: '利用規約',
    lead:
      'この利用規約は、StudyPlannerを利用する際の基本的な条件を定めるものです。',
    sections: [
      {
        title: 'サービス概要',
        body: [
          'StudyPlannerは、学習予定、実績、Todo、時間割などを管理するための学習支援サービスです。',
        ],
      },
      {
        title: '禁止事項',
        body: [
          '法令または公序良俗に反する行為、第三者の権利を侵害する行為、不正アクセス、サービス運営を妨げる行為を禁止します。',
        ],
      },
      {
        title: '免責事項',
        body: [
          '本サービスの利用により生じた損害について、運営者は故意または重大な過失がある場合を除き責任を負いません。',
          '学習計画やAIによる提案は参考情報であり、成果を保証するものではありません。',
        ],
      },
      {
        title: 'サービス変更・停止',
        body: [
          '運営上または技術上必要な場合、事前の予告なくサービス内容の変更、停止、終了を行うことがあります。',
        ],
      },
      {
        title: 'アカウント削除',
        body: [
          'アカウント削除を希望する場合は、お問い合わせページからご連絡ください。本人確認後、必要な範囲でデータ削除を行います。',
        ],
      },
      {
        title: 'お問い合わせ',
        body: [
          '本規約に関するお問い合わせは、お問い合わせページからご連絡ください。',
        ],
      },
    ],
  },
  privacy: {
    title: 'プライバシーポリシー',
    lead:
      'StudyPlannerは、ユーザーの情報をサービス提供と改善のために適切に取り扱います。',
    sections: [
      {
        title: '取得する情報',
        body: [
          'メールアドレス、ユーザー名、アイコン画像を取得します。',
          '学習予定、実績、Todo、時間割データ、OCR用にアップロードされた時間割画像を取得する場合があります。',
        ],
      },
      {
        title: '利用目的',
        body: [
          '取得した情報は、サービス提供、本人確認、データ同期、機能改善、不具合対応のために利用します。',
        ],
      },
      {
        title: '使用サービス',
        body: [
          'データ保存や認証にFirebase、配信やAIプロキシ等にCloudflareを利用する場合があります。',
          '自然言語処理やOCRなどのAI処理にOpenAI API等の外部AIサービスを利用する場合があります。',
        ],
      },
      {
        title: 'データ保存と削除方法',
        body: [
          'ユーザーデータはサービス提供に必要な期間保存します。',
          'アカウント削除や保存データの削除を希望する場合は、お問い合わせページからご連絡ください。本人確認後、合理的な範囲で対応します。',
        ],
      },
      {
        title: 'お問い合わせ方法',
        body: [
          '個人情報の取り扱いに関するお問い合わせは、お問い合わせページからご連絡ください。',
        ],
      },
    ],
  },
  contact: {
    title: 'お問い合わせ',
    lead:
      'StudyPlannerに関するお問い合わせ、アカウント削除、データ削除のご依頼はこちらからご連絡ください。',
    sections: [
      {
        title: 'お問い合わせ方法',
        body: [
          '現在は運営者が案内した連絡手段からお問い合わせください。',
          'ご本人確認が必要な内容では、登録メールアドレスやアカウント情報の確認をお願いする場合があります。',
        ],
      },
      {
        title: '対象となる内容',
        body: [
          'サービスの不具合、使い方、利用規約やプライバシーポリシー、アカウント削除、データ削除に関するご相談を受け付けます。',
        ],
      },
    ],
  },
};

interface LegalPageProps {
  kind: LegalPageKind;
}

export function LegalPage({ kind }: LegalPageProps) {
  const content = LEGAL_PAGE_CONTENT[kind];

  return (
    <main className="legal-page-shell">
      <article className="legal-page-card">
        <a className="legal-back-link" href="/">
          StudyPlannerへ戻る
        </a>
        <header className="legal-page-header">
          <p className="eyebrow">StudyPlanner</p>
          <h1>{content.title}</h1>
          <p>{content.lead}</p>
        </header>

        <div className="legal-section-list">
          {content.sections.map((section) => (
            <section key={section.title} className="legal-section">
              <h2>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>

        <p className="legal-updated">制定日: 2026年5月2日</p>
      </article>
    </main>
  );
}
