import { describe, expect, it } from 'vitest'
import { getKeywordBankForGenre, hasKeywordBank } from './genreKeywordBank'

describe('getKeywordBankForGenre', () => {
  it('returns a full keyword bank for a genre that has one (the new EDM/rock fusion genres)', () => {
    const bank = getKeywordBankForGenre('emo_electronic_rock_x_drumnbass')
    expect(bank).not.toBeNull()
    expect(bank?.general.length).toBeGreaterThanOrEqual(20)
    expect(bank?.chorus_hooks.length).toBeGreaterThan(0)
  })

  it('returns null for a genre without a keyword bank (an original genre like pop)', () => {
    expect(getKeywordBankForGenre('pop')).toBeNull()
  })

  it('returns null for an unknown genre key', () => {
    expect(getKeywordBankForGenre('not-a-real-genre-key')).toBeNull()
  })
})

describe('hasKeywordBank', () => {
  it('mirrors getKeywordBankForGenre as a boolean', () => {
    expect(hasKeywordBank('emo_electronic_rock_x_drumnbass')).toBe(true)
    expect(hasKeywordBank('pop')).toBe(false)
  })
})
