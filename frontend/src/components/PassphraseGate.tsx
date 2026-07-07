import { useEffect, useState } from 'react'
import { isInitialized, unlockWithPassphrase } from '../lib/db'
import { migrateLegacyPresetsFromLocalStorage } from '../lib/migrateLegacyPresets'

interface PassphraseGateProps {
  onUnlock: () => void
}

export function PassphraseGate({ onUnlock }: PassphraseGateProps) {
  const [firstRun, setFirstRun] = useState<boolean | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    isInitialized().then((initialized) => setFirstRun(!initialized))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!passphrase) {
      setError('パスフレーズを入力してください')
      return
    }
    if (firstRun && passphrase !== confirmPassphrase) {
      setError('確認用パスフレーズが一致しません')
      return
    }

    setBusy(true)
    try {
      await unlockWithPassphrase(passphrase)
      await migrateLegacyPresetsFromLocalStorage()
      onUnlock()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アンロックに失敗しました')
    } finally {
      setBusy(false)
    }
  }

  if (firstRun === null) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-dark-bg text-text-secondary text-sm">
        読み込み中…
      </div>
    )
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-dark-bg text-text-primary px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm glass-panel glass-panel-hover p-6 space-y-4"
      >
        <div className="text-center">
          <h1 className="text-xl font-bold text-neon-blue">🔒 ローカルデータのロック解除</h1>
          <p className="text-xs text-text-secondary mt-2">
            {firstRun
              ? 'このパスフレーズで履歴・プリセットをこの端末上で暗号化します。忘れると復元できないのでご注意ください。'
              : 'この端末に保存された履歴・プリセットを復号するパスフレーズを入力してください。'}
          </p>
        </div>

        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="passphrase">
            パスフレーズ
          </label>
          <input
            id="passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="w-full input-neon px-3 py-2 text-sm"
            autoFocus
          />
        </div>

        {firstRun && (
          <div>
            <label className="text-xs text-text-secondary block mb-1" htmlFor="passphrase-confirm">
              パスフレーズ（確認）
            </label>
            <input
              id="passphrase-confirm"
              type="password"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              className="w-full input-neon px-3 py-2 text-sm"
            />
          </div>
        )}

        {error && <p className="text-xs text-neon-pink">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full btn-primary py-2 disabled:opacity-50"
        >
          {busy ? '処理中…' : firstRun ? '設定して開始' : 'ロック解除'}
        </button>
      </form>
    </div>
  )
}
