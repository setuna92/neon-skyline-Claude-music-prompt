import { useCallback, useEffect, useRef, useState } from 'react'
import { getExternalSendConsent, hasClaudeApiKey, setExternalSendConsent } from '../lib/db'

interface UseClaudeExternalSendConsentResult {
  hasApiKey: boolean | null
  consentModalOpen: boolean
  /** 送信同意が済んでいれば即座に、未同意なら同意モーダルを挟んでからactionを実行する */
  runWithConsent: (action: () => void | Promise<void>) => Promise<void>
  handleConsentGranted: () => Promise<void>
  handleConsentCancelled: () => void
}

/** Claude API送信前の「APIキー有無」「外部送信への同意」を扱う共通ロジック(歌詞プロンプト・あらすじ生成で共用) */
export function useClaudeExternalSendConsent(): UseClaudeExternalSendConsentResult {
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [consentModalOpen, setConsentModalOpen] = useState(false)
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null)

  useEffect(() => {
    hasClaudeApiKey().then(setHasApiKey).catch(() => setHasApiKey(false))
  }, [])

  const runWithConsent = useCallback(async (action: () => void | Promise<void>) => {
    const consent = await getExternalSendConsent()
    if (!consent.granted) {
      pendingActionRef.current = action
      setConsentModalOpen(true)
      return
    }
    await action()
  }, [])

  const handleConsentGranted = useCallback(async () => {
    await setExternalSendConsent(true)
    setConsentModalOpen(false)
    const action = pendingActionRef.current
    pendingActionRef.current = null
    if (action) await action()
  }, [])

  const handleConsentCancelled = useCallback(() => {
    setConsentModalOpen(false)
    pendingActionRef.current = null
  }, [])

  return { hasApiKey, consentModalOpen, runWithConsent, handleConsentGranted, handleConsentCancelled }
}
