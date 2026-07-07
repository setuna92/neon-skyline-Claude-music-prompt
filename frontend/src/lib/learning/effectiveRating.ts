import type { HistoryEntry } from '../../types/persistence'

/**
 * 自己学習のスコアリングに使う「実質的な評価」を返す。
 * 歌詞プロンプトについては、可能なら「実際に得られた歌詞そのもの」への評価
 * (lyricsQualityRating)を優先する。プロンプトの見た目の評価だけでなく、
 * 最終成果物の質に基づいて学習させるため。未設定なら従来通りプロンプト自体の
 * 評価(rating)にフォールバックする(後方互換)。
 */
export function effectiveRating(entry: HistoryEntry): number | undefined {
  if (entry.kind === 'lyricsPrompt' && typeof entry.lyricsQualityRating === 'number') {
    return entry.lyricsQualityRating
  }
  return entry.rating
}
