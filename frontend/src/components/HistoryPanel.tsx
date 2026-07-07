import { useEffect, useMemo, useState } from 'react'
import templatesData from '../data/templates.json'
import type { PromptTemplates } from '../types/templates'
import type { HistoryEntry } from '../types/persistence'
import { clearHistory, deleteHistoryEntry, exportEncryptedBackup, getAllHistory } from '../lib/db'
import { StarRating } from './StarRating'

const templates = templatesData as PromptTemplates

function genreLabel(genreKey: string): string {
  return templates.genres.find((g) => g.key === genreKey)?.label ?? genreKey
}

function kindLabel(kind: HistoryEntry['kind']): string {
  return kind === 'lyricsPrompt' ? '歌詞プロンプト' : '作曲プロンプト'
}

function variantPreview(variant: HistoryEntry['variants'][number]): string {
  return 'promptText' in variant ? variant.promptText : variant.englishPrompt
}

export function HistoryPanel() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [minRating, setMinRating] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    setLoadError(null)
    try {
      setEntries(await getAllHistory())
    } catch (err) {
      // 読み込み失敗を握りつぶすと「履歴はまだありません」と表示され
      // データが消えたように見えてしまうため、エラーとして明示する
      setLoadError(err instanceof Error ? err.message : '履歴の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (minRating > 0 && (entry.rating ?? 0) < minRating) return false
      if (!q) return true
      const variantTexts =
        entry.kind === 'lyricsPrompt'
          ? entry.variants.map((v) => v.promptText)
          : entry.variants.flatMap((v) => [v.englishPrompt, v.japanesePrompt])
      const haystack = [genreLabel(entry.input.genreKey), ...entry.tags, ...variantTexts].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [entries, query, minRating])

  async function handleDelete(id: string) {
    if (!window.confirm('この履歴を削除しますか？')) return
    await deleteHistoryEntry(id)
    await reload()
  }

  async function handleClearAll() {
    if (!window.confirm('すべての履歴を削除しますか？この操作は取り消せません。')) return
    await clearHistory()
    await reload()
  }

  async function handleExport() {
    const backup = await exportEncryptedBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `music-prompt-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="glass-panel glass-panel-hover p-4 space-y-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ジャンル・タグ・本文を検索…"
          className="w-full input-neon px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary" htmlFor="min-rating">
            最低評価
          </label>
          <select
            id="min-rating"
            value={minRating}
            onChange={(e) => setMinRating(Number(e.target.value))}
            className="input-neon px-2 py-1 text-xs"
          >
            <option value={0}>指定なし</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                ★{n}以上
              </option>
            ))}
          </select>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleExport}
            className="text-xs btn-ghost px-2 py-1"
          >
            エクスポート
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="text-xs btn-danger-ghost px-2 py-1"
          >
            全削除
          </button>
        </div>
      </div>

      {loading && <p className="text-xs text-text-secondary text-center">読み込み中…</p>}

      {!loading && loadError && (
        <div className="text-center py-6 space-y-2">
          <p className="text-xs text-neon-pink">履歴の読み込みに失敗しました: {loadError}</p>
          <button type="button" onClick={() => void reload()} className="text-xs btn-ghost px-3 py-1">
            再試行
          </button>
        </div>
      )}

      {!loading && !loadError && filteredEntries.length === 0 && (
        <p className="text-xs text-text-secondary text-center py-6">
          {entries.length === 0 ? '履歴はまだありません。' : '条件に一致する履歴がありません。'}
        </p>
      )}

      <div className="space-y-2">
        {filteredEntries.map((entry) => {
          const expanded = expandedId === entry.id
          const selectedVariant = entry.variants.find((v) => v.variantId === entry.selectedVariantId)
          return (
            <article key={entry.id} className="glass-panel glass-panel-hover p-3">
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : entry.id)}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-neon-blue">{genreLabel(entry.input.genreKey)}</span>
                  <StarRating value={entry.rating ?? 0} size="sm" />
                </div>
                <div className="text-[11px] text-text-muted mt-1">
                  {kindLabel(entry.kind)} ・ {new Date(entry.createdAt).toLocaleString('ja-JP')}
                </div>
                {entry.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {entry.tags.map((tag, i) => (
                      <span key={i} className="text-[10px] bg-dark-lighter border border-border-neon rounded px-1.5 py-0.5">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {!expanded && selectedVariant && (
                  <p className="text-xs text-text-secondary mt-2 line-clamp-2">{variantPreview(selectedVariant)}</p>
                )}
              </button>

              {expanded && (
                <div className="mt-2 space-y-2 border-t border-border-neon pt-2">
                  {entry.variants.map((variant) => (
                    <div key={variant.variantId} className="bg-dark-lighter rounded-lg p-2">
                      <p className="text-[11px] text-neon-green mb-1">{variant.styleLabel}</p>
                      {'promptText' in variant ? (
                        <p className="text-xs text-text-secondary whitespace-pre-line">{variant.promptText}</p>
                      ) : (
                        <>
                          <p className="text-xs text-text-secondary whitespace-pre-line">{variant.englishPrompt}</p>
                          <p className="text-xs text-text-muted whitespace-pre-line mt-1">{variant.japanesePrompt}</p>
                        </>
                      )}
                    </div>
                  ))}
                  {entry.kind === 'lyricsPrompt' && entry.actualLyricsText && (
                    <div className="bg-dark-lighter rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[11px] text-neon-purple">実際に得られた歌詞</p>
                        {typeof entry.lyricsQualityRating === 'number' && (
                          <StarRating value={entry.lyricsQualityRating} size="sm" />
                        )}
                      </div>
                      <p className="text-xs text-text-secondary whitespace-pre-line">{entry.actualLyricsText}</p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(entry.id)}
                    className="text-xs text-neon-pink"
                  >
                    この履歴を削除
                  </button>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
