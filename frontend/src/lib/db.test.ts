import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'

const DB_NAME = 'music-prompt-app'

// db.ts はモジュールスコープでDB接続とアクティブキーをキャッシュしているため、
// テストごとにモジュールを再読み込みしてまっさらな状態から始める。
// 前のテストが開いたままの接続を閉じてからでないと deleteDB がブロックされたままになる。
let activeDbModule: typeof import('./db') | null = null

async function freshDb() {
  if (activeDbModule) {
    await activeDbModule.closeDB()
  }
  await deleteDB(DB_NAME).catch(() => {})
  vi.resetModules()
  activeDbModule = await import('./db')
  return activeDbModule
}

afterEach(async () => {
  if (activeDbModule) {
    await activeDbModule.closeDB()
    activeDbModule = null
  }
})

describe('isInitialized / unlockWithPassphrase', () => {
  it('is false before first unlock and true after', async () => {
    const db = await freshDb()
    expect(await db.isInitialized()).toBe(false)
    await db.unlockWithPassphrase('test-passphrase')
    expect(await db.isInitialized()).toBe(true)
  })

  it('throws when accessing encrypted data before unlocking', async () => {
    const db = await freshDb()
    await expect(db.getAllHistory()).rejects.toThrow()
  })

  it('lock() clears the active key so subsequent access fails again', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')
    await db.getAllHistory()
    db.lock()
    await expect(db.getAllHistory()).rejects.toThrow()
  })

  it('rejects a wrong passphrase on subsequent unlocks instead of silently showing empty data', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('correct-passphrase')
    db.lock()

    await expect(db.unlockWithPassphrase('wrong-passphrase')).rejects.toThrow('パスフレーズが正しくありません')
    // 検証に失敗した場合はロックされたままであること
    await expect(db.getAllHistory()).rejects.toThrow()

    // 正しいパスフレーズなら通る
    await db.unlockWithPassphrase('correct-passphrase')
    expect(await db.getAllHistory()).toEqual([])
  })

  it('verifies against existing encrypted data for legacy DBs without a check record', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('correct-passphrase')
    await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] },
      variants: [],
      tags: [],
    })
    db.lock()

    // 旧バージョンのDBを模倣: 検証レコードを直接削除する
    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = rawDb.transaction('settings', 'readwrite')
      const delReq = tx.objectStore('settings').delete('passphraseCheck')
      delReq.onsuccess = () => resolve()
      delReq.onerror = () => reject(delReq.error)
    })
    rawDb.close()

    // 検証レコードが無くても、既存の履歴データで間違ったパスフレーズを検出できる
    await expect(db.unlockWithPassphrase('wrong-passphrase')).rejects.toThrow('パスフレーズが正しくありません')

    // 正しいパスフレーズなら通り、以後のために検証レコードが再作成される
    await db.unlockWithPassphrase('correct-passphrase')
    expect(await db.getAllHistory()).toHaveLength(1)
    db.lock()
    await expect(db.unlockWithPassphrase('wrong-passphrase')).rejects.toThrow('パスフレーズが正しくありません')
  })
})

describe('history CRUD', () => {
  it('round-trips an entry and encrypts it at rest', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const entry = await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'jrock', instrumentKeys: [], atmosphereKeys: [] },
      variants: [
        {
          variantId: 'v1',
          styleId: 'standard',
          styleLabel: '標準',
          englishPrompt: 'Create a J-Rock track.',
          japanesePrompt: 'J-Rockの要素を取り入れます。',
        },
      ],
      tags: ['連絡先は test@example.com です'],
    })

    expect(entry.tags).toEqual(['連絡先は [MASKED_EMAIL] です'])

    const all = await db.getAllHistory()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(entry.id)

    const rawRecords = await new Promise<unknown[]>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME)
      req.onsuccess = () => {
        const tx = req.result.transaction('history', 'readonly')
        const getAllReq = tx.objectStore('history').getAll()
        getAllReq.onsuccess = () => {
          resolve(getAllReq.result)
          req.result.close()
        }
        getAllReq.onerror = () => reject(getAllReq.error)
      }
      req.onerror = () => reject(req.error)
    })
    const raw = JSON.stringify(rawRecords)
    expect(raw).not.toContain('J-Rock track')
    expect(raw).not.toContain('test@example.com')
  })

  it('caches decrypted history across calls and invalidates it on writes', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] },
      variants: [],
      tags: [],
    })

    const crypto = await import('./crypto')
    const spy = vi.spyOn(crypto, 'decryptJSON')

    await db.getAllHistory()
    const callsAfterFirstRead = spy.mock.calls.length
    expect(callsAfterFirstRead).toBeGreaterThan(0)

    await db.getAllHistory()
    expect(spy.mock.calls.length).toBe(callsAfterFirstRead) // 2回目はキャッシュから返り、再復号しない

    await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'rock', instrumentKeys: [], atmosphereKeys: [] },
      variants: [],
      tags: [],
    })
    await db.getAllHistory()
    expect(spy.mock.calls.length).toBeGreaterThan(callsAfterFirstRead) // 書き込み後はキャッシュが無効化され再復号する

    spy.mockRestore()
  })

  it('updates rating, selection, and tags', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const entry = await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] },
      variants: [{ variantId: 'v1', styleId: 'standard', styleLabel: '標準', englishPrompt: 'x', japanesePrompt: 'x' }],
      tags: [],
    })

    const updated = await db.updateHistoryEntry(entry.id, { rating: 4, selectedVariantId: 'v1', tags: ['良かった'] })
    expect(updated.rating).toBe(4)
    expect(updated.selectedVariantId).toBe('v1')
    expect(updated.tags).toEqual(['良かった'])
  })

  it('deletes a single entry and clears all entries', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const a = await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] },
      variants: [],
      tags: [],
    })
    await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'rock', instrumentKeys: [], atmosphereKeys: [] },
      variants: [],
      tags: [],
    })

    await db.deleteHistoryEntry(a.id)
    expect(await db.getAllHistory()).toHaveLength(1)

    await db.clearHistory()
    expect(await db.getAllHistory()).toHaveLength(0)
  })

  it('skips undecryptable records instead of blanking out the whole history list', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] },
      variants: [],
      tags: [],
    })

    // 別の鍵(=別パスフレーズ時代)で書かれたレコードの混在を模倣して破損レコードを直接挿入
    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = rawDb.transaction('history', 'readwrite')
      const putReq = tx.objectStore('history').put({
        id: 'corrupted-entry',
        createdAt: new Date().toISOString(),
        payload: { iv: 'not-valid-base64!!', ciphertext: 'also-not-valid!!' },
      })
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    })
    rawDb.close()

    // 破損1件を含んでいても、読めるレコードは表示される
    const all = await db.getAllHistory()
    expect(all).toHaveLength(1)
    expect(all[0].input.genreKey).toBe('pop')
  })

  it('normalizes legacy records that predate the kind field to composition', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const entry = await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] },
      variants: [],
      tags: [],
    })

    // 旧バージョンのレコードを模倣するため kind を含まない状態で直接書き換える
    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const record = await new Promise<{ id: string; createdAt: string; payload: unknown }>((resolve, reject) => {
      const tx = rawDb.transaction('history', 'readonly')
      const getReq = tx.objectStore('history').get(entry.id)
      getReq.onsuccess = () => resolve(getReq.result)
      getReq.onerror = () => reject(getReq.error)
    })

    const crypto = await import('./crypto')
    const legacyShape = { ...entry } as Record<string, unknown>
    delete legacyShape.kind
    const key = (await import('./keyStore')).getActiveKey()
    const legacyPayload = await crypto.encryptJSON(key, legacyShape)
    await new Promise<void>((resolve, reject) => {
      const tx = rawDb.transaction('history', 'readwrite')
      const putReq = tx.objectStore('history').put({ id: record.id, createdAt: record.createdAt, payload: legacyPayload })
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    })
    rawDb.close()

    const all = await db.getAllHistory()
    expect(all[0].kind).toBe('composition')
  })
})

describe('updateLyricsQuality', () => {
  it('records the actual lyrics text (masking PII) and a separate quality rating', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const entry = await db.addHistoryEntry({
      kind: 'lyricsPrompt',
      input: { genreKey: 'city_pop', atmosphereKeys: [], themeKeywords: ['夏'], languageKey: 'ja' },
      variants: [{ variantId: 'v1', styleId: 'standard', styleLabel: '標準', promptText: 'x' }],
      tags: [],
    })

    const updated = await db.updateLyricsQuality(entry.id, {
      actualLyricsText: '連絡先は test@example.com です',
      lyricsQualityRating: 5,
    })
    expect(updated.actualLyricsText).toBe('連絡先は [MASKED_EMAIL] です')
    expect(updated.lyricsQualityRating).toBe(5)

    const all = await db.getAllHistory()
    const reloaded = all[0]
    expect(reloaded.kind).toBe('lyricsPrompt')
    if (reloaded.kind === 'lyricsPrompt') {
      expect(reloaded.actualLyricsText).toBe('連絡先は [MASKED_EMAIL] です')
      expect(reloaded.lyricsQualityRating).toBe(5)
    }
  })

  it('rejects updating lyrics quality on a composition entry', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const entry = await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] },
      variants: [],
      tags: [],
    })

    await expect(db.updateLyricsQuality(entry.id, { lyricsQualityRating: 5 })).rejects.toThrow(
      '歌詞プロンプトの履歴にのみ設定できます',
    )
  })
})

describe('presets', () => {
  it('adds, lists, and deletes presets, masking PII in the name', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const preset = await db.addPreset('連絡は test@example.com へ', {
      genreKey: 'jrock',
      instrumentKeys: ['guitar'],
      atmosphereKeys: [],
    })
    expect(preset.name).toBe('連絡は [MASKED_EMAIL] へ')

    expect(await db.getAllPresets()).toHaveLength(1)
    await db.deletePreset(preset.id)
    expect(await db.getAllPresets()).toHaveLength(0)
  })
})

describe('imported prompts (library)', () => {
  it('bulk-adds, lists, and deletes imported prompts', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const saved = await db.addImportedPrompts([
      { title: '夏の恋', body: '夏の終わりの切ない恋', sourceFormat: 'json' },
      { title: '冬の別れ', body: '雪が降る夜の別れ', sourceFormat: 'csv' },
    ])
    expect(saved).toHaveLength(2)

    const all = await db.getAllImportedPrompts()
    expect(all.map((p) => p.title).sort()).toEqual(['冬の別れ', '夏の恋'])

    await db.deleteImportedPrompt(saved[0].id)
    expect(await db.getAllImportedPrompts()).toHaveLength(1)
  })
})

describe('external send consent', () => {
  it('defaults to not granted and records a timestamp when granted', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    expect(await db.getExternalSendConsent()).toEqual({ granted: false })

    await db.setExternalSendConsent(true)
    const consent = await db.getExternalSendConsent()
    expect(consent.granted).toBe(true)
    expect(consent.grantedAt).toBeTruthy()

    await db.setExternalSendConsent(false)
    expect((await db.getExternalSendConsent()).granted).toBe(false)
  })
})

describe('Claude API key + model settings', () => {
  it('stores the API key encrypted and round-trips it', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    expect(await db.hasClaudeApiKey()).toBe(false)
    await db.setClaudeApiKey('sk-ant-secret-value')
    expect(await db.hasClaudeApiKey()).toBe(true)
    expect(await db.getClaudeApiKey()).toBe('sk-ant-secret-value')

    const rawRecords = await new Promise<unknown[]>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME)
      req.onsuccess = () => {
        const tx = req.result.transaction('settings', 'readonly')
        const getAllReq = tx.objectStore('settings').getAll()
        getAllReq.onsuccess = () => {
          resolve(getAllReq.result)
          req.result.close()
        }
        getAllReq.onerror = () => reject(getAllReq.error)
      }
      req.onerror = () => reject(req.error)
    })
    expect(JSON.stringify(rawRecords)).not.toContain('sk-ant-secret-value')

    await db.clearClaudeApiKey()
    expect(await db.hasClaudeApiKey()).toBe(false)
  })

  it('defaults the model and allows overriding it', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    expect(await db.getClaudeModel()).toBe(db.DEFAULT_CLAUDE_MODEL)
    await db.setClaudeModel('claude-custom-model')
    expect(await db.getClaudeModel()).toBe('claude-custom-model')
  })

  it('self-heals when the stored API key record is corrupted (fails to decrypt)', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    // 破損したレコードを直接書き込む（正規のciphertextではないバイト列）
    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = rawDb.transaction('settings', 'readwrite')
      const putReq = tx.objectStore('settings').put({
        key: 'claudeApiKey',
        value: { iv: 'not-valid-base64!!', ciphertext: 'also-not-valid!!' },
      })
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    })
    rawDb.close()

    expect(await db.hasClaudeApiKey()).toBe(true)
    await expect(db.getClaudeApiKey()).resolves.toBeNull()
    expect(await db.hasClaudeApiKey()).toBe(false)
  })
})

describe('onDataChange', () => {
  it('notifies subscribers when a history entry is added, updated, or deleted', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const listener = vi.fn()
    const unsubscribe = db.onDataChange(listener)

    const entry = await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] },
      variants: [],
      tags: [],
    })
    expect(listener).toHaveBeenCalledTimes(1)

    await db.updateHistoryEntry(entry.id, { rating: 5 })
    expect(listener).toHaveBeenCalledTimes(2)

    await db.deleteHistoryEntry(entry.id)
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe()
    await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] },
      variants: [],
      tags: [],
    })
    expect(listener).toHaveBeenCalledTimes(3) // 購読解除後は呼ばれない
  })

  it('notifies subscribers when learning data (template overrides, tempo hints, etc.) changes', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const listener = vi.fn()
    db.onDataChange(listener)

    const override = await db.addTemplateOverride({ category: 'genreKey', key: 'jrock', boost: 5, reason: 'r' })
    expect(listener).toHaveBeenCalledTimes(1)

    await db.removeTemplateOverride(override.id)
    expect(listener).toHaveBeenCalledTimes(2)

    const hint = await db.addTempoHint({ genreKey: 'jrock', tempo: 128, sampleCount: 3, averageRating: 4.5, reason: 'r' })
    expect(listener).toHaveBeenCalledTimes(3)

    await db.removeTempoHint(hint.id)
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('notifies subscribers on lock() and unlockWithPassphrase() too', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const listener = vi.fn()
    db.onDataChange(listener)

    db.lock()
    expect(listener).toHaveBeenCalledTimes(1)

    await db.unlockWithPassphrase('test-passphrase')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('smart loop auto-start setting', () => {
  it('defaults to false and can be toggled', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    expect(await db.getSmartLoopAutoStart()).toBe(false)

    await db.setSmartLoopAutoStart(true)
    expect(await db.getSmartLoopAutoStart()).toBe(true)

    await db.setSmartLoopAutoStart(false)
    expect(await db.getSmartLoopAutoStart()).toBe(false)
  })
})

describe('template overrides (self-learning approvals)', () => {
  it('adds, lists, and removes overrides', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    expect(await db.getTemplateOverrides()).toEqual([])

    const override = await db.addTemplateOverride({
      category: 'genreKey',
      key: 'jrock',
      boost: 15,
      reason: 'test',
    })
    expect(await db.getTemplateOverrides()).toHaveLength(1)

    await db.removeTemplateOverride(override.id)
    expect(await db.getTemplateOverrides()).toEqual([])
  })

  it('updates an existing override in place instead of adding a duplicate for the same category+key', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const first = await db.addTemplateOverride({ category: 'genreKey', key: 'jrock', boost: 5, reason: 'first' })
    const second = await db.addTemplateOverride({ category: 'genreKey', key: 'jrock', boost: 5, reason: 'second' })

    // 重複して積み上がると、承認回数の多いジャンルが自己強化的に選ばれやすくなるバグの原因になるため、
    // 同じカテゴリ・キーは1件だけ保持し、内容を更新する
    const overrides = await db.getTemplateOverrides()
    expect(overrides).toHaveLength(1)
    expect(overrides[0].id).toBe(first.id)
    expect(second.id).toBe(first.id)
    expect(overrides[0].reason).toBe('second')
  })
})

describe('keyword associations (context learning)', () => {
  it('adds, lists, and removes associations', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    expect(await db.getKeywordAssociations()).toEqual([])

    const association = await db.addKeywordAssociation({
      word: '深夜のコンビニ帰り',
      contextType: 'mood',
      contextKey: 'late_night_drive',
      reason: 'test',
    })
    expect(await db.getKeywordAssociations()).toHaveLength(1)

    await db.removeKeywordAssociation(association.id)
    expect(await db.getKeywordAssociations()).toEqual([])
  })
})

describe('demoted keywords', () => {
  it('adds, lists, and removes demoted keywords', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    expect(await db.getDemotedKeywords()).toEqual([])

    const demoted = await db.addDemotedKeyword({ word: '微妙な語', reason: 'test' })
    expect(await db.getDemotedKeywords()).toHaveLength(1)

    await db.removeDemotedKeyword(demoted.id)
    expect(await db.getDemotedKeywords()).toEqual([])
  })
})

describe('tempo hints', () => {
  it('adds, lists, and removes tempo hints', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    expect(await db.getTempoHints()).toEqual([])

    const hint = await db.addTempoHint({
      genreKey: 'jrock',
      tempo: 128,
      sampleCount: 3,
      averageRating: 4.7,
      reason: 'test',
    })
    expect(await db.getTempoHints()).toHaveLength(1)

    await db.removeTempoHint(hint.id)
    expect(await db.getTempoHints()).toEqual([])
  })
})

describe('encrypted backup export/import', () => {
  it('round-trips history, presets, and imported prompts through export/import', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    await db.addHistoryEntry({
      kind: 'composition',
      input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] },
      variants: [],
      tags: [],
    })
    await db.addPreset('プリセットA', { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] })
    await db.addImportedPrompts([{ title: 'テーマ', body: '本文', sourceFormat: 'json' }])

    const backup = await db.exportEncryptedBackup()
    expect(backup.history).toHaveLength(1)
    expect(backup.presets).toHaveLength(1)
    expect(backup.importedPrompts).toHaveLength(1)

    await db.clearHistory()
    expect(await db.getAllHistory()).toHaveLength(0)

    await db.importEncryptedBackup(backup)
    expect(await db.getAllHistory()).toHaveLength(1)
  })
})
