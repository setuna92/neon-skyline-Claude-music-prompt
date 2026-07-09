import { useEffect, useRef, useState } from 'react'
import type { ClaudeCompositionResult, ClaudeCompositionVariant } from '../types/claudeComposition'
import {
  getAllHistory,
  getClaudeApiKey,
  getClaudeModel,
  getExternalSendConsent,
  hasClaudeApiKey,
  onDataChange,
  setExternalSendConsent,
  updateHistoryEntry,
  updateClaudeCompositionQuality,
} from '../lib/db'
import { callClaude } from '../lib/claudeClient'
import { StarRating } from './StarRating'
import { ConsentModal } from './ConsentModal'

interface ClaudeCompositionResultPanelProps {
  historyEntryId: string
  result: ClaudeCompositionResult
}

interface ClaudeCallState {
  status: 'idle' | 'loading' | 'done' | 'error'
  text?: string
  error?: string
}

// 「🎵 Sunoで自動作曲」ボタン経由で保存された履歴に付くタグ(ClaudeCompositionForm.tsx参照)
const AUTO_COMPOSE_TAG = '自動作曲'

type HistoryLoadStatus = 'loading' | 'done' | 'error'

export function ClaudeCompositionResultPanel({ historyEntryId, result }: ClaudeCompositionResultPanelProps) {
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(undefined)
  const [rating, setRating] = useState(0)
  const [tagsInput, setTagsInput] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [claudeResults, setClaudeResults] = useState<Record<string, ClaudeCallState>>({})
  const [pendingVariant, setPendingVariant] = useState<ClaudeCompositionVariant | null>(null)
  const [consentModalOpen, setConsentModalOpen] = useState(false)

  const [actualCompositionPromptText, setActualCompositionPromptText] = useState('')
  const [compositionPromptQualityRating, setCompositionPromptQualityRating] = useState(0)
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)

  // 「実際に得られた作曲プロンプト」欄が、ユーザー自身の貼り付けではなく
  // 「🎵 Sunoで自動作曲」から自動的に保存されたものかどうか
  const [autoRecordedViaSuno, setAutoRecordedViaSuno] = useState(false)

  const [historyLoadStatus, setHistoryLoadStatus] = useState<HistoryLoadStatus>('loading')
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null)

  // ユーザーが「実際に得られた作曲プロンプト」欄を自分で編集し始めたかどうか。
  // 「🎵 Sunoで自動作曲」はパネル表示後(onGenerated呼び出し後)に非同期でClaude APIを呼んでから
  // actualCompositionPromptTextを保存するため、初回読み込み時点ではまだ間に合わないことがある。
  // onDataChangeで後から届いた更新を反映したいが、ユーザーが既に手で編集を始めていたら上書きしない。
  const userEditedActualTextRef = useRef(false)

  useEffect(() => {
    hasClaudeApiKey().then(setHasApiKey).catch(() => setHasApiKey(false))
  }, [])

  // historyEntryId(表示対象の履歴)が変わるたびに、その履歴の実データで各stateを初期化し直す。
  // 「🎵 Sunoで自動作曲」はフォーム側から直接actualCompositionPromptText等を保存するため、
  // このパネルが開かれた時点で既に値が入っている場合がある。それをここで読み込んで表示する。
  useEffect(() => {
    let cancelled = false
    userEditedActualTextRef.current = false

    async function loadFromHistory(isInitialLoad: boolean) {
      if (isInitialLoad) {
        setHistoryLoadStatus('loading')
        setHistoryLoadError(null)
      }
      try {
        const entries = await getAllHistory()
        if (cancelled) return
        const entry = entries.find((e) => e.id === historyEntryId)

        if (entry && entry.kind === 'claudeComposition') {
          // ユーザーが既にこの欄を編集し始めている場合、後追いの自動反映で上書きしない
          if (isInitialLoad || !userEditedActualTextRef.current) {
            setActualCompositionPromptText(entry.actualCompositionPromptText ?? '')
            setCompositionPromptQualityRating(entry.compositionPromptQualityRating ?? 0)
            setAutoRecordedViaSuno(
              Boolean(entry.actualCompositionPromptText?.trim()) && (entry.tags ?? []).includes(AUTO_COMPOSE_TAG),
            )
          }
          if (isInitialLoad) {
            setSelectedVariantId(entry.selectedVariantId)
            setRating(entry.rating ?? 0)
            setTagsInput((entry.tags ?? []).join(', '))
          }
        } else if (isInitialLoad) {
          setSelectedVariantId(undefined)
          setRating(0)
          setTagsInput('')
          setActualCompositionPromptText('')
          setCompositionPromptQualityRating(0)
          setAutoRecordedViaSuno(false)
        }

        if (isInitialLoad) {
          // Claudeへの送信結果・コピー済み表示など、この履歴に紐づく一時的な表示状態もリセットする
          setClaudeResults({})
          setCopiedId(null)
          setSaved(false)
          setHistoryLoadStatus('done')
        }
      } catch (err) {
        if (cancelled) return
        if (!isInitialLoad) {
          // バックグラウンドでの再読み込み失敗はUIをエラー状態にはしない(初回表示は既に成功しているため)が、
          // 気づけるようにログには残しておく
          console.error('履歴のバックグラウンド再読み込みに失敗しました', err)
          return
        }
        setHistoryLoadError(err instanceof Error ? err.message : '履歴の読み込みに失敗しました')
        setHistoryLoadStatus('error')
      }
    }

    void loadFromHistory(true)
    // 「Sunoで自動作曲」がこのパネル表示後に非同期でactualCompositionPromptTextを保存した場合に備え、
    // データ変化を購読して後追いで反映する(ユーザーが編集中でなければ)
    const unsubscribe = onDataChange(() => void loadFromHistory(false))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [historyEntryId])

  async function persist(patch: { selectedVariantId?: string; rating?: number; tags?: string[] }) {
    await updateHistoryEntry(historyEntryId, patch)
    setSaved(true)
  }

  async function handleActualCompositionPromptBlur() {
    await updateClaudeCompositionQuality(historyEntryId, { actualCompositionPromptText })
    setSaved(true)
  }

  async function handleCompositionPromptQualityRate(value: number) {
    setCompositionPromptQualityRating(value)
    await updateClaudeCompositionQuality(historyEntryId, { compositionPromptQualityRating: value })
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

  async function performSend(variant: ClaudeCompositionVariant) {
    setClaudeResults((prev) => ({ ...prev, [variant.variantId]: { status: 'loading' } }))
    try {
      const apiKey = await getClaudeApiKey()
      if (!apiKey) {
        throw new Error('Claude APIキーが未設定です。設定タブから登録してください。')
      }
      const model = await getClaudeModel()
      const text = await callClaude(variant.promptText, { apiKey, model })
      setClaudeResults((prev) => ({ ...prev, [variant.variantId]: { status: 'done', text } }))
      // 実際に得られた作曲プロンプト欄が空ならこの応答で埋めておく(手動で書き換え・上書き可能)
      if (!actualCompositionPromptText.trim()) {
        setActualCompositionPromptText(text)
        await updateClaudeCompositionQuality(historyEntryId, { actualCompositionPromptText: text })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Claudeへの送信に失敗しました'
      setClaudeResults((prev) => ({ ...prev, [variant.variantId]: { status: 'error', error: message } }))
    }
  }

  async function handleSendToClaude(variant: ClaudeCompositionVariant) {
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
        <h2 className="text-neon-cyan font-semibold">Claude作曲プロンプト（3案）</h2>
        {saved && <span className="text-[10px] text-text-muted">保存済み</span>}
      </div>
      <p className="text-[11px] text-text-muted">
        コピーして他のAIチャットボットに貼り付けるか、「Claudeに送信」でこのアプリから直接Claude APIに投げて結果を確認できます。
      </p>
      {historyLoadStatus === 'loading' && (
        <p className="text-[11px] text-text-muted">履歴データを読み込み中…</p>
      )}
      {historyLoadStatus === 'error' && (
        <p className="text-[11px] text-neon-pink">
          {historyLoadError ?? '履歴の読み込みに失敗しました'}（評価やタグの保存はできますが、既存の入力内容が反映されていない可能性があります）
        </p>
      )}
      {hasApiKey === false && (
        <p className="text-[10px] text-text-muted">
          「Claudeに送信」を使うには設定タブでAPIキーを登録してください。使わなくても、下の「実際に得られた作曲プロンプト」欄に
          Copilot等から得た作曲プロンプトを貼り付ければ学習に反映されます。
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
          <span className="text-xs text-text-secondary block mb-1">この指示文の評価</span>
          <StarRating value={rating} onChange={handleRate} />
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="composition-tags-input">
            タグ（カンマ区切り）
          </label>
          <input
            id="composition-tags-input"
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
          Copilot・ChatGPT・Claudeなど、どこに送って得たものでも構いません。ここに貼り付けて評価すると、
          指示文の見た目ではなく実際にClaudeが書いた作曲プロンプトの質に基づいて学習が進みます。
        </p>
        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="actual-composition-prompt-text">
            実際に得られた作曲プロンプト（貼り付け）
          </label>
          {autoRecordedViaSuno && (
            <p className="text-[10px] text-neon-purple mb-1">
              🎵 「Sunoで自動作曲」から自動的に記録されたものです。内容を確認し、必要であれば編集してください。
            </p>
          )}
          <textarea
            id="actual-composition-prompt-text"
            value={actualCompositionPromptText}
            onChange={(e) => {
              userEditedActualTextRef.current = true
              setActualCompositionPromptText(e.target.value)
              if (autoRecordedViaSuno) setAutoRecordedViaSuno(false)
            }}
            onBlur={handleActualCompositionPromptBlur}
            placeholder="Copilot等に送って得られた作曲プロンプトをここに貼り付けてください"
            rows={5}
            className="w-full input-neon px-3 py-2 text-sm"
          />
        </div>
        <div>
          <span className="text-xs text-text-secondary block mb-1">この作曲プロンプトそのものの評価</span>
          <StarRating value={compositionPromptQualityRating} onChange={handleCompositionPromptQualityRate} />
        </div>
      </div>

      <ConsentModal open={consentModalOpen} onConsent={handleConsentGranted} onCancel={handleConsentCancelled} />
    </section>
  )
}
