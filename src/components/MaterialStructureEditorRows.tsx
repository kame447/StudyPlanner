import { Fragment } from 'react';
import { Trash2 } from 'lucide-react';
import type { MaterialStructureItem } from '../lib/bookshelfMaterialDetails';
import type { MaterialStructurePatch } from '../lib/materialStructureEditor';

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function MaterialStructureEditorRows({ items, unitLabel, onUpdate, onRemove, prefix = '', depth = 0 }: {
  items: MaterialStructureItem[];
  unitLabel: string;
  onUpdate: (id: string, patch: MaterialStructurePatch) => void;
  onRemove: (id: string) => void;
  prefix?: string;
  depth?: number;
}) {
  return items.map((item, index) => {
    const position = `${prefix}${index + 1}`;
    return <Fragment key={item.id}>
      <div className="bookshelf-structure-edit-row" style={{ marginInlineStart: Math.min(depth, 2) * 8 }}>
        <label>
          <span>章・節の名前 {position}</span>
          <input value={item.title} onChange={event => onUpdate(item.id, { title: event.target.value })}
            placeholder="例: 第1章 アルゴリズムの基礎" />
        </label>
        <label>
          <span>開始（{unitLabel}）</span>
          <input type="number" min="0" aria-label={`開始（${unitLabel}） ${position}`}
            value={item.startUnit ?? ''} onChange={event => onUpdate(item.id, { startUnit: parseOptionalNumber(event.target.value) })} placeholder="任意" />
        </label>
        <label>
          <span>終了（{unitLabel}）</span>
          <input type="number" min="0" aria-label={`終了（${unitLabel}） ${position}`}
            value={item.endUnit ?? ''} onChange={event => onUpdate(item.id, { endUnit: parseOptionalNumber(event.target.value) })} placeholder="任意" />
        </label>
        <label>
          <span>進捗（%・任意）</span>
          <input type="number" min="0" max="100" aria-label={`進捗（%・任意） ${position}`}
            value={item.progressRate ?? ''} onChange={event => onUpdate(item.id, { progressRate: parseOptionalNumber(event.target.value) })} placeholder="自動" />
        </label>
        <button type="button" onClick={() => onRemove(item.id)} aria-label={`${item.title || `項目${position}`}を削除`}>
          <Trash2 aria-hidden="true" />
        </button>
      </div>
      {item.children?.length ? <MaterialStructureEditorRows items={item.children} unitLabel={unitLabel}
        onUpdate={onUpdate} onRemove={onRemove} prefix={`${position}-`} depth={depth + 1} /> : null}
    </Fragment>;
  });
}
