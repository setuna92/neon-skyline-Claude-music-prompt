import { useEffect, useState } from 'react'
import type { OptionEntry } from '../types/templates'
import type { OptionScore, RankingCategory, TemplateOverride } from '../types/learning'
import { getAllHistory, getTemplateOverrides, onDataChange } from '../lib/db'
import { computeScoresByCategory, rankByScore } from '../lib/learning/ranking'

/** 履歴の評価データに基づき、選択肢を高評価順に並び替える（自己学習ループ・短期のルールベースリランキング） */
export function useOptionRanking() {
  const [scores, setScores] = useState<Record<RankingCategory, Map<string, OptionScore>> | null>(null)
  const [overrides, setOverrides] = useState<TemplateOverride[]>([])

  useEffect(() => {
    function load() {
      Promise.all([getAllHistory(), getTemplateOverrides()])
        .then(([entries, loadedOverrides]) => {
          setScores(computeScoresByCategory(entries))
          setOverrides(loadedOverrides)
        })
        .catch(() => {
          setScores(computeScoresByCategory([]))
        })
    }
    load()
    // 評価・タグ付けやAuto-Loopの適用があった際、タブを切り替えなくても反映されるように購読する
    return onDataChange(load)
  }, [])

  function rank(category: RankingCategory, options: OptionEntry[]): OptionEntry[] {
    if (!scores) return options
    return rankByScore(options, scores[category], overrides, category)
  }

  function scoreFor(category: RankingCategory, key: string): OptionScore | undefined {
    return scores?.[category].get(key)
  }

  return { rank, scoreFor, ready: scores !== null }
}
