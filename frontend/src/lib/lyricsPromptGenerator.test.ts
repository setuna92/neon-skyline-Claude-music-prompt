import { describe, expect, it } from 'vitest'
import {
  generateLyricsPromptVariant,
  generateLyricsPromptVariants,
  generateSynopsisPrompt,
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

  it('includes songwriting quality guidance (structure, cliche avoidance, output format) in every style', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toContain('サビ')
      expect(variant.promptText).toMatch(/クリシェ|使い古された/)
      expect(variant.promptText).toContain('歌詞本文のみ')
    }
  })

  it('includes pacing/word-variety guidance in every style', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toContain('Aメロ・Bメロは長すぎなくてよ')
      expect(variant.promptText).toContain('単調にならない')
      expect(variant.promptText).toMatch(/同じ(単語やフレーズ|ワード)を使いすぎ/)
    }
  })

  it('instructs every style to translate keywords into metaphor instead of inserting them literally', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toContain('翻訳')
      expect(variant.promptText).toMatch(/そのまま(歌詞|使)/)
    }
  })

  it('bans music/production terminology and meta references to the song itself in every style', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toContain('音楽用語')
    }
    expect(result.variants[0].promptText).toContain('メタ表現')
  })

  it('requires an upfront story design (protagonist/event/ending) with a 起承転結 arc in every style', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toContain('起承転結')
    }
    expect(result.variants[0].promptText).toContain('主人公')
  })

  it('assigns section roles including ラストサビ resolving the story in every style', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toContain('ラストサビ')
      expect(variant.promptText).toContain('核フレーズ')
    }
  })

  it('requires a sensory-description quota and specific concrete details in every style', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toContain('五感')
    }
    expect(result.variants[0].promptText).toContain('冷蔵庫の唸り')
  })

  it('bans the specific overused cliches listed by the user in every style', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toContain('輝く未来')
      expect(variant.promptText).toContain('無限の空')
    }
  })

  it('explicitly tells Claude to write the lyrics directly right now, not describe or ask how, in every style', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toContain('プロの作詞家')
      expect(variant.promptText).toMatch(/今この場で(最初から)?最後まで(完全に)?書き切って/)
      expect(variant.promptText).toMatch(/相談|確認/)
    }
  })

  it('tells Claude to aim for its best-ever lyrics every time, in every style', () => {
    const result = generateLyricsPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toContain('一番')
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

  it('embeds the synopsis as a mandatory condition in every style when provided', () => {
    const synopsis = '主人公: 夜勤明けの店員／出来事: 始発を待つ／結末: 折り返さずに歩き出す'
    const result = generateLyricsPromptVariants({ ...BASE_INPUT, synopsis })
    for (const variant of result.variants) {
      expect(variant.promptText).toContain(synopsis)
      expect(variant.promptText).toMatch(/あらすじ.*従っ/)
    }
  })

  it('omits any synopsis section when none is given', () => {
    const withoutSynopsis = generateLyricsPromptVariant(BASE_INPUT, 'standard')
    expect(withoutSynopsis.promptText).not.toContain('あらすじ')
  })

  it('never runs the synopsis text directly into the next instruction sentence in the minimal style', () => {
    const synopsis = '主人公: 夜勤明けの店員／出来事: 始発を待つ／結末: 折り返さずに歩き出す'
    const minimal = generateLyricsPromptVariant({ ...BASE_INPUT, synopsis }, 'minimal')
    expect(minimal.promptText).not.toContain(`${synopsis}セクション`)
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

describe('generateSynopsisPrompt', () => {
  it('throws for an unknown genre', () => {
    expect(() => generateSynopsisPrompt({ ...BASE_INPUT, genreKey: 'not-a-genre' })).toThrow()
  })

  it('embeds genre and theme keywords, and asks for the 3-line 主人公/出来事/結末 format only', () => {
    const prompt = generateSynopsisPrompt(BASE_INPUT)
    expect(prompt).toContain('シティポップ')
    expect(prompt).toContain('夏、花火、切なさ')
    expect(prompt).toContain('主人公:')
    expect(prompt).toContain('出来事:')
    expect(prompt).toContain('結末:')
    expect(prompt).toMatch(/この3行のみ/)
  })

  it('tells Claude the keywords need not be used verbatim in the synopsis', () => {
    const prompt = generateSynopsisPrompt(BASE_INPUT)
    expect(prompt).toContain('そのまま使う必要はありません')
  })

  it('explicitly tells Claude to just write the synopsis directly right now, not ask how', () => {
    const prompt = generateSynopsisPrompt(BASE_INPUT)
    expect(prompt).toContain('プロの作詞家')
    expect(prompt).toMatch(/相談|確認/)
  })
})
