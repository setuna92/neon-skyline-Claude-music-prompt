import { useEffect, useState } from 'react'
import { getDiscoveredKeywords, onDataChange } from '../lib/db'

/** Auto-Loopが自動発見した語彙の一覧（単語のみ）を読み込む */
export function useDiscoveredKeywords(): string[] {
  const [words, setWords] = useState<string[]>([])

  useEffect(() => {
    function load() {
      getDiscoveredKeywords()
        .then((keywords) => setWords(keywords.map((k) => k.word)))
        .catch(() => setWords([]))
    }
    load()
    return onDataChange(load)
  }, [])

  return words
}
