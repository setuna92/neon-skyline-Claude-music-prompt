import templatesData from '../data/templates.json'
import genreKeywordsData from '../data/genreKeywords.json'
import type { PromptTemplates } from '../types/templates'
import type { GenreKeywordCategories, GenreKeywordData } from '../types/genreKeywordBank'

const templates = templatesData as PromptTemplates
const genreKeywords = genreKeywordsData as GenreKeywordData

// genreKeywords.json は「ジャンルラベル文字列」をキーに持つため、templates.json側の
// genreKey(slug) -> ラベル を経由してキーワードバンクを引けるようにする。
const labelToBank = new Map(genreKeywords.genres.map((entry) => [entry.genre, entry.keywords]))
const keyToLabel = new Map(templates.genres.map((g) => [g.key, g.label]))

/** 指定したジャンルキーに対応するキーワードバンクを返す。バンクが存在しないジャンル(既存54種等)は null。 */
export function getKeywordBankForGenre(genreKey: string): GenreKeywordCategories | null {
  const label = keyToLabel.get(genreKey)
  if (!label) return null
  return labelToBank.get(label) ?? null
}

export function hasKeywordBank(genreKey: string): boolean {
  return getKeywordBankForGenre(genreKey) !== null
}
