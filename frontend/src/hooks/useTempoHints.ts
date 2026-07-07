import { useEffect, useState } from 'react'
import type { TempoHint } from '../types/learning'
import { getTempoHints, onDataChange } from '../lib/db'

/** Auto-Loopが作曲履歴から学習した「ジャンル別のおすすめテンポ(BPM)」一覧 */
export function useTempoHints(): TempoHint[] {
  const [hints, setHints] = useState<TempoHint[]>([])

  useEffect(() => {
    function load() {
      getTempoHints()
        .then(setHints)
        .catch(() => setHints([]))
    }
    load()
    return onDataChange(load)
  }, [])

  return hints
}
