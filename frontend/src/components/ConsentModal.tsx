import templatesData from '../data/templates.json'
import type { PromptTemplates } from '../types/templates'

const templates = templatesData as PromptTemplates

interface ConsentModalProps {
  open: boolean
  onConsent: () => void
  onCancel: () => void
}

/**
 * 外部LLM連携（フェーズ2）用の同意モーダルの雛形。
 * 現行MVPはローカル生成のみで外部送信は発生しないため、まだどの操作からも呼び出されない。
 */
export function ConsentModal({ open, onConsent, onCancel }: ConsentModalProps) {
  if (!open) return null
  const t = templates.consentModalTemplate

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="glass-panel glass-panel-hover p-5 max-w-sm w-full space-y-3">
        <h2 className="text-neon-pink font-bold">{t.title}</h2>
        <dl className="text-xs text-text-secondary space-y-1">
          <div>
            <dt className="text-text-primary inline">{t.summaryLabel}: </dt>
            <dd className="inline">選択中のプロンプト本文（テキストのみ、履歴IDなどのメタデータは含まない）</dd>
          </div>
          <div>
            <dt className="text-text-primary inline">{t.destinationLabel}: </dt>
            <dd className="inline">外部LLM API（フェーズ2で接続予定・現在は未接続）</dd>
          </div>
          <div>
            <dt className="text-text-primary inline">{t.purposeLabel}: </dt>
            <dd className="inline">プロンプトの高度な最適化・言い換え</dd>
          </div>
        </dl>
        <p className="text-[11px] text-text-muted">{t.notes}</p>
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 btn-ghost py-2 text-sm"
          >
            {t.cancelButtonLabel}
          </button>
          <button
            type="button"
            onClick={onConsent}
            className="flex-1 bg-neon-pink text-dark-bg rounded-lg py-2 text-sm font-semibold"
          >
            {t.consentButtonLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
