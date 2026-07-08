import templatesData from '../data/templates.json'
import type { OptionEntry, PromptTemplates } from '../types/templates'
import type { HistoryEntry, CompositionHistoryEntry, LyricsPromptHistoryEntry } from '../types/persistence'
import type { GenerationInput } from '../types/generation'
import type { LyricsPromptInput } from '../types/lyricsPrompt'
import type { FavoriteCombo } from './comboLearning'
import { computeFavoriteCompositionCombos, computeFavoriteLyricsCombos } from './comboLearning'
import { computeScoresByCategory } from './learning/ranking'
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
// お気に入り組み合わせが存在しても、この確率では敢えて使わずカテゴリ別の重み付きランダムから
// 選び直す。組み合わせが少数しかない状態だと毎回同じ結果になってしまい、バリエーションが
// 生まれず自己進化にも繋がらないため、意図的に探索(exploration)の余地を残す。
const EXPLORATION_RATE = 0.3

function pickFromFavoriteCombos<TInput extends { genreKey: string; moodKey?: string }>(
  combos: FavoriteCombo<TInput>[],
  allowedGenreKeys?: string[],
  avoid?: { genreKey?: string; moodKey?: string },
): FavoriteCombo<TInput> | null {
  let eligible =
    !allowedGenreKeys || allowedGenreKeys.length === 0
      ? combos
      : combos.filter((c) => allowedGenreKeys.includes(c.input.genreKey))
  // ここで0件になるのは「履歴が空」または「allowedGenreKeysに該当する組み合わせが無い」
  // という通常のケース。そのままnullを返し、呼び出し元でカテゴリ別の重み付き選択に委ねる。
  if (eligible.length === 0) return null

  // avoidは「直前に選ばれた組み合わせそのもの」を表す前提(genreKey/moodKeyは同じ回の
  // 結果からペアで渡すこと)。直前と全く同じ組み合わせは候補から外す(ボタンを押し直した
  // ときに毎回同じ結果になるのを防ぐため)。除外した結果0件になった場合(=お気に入り
  // 組み合わせが直前のもの1件しか無かった場合)、除外前の状態に戻すと直前と同じ組み合わせに
  // 逆戻りしてしまうので、そのまま「組み合わせ無し」としてカテゴリ別の重み付き選択に
  // フォールバックする。
  if (avoid?.genreKey) {
    eligible = eligible.filter((c) => !(c.input.genreKey === avoid.genreKey && c.input.moodKey === avoid.moodKey))
    if (eligible.length === 0) return null
  }

  if (Math.random() < EXPLORATION_RATE) return null
  const topCount = Math.max(1, Math.ceil(eligible.length * TOP_FRACTION))
  return weightedPick(eligible.slice(0, topCount))
}

/**
 * スコア付きの選択肢の中から、評価が高いものほど選ばれやすい重み付きランダムで1件選ぶ。
 * 未評価の選択肢にも基礎重みを残すことで、新しい組み合わせを試す余地(探索)を確保する。
 * これにより、学習が進んでも上位互換だけが固定的に選ばれ続けることを防ぐ。
 */
function weightedPickOption(
  options: OptionEntry[],
  scores: Map<string, { sampleCount: number; averageRating: number }>,
): OptionEntry | undefined {
  if (options.length === 0) return undefined
  const BASELINE_WEIGHT = 1
  const weights = options.map((o) => {
    const s = scores.get(o.key)
    return s ? Math.max(0.3, s.averageRating * Math.log2(1 + s.sampleCount)) : BASELINE_WEIGHT
  })
  const total = weights.reduce((sum, w) => sum + w, 0)
  let r = Math.random() * total
  for (let i = 0; i < options.length; i++) {
    r -= weights[i]
    if (r <= 0) return options[i]
  }
  return options[options.length - 1]
}

function pickKeyWeighted(
  options: OptionEntry[],
  scores: Map<string, { sampleCount: number; averageRating: number }>,
  avoidKey?: string,
): string | undefined {
  // 直前と同じ値は、他に選択肢があれば候補から外して必ず変化させる
  const pool = avoidKey && options.length > 1 ? options.filter((o) => o.key !== avoidKey) : options
  return weightedPickOption(pool.length > 0 ? pool : options, scores)?.key
}

/** 重複無しでcount件、重み付きランダムに選ぶ(評価が高いものほど選ばれやすいが毎回同じにはならない) */
function pickKeysWeighted(
  options: OptionEntry[],
  scores: Map<string, { sampleCount: number; averageRating: number }>,
  count: number,
): string[] {
  const pool = [...options]
  const result: string[] = []
  for (let i = 0; i < count && pool.length > 0; i++) {
    const chosen = weightedPickOption(pool, scores)
    if (!chosen) break
    result.push(chosen.key)
    pool.splice(
      pool.findIndex((o) => o.key === chosen.key),
      1,
    )
  }
  return result
}

/** 選択済みのジャンル/ムード/雰囲気に応じたテーマキーワードを、履歴の評価から相性の良い順に選ぶ */
function pickThemeKeywords(history: HistoryEntry[], genreKey: string, moodKey: string | undefined, atmosphereKeys: string[]): string[] {
  const keywordScores = scoreKeywordsFromHistory(history)
  const groups = buildKeywordSuggestions({ genreKey, moodKey, atmosphereKeys }, keywordScores)
  const allWords = groups.flatMap((g) => g.words)
  if (allWords.length > 0) {
    // 上位互換だけを毎回そのまま使うと同じ歌詞テーマが繰り返されるため、上位候補の中から
    // ランダムに2〜3件選んでバリエーションを持たせる。
    const topPool = allWords.slice(0, Math.min(6, allWords.length))
    return pickRandomSubset(topPool, 3)
  }
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

export interface SmartSelectOptions {
  /** 指定した場合、これらのジャンルの中からのみ選ぶ(未指定/空なら全ジャンルが対象) */
  allowedGenreKeys?: string[]
  /**
   * 直前にこの機能で選ばれたジャンル/ムード。指定すると、他に選択肢がある限り
   * 同じ組み合わせが連続して選ばれないようにする(「もう一度押したら別のものになる」ため)。
   * 必ず同じ回の結果からペアで渡すこと(avoidMoodKeyだけ省略すると、moodKey未設定の
   * 別の組み合わせまで誤って「直前と同じ」判定されてしまう)。
   */
  avoidGenreKey?: string
  avoidMoodKey?: string
}

function candidateGenres(allowedGenreKeys?: string[]): OptionEntry[] {
  if (!allowedGenreKeys || allowedGenreKeys.length === 0) return templates.genres
  const allowed = new Set(allowedGenreKeys)
  const scoped = templates.genres.filter((g) => allowed.has(g.key))
  return scoped.length > 0 ? scoped : templates.genres
}

/**
 * 作曲プロンプトの「相性の良い」組み合わせを選ぶ。完全ランダムではなく、
 * 高評価の組み合わせ実績(FavoriteCombo)があれば一定確率でそこから重み付きで選び、
 * それ以外はカテゴリ別の学習済みスコアに基づく重み付きランダムで選ぶ(未評価の選択肢にも
 * 探索の機会を残すため、同じ組み合わせに固定的に収束しない)。
 */
export function pickSmartCompositionInput(
  history: HistoryEntry[],
  options: SmartSelectOptions = {},
): SmartSelectionResult<GenerationInput> {
  const compositionEntries = history.filter((e): e is CompositionHistoryEntry => e.kind === 'composition')
  const combos = computeFavoriteCompositionCombos(compositionEntries)
  const picked = pickFromFavoriteCombos(combos, options.allowedGenreKeys, {
    genreKey: options.avoidGenreKey,
    moodKey: options.avoidMoodKey,
  })
  const scores = computeScoresByCategory(history)
  const genreCandidates = candidateGenres(options.allowedGenreKeys)

  const base = picked?.input
  const genreKey = base?.genreKey ?? pickKeyWeighted(genreCandidates, scores.genreKey, options.avoidGenreKey) ?? genreCandidates[0].key
  const moodKey = base?.moodKey ?? pickKeyWeighted(templates.moods, scores.moodKey, options.avoidMoodKey)
  const vocalTypeKey = base?.vocalTypeKey ?? pickKeyWeighted(templates.vocalTypes, scores.vocalTypeKey)
  const songStructureKey = base?.songStructureKey ?? pickKeyWeighted(templates.songStructures, scores.songStructureKey)
  const atmosphereKeys = base?.atmosphereKeys?.length
    ? base.atmosphereKeys
    : pickKeysWeighted(templates.atmospheres, scores.atmosphereKeys, 2)
  const instrumentKeys = base?.instrumentKeys?.length
    ? base.instrumentKeys
    : pickKeysWeighted(templates.instrumentElements, scores.instrumentKeys, 3)
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
 * 歌詞プロンプトの「相性の良い」組み合わせを選ぶ(作曲プロンプトと同じ考え方)。
 */
export function pickSmartLyricsInput(
  history: HistoryEntry[],
  options: SmartSelectOptions = {},
): SmartSelectionResult<LyricsPromptInput> {
  const lyricsEntries = history.filter((e): e is LyricsPromptHistoryEntry => e.kind === 'lyricsPrompt')
  const combos = computeFavoriteLyricsCombos(lyricsEntries)
  const picked = pickFromFavoriteCombos(combos, options.allowedGenreKeys, {
    genreKey: options.avoidGenreKey,
    moodKey: options.avoidMoodKey,
  })
  const scores = computeScoresByCategory(history)
  const genreCandidates = candidateGenres(options.allowedGenreKeys)

  const base = picked?.input
  const genreKey = base?.genreKey ?? pickKeyWeighted(genreCandidates, scores.genreKey, options.avoidGenreKey) ?? genreCandidates[0].key
  const moodKey = base?.moodKey ?? pickKeyWeighted(templates.moods, scores.moodKey, options.avoidMoodKey)
  const vocalTypeKey = base?.vocalTypeKey ?? pickKeyWeighted(templates.vocalTypes, scores.vocalTypeKey)
  const songStructureKey = base?.songStructureKey ?? pickKeyWeighted(templates.songStructures, scores.songStructureKey)
  const atmosphereKeys = base?.atmosphereKeys?.length
    ? base.atmosphereKeys
    : pickKeysWeighted(templates.atmospheres, scores.atmosphereKeys, 2)
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
 * 対になる歌詞プロンプトの入力を作る(作曲と歌詞で世界観がズレないようにするため)。
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
