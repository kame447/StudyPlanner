import { ArrowLeft } from 'lucide-react';

export function AdminAppReturnButton({ onReturn }: { onReturn: () => void }) {
  return (
    <button
      className="ghost-button admin-app-return-button"
      onClick={onReturn}
      type="button"
    >
      <ArrowLeft aria-hidden="true" size={18} strokeWidth={2} />
      通常画面に戻る
    </button>
  );
}
