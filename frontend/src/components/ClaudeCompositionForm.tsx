import { useEffect, useMemo, useRef, useState } from 'react'
import templatesData from '../data/templates.json'
import type { PromptTemplates } from '../types/templates'
import type { GenerationInput } from '../types/generation'
import type { ClaudeCompositionResult } from '../types/claudeComposition'
import { generateClaudeCompositionPromptVariants } from '../lib/claudeCompositionPromptGenerator'
import { buildKeywordSuggestions } from '../lib/keywordSuggestionEngine'
import { pickSmartCompositionInput } from '../lib/smartSelect'
import { callClaude } from '../lib/claudeClient'
import { composeSunoSongViaHelper, isSunoHelperRunning } from '../lib/sunoAutomationClient'
import {
  addHistoryEntry,
  getAllHistory,
  getClaudeApiKey,
  getClaudeModel,
  getExternalSendConsent,
  hasClaudeApiKey,
  setExternalSendConsent,
  updateClaudeCompositionQuality,
} from '../lib/db'
import { useOptionRanking } from '../hooks/useOptionRanking'
import { useKeywordScores } from '../hooks/useKeywordScores'
import { useDiscoveredKeywords } from '../hooks/useDiscoveredKeywords'
import { useKeywordAssociations } from '../hooks/useKeywordAssociations'
import { useDemotedKeywords } from '../hooks/useDemotedKeywords'
import { useTempoHints } from '../hooks/useTempoHints'
import { useFavoriteCompositionCombos } from '../hooks/useFavoriteCombos'
import { KeywordSuggestionPicker } from './KeywordSuggestionPicker'
import { FavoriteComboPicker } from './FavoriteComboPicker'
import { ConsentModal } from './ConsentModal'

const templates = templatesData as PromptTemplates

function withRatingBadge(label: string, averageRating: number | undefined): string {
  return averageRating !== undefined && averageRating >= 4 ? `⭐ ${label}` : label
}

function findLabel(list: { key: string; label: string }[], key: string | undefined): string | undefined {
  return key ? list.find((e) => e.key === key)?.label : undefined
}

function describeCombo(input: GenerationInput): string {
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

type SunoAutomationStatus = 'idle' | 'generating-prompt' | 'checking-helper' | 'sending-to-suno' | 'done' | 'error'

interface SunoAutomationState {
  status: SunoAutomationStatus
  message?: string
}

const SUNO_IN_PROGRESS_STATUSES: SunoAutomationStatus[] = ['generating-prompt', 'checking-helper', 'sending-to-suno']

interface ClaudeCompositionFormProps {
  onGenerated: (historyEntryId: string, result: ClaudeCompositionResult) => void
}

export function ClaudeCompositionForm({ onGenerated }: ClaudeCompositionFormProps) {
  const [input, setInput] = useState<GenerationInput>(EMPTY_INPUT)
  const [genreFilter, setGenreFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // busy(state)は再レンダー後まで最新値を読めないため、同期的な連打(2重送信)を防ぐのに使う
  const busyRef = useRef(false)
  // 直前に自動選択した結果を覚えておき、次に押した時に同じ組み合わせを避けるために使う
  const lastAutoSelectRef = useRef<{ genreKey: string; moodKey?: string } | null>(null)
  const [themeKeywordsText, setThemeKeywordsText] = useState('')
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([])
  const [instrumentsOpen, setInstrumentsOpen] = useState(false)
  const [atmosphereOpen, setAtmosphereOpen] = useState(false)
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null)
  const { rank, scoreFor } = useOptionRanking()

  // 「🎵 Sunoで自動作曲」ボタン専用の状態(通常の生成ボタンとは独立して管理する)
  const sunoBusyRef = useRef(false)
  const [sunoState, setSunoState] = useState<SunoAutomationState>({ status: 'idle' })
  const [pendingAutoComposeInput, setPendingAutoComposeInput] = useState<GenerationInput | null>(null)
  const [consentModalOpen, setConsentModalOpen] = useState(false)
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const sunoInProgress = SUNO_IN_PROGRESS_STATUSES.includes(sunoState.status)

  useEffect(() => {
    hasClaudeApiKey().then(setHasApiKey).catch(() => setHasApiKey(false))
  }, [])

  const keywordScores = useKeywordScores()
  const discoveredWords = useDiscoveredKeywords()
  const learnedAssociations = useKeywordAssociations()
  const demotedWords = useDemotedKeywords()
  const tempoHints = useTempoHints()
  const favoriteCombos = useFavoriteCompositionCombos()
  const tempoHintForGenre = tempoHints.find((h) => h.genreKey === input.genreKey)

  function applyComboToInput(combo: GenerationInput) {
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
    setInstrumentsOpen(combo.instrumentKeys.length > 0)
    setAtmosphereOpen(combo.atmosphereKeys.length > 0)
  }

  function handleApplyCombo(combo: GenerationInput) {
    applyComboToInput(combo)
    setAppliedMessage('組み合わせを適用しました。内容を確認して生成ボタンを押してください。')
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

  function collectThemeKeywords(): string[] {
    const manualKeywords = themeKeywordsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    return [...new Set([...manualKeywords, ...selectedSuggestions])]
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // busy(state)は同期的な連打の間は古い値のままなので、refで即座にガードする
    if (busyRef.current) return
    busyRef.current = true
    await runGeneration({ ...input, themeKeywords: collectThemeKeywords() })
  }

  async function handleAutoSelect() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setGenreFilter('')
    const history = await getAllHistory().catch(() => [])
    const { input: picked } = pickSmartCompositionInput(history, {
      avoidGenreKey: lastAutoSelectRef.current?.genreKey,
      avoidMoodKey: lastAutoSelectRef.current?.moodKey,
    })
    lastAutoSelectRef.current = { genreKey: picked.genreKey, moodKey: picked.moodKey }
    applyComboToInput(picked)
    await runGeneration(picked)
  }

  /** Claudeにこの入力からSuno向けプロンプトを書かせ、ローカルの自動化ヘルパー経由でSunoに送って実際に作曲させる */
  async function performAutoCompose(fullInput: GenerationInput) {
    setSunoState({ status: 'generating-prompt' })
    try {
      let result: ClaudeCompositionResult
      try {
        result = generateClaudeCompositionPromptVariants(fullInput)
      } catch (err) {
        setSunoState({ status: 'error', message: err instanceof Error ? err.message : '生成に失敗しました' })
        return
      }
      const entry = await addHistoryEntry({
        kind: 'claudeComposition',
        input: fullInput,
        variants: result.variants,
        tags: ['自動作曲'],
      })
      onGenerated(entry.id, result)

      const apiKey = await getClaudeApiKey()
      if (!apiKey) {
        setSunoState({ status: 'error', message: 'Claude APIキーが未設定です。設定タブから登録してください。' })
        return
      }
      const model = await getClaudeModel()
      const standardVariant = result.variants.find((v) => v.styleId === 'standard') ?? result.variants[0]
      const sunoPromptText = await callClaude(standardVariant.promptText, { apiKey, model })
      await updateClaudeCompositionQuality(entry.id, { actualCompositionPromptText: sunoPromptText })

      setSunoState({ status: 'checking-helper' })
      const helperRunning = await isSunoHelperRunning()
      if (!helperRunning) {
        setSunoState({
          status: 'error',
          message:
            'ローカルのSuno自動化ヘルパー(suno-automation-helper)が起動していません。起動するか、履歴に保存されたClaudeの応答をコピーしてSunoに手動で貼り付けてください。',
        })
        return
      }

      setSunoState({ status: 'sending-to-suno' })
      const composeResult = await composeSunoSongViaHelper(sunoPromptText)
      if (!composeResult.ok) {
        setSunoState({ status: 'error', message: composeResult.error ?? 'Sunoへの自動送信に失敗しました' })
        return
      }
      setSunoState({ status: 'done' })
    } catch (err) {
      setSunoState({ status: 'error', message: err instanceof Error ? err.message : '自動作曲に失敗しました' })
    }
  }

  async function handleAutoComposeOnSuno() {
    if (sunoBusyRef.current) return
    sunoBusyRef.current = true
    try {
      const fullInput = { ...input, themeKeywords: collectThemeKeywords() }
      const consent = await getExternalSendConsent()
      if (!consent.granted) {
        setPendingAutoComposeInput(fullInput)
        setConsentModalOpen(true)
        return
      }
      await performAutoCompose(fullInput)
    } finally {
      sunoBusyRef.current = false
    }
  }

  async function handleConsentGranted() {
    await setExternalSendConsent(true)
    setConsentModalOpen(false)
    if (pendingAutoComposeInput) {
      const fullInput = pendingAutoComposeInput
      setPendingAutoComposeInput(null)
      sunoBusyRef.current = true
      try {
        await performAutoCompose(fullInput)
      } finally {
        sunoBusyRef.current = false
      }
    }
  }

  function handleConsentCancelled() {
    setConsentModalOpen(false)
    setPendingAutoComposeInput(null)
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
        相性の良い（過去の高評価の実績に基づく）組み合わせを全項目自動で選び、Claudeへの指示文まで生成します。
      </p>

      <FavoriteComboPicker combos={favoriteCombos} describe={describeCombo} onApply={handleApplyCombo} />
      {appliedMessage && (
        <p className="text-xs text-neon-green bg-dark-lighter border border-neon-green rounded-lg px-3 py-2">
          ✅ {appliedMessage}
        </p>
      )}

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

      <div className="glass-panel glass-panel-hover p-4 space-y-2">
        <h3 className="text-neon-cyan text-sm font-semibold">🎵 Sunoで自動作曲（実験的）</h3>
        <p className="text-[11px] text-text-muted">
          上の条件でClaudeにSuno向けプロンプトを書かせ、ローカルで動く自動化ヘルパー(suno-automation-helper)経由で
          Sunoに直接送信し、実際に1曲分の作曲を自動で開始します。事前に <code>suno-automation-helper</code> を
          あなたのPCで起動し、Sunoにログイン済みにしておく必要があります。
        </p>
        {hasApiKey === false && (
          <p className="text-[10px] text-text-muted">設定タブでClaude APIキーを登録すると使えます。</p>
        )}
        <button
          type="button"
          onClick={() => void handleAutoComposeOnSuno()}
          // hasApiKeyは起動直後はnull(未確認)なので、確認が済んでtrueになるまでは押せないようにする
          // (未確認のまま押せてしまうと、履歴だけ保存されてAPI呼び出しで即エラーになる中途半端な状態になるため)
          disabled={sunoInProgress || consentModalOpen || hasApiKey !== true}
          title={hasApiKey !== true ? '設定タブでClaude APIキーを登録すると使えます' : undefined}
          className="w-full btn-primary py-2 text-sm disabled:opacity-50"
        >
          {sunoInProgress ? sunoStatusLabel(sunoState.status) : '🎵 Sunoで自動作曲'}
        </button>
        {sunoState.status === 'done' && (
          <p className="text-xs text-neon-green">✅ Sunoに送信しました。Suno側の生成状況を確認してください。</p>
        )}
        {sunoState.status === 'error' && sunoState.message && (
          <p className="text-xs text-neon-pink whitespace-pre-line">{sunoState.message}</p>
        )}
      </div>

      <ConsentModal open={consentModalOpen} onConsent={handleConsentGranted} onCancel={handleConsentCancelled} />
    </form>
  )
}

function sunoStatusLabel(status: SunoAutomationStatus): string {
  switch (status) {
    case 'generating-prompt':
      return 'Claudeに作曲プロンプトを書かせています…'
    case 'checking-helper':
      return 'ローカルヘルパーを確認しています…'
    case 'sending-to-suno':
      return 'Sunoに送信しています…'
    default:
      return '処理中…'
  }
}
