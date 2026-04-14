import { useMemo, useState } from 'react';
import type { AiProvider } from '../lib/aiConfig';
import {
  buildNaturalLanguageCsvCases,
  canRunNaturalLanguageCsvCase,
  compareNaturalLanguageCaseResult,
  deriveActualRecurrenceView,
  parseNaturalLanguageCsv,
  type NaturalLanguageCsvCaseResult,
} from '../lib/naturalLanguageCsvTest';
import { generateNaturalLanguageSuggestions } from '../services/naturalLanguagePlanner';
import type { Plan } from '../types/domain';

interface NaturalLanguageCsvTesterProps {
  currentProvider: AiProvider;
  userId: string;
  plans: Plan[];
}

export function NaturalLanguageCsvTester({
  currentProvider,
  userId,
  plans,
}: NaturalLanguageCsvTesterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<NaturalLanguageCsvCaseResult[]>([]);
  const [ignoreProviderMismatch, setIgnoreProviderMismatch] = useState(
    currentProvider === 'rules',
  );

  const summary = useMemo(() => {
    return results.reduce(
      (accumulator, result) => {
        accumulator.total += 1;
        accumulator[result.status] += 1;
        return accumulator;
      },
      { total: 0, pass: 0, fail: 0, partial: 0, skip: 0 },
    );
  }, [results]);

  async function handleFileChange(file: File | null) {
    if (!file) {
      return;
    }

    const nextText = await file.text();
    setCsvText(nextText);
    setFileName(file.name);
    setError('');
    setStatus(`${file.name} を読み込みました。`);
    setResults([]);
  }

  async function handleRun() {
    if (!csvText.trim()) {
      setError('CSVファイルを読み込むか、CSVテキストを貼り付けてください。');
      return;
    }

    setIsRunning(true);

    try {
      const rows = parseNaturalLanguageCsv(csvText);
      const testCases = buildNaturalLanguageCsvCases(rows);
      const nextResults: NaturalLanguageCsvCaseResult[] = [];

      for (const testCase of testCases) {
        const runnable = canRunNaturalLanguageCsvCase(testCase, currentProvider, {
          ignoreProviderMismatch,
        });

        if (!runnable.runnable) {
          nextResults.push({
            testCase,
            mode: 'add',
            status: 'skip',
            reason: runnable.reason,
            rowResults: [],
            extraActuals: [],
          });
          continue;
        }

        const suggestions = await generateNaturalLanguageSuggestions({
          mode: 'add',
          text: testCase.input,
          selectedDate: testCase.selectedDate,
          plans,
          userId,
        });

        nextResults.push(compareNaturalLanguageCaseResult(testCase, suggestions));
      }

      setResults(nextResults);
      setError('');
      setStatus(`${nextResults.length}ケースを実行しました。`);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'CSVテストの実行に失敗しました。',
      );
      setResults([]);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="assistant-settings-card csv-test-card">
      <div className="label-row">
        <div>
          <strong>CSVテスト</strong>
          <p className="detail-note">
            自然言語ケースを一括実行して、期待値との差分を確認します。
          </p>
        </div>
        <button
          className="ghost-button"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          {isOpen ? '閉じる' : 'テストを開く'}
        </button>
      </div>

      {isOpen ? (
        <div className="section-stack">
          <label className="field field-full">
            <span>CSVファイル</span>
            <input
              type="file"
              accept=".csv,text/csv,.txt,text/plain"
              onChange={(event) => {
                void handleFileChange(event.target.files?.[0] ?? null);
              }}
            />
          </label>

          <label className="field field-full">
            <span>CSVテキスト</span>
            <textarea
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              rows={8}
              placeholder="case_id,input,..."
            />
          </label>

          <div className="row-actions">
            <span className="detail-note">
              実行プロバイダ: {currentProvider}
              {fileName ? ` / 読込ファイル: ${fileName}` : ''}
            </span>
            <button
              className="primary-button"
              onClick={() => void handleRun()}
              type="button"
              disabled={isRunning}
            >
              {isRunning ? '実行中...' : 'CSVテストを実行'}
            </button>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={ignoreProviderMismatch}
              onChange={(event) => setIgnoreProviderMismatch(event.target.checked)}
            />
            <span className="detail-note">
              CSV の provider 列を無視して、現在の provider で実行する
            </span>
          </label>

          {error ? <p className="inline-error">{error}</p> : null}
          {status ? <p className="inline-note">{status}</p> : null}

          {results.length > 0 ? (
            <div className="section-stack">
              <div className="csv-test-summary">
                <span className="confidence-badge">total {summary.total}</span>
                <span className="confidence-badge">pass {summary.pass}</span>
                <span className="confidence-badge">partial {summary.partial}</span>
                <span className="confidence-badge">fail {summary.fail}</span>
                <span className="confidence-badge">skip {summary.skip}</span>
              </div>

              {results.map((result) => (
                <article
                  key={result.testCase.caseId}
                  className={`suggestion-card csv-test-result-card ${result.status}`}
                >
                  <div className="label-row">
                    <strong>Case {result.testCase.caseId}</strong>
                    <span className="confidence-badge">
                      {result.status} /{' '}
                      {ignoreProviderMismatch &&
                      result.testCase.provider &&
                      result.testCase.provider !== currentProvider
                        ? `${result.testCase.provider} -> ${currentProvider}`
                        : result.testCase.provider || currentProvider}
                    </span>
                  </div>
                  <p className="detail-note">{result.testCase.input}</p>

                  {result.reason ? (
                    <div className="assistant-feedback-card warning">
                      <strong>補足</strong>
                      <p className="detail-note">{result.reason}</p>
                    </div>
                  ) : null}

                  {result.rowResults.map((rowResult) => (
                    <div key={`${result.testCase.caseId}-${rowResult.expected.expectedIndex}`} className="csv-test-row">
                      {(() => {
                        const actualRecurrence = rowResult.actual
                          ? deriveActualRecurrenceView(
                              rowResult.actual,
                              rowResult.expected.selectedDate,
                            )
                          : null;

                        return (
                          <>
                      <div className="label-row">
                        <strong>期待 {rowResult.expected.expectedIndex}</strong>
                        <span className="confidence-badge">{rowResult.status}</span>
                      </div>
                      <p className="detail-note">
                        expected: {rowResult.expected.expectedTitle} / {rowResult.expected.expectedSubject} /{' '}
                        {rowResult.expected.expectedDate} / {rowResult.expected.expectedStart} -{' '}
                        {rowResult.expected.expectedEnd} / {rowResult.expected.expectedRepeat}
                      </p>
                      {rowResult.actual ? (
                        <p className="detail-note">
                          actual: {rowResult.actual.parsedPlan.title} / {rowResult.actual.parsedPlan.subject} /{' '}
                          {actualRecurrence?.date ?? rowResult.actual.parsedPlan.date} /{' '}
                          {rowResult.actual.parsedPlan.startTime} - {rowResult.actual.parsedPlan.endTime} /{' '}
                          {actualRecurrence?.repeatKey ?? rowResult.actual.parsedPlan.repeat}
                          {actualRecurrence?.repeatUntil
                            ? ` until ${actualRecurrence.repeatUntil}`
                            : ''}
                        </p>
                      ) : null}
                      {rowResult.mismatches.length > 0 ? (
                        <ul className="assistant-feedback-list">
                          {rowResult.mismatches.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                      {rowResult.notes.length > 0 ? (
                        <ul className="assistant-feedback-list">
                          {rowResult.notes.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
