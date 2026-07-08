import { describe, expect, it } from 'vitest'
import {
  generateClaudeCompositionPromptVariant,
  generateClaudeCompositionPromptVariants,
  validateClaudeCompositionInput,
} from './claudeCompositionPromptGenerator'
import type { ClaudeCompositionInput } from '../types/claudeComposition'

const BASE_INPUT: ClaudeCompositionInput = {
  genreKey: 'city_pop',
  moodKey: undefined,
  tempo: undefined,
  vocalTypeKey: undefined,
  instrumentKeys: [],
  songStructureKey: undefined,
  atmosphereKeys: [],
  themeKeywords: ['夏', '花火'],
}

describe('validateClaudeCompositionInput', () => {
  it('rejects a missing genre', () => {
    const result = validateClaudeCompositionInput({ ...BASE_INPUT, genreKey: '' })
    expect(result.valid).toBe(false)
  })

  it('rejects an unknown genre key', () => {
    const result = validateClaudeCompositionInput({ ...BASE_INPUT, genreKey: 'not-a-genre' })
    expect(result.valid).toBe(false)
  })

  it('rejects a non-positive tempo', () => {
    const result = validateClaudeCompositionInput({ ...BASE_INPUT, tempo: 0 })
    expect(result.valid).toBe(false)
  })

  it('accepts a valid input', () => {
    expect(validateClaudeCompositionInput(BASE_INPUT)).toEqual({ valid: true, errors: [] })
  })
})

describe('generateClaudeCompositionPromptVariants', () => {
  it('throws for invalid input', () => {
    expect(() => generateClaudeCompositionPromptVariants({ ...BASE_INPUT, genreKey: '' })).toThrow()
  })

  it('produces the standard/poetic/minimal variants, each as a single prompt text', () => {
    const result = generateClaudeCompositionPromptVariants(BASE_INPUT)
    expect(result.variants.map((v) => v.styleId)).toEqual(['standard', 'poetic', 'minimal'])
    for (const variant of result.variants) {
      expect(variant.promptText.length).toBeGreaterThan(0)
    }
  })

  it('embeds the genre, tempo, and theme keywords in the standard variant', () => {
    const standard = generateClaudeCompositionPromptVariant(
      { ...BASE_INPUT, tempo: 128 },
      'standard',
    )
    expect(standard.promptText).toContain('シティポップ')
    expect(standard.promptText).toContain('BPM 128')
    expect(standard.promptText).toContain('夏、花火')
  })

  it('every style instructs Claude to output only the final Suno-ready prompt (no Japanese explanation)', () => {
    const result = generateClaudeCompositionPromptVariants(BASE_INPUT)
    for (const variant of result.variants) {
      expect(variant.promptText).toMatch(/Suno/)
      expect(variant.promptText).toMatch(/前置きや解説/)
    }
  })

  it('describes no-vocal input as instrumental rather than omitting vocal guidance entirely', () => {
    const result = generateClaudeCompositionPromptVariants({ ...BASE_INPUT, vocalTypeKey: 'no_vocal' })
    const standard = result.variants.find((v) => v.styleId === 'standard')
    expect(standard?.promptText).toMatch(/ボーカルなし|インストゥルメンタル/)
  })
})
