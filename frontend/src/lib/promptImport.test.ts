import { describe, expect, it } from 'vitest'
import {
  parseImportedPromptsFromCSV,
  parseImportedPromptsFromFile,
  parseImportedPromptsFromJSON,
} from './promptImport'

describe('parseImportedPromptsFromJSON', () => {
  it('parses an array of {title, text} objects', () => {
    const result = parseImportedPromptsFromJSON(
      JSON.stringify([{ title: '夏の恋', text: '夏の終わりの切ない恋' }]),
      'prefix',
    )
    expect(result).toEqual([{ title: '夏の恋', body: '夏の終わりの切ない恋', sourceFormat: 'json' }])
  })

  it('accepts alternate field names (name/body/content/prompt)', () => {
    const result = parseImportedPromptsFromJSON(JSON.stringify([{ name: 'A', body: 'B' }]), 'prefix')
    expect(result).toEqual([{ title: 'A', body: 'B', sourceFormat: 'json' }])
  })

  it('auto-titles bare strings in an array using the prefix and 1-based index', () => {
    const result = parseImportedPromptsFromJSON(JSON.stringify(['ただの文字列']), 'themes')
    expect(result).toEqual([{ title: 'themes #1', body: 'ただの文字列', sourceFormat: 'json' }])
  })

  it('wraps a single (non-array) object as one entry', () => {
    const result = parseImportedPromptsFromJSON(JSON.stringify({ title: 'X', text: 'Y' }), 'prefix')
    expect(result).toEqual([{ title: 'X', body: 'Y', sourceFormat: 'json' }])
  })

  it('falls back to JSON.stringify of the item when no known text field exists', () => {
    const result = parseImportedPromptsFromJSON(JSON.stringify([{ foo: 'bar' }]), 'prefix')
    expect(result[0].body).toBe(JSON.stringify({ foo: 'bar' }))
  })
})

describe('parseImportedPromptsFromCSV', () => {
  it('returns an empty array for empty input', () => {
    expect(parseImportedPromptsFromCSV('', 'prefix')).toEqual([])
    expect(parseImportedPromptsFromCSV('\n\n', 'prefix')).toEqual([])
  })

  it('maps title/text header columns to the right fields', () => {
    const csv = 'title,text\n夏の恋,夏の終わりの切ない恋\n冬の別れ,雪が降る夜の別れ'
    const result = parseImportedPromptsFromCSV(csv, 'prefix')
    expect(result).toEqual([
      { title: '夏の恋', body: '夏の終わりの切ない恋', sourceFormat: 'csv' },
      { title: '冬の別れ', body: '雪が降る夜の別れ', sourceFormat: 'csv' },
    ])
  })

  it('treats each line as one prompt body with an auto-generated title when there is no header', () => {
    const csv = '夏の終わりの切ない恋\n雪が降る夜の別れ'
    const result = parseImportedPromptsFromCSV(csv, 'themes')
    expect(result).toEqual([
      { title: 'themes #1', body: '夏の終わりの切ない恋', sourceFormat: 'csv' },
      { title: 'themes #2', body: '雪が降る夜の別れ', sourceFormat: 'csv' },
    ])
  })

  it('handles quoted fields containing commas', () => {
    const csv = 'title,text\n"夏, 花火","夏の夜, 花火が消える"'
    const result = parseImportedPromptsFromCSV(csv, 'prefix')
    expect(result).toEqual([{ title: '夏, 花火', body: '夏の夜, 花火が消える', sourceFormat: 'csv' }])
  })

  it('does not duplicate the title into the body when only a title column is recognized', () => {
    const csv = 'title\n夏の恋\n冬の別れ'
    const result = parseImportedPromptsFromCSV(csv, 'prefix')
    expect(result).toEqual([
      { title: '夏の恋', body: '', sourceFormat: 'csv' },
      { title: '冬の別れ', body: '', sourceFormat: 'csv' },
    ])
  })

  it('falls back to the first non-title column when only a title column is recognized but extra columns exist', () => {
    const csv = 'note,title\nメモA,夏の恋\nメモB,冬の別れ'
    const result = parseImportedPromptsFromCSV(csv, 'prefix')
    expect(result).toEqual([
      { title: '夏の恋', body: 'メモA', sourceFormat: 'csv' },
      { title: '冬の別れ', body: 'メモB', sourceFormat: 'csv' },
    ])
  })

  it('falls back to the auto-generated title when the title cell itself is blank', () => {
    const csv = 'title,text\n,本文のみ'
    const result = parseImportedPromptsFromCSV(csv, 'prefix')
    expect(result).toEqual([{ title: 'prefix #1', body: '本文のみ', sourceFormat: 'csv' }])
  })
})

describe('parseImportedPromptsFromFile', () => {
  it('routes .csv files to the CSV parser and strips the extension for the prefix', () => {
    const result = parseImportedPromptsFromFile('themes.csv', '夏の恋')
    expect(result).toEqual([{ title: 'themes #1', body: '夏の恋', sourceFormat: 'csv' }])
  })

  it('routes non-.csv files to the JSON parser', () => {
    const result = parseImportedPromptsFromFile('themes.json', JSON.stringify([{ title: 'A', text: 'B' }]))
    expect(result).toEqual([{ title: 'A', body: 'B', sourceFormat: 'json' }])
  })

  it('is case-insensitive about the .csv extension', () => {
    const result = parseImportedPromptsFromFile('THEMES.CSV', '夏の恋')
    expect(result[0].sourceFormat).toBe('csv')
  })
})
