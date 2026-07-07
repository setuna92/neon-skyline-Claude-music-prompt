interface StarRatingProps {
  value: number
  onChange?: (value: number) => void
  size?: 'sm' | 'md'
}

export function StarRating({ value, onChange, size = 'md' }: StarRatingProps) {
  const textSize = size === 'sm' ? 'text-sm' : 'text-lg'

  // 読み取り専用表示 (onChange なし) はプレーンな span にする。HistoryPanel では行全体が
  // <button> なので、その中に <button> をネストすると無効なHTMLになってしまうため。
  if (!onChange) {
    return (
      <div className={`flex gap-0.5 ${textSize}`} role="img" aria-label={`評価 ${value} / 5`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <span key={star} className={star <= value ? 'text-neon-blue' : 'text-text-muted'}>
            ★
          </span>
        ))}
      </div>
    )
  }

  return (
    <div className={`flex gap-0.5 ${textSize}`} role="radiogroup" aria-label="評価">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          onClick={() => onChange(star === value ? 0 : star)}
          className={star <= value ? 'text-neon-blue' : 'text-text-muted'}
        >
          ★
        </button>
      ))}
    </div>
  )
}
