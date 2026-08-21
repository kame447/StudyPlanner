import { useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clock3,
  MoreHorizontal,
} from 'lucide-react';
import { formatDateLabel, todayIsoDate } from '../lib/date';
import {
  buildMaterialActivitySummary,
  getCurrentStructureItem,
  getStructureItemProgress,
  type MaterialDetailPreferences,
  type MaterialStructureItem,
} from '../lib/bookshelfMaterialDetails';
import { calculateMaterialPace, getMaterialUnitLabel } from '../lib/materialPace';
import type { Actual, Plan, StudyMaterial, StudySubject } from '../types/domain';

interface BookshelfMaterialDetailProps {
  material: StudyMaterial;
  subject: StudySubject | null;
  plans: Plan[];
  actuals: Actual[];
  preferences: MaterialDetailPreferences;
  onBack: () => void;
  onOpenMenu: () => void;
  onEditStructure: () => void;
  onOpenDisplaySettings: () => void;
  onAddToPlan: () => void;
}

type DetailTab = 'overview' | 'structure' | 'logs' | 'schedule';

function formatMinutes(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;

  if (hours === 0) {
    return `${rest}分`;
  }

  return rest > 0 ? `${hours}時間${rest}分` : `${hours}時間`;
}

function getActualRangeLabel(actual: Actual, material: StudyMaterial): string | null {
  const update = actual.materialProgressUpdates?.find(
    (candidate) => candidate.materialId === material.id,
  );

  if (!update) {
    return null;
  }

  const label = update.progressUnitLabel?.trim() || getMaterialUnitLabel(material);
  if (typeof update.fromUnit === 'number' && typeof update.toUnit === 'number') {
    return `${update.fromUnit} → ${update.toUnit}${label}`;
  }
  if (typeof update.toUnit === 'number') {
    return `${update.toUnit}${label}まで`;
  }
  if (typeof update.deltaUnits === 'number') {
    return `+${update.deltaUnits}${label}`;
  }

  return null;
}

function StructureRows({
  items,
  currentUnit,
  depth = 0,
}: {
  items: MaterialStructureItem[];
  currentUnit?: number;
  depth?: number;
}) {
  return (
    <div className="bookshelf-structure-list">
      {items.map((item) => {
        const progress = getStructureItemProgress(item, currentUnit);
        const style = { '--structure-depth': depth } as CSSProperties;

        return (
          <div key={item.id}>
            <div className="bookshelf-structure-row" style={style}>
              <div className="bookshelf-structure-copy">
                <strong>{item.title}</strong>
                {typeof item.startUnit === 'number' && typeof item.endUnit === 'number' ? (
                  <small>
                    {item.startUnit}–{item.endUnit}
                  </small>
                ) : null}
              </div>
              <span>{Math.round(progress)}%</span>
              <div className="bookshelf-inline-progress" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>
              <ChevronRight aria-hidden="true" size={18} />
            </div>
            {item.children?.length ? (
              <StructureRows
                items={item.children}
                currentUnit={currentUnit}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MaterialCover({ material }: { material: StudyMaterial }) {
  if (material.coverImageDataUrl || material.coverImageUrl) {
    return (
      <img
        className="bookshelf-detail-cover-image"
        src={material.coverImageDataUrl || material.coverImageUrl}
        alt={material.name}
      />
    );
  }

  return (
    <div className="bookshelf-detail-cover-placeholder" aria-hidden="true">
      <BookOpen size={38} strokeWidth={1.7} />
    </div>
  );
}

export function BookshelfMaterialDetail({
  material,
  subject,
  plans,
  actuals,
  preferences,
  onBack,
  onOpenMenu,
  onEditStructure,
  onOpenDisplaySettings,
  onAddToPlan,
}: BookshelfMaterialDetailProps) {
  const today = todayIsoDate();
  const pace = useMemo(() => calculateMaterialPace(material, today), [material, today]);
  const summary = useMemo(
    () => buildMaterialActivitySummary(material, plans, actuals, today),
    [actuals, material, plans, today],
  );
  const canShowStructure =
    preferences.structureEnabled && preferences.structureVisible;
  const [tab, setTab] = useState<DetailTab>('overview');
  const activeTab = tab === 'structure' && !canShowStructure ? 'overview' : tab;
  const currentStructureItem = useMemo(
    () =>
      canShowStructure
        ? getCurrentStructureItem(preferences.structureItems, material.currentUnit)
        : null,
    [canShowStructure, material.currentUnit, preferences.structureItems],
  );
  const progressRate = pace.progressRate;
  const unitLabel = getMaterialUnitLabel(material);

  return (
    <section className="bookshelf-detail-page" aria-label={`${material.name}の詳細`}>
      <header className="bookshelf-detail-header">
        <button type="button" onClick={onBack} aria-label="教材一覧へ戻る">
          <ArrowLeft aria-hidden="true" />
        </button>
        <h1>教材の詳細</h1>
        <button type="button" onClick={onOpenMenu} aria-label="教材メニューを開く">
          <MoreHorizontal aria-hidden="true" />
        </button>
      </header>

      <section className="bookshelf-detail-hero">
        <MaterialCover material={material} />
        <div className="bookshelf-detail-hero-copy">
          <h2>{material.name}</h2>
          <p>{subject?.name ?? material.subjectName}</p>
          {preferences.favorite ? <span className="bookshelf-important-chip">よく使う</span> : null}
          <div className="bookshelf-detail-progress-line">
            <div className="bookshelf-detail-progress-track" aria-hidden="true">
              <span style={{ width: `${progressRate}%` }} />
            </div>
            <strong>進捗 {Math.round(progressRate)}%</strong>
          </div>
          {pace.enabled && pace.totalUnits !== null ? (
            <small>
              {pace.currentUnit} / {pace.totalUnits} {unitLabel}
            </small>
          ) : null}
        </div>
      </section>

      <section className="bookshelf-detail-metrics" aria-label="教材の学習状況">
        <div>
          <Clock3 aria-hidden="true" />
          <span>使用時間</span>
          <strong>{formatMinutes(summary.actualMinutes)}</strong>
        </div>
        <div>
          <Clock3 aria-hidden="true" />
          <span>予定時間</span>
          <strong>{formatMinutes(summary.plannedMinutes)}</strong>
        </div>
        <div>
          <BookOpen aria-hidden="true" />
          <span>セッション数</span>
          <strong>{summary.sessionCount}回</strong>
        </div>
        <div>
          <CalendarDays aria-hidden="true" />
          <span>最終学習日</span>
          <strong>{summary.lastStudyDate ? formatDateLabel(summary.lastStudyDate) : '未記録'}</strong>
        </div>
      </section>

      <nav className="bookshelf-detail-tabs" aria-label="教材詳細タブ">
        <button
          className={activeTab === 'overview' ? 'active' : ''}
          onClick={() => setTab('overview')}
          type="button"
        >
          概要
        </button>
        {canShowStructure ? (
          <button
            className={activeTab === 'structure' ? 'active' : ''}
            onClick={() => setTab('structure')}
            type="button"
          >
            教材内構造
          </button>
        ) : null}
        <button
          className={activeTab === 'logs' ? 'active' : ''}
          onClick={() => setTab('logs')}
          type="button"
        >
          学習記録
        </button>
        <button
          className={activeTab === 'schedule' ? 'active' : ''}
          onClick={() => setTab('schedule')}
          type="button"
        >
          予定
        </button>
      </nav>

      <div className="bookshelf-detail-content">
        {activeTab === 'overview' ? (
          <div className="bookshelf-detail-section-stack">
            {preferences.structureEnabled ? (
              <section className="bookshelf-structure-status">
                <div>
                  <strong>
                    教材内構造: {preferences.structureVisible ? '表示中' : '非表示'}
                  </strong>
                  <span>
                    {preferences.structureVisible
                      ? currentStructureItem
                        ? `現在地: ${currentStructureItem.title}`
                        : '項目を追加すると現在地を表示できます。'
                      : '全体進捗だけでシンプルに管理しています。'}
                  </span>
                </div>
                <button type="button" onClick={onOpenDisplaySettings}>表示設定</button>
              </section>
            ) : (
              <section className="bookshelf-structure-status is-disabled">
                <div>
                  <strong>教材内構造は使用していません</strong>
                  <span>章・節を登録しなくても、教材全体の進捗だけで管理できます。</span>
                </div>
                <button type="button" onClick={onEditStructure}>設定する</button>
              </section>
            )}

            {canShowStructure ? (
              <section>
                <div className="bookshelf-detail-section-head">
                  <h3>教材内構造</h3>
                  <button type="button" onClick={onEditStructure}>編集</button>
                </div>
                {preferences.structureItems.length > 0 ? (
                  <StructureRows
                    items={preferences.structureItems.slice(0, 5)}
                    currentUnit={material.currentUnit}
                  />
                ) : (
                  <div className="bookshelf-detail-empty">
                    <p>まだ章・節などの項目がありません。</p>
                    <button type="button" onClick={onEditStructure}>項目を追加</button>
                  </div>
                )}
              </section>
            ) : (
              <section className="bookshelf-aggregate-progress">
                <div className="bookshelf-detail-section-head">
                  <h3>現在の進捗</h3>
                </div>
                {pace.enabled && pace.totalUnits !== null ? (
                  <p>
                    現在 {pace.currentUnit} / {pace.totalUnits} {unitLabel}
                  </p>
                ) : (
                  <p>教材ペース管理を有効にすると、全体の現在位置を表示できます。</p>
                )}
              </section>
            )}

            <section>
              <div className="bookshelf-detail-section-head">
                <h3>最近の学習記録</h3>
                <button type="button" onClick={() => setTab('logs')}>すべて見る</button>
              </div>
              {summary.recentActuals.length > 0 ? (
                <div className="bookshelf-activity-list">
                  {summary.recentActuals.slice(0, 2).map((actual) => (
                    <div key={actual.id}>
                      <span>{formatDateLabel(actual.occurrenceDate)}</span>
                      <strong>{formatMinutes(Math.max(0, Math.round((new Date(`1970-01-01T${actual.actualEndTime}:00`).getTime() - new Date(`1970-01-01T${actual.actualStartTime}:00`).getTime()) / 60000)))}</strong>
                      <small>{getActualRangeLabel(actual, material) ?? actual.note || '学習記録'}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="bookshelf-detail-muted">この教材に紐づく学習記録はまだありません。</p>
              )}
            </section>

            <section>
              <div className="bookshelf-detail-section-head">
                <h3>今後の予定</h3>
                <button type="button" onClick={() => setTab('schedule')}>すべて見る</button>
              </div>
              {summary.upcomingPlans.length > 0 ? (
                <div className="bookshelf-activity-list">
                  {summary.upcomingPlans.slice(0, 2).map((plan) => (
                    <div key={plan.id}>
                      <span>{formatDateLabel(plan.date)}</span>
                      <strong>{plan.startTime}–{plan.endTime}</strong>
                      <small>{plan.title}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="bookshelf-detail-muted">この教材の予定はまだありません。</p>
              )}
            </section>
          </div>
        ) : null}

        {activeTab === 'structure' ? (
          <section>
            <div className="bookshelf-detail-section-head">
              <div>
                <h3>教材内構造</h3>
                {currentStructureItem ? <p>現在地: {currentStructureItem.title}</p> : null}
              </div>
              <button type="button" onClick={onEditStructure}>編集</button>
            </div>
            {preferences.structureItems.length > 0 ? (
              <StructureRows
                items={preferences.structureItems}
                currentUnit={material.currentUnit}
              />
            ) : (
              <div className="bookshelf-detail-empty">
                <p>章・節・単元などを自由に追加できます。</p>
                <button type="button" onClick={onEditStructure}>最初の項目を追加</button>
              </div>
            )}
          </section>
        ) : null}

        {activeTab === 'logs' ? (
          <section>
            <div className="bookshelf-detail-section-head">
              <h3>学習記録</h3>
            </div>
            {summary.recentActuals.length > 0 ? (
              <div className="bookshelf-activity-list is-long">
                {summary.recentActuals.map((actual) => (
                  <div key={actual.id}>
                    <span>{formatDateLabel(actual.occurrenceDate)}</span>
                    <strong>{actual.actualStartTime}–{actual.actualEndTime}</strong>
                    <small>{getActualRangeLabel(actual, material) ?? actual.note || '学習記録'}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="bookshelf-detail-muted">この教材に紐づく学習記録はまだありません。</p>
            )}
          </section>
        ) : null}

        {activeTab === 'schedule' ? (
          <section>
            <div className="bookshelf-detail-section-head">
              <h3>今後の予定</h3>
            </div>
            {summary.upcomingPlans.length > 0 ? (
              <div className="bookshelf-activity-list is-long">
                {summary.upcomingPlans.map((plan) => (
                  <div key={plan.id}>
                    <span>{formatDateLabel(plan.date)}</span>
                    <strong>{plan.startTime}–{plan.endTime}</strong>
                    <small>{plan.title}</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bookshelf-detail-empty">
                <p>この教材の予定はまだありません。</p>
                <button type="button" onClick={onAddToPlan}>予定に追加</button>
              </div>
            )}
          </section>
        ) : null}
      </div>

      <div className="bookshelf-detail-primary-action">
        <button type="button" onClick={onAddToPlan}>
          <CalendarDays aria-hidden="true" />
          この教材を予定に追加
        </button>
      </div>
    </section>
  );
}
