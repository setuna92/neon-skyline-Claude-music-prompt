import { useEffect, useState } from 'react'
import type { ConsentRecord } from '../types/persistence'
import {
  DEFAULT_CLAUDE_MODEL,
  clearClaudeApiKey,
  getClaudeModel,
  getExternalSendConsent,
  hasClaudeApiKey,
  lock,
  setClaudeApiKey,
  setClaudeModel,
  setExternalSendConsent,
} from '../lib/db'
import { ConsentModal } from './ConsentModal'
import { LearningPanel } from './LearningPanel'

interface SettingsPanelProps {
  onLock: () => void
}

export function SettingsPanel({ onLock }: SettingsPanelProps) {
  const [consent, setConsent] = useState<ConsentRecord>({ granted: false })
  const [modalOpen, setModalOpen] = useState(false)

  const [apiKeyInput, setApiKeyInput] = useState('')
  const [modelInput, setModelInput] = useState(DEFAULT_CLAUDE_MODEL)
  const [keySaved, setKeySaved] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  useEffect(() => {
    getExternalSendConsent().then(setConsent)
    hasClaudeApiKey().then(setKeySaved)
    getClaudeModel().then(setModelInput)
  }, [])

  async function handleToggle() {
    if (consent.granted) {
      await setExternalSendConsent(false)
      setConsent(await getExternalSendConsent())
    } else {
      setModalOpen(true)
    }
  }

  async function handleConsent() {
    await setExternalSendConsent(true)
    setConsent(await getExternalSendConsent())
    setModalOpen(false)
  }

  function handleCancel() {
    setModalOpen(false)
  }

  function handleLock() {
    lock()
    onLock()
  }

  async function handleSaveApiKey() {
    if (!apiKeyInput.trim()) return
    await setClaudeApiKey(apiKeyInput.trim())
    await setClaudeModel(modelInput.trim() || DEFAULT_CLAUDE_MODEL)
    setApiKeyInput('')
    setKeySaved(true)
    setSaveMessage('保存しました')
    setTimeout(() => setSaveMessage(null), 2000)
  }

  async function handleClearApiKey() {
    if (!window.confirm('保存済みのClaude APIキーを削除しますか？')) return
    await clearClaudeApiKey()
    setKeySaved(false)
  }

  return (
    <div className="space-y-4">
      <section className="glass-panel glass-panel-hover p-4 space-y-3">
        <h2 className="text-neon-cyan font-semibold">外部AI連携（Claude API）</h2>
        <p className="text-xs text-text-secondary">
          デフォルトでは外部送信は一切行われません。歌詞プロンプト画面で「Claudeに送信」を使う場合のみ、
          下記のAPIキーと、次の同意設定が必要です。作曲プロンプトは引き続きローカル生成のみです。
        </p>
        <div className="flex items-center justify-between">
          <span className="text-sm">
            送信同意: <span className={consent.granted ? 'text-neon-green' : 'text-text-muted'}>
              {consent.granted ? '許可済み' : '未許可（デフォルト）'}
            </span>
          </span>
          <button
            type="button"
            onClick={handleToggle}
            className="text-xs btn-ghost px-3 py-1.5"
          >
            {consent.granted ? '同意を取り消す' : '同意を確認する'}
          </button>
        </div>
        {consent.grantedAt && (
          <p className="text-[10px] text-text-muted">同意日時: {new Date(consent.grantedAt).toLocaleString('ja-JP')}</p>
        )}
      </section>

      <section className="glass-panel glass-panel-hover p-4 space-y-3">
        <h2 className="text-neon-purple font-semibold">Claude APIキー</h2>
        <p className="text-xs text-text-secondary">
          キーはこの端末上でパスフレーズ由来の鍵により暗号化して保存されます。ただし送信自体はブラウザから直接
          Anthropic APIへ行われるため、ネットワークタブ等からキーが見える可能性がある点にご留意ください
          （個人利用のローカルアプリという前提の設計です）。
        </p>
        <div className="flex items-center justify-between text-xs">
          <span>
            状態: <span className={keySaved ? 'text-neon-green' : 'text-text-muted'}>{keySaved ? '設定済み' : '未設定'}</span>
          </span>
          {keySaved && (
            <button type="button" onClick={handleClearApiKey} className="text-neon-pink">
              削除
            </button>
          )}
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="claude-api-key">
            APIキー
          </label>
          <input
            id="claude-api-key"
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={keySaved ? '（変更する場合のみ入力）' : 'sk-ant-...'}
            className="w-full input-neon px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="claude-model">
            モデルID
          </label>
          <input
            id="claude-model"
            type="text"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            className="w-full input-neon px-3 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={handleSaveApiKey}
          disabled={!apiKeyInput.trim()}
          className="w-full bg-neon-purple text-dark-bg font-semibold rounded-lg py-2 disabled:opacity-50"
        >
          保存
        </button>
        {saveMessage && <p className="text-[11px] text-neon-green text-center">{saveMessage}</p>}
      </section>

      <LearningPanel />

      <section className="glass-panel glass-panel-hover p-4 space-y-3">
        <h2 className="text-neon-purple font-semibold">セキュリティ</h2>
        <p className="text-xs text-text-secondary">
          データはこの端末上でパスフレーズから導出した鍵によりAES-GCM暗号化されています。
        </p>
        <button
          type="button"
          onClick={handleLock}
          className="w-full btn-ghost py-2 text-sm"
        >
          ロックする
        </button>
      </section>

      <ConsentModal open={modalOpen} onConsent={handleConsent} onCancel={handleCancel} />
    </div>
  )
}
