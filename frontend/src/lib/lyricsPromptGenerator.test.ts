import { describe, expect, it } from 'vitest'
import {
  generateLyricsPromptVariant,
  generateLyricsPromptVariants,
  validateLyricsPromptInput,
} from './lyricsPromptGenerator'
import type { LyricsPromptInput } from '../types/lyricsPrompt'

const BASE_INPUT: LyricsPromptInput = {
  genreKey: 'city_pop',
  moodKey: undefined,
  atmosphereKeys: [],
  vocalTypeKey: undefined,
  songStructureKey: undefined,
  themeKeywords: ['夏', '花火', '切なさ'],
  languageKey: 'ja',
}

describe('validateLyricsPromptInput', () => {
  it('rejects a missing genre', () => {
    const result = validateLyricsPromptInput({ ...BASE_INPUT, genreKey: '' })
    expect(result.valid).toBe(false)
  })

  it('rejects empty theme keywords', () => {
    const result = validateLyricsPromptInput({ ...BASE_INPUT, themeKeywords: [] })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('テーマ・キーワードを最低1つ入力してください')
  })

  it('accepts a valid input', () => {
    expect(validateLyricsPromptInput(BASE_INPUT)).toEqual({ valid: true, errors: [] })
  })
})

describe('generateLyricsPromptVariants', () => {
  it('throws for invalid input', () => {
    expect(() => generateLyricsPromptVariants({ ...BASE_INPUT, themeKeywords: [] })).toThrow()
  })

  it('produces the standard/poetic/minimal variants, each as a single prompt text', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    expect(result.variants.map((v) => v.styleId)).toEqual(['standard', 'poetic', 'minimal'])
    for (const variant of result.variants) {
      expect(variant.promptText.length).toBeGreaterThan(0)
    }
  })

  it('embeds the genre, theme keywords, and language in the standard variant', () => {
    const standard = generateLyricsPromptVariant(BASE_INPUT, 'standard')
    expect(standard.promptText).toContain('シティポップ')
    expect(standard.promptText).toContain('夏、花火、切なさ')
    expect(standard.promptText).toContain('言語: 日本語')
  })

  it('includes songwriting quality guidance (structure, hook repetition, output format) in every style', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toContain('サビ')
      expect(variant.promptText).toMatch(/陳腐|ありきたり/)
      expect(variant.promptText).toContain('歌詞本文のみ')
    }
  })

  it('includes story/pacing/word-variety guidance in every style', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toContain('ストーリー性')
      expect(variant.promptText).toContain('Aメロ・Bメロは長すぎなくてよ')
      expect(variant.promptText).toContain('単調にならない')
      expect(variant.promptText).toMatch(/同じ(単語やフレーズ|ワード)を使いすぎ/)
    }
  })

  it('appends the base prompt text as reference context when provided', () => {
    const withBase = generateLyricsPromptVariant(
      { ...BASE_INPUT, basePromptText: '夏の終わりの切ない恋の情景' },
      'standard',
    )
    expect(withBase.promptText).toContain('参考プロンプト')
    expect(withBase.promptText).toContain('夏の終わりの切ない恋の情景')
  })

  it('omits the reference section when no base prompt is given', () => {
    const withoutBase = generateLyricsPromptVariant(BASE_INPUT, 'standard')
    expect(withoutBase.promptText).not.toContain('参考プロンプト')
  })

  it('is unaffected by an empty genome (backward compatible)', () => {
    const withEmptyGenome = generateLyricsPromptVariant(BASE_INPUT, 'standard', { hookPhrases: [], connectorPhrases: [] })
    const withoutGenome = generateLyricsPromptVariant(BASE_INPUT, 'standard')
    expect(withEmptyGenome.promptText).toBe(withoutGenome.promptText)
  })

  it('prepends an evolved hook phrase when the genome has one', () => {
    const variant = generateLyricsPromptVariant(BASE_INPUT, 'standard', {
      hookPhrases: ['ねえ、聞いて――'],
      connectorPhrases: [],
    })
    expect(variant.promptText.startsWith('ねえ、聞いて――')).toBe(true)
  })

  it('appends an evolved connector phrase when the genome has one', () => {
    const variant = generateLyricsPromptVariant(BASE_INPUT, 'standard', {
      hookPhrases: [],
      connectorPhrases: ['最後まで、想いを途切れさせないで。'],
    })
    expect(variant.promptText.endsWith('最後まで、想いを途切れさせないで。')).toBe(true)
  })
})
