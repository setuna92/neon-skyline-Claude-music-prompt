import { describe, expect, it } from 'vitest'
import { generateSuggestions } from './suggestions'
import type { OptionScore, RankingCategory, TemplateOverride } from '../../types/learning'

function emptyScores(): Record<RankingCategory, Map<string, OptionScore>> {
  return {
    genreKey: new Map(),
    moodKey: new Map(),
    vocalTypeKey: new Map(),
    songStructureKey: new Map(),
    atmosphereKeys: new Map(),
    instrumentKeys: new Map(),
    variantStyle: new Map(),
  }
}

describe('generateSuggestions', () => {
  it('suggests a key that meets the sample-count and rating thresholds', () => {
    const scores = emptyScores()
    scores.genreKey.set('jrock', { sampleCount: 3, averageRating: 4.5 })

    const suggestions = generateSuggestions(scores, [])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({ category: 'genreKey', key: 'jrock', label: 'J-ロック', sampleCount: 3, averageRating: 4.5 })
    expect(suggestions[0].reason).toContain('3件')
    expect(suggestions[0].reason).toContain('4.5')
  })

  it('excludes entries below the minimum sample count', () => {
    const scores = emptyScores()
    scores.genreKey.set('jrock', { sampleCount: 2, averageRating: 5 })
    expect(generateSuggestions(scores, [])).toEqual([])
  })

  it('excludes entries below the minimum average rating', () => {
    const scores = emptyScores()
    scores.genreKey.set('jrock', { sampleCount: 5, averageRating: 3.9 })
    expect(generateSuggestions(scores, [])).toEqual([])
  })

  it('excludes keys that already have an approved override', () => {
    const scores = emptyScores()
    scores.genreKey.set('jrock', { sampleCount: 5, averageRating: 5 })
    const overrides: TemplateOverride[] = [
      { id: '1', category: 'genreKey', key: 'jrock', boost: 15, reason: 'approved', createdAt: '' },
    ]
    expect(generateSuggestions(scores, overrides)).toEqual([])
  })

  it('resolves labels for every ranking category', () => {
    const scores = emptyScores()
    scores.moodKey.set('late_night_drive', { sampleCount: 3, averageRating: 4 })
    scores.atmosphereKeys.set('dark', { sampleCount: 3, averageRating: 4 })
    scores.instrumentKeys.set('guitar', { sampleCount: 3, averageRating: 4 })
    scores.variantStyle.set('standard', { sampleCount: 3, averageRating: 4 })

    const suggestions = generateSuggestions(scores, [])
    const labelsByCategory = Object.fromEntries(suggestions.map((s) => [s.category, s.label]))
    expect(labelsByCategory.moodKey).toBe('深夜ドライブ')
    expect(labelsByCategory.atmosphereKeys).toBe('ダーク')
    expect(labelsByCategory.instrumentKeys).not.toBe('guitar') // 何らかの日本語ラベルに解決されている
    expect(labelsByCategory.variantStyle).toBe('標準')
  })

  it('falls back to the raw key when it is not found in templates', () => {
    const scores = emptyScores()
    scores.genreKey.set('does-not-exist', { sampleCount: 3, averageRating: 4 })
    const suggestions = generateSuggestions(scores, [])
    expect(suggestions[0].label).toBe('does-not-exist')
  })

  it('sorts suggestions by averageRating descending', () => {
    const scores = emptyScores()
    scores.genreKey.set('pop', { sampleCount: 3, averageRating: 4.2 })
    scores.genreKey.set('jrock', { sampleCount: 3, averageRating: 4.9 })
    const suggestions = generateSuggestions(scores, [])
    expect(suggestions.map((s) => s.key)).toEqual(['jrock', 'pop'])
  })
})
