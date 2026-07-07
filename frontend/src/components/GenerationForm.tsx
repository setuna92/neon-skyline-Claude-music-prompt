import { useEffect, useMemo, useRef, useState } from 'react'
import templatesData from '../data/templates.json'
import type { PromptTemplates } from '../types/templates'
import type { GenerationInput } from '../types/generation'
import type { PresetEntry } from '../types/persistence'
import { generateVariants } from '../lib/promptGenerator'
import { buildKeywordSuggestions } from '../lib/keywordSuggestionEngine'
import { pickSmartCompositionInput } from '../lib/smartSelect'
import { addHistoryEntry, addPreset, getAllHistory, getAllPresets } from '../lib/db'
import { useOptionRanking } from '../hooks/useOptionRanking'
import { useKeywordScores } from '../hooks/useKeywordScores'
import { useDiscoveredKeywords } from '../hooks/useDiscoveredKeywords'
import { useKeywordAssociations } from '../hooks/useKeywordAssociations'
import { useDemotedKeywords } from '../hooks/useDemotedKeywords'
import { useTempoHints } from '../hooks/useTempoHints'
import { useFavoriteCompositionCombos } from '../hooks/useFavoriteCombos'
import { KeywordSuggestionPicker } from './KeywordSuggestionPicker'
import { FavoriteComboPicker } from './FavoriteComboPicker'

const templates = templatesData as PromptTemplates

function withRatingBadge(label: string, averageRating: number | undefined): string {
  return averageRating !== undefined && averageRating >= 4 ? `⭐ ${label}` : label
}

function findLabel(list: { key: string; label: string }[], key: string | undefined): string | undefined {
  return key ? list.find((e) => e.key === key)?.label : undefined
}

function describeCompositionCombo(input: GenerationInput): string {
  const parts = [
    findLabel(templates.genres, input.genreKey) ?? input.genreKey,
    findLabel(templates.moods, input.moodKey),
    input.tempo ? `BPM${input.tempo}` : undefined,
    findLabel(templates.vocalTypes, input.vocalTypeKey) ?? 'ボーカルなし',
    findLabel(templates.songStructures, input.songStructureKey),
    input.instrumentKeys.length
      ? `楽器:${input.instrumentKeys.map((k) => findLabel(templates.instrumentElements, k) ?? k).join('/')}`
      : undefined,
    input.atmosphereKeys.length
      ? `雰囲気:${input.atmosphereKeys.map((k) => findLabel(templates.atmospheres, k) ?? k).join('/')}`
      : undefined,
    input.themeKeywords?.length ? `テーマ:${input.themeKeywords.join('/')}` : undefined,
  ]
  return parts.filter(Boolean).join(' / ')
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

interface GenerationFormProps {
  onGenerated: (historyEntryId: string, result: ReturnType<typeof generateVariants>) => void
}

export function GenerationForm({ onGenerated }: GenerationFormProps) {
  const [input, setInput] = useState<GenerationInput>(EMPTY_INPUT)
  const [genreFilter, setGenreFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [presets, setPresets] = useState<PresetEntry[]>([])
  const [busy, setBusy] = useState(false)
  // busy(state)は再レンダー後まで最新値を読めないため、同期的な連打(2重送信)を防ぐのに使う
  const busyRef = useRef(false)
  const [themeKeywordsText, setThemeKeywordsText] = useState('')
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([])
  const [instrumentsOpen, setInstrumentsOpen] = useState(false)
  const [atmosphereOpen, setAtmosphereOpen] = useState(false)
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null)
  const { rank, scoreFor } = useOptionRanking()

  useEffect(() => {
    getAllPresets().then(setPresets).catch(() => setPresets([]))
  }, [])

  const keywordScores = useKeywordScores()
  const discoveredWords = useDiscoveredKeywords()
  const learnedAssociations = useKeywordAssociations()
  const demotedWords = useDemotedKeywords()
  const tempoHints = useTempoHints()
  const favoriteCombos = useFavoriteCompositionCombos()
  const tempoHintForGenre = tempoHints.find((h) => h.genreKey === input.genreKey)

  function handleApplyCombo(combo: GenerationInput) {
    setGenreFilter('')
    setInput({
      genreKey: combo.genreKey,
      moodKey: combo.moodKey,
      tempo: combo.tempo,
      vocalTypeKey: combo.vocalTypeKey,
      instrumentKeys: combo.instrumentKeys,
      songStructureKey: combo.songStructureKey,
      atmosphereKeys: combo.atmosphereKeys,
    })
    setThemeKeywordsText((combo.themeKeywords ?? []).join(', '))
    setSelectedSuggestions([])
    // 楽器・雰囲気は折りたたみの中にあり、閉じたままだとチェックが変わっても見えないため開く
    setInstrumentsOpen(combo.instrumentKeys.length > 0)
    setAtmosphereOpen(combo.atmosphereKeys.length > 0)
    setAppliedMessage('組み合わせを適用しました。内容を確認して「プロンプトを生成」を押してください。')
    setTimeout(() => setAppliedMessage(null), 4000)
  }

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

  async function runGeneration(fullInput: GenerationInput) {
    setError(null)
    setBusy(true)
    try {
      let result
      try {
        result = generateVariants(fullInput)
      } catch (err) {
        setError(err instanceof Error ? err.message : '生成に失敗しました')
        return
      }
      const entry = await addHistoryEntry({ kind: 'composition', input: fullInput, variants: result.variants, tags: [] })
      onGenerated(entry.id, result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '履歴の保存に失敗しました')
    } finally {
      setBusy(false)
      busyRef.current = false
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // busy(state)は同期的な連打の間は古い値のままなので、refで即座にガードする
    if (busyRef.current) return
    busyRef.current = true
    const manualKeywords = themeKeywordsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const themeKeywords = [...new Set([...manualKeywords, ...selectedSuggestions])]
    await runGeneration({ ...input, themeKeywords })
  }

  async function handleAutoSelect() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setGenreFilter('')
    const history = await getAllHistory().catch(() => [])
    const { input: picked } = pickSmartCompositionInput(history)
    setInput({
      genreKey: picked.genreKey,
      moodKey: picked.moodKey,
      tempo: picked.tempo,
      vocalTypeKey: picked.vocalTypeKey,
      instrumentKeys: picked.instrumentKeys,
      songStructureKey: picked.songStructureKey,
      atmosphereKeys: picked.atmosphereKeys,
    })
    setThemeKeywordsText((picked.themeKeywords ?? []).join(', '))
    setSelectedSuggestions([])
    setInstrumentsOpen(picked.instrumentKeys.length > 0)
    setAtmosphereOpen(picked.atmosphereKeys.length > 0)
    await runGeneration(picked)
  }

  async function handleSavePreset() {
    const name = window.prompt('プリセット名を入力してください')
    if (!name) return
    const preset = await addPreset(name, input)
    setPresets((prev) => [preset, ...prev])
  }

  function handleLoadPreset(presetId: string) {
    const preset = presets.find((p) => p.id === presetId)
    if (!preset) return
    setInput(preset.input)
    setInstrumentsOpen(preset.input.instrumentKeys.length > 0)
    setAtmosphereOpen(preset.input.atmosphereKeys.length > 0)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <button
        type="button"
        onClick={() => void handleAutoSelect()}
        disabled={busy}
        className="w-full btn-primary py-2.5 text-sm disabled:opacity-50"
      >
        {busy ? '生成中…' : '🎲 自動選択でおまかせ生成'}
      </button>
      <p className="text-[11px] text-text-muted -mt-2">
        相性の良い（過去の高評価の実績に基づく）組み合わせを全項目自動で選び、そのままプロンプトまで生成します。
      </p>

      <FavoriteComboPicker combos={favoriteCombos} describe={describeCompositionCombo} onApply={handleApplyCombo} />
      {appliedMessage && (
        <p className="text-xs text-neon-green bg-dark-lighter border border-neon-green rounded-lg px-3 py-2">
          ✅ {appliedMessage}
        </p>
      )}

      {presets.length > 0 && (
        <div className="glass-panel glass-panel-hover p-4">
          <label className="text-xs text-text-secondary block mb-1" htmlFor="preset-select">
            プリセットから読み込む
          </label>
          <select
            id="preset-select"
            defaultValue=""
            onChange={(e) => e.target.value && handleLoadPreset(e.target.value)}
            className="w-full input-neon px-3 py-2 text-sm"
          >
            <option value="">選択してください</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="glass-panel glass-panel-hover p-4 space-y-3">
        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="genre-filter">
            ジャンル（必須）
          </label>
          <input
            id="genre-filter"
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
          <label className="text-xs text-text-secondary block mb-1" htmlFor="composition-theme">
            テーマ・キーワード（カンマ区切り、任意）
          </label>
          <input
            id="composition-theme"
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
          <label className="text-xs text-text-secondary block mb-1" htmlFor="tempo">
            テンポ (BPM)
          </label>
          <input
            id="tempo"
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
          <label className="text-xs text-text-secondary block mb-1" htmlFor="mood">
            ムード
          </label>
          <select
            id="mood"
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
          <label className="text-xs text-text-secondary block mb-1" htmlFor="vocal-type">
            ボーカル
          </label>
          <select
            id="vocal-type"
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
          <label className="text-xs text-text-secondary block mb-1" htmlFor="song-structure">
            曲構成
          </label>
          <select
            id="song-structure"
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

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 btn-primary py-2 disabled:opacity-50"
        >
          {busy ? '生成中…' : 'プロンプトを生成'}
        </button>
        <button
          type="button"
          onClick={handleSavePreset}
          className="btn-ghost px-3 text-sm"
        >
          プリセット保存
        </button>
      </div>
    </form>
  )
}
