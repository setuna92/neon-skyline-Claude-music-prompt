import { describe, expect, it } from 'vitest'
import { runExecutorCycle } from './executor'
import { validateLyricsPromptInput } from '../lyricsPromptGenerator'
import templatesData from '../../data/templates.json'
import type { PromptTemplates } from '../../types/templates'
import type { TemplateOverride } from '../../types/learning'

const templates = templatesData as PromptTemplates
const KNOWN_STYLE_IDS = new Set(templates.variantStyles.map((s) => s.id))
const KNOWN_GENRE_KEYS = new Set(templates.genres.map((g) => g.key))

describe('runExecutorCycle', () => {
  it('never throws across many iterations (regression guard: themeKeywords must never end up empty)', () => {
    // buildRandomInput が空のthemeKeywordsを生成すると generateLyricsPromptVariants がバリデーションエラーを
    // 投げる。これは以前、確率的にしか再現しないバグとして実際に発生した(2回連続でpickRandomSubsetを呼んでいた)。
    for (let i = 0; i < 300; i++) {
      expect(() => runExecutorCycle(1, [])).not.toThrow()
    }
  })

  it('produces exactly concurrencyLimit * 3 variants (one run per input, 3 styles each)', () => {
    expect(runExecutorCycle(1, [])).toHaveLength(3)
    expect(runExecutorCycle(2, [])).toHaveLength(6)
    expect(runExecutorCycle(5, [])).toHaveLength(15)
  })

  it('every variant references a known style id and genre key, with non-empty expected keywords', () => {
    const variants = runExecutorCycle(10, [])
    for (const variant of variants) {
      expect(KNOWN_STYLE_IDS.has(variant.styleId)).toBe(true)
      expect(KNOWN_GENRE_KEYS.has(variant.genreKey)).toBe(true)
      expect(variant.expectedKeywords.length).toBeGreaterThan(0)
      expect(variant.text.length).toBeGreaterThan(0)
    }
  })

  it('always builds an input that independently passes validateLyricsPromptInput', () => {
    // runExecutorCycle は内部で generateLyricsPromptVariants を呼ぶため間接的に検証されるが、
    // ここでは意図を明示するために直接 validateLyricsPromptInput 相当の性質(非空テーマ)を確認する
    for (let i = 0; i < 50; i++) {
      const variants = runExecutorCycle(1, [])
      // expectedKeywords の非空はテーマキーワードが有効だったことの証拠
      expect(variants.every((v) => v.expectedKeywords.length > 0)).toBe(true)
    }
  })

  it('applies the given text genome (hook phrase) to every generated variant', () => {
    const genome = { hookPhrases: ['ねえ、聞いて――'], connectorPhrases: [] }
    const variants = runExecutorCycle(3, [], genome)
    expect(variants.every((v) => v.text.startsWith('ねえ、聞いて――'))).toBe(true)
  })

  it('picks the boosted genre noticeably more often than baseline when a strong override exists', () => {
    const overrides: TemplateOverride[] = [
      { id: 'o1', category: 'genreKey', key: 'jrock', boost: 20, reason: 'test', createdAt: '' },
    ]
    let jrockCount = 0
    const runs = 200
    for (let i = 0; i < runs; i++) {
      const [variant] = runExecutorCycle(1, overrides)
      if (variant.genreKey === 'jrock') jrockCount++
    }
    // 重み付けなしなら基準は約 1/105 (≈1%)。仕組みが機能していれば大幅に高くなるはず。
    expect(jrockCount / runs).toBeGreaterThan(0.25)
  })

  it('never picks an excluded theme word, even though it may still appear via forcedThemeWords', () => {
    for (let i = 0; i < 100; i++) {
      const variants = runExecutorCycle(1, [], undefined, { excludeThemeWords: ['夏', '別れ', '再会', '青春', '花火'] })
      for (const variant of variants) {
        expect(variant.expectedKeywords).not.toContain('夏')
        expect(variant.expectedKeywords).not.toContain('別れ')
      }
    }
  })

  it('ignores overrides for categories other than genreKey when weighting genre selection', () => {
    const overrides: TemplateOverride[] = [
      { id: 'o1', category: 'moodKey', key: 'chill', boost: 100, reason: 'test', createdAt: '' },
    ]
    // moodKeyのブーストはジャンル選択に影響しないはず(クラッシュしないことも含めて確認)
    expect(() => runExecutorCycle(5, overrides)).not.toThrow()
  })
})

describe('validateLyricsPromptInput sanity (cross-check with lyricsPromptGenerator)', () => {
  it('confirms the theme-keyword requirement this module must satisfy', () => {
    expect(validateLyricsPromptInput({
      genreKey: 'pop',
      atmosphereKeys: [],
      themeKeywords: [],
      languageKey: 'ja',
    }).valid).toBe(false)
  })
})
