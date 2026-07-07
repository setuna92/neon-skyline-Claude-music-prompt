import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'

const DB_NAME = 'music-prompt-app'
let activeDbModule: typeof import('../db') | null = null

async function freshDb() {
  if (activeDbModule) await activeDbModule.closeDB()
  await deleteDB(DB_NAME).catch(() => {})
  activeDbModule = await import('../db')
  return activeDbModule
}

afterEach(async () => {
  if (activeDbModule) {
    await activeDbModule.closeDB()
    activeDbModule = null
  }
})

describe('SmartGenerationLoop', () => {
  it('runs exactly maxCyclesPerSession cycles then stops with that reason', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')
    const { SmartGenerationLoop } = await import('./smartGenerationLoop')

    const loop = new SmartGenerationLoop()
    await new Promise<void>((resolve) => {
      const unsubscribe = loop.subscribe(({ metrics }) => {
        if (metrics.status === 'stopped') {
          unsubscribe()
          resolve()
        }
      })
      void loop.start({ cycleDelayMs: 1, maxCyclesPerSession: 3 })
    })

    const metrics = loop.getMetrics()
    expect(metrics.cyclesCompleted).toBe(3)
    expect(metrics.lastStopReason).toContain('最大サイクル数')
  })

  it('stop() halts the loop before maxCyclesPerSession is reached', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')
    const { SmartGenerationLoop } = await import('./smartGenerationLoop')

    const loop = new SmartGenerationLoop()
    await new Promise<void>((resolve) => {
      let stopped = false
      const unsubscribe = loop.subscribe(({ latestCycle }) => {
        if (latestCycle && !stopped) {
          stopped = true
          loop.stop('test stop')
        }
      })
      setTimeout(() => {
        unsubscribe()
        resolve()
      }, 200)
      void loop.start({ cycleDelayMs: 50, maxCyclesPerSession: 1000 })
    })

    const metrics = loop.getMetrics()
    expect(metrics.status).toBe('stopped')
    expect(metrics.lastStopReason).toBe('test stop')
    expect(metrics.cyclesCompleted).toBeLessThan(1000)
  })

  it('each cycle saves a coherent, auto-rated composition + lyrics pair tagged as auto-generated', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')
    const { SmartGenerationLoop, SMART_LOOP_TAG } = await import('./smartGenerationLoop')

    const loop = new SmartGenerationLoop()
    await new Promise<void>((resolve) => {
      const unsubscribe = loop.subscribe(({ metrics }) => {
        if (metrics.status === 'stopped') {
          unsubscribe()
          resolve()
        }
      })
      void loop.start({ cycleDelayMs: 1, maxCyclesPerSession: 1 })
    })

    const history = await db.getAllHistory()
    expect(history).toHaveLength(2)

    const composition = history.find((e) => e.kind === 'composition')
    const lyrics = history.find((e) => e.kind === 'lyricsPrompt')
    expect(composition).toBeDefined()
    expect(lyrics).toBeDefined()

    expect(composition?.tags).toEqual([SMART_LOOP_TAG])
    expect(lyrics?.tags).toEqual([SMART_LOOP_TAG])

    expect(typeof composition?.rating).toBe('number')
    expect(composition?.rating).toBeGreaterThanOrEqual(1)
    expect(composition?.rating).toBeLessThanOrEqual(5)
    expect(typeof lyrics?.rating).toBe('number')

    // 作曲プロンプトと歌詞プロンプトの世界観が揃っている(ジャンル・ムード・雰囲気が一致)こと
    if (composition && lyrics) {
      expect(lyrics.input.genreKey).toBe(composition.input.genreKey)
      expect(lyrics.input.moodKey).toBe(composition.input.moodKey)
      expect(lyrics.input.atmosphereKeys).toEqual(composition.input.atmosphereKeys)
    }
  })

  it('accumulates multiple cycles worth of history (4 entries after 2 cycles)', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')
    const { SmartGenerationLoop } = await import('./smartGenerationLoop')

    const loop = new SmartGenerationLoop()
    await new Promise<void>((resolve) => {
      const unsubscribe = loop.subscribe(({ metrics }) => {
        if (metrics.status === 'stopped') {
          unsubscribe()
          resolve()
        }
      })
      void loop.start({ cycleDelayMs: 1, maxCyclesPerSession: 2 })
    })

    const history = await db.getAllHistory()
    expect(history).toHaveLength(4)
  })
})
