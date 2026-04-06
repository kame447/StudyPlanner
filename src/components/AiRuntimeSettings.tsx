import { useEffect, useState } from 'react';
import {
  applyOllamaProfile,
  getAiConfigValidationMessage,
  getOllamaProfileId,
  getOllamaProfiles,
  getAiStorageNote,
  type AiConfig,
  type AiProvider,
  withAiProvider,
} from '../lib/aiConfig';

interface AiRuntimeSettingsProps {
  config: AiConfig;
  onSave: (config: AiConfig) => void;
  onReset: () => void;
}

const PROVIDER_OPTIONS: Array<{ value: AiProvider; label: string }> = [
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai', label: 'OpenAI互換' },
  { value: 'rules', label: 'ルールのみ' },
];

export function AiRuntimeSettings({
  config,
  onSave,
  onReset,
}: AiRuntimeSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<AiConfig>(config);
  const ollamaProfiles = getOllamaProfiles();

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const validationMessage = getAiConfigValidationMessage(draft);
  const activeOllamaProfileId = getOllamaProfileId(draft);
  const activeOllamaProfile =
    draft.provider === 'ollama'
      ? ollamaProfiles.find((profile) => profile.id === activeOllamaProfileId)
      : undefined;

  return (
    <div className="assistant-settings-card">
      <div className="label-row">
        <div>
          <strong>AI接続</strong>
          <p className="detail-note">
            ローカルOllamaとOpenAI互換APIを切り替えられます。
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
          <label className="field field-full">
            <span>プロバイダ</span>
            <div className="segmented-control">
              {PROVIDER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={
                    draft.provider === option.value ? 'segment active' : 'segment'
                  }
                  onClick={() =>
                    setDraft((current) => withAiProvider(current, option.value))
                  }
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </label>

          {draft.provider === 'ollama' ? (
            <>
              <label className="field field-full">
                <span>ローカルモデル方針</span>
                <div className="segmented-control">
                  {ollamaProfiles.map((profile) => (
                    <button
                      key={profile.id}
                      className={
                        activeOllamaProfileId === profile.id
                          ? 'segment active'
                          : 'segment'
                      }
                      onClick={() =>
                        setDraft((current) => applyOllamaProfile(current, profile.id))
                      }
                      type="button"
                    >
                      {profile.label}
                    </button>
                  ))}
                  <button
                    className={
                      activeOllamaProfileId === 'custom' ? 'segment active' : 'segment'
                    }
                    onClick={() =>
                      setDraft((current) =>
                        current.provider === 'ollama'
                          ? current
                          : withAiProvider(current, 'ollama'),
                      )
                    }
                    type="button"
                  >
                    カスタム
                  </button>
                </div>
              </label>

              <div className="assistant-feedback-card">
                <strong>
                  {activeOllamaProfile?.label ?? 'カスタム'}
                  {activeOllamaProfile ? `: ${activeOllamaProfile.model}` : ''}
                </strong>
                <p className="detail-note">
                  {activeOllamaProfile?.summary ??
                    '任意の Ollama モデル名を入れて試せます。'}
                </p>
                <p className="detail-note">
                  {activeOllamaProfile
                    ? `未取得なら ${activeOllamaProfile.pullCommand}`
                    : 'モデル名を直接入力するとカスタム設定として扱います。'}
                </p>
              </div>
            </>
          ) : null}

          {draft.provider !== 'rules' ? (
            <>
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
                  placeholder="http://127.0.0.1:11434/v1"
                />
              </label>

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
                  placeholder="gemma4:e4b / gpt-5.4-mini"
                />
              </label>
            </>
          ) : null}

          {draft.provider === 'openai' ? (
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
            {draft.provider === 'openai' ? (
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
