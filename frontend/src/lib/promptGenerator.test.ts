import { describe, expect, it } from 'vitest'
import { generateVariant, generateVariants, validateGenerationInput, validateVariant } from './promptGenerator'
import type { GenerationInput } from '../types/generation'

const BASE_INPUT: GenerationInput = {
  genreKey: 'jrock',
  moodKey: 'late_night_drive',
  tempo: 128,
  vocalTypeKey: 'female',
  instrumentKeys: ['guitar', 'drums', 'bass'],
  songStructureKey: 'verse_chorus',
  atmosphereKeys: ['fast_paced', 'emo'],
}

describe('validateGenerationInput', () => {
  it('rejects a missing genre', () => {
    const result = validateGenerationInput({ ...BASE_INPUT, genreKey: '' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('ジャンルを最低1つ選択してください')
  })

  it('rejects an unknown genre key', () => {
    const result = validateGenerationInput({ ...BASE_INPUT, genreKey: 'not-a-real-genre' })
    expect(result.valid).toBe(false)
  })

  it('rejects a non-positive tempo', () => {
    const result = validateGenerationInput({ ...BASE_INPUT, tempo: 0 })
    expect(result.valid).toBe(false)
  })

  it('accepts a valid input', () => {
    const result = validateGenerationInput(BASE_INPUT)
    expect(result).toEqual({ valid: true, errors: [] })
  })
})

describe('generateVariants', () => {
  it('throws when the input is invalid', () => {
    expect(() => generateVariants({ ...BASE_INPUT, genreKey: '' })).toThrow()
  })

  it('produces exactly the standard/poetic/minimal variants', () => {
    const result = generateVariants(BASE_INPUT)
    expect(result.variants.map((v) => v.styleId)).toEqual(['standard', 'poetic', 'minimal'])
    for (const variant of result.variants) {
      expect(validateVariant(variant).valid).toBe(true)
    }
  })

  it('embeds the genre, tempo, mood, vocal, instruments, structure, and atmosphere in the standard variant', () => {
    const standard = generateVariant(BASE_INPUT, 'standard')
    expect(standard.englishPrompt).toContain('J-Rock')
    expect(standard.englishPrompt).toContain('BPM 128')
    expect(standard.englishPrompt).toContain('late-night driving atmosphere')
    expect(standard.englishPrompt).toContain('female vocals')
    expect(standard.englishPrompt).toContain('guitar, drums, bass')
    expect(standard.japanesePrompt).toContain('BPM128')
    expect(standard.japanesePrompt).toContain('ギター、ドラムス、ベース')
  })

  it('omits optional sections when not provided', () => {
    const minimalInput: GenerationInput = { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] }
    const standard = generateVariant(minimalInput, 'standard')
    expect(standard.englishPrompt).toBe(
      'Create a Pop track.\n\nAfter outputting everything, summarize it in 1000 characters.',
    )
  })

  it('appends the mandatory summary instruction to every variant, in both languages', () => {
    const result = generateVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.englishPrompt).toContain('After outputting everything, summarize it in 1000 characters.')
      expect(variant.japanesePrompt).toContain('全体を出力した後、それを1000字でまとめる')
    }
  })

  it('produces different phrasing across the three styles for the same input', () => {
    const result = generateVariants(BASE_INPUT)
    const [standard, poetic, minimal] = result.variants
    expect(standard.englishPrompt).not.toBe(poetic.englishPrompt)
    expect(standard.englishPrompt).not.toBe(minimal.englishPrompt)
  })

  it('embeds theme keywords in every style, in both languages', () => {
    const input: GenerationInput = { ...BASE_INPUT, themeKeywords: ['夜のドライブ', 'glitch fx'] }
    const result = generateVariants(input)
    for (const variant of result.variants) {
      expect(variant.englishPrompt).toContain('夜のドライブ')
      expect(variant.englishPrompt).toContain('glitch fx')
      expect(variant.japanesePrompt).toContain('夜のドライブ')
      expect(variant.japanesePrompt).toContain('glitch fx')
    }
  })

  it('remains byte-identical to the pre-themeKeywords output when the field is absent or empty (backward compat)', () => {
    const withoutField = generateVariant({ genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] }, 'standard')
    const withEmpty = generateVariant(
      { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [], themeKeywords: [] },
      'standard',
    )
    const expected = 'Create a Pop track.\n\nAfter outputting everything, summarize it in 1000 characters.'
    expect(withoutField.englishPrompt).toBe(expected)
    expect(withEmpty.englishPrompt).toBe(expected)
  })
})
