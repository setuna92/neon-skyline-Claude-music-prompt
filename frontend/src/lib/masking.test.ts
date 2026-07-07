import { describe, expect, it } from 'vitest'
import { maskPII, maskPIIDeep } from './masking'

describe('maskPII', () => {
  it('masks email addresses', () => {
    const result = maskPII('連絡先は test.user@example.co.jp です')
    expect(result.masked).toBe(true)
    expect(result.text).toBe('連絡先は [MASKED_EMAIL] です')
  })

  it('masks Japanese phone numbers', () => {
    const result = maskPII('電話は 090-1234-5678 です')
    expect(result.masked).toBe(true)
    expect(result.text).toBe('電話は [MASKED_PHONE] です')
  })

  it('masks credit-card-like digit runs', () => {
    const result = maskPII('カード番号 4111 1111 1111 1111 を入力')
    expect(result.masked).toBe(true)
    expect(result.text).toBe('カード番号 [MASKED_CARD] を入力')
  })

  it('leaves ordinary text untouched', () => {
    const result = maskPII('普通のタグ名')
    expect(result.masked).toBe(false)
    expect(result.text).toBe('普通のタグ名')
  })
})

describe('maskPIIDeep', () => {
  it('masks strings inside arrays', () => {
    const result = maskPIIDeep(['良かった', 'test@example.com'])
    expect(result).toEqual(['良かった', '[MASKED_EMAIL]'])
  })

  it('masks strings inside nested objects', () => {
    const result = maskPIIDeep({
      name: 'メモ',
      tags: ['090-1234-5678'],
      nested: { note: 'foo@bar.com' },
    })
    expect(result).toEqual({
      name: 'メモ',
      tags: ['[MASKED_PHONE]'],
      nested: { note: '[MASKED_EMAIL]' },
    })
  })

  it('passes through non-string primitives unchanged', () => {
    expect(maskPIIDeep(42)).toBe(42)
    expect(maskPIIDeep(true)).toBe(true)
    expect(maskPIIDeep(null)).toBe(null)
  })
})
