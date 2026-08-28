import { useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import {
  resolveMaterialMetadataCandidate,
  searchMaterialMetadata,
  type MaterialMetadataCandidate,
} from '../services/materialMetadataService';
import '../styles/material-metadata.css';

interface BookshelfMaterialSearchProps {
  onSelect: (candidate: MaterialMetadataCandidate) => void;
}

function candidateMeta(candidate: MaterialMetadataCandidate): string {
  return [
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
}: BookshelfMaterialSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MaterialMetadataCandidate[]>([]);
  const [status, setStatus] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  async function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed || isSearching) return;

    setIsSearching(true);
    setStatus('教材を検索しています...');
    setResults([]);
    try {
      const response = await searchMaterialMetadata(trimmed);
      setResults(response.results);
      setStatus(
        response.results.length > 0
          ? `${response.results.length}件見つかりました。教材を選ぶとページ数や目次なども確認します。`
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

  async function handleSelect(candidate: MaterialMetadataCandidate) {
    if (resolvingId) return;
    setResolvingId(candidate.catalogEntryId);
    setStatus('教材のページ数・版・目次を確認しています...');
    try {
      const resolved = await resolveMaterialMetadataCandidate(candidate);
      onSelect(resolved);
      const detailCount = [
        resolved.coverImageUrl,
        resolved.pageCount,
        resolved.edition,
        resolved.tableOfContents?.length,
      ].filter(Boolean).length;
      setStatus(
        detailCount > 0
          ? '教材の詳しい情報を反映しました。内容を確認して保存してください。'
          : '教材名を反映しました。詳しい情報がない項目は手入力できます。',
      );
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <section className="material-metadata-search" aria-label="教材検索">
      <div className="material-metadata-search-heading">
        <div>
          <strong>教材を検索</strong>
          <p className="detail-note">
            教材名やISBNで探し、表紙・版・ページ数・目次が取得できれば登録前に確認できます。
          </p>
        </div>
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
            placeholder="例: 9784023315686 / 金のフレーズ"
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

      {results.length > 0 ? (
        <div className="material-metadata-results" aria-label="教材検索結果">
          {results.map((candidate) => {
            const resolving = resolvingId === candidate.catalogEntryId;
            return (
              <button
                key={candidate.catalogEntryId}
                className="material-metadata-result"
                disabled={Boolean(resolvingId)}
                onClick={() => void handleSelect(candidate)}
                type="button"
              >
                <span className="material-metadata-result-cover" aria-hidden="true">
                  {candidate.coverImageUrl ? (
                    <img src={candidate.coverImageUrl} alt="" loading="lazy" />
                  ) : (
                    <BookOpen size={22} strokeWidth={1.7} />
                  )}
                </span>
                <span className="material-metadata-result-copy">
                  <strong>{candidate.title}</strong>
                  {candidateMeta(candidate) ? <span>{candidateMeta(candidate)}</span> : null}
                  <small>{resolving ? '詳細を取得中...' : '選択して詳しい情報を確認'}</small>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <p className="detail-note material-metadata-attribution">
        書誌・目次情報には
        <a href="https://ndlsearch.ndl.go.jp/" target="_blank" rel="noreferrer">
          国立国会図書館全国書誌情報
        </a>
        （CC BY 4.0）を利用します。取得できる場合のみopenBDの書影を表示します。
      </p>
    </section>
  );
}
