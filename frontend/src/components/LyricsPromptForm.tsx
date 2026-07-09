import { useEffect, useMemo, useRef, useState } from 'react'
import templatesData from '../data/templates.json'
import type { PromptTemplates } from '../types/templates'
import type { LyricsPromptInput, LyricsPromptSeed } from '../types/lyricsPrompt'
import type { ImportedPrompt } from '../types/promptLibrary'
import { EMPTY_GENOME, genomeFromMutations } from '../types/textGenome'
import type { TextGenome } from '../types/textGenome'
import { generateLyricsPromptVariants, generateSynopsisPrompt } from '../lib/lyricsPromptGenerator'
import { DEFAULT_GENRE_CATEGORIES, buildKeywordSuggestions, splitAutoSelectedKeywords } from '../lib/keywordSuggestionEngine'
import { pickSmartLyricsInput } from '../lib/smartSelect'
import { addHistoryEntry, getAllHistory, getClaudeApiKey, getClaudeModel, getTextMutations } from '../lib/db'
import { callClaude } from '../lib/claudeClient'
import { useOptionRanking } from '../hooks/useOptionRanking'
import { useKeywordScores } from '../hooks/useKeywordScores'
import { useDiscoveredKeywords } from '../hooks/useDiscoveredKeywords'
import { useKeywordAssociations } from '../hooks/useKeywordAssociations'
import { useDemotedKeywords } from '../hooks/useDemotedKeywords'
import { useFavoriteLyricsCombos } from '../hooks/useFavoriteCombos'
import { useClaudeExternalSendConsent } from '../hooks/useClaudeExternalSendConsent'
import { PromptLibraryPanel } from './PromptLibraryPanel'
import { KeywordSuggestionPicker } from './KeywordSuggestionPicker'
import { FavoriteComboPicker } from './FavoriteComboPicker'
import { ConsentModal } from './ConsentModal'

const templates = templatesData as PromptTemplates

function toggleKey(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key]
}

function withRatingBadge(label: string, averageRating: number | undefined): string {
  return averageRating !== undefined && averageRating >= 4 ? `⭐ ${label}` : label
}

function findLabel(list: { key: string; label: string }[], key: string | undefined): string | undefined {
  return key ? list.find((e) => e.key === key)?.label : undefined
}

function describeLyricsCombo(input: LyricsPromptInput): string {
  const parts = [
    findLabel(templates.genres, input.genreKey) ?? input.genreKey,
    findLabel(templates.moods, input.moodKey),
    findLabel(templates.vocalTypes, input.vocalTypeKey) ?? 'ボーカルなし',
    findLabel(templates.songStructures, input.songStructureKey),
    input.atmosphereKeys.length
      ? `雰囲気:${input.atmosphereKeys.map((k) => findLabel(templates.atmospheres, k) ?? k).join('/')}`
      : undefined,
    input.themeKeywords.length ? `テーマ:${input.themeKeywords.join('/')}` : undefined,
    input.languageKey === 'en' ? '英語' : '日本語',
  ]
  return parts.filter(Boolean).join(' / ')
}

interface LyricsPromptFormProps {
  onGenerated: (historyEntryId: string, result: ReturnType<typeof generateLyricsPromptVariants>) => void
  /** 作曲プロンプトから引き継ぐ初期値。マウント時に一度だけ反映する。 */
  seed?: LyricsPromptSeed | null
  /** seedを反映し終えたことを親に伝える(手動でタブを開き直した時の再適用を防ぐ) */
  onSeedConsumed?: () => void
}

export function LyricsPromptForm({ onGenerated, seed, onSeedConsumed }: LyricsPromptFormProps) {
  const [genreFilter, setGenreFilter] = useState('')
  const [moodKey, setMoodKey] = useState<string | undefined>(seed?.moodKey)
  const [genreKey, setGenreKey] = useState(seed?.genreKey ?? '')
  const [atmosphereKeys, setAtmosphereKeys] = useState<string[]>(seed?.atmosphereKeys ?? [])
  const [vocalTypeKey, setVocalTypeKey] = useState<string | undefined>(seed?.vocalTypeKey)
  const [songStructureKey, setSongStructureKey] = useState<string | undefined>(seed?.songStructureKey)
  const [themeKeywordsText, setThemeKeywordsText] = useState(seed?.themeKeywords.join(', ') ?? '')
  const [languageKey, setLanguageKey] = useState<'ja' | 'en'>('ja')
  const [selectedPrompt, setSelectedPrompt] = useState<ImportedPrompt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // busy(state)は再レンダー後まで最新値を読めないため、同期的な連打(2重送信)を防ぐのに使う
  const busyRef = useRef(false)
  // 直前に自動選択した結果を覚えておき、次に押した時に同じ組み合わせを避けるために使う
  const lastAutoSelectRef = useRef<{ genreKey: string; moodKey?: string } | null>(null)
  const [genome, setGenome] = useState<TextGenome>(EMPTY_GENOME)
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([])
  const [atmosphereOpen, setAtmosphereOpen] = useState((seed?.atmosphereKeys.length ?? 0) > 0)
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null)
  const [synopsisText, setSynopsisText] = useState('')
  const [synopsisStatus, setSynopsisStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [synopsisError, setSynopsisError] = useState<string | null>(null)
  const { hasApiKey, consentModalOpen, runWithConsent, handleConsentGranted, handleConsentCancelled } =
    useClaudeExternalSendConsent()
  const { rank, scoreFor } = useOptionRanking()

  useEffect(() => {
    if (seed) onSeedConsumed?.()
    // マウント時に一度だけseedを消費する(依存配列は意図的に空)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    getTextMutations()
      .then((mutations) => setGenome(genomeFromMutations(mutations)))
      .catch(() => setGenome(EMPTY_GENOME))
  }, [])

  const keywordScores = useKeywordScores()
  const discoveredWords = useDiscoveredKeywords()
  const learnedAssociations = useKeywordAssociations()
  const demotedWords = useDemotedKeywords()
  const favoriteCombos = useFavoriteLyricsCombos()
  const suggestionGroups = useMemo(
    () =>
      buildKeywordSuggestions(
        { genreKey, moodKey, atmosphereKeys, discoveredWords, learnedAssociations, demotedWords },
        keywordScores,
      ),
    [genreKey, moodKey, atmosphereKeys, keywordScores, discoveredWords, learnedAssociations, demotedWords],
  )


  function handleToggleSuggestion(word: string) {
    setSelectedSuggestions((prev) => (prev.includes(word) ? prev.filter((w) => w !== word) : [...prev, word]))
  }

  function handleApplyCombo(combo: LyricsPromptInput) {
    setGenreFilter('')
    setGenreKey(combo.genreKey)
    setMoodKey(combo.moodKey)
    setVocalTypeKey(combo.vocalTypeKey)
    setSongStructureKey(combo.songStructureKey)
    setAtmosphereKeys(combo.atmosphereKeys)
    setThemeKeywordsText(combo.themeKeywords.join(', '))
    setLanguageKey(combo.languageKey)
    setSelectedSuggestions([])
    // 雰囲気は折りたたみの中にあり、閉じたままだとチェックが変わっても見えないため開く
    setAtmosphereOpen(combo.atmosphereKeys.length > 0)
    // ジャンル・キーワードが変わるため、直前のあらすじは新しい組み合わせに合わなくなる
    setSynopsisText('')
    setSynopsisStatus('idle')
    setSynopsisError(null)
    setAppliedMessage('組み合わせを適用しました。内容を確認して「歌詞プロンプトを生成」を押してください。')
    setTimeout(() => setAppliedMessage(null), 4000)
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
  const rankedAtmospheres = rank('atmosphereKeys', templates.atmospheres)

  async function runGeneration(input: LyricsPromptInput) {
    setError(null)
    setBusy(true)
    try {
      let result
      try {
        result = generateLyricsPromptVariants(input, genome)
      } catch (err) {
        setError(err instanceof Error ? err.message : '生成に失敗しました')
        return
      }
      const entry = await addHistoryEntry({ kind: 'lyricsPrompt', input, variants: result.variants, tags: [] })
      onGenerated(entry.id, result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '履歴の保存に失敗しました')
    } finally {
      setBusy(false)
      busyRef.current = false
    }
  }

  function currentThemeKeywords(): string[] {
    const manualKeywords = themeKeywordsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    return [...new Set([...manualKeywords, ...selectedSuggestions])]
  }

  async function performSynopsisGeneration() {
    setSynopsisStatus('loading')
    setSynopsisError(null)
    try {
      const apiKey = await getClaudeApiKey()
      if (!apiKey) throw new Error('Claude APIキーが未設定です。設定タブから登録してください。')
      const model = await getClaudeModel()
      const prompt = generateSynopsisPrompt({
        genreKey,
        moodKey,
        atmosphereKeys,
        themeKeywords: currentThemeKeywords(),
        languageKey,
      })
      const text = await callClaude(prompt, { apiKey, model })
      setSynopsisText(text.trim())
      setSynopsisStatus('idle')
    } catch (err) {
      setSynopsisStatus('error')
      setSynopsisError(err instanceof Error ? err.message : 'あらすじの生成に失敗しました')
    }
  }

  async function handleGenerateSynopsis() {
    if (!genreKey) {
      setSynopsisStatus('error')
      setSynopsisError('先にジャンルを選択してください')
      return
    }
    if (currentThemeKeywords().length === 0) {
      setSynopsisStatus('error')
      setSynopsisError('先にテーマ・キーワードを入力してください')
      return
    }
    setSynopsisError(null)
    await runWithConsent(performSynopsisGeneration)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // busy(state)は同期的な連打の間は古い値のままなので、refで即座にガードする
    if (busyRef.current) return
    busyRef.current = true

    await runGeneration({
      genreKey,
      moodKey,
      atmosphereKeys,
      vocalTypeKey,
      songStructureKey,
      themeKeywords: currentThemeKeywords(),
      languageKey,
      basePromptText: selectedPrompt?.body,
      synopsis: synopsisText.trim() || undefined,
    })
  }

  async function handleAutoSelect() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setGenreFilter('')
    // ジャンル・キーワードが変わるため、直前のあらすじは新しい組み合わせに合わなくなる
    setSynopsisText('')
    setSynopsisStatus('idle')
    setSynopsisError(null)
    const history = await getAllHistory().catch(() => [])
    const { input: picked } = pickSmartLyricsInput(history, {
      avoidGenreKey: lastAutoSelectRef.current?.genreKey,
      avoidMoodKey: lastAutoSelectRef.current?.moodKey,
      genreCategories: DEFAULT_GENRE_CATEGORIES,
    })
    lastAutoSelectRef.current = { genreKey: picked.genreKey, moodKey: picked.moodKey }
    setGenreKey(picked.genreKey)
    setMoodKey(picked.moodKey)
    setVocalTypeKey(picked.vocalTypeKey)
    setSongStructureKey(picked.songStructureKey)
    setAtmosphereKeys(picked.atmosphereKeys)
    // 選ばれたテーマキーワードのうち、候補チップ(イメージ語・キーワード等)に該当するものは
    // 手入力欄ではなく「選択済みチップ」として反映する
    const { chipSelected, freeform } = splitAutoSelectedKeywords(
      picked.themeKeywords,
      { genreKey: picked.genreKey, moodKey: picked.moodKey, atmosphereKeys: picked.atmosphereKeys },
      DEFAULT_GENRE_CATEGORIES,
      { discoveredWords, learnedAssociations, demotedWords },
      keywordScores,
    )
    setThemeKeywordsText(freeform.join(', '))
    setSelectedSuggestions(chipSelected)
    setLanguageKey(picked.languageKey)
    setAtmosphereOpen(picked.atmosphereKeys.length > 0)
    await runGeneration(picked)
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

      <FavoriteComboPicker combos={favoriteCombos} describe={describeLyricsCombo} onApply={handleApplyCombo} />
      {appliedMessage && (
        <p className="text-xs text-neon-green bg-dark-lighter border border-neon-green rounded-lg px-3 py-2">
          ✅ {appliedMessage}
        </p>
      )}

      <PromptLibraryPanel
        selectedId={selectedPrompt?.id}
        onSelect={setSelectedPrompt}
      />

      <div className="glass-panel glass-panel-hover p-4 space-y-3">
        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="lyrics-genre-filter">
            ジャンル（必須）
          </label>
          <input
            id="lyrics-genre-filter"
            type="text"
            placeholder="検索…"
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            className="w-full input-neon px-3 py-2 text-sm mb-2"
          />
          <select
            size={6}
            value={genreKey}
            onChange={(e) => {
              setGenreKey(e.target.value)
              // ジャンルを手動で変えたら、そのジャンル向けの候補選択もリセットする
              setSelectedSuggestions([])
              // あらすじはジャンル前提で考えられているため、ジャンルが変わったら古いあらすじを破棄する
              setSynopsisText('')
              setSynopsisStatus('idle')
              setSynopsisError(null)
            }}
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
          <label className="text-xs text-text-secondary block mb-1" htmlFor="lyrics-theme">
            テーマ・キーワード（カンマ区切り、必須）
          </label>
          <input
            id="lyrics-theme"
            type="text"
            value={themeKeywordsText}
            onChange={(e) => setThemeKeywordsText(e.target.value)}
            placeholder="例: 夏, 別れ, 花火"
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

        <div className="border border-border-neon rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-1">
            <span className="text-xs text-text-secondary">① あらすじ（任意・推奨）</span>
            <button
              type="button"
              onClick={() => void handleGenerateSynopsis()}
              disabled={synopsisStatus === 'loading' || hasApiKey === false}
              title={hasApiKey === false ? '設定タブでClaude APIキーを登録すると使えます' : undefined}
              className="text-[11px] px-2 py-1 btn-ghost disabled:opacity-50"
            >
              {synopsisStatus === 'loading' ? '考え中…' : 'Claudeにあらすじを考えてもらう'}
            </button>
          </div>
          <p className="text-[11px] text-text-muted">
            主人公・出来事・結末を先に決めてから②で歌詞を書かせると、ストーリー性のある歌詞になりやすくなります。
            ジャンルとキーワードを入力してから押してください。自分で書いて貼り付けてもかまいません。
          </p>
          {synopsisError && <p className="text-[11px] text-neon-pink">{synopsisError}</p>}
          <textarea
            id="lyrics-synopsis"
            value={synopsisText}
            onChange={(e) => setSynopsisText(e.target.value)}
            placeholder={'例:\n主人公: 夜勤明けの若い店員\n出来事: 始発を待つ間、別れた相手からの着信に気づく\n結末: 折り返さずに歩き出し、朝焼けに切り替わる'}
            rows={4}
            className="w-full input-neon px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="lyrics-language">
            歌詞の言語
          </label>
          <select
            id="lyrics-language"
            value={languageKey}
            onChange={(e) => setLanguageKey(e.target.value as 'ja' | 'en')}
            className="w-full input-neon px-3 py-2 text-sm"
          >
            <option value="ja">日本語</option>
            <option value="en">英語</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="lyrics-mood">
            ムード
          </label>
          <select
            id="lyrics-mood"
            value={moodKey ?? ''}
            onChange={(e) => setMoodKey(e.target.value || undefined)}
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
          <label className="text-xs text-text-secondary block mb-1" htmlFor="lyrics-vocal">
            ボーカル
          </label>
          <select
            id="lyrics-vocal"
            value={vocalTypeKey ?? ''}
            onChange={(e) => setVocalTypeKey(e.target.value || undefined)}
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
          <label className="text-xs text-text-secondary block mb-1" htmlFor="lyrics-structure">
            曲構成
          </label>
          <select
            id="lyrics-structure"
            value={songStructureKey ?? ''}
            onChange={(e) => setSongStructureKey(e.target.value || undefined)}
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
          open={atmosphereOpen}
          onToggle={(e) => setAtmosphereOpen(e.currentTarget.open)}
        >
          <summary className="text-neon-cyan cursor-pointer">雰囲気を選択 ({atmosphereKeys.length})</summary>
          <div className="grid grid-cols-2 gap-1 mt-2 max-h-48 overflow-y-auto pr-1">
            {rankedAtmospheres.map((atmosphere) => (
              <label key={atmosphere.key} className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={atmosphereKeys.includes(atmosphere.key)}
                  onChange={() => setAtmosphereKeys((prev) => toggleKey(prev, atmosphere.key))}
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
        {busy ? '生成中…' : '② 歌詞プロンプトを生成'}
      </button>

      <ConsentModal open={consentModalOpen} onConsent={handleConsentGranted} onCancel={handleConsentCancelled} />
    </form>
  )
}
