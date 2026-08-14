import type { CSSProperties } from 'react';
import type { StudyMaterialProgressUnit, StudySubject } from '../types/domain';

export const SUBJECT_COLOR_OPTIONS = [
  { label: '青', value: '#2f6fc2' },
  { label: '緑', value: '#2f8f6f' },
  { label: '赤', value: '#cc4b4b' },
  { label: 'ピンク', value: '#d65b8a' },
  { label: '紫', value: '#7d65c8' },
  { label: 'オレンジ', value: '#d9822b' },
  { label: 'グレー', value: '#6b7280' },
] as const;

export const PROGRESS_UNIT_OPTIONS: Array<{
  value: StudyMaterialProgressUnit;
  label: string;
}> = [
  { value: 'page', label: 'ページ' },
  { value: 'problem', label: '問題' },
  { value: 'section', label: '章' },
  { value: 'video', label: '動画' },
  { value: 'word', label: '単語' },
  { value: 'custom', label: 'その他' },
];

export function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : undefined;
}

export function getSubjectColor(subject: StudySubject | null | undefined): string {
  return subject?.color || SUBJECT_COLOR_OPTIONS[0].value;
}

export function getSubjectStyle(color: string): CSSProperties {
  return {
    '--subject-color': color,
  } as CSSProperties;
}
