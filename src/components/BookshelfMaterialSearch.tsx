import { useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import {
  resolveMaterialMetadataCandidate,
  searchMaterialMetadata,
  type MaterialMetadataCandidate,
} from '../services/materialMetadataService';
import '../styles/material-metadata.css';

interface BookshelfMaterialSearchProps {
  onSelect: (candidate: MaterialMetadataCandidate) => void;
  compact?: boolean;
  onSelectionFocusReturn?: () => void;
  onSelectionPendingChange?: (pending: boolean) => void;
}

function candidateMeta(candidate: MaterialMetadataCandidate): string {
  return [
    candidate.subjectHint,
    candidate.materialKind,
    candidate.authors.join(' / '),
    candidate.publisher,
    candidate.edition,
    candidate.publishedYear ? String(candidate.publishedYear) : '',
    candidate.pageCount ? `${candidate.pageCount}ページ` : '',
    candidate.isbn13 ? `ISBN ${candidate.isbn13}` : candidate.isbn10 ? `ISBN ${candidate.isbn10}` : '',
  ]
    .filter(Boolean)
    .join(' ・ ');
}

export function BookshelfMaterialSearch({
  onSelect,
  compact = false,
  onSelectionFocusReturn,
  onSelectionPendingChange,
}: BookshelfMaterialSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MaterialMetadataCandidate[]>([]);
  const [status, setStatus] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const selection = useRef<object | null>(null);
  const selectionFocusCleanup = useRef<(() => void) | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; selection.current = null; selectionFocusCleanup.current?.(); };
  }, []);

  function cancelSelection() {
    selectionFocusCleanup.current?.();
    selection.current = null;
    setResolvingId(null);
    onSelectionPendingChange?.(false);
    setStatus('選択を取り消しました。入力内容はそのまま保存できます。');
  }

  async function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed || isSearching) return;

    setIsSearching(true);
    setStatus('教材と表紙を検索しています...');
    setResults([]);
    try {
      const response = await searchMaterialMetadata(trimmed);
      setResults(response.results);
      const coverCount = response.results.filter((candidate) => Boolean(candidate.coverImageUrl)).length;
      setStatus(
        response.results.length > 0
          ? `${response.results.length}件見つかりました。${coverCount > 0 ? `${coverCount}件は表紙も取得しました。` : ''}教材を選ぶとページ数や目次なども確認します。`
          : '候補が見つかりませんでした。下の教材名から手入力できます。',
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : '教材検索を利用できません。下の教材名から手入力できます。',
      );
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSelect(candidate: MaterialMetadataCandidate, button?: HTMLButtonElement) {
    if (!mounted.current || selection.current) return;
    const operation = {};
    // Disabling/removing the selected result can otherwise send keyboard focus
    // to the page. A later deliberate focus change always wins this handoff.
    let returnFocus = compact && Boolean(button) && typeof document !== 'undefined'
      && document.activeElement === button;
    if (returnFocus) {
      const observeFocus = (event: FocusEvent) => {
        if (event.target !== button && event.target !== document.body) returnFocus = false;
      };
      document.addEventListener('focusin', observeFocus);
      selectionFocusCleanup.current = () => {
        document.removeEventListener('focusin', observeFocus);
        selectionFocusCleanup.current = null;
      };
    }
    selection.current = operation;
    onSelectionPendingChange?.(true);
    setResolvingId(candidate.catalogEntryId);
    setStatus('教材の表紙・ページ数・版・目次を確認しています...');
    try {
      const resolved = await resolveMaterialMetadataCandidate(candidate);
      if (!mounted.current || selection.current !== operation) return;
      onSelect(resolved);
      if (compact) setResults([]);
      if (returnFocus) onSelectionFocusReturn?.();
      const detailCount = [
        resolved.coverImageUrl,
        resolved.pageCount,
        resolved.edition,
        resolved.tableOfContents?.length,
      ].filter(Boolean).length;
      setStatus(
        compact
          ? '反映しました。内容を確認して保存してください。'
          : detailCount > 0
            ? '教材の詳しい情報を反映しました。内容を確認して保存してください。'
            : '教材名を反映しました。詳しい情報がない項目は手入力できます。',
      );
    } catch {
      if (mounted.current && selection.current === operation) {
        setStatus('教材の詳細を取得できませんでした。再選択するか手入力で登録できます。');
      }
    } finally {
      if (mounted.current && selection.current === operation) {
        selectionFocusCleanup.current?.();
        selection.current = null;
        setResolvingId(null);
        onSelectionPendingChange?.(false);
      }
    }
  }

  function handleCoverError(candidate: MaterialMetadataCandidate) {
    if (!candidate.coverImageUrl) return;
    setResults((current) =>
      current.map((item) =>
        item.catalogEntryId === candidate.catalogEntryId
          && item.coverImageUrl === candidate.coverImageUrl
          ? { ...item, coverImageUrl: undefined }
          : item,
      ),
    );
  }

  return (
    <section className="material-metadata-search" aria-label="教材検索">
      <div className="material-metadata-search-heading">
        <strong>{compact ? '検索して入力（任意）' : '教材を検索'}</strong>
        {compact ? <span>教材名から手入力もできます</span> : null}
      </div>

      <div className="material-metadata-search-form">
        <label className="field material-metadata-search-field">
          <span>ISBN / 教材名</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleSearch();
              }
            }}
            placeholder="例: 金フレ / 青チャート / 東京大学 赤本"
            autoComplete="off"
          />
        </label>
        <button
          className="ghost-button material-metadata-search-button"
          disabled={isSearching || Boolean(resolvingId) || !query.trim()}
          onClick={() => void handleSearch()}
          type="button"
        >
          <Search aria-hidden="true" size={17} strokeWidth={1.9} />
          {isSearching ? '検索中' : '検索'}
        </button>
      </div>

      {status ? <p className="detail-note material-metadata-search-status">{status}</p> : null}
      {resolvingId ? (
        <button className="ghost-button" type="button" onClick={cancelSelection}>
          教材の選択を取り消す
        </button>
      ) : null}

      {results.length > 0 ? (
        <div className="material-metadata-results" aria-label="教材検索結果">
          {results.map((candidate) => {
            const resolving = resolvingId === candidate.catalogEntryId;
            const resultHint = resolving
              ? '詳細を取得中...'
              : candidate.resolutionRequired
                ? '検索候補・選択後に実在する版とISBNを確認'
                : '選択して詳しい情報を確認';
            return (
              <button
                key={candidate.catalogEntryId}
                className="material-metadata-result"
                disabled={Boolean(resolvingId)}
                onClick={(event) => void handleSelect(candidate, event.currentTarget)}
                type="button"
              >
                <span className="material-metadata-result-cover" aria-hidden="true">
                  {candidate.coverImageUrl ? (
                    <img
                      src={candidate.coverImageUrl}
                      alt=""
                      loading="lazy"
                      onError={() => handleCoverError(candidate)}
                    />
                  ) : (
                    <BookOpen size={22} strokeWidth={1.7} />
                  )}
                </span>
                <span className="material-metadata-result-copy">
                  <strong>{candidate.title}</strong>
                  {candidateMeta(candidate) ? <span>{candidateMeta(candidate)}</span> : null}
                  <small>{resultHint}</small>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {compact ? (
        <details className="material-create-attribution">
          <summary>
            出典: <a href="https://ndlsearch.ndl.go.jp/" target="_blank" rel="noreferrer">国立国会図書館</a>
            {' · '}<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
          </summary>
          <p className="detail-note">
            書誌・目次情報は国立国会図書館全国書誌情報を加工して表示しています。
            取得できる場合のみ<a href="https://openbd.jp/" target="_blank" rel="noreferrer">openBD</a>の書影を表示します。
          </p>
        </details>
      ) : (
        <p className="detail-note material-metadata-attribution">
          書誌・目次情報には
          <a href="https://ndlsearch.ndl.go.jp/" target="_blank" rel="noreferrer">国立国会図書館全国書誌情報</a>
          （<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>）を利用します。取得できる場合のみopenBDの書影を表示します。
        </p>
      )}
    </section>
  );
}
