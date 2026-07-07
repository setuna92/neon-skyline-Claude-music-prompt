const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const JP_PHONE_RE = /0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}/g
const CREDIT_CARD_RE = /\b(?:\d[ -]*?){13,16}\b/g

export interface MaskResult {
  text: string
  masked: boolean
}

/** メール・電話番号・クレジットカード番号らしき文字列を保存前に自動マスキングする */
export function maskPII(input: string): MaskResult {
  let masked = false
  let text = input
    .replace(EMAIL_RE, () => {
      masked = true
      return '[MASKED_EMAIL]'
    })
    .replace(CREDIT_CARD_RE, () => {
      masked = true
      return '[MASKED_CARD]'
    })
    .replace(JP_PHONE_RE, () => {
      masked = true
      return '[MASKED_PHONE]'
    })
  return { text, masked }
}

/** 文字列・配列・プレーンオブジェクトを再帰的に走査し、文字列フィールドをすべてマスキングする */
export function maskPIIDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return maskPII(value).text as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskPIIDeep(item)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = maskPIIDeep(v)
    }
    return result as T
  }
  return value
}
