import templatesData from '../../data/templates.json'
import type { PromptTemplates } from '../../types/templates'
import type { OptionScore, RankingCategory, TemplateOverride, TemplateSuggestion } from '../../types/learning'

const templates = templatesData as PromptTemplates

const MIN_SAMPLES = 3
const MIN_AVERAGE_RATING = 4

function labelFor(category: RankingCategory, key: string): string {
  switch (category) {
    case 'genreKey':
      return templates.genres.find((g) => g.key === key)?.label ?? key
    case 'moodKey':
      return templates.moods.find((m) => m.key === key)?.label ?? key
    case 'vocalTypeKey':
      return templates.vocalTypes.find((v) => v.key === key)?.label ?? key
    case 'songStructureKey':
      return templates.songStructures.find((s) => s.key === key)?.label ?? key
    case 'atmosphereKeys':
      return templates.atmospheres.find((a) => a.key === key)?.label ?? key
    case 'instrumentKeys':
      return templates.instrumentElements.find((i) => i.key === key)?.label ?? key
    case 'variantStyle':
      return templates.variantStyles.find((s) => s.id === key)?.label ?? key
    default:
      return key
  }
}

/**
 * 履歴の評価データから「一覧の上位に固定表示してよいか」の提案を生成する。
 * 十分なサンプル数と高評価がある組み合わせのみを対象にし、既に承認済み（オーバーライド済み）のものは除外する。
 */
export function generateSuggestions(
  scores: Record<RankingCategory, Map<string, OptionScore>>,
  existingOverrides: TemplateOverride[],
): TemplateSuggestion[] {
  const overriddenKeys = new Set(existingOverrides.map((o) => `${o.category}:${o.key}`))
  const suggestions: TemplateSuggestion[] = []

  for (const category of Object.keys(scores) as RankingCategory[]) {
    for (const [key, score] of scores[category]) {
      if (score.sampleCount < MIN_SAMPLES) continue
      if (score.averageRating < MIN_AVERAGE_RATING) continue
      if (overriddenKeys.has(`${category}:${key}`)) continue

      suggestions.push({
        category,
        key,
        label: labelFor(category, key),
        averageRating: score.averageRating,
        sampleCount: score.sampleCount,
        reason: `${score.sampleCount}件の履歴で平均★${score.averageRating.toFixed(1)}のため、一覧の上位に固定表示することを提案します。`,
      })
    }
  }

  return suggestions.sort((a, b) => b.averageRating - a.averageRating)
}
