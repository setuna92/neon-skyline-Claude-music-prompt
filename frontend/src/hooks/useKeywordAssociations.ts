import { useEffect, useState } from 'react'
import type { KeywordAssociation } from '../types/learning'
import { getKeywordAssociations, onDataChange } from '../lib/db'

/** Auto-Loopが学習した「特定のムード/雰囲気との組み合わせ」の連想語一覧 */
export function useKeywordAssociations(): KeywordAssociation[] {
  const [associations, setAssociations] = useState<KeywordAssociation[]>([])

  useEffect(() => {
    function load() {
      getKeywordAssociations()
        .then(setAssociations)
        .catch(() => setAssociations([]))
    }
    load()
    return onDataChange(load)
  }, [])

  return associations
}
