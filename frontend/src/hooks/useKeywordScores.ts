import { useEffect, useState } from 'react'
import type { KeywordScore } from '../lib/keywordSuggestionEngine'
import { scoreKeywordsFromHistory } from '../lib/keywordSuggestionEngine'
import { getAllHistory, onDataChange } from '../lib/db'

/**
 * 履歴の評価データから「実際に使われて高評価だったキーワード」のスコアを読み込む。
 * キーワード提案の並び順・⭐表示に使う（提案の自己進化）。
 */
export function useKeywordScores(): Map<string, KeywordScore> {
  const [scores, setScores] = useState<Map<string, KeywordScore>>(new Map())

  useEffect(() => {
    function load() {
      getAllHistory()
        .then((entries) => setScores(scoreKeywordsFromHistory(entries)))
        .catch(() => setScores(new Map()))
    }
    load()
    return onDataChange(load)
  }, [])

  return scores
}
