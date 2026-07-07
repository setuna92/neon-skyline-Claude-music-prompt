import { useEffect, useState } from 'react'
import type { LyricsPromptResult, LyricsPromptVariant } from '../types/lyricsPrompt'
import {
  getClaudeApiKey,
  getClaudeModel,
  getExternalSendConsent,
  hasClaudeApiKey,
  setExternalSendConsent,
  updateHistoryEntry,
  updateLyricsQuality,
} from '../lib/db'
import { callClaude } from '../lib/claudeClient'
import { StarRating } from './StarRating'
import { ConsentModal } from './ConsentModal'

interface LyricsPromptResultPanelProps {
  historyEntryId: string
  result: LyricsPromptResult
}

interface ClaudeCallState {
  status: 'idle' | 'loading' | 'done' | 'error'
  text?: string
  error?: string
}

export function LyricsPromptResultPanel({ historyEntryId, result }: LyricsPromptResultPanelProps) {
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(undefined)
  const [rating, setRating] = useState(0)
  const [tagsInput, setTagsInput] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [claudeResults, setClaudeResults] = useState<Record<string, ClaudeCallState>>({})
  const [pendingVariant, setPendingVariant] = useState<LyricsPromptVariant | null>(null)
  const [consentModalOpen, setConsentModalOpen] = useState(false)

  const [actualLyricsText, setActualLyricsText] = useState('')
  const [lyricsQualityRating, setLyricsQualityRating] = useState(0)
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)

  useEffect(() => {
    hasClaudeApiKey().then(setHasApiKey).catch(() => setHasApiKey(false))
  }, [])

  async function persist(patch: { selectedVariantId?: string; rating?: number; tags?: string[] }) {
    await updateHistoryEntry(historyEntryId, patch)
    setSaved(true)
  }

  async function handleActualLyricsBlur() {
    await updateLyricsQuality(historyEntryId, { actualLyricsText })
    setSaved(true)
  }

  async function handleLyricsQualityRate(value: number) {
    setLyricsQualityRating(value)
    await updateLyricsQuality(historyEntryId, { lyricsQualityRating: value })
    setSaved(true)
  }

  function handleSelect(variantId: string) {
    setSelectedVariantId(variantId)
    void persist({ selectedVariantId: variantId })
  }

  function handleRate(value: number) {
    setRating(value)
    void persist({ rating: value })
  }

  function handleTagsBlur() {
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    void persist({ tags })
  }

  async function handleCopy(id: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
  }

  async function performSend(variant: LyricsPromptVariant) {
    setClaudeResults((prev) => ({ ...prev, [variant.variantId]: { status: 'loading' } }))
    try {
      const apiKey = await getClaudeApiKey()
      if (!apiKey) {
        throw new Error('Claude APIキーが未設定です。設定タブから登録してください。')
      }
      const model = await getClaudeModel()
      const text = await callClaude(variant.promptText, { apiKey, model })
      setClaudeResults((prev) => ({ ...prev, [variant.variantId]: { status: 'done', text } }))
      // 実際に得られた歌詞欄が空ならこの応答で埋めておく(手動で書き換え・上書き可能)
      if (!actualLyricsText.trim()) {
        setActualLyricsText(text)
        await updateLyricsQuality(historyEntryId, { actualLyricsText: text })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Claudeへの送信に失敗しました'
      setClaudeResults((prev) => ({ ...prev, [variant.variantId]: { status: 'error', error: message } }))
    }
  }

  async function handleSendToClaude(variant: LyricsPromptVariant) {
    const consent = await getExternalSendConsent()
    if (!consent.granted) {
      setPendingVariant(variant)
      setConsentModalOpen(true)
      return
    }
    await performSend(variant)
  }

  async function handleConsentGranted() {
    await setExternalSendConsent(true)
    setConsentModalOpen(false)
    if (pendingVariant) {
      const variant = pendingVariant
      setPendingVariant(null)
      await performSend(variant)
    }
  }

  function handleConsentCancelled() {
    setConsentModalOpen(false)
    setPendingVariant(null)
  }

  return (
    <section className="glass-panel glass-panel-hover p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-neon-cyan font-semibold">歌詞プロンプト（3案）</h2>
        {saved && <span className="text-[10px] text-text-muted">保存済み</span>}
      </div>
      <p className="text-[11px] text-text-muted">
        コピーして他のAIチャットボットに貼り付けるか、「Claudeに送信」でこのアプリから直接Claude APIに投げて結果を確認できます。
      </p>
      {hasApiKey === false && (
        <p className="text-[10px] text-text-muted">
          「Claudeに送信」を使うには設定タブでAPIキーを登録してください。使わなくても、下の「実際に得られた歌詞」欄に
          Copilot等から得た歌詞を貼り付ければ学習に反映されます。
        </p>
      )}

      <div className="space-y-3">
        {result.variants.map((variant) => {
          const claudeState = claudeResults[variant.variantId] ?? { status: 'idle' as const }
          return (
            <article
              key={variant.variantId}
              className={`border rounded-lg p-3 bg-dark-lighter ${
                selectedVariantId === variant.variantId ? 'border-neon-blue' : 'border-border-neon'
              }`}
            >
              <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                <h3 className="text-neon-green text-sm font-semibold">{variant.styleLabel}</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelect(variant.variantId)}
                    className={`text-[11px] px-2 py-0.5 rounded border ${
                      selectedVariantId === variant.variantId
                        ? 'border-neon-blue text-neon-blue'
                        : 'border-border-neon text-text-secondary'
                    }`}
                  >
                    {selectedVariantId === variant.variantId ? '採用中' : 'これを採用'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(variant.variantId, variant.promptText)}
                    className="text-[11px] px-2 py-0.5 btn-ghost"
                  >
                    {copiedId === variant.variantId ? 'コピー済み' : 'コピー'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendToClaude(variant)}
                    disabled={claudeState.status === 'loading' || hasApiKey === false}
                    title={hasApiKey === false ? '設定タブでClaude APIキーを登録すると使えます' : undefined}
                    className="text-[11px] px-2 py-0.5 btn-ghost disabled:opacity-50"
                  >
                    {claudeState.status === 'loading' ? '送信中…' : 'Claudeに送信'}
                  </button>
                </div>
              </div>
              <p className="text-xs text-text-secondary whitespace-pre-line">{variant.promptText}</p>

              {claudeState.status === 'error' && (
                <p className="text-[11px] text-neon-pink mt-2">{claudeState.error}</p>
              )}
              {claudeState.status === 'done' && claudeState.text && (
                <div className="mt-2 border-t border-border-neon pt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-neon-purple">Claudeの応答</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(`claude-${variant.variantId}`, claudeState.text ?? '')}
                      className="text-[11px] px-2 py-0.5 btn-ghost"
                    >
                      {copiedId === `claude-${variant.variantId}` ? 'コピー済み' : 'コピー'}
                    </button>
                  </div>
                  <p className="text-xs text-text-primary whitespace-pre-line">{claudeState.text}</p>
                </div>
              )}
            </article>
          )
        })}
      </div>

      <div className="pt-2 border-t border-border-neon space-y-2">
        <div>
          <span className="text-xs text-text-secondary block mb-1">このプロンプトの評価</span>
          <StarRating value={rating} onChange={handleRate} />
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="lyrics-tags-input">
            タグ（カンマ区切り）
          </label>
          <input
            id="lyrics-tags-input"
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            onBlur={handleTagsBlur}
            placeholder="例: 良かった, 次回も使う"
            className="w-full input-neon px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="pt-2 border-t border-border-neon space-y-2">
        <p className="text-[11px] text-text-muted">
          Copilot・ChatGPT・Claudeなど、どこに送って得たものでも構いません。実際にできた歌詞をここに貼り付けて評価すると、
          プロンプトの見た目ではなく最終的な歌詞の質に基づいてキーワードの学習が進みます。
        </p>
        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="actual-lyrics-text">
            実際に得られた歌詞（貼り付け）
          </label>
          <textarea
            id="actual-lyrics-text"
            value={actualLyricsText}
            onChange={(e) => setActualLyricsText(e.target.value)}
            onBlur={handleActualLyricsBlur}
            placeholder="Copilot等に送って得られた歌詞をここに貼り付けてください"
            rows={5}
            className="w-full input-neon px-3 py-2 text-sm"
          />
        </div>
        <div>
          <span className="text-xs text-text-secondary block mb-1">この歌詞そのものの評価</span>
          <StarRating value={lyricsQualityRating} onChange={handleLyricsQualityRate} />
        </div>
      </div>

      <ConsentModal open={consentModalOpen} onConsent={handleConsentGranted} onCancel={handleConsentCancelled} />
    </section>
  )
}
