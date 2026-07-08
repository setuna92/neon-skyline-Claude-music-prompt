import { useEffect, useMemo, useRef, useState } from 'react'
import templatesData from '../data/templates.json'
import type { PromptTemplates } from '../types/templates'
import type { GenerationInput } from '../types/generation'
import type { ClaudeCompositionResult } from '../types/claudeComposition'
import { generateClaudeCompositionPromptVariants } from '../lib/claudeCompositionPromptGenerator'
import { buildKeywordSuggestions } from '../lib/keywordSuggestionEngine'
import { addHistoryEntry } from '../lib/db'
import { useOptionRanking } from '../hooks/useOptionRanking'
import { useKeywordScores } from '../hooks/useKeywordScores'
import { useDiscoveredKeywords } from '../hooks/useDiscoveredKeywords'
import { useKeywordAssociations } from '../hooks/useKeywordAssociations'
import { useDemotedKeywords } from '../hooks/useDemotedKeywords'
import { useTempoHints } from '../hooks/useTempoHints'
import { KeywordSuggestionPicker } from './KeywordSuggestionPicker'

const templates = templatesData as PromptTemplates

function withRatingBadge(label: string, averageRating: number | undefined): string {
  return averageRating !== undefined && averageRating >= 4 ? `⭐ ${label}` : label
}

const EMPTY_INPUT: GenerationInput = {
  genreKey: '',
  moodKey: undefined,
  tempo: undefined,
  vocalTypeKey: undefined,
  instrumentKeys: [],
  songStructureKey: undefined,
  atmosphereKeys: [],
}

function toggleKey(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key]
}

interface ClaudeCompositionFormProps {
  onGenerated: (historyEntryId: string, result: ClaudeCompositionResult) => void
}

// 「自動選択」ボタンやお気に入り組み合わせピッカーは、この機能の初期スコープでは意図的に含めていない
// (仕様承認時に手動選択のみと決めたため)。追加する場合は smartSelect.ts / comboLearning.ts /
// useFavoriteCombos.ts に claudeComposition 向けの選択・集計ロジックを別途追加する必要がある。
export function ClaudeCompositionForm({ onGenerated }: ClaudeCompositionFormProps) {
  const [input, setInput] = useState<GenerationInput>(EMPTY_INPUT)
  const [genreFilter, setGenreFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // busy(state)は再レンダー後まで最新値を読めないため、同期的な連打(2重送信)を防ぐのに使う
  const busyRef = useRef(false)
  const [themeKeywordsText, setThemeKeywordsText] = useState('')
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([])
  const [instrumentsOpen, setInstrumentsOpen] = useState(false)
  const [atmosphereOpen, setAtmosphereOpen] = useState(false)
  const { rank, scoreFor } = useOptionRanking()

  const keywordScores = useKeywordScores()
  const discoveredWords = useDiscoveredKeywords()
  const learnedAssociations = useKeywordAssociations()
  const demotedWords = useDemotedKeywords()
  const tempoHints = useTempoHints()
  const tempoHintForGenre = tempoHints.find((h) => h.genreKey === input.genreKey)

  const suggestionGroups = useMemo(
    () =>
      buildKeywordSuggestions(
        {
          genreKey: input.genreKey,
          moodKey: input.moodKey,
          atmosphereKeys: input.atmosphereKeys,
          genreCategories: ['production_tags', 'imagery', 'adjectives', 'general'],
          discoveredWords,
          learnedAssociations,
          demotedWords,
        },
        keywordScores,
      ),
    [
      input.genreKey,
      input.moodKey,
      input.atmosphereKeys,
      keywordScores,
      discoveredWords,
      learnedAssociations,
      demotedWords,
    ],
  )

  // ジャンルを変えたら、そのジャンル向けの候補選択もリセットする
  useEffect(() => {
    setSelectedSuggestions([])
  }, [input.genreKey])

  function handleToggleSuggestion(word: string) {
    setSelectedSuggestions((prev) => (prev.includes(word) ? prev.filter((w) => w !== word) : [...prev, word]))
  }

  const filteredGenres = rank('genreKey', templates.genres).filter(
    (g) =>
      genreFilter.trim() === '' ||
      g.label.includes(genreFilter) ||
      (g.en ?? '').toLowerCase().includes(genreFilter.toLowerCase()),
  )
  const rankedMoods = rank('moodKey', templates.moods)
  const rankedVocalTypes = rank('vocalTypeKey', templates.vocalTypes)
  const rankedSongStructures = rank('songStructureKey', templates.songStructures)
  const rankedInstruments = rank('instrumentKeys', templates.instrumentElements)
  const rankedAtmospheres = rank('atmosphereKeys', templates.atmospheres)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // busy(state)は同期的な連打の間は古い値のままなので、refで即座にガードする
    if (busyRef.current) return
    busyRef.current = true
    setError(null)
    setBusy(true)
    try {
      const manualKeywords = themeKeywordsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const themeKeywords = [...new Set([...manualKeywords, ...selectedSuggestions])]
      const fullInput = { ...input, themeKeywords }

      let result: ClaudeCompositionResult
      try {
        result = generateClaudeCompositionPromptVariants(fullInput)
      } catch (err) {
        setError(err instanceof Error ? err.message : '生成に失敗しました')
        return
      }
      const entry = await addHistoryEntry({
        kind: 'claudeComposition',
        input: fullInput,
        variants: result.variants,
        tags: [],
      })
      onGenerated(entry.id, result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '履歴の保存に失敗しました')
    } finally {
      setBusy(false)
      busyRef.current = false
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-[11px] text-text-muted">
        選んだ条件から、Claudeに「Suno向けの作曲プロンプトを書いて」と依頼するための指示文を生成します。
      </p>

      <div className="glass-panel glass-panel-hover p-4 space-y-3">
        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="claude-genre-filter">
            ジャンル（必須）
          </label>
          <input
            id="claude-genre-filter"
            type="text"
            placeholder="検索…"
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            className="w-full input-neon px-3 py-2 text-sm mb-2"
          />
          <select
            size={6}
            value={input.genreKey}
            onChange={(e) => setInput((prev) => ({ ...prev, genreKey: e.target.value }))}
            className="w-full input-neon px-3 py-2 text-sm"
          >
            {filteredGenres.map((g) => (
              <option key={g.key} value={g.key}>
                {withRatingBadge(g.label, scoreFor('genreKey', g.key)?.averageRating)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="claude-composition-theme">
            テーマ・キーワード（カンマ区切り、任意）
          </label>
          <input
            id="claude-composition-theme"
            type="text"
            value={themeKeywordsText}
            onChange={(e) => setThemeKeywordsText(e.target.value)}
            placeholder="例: 夜のドライブ, 雨上がり"
            className="w-full input-neon px-3 py-2 text-sm"
          />
          {suggestionGroups.length > 0 && (
            <div className="mt-2">
              <KeywordSuggestionPicker
                groups={suggestionGroups}
                selected={selectedSuggestions}
                onToggle={handleToggleSuggestion}
                scores={keywordScores}
              />
            </div>
          )}
        </div>

        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="claude-tempo">
            テンポ (BPM)
          </label>
          <input
            id="claude-tempo"
            type="number"
            min={1}
            value={input.tempo ?? ''}
            onChange={(e) =>
              setInput((prev) => ({
                ...prev,
                tempo: e.target.value ? Number(e.target.value) : undefined,
              }))
            }
            className="w-full input-neon px-3 py-2 text-sm"
          />
          {tempoHintForGenre && tempoHintForGenre.tempo !== input.tempo && (
            <button
              type="button"
              onClick={() => setInput((prev) => ({ ...prev, tempo: tempoHintForGenre.tempo }))}
              className="mt-1 text-[11px] chip-neon px-2 py-1"
            >
              🎯 おすすめBPM {tempoHintForGenre.tempo}（★{tempoHintForGenre.averageRating.toFixed(1)}・
              {tempoHintForGenre.sampleCount}件）を適用
            </button>
          )}
        </div>

        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="claude-mood">
            ムード
          </label>
          <select
            id="claude-mood"
            value={input.moodKey ?? ''}
            onChange={(e) => setInput((prev) => ({ ...prev, moodKey: e.target.value || undefined }))}
            className="w-full input-neon px-3 py-2 text-sm"
          >
            <option value="">未選択</option>
            {rankedMoods.map((m) => (
              <option key={m.key} value={m.key}>
                {withRatingBadge(m.label, scoreFor('moodKey', m.key)?.averageRating)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="claude-vocal-type">
            ボーカル
          </label>
          <select
            id="claude-vocal-type"
            value={input.vocalTypeKey ?? ''}
            onChange={(e) => setInput((prev) => ({ ...prev, vocalTypeKey: e.target.value || undefined }))}
            className="w-full input-neon px-3 py-2 text-sm"
          >
            <option value="">未選択</option>
            {rankedVocalTypes.map((v) => (
              <option key={v.key} value={v.key}>
                {withRatingBadge(v.label, scoreFor('vocalTypeKey', v.key)?.averageRating)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="claude-song-structure">
            曲構成
          </label>
          <select
            id="claude-song-structure"
            value={input.songStructureKey ?? ''}
            onChange={(e) => setInput((prev) => ({ ...prev, songStructureKey: e.target.value || undefined }))}
            className="w-full input-neon px-3 py-2 text-sm"
          >
            <option value="">未選択</option>
            {rankedSongStructures.map((s) => (
              <option key={s.key} value={s.key}>
                {withRatingBadge(s.label, scoreFor('songStructureKey', s.key)?.averageRating)}
              </option>
            ))}
          </select>
        </div>

        <details
          className="text-sm"
          open={instrumentsOpen}
          onToggle={(e) => setInstrumentsOpen(e.currentTarget.open)}
        >
          <summary className="text-neon-cyan cursor-pointer">
            楽器を選択 ({input.instrumentKeys.length})
          </summary>
          <div className="grid grid-cols-2 gap-1 mt-2 max-h-48 overflow-y-auto pr-1">
            {rankedInstruments.map((instrument) => (
              <label key={instrument.key} className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={input.instrumentKeys.includes(instrument.key)}
                  onChange={() =>
                    setInput((prev) => ({ ...prev, instrumentKeys: toggleKey(prev.instrumentKeys, instrument.key) }))
                  }
                />
                {withRatingBadge(instrument.label, scoreFor('instrumentKeys', instrument.key)?.averageRating)}
              </label>
            ))}
          </div>
        </details>

        <details
          className="text-sm"
          open={atmosphereOpen}
          onToggle={(e) => setAtmosphereOpen(e.currentTarget.open)}
        >
          <summary className="text-neon-cyan cursor-pointer">
            雰囲気を選択 ({input.atmosphereKeys.length})
          </summary>
          <div className="grid grid-cols-2 gap-1 mt-2 max-h-48 overflow-y-auto pr-1">
            {rankedAtmospheres.map((atmosphere) => (
              <label key={atmosphere.key} className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={input.atmosphereKeys.includes(atmosphere.key)}
                  onChange={() =>
                    setInput((prev) => ({
                      ...prev,
                      atmosphereKeys: toggleKey(prev.atmosphereKeys, atmosphere.key),
                    }))
                  }
                />
                {withRatingBadge(atmosphere.label, scoreFor('atmosphereKeys', atmosphere.key)?.averageRating)}
              </label>
            ))}
          </div>
        </details>
      </div>

      {error && <p className="text-xs text-neon-pink">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full btn-primary py-2 disabled:opacity-50"
      >
        {busy ? '生成中…' : 'Claude作曲プロンプトを生成'}
      </button>
    </form>
  )
}
