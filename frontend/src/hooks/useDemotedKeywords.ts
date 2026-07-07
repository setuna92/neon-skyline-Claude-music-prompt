import { useEffect, useState } from 'react'
import { getDemotedKeywords, onDataChange } from '../lib/db'

/** Auto-Loopが低評価の実績から提案対象外に降格させた語彙(単語のみ) */
export function useDemotedKeywords(): string[] {
  const [words, setWords] = useState<string[]>([])

  useEffect(() => {
    function load() {
      getDemotedKeywords()
        .then((keywords) => setWords(keywords.map((k) => k.word)))
        .catch(() => setWords([]))
    }
    load()
    return onDataChange(load)
  }, [])

  return words
}
