interface DiscoverySeedEntry {
  id: string;
  title: string;
  subject: string;
  kind: string;
  aliases?: string[];
  resolutionRequired: true;
}

function expandDiscoveryEntries(
  prefix: string,
  values: string[],
  templates: string[],
  subject: string,
  kind: string,
): DiscoverySeedEntry[] {
  return values.flatMap((value, valueIndex) =>
    templates.map((template, templateIndex) => ({
      id: `${prefix}-${valueIndex + 1}-${templateIndex + 1}`,
      title: template.replace('{value}', value),
      subject,
      kind,
      resolutionRequired: true as const,
    })),
  );
}

const HIGH_SCHOOL_SUBJECTS = [
  '数学I+A', '数学II+B+C', '数学III+C', '英文法', '英語長文', '英文解釈',
  '現代文', '古文', '漢文', '物理', '化学', '生物', '地学', '日本史',
  '世界史', '地理', '政治・経済', '倫理', '情報I', '小論文',
];

const HIGH_SCHOOL_TEMPLATES = [
  '大学入試 {value} 基礎問題集',
  '大学入試 {value} 標準問題集',
  '大学入試 {value} 問題精講',
  '大学入試 {value} 重要問題集',
  '大学入試 {value} 全レベル問題集',
  '大学入試 {value} 一問一答',
  '大学入試 {value} 講義',
  '大学入試 {value} 演習',
  '高校 {value} 参考書',
  '高校 {value} 教科書ガイド',
];

const COMMON_TEST_SUBJECTS = [
  '英語リーディング', '英語リスニング', '数学I・A', '数学II・B・C', '国語',
  '物理', '化学', '生物', '地学', '日本史探究', '世界史探究',
  '地理総合・地理探究', '公共・政治経済', '公共・倫理', '情報I',
  '歴史総合・日本史探究', '歴史総合・世界史探究', '地理総合',
];

const COMMON_TEST_TEMPLATES = [
  '共通テスト実戦問題集 {value}',
  '共通テスト実戦模試 {value}',
  '共通テスト総合問題集 {value}',
  '共通テスト対策問題集 {value}',
  '共通テスト過去問 {value}',
  '共通テスト予想問題 {value}',
];

const MIDDLE_SCHOOL_SUBJECTS = ['国語', '数学', '英語', '理科', '社会'];
const MIDDLE_SCHOOL_TEMPLATES = [
  '中学 {value} をひとつひとつわかりやすく',
  '中学 {value} 自由自在',
  '中学 {value} 最高水準問題集',
  '高校入試 {value} 問題集',
  '高校入試 {value} 過去問',
  '高校入試 {value} 一問一答',
  '中学 {value} 定期テスト対策',
  '中学 {value} 教科書ワーク',
  '中学 {value} 教科書ガイド',
  '中学 {value} ハイクラス',
];

const EIKEN_GRADES = ['5級', '4級', '3級', '準2級', '2級', '準1級', '1級'];
const EIKEN_TEMPLATES = [
  '英検{value} でる順パス単',
  '英検{value} 過去6回全問題集',
  '英検{value} 総合対策教本',
  '英検{value} 予想問題ドリル',
  '英検{value} 文で覚える単熟語',
  '英検{value} ライティング大特訓',
  '英検{value} 面接大特訓',
  '英検{value} をひとつひとつわかりやすく',
];

const TOEIC_TARGETS = [
  'TOEIC 500点', 'TOEIC 600点', 'TOEIC 700点', 'TOEIC 800点', 'TOEIC 900点',
  'TOEIC Part5', 'TOEIC Part6', 'TOEIC Part7', 'TOEIC リスニング', 'TOEIC 文法',
  'TOEIC 英単語', 'TOEIC 模試',
];

const TOEIC_TEMPLATES = [
  '{value} 参考書',
  '{value} 問題集',
  '{value} 特急',
  '{value} ドリル',
  '{value} 完全攻略',
  '{value} 対策',
];

const IT_EXAMS = [
  'ITパスポート', '情報セキュリティマネジメント', '基本情報技術者', '応用情報技術者',
  '情報処理安全確保支援士', 'ネットワークスペシャリスト', 'データベーススペシャリスト',
  'エンベデッドシステムスペシャリスト', 'ITストラテジスト', 'システムアーキテクト',
  'プロジェクトマネージャ', 'ITサービスマネージャ', 'システム監査技術者',
  'CCNA', 'AWS認定', 'Microsoft Azure認定',
];

const CERTIFICATION_TEMPLATES = [
  '{value} 教科書',
  '{value} テキスト',
  '{value} 問題集',
  '{value} 過去問題集',
  '{value} 一問一答',
  '{value} 予想問題集',
];

const PROFESSIONAL_EXAMS = [
  '日商簿記3級', '日商簿記2級', '日商簿記1級', 'FP3級', 'FP2級', 'FP1級',
  '宅地建物取引士', '行政書士', '社会保険労務士', '中小企業診断士', '公認会計士',
  '税理士', '司法書士', '司法試験', '予備試験', '弁理士', '通関士',
  '登録販売者', '危険物取扱者乙4', '第二種電気工事士',
];

const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

const PREFECTURE_TEMPLATES = [
  '{value} 公立高校入試 過去問',
  '{value} 高校入試 過去問題集',
  '{value} 公立高校入試 予想問題',
];

const UNIVERSITIES = [
  '東京大学', '京都大学', '大阪大学', '東北大学', '名古屋大学', '九州大学',
  '北海道大学', '東京科学大学', '一橋大学', '神戸大学', '筑波大学', '千葉大学',
  '横浜国立大学', 'お茶の水女子大学', '東京外国語大学', '電気通信大学',
  '埼玉大学', '群馬大学', '茨城大学', '宇都宮大学', '新潟大学', '金沢大学',
  '富山大学', '福井大学', '信州大学', '山梨大学', '静岡大学', '岐阜大学',
  '三重大学', '滋賀大学', '奈良女子大学', '和歌山大学', '岡山大学', '広島大学',
  '山口大学', '徳島大学', '香川大学', '愛媛大学', '高知大学', '鳥取大学',
  '島根大学', '佐賀大学', '長崎大学', '熊本大学', '大分大学', '宮崎大学',
  '鹿児島大学', '琉球大学', '早稲田大学', '慶應義塾大学', '上智大学',
  '東京理科大学', '明治大学', '青山学院大学', '立教大学', '中央大学', '法政大学',
  '学習院大学', '成蹊大学', '成城大学', '明治学院大学', '國學院大學', '武蔵大学',
  '日本大学', '東洋大学', '駒澤大学', '専修大学', '芝浦工業大学', '東京農業大学',
  '東京都市大学', '工学院大学', '関西大学', '関西学院大学', '同志社大学',
  '立命館大学', '近畿大学', '京都産業大学', '龍谷大学', '甲南大学', '南山大学',
  '名城大学', '中京大学', '愛知大学', '西南学院大学', '福岡大学',
  '同志社女子大学', '京都女子大学', '東京女子大学', '日本女子大学', '津田塾大学',
  '北里大学', '東邦大学', '順天堂大学', '昭和医科大学', '東京医科大学',
  '日本医科大学', '自治医科大学', '国際医療福祉大学', '藤田医科大学', '関西医科大学',
];

const UNIVERSITY_TEMPLATES = ['{value} 赤本', '{value} 入試過去問'];

export const MATERIAL_CATALOG_DISCOVERY_ENTRIES: DiscoverySeedEntry[] = [
  ...expandDiscoveryEntries('discover-high-school', HIGH_SCHOOL_SUBJECTS, HIGH_SCHOOL_TEMPLATES, '高校・大学受験', '検索候補'),
  ...expandDiscoveryEntries('discover-common-test', COMMON_TEST_SUBJECTS, COMMON_TEST_TEMPLATES, '共通テスト', '検索候補'),
  ...expandDiscoveryEntries('discover-middle-school', MIDDLE_SCHOOL_SUBJECTS, MIDDLE_SCHOOL_TEMPLATES, '中学・高校受験', '検索候補'),
  ...expandDiscoveryEntries('discover-eiken', EIKEN_GRADES, EIKEN_TEMPLATES, '英語', '英検検索候補'),
  ...expandDiscoveryEntries('discover-toeic', TOEIC_TARGETS, TOEIC_TEMPLATES, '英語', 'TOEIC検索候補'),
  ...expandDiscoveryEntries('discover-it', IT_EXAMS, CERTIFICATION_TEMPLATES, '情報', '資格検索候補'),
  ...expandDiscoveryEntries('discover-professional', PROFESSIONAL_EXAMS, CERTIFICATION_TEMPLATES, '資格', '資格検索候補'),
  ...expandDiscoveryEntries('discover-prefecture', PREFECTURES, PREFECTURE_TEMPLATES, '高校受験', '過去問検索候補'),
  ...expandDiscoveryEntries('discover-university', UNIVERSITIES, UNIVERSITY_TEMPLATES, '大学受験', '過去問検索候補'),
];
