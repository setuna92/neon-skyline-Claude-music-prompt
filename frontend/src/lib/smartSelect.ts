import templatesData from '../data/templates.json'
import type { OptionEntry, PromptTemplates } from '../types/templates'
import type { HistoryEntry, CompositionHistoryEntry, LyricsPromptHistoryEntry } from '../types/persistence'
import type { GenerationInput } from '../types/generation'
import type { LyricsPromptInput } from '../types/lyricsPrompt'
import type { FavoriteCombo } from './comboLearning'
import { computeFavoriteCompositionCombos, computeFavoriteLyricsCombos } from './comboLearning'
import { computeScoresByCategory, rankByScore } from './learning/ranking'
import { buildKeywordSuggestions, scoreKeywordsFromHistory } from './keywordSuggestionEngine'
import { THEME_WORD_BANK } from './autoLoop/executor'

const templates = templatesData as PromptTemplates

// 高評価の組み合わせが複数ある場合、常に1位だけを選ぶと毎回同じ結果になってしまうため、
// 上位の中からスコアに応じた重み付きランダムで選ぶ(実績の高いものほど選ばれやすい)。
function weightedPick<T extends { averageRating: number; sampleCount: number }>(items: T[]): T {
  const weights = items.map((item) => Math.max(0.01, item.averageRating * Math.log2(1 + item.sampleCount)))
  const total = weights.reduce((sum, w) => sum + w, 0)
  let r = Math.random() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

// 最低1件は返す(空配列だと歌詞プロンプトのバリデーションが失敗するため)
function pickRandomSubset<T>(list: T[], max: number): T[] {
  const shuffled = [...list].sort(() => Math.random() - 0.5)
  const count = Math.max(1, Math.floor(Math.random() * (max + 1)))
  return shuffled.slice(0, count)
}

const TOP_FRACTION = 0.3

function pickFromFavoriteCombos<TInput>(combos: FavoriteCombo<TInput>[]): FavoriteCombo<TInput> | null {
  if (combos.length === 0) return null
  const topCount = Math.max(1, Math.ceil(combos.length * TOP_FRACTION))
  return weightedPick(combos.slice(0, topCount))
}

function topKeyOrUndefined(options: OptionEntry[], scores: Map<string, { sampleCount: number; averageRating: number }>): string | undefined {
  if (options.length === 0) return undefined
  return rankByScore(options, scores)[0]?.key
}

function topKeys(
  options: OptionEntry[],
  scores: Map<string, { sampleCount: number; averageRating: number }>,
  count: number,
): string[] {
  return rankByScore(options, scores)
    .slice(0, count)
    .map((o) => o.key)
}

/** 選択済みのジャンル/ムード/雰囲気に応じたテーマキーワードを、履歴の評価から相性の良い順に選ぶ */
function pickThemeKeywords(history: HistoryEntry[], genreKey: string, moodKey: string | undefined, atmosphereKeys: string[]): string[] {
  const keywordScores = scoreKeywordsFromHistory(history)
  const groups = buildKeywordSuggestions({ genreKey, moodKey, atmosphereKeys }, keywordScores)
  const allWords = groups.flatMap((g) => g.words)
  if (allWords.length > 0) return allWords.slice(0, 3)
  return pickRandomSubset(THEME_WORD_BANK, 2)
}

function averagePredictedRating(
  scores: Record<string, Map<string, { sampleCount: number; averageRating: number }>>,
  picks: { category: string; key: string | undefined }[],
): number {
  const relevant = picks
    .map(({ category, key }) => (key ? scores[category].get(key) : undefined))
    .filter((s): s is { sampleCount: number; averageRating: number } => Boolean(s))
  if (relevant.length === 0) return 3
  return relevant.reduce((sum, s) => sum + s.averageRating, 0) / relevant.length
}

function clampRating(value: number): number {
  return Math.min(5, Math.max(1, Math.round(value)))
}

export interface SmartSelectionResult<TInput> {
  input: TInput
  predictedRating: number
}

/**
 * 作曲プロンプトの「相性の良い」組み合わせを選ぶ。完全ランダムではなく、
 * 高評価の組み合わせ実績(FavoriteCombo)があればそこから重み付きで選び、
 * 無ければカテゴリ別の学習済みランキング上位で補完する。
 */
export function pickSmartCompositionInput(history: HistoryEntry[]): SmartSelectionResult<GenerationInput> {
  const compositionEntries = history.filter((e): e is CompositionHistoryEntry => e.kind === 'composition')
  const combos = computeFavoriteCompositionCombos(compositionEntries)
  const picked = pickFromFavoriteCombos(combos)
  const scores = computeScoresByCategory(history)

  const base = picked?.input
  const genreKey = base?.genreKey ?? topKeyOrUndefined(templates.genres, scores.genreKey) ?? templates.genres[0].key
  const moodKey = base?.moodKey ?? topKeyOrUndefined(templates.moods, scores.moodKey)
  const vocalTypeKey = base?.vocalTypeKey ?? topKeyOrUndefined(templates.vocalTypes, scores.vocalTypeKey)
  const songStructureKey = base?.songStructureKey ?? topKeyOrUndefined(templates.songStructures, scores.songStructureKey)
  const atmosphereKeys = base?.atmosphereKeys?.length ? base.atmosphereKeys : topKeys(templates.atmospheres, scores.atmosphereKeys, 2)
  const instrumentKeys = base?.instrumentKeys?.length
    ? base.instrumentKeys
    : topKeys(templates.instrumentElements, scores.instrumentKeys, 3)
  const tempo = base?.tempo
  const themeKeywords = base?.themeKeywords?.length ? base.themeKeywords : pickThemeKeywords(history, genreKey, moodKey, atmosphereKeys)

  const predictedRating = picked
    ? picked.averageRating
    : averagePredictedRating(scores, [
        { category: 'genreKey', key: genreKey },
        { category: 'moodKey', key: moodKey },
      ])

  return {
    input: { genreKey, moodKey, vocalTypeKey, songStructureKey, instrumentKeys, atmosphereKeys, tempo, themeKeywords },
    predictedRating: clampRating(predictedRating),
  }
}

/**
 * 歌詞プロンプトの「相性の良い」組み合わせを選ぶ（作曲プロンプトと同じ考え方）。
 */
export function pickSmartLyricsInput(history: HistoryEntry[]): SmartSelectionResult<LyricsPromptInput> {
  const lyricsEntries = history.filter((e): e is LyricsPromptHistoryEntry => e.kind === 'lyricsPrompt')
  const combos = computeFavoriteLyricsCombos(lyricsEntries)
  const picked = pickFromFavoriteCombos(combos)
  const scores = computeScoresByCategory(history)

  const base = picked?.input
  const genreKey = base?.genreKey ?? topKeyOrUndefined(templates.genres, scores.genreKey) ?? templates.genres[0].key
  const moodKey = base?.moodKey ?? topKeyOrUndefined(templates.moods, scores.moodKey)
  const vocalTypeKey = base?.vocalTypeKey ?? topKeyOrUndefined(templates.vocalTypes, scores.vocalTypeKey)
  const songStructureKey = base?.songStructureKey ?? topKeyOrUndefined(templates.songStructures, scores.songStructureKey)
  const atmosphereKeys = base?.atmosphereKeys?.length ? base.atmosphereKeys : topKeys(templates.atmospheres, scores.atmosphereKeys, 2)
  const themeKeywords = base?.themeKeywords?.length ? base.themeKeywords : pickThemeKeywords(history, genreKey, moodKey, atmosphereKeys)
  const languageKey = base?.languageKey ?? 'ja'

  const predictedRating = picked
    ? picked.averageRating
    : averagePredictedRating(scores, [
        { category: 'genreKey', key: genreKey },
        { category: 'moodKey', key: moodKey },
      ])

  return {
    input: { genreKey, moodKey, vocalTypeKey, songStructureKey, atmosphereKeys, themeKeywords, languageKey },
    predictedRating: clampRating(predictedRating),
  }
}

/**
 * 作曲プロンプトの選択内容とジャンル・ムード・雰囲気・曲構成・ボーカルを完全に揃えた、
 * 対になる歌詞プロンプトの入力を作る（作曲と歌詞で世界観がズレないようにするため）。
 */
export function deriveLyricsInputFromComposition(
  compositionInput: GenerationInput,
  history: HistoryEntry[],
): SmartSelectionResult<LyricsPromptInput> {
  const scores = computeScoresByCategory(history)
  const themeKeywords = compositionInput.themeKeywords?.length
    ? compositionInput.themeKeywords
    : pickThemeKeywords(history, compositionInput.genreKey, compositionInput.moodKey, compositionInput.atmosphereKeys)

  const predictedRating = averagePredictedRating(scores, [
    { category: 'genreKey', key: compositionInput.genreKey },
    { category: 'moodKey', key: compositionInput.moodKey },
  ])

  return {
    input: {
      genreKey: compositionInput.genreKey,
      moodKey: compositionInput.moodKey,
      vocalTypeKey: compositionInput.vocalTypeKey,
      songStructureKey: compositionInput.songStructureKey,
      atmosphereKeys: compositionInput.atmosphereKeys,
      themeKeywords,
      languageKey: 'ja',
    },
    predictedRating: clampRating(predictedRating),
  }
}
