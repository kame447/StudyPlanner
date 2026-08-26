import {
  useMemo,
  useState,
  type CSSProperties,
  type ComponentType,
} from 'react';
import {
  BookOpen,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flag,
  Sparkles,
  type LucideProps,
} from 'lucide-react';
import {
  ALL_MATERIALS_FILTER,
  buildLearningReportMaterialOptions,
  buildLearningReportModel,
  buildLearningReportOverview,
  formatLearningReportRangeLabel,
  shiftLearningReportAnchor,
  type LearningReportScope,
} from '../lib/learningReport';
import { formatMinutes, todayIsoDate } from '../lib/date';
import type {
  Actual,
  Plan,
  StudyMaterial,
  StudySubject,
} from '../types/domain';

interface ReportViewProps {
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  studySubjects?: StudySubject[];
  studyMaterials?: StudyMaterial[];
  onBack: () => void;
}

const REPORT_SCOPES: ReadonlyArray<{
  value: LearningReportScope;
  label: string;
}> = [
  { value: 'day', label: '日' },
  { value: 'week', label: '週' },
  { value: 'month', label: '月' },
];

function SummaryCard({
  label,
  minutes,
  plannedMinutes,
  Icon,
  lifetime = false,
}: {
  label: string;
  minutes: number;
  plannedMinutes?: number;
  Icon: ComponentType<LucideProps>;
  lifetime?: boolean;
}) {
  return (
    <article className="learning-report-summary-card">
      <div className="learning-report-summary-icon" aria-hidden="true">
        <Icon />
      </div>
      <div className="learning-report-summary-copy">
        <span>{label}</span>
        <strong>{formatMinutes(minutes)}</strong>
        <small>
          {lifetime
            ? 'これまでの学習記録'
            : plannedMinutes && plannedMinutes > 0
              ? `予定 ${formatMinutes(plannedMinutes)}`
              : '予定なし'}
        </small>
      </div>
    </article>
  );
}

function shouldShowMonthLabel(index: number, total: number): boolean {
  return index === 0 || index === total - 1 || (index + 1) % 5 === 0;
}

export function ReportView({
  selectedDate,
  plans,
  actuals,
  studySubjects = [],
  studyMaterials = [],
  onBack,
}: ReportViewProps) {
  const [scope, setScope] = useState<LearningReportScope>('week');
  const [anchorDate, setAnchorDate] = useState(selectedDate);
  const [materialFilter, setMaterialFilter] = useState(ALL_MATERIALS_FILTER);
  const referenceDate = todayIsoDate();
  const overview = useMemo(
    () =>
      buildLearningReportOverview({
        referenceDate,
        plans,
        actuals,
        subjects: studySubjects,
        materials: studyMaterials,
      }),
    [actuals, plans, referenceDate, studyMaterials, studySubjects],
  );
  const report = useMemo(
    () =>
      buildLearningReportModel({
        scope,
        anchorDate,
        materialFilter,
        plans,
        actuals,
        subjects: studySubjects,
        materials: studyMaterials,
      }),
    [
      actuals,
      anchorDate,
      materialFilter,
      plans,
      scope,
      studyMaterials,
      studySubjects,
    ],
  );
  const materialOptions = useMemo(
    () => buildLearningReportMaterialOptions(studyMaterials),
    [studyMaterials],
  );
  const rangeLabel = formatLearningReportRangeLabel(scope, anchorDate);
  const maxBucketMinutes = Math.max(
    60,
    ...report.buckets.map((bucket) => bucket.actualMinutes),
  );

  return (
    <section className="learning-report-view" aria-labelledby="learning-report-title">
      <header className="learning-report-header">
        <button
          className="learning-report-icon-button"
          type="button"
          aria-label="ホームに戻る"
          onClick={onBack}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <h1 id="learning-report-title">学習レポート</h1>
        <span className="learning-report-header-spacer" aria-hidden="true" />
      </header>

      <div className="learning-report-summary-grid" aria-label="学習時間サマリー">
        <SummaryCard
          label="今日"
          minutes={overview.todayMinutes}
          plannedMinutes={overview.todayPlannedMinutes}
          Icon={Clock3}
        />
        <SummaryCard
          label="今週"
          minutes={overview.weekMinutes}
          plannedMinutes={overview.weekPlannedMinutes}
          Icon={CalendarDays}
        />
        <SummaryCard
          label="今月"
          minutes={overview.monthMinutes}
          plannedMinutes={overview.monthPlannedMinutes}
          Icon={CalendarRange}
        />
        <SummaryCard
          label="累計"
          minutes={overview.lifetimeMinutes}
          Icon={Flag}
          lifetime
        />
      </div>

      <div
        className="learning-report-scope-tabs"
        role="tablist"
        aria-label="集計期間"
      >
        {REPORT_SCOPES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={scope === option.value}
            className={scope === option.value ? 'active' : undefined}
            onClick={() => setScope(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="learning-report-period-navigation">
        <button
          className="learning-report-icon-button"
          type="button"
          aria-label="前の期間を表示"
          onClick={() =>
            setAnchorDate((current) =>
              shiftLearningReportAnchor(scope, current, -1),
            )
          }
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <strong>{rangeLabel}</strong>
        <button
          className="learning-report-icon-button"
          type="button"
          aria-label="次の期間を表示"
          onClick={() =>
            setAnchorDate((current) =>
              shiftLearningReportAnchor(scope, current, 1),
            )
          }
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>

      <label className="learning-report-material-filter">
        <BookOpen aria-hidden="true" />
        <span className="sr-only">表示する教材</span>
        <select
          value={materialFilter}
          onChange={(event) => setMaterialFilter(event.target.value)}
        >
          {materialOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {report.actualMinutes === 0 ? (
        <section className="learning-report-empty" aria-live="polite">
          <div className="learning-report-empty-icon" aria-hidden="true">
            <BookOpen />
          </div>
          <div>
            <h2>この期間にはまだ学習記録がありません</h2>
            <p>期間や教材を切り替えると、別の学習記録を確認できます。</p>
          </div>
        </section>
      ) : (
        <>
          <section className="learning-report-card learning-report-trend-card">
            <div className="learning-report-card-heading">
              <div>
                <h2>学習時間の推移</h2>
                <p>実績ベース</p>
              </div>
              <div className="learning-report-period-total">
                <strong>合計 {formatMinutes(report.actualMinutes)}</strong>
                {report.plannedMinutes > 0 ? (
                  <span>予定 {formatMinutes(report.plannedMinutes)}</span>
                ) : null}
              </div>
            </div>

            <div
              className={`learning-report-chart scope-${scope}`}
              role="img"
              aria-label={`${rangeLabel}の学習時間 合計 ${formatMinutes(report.actualMinutes)}`}
              style={
                {
                  '--learning-report-bucket-count': Math.max(
                    1,
                    report.buckets.length,
                  ),
                } as CSSProperties
              }
            >
              {report.buckets.map((bucket, index) => {
                const height =
                  bucket.actualMinutes <= 0
                    ? 0
                    : Math.max(
                        4,
                        (bucket.actualMinutes / maxBucketMinutes) * 100,
                      );
                const showLabel =
                  scope !== 'month' ||
                  shouldShowMonthLabel(index, report.buckets.length);

                return (
                  <div
                    className="learning-report-chart-item"
                    key={bucket.key}
                    aria-label={`${bucket.label} ${bucket.sublabel ?? ''} ${formatMinutes(bucket.actualMinutes)}`}
                  >
                    <div className="learning-report-chart-bar-area">
                      {scope !== 'month' && bucket.actualMinutes > 0 ? (
                        <span className="learning-report-chart-value">
                          {formatMinutes(bucket.actualMinutes)}
                        </span>
                      ) : null}
                      <span
                        className="learning-report-chart-bar"
                        style={{ height: `${height}%` }}
                        aria-hidden="true"
                      />
                    </div>
                    <div
                      className={
                        showLabel
                          ? 'learning-report-chart-label'
                          : 'learning-report-chart-label hidden-label'
                      }
                      aria-hidden="true"
                    >
                      <strong>{showLabel ? bucket.label : ''}</strong>
                      <span>{showLabel ? bucket.sublabel : ''}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="learning-report-card learning-report-breakdown-card">
            <div className="learning-report-card-heading">
              <div>
                <h2>教材・科目別の学習時間</h2>
                <p>この期間の実績内訳</p>
              </div>
              <strong className="learning-report-heading-total">
                {formatMinutes(report.actualMinutes)}
              </strong>
            </div>

            <div className="learning-report-breakdown-list">
              {report.breakdown.map((entry) => (
                <article
                  className="learning-report-breakdown-item"
                  key={entry.key}
                  style={
                    {
                      '--learning-report-entry-color': entry.color,
                    } as CSSProperties
                  }
                >
                  <div className="learning-report-breakdown-icon" aria-hidden="true">
                    <BookOpen />
                  </div>
                  <div className="learning-report-breakdown-body">
                    <div className="learning-report-breakdown-copy">
                      <strong title={entry.label}>{entry.label}</strong>
                      <span>{entry.subject}</span>
                    </div>
                    <div className="learning-report-breakdown-progress" aria-hidden="true">
                      <span style={{ width: `${entry.ratio * 100}%` }} />
                    </div>
                  </div>
                  <div className="learning-report-breakdown-value">
                    <strong>{formatMinutes(entry.minutes)}</strong>
                    <span>{Math.round(entry.ratio * 100)}%</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {report.insight ? (
            <section className="learning-report-insight">
              <div className="learning-report-insight-icon" aria-hidden="true">
                <Sparkles />
              </div>
              <div>
                <strong>インサイト</strong>
                <p>{report.insight}</p>
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
