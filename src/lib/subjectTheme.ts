import type { PlanSourceType, PlanType } from '../types/domain';

export interface SubjectTheme {
  fill: string;
  soft: string;
  border: string;
  text: string;
}

const SUBJECT_THEME_MAP: Record<string, SubjectTheme> = {
  数学: {
    fill: '#2f78e3',
    soft: '#dce8fb',
    border: '#7ca8ec',
    text: '#184b92',
  },
  英語: {
    fill: '#8a5fe0',
    soft: '#ede4fd',
    border: '#b79aec',
    text: '#5a34a1',
  },
  国語: {
    fill: '#dc6ea9',
    soft: '#fbe4ef',
    border: '#ecabca',
    text: '#9a3d6b',
  },
  理科: {
    fill: '#4d9f8c',
    soft: '#e0f2ee',
    border: '#8bc8bb',
    text: '#2e6d61',
  },
  物理: {
    fill: '#ea8b2f',
    soft: '#fbe9db',
    border: '#f0b37d',
    text: '#9a5617',
  },
  化学: {
    fill: '#2ca260',
    soft: '#def3e5',
    border: '#84cf9d',
    text: '#1b6d40',
  },
  生物: {
    fill: '#57a948',
    soft: '#e1f2dd',
    border: '#91cc86',
    text: '#37732d',
  },
  歴史: {
    fill: '#b34d67',
    soft: '#f6dde4',
    border: '#df9dac',
    text: '#7b3448',
  },
  地理: {
    fill: '#3b8f7f',
    soft: '#ddf1eb',
    border: '#85c6b8',
    text: '#266257',
  },
  情報: {
    fill: '#6b78ce',
    soft: '#e4e8fb',
    border: '#99a3e5',
    text: '#44529a',
  },
  模試: {
    fill: '#5b616e',
    soft: '#e5e7eb',
    border: '#b5bac4',
    text: '#3e434d',
  },
  学校行事: {
    fill: '#8b6b52',
    soft: '#efe6df',
    border: '#c9b29f',
    text: '#5d4736',
  },
  塾: {
    fill: '#0f827a',
    soft: '#d8efed',
    border: '#79c4bf',
    text: '#0e5c57',
  },
  締切: {
    fill: '#b7503c',
    soft: '#f7e1dc',
    border: '#d99a8e',
    text: '#7d372a',
  },
  予定: {
    fill: '#4d7a74',
    soft: '#dfedeb',
    border: '#92bab5',
    text: '#2f5450',
  },
  主要予定: {
    fill: '#4d7a74',
    soft: '#dfedeb',
    border: '#92bab5',
    text: '#2f5450',
  },
  授業: {
    fill: '#2f78e3',
    soft: '#dce8fb',
    border: '#7ca8ec',
    text: '#184b92',
  },
};

function detectKnownSubject(
  subject: string,
  type: PlanType,
  sourceType?: PlanSourceType,
): string {
  if (sourceType === 'timetable') {
    return '授業';
  }

  const normalized = subject.trim();

  if (normalized) {
    const known = Object.keys(SUBJECT_THEME_MAP).find((key) =>
      normalized.includes(key),
    );

    if (known) {
      return known;
    }
  }

  if (type === 'mock-exam') {
    return '模試';
  }

  if (type === 'school-event') {
    return '学校行事';
  }

  if (type === 'cram-school') {
    return '塾';
  }

  if (type === 'deadline') {
    return '締切';
  }

  return '予定';
}

export function getSubjectTheme(
  subject: string,
  type: PlanType,
  sourceType?: PlanSourceType,
): SubjectTheme {
  return SUBJECT_THEME_MAP[detectKnownSubject(subject, type, sourceType)] ?? SUBJECT_THEME_MAP['予定'];
}

export function getSubjectLabel(
  subject: string,
  type: PlanType,
  sourceType?: PlanSourceType,
): string {
  return detectKnownSubject(subject, type, sourceType);
}
