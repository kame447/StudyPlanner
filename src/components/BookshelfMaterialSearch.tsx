import { useState } from 'react';
import { Search } from 'lucide-react';
import {
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
    candidate.publishedYear ? String(candidate.publishedYear) : '',
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
          ? `${response.results.length}件見つかりました。候補を選ぶと教材名へ反映します。`
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

  return (
    <section className="material-metadata-search" aria-label="教材検索">
      <div className="material-metadata-search-heading">
        <div>
          <strong>登録済みの本を検索</strong>
          <p className="detail-note">ISBNまたは教材名で検索できます。検索を使わず手入力しても構いません。</p>
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
          disabled={isSearching || !query.trim()}
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
          {results.map((candidate) => (
            <button
              key={candidate.catalogEntryId}
              className="material-metadata-result"
              onClick={() => {
                onSelect(candidate);
                setStatus('候補を教材名へ反映しました。教科や進捗設定を確認して保存してください。');
              }}
              type="button"
            >
              <strong>{candidate.title}</strong>
              {candidateMeta(candidate) ? <span>{candidateMeta(candidate)}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <p className="detail-note material-metadata-attribution">
        書誌情報の一部は
        <a href="https://ndlsearch.ndl.go.jp/" target="_blank" rel="noreferrer">
          国立国会図書館サーチ
        </a>
        の全国書誌情報（CC BY 4.0）を利用しています。
      </p>
    </section>
  );
}
