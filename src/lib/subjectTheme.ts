import type { PlanType } from '../types/domain';

export interface SubjectTheme {
  fill: string;
  soft: string;
  border: string;
  text: string;
}

const SUBJECT_THEME_MAP: Record<string, SubjectTheme> = {
  数学: {
    fill: '#2f7de1',
    soft: '#dce9fb',
    border: '#7aa8ea',
    text: '#184a8d',
  },
  英語: {
    fill: '#24a067',
    soft: '#dcf3e6',
    border: '#79c89e',
    text: '#176544',
  },
  国語: {
    fill: '#ba6f28',
    soft: '#f7e8d8',
    border: '#d7ab80',
    text: '#81501d',
  },
  理科: {
    fill: '#7b67d4',
    soft: '#ebe7fb',
    border: '#b2a6e9',
    text: '#4d3ca0',
  },
  物理: {
    fill: '#5470d8',
    soft: '#e3e8fb',
    border: '#90a4eb',
    text: '#30479f',
  },
  化学: {
    fill: '#2d9c93',
    soft: '#daf1ef',
    border: '#7ccac4',
    text: '#1b6963',
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
};

function detectKnownSubject(subject: string, type: PlanType): string {
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

export function getSubjectTheme(subject: string, type: PlanType): SubjectTheme {
  return SUBJECT_THEME_MAP[detectKnownSubject(subject, type)] ?? SUBJECT_THEME_MAP['予定'];
}

export function getSubjectLabel(subject: string, type: PlanType): string {
  return detectKnownSubject(subject, type);
}
