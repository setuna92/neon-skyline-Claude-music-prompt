import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const DB_NAME = 'music-prompt-app'
const LEGACY_STORAGE_KEY = 'music_prompt_presets'
let activeDbModule: typeof import('./db') | null = null

// vitestのnode環境にはlocalStorageが無いため、テスト用の最小限のin-memory実装を用意する
function installFakeLocalStorage(): void {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  } as Storage
}

async function freshDb() {
  if (activeDbModule) await activeDbModule.closeDB()
  await deleteDB(DB_NAME).catch(() => {})
  installFakeLocalStorage()
  activeDbModule = await import('./db')
  return activeDbModule
}

beforeEach(() => {
  installFakeLocalStorage()
})

afterEach(async () => {
  if (activeDbModule) {
    await activeDbModule.closeDB()
    activeDbModule = null
  }
})

describe('migrateLegacyPresetsFromLocalStorage', () => {
  it('returns 0 and does nothing when there is no legacy data', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')
    const { migrateLegacyPresetsFromLocalStorage } = await import('./migrateLegacyPresets')

    expect(await migrateLegacyPresetsFromLocalStorage()).toBe(0)
    expect(await db.getAllPresets()).toEqual([])
  })

  it('migrates a legacy preset into IndexedDB and clears localStorage', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')
    const { migrateLegacyPresetsFromLocalStorage } = await import('./migrateLegacyPresets')

    localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify([
        {
          id: 1,
          name: '夏のプリセット',
          settings: {
            genres: ['jrock'],
            mood: 'late_night_drive',
            tempo: '128',
            vocal_type: 'female',
            instrument_elements: ['guitar', 'drums'],
            song_structure: 'verse_chorus',
            atmospheres: ['dark'],
          },
          created_at: '2025-01-01T00:00:00.000Z',
        },
      ]),
    )

    const migrated = await migrateLegacyPresetsFromLocalStorage()
    expect(migrated).toBe(1)

    const presets = await db.getAllPresets()
    expect(presets).toHaveLength(1)
    expect(presets[0].name).toBe('夏のプリセット')
    expect(presets[0].input).toEqual({
      genreKey: 'jrock',
      moodKey: 'late_night_drive',
      tempo: 128,
      vocalTypeKey: 'female',
      instrumentKeys: ['guitar', 'drums'],
      songStructureKey: 'verse_chorus',
      atmosphereKeys: ['dark'],
    })

    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull()
  })

  it('skips legacy presets with no genre and uses a fallback name when missing', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')
    const { migrateLegacyPresetsFromLocalStorage } = await import('./migrateLegacyPresets')

    localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify([
        { id: 1, name: '', settings: { genres: [] }, created_at: '' },
        { id: 2, name: '', settings: { genres: ['pop'] }, created_at: '' },
      ]),
    )

    const migrated = await migrateLegacyPresetsFromLocalStorage()
    expect(migrated).toBe(1)

    const presets = await db.getAllPresets()
    expect(presets).toHaveLength(1)
    expect(presets[0].name).toBe('無題のプリセット')
  })

  it('returns 0 when the stored value is not valid JSON or not an array', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')
    const { migrateLegacyPresetsFromLocalStorage } = await import('./migrateLegacyPresets')

    localStorage.setItem(LEGACY_STORAGE_KEY, '{not valid json')
    expect(await migrateLegacyPresetsFromLocalStorage()).toBe(0)

    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ not: 'an array' }))
    expect(await migrateLegacyPresetsFromLocalStorage()).toBe(0)
  })
})
