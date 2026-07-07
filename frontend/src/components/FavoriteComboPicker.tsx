import { useState } from 'react'
import type { FavoriteCombo } from '../lib/comboLearning'

const MAX_VISIBLE = 20

interface FavoriteComboPickerProps<T> {
  combos: FavoriteCombo<T>[]
  describe: (input: T) => string
  onApply: (input: T) => void
}

export function FavoriteComboPicker<T>({ combos, describe, onApply }: FavoriteComboPickerProps<T>) {
  const [open, setOpen] = useState(false)

  if (combos.length === 0) return null

  return (
    <div className="glass-panel glass-panel-hover p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-sm text-neon-cyan"
      >
        <span>⭐ 高評価の組み合わせから選ぶ ({combos.length})</span>
        <span className="text-xs">{open ? '▲ 閉じる' : '▼ 開く'}</span>
      </button>
      <p className="text-[11px] text-text-muted mt-1">
        選ぶとジャンル・ムード・ボーカル・曲構成・楽器・雰囲気・テーマキーワードなどが一括で反映されます。
      </p>
      {open && (
        <div className="mt-2 space-y-1 max-h-72 overflow-y-auto pr-1">
          {combos.slice(0, MAX_VISIBLE).map((combo) => (
            <button
              key={combo.id}
              type="button"
              onClick={() => {
                onApply(combo.input)
                // 適用後は一覧を閉じて、下のフォームに反映された内容がすぐ見えるようにする
                setOpen(false)
              }}
              className="w-full text-left text-xs bg-dark-lighter border border-border-neon rounded-lg px-3 py-2 hover:border-neon-blue transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-text-primary">{describe(combo.input)}</span>
                <span className="text-neon-green shrink-0 whitespace-nowrap">
                  ★{combo.averageRating.toFixed(1)}（{combo.sampleCount}件）
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
