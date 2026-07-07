import type { HistoryEntry } from '../../types/persistence'
import type { OptionScore, RankingCategory, TemplateOverride } from '../../types/learning'
import { effectiveRating } from './effectiveRating'

interface Accumulator {
  sum: number
  count: number
}

function accumulate(map: Map<string, Accumulator>, key: string | undefined, rating: number): void {
  if (!key) return
  const existing = map.get(key) ?? { sum: 0, count: 0 }
  existing.sum += rating
  existing.count += 1
  map.set(key, existing)
}

function ratedEntries(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.filter((e) => {
    const rating = effectiveRating(e)
    return typeof rating === 'number' && rating > 0
  })
}

/** 履歴の評価データから、カテゴリごと・キーごとの平均評価とサンプル数を集計する */
export function computeScoresByCategory(entries: HistoryEntry[]): Record<RankingCategory, Map<string, OptionScore>> {
  const raw: Record<RankingCategory, Map<string, Accumulator>> = {
    genreKey: new Map(),
    moodKey: new Map(),
    vocalTypeKey: new Map(),
    songStructureKey: new Map(),
    atmosphereKeys: new Map(),
    instrumentKeys: new Map(),
    variantStyle: new Map(),
  }

  for (const entry of ratedEntries(entries)) {
    const rating = effectiveRating(entry) as number
    accumulate(raw.genreKey, entry.input.genreKey, rating)
    accumulate(raw.moodKey, entry.input.moodKey, rating)
    accumulate(raw.vocalTypeKey, entry.input.vocalTypeKey, rating)
    accumulate(raw.songStructureKey, entry.input.songStructureKey, rating)
    for (const atmosphereKey of entry.input.atmosphereKeys) {
      accumulate(raw.atmosphereKeys, atmosphereKey, rating)
    }
    if (entry.kind === 'composition') {
      for (const instrumentKey of entry.input.instrumentKeys) {
        accumulate(raw.instrumentKeys, instrumentKey, rating)
      }
    }
    const selected = entry.variants.find((v) => v.variantId === entry.selectedVariantId)
    if (selected) accumulate(raw.variantStyle, selected.styleId, rating)
  }

  const result = {} as Record<RankingCategory, Map<string, OptionScore>>
  for (const category of Object.keys(raw) as RankingCategory[]) {
    const scored = new Map<string, OptionScore>()
    for (const [key, { sum, count }] of raw[category]) {
      scored.set(key, { sampleCount: count, averageRating: sum / count })
    }
    result[category] = scored
  }
  return result
}

/**
 * 暗黙スコア（平均評価 × log2(1+件数)、外れ値1件が上位を独占しないようにする）に
 * 承認済みオーバーライドのブーストを加えて並び替える。スコアが同点の場合は元の順序を保つ。
 */
export function rankByScore<T extends { key: string }>(
  options: T[],
  scores: Map<string, OptionScore>,
  overrides: TemplateOverride[] = [],
  category?: RankingCategory,
): T[] {
  const overrideBoost = new Map(
    overrides.filter((o) => !category || o.category === category).map((o) => [o.key, o.boost]),
  )

  return options
    .map((option, index) => {
      const score = scores.get(option.key)
      const implicitScore = score ? score.averageRating * Math.log2(1 + score.sampleCount) : 0
      const boost = overrideBoost.get(option.key) ?? 0
      return { option, index, total: implicitScore + boost }
    })
    .sort((a, b) => (b.total !== a.total ? b.total - a.total : a.index - b.index))
    .map((entry) => entry.option)
}
