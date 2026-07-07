import { useState } from 'react'
import type { GenerationResult } from '../types/generation'
import type { LyricsPromptSeed } from '../types/lyricsPrompt'
import { updateHistoryEntry } from '../lib/db'
import { StarRating } from './StarRating'

interface GenerationResultPanelProps {
  historyEntryId: string
  result: GenerationResult
  onSendToLyrics?: (seed: LyricsPromptSeed) => void
}

export function GenerationResultPanel({ historyEntryId, result, onSendToLyrics }: GenerationResultPanelProps) {
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(undefined)
  const [rating, setRating] = useState(0)
  const [tagsInput, setTagsInput] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function persist(patch: { selectedVariantId?: string; rating?: number; tags?: string[] }) {
    await updateHistoryEntry(historyEntryId, patch)
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

  async function handleCopy(variantId: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopiedId(variantId)
    setTimeout(() => setCopiedId((current) => (current === variantId ? null : current)), 1500)
  }

  function handleSendToLyrics() {
    onSendToLyrics?.({
      genreKey: result.input.genreKey,
      moodKey: result.input.moodKey,
      atmosphereKeys: result.input.atmosphereKeys,
      vocalTypeKey: result.input.vocalTypeKey,
      songStructureKey: result.input.songStructureKey,
      themeKeywords: result.input.themeKeywords ?? [],
    })
  }

  return (
    <section className="glass-panel glass-panel-hover p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-neon-cyan font-semibold">生成結果（3案）</h2>
        {saved && <span className="text-[10px] text-text-muted">保存済み</span>}
      </div>

      {onSendToLyrics && (
        <button
          type="button"
          onClick={handleSendToLyrics}
          className="w-full text-xs chip-neon px-3 py-2 text-left"
        >
          🎤 この設定に合う歌詞プロンプトを作る（ジャンル・ムード・雰囲気・テーマを引き継ぎ）
        </button>
      )}

      <div className="space-y-3">
        {result.variants.map((variant) => (
          <article
            key={variant.variantId}
            className={`border rounded-lg p-3 bg-dark-lighter ${
              selectedVariantId === variant.variantId ? 'border-neon-blue' : 'border-border-neon'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
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
              </div>
            </div>
            <p className="text-xs text-text-secondary whitespace-pre-line mb-2">{variant.englishPrompt}</p>
            <p className="text-xs text-text-muted whitespace-pre-line mb-2">{variant.japanesePrompt}</p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => handleCopy(`${variant.variantId}-en`, variant.englishPrompt)}
                aria-label="英語版プロンプトをコピー"
                className="text-[11px] px-2 py-0.5 btn-ghost"
              >
                {copiedId === `${variant.variantId}-en` ? 'コピー済み' : 'Copy Prompt (EN)'}
              </button>
              <button
                type="button"
                onClick={() => handleCopy(`${variant.variantId}-ja`, variant.japanesePrompt)}
                aria-label="日本語版プロンプトをコピー"
                className="text-[11px] px-2 py-0.5 btn-ghost"
              >
                {copiedId === `${variant.variantId}-ja` ? 'コピー済み' : 'プロンプトをコピー（日本語）'}
              </button>
              <button
                type="button"
                onClick={() => handleCopy(variant.variantId, `${variant.englishPrompt}\n\n${variant.japanesePrompt}`)}
                aria-label="英語版と日本語版の両方をコピー"
                className="text-[11px] px-2 py-0.5 btn-ghost"
              >
                {copiedId === variant.variantId ? 'コピー済み' : '両方コピー'}
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="pt-2 border-t border-border-neon space-y-2">
        <div>
          <span className="text-xs text-text-secondary block mb-1">この生成の評価</span>
          <StarRating value={rating} onChange={handleRate} />
        </div>
        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="tags-input">
            タグ（カンマ区切り）
          </label>
          <input
            id="tags-input"
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            onBlur={handleTagsBlur}
            placeholder="例: 良かった, 次回も使う"
            className="w-full input-neon px-3 py-2 text-sm"
          />
        </div>
      </div>
    </section>
  )
}
