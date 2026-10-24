import { useEffect, useRef, useState } from 'react';
import type { MaterialContentsRow } from '../../shared/materialContentsPhoto';
import type { MaterialStructureItem } from '../lib/bookshelfMaterialDetails';
import { extractMaterialContentsPhoto, materialContentsToStructure } from '../lib/materialContentsPhoto';

export function MaterialContentsPhotoImport({ hasExistingItems, onApply, includePageRanges = true }: {
  hasExistingItems: boolean;
  includePageRanges?: boolean;
  onApply: (items: MaterialStructureItem[]) => void;
}) {
  const [rows, setRows] = useState<MaterialContentsRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setRows(null);
    setError('');
  }
  async function read(file: File) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setRows(null); setError('');
    try {
      const result = await extractMaterialContentsPhoto(file, request.signal);
      if (!request.signal.aborted) setRows(result);
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : '目次を読み取れませんでした。');
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  function update(index: number, patch: Partial<MaterialContentsRow>) {
    setRows(current => current?.map((row, i) => i === index ? { ...row, ...patch } : row) ?? null);
  }
  function apply() {
    try {
      const items = materialContentsToStructure(rows ?? [], includePageRanges);
      if (hasExistingItems && !window.confirm('編集中の目次を読取結果で置き換えますか？保存するまでは元の目次は変わりません。')) return;
      onApply(items); cancel();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '目次を確認してください。');
    }
  }
  return <section className="section-stack" aria-label="目次写真の取込">
    <p>目次写真をAIで読み取れます。画像は読取のためOpenAIへ送信されます。見出し・階層・ページを確認し、保存してください。写真は教材に保存されません。</p>
    {!includePageRanges ? <p>ページ以外の進捗単位のため、章・節の名前と階層だけを取り込みます。ページ番号は進捗位置に反映しません。</p> : null}
    <input ref={input} hidden type="file" accept="image/png,image/jpeg" aria-label="目次写真を選択"
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file); }} />
    <button type="button" className="ghost-button material-contents-photo-action" onClick={() => input.current?.click()}>目次写真から読み取る</button>
    {busy ? <p role="status">目次を読み取っています…</p> : null}
    {error ? <p role="alert" className="inline-error">{error}</p> : null}
    {rows ? <div className="section-stack">
      <strong>読取結果（未保存）</strong>
      <p>読み間違いを修正してください。終了ページが不明な場合は空欄にできます。</p>
      {rows.map((row, index) => <fieldset key={index} className="section-stack">
        <legend>項目 {index + 1}</legend>
        <label>階層<select value={row.level} onChange={event => update(index, { level: Number(event.target.value) })}>
          <option value={1}>章</option><option value={2}>節</option><option value={3}>小節</option>
        </select></label>
        <label>見出し<input value={row.title} maxLength={300} onChange={event => update(index, { title: event.target.value })} /></label>
        <label>開始ページ<input type="number" min={1} max={100000} value={row.startPage ?? ''}
          onChange={event => update(index, { startPage: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <label>終了ページ<input type="number" min={1} max={100000} value={row.endPage ?? ''}
          onChange={event => update(index, { endPage: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <button type="button" onClick={() => setRows(current => current?.filter((_, i) => i !== index) ?? null)}>項目 {index + 1}を除く</button>
      </fieldset>)}
      <button type="button" className="primary-button" onClick={apply}>確認した目次を編集欄へ反映</button>
    </div> : null}
    {busy || rows ? <button type="button" className="ghost-button" onClick={cancel}>写真の取込をキャンセル</button> : null}
  </section>;
}
