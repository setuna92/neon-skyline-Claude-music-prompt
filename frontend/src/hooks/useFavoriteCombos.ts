import { useEffect, useState } from 'react'
import type { FavoriteCombo } from '../lib/comboLearning'
import { computeFavoriteCompositionCombos, computeFavoriteLyricsCombos } from '../lib/comboLearning'
import type { GenerationInput } from '../types/generation'
import type { LyricsPromptInput } from '../types/lyricsPrompt'
import { getAllHistory, onDataChange } from '../lib/db'

/**
 * 評価4以上だった「作曲プロンプトの組み合わせ」一覧(ワンタップ全項目適用用)。
 * 「作曲」タブと「Claude作曲」タブは選択項目が同じ(GenerationInput)なので、両方の履歴を合算する。
 */
export function useFavoriteCompositionCombos(): FavoriteCombo<GenerationInput>[] {
  const [combos, setCombos] = useState<FavoriteCombo<GenerationInput>[]>([])

  useEffect(() => {
    function load() {
      getAllHistory()
        .then((entries) => {
          const compositionEntries = entries.filter((e) => e.kind === 'composition' || e.kind === 'claudeComposition')
          setCombos(computeFavoriteCompositionCombos(compositionEntries))
        })
        .catch(() => setCombos([]))
    }
    load()
    return onDataChange(load)
  }, [])

  return combos
}

/** 評価4以上だった「歌詞プロンプトの組み合わせ」一覧(ワンタップ全項目適用用) */
export function useFavoriteLyricsCombos(): FavoriteCombo<LyricsPromptInput>[] {
  const [combos, setCombos] = useState<FavoriteCombo<LyricsPromptInput>[]>([])

  useEffect(() => {
    function load() {
      getAllHistory()
        .then((entries) => {
          const lyricsEntries = entries.filter((e) => e.kind === 'lyricsPrompt')
          setCombos(computeFavoriteLyricsCombos(lyricsEntries))
        })
        .catch(() => setCombos([]))
    }
    load()
    return onDataChange(load)
  }, [])

  return combos
}
