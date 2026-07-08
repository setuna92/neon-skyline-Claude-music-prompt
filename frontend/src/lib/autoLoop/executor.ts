import templatesData from '../../data/templates.json'
import type { PromptTemplates } from '../../types/templates'
import type { LyricsPromptInput } from '../../types/lyricsPrompt'
import type { TemplateOverride } from '../../types/learning'
import type { ExecutedVariant } from '../../types/autoLoop'
import type { TextGenome } from '../../types/textGenome'
import { EMPTY_GENOME } from '../../types/textGenome'
import { generateLyricsPromptVariants } from '../lyricsPromptGenerator'

const templates = templatesData as PromptTemplates

// 実LLM無し・API課金無しで多様な入力を作るための簡易テーマ語彙バンク
export const THEME_WORD_BANK = [
  '夏',
  '別れ',
  '再会',
  '青春',
  '花火',
  '雨',
  '夜明け',
  '旅立ち',
  '約束',
  '記憶',
  '自由',
  '孤独',
  '希望',
  '疾走',
  '恋',
]

function pickRandom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

function pickRandomSubset<T>(list: T[], max: number): T[] {
  const shuffled = [...list].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.floor(Math.random() * (max + 1)))
}

function pickWeightedGenreKey(overrides: TemplateOverride[]): string {
  // 同じジャンルへのブーストが複数件あっても重複排除する。重複したまま pickRandom に渡すと、
  // 承認回数が多いジャンルほど配列内で水増しされ、意図せず毎回そのジャンルばかり選ばれる
  // (自己強化的な偏り)原因になるため。
  const boosted = [...new Set(overrides.filter((o) => o.category === 'genreKey' && o.boost > 0).map((o) => o.key))]
  // 承認済みブーストがあるジャンルは50%の確率で優先的に選ぶ（既存の自己学習ループとの一貫性）
  if (boosted.length > 0 && Math.random() < 0.5) {
    return pickRandom(boosted)
  }
  return pickRandom(templates.genres).key
}

export interface ExecutorOptions {
  /** 通常のテーマ語彙バンクに追加する語（自動発見された語彙など）。ランダム選択の候補に加わる。 */
  extraThemeWords?: string[]
  /** すべての生成入力に必ず含める語（Testerが特定の候補語を検証するときに使う）。 */
  forcedThemeWords?: string[]
  /** ランダム選択の候補から除外する語（降格済みキーワードなど）。 */
  excludeThemeWords?: string[]
}

function buildRandomInput(overrides: TemplateOverride[], options: ExecutorOptions): LyricsPromptInput {
  const excluded = new Set(options.excludeThemeWords ?? [])
  const themePool = [...THEME_WORD_BANK, ...(options.extraThemeWords ?? [])].filter((w) => !excluded.has(w))
  const randomKeywords = pickRandomSubset(themePool, 3)
  const forced = options.forcedThemeWords ?? []
  const themeKeywords = [...new Set([...forced, ...randomKeywords])]

  return {
    genreKey: pickWeightedGenreKey(overrides),
    moodKey: Math.random() < 0.7 ? pickRandom(templates.moods).key : undefined,
    atmosphereKeys: pickRandomSubset(
      templates.atmospheres.map((a) => a.key),
      2,
    ),
    vocalTypeKey: Math.random() < 0.5 ? pickRandom(templates.vocalTypes).key : undefined,
    songStructureKey: Math.random() < 0.5 ? pickRandom(templates.songStructures).key : undefined,
    themeKeywords: themeKeywords.length > 0 ? themeKeywords : [pickRandom(themePool)],
    languageKey: 'ja',
  }
}

/**
 * 1回分の実行(Execute)。concurrencyLimit 件のランダム入力を作り、それぞれについて
 * 歌詞プロンプト(標準/詩的/ミニマル)を生成する。外部LLM呼び出しは行わない(モック=ローカル生成)。
 */
export function runExecutorCycle(
  concurrencyLimit: number,
  overrides: TemplateOverride[],
  genome: TextGenome = EMPTY_GENOME,
  options: ExecutorOptions = {},
): ExecutedVariant[] {
  const variants: ExecutedVariant[] = []

  for (let i = 0; i < concurrencyLimit; i++) {
    const input = buildRandomInput(overrides, options)
    const result = generateLyricsPromptVariants(input, genome)
    for (const variant of result.variants) {
      variants.push({
        variantId: variant.variantId,
        styleId: variant.styleId,
        genreKey: input.genreKey,
        text: variant.promptText,
        expectedKeywords: [...input.themeKeywords, ...input.atmosphereKeys.map((k) => resolveAtmosphereLabel(k))],
      })
    }
  }

  return variants
}

function resolveAtmosphereLabel(key: string): string {
  return templates.atmospheres.find((a) => a.key === key)?.label ?? key
}
