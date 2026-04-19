import { useEffect, useState } from 'react';
import {
  getAiConfigValidationMessage,
  getAiStorageNote,
  usesCloudflareOpenAiProxy,
  type AiConfig,
} from '../lib/aiConfig';

interface AiRuntimeSettingsProps {
  config: AiConfig;
  onSave: (config: AiConfig) => void;
  onReset: () => void;
}

export function AiRuntimeSettings({
  config,
  onSave,
  onReset,
}: AiRuntimeSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<AiConfig>(config);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const validationMessage = getAiConfigValidationMessage(draft);
  const usesOpenAiProxy = usesCloudflareOpenAiProxy(draft);

  return (
    <div className="assistant-settings-card">
      <div className="label-row">
        <div>
          <strong>AI接続</strong>
          <p className="detail-note">
            OpenAI assist の接続情報です。通常の予定抽出は先に current pipeline で処理します。
          </p>
        </div>
        <button
          className="ghost-button"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          {isOpen ? '閉じる' : '設定を開く'}
        </button>
      </div>

      {isOpen ? (
        <div className="assistant-settings-grid">
          {draft.provider !== 'rules' ? (
            <>
              {!usesOpenAiProxy ? (
                <label className="field field-full">
                  <span>接続先URL</span>
                  <input
                    value={draft.baseUrl}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
              ) : null}

              {draft.provider === 'openai' ? (
                <label className="field field-full">
                  <span>モデル名</span>
                  <input
                    value={draft.model}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                    placeholder="gpt-5.4-mini"
                  />
                </label>
              ) : null}
            </>
          ) : null}

          {draft.provider === 'openai' && !usesOpenAiProxy ? (
            <label className="field field-full">
              <span>APIキー</span>
              <input
                autoComplete="off"
                type="password"
                value={draft.apiKey}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
                placeholder="sk-..."
              />
            </label>
          ) : null}

          <div className="assistant-feedback-card">
            <strong>保存方法</strong>
            <p className="detail-note">{getAiStorageNote(draft)}</p>
            {usesOpenAiProxy ? (
              <p className="detail-note">
                Cloudflare Worker を deploy 済みなら、そのまま OpenAI を呼びます。
              </p>
            ) : null}
            {draft.provider === 'openai' && !usesOpenAiProxy ? (
              <p className="detail-note">
                公開Webアプリで使う場合は、後でバックエンド経由へ移してください。
              </p>
            ) : null}
          </div>

          {validationMessage ? (
            <p className="inline-error">{validationMessage}</p>
          ) : null}

          <div className="row-actions">
            <button className="ghost-button" onClick={onReset} type="button">
              初期値へ戻す
            </button>
            <button
              className="primary-button"
              onClick={() => onSave(draft)}
              type="button"
              disabled={Boolean(validationMessage)}
            >
              設定を反映
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
