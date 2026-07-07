import type { KeywordScore, KeywordSuggestionGroup } from '../lib/keywordSuggestionEngine'

interface KeywordSuggestionPickerProps {
  groups: KeywordSuggestionGroup[]
  selected: string[]
  onToggle: (keyword: string) => void
  /** 履歴評価スコア。平均★4以上のキーワードに⭐を付ける（他のランキングUIと同じ規約）。 */
  scores?: Map<string, KeywordScore>
}

/**
 * ジャンル・ムード・雰囲気の選択に応じたキーワード候補をグループ別に表示し、
 * クリックでテーマキーワードへの追加/削除をトグルできるチップ群。
 * 評価履歴で高評価だった語は⭐付き・上位表示され、使い込むほど提案が進化する。
 */
export function KeywordSuggestionPicker({ groups, selected, onToggle, scores }: KeywordSuggestionPickerProps) {
  if (groups.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-secondary">
        選択内容に応じたキーワード候補です。クリックでテーマ・キーワードに追加/削除できます。
      </p>
      {groups.map((group) => (
        <div key={group.id}>
          <p className="text-[10px] text-neon-purple mb-1">{group.label}</p>
          <div className="flex flex-wrap gap-1">
            {group.words.map((word) => {
              const isSelected = selected.includes(word)
              const score = scores?.get(word)
              const starred = score !== undefined && score.averageRating >= 4
              return (
                <button
                  key={word}
                  type="button"
                  onClick={() => onToggle(word)}
                  className={`text-[11px] px-2 py-0.5 ${isSelected ? 'chip-neon-selected' : 'chip-neon'}`}
                >
                  {starred ? `⭐ ${word}` : word}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
