import type { ThemeMode } from '../hooks/useThemePreference';

interface DisplaySettingsDialogProps {
  open: boolean;
  themeMode: ThemeMode;
  onChangeTheme: (nextThemeMode: ThemeMode) => void;
  onClose: () => void;
}

export function DisplaySettingsDialog({
  open,
  themeMode,
  onChangeTheme,
  onClose,
}: DisplaySettingsDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="overlay modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>表示設定</h2>
              <p>画面テーマを切り替えます。設定はこの端末に保存されます。</p>
            </div>
            <button className="ghost-button" onClick={onClose} type="button">
              閉じる
            </button>
          </div>

          <section className="assistant-settings-card">
            <div className="field">
              <span>テーマ</span>
              <div className="segmented-control">
                <button
                  className={themeMode === 'light' ? 'segment active' : 'segment'}
                  onClick={() => onChangeTheme('light')}
                  type="button"
                >
                  ライト
                </button>
                <button
                  className={themeMode === 'dark' ? 'segment active' : 'segment'}
                  onClick={() => onChangeTheme('dark')}
                  type="button"
                >
                  ダーク
                </button>
              </div>
            </div>

            <p className="inline-note">
              勉強時間の確認や、夜間の利用に合わせて見やすい方へ切り替えられます。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
